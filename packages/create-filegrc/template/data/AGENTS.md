# filegrc Data Instructions

These instructions apply to every file under `data/`. The root `AGENTS.md` explains the program and Git workflow. A collection-level `AGENTS.md`, when present, adds rules for that resource.

## Start with discovery

Treat the installed model as the authority. Do not infer a schema from a nearby JSON file because that file may use only part of the model.

```sh
npx filegrc guide --json
npx filegrc program-path --next --json
npx filegrc reconcile --preview --json
npx filegrc types --json
npx filegrc guide RESOURCE_TYPE --json
npx filegrc list RESOURCE_TYPE --json
npx filegrc search "TERM" --json
```

Use `program-path --next --json` for the current lifecycle step. Use `workflow --json` when you need the full shared assessments, complete checklist, Work Items, and blockers. Use `guide` before any unfamiliar create or status transition. It reports required fields, fields required by a status, enum values, relationship types and candidates, Markdown slots, timing, and exact paths. Use `describe` only when you need the raw model definition.

After changing a lifecycle fact directly, review `reconcile --preview --json`. A candidate asks whether the change represents a real policy event. Supply the actual event date or timestamp, departure risk when relevant, and explicit confirmation before applying it.

## Choose the right record

- A reusable rule belongs in `policy`.
- A testable activity that implements a rule belongs in `control`.
- Work required on a schedule or event belongs in `obligation`.
- A dated instance of work belongs in its activity type, such as `meeting`, `risk-assessment`, `access-review`, `vulnerability-scan`, `backup-test`, or `exercise`.
- A fact that may change over time belongs in an inventory record, such as `person`, `system`, `asset`, `vendor`, or `access-grant`.
- A Person’s `jobTitle` is their actual position in the organization. A named authority they hold, such as CISO, DPO, Policy Owner, or team chair, belongs in a dated `appointment` scoped to the workspace, team, or governed records.
- Team membership and chairs are authoritative on `team.memberIds` and `team.chairIds`.
- A dated Step 4 operating record proves that filegrc-managed work occurred. Put each fixed external artifact in an `evidence` record and link it from the operating record; never add an unexplained attachment.
- Follow-up work belongs in `action-item`. A gap belongs in `finding`, a known threat belongs in `risk`, and an approved temporary departure belongs in `exception`.
- An auditor request belongs in `audit-request`; the engagement itself belongs in `audit`.

When more than one type seems plausible, run `guide` for each and choose the one whose purpose matches the requested action. Do not create a new type or field.

## Create

Create a model-driven draft:

```sh
npx filegrc scaffold RESOURCE_TYPE --title "Human name" > /tmp/filegrc-mutation.json
```

The scaffold is a mutation envelope:

```json
{
  "record": {
    "id": "resource-type-human-name",
    "type": "resource-type",
    "title": "Human name"
  },
  "content": {
    "record": "# Human name\n"
  }
}
```

Replace every `null` and every empty required array. Keep the starting status until the work reaches the next real state. Do not use placeholder text as a compliance fact. Use IDs returned by `list` or the relationship candidates returned by `guide`.

```sh
npx filegrc create /tmp/filegrc-mutation.json
npx filegrc validate --json
```

Creation is atomic. If JSON, Markdown, relationships, or validation fail, filegrc rolls back the write. IDs are globally unique and immutable after commit.

## Read and update

```sh
npx filegrc get RESOURCE_ID --mutation > /tmp/filegrc-mutation.json
npx filegrc content RESOURCE_TYPE RESOURCE_ID --json
npx filegrc references RESOURCE_ID --json
```

Edit the exported mutation, then run:

```sh
npx filegrc update RESOURCE_TYPE RESOURCE_ID /tmp/filegrc-mutation.json
```

The mutation includes the complete record, current Markdown, and revision hashes. filegrc rejects the update if another person or agent changed either source after export. Reload and reapply the intended change instead of overwriting it.

To update JSON and Markdown together, pass `{ "record": {...}, "content": {...}, "revision": "...", "contentRevisions": {...} }`. To change one Markdown slot:

```sh
npx filegrc content RESOURCE_TYPE RESOURCE_ID SLOT --write updated.md
```

Never replace a complete record with a partial JSON object. Never change `id` or `type` during an update. Preserve unknown namespaced `extensions`.

## Record the substance

JSON is for stable metadata used by validation, relationships, filters, schedules, and audit checks. Markdown is for the actual work: inputs, method, observations, results, rationale, decisions, exceptions, and follow-up.

If `guide` marks a Markdown slot recommended, fill it before treating the deliverable as complete. Keep observations and report details in the source record’s Markdown. Create a Finding only for a confirmed gap that needs its own remediation lifecycle. Create an Action Item only when follow-up needs a separate assignee, deadline, and completion proof. Set each child record’s `sourceResourceId` to the record that produced it; do not maintain reverse Finding or Action Item arrays on the source. Do not put a report’s entire variable structure into new JSON fields.

When `guide` returns a collection review requirement, review the listed type-specific criteria and use `npx filegrc review-collection RESOURCE_TYPE --scaffold`. Fill the management conclusion, rationale, reviewer, and date, then preview and apply the payload. Do not invent `collectionRevision`; FileGRC calculates it from the current records and material Program scope. Any later change makes the confirmation stale and requires another review.

Use Retention Schedule Items as the structured rows of the Data Retention Schedule. Keep a row `planned` until management has approved its Information Types, scope, cutoff, period, disposition action, instructions, sources, approver, date, and reviewed source revisions. Run `npx filegrc program-readiness --json` after changing an information use, source-coverage record, Commitment, Policy, or other source. FileGRC may identify missing or stale decisions, but it must never infer an organization-specific period or deletion behavior.

Store a relationship only on its authoritative record. Control Tests store `auditId`; Evidence Artifacts store `auditIds`; Commitments store `systemIds` and `controlIds`; Controls store `policyIds`, `requirementIds`, `systemIds`, `componentIds`, and `evidenceSourceComponentIds`; Risks store `controlIds`; Components store their `vendorId` and `systemUses`. Use `references` to inspect derived inbound links.

Use explicit business dates. Git records when a file changed, but it does not replace `occurredOn`, `scheduledFor`, `completedOn`, `approvedOn`, or similar fields.

## Status changes

Status is an assertion. Before moving a record to a completed, approved, implemented, reconciled, remediated, passed, verified, or closed state:

1. Run `guide RESOURCE_TYPE --json` and satisfy every conditional field.
2. Write the actual work and conclusion in Markdown when recommended.
3. Link source Components, Evidence Artifacts, risks, findings, exceptions, and actions that support the result.
4. Use the real completion or approval date.
5. Confirm the named people performed and reviewed the work.

Do not mark a control implemented because a policy says it should exist. Do not mark evidence verified because it was merely collected. Do not mark a task done without the completion record type requested by its obligation.

Policy, program Document, and Training approval in Step 2 accepts the reviewed requirements, intended values, and exact content revisions. It does not prove implementation or start governed work. A required program Document has `workflowScope: program`, and Training stays `approved`, until linked Controls and Obligations are ready. In Step 3, run `activate-content --scaffold` and record the active Person who performs the cutover, actual activation date, and effective date; FileGRC binds activation to each unchanged approved revision. Then run `activate-policies --scaffold`, review the approved Policies together, select the cutover set, and record the real effective date. Operate the program and collect Evidence in Step 4. Create Audit Documents with `workflowScope: engagement` only in the Step 5 workflow. After each Audit Document is complete, record approval first, then activate the unchanged approved revision in a separate update with its actor, actual activation date, and effective date.

## Delete and replace

Before deletion:

```sh
npx filegrc references RESOURCE_ID --json
```

Delete only an uncommitted draft or a mistake:

```sh
npx filegrc delete RESOURCE_TYPE RESOURCE_ID --yes --expected-revision REVISION
```

filegrc rejects deletion that breaks references and removes owned Markdown with the JSON. Retire, close, cancel, supersede, or replace committed records that explain historical operation.

## Evidence and attachments

Put attachments under the evidence record’s directory and store data-relative paths:

```text
data/evidence/evidence-example/evidence.json
data/evidence/evidence-example/source-export.csv
```

The JSON uses `filePaths: ["evidence/evidence-example/source-export.csv"]`. Commit the evidence JSON and attachment together. Do not scatter PDFs, screenshots, exports, or signatures elsewhere in `data/`.

Use the attachment command to copy a fixed file and update `filePaths` in one validated action:

```sh
npx filegrc attach EVIDENCE_ID /path/to/source-export.csv --expected-revision REVISION
```

It refuses symlinks, hidden destination names, and existing destination files.

Remove a local attachment explicitly before deleting its evidence record:

```sh
npx filegrc detach EVIDENCE_ID source-export.csv --yes --expected-revision REVISION
```

filegrc will not delete an evidence record that still has local attachments.

Never invent Evidence, dates, approvals, results, people, or source-Component details. If a required fact is unavailable, leave the record in a non-final state and report the missing input.

## Implement Controls and Their Evidence Sources

Finish each applicable Control and its authoritative source Components together. Use Program Readiness as the completion check:

```sh
npx filegrc program-readiness --json
```

The Control stage reports Control implementation items, evidence-family source checks, governed-plan blockers, and per-Policy activation assessments. Resolve them through the source records:

1. Choose an existing Component or scaffold the Component that is authoritative for the family.
2. Set the Component to `active`, connect it to each bounded System through `systemUses` with the `evidence-source` role and a rationale, add the matching `evidenceSourceKinds`, and name current `evidenceOwnerIds`.
3. Put the exact report, filters, date range, timezone, export format, and reconciliation steps in the Component’s Record Markdown.
4. Add the Component ID to `evidenceSourceComponentIds` on every Control in the family that it supports.
5. Finish the Control’s owner, procedure, scope, operation pattern, mappings, and implementation date. Put every calendar or event schedule in an Obligation.
6. Enable each required Obligation. It stays dormant while a governing Policy or required program Document is inactive. The first operating window starts from the latest applicable effective date, so FileGRC does not create overdue work for a period before cutover.
7. Run `program-readiness --json`, then use `activate-policies --scaffold` to review and atomically activate the selected approved Policies at implementation cutover. A documented gap or approved Exception may support activation, but the candidate period cannot start until Policies are active and Controls are fully implemented and evidence-ready.

Use `get RESOURCE_ID --mutation` and `update` so JSON and Markdown change together. `evidence-map --json` remains available when you want only the evidence-family checks. Do not create an Evidence Artifact while designing or implementing a Control. Create one during Step 4 only when the real export, report, screenshot, signed file, or approved external reference exists.

## Scheduled and event work

```sh
npx filegrc obligations --json
npx filegrc activate-obligation-rule RULE_ID --scaffold > activation.json
npx filegrc activate-obligation-rule RULE_ID activation.json
npx filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD > completion-mutation.json
npx filegrc complete OBLIGATION_ID completion-mutation.json
npx filegrc reconcile-obligation OBLIGATION_ID --scaffold --window-start YYYY-MM-DD > occurrence.json
npx filegrc reconcile-obligation OBLIGATION_ID occurrence.json
npx filegrc reconcile-obligation OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --correct-finalized > occurrence-correction.json
npx filegrc trigger EVENT_TYPE --occurred-on YYYY-MM-DD --subject RESOURCE_ID --json
npx filegrc complete-action ACTION_ITEM_ID --scaffold --completed-on YYYY-MM-DD > completion-mutation.json
npx filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD
npx filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD --expected-revision REVISION
```

Fill the scaffold with the actual work, evidence, review, and every null or empty required value. Completion scaffolds include the target revision. For other updates, read `REVISION` from `npx filegrc get RESOURCE_ID --mutation`. Run `obligations` before `trigger` to preview every Policy Event task, owner, deadline, and requested proof. Triggering creates the event and adds all linked Action Items to the Work Queue atomically. `complete` and `complete-action` validate the expected completion type and link the new record atomically. `complete-event` refuses to close the workflow until every action has its requested proof. For hour-based deadlines use `--occurred-at` with an RFC 3339 timestamp and timezone.

## Audit work

```sh
npx filegrc program-readiness --summary --json
npx filegrc prepare-audit AUDIT_ID
npx filegrc audit-readiness AUDIT_ID --json
npx filegrc reconcile-management-documents AUDIT_ID --scaffold > management-reconciliation.json
npx filegrc reconcile-management-documents AUDIT_ID management-reconciliation.json
npx filegrc correct-audit-population POPULATION_ID --scaffold > population-correction.json
npx filegrc correct-audit-population POPULATION_ID population-correction.json
npx filegrc evidence-packet --audit AUDIT_ID --preview --json
```

Run Program Readiness before creating the normal audit engagement. Step 2 checks independent approval of Policies, required program Documents, and Training without requiring activation. Step 3 separately checks active Documents and Training, their activation dates and bound revisions, active Policies, implemented Controls, enabled Obligations, and evidence mapping without an audit ID. Fix readiness errors in Policy, Document, Training, Control, Component, System, Obligation, and Evidence records. Do not edit packet output under `.filegrc/`. A delivery-ready filegrc packet means the management checks passed; the engagement team still judges evidence and performs the examination.

For a real engagement, select the Program and its bounded Systems, a framework containing the complete CC1.1 through CC9.2 Security Common Criteria set, all nine SOC 2 Description Criteria, any optional Trust Services Categories in scope, and Controls that cover every applicable selected Trust Services criterion. Treat every Security Common Criterion as applicable. For an included optional category, keep a criterion in the framework when management judges it not relevant and record the limited circumstances in the System Description's DC8 disclosure. Do not omit any of the nine Description Criteria. Use `coverage.kind: "as-of"` with `on` for Type 1 or `coverage.kind: "range"` with `startsOn` and `endsOn` for Type 2. Record the Git commit for management's complete scope review in `scopeRevision`. Record `subserviceConclusion` and its rationale. When subservice organizations are identified, each `subserviceTreatments` item must connect one Vendor to its supplied Components within a selected System and choose the carve-out or inclusive method. Inclusive treatments also need the selected Controls that operate on those Components.

## Finish every change

```sh
npx filegrc validate --json
git diff --check
git status --short
git diff
```

Review every changed JSON, Markdown, and attachment. Confirm the diff contains no plaintext credentials, private keys, tokens, recovery codes, improperly controlled ciphertext, temporary files, source exports with prohibited data, or derived `.filegrc/` output. Make one focused commit whose message says why the compliance record changed.

These commands are for CLI and agent work, which continues to manage Git explicitly. Browser saves in trunk mode commit automatically from the configured authoritative branch, then push in the background while the UI reports `Syncing`. Do not start another write until it reports `Synced`. Do not use a feature branch as a record approval state, and never include application changes when this workspace lives in a monorepo.
