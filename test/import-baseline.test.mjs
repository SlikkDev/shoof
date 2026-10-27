import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { createObservationStore } from '../src/observation-store.mjs';
import { createAuth } from '../src/auth.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

// Wholly fictional changes: small distinct counts distinguish competing writes.
const scope = f => ({tenantId:f.tenant.tenantId, sourceId:'reporting', jobId:'published-view'});
const filename = (f, key = scope(f)) => join(f.directory, createHash('sha256').update(JSON.stringify(key)).digest('hex') + '.json');
const cli = (f, overrides = {}) => new Promise((resolve, reject) => {
  execFile(process.execPath, [new URL('../tools/import-report.mjs', import.meta.url).pathname],
    {env:{...process.env,...f.env,...overrides}, timeout:10000, maxBuffer:65536}, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') reject(error);
      else resolve({status:error?.code ?? 0, stdout, stderr});
    });
});
const refused = result => {
  assert.equal(result.status,1); assert.equal(result.stdout,'');
  assert.equal(result.stderr.trim(),'Import refused. Previous accepted report was preserved.');
};
const clean = async f => assert.equal((await readdir(f.directory)).some(n => /\.(tmp|lock)$/.test(n)),false);

test('CLI requires an explicit baseline; absent bootstraps once and never replaces a report', async t => {
  const f=await fixture();t.after(f.cleanup);
  for (const value of [undefined,'','invalid','A'.repeat(64)]) refused(await cli(f,{REPORTING_EXPECTED_DIGEST:value}));
  assert.equal((await cli(f)).status,0);
  const before=await readFile(filename(f));
  refused(await cli(f));
  refused(await cli(f,{REPORTING_EXPECTED_DIGEST:'0'.repeat(64)}));
  assert.deepEqual(await readFile(filename(f)),before);
  const data=await createRuntimeData(f.config);
  await assert.rejects(data.publish(f.snapshot,f.observations),/baseline changed/);
  await clean(f);
});

test('stale import cannot overwrite a correction with identical observation timestamps', async t => {
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const baseline=await f.publicationBaseline();
  const corrected=structuredClone(f.observations);corrected.sources[0].metrics[0].values[0].value=3;
  await (await createRuntimeData(f.config)).publish(f.snapshot,corrected,baseline);
  const before=await readFile(filename(f));
  await assert.rejects(data.publish(f.snapshot,f.observations,baseline),/baseline changed/);
  refused(await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest}));
  assert.deepEqual(await readFile(filename(f)),before);
  assert.equal((await data.read()).observations[0].metrics[0].total,3);
  await clean(f);
});

test('stale import cannot drop a source added after package preparation', async t => {
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const baseline=await f.publicationBaseline(),at=f.snapshot.asOf;
  const added={...structuredClone(f.observations.sources[0]),sourceId:'payments',origin:'synced',lastSuccessfulReadAt:at};
  added.metrics[0].values[0].value=5;
  await data.recordSourceRead({tenantId:f.tenant.tenantId,workspaceId:f.tenant.workspaceId,currentTenantId:()=>f.tenant.tenantId,
    attempt:{sourceId:'payments',status:'success',startedAt:at,finishedAt:at},observation:added});
  const before=await readFile(filename(f));
  refused(await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest}));
  assert.deepEqual(await readFile(filename(f)),before);
  assert.deepEqual((await data.read()).observations.map(s=>s.sourceId),['ga4','payments']);
  await clean(f);
});

test('a changed read receipt invalidates the baseline even when observations are identical', async t => {
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const baseline=await f.publicationBaseline(),at=f.snapshot.asOf;
  await data.recordSourceRead({tenantId:f.tenant.tenantId,workspaceId:f.tenant.workspaceId,currentTenantId:()=>f.tenant.tenantId,
    attempt:{sourceId:'ga4',status:'failed',startedAt:at,finishedAt:at}});
  const before=await readFile(filename(f));
  refused(await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest}));
  assert.deepEqual(await readFile(filename(f)),before);
});

test('two concurrent CLI replacements of one baseline commit exactly one candidate', async t => {
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const baseline=await f.publicationBaseline();
  const inputs=await Promise.all([3,5].map(async value=>{
    const candidate=structuredClone(f.observations);candidate.sources[0].metrics[0].values[0].value=value;
    const path=join(f.directory,`candidate-${value}.json`);await writeFile(path,JSON.stringify(candidate),{mode:0o600});
    return {REPORTING_OBSERVATIONS_FILE:path,REPORTING_EXPECTED_DIGEST:baseline.expectedDigest};
  }));
  const results=await Promise.all(inputs.map(input=>cli(f,input)));
  assert.deepEqual(results.map(r=>r.status).sort(),[0,1]);
  const winner=results.findIndex(r=>r.status===0),loser=1-winner;
  assert.equal((await data.read()).observations[0].metrics[0].total,[3,5][winner]);
  const before=await readFile(filename(f));
  refused(await cli(f,inputs[loser]));
  assert.deepEqual(await readFile(filename(f)),before);
  await clean(f);
});

test('writer lock prevents imports during a pending correction, and stale retry fails after commit', async t => {
  const f=await fixture();t.after(f.cleanup);
  const data=await createRuntimeData(f.config);await data.publish(f.snapshot,f.observations);
  const baseline=await f.publicationBaseline(),store=await createObservationStore(f.directory);
  // Deterministically hold the actual writer lock around a valid same-time correction.
  await store.withLock(scope(f),async transaction=>{
    const previous=await transaction.read();
    previous.observations[0].metrics[0].values[0].value=3;
    previous.observations[0].metrics[0].total=3;
    previous.digest=createHash('sha256').update(JSON.stringify({report:previous.report,observations:previous.observations,reads:previous.reads})).digest('hex');
    refused(await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest}));
    await transaction.write(previous);
  });
  const before=await readFile(filename(f));
  refused(await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest}));
  assert.deepEqual(await readFile(filename(f)),before);
  assert.equal((await data.read()).observations[0].metrics[0].total,3);
  await clean(f);
});

test('matching baseline imports successfully and rejected or accepted imports leave authentication untouched', async t => {
  const f=await fixture();t.after(f.cleanup);
  const auth=await createAuth(f.config),mail=await auth.requestMagic(f.email);
  const login=await auth.redeemMagic(mail.token);assert.equal(login.status,'accepted');
  const authPath=filename(f,{tenantId:f.tenant.tenantId,sourceId:'authentication',jobId:'owner'});
  const authBytes=await readFile(authPath);
  assert.equal((await cli(f)).status,0);
  const baseline=await f.publicationBaseline();
  f.observations.sources[0].metrics[0].values[0].value=3;
  await writeFile(f.env.REPORTING_OBSERVATIONS_FILE,JSON.stringify(f.observations));
  assert.equal((await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest})).status,0);
  refused(await cli(f,{REPORTING_EXPECTED_DIGEST:baseline.expectedDigest}));
  assert.deepEqual(await readFile(authPath),authBytes);
  assert.equal(await auth.authenticated(login.token),true);
  await clean(f);
});
