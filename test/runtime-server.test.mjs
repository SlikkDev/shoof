import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

const get = (server, path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const req = request({hostname:'127.0.0.1', port:server.address().port, path, method, headers}, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', chunk => {body += chunk;}); res.on('end', () => resolve({status:res.statusCode, headers:res.headers, body}));
  }); req.on('error', reject); req.end();
});
const close = server => new Promise(resolve => server.close(resolve));

test('origin rejects anonymous/forged identities on all content routes and every read requires a valid assertion', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config); await data.publish(f.snapshot, f.observations);
  const server = await startRuntime(f.config, {keySet:f.keySet}); t.after(() => close(server));
  for (const path of ['/', '/api/report', '/styles.css', '/app.mjs', '/healthz']) {
    assert.equal((await get(server, path, {host:f.access.publicHost})).status, 401);
    assert.equal((await get(server, path, {host:f.access.publicHost,'cf-access-authenticated-user-email':f.access.allowedEmails[0],'x-forwarded-for':'127.0.0.1'})).status, 401);
  }
  assert.equal((await get(server, '/api/report')).status, 421);
  assert.equal((await get(server, '/healthz')).status, 200);
  for (const token of ['a.b.c', await f.sign({aud:'b'.repeat(64)}), await f.sign({exp:1}), await f.sign({email:'outsider@example.invalid'})]) assert.equal((await get(server, '/api/report', {host:f.access.publicHost,'cf-access-jwt-assertion':token})).status, 401);
  const headers = {host:f.access.publicHost,'cf-access-jwt-assertion':await f.sign()};
  const response = await get(server, '/api/report', headers);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).observations[0].metrics[0].total, 7);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  for (const path of ['/api/report?tenantId=other', '/tenant.json', '/.env', '/state/', '/src/access.mjs', '/%2e%2e/tenant.json']) assert.equal((await get(server, path, headers)).status, 404);
  assert.equal((await get(server, '/api/report', headers, 'POST')).status, 405);
  assert.equal((await get(server, '/api/report', headers, 'HEAD')).body, '');
});

test('uninitialized state is unavailable; accepted updates survive HTTP server restart', async t => {
  const f = await fixture(); t.after(f.cleanup);
  let server = await startRuntime(f.config, {keySet:f.keySet});
  t.after(() => close(server));
  const headers = {host:f.access.publicHost,'cf-access-jwt-assertion':await f.sign()};
  assert.equal((await get(server, '/api/report', headers)).status, 503);
  const data = await createRuntimeData(f.config); await data.publish(f.snapshot, f.observations);
  const before = JSON.parse((await get(server, '/api/report', headers)).body);
  await close(server); server = await startRuntime(f.config, {keySet:f.keySet});
  assert.deepEqual(JSON.parse((await get(server, '/api/report', headers)).body), before);
});
