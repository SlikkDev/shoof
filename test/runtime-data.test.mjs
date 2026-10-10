import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { loadRuntimeConfig, readPrivateJson } from '../src/runtime-config.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

test('publication retains dated provenance, strips extras and keeps all KPIs gated', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config);
  f.snapshot.period.customerRows = [{name: 'Fictional excluded person'}];
  f.observations.sources[0].metrics[0].values[0].extra = 'excluded-field-marker';
  f.observations.sources[0].privateNote = 'excluded-field-marker';
  await data.publish(f.snapshot, f.observations);
  const report = await data.read();
  assert.equal(report.asOf, f.snapshot.asOf);
  assert.equal(report.runtime.evidenceFreshness, 'stale');
  assert.equal(report.runtime.sourceConnectionsActive, false);
  assert.equal(report.observations[0].readFreshness, 'unknown');
  assert.equal(report.observations[0].sourceTimezone, null);
  assert.equal(report.observations[0].metrics[0].total, 7);
  assert.equal(Object.values(report.metrics).filter(m => m.status === 'unavailable').length, 10);
  for (const marker of ['workspaceId', 'accountIds', 'customerRows', 'excluded-field-marker']) assert.equal(JSON.stringify(report).includes(marker), false);
  const stored = await readFile(join(f.directory, (await readdir(f.directory)).find(n => /^[a-f0-9]{64}\.json$/.test(n))), 'utf8');
  assert.equal(stored.includes('excluded-field-marker'), false);
  assert.equal(stored.includes('customerRows'), false);
});

test('invalid, cross-tenant, older and duplicate candidates preserve accepted file and timestamp', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config);
  await data.publish(f.snapshot, f.observations);
  const before = await data.read();
  for (const change of [s => {s.workspaceId = 'another-fictional-workspace';}, s => {s.period.endExclusive = s.period.start;}, s => {s.asOf = '2020-01-01T00:00:00Z';}, s => {s.asOf = '2099-01-01T00:00:00Z';}]) {
    const snapshot = structuredClone(f.snapshot); change(snapshot);
    await assert.rejects(data.publish(snapshot, f.observations));
    assert.deepEqual(await data.read(), before);
  }
  for (const change of [o => {o.tenantId = 'another-fictional-tenant';}, o => {o.sources[0].metrics[0].values.push({...o.sources[0].metrics[0].values[0]});}, o => {o.sources[0].lastSuccessfulReadAt = f.snapshot.asOf;}, o => {o.sources[0].metrics[0].values[0].value = -1;}, o => {o.sources[0].observedAt = '2020-01-01T00:00:00Z';}]) {
    const observations = structuredClone(f.observations); change(observations);
    await assert.rejects(data.publish(f.snapshot, observations));
    assert.deepEqual(await data.read(), before);
  }
});

test('empty observations are unavailable, never zero-filled; explicit zero remains zero', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config);
  f.observations.sources[0].metrics[0].values = [];
  await data.publish(f.snapshot, f.observations);
  assert.equal((await data.read()).observations[0].metrics[0].total, null);
  f.observations.sources[0].metrics[0].values = [{date: f.snapshot.period.start, value: 0}];
  await data.publish(f.snapshot, f.observations);
  assert.equal((await data.read()).observations[0].metrics[0].total, 0);
});

test('durable report survives a separate process and rejected CLI import', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const env = {...process.env, ...f.env};
  execFileSync(process.execPath, [new URL('../tools/import-report.mjs', import.meta.url).pathname], {env});
  const data = await createRuntimeData(f.config), before = await data.read();
  const script = `import {createRuntimeData} from ${JSON.stringify(new URL('../src/runtime-data.mjs', import.meta.url).href)}; const d=await createRuntimeData(JSON.parse(process.argv[1])); console.log(JSON.stringify(await d.read()));`;
  const freshProcess = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(f.config)], {encoding:'utf8'}));
  assert.deepEqual(freshProcess, before);
  await writeFile(f.snapshotFile, '{invalid-json');
  const failed = spawnSync(process.execPath, [new URL('../tools/import-report.mjs', import.meta.url).pathname], {env, encoding:'utf8'});
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Previous accepted report was preserved/);
  assert.deepEqual(await data.read(), before);
});

for (const target of ['snapshot', 'observations']) test(`distant ${target} period is refused by the bounded-memory import CLI without changing state`, async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config);
  await data.publish(f.snapshot, f.observations);
  const stateFile = join(f.directory, (await readdir(f.directory)).find(n => /^[a-f0-9]{64}\.json$/.test(n)));
  const before = await readFile(stateFile);
  const period = {start: '0001-01-01', endExclusive: '9999-12-31'};
  if (target === 'snapshot') f.snapshot.period = period;
  else f.observations.sources[0].period = period;
  await writeFile(f.snapshotFile, JSON.stringify(f.snapshot));
  await writeFile(f.env.REPORTING_OBSERVATIONS_FILE, JSON.stringify(f.observations));
  const failed = spawnSync(process.execPath, ['--max-old-space-size=64', new URL('../tools/import-report.mjs', import.meta.url).pathname], {
    env: {...process.env, ...f.env}, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024,
  });
  assert.equal(failed.error, undefined);
  assert.equal(failed.signal, null);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
  assert.equal(failed.stderr.trim(), 'Import refused. Previous accepted report was preserved.');
  assert.deepEqual(await readFile(stateFile), before);
  assert.equal((await readdir(f.directory)).some(name => name.endsWith('.tmp') || name.endsWith('.lock')), false);
});

test('tenant identity is frozen, another tenant cannot read state, corruption fails closed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config);
  await data.publish(f.snapshot);
  f.config.tenant = {...f.tenant, tenantId: 'other-fictional-tenant'};
  const other = await createRuntimeData(f.config);
  await assert.rejects(other.read());
  assert.equal((await data.read()).tenant.displayName, f.tenant.displayName);
  const file = join(f.directory, (await readdir(f.directory)).find(n => /^[a-f0-9]{64}\.json$/.test(n)));
  const state = JSON.parse(await readFile(file, 'utf8')); state.report.metrics.mediaSpend.value = 999;
  await writeFile(file, JSON.stringify(state));
  await assert.rejects(data.read());
  await assert.rejects(data.publish(f.snapshot));
});

test('concurrent readers see a complete old/new report or busy, never a partial write', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const data = await createRuntimeData(f.config);
  await data.publish(f.snapshot, f.observations);
  f.observations.sources[0].metrics[0].values[0].value = 9;
  const attempts = await Promise.allSettled([data.publish(f.snapshot, f.observations), ...Array.from({length: 12}, () => data.read())]);
  for (const result of attempts.slice(1)) {
    if (result.status === 'fulfilled') assert.ok([7,9].includes(result.value.observations[0].metrics[0].total));
    else assert.match(result.reason.message, /busy/);
  }
  const final = await data.read();
  assert.equal(final.observations[0].metrics[0].total, attempts[0].status === 'fulfilled' ? 9 : 7);
});

test('private files and runtime config reject public modes, missing auth, symlinks and broad permissions', async t => {
  const f = await fixture(); t.after(f.cleanup);
  assert.equal((await loadRuntimeConfig(f.env)).access.publicHost, f.access.publicHost);
  await assert.rejects(loadRuntimeConfig({...f.env, REPORTING_ACCESS_AUDIENCE: ''}));
  await assert.rejects(readPrivateJson(new URL('../examples/tenant.demo.json', import.meta.url).pathname));
  const link = join(f.directory, 'linked.json'); await symlink(f.tenantFile, link);
  await assert.rejects(readPrivateJson(link));
  await chmod(f.tenantFile, 0o644); await assert.rejects(loadRuntimeConfig(f.env));
  await chmod(f.tenantFile, 0o600);
  await writeFile(f.tenantFile, JSON.stringify({...f.tenant, mode:'demo'})); await assert.rejects(loadRuntimeConfig(f.env));
});
