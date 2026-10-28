// Bounded daily receipts from oToK's existing imports, never vendor responses.
import { daysInPeriod } from './model.mjs';
const must = value => { if (!value) throw new Error('Invalid Google Ads observation receipt'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const currencies = ['USD', 'EUR', 'GBP', 'ILS'];

export function validateGoogleAdsContext(context) {
  must(exact(context, ['tenantId','workspaceId','customerId','currency','sourceTimezone','period']));
  for (const key of ['tenantId','workspaceId']) must(typeof context[key] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(context[key]));
  must(typeof context.customerId === 'string' && /^\d{1,30}$/.test(context.customerId) && currencies.includes(context.currency));
  if (context.sourceTimezone !== null) {
    must(typeof context.sourceTimezone === 'string' && context.sourceTimezone.length <= 80);
    try { new Intl.DateTimeFormat('en', {timeZone:context.sourceTimezone}); } catch { must(false); }
  }
  must(exact(context.period, ['start','endExclusive']) && daysInPeriod(context.period).length <= 31);
  return structuredClone(context);
}

export function projectGoogleAdsReceipt(raw, context) {
  const fixed = validateGoogleAdsContext(context), days = daysInPeriod(fixed.period);
  must(exact(raw, ['schemaVersion','source','origin','scope','period','currency','sourceTimezone','aggregation','retainedKeysMayBeStale','readAt','observations','freshness','coverage','reconciliation','nextCursor']));
  must(raw.schemaVersion === 1 && raw.source === 'google_ads' && raw.origin === 'imported-observations' && raw.aggregation === 'daily-sum-imported-campaigns' && raw.retainedKeysMayBeStale === true && raw.reconciliation === 'pending' && raw.nextCursor === null);
  must(exact(raw.scope, ['workspaceId','accountId']) && raw.scope.workspaceId === fixed.workspaceId && raw.scope.accountId === fixed.customerId);
  must(exact(raw.period, ['start','endExclusive']) && raw.period.start === fixed.period.start && raw.period.endExclusive === fixed.period.endExclusive);
  must(raw.currency === fixed.currency && raw.sourceTimezone === fixed.sourceTimezone && stamp(raw.readAt));
  must(Array.isArray(raw.observations) && raw.observations.length <= days.length);
  const seen = new Set();
  const observations = raw.observations.map(row => {
    must(exact(row, ['date','spendMinor','clicks','impressions','observedRows']) && days.includes(row.date) && !seen.has(row.date)); seen.add(row.date);
    for (const key of ['spendMinor','clicks','impressions','observedRows']) must(count(row[key]));
    must(row.observedRows > 0);
    return {...row};
  });
  for (const key of ['spendMinor','clicks','impressions']) must(count(observations.reduce((sum,row) => sum + row[key], 0)));
  const importedRows = observations.reduce((sum,row) => sum + row.observedRows, 0);
  const observedDays = [...seen].sort(), missingDays = days.filter(day => !seen.has(day));
  must(exact(raw.coverage, ['status','observedDays','missingDays','importedRows','exhausted']) && raw.coverage.status === 'unverified' && raw.coverage.exhausted === true && importedRows <= 10000 && raw.coverage.importedRows === importedRows);
  must(JSON.stringify(raw.coverage.observedDays) === JSON.stringify(observedDays) && JSON.stringify(raw.coverage.missingDays) === JSON.stringify(missingDays));
  const freshness = raw.freshness;
  must(exact(freshness, ['importCompletedAt','importWindow','latestRestatementAt','rowsWithoutRestatementTime','restatements']) && stamp(freshness.importCompletedAt) && Date.parse(freshness.importCompletedAt) <= Date.parse(raw.readAt));
  must(exact(freshness.importWindow, ['start','endExclusive']));
  daysInPeriod(freshness.importWindow);
  must(freshness.importWindow.start <= fixed.period.start && freshness.importWindow.endExclusive >= fixed.period.endExclusive);
  must(Array.isArray(freshness.restatements) && freshness.restatements.length <= importedRows && count(freshness.rowsWithoutRestatementTime));
  let total = 0, missing = 0, latest = null;
  const times = new Set();
  const restatements = freshness.restatements.map(row => {
    must(exact(row, ['updatedAt','rows']) && count(row.rows) && row.rows > 0 && !times.has(row.updatedAt)); times.add(row.updatedAt);
    must(row.updatedAt === null || (stamp(row.updatedAt) && Date.parse(row.updatedAt) <= Date.parse(raw.readAt)));
    total += row.rows;
    if (row.updatedAt === null) missing += row.rows;
    else if (latest === null || Date.parse(row.updatedAt) > Date.parse(latest)) latest = row.updatedAt;
    return {...row};
  });
  must(total === importedRows && missing === freshness.rowsWithoutRestatementTime && latest === freshness.latestRestatementAt);
  return {...raw, scope:{...raw.scope}, period:{...raw.period}, observations,
    freshness:{...freshness, importWindow:{...freshness.importWindow}, restatements},
    coverage:{...raw.coverage, observedDays, missingDays}};
}

export function googleAdsSourceObservation(receipt) {
  return {sourceId:'google_ads', period:{...receipt.period}, observedAt:receipt.readAt, origin:'synced', sourceTimezone:receipt.sourceTimezone,
    lastSuccessfulReadAt:receipt.readAt, importCompletedAt:receipt.freshness.importCompletedAt, latestRestatementAt:receipt.freshness.latestRestatementAt,
    note:'Imported campaign/day sums, not native account totals. Retained campaign keys may be stale. Missing dates remain unavailable; native reconciliation and business-KPI approval are separate.',
    metrics:[['spendMinor','Imported Google Ads spend','currency-minor'],['clicks','Imported Google Ads clicks','count'],['impressions','Imported Google Ads impressions','count']]
      .map(([key,label,unit]) => ({key,label,unit,...(unit === 'currency-minor' ? {currency:receipt.currency} : {}),values:receipt.observations.map(row=>({date:row.date,value:row[key]}))}))};
}
