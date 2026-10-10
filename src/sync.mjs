import { createHash } from 'node:crypto';
import { collectObservations, normalizeObservationPage, projectReadContext } from './read-contract.mjs';
import { projectJobScope } from './observation-store.mjs';

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Canonical UTC timestamp required');
  return value;
}
function positiveInteger(value, maximum = 365 * 86400000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid sync bound');
  return value;
}
function configurationHash(context) {
  const {period, ...scope} = projectReadContext(context);
  scope.accountIds.sort(); scope.metricKeys.sort();
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}
function projectJob(job) {
  const context = projectReadContext(job.context);
  return {
    scope: projectJobScope({...context, jobId: job.id}), context,
    configurationHash: configurationHash(context),
    intervalMs: positiveInteger(job.intervalMs), staleAfterMs: positiveInteger(job.staleAfterMs),
    maxPages: positiveInteger(job.maxPages ?? 10, 1000), maxRows: positiveInteger(job.maxRows ?? 10000, 100000)
  };
}
function projectObservation(value, job) {
  const context = projectReadContext(value.context);
  if (configurationHash(context) !== job.configurationHash || value.coverage !== 'unverified' || value.reconciliation !== 'pending' || value.paginationExhausted !== true || !Array.isArray(value.rows) || value.rows.length > 100000) throw new Error('Invalid stored observation');
  const rows = [], seen = new Set();
  for (let i = 0; i < value.rows.length; i += 1000) {
    const page = normalizeObservationPage({...context, rows: value.rows.slice(i, i + 1000), nextCursor: null}, context);
    for (const row of page.rows) {
      const key = row.accountId + ':' + row.key;
      if (seen.has(key)) throw new Error('Duplicate stored observation');
      seen.add(key); rows.push(row);
    }
  }
  return {context, collectedAt: timestamp(value.collectedAt), rows, paginationExhausted: true, coverage: 'unverified', reconciliation: 'pending'};
}
function projectState(value, job) {
  if (!value) return {schemaVersion: 1, scope: job.scope, configurationHash: job.configurationHash, lastAttempt: null, nextDueAt: null, observation: null};
  if (value.schemaVersion !== 1 || JSON.stringify(projectJobScope(value.scope)) !== JSON.stringify(job.scope) || value.configurationHash !== job.configurationHash) throw new Error('Stored job scope changed; use a new job id');
  const attempt = value.lastAttempt;
  if (!attempt || !['running', 'success', 'failed'].includes(attempt.status)) throw new Error('Invalid stored attempt');
  const lastAttempt = {status: attempt.status, startedAt: timestamp(attempt.startedAt), finishedAt: attempt.status === 'running' ? null : timestamp(attempt.finishedAt), errorCode: attempt.status === 'failed' ? 'read-failed' : null};
  if (lastAttempt.finishedAt && lastAttempt.finishedAt < lastAttempt.startedAt) throw new Error('Invalid attempt clock');
  const observation = value.observation === null ? null : projectObservation(value.observation, job);
  const nextDueAt = timestamp(value.nextDueAt);
  if (nextDueAt < (lastAttempt.finishedAt ?? lastAttempt.startedAt) || (observation && observation.collectedAt > (lastAttempt.finishedAt ?? lastAttempt.startedAt)) || (attempt.status === 'success' && (!observation || observation.collectedAt !== lastAttempt.finishedAt))) throw new Error('Inconsistent stored state');
  return {schemaVersion: 1, scope: job.scope, configurationHash: job.configurationHash, lastAttempt, nextDueAt, observation};
}
function health(state, job, now) {
  const age = state.observation ? Date.parse(now) - Date.parse(state.observation.collectedAt) : null;
  if (age !== null && age < 0) throw new Error('Clock moved backwards');
  return {
    lastAttemptStatus: state.lastAttempt?.status ?? 'never', lastSuccessAt: state.observation?.collectedAt ?? null,
    nextDueAt: state.nextDueAt, readFreshness: age === null ? 'unknown' : age >= job.staleAfterMs ? 'stale' : 'fresh', sourceFreshness: 'unknown',
    observationPeriod: state.observation?.context.period ?? null,
    rowCount: state.observation?.rows.length ?? null,
    observedDays: state.observation ? [...new Set(state.observation.rows.map(row => row.date))].sort() : [],
    coverage: 'unverified', reconciliation: 'pending', reportReady: false
  };
}

// One caller-driven tick; no cron, timers, network binding or credential loader.
// The trusted private host owns authorization, transport timeouts and recurrence.
export async function runSyncTick({enabled = false, job: input, store, transport, currentTenantId, clock = () => new Date().toISOString()}) {
  if (enabled !== true) return {status: 'disabled'};
  const job = projectJob(input), now = timestamp(clock());
  if (typeof currentTenantId !== 'function' || currentTenantId() !== job.scope.tenantId || typeof transport !== 'function') throw new Error('Authorized read context required');
  return store.withLock(job.scope, async transaction => {
    const state = projectState(await transaction.read(), job);
    if (currentTenantId() !== job.scope.tenantId) throw new Error('Tenant changed');
    if (state.lastAttempt && now < (state.lastAttempt.finishedAt ?? state.lastAttempt.startedAt)) throw new Error('Clock moved backwards');
    if (state.lastAttempt?.status === 'running') return {status: 'recovery-required', health: health(state, job, now)};
    if (state.nextDueAt && now < state.nextDueAt) return {status: 'not-due', health: health(state, job, now)};
    const running = {...state, lastAttempt: {status: 'running', startedAt: now, finishedAt: null, errorCode: null}, nextDueAt: new Date(Date.parse(now) + job.intervalMs).toISOString()};
    await transaction.write(running);
    let observation = state.observation, succeeded = false;
    try {
      const result = await collectObservations({transport, currentTenantId, context: job.context, maxPages: job.maxPages, maxRows: job.maxRows});
      observation = {context: job.context, rows: result.rows, paginationExhausted: true, coverage: 'unverified', reconciliation: 'pending'};
      succeeded = true;
    } catch { /* Raw provider errors can contain secrets; never persist or return them. */ }
    const finishedAt = timestamp(clock());
    if (finishedAt < now) throw new Error('Clock moved backwards');
    const finished = {
      ...state,
      lastAttempt: {status: succeeded ? 'success' : 'failed', startedAt: now, finishedAt, errorCode: succeeded ? null : 'read-failed'},
      nextDueAt: new Date(Date.parse(finishedAt) + job.intervalMs).toISOString(),
      observation: succeeded ? {...observation, collectedAt: finishedAt} : observation
    };
    // Re-project at the persistence boundary; no provider payload or injected extras survive.
    await transaction.write(projectState(finished, job));
    if (currentTenantId() !== job.scope.tenantId) throw new Error('Tenant changed');
    return {status: finished.lastAttempt.status, health: health(finished, job, finishedAt)};
  });
}

export async function inspectSyncState({job: input, store, currentTenantId, clock = () => new Date().toISOString()}) {
  const job = projectJob(input), now = timestamp(clock());
  if (currentTenantId() !== job.scope.tenantId) throw new Error('Tenant changed');
  return store.withLock(job.scope, async transaction => {
    const state = projectState(await transaction.read(), job);
    if (currentTenantId() !== job.scope.tenantId) throw new Error('Tenant changed');
    return {status: 'inspected', health: health(state, job, now)};
  });
}
