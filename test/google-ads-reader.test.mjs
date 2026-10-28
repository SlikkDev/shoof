import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../tools/runtime-fixtures.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { createObservationStore } from '../src/observation-store.mjs';
import { createGoogleAdsTransport, googleAdsPeriod, runGoogleAdsRead } from '../src/google-ads-reader.mjs';
import { projectGoogleAdsReceipt } from '../src/google-ads-observations.mjs';

// Independently invented: EUR 1.23, 7 clicks, 23 impressions exercise exact
// minor units and small counts. None originate in a client report or export.
const period={start:'2025-04-01',endExclusive:'2025-04-03'};
const context={tenantId:'fictional-demo',workspaceId:'fictional-workspace',customerId:'9001002003',currency:'EUR',sourceTimezone:'Europe/Paris',period};
const instant='2026-01-07T12:00:00.000Z';
const receipt=(at=instant)=>({schemaVersion:1,source:'google_ads',origin:'imported-observations',scope:{workspaceId:context.workspaceId,accountId:context.customerId},period,currency:'EUR',sourceTimezone:context.sourceTimezone,aggregation:'daily-sum-imported-campaigns',retainedKeysMayBeStale:true,readAt:at,
  observations:[{date:period.start,spendMinor:123,clicks:7,impressions:23,observedRows:1}],freshness:{importCompletedAt:'2025-04-04T00:00:00.000Z',importWindow:period,latestRestatementAt:'2025-04-04T00:00:00.000Z',rowsWithoutRestatementTime:0,restatements:[{updatedAt:'2025-04-04T00:00:00.000Z',rows:1}]},coverage:{status:'unverified',observedDays:[period.start],missingDays:['2025-04-02'],importedRows:1,exhausted:true},reconciliation:'pending',nextCursor:null});

test('strict receipt binds account/workspace/currency/timezone/window and reconciles row provenance',()=>{
  assert.deepEqual(projectGoogleAdsReceipt(receipt(),context),receipt());
  const bad=[r=>r.scope.accountId='other',r=>r.scope.workspaceId='other',r=>r.currency='USD',r=>r.sourceTimezone='UTC',r=>r.period={...period,start:'2025-03-31'},r=>r.nextCursor='more',r=>r.extra='private',r=>r.observations[0].spendMinor=1.23,r=>r.observations[0].clicks=null,r=>r.observations[0].impressions=-1,r=>r.observations.push({...r.observations[0]}),r=>r.freshness.importWindow={start:'2025-04-02',endExclusive:period.endExclusive},r=>r.freshness.restatements[0].rows=2,r=>r.freshness.latestRestatementAt=null,r=>r.freshness.rowsWithoutRestatementTime=1,r=>r.coverage.missingDays=[],r=>r.coverage.exhausted=false,r=>r.retainedKeysMayBeStale=false,r=>r.coverage.status='complete',r=>r.freshness.importCompletedAt='2999-01-01T00:00:00Z'];
  for(const mutate of bad){const raw=receipt();mutate(raw);assert.throws(()=>projectGoogleAdsReceipt(raw,context));}
});

test('rolling dates honor source timezone and DST; unknown timezone requires fixed dates',()=>{
  assert.deepEqual(googleAdsPeriod({completedDays:2,sourceTimezone:'America/New_York',now:new Date('2025-03-10T02:30:00Z')}),{start:'2025-03-07',endExclusive:'2025-03-09'});
  assert.throws(()=>googleAdsPeriod({completedDays:32,sourceTimezone:'UTC'}));
  assert.throws(()=>googleAdsPeriod({completedDays:1,sourceTimezone:null}));
  assert.throws(()=>googleAdsPeriod({period,completedDays:1,sourceTimezone:'UTC'}));
});

function response(raw=receipt(),over={}) {
  const body=JSON.stringify(raw);
  return {status:201,url:'https://reporting.example.test/api/reports/observations/read',redirected:false,headers:new Headers({'content-type':'application/json'}),body:new ReadableStream({start(c){c.enqueue(Buffer.from(body));c.close();}}),...over};
}
const transportOptions={origin:'https://reporting.example.test',token:'otok_agent_'+'a'.repeat(43),context};
test('transport is a bounded POST with immutable scope, timeout, no redirect and no token output',async()=>{
  let call;
  const read=createGoogleAdsTransport({...transportOptions,fetchImpl:async(...args)=>{call=args;return response();}});
  assert.deepEqual(await read(),receipt());
  assert.equal(call[0],response().url);assert.equal(call[1].redirect,'error');assert.ok(call[1].signal instanceof AbortSignal);
  assert.equal(call[1].headers['x-workspace-id'],context.workspaceId);
  assert.deepEqual(JSON.parse(call[1].body),{source:'google_ads',period});
  for(const origin of ['http://reporting.example.test','https://reporting.example.test/path','https://user:password@reporting.example.test'])assert.throws(()=>createGoogleAdsTransport({...transportOptions,origin}));
});
for(const [name,over] of [['status',{status:403}],['redirect',{redirected:true}],['url',{url:'https://other.example.test'}],['type',{headers:new Headers({'content-type':'text/html'})}],['size',{headers:new Headers({'content-type':'application/json','content-length':'1048577'})}]])test(`transport refuses ${name}`,async()=>{
  await assert.rejects(createGoogleAdsTransport({...transportOptions,fetchImpl:async()=>response(receipt(),over)})(),/Google Ads read unavailable/);
});
test('stream cap catches missing/lying content length without exposing the response',async()=>{
  const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(1048577));c.close();}});
  await assert.rejects(createGoogleAdsTransport({...transportOptions,fetchImpl:async()=>response(receipt(),{body})})(),/Google Ads read unavailable/);
});

async function setup(t){
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const fixed={...context,tenantId:f.tenant.tenantId,workspaceId:f.tenant.workspaceId};
  const store=await createObservationStore(f.config.directory);let at=instant;
  const raw=()=>({...receipt(at),scope:{workspaceId:fixed.workspaceId,accountId:fixed.customerId}});
  const args={enabled:true,context:fixed,jobId:'fictional-reader',intervalMs:3600000,staleAfterMs:7200000,store,data,currentTenantId:()=>fixed.tenantId,clock:()=>at,transport:async()=>raw()};
  return {f,data,store,args,raw,setTime:x=>{at=x;}};
}
test('successful read preserves other evidence and unavailable KPIs; restart skips read, failure preserves success and exposes stale source',async t=>{
  const f=await setup(t),before=await f.data.read();
  assert.equal((await runGoogleAdsRead(f.args)).status,'success');
  const after=await f.data.read(new Date(instant));
  assert.deepEqual(after.observations.filter(x=>x.sourceId!=='google_ads'),before.observations);
  assert.deepEqual(after.metrics,before.metrics);assert.ok(Object.values(after.metrics).every(x=>x.status==='unavailable'));
  const ads=after.observations.find(x=>x.sourceId==='google_ads');
  assert.deepEqual(ads.metrics.map(x=>x.total),[123,7,23]);assert.equal(ads.readFreshness,'recent');assert.equal(ads.importFreshness,'stale');assert.equal(ads.matchesReportPeriod,false);
  assert.equal((await runGoogleAdsRead({...f.args,store:await createObservationStore(f.f.config.directory),transport:()=>{throw Error('must not run');}})).status,'not-due');
  f.setTime('2026-01-07T15:00:00.000Z');
  const failed=await runGoogleAdsRead({...f.args,transport:()=>{throw Error('fictional-private-sentinel');}});
  assert.equal(failed.status,'failed');assert.equal(failed.health.readFreshness,'stale');
  const final=await f.data.read(new Date('2026-01-07T15:00:00.000Z'));
  assert.deepEqual(final.observations.filter(x=>x.sourceId!=='google_ads'),before.observations);
  assert.deepEqual(final.observations.find(x=>x.sourceId==='google_ads').metrics,ads.metrics);
  assert.equal(final.runtime.reads.find(x=>x.sourceId==='google_ads').status,'failed');
  for(const name of await readdir(f.f.config.directory)){if(!name.endsWith('.json'))continue;const path=join(f.f.config.directory,name);assert.equal((await stat(path)).mode&0o777,0o600);assert.ok(!(await readFile(path,'utf8')).includes('fictional-private-sentinel'));}
});
test('failure before first read does not manufacture data or zero; stale receipt rejected',async t=>{
  const f=await setup(t),before=await f.data.read();
  const result=await runGoogleAdsRead({...f.args,transport:async()=>({...f.raw(),readAt:'2025-04-04T00:00:00.000Z'})});
  assert.equal(result.status,'failed');assert.deepEqual((await f.data.read()).observations,before.observations);
});
test('concurrent runner issues one read and publication failure stops in recovery-required state',async t=>{
  const f=await setup(t);let release,entered;
  const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
  const running=runGoogleAdsRead({...f.args,transport:async()=>{entered();await held;return f.raw();}});await started;
  assert.equal((await runGoogleAdsRead(f.args)).status,'busy');release();await running;
  f.setTime('2026-01-07T15:00:00.000Z');
  await assert.rejects(runGoogleAdsRead({...f.args,data:{recordSourceRead:async()=>{throw Error('disk');}}}));
  assert.equal((await runGoogleAdsRead({...f.args,transport:()=>{throw Error('must not retry');}})).status,'recovery-required');
});
test('tenant change after response retains all report evidence',async t=>{
  const f=await setup(t),before=await f.data.read();let tenant=f.args.context.tenantId;
  await assert.rejects(runGoogleAdsRead({...f.args,currentTenantId:()=>tenant,transport:async()=>{tenant='other';return f.raw();}}));
  assert.deepEqual(await f.data.read(),before);
});
