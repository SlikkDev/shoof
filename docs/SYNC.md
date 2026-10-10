# Persisted observation reads

This interface runs one bounded read when a trusted private host calls it. It installs no scheduler, makes no network request itself, loads no credential and has no provider-specific binding. It is disabled unless `enabled: true` is passed. Tests use only fictional observations and temporary external storage.

```js
import { createObservationStore } from './src/observation-store.mjs';
import { runSyncTick, inspectSyncState } from './src/sync.mjs';

// Illustrative private-host wiring. These arguments must come from the host's
// verified configuration and existing authorized transport, not an HTTP body.
const store = await createObservationStore(verifiedPrivateDirectory);
const job = {
  id: 'website-observations', context: verifiedReadContext,
  intervalMs: 86400000, staleAfterMs: 2 * 86400000,
  maxPages: 5, maxRows: 1000
};
const result = await runSyncTick({
  enabled: true, job, store, transport: authorizedReadTransport,
  currentTenantId: verifiedCurrentTenant
});
const health = await inspectSyncState({job, store, currentTenantId: verifiedCurrentTenant});
```

The example is not an executable connector or a request to enable one. A separate owner decision must cover the principal, permitted data, private destination and recurrence. Calendar scheduling, daylight-saving handling, transport deadlines/cancellation and account authorization belong to that host. `intervalMs` is only the minimum delay from an attempt's completion until the next due tick. Missed ticks do not produce a catch-up burst. The host supplies the exact source-native date window on every tick.

## Stored state and failure behavior

Storage must already exist as an absolute, owner-only directory outside the code repository. State files are owner-only, bounded to 8 MiB, written to a temporary file, flushed and atomically renamed. The runtime owner must control the directory and its ancestors. This is a single-host local store, not an authenticated shared service or distributed database. Files are not encrypted by this module; use the private host's storage and backup controls.

Each job is keyed by tenant, source and job ID. Account and metric allowlists and source timezone are bound to that job; a changed scope requires a new job ID. A complete successful read replaces that job's latest observation batch. Rolling periods are labelled explicitly and are never appended, merged or zero-filled. Old batches are not an archive. If provenance history is required, implement it in private storage before relying on it for an audit.

State includes the latest attempt, next due timestamp, and latest successful normalized observations. Unknown payload/context fields, provider error text and credentials are not persisted. Partial pages, duplicates, row/page limit exhaustion and tenant changes detected before commit cannot replace the last good observations. Failures record only a generic error code. A failed read does not advance the success timestamp. A storage failure throws and must not be reported as success.

The tick rechecks tenant scope after collection and supplies a synchronous `shouldCommit` guard to the store. The store checks it before preparing the write and again immediately before dispatching the atomic rename; returning anything except `true` discards that candidate and returns `false`. The tick then records a failed attempt while retaining the previous successful observations and timestamp. This guarded replacement is the commit boundary. A tenant change after it suppresses the response but does not retroactively invalidate an already accepted snapshot. Custom transaction implementations must honor the same guard/boolean-result contract. The runtime must not expose job health to a different tenant.

An exclusive directory lock prevents overlapping processes from reading the same job concurrently. A process crash can leave a lock or a `running` attempt. The interface never steals a lock or automatically retries an unfinished attempt. A trusted operator must confirm the old process is stopped, preserve the last good state, and explicitly recover or reset that private job. Corrupt or cross-scope state is rejected without overwriting it. Filesystem atomic rename protects against partial file replacement; this is not a power-loss durability guarantee.

## Health is not completeness

| Field | Meaning |
|---|---|
| `lastAttemptStatus` | Never, running, success or failed |
| `lastSuccessAt` | Local completion time of the last accepted read |
| `readFreshness` | Unknown with no successful read; fresh/stale against `staleAfterMs` |
| `sourceFreshness` | Always unknown here; requires separately verified upstream metadata |
| `observationPeriod` | Exact window of the retained successful batch, including after failure |
| `rowCount`, `observedDays` | Observed rows/dates only; an empty response creates no zero-valued metrics |
| `coverage`, `reconciliation`, `reportReady` | Always unverified, pending and false in this interface |

A recent read can contain old or incomplete source data. The metric engine's existing evidence gates remain independent. No business KPI is populated by this sync state, and no raw state endpoint or browser exposure is added. The host must still enforce read-only operations: passing `kind: read-observations` is not a provider authorization mechanism.
