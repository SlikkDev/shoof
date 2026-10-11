import { daysInPeriod } from './model.mjs';
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
function validateContext(context) {
  const {tenantId,sourceId,accountIds,metricKeys,period,timezone}=context;
  if (!identifier(tenantId)||!identifier(sourceId)||!Array.isArray(accountIds)||!accountIds.length||accountIds.some(x=>!identifier(x))||new Set(accountIds).size!==accountIds.length) throw new Error('Verified tenant/source/accounts required');
  if (!Array.isArray(metricKeys)||!metricKeys.length||metricKeys.some(x=>!identifier(x))||new Set(metricKeys).size!==metricKeys.length) throw new Error('Metric allowlist required');
  if (timezone !== null) {
    if (typeof timezone !== 'string' || !timezone) throw new Error('Explicit source timezone or null (unverified) required');
    new Intl.DateTimeFormat('en',{timeZone:timezone});
  }
  daysInPeriod(period);
}
export function normalizeObservationPage(page,context) {
  validateContext(context);
  if (!page||page.tenantId!==context.tenantId||page.sourceId!==context.sourceId||page.timezone!==context.timezone||!Array.isArray(page.rows)||page.rows.length>1000) throw new Error('Invalid observation scope');
  if (page.nextCursor!==null && (typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>500)) throw new Error('Invalid pagination cursor');
  if (page.partial === true) throw new Error('Partial upstream response');
  const rows=page.rows.map(row=>{
    if (!identifier(row.key)||!context.accountIds.includes(row.accountId)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||row.date<context.period.start||row.date>=context.period.endExclusive) throw new Error('Invalid observation identity/date');
    daysInPeriod({start:row.date,endExclusive:new Date(Date.parse(row.date)+86400000).toISOString().slice(0,10)});
    const values=Object.fromEntries(context.metricKeys.map(key=>{
      const value=row.values?.[key];
      if (value !== null && (typeof value!=='number'||!Number.isFinite(value))) throw new Error('Missing or nonnumeric observation');
      return [key,value]; // Missing is rejected; explicit unknown remains null.
    }));
    return {key:row.key,accountId:row.accountId,date:row.date,values};
  });
  return {rows,nextCursor:page.nextCursor};
}
export function projectReadContext(context) {
  validateContext(context);
  return {tenantId:context.tenantId,sourceId:context.sourceId,accountIds:[...context.accountIds],metricKeys:[...context.metricKeys],timezone:context.timezone,period:{start:context.period.start,endExclusive:context.period.endExclusive}};
}
export async function collectObservations({transport,currentTenantId,context,maxPages=100,maxRows=10000}) {
  const fixed=projectReadContext(context);
  if (typeof transport!=='function'||typeof currentTenantId!=='function'||!Number.isInteger(maxPages)||maxPages<1||maxPages>1000||!Number.isInteger(maxRows)||maxRows<1||maxRows>100000) throw new Error('Bounded existing read transport required');
  const rows=[],cursors=new Set(),keys=new Set();let cursor=null;
  for (let index=0;index<maxPages;index++) {
    if (currentTenantId()!==fixed.tenantId) throw new Error('Tenant changed');
    const request=Object.freeze({...structuredClone(fixed),cursor,kind:'read-observations'});
    const raw=await transport(request);
    if (currentTenantId()!==fixed.tenantId) throw new Error('Tenant changed');
    const page=normalizeObservationPage(raw,fixed);
    if (rows.length+page.rows.length>maxRows) throw new Error('Row limit reached; completeness unknown');
    for (const row of page.rows) {
      const key=`${row.accountId}:${row.key}`;
      if (keys.has(key)) throw new Error('Duplicate source identity');
      keys.add(key);rows.push(row);
    }
    if (page.nextCursor===null) return {tenantId:fixed.tenantId,sourceId:fixed.sourceId,rows,paginationExhausted:true,coverage:'unverified',observedDays:[...new Set(rows.map(r=>r.date))].sort()};
    if (cursors.has(page.nextCursor)) throw new Error('Repeated cursor');
    cursors.add(page.nextCursor);cursor=page.nextCursor;
  }
  throw new Error('Page limit reached; completeness unknown');
}
