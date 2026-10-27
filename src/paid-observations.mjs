// Pure projections of existing imported tables. No credentials, SQL execution,
// vendor requests, publication, or business-KPI approval happen here.
import { daysInPeriod } from './model.mjs';

const must = value => { if (!value) throw new Error('Invalid paid-media import evidence'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const numericId = value => typeof value === 'string' && /^\d{1,30}$/.test(value);
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);
const count = value => Number.isSafeInteger(value) && value >= 0;
const add = (a, b) => { const sum = a + b; must(Number.isSafeInteger(sum)); return sum; };
const tables = {
  meta_ads: { table: 'meta_ads_daily_stats', account: 'ad_account_id', amount: 'spend', currency: 'meta_currency', extra: ['level', 'ad_id'] },
  google_ads: { table: 'google_ads_daily_stats', account: 'customer_id', amount: 'cost', currency: 'google_currency', extra: [] },
};

// Both warehouse columns are NUMERIC(14,2). Read them as decimal text (SQL
// ::text), not floating-point numbers. Google cost is already major units;
// dividing it by a million again would silently corrupt the stored evidence.
export function importedAmountToMinor(value, currency) {
  // Deliberately narrow: verified two-decimal currency contracts only. Unknown
  // and zero/three-decimal currencies require a separate reviewed mapping.
  must(['USD', 'EUR', 'GBP', 'ILS'].includes(currency));
  must(typeof value === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  must(minor <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(minor);
}

export function projectPaidImport(raw, context) {
  must(exact(context, ['workspaceId', 'source', 'accountId', 'period', 'currency', 'sourceTimezone']));
  const { workspaceId, source, accountId, period, currency, sourceTimezone } = context;
  must(identifier(workspaceId) && typeof source === 'string' && Object.hasOwn(tables, source) && numericId(accountId));
  must(exact(period, ['start', 'endExclusive']));
  const days = daysInPeriod(period);
  must(days.length <= 31);
  importedAmountToMinor('0', currency);
  if (sourceTimezone !== null) {
    must(typeof sourceTimezone === 'string' && sourceTimezone.length > 0 && sourceTimezone.length <= 100);
    try { new Intl.DateTimeFormat('en', { timeZone: sourceTimezone }); } catch { must(false); }
  }
  must(exact(raw, ['schemaVersion', 'table', 'scope', 'period', 'currency', 'sourceTimezone', 'readAt', 'importCompletedAt', 'snapshot', 'rows', 'nextCursor', 'exhausted']));
  const contract = tables[source];
  must(raw.schemaVersion === 1 && raw.table === contract.table && raw.currency === currency && raw.sourceTimezone === sourceTimezone);
  must(exact(raw.scope, ['workspaceId', 'accountId']) && raw.scope.workspaceId === workspaceId && raw.scope.accountId === accountId);
  must(exact(raw.period, ['start', 'endExclusive']) && raw.period.start === period.start && raw.period.endExclusive === period.endExclusive);
  must(stamp(raw.readAt) && stamp(raw.importCompletedAt) && Date.parse(raw.importCompletedAt) <= Date.parse(raw.readAt));
  // Supplied by the trusted private export/reader, not by vendor rows. Equality
  // alone is not a concurrency proof: the producer must use a stable snapshot
  // and check the account's completed, error-free import before and after it.
  must(exact(raw.snapshot, ['before', 'after', 'status']) && identifier(raw.snapshot.before) &&
    raw.snapshot.before === raw.snapshot.after && raw.snapshot.status === 'complete');
  must(raw.nextCursor === null && raw.exhausted === true && Array.isArray(raw.rows) && raw.rows.length <= 1000);
  const keys = new Set(), daily = new Map(), restatements = new Map();
  let latest = null, unknownTimes = 0;
  for (const row of raw.rows) {
    must(exact(row, ['workspace_id', contract.account, 'date', 'campaign_id', contract.amount, contract.currency, 'impressions', 'clicks', 'updated_at', ...contract.extra]));
    must(row.workspace_id === workspaceId && row[contract.account] === accountId && days.includes(row.date));
    must(numericId(row.campaign_id) && row[contract.currency] === currency && count(row.impressions) && count(row.clicks));
    if (source === 'meta_ads') must(row.level === 'ad' && numericId(row.ad_id));
    const key = JSON.stringify([row.date, row.campaign_id, ...(source === 'meta_ads' ? [row.ad_id] : [])]);
    must(!keys.has(key)); keys.add(key);
    const amount = importedAmountToMinor(row[contract.amount], currency);
    must(row.updated_at === null || (stamp(row.updated_at) && Date.parse(row.updated_at) <= Date.parse(raw.readAt)));
    restatements.set(row.updated_at, (restatements.get(row.updated_at) ?? 0) + 1);
    if (row.updated_at === null) unknownTimes++;
    else if (latest === null || Date.parse(row.updated_at) > Date.parse(latest)) latest = row.updated_at;
    const current = daily.get(row.date) ?? { date: row.date, spendMinor: 0, impressions: 0, clicks: 0, observedRows: 0 };
    current.spendMinor = add(current.spendMinor, amount);
    current.impressions = add(current.impressions, row.impressions);
    current.clicks = add(current.clicks, row.clicks);
    current.observedRows++;
    daily.set(row.date, current);
  }
  const observations = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  const observedDays = observations.map(row => row.date);
  return {
    schemaVersion: 1, source, origin: 'imported-observations', scope: { workspaceId, accountId }, period: { ...period },
    currency, amountUnit: 'currency-minor-units', minorUnitDigits: 2, sourceTimezone, readAt: raw.readAt,
    aggregation: source === 'meta_ads' ? 'daily-sum-ad-level-imports' : 'daily-sum-campaign-imports',
    retainedKeysMayBeStale: true, observations,
    freshness: { importCompletedAt: raw.importCompletedAt, latestRestatementAt: latest, rowsWithoutRestatementTime: unknownTimes,
      restatements: [...restatements].map(([updatedAt, rows]) => ({ updatedAt, rows })) },
    coverage: { status: 'unverified', exhausted: true, importedRows: raw.rows.length, observedDays, missingDays: days.filter(day => !daily.has(day)) },
    reconciliation: 'pending', reportReady: false,
  };
}

// Compare independently captured versions without summing them. Both inputs are
// revalidated; empty dates stay unknown even when both exports omit the same day.
// Matching imports are not independent native reconciliation or KPI approval.
export function comparePaidImports(leftRaw, rightRaw, leftContext, rightContext) {
  const left = projectPaidImport(leftRaw, leftContext), right = projectPaidImport(rightRaw, rightContext);
  const comparable = left.sourceTimezone !== null &&
    ['workspaceId', 'accountId'].every(key => left.scope[key] === right.scope[key]) &&
    ['source', 'currency', 'sourceTimezone', 'aggregation'].every(key => left[key] === right[key]) &&
    ['start', 'endExclusive'].every(key => left.period[key] === right.period[key]);
  if (!comparable) return { status: 'not-comparable', reportReady: false, differences: [] };
  const differences = daysInPeriod(left.period).map(date => {
    const a = left.observations.find(row => row.date === date), b = right.observations.find(row => row.date === date);
    return { date, spendMinor: a && b ? b.spendMinor - a.spendMinor : null,
      impressions: a && b ? b.impressions - a.impressions : null, clicks: a && b ? b.clicks - a.clicks : null };
  });
  const changed = differences.some(row => ['spendMinor', 'impressions', 'clicks'].some(key => row[key] !== null && row[key] !== 0));
  return { status: changed ? 'different-observations' : differences.some(row => row.spendMinor === null) ? 'incomplete-observations' : 'matching-observations',
    reportReady: false, differences };
}
