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

export function validatePublicHost(publicHost) {
  if (typeof publicHost !== 'string' || publicHost.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(publicHost)) throw new Error('Explicit public hostname required');
  return publicHost;
}

export async function loadRuntimeConfig(env = process.env) {
  const publicHost = validatePublicHost(env.REPORTING_PUBLIC_HOST);
  const tenant = validateTenant(await readPrivateJson(env.REPORTING_TENANT_FILE));
  if (tenant.mode !== 'private') throw new Error('Private runtime tenant required');
  const port = Number(env.REPORTING_PORT ?? 8080), host = env.REPORTING_BIND ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Invalid listen configuration');
  return Object.freeze({publicHost, tenant, host, port, directory: env.REPORTING_STATE_DIR});
}
