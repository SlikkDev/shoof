import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

// Wholly invented amounts: one unit/one cent and two units/two cents.
// The safe-integer boundary exercises rendering precision; no real observations are used.
function money(f) {
  const source = f.observations.sources[0];
  source.sourceId = 'payments';
  source.origin = 'manual';
  source.note = 'Fictional provider audit. Gross charges are not settled cash.';
  source.metrics = [{key:'grossCharges',label:'Observed gross charges (fictional)',unit:'currency-minor',currency:'EUR',
    values:[{date:f.snapshot.period.start,value:101},{date:'2025-01-02',value:202}]}];
  return source;
}

test('dated monetary diagnostics preserve cents and leave every business KPI unchanged', async t => {
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);
  await data.publish(f.snapshot,f.observations);
  const before=await data.read();
  money(f);
  await data.publish(f.snapshot,f.observations);
  const after=await data.read(),source=after.observations[0];
  assert.equal(source.metrics[0].total,303);
  assert.equal(source.metrics[0].currency,'EUR');
  assert.equal(source.origin,'manual');
  assert.equal(source.lastSuccessfulReadAt,null);
  assert.equal(source.reportReady,false);
  assert.equal(source.coverage,'unverified');
  assert.equal(source.reconciliation,'pending');
  assert.equal(after.runtime.sourceReadsRecorded,false);
  assert.equal(after.asOf,before.asOf);
  assert.deepEqual(after.metrics,before.metrics);
  assert.match(source.note,/not settled cash/);
});

test('unknown or omitted currency, unsafe amounts and invalid notes preserve accepted state', async t => {
  const f=await fixture();t.after(f.cleanup);money(f);
  const data=await createRuntimeData(f.config);
  await data.publish(f.snapshot,f.observations);const before=await data.read();
  for (const change of [
    s=>{delete s.metrics[0].currency;},s=>{s.metrics[0].currency='JPY';},s=>{s.metrics[0].currency=['EUR'];},
    s=>{s.metrics[0].values[0].value=1.01;},s=>{s.metrics[0].values[0].value=-1;},
    s=>{s.metrics[0].values[0].value=Number.MAX_SAFE_INTEGER;},
    s=>{s.note='x'.repeat(601);},s=>{s.note='invalid\nannotation';},s=>{s.note={raw:'not text'};}
  ]) {
    const candidate=structuredClone(f.observations);change(candidate.sources[0]);
    await assert.rejects(data.publish(f.snapshot,candidate));
    assert.deepEqual(await data.read(),before);
  }
});

test('empty money observations stay unavailable, zero stays explicit and mismatched periods stay labelled', async t => {
  const f=await fixture();t.after(f.cleanup);const source=money(f);
  source.period={start:'2025-02-01',endExclusive:'2025-02-03'};
  source.metrics[0].values=[];
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  assert.equal((await data.read()).observations[0].metrics[0].total,null);
  source.metrics[0].values=[{date:'2025-02-01',value:0}];
  await data.publish(f.snapshot,f.observations);
  const result=(await data.read()).observations[0];
  assert.equal(result.metrics[0].total,0);
  assert.equal(result.metrics[0].values.length,1);
  assert.equal(result.matchesReportPeriod,false);
});

const script=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
async function render(report) {
  const elements=new Map();
  const element=()=>({textContent:'',innerHTML:'',addEventListener(){},after(){}});
  const document={title:'',addEventListener(){},querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},
    querySelectorAll:()=>[],documentElement:{style:{setProperty(){}}}};
  const calls=[];
  await runInNewContext('(async()=>{'+script+'})()',{
    document,window:{addEventListener(){}},location:{hash:'#health'},history:{},requestAnimationFrame(){},
    fetch:async path=>{calls.push(path);return {status:200,ok:true,headers:{get:()=>null},json:async()=>report};}
  });
  assert.deepEqual(calls,['./api/report']);
  return elements.get('#main').innerHTML;
}

test('actual UI renders per-metric currency/cents, escaped explanation and unavailable values', async t => {
  const f=await fixture();t.after(f.cleanup);const source=money(f);
  source.note='Fictional <script>marker</script> is text, not settled cash.';
  source.metrics.push({key:'empty',label:'No evidence',unit:'currency-minor',currency:'GBP',values:[]});
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const report=await data.read();report.tenant.locale='en-US';report.currency='USD';
  const page=await render(report);
  assert.match(page,/€3\.03/);assert.match(page,/€1\.01/);assert.match(page,/€2\.02/);
  assert.match(page,/No evidence: Unavailable/);
  assert.match(page,/Manual snapshot/);assert.match(page,/Coverage unverified/);
  assert.match(page,/&lt;script&gt;marker&lt;\/script&gt;/);assert.doesNotMatch(page,/<script>/);
  assert.doesNotMatch(page,/\$3\.03/);
});

test('actual UI retains the final cent at the safe integer boundary', async t => {
  const f=await fixture();t.after(f.cleanup);const source=money(f);
  source.metrics[0].currency='USD';source.metrics[0].values=[{date:f.snapshot.period.start,value:Number.MAX_SAFE_INTEGER}];
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const report=await data.read();report.tenant.locale='en-US';
  assert.match(await render(report),/\$90,071,992,547,409\.91/);
});

test('localised currency rendering retains non-Latin fractional digits', async t => {
  const f=await fixture();t.after(f.cleanup);money(f);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const report=await data.read();report.tenant.locale='ar-EG';
  const page=await render(report);
  assert.match(page,/٣٫٠٣/);
});

