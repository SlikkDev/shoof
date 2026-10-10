import { read } from 'read';
import { loadRuntimeConfig } from '../src/runtime-config.mjs';
import { createAuth } from '../src/auth.mjs';

try {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.slice(2).some(arg => arg !== '--reset') || process.argv.length > 3) throw new Error('Use an interactive terminal');
  const auth = await createAuth(await loadRuntimeConfig());
  const reset = process.argv.includes('--reset');
  if (reset && await read({prompt: 'Reset owner password and revoke every session? Type RESET: '}) !== 'RESET') throw new Error('Cancelled');
  const email = await read({prompt: 'Owner email: '});
  const password = await read({prompt: 'Password (15–128 characters): ', silent: true});
  const confirmation = await read({prompt: 'Confirm password: ', silent: true});
  if (password !== confirmation) throw new Error('Passwords do not match');
  await auth.setup(email, password, {reset});
  console.log(reset ? 'Owner updated. All previous sessions revoked.' : 'Owner account created. Sign in through the HTTPS dashboard.');
} catch { console.error('Owner setup refused. Use a private interactive terminal, valid email and matching passwords of 15–128 characters. Existing state was preserved.'); process.exitCode = 1; }
