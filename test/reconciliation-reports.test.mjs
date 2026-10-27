import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconciliationReports } from '../src/reconciliation-reports.mjs';

test('fixed month maps half-open bounds to inclusive report dates without execution', () => {
  // Fictional leap month exercises the date boundary, independently of clients.
  const reports = buildReconciliationReports({ start: '2040-02-01', endExclusive: '2040-03-01' });
  assert.equal(reports.length, 6);
  for (const report of reports) {
    assert.equal(report.executed, false); assert.equal(report.businessKpiInput, false); assert.equal(report.coverage, 'unverified');
    assert.deepEqual(report.definition.dateRange, { kind: 'fixed', from: '2040-02-01', to: '2040-02-29' });
    assert.equal(report.definition.currencyMode, 'breakdown');
    assert.equal(report.definition.version, 2);
    if (report.definition.shape.kind === 'table') {
      assert.deepEqual(report.definition.shape.page, { size: 100, offset: 0 });
      assert.ok(report.definition.shape.columns.every(column => !/name|email|phone|note|snapshot|provider|terminal/.test(column)));
    }
  }
  const ledger = reports.find(report => report.id === 'recognized-ledger');
  assert.equal(ledger.definition.dateField, 'recognized_at');
  assert.deepEqual(ledger.definition.shape.measures.map(x => x.key), ['count', 'sum_recognized', 'count_refunds']);
});
test('definition preparation refuses unbounded, impossible and oversized windows', () => {
  for (const period of [null, {}, { start: '2040-02-30', endExclusive: '2040-03-01' }, { start: '2040-01-01', endExclusive: '2040-04-01' }]) assert.throws(() => buildReconciliationReports(period));
});
