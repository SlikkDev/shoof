import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPaidImport, importedAmountToMinor, comparePaidImports } from '../src/paid-observations.mjs';
import { buildReport } from '../src/model.mjs';
import { readFile } from 'node:fs/promises';

// Wholly invented from arithmetic requirements: one dollar plus one cent, two
// dollars plus two cents; tiny counters exercise addition. No source evidence
// was used to choose amounts, counts, identifiers, dates, or ratios.
const period = { start: '2040-02-01', endExclusive: '2040-02-04' };
const context = (source = 'meta_ads') => ({ workspaceId: 'fictional-workspace', source, accountId: '123', period: { ...period }, currency: 'USD', sourceTimezone: 'Etc/UTC' });
function raw(source = 'meta_ads') {
  const ctx = context(source), meta = source === 'meta_ads';
  const rows = [1, 2].map(n => ({ workspace_id: ctx.workspaceId, [meta ? 'ad_account_id' : 'customer_id']: ctx.accountId,
    date: period.start, campaign_id: String(n), [meta ? 'spend' : 'cost']: `${n}.0${n}`,
    [meta ? 'meta_currency' : 'google_currency']: 'USD', impressions: n * 10, clicks: n,
    updated_at: '2040-02-04T00:00:00Z', ...(meta ? { level: 'ad', ad_id: String(n) } : {}) }));
  return { schemaVersion: 1, table: meta ? 'meta_ads_daily_stats' : 'google_ads_daily_stats', scope: { workspaceId: ctx.workspaceId, accountId: ctx.accountId },
    period: { ...period }, currency: 'USD', sourceTimezone: 'Etc/UTC', readAt: '2040-02-05T00:00:00Z', importCompletedAt: '2040-02-04T01:00:00Z',
    snapshot: { before: 'fictional-version', after: 'fictional-version', status: 'complete' }, rows, nextCursor: null, exhausted: true };
}

for (const source of ['meta_ads', 'google_ads']) {
  test(`${source}: exact imported major-unit amounts, daily aggregation and missing days`, () => {
    const input = raw(source), copy = structuredClone(input);
    const receipt = projectPaidImport(input, context(source));
    assert.deepEqual(receipt.observations, [{ date: period.start, spendMinor: 303, impressions: 30, clicks: 3, observedRows: 2 }]);
    assert.equal(receipt.currency, 'USD');
    assert.equal(receipt.amountUnit, 'currency-minor-units');
    assert.deepEqual(receipt.coverage.missingDays, ['2040-02-02', '2040-02-03']);
    assert.equal(receipt.coverage.status, 'unverified');
    assert.equal(receipt.reconciliation, 'pending');
    assert.equal(receipt.reportReady, false);
    assert.deepEqual(input, copy);
    assert.equal(JSON.stringify(receipt).includes('campaign_id'), false);
  });
  test(`${source}: exhausted empty export remains unknown, not a zero day`, () => {
    const input = raw(source); input.rows = [];
    const receipt = projectPaidImport(input, context(source));
    assert.deepEqual(receipt.observations, []);
    assert.equal(receipt.coverage.missingDays.length, 3);
    assert.equal(receipt.freshness.latestRestatementAt, null);
  });
  const invalid = [
    ['workspace', x => { x.rows[0].workspace_id = 'other-workspace'; }],
    ['account', x => { x.rows[0][source === 'meta_ads' ? 'ad_account_id' : 'customer_id'] = '999'; }],
    ['scope', x => { x.scope.accountId = '999'; }],
    ['period', x => { x.period.endExclusive = '2040-02-03'; }],
    ['range boundary', x => { x.rows[0].date = period.endExclusive; }],
    ['invalid day', x => { x.rows[0].date = '2040-02-31'; }],
    ['currency', x => { x.rows[0][source === 'meta_ads' ? 'meta_currency' : 'google_currency'] = 'EUR'; }],
    ['missing currency', x => { x.rows[0][source === 'meta_ads' ? 'meta_currency' : 'google_currency'] = null; }],
    ['duplicate identity', x => { x.rows.push(structuredClone(x.rows[0])); }],
    ['pagination', x => { x.nextCursor = 'remaining'; }],
    ['exhaustion', x => { x.exhausted = false; }],
    ['partial import', x => { x.snapshot.status = 'partial'; }],
    ['version change', x => { x.snapshot.after = 'changed'; }],
    ['row cap', x => { x.rows = Array(1001).fill(x.rows[0]); }],
    ['unsafe count', x => { x.rows[0].impressions = Number.MAX_SAFE_INTEGER + 1; }],
    ['sum overflow', x => { x.rows[0].impressions = Number.MAX_SAFE_INTEGER; }],
    ['unknown value', x => { x.rows[0].clicks = null; }],
    ['negative count', x => { x.rows[0].clicks = -1; }],
    ['future restatement', x => { x.rows[0].updated_at = '2040-02-06T00:00:00Z'; }],
    ['future completion', x => { x.importCompletedAt = '2040-02-06T00:00:00Z'; }],
    ['privacy field', x => { x.rows[0].campaign_name = 'fictional disallowed label'; }],
    ['raw metadata', x => { x.last_error = 'disallowed diagnostic'; }],
  ];
  for (const [name, change] of invalid) test(`${source}: rejects ${name}`, () => {
    const input = raw(source); change(input);
    assert.throws(() => projectPaidImport(input, context(source)), /Invalid paid-media import evidence/);
  });
}

test('Meta campaign-level overlap is rejected, not silently included', () => {
  const input = raw(); input.rows[0].level = 'campaign'; input.rows[0].ad_id = '';
  assert.throws(() => projectPaidImport(input, context()));
});
test('source lookup does not coerce arrays into an allowed provider', () => {
  const input = raw(); input.rows[0].level = 'campaign'; input.rows[0].ad_id = '';
  for (const source of [['meta_ads'], ['google_ads'], { source: 'meta_ads' }, null, true, 1]) {
    assert.throws(() => projectPaidImport(input, { ...context(), source }), /Invalid paid-media import evidence/);
  }
});
test('decimal conversion has no implicit rounding, coercion, FX or micros conversion', () => {
  for (const [amount, expected] of [['0', 0], ['0.01', 1], ['1.1', 110], ['1.23', 123], ['999999999999.99', 99999999999999]]) assert.equal(importedAmountToMinor(amount, 'USD'), expected);
  for (const amount of [null, undefined, 1.23, '', '1e2', '-1', 'NaN', 'Infinity', '01.20', ' 1.20', '1.234', '1000000000000']) assert.throws(() => importedAmountToMinor(amount, 'USD'));
  for (const currency of [null, '', 'usd', 'JPY', 'KWD', 'XXX']) assert.throws(() => importedAmountToMinor('1.23', currency));
});
test('retained/unknown timestamps remain visible without discarding old rows', () => {
  const input = raw(); input.rows[0].updated_at = null; input.rows[1].updated_at = '2039-12-01T00:00:00Z';
  const receipt = projectPaidImport(input, context());
  assert.equal(receipt.freshness.rowsWithoutRestatementTime, 1);
  assert.equal(receipt.freshness.latestRestatementAt, '2039-12-01T00:00:00Z');
  assert.equal(receipt.observations[0].spendMinor, 303);
  assert.equal(receipt.retainedKeysMayBeStale, true);
});
test('money aggregation rejects overflow instead of emitting rounded totals', () => {
  const input = raw();
  input.rows = Array.from({ length: 100 }, (_, n) => ({ ...input.rows[0], campaign_id: String(n + 1), ad_id: String(n + 1), spend: '999999999999.99' }));
  assert.throws(() => projectPaidImport(input, context()), /Invalid paid-media import evidence/);
});
test('context date cap, exact keys and unknown timezone are explicit', () => {
  for (const period of [{ start: '2040-01-01', endExclusive: '2040-03-01' }, { start: '2040-02-01', endExclusive: '2040-02-01' }]) assert.throws(() => projectPaidImport(raw(), { ...context(), period }));
  assert.throws(() => projectPaidImport(raw(), { ...context(), sourceTimezone: 'Invalid/Zone' }));
  const input = raw(), ctx = context(); input.sourceTimezone = ctx.sourceTimezone = null;
  assert.equal(projectPaidImport(input, ctx).sourceTimezone, null);
  assert.equal(comparePaidImports(input, input, ctx, ctx).status, 'not-comparable');
});
test('restated versions replace: differences are explicit, missing dates never zero', () => {
  const previous = raw(), current = raw(); current.rows[0].spend = '0.01';
  const result = comparePaidImports(previous, current, context(), context());
  assert.equal(result.status, 'different-observations');
  assert.equal(result.differences[0].spendMinor, -100);
  assert.equal(result.differences[1].spendMinor, null);
  assert.equal(result.reportReady, false);
  assert.equal(comparePaidImports(previous, previous, context(), context()).status, 'incomplete-observations');
});
test('mismatched ranges and currencies cannot be compared', () => {
  const other = raw(), ctx = context(); other.period.endExclusive = ctx.period.endExclusive = '2040-02-03';
  assert.equal(comparePaidImports(raw(), other, context(), ctx).status, 'not-comparable');
  other.period = { ...period }; ctx.period = { ...period }; other.currency = ctx.currency = 'EUR';
  other.rows.forEach(row => { row.meta_currency = 'EUR'; });
  assert.equal(comparePaidImports(raw(), other, context(), ctx).status, 'not-comparable');
});
test('matching complete observed days still do not approve reconciliation', () => {
  const input = raw(), ctx = context(); input.period.endExclusive = ctx.period.endExclusive = '2040-02-02';
  assert.deepEqual(comparePaidImports(input, input, ctx, ctx), { status: 'matching-observations', reportReady: false, differences: [{ date: period.start, spendMinor: 0, impressions: 0, clicks: 0 }] });
});
test('a paid observation receipt cannot populate business KPIs', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../examples/snapshot.demo.json', import.meta.url)));
  for (const source of snapshot.sources) { source.coverage.status = 'unverified'; source.reconciliation.status = 'pending'; }
  snapshot.metricInputs = {};
  snapshot.sourceObservations = [projectPaidImport(raw(), context())];
  assert.ok(Object.values(buildReport(snapshot).metrics).every(metric => metric.status === 'unavailable' && metric.value === null));
});
