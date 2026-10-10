# Protected reporting runtime

Shoof has a built-in email/password login for one owner. There is no public signup, email delivery, social login or external identity-provider setup. The single-tenant reporting runtime, private imports and persistent presentation store remain separate from the fictional static demo. No source-reader credential or automatic marketing connection is created by signing in.

## One-time owner setup

Provide these runtime variables through the existing private host configuration:

| Name | Purpose |
| --- | --- |
| `REPORTING_PUBLIC_HOST` | Exact lowercase HTTPS hostname, with no scheme, path or port |
| `REPORTING_TENANT_FILE` | Absolute external owner-only tenant JSON, mode `private` |
| `REPORTING_STATE_DIR` | Existing external owner-only directory for authentication and report state |

`REPORTING_PORT` defaults to 8080 and `REPORTING_BIND` to loopback. The container binds `0.0.0.0` internally. Keep the existing HTTPS reverse proxy and publish no application host port. HTTPS is required; the application trusts neither forwarded host/IP/identity headers nor old Access assertions. The former Access issuer/audience/viewer settings are no longer used.

After the owner approves account creation, run this **in a private interactive terminal** with the runtime environment and state volume mounted:

```sh
npm run auth:setup
```

The owner enters an email and a password twice; password entry is hidden. Use 15–128 characters (at most 512 UTF-8 bytes), preferably a unique password-manager passphrase. Passwords are not accepted in arguments, environment variables or piped input. Do not send them in chat or put them in Git. Existing accounts cannot be overwritten by this command. With no owner set up, sign-in is unavailable; the browser cannot create the account. No mail service or email verification is implied: the operator establishes the owner's identity.

Forgotten password, suspected session theft, or a deliberate owner-email change uses the same private operator path:

```sh
npm run auth:setup -- --reset
```

This requires typing `RESET`, a new email/password, and confirmation. It revokes every session and clears the login-attempt budget. Never run it without the owner's authorization. There is no password-reset email, browser account-management endpoint, second account or role hierarchy.

## Authentication boundaries

- The pinned `@node-rs/argon2` library hashes passwords with Argon2id, 19 MiB memory, two iterations, parallelism one, a random 16-byte salt and 32-byte output. Stored hash parameters are validated before verification; corrupt state cannot select an unbounded hash cost. The pinned `cookie` package handles serialization/parsing, and `read` provides hidden terminal input. No custom password hashing is implemented.
- Each login creates a fresh opaque 256-bit random session. Only its SHA-256 digest is persisted. The `__Host-shoof` cookie is host-only, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, with an absolute eight-hour expiry. It is never put in localStorage, URLs, logs or report responses. Login replaces the current browser session; at most ten sessions remain, evicting the oldest when full.
- Every private request checks current server-side state. Sign-out revokes that session; an operator password reset revokes all sessions immediately for subsequent authorization checks, without a process restart. Sessions and revocations survive restarts through the private mounted store. Already-authorized in-flight reads may finish. Rolling back an authentication backup can restore old credentials/sessions; reset the owner after restoring storage and before serving traffic.
- Login and logout accept only POST JSON with the fixed AJAX header `X-Shoof-Request: 1` and exact configured HTTPS `Origin`. Cross-site/same-site Fetch Metadata values are rejected; CORS is never enabled. This implements the [OWASP custom-header CSRF pattern](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi), with Origin and cookie defenses as well. No GET changes authentication state. Do not add cross-origin callers or HTML-form fallbacks without revisiting this boundary.
- All usernames share a durable limit of ten password checks per fifteen minutes. A changed username, IP header or process restart cannot reset it. Successful attempts also consume the budget. Existing sessions remain usable while login is limited. This deliberately simple single-owner policy can let an attacker delay new sign-ins; the budget recovers automatically and authorized terminal reset is available. No distributed/per-IP limiter or trusted-proxy setup is required.
- One login body/hash runs at a time per process; the existing store lock also serializes hashes across processes. Parallel attempts receive a retry response. Bodies are capped at 2 KiB, passwords at 512 UTF-8 bytes, and login processing has a five-second connection deadline. HTTP headers and connections are bounded. No password, raw token or user-supplied error is logged.

Only `/login`, `/login.css` and `/login.mjs` are public, containing generic Shoof UI and no tenant identity/data. Anonymous `/` redirects to `/login`; private assets and `/api/report` return 401. `/api/login` and `/api/logout` are the only HTTP mutations. The report/data routes remain read-only and exact, with no tenant selector, file download, import or sync route. Authentication/store errors fail closed. Missing report state returns 503, never fictional substitute data.

The content-free `/healthz` exception still requires the actual container-loopback TCP peer and loopback Host. Configure healthchecks there; forwarded headers cannot qualify. Public responses use no-store/noindex, CSP, nosniff and HSTS. Reverse-proxy access logs must omit request bodies/cookies and protect server logs. Use HTTPS redirect at the proxy; do not expose the internal HTTP port.

## Durable data and private storage

Mount the tenant/input files read-only outside `/app`, mode 0600 and owned by the runtime UID. Mount a dedicated Shoof volume at `/var/lib/shoof`, mode 0700, UID 1000. The image runs as `node`; it supports a read-only root filesystem, with only this state mount writable. Bind mounts must be provisioned with matching ownership. Keep all storage ancestors operator-controlled. The same atomic store holds separate tenant-scoped authentication and reporting files; neither is a public asset.

`npm run import:report` takes the configured tenant/state paths plus:

- `REPORTING_SNAPSHOT_FILE`: external business snapshot matching tenant/workspace/timezone/currency.
- `REPORTING_OBSERVATIONS_FILE`: optional external dated-observation envelope, shown below.

The local command performs no network call. It validates metric evidence gates and publishes projected fields only. Unknown payload extras, customer rows, evidence references and account IDs are excluded. Invalid, oversized, duplicate, cross-tenant, future or older candidates preserve the accepted presentation. Date spans over 366 days are rejected before enumeration. Each publication replaces the whole presentation; omitting observations deliberately publishes an empty list.

Exclusive lock, owner-only temporary file, fsync and atomic rename protect the single-host state. A busy operation is retried later; do not delete a live lock. A crash can leave a lock requiring deliberate operator recovery after confirming the old process stopped. Corrupt state fails closed and is not automatically overwritten. Mounts survive container replacement; they are not backups or distributed/power-loss durability guarantees. Preserve private backups outside the web root before updates. Do not blindly restore old authentication sessions.

## Dated observation envelope

This example is fictional and creates no source connection:

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

Source IDs must exist in the business snapshot. Periods are half-open and source-native, at most 366 days; unknown timezone remains null. Metrics have unique dated nonnegative integer values in `count` or `seconds`, with no currency/ratio inference. Empty observations have unavailable totals, not zero. Limits: 25 sources, twelve metrics per source, 366 values per metric.

Only origin `synced` may carry a successful-read timestamp, and must provide it; this is a trusted operator assertion, not proof the runtime performed a read. Observations retain unverified coverage, pending reconciliation and `reportReady: false`. They cannot populate business KPIs. The 48-hour recent/stale label is a display heuristic, not proof of coverage. Save time never refreshes source evidence. The caller-driven sync interface remains disabled and separate from publication.

## Deployment and review sequence

1. Independently review the exact source, including authentication and bootstrap, and require current CI. The build context includes only generic source, never tenant inputs, owner passwords or session state.
2. Configure this app's existing HTTPS proxy, hostname, private tenant input and durable volume. No external identity-provider enrollment is needed. Do not restart shared hosting or expose a host port.
3. Obtain owner authorization for setup; the owner chooses the password in the hidden terminal prompt. Verify native login and anonymous/direct-origin denial using fictional data first. Verify logout, invalid credentials, protected assets and restart persistence.
4. Only after the authenticated boundary is verified, copy/import the reviewed private seed and check its original dates, unavailable business gates and owner view. Restart Shoof only and verify both login and data persistence.
5. Keep source-reader grants and recurring imports separate. This login is not an upstream marketing credential.

`npm run qa:runtime` creates a temporary loopback-only fictional account and data. A QA proxy adapts localhost Origin/Host, but does not inject an authenticated session or bypass native login. It prints that temporary fixture's credentials for browser testing and is excluded from the production image. CI checks native login, mounted data, anonymous denial and session/report persistence after container restart. Actual public HTTPS and owner setup remain deployment checks.

For rollback, preserve the private state and pin a previously reviewed compatible login runtime. Do not roll back to the old Access-only server unless its independent provider gate and origin configuration have first been established. Never expose private static files as a fallback.
