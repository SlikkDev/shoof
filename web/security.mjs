const message = document.querySelector('#message'), add = document.querySelector('#add');
const post = (path, body) => fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Shoof-Request': '1'}, body: JSON.stringify(body)});
async function load() {
  const r = await fetch('/api/session'); if (r.status === 401) { location.replace('/login'); return; } if (!r.ok) throw new Error();
  const account = await r.json(); document.querySelector('#owner').textContent = account.email; add.disabled = !account.recent || account.passkeys.length >= 5;
  message.textContent = account.recent ? '' : 'Sign in again with an email link or passkey to make changes.';
  const list = document.querySelector('#keys'); list.replaceChildren();
  if (!account.passkeys.length) { const p = document.createElement('p'); p.textContent = 'No passkeys added yet.'; list.append(p); }
  for (const key of account.passkeys) { const p = document.createElement('p'); p.textContent = 'Added ' + new Date(key.createdAt).toLocaleString(); const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = 'Remove passkey'; remove.disabled = !account.recent; remove.addEventListener('click', async () => { if (!confirm('Remove this passkey and sign out every session?')) return; remove.disabled = true; try { const r = await post('/api/passkeys/revoke', {id: key.id}); if (!r.ok) throw new Error(); location.replace('/login'); } catch { message.textContent = 'Could not remove this passkey. Sign in again and retry.'; remove.disabled = false; } }); p.append(remove); list.append(p); }
}
add.addEventListener('click', async () => { add.disabled = true; try { const r = await post('/api/passkeys/register/options', {}); if (!r.ok) throw new Error(); const {options, ceremonyId} = await r.json(); const response = await SimpleWebAuthnBrowser.startRegistration({optionsJSON: options}); const verified = await post('/api/passkeys/register/verify', {ceremonyId, response}); if (!verified.ok) throw new Error(); await load(); } catch { message.textContent = 'Passkey setup was not completed. Sign in again if needed, then retry.'; add.disabled = false; } });
load().catch(() => { add.disabled = true; message.textContent = 'Passkeys could not be loaded.'; });
