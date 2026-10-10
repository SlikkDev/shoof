import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAuth, sessionCookie, sessionToken } from './auth.mjs';
import { createRuntimeData } from './runtime-data.mjs';
import { validatePublicHost } from './runtime-config.mjs';

async function readLogin(req) {
  if (req.headers['content-encoding'] || (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > 2048))) throw new Error('Invalid body');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2048) throw new Error('Invalid body'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'email,password') throw new Error('Invalid body');
  return value;
}

export async function startRuntime(config) {
  const publicHost = validatePublicHost(config.publicHost), origin = 'https://' + publicHost;
  const auth = await createAuth(config), data = await createRuntimeData(config);
  const assets = new Map(await Promise.all([['/', 'index.html', 'text/html'], ['/app.mjs', 'app.mjs', 'text/javascript'], ['/styles.css', 'styles.css', 'text/css'], ['/login', 'login.html', 'text/html'], ['/login.mjs', 'login.mjs', 'text/javascript'], ['/login.css', 'login.css', 'text/css']].map(async ([path, file, type]) => [path, {bytes: await readFile(new URL('../web/' + file, import.meta.url)), type}])));
  const publicPaths = new Set(['/login', '/login.mjs', '/login.css']);
  // One bounded body/hash at a time per process; the private store also serializes
  // attempts across processes. Slow/parallel login requests cannot queue hashes.
  let loginInFlight = false;
  const server = createServer({maxHeaderSize: 12000, requestTimeout: 10000, headersTimeout: 10000}, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const reply = (status, body, type = 'text/plain') => { res.writeHead(status, {'Content-Type': type + '; charset=utf-8'}); res.end(req.method === 'HEAD' ? undefined : body); };
    const redirect = location => { res.setHeader('Location', location); reply(303, ''); };
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (req.url === '/healthz' && loopback && ['127.0.0.1:' + req.socket.localPort, 'localhost:' + req.socket.localPort].includes(req.headers.host) && ['GET', 'HEAD'].includes(req.method)) { reply(200, 'ok'); return; }
    if (req.headers.host !== publicHost) { reply(421, 'Misdirected request'); return; }
    // Unknown paths never reach authentication or a filesystem selector.
    if (!assets.has(req.url) && !['/api/report', '/api/login', '/api/logout'].includes(req.url)) { reply(404, 'Not found'); return; }
    const mutation = ['/api/login', '/api/logout'].includes(req.url);
    if (mutation ? req.method !== 'POST' : !['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', mutation ? 'POST' : 'GET, HEAD'); reply(405, 'Method not allowed'); return; }
    // AJAX custom-header CSRF protection, exact configured Origin, no CORS and
    // rejection of browser cross-site/same-site requests. Forwarded headers are ignored.
    if (mutation && (req.headers.origin !== origin || req.headers['x-shoof-request'] !== '1' || req.headers['content-type'] !== 'application/json' || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))) { reply(403, 'Request refused'); return; }
    const token = sessionToken(req.headers.cookie);
    try {
      if (req.url === '/api/login') {
        if (loginInFlight) { res.setHeader('Retry-After', '2'); reply(429, 'Try again later'); return; }
        loginInFlight = true;
        const deadline = setTimeout(() => req.destroy(), 5000);
        try {
          let input;
          try { input = await readLogin(req); } catch { reply(400, 'Invalid sign-in request'); return; }
          const result = await auth.login(input.email, input.password, token);
          if (result.status === 'limited') { res.setHeader('Retry-After', '900'); reply(429, 'Too many sign-in attempts. Try again later.'); return; }
          if (result.status === 'unavailable') { reply(503, 'Sign-in unavailable. Contact the operator.'); return; }
          if (result.status !== 'accepted') { reply(401, 'Email or password is incorrect.'); return; }
          res.setHeader('Set-Cookie', sessionCookie(result.token)); reply(204, '');
        } finally { clearTimeout(deadline); loginInFlight = false; }
        return;
      }
      if (req.url === '/api/logout') {
        if (Number(req.headers['content-length'] || 0) > 2 || req.headers['transfer-encoding']) { reply(400, 'Invalid request'); return; }
        await auth.logout(token); res.setHeader('Set-Cookie', sessionCookie('', true)); reply(204, ''); return;
      }
      if (publicPaths.has(req.url)) { const asset = assets.get(req.url); reply(200, asset.bytes, asset.type); return; }
      if (!await auth.authenticated(token)) {
        if (req.url === '/') redirect('/login'); else reply(401, 'Sign in required');
        return;
      }
      if (req.url === '/api/report') {
        res.setHeader('X-Shoof-Session', 'active');
        try { reply(200, JSON.stringify(await data.read()), 'application/json'); } catch { reply(503, 'Report unavailable'); }
        return;
      }
      const asset = assets.get(req.url); reply(200, asset.bytes, asset.type);
    } catch { reply(503, 'Service temporarily unavailable'); }
  });
  server.keepAliveTimeout = 5000;
  server.maxConnections = 100;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  return server;
}
