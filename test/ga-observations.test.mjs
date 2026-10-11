import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGa4Receipt, ga4SourceObservation } from '../src/ga-observations.mjs';

// Fictional data only; numbers exercise independent restated snapshot versions.
export const context = {workspaceId:'fictional-workspace',propertyId:'123456',period:{start:'2026-01-02',endExclusive:'2026-01-05'}};
export function receipt(sessions=19, engagedSessions=11) {
  return {schemaVersion:1,source:'ga4',origin:'imported-observations',scope:{workspaceId:context.workspaceId,accountId:context.propertyId},period:{...context.period},sourceTimezone:null,
    aggregation:'daily-sum-all-imported-dimension-keys',retainedKeysMayBeStale:true,readAt:'2026-01-06T08:00:01.000Z',
    observations:[{date:'2026-01-02',sessions,engagedSessions,observedRows:2}],
    freshness:{importCompletedAt:'2026-01-06T07:00:00.000Z',latestRestatementAt:'2026-01-06T07:00:00.000Z',rowsWithoutRestatementTime:0,
      restatements:[{updatedAt:'2026-01-04T07:00:00.000Z',rows:1},{updatedAt:'2026-01-06T07:00:00.000Z',rows:1}]},
    coverage:{status:'unverified',observedDays:['2026-01-02'],missingDays:['2026-01-03','2026-01-04'],importedRows:2,exhausted:true},reconciliation:'pending',nextCursor:null};
}
test('restated snapshots remain distinct, retain older restatement times and keep coverage unverified',()=>{
  const before=projectGa4Receipt(receipt(),context),after=projectGa4Receipt(receipt(17,12),context);
  assert.equal(before.observations[0].sessions,19);assert.equal(after.observations[0].sessions,17);
  assert.equal(after.observations[0].engagedSessions,12);
  assert.equal(after.coverage.status,'unverified');assert.equal(after.reconciliation,'pending');
  assert.equal(after.freshness.restatements.length,2);
  assert.equal(ga4SourceObservation(after).metrics[0].values[0].value,17);
});
test('rejects tenant/property/date/aggregation drift, pagination, duplicates, extras and false completeness',()=>{
  for(const mutate of [r=>r.scope.workspaceId='other',r=>r.scope.accountId='654321',r=>r.period.start='2026-01-01',r=>r.sourceTimezone='UTC',
    r=>r.observations.push({...r.observations[0]}),r=>r.observations[0].sessions=null,r=>r.observations[0].date='2026-01-05',
    r=>r.coverage.exhausted=false,r=>r.nextCursor='page2',r=>r.coverage.status='complete',r=>r.freshness.restatements=[],
    r=>r.scope.email='fictional@example.test',r=>r.aggregation='channel-sum',r=>r.retainedKeysMayBeStale=false]) {
    const raw=receipt();mutate(raw);assert.throws(()=>projectGa4Receipt(raw,context));
  }
  assert.throws(()=>projectGa4Receipt(receipt(),{...context,period:{start:'0001-01-01',endExclusive:'9999-12-31'}}));
});
test('empty imported scope remains empty and unavailable, never synthetic zeros',()=>{
  const raw=receipt();raw.observations=[];raw.coverage={status:'unverified',observedDays:[],missingDays:['2026-01-02','2026-01-03','2026-01-04'],importedRows:0,exhausted:true};
  raw.freshness={...raw.freshness,latestRestatementAt:null,restatements:[]};
  assert.deepEqual(ga4SourceObservation(projectGa4Receipt(raw,context)).metrics[0].values,[]);
});
