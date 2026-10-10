# Protected reporting runtime

The runtime is a single-tenant, read-only HTTP service. It does not create an Access application, select an identity provider, deploy itself, create credentials or read a marketing API. Keep source configuration and private evidence outside Git, static output and image layers.

## Authentication and configuration

Configure an existing Cloudflare Access self-hosted application for the exact public hostname and every path. Allow only the intended viewer identities; do not create bypass policies. The runtime independently verifies the signed `Cf-Access-Jwt-Assertion` at the origin using `jose`, restricted to RS256, configured issuer/audience, required expiration/issued-at/subject/email/type claims, and an exact email allowlist. It ignores forwarded email/host headers. This prevents a direct-origin request from bypassing login. No Access service-token login is supported.

Public signing keys are fetched only from the configured `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` endpoint. Redirects are rejected, response size is limited to 64 KiB, and the fetch deadline includes the body. The key cache lasts ten minutes with a thirty-second rotation-fetch cooldown. A known cached signing key remains usable within that window during an outage; absent/expired keys fail closed. Tokens are never logged, persisted or sent to a provider. Access session duration/revocation is owned by the identity provider; valid issued tokens remain accepted until expiration, so revocation is not instantaneous at a directly reachable origin. Keep sessions short and restrict origin exposure operationally.

Required environment:

| Name | Purpose |
| --- | --- |
| `REPORTING_ACCESS_ISSUER` | Exact HTTPS Access team origin, without trailing slash |
| `REPORTING_ACCESS_AUDIENCE` | Exact application audience; no token-derived configuration |
| `REPORTING_PUBLIC_HOST` | Lowercase hostname only, without scheme or port |
| `REPORTING_VIEWER_EMAILS` | Comma-separated exact email addresses; at most twenty |
| `REPORTING_TENANT_FILE` | Absolute path to an owner-only external tenant JSON, mode `private` |
| `REPORTING_STATE_DIR` | Existing owner-only external directory for accepted presentation state |

Optional listener settings: `REPORTING_PORT` defaults to 8080; `REPORTING_BIND` defaults to loopback. The Docker image explicitly binds `0.0.0.0` inside its container. It runs as `node` (UID 1000); publish no host port when using the existing container proxy network. A missing/malformed configuration refuses startup. Runtime tenant and viewer configuration are fixed for the process lifetime; changing them requires restarting only this service.

All UI/assets/report paths require both the configured Host and a valid assertion. Only GET/HEAD are accepted. `/api/report` accepts no query selectors and projects presentation fields only. No generic file, export, token, import or sync HTTP endpoint exists. The only unauthenticated route is content-free `/healthz` when the actual TCP peer and Host are container loopback; forwarded headers cannot qualify. Configure the container healthcheck here, not against a private report or a fictional-data string.

See [Cloudflare token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [jose](https://github.com/panva/jose).

## Durable imports

Mount tenant/input files read-only outside `/app`, mode 0600 and owned by the runtime UID. Mount a separate named volume at `/var/lib/shoof` (the image's default state directory), mode 0700 and owned by UID 1000. For bind mounts, an operator must provision those ownership/permission settings explicitly. Do not mount state under the web root. The runtime supports a read-only container root filesystem, with only the state mount writable. Parent directories must remain controlled by the operator.

Run `npm run import:report` locally in the protected runtime environment with two additional explicit paths:

- `REPORTING_SNAPSHOT_FILE`: the existing business snapshot schema shown by `examples/snapshot.demo.json`, with matching tenant/workspace/timezone/currency and honest coverage/reconciliation evidence.
- `REPORTING_OBSERVATIONS_FILE`: optional dated-observation envelope below. Omission deliberately publishes an empty observation list; each import replaces the whole presentation, not an incremental merge.

The command performs no network request. It runs the metric evidence gates, validates source observations and publishes only their projected presentation. Raw snapshot extras, customer rows, evidence references and account IDs are not copied to the serving store. Invalid, oversized, duplicate, cross-tenant, future-dated or older business-report candidates fail before replacement. Successful replacement uses the existing exclusive lock, owner-only temporary file, fsync and atomic rename. A concurrent operation can return busy; retry later rather than deleting its lock. A crash can leave a lock; preserve state and confirm the old process is stopped before operator recovery. A corrupt state fails closed and is not overwritten automatically. There is no browser rollback/edit API.

No state means `/api/report` returns 503, never demo substitute data. A rejected import leaves the previous report and its accepted timestamp unchanged. Restarting the HTTP process reads the same mounted state. Data stored only in the container filesystem will not survive replacement; mount configuration and backups remain deployment responsibilities. Keep an owner-controlled backup outside the web root before an import; restoring a prior state file requires a deliberate operator recovery, not re-importing an older snapshot. The atomic file store is single-host storage, not a distributed or power-loss durability guarantee. See [Coolify storage](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview).

## Dated observation envelope

The following is wholly fictional and does not create a source connection:

```json
{
  "schemaVersion": 1,
  "tenantId": "fictional-harbor",
  "workspaceId": "demo-workspace",
  "sources": [{
    "sourceId": "ga4",
    "period": {"start": "2025-01-01", "endExclusive": "2025-01-03"},
    "observedAt": "2025-01-04T12:00:00Z",
    "origin": "ui-snapshot",
    "sourceTimezone": null,
    "lastSuccessfulReadAt": null,
    "metrics": [{
      "key": "sessions", "label": "Sessions", "unit": "count",
      "values": [{"date": "2025-01-01", "value": 7}]
    }]
  }]
}
```

Source IDs must exist in the business snapshot. Periods are half-open and source-native, at most 366 days; missing timezone remains null. Each metric has unique dated nonnegative integer values, with units `count` or `seconds`; no currency/ratio inference is provided. An empty list has unavailable total, not zero. Only listed dates contribute. Unknown fields are stripped. Limits: 25 sources, twelve metrics per source and 366 values per metric.

`origin` is `manual`, `ui-snapshot` or `synced`. Only `synced` may carry a `lastSuccessfulReadAt`, and must provide it; this label is an operator assertion backed by the input's evidence, not proof that this runtime executed a read. Source observations always retain unverified coverage, pending reconciliation and `reportReady: false`. They cannot populate business KPIs. UI separates observation period, observation timestamp, read freshness and local save time. The fixed 48-hour recent/stale threshold is a display heuristic, not a coverage rule or provider-specific SLA. A future evidence timestamp is unknown on read; importing it is rejected.

The existing `runSyncTick` remains disabled by default and separate from presentation publication. A future trusted adapter must use an explicitly authorized scoped transport, verify source-native timezones, normalize only allowed aggregate metrics and produce this envelope. It may then call `publish` locally. No scheduling, source credential loader or broad-token fallback is provided here. The viewer's Access assertion is never an upstream data credential.

## Deployment and review sequence

1. Review the generic PR and its tests; pin the reviewed image/commit. Keep all build inputs fictional. `npm ci --ignore-scripts`, tests, syntax/build/privacy checks run in CI, followed by an isolated container build and fictional mounted-state smoke test.
2. Obtain the separate approval for the access gate and audience, and any identity-provider enrollment. Configure the all-path Access policy, then supply issuer/audience/allowlist externally. No paid plan or grant is implicit in these instructions.
3. Deploy this runtime only, provision its private input/state mounts and use the content-free healthcheck. Do not restart a shared proxy or another application. Keep the old static deployment available for rollback, without any private input baked into it.
4. Before importing real data, verify anonymous denial on UI, assets and report routes, missing/forged/expired/wrong-audience token denial directly at the origin, and successful access for the approved viewer. Verify an unauthorized viewer is denied and there is no bypass route or public volume mount.
5. Import a reviewed dated seed using the local command. Verify exact source/date/totals and unavailable business gates through authenticated UI. Restart/redeploy this service and verify the state survives its mount. Backups and restore must be tested separately before operational reliance.
6. Enable no source read until its independent reader scope/recurrence is approved. On authentication failure, stop private service or restore a known protected version; never fall back to public private-data files. On data-import failure, keep the last good state and investigate.

`npm run qa:runtime` starts a loopback-only fictional gateway with in-memory generated test keys, allowing browser layout review without an actual identity provider. It is excluded from the Docker build context/image. It does not test real Cloudflare login; that requires the approved deployed gate. CI's container probe checks private mounted import, anonymous origin denial, read-only root and restart persistence; JWT claim/signature tests use generated keys independently.
