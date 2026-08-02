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

Review both evidence paths for the exact formal date or period:

1. filegrc Evidence consists of dated Step 4 operating records. Complete the record, link it to the applicable Controls, record the result in its fields or Markdown, and link any external artifact needed to support that result.
2. External Evidence consists of verified `evidence` records from other Systems. Confirm the source System, date or period, Control links, collector, verifier, and fixed attachment or approved external reference.

The packet compiles both paths. It includes filegrc records and Markdown with Git history, plus External Evidence records, retained attachments, delivery indexes, and checksums.

Run readiness repeatedly and fix source records. Preview the packet before writing it:

```sh
npx filegrc evidence-packet --audit AUDIT_ID --preview --json
npx filegrc evidence-packet --audit AUDIT_ID
```

Do not state that an auditor accepted evidence, selected a sample, cleared an exception, or issued a report unless that fact came from the engagement team. filegrc tracks management preparation; the CPA firm owns examination judgments and the report.
