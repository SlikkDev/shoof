# Shoof

This repository contains Shoof's generic reporting source. Do not add real tenant configuration, identifiers, private reports, credentials or customer data. Demo files and test fixtures must be wholly fictional and visibly labelled. Use the injected read contract and caller-driven sync interface; no network connector, credential loader, send/mutation path or active scheduler is provided. Test persistence only with synthetic data in temporary external directories.

Run npm test, npm run check, npm run build and npm run privacy for code changes. Run browser QA for UI changes when a local browser tool is available. Private runtime inputs must remain outside the repository. Builds always use fictional demo data and refuse private input environment variables. Do not invent software ownership or add a license without the owner's decision.
