# Upgrade to data model v5

Model v5 separates governed Document approval from activation. Required program plans and schedules now follow `draft → approved → active`, with an approval date and content revision in Step 2 and a separate activation date, activation actor, effective date, and content revision in Step 3.

Every Document now declares `workflowScope` as `program` or `engagement`. Audit-specific Documents use `engagement` and remain in Step 5. The program gate does not treat engagement terms, management assertions, representation letters, or other audit management Documents as Step 2 plans.

## Preview first

Run the preview from the workspace root:

```sh
npx filegrc migrate --to-model 5 --preview --json
```

The preview does not write files. It classifies the Workspace version change and unambiguous Document scopes as `automatic`, and each active v4 Document reset as `review-required`. An `unsupported` item means the target model validation found a fact that management must fix before applying the migration.

If a Document is linked to both program governance and an Audit, choose its authoritative workflow explicitly:

```json
{
  "documentScopes": {
    "document-example": "program"
  }
}
```

Pass that file with `--decisions decisions.json` for both preview and apply. Split the Document before migration if the same content actually mixes a reusable program plan with an engagement deliverable.

## What the migration preserves

Model v4 used `active`, `approvedOn`, `effectiveOn`, and `approvedContentRevisions` for a combined Document adoption event. The migration cannot tell when implementation finished or when management separately put that Document into use.

For an active v4 Document that still needs a distinct activation, the migration:

- preserves `approvedOn`, `approverIds`, and `approvedContentRevisions`;
- changes `status` to `approved`;
- moves the prior `effectiveOn` value to `proposedEffectiveOn`;
- leaves `activatedOn` and `activatedContentRevisions` unset.

It does not invent an activation event, actor, date, or revision.

Issued, delivered, and completed Audits must keep their historical management Documents intact. The migration preserves those engagement Documents as active with `activationBasis: legacy-v4`. That basis makes the missing second event visible because model v4 recorded approval and adoption together. New and ongoing Documents must use `activationBasis: recorded` and name the active Person who performed activation.

## Apply and finish Step 3

After the preview has no unsupported items, apply it:

```sh
npx filegrc migrate --to-model 5 --yes --json
```

Inspect the Git diff and run Program Readiness. For each required governed plan or schedule:

1. Confirm the Step 2 intended values, owner, independent approver, approval date, and approved content revision are still correct.
2. Implement or confirm every linked Control requirement.
3. Keep the approved Markdown unchanged. A material edit returns the Document to draft and requires another approval.
4. Review the `documentActivations` result, then scaffold and apply the activation:

```sh
npx filegrc activate-documents --scaffold > document-activation.json
# Set activatedByIds to the active Person who performs the cutover.
npx filegrc activate-documents document-activation.json --yes --json
```

Activation records the actual current date in `activatedOn`, the active Person in `activatedByIds`, the chosen `effectiveOn`, and the exact `activatedContentRevisions`. It does not replace the approval date or approved revision.

For a Step 5 engagement Document, link it to exactly one Audit, approve it, and use the Audit-scoped activation operation:

```sh
npx filegrc activate-documents --audit AUDIT_ID --scaffold > audit-document-activation.json
# Set activatedByIds to the active Person who performs the engagement cutover.
npx filegrc activate-documents audit-document-activation.json --yes --json
```

Do not place a reusable program Document in an Audit's engagement-terms or management-Document field, or use an engagement Document as a Policy or Obligation document. After approval or activation, the recorded actors, dates, and content revisions are immutable. Move the Document back to draft or approved and record a new event instead of editing the old event facts.

Then run:

```sh
npm run validate
npx filegrc program-readiness --json
npx filegrc workflow --json
```

Commit the migration and reviewed activation changes only after the workspace validates and the lifecycle facts match what management actually did.
