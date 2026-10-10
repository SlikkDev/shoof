# Data boundaries

| Material | Location |
|---|---|
| Reusable code, model definitions, schemas, fictional examples and tests | Code repository |
| Display name, locale, direction, timezone/currency, selected source/account identifiers | Private deployment configuration loaded at runtime; these are not passwords but can still expose a client relationship |
| Metrics, canonical customer/payment facts, import evidence, source exports, reports, screenshots and backups | Private tenant-scoped storage outside the code repository |
| OAuth grants, session/API credentials, database passwords and signing keys | Existing server-side secret/environment mechanism, never tenant JSON, browser code or Git |

Real configuration is not needed for the reusable project to build or test. Private source-specific adapters and authorization details belong in the owner-controlled integration runtime until approved for disclosure. This project's read contract is provider-independent and carries no production URL.

The public presentation contract uses display settings and approved aggregate outcomes. The protected snapshot contract carries workspace/account identity and evidence necessary for scope checks. Do not blindly expose snapshots, payloads or audit receipts through an API. Never log credentials or customer bodies; hashing an identifier is not an automatic privacy guarantee.

A private runtime must authorize the requesting user and tenant before selecting files or database records, protect exports, use tenant-scoped storage, and record reviewed coverage/reconciliation. This local preview only binds loopback and does not implement those deployment controls.

The `dist/` build is demo-only. `artifacts/`, private JSON suffixes and `.env*` are ignored as defense in depth, not as a guarantee: ignored files can still be force-added. Before any release, inspect the complete tracked tree, history, screenshots/PDFs and archive contents. Do not move private Git history into a public repository or rely on deleting the newest copy of a file.
