# Marketing reporting

A reusable local dashboard and metric engine with four views: results, funnel, channels and data health. The included **Harbor & Pine** tenant and every displayed value are fictional examples. No live connector, credential, customer export, hosted deployment or scheduler is included.

```sh
npm test
npm run check
npm run build
npm run preview
```

Requires Node 22 or newer, with no runtime dependencies or installation. The preview binds only to `127.0.0.1:4327`. The build produces a static fictional demo under `dist/`; it refuses private runtime input variables. There is no authentication layer for remote deployment: this is a loopback review tool.

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
- `docs/INTEGRATION.md`: automated/manual source sequence and evidence gates.
- `docs/DATA-BOUNDARIES.md`: nonsecret tenant configuration, private observations and secrets.
- `docs/RELEASE-REVIEW.md`: local review status and publication requirements.

Browser QA can reuse an existing external Playwright installation without installing packages in this project. Set `REPORTING_QA_PACKAGE` to its absolute package.json path and `REPORTING_QA_BROWSER` to an installed Chromium executable, then run `npm run qa`. QA starts a temporary loopback demo server and writes fictional screenshots/PDF to ignored `artifacts/`. No machine-specific paths are committed.

## Publication and licensing

This is a local source candidate, not a published open-source release. `private: true` prevents npm publishing; it does not determine Git hosting visibility. `license: "UNLICENSED"` grants no reuse license and makes no ownership claim. The owner must choose licensing and explicitly approve the repository audience before publication.
