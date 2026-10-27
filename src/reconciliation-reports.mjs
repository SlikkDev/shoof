// Unsaved definitions for oToK's existing permission-checked /api/reports/run.
// This module never calls that route and confers no account or field access.
import { daysInPeriod } from './model.mjs';

export function buildReconciliationReports(period) {
  const days = daysInPeriod(period);
  if (days.length > 31) throw new Error('Reconciliation requires a fixed window of at most 31 days');
  const dateRange = { kind: 'fixed', from: days[0], to: days.at(-1) }; // oToK end is inclusive.
  const specs = [
    ['inquiry-status', 'inquiries', 'created_at', 'status', ['count']],
    ['sale-status', 'sales', 'sold_at', 'status', ['count', 'count_active', 'count_cancelled']],
    ['recognized-ledger', 'payment_entries', 'recognized_at', 'kind', ['count', 'sum_recognized', 'count_refunds']],
  ];
  const reports = specs.map(([id, dataset, dateField, field, measures]) => ({
    id, executed: false, coverage: 'unverified', businessKpiInput: false,
    definition: { version: 2, dataset, dateField, dateRange: { ...dateRange }, currencyMode: 'breakdown',
      shape: { kind: 'summary', groupBy: { field }, measures: measures.map(key => ({ key })), chart: { type: 'table' }, groupLimit: 50 } },
  }));
  const tables = [
    ['inquiry-rows', 'inquiries', 'created_at', ['created_at', 'contact_id', 'source', 'status']],
    ['sale-rows', 'sales', 'sold_at', ['contact_id', 'sold_at', 'status', 'settlement_status', 'expects_payment', 'currency', 'total_amount', 'paid_total', 'refunded_total', 'pending_refund_total', 'has_unpriced_lines']],
    ['recognized-ledger-rows', 'payment_entries', 'recognized_at', ['payment_id', 'contact_id', 'kind', 'status', 'amount', 'currency', 'paid_at', 'recognized_at', 'recognized_amount', 'refunds_entry_id', 'is_void', 'recorded_outside']],
  ];
  for (const [id, dataset, dateField, columns] of tables) reports.push({
    id, executed: false, coverage: 'unverified', businessKpiInput: false,
    definition: { version: 2, dataset, dateField, dateRange: { ...dateRange }, currencyMode: 'breakdown',
      // The engine returns row identity separately and adds its own ID tie-break.
      // `id` is not a selectable/sortable column in the public report catalog.
      shape: { kind: 'table', columns, sort: [{ by: dateField, dir: 'asc' }], page: { size: 100, offset: 0 } } },
  });
  return reports;
}
