# Connecting observations to reporting

Start with an existing authorized source/runtime. The injected interface deliberately contains no login flow, private API route, token loader, mutation or scheduled job. Connector owners enforce permitted read operations; the local contract validates returned scope and strips unapproved fields.

1. Verify tenant and source identities and the existing principal's accessible scope. Source status and sync logs establish activity only; they cannot populate performance metrics.
2. Reuse existing paid-ad and website imports first. Normalize one non-overlapping account/day grain, preserving currency and source timezone. Prefer exact-date reads; a trailing aggregate cannot be relabelled as a historical month. Prove daily coverage and reconcile against authoritative totals.
3. Read canonical CRM enquiries, confirmed sales, settled cash/refunds and allocations in the private owner runtime. Exclude tests/spam/duplicates; retain stable private IDs for joins. Sales, payment schedules, recognized accounting amounts and posted cash are different measures. Pass only approved aggregates/normalized inputs to the reporting layer.
4. Add search and organic content through existing permitted analytics access. If access is unverified, use clearly dated manual platform reports for search, video, social and podcast observations. Preserve exact definitions/units, native timezones and provenance; do not infer organic analytics access from a paid-ad connection. Reach is not additive across platforms, period users are not a sum of daily users, and platform conversion is not a CRM sale.
5. Add email and messaging delivery/cost data from verified send ledgers. Contact/template imports are not delivery evidence.
6. Release independently proven cards for the latest complete overlapping period. Funnel ratios additionally need matched populations, attribution approval and mature cohorts. Missing data remains unavailable.

## Read contract

A caller supplies `{tenantId,sourceId,accountIds,metricKeys,period,timezone}`, a `currentTenantId` function and an existing read transport. Each request has kind `read-observations`, bounded pagination and no mutation command. Returned pages must match tenant/source/timezone, use approved accounts and dates, and contain explicit numeric or null values for every requested metric. Unknown payload fields are removed. Duplicate identities, partial pages, repeated cursors and tenant switches reject the batch.

`paginationExhausted: true` is not `coverage: complete`. Observed dates alone cannot distinguish missing events from verified zero activity. Store coverage/reconciliation evidence separately, at the exact account/date/grain scope. The current helper returns `coverage: unverified` even for an empty complete response.

The manual helper accepts the same aggregate rows plus version 1, `origin: manual`, exported timestamp, exact period, source units and a final null cursor. It hashes the original input and returns only normalized fields. It does not import arbitrary provider CSV formats, certify source definitions, create metric-input mappings or upload anything.

## Remaining implementation

Production connector bindings, private persistence, coverage verification, source-specific CSV parsing, CRM canonicalization, paid attribution and authorization for multi-user hosting remain outside this local foundation. The mock contract and tests can be developed before selecting a remote Git repository. Do not connect new accounts merely because a platform is listed in the demo.
