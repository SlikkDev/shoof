import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAccessVerifier } from './access.mjs';
import { createRuntimeData } from './runtime-data.mjs';

export async function startRuntime(config, {keySet} = {}) {
  const verify = createAccessVerifier(config.access, {keySet});
  const data = await createRuntimeData(config);
  const assets = new Map(await Promise.all([['/', 'index.html', 'text/html'], ['/app.mjs', 'app.mjs', 'text/javascript'], ['/styles.css', 'styles.css', 'text/css']].map(async ([path, file, type]) => [path, {bytes: await readFile(new URL('../web/' + file, import.meta.url)), type}])));
  const server = createServer({maxHeaderSize: 20000, requestTimeout: 10000, headersTimeout: 10000}, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const reply = (status, body, type = 'text/plain') => { res.writeHead(status, {'Content-Type': type + '; charset=utf-8'}); res.end(req.method === 'HEAD' ? undefined : body); };
    // Only an in-container loopback probe can bypass auth; never forwarded headers.
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (req.url === '/healthz' && loopback && ['127.0.0.1:' + req.socket.localPort, 'localhost:' + req.socket.localPort].includes(req.headers.host) && ['GET', 'HEAD'].includes(req.method)) { reply(200, 'ok'); return; }
    if (req.headers.host !== config.access.publicHost) { reply(421, 'Misdirected request'); return; }
    try { await verify(req.headers['cf-access-jwt-assertion']); }
    catch { reply(401, 'Access denied'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); reply(405, 'Read-only runtime'); return; }
    // Exact routes only; no file paths, tenant selectors, query parameters or exports.
    if (req.url === '/api/report') {
      try { reply(200, JSON.stringify(await data.read()), 'application/json'); }
      catch { reply(503, 'Report unavailable'); }
      return;
    }
    const asset = assets.get(req.url);
    if (asset) reply(200, asset.bytes, asset.type);
    else reply(404, 'Not found');
  });
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  return server;
}
