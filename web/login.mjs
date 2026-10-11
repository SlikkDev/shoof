const form = document.querySelector('#login'), message = document.querySelector('#message');
const passkey = document.querySelector('#passkey');
let pending = null, linkVersion = 0, running = false, leaving = false;
function say(text, state = 'error') { message.textContent = text; message.dataset.state = state; }
function busy(value) { form.hidden = value; passkey.disabled = value; }
function complete() { pending = null; leaving = true; location.replace('/'); }
async function post(path, body) { return fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Shoof-Request': '1'}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)}); }
async function signedIn() { try { return (await fetch('/api/session', {signal: AbortSignal.timeout(5000)})).ok; } catch { return false; } }

async function redeemPending() {
  // A background tab or prerender does not consume a link. This prevents passive
  // prefetch/scanning, not scanners that execute JavaScript in a visible page.
  if (!pending || running || leaving || document.visibilityState !== 'visible' || document.prerendering) return;
  const {token, version} = pending; pending = null; running = true;
  busy(true); say('Signing you in…', 'progress');
  try {
    const response = await post('/api/magic/confirm', {token});
    // Real Set-Cookie effects are already applied, including for a superseded
    // link. Finish successful sign-in instead of treating it as a stale promise.
    if (response.ok) { complete(); return; }
    throw new Error();
  } catch {
    // A response can be interrupted after the server committed a session. Also
    // respect a sign-in completed in another tab before reporting link failure.
    if (await signedIn()) { complete(); return; }
    if (version === linkVersion) {
      busy(false); say('This link has expired or could not be used. Request a new one, or sign in with a passkey.');
    }
  } finally {
    running = false;
    // Serialize replacement links so late responses cannot race their cookies.
    if (!leaving && pending) void redeemPending();
  }
}
function ingestLink() {
  const fragment = location.hash;
  if (!fragment) return;
  const token = new URLSearchParams(fragment.slice(1)).get('token');
  // Fragments never reach HTTP access logs. Scrub before any asynchronous work;
  // tokens live only in memory, never in local/session storage or telemetry.
  history.replaceState(null, '', '/login');
  linkVersion += 1; pending = null;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    busy(false); say('This sign-in link is incomplete. Request a new one.'); return;
  }
  pending = {token, version: linkVersion};
  busy(true); say('Signing you in when this tab is visible…', 'progress');
  void redeemPending();
}
addEventListener('hashchange', ingestLink);
document.addEventListener('visibilitychange', redeemPending);
document.addEventListener('prerenderingchange', redeemPending);
addEventListener('pageshow', async event => {
  if (!event.persisted) return;
  // A restored page never replays a token already submitted before navigation.
  if (pending || running) { void redeemPending(); return; }
  leaving = false; const version = ++linkVersion;
  busy(false); say('');
  if (await signedIn()) complete();
  else if (version === linkVersion) say('Sign in to continue.');
});
ingestLink();
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button'), version = linkVersion; button.disabled = true; say('');
  try { const r = await post('/api/magic/request', {email: form.email.value}); if (version === linkVersion && !leaving) say(r.ok ? 'Check your email. If this address is allowed, open the link to sign in on any browser or device.' : 'Please try again later.', r.ok ? 'sent' : 'error'); }
  catch { if (version === linkVersion && !leaving) say('Could not connect. Please try again.'); }
  finally { button.disabled = false; }
});
passkey.addEventListener('click', async () => {
  if (passkey.disabled || leaving) return;
  const version = linkVersion; passkey.disabled = true; say('');
  try { const r = await post('/api/passkeys/options', {}); if (!r.ok) throw new Error(); const {options, ceremonyId} = await r.json(); const response = await SimpleWebAuthnBrowser.startAuthentication({optionsJSON: options}); const verified = await post('/api/passkeys/verify', {ceremonyId, response}); if (!verified.ok) throw new Error(); complete(); }
  catch { if (version === linkVersion && !leaving) say('Passkey sign-in was not completed. Try again or use an email link.'); }
  finally { if (!pending && !running) passkey.disabled = false; }
});
