const form = document.querySelector('#login'), message = document.querySelector('#message'), button = form.querySelector('button');
form.addEventListener('submit', async event => {
  event.preventDefault(); button.disabled = true; message.textContent = '';
  try {
    const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Shoof-Request': '1'}, body: JSON.stringify({email: form.email.value, password: form.password.value})});
    form.password.value = '';
    if (response.ok) { location.replace('/'); return; }
    message.textContent = response.status === 429 ? 'Too many sign-in attempts. Please try again in 15 minutes.' : response.status === 401 ? 'Email or password is incorrect.' : 'Sign-in is unavailable. Please contact the dashboard owner.';
  } catch { form.password.value = ''; message.textContent = 'Could not connect. Please try again.'; }
  finally { button.disabled = false; }
});
