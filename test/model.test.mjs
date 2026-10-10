import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateMetric,buildReport,daysInPeriod,sourceHealth } from '../src/model.mjs';
const fixture=JSON.parse(readFileSync(new URL('../examples/snapshot.demo.json',import.meta.url)));
const fresh=()=>structuredClone(fixture);
test('fictional snapshot has ten consistent metric outputs',()=>{const r=buildReport(fresh());assert.equal(Object.keys(r.metrics).length,10);assert.ok(Object.values(r.metrics).every(m=>m.status==='available'));assert.equal(r.metrics.mediaSpend.value,120000);assert.equal(r.metrics.mediaCpl.value,5000);assert.equal(r.metrics.netCollected.value,630000);assert.equal(r.metrics.cashRoas.value,3.5);});
test('missing business observations never become zero',()=>{const s=fresh();delete s.metricInputs.mediaSpend;assert.equal(evaluateMetric('mediaSpend',s).value,null);});
test('a proven empty population is zero, with undefined ratio',()=>{const s=fresh();s.metricInputs.paidLeads.records=[];assert.equal(evaluateMetric('paidLeads',s).value,0);assert.equal(evaluateMetric('mediaCpl',s).value,null);});
test('missing day and unverified source identities block values',()=>{for(const modify of [s=>s.sources[0].coverage.coveredDays.pop(),s=>s.sources[0].identityVerified=false,s=>s.sources[0].accountIds=[]]){const s=fresh();modify(s);assert.equal(evaluateMetric('mediaSpend',s).value,null);}});
test('reconciliation must match tenant, period, timezone and currency',()=>{for(const [key,value] of [['workspaceId','other-demo'],['start','2024-01-01'],['timezone','Asia/Tokyo'],['currency','EUR']]){const s=fresh();s.sources[0].reconciliation[key]=value;assert.equal(evaluateMetric('mediaSpend',s).value,null);}});
test('invalid account, duplicate identity and fractional money are rejected',()=>{for(const change of [s=>s.metricInputs.mediaSpend.records[0].accountId='other',s=>s.metricInputs.mediaSpend.records.push(s.metricInputs.mediaSpend.records[0]),s=>s.metricInputs.mediaSpend.records[0].spendMinor=0.1]){const s=fresh();change(s);assert.equal(evaluateMetric('mediaSpend',s).value,null);}});
test('cash subtracts refunds and chargebacks on the supplied event population',()=>{const s=fresh();s.metricInputs.netCollected.records[0].chargebackMinor=30000;assert.equal(evaluateMetric('netCollected',s).value,600000);});
test('CRM identity is deduplicated after input identity validation',()=>{const s=fresh();const row=s.metricInputs.validLeads.records[0];s.metricInputs.validLeads.records.push({...row,key:'different-source-event'});assert.equal(evaluateMetric('validLeads',s).value,40);});
test('immature and unapproved attribution cannot release cohort ratios',()=>{const s=fresh();s.asOf='2025-01-09T00:00:00Z';assert.equal(evaluateMetric('mediaCac',s).value,null);s.asOf=fixture.asOf;s.attribution.status='pending';assert.equal(evaluateMetric('cashRoas',s).value,null);});
test('successful sync is independent of verified coverage',()=>{const s=fresh();s.sources[0].coverage.status='unknown';const h=sourceHealth(s.sources[0],s.asOf,s);assert.equal(h.sync,'recent');assert.equal(h.reportReady,false);});
test('invalid calendar dates and missing values are rejected',()=>{assert.throws(()=>daysInPeriod({start:'2025-02-30',endExclusive:'2025-03-04'}));const s=fresh();s.metricInputs.mediaSpend.records[0].spendMinor=null;assert.equal(evaluateMetric('mediaSpend',s).value,null);});
test('report presentation rejects nested objects and coerced arrays in scalar fields',()=>{
  const paths=[['mode'],['timezone'],['currency'],['asOf'],...['id','label','group','connection','evidenceObservedAt','lastSuccessfulSync','latestBusinessDate'].map(key=>['sources',0,key]),['sources',0,'coverage','status'],['sources',0,'reconciliation','status']];
  for(const path of paths)for(const wrap of [value=>[value],()=>({private:'fictional-sentinel'})]){
    const s=fresh(),parent=path.slice(0,-1).reduce((value,key)=>value[key],s),key=path.at(-1);parent[key]=wrap(parent[key]);
    assert.throws(()=>buildReport(s),undefined,path.join('.'));
  }
});
