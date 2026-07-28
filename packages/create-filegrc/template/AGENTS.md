# filegrc SOC 2 Workspace Instructions

## Purpose

This repository is {{company_name}}’s filegrc workspace for its SOC 2 program. Engineers and agents maintain the source records under `data/`. The `filegrc` package validates, searches, edits, and renders those files.

Using this repository does not establish compliance by itself. Records must match actual practice and evidence must prove that controls operated during the audit period.

## Agent quick start

Do not guess a resource type, field name, enum value, relationship, or file path. Start every unfamiliar task with the installed model:

```sh
npx filegrc guide --json
npx filegrc program-path --json
npx filegrc guide risk-assessment --json
npx filegrc list person --json
npx filegrc program-readiness --json
```

`program-path` gives agents the same six-step order, exact page Instructions, Use, Policy Basis, commands, current state, and next actions shown in the renderer. The general guide lists every supported action and record type. A type guide repeats that page guidance and adds timing, required and conditional fields, current relationship candidates, JSON location, and Markdown slots.

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

## Git is the audit trail

Git supplies file authors, commit timestamps, messages, diffs, and revisions. Do not add fields such as `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, or a second change log.

Domain events still need explicit dates. Keep values such as `occurredOn`, `approvedOn`, `reviewedOn`, `completedOn`, and audit-period dates in their records.

Make focused commits with messages that explain the reason for the change. The engine never creates commits automatically. Review the workspace diff, then use the commit action on Repository or the Git CLI. The renderer validates the workspace and requires an explicit message before it creates a commit.

Pull before starting work when other people or agents may have changed the repository. Without a remote, the browser's Repository page creates a local commit and hides synchronization actions. With a remote, it pulls with rebase, refuses to pull over uncommitted files, and pushes immediately after it creates a commit. Agents and terminal users own Git synchronization and should run `git pull --rebase`, `git commit`, and `git push` directly. Do not create merge commits for routine synchronization.

Do not rewrite or remove committed records that explain prior audit periods. Close or retire them. Delete only mistakes and uncommitted drafts.

## Data model

`data/workspace.json` selects the model through `dataModelVersion`. The installed `filegrc` package owns the authoritative model. Do not copy or invent a local schema.

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

`data/renderer.json` stores committed renderer preferences. New workspaces set `showOnboarding` to `true`. Completing or skipping onboarding sets it to `false`; the app does not commit that change.

Onboarding explains the file and Git workflow, the program path, policy obligations, and Policy Events before covering report types and the final audit stage. It then collects the initial service boundary, owner, business criticality, highest data classification, internet exposure, and optional program goal. It creates or updates a `system` record and stores the management goal and program scope on `workspace`. Selecting Type 1 or Type 2 does not create an audit engagement. Completing onboarding opens the Step 1 overview so the user can confirm the starter people and oversight team, criteria, commitments, vendors, and systems before approving policies.

The renderer is optional. Agents may set `showOnboarding` to `false` and maintain all records headlessly. Restart onboarding from Repository when useful. Read-only builds never run it.

## Starter baseline

The generated workspace starts with the SOC 2 Security category:

- Active framework records for the 2017 Trust Services Criteria with revised points of focus (2022) and the 2018 SOC 2 Description Criteria with revised implementation guidance (2022)
- The 33 Common Criteria reference IDs from CC1.1 through CC9.2, without the licensed criteria text
- The nine Description Criteria reference IDs from DC1 through DC9, without the licensed criteria text
- Planned controls mapped to those references and the included policies
- A security and risk oversight team chaired by an independent reviewer who may be internal or external
- Recurring obligations for the reviews, scans, tests, training, and meetings required by the included policies
- A default 5x5 risk method and Public, Internal, Confidential, and Restricted data classifications

Treat every planned control as a proposal until its owner, actual procedure in Record Markdown, system scope, cadence, authoritative evidence sources, implementation date, and mappings match actual practice. For a control linked to filegrc obligations, every non-retired Work Queue schedule must be enabled and its governing policies effective. Marking the control implemented starts eligible schedules. Do not mark a control implemented because a policy describes it. Add Availability, Processing Integrity, Confidentiality, or Privacy criteria only when they are in scope.

The recurring obligations mirror the fixed cadences in the starter policies. They remain proposals until every governing policy is active and effective and, when they name controls, at least one linked control is implemented. Update the policy, control, and obligation together when an approved cadence changes. Create separate completion records, such as meetings, reviews, scans, tests, exercises, and attestations, for each period.

## Work Queue and Policy Events

Run the same obligation planner used by the web app:

```sh
npx filegrc obligations --json
npx filegrc obligations --from 2026-01-01 --through 2026-12-31 --complete --json
```

Work Queue includes recurring obligations, Policy Event tasks, and every other open Action Item. Create an Action Item only when follow-up from a Finding, Risk, Incident, review, test, meeting, Exception, or request needs its own assignee, deadline, and completion proof. Point `sourceResourceId` to the record that produced the task. Use that source record’s Markdown for the report and observations.

A calendar obligation’s recurrence anchor starts its first allowed cycle. Unless `window` narrows that range, completion is allowed from the cycle start through the day before the next cycle, and the item becomes overdue on the next cycle’s first day. Use **Record work** in Work Queue, or create and link a completion atomically with:

```sh
npx filegrc complete obligation-id completion-record.json
```

Keep prior completion links because the planner matches each dated record to its own period.

Event obligations are templates. Do not mark a template complete or replace it for each occurrence. Use Trigger Work on Step 5 or run:

```sh
npx filegrc trigger person-started --occurred-on 2026-07-25 --subject person-new-worker --json
npx filegrc trigger person-ended --occurred-at 2026-07-25T16:30:00-05:00 --subject person-departing-worker --json
```

Run `npx filegrc obligations` first to preview every task, owner, deadline, and requested proof for each available Policy Event. The trigger command creates one `obligation-event` and adds its full set of Action Items to the Work Queue in a single validated write. Its success output names the event, task count, task IDs, and deadlines. Hour-based deadlines require an RFC 3339 event timestamp so an immediate or 24-hour cutoff is exact. Day-based deadlines use the event’s calendar date. Link the requested completion resources and evidence to each action item, then mark the actions done and the event complete. Every generated action has a cutoff. filegrc applies a 30-day deadline when a custom event obligation omits one.

Complete an event action and link its new proof in one validated write:

```sh
npx filegrc complete-action action-item-id completion-record.json --completed-on 2026-07-25
npx filegrc complete-event obligation-event-id --completed-on 2026-07-25
```

filegrc rejects a completion resource whose type does not match the obligation. It will close the event only after every action has its requested proof.

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
npx filegrc program-readiness --require-ready --json
```

The Evidence Ready gate requires:

1. A management goal, selected systems, criteria, and controls.
2. Active policies with completed text, separate management approval, real approval and effective dates, and linked controls.
3. Implemented controls with an owner, actual procedure, scope, cadence, evidence source, mappings, implementation date, and every eligible linked Work Queue schedule running.
4. Active authoritative systems with evidence source roles, access owners, and repeatable extraction instructions in Record Markdown.
5. A verified `test-export` or `test-capture` evidence record for each selected control family that relies on evidence from outside filegrc.

Completing onboarding creates draft External Evidence records only for evidence that must come from other systems and does not already have a dedicated Step 5 record. filegrc-managed records, such as risk assessments, meetings, vendor reviews, attestations, vulnerability scans, penetration tests, backup tests, exercises, exceptions, and findings, do not need a separate collection test. Put any fixed external artifact in an External Evidence record and link it from the operating record. For each generated draft, choose its authoritative source System, attach or reference the real result, record its collector and classification, then have another person verify it. Run `npx filegrc evidence-test-drafts` to create any drafts needed after the control set changes.

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

Preparation creates a separate system description, management assertion, and management representation document for the engagement from the local starter templates. Type 2 preparation also creates a period completeness statement and one `audit-population` record for each standard population. It is safe to run again and does not approve documents, mark controls implemented, or create evidence. Do not reuse one completed management document across engagements.

Review both evidence paths against the exact firm-agreed date or period:

1. filegrc Evidence consists of dated Step 5 operating records. Complete each applicable record, link it to the Controls it supports, record the result in structured fields or Markdown, and link any external artifact needed to support that result.
2. External Evidence consists of verified `evidence` records from authoritative Systems. Confirm the source System, audit date or period, Control links, collector, verifier, and fixed attachment or approved external reference.

Audit Readiness reports coverage for both paths. The packet includes the matching filegrc records and Markdown with Git history, plus External Evidence records, retained attachments, delivery indexes, and checksums.

Near the end of fieldwork, link a verified fixed-format copy of the signed management representation letter to its engagement-specific document. Date it on or after the Type 1 date or Type 2 period end. A representation that is still marked for later blocks packet delivery.

Catalog each authoritative source under Systems and assign its `evidenceSourceKinds`. A third-party application is still a System because it operates controls or produces evidence. Create a separate Vendor for its provider and connect the System through `vendorId`; keep contracts, due diligence, and supplier risk on the Vendor. Name the people who can access system reports and keep extraction instructions in the System's Record Markdown. For each Type 2 population, select one source system and export the exact audit period. Split a population when different systems or queries produce its items. Link a verified `population-export` evidence record that names the same source system and stores the query or report parameters, generation time, timezone, count, completeness check, and accuracy check. A zero count still requires the source export and query. A population linked to an in-scope control cannot be marked not applicable.

Every evidence record names its collector. Verified evidence also names its verifier and verification date. Use `sourceSystemId` for system exports, `sourceResourceIds` for filegrc records, and `sourceCommit` to bind the evidence to repository state.

Preview coverage before writing output:

```sh
npx filegrc evidence-packet --audit audit-2026-type-2 --preview --json
npx filegrc evidence-packet --audit audit-2026-type-2
npx filegrc evidence-packet --audit audit-2026-type-2 --preview --require-ready
```

The packet includes records explicitly related to the selected engagement, its systems, controls, criteria, policies, evidence, and dependencies. It does not include unrelated dated records from the workspace. A Type 2 packet adds filegrc Evidence, recurring obligation occurrences, event workflows, and management population reconciliations. Output includes a control matrix with separate filegrc Evidence and External Evidence columns, source-system index, external-evidence delivery index, population index, evidence index, committed historical source versions, and SHA-256 checksums. Output under `.filegrc/evidence-packets/` is derived and must not be hand-edited or committed.

Treat a packet as ready for management delivery only when its status is `delivery-ready`, its review list is clear, and its manifest names a clean Git revision. This means filegrc's management checks passed. It does not mean the engagement team found the evidence sufficient or appropriate. The generator copies raw records, Markdown, and local fixed attachments. It never fetches external references. Reconcile `external-evidence-index.csv` to the auditor portal or other approved delivery system before telling the engagement team that submission is complete.

Link a control test to its `audit-population` record when sampling applies. Link item-level sample evidence separately. Management owns population completeness and accuracy. The auditor owns sample selection, independent testing, exception evaluation, and the report opinion. The auditor or publisher also supplies the authoritative criteria and examination guidance. filegrc stores references and orientation text, not licensed criteria.

## Content and approvals

The seed policy owner is {{policy_owner_name}} at {{policy_owner_email}}, and the security reporting address is {{security_contact_email}}. Replace ownership or contacts when responsibilities change.

Appoint an independent management reviewer during policy review, not as a condition of defining the service boundary. The reviewer must be separate from the policy owner and able to challenge the owner’s decisions. Most organizations assign another internal leader or manager. An external reviewer is also allowed, and a one-person company needs one because no second internal person is available. The reviewer chairs Security and Risk Oversight and approves policies and governed documents.

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
