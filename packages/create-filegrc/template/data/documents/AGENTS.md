# Governed Document Instructions

The companion Markdown in this collection is the governed document that management reviews, approves, signs, or gives to the service auditor. Write it as a standalone company artifact.

Do not put FileGRC commands, record-entry instructions, readiness states, relationship IDs, or starter-library mechanics in the governed prose. Keep those details in this guide, the record editor, and calculated work guidance. A document may name FileGRC only when FileGRC itself is part of the document's subject, such as an actual system component or evidence source.

Bracketed prompts mark facts management must supply. Replace every prompt with a reviewed fact before approval, activation, signature, or delivery. FileGRC treats unresolved prompts as content blockers where the document lifecycle requires complete content.

Set `workflowScope` to `program` for reusable plans, schedules, charters, procedures, and standards. Set it to `engagement` only for Documents prepared for a named Audit, including engagement terms, management assertions, period-completeness statements, system descriptions, and representation letters.

Required program Documents follow `draft → approved → active`. Step 2 records the independent approver, `approvedOn`, and the exact `approvedContentRevisions`. After the linked requirements are implemented, Step 3 records `activationBasis: recorded`, the active Person in `activatedByIds`, `activatedOn`, `effectiveOn`, and the unchanged `activatedContentRevisions`. Approval and activation are separate writes even when they happen on the same calendar date. Editing bound Markdown requires a new approval and activation.

Engagement Documents use the same separate events inside Step 5. Link each approved or active engagement Document to exactly one Audit, and do not reuse it as a Policy or Obligation document. Activate ready engagement Documents with `npx filegrc activate-documents --audit AUDIT_ID --scaffold`. Approval and activation facts become immutable after their event; return the Document to draft or approved and record a new lifecycle event when the content or decision changes. `activationBasis: legacy-v4` is only for historical audit Documents preserved by the model v4 migration. Do not use it for new work.

Keep resource links in the Document JSON and supporting records. In the Markdown, describe the underlying business fact in ordinary terms. For example, use “management's control matrix,” “authoritative-source export,” or “signed letter reference” instead of a FileGRC record type or ID.

The SOC 2 assertion, representation letter, period-completeness statement, and system description are management deliverables. Reconcile them to the selected Audit, criteria, Controls, populations, events, and Evidence, but do not describe the repository workflow in the final artifact. The service auditor supplies or approves final engagement wording where applicable.
