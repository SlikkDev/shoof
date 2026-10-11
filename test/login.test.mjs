import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const script = await readFile(new URL('../web/login.mjs', import.meta.url), 'utf8');
const tokenA = 'a'.repeat(43), tokenB = 'b'.repeat(43);
const settle = () => new Promise(resolve => setImmediate(resolve));
function page(hash = '', {visibilityState = 'visible', prerendering = false} = {}) {
  function element() {
    const listeners = new Map();
    return {hidden: false, disabled: false, textContent: '', dataset: {},
      addEventListener: (name, listener) => listeners.set(name, listener),
      fire(name, event = {}) { return listeners.get(name)?.({currentTarget: this, preventDefault() {}, ...event}); }};
  }
  const form = element(), message = element(), passkey = element(), request = element(), window = element(), document = element();
  form.email = {value: 'owner@example.invalid'}; form.querySelector = () => request;
  const elements = {'#login': form, '#message': message, '#passkey': passkey};
  Object.assign(document, {visibilityState, prerendering, querySelector: selector => elements[selector]});
  const calls = [], navigations = [], historyEntries = [];
  const location = {hash, replace: path => navigations.push(path)};
  runInNewContext(script, {document, location, URLSearchParams, AbortSignal,
    history: {replaceState(_state, _title, path) { historyEntries.push(path); location.hash = ''; }},
    addEventListener: window.addEventListener,
    SimpleWebAuthnBrowser: {startAuthentication: async () => ({fictional: true})},
    fetch: (path, options) => new Promise((resolve, reject) => calls.push({path, ...options, resolve, reject}))
  });
  return {form, message, passkey, request, calls, navigations, historyEntries, location, document,
    openLink(token) { location.hash = '#token=' + token; return window.fire('hashchange'); },
    show: persisted => window.fire('pageshow', {persisted})};
}
function assertScrubbed(p) { assert.equal(p.location.hash, ''); assert.equal(p.historyEntries.at(-1), '/login'); }
function assertPost(call, token) {
  assert.equal(call.path, '/api/magic/confirm'); assert.equal(call.method, 'POST');
  assert.equal(call.headers['X-Shoof-Request'], '1'); assert.deepEqual(JSON.parse(call.body), {token});
}

test('initial email-app/new-tab link signs in automatically and scrubs before submitting', async () => {
  const p = page('#token=' + tokenA); assertScrubbed(p); assertPost(p.calls[0], tokenA);
  assert.equal(p.form.hidden, true); assert.equal(p.passkey.disabled, true);
  p.calls[0].resolve({ok: true}); await settle(); assert.deepEqual(p.navigations, ['/']);
});
test('already-open login accepts a same-document link without a second button or reload', async () => {
  const p = page(); const submit = p.form.fire('submit'); p.calls[0].resolve({ok: true}); await submit;
  assert.match(p.message.textContent, /any browser or device/);
  p.openLink(tokenA); assertScrubbed(p); assertPost(p.calls[1], tokenA);
  p.calls[1].resolve({ok: true}); await settle(); assert.deepEqual(p.navigations, ['/']);
});
for (const state of [{visibilityState:'hidden'}, {prerendering:true}]) test('hidden/prerendered links wait for actual visible activation', async () => {
  const p = page('#token=' + tokenA, state); assertScrubbed(p); assert.equal(p.calls.length, 0);
  await p.document.fire('visibilitychange'); assert.equal(p.calls.length, 0);
  p.document.visibilityState = 'visible'; p.document.prerendering = false;
  void p.document.fire('visibilitychange'); void p.document.fire('prerenderingchange');
  assert.equal(p.calls.length, 1); assertPost(p.calls[0], tokenA);
  p.calls[0].resolve({ok:true}); await settle(); assert.deepEqual(p.navigations, ['/']);
});
for (const failure of ['expired/replayed', 'interrupted']) test(`replacement link works after an ${failure} confirmation`, async () => {
  const p = page('#token=' + tokenA);
  if (failure === 'interrupted') p.calls[0].reject(new Error('Fictional disconnect')); else p.calls[0].resolve({ok:false});
  await settle(); assert.equal(p.calls[1].path, '/api/session'); p.calls[1].resolve({ok:false}); await settle();
  assert.equal(p.form.hidden, false); assert.equal(p.passkey.disabled, false); assert.match(p.message.textContent, /could not be used/);
  p.openLink(tokenB); assertScrubbed(p); assertPost(p.calls[2], tokenB); assert.equal(p.message.dataset.state, 'progress');
  p.calls[2].resolve({ok:true}); await settle(); assert.deepEqual(p.navigations, ['/']);
});
test('an interrupted response reconciles an already-committed browser session', async () => {
  const p = page('#token=' + tokenA); p.calls[0].reject(new Error('Fictional disconnect')); await settle();
  p.calls[1].resolve({ok:true}); await settle(); assert.deepEqual(p.navigations, ['/']); assert.equal(p.calls.length, 2);
});
test('late successful response finishes sign-in and does not submit a queued replacement', async () => {
  const p = page('#token=' + tokenA); p.openLink(tokenB); assertScrubbed(p); assert.equal(p.calls.length, 1);
  p.calls[0].resolve({ok:true}); await settle(); assert.deepEqual(p.navigations, ['/']); assert.equal(p.calls.length, 1);
  void p.document.fire('visibilitychange'); assert.equal(p.calls.length, 1);
});
test('late failure cannot overwrite or race the queued replacement', async () => {
  const p = page('#token=' + tokenA); p.openLink(tokenB); p.calls[0].resolve({ok:false}); await settle();
  assert.equal(p.calls[1].path, '/api/session'); p.calls[1].resolve({ok:false}); await settle();
  assertPost(p.calls[2], tokenB); assert.equal(p.form.hidden, true); assert.equal(p.message.textContent, 'Signing you in…');
  p.calls[2].resolve({ok:true}); await settle(); assert.deepEqual(p.navigations, ['/']);
});
test('delayed request response cannot overwrite automatic sign-in progress', async () => {
  const p = page(); const request = p.form.fire('submit'); p.openLink(tokenA);
  p.calls[0].resolve({ok:true}); await request; assert.equal(p.message.textContent, 'Signing you in…');
  p.calls[1].resolve({ok:true}); await settle(); assert.deepEqual(p.navigations, ['/']);
});
test('invalid/empty fragments are scrubbed without sending or retaining a token', async () => {
  for (const value of ['', 'incomplete', 'a'.repeat(44)]) { const p = page('#token=' + value); assertScrubbed(p); assert.equal(p.calls.length, 0); assert.equal(p.form.hidden, false); }
  const p = page('#token=' + tokenA, {visibilityState:'hidden'}); p.openLink(''); p.document.visibilityState='visible'; await p.document.fire('visibilitychange'); assert.equal(p.calls.length, 0);
});
test('back/forward cache restoration does not replay consumed tokens and checks current session', async () => {
  const p = page('#token=' + tokenA); p.calls[0].resolve({ok:true}); await settle();
  const show=p.show(true); assert.equal(p.calls[1].path, '/api/session'); p.calls[1].resolve({ok:false}); await show;
  assert.equal(p.form.hidden, false); assert.equal(p.passkey.disabled, false);
  const again=p.show(true); p.calls[2].resolve({ok:true}); await again;
  assert.deepEqual(p.navigations, ['/', '/']); assert.equal(p.calls.filter(c=>c.method==='POST').length,1); assertScrubbed(p);
});
test('passkeys remain directly available without requesting an email', async () => {
  const p=page(); const click=p.passkey.fire('click'); assert.equal(p.calls[0].path,'/api/passkeys/options');
  p.calls[0].resolve({ok:true,json:async()=>({options:{},ceremonyId:'fictional'})}); await settle();
  assert.equal(p.calls[1].path,'/api/passkeys/verify'); p.calls[1].resolve({ok:true}); await click;
  assert.deepEqual(p.navigations,['/']);
});
