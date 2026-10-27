// Entirely fictional fixtures. No real email delivery or device registration.
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservationStore } from '../src/observation-store.mjs';

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'shoof-fictional-'));
  const tenant = JSON.parse(await readFile(new URL('../examples/tenant.demo.json', import.meta.url), 'utf8'));
  tenant.mode = 'private'; tenant.displayName = 'Harbor & Pine (fictional)';
  const snapshot = JSON.parse(await readFile(new URL('../examples/snapshot.demo.json', import.meta.url), 'utf8'));
  snapshot.sources.forEach(source => { source.coverage.status = 'unknown'; source.reconciliation.status = 'pending'; });
  const publicHost = 'report.example.invalid', email = 'owner@example.invalid';
  const smtp = {host:'smtp.example.invalid',port:587,secure:false,from:'signin@example.invalid'};
  const observations = {schemaVersion: 1, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, sources: [{sourceId: 'ga4', period: {...snapshot.period}, observedAt: snapshot.asOf, origin: 'ui-snapshot', sourceTimezone: null, lastSuccessfulReadAt: null, metrics: [{key: 'sessions', label: 'Sessions', unit: 'count', values: [{date: snapshot.period.start, value: 7}]}]}]};
  const config = {tenant, directory, publicHost, ownerEmail:email, smtp, port: 0, host: '127.0.0.1'};
  const tenantFile = join(directory, 'tenant.json'), snapshotFile = join(directory, 'snapshot.json'), observationsFile = join(directory, 'observations.json'), smtpFile = join(directory, 'smtp.json');
  for (const [path, value] of [[smtpFile, smtp], [tenantFile, tenant], [snapshotFile, snapshot], [observationsFile, observations]]) await writeFile(path, JSON.stringify(value), {mode: 0o600});
  const env = {REPORTING_TENANT_FILE: tenantFile, REPORTING_SNAPSHOT_FILE: snapshotFile, REPORTING_OBSERVATIONS_FILE: observationsFile, REPORTING_STATE_DIR: directory, REPORTING_PUBLIC_HOST: publicHost, REPORTING_OWNER_EMAIL: email, REPORTING_SMTP_FILE: smtpFile, REPORTING_EXPECTED_DIGEST: 'absent'};
  // Synthetic tests capture this once before preparing a replacement candidate.
  const publicationBaseline = async () => {
    const store = await createObservationStore(directory);
    const state = await store.read({tenantId: tenant.tenantId, sourceId: 'reporting', jobId: 'published-view'});
    return {expectedDigest: state?.digest ?? null};
  };
  return {directory, tenant, snapshot, observations, publicHost, email, config, env, tenantFile, snapshotFile, publicationBaseline, cleanup: () => rm(directory, {recursive: true, force: true})};
}
