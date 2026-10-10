import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTenant } from './tenant.mjs';

export async function readPrivateJson(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Absolute private file required');
  const resolved = await realpath(path), repo = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const rel = relative(repo, resolved);
  if (!rel || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) throw new Error('Private input must be outside source');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Owner-only private file required');
    const bytes = await file.readFile();
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Private input too large');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await file.close(); }
}

export function validateAccessConfig({issuer, audience, allowedEmails, publicHost}) {
  if (typeof issuer !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)) throw new Error('Explicit Cloudflare Access issuer required');
  if (typeof audience !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(audience)) throw new Error('Explicit application audience required');
  if (typeof publicHost !== 'string' || publicHost.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(publicHost)) throw new Error('Explicit public hostname required');
  if (!Array.isArray(allowedEmails) || !allowedEmails.length || allowedEmails.length > 20 || allowedEmails.some(e => typeof e !== 'string' || e.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e))) throw new Error('Explicit viewer email allowlist required');
  return Object.freeze({issuer, audience, publicHost, allowedEmails: Object.freeze([...new Set(allowedEmails.map(e => e.toLowerCase()))])});
}

export async function loadRuntimeConfig(env = process.env) {
  const access = validateAccessConfig({issuer: env.REPORTING_ACCESS_ISSUER, audience: env.REPORTING_ACCESS_AUDIENCE, publicHost: env.REPORTING_PUBLIC_HOST, allowedEmails: env.REPORTING_VIEWER_EMAILS?.split(',').map(e => e.trim())});
  const tenant = validateTenant(await readPrivateJson(env.REPORTING_TENANT_FILE));
  if (tenant.mode !== 'private') throw new Error('Private runtime tenant required');
  const port = Number(env.REPORTING_PORT ?? 8080), host = env.REPORTING_BIND ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Invalid listen configuration');
  return Object.freeze({access, tenant, host, port, directory: env.REPORTING_STATE_DIR});
}
