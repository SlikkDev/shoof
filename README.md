# Shoof

A reusable local dashboard and metric engine with four views: results, funnel, channels and data health. The included **Harbor & Pine** tenant and every displayed value are fictional examples. No live connector, credential, customer export, hosted deployment or active scheduler is included.

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run build
npm run privacy
npm run preview
```

Requires Node 22 or newer. Passwordless authentication uses pinned SimpleWebAuthn, Nodemailer and cookie libraries. The local preview binds only to `127.0.0.1:4327`. The static build is always fictional and refuses all private runtime variables.

## Protected runtime

`npm start` serves one externally allowlisted owner using **magic links and passkeys**. Configure the existing HTTPS hostname, owner email, private tenant/state paths and an approved generic SMTP sender. There is no Shoof password, public registration, default account or external identity-provider enrollment.

Email links open on any browser or device and sign in automatically when the page becomes visible. They expire after ten minutes. Tokens are single use and stored only as hashes. After signing in, the owner can add or remove a passkey from the Passkeys page; changes require recent authentication. Server sessions expire after eight hours, survive restart and revoke on sign-out. CSRF controls and durable rate limits protect the authentication endpoints.

`npm run import:report` validates external snapshot/observation files and atomically publishes projected fields. Invalid or older candidates preserve the accepted report. Signing in neither releases metric gates nor starts a marketing connection.

See [runtime setup](docs/RUNTIME.md) for generic SMTP configuration, recovery and cutover. `npm run qa:runtime` provides a fictional loopback login and captured local inbox, with no real email or device credential. Source publication performs no actual credential setup, registration, deployment or private-data upload.

The engine keeps missing data unavailable, requires matching tenant/account/date/currency/timezone scope and reconciliation evidence, rejects duplicate records and computes ratios from additive totals. Source run metadata never establishes business coverage. The example metric definitions are proposed business rules, including a 30-day cohort and VAT-inclusive cash; they require review before real reporting.

## Private runtime configuration

Keep real tenant configuration and snapshots outside this repository. Supply both absolute paths through your existing private runtime:

```sh
REPORTING_TENANT_FILE=/private/reporting/tenant.json \
REPORTING_SNAPSHOT_FILE=/private/reporting/snapshot.json \
npm run preview
```

The paths above are placeholders. The tenant file uses the shape in `examples/tenant.demo.json` with `mode: "private"`. The snapshot must match its workspace, timezone and currency. The loader rejects private files inside this repository, partial configuration and unknown configuration fields. No credential field is accepted. Locale, direction, display name, currency, timezone and accent are injected; the current interface text is English.

The presentation response excludes workspace/account identities, evidence URLs, raw payloads and customer rows. It intentionally contains approved business metrics; keep private previews and any future deployment access-controlled. Tenant separation in these local interfaces is not a substitute for deployment authentication and authorization.

## Integration preparation

- `src/read-contract.mjs`: injected, paginated aggregate-read interface with scope/date checks, duplicate/cursor protection and field allowlisting. It performs no network request itself. A trusted connector must enforce its actual authorized, read-only API operations.
- `src/manual-import.mjs`: dated JSON aggregate import with source units and a content hash. Parsing and exhausted pagination do not establish coverage or reconciliation.
- `src/sync.mjs` and `src/observation-store.mjs`: caller-driven sync ticks, bounded private persistence, overlap protection and separate read freshness. Disabled by default; no timer or live transport. See `docs/SYNC.md` for the private-host contract and recovery limits.
- `docs/INTEGRATION.md`: automated/manual source sequence and evidence gates.
- `docs/DATA-BOUNDARIES.md`: nonsecret tenant configuration, private observations and secrets.
- `docs/RELEASE-REVIEW.md`: source review and licensing notes.

Browser QA can reuse an existing external Playwright installation without installing packages in this project. Set `REPORTING_QA_PACKAGE` to its absolute package.json path and `REPORTING_QA_BROWSER` to an installed Chromium executable, then run `npm run qa`. QA starts a temporary loopback demo server and writes fictional screenshots/PDF to ignored `artifacts/`. No machine-specific paths are committed.

Pull requests and pushes to `main` run tests, syntax checks, the fictional build and public-source guards in GitHub Actions. Actions are pinned by commit, the job has read-only repository access, and no private secrets or runtime data are configured. `npm run privacy` checks reviewed source paths, common credential/local-path patterns and demo build output. It supplements human source/history/artifact review; it cannot identify every form of private content or replace a dedicated secret scan.

## Publication and licensing

Shoof's generic source is published for review. An open-source license has not been selected. `private: true` prevents npm publishing; it does not determine Git hosting visibility. `license: "UNLICENSED"` grants no reuse license and makes no ownership claim. Licensing remains undecided. This repository does not publish a hosted dashboard or any private tenant data.
