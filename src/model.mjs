import { METRICS, unavailable } from './catalog.mjs';

const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function daysInPeriod(period) {
  if (!validDay(period.start) || !validDay(period.endExclusive) || period.start >= period.endExclusive) throw new Error('Invalid half-open reporting period');
  const days = [];
  for (let t = Date.parse(period.start); t < Date.parse(period.endExclusive); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  if (days.length > 366) throw new Error('Reporting window is too large');
  return days;
}

export function sourceHealth(source, asOf, context) {
  const stamp = source.lastSuccessfulSync;
  const age = stamp ? (Date.parse(asOf) - Date.parse(stamp)) / 3600000 : null;
  return {
    connection: source.connection,
    sync: age === null || !Number.isFinite(age) || age < 0 ? 'unknown' : age > source.freshnessHours ? 'stale' : 'recent',
    lastSuccessfulSync: stamp,
    latestBusinessDate: source.latestBusinessDate,
    coverage: source.coverage.status,
    reconciliation: source.reconciliation.status,
    // Sync success and populated business dates are independent evidence.
    reportReady: Boolean(context && sourceReadiness(source, context).length === 0),
  };
}

function exactScope(scope, expected) {
  return scope && scope.workspaceId === expected.workspaceId && scope.timezone === expected.timezone && scope.currency === expected.currency &&
    scope.start === expected.start && scope.endExclusive === expected.endExclusive;
}

function sourceReadiness(source, snapshot) {
  const expected = { ...snapshot.period, workspaceId: snapshot.workspaceId, timezone: snapshot.timezone, currency: snapshot.currency };
  const reasons = [];
  const proof = source.coverage ?? {};
  if (!exactScope(proof, expected) || proof.status !== 'complete' || !proof.evidenceRef) reasons.push(`${source.id}: complete scoped coverage not proven`);
  if (!Array.isArray(proof.coveredDays) || daysInPeriod(snapshot.period).some(d => !proof.coveredDays.includes(d))) reasons.push(`${source.id}: daily coverage incomplete`);
  if (source.reconciliation?.status !== 'passed' || !source.reconciliation?.evidenceRef || !exactScope(source.reconciliation, expected)) reasons.push(`${source.id}: reconciliation pending or scope mismatch`);
  if (!source.identityVerified || !Array.isArray(source.accountIds) || source.accountIds.length === 0) reasons.push(`${source.id}: account scope unverified`);
  return reasons;
}

export function metricReadiness(id, snapshot) {
  const def = METRICS[id];
  if (!def) throw new Error(`Unknown metric: ${id}`);
  if (def.numerator) return [...new Set([...metricReadiness(def.numerator, snapshot), ...metricReadiness(def.denominator, snapshot)])];
  const reasons = [];
  const expected = { ...snapshot.period, workspaceId: snapshot.workspaceId, timezone: snapshot.timezone, currency: snapshot.currency };
  for (const key of def.sources) {
    const source = snapshot.sources.find(s => s.id === key);
    if (!source) { reasons.push(`${key}: source missing`); continue; }
    reasons.push(...sourceReadiness(source, snapshot));
  }
  if (def.gated && (snapshot.businessReview?.status !== 'approved' || !snapshot.businessReview?.evidenceRef || !exactScope(snapshot.businessReview, expected))) reasons.push('Business reconciliation approval missing');
  if (def.cohort && (!snapshot.cohort?.closedAt || !Number.isFinite(Date.parse(snapshot.cohort.closedAt)) || Date.parse(snapshot.asOf) < Date.parse(snapshot.cohort.closedAt))) reasons.push('30-day cohort has not matured');
  if (['paidLeads', 'newCustomers', 'paidCohortCash'].includes(id) && (snapshot.attribution?.status !== 'approved' || !snapshot.attribution?.evidenceRef || !exactScope(snapshot.attribution, expected))) reasons.push('Attribution definition and cohort mapping pending');
  return reasons;
}

export function evaluateMetric(id, snapshot) {
  const def = METRICS[id];
  const reasons = metricReadiness(id, snapshot);
  if (reasons.length) return unavailable(reasons);
  if (def.numerator) {
    const a = evaluateMetric(def.numerator, snapshot), b = evaluateMetric(def.denominator, snapshot);
    if (a.status !== 'available' || b.status !== 'available') return unavailable([...a.reasons, ...b.reasons]);
    if (b.value === 0) return unavailable(['Denominator is zero; ratio is undefined']);
    return { status: 'available', value: a.value / b.value, unit: def.unit, reasons: [] };
  }
  const input = snapshot.metricInputs?.[id];
  const expected = { ...snapshot.period, workspaceId: snapshot.workspaceId, timezone: snapshot.timezone, currency: snapshot.currency };
  if (!input || !exactScope(input, expected) || !input.evidenceRef || input.complete !== true || !Array.isArray(input.records)) return unavailable(['Complete metric input and scoped evidence missing']);
  // Each metric receives exactly one aggregate per source/account/day, or one
  // immutable CRM/ledger entity. Do not feed overlapping breakdowns together.
  const seen = new Map();
  for (const row of input.records) {
    const source = snapshot.sources.find(s => s.id === row.source);
    if (!row.key || !def.sources.includes(row.source) || !source?.accountIds.includes(row.accountId) || !validDay(row.date) || row.date < snapshot.period.start || row.date >= snapshot.period.endExclusive) return unavailable(['Metric input contains an invalid source, account, key, or business date']);
    const key = `${row.source}:${row.accountId}:${row.key}`;
    if (seen.has(key)) return unavailable(['Duplicate input identity; canonical deduplication required']);
    if (def.fields.some(field => row[field] === null || row[field] === undefined)) return unavailable(['Missing metric value']);
    for (const field of def.fields.filter(f => f.endsWith('Minor'))) if (!Number.isSafeInteger(row[field]) || (field !== 'cohortNetCashMinor' && row[field] < 0)) return unavailable(['Monetary values must be integer minor units with explicit refund signs']);
    if (def.fields.some(f => f.endsWith('Id') && (typeof row[f] !== 'string' || !row[f]))) return unavailable(['Stable entity identity missing']);
    seen.set(key, row);
  }
  const rows = [...seen.values()];
  let value;
  if (id === 'mediaSpend') value = rows.reduce((n, r) => n + r.spendMinor, 0);
  else if (id === 'netCollected') value = rows.reduce((n, r) => n + r.capturedMinor - r.refundMinor - r.chargebackMinor, 0);
  else if (id === 'paidCohortCash') value = rows.reduce((n, r) => n + r.cohortNetCashMinor, 0);
  else value = new Set(rows.map(r => r[def.fields[0]])).size;
  if (!Number.isSafeInteger(value)) return unavailable(['Metric exceeds safe integer range']);
  return { status: 'available', value, unit: def.unit, reasons: [] };
}

export function buildReport(snapshot) {
  daysInPeriod(snapshot.period);
  if (!Number.isFinite(Date.parse(snapshot.asOf))) throw new Error('Invalid evidence as-of timestamp');
  return {
    schemaVersion: 1,
    mode: snapshot.mode,
    period: snapshot.period,
    timezone: snapshot.timezone,
    currency: snapshot.currency,
    asOf: snapshot.asOf,
    metrics: Object.fromEntries(Object.keys(METRICS).map(id => [id, { label: METRICS[id].label, ...evaluateMetric(id, snapshot) }])),
    sources: snapshot.sources.map(s => ({ id: s.id, label: s.label, group: s.group, evidenceObservedAt: s.evidenceObservedAt, ...sourceHealth(s, snapshot.asOf, snapshot) })),
  };
}
