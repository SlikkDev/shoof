const form = document.querySelector('#login'), message = document.querySelector('#message');
const confirmation = document.querySelector('#confirmation'), confirm = document.querySelector('#confirm');
// Fragments never reach the HTTP server or access logs. Remove from history
// immediately; neither loading the page nor a scanner GET consumes a link.
let magic = null, linkVersion = 0;
function ingestLink() {
  magic = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', '/login');
  linkVersion += 1;
  confirm.disabled = false;
  message.textContent = '';
  confirmation.hidden = !magic;
  form.hidden = Boolean(magic);
}
addEventListener('hashchange', ingestLink);
ingestLink();
async function post(path, body) { return fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Shoof-Request': '1'}, body: JSON.stringify(body)}); }
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button'), version = linkVersion; button.disabled = true; message.textContent = '';
  try { const r = await post('/api/magic/request', {email: form.email.value}); if (version === linkVersion) message.textContent = r.ok ? 'If this address is allowed, a link will arrive shortly. Open it in this browser.' : 'Please try again later.'; } catch { if (version === linkVersion) message.textContent = 'Could not connect. Please try again.'; } finally { button.disabled = false; }
});
confirm.addEventListener('click', async () => {
  if (!magic || confirm.disabled) return;
  const version = linkVersion, token = magic;
  confirm.disabled = true;
  try {
    const r = await post('/api/magic/confirm', {token});
    // A successful response has already applied its session/flow cookies, even
    // when another link arrived meanwhile. Complete that authenticated sign-in.
    if (r.ok) { magic = null; location.replace('/'); return; }
    if (version !== linkVersion) return;
    throw new Error();
  }
  catch { if (version !== linkVersion) return; magic = null; message.textContent = 'This link could not be used. Request a new link here, then open it in this browser.'; form.hidden = false; confirmation.hidden = true; }
  finally { if (version === linkVersion) confirm.disabled = false; }
});
document.querySelector('#passkey').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; message.textContent = '';
  try { const r = await post('/api/passkeys/options', {}); if (!r.ok) throw new Error(); const {options, ceremonyId} = await r.json(); const response = await SimpleWebAuthnBrowser.startAuthentication({optionsJSON: options}); const verified = await post('/api/passkeys/verify', {ceremonyId, response}); if (!verified.ok) throw new Error(); location.replace('/'); }
  catch { message.textContent = 'Passkey sign-in was not completed. Try again or use an email link.'; } finally { button.disabled = false; }
});
