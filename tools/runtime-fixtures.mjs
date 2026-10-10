// Entirely fictional fixtures. Passwords are ephemeral and never deployed.
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../src/auth.mjs';

export async function fixture({owner = false} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shoof-fictional-'));
  const tenant = JSON.parse(await readFile(new URL('../examples/tenant.demo.json', import.meta.url), 'utf8'));
  tenant.mode = 'private'; tenant.displayName = 'Harbor & Pine (fictional)';
  const snapshot = JSON.parse(await readFile(new URL('../examples/snapshot.demo.json', import.meta.url), 'utf8'));
  snapshot.sources.forEach(source => { source.coverage.status = 'unknown'; source.reconciliation.status = 'pending'; });
  const publicHost = 'report.example.invalid', email = 'owner@example.invalid', password = 'Fictional ' + randomBytes(24).toString('base64url');
  const observations = {schemaVersion: 1, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, sources: [{sourceId: 'ga4', period: {...snapshot.period}, observedAt: snapshot.asOf, origin: 'ui-snapshot', sourceTimezone: null, lastSuccessfulReadAt: null, metrics: [{key: 'sessions', label: 'Sessions', unit: 'count', values: [{date: snapshot.period.start, value: 7}]}]}]};
  const config = {tenant, directory, publicHost, port: 0, host: '127.0.0.1'};
  const tenantFile = join(directory, 'tenant.json'), snapshotFile = join(directory, 'snapshot.json'), observationsFile = join(directory, 'observations.json');
  for (const [path, value] of [[tenantFile, tenant], [snapshotFile, snapshot], [observationsFile, observations]]) await writeFile(path, JSON.stringify(value), {mode: 0o600});
  const env = {REPORTING_TENANT_FILE: tenantFile, REPORTING_SNAPSHOT_FILE: snapshotFile, REPORTING_OBSERVATIONS_FILE: observationsFile, REPORTING_STATE_DIR: directory, REPORTING_PUBLIC_HOST: publicHost};
  if (owner) await (await createAuth(config)).setup(email, password);
  return {directory, tenant, snapshot, observations, publicHost, email, password, config, env, tenantFile, snapshotFile, cleanup: () => rm(directory, {recursive: true, force: true})};
}
