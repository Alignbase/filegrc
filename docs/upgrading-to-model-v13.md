# Upgrade to model v13

Model v13 strengthens Step 3 baseline readiness and lets operating ownership reuse existing Control procedures. Published models v2 through v12 remain supported. The 0.18.1 refinement strengthens the existing v13 workflow without another model migration.

Existing v13 repositories update the installed engine within the 0.18 release line, then inspect current readiness:

```sh
npm update filegrc
npx filegrc program-readiness --json
npx filegrc validate
```

From a clean, committed v12 repository, inspect the migration:

```sh
npx filegrc migrate --to-model 13 --preview --json
npx filegrc migrate --to-model 13 --yes --json
npx filegrc program-readiness --json
npx filegrc validate
```

Older repositories migrate one version at a time to v12, then preview and apply the v13 migration. Migration changes only `data/workspace.json`. Review that diff and commit it. It preserves Policies, Documents, Controls, reviews, operating records, proof, activation and candidate dates. It creates no compliance facts or approvals.

Active programs keep operating on their recorded dates. Complete missing work now and reconcile each scheduled occurrence separately using its allowed date and scope. Do not repeat activation, backdate completion or replace historical results.

The grouped baseline derives work from selected Controls and adopted schedules:

- Complete a full program Risk Assessment covering all scoped Systems, active Components, material providers, active Commitments and current Risks. Retain actual results and use the existing independent risk reviewer. A narrow assessment does not cover the program.
- Compare the current workforce roster with current approved training and policies. Keep role-specific training scoped to its adopted audience. Finish training and collect each applicable person's acknowledgement of the exact subject revision. Signed or external completions retain actual proof. Existing content bindings stay historical; record a new Attestation when new completion is needed.
- Obtain actual human and service-account lists from scoped providers. Reconcile exports, counts, permissions and every Access Grant decision; investigate orphan accounts and missing access. Finish the existing Access Review and its normal approval. A successful retrieval rehearsal does not complete access reconciliation. Resolve removal and change decisions, or use the existing approved Exception workflow with owned remediation and a deadline.

The CLI and browser show the same gaps, existing records, acceptance conditions and mutation commands. Reuse unchanged valid results when their date, scope and content meet the current obligation. Do not create generic completion checkboxes or fictional operating events.

For ownership, inspect existing implemented Control procedures and approved program Documents for discovery, triggering, reconciliation, queue checks and escalation. Link the procedures actually used in handoff Evidence, or select `operatingOwnership.procedureResourceIds`. The legacy `procedureDocumentId` still works. Rehearse manual operation and retain dated proof covering the adopted event rules and sources.

No new independent approval is required solely for either group. Risk Assessments, Access Reviews, Documents, schedule decisions and preservation changes keep their normal reviews. Material changes to approved content require that content's existing review; unchanged approvals and historical Control oversight remain valid.

Retrieval and preservation still require safe proof. Retain necessary control proof under approved retention rules; these checks do not require blanket log retention or retention of deleted customer content.

For each authoritative source, follow the Component's extraction instructions, confirm access and query filters, and retrieve a safe sample or checked zero export. Link dated rehearsal Evidence from Source Coverage and reuse a current approved preservation rule covering the necessary proof. Change the preservation schedule only when the proof, cutoff, period or disposition needs a new decision, then use its normal whole-schedule review.

Inspect the first eligible work in the schedule review and activation preview: owner, population, proof, allowed completion window and justified deadline. Keep existing effective dates and frozen initial cycles. An applicability or cadence review decides whether a test is needed; a named adopted test activity still requires execution. Use a separate review workflow for applicability decisions. Reconcile each occurrence independently before reusing a baseline result. For fixed external test reports, name the activity in `artifactSubtype`, its actual `businessEventAt` and reported `operatingResult`. An export rehearsal does not execute the test.

## Reporting Channel Set approval Evidence

Release 0.18.2 fixes configuration support and historical proposal-time assessment. This is an engine fix with no model change or compliance-record migration. Both packages use the coordinated 0.18.2 release.

Existing 0.18 workspaces run `npm update filegrc`, commit the dependency and lockfile change, restart the local server, then run `npx filegrc validate` and `npx filegrc program-readiness --json`. Hosted adapters deploy the fixed patch in the same 0.18 compatibility line. Do not change Evidence coverage, collection dates, Policy activation, or proposal dates to bypass a warning.

For an unchanged committed proposal, retain the fixed configuration export and its real observation date. The actual independent reviewer verifies it using the normal Evidence workflow and records the real verification date and timestamp when known. The authorized approving Person then records the actual approval and effectiveness time using the existing browser, HTTP, or `reporting-route-set approve` workflow. Attachments must already be committed. Verification must follow the proposal and collection, and be available by approval. A configuration export supports the reviewed proposal; it does not prove historical operation or a cancellation event. Changed JSON or instructions require a new committed proposal, and a successor still needs separate predecessor cancellation proof.

If a Policy activated before approved channels became effective, the historical coverage gap remains. Record current work on its actual dates and assess the earlier gap through the normal program and audit workflows. Recollecting an unchanged capture or backdating approval does not resolve that gap.
