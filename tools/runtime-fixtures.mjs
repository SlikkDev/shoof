// Entirely fictional fixtures. Signing keys are generated in memory per test run.
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'shoof-fictional-'));
  const tenant = JSON.parse(await readFile(new URL('../examples/tenant.demo.json', import.meta.url), 'utf8'));
  tenant.mode = 'private';
  tenant.displayName = 'Harbor & Pine (fictional)';
  const snapshot = JSON.parse(await readFile(new URL('../examples/snapshot.demo.json', import.meta.url), 'utf8'));
  snapshot.sources.forEach(source => { source.coverage.status = 'unknown'; source.reconciliation.status = 'pending'; });
  const access = {issuer: 'https://fictional.cloudflareaccess.com', audience: 'a'.repeat(64), publicHost: 'report.example.invalid', allowedEmails: ['reader@example.invalid']};
  const {privateKey, publicKey} = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(publicKey), kid: 'fictional-signing-key', alg: 'RS256', use: 'sig'};
  const keySet = createLocalJWKSet({keys: [jwk]});
  const sign = (changes = {}, key = privateKey, header = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({iss: access.issuer, aud: access.audience, sub: 'fictional-reader', email: access.allowedEmails[0], type: 'app', iat: now, exp: now + 300, ...changes}).setProtectedHeader({alg: 'RS256', kid: jwk.kid, ...header}).sign(key);
  };
  const observations = {schemaVersion: 1, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, sources: [{sourceId: 'ga4', period: {...snapshot.period}, observedAt: snapshot.asOf, origin: 'ui-snapshot', sourceTimezone: null, lastSuccessfulReadAt: null, metrics: [{key: 'sessions', label: 'Sessions', unit: 'count', values: [{date: snapshot.period.start, value: 7}]}]}]};
  const config = {tenant, directory, access, port: 0, host: '127.0.0.1'};
  const tenantFile = join(directory, 'tenant.json'), snapshotFile = join(directory, 'snapshot.json'), observationsFile = join(directory, 'observations.json');
  for (const [path, value] of [[tenantFile, tenant], [snapshotFile, snapshot], [observationsFile, observations]]) await writeFile(path, JSON.stringify(value), {mode: 0o600});
  const env = {REPORTING_TENANT_FILE: tenantFile, REPORTING_SNAPSHOT_FILE: snapshotFile, REPORTING_OBSERVATIONS_FILE: observationsFile, REPORTING_STATE_DIR: directory, REPORTING_ACCESS_ISSUER: access.issuer, REPORTING_ACCESS_AUDIENCE: access.audience, REPORTING_PUBLIC_HOST: access.publicHost, REPORTING_VIEWER_EMAILS: access.allowedEmails.join(',')};
  return {directory, tenant, snapshot, observations, access, config, keySet, jwk, sign, env, tenantFile, snapshotFile, cleanup: () => rm(directory, {recursive: true, force: true})};
}
