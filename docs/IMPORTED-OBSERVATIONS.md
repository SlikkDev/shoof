# Imported observation receipts

The pure `ga-observations.mjs` adapter validates the bounded oToK GA4 observation
response without handling a host, credential or network request. Workspace,
property, exact native period, aggregation, row budget, exhausted response,
missing dates and restatement timestamp counts must agree. The only accepted
measures are sessions and engaged sessions. Property timezone is explicitly null
(unverified); the generic injected-read contract now preserves that value.

A trusted private caller can feed the resulting daily rows through `runSyncTick`
and publish one validated result using `recordSourceRead`. Both use the existing
private observation store. `recordSourceRead` locks and atomically replaces that
source's observation and updates the attempt receipt. Failed reads update only
sanitized health and preserve previous evidence and successful-read time. Late,
future, tenant-mismatched and malformed publications fail closed. A current-tenant
callback is rechecked at the final write boundary. There is no HTTP write route,
source credential loader, network connector or scheduler in Shoof.

The UI shows recorded origin/read time, latest attempt status, import completion,
restatement time, stale state and the unknown-coverage warning. It does not infer
recurrence from a saved successful read. Historical UI/manual snapshots retain
their original provenance. Observation periods differing from the report period
are labelled non-comparable; values never release acquisition/business KPIs.

Separate reads replace displayed values; they are never summed. The private
caller must archive each validated dated receipt outside the repository before
publishing, including its private account scope and timestamp histogram. That is
the historical evidence store; the displayed report remains the latest accepted
view. Import completion and a recent read do not certify upstream completeness.
The existing importer may retain older dimension keys: those rows remain included.

Activation requires reviewed server support plus the owner's concrete approval
of the identified member, exact account/workspace policy, lifetime and private
secret destination. Use a fixed-period probe first. Native timezone and source
completeness/reconciliation must be reviewed before completed-day recurrence.
No production read, credential, grant, deployment or schedule is enabled here.
Paid media still needs separate server policy/projections. Manual source
diagnostics may use `unit: 'currency-minor'` with an explicit per-metric
`currency` of USD, EUR, GBP or ILS. Values and totals remain nonnegative safe
integer minor units; unsupported currencies are refused. Display retains both
fractional digits, including at the safe-integer boundary, and never converts
between currencies or borrows the report currency. Missing dates remain absent;
an empty series has an unavailable total. Do not encode monetary values as counts.

An optional source `note` (at most 600 characters) can explain a diagnostic's
dated basis and exclusions. It is escaped when rendered. Supply only reviewed
explanatory text, without customer data, account identifiers, evidence URLs or
credentials. A provider-charge diagnostic must state that it is not settled
cash; reference matching does not establish current ledger balances, sale
allocation or attribution. Use origin `manual`, the evidence's actual observed
time and a null successful-read time. File preparation is not a source read.

These observations appear beneath the report as dated evidence. They cannot
change any business KPI, source readiness, coverage or reconciliation gate.
Private import preparation must preserve other observations and the existing
snapshot; verify the live baseline again before applying a prepared package.
No HTTP upload route, credential entry form or scheduler is added.

Deploy reviewed code before importing a monetary observation: older runtimes
reject the new unit. After import, rollback requires a compatible runtime or a
reviewed report-only removal of that observation that preserves newer evidence.
Never restore authentication state or an obsolete report backup blindly.
