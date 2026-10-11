import { createHash } from 'node:crypto';
import { createReport, validateTenant } from './tenant.mjs';
import { daysInPeriod } from './model.mjs';
import { METRICS } from './catalog.mjs';
import { createObservationStore } from './observation-store.mjs';

const text = (value, max = 200) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f]/.test(value);
const stamp = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const must = condition => { if (!condition) throw new Error('Invalid reporting data'); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Re-project durable data too: disk contents never bypass response allowlists.
function projectReport(value, tenant) {
  must(value?.schemaVersion === 1 && value.timezone === tenant.timezone && value.currency === tenant.currency && stamp(value.asOf));
  daysInPeriod(value.period);
  const metrics = Object.fromEntries(Object.entries(METRICS).map(([id, definition]) => {
    const metric = value.metrics?.[id];
    must(metric && ['available', 'unavailable'].includes(metric.status) && Array.isArray(metric.reasons) && metric.reasons.length <= 100 && metric.reasons.every(reason => text(reason)));
    must(metric.status === 'available' ? Number.isFinite(metric.value) : metric.value === null);
    return [id, {label: definition.label, status: metric.status, value: metric.value, unit: definition.unit, reasons: [...metric.reasons]}];
  }));
  must(Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 100 && new Set(value.sources.map(s => s.id)).size === value.sources.length);
  const sources = value.sources.map(source => {
    must(['id', 'label', 'group', 'connection', 'sync', 'coverage', 'reconciliation'].every(key => text(source[key])) && typeof source.reportReady === 'boolean');
    for (const field of ['evidenceObservedAt', 'lastSuccessfulSync']) must(source[field] === null || stamp(source[field]));
    must(source.latestBusinessDate === null || (/^\d{4}-\d{2}-\d{2}$/.test(source.latestBusinessDate) && stamp(source.latestBusinessDate)));
    return Object.fromEntries(['id', 'label', 'group', 'connection', 'sync', 'coverage', 'reconciliation', 'evidenceObservedAt', 'lastSuccessfulSync', 'latestBusinessDate', 'reportReady'].map(key => [key, source[key]]));
  });
  return {schemaVersion: 1, mode: 'snapshot', period: {start: value.period.start, endExclusive: value.period.endExclusive}, timezone: tenant.timezone, currency: tenant.currency, asOf: value.asOf, metrics, sources,
    tenant: {displayName: tenant.displayName, locale: tenant.locale, direction: tenant.direction, accent: tenant.accent},
    disclaimer: 'Private dated report. Source observations are labelled separately; no automatic connection is implied.'};
}

function projectReads(input, sourceIds) {
  must(Array.isArray(input) && input.length <= 25 && new Set(input.map(r => r.sourceId)).size === input.length);
  return input.map(read => {
    must(sourceIds.includes(read.sourceId) && ['success','failed'].includes(read.status) && stamp(read.startedAt) && stamp(read.finishedAt) && Date.parse(read.finishedAt) >= Date.parse(read.startedAt));
    return {sourceId: read.sourceId, status: read.status, startedAt: read.startedAt, finishedAt: read.finishedAt, errorCode: read.status === 'failed' ? 'read-failed' : null};
  });
}

function projectObservations(input, sourceIds) {
  must(Array.isArray(input) && input.length <= 25 && new Set(input.map(s => s.sourceId)).size === input.length);
  return input.map(source => {
    must(sourceIds.includes(source.sourceId) && stamp(source.observedAt) && ['manual', 'ui-snapshot', 'synced'].includes(source.origin));
    must(source.sourceTimezone === null || text(source.sourceTimezone, 80));
    if (source.sourceTimezone !== null) new Intl.DateTimeFormat('en', {timeZone: source.sourceTimezone});
    must(source.origin === 'synced' ? stamp(source.lastSuccessfulReadAt) : source.lastSuccessfulReadAt === null);
    for (const key of ['importCompletedAt','latestRestatementAt']) must(source[key] == null || (stamp(source[key]) && Date.parse(source[key]) <= Date.parse(source.observedAt)));
    const days = daysInPeriod(source.period);
    must(Array.isArray(source.metrics) && source.metrics.length > 0 && source.metrics.length <= 12 && new Set(source.metrics.map(m => m.key)).size === source.metrics.length);
    const metrics = source.metrics.map(metric => {
      must(text(metric.key, 80) && text(metric.label, 80) && ['count', 'seconds'].includes(metric.unit));
      must(Array.isArray(metric.values) && metric.values.length <= 366 && new Set(metric.values.map(v => v.date)).size === metric.values.length);
      const values = metric.values.map(row => { must(days.includes(row.date) && Number.isSafeInteger(row.value) && row.value >= 0); return {date: row.date, value: row.value}; });
      const total = values.length ? values.reduce((sum, row) => sum + row.value, 0) : null;
      must(total === null || Number.isSafeInteger(total));
      return {key: metric.key, label: metric.label, unit: metric.unit, values, total};
    });
    return {sourceId: source.sourceId, period: {start: source.period.start, endExclusive: source.period.endExclusive}, observedAt: source.observedAt, origin: source.origin, sourceTimezone: source.sourceTimezone, lastSuccessfulReadAt: source.lastSuccessfulReadAt, importCompletedAt: source.importCompletedAt ?? null, latestRestatementAt: source.latestRestatementAt ?? null, metrics, coverage: 'unverified', reconciliation: 'pending', reportReady: false};
  });
}

export async function createRuntimeData({tenant, directory}) {
  tenant = validateTenant(structuredClone(tenant));
  must(tenant.mode === 'private');
  const store = await createObservationStore(directory);
  const scope = {tenantId: tenant.tenantId, sourceId: 'reporting', jobId: 'published-view'};
  function unpack(state) {
    must(state?.schemaVersion === 1 && state.tenantId === tenant.tenantId && state.workspaceId === tenant.workspaceId && stamp(state.acceptedAt));
    must(state.digest === hash({report: state.report, observations: state.observations, ...(state.reads ? {reads: state.reads} : {})}));
    const report = projectReport(state.report, tenant);
    const observations = projectObservations(state.observations, report.sources.map(s => s.id));
    const reads = projectReads(state.reads ?? [], report.sources.map(s => s.id));
    return {report, observations, reads, acceptedAt: state.acceptedAt};
  }
  return Object.freeze({
    async publish(snapshot, observationInput = null) {
      const report = projectReport(createReport(tenant, snapshot), tenant);
      if (observationInput) must(observationInput.schemaVersion === 1 && observationInput.workspaceId === tenant.workspaceId && observationInput.tenantId === tenant.tenantId);
      const observations = projectObservations(observationInput?.sources ?? [], report.sources.map(s => s.id));
      const result = await store.withLock(scope, async transaction => {
        const previous = await transaction.read();
        let reads = [];
        if (previous) {
          const accepted = unpack(previous);
          reads = accepted.reads.filter(read => report.sources.some(source => source.id === read.sourceId));
          must(Date.parse(report.asOf) >= Date.parse(accepted.report.asOf));
          for (const source of observations) {
            const prior = accepted.observations.find(item => item.sourceId === source.sourceId);
            if (prior) must(Date.parse(source.observedAt) >= Date.parse(prior.observedAt));
          }
        }
        const acceptedAt = new Date().toISOString();
        must(Date.parse(report.asOf) <= Date.parse(acceptedAt));
        for (const source of observations) must(Date.parse(source.observedAt) <= Date.parse(acceptedAt) && (source.lastSuccessfulReadAt === null || Date.parse(source.lastSuccessfulReadAt) <= Date.parse(source.observedAt)));
        await transaction.write({schemaVersion: 1, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, acceptedAt, report, observations, reads, digest: hash({report, observations, reads})});
        return {status: 'published', acceptedAt};
      });
      if (result.status !== 'published') throw new Error('Reporting state busy');
      return result;
    },
    // Local atomic publication of one validated read. No network or recurrence.
    // A failed attempt changes only health; the last accepted evidence survives.
    async recordSourceRead({tenantId, workspaceId, attempt, observation = null, currentTenantId}) {
      must(tenantId === tenant.tenantId && workspaceId === tenant.workspaceId && typeof currentTenantId === 'function' && currentTenantId() === tenant.tenantId);
      const result = await store.withLock(scope, async transaction => {
        const previous = await transaction.read(), accepted = unpack(previous);
        const [read] = projectReads([attempt], accepted.report.sources.map(s => s.id));
        must(Date.parse(read.finishedAt) <= Date.now());
        const prior = accepted.reads.find(item => item.sourceId === read.sourceId);
        must(!prior || Date.parse(read.startedAt) >= Date.parse(prior.finishedAt));
        let observations = accepted.observations;
        if (read.status === 'success') {
          const [source] = projectObservations([observation], accepted.report.sources.map(s => s.id));
          must(source.sourceId === read.sourceId && source.origin === 'synced' && source.lastSuccessfulReadAt === source.observedAt);
          must(Date.parse(source.observedAt) >= Date.parse(read.startedAt) && Date.parse(source.observedAt) <= Date.parse(read.finishedAt));
          const older = observations.find(item => item.sourceId === source.sourceId);
          must(!older || Date.parse(source.observedAt) >= Date.parse(older.observedAt));
          observations = [...observations.filter(item => item.sourceId !== source.sourceId), source];
        } else must(observation === null);
        const reads = [...accepted.reads.filter(item => item.sourceId !== read.sourceId), read];
        const report = accepted.report;
        const committed = await transaction.write({...previous, report, observations, reads, digest: hash({report, observations, reads})}, {shouldCommit: () => currentTenantId() === tenant.tenantId});
        must(committed !== false);
        return {status: read.status};
      });
      if (!['success','failed'].includes(result.status)) throw new Error('Reporting state busy');
      return result;
    },
    async read(now = new Date()) {
      const result = await store.withLock(scope, async transaction => {
        const state = await transaction.read();
        if (!state) throw new Error('No accepted report');
        return unpack(state);
      });
      if (result.status === 'busy') throw new Error('Reporting state busy');
      const freshness = timestamp => !timestamp || Date.parse(timestamp) > +now ? 'unknown' : +now - Date.parse(timestamp) > 48 * 3600000 ? 'stale' : 'recent';
      return {...result.report, runtime: {acceptedAt: result.acceptedAt, evidenceFreshness: freshness(result.report.asOf), sourceReadsRecorded: result.observations.some(source => source.origin === 'synced'), reads: result.reads.map(read => ({...read, readFreshness: freshness(read.finishedAt)}))}, observations: result.observations.map(source => ({...source, evidenceFreshness: freshness(source.observedAt), readFreshness: freshness(source.lastSuccessfulReadAt), importFreshness: freshness(source.importCompletedAt), matchesReportPeriod: source.period.start === result.report.period.start && source.period.endExclusive === result.report.period.endExclusive}))};
    }
  });
}
