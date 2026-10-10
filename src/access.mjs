import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { validateAccessConfig } from './runtime-config.mjs';

// Public signing keys only. Tokens never determine the issuer or a fetch URL.
async function fetchKeys(url, options) {
  const response = await fetch(url, {...options, redirect: 'error', signal: AbortSignal.timeout(5000)});
  if (response.status !== 200 || !response.body) throw new Error('Signing keys unavailable');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new Error('Signing keys too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return new Response(Buffer.concat(chunks), {status: 200, headers: {'content-type': 'application/json'}});
}

export function createAccessVerifier(input, {keySet} = {}) {
  const config = validateAccessConfig(input);
  // Injection is for trusted in-process tests only; there is no environment or
  // HTTP option that disables signature validation or accepts caller keys.
  const keys = keySet ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', config.issuer), {
    timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000, [customFetch]: fetchKeys
  });
  return async token => {
    if (typeof token !== 'string' || token.length > 16000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Access denied');
    try {
      const {payload} = await jwtVerify(token, keys, {issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email', 'type'], clockTolerance: 0});
      if (payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !config.allowedEmails.includes(payload.email.toLowerCase()) || payload.iat > Date.now() / 1000 || payload.exp <= payload.iat) throw new Error('Access denied');
      return true;
    } catch { throw new Error('Access denied'); }
  };
}
