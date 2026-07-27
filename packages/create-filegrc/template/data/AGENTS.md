# FileGRC Data Instructions

These instructions apply to every file under `data/`. The root `AGENTS.md` explains the program and Git workflow. A collection-level `AGENTS.md`, when present, adds rules for that resource.

## Start with discovery

Treat the installed model as the authority. Do not infer a schema from a nearby JSON file because that file may use only part of the model.

```sh
npx filegrc guide --json
npx filegrc types --json
npx filegrc guide RESOURCE_TYPE --json
npx filegrc list RESOURCE_TYPE --json
npx filegrc search "TERM" --json
```

Use `guide` before any unfamiliar create or status transition. It reports required fields, fields required by a status, enum values, relationship types and candidates, Markdown slots, policy context, timing, and exact paths. Use `describe` only when you need the raw model definition.

## Choose the right record

- A reusable rule belongs in `policy`.
- A testable activity that implements a rule belongs in `control`.
- Work required on a schedule or event belongs in `obligation`.
- A dated instance of work belongs in its activity type, such as `meeting`, `risk-assessment`, `access-review`, `vulnerability-scan`, `backup-test`, or `exercise`.
- A fact that may change over time belongs in an inventory record, such as `person`, `system`, `asset`, `vendor`, or `access-grant`.
- Proof belongs in `evidence`, not in an unexplained attachment.
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
    "schemaVersion": 1,
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

Creation is atomic. If JSON, Markdown, relationships, or validation fail, FileGRC rolls back the write. IDs are globally unique and immutable after commit.

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

The mutation includes the complete record, current Markdown, and revision hashes. FileGRC rejects the update if another person or agent changed either source after export. Reload and reapply the intended change instead of overwriting it.

To update JSON and Markdown together, pass `{ "record": {...}, "content": {...}, "revision": "...", "contentRevisions": {...} }`. To change one Markdown slot:

```sh
npx filegrc content RESOURCE_TYPE RESOURCE_ID SLOT --write updated.md
```

Never replace a complete record with a partial JSON object. Never change `id` or `type` during an update. Preserve unknown namespaced `extensions`.

## Record the substance

JSON is for stable metadata used by validation, relationships, filters, schedules, and audit checks. Markdown is for the actual work: inputs, method, observations, results, rationale, decisions, exceptions, and follow-up.

If `guide` marks a Markdown slot recommended, fill it before treating the deliverable as complete. Link evidence and resulting risks, findings, exceptions, or action items in JSON. Do not put a report’s entire variable structure into new JSON fields.

Use explicit business dates. Git records when a file changed, but it does not replace `occurredOn`, `assessmentDate`, `reviewedOn`, `completedOn`, or similar fields.

## Status changes

Status is an assertion. Before moving a record to a completed, approved, implemented, reconciled, remediated, passed, verified, or closed state:

1. Run `guide RESOURCE_TYPE --json` and satisfy every conditional field.
2. Write the actual work and conclusion in Markdown when recommended.
3. Link source systems, evidence, risks, findings, exceptions, and actions that support the result.
4. Use the real completion or approval date.
5. Confirm the named people performed and reviewed the work.

Do not mark a control implemented because a policy says it should exist. Do not mark evidence verified because it was merely collected. Do not mark a task done without the completion record type requested by its obligation.

## Delete and replace

Before deletion:

```sh
npx filegrc references RESOURCE_ID --json
```

Delete only an uncommitted draft or a mistake:

```sh
npx filegrc delete RESOURCE_TYPE RESOURCE_ID --yes
```

FileGRC rejects deletion that breaks references and removes owned Markdown with the JSON. Retire, close, cancel, supersede, or replace committed records that explain historical operation.

## Evidence and attachments

Put attachments under the evidence record’s directory and store data-relative paths:

```text
data/evidence/evidence-example/evidence.json
data/evidence/evidence-example/source-export.csv
```

The JSON uses `filePaths: ["evidence/evidence-example/source-export.csv"]`. Commit the evidence JSON and attachment together. Do not scatter PDFs, screenshots, exports, or signatures elsewhere in `data/`.

Use the attachment command to copy a fixed file and update `filePaths` in one validated action:

```sh
npx filegrc attach EVIDENCE_ID /path/to/source-export.csv
```

It refuses symlinks, hidden destination names, and existing destination files.

Remove a local attachment explicitly before deleting its evidence record:

```sh
npx filegrc detach EVIDENCE_ID source-export.csv --yes
```

FileGRC will not delete an evidence record that still has local attachments.

Never invent evidence, dates, approvals, results, people, or source-system details. If a required fact is unavailable, leave the record in a non-final state and report the missing input.

## Scheduled and event work

```sh
npx filegrc obligations --json
npx filegrc complete OBLIGATION_ID completion-mutation.json
npx filegrc trigger EVENT_TYPE --occurred-on YYYY-MM-DD --subject RESOURCE_ID --json
npx filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD
npx filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD
```

`complete` and `complete-action` validate the expected completion type and link the new record atomically. `complete-event` refuses to close the workflow until every action has its requested proof. For hour-based deadlines use `--occurred-at` with an RFC 3339 timestamp and timezone.

## Audit work

```sh
npx filegrc prepare-audit AUDIT_ID
npx filegrc audit-readiness AUDIT_ID --json
npx filegrc evidence-packet --audit AUDIT_ID --preview --json
```

Fix readiness errors in source records. Do not edit packet output under `.filegrc/`. A delivery-ready FileGRC packet means the management checks passed; the engagement team still judges evidence and performs the examination.

## Finish every change

```sh
npx filegrc validate --json
git diff --check
git status --short
git diff
```

Review every changed JSON, Markdown, and attachment. Confirm the diff contains no secrets, temporary files, source exports with prohibited data, or derived `.filegrc/` output. Make one focused commit whose message says why the compliance record changed.
