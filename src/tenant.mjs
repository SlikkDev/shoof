import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, daysInPeriod } from './model.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set(['schemaVersion','tenantId','workspaceId','displayName','mode','locale','direction','timezone','currency','accent']);
export function validateTenant(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.has(k))) throw new Error('Invalid tenant fields; secrets do not belong in tenant configuration');
  if (input.schemaVersion !== 1 || !['demo','private'].includes(input.mode)) throw new Error('Invalid tenant version or mode');
  for (const key of ['tenantId','workspaceId']) if (typeof input[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input[key])) throw new Error('Invalid tenant identity');
  if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 80 || /[\x00-\x1f]/.test(input.displayName)) throw new Error('Invalid display name');
  if (!['ltr','rtl'].includes(input.direction) || !/^[A-Z]{3}$/.test(input.currency) || !/^#[0-9a-f]{6}$/i.test(input.accent)) throw new Error('Invalid presentation configuration');
  if (typeof input.locale !== 'string' || !input.locale || typeof input.timezone !== 'string' || !input.timezone) throw new Error('Explicit locale and timezone required');
  try { new Intl.DateTimeFormat(input.locale, {timeZone:input.timezone}); new Intl.NumberFormat(input.locale,{style:'currency',currency:input.currency}); } catch { throw new Error('Invalid locale, timezone or currency'); }
  return Object.freeze({...input});
}
export function createReport(tenantInput, snapshot) {
  const tenant = validateTenant(tenantInput);
  if (!snapshot || snapshot.workspaceId !== tenant.workspaceId || snapshot.timezone !== tenant.timezone || snapshot.currency !== tenant.currency) throw new Error('Snapshot does not match tenant scope');
  if (!Array.isArray(snapshot.sources) || !snapshot.sources.length || new Set(snapshot.sources.map(s=>s.id)).size !== snapshot.sources.length) throw new Error('Invalid source registry');
  daysInPeriod(snapshot.period);
  const report = buildReport(snapshot);
  // Public presentation fields only. No workspace/account IDs, evidence URLs,
  // raw connector payloads, source notes, credentials or customer rows.
  return {...report, mode:tenant.mode === 'demo'?'demo':'snapshot', tenant:{displayName:tenant.displayName,locale:tenant.locale,direction:tenant.direction,accent:tenant.accent}, disclaimer:tenant.mode === 'demo'?'Fictional demonstration. All observations are synthetic. No live integrations.':'Private local snapshot. No live connection is active.'};
}
async function externalFile(path) {
  if (!isAbsolute(path)) throw new Error('Private inputs must use absolute paths outside the code repository');
  const resolved=await realpath(path), rel=relative(await realpath(root),resolved);
  if (rel === '' || (!rel.startsWith('..'+sep) && rel !== '..' && !isAbsolute(rel))) throw new Error('Private inputs must be outside the code repository');
  return resolved;
}
export async function loadReport(env=process.env) {
  const config=env.REPORTING_TENANT_FILE, snapshot=env.REPORTING_SNAPSHOT_FILE;
  if (Boolean(config)!==Boolean(snapshot)) throw new Error('Supply both external tenant and snapshot paths');
  const configPath=config?await externalFile(config):new URL('../examples/tenant.demo.json',import.meta.url);
  const snapshotPath=snapshot?await externalFile(snapshot):new URL('../examples/snapshot.demo.json',import.meta.url);
  const [tenant,data]=await Promise.all([readFile(configPath,'utf8').then(JSON.parse),readFile(snapshotPath,'utf8').then(JSON.parse)]);
  if (config && tenant.mode !== 'private') throw new Error('External runtime configuration must use private mode');
  return createReport(tenant,data);
}
