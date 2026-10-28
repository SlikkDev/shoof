# Reading existing Google Ads imports

This opt-in command reads oToK's restricted imported-observations endpoint once.
It reuses oToK's vendor sync; it does not connect to Google, create credentials,
configure an OAuth grant, install a schedule, or populate business KPIs.
Manual exports are not a prerequisite. The endpoint and caller must both be
reviewed and deployed before activation, with exact private account mapping.

## Private host inputs

All input files must be owner-only, outside the source checkout, and under
runtime-owner-controlled parent directories. Use the existing protected secret
provisioning mechanism; never paste tokens into chat, command arguments or Git.
`REPORTING_GOOGLE_ADS_TOKEN_FILE` names a JSON object with only a `token` field.
That token must have an immutable Google Ads reporting policy, one workspace,
one customer, an approved member and an explicitly approved lifetime. It cannot
be a broad member/OAuth token. The server remains the authorization boundary.

`REPORTING_GOOGLE_ADS_CONFIG_FILE` names this shape (independently fictional):

```json
{
  "origin": "https://reporting.example.test",
  "workspaceId": "fictional-workspace",
  "customerId": "9001002003",
  "currency": "EUR",
  "sourceTimezone": "Europe/Paris",
  "jobId": "fictional-ads-reader",
  "completedDays": 2,
  "intervalMs": 86400000,
  "staleAfterMs": 172800000
}
```

Use either `completedDays` (1–31, requiring a verified IANA source timezone) or
`period:{start,endExclusive}` for fixed source-native dates, never both. A null
source timezone is permitted only with fixed dates and must match the receipt.
The rolling form ends at today's source-account date, excluding the current day.
Currency is explicit, never inferred from the workspace. The workspace must match
`REPORTING_TENANT_FILE`; `REPORTING_STATE_DIR` contains the existing accepted
report plus reader job state and receipts, not authentication configuration.

With those private paths supplied, the explicitly authorized host invokes:

```sh
REPORTING_GOOGLE_ADS_ENABLED=true node tools/read-google-ads.mjs
```

No default origin, tenant, account or token is built in. A timer is not installed.
`intervalMs` prevents repeat calls before the persisted due time; it does not
schedule them. Recurrence requires its own owner decision about frequency,
window, account, destination, lifetime, failure handling and retention. Use one
job ID per immutable account/currency/timezone configuration. Changing a job ID
is not a way to evade a busy or unfinished attempt.

## Receipt and publication

Exactly one POST goes to `/api/reports/observations/read`, with a 15-second
abort deadline, 1 MiB response cap, no redirect or retry, an exact period and
workspace header. The token never enters response data, job state or logs.
The reader accepts at most 31 daily spend/click/impression buckets, containing
at most 10,000 imported campaign/day rows. It checks customer/workspace,
currency, timezone, missing dates, import window, counts and timestamp histogram.
Spend uses safe integer minor units; missing dates remain absent, never zero.
The receipt explicitly says retained campaign keys may be stale and aggregation
is imported campaign/day sums, not native account totals. Source freshness and
read freshness are distinct; coverage remains unverified and reconciliation
pending. Old metadata without customer, generation and window stamps is refused until oToK's next ordinary
successful sync. Dates outside the latest completed window are refused.

A validated receipt is archived by content hash in private storage before
publication. `recordSourceRead` changes only this source's observations and
attempt health under the existing report lock. Other sources, report KPIs,
report date, login/session state and authentication files are preserved. A failed
read updates sanitized failure health and retains the previous accepted evidence.
Recent reads of stale imports stay visibly stale. This does not certify any of
the ten business KPIs, including total paid spend across all required sources.

The job lock covers the network read, receipt archive and source publication.
Only after publication succeeds is the completed job state persisted. A crash or
storage/publication error leaves a `running` marker and subsequent invocations
return `recovery-required` without reading again. The report and job files are
separate atomic commits, not a cross-file transaction: after a late failure the
report may already contain the new accepted source while the job is unfinished.
Inspect both accepted report and receipt before recovery; never delete the marker
and blindly retry. An operator can reconcile/retire that attempt after confirming
whether publication occurred. Stop the caller before such recovery.

## Rollout and rollback

1. Review exact source commits and fixture provenance; pass local checks and CI.
2. Deploy the reviewed oToK/Shoof versions through the existing project workflow.
   No credentials, source writes or schedules are part of that source promotion.
3. Read-only verify the existing pinned workspace/customer mapping, currency,
   timezone and completed import window. No vendor reconnect is needed if the
   existing importer is healthy. Do not change the pin to make a test pass.
4. Obtain action-time approval for creating/configuring the restricted reader
   token: member, workspace, customer, supported lifetime, secure destination,
   and one initial bounded read. Its server scope allows **any 1–31-day period
   within the latest completed import window**, not only initial probe dates.
5. Provision the token through approved private secret entry, invoke once and
   verify receipt, durable readback, unchanged other sources and unavailable KPI
   labels. Reconcile identical scopes; never force campaign sums to equal a native
   account total. Decide about recurrence separately after this check.

Rollback first stops the caller. Reverting application code must retain current
report/job/receipt and login state; do not restore an old data volume. Token
revocation is a separate authorized action. Never erase newer evidence to make
an older backup or expected digest match. The paused manual snapshot need not be
imported to activate this path.

Meta needs a separately restricted imported-table reader (ad level, account,
date and currency). CRM leads, won-sale cohorts, settled cash/refunds and paid
attribution need their own agreed event definitions, source completeness and
reconciliation. A provider charge diagnostic does not establish settled cash.
