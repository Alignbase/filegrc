# External Evidence Instructions

An evidence record explains what a proof item is, where it came from, what period it supports, who collected it, and which records or controls it supports. The attachment alone is not enough.

Onboarding does not create collection tests. After confirming applicable controls and authoritative source Systems, preview proposed tests with `npx filegrc evidence-test-drafts --preview --json`, review each family, evidence kind, collection prompt, and linked control, then run `npx filegrc evidence-test-drafts` to create the missing drafts. Repeating creation preserves existing records. Risk assessments, meetings, vendor reviews, attestations, vulnerability scans, penetration tests, backup tests, exercises, exceptions, and findings do not need a separate test. When one of those operating records needs a fixed external artifact, create or update an External Evidence record for the artifact and link its ID from the operating record. Keep a created collection test as `draft` until the artifact has actually been captured. Set it to `collected` only after selecting the source System, attaching or referencing the result, and recording the source, date, classification, and collector. Set it to `verified` only after another named person checks it.

## Create evidence

1. Run `npx filegrc guide evidence --json`.
2. Use one evidence record for one coherent proof item or fixed export.
3. Put local attachments under `data/evidence/EVIDENCE_ID/` and list their data-relative paths in `filePaths`.
4. Use `externalReference` only when the file must remain in an approved external system. filegrc never fetches it.
5. Link `sourceResourceIds`, `controlIds`, and `auditIds` as applicable. Use `sourceCommit` when the evidence represents repository state.
6. Name the actual collector. A `verified` record also needs the actual verifier and verification date.

Copy a local fixed file and update the record atomically:

```sh
npx filegrc attach EVIDENCE_ID /path/to/source-file --name auditor-facing-name.csv
```

The command never overwrites an existing attachment.

Use `npx filegrc detach EVIDENCE_ID FILE_NAME --yes` when removing a mistaken attachment. filegrc will not delete an evidence record while local attachments remain.

For a rendered page capture, record the route, filters, audit period, exact Git commit, capture time and method, source resource IDs, and screenshot. A current screenshot cannot prove an earlier state unless it is rendered from or bound to that revision.

For a signed acknowledgement, bind the attestation to the exact content Git revision and store the signed file as evidence.

For a `population-export`, also record the authoritative `sourceSystemId`, exact period, generation timestamp, timezone, query or report parameters, item count, completeness check, and accuracy check. A zero-item population still needs its source export and query.

Do not commit secrets, session data, regulated data, or personal data that may need erasure. Use an approved external reference when Git is not an appropriate store.
