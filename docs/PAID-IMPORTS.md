# Paid import preparation

`src/paid-observations.mjs` is a pure, offline adapter for projected rows from
oToK's existing warehouse. It does not expose an endpoint, run SQL, fetch a
vendor, load credentials, broaden an agent token, publish observations, or
populate business KPIs. Currency-aware display/publication and a separately
authorized producer are still required. The GA4 token cannot read paid media.

## Projection contract

| Source | Stored fields | Required grain and identity |
| --- | --- | --- |
| Meta | `meta_ads_daily_stats.spend`, `meta_currency`, `impressions`, `clicks`, `updated_at` | Workspace + exact `ad_account_id` + date + `level = ad` + `campaign_id` + `ad_id` |
| Google | `google_ads_daily_stats.cost`, `google_currency`, `impressions`, `clicks`, `updated_at` | Workspace + exact `customer_id` + date + `campaign_id` |

Both amounts are stored as `NUMERIC(14,2)` major units. The private producer
must select `spend::text` / `cost::text` to preserve exact decimals. Google cost
has already been converted from vendor micros and rounded to the warehouse
scale; the adapter cannot recover that discarded precision. No FX conversion
or additional rounding is performed. The reviewed currency allowlist is USD,
EUR, GBP and ILS, all using two decimal places. Unknown currency is refused.
Zero/three-decimal currencies need a separate reviewed storage contract.

The exact raw-envelope and row keys are enforced in `projectPaidImport`.
Pass one source/account/currency, explicit workspace, half-open period of at
most 31 days, source timezone or explicit null, read/completion timestamps, a
stable completed-import snapshot receipt, at most 1,000 rows, exhausted=true
and nextCursor=null. Normalize source timestamps to ISO UTC; preserve null
restatement times. Project only the listed columns plus row identities: labels,
raw errors, credentials, customer fields and additional payload keys fail closed.

The producer must prove account authorization, a stable database snapshot and
completed, error-free metadata around the read. Equal caller-supplied version
strings alone do not prove atomicity. A future server reader must enforce this
and its narrower policy/date limits itself. The offline 31-day limit grants no
production access. Retrieve a sentinel beyond the cap and reject truncation;
never describe the first page as exhausted or silently merge separate versions.

Meta campaign-level rows are refused because the warehouse also contains ad
rows for the same spend. Duplicate import keys fail rather than being summed.
All rows at the selected grain remain, including older retained keys. Daily
amounts use safe integer minor units with explicit currency. Missing days stay
absent; a present zero is distinct from no evidence. Import completion and
exhausted pagination do not establish vendor coverage or native reconciliation.

`comparePaidImports` validates both exports and compares only identical source,
workspace, account, date range, known timezone and currency. It reports deltas
between versions, never their sum. Even identical versions return
`reportReady: false`; this is not independent native-platform reconciliation.
Failed calls throw before producing output and cannot overwrite an existing
report. Wiring durable publication/retention is a separate change.

## KPI input mapping

All ten metrics require complete, reconciled inputs for the same approved
workspace, identities, dates, timezone and currency. These mappings identify
candidate evidence, not an assertion that those private inputs exist.

| Shoof metric | Candidate oToK evidence | Definition/evidence still needed |
| --- | --- | --- |
| `mediaSpend` | Ad-level Meta `spend`; campaign-level Google `cost` | Authorized exact accounts, daily coverage, native account reconciliation, stored-precision check; no overlapping levels |
| `validLeads` | `inquiries.id`, `created_at`, `contact_id`, `source`, `status`; intake `dedup_key` in schema | Validity and cross-channel canonical lead policy. Intake-event idempotence does not deduplicate a person across different events; dismissed/resolved statuses alone do not define validity |
| `confirmedSales` | `sales.id`, `sold_at`, `status`, `settlement_status`, `expects_payment`, `has_unpriced_lines` | Sign-off on active/partially_cancelled/cancelled and mirrored/untracked records. `count_active` is not automatically confirmed-sales count |
| `netCollected` | `contact_payment_entries.id`, `payment_id`, `contact_id`, `kind`, `status`, `amount`, `currency`, `paid_at`, `refunds_entry_id`, `is_void`, `recorded_outside` | Verified capture/settlement date and provenance, refund/chargeback coverage and VAT treatment; deduplicate payment events, exclude voided non-captures |
| `paidLeads` | Canonical enquiry IDs plus approved paid-source touchpoint/cohort map | Attribution model, window, eligible source/account mapping and deduplication; platform conversion counts are not canonical leads |
| `newCustomers` | Canonical buyer identity, payment entries and `sale_payment_allocations` | Buyer may differ from payer. Prove first payment using sufficient earlier history, approved attribution and mature cohort; a bounded-month export cannot establish first-ever customer |
| `paidCohortCash` | Matched payment entries and allocation `sale_id`, `payment_entry_id`, signed `amount` | Complete 30-day post-lead window, correct refunds/chargebacks and allocation bounds, cohort attribution and business approval |
| `mediaCpl` | `mediaSpend / paidLeads` | Both approved inputs on the same basis; zero denominator is unavailable |
| `mediaCac` | `mediaSpend / newCustomers` | Same scope and approved matured customer cohort; zero denominator is unavailable |
| `cashRoas` | `paidCohortCash / mediaSpend` | Same currency/cohort basis, mature cash window and business approval; zero denominator is unavailable |

The `payment_entries` report called “Collected revenue” is a **recognition**
ledger. Its baseline includes only `recognized_at IS NOT NULL AND <= now()`.
Installments can recognize immediately at purchase; due dates are not cash
dates. Refund entries have signed negative amounts. Neither `sum_recognized`
nor sale-level `paid_total` grouped by `sold_at` proves cash collected in that
reporting window. The prepared ledger reports cannot inventory excluded,
unrecognized entries or establish provider settlement/chargeback completeness.
Provider reference fields have stronger field permissions and are intentionally
not requested here. Do not broaden access to fill those gaps automatically.

## Bounded existing reports

`buildReconciliationReports(period)` prepares six unsaved definitions: enquiry
status/rows, sale status/rows, and recognized-ledger kind/rows. It converts the
half-open Shoof range to oToK's inclusive fixed dates, bounds it to 31 days,
uses currency breakdown rather than FX, and requests a first page of 100 rows.
The engine includes root `id` itself and an ID sorting tie-break; `id` is not a
selectable column. No names, email, phone, notes or raw snapshots are requested.

Execution still requires the existing authenticated member's live permissions,
plan features and record/field access: enquiries (`inquiries:read`,
`inquiry_queue`), sales (`sales:read`, `sales`) and payment entries
(`payments:read`, `payments`). Money fields may be separately refused. A
summary-only payment viewer is not authorized for the row report. Retain the
executed definition and its dateRange alongside returned `meta.refusedColumns`,
warnings, generatedAt, timezone, summary truncation and table page total.
Empty results, filtered access,
omitted fields and incomplete pagination cannot become zero KPIs. Offset pages
are not an atomic export; stable-snapshot reconciliation remains required.

The definitions are preparation only (`executed: false`, `coverage:
unverified`, `businessKpiInput: false`). They are not saved reports, automatic
feeds, or cash/lead transformations. Use authorized private exports for review,
and keep all real identities and values outside this repository.
