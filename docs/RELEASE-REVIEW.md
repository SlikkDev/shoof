# Source review and licensing

This repository is intended for generic source and independently invented examples. Validate the actual publication candidate and outgoing commits; this document does not certify all historical objects. Machine-specific QA paths are supplied externally.

No upstream source code, downloaded brand assets, original reference mockups, bundled third-party libraries or web fonts are included. The UI uses system font stacks. Generated review screenshots and PDF contain the fictional demo and are ignored by Git. Software ownership and licensing have not been asserted; choose an appropriate license before an open-source release.

For each release, review all tracked files, every commit, generated assets and the exact archive. Secret scanning complements visual/content review and is not proof that all confidential business information is absent. Keep private operational reports and audit findings outside this repository.

Before the first push, and again after each local correction:

1. Choose the already published base (normally freshly fetched `origin/main`). Commit the intended files, run the normal test/build/privacy checks, then `npm run review:publication -- origin/main`. The command applies the existing source guards to every outgoing committed tree, including intermediate versions later changed or deleted. It does not rewrite history or contact a remote.
2. Inspect `git log --reverse --stat origin/main..HEAD` and each outgoing diff, including tests, examples, screenshots and attachments. The command lists likely fixture paths, but that list is not an exhaustive provenance review. Also check the index before committing; a clean working copy is not evidence that staged or earlier committed bytes are safe.
3. For every added or changed metric fixture, explain its test-driven construction in a generic comment or PR description: for example, small invented counts chosen to exercise a decrease in one metric and an increase in another. Confirm that no value, pair, ratio, identifier or payload was copied or transformed from private source evidence. Replacing names/dates or labelling copied numbers fictional is insufficient.
4. Have the reviewer inspect that explanation against the exact outgoing diff before publication. Do not include private originals, client identities, fingerprints of private metric values or an incident record in a public explanation or detector. If provenance is uncertain, replace the fixture from first principles and repeat this review before pushing.

These guards detect known structural/credential patterns; ordinary aggregate numbers do not reveal their origin. Review of fixture origins remains required even when every automated check passes. CI repeats the committed-history guard for PRs, but cannot undo the first public push and is not a substitute for the local check.

The generic source is published for review; licensing remains undecided. Public source visibility is not an open-source license grant. No hosted deployment, remote repository or visibility change is created by these scripts.
