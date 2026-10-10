import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from 'jose';
import { createAccessVerifier } from '../src/access.mjs';
import { validateAccessConfig } from '../src/runtime-config.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

test('signed Access identity must match issuer, audience, time and exact viewer', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const verify = createAccessVerifier(f.access, {keySet: f.keySet});
  assert.equal(await verify(await f.sign()), true);
  const bad = [undefined, '', 'untrusted', 'a.b.c', 'x'.repeat(16001)];
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [{aud: 'b'.repeat(64)}, {iss: 'https://other.cloudflareaccess.com'}, {exp: now - 1}, {nbf: now + 60}, {iat: now + 60}, {email: 'another@example.invalid'}, {type: 'service'}, {sub: ''}, {exp: undefined}, {iat: undefined}]) bad.push(await f.sign(claims));
  const forged = await generateKeyPair('RS256');
  bad.push(await f.sign({}, forged.privateKey));
  for (const token of bad) await assert.rejects(verify(token), /Access denied/);
});

test('Access config cannot derive keys from HTTP, other hosts, paths or blank audience', async t => {
  const f = await fixture(); t.after(f.cleanup);
  for (const change of [{issuer: 'http://fictional.cloudflareaccess.com'}, {issuer: 'https://fictional.cloudflareaccess.com/extra'}, {issuer: 'https://localhost'}, {issuer: 'https://user@fictional.cloudflareaccess.com'}, {audience: ''}, {allowedEmails: []}, {allowedEmails: ['*']}, {publicHost: 'report.example.invalid:443'}]) assert.throws(() => validateAccessConfig({...f.access, ...change}));
});

test('remote signing-key path is fixed, bounded and fail-closed without leaking assertion', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const token = await f.sign();
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), f.access.issuer + '/cdn-cgi/access/certs');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.stringify(options).includes(token), false);
    return new Response(JSON.stringify({keys: [f.jwk]}));
  };
  const verify = createAccessVerifier(f.access);
  assert.equal(await verify(token), true);
  assert.equal(await verify(token), true);
  assert.equal(calls, 1);
  for (const response of [() => new Response('unavailable', {status: 503}), () => new Response('x'.repeat(65537)), () => new Response('{}')]) {
    globalThis.fetch = async () => response();
    await assert.rejects(createAccessVerifier(f.access)(token), /Access denied/);
  }
  globalThis.fetch = async () => { throw new Error('unavailable'); };
  await assert.rejects(createAccessVerifier(f.access)(token), /Access denied/);
});
