// Pure adapter for oToK's restricted imported-observation response. No network,
// credentials, tenant configuration or vendor import is provided here.
import { daysInPeriod } from './model.mjs';
const must = condition => { if (!condition) throw new Error('Invalid GA4 observation receipt'); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function projectGa4Receipt(raw, context) {
  const {workspaceId, propertyId, period} = context;
  must(typeof workspaceId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId) && typeof propertyId === 'string' && /^\d{1,30}$/.test(propertyId));
  const span = (Date.parse(period?.endExclusive) - Date.parse(period?.start)) / 86400000;
  must(Number.isInteger(span) && span >= 1 && span <= 3);
  const days = daysInPeriod(period);
  must(exact(raw, ['schemaVersion','source','origin','scope','period','sourceTimezone','aggregation','retainedKeysMayBeStale','readAt','observations','freshness','coverage','reconciliation','nextCursor']));
  must(raw.schemaVersion === 1 && raw.source === 'ga4' && raw.origin === 'imported-observations' && raw.sourceTimezone === null && raw.aggregation === 'daily-sum-all-imported-dimension-keys' && raw.retainedKeysMayBeStale === true && raw.reconciliation === 'pending' && raw.nextCursor === null);
  must(exact(raw.scope, ['workspaceId','accountId']) && raw.scope.workspaceId === workspaceId && raw.scope.accountId === propertyId);
  must(exact(raw.period, ['start','endExclusive']) && raw.period.start === period.start && raw.period.endExclusive === period.endExclusive && stamp(raw.readAt));
  must(Array.isArray(raw.observations) && raw.observations.length <= 3);
  const seen = new Set();
  const observations = raw.observations.map(row => {
    must(exact(row, ['date','sessions','engagedSessions','observedRows']) && days.includes(row.date) && !seen.has(row.date)); seen.add(row.date);
    must(count(row.sessions) && count(row.engagedSessions) && row.engagedSessions <= row.sessions && count(row.observedRows) && row.observedRows > 0);
    return {...row};
  });
  const importedRows = observations.reduce((sum, row) => sum + row.observedRows, 0);
  const observedDays = [...seen].sort(), missingDays = days.filter(day => !seen.has(day));
  must(exact(raw.coverage, ['status','observedDays','missingDays','importedRows','exhausted']) && raw.coverage.status === 'unverified' && raw.coverage.exhausted === true && importedRows <= 1000 && raw.coverage.importedRows === importedRows);
  must(JSON.stringify(raw.coverage.observedDays) === JSON.stringify(observedDays) && JSON.stringify(raw.coverage.missingDays) === JSON.stringify(missingDays));
  const freshness = raw.freshness;
  must(exact(freshness, ['importCompletedAt','latestRestatementAt','rowsWithoutRestatementTime','restatements']) && stamp(freshness.importCompletedAt) && Date.parse(freshness.importCompletedAt) <= Date.parse(raw.readAt));
  must(Array.isArray(freshness.restatements) && freshness.restatements.length <= importedRows && count(freshness.rowsWithoutRestatementTime));
  const times = new Set(); let total = 0, missing = 0, latest = null;
  const restatements = freshness.restatements.map(row => {
    must(exact(row, ['updatedAt','rows']) && count(row.rows) && row.rows > 0 && !times.has(row.updatedAt)); times.add(row.updatedAt);
    must(row.updatedAt === null || (stamp(row.updatedAt) && Date.parse(row.updatedAt) <= Date.parse(raw.readAt)));
    total += row.rows;
    if (row.updatedAt === null) missing += row.rows;
    else if (latest === null || Date.parse(row.updatedAt) > Date.parse(latest)) latest = row.updatedAt;
    return {...row};
  });
  must(total === importedRows && missing === freshness.rowsWithoutRestatementTime && latest === freshness.latestRestatementAt);
  // Retain version-specific evidence, including older imported rows. Consumers
  // replace a displayed observation; they never add separate reads together.
  return {schemaVersion: 1, source: 'ga4', scope: {...raw.scope}, period: {...raw.period}, readAt: raw.readAt,
    sourceTimezone: null, aggregation: raw.aggregation, retainedKeysMayBeStale: true, observations,
    freshness: {...freshness, restatements}, coverage: {...raw.coverage, observedDays, missingDays}, reconciliation: 'pending'};
}

export function ga4SourceObservation(receipt, sourceId = 'ga4') {
  return {sourceId, period: {...receipt.period}, observedAt: receipt.readAt, origin: 'synced', sourceTimezone: null,
    lastSuccessfulReadAt: receipt.readAt, importCompletedAt: receipt.freshness.importCompletedAt,
    latestRestatementAt: receipt.freshness.latestRestatementAt,
    metrics: [['sessions','Sessions'],['engagedSessions','Engaged sessions']].map(([key,label]) => ({key,label,unit:'count',values:receipt.observations.map(row=>({date:row.date,value:row[key]}))}))};
}
