# {{agent_title}}

## Purpose

{{agent_purpose}}

Using this repository does not establish compliance by itself. Records must match actual practice and evidence must prove that controls operated during the audit period.

## Agent quick start

Do not guess a resource type, field name, enum value, relationship, or file path. Start every unfamiliar task with the installed model:

```sh
npx filegrc guide --json
npx filegrc program-path --next --json
npx filegrc guide risk-assessment --json
npx filegrc list person --json
npx filegrc program-readiness --summary --json
```

`program-path --next --json` gives agents the current step and first action. Use `--summary` for all five step statuses or `--current` for the current step’s page summaries, detailed guidance fields, commands, and next actions. The general guide lists every supported action and record type. A type guide adds the checks needed for that resource, including timing, required and conditional fields, current relationship candidates, JSON location, and Markdown slots.

For a new record, generate a mutation envelope:

```sh
npx filegrc scaffold risk-assessment --title "2026 Annual Risk Assessment" > /tmp/risk-assessment.json
```

The scaffold contains `{ "record": ..., "content": ... }`, which is the same payload shape used by the renderer. Null values and empty required arrays are deliberate prompts. Replace all of them with facts before creation:

```sh
npx filegrc create /tmp/risk-assessment.json
npx filegrc validate --json
git diff --check
git diff
```

Read `data/AGENTS.md` before changing records. More specific instructions inside high-risk collections apply in addition to that file.

## Working rules

- Read `README.md` and run `npm run validate` before broad changes.
- Treat `data/` as the source of truth. Do not hand-edit `.filegrc/` output.
- Use UTF-8 JSON for structured records and Markdown for long-form work.
- Keep one resource in each JSON file.
- Let the local app generate IDs from each record’s name or title. When editing JSON directly, keep IDs globally unique, human-readable, and lowercase kebab-case.
- Use ISO 8601 dates and RFC 3339 timestamps.
- Store relationships as resource IDs.
- Put policies, plans, charters, procedures, meeting minutes, training, assertions, narratives, templates, and audit responses in Markdown beside their JSON records. filegrc derives the Markdown name, so records do not contain file paths.
- Put signed forms, screenshots, third-party reports, and immutable exports behind evidence records. These files may be PDF, image, CSV, or another fixed format.
- Never fetch an external evidence reference automatically.
- Do not store secrets, credentials, session data, or personal data that may need to be erased from Git history.
- Keep the editable local server on loopback or behind trusted authentication. Use the read-only static build for audit sharing.

## Source truth and derived workflow

The JSON and Markdown under `data/`, the installed model, policy content, and Git history are the inputs to FileGRC’s shared workflow calculation. Source files hold facts, decisions, relationships, dates, status, and evidence references. They do not each need a copy of the generic audit-readiness instructions or calculated TODO list.

Use `npx filegrc workflow --json` for the complete derived checklist, named readiness assessments, blockers, Work Items, and recommended next action. `guide`, `list --workflow`, `get --workflow`, mutation previews, the HTTP API, and the browser consume the same calculation. Resolve a derived finding by changing its source facts, recording a reviewed applicability decision, accepting an allowed Exception, or completing authoritative assigned work. Never add a separate TODO file or UI-only completion flag for calculated work.

FileGRC marks an item `blocked` only when named prerequisite records must be resolved first. A missing record, editable error, or management decision is `ready` when you can act on it now, even when it prevents a readiness assessment from passing.

An Action Item or Audit Request is a source record because it captures a real assignment, owner, deadline, and completion proof. A Collection Review is also a source record because FileGRC cannot infer that management reviewed an apparently complete or empty collection. `npx filegrc guide RESOURCE_TYPE --json` returns the type-specific review criteria and current confirmation state. Use `npx filegrc review-collection RESOURCE_TYPE --scaffold`, fill the conclusion and reviewer facts, preview it, then apply it with `--yes`. FileGRC calculates the collection revision and marks the confirmation stale after a reviewed record or material scope fact changes.

Other prompts and blockers remain derived. After a direct file edit, run `npm run validate`, `npx filegrc reconcile --preview --json`, and `npx filegrc workflow --json`. Reconciliation reports source transitions that may need a dated Policy Event and linked tasks. It never treats a file diff as proof that a real-world event happened. Apply a candidate only after confirming the event facts. The result must match an equivalent browser or CLI edit.

Run `npm run check:milestone` in CI. Before an assurance goal is selected it checks structural validity. It checks Evidence Readiness after a goal is selected, then Period Health after candidate coverage dates exist.

## Git is the audit trail

Git supplies file authors, commit timestamps, messages, diffs, and revisions. Do not add fields such as `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, or a second change log.

Domain events still need explicit dates. Keep values such as `occurredOn`, `scheduledFor`, `approvedOn`, `completedOn`, and audit-period dates in their records.

Use a dedicated private repository for your FileGRC workspace. The browser commits and pushes each saved program change, so a standalone repository keeps the compliance audit trail separate from application development history.

- Prefer creating or cloning FileGRC as a standalone private repository.
- Run the editable browser from the authoritative branch's main checkout.
- Do not place a new FileGRC workspace inside an application monorepo unless the organization has explicitly chosen that structure.
- If FileGRC already lives in a monorepo, do not relocate it automatically.
- In a monorepo, never include application changes in FileGRC-generated commits.
- Treat detached and feature-branch copies as read-only unless an explicit development override is active.

New workspaces use trunk repository mode with `main` as the authoritative branch and `origin` as the remote. Each browser mutation checks the whole Git worktree, fetches the remote, fast-forwards only, rechecks the edited revision, writes through the normal domain function, validates the workspace, stages only this FileGRC workspace, creates a focused commit, and pushes it. Browser onboarding commits its related Workspace, Program, System, Component, and renderer changes together.

The Repository page reports `Synced`, `Syncing`, `Not synced`, `Read-only checkout`, or `Git setup required`. Browser saves return after the validated local commit, then push in the background. Treat `Syncing` as locally durable but not yet durable on the remote, and wait for `Synced` before starting another write. A failed push keeps the local FileGRC commit and offers Retry sync when every ahead commit changes only this workspace. FileGRC never pushes an ahead commit that includes files outside this workspace, and it never merges, rebases, switches branches, resolves conflicts, or changes files outside the workspace.

Record lifecycle fields are the approval source. Draft, proposed, approved, and retired records may all live on the authoritative branch. Do not use Git branches to represent policy approval.

Manual mode requires an explicit `repositoryMode` in `data/renderer.json`. In manual mode, review the workspace diff and use the Repository controls or Git CLI. Agents and terminal users always own their Git synchronization and should pull, commit, and push directly. FileGRC does not replace repository authentication, authorization, branch protection, or review controls.

Use `npx filegrc serve --allow-non-authoritative-writes` only for local development in a task worktree. The override is visible in the UI and never commits or pushes.

Do not rewrite or remove committed records that explain prior audit periods. Close or retire them. Delete only mistakes and uncommitted drafts.

## Data model

`data/workspace.json` selects the model through `dataModelVersion`. The installed `filegrc` package owns the authoritative model. Do not copy or invent a local schema.

If the installed CLI reports that this workspace uses an unsupported model, start with:

```sh
npx filegrc migrate --to-model 3 --preview --json
```

Older workspaces migrate one version at a time. Review the v4 preview’s automatic, review-required, and unsupported classifications before applying it with the same options and `--yes`. The migration creates no approvals, holders, Evidence Artifacts, or historical dates.

The [model v4 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v4.md) explains System classification decisions, relationship changes, and required post-migration review.

Run these commands when working with records:

```sh
npm run validate
npx filegrc guide --json
npx filegrc guide risk
npx filegrc list risk --json
npx filegrc get risk-example
npx filegrc get risk-example --mutation
npx filegrc references risk-example --json
npx filegrc describe risk
npx filegrc search "access review"
npm run serve
```

Prefer existing fields. Put organization-specific values under `extensions` with a namespace owned by {{company_name}}. Add structure only when validation, filtering, relationships, due dates, or audit completeness need it. Variable procedures, interviews, observations, rationale, and detailed results belong in the record's Markdown companion.

Never change a resource ID after it is committed. Create a replacement and link the records if identity truly changes.

The local app keeps IDs out of the guided form, generates them during creation, and leaves them unchanged when a record is renamed. It presents the core model fields and relationship pickers. Use its advanced JSON section for optional fields and extensions. It rejects a save if the source file changed after the editor opened, so reload and reapply the change instead of overwriting newer work.

Headless agents get the same protection by exporting an edit payload with `filegrc get RESOURCE_ID --mutation` and passing that file to `filegrc update`.

## Renderer settings and onboarding

`data/renderer.json` stores committed renderer and repository preferences. New workspaces set `showOnboarding` to `true`, `repositoryMode` to `trunk`, `authoritativeBranch` to `main`, and `repositoryRemote` to `origin`. In trunk mode, completing or skipping onboarding commits the related change and starts its background push.

Onboarding explains the file and Git workflow, the program path, policy obligations, and Policy Events before covering report types and the final audit stage. It then collects the initial service boundary, owner, business criticality, highest data classification, internet exposure, and optional program goal. It creates or updates one `system` record, stores that selected system and the management goal on `workspace`, and creates one planned service-commitment prompt. Replace that prompt with the actual customer promise or approved service requirement before activation. Onboarding does not link controls to the service or create evidence. Selecting Type 1 or Type 2 does not create an audit engagement. Completing onboarding opens the Step 1 overview so the user can add the real reviewers and operators, finish the oversight team, and confirm the criteria, commitments, vendors, and systems before approving policies.

The renderer is optional. Agents may set `showOnboarding` to `false` and maintain all records headlessly. Restart onboarding from Repository when useful. Read-only builds never run it.

{{starter_baseline}}

Review all criteria against the actual service boundary in one explicit batch. Run `npx filegrc review-applicability --scaffold --type requirement > decisions.json`, fill every decision, then preview with `npx filegrc review-applicability decisions.json --preview --json` and apply the same file with `--yes`. Every decision needs a reviewer, date, and rationale. FileGRC records the current scope revision automatically.

## Work Queue and Policy Events

Run the same obligation planner used by the web app:

```sh
npx filegrc obligations --json
npx filegrc obligations --from 2026-01-01 --through 2026-12-31 --complete --json
```

Work Queue includes recurring obligations, Policy Event tasks, and every other open Action Item. Create an Action Item only when follow-up from a Finding, Risk, Incident, review, test, meeting, Exception, or request needs its own assignee, deadline, and completion proof. Point `sourceResourceId` to the record that produced the task. Use that source record’s Markdown for the report and observations.

A calendar obligation’s recurrence anchor starts its first allowed cycle. Unless `window` narrows that range, completion is allowed from the cycle start through the day before the next cycle, and the item becomes overdue on the next cycle’s first day. Use **Record work** in Work Queue, or create and link a completion atomically with:

```sh
npx filegrc complete obligation-id --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD > completion-record.json
# Fill the actual work, evidence, review, and any null or empty required values.
npx filegrc complete obligation-id completion-record.json
```

The scaffold includes the current obligation revision, so the second command rejects a stale Work Queue write. Keep prior completion links because the planner matches each dated record to its own period.

Event obligations are templates. Do not mark a template complete or replace it for each occurrence. Use Trigger Work on Step 4 or run:

```sh
npx filegrc trigger person-started --occurred-on 2026-07-25 --subject person-new-worker --json
npx filegrc trigger person-ended --occurred-at 2026-07-25T16:30:00-05:00 --subject person-departing-worker --json
```

Run `npx filegrc obligations` first to preview every task, owner, deadline, and requested proof for each available Policy Event. The trigger command creates one `obligation-event` and adds its full set of Action Items to the Work Queue in a single validated write. Its success output names the event, task count, task IDs, and deadlines. Hour-based deadlines require an RFC 3339 event timestamp so an immediate or 24-hour cutoff is exact. Day-based deadlines use the event’s calendar date. Link the requested completion resources and evidence to each action item, then mark the actions done and the event complete. Every generated action has a cutoff. filegrc applies a 30-day deadline when a custom event obligation omits one.

Complete an event action and link its new proof in one validated write:

```sh
npx filegrc complete-action action-item-id --scaffold --completed-on 2026-07-25 > completion-record.json
# Fill the actual work, evidence, review, and any null or empty required values.
npx filegrc complete-action action-item-id completion-record.json --completed-on 2026-07-25
npx filegrc complete-event obligation-event-id --completed-on 2026-07-25 --expected-revision REVISION
```

Completion scaffolds include the target revision. For other updates, read `REVISION` from `npx filegrc get RESOURCE_ID --mutation`. filegrc rejects a completion resource whose type does not match the obligation. It will close the event only after every action has its requested proof.

## Headless Markdown

Create and update JSON plus Markdown in one mutation envelope when practical. You can also inspect or replace a companion directly:

```sh
npx filegrc content risk-assessment risk-assessment-2026 --json
npx filegrc content risk-assessment risk-assessment-2026 --write updated-assessment.md
```

Run `filegrc guide <type>` to get slot names. Policies use `content`, meetings use `agenda` and `minutes`, and implicit long-form work uses `record`. filegrc derives the path and rejects content that does not belong to the record.

## Program readiness and the candidate period

Prepare the management program before creating an audit engagement:

```sh
npx filegrc program-readiness
npx filegrc program-readiness --require-ready --summary --json
```

The Evidence Ready gate requires:

1. A management goal, selected systems, criteria, and controls.
2. Active policies with completed text, separate management approval, real approval and effective dates, and linked controls.
3. Implemented Controls with an owner, actual procedure, scope, operation pattern, mappings, implementation date, and every required linked Work Queue schedule running.
4. Every selected Control mapped to active authoritative Systems with the required evidence source roles, current access owners, and repeatable extraction instructions in Record Markdown.

Onboarding does not create Evidence Artifacts. Complete authoritative source Components as part of Control implementation. For every incomplete family in Program Readiness, update the Control with its authoritative `evidenceSourceComponentIds`, then give each source Component the required evidence role, current access owners, and repeatable retrieval instructions in Record Markdown. Use `npx filegrc evidence-map --json` when you want only those source checks. During Step 4, create an Evidence Artifact only when a real artifact exists. Select its `sourceComponentId`, attach or reference the result, link the Controls and operating record it supports, record its collector and Classification, then have another person verify it before audit use.

When the gate passes, set `workspace.candidatePeriodStart` to the date reliable evidence collection begins. Do not backdate it. `candidatePeriodStart` and `candidatePeriodEnd` express management’s target. They do not establish the final report period.

Maintain risk assessments and the risk register while the program operates. Complete assessments on schedule and after material changes, and add or update controls when the conclusions require a different response. Audit preparation still checks for a current, independently reviewed assessment.

Record complementary customer or subservice controls after the internal control set is defined. `complementary-control.relatedControlIds` is the source of truth for those links. filegrc derives the reverse connections for Control pages and evidence packets.

## Audit preparation and evidence packets

After engaging a CPA firm, create one audit record and set the firm-agreed Type 1 date or Type 2 period. Then initialize the engagement-specific management work:

```sh
npx filegrc prepare-audit audit-2026-type-2
npx filegrc audit-readiness audit-2026-type-2
npx filegrc audit-readiness audit-2026-type-2 --require-ready --json
```

The audit record’s `typeOneAsOf`, `periodStart`, and `periodEnd` are the dates agreed with the CPA firm. Keep the workspace candidate dates even when the formal period differs.

{{audit_preparation_guidance}}

Review both evidence paths against the exact firm-agreed date or period:

1. filegrc Evidence consists of dated Step 4 operating records. Complete each applicable record, link it to the Controls it supports, record the result in structured fields or Markdown, and link any external artifact needed to support that result.
2. Evidence Artifacts are verified `evidence` records from authoritative Components. Confirm the source Component, audit date or period, Control links, collector, verifier, and fixed attachment or approved external reference.

Audit Readiness reports coverage for both paths. The packet includes the matching filegrc records and Markdown with Git history, plus Evidence Artifacts, retained attachments, delivery indexes, and checksums.

Near the end of fieldwork, link a verified fixed-format copy of the signed management representation letter to its engagement-specific document. Date it on or after the Type 1 date or Type 2 period end. A representation that is still marked for later blocks packet delivery.

Catalog each authoritative source as a Component and assign its `evidenceSourceKinds`. A third-party application is a Component when it supports a bounded System, a Control, Evidence, or relevant operations. Create a separate Vendor for its provider and connect the Component through `vendorId`; keep contracts, due diligence, and supplier risk on the Vendor. Name the people who can access reports and keep extraction instructions in the Component's Record Markdown. For each Type 2 population, select one source Component and export the exact audit period. Split a population when different Components or queries produce its items. Link a verified `population-export` Evidence Artifact that names the same source Component and stores the query or report parameters, generation time, timezone, count, completeness check, and accuracy check. A zero count still requires the source export and query. A population linked to an in-scope Control cannot be marked not applicable.

Every Evidence Artifact names its collector. Verified Evidence Artifacts also name their verifier and verification date. Use `sourceComponentId` for source exports, `sourceResourceIds` for FileGRC records, and `sourceCommit` to bind the Evidence Artifact to repository state.

Preview coverage before writing output:

```sh
npx filegrc evidence-packet --audit audit-2026-type-2 --preview --json
npx filegrc evidence-packet --audit audit-2026-type-2
npx filegrc evidence-packet --audit audit-2026-type-2 --preview --require-ready
```

The packet includes records explicitly related to the selected engagement, its bounded Systems, Controls, criteria, policies, Evidence, and dependencies. It does not include unrelated dated records from the workspace. A Type 2 packet adds filegrc Evidence, recurring obligation occurrences, event workflows, and management population reconciliations. Output includes a control matrix with separate filegrc Evidence and Evidence Artifact columns, source-Component index, Evidence Artifact delivery index, population index, evidence index, committed historical source versions, and SHA-256 checksums. Output under `.filegrc/evidence-packets/` is derived and must not be hand-edited or committed.

Treat a packet as ready for management delivery only when its status is `delivery-ready`, its review list is clear, and its manifest names a clean Git revision. This means filegrc's management checks passed. It does not mean the engagement team found the evidence sufficient or appropriate. The generator copies raw records, Markdown, and local fixed attachments. It never fetches external references. Reconcile `external-evidence-index.csv` to the auditor portal or other approved delivery system before telling the engagement team that submission is complete.

Link a control test to its `audit-population` record when sampling applies. Link item-level sample evidence separately. Management owns population completeness and accuracy. The auditor owns sample selection, independent testing, exception evaluation, and the report opinion. The auditor or publisher also supplies the authoritative criteria and examination guidance. filegrc stores references and orientation text, not licensed criteria.

## Content and approvals

The initial program lead is {{policy_owner_name}}, {{policy_owner_job_title}}, at {{policy_owner_email}}. The separate Policy Owner Appointment records this person’s starting program authority, and the security reporting address is {{security_contact_email}}. Update the Person when their organizational position changes. End and replace Appointments when named authority moves to someone else.

Appoint an independent management reviewer during policy review, not as a condition of defining the service boundary. The reviewer must be separate from the policy owner and able to challenge the owner’s decisions. Assign another internal leader or manager when a suitable reviewer is available. Otherwise, appoint a qualified external reviewer. The reviewer chairs Security and Risk Oversight and approves policies and governed documents.

To appoint an internal reviewer, create or update that Person and set the planned Independent Policy Reviewer Appointment’s `holderId`, scope, start date, responsibilities, and independence rationale before making it active. When no suitable internal reviewer is available, include the reviewer’s real organizational job title, organization, start date, and independence rationale in `reviewer.json`, then preview the external-reviewer bundle before applying it:

```sh
npx filegrc external-reviewer-setup --scaffold > reviewer.json
# Replace the null values with the reviewer's current facts and independence rationale.
npx filegrc external-reviewer-setup reviewer.json --preview --json
npx filegrc external-reviewer-setup reviewer.json --yes --json
```

The management reviewer and CPA auditor are different roles. Do not assign the CPA firm management or approval work without first confirming the firm's independence requirements.

Policy and training attestations must identify the exact Git revision of the content that a person acknowledged. Store signatures as evidence attachments and link their evidence IDs from the attestation.

Committee and risk meeting minutes are `meeting` resources with a primary Markdown companion. An optional `-agenda.md` companion holds the agenda. Record attendees, decisions, and risks discussed on the Meeting. When follow-up needs separate tracking, create an `action-item` whose `sourceResourceId` points to the Meeting.

## Audit evidence

A rendered-page evidence capture must identify:

- The route and filters shown
- The audit or evidence period
- The exact Git commit
- The capture timestamp and method
- The source resource IDs
- The screenshot or fixed export

Commit the evidence record and attachment together. Do not claim that a current page proves a prior period unless it is rendered from or bound to the correct revision.

## Validation

After substantive edits:

1. Run `npm run validate`.
2. Review JSON and Markdown diffs.
3. Check every new relationship and attachment.
4. Confirm dates describe the business event, not the edit time.
5. Run `npm run build` when producing a read-only audit view.

Do not loosen validation to make a bad record pass. Fix the record or update the installed engine through its normal versioned model process.
