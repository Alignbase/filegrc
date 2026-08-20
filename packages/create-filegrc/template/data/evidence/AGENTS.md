# Evidence Artifact Instructions

An evidence record explains what a proof item is, where it came from, what period it supports, who collected it, and which records or controls it supports. The attachment alone is not enough.

Do not create placeholder or collection-test Evidence. Control implementation maps Controls to complete authoritative source Components; `npx filegrc evidence-map --json` remains available as a focused diagnostic. Create an Evidence Artifact during Step 4 only when a real export, report, screenshot, signed file, or approved external reference exists. When an operating record needs fixed supporting proof, create or update an Evidence Artifact and link its ID from that record. Keep it as `draft` until the artifact exists. Set it to `collected` only after selecting the source Component, attaching or referencing the result, and recording the source, date, Classification, and collector. Set it to `verified` only after another named person checks it.

## Create evidence

1. Run `npx filegrc guide evidence --json`.
2. Use one evidence record for one coherent proof item or fixed export.
3. Put local attachments under `data/evidence/EVIDENCE_ID/` and list their data-relative paths in `filePaths`.
4. Use `externalReference` only when the file must remain in an approved external system. filegrc never fetches it.
5. Link `sourceResourceIds`, `controlIds`, and `auditIds` as applicable. Use `sourceCommit` when the evidence represents repository state.
6. Name the actual collector. A `verified` record also needs the actual verifier and verification date.

Copy a local fixed file and update the record atomically:

```sh
npx filegrc attach EVIDENCE_ID /path/to/source-file --name auditor-facing-name.csv --expected-revision REVISION
```

The command never overwrites an existing attachment.

Read `REVISION` from `npx filegrc get EVIDENCE_ID --mutation`. Use `npx filegrc detach EVIDENCE_ID FILE_NAME --yes --expected-revision REVISION` when removing a mistaken attachment. filegrc will not delete an evidence record while local attachments remain.

For a rendered page capture, record the route, filters, audit period, exact Git commit, capture time and method, source resource IDs, and screenshot. A current screenshot cannot prove an earlier state unless it is rendered from or bound to that revision.

For a signed acknowledgement, bind the attestation to the exact content Git revision and store the signed file as evidence.

For a `population-export`, also record the authoritative `sourceComponentId`, exact period, generation timestamp, timezone, query or report parameters, item count, completeness check, and accuracy check. A zero-item population still needs its source export and query.

Do not commit plaintext credentials, private keys, tokens, recovery codes, session data, regulated data, or personal data that may need erasure. Source-controlled ciphertext is allowed only under the Information Security Policy's approved encryption, separate-key, access, and rotation conditions. Use an approved external reference when Git is not an appropriate store.
