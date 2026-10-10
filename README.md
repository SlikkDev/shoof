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

Requires Node 22 or newer. The protected runtime uses the pinned `jose` dependency for JWT verification. The preview binds only to `127.0.0.1:4327`. The build produces a static fictional demo under `dist/`; it refuses private runtime input variables. These review paths remain separate from the authenticated runtime.

## Protected runtime

`npm start` serves a single externally configured tenant behind an existing Cloudflare Access application, validates signed assertions at the origin, and reads an owner-only persistent store. Startup requires explicit Access issuer/audience, viewer allowlist, hostname, tenant file and state directory. There is no default login, credential creation, HTTP write endpoint or source connection.

`npm run import:report` validates external snapshot/observation files and atomically publishes their projected presentation to that store. Invalid or older candidates preserve the last accepted report. Freshness uses evidence timestamps, not file-save times. `npm run qa:runtime` opens a separate loopback-only fictional review server with an ephemeral test identity; it is excluded from the production image.

See [protected runtime setup](docs/RUNTIME.md) for configuration, storage, observation format, verification and rollback. Deployment and identity-provider setup are operator actions; publishing this source performs neither.

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
