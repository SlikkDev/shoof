const form = document.querySelector('#login'), message = document.querySelector('#message');
// Fragments never reach the HTTP server or access logs. Remove from history
// immediately; neither loading the page nor a scanner GET consumes a link.
let magic = new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null, '', '/login');
if (magic) { document.querySelector('#confirmation').hidden = false; form.hidden = true; }
async function post(path, body) { return fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Shoof-Request': '1'}, body: JSON.stringify(body)}); }
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; message.textContent = '';
  try { const r = await post('/api/magic/request', {email: form.email.value}); message.textContent = r.ok ? 'If this address is allowed, a link will arrive shortly. Open it in this browser.' : 'Please try again later.'; } catch { message.textContent = 'Could not connect. Please try again.'; } finally { button.disabled = false; }
});
document.querySelector('#confirm').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { const r = await post('/api/magic/confirm', {token: magic}); magic = null; if (!r.ok) throw new Error(); location.replace('/'); }
  catch { message.textContent = 'This link could not be used. Request a new link here, then open it in this browser.'; form.hidden = false; document.querySelector('#confirmation').hidden = true; }
});
document.querySelector('#passkey').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; message.textContent = '';
  try { const r = await post('/api/passkeys/options', {}); if (!r.ok) throw new Error(); const {options, ceremonyId} = await r.json(); const response = await SimpleWebAuthnBrowser.startAuthentication({optionsJSON: options}); const verified = await post('/api/passkeys/verify', {ceremonyId, response}); if (!verified.ok) throw new Error(); location.replace('/'); }
  catch { message.textContent = 'Passkey sign-in was not completed. Try again or use an email link.'; } finally { button.disabled = false; }
});
