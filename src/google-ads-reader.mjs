import { createHash } from 'node:crypto';
import { validateGoogleAdsContext, projectGoogleAdsReceipt, googleAdsSourceObservation } from './google-ads-observations.mjs';
import { runSyncTick } from './sync.mjs';

const fail = () => { throw new Error('Google Ads read unavailable'); };
// The sole network action. No redirects, vendor calls, retry or account override.
export function createGoogleAdsTransport({origin, token, context, fetchImpl = globalThis.fetch}) {
  const fixed = validateGoogleAdsContext(context), base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !/^otok_agent_[A-Za-z0-9_-]{43}$/.test(token)) fail();
  const endpoint = new URL('/api/reports/observations/read', base).href;
  return async () => {
    let reader, response;
    try {
      response = await fetchImpl(endpoint, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
        headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-workspace-id':fixed.workspaceId},
        body:JSON.stringify({source:'google_ads',period:fixed.period})});
      if (response.status !== 201 || response.redirected || response.url !== endpoint || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) fail();
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024*1024)) fail();
      reader = response.body?.getReader(); if (!reader) fail();
      const chunks = []; let bytes = 0;
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 1024*1024) fail(); chunks.push(value);
      }
      return projectGoogleAdsReceipt(JSON.parse(Buffer.concat(chunks).toString('utf8')), fixed);
    } catch { fail(); }
    finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } else await response?.body?.cancel().catch(() => {}); }
  };
}

// Source-native completed dates. Unknown timezone cannot drive a rolling read.
export function googleAdsPeriod({period, completedDays, sourceTimezone, now = new Date()}) {
  if (period !== undefined && completedDays === undefined) return period;
  if (period !== undefined || !Number.isInteger(completedDays) || completedDays < 1 || completedDays > 31 || !sourceTimezone) fail();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone:sourceTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(part=>[part.type,part.value]));
  const endExclusive = `${parts.year}-${parts.month}-${parts.day}`;
  return {start:new Date(Date.parse(endExclusive)-completedDays*86400000).toISOString().slice(0,10),endExclusive};
}

// Called once by an explicitly authorized private host. This installs no timer.
export async function runGoogleAdsRead({enabled = false, context, jobId, intervalMs, staleAfterMs, store, data, transport, currentTenantId, clock = () => new Date().toISOString()}) {
  if (enabled !== true) return {status:'disabled'};
  const fixed = validateGoogleAdsContext(context);
  const readContext = {tenantId:fixed.tenantId,sourceId:'google_ads',accountIds:[fixed.customerId],metricKeys:['spendMinor','clicks','impressions'],timezone:fixed.sourceTimezone,period:fixed.period};
  let receipt;
  const earliest = Date.parse(clock());
  return runSyncTick({enabled:true, job:{id:jobId,context:readContext,intervalMs,staleAfterMs,maxPages:1,maxRows:31},store,currentTenantId,clock,
    transport:async () => {
      receipt = projectGoogleAdsReceipt(await transport(), fixed);
      if (Date.parse(receipt.readAt) < earliest || Date.parse(receipt.readAt) > Date.parse(clock())) fail();
      return {...readContext,nextCursor:null,rows:receipt.observations.map(row=>({key:row.date,accountId:fixed.customerId,date:row.date,values:{spendMinor:row.spendMinor,clicks:row.clicks,impressions:row.impressions}}))};
    },
    publishAttempt:async attempt => {
      if (attempt.status === 'success') {
        if (Date.parse(receipt.readAt) < Date.parse(attempt.startedAt) || Date.parse(receipt.readAt) > Date.parse(attempt.finishedAt)) fail();
        // Archive the allowlisted provenance before changing the report. The
        // content-addressed receipt contains no credential or provider payload.
        const digest = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
        const archived = await store.withLock({tenantId:fixed.tenantId,sourceId:'google_ads',jobId:`receipt-${digest}`}, async tx => {
          if (await tx.write(receipt, {shouldCommit:()=>currentTenantId()===fixed.tenantId}) === false) fail();
          return {status:'archived'};
        });
        if (archived.status !== 'archived') fail();
      }
      await data.recordSourceRead({tenantId:fixed.tenantId,workspaceId:fixed.workspaceId,currentTenantId,
        attempt:{...attempt,sourceId:'google_ads'},observation:attempt.status==='success'?googleAdsSourceObservation(receipt):null});
    }});
}
