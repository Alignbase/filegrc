# Upgrade a workspace to data model v2

Model v2 removes fields and behaviors that model v1 kept for older workspaces. The migration changes workspace files but does not commit them.

Start from a clean Git worktree on the branch where you maintain the FileGRC workspace. Install the new `filegrc` package version, then preview the complete migration:

```sh
npx filegrc migrate --to-model 2 --preview --json
```

Review `missing`, `conflicts`, and `manualActions`. The preview is ready when `ready` is `true`. A former `Policy Owner` Person needs their actual organization job title and the date their Policy Owner Appointment began:

```sh
npx filegrc migrate \
  --to-model 2 \
  --preview \
  --job-title "ACTUAL JOB TITLE" \
  --starts-on YYYY-MM-DD \
  --json
```

For any other value in the removed Person `role` field, decide whether it was an organization job title, a named Appointment, or both. Update the Person and create the Appointment before rerunning the preview.

When the preview is ready, apply the same options with `--yes`:

```sh
npx filegrc migrate \
  --to-model 2 \
  --job-title "ACTUAL JOB TITLE" \
  --starts-on YYYY-MM-DD \
  --yes \
  --json
```

The command performs one atomic batch. It:

- Moves Person team links to `team.memberIds`.
- Moves reverse System, Requirement, Control, Policy, Vendor, Audit, Control Test, and External Evidence links to their authoritative records.
- Converts the former Policy Owner seed role into a dated Appointment.
- Sets missing repository settings to the prior manual behavior.
- Rewrites stored `scope:complementary-control` program-page completion to `controls:complementary-control`.
- Removes obsolete evidence collection-test fields without deleting the Evidence record.
- Converts `evidenceKind` and `source` to the discriminated External Evidence provenance fields.
- Converts Action Item deadline fields to one `completionWindow`.
- Converts Control `frequency` to `operationPattern`.
- Converts structured calendar cadence fields to Obligations when the source record has enough information.
- Consolidates program scope in `workspace.systemIds` and removes `system.inScope`.
- Converts audit, evidence, review, population, page-capture, and candidate dates to discriminated `coverage` objects.
- Removes per-Obligation completion-type lists and checks activity and Policy Event IDs against the model registries.
- Checks each Obligation activity’s allowed recurrence mode and scope resource types.
- Checks each Policy Event subject’s resource type and cardinality.
- Converts event deadlines to a date- or timestamp-precision `window`.
- Binds existing Policy and governed Document approvals to the current companion Markdown revisions for review.
- Binds completed Git approvals in Attestations to the current subject Markdown revisions for review.
- Separates scheduled dates from actual completion dates on reviews, assessments, and Backup Tests.
- Requires completed operating records to name their completion date or time, actors, result, evidence, review, and coverage where applicable.
- Normalizes Access Grant request, approval, provisioning, and deprovisioning facts and removes `subjectKind`.
- Converts Risk acceptance and Exception approval or resolution fields into decision objects.
- Removes stored Attestation `overdue` state and derives it from a pending record’s `dueOn`.
- Requires actual Person IDs for actors who approved, performed, verified, collected, or attested to work.
- Requires accepted Findings and risk-accepted Vulnerabilities to link the approved Exception that authorizes the decision.
- Requires canceled work to retain the canceling People, cancellation date, and reason in one `cancellation` object.
- Derives External Evidence expiry from `expiresOn` and requires withdrawals to name the acting People, date, and reason.
- Uses Audit Population `status` for workflow and `conclusion` for complete, complete-with-exceptions, or incomplete results.
- Requires material inactive, ended, deprecated, retired, superseded, lost, disposed, not-applicable, closed, archived, and terminated transitions to retain an actor, date, and reason.
- Requires terminal Meeting, Incident, Audit, Audit Request, and Data Request records to retain their completion proof.
- Rejects parent and supersession cycles plus duplicate active Appointments and Access Grants.
- Removes the unused inline Audit `auditor` and `assessmentCoverage` structures.
- Converts a one-Vendor `vendorIds` array to `vendorId`; multi-Vendor reviews require manual splitting.
- Splits Person lifecycle `status` from `affiliation`.
- Splits Vendor Review and Backup Test workflow status from their decision or outcome.
- Renames classification fields to `classificationId`, normalizes Workspace classification IDs, and validates every reference.
- Removes `workspace.repositoryUrl`; Git remains the repository authority.
- Converts acknowledgement-document `relatedResourceIds` that point only to Training into `trainingIds`.
- Removes the redundant `schemaVersion` key from every record.
- Sets `dataModelVersion` to `2` and validates the complete workspace.

## Review the breaking field changes

Model v2 rejects unknown top-level record fields and unknown keys inside model-defined nested objects. Move organization-specific data under `extensions`, using a lowercase namespace owned by your organization:

```json
{
  "extensions": {
    "example.company": {
      "customField": "value"
    }
  }
}
```

The migration reports generic `ownerIds` on record types that no longer have a meaningful owner. Move those IDs to the type-specific field that states the real role, such as an assignee, collector, performer, reviewer, approver, or accountable party.

The common `relatedResourceIds` field is gone. Replace each remaining use with the field that states what the relationship means. The migration converts acknowledgement Documents that point only to Training into `trainingIds`; every ambiguous use is a `manualAction`.

Relationship fields now use explicit model-defined resource groups. If a reference has the wrong type, move it to the field whose meaning matches the relationship. No model-v2 relationship accepts an unrestricted wildcard.

### Mutation revisions

Updates now require the current record revision. If an update replaces existing Markdown, it also requires that file’s current revision. Export the complete edit payload instead of constructing an update from an old record:

```sh
npx filegrc get RESOURCE_ID --mutation > mutation.json
npx filegrc update RESOURCE_TYPE RESOURCE_ID mutation.json --json
```

Commands that change an existing record outside that envelope, including `complete`, `complete-action`, `complete-event`, `attach`, `detach`, and `delete`, require `--expected-revision`. Read the current revision with `filegrc get RESOURCE_ID --mutation`. Browser and HTTP updates enforce the same stale-write checks.

### External Evidence provenance

External Evidence now separates what the artifact is from where it came from:

```json
{
  "artifactKind": "system-export",
  "artifactSubtype": "access-review-export",
  "sourceKind": "system",
  "sourceDescription": "Quarterly access report",
  "sourceSystemId": "system-identity"
}
```

`artifactKind` is one of `population-export`, `system-export`, `configuration-export`, `capture`, `signed-record`, `third-party-report`, `rendered-page`, `business-record`, or `other`. Use `artifactSubtype` for a narrower organization or provider-specific label.

`sourceKind` is one of:

- `system`, which requires `sourceSystemId` after draft.
- `file`, which requires at least one `filePaths` attachment after draft.
- `external-reference`, which requires `externalReference` after draft.
- `rendered-page`, which requires `capture` and `sourceCommit` after draft.
- `authored-record`, which requires Evidence Markdown after draft.

The migration maps known v1 `evidenceKind` values. Unknown values become `artifactKind: "other"` with the old value preserved in `artifactSubtype`. A rendered-page record without its capture metadata or Git revision appears in `missing`.

### Schedules

Obligations are the only schedule authority in model v2. The migration removes `meetingCadence`, `reviewCadence`, Training `recurrence`, and the old next-review constraint fields. It creates an Obligation automatically from a complete calendar recurrence. If the old value cannot produce an owned, dated Obligation without guessing, the preview adds a `manualAction`.

Controls now use `operationPattern` with `continuous`, `event-driven`, `scheduled`, or `mixed`. This describes how the Control operates; it does not store a schedule. Implemented scheduled, event-driven, and mixed Controls must link an active Obligation.

Each Obligation `activityType` must exist in the model-owned obligation activity registry. The registry supplies the default completion record and the accepted completion record types, so remove `completionResourceTypes` from individual records. Each event recurrence must also use a registered Policy Event ID.

The activity registry also limits recurrence modes and the resource types allowed in `scopeResourceIds` and `templateResourceId`. The preview reports any old combination that needs a different activity or scope.

Each Policy Event declares subject rules. For example, a worker departure requires exactly one Person, a Vendor reassessment requires exactly one Vendor, and a material System change requires exactly one System. Fix every `subjectResourceIds` action before applying the migration.

Event deadlines use one unit:

```json
{
  "window": {
    "precision": "date",
    "startsAfter": 0,
    "dueAfter": 30
  }
}
```

Use `precision: "timestamp"` when the offsets are hours. A window cannot mix day and hour offsets.

### Scope, coverage, people, and classifications

Select every program-scope System in `workspace.systemIds`. `system.inScope` no longer exists, which means there is one authoritative scope list.

Use a discriminated coverage object wherever a record describes a point-in-time or period:

```json
{ "coverage": { "kind": "as-of", "on": "2026-07-31" } }
```

```json
{
  "coverage": {
    "kind": "range",
    "startsOn": "2026-01-01",
    "endsOn": "2026-06-30"
  }
}
```

The Workspace uses `candidateCoverage`. Rendered-page capture metadata also uses `capture.coverage`.

Person `status` is now `active` or `inactive`. Store whether the person belongs to the organization in `affiliation`, which is `internal` or `external`. The migration converts the former `status: "external"` value to `status: "active"` with `affiliation: "external"`.

Fields that prove who performed, approved, verified, collected, waived, or attested to work now accept Person IDs only. Keep Teams and Appointments in accountable fields such as `ownerIds`, because those fields assign authority rather than prove who acted.

Accepted Findings and risk-accepted Vulnerabilities now use `exceptionId` instead of incomplete inline acceptance facts. Select an approved Exception that records its approvers, date, rationale, expiry, scope, and compensating Controls. Remediated and closed Vulnerabilities require the remediation date, verifier, verification date, and Evidence. False positives require a rationale and verifier.

Canceled Policy Events, Control Tests, Action Items, Policy Reviews, Meetings, Risk Assessments, Vendor Reviews, Access Reviews, Exercises, Backup Tests, Penetration Tests, and Data Requests use:

```json
{
  "cancellation": {
    "canceledByIds": ["person-reviewer"],
    "canceledOn": "2026-08-02",
    "reason": "The planned work was replaced by a different scoped activity."
  }
}
```

The migration reports canceled v1 records that need these facts. It does not invent an actor or reason.

External Evidence no longer stores `status: "expired"`. It remains `collected` or `verified`, and FileGRC reports it as expired after `expiresOn`. A deliberate `status: "withdrawn"` uses a `withdrawal` object with `withdrawnByIds`, `withdrawnOn`, and `reason`. The migration converts a stored expired state when `expiresOn` is present and reports the missing date otherwise.

Audit Populations no longer use `status: "incomplete"`. A completed reconciliation uses `status: "reconciled"` and records the result in `conclusion`, including `conclusion: "incomplete"`. The migration moves the old state and reports any reconciliation proof that is still missing.

Material lifecycle changes on People, Appointments, Service Accounts, Teams, Systems, Assets, Documents, Obligations, Frameworks, Commitments, Complementary Controls, Controls, Policies, Training, Risks, and Vendors use:

```json
{
  "statusTransition": {
    "changedByIds": ["person-reviewer"],
    "changedOn": "2026-08-02",
    "reason": "The record was retired after its replacement became active."
  }
}
```

This object records the business event that changed the current state. Git still records who edited the file and when, but it does not replace the business actor, effective date, or decision reason. The migration reports terminal v1 records that need these facts.

A Team that has not been activated yet uses `status: "planned"`. Use `status: "inactive"` only after an active Team stops operating, with its `statusTransition`.

Vendor Reviews use `planned`, `in-progress`, `complete`, or `canceled` for workflow status. A complete review stores `decision` as `approved`, `conditional`, or `rejected`. Backup Tests use the same workflow pattern and store `passed` or `failed` in `outcome`.

Each Vendor Review now uses one `vendorId`. The migration converts a one-item `vendorIds` array. Split a review with multiple Vendors into separate records so each Vendor has its own decision, coverage, evidence, and follow-up.

Systems, Assets, Documents, External Evidence, Vendors, and Incidents use `classificationId`. Each value must be a key in `workspace.classificationDefinitions`. The migration normalizes existing definition names to lowercase kebab-case IDs and reports collisions or unknown values for review.

### Approvals and completed work

Approved Policies and governed Documents store `approvedContentRevisions`, keyed by companion Markdown path. FileGRC checks each SHA-256 revision during normal validation. Editing bound Markdown without moving the record back to draft or review fails, so the approved status cannot silently carry across a content change.

The migration binds an old approval to the Markdown that exists at migration time and adds a note for review. Confirm that this is the content the named approvers approved. If it is not, move the record back to draft or review, correct the content, then approve it again.

Policy Reviews, Vendor Reviews, Access Reviews, Risk Assessments, and Backup Tests now separate `scheduledFor` from actual completion:

| Model v1 field | Model v2 field while planned or in progress | Model v2 field when complete |
| --- | --- | --- |
| `policy-review.reviewedOn` | `scheduledFor` | `completedOn` |
| `vendor-review.reviewedOn` | `scheduledFor` | `completedOn` |
| `access-review.reviewDate` | `scheduledFor` | `completedOn` |
| `risk-assessment.assessmentDate` | `scheduledFor` | `completedOn` |
| `backup-test.testDate` | `scheduledFor` | `completedAt` |

The migration chooses the destination from the record’s workflow status. A complete operating record must also include the model-defined performer or reviewer, result, supporting Evidence, coverage, and approval fields. The preview lists missing values instead of inventing them. Completion and review dates must be ordered correctly, and terminal-only fields are rejected before the record reaches its terminal status.

Access Grants no longer store `subjectKind`; FileGRC reads the type from `subjectId`. Every grant stores `requestedOn`. Approved grants also name the approving People and date, active grants add the provisioning People and timestamp, and revoked or expired grants add a deprovisioning timestamp and reason.

Risk acceptance is one `acceptance` object with rationale, approving People, approval date, and expiry date. Exception approval and resolution use separate `approval` and `resolution` objects. The migration converts complete flat decisions and reports missing decision facts rather than guessing.

Completed Attestations require `completedOn` and `attestationMethod`. Git approvals bind the exact subject Markdown files in `contentRevisions`; signed and external approvals link Evidence. Waivers name the People who waived the assignment and preserve a reason. A pending Attestation remains stored as `pending`; FileGRC reports it as overdue after `dueOn`.

Completed Meetings store `startedAt`, `endedAt`, attendees, and minutes. Closed Incidents require their declared, containment, eradication, recovery, and closure timestamps plus Evidence and Record Markdown. Audit fieldwork requires its CPA Vendor and fieldwork dates, and a complete Audit links the report Evidence and conclusion dates. Submitted and closed Audit Requests and completed Data Requests likewise retain their dated response and Evidence.

Accepted Audit Requests name the People who confirmed acceptance. Completed or denied Data Requests name the People who made the decision. Planned Control Tests and Penetration Tests use `scheduledFor`, matching the other scheduled operating records.

Model v2 also rejects cycles in Person managers, System parents, Requirement parents, Commitment supersession, Policy parents and supersession, Document supersession, and backup Vendors. It rejects duplicate active Appointments for the same authority and scope, and duplicate active Access Grants for the same subject, System, access level, role, and privilege flag. Resolve every reported relationship before applying the migration.

### Action Item deadlines

The migration replaces `dueOn`, `dueWindowStart`, `dueWindowEnd`, `overdueOn`, and their timestamp variants with one discriminated object:

```json
{
  "completionWindow": {
    "precision": "date",
    "startsOn": "2026-08-01",
    "dueOn": "2026-08-15",
    "overdueOn": "2026-08-16"
  }
}
```

Hour-based deadlines use `precision: "timestamp"` with `startsAt`, `dueAt`, `overdueAt`, and an IANA `timezone`.

A workspace must explicitly declare `dataModelVersion`; the migration does not guess when that field is missing.

CLI and HTTP creates and updates now require one mutation envelope:

```json
{
  "record": {
    "id": "person-reviewer",
    "type": "person",
    "title": "Reviewer",
    "status": "active",
    "affiliation": "internal"
  },
  "content": {},
  "revision": "REVISION WHEN UPDATING",
  "contentRevisions": {}
}
```

Use `npx filegrc scaffold RESOURCE_TYPE --title "Human name"` to create an envelope. Use `npx filegrc get RESOURCE_ID --mutation` before an update so the payload includes the current revision hashes. Raw record objects are no longer accepted by `filegrc create`, `filegrc update`, `POST /api/resources`, or `PUT /api/resource/:type/:id`.

Review any former collection-test draft named in `notes`. Keep it as normal External Evidence when it represents real work, mark it withdrawn when history should remain, or delete it only when it is a mistake or uncommitted draft.

After the migration:

```sh
npm run validate
git diff -- data
```

Review every changed record, commit the migration with a clear message, and push it through the repository’s normal review process. Rerunning the migration after success is safe and makes no changes.
