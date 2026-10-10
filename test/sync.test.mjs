import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, stat, chmod, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservationStore } from '../src/observation-store.mjs';
import { runSyncTick, inspectSyncState } from '../src/sync.mjs';

// All observations, identities and dates in this suite are fictional.
const context = {tenantId: 'fictional-demo', sourceId: 'website', accountIds: ['demo-property'], metricKeys: ['sessions'], timezone: 'Etc/UTC', period: {start: '2025-01-01', endExclusive: '2025-01-03'}};
const job = {id: 'demo-daily', context, intervalMs: 3600000, staleAfterMs: 7200000, maxPages: 2, maxRows: 2};
const row = (key = 'demo-row') => ({key, accountId: 'demo-property', date: '2025-01-01', values: {sessions: 0}, customer: 'fictional-private-sentinel'});
const page = (rows = [row()], nextCursor = null) => ({...context, rows, nextCursor, secret: 'fictional-private-sentinel'});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'shoof-synthetic-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = await createObservationStore(directory);
  let instant = '2025-01-04T00:00:00.000Z';
  const args = {enabled: true, job, store, currentTenantId: () => context.tenantId, transport: async () => page(), clock: () => instant};
  return {
    directory, store, args, setTime: value => { instant = value; },
    async state() { const file = (await readdir(directory)).find(name => name.endsWith('.json')); return JSON.parse(await readFile(join(directory, file), 'utf8')); },
    async file() { return join(directory, (await readdir(directory)).find(name => name.endsWith('.json'))); }
  };
}

test('disabled ticks do not use a store, a clock or a transport', async () => {
  assert.deepEqual(await runSyncTick({clock: () => {throw new Error('must not run');}}), {status: 'disabled'});
});
test('successful ticks persist only normalized observations and never certify reporting coverage', async t => {
  const f = await fixture(t);
  const result = await runSyncTick({...f.args, job: {...job, context: {...context, kind: 'unexpected-operation', extra: 'fictional-private-sentinel', period: {...context.period, extra: 'fictional-private-sentinel'}}}});
  assert.equal(result.status, 'success'); assert.equal(result.health.rowCount, 1);
  assert.equal(result.health.readFreshness, 'fresh'); assert.equal(result.health.sourceFreshness, 'unknown');
  assert.equal(result.health.coverage, 'unverified'); assert.equal(result.health.reportReady, false);
  const state = await f.state();
  assert.equal(state.observation.rows[0].values.sessions, 0);
  assert.equal(JSON.stringify(state).includes('sentinel'), false);
  assert.equal((await stat(await f.file())).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(f.directory)).map(x => x.slice(-5)), ['.json']);
});
test('a restarted runner skips a not-due read and resumes at the persisted boundary', async t => {
  const f = await fixture(t); await runSyncTick(f.args);
  f.setTime('2025-01-04T00:59:59.000Z');
  const restarted = await createObservationStore(f.directory);
  assert.equal((await runSyncTick({...f.args, store: restarted, transport: () => {throw new Error('not due');}})).status, 'not-due');
  f.setTime('2025-01-04T01:00:00.000Z');
  assert.equal((await runSyncTick({...f.args, store: restarted})).status, 'success');
  assert.equal((await f.state()).observation.collectedAt, '2025-01-04T01:00:00.000Z');
});
test('failed and partial reads retain the last success, advance no success clock and store no raw error', async t => {
  const f = await fixture(t); await runSyncTick(f.args);
  f.setTime('2025-01-04T02:00:00.000Z');
  let result = await runSyncTick({...f.args, transport: async () => {throw new Error('fictional-private-sentinel');}});
  assert.equal(result.status, 'failed'); assert.equal(result.health.lastSuccessAt, '2025-01-04T00:00:00.000Z');
  assert.equal(result.health.readFreshness, 'stale'); assert.equal(result.health.rowCount, 1);
  f.setTime('2025-01-04T03:00:00.000Z');
  result = await runSyncTick({...f.args, transport: async () => ({...page(), partial: true})});
  assert.equal(result.status, 'failed'); assert.equal((await f.state()).observation.rows[0].values.sessions, 0);
  assert.equal(JSON.stringify(await f.state()).includes('sentinel'), false);
});
test('failure before any success stays unknown; an empty read does not create zero metrics or coverage', async t => {
  const f = await fixture(t);
  const failed = await runSyncTick({...f.args, transport: async () => {throw new Error('offline');}});
  assert.equal(failed.health.readFreshness, 'unknown'); assert.equal(failed.health.rowCount, null);
  f.setTime('2025-01-04T01:00:00.000Z');
  const empty = await runSyncTick({...f.args, transport: async () => page([])});
  assert.equal(empty.health.rowCount, 0); assert.deepEqual(empty.health.observedDays, []);
  assert.equal(empty.health.coverage, 'unverified'); assert.deepEqual((await f.state()).observation.rows, []);
});
test('overlapping runners cannot issue two transports for the same job', async t => {
  const f = await fixture(t); let release, entered;
  const start = new Promise(resolve => { entered = resolve; });
  const pause = new Promise(resolve => { release = resolve; });
  const first = runSyncTick({...f.args, transport: async () => { entered(); await pause; return page(); }});
  await start;
  const second = await runSyncTick({...f.args, store: await createObservationStore(f.directory), transport: () => {throw new Error('overlap');}});
  assert.deepEqual(second, {status: 'busy'}); release(); assert.equal((await first).status, 'success');
});
test('tenant and account scope changes cannot reuse or expose another observation', async t => {
  const f = await fixture(t); await runSyncTick(f.args);
  await assert.rejects(runSyncTick({...f.args, currentTenantId: () => 'another-demo'}), /Authorized read context/);
  await assert.rejects(runSyncTick({...f.args, job: {...job, context: {...context, accountIds: ['other-demo-account']}}}), /scope changed/);
  f.setTime('2025-01-04T01:00:00.000Z'); let tenant = context.tenantId;
  await assert.rejects(runSyncTick({...f.args, currentTenantId: () => tenant, transport: async () => {tenant = 'another-demo'; return page();}}), /Tenant changed/);
  assert.equal((await f.state()).lastAttempt.status, 'failed');
});
test('page and row budgets reject whole batches, retaining no partial observations', async t => {
  const f = await fixture(t);
  const rows = [row('one'), row('two'), row('three')];
  assert.equal((await runSyncTick({...f.args, transport: async () => page(rows)})).status, 'failed');
  assert.equal((await f.state()).observation, null);
  f.setTime('2025-01-04T01:00:00.000Z'); let cursor = 0;
  assert.equal((await runSyncTick({...f.args, transport: async () => page([], String(++cursor))})).status, 'failed');
});
test('rolling periods replace a complete batch; they do not append or imply missing-day zeros', async t => {
  const f = await fixture(t); await runSyncTick(f.args); f.setTime('2025-01-04T01:00:00.000Z');
  const nextJob = {...job, context: {...context, period: {start: '2025-01-02', endExclusive: '2025-01-04'}}};
  const result = await runSyncTick({...f.args, job: nextJob, transport: async () => page([{...row('next'), date: '2025-01-03', values: {sessions: null}}])});
  assert.deepEqual(result.health.observationPeriod, nextJob.context.period);
  assert.deepEqual(result.health.observedDays, ['2025-01-03']); assert.equal(result.health.rowCount, 1);
  assert.equal((await f.state()).observation.rows[0].values.sessions, null);
});
test('corrupt, cross-scope and unfinished stored states fail closed without another read', async t => {
  const f = await fixture(t); await runSyncTick(f.args);
  const file = await f.file(), original = await f.state(); f.setTime('2025-01-04T03:00:00.000Z');
  await writeFile(file, '{broken'); await assert.rejects(runSyncTick(f.args), /Cannot read/);
  await writeFile(file, JSON.stringify({...original, scope: {...original.scope, tenantId: 'other-demo'}}));
  await assert.rejects(runSyncTick(f.args), /scope changed/);
  await writeFile(file, JSON.stringify({...original, lastAttempt: {...original.lastAttempt, status: 'running', finishedAt: null}}));
  const result = await runSyncTick({...f.args, transport: () => {throw new Error('must not retry');}});
  assert.equal(result.status, 'recovery-required');
});
test('inspection ages the last success without a transport, and backward clocks fail closed', async t => {
  const f = await fixture(t); await runSyncTick(f.args); f.setTime('2025-01-04T05:00:00.000Z');
  assert.equal((await inspectSyncState(f.args)).health.readFreshness, 'stale');
  f.setTime('2025-01-03T23:59:59.000Z'); await assert.rejects(runSyncTick(f.args), /Clock moved backwards/);
});
test('stored nested extras are stripped on the next write and tenants use separate state files', async t => {
  const f = await fixture(t); await runSyncTick(f.args);
  const file = await f.file(), state = await f.state();
  state.extra = 'fictional-private-sentinel';
  state.observation.context.period.extra = 'fictional-private-sentinel';
  state.observation.rows[0].extra = 'fictional-private-sentinel';
  await writeFile(file, JSON.stringify(state)); f.setTime('2025-01-04T01:00:00.000Z');
  await runSyncTick({...f.args, transport: async () => {throw new Error('offline');}});
  assert.equal((await readFile(file, 'utf8')).includes('sentinel'), false);
  const secondContext = {...context, tenantId: 'second-fictional-demo'};
  await runSyncTick({...f.args, job: {...job, context: secondContext}, currentTenantId: () => secondContext.tenantId, transport: async () => ({...page([]), tenantId: secondContext.tenantId})});
  assert.equal((await readdir(f.directory)).filter(name => name.endsWith('.json')).length, 2);
  assert.equal((await inspectSyncState(f.args)).health.rowCount, 1);
  assert.equal((await inspectSyncState({...f.args, job: {...job, context: secondContext}, currentTenantId: () => secondContext.tenantId})).health.rowCount, 0);
});
test('store rejects repository directories, symlinks and group-readable roots or state', async t => {
  const f = await fixture(t);
  await assert.rejects(createObservationStore(new URL('../', import.meta.url).pathname), /outside the repository/);
  const link = join(f.directory, 'link'); await symlink(f.directory, link);
  await assert.rejects(createObservationStore(link), /not a symlink/);
  const shared = join(f.directory, 'shared'); await mkdir(shared, {mode: 0o755});
  await assert.rejects(createObservationStore(shared), /owner-only/);
  await runSyncTick(f.args); await chmod(await f.file(), 0o644);
  await assert.rejects(runSyncTick(f.args), /Cannot read/);
});
