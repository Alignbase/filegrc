# Audit Instructions

Create one `audit` record for one engagement. Define the audit kind, framework, exact Type 1 date or Type 2 period, scope, owners, auditor, and report status from facts supplied by management or the engagement team.

After the audit record has its dates:

```sh
npx filegrc prepare-audit AUDIT_ID
npx filegrc audit-readiness AUDIT_ID --json
```

Preparation creates engagement-specific management documents and, for Type 2, population records. It does not approve documents, implement controls, reconcile populations, or create evidence.

Run readiness repeatedly and fix source records. Preview the packet before writing it:

```sh
npx filegrc evidence-packet --audit AUDIT_ID --preview --json
npx filegrc evidence-packet --audit AUDIT_ID
```

Do not state that an auditor accepted evidence, selected a sample, cleared an exception, or issued a report unless that fact came from the engagement team. FileGRC tracks management preparation; the CPA firm owns examination judgments and the report.
