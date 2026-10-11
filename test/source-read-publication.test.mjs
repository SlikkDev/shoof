import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../tools/runtime-fixtures.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';

function observation(at, sessions=19, engaged=11) {
  return {sourceId:'ga4',period:{start:'2026-01-02',endExclusive:'2026-01-05'},observedAt:at,origin:'synced',sourceTimezone:null,lastSuccessfulReadAt:at,
    importCompletedAt:'2026-01-06T07:00:00.000Z',latestRestatementAt:'2026-01-06T07:00:00.000Z',metrics:[
      {key:'sessions',label:'Sessions',unit:'count',values:[{date:'2026-01-02',value:sessions}]},
      {key:'engagedSessions',label:'Engaged sessions',unit:'count',values:[{date:'2026-01-02',value:engaged}]}]};
}
test('success replaces a snapshot version; failure preserves evidence and exposes only sanitized attempt health',async t=>{
  const f=await fixture();t.after(f.cleanup);const data=await createRuntimeData(f.config);
  await data.publish(f.snapshot,f.observations);
  const record=(status,start,source=null)=>data.recordSourceRead({tenantId:f.tenant.tenantId,workspaceId:f.tenant.workspaceId,currentTenantId:()=>f.tenant.tenantId,
    attempt:{sourceId:'ga4',status,startedAt:start,finishedAt:start,rawError:'FICTIONAL_SECRET'},observation:source});
  const at='2026-01-06T08:00:00.000Z',later='2026-01-07T08:00:00.000Z';
  await record('success',at,observation(at));
  assert.equal((await data.read()).observations[0].metrics[0].total,19);
  await record('success',later,observation(later,17,12));
  const good=await data.read();
  assert.deepEqual(good.observations[0].metrics.map(m=>m.total),[17,12]);
  assert.equal(good.observations[0].matchesReportPeriod,false);
  assert.equal(good.observations[0].coverage,'unverified');assert.equal(good.observations[0].reconciliation,'pending');
  assert.equal(good.runtime.sourceReadsRecorded,true);
  assert.equal(good.asOf,f.snapshot.asOf);
  assert.equal(good.observations[0].readFreshness,'stale');
  assert.ok(Object.values(good.metrics).every(m=>m.status==='unavailable'));
  await record('failed','2026-01-08T08:00:00.000Z');
  const failed=await data.read();assert.deepEqual(failed.observations,good.observations);
  assert.equal(failed.runtime.reads[0].status,'failed');assert.equal(failed.runtime.reads[0].errorCode,'read-failed');
  assert.equal(JSON.stringify(failed).includes('FICTIONAL_SECRET'),false);
  await assert.rejects(record('success',at,observation(at)));
  assert.deepEqual((await data.read()).observations,good.observations);
});
test('failed first attempt never promotes a UI snapshot to connected; crossed tenant and future reads fail closed',async t=>{
  const f=await fixture();t.after(f.cleanup);const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const input={tenantId:f.tenant.tenantId,workspaceId:f.tenant.workspaceId,currentTenantId:()=>f.tenant.tenantId,
    attempt:{sourceId:'ga4',status:'failed',startedAt:'2026-01-06T08:00:00.000Z',finishedAt:'2026-01-06T08:00:00.000Z'}};
  await data.recordSourceRead(input);const before=await data.read();
  assert.equal(before.observations[0].origin,'ui-snapshot');assert.equal(before.runtime.sourceReadsRecorded,false);
  for(const patch of [{workspaceId:'other'},{tenantId:'other'},{currentTenantId:()=> 'other'},
    {attempt:{...input.attempt,finishedAt:'2099-01-01T00:00:00.000Z'}}]) await assert.rejects(data.recordSourceRead({...input,...patch}));
  assert.deepEqual(await data.read(),before);
});
