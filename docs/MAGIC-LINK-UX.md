# Portable automatic email sign-in

The owner requests an email link, opens it wherever they read email, and arrives at the protected report. There is no requesting-browser requirement or second confirmation button. Passkey sign-in remains available on the login page and its device-verification ceremony is unchanged.

## Interaction

- The email explains that the link works on any browser/device, expires in ten minutes, works once and must not be forwarded.
- Initial navigation and same-document fragment changes use the same ingestion routine. The fragment is removed before asynchronous work; the token exists only in page memory.
- A visible, non-prerendered page automatically submits the token with the existing same-origin JSON POST and CSRF header. A hidden tab waits until visible.
- Replacement links queue behind an outstanding confirmation. A real successful response completes navigation even if a newer link arrived: its Set-Cookie headers already changed the browser state. Failed/interrupted responses check the authenticated session before showing an error or trying the queued replacement.
- Replay/expiry/invalid links offer a fresh email or passkey. Back/forward cache restoration checks the session without replaying the consumed token. No token appears in application telemetry, storage, server URLs or referrers.

## Boundaries and deployment

The server continues to enforce its configured owner and HTTPS host, random 256-bit hashed tokens, ten-minute expiry, atomic single-use redemption, persistent rate budgets, bounded bodies, strict CSRF controls and eight-hour server sessions. Magic links no longer need a flow cookie; passkey challenges still do. Authentication schema 2 upgrades to 3 on the next successful state write, preserving existing sessions, user handles, keys and budgets. Tenant/owner/host mismatches still fail closed. Rollback must use a schema-3-compatible image.

GET/HEAD and passive prefetches do not consume links. Visibility/prerender checks cannot distinguish a person from a scanner executing JavaScript in a visible browser. Such a scanner can redeem the link; removing both cookie binding and the extra click accepts that limitation. Use a passkey when this behavior is unsuitable.

Review the exact commit independently before merge and coordinate deployment. This change contains no private configuration, new credentials, source integration or tenant cutover.
