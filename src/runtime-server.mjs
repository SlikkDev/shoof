import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAuth, sessionCookie, sessionToken, newToken, flowCookieName } from './auth.mjs';
import { createMailer } from './mail.mjs';
import { createRuntimeData } from './runtime-data.mjs';
import { validatePublicHost } from './runtime-config.mjs';

async function readJson(req, max) {
  if (req.headers['content-encoding'] || (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > max))) throw new Error('Invalid body');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('Invalid body'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid body'); return value;
}
const keys = (value, expected) => Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const genericMail = 'If this address is allowed, a sign-in link will arrive shortly. Open it to sign in.';

export async function startRuntime(config, {mailer = createMailer(config.smtp)} = {}) {
  const publicHost = validatePublicHost(config.publicHost), origin = 'https://' + publicHost;
  const auth = await createAuth(config), data = await createRuntimeData(config);
  const assets = new Map(await Promise.all([['/', 'index.html', 'text/html'], ['/app.mjs', 'app.mjs', 'text/javascript'], ['/styles.css', 'styles.css', 'text/css'], ['/login', 'login.html', 'text/html'], ['/login.mjs', 'login.mjs', 'text/javascript'], ['/login.css', 'login.css', 'text/css'], ['/security', 'security.html', 'text/html'], ['/security.mjs', 'security.mjs', 'text/javascript']].map(async ([path, file, type]) => [path, {bytes: await readFile(new URL('../web/' + file, import.meta.url)), type}])));
  assets.set('/webauthn.js', {bytes: await readFile(new URL('../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', import.meta.url)), type: 'text/javascript'});
  const publicPaths = new Set(['/login', '/login.mjs', '/login.css', '/webauthn.js']);
  const postPaths = new Set(['/api/magic/request', '/api/magic/confirm', '/api/passkeys/options', '/api/passkeys/verify', '/api/passkeys/register/options', '/api/passkeys/register/verify', '/api/passkeys/revoke', '/api/logout']);
  const mailTasks = new Set();
  let inFlight = false;
  const server = createServer({maxHeaderSize: 12000, requestTimeout: 10000, headersTimeout: 10000}, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'publickey-credentials-get=(self), publickey-credentials-create=(self)');
    const reply = (status, body, type = 'text/plain') => { res.writeHead(status, {'Content-Type': type + '; charset=utf-8'}); res.end(req.method === 'HEAD' ? undefined : body); };
    const json = (status, value) => reply(status, JSON.stringify(value), 'application/json');
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (req.url === '/healthz' && loopback && ['127.0.0.1:' + req.socket.localPort, 'localhost:' + req.socket.localPort].includes(req.headers.host) && ['GET', 'HEAD'].includes(req.method)) { reply(200, 'ok'); return; }
    if (req.headers.host !== publicHost) { reply(421, 'Misdirected request'); return; }
    const mutation = postPaths.has(req.url);
    if (!assets.has(req.url) && !mutation && !['/api/report', '/api/session'].includes(req.url)) { reply(404, 'Not found'); return; }
    if (mutation ? req.method !== 'POST' : !['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', mutation ? 'POST' : 'GET, HEAD'); reply(405, 'Method not allowed'); return; }
    if (mutation && (req.headers.origin !== origin || req.headers['x-shoof-request'] !== '1' || req.headers['content-type'] !== 'application/json' || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))) { reply(403, 'Request refused'); return; }
    const token = sessionToken(req.headers.cookie), flow = sessionToken(req.headers.cookie, flowCookieName);
    try {
      if (mutation) {
        if (inFlight) { res.setHeader('Retry-After', '2'); reply(429, 'Try again later'); return; }
        inFlight = true; const deadline = setTimeout(() => req.destroy(), 5000);
        try {
          let input; try { input = await readJson(req, req.url.endsWith('/verify') ? 32768 : 2048); } catch { reply(400, 'Invalid request'); return; }
          if (req.url === '/api/magic/request') {
            if (!keys(input, ['email']) || typeof input.email !== 'string' || input.email.length > 254) { reply(400, 'Invalid request'); return; }
            // Return the same response before delivery; SMTP latency/errors do not
            // disclose whether the configured owner matched. No durable raw-token queue.
            let delivery; try { delivery = await auth.requestMagic(input.email); } catch { /* same public response */ }
            reply(202, genericMail);
            if (delivery) {
              const task = Promise.resolve().then(() => mailer.sendMagic(delivery)).catch(async () => { await auth.cancelMagic(delivery.token).catch(() => {}); }).finally(() => mailTasks.delete(task));
              mailTasks.add(task);
            }
            return;
          }
          if (req.url === '/api/logout') {
            if (!keys(input, [])) { reply(400, 'Invalid request'); return; }
            await auth.logout(token); res.setHeader('Set-Cookie', [sessionCookie('', true), sessionCookie('', true, true)]); reply(204, ''); return;
          }
          if (req.url === '/api/passkeys/revoke') {
            if (!keys(input, ['id']) || !await auth.revokePasskey(input.id, token)) { reply(403, 'Sign in again to manage passkeys'); return; }
            res.setHeader('Set-Cookie', [sessionCookie('', true), sessionCookie('', true, true)]); reply(204, ''); return;
          }
          let result;
          if (req.url === '/api/magic/confirm') {
            if (!keys(input, ['token'])) { reply(400, 'Invalid request'); return; }
            result = await auth.redeemMagic(input.token, token);
          } else {
            const kind = req.url.includes('/register/') ? 'register' : 'authenticate';
            if (req.url.endsWith('/options')) {
              if (!keys(input, [])) { reply(400, 'Invalid request'); return; }
              const browser = flow || newToken(); result = await auth.options(kind, browser, token);
              if (result.status === 'accepted') { res.setHeader('Set-Cookie', sessionCookie(browser, false, true)); json(200, {ceremonyId: result.ceremonyId, options: result.options}); return; }
            } else {
              if (!keys(input, ['ceremonyId', 'response'])) { reply(400, 'Invalid request'); return; }
              result = await auth.verify(kind, input.ceremonyId, input.response, flow, token);
            }
          }
          if (result.status !== 'accepted') { reply(result.status === 'limited' ? 429 : 403, 'Sign-in could not be verified. Please start again.'); return; }
          if (result.token) res.setHeader('Set-Cookie', [sessionCookie(result.token), sessionCookie('', true, true)]);
          reply(204, '');
        } finally { clearTimeout(deadline); inFlight = false; }
        return;
      }
      if (publicPaths.has(req.url)) { const asset = assets.get(req.url); reply(200, asset.bytes, asset.type); return; }
      if (!await auth.authenticated(token)) { if (req.url === '/' || req.url === '/security') { res.setHeader('Location', '/login'); reply(303, ''); } else reply(401, 'Sign in required'); return; }
      if (req.url === '/api/session') { const account = await auth.account(token); if (!account) { reply(401, 'Sign in required'); return; } json(200, account); return; }
      if (req.url === '/api/report') { res.setHeader('X-Shoof-Session', 'active'); try { json(200, await data.read()); } catch { reply(503, 'Report unavailable'); } return; }
      const asset = assets.get(req.url); reply(200, asset.bytes, asset.type);
    } catch { reply(503, 'Service temporarily unavailable'); }
  });
  server.keepAliveTimeout = 5000; server.maxConnections = 100;
  server.once('close', () => { void Promise.allSettled([...mailTasks]).then(() => mailer.close?.()); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  return server;
}
