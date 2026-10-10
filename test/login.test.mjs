import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../web/login.mjs', import.meta.url), 'utf8');

// Exercise the shipped page script across browser events without reloading it.
// Network calls remain pending until each test supplies its fictional response.
function page(hash = '') {
  function element() {
    const listeners = new Map();
    return {hidden: false, disabled: false, textContent: '',
      addEventListener: (name, listener) => listeners.set(name, listener),
      fire(name) { return listeners.get(name)?.({currentTarget: this, preventDefault() {}}); }};
  }
  const form = element(), message = element(), confirmation = element(), confirm = element(), passkey = element(), request = element(), window = element();
  confirmation.hidden = true;
  form.email = {value: 'owner@example.invalid'};
  form.querySelector = () => request;
  const elements = {'#login': form, '#message': message, '#confirmation': confirmation, '#confirm': confirm, '#passkey': passkey};
  const calls = [], navigations = [], historyEntries = [];
  const location = {hash, replace: path => navigations.push(path)};
  runInNewContext(script, {
    document: {querySelector: selector => elements[selector]}, location, URLSearchParams,
    history: {replaceState(_state, _title, path) { historyEntries.push(path); location.hash = ''; }},
    addEventListener: window.addEventListener,
    fetch: (path, options) => new Promise((resolve, reject) => calls.push({path, ...options, resolve, reject}))
  });
  return {form, message, confirmation, confirm, request, calls, navigations, historyEntries, location,
    openLink(token) { location.hash = '#token=' + token; return window.fire('hashchange'); }};
}

function assertConfirmation(p) {
  assert.equal(p.location.hash, '');
  assert.equal(p.historyEntries.at(-1), '/login');
  assert.equal(p.confirmation.hidden, false);
  assert.equal(p.form.hidden, true);
  assert.equal(p.confirm.disabled, false);
  assert.equal(p.message.textContent, '');
  assert.deepEqual(p.navigations, []);
}

test('initial magic link clears its fragment and waits for an explicit confirmation click', async () => {
  const p = page('#token=fictional-initial');
  assertConfirmation(p);
  assert.equal(p.calls.length, 0);
  const click = p.confirm.fire('click');
  assert.equal(p.confirm.disabled, true);
  assert.equal(p.calls[0].path, '/api/magic/confirm');
  assert.equal(p.calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(p.calls[0].body), {token: 'fictional-initial'});
  p.calls[0].resolve({ok: true}); await click;
  assert.deepEqual(p.navigations, ['/']);
});

test('an already-open login page accepts a same-document magic link without a reload or automatic redemption', async () => {
  const p = page();
  const submit = p.form.fire('submit'); p.calls[0].resolve({ok: true}); await submit;
  assert.match(p.message.textContent, /arrive shortly/);
  p.openLink('fictional-same-tab');
  assertConfirmation(p);
  assert.equal(p.form.email.value, 'owner@example.invalid');
  assert.equal(p.calls.length, 1);
  const click = p.confirm.fire('click');
  assert.deepEqual(JSON.parse(p.calls[1].body), {token: 'fictional-same-tab'});
  p.calls[1].resolve({ok: true}); await click;
  assert.deepEqual(p.navigations, ['/']);
});

for (const failure of ['rejected link', 'interrupted connection']) {
  test(`a replacement link resets the UI after ${failure}`, async () => {
    const p = page('#token=fictional-old');
    const first = p.confirm.fire('click');
    if (failure === 'rejected link') p.calls[0].resolve({ok: false});
    else p.calls[0].reject(new Error('Fictional connection failure'));
    await first;
    assert.equal(p.form.hidden, false);
    assert.equal(p.confirmation.hidden, true);
    assert.match(p.message.textContent, /could not be used/);
    p.openLink('fictional-replacement');
    assertConfirmation(p);
    assert.equal(p.calls.length, 1);
    const second = p.confirm.fire('click');
    assert.deepEqual(JSON.parse(p.calls[1].body), {token: 'fictional-replacement'});
    p.calls[1].resolve({ok: true}); await second;
    assert.deepEqual(p.navigations, ['/']);
  });
}

for (const outcome of ['failure', 'interruption']) {
  test(`a superseded confirmation ${outcome} cannot change the replacement link UI`, async () => {
    const p = page('#token=fictional-old');
    const first = p.confirm.fire('click');
    p.openLink('fictional-replacement');
    assertConfirmation(p);
    if (outcome === 'interruption') p.calls[0].reject(new Error('Fictional connection failure'));
    else p.calls[0].resolve({ok: false});
    await first;
    assertConfirmation(p);
    const second = p.confirm.fire('click');
    assert.deepEqual(JSON.parse(p.calls[1].body), {token: 'fictional-replacement'});
    p.calls[1].resolve({ok: true}); await second;
    assert.deepEqual(p.navigations, ['/']);
  });
}

test('a successful older confirmation completes sign-in after a replacement link arrives', async () => {
  const p = page('#token=fictional-old');
  const first = p.confirm.fire('click');
  p.openLink('fictional-replacement');
  assertConfirmation(p);
  p.calls[0].resolve({ok: true}); await first;
  assert.deepEqual(p.navigations, ['/']);
  assert.equal(p.message.textContent, '');
  // While navigation is pending, do not try to consume B with a cleared flow.
  await p.confirm.fire('click');
  assert.equal(p.calls.length, 1);
});

test('a delayed email-request response cannot overwrite a new link confirmation', async () => {
  const p = page();
  const submit = p.form.fire('submit');
  p.openLink('fictional-replacement');
  p.calls[0].resolve({ok: true}); await submit;
  assertConfirmation(p);
  assert.equal(p.request.disabled, false);
  assert.equal(p.calls.length, 1);
});

test('an old response cannot re-enable an in-flight replacement confirmation', async () => {
  const p = page('#token=fictional-old');
  const first = p.confirm.fire('click');
  p.openLink('fictional-replacement');
  const second = p.confirm.fire('click');
  p.calls[0].resolve({ok: false}); await first;
  assert.equal(p.confirm.disabled, true);
  assert.equal(p.confirmation.hidden, false);
  assert.equal(p.message.textContent, '');
  assert.deepEqual(p.navigations, []);
  await p.confirm.fire('click');
  assert.equal(p.calls.length, 2);
  p.calls[1].resolve({ok: true}); await second;
  assert.deepEqual(p.navigations, ['/']);
});

test('an empty-token fragment is scrubbed and cannot leave an old token ready to consume', async () => {
  const p = page('#token=fictional-old');
  p.openLink('');
  assert.equal(p.location.hash, '');
  assert.equal(p.confirmation.hidden, true);
  assert.equal(p.form.hidden, false);
  await p.confirm.fire('click');
  assert.equal(p.calls.length, 0);
});
