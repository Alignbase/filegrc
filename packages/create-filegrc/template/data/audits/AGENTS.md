# Audit Instructions

Create one `audit` record for one real CPA engagement. Define the audit kind, framework, exact firm-agreed Type 1 date or Type 2 period, scope, owners, auditor, and report status from facts supplied by management or the engagement team.

Keep management’s candidate Type 2 dates on `workspace`. Do not copy them into the audit record until the CPA firm agrees to those dates. Preserve both sets when the formal period differs.

The normal path is to pass `npx filegrc program-readiness --require-ready` and start reliable evidence collection before engaging the firm. Early engagement is allowed when a customer deadline or unusual scope needs CPA input.

After the audit record has its dates:

```sh
npx filegrc prepare-audit AUDIT_ID
npx filegrc audit-readiness AUDIT_ID --json
```

Preparation creates engagement-specific management documents and, for Type 2, population records. It does not approve documents, implement controls, reconcile populations, or create evidence.

Before fieldwork, link the accepted engagement terms as an active approved Document with `documentKind: "soc2-engagement-terms"`. Record the actual acknowledgement date, on or after approval and no later than fieldwork start, and the current management people who acknowledged the terms.

Select a framework containing every CC1.1 through CC9.2 Security Common Criterion, all nine SOC 2 Description Criteria, and any optional Trust Services Categories included in the report. Treat every Security Common Criterion as applicable. For an included optional category, keep a criterion in the framework when management judges it not relevant, record the limited circumstances, and disclose them under DC8. Do not omit any Description Criterion. Bind management's complete scope review to its Git commit in `scopeRevision`. The selected auditor Vendor must represent the CPA firm engaged for the examination and must have been active during the engagement period.

Review both evidence paths for the exact formal date or period:

1. filegrc Evidence consists of dated Step 4 operating records. Complete the record, link it to the applicable Controls, record the result in its fields or Markdown, and link any external artifact needed to support that result.
2. Evidence Artifacts are verified `evidence` records from source Components. Confirm the source Component, date or period, Control links, collector, verifier, and fixed attachment or approved external reference.

The packet compiles both paths. It includes FileGRC records and Markdown with Git history, plus Evidence Artifacts, retained attachments, delivery indexes, and checksums.

Run readiness repeatedly and fix source records. Preview the packet before writing it:

```sh
npx filegrc evidence-packet --audit AUDIT_ID --preview --json
npx filegrc evidence-packet --audit AUDIT_ID
```

Do not state that an auditor accepted evidence, selected a sample, cleared an exception, or issued a report unless that fact came from the engagement team. filegrc tracks management preparation; the CPA firm owns examination judgments and the report.

The signed representation requires verified `signed-record` Evidence with `artifactSubtype: "signed-management-representation"` and a fixed-format attachment. Record the letter's actual signing timestamp in `businessEventAt`; `collectedOn` only records when FileGRC received it. The signing date must match the CPA report date once `reportDate` is known. Store the issued SOC 2 report as verified `third-party-report` Evidence with `artifactSubtype: "soc2-report"`, record its actual issuance timestamp in `sourceGeneratedAt`, and link it through `reportEvidenceId` before closing the Audit. Reconcile `reportDate` and `opinionDate` to the date on that issued report.

At report draft and again before closure, record the subsequent-events review through the CPA report date. Name the actual reviewers, review on or after the through date, state management's conclusion, and link relevant incidents, findings, and Evidence.

For each packet delivery, name the people who performed the least-disclosure review and approved delivery. Record the redaction decision, recipient, approved delivery System, exact packet Git revision, SHA-256 manifest checksum, chronological review, approval, and delivery dates, and the receipt reference. Final assertion and representation signers must have active authority Appointments linked from the Audit.
