# filegrc Architecture and Delivery Plan

## Status

The first end-to-end implementation is in place. Model v1, validation, Git metadata, search, filtering, atomic CRUD, policy obligations, Policy Events, evidence packets, the local web app, static builds, onboarding, the generator, a minimal SOC 2 Security Policy, training, attestations, and tests all run from this monorepo.

Later passes can add licensed framework content, deeper control mappings, and guided evidence capture.

## Product

filegrc is a Git-native GRC workspace for SOC 2 programs. Engineers and agents maintain plain files, while a small Node.js engine renders an audit overview and provides validation, search, filtering, and CRUD utilities.

The system has three layers:

1. Files under `data/` hold canonical GRC records.
2. Git records who changed those files, when they changed, why they changed, and exactly what changed.
3. The `filegrc` package validates and renders the current files together with their Git history.

There is no application database. A fresh clone contains the complete current record set and its available audit trail.

## Scope

The project manages:

- Governance documents and approvals
- Control definitions, mappings, tests, and evidence
- Service commitments, system requirements, and complementary controls
- Risk, vendor, asset, access, vulnerability, and incident registers
- Recurring reviews, exercises, training, and follow-up work
- Audit periods, requests, evidence, findings, and status

The project does not replace operational security systems. Organizations still need appropriate identity, infrastructure logging, alerting, endpoint, backup, deployment, vulnerability, and incident-detection controls. This repository can record those systems and their evidence.

## Monorepo

```text
/
├── AGENTS.md
├── README.md -> packages/create-filegrc/template/README.md
├── docs/
│   ├── architecture.md
│   └── data-model.md
├── package.json
└── packages/
    ├── filegrc/
    │   ├── package.json
    │   ├── bin/
    │   ├── model/
    │   │   ├── index.js
    │   │   ├── v1.json
    │   │   └── v2.json
    │   ├── src/
    │   └── test/
    └── create-filegrc/
        ├── package.json
        ├── src/
        ├── test/
        ├── template-parameters.json
        └── template/
            ├── README.md
            ├── AGENTS.md
            ├── package.json
            ├── data/
            └── docs/
                ├── filegrc-home.png
                └── filegrc-audit.png
```

The template README is the source for the monorepo root README. Root `docs/` symlinks expose its screenshots without copying them.

## Package responsibilities

### `filegrc`

`filegrc` is a zero-dependency Node.js package with no build step. It owns:

- The authoritative, versioned GRC data model
- Data discovery and parsing
- Schema and relationship validation
- Git history queries
- Search and filtering
- Safe file creation, editing, and deletion
- Model-driven agent guides and record scaffolds
- Revision-safe JSON and Markdown mutation exports
- Evidence attachment and removal utilities
- Local HTTP serving
- Static audit-overview generation
- Recurring and event-driven obligation planning
- Program readiness and evidence-source test checks
- Audit-period evidence packet generation
- HTML, CSS, and browser JavaScript assets

Commands:

```text
Discovery:    help, version, model, types, describe, guide
Read:         list, get, search, references, content
Write:        scaffold, create, update, content, attach, detach, delete
Program work: obligations, complete, trigger, complete-action, complete-event, program-readiness
Audit work:   prepare-audit, audit-readiness, evidence-packet
Rendering:    serve, build
Verification: validate
```

`filegrc serve` provides the interactive local view and CRUD operations. `filegrc build` creates a read-only static view. `filegrc validate` is suitable for local use and CI.

### Browser repository transactions

FileGRC recommends one dedicated private repository per organization. Browser editing creates frequent focused commits for records, onboarding, approvals, evidence, recurring work, and renderer settings. A standalone repository keeps that compliance history separate from application development commits. Monorepos remain supported, and the scaffolder never creates a nested repository inside an existing worktree or relocates an existing workspace.

New renderer settings use trunk mode with `main` as the authoritative branch and `origin` as the remote. Model v2 requires every renderer setting to choose trunk or manual mode explicitly. Record lifecycle fields represent draft, proposed, approved, and retired states; Git branches do not represent approval. Approved Policies and governed Documents bind their approval to the SHA-256 revision of each companion Markdown file. Editing bound content requires moving the record back through review and recording a new approval.

Each trunk-mode browser mutation runs under one server-side serialization lock. It checks Git availability, the authoritative checkout, the configured remote and upstream, repository operations, the whole worktree, and ahead commits. It fetches the remote, fast-forwards only, reloads the target, applies optimistic revisions, calls the existing domain mutation, validates, stages only the FileGRC workspace, commits a generated message, and pushes. Onboarding uses the same transaction for its system, workspace, and renderer writes.

Fetch or fast-forward failure occurs before a write. Stale revisions and validation errors roll back the FileGRC mutation. Commit failure leaves the changed files visible and blocks later browser changes. Push failure keeps the focused local commit and reports `Not synced`; Retry sync is available only when every ahead commit changes files inside the FileGRC workspace. FileGRC never pushes an ahead commit that includes another monorepo path, and it never switches branches, merges, rebases, resets external files, or resolves conflicts.

Detached and non-authoritative checkouts are read-only. `filegrc serve --allow-non-authoritative-writes` is an explicit development override that restores local browser writes without automatic fetch, commit, or push. CLI and agent mutations keep their existing Git behavior.

### Headless agent contract

A generated workspace must be operable by an agent that knows Git and JSON but has no filegrc context. The root `AGENTS.md` explains the program and Git behavior. `data/AGENTS.md` defines the universal record workflow. Collection-level instruction files add compact rules for areas where a wrong action could weaken an audit, lose evidence, or expose data.

`filegrc program-path --next --json` is the compact headless entry point for the renderer’s lifecycle. It reports the current step and first action. `--summary` reports compact status across all five steps, `--current` reports the full current-step data, and the unfiltered command reports every step. Human-readable output shows short stage and page summaries plus links to type guides. Structured output keeps the detailed Instructions, Use, Policy Basis, commands, and next actions for agents that ask for the full contract. `filegrc guide --json` is the compact action and type index. A type-specific guide adds current relationship candidates, timing guidance, storage location, Markdown slots, and the detailed checks needed for that resource. The shared definitions in `src/program-path.js` keep renderer and headless guidance aligned at each level. `filegrc scaffold` produces an incomplete `{ record, content }` mutation with a generated ID and explicit missing values. Scaffolds remain in a non-final lifecycle state and must not contain fabricated compliance facts.

`filegrc get <id> --mutation` exports the complete record, existing Markdown, and their revisions. `filegrc update` consumes that shape and rejects a stale JSON or Markdown revision. Create and update therefore use the same payload and domain functions as the HTTP and browser paths.

Every model resource must have automated guide and scaffold coverage. Tests require every renderer instruction to match its headless guide. Multi-record commands must validate their domain rules and write through one serialized mutation. This includes obligation completion, Policy Event creation and closure, audit preparation, and evidence attachment management. Program Readiness must use the same domain calculation in the CLI, HTTP state, static state, and browser.

## Model registry

The `filegrc` package is the only source of truth for the data model:

```text
packages/filegrc/model/v1.json
packages/filegrc/model/v2.json
```

The registry defines:

- Shared primitives
- Resource types and fields
- Required and conditional fields
- Enums and defaults
- Relationship targets and cardinality
- Lifecycle states
- File and content rules
- Search, filter, list, and form metadata

The registry structures only values needed for validation, filters, relationships, lifecycle rules, due-date calculations, and audit-period completeness. Variable procedures, questionnaires, interviews, per-item analysis, and provider-specific result tables remain Record Markdown in implicit companion files. The model's `recordContent` settings decide which result-bearing resources show this body by default. A source form is evidence for a workflow, not a schema to copy field for field.

The engine loads the complete active registry directly. Each published model registry is standalone and frozen after a later model ships, so the active model never inherits behavior from an older registry. Validation, CRUD forms, relationship pickers, list columns, filters, search indexing, CLI descriptions, and generated reference documentation all use the same definitions.

Each relationship has one stored authority. Inbound references and reverse lists are derived by scanning the current records. Teams store their membership and chairs, Control Tests store their Audit, Evidence Artifacts store applicable Audits, Commitments store their Systems and Controls, Controls store governing Policies, Requirements, bounded Systems, operating Components, and evidence-source Components, Risks store treating Controls, and Components store their System uses and primary Vendor. Audit-time subservice treatments stay on the Audit because they are engagement-specific.

`packages/filegrc/model/index.js` loads the registry and exposes a stable Node.js API.

Generated repositories contain only their records and one required `dataModelVersion` in `data/workspace.json`. Individual records do not repeat a schema version. Unknown top-level record fields are errors; organization-specific values belong under `extensions`. Generated repositories do not receive copied schema files.

`docs/data-model.md` is generated from the active model v8. `npm run validate` fails when the generated document differs from the registry. The migration command previews and applies each model upgrade as a separate atomic step, including the explicit v3-to-v4 System classification and relationship rewrite, the v4-to-v5 governed Document lifecycle split, the v5-to-v6 Training lifecycle and scheduling split, the v6-to-v7 cleanup of model-version lifecycle labels, and the v7-to-v8 structured retention, mapping, and supplemental-source review work.

The registry may expose a JSON Schema projection for editors and outside tools, but that projection is generated output. It is not a second schema authority.

### `create-filegrc`

`create-filegrc` creates a standalone repository on `main` with:

- A private `package.json`
- One dependency, `filegrc`
- A lockfile
- Scripts for serving, building, and validation
- Generic seed records
- A high-level README
- Detailed consumer instructions in `AGENTS.md`
  - A `data/` directory using the current data-model version
  - Trunk repository settings for `main` and `origin`

The generator resolves the current `filegrc` release and records a normal semver range. This keeps initial output current while the lockfile makes installs repeatable.

The generator reads `packages/create-filegrc/template-parameters.json` and asks for four values:

- Company name
- Initial program lead name
- Initial program lead organization job title
- Security contact email

It defaults the program lead email from the security contact, defaults the timezone from the local environment, and generates the initial effective date from the current date. These values replace tokens such as `{{company_name}}` in the template. Creation fails if the template contains an undeclared token or if any token remains after rendering.

This is the smallest useful initial prompt set. The company name identifies the program and appears in policy text. The lead name and job title create an accurate Person record, while a separate dated Policy Owner Appointment gives the starter records an accountable party. The security email gives people one report and escalation route. Timezone defaults to UTC, and users can edit it later. Jurisdiction, industry, risk scoring, retention periods, other control owners, system scope, and audit plans do not need create-time prompts.

## Starter SOC 2 baseline

`create-filegrc` generates a Security-category baseline before organization-specific onboarding:

- The AICPA 2017 Trust Services Criteria with revised points of focus (2022)
- All 33 Common Criteria reference IDs from CC1.1 through CC9.2
- The AICPA 2018 SOC 2 Description Criteria with revised implementation guidance (2022)
- All nine Description Criteria reference IDs from DC1 through DC9
- A planned control catalog mapped to the Common Criteria and one starter Information Security Policy
- A planned security and risk oversight team that still needs a chair and membership.
- A Person with their actual organization job title, an active Policy Owner Appointment, and a planned Independent Policy Reviewer Appointment scoped to the program
- Recurring and event Obligations that are the sole authority for review, scan, test, training, and meeting schedules
- Event obligations for workforce starts, role changes, departures, personal devices, vendor access and reassessment, material system or data-use changes, and incidents
- One general Security Awareness Training record. Add role-specific modules only when the current people, access, and duties require them.
- A governed data retention schedule plus annual and material-change review work
- Annual incident-response and end-to-end alert-path testing
- A default 5x5 likelihood-and-impact risk method
- Public, Internal, Confidential, and Restricted classification definitions

The baseline does not redistribute licensed criteria text. It stores reference IDs and an official source link. Program and audit readiness require all 33 Security Common Criteria and all nine Description Criteria to remain applicable and in scope. A criterion from an included optional Trust Services Category may be marked not relevant only with a recorded rationale for the limited circumstances and a DC8 disclosure. The baseline also does not create organization-specific systems, vendors, risks, audit periods, or evidence. Optional renderer onboarding collects one initial system boundary and an optional management goal, stores them on the workspace, and creates one planned service-commitment prompt linked to that system. The prompt does not assert a customer promise and must be replaced with the actual commitment before activation. Onboarding does not create an audit engagement, appoint the independent management reviewer, add optional trust categories, or claim that the initial scope is complete.

Every starter control is `planned`. A user must confirm the owner, system scope, actual procedure, operation pattern, evidence source, implementation date, mappings, and every required Work Queue schedule before marking it implemented. Starter calendar Obligations remain `proposed` and carry sensible starting cadences, including the former common scan, testing, review, and recovery intervals. A user may edit those values, and only enabling the Obligation records management's choice. Bracketed retention and recovery values work the same way: the document remains incomplete until management confirms or replaces the proposed value and removes the prompt. A policy statement alone does not prove that a control operates.

## Storage

Structured resources use JSON because Node.js can parse it without dependencies and tools can edit it reliably. All internally authored long-form content uses Markdown, including policies, charters, plans, procedures, minutes, system descriptions, assertions, narratives, templates, and audit responses.

Signed forms, third-party reports, screenshots, and immutable exports are evidence rather than canonical documents. These files may remain PDF, image, CSV, or another fixed format when that representation is part of the proof. Evidence records describe every supporting file or external reference.

```text
data/
├── workspace.json
├── renderer.json
├── AGENTS.md
├── people/
├── service-accounts/
├── teams/
├── systems/
├── assets/
├── documents/
├── evidence/
├── obligations/
├── obligation-events/
├── frameworks/
├── requirements/
├── commitments/
├── complementary-controls/
├── controls/
├── control-tests/
├── findings/
├── exceptions/
├── action-items/
├── policies/
├── policy-reviews/
├── attestations/
├── meetings/
├── training/
├── risks/
├── risk-assessments/
├── vendors/
├── vendor-reviews/
├── access-grants/
├── access-reviews/
├── vulnerabilities/
├── vulnerability-scans/
├── incidents/
├── exercises/
├── backup-tests/
├── penetration-tests/
├── data-requests/
├── audits/
├── audit-populations/
└── audit-requests/
```

Most records are one JSON file. Long-form content is a Markdown companion beside that JSON file, and the model names each supported Markdown slot. The primary companion uses the JSON basename with `.md`; secondary companions add a semantic suffix such as `-agenda.md`. Records do not store Markdown paths. The renderer and CLI derive them from the stable record location. Evidence that includes local files gets its own directory containing `evidence.json`, an optional `evidence.md`, and the files it describes.

Policies and other authored documents do not carry embedded change-control tables. Git is their change history. A human-facing policy version remains available when it has contractual or organizational meaning.

Generated or cached data never belongs in these directories.

## Policy obligations

An `obligation` is a reusable policy rule. Its own `active` status means the schedule is enabled and ready for cutover. Work remains dormant until every governing Policy and required program Document is active and effective and, when it names Controls, at least one linked Control is implemented. Calendar obligations define a recurrence whose anchor is the first day of a compliant cycle. If a governing Policy or required program Document takes effect after the stored recurrence anchor, the latest applicable effective date becomes the first cycle anchor. This prevents a later activation from creating overdue work for a period before cutover. Audit Documents do not affect this program gate because their lifecycle belongs to Step 5. Unless the Policy narrows it, the allowed completion window runs through the day before the next cycle and becomes overdue on the next cycle’s first day. A dated record explicitly linked through `completionResourceIds` satisfies the occurrence whose window contains that date. An Obligation may be proposed, active, paused, or retired. Blocking is authoritative only on an assigned Action Item, which must name its blocking resources. The shared planner preserves that state and exposes the same blocker titles and resolution action in browser, CLI, HTTP, and agent output.

Event obligations define an `eventType`, a prompt, owners, completion record types, and a due window relative to the event. The model-owned activity registry limits each activity’s recurrence modes and scope resource types. The Policy Event registry limits subject resource types and their cardinality, such as exactly one Person for a departure or exactly one Vendor for reassessment. filegrc rejects an event while a governing policy is still a proposal. Starting an active event creates an `obligation-event` and all required `action-item` records as one validated write. Day windows preserve policies such as “within 30 days.” Hour windows preserve exact timestamps for rules such as same-time or 24-hour access removal. The starter obligations use policy-specific cutoffs. filegrc applies a 30-day deadline when a custom event obligation omits one, so every generated action can become overdue.

`planObligations` is the shared calculation used by the dashboard, obligation board, HTTP API, and `filegrc obligations` CLI command. `createObligationEvent` is the shared write path used by the UI, API, and `filegrc trigger`. Calendar completion uses one validated mutation to create the dated operating record and append it to the obligation's `completionResourceIds`; the obligation board, API, and `filegrc complete` use that same transaction. `filegrc complete --scaffold` and `complete-action --scaffold` select the model-defined completion type, prefill the occurrence, scope, actors, review candidates, dates, and current target revision, and keep missing actual facts visible. The planner does not write derived occurrence records for calendar schedules.

## Git metadata

The engine derives the following for each record:

- First commit and first committed timestamp
- Latest commit and latest committed timestamp
- Commit authors
- Commit messages
- Diffs and prior versions
- Current uncommitted state

These are presentation fields, not data fields. Operational dates remain explicit because a commit timestamp does not say when an incident occurred, a review was approved, or a test completed.

The engine follows file renames when possible. A resource ID remains the durable identity if a path changes.

Domain CRUD operations write files atomically and do not create commits. Record and Markdown updates use content revisions, so a stale browser cannot overwrite a newer filesystem change. Deleting a draft also deletes authored Markdown that no other resource references. The trunk-mode browser wraps those domain writes in the authoritative-branch transaction described above. Manual-mode browser, CLI, and agent writes stay local until the user or agent manages Git.

## Program readiness

Program Readiness answers whether management can begin a candidate Type 2 period. It has no audit ID or CPA firm requirement. The stages are:

1. Define scope.
2. Review Policies, program Documents, and Training on one Policies page, and independently approve each exact revision.
3. Implement Controls and approved governed-content requirements, complete authoritative evidence sources, configure Obligations, activate unchanged approved Documents and Training with separate dates and revision bindings, and activate Policies at the cutover.
4. Operate the program.

Policy approval records management's approval of the requirements and exact content. It does not assert that linked Controls are implemented, and an approved Policy may remain inactive while implementation finishes. FileGRC does not infer technical implementation from policy prose. Configuration facts belong in Controls, Components, Systems, Obligations, and Evidence.

The Evidence Ready gate requires an assurance goal, selected Systems, reviewed criteria and service commitments, active and effective required Policies, separately approved and activated required program Documents and Training, implemented Controls, complete authoritative evidence sources, and enabled Obligations. Step 2 checks owners, independent approvers, approval dates, intended values, and approved content revisions. Step 3 separately checks linked Control implementation, Training assignment Obligations, the active Person who performed activation, activation dates, effective dates, and activation revisions. `workflowScope` assigns each Document to the program path or one engagement; Document kind names no longer decide that lifecycle. Every selected Control family must point to active authoritative Components with the required evidence roles, current evidence access owners, and repeatable retrieval instructions in Record Markdown. These checks are part of Control implementation in `assessProgramReadiness`. The Step 3 browser overview shows program Document, Training, and Policy activation assessments beside the source-family results, and the CLI and HTTP API expose the same data. Step 4 begins operation and evidence collection only after the program gate. Engagement-scoped Audit Documents remain in Step 5 and are checked by Audit Readiness instead of the program gate.

Scheduled operating records use `scheduledFor` separately from their actual completion date or timestamp. Completed reviews, assessments, scans, tests, and exercises must name the model-defined actors, result, evidence, review, and coverage fields. Validation rejects missing completion proof, terminal-only fields on unfinished work, and completion or review dates in the wrong order. Each Vendor Review covers one Vendor so its decision, evidence, coverage, and follow-up remain unambiguous.

The renderer adds Audit as the fifth and final lifecycle stage. That stage covers the CPA firm, formal period, FileGRC Evidence, Evidence Artifacts, fieldwork, evidence packet, and report. Criteria remain part of Program scope because management must decide what applies before adopting policies.

The workspace keeps management’s `candidatePeriodStart` and `candidatePeriodEnd`. An audit record keeps the separate CPA-agreed Type 1 date or Type 2 period. The candidate dates let management preserve evidence as soon as collection works, but they do not establish the report period.

## Audit evidence

Auditors commonly receive screenshots of rendered GRC pages for the audit period. The engine therefore provides a stable evidence view for every list and detail page.

An evidence snapshot records:

- The rendered route and filters
- The audit and evidence period
- The exact Git commit
- The capture timestamp and method
- The source resource IDs
- The screenshot or fixed export

The engine can prepare deterministic evidence views and metadata without a browser dependency. A user or approved capture tool may create the screenshot. The evidence record and image are committed together.

The evidence-packet engine supports a Type 1 as-of date and a Type 2 period. It selects records explicitly related to the engagement, its scope, systems, controls, criteria, policies, dependencies, and evidence, so an unrelated dated record is not disclosed just because it falls in the date range. Type 2 adds recurring obligation coverage, Policy Event workflows, complete populations, and samples. Delivery-ready checks cover management's work and packet integrity. They do not claim that the engagement team found the evidence sufficient or appropriate.

Packet output is derived under `.filegrc/evidence-packets/`. It contains an auditor-oriented HTML index, a machine-readable manifest, a control matrix, source-system index, external-evidence delivery index, evidence index, Type 2 population index, raw JSON source records, governed Markdown, fixed local attachments, committed historical versions, and per-file SHA-256 checksums. External references are listed but never fetched and keep the packet in review-required state. The packet records the source revision and whether the worktree was clean, so incomplete or uncommitted output is visibly marked as a draft.

The model registry owns the four management-document definitions, ten standard population kinds, and authoritative source-Component guidance used by every interface. `prepareAuditWorkspace` creates engagement-specific documents from the local starter templates. For Type 2, it also creates missing population records, maps starter Controls by code, and selects a source Component when exactly one cataloged Component has the required evidence role. It does not approve or complete the resulting records. `assessAuditPreparation` begins with Program Readiness, then checks the CPA engagement, firm-agreed period, fieldwork records, and auditor-owned steps. It provides the same scoped checklist to the renderer, CLI, static build, and packet readiness checks.

Each `audit-population` records management’s reconciliation state for one complete population. The population and its linked `population-export` Evidence Artifact must name the same cataloged source Component. The Evidence Artifact records the exact query or report parameters, timezone, generation timestamp, record count, and completeness and accuracy validation. Split populations when source Components or queries differ. A zero-event population still needs a fixed source export and query. A population linked to an in-scope Control cannot be dismissed as not applicable.

`assessAuditPreparation`, `prepareEvidencePacket`, `generateEvidencePacket`, and `writeEvidencePacket` are shared by the audit page, HTTP API, CLI, and static state. UI and headless callers therefore receive the same management checklist, selected records, and coverage gaps. Packet generation waits for in-flight workspace writes and blocks new ones until its source snapshot is copied and checked.

People who do not have repository access may acknowledge policies, training, or tasks with a signed PDF or image. The corresponding attestation records the signer, signing date, acknowledgement statement, exact content revisions, and evidence file. Repository collaborators may use a reviewed Git commit as an attestation when the workflow permits it.

Training material is canonical Markdown. A reusable `training` record defines its audience and assignment trigger. An Obligation defines recurring or event-driven assignments. One `attestation` per assigned person records completion, the exact training revision, and any signed evidence.

## Rendering

The homepage includes a program progress tracker and an Evidence Collection Running milestone. Its five-step path is Define Scope, Approve Policies, Implement Controls, Operate the Program, and Audit. Each step links to its overview page rather than a separate readiness checklist. Continue opens the first step page with unfinished work. Page completion comes from source-record state, explicit reviewed decisions, current collection confirmations, and the shared readiness calculation. Program Readiness checks whether Control implementation includes complete authoritative evidence sources before management begins reliable evidence collection. Audit remains last, though the Audit area stays available when a customer deadline needs early CPA input. Validation and Git status remain visible in the top bar.

The sidebar groups records by their job:

- Define Scope: people and the oversight team, criteria, commitments, material vendors, and in-scope systems, including evidence roles, access owners, and retrieval instructions for Systems that produce Control evidence
- Approve Policies: independent approval of Policy requirements and exact content revisions, without requiring activation
- Implement Controls: program Documents and Training, the starter control set, authoritative evidence source mappings and readiness, implementation fields, enabled Obligations, complementary customer or subservice controls, operation-tracking status, and the Policy activation cutover
- Operate the Program: risk assessments and risks, the Work Queue, Evidence Artifacts, data requests, asset inventory, vendor reviews, governance, access, security, resilience, training, confirmed findings, and exceptions
- Audit: engagements and requests, populations, tests, FileGRC Evidence and Evidence Artifact review, packet preparation, fieldwork, and reports

Resource types are nested only when the extra grouping adds meaning. Organization settings remain anchored at the bottom.

The Controls page explains what the generated workspace already supplies and what management must tailor before a planned Control becomes implemented. Its operation-tracking column distinguishes Controls linked to recurring or event work in FileGRC from Controls supported by Evidence Artifacts, and it always shows authoritative evidence-source mappings. The Step 3 overview derives evidence-source readiness from the selected Controls, model evidence families, and their authoritative source Components. Each row shows the expected Evidence, timing, linked Controls, mapped Components, and whether source roles, access owners, and retrieval Markdown are complete. Users fix gaps in the canonical Control and Component records, without duplicate lifecycle pages or placeholder Evidence. Step 2 ends with required program Documents in `approved`. Once their linked Controls are implemented, the Step 3 activation operation changes each unchanged Document to `active`, records `activationBasis`, `activatedByIds`, `activatedOn`, and `effectiveOn`, and binds `activatedContentRevisions` without replacing `approvedOn` or `approvedContentRevisions`. The Policy editor also ends at approval, so the Controls page offers a separate Policy cutover after Document activation. Browser, HTTP API, and CLI use the same atomic domain operations and readiness calculations.

Evidence Artifacts belong in Step 4 because management should create one only when a real export, report, screenshot, signed file, or approved external reference exists. The standard page creates and filters these records. Users select the source Component, link Controls and source operating records, attach or reference the result, record collection facts, and obtain verification before audit use. Risk, governance, vendor review, training and acknowledgement, vulnerability testing, backup and recovery testing, exception, and finding evidence stays on the Step 4 operating records. Fixed artifacts remain behind Evidence Artifact records and are linked from those operating records.

Step 5 reviews both evidence paths for the formal audit date or period. It also completes, independently approves, and separately activates engagement terms and management Documents through an Audit-scoped activation operation. An approved or active engagement Document belongs to exactly one Audit and cannot govern reusable Policy or Obligation work. Approval actors, dates, and revisions become immutable after approval; activation actors, dates, effective dates, and revisions become immutable after activation. A changed decision returns the Document to draft or approved for a new lifecycle event.

FileGRC Evidence is the set of dated Step 4 operating records, their Markdown, and Git history. Evidence Artifacts are verified `evidence` records, fixed attachments, and approved external references from authoritative Components. Audit Readiness reports coverage for both. The packet includes matching FileGRC records, Evidence Artifacts, Control links, delivery indexes, historical revisions, and checksums. Model v5 packets also include `document-lifecycle-index.csv`, which lists each governed engagement Document's Audit role, status, owners, approvers, activators, event dates, effective date, and exact approval and activation content revisions.

Each of the five lifecycle steps has its own overview route. Clicking a step label opens that page, while its separate chevron expands or collapses the step in place. Nested subgroup rows toggle their drawers and do not have separate overview pages. Every step links its records or working pages in order and derives completion from the active model, source records, policy content, and Git state. No page stores a manual completion flag. Step 3 also shows the derived evidence-source readiness results. Step 4 is an operating board. It puts compact Policy Event triggers above the Work Queue. Each trigger shows every resulting task, owner, due window, and required proof in a tooltip, then creates the event and all linked Work Queue tasks atomically. Other open Action Items also appear in Work Queue. Step 4 progress comes from period state and the Work Queue, including named blocked work.

Findings are the global register for confirmed gaps that need their own owner, due date, remediation state, or verified closure. The review, test, assessment, incident, meeting, or audit record keeps the report and observations in Markdown. A Finding points back to that source through `sourceResourceId`; the source does not maintain a reverse list. Straightforward remediation stays on the Finding. Create an Action Item only when part of the follow-up needs a separate assignee, deadline, and completion proof. Action Items point to their source and appear in Work Queue, but do not need a separate sidebar destination.

Third-party software commonly needs both a `system` and a `vendor`. The application is the System because it operates controls and produces evidence. The provider is the Vendor because contracts, due diligence, and supplier risk belong to the relationship. `system.vendorId` connects them, and evidence names the System as its source.

For enabled Obligations whose governing Policies, required program Documents, and Training are active and effective and that have an implemented linked Control, the dashboard derives the next calendar occurrence from the recurrence rule and the latest applicable governing-content effective date. Explicit operational due dates take precedence. Each completed occurrence remains a separate operating record with its own evidence. Starter Obligations can be enabled during implementation but remain dormant until activation.

Each resource type gets a responsive list page with search and filters, plus a detail page that combines the current record, linked resources, Markdown, and Git history. Progressive disclosure keeps orientation separate from execution: a stage hero states one outcome, each page card states one purpose, and detailed checks appear only in the current record, action, confirmation, or guide. A list row shows that record’s actionable issue and links to the best place to resolve it. Collection-level To-do panels do not repeat those row actions. For model-defined collections where FileGRC cannot infer that management reviewed the complete or empty set, the page shows one Scope Confirmation with type-specific review criteria, conclusion, reviewer, date, scope revision, and calculated collection revision. The confirmation becomes stale after a reviewed record or material Program scope fact changes. List-page guides show Instructions, Use, Policy Basis, and any resource-specific review criteria. The type-specific CLI guide returns the same text and adds timing, fields, relationships, paths, Markdown slots, and collection review state. When the workspace contains the referenced policies, documents, or recurring obligations, the renderer links to those current records and schedules. The dashboard reports data validity, Program Readiness, evidence collection, and Audit Readiness separately, so a valid starter schema is not presented as an operating program or active engagement.

The local app generates guided fields and relationship pickers from the model, with advanced JSON available for optional fields and extensions. Global and list search include authored Markdown. Static builds provide the same browsing, search, and filter flows without write actions.

New generated workspaces include `data/renderer.json` with `showOnboarding` set to `true` and trunk settings for `main` and `origin`. The local renderer explains the file and Git model, the program path, policy obligations, and Policy Events before covering report types and the final audit stage. The setup step collects the initial service boundary, owner, business criticality, highest data classification, internet exposure, and optional Type 1 or Type 2 management goal. It creates or updates one system, adds that system and the goal to the workspace, and sets `showOnboarding` to `false`. It does not select frameworks, requirements, or controls, link every control to the service, create evidence, or create an audit. The headless `setup --preview` command reports the same planned writes without saving, and `setup --summary --json` returns compact agent output. The final browser screen opens the Step 1 overview so management can add the real reviewers and operators, finish the oversight team, and confirm the criteria, commitments, vendors, and systems before approving policies. Skipping also sets the flag to `false`. In trunk mode, browser onboarding validates, commits, and pushes its related writes together. Headless setup remains a normal CLI mutation and leaves Git to the user or agent.

Onboarding never runs in a read-only build or a trunk-mode checkout that cannot synchronize safely. It can be restarted from Repository, or bypassed entirely by editing the same data files through an agent or other tooling. Repositories created before the renderer settings record remain valid and do not start onboarding automatically.

The static build is read-only. Search and filtering run in the browser against a generated index. CRUD is available only from the local server.

Audit pages also show:

- Scope, criteria, period, and report opinion
- The management assertion and system description
- Controls and applicable criteria
- Management and service-auditor test procedures
- Samples, results, exceptions, and management responses
- Controls not exercised or tested during the period and the reason
- Complementary user-entity and subservice-organization controls
- Subservice organizations and the method used to include or exclude them

## Guided SOC 2 workflow architecture

The product starts with every known piece of work already represented. A new user does not need to read a policy, infer a record type, and invent a checklist before FileGRC can tell them what to do.

Represent work in three forms:

- Source records hold organization facts and reviewed decisions.
- Assigned-work records hold real commitments with an owner, deadline, and completion proof, such as an Action Item, Audit Request, or reusable Obligation.
- Derived checklist items explain what is missing, blocked, scheduled, or next. They are calculated and never become a second source of truth.

Starter source records may be incomplete prompts, and starter Obligations may remain proposals, but they must stay in a non-final state and must not assert organization-specific facts. Do not create an Action Item, Audit Request, or other assignment until its real owner, deadline or due rule, and completion expectation are known. The engine derives checklist items, finalization checks, period coverage, and next actions from the source records, assigned work, model, policy content, and Git history.

A Work Item is the common read model used by queues and search. It may project an assigned-work record, a derived obligation occurrence, or a dated source-record deadline. It has a deterministic key derived from its source, subject, and due window so every interface can refer to the same item. It is never another stored record type.

Assigned work may be canceled or superseded only with an actor, date, and reason. Preserve its history and assess the effect on policy, control, and period coverage. Cancellation removes work from the active queue only after the shared assessment accepts the disposition.

The same derived workflow contract must drive the browser, HTTP API, CLI, direct-file guidance, and agent guidance. A source file does not need to repeat generic audit-readiness instructions. `guide`, `scaffold`, `get`, list and search results, mutation responses, program readiness, audit readiness, and the browser should expose the same calculation. Persist a task only when it is an authoritative assigned record, such as an Action Item or Audit Request.

### Shared workflow contract

Add one model-driven assessment kernel. Record finalization, Program Readiness, Period Health, Audit Readiness, delivery readiness, and closure must be named assessments over the same facts and rules, not separate implementations. Its result returns:

- Separate assessment results for structural validity, program configuration, Evidence Readiness, period health, audit readiness, delivery readiness, and audit closure. Do not collapse them into one green or red lifecycle state.
- Required, conditional, and optional work for the current record and program stage
- Explicit applicability decisions, including reviewed `not-applicable` outcomes with reason, reviewer, and date
- Blocking dependencies in a useful order, including every record and relationship needed to resolve the block
- Derived checklist items with `blocked`, `ready`, `scheduled`, `waiting-external`, `not-applicable`, `overdue`, and `complete` states
- `blocked` only when named prerequisite records prevent the item from proceeding; immediately actionable creation, editing, review, and management decisions use `ready` even when they prevent an assessment from passing
- Fields, Markdown, relationships, actors, dates, evidence, and independent review still needed to finalize a record
- A stable next action, suggested command or route, candidate relationships, and machine-readable error codes and field paths
- A mutation preview that shows validation, readiness, due-work, period-continuity, and created-record changes before a write
- A `workflowDelta` after every write so a browser or agent can continue without calculating the next step again
- A versioned result-envelope contract that can evolve independently of the data model
- The input scope, explicit evaluation date or timestamp, timezone, date or period, model version, contract version, and Git revision needed to reproduce the result

The kernel is one public contract over small evaluators owned by the model, resource lifecycle, obligation planner, period coverage, and audit workflow. Each evaluator emits normalized findings with a stable code, subject references, state, severity, dependencies, and resolution actions. One aggregator orders and summarizes them for every interface. Do not build one large function or copy a rule into several readiness commands.

Do not add a UI-only dismiss or completion control for a derived finding. Resolve it by changing its source facts, recording a reviewed applicability decision, accepting an explicit Exception where policy allows one, or completing authoritative assigned work.

Replace manual page-completion flags with derived completion. Global search, resource lists, and `get` include assessment state and derived blockers without writing duplicate TODO files. Resource rows carry record-specific work. Model-defined Collection Reviews preserve the management fact that a complete or empty collection was checked, while the engine calculates and verifies the reviewed collection revision. Applicability batch flows preserve per-record decisions. Derive batch progress from saved source decisions rather than storing a parallel session checklist.

Add scaffold and preview support for multi-record operations, obligation completions, and Policy Events. A suggested next action must describe the full ordered dependency bundle. For example, adding a reviewer to the oversight team may require a Person, a planned Appointment, and Team membership rather than one partial update.

Rank next actions consistently: expired and overdue work first, then work that threatens an active period or external deadline, blocking prerequisites, ready assigned work, and future scheduled work. Show one recommended next action by default and keep the complete backlog available. Explain the rule that placed an item first.

Apply one presentation pattern everywhere:

- A stage overview shows its named assessment, blocking prerequisites, recommended next action, and complete checklist.
- A list page shows expected coverage, missing or conditional records, reviewed zero or not-applicable decisions, externally managed coverage, and the create or batch action.
- A detail and edit page shows the record's finalization checks, downstream effect, and allowed next transitions.
- An empty page explains whether records are required, conditional, externally managed, or reviewed as zero. It never stops at a record count.
- CLI, HTTP, static, and agent output expose the same information at an appropriate level of detail.

Browser and HTTP mutations must reach parity with CLI operations, including Action Item completion, Policy Event completion, evidence attachment and removal, and every future atomic transition. The CLI and HTTP API should return the same stable JSON result. Generated `AGENTS.md`, collection guidance, model documentation, CLI help, and browser copy need contract tests against the active model so field names and commands cannot drift.

Domain transition commands create their source change, Policy Event, and assigned Action Items in one atomic mutation. A direct file edit cannot provide that transaction. After a file edit, `validate`, `get`, and the shared assessments must identify the incomplete transition and return the same proposed bundle. A `reconcile --preview` path shows the missing records. `reconcile --apply` requires explicit event facts and confirmation before it creates them. It must never infer that a real-world event occurred merely because two field values differ. Static output exposes the same assessment and recovery instructions without write actions.

### Starter work and governance

Create one starter Appointment record for every model-defined authority role. Start Policy Owner active and keep the other records planned:

- Policy Owner
- Independent Policy Reviewer

Treat Policy Owner and Independent Policy Reviewer as the core Appointments required by the starter control design. SOC 2 does not prescribe these or any other job titles. The Policy Owner coordinates incident, recovery, executive, communications, audit, insurance, privacy, and legal input unless the company delegates a function. FileGRC does not require in-house counsel, a standing legal retainer, or separate role records merely because a plan names a function. Let users create custom Appointments for real delegations. One Person may hold several compatible Appointments. Enforce separation only where the workflow requires independent challenge, approval, collection, or verification.

Allow an Appointment to remain `planned` without a holder. Require the holder, effective dates, authority scope, and any required independence before it becomes active. Keep the person's actual job title separate from appointed authority. Do not create placeholder Person records for unfilled slots.

Add a guided external-reviewer bundle for any organization without a suitable internal reviewer. It creates the minimum external reviewer identity, Appointment, oversight-chair assignment, Team membership, and independent approval path. The reviewer record should collect only the data needed for the program. Do not infer company size from the number of Person records in FileGRC.

Create first-class initial work for:

- Selecting the assurance goal and candidate dates
- Reviewing the service boundary and all relevant system components, infrastructure, software, people, procedures, data, locations, vendors, and dependencies
- Deciding whether Security alone applies or whether Availability, Confidentiality, Processing Integrity, or Privacy applies based on service commitments and system requirements
- Reviewing all criteria rather than treating every starter requirement as accepted
- Reviewing the full starter control catalog rather than treating all planned controls as selected
- Recording legal, contractual, privacy, regulatory, and security duties as Framework, Requirement, or Commitment records, then mapping each applicable duty to an owner and controls
- Deciding whether commitments, subservice organizations, complementary user-entity controls, and complementary subservice-organization controls exist
- Completing the initial risk assessment and recording resulting risks, treatments, and control changes
- Reviewing the model-required source-family coverage for the selected scope and controls
- Assigning every policy, control, obligation, system, source family, and governed document to a real accountable party

Commitment and complementary-control records need a planned state, or the workflow needs a reviewed applicability decision on an existing source record, so starter prompts do not assert organization-specific facts. Do not add a generic decision record unless several workflows prove that the existing resource types cannot retain the decision cleanly.

Bind each applicability decision to the scope facts and revision it reviewed. When a service, System, policy, Requirement, Commitment, or control changes in a way that affects the decision, mark the decision stale and require re-review rather than silently carrying it forward.

Keep the default Security starter focused on an early-stage program designed to support a SOC 2 examination for a founder-led technical team: one required Information Security Policy, one combined Security Incident and Recovery Plan, one focused Data Retention Schedule, and one Security Awareness Training record. Readiness still depends on scoped, implemented Controls and sufficient operating Evidence. Do not generate employment, anti-bribery, Privacy, Confidentiality, Availability, Processing Integrity, or other broader GRC records until management deliberately adds that scope. Existing workspaces keep their established records and receive review proposals instead of silent rewrites.

Draft policies and governed documents must not receive a factual `effectiveOn` date before approval. Use no effective date while draft, or model a clearly named proposed date. Warn when a proposed date has passed and never advise users to backdate adoption. Approval must bind the exact Markdown revision, use a reviewer separate from the owner, and move changed approved content back through review. A Policy says what the company commits to do by the date it takes effect. Approval means the company accepts those commitments. It does not prove the work is done. Controls and operating records describe how the company meets them and provide the proof.

### Authoritative systems and external recordkeeping

Model authoritative recordkeeping once at the model-owned source-family and scoped-System level, then roll it up into controls, operating domains, program stages, and audits. Do not ask for the same source-of-record decision on every page, control, or obligation.

Derive applicable source families from selected controls, policies, systems, and audit scope. Families may cover workforce, access, changes, incidents, vulnerabilities, assets, vendors, training, backups, monitoring, findings, or exceptions. Require coverage only for applicable families. Each applicable family uses FileGRC records, an external authoritative System, or a reviewed not-applicable decision. An external path must name:

- The authoritative System
- The exact scope it covers and any excluded population
- The people who can retrieve records
- Retrieval instructions in Record Markdown
- Collection cadence and retention
- Reconciliation method
- Valid-from and valid-through dates
- A reviewed reason when the domain does not apply

An empty FileGRC collection must not look complete when the facts live elsewhere. The derived workflow should direct the user to the selected system and require period reconciliation.

Before a candidate Type 2 period begins, require a real evidence-retrieval dry run for every distinct retrieval method used by the selected source families. One dry run may cover several families only when the authoritative System, query or procedure, access path, and retained artifact are the same. Preserve a sample export or report, collection facts, access confirmation, covered families, and verification result. Mark it as a pre-period readiness test so it cannot satisfy audit-period control operation.

Track source-system and evidence-mapping history. A control may change systems, queries, access owners, or retrieval steps during a period, so current mappings alone cannot prove continuous coverage.

### Policies, controls, and training

The Policy activation assessment has four states: Approved, implementation pending; Ready to activate; Active with implementation gaps; and Active and operating. Before activation it reports planned or partial Controls, missing Components or evidence sources, missing schedules, and unresolved Exceptions. The user may still activate with a documented gap or approved Exception. The warning must remain visible, and Evidence Readiness must remain incomplete while required implementation is missing.

The policy activation flow creates or resolves:

- Owner and independent reviewer appointments
- Exact revision approval
- Effective date and activation cutover
- Related governed-document approvals
- Required training and acknowledgement assignments
- Recurring obligations and Policy Events
- Material-change and annual-review work

Distinguish whether an Obligation is configured from whether it is proposed, blocked, running, due, overdue, paused, or retired. A source record marked `active` must not imply that work runs while its policy and controls remain incomplete.

Add a control implementation flow for each selected control. It should require owner, in-scope systems, requirement mappings, actual procedure, operation mode and frequency, evidence-source families, authoritative systems, retrieval dry runs, initial applicability decision, implementation date, and Work Queue schedules. A not-applicable control needs a reason, approver, decision date, and a clear statement of the resulting criteria-coverage effect.

Bind a control procedure to an effective Git revision. A material procedure change during a Type 2 period needs a dated change decision, re-review, new effective revision, and a period-impact assessment.

Training content needs the same governed revision lifecycle. Active training should name its effective revision. Each completion or signed attestation must bind the exact revision assigned to that person.

### Operating work and atomic transitions

Define one derived Work Item projection with source type and ID, title, owner, due or scheduled date, state, blocking reason, scope, required completion profile, and next action. Project all open Action Items, Audit Requests, risks, vulnerabilities, exceptions, findings, expiring access, service accounts, vendor artifacts, contracts, insurance, penetration tests, certifications, and other dated work into that shape. The Work Queue, CLI, API, agent output, and search consume the same projection rather than maintaining type-specific queue logic.

Recurring obligations that apply per person, vendor, system, or other scope item must fan out into one derived Work Item per subject. The activity profile defines the eligibility rule and evaluation date. Retain the scope revision or population evidence needed to reconstruct which subjects were expected for the due window. Persist the reusable Obligation and each completed operating record. Create an Action Item only when the occurrence needs an authoritative assignment that is not already supplied by the Obligation. One generic completion cannot cover an unspecified population.

Add first-class scheduled or event work for:

- High and critical risk treatment and review
- Policy and governed-document material change and reapproval
- Emergency-change post-review
- Exception expiry and compensating-control review
- Vulnerability remediation deadlines by confirmed severity
- Service-account review, expiry, and non-expiring justification
- Asset disposal
- Data-retention disposal
- Vendor renewal, termination, reassessment, and assurance-report expiry
- Commitment and system-requirement change
- Finding remediation and verified closure
- Lost devices and personal-device approval
- Business continuity or disaster recovery activation

Use atomic transition workflows when changing a source record should trigger policy work. Cover workforce start, role change, departure, vendor activation or termination, vendor access, material system change, material data-use change, incident closure, high-risk departure, policy revision, emergency change, exception expiry, service-account creation or expiry, vulnerability confirmation or overdue status, asset disposal, and continuity activation.

Use one departure flow with a risk flag and conditional steps rather than separate normal and high-risk events that can be missed or duplicated. A direct file edit, CLI command, API write, or browser form must receive the same required-transition result. Do not block a truthful late or emergency update. Domain mutations create the required event and actions atomically. Direct file edits leave the transition visibly unfinished with an exact reconciliation action.

Several recurring activities currently accept an Evidence record as the completion itself. Define model-owned completion profiles for inventory reviews, log reviews, network reviews, continuity reviews, performance reviews, personal-device approvals, and security scans. Each profile must select an existing operating record type that captures performer, scope, method, result, exceptions, review, completion time, follow-up, and supporting Evidence. When an external system owns the activity facts, support a structured external-activity reference and reconciliation instead of forcing a duplicate local record. Add a generic control-activity resource only if repeated implementation shows that no specific record type can represent a stable shared workflow.

Add missing model facts:

- Risk treatment target and next review dates
- Vulnerability confirmation, severity-assignment, target-remediation, and severity-change dates and reasons
- Access Grant business need
- Service Account privilege, authentication method, review date, expiry, and non-expiring rationale
- A System finalization profile that checks existing relationships, calculated evidence-source readiness, and required Markdown sections for variable boundary, data, dependency, and recovery detail. Add structured System fields only when validation, filtering, relationships, or readiness calculations need them.
- Requirement applicability reviewer and review date
- Evidence provenance that separates business event time, source generation time, collection time, verification time, and first Git entry time

Support a reviewed zero-population conclusion for organizations with no employees, vendors, incidents, vulnerabilities, or another applicable population. Do not require fictional records. Preserve source evidence that supports the zero count.

### Period health and change control

Extend the shared assessment kernel across a date range for policies, controls, procedures, systems, evidence sources, Appointments, obligations, and scoped populations. Program Readiness is the current-state assessment. Period Health applies the same rules across a candidate or formal Type 2 period and reports mid-period changes, pauses, owner gaps, missing occurrences, and source changes.

Once evidence collection begins, a mutation that reduces readiness should preview the period impact. Allow the truthful change, then mark the affected period at risk and require the applicable material-change, exception, incident, or remediation flow. Never silently preserve a green state after a control, source, policy, or accountable role stops being ready.

Add milestone-aware CI checks backed by the same assessment kernel. Structural `validate` should continue to allow honest drafts. A workspace that declares Evidence Ready or starts a candidate period should also run a stage check that fails on readiness regressions, overdue work, or period gaps.

Check contemporaneity without rewriting history. Compare explicit business dates with the first Git commit and flag late-entered events, retroactive approvals, and evidence created after the fact. Preserve a management explanation. Check whether available Git history spans the candidate or audit period, including shallow, replaced, or newly initialized history.

Keep overlapping services, audit scopes, and periods isolated. A completion, evidence record, or population must not satisfy unrelated controls or engagements merely because its date falls inside both periods.

### Audit engagement and fieldwork

Create an engagement wizard only after a real CPA engagement exists, or earlier when a customer deadline requires coordination. Force management to confirm or intentionally carry forward:

- Type 1 or Type 2
- Firm-agreed date or period
- Included services, systems, locations, and data
- Trust Services Categories and criteria
- Controls and commitments
- Subservice organizations and inclusive or carve-out method
- Complementary user-entity and subservice-organization controls
- Management owners and authorized signatories
- Auditor and engagement contact
- Management deadlines and auditor-owned steps

Initialize scope from the current workspace, show the diff, and require a reviewed decision. An audit with no selected controls must not produce a reassuring empty evidence result.

Run a period-feasibility check before fieldwork. Compare the formal period with the candidate-ready date, Git history, policy and control effective dates, source-system coverage, and available external history. Permit a retrospective period only when the source history supports it, and show every gap when it does not.

Derive expected evidence from each control's operation pattern and frequency. One dated operating record per control is not enough when the control operates per event, daily, monthly, quarterly, or continuously. Show expected occurrences, configuration snapshots, population coverage, samples, and missing intervals.

Require zero-event population proof during Period Health, not only after the period ends. Cover workforce changes, incidents, vendors, vulnerabilities, access, changes, and every other selected event family.

Build first-class subservice assurance work for assurance-report coverage dates, bridge letters, current vendor review, report exceptions, complementary subservice controls, complementary user-entity controls, and the inclusive or carve-out conclusion.

Support an external-authority path on Audit Requests when the CPA firm's portal is authoritative. Reuse the normal Audit Request lifecycle and external-reference pattern. FileGRC should retain the request reference, owner, due date, response revision, delivery evidence, status, and reconciliation without duplicating confidential portal contents.

Audit readiness must include open Audit Requests and Findings before an audit can become complete. Management representation and assertion documents must require signers with active authority Appointments. Record the CPA firm's engagement terms and management's acknowledgement while keeping the firm's professional judgments outside FileGRC.

Before report issue, require a subsequent-events and significant-changes review for the period between the Type 2 period end or Type 1 date and the report date. Reconfirm incidents, changes, findings, subservice coverage, management representations, and system-description disclosures.

### Delivery, closure, and the next cycle

The packet-delivery approval flow records:

- Classification and least-disclosure review
- Redaction decision
- Approved recipient and delivery system
- Exact packet revision and checksum manifest
- Authorized management approval
- Delivery date and receipt

Generating a packet is preparation, not delivery. A delivery-ready packet should remain separate from a delivered packet.

Audit lifecycle findings guide each transition through planning, fieldwork, report draft, issue, delivery, and closure. A completed audit links the issued report, records the auditor's opinion and report date, resolves or accepts open requests and findings, records retention and distribution, and includes an explicit carry-forward action list, including an empty list when no next-period work remains. Modified opinions and final findings use management responses, remediation, customer communication, and next-period carryover. After report issue, track authorized distribution, retention, approved bridge letters, customer requests, and report expiry.

Audit closure should require resolved or accepted requests and findings, final management documents, issued report details, delivery record, retention decision, and carry-forward work. Then create or propose the next candidate period and audit cycle, reconfirm scope and Trust Services Categories, renew policy and vendor evidence, and preserve the completed report's exact coverage.

Add a Type 1 to Type 2 transition that carries forward approved scope and control design, starts the operating period after the as-of date, and detects later changes rather than rebuilding the program.

Do not require a separate Commitment for every supporting System. Support service-level commitments and system requirements, then require an explicit reviewed decision when a supporting System has no separate customer commitment.

### Model and release boundary

The guided workflow first shipped in model v3. Model v4 separated Workspace identity, Program scope, bounded Systems, operational Components, Vendors, Assets, and Evidence Artifacts. Model v5 separated governed Document approval from activation and assigned Documents to program or engagement workflow scope. Model v6 applied the same approval and activation split to Training and made Obligations the only source for assignment timing. Model v7 gave issued legacy engagement Documents the neutral `historical` basis, returned legacy Training to approved until a current activation is recorded, and kept migration mechanics out of compliance entities. Model v8 is current. It adds structured retention decisions, reviewed Requirement Mappings, supplemental Commitment tracing, and review invalidation when their source facts change.

The v2-to-v3 migration must provide preview and explicit apply modes. Classify every proposed change as automatic, review required, or unsupported. Preserve source facts and historical records. Never invent an approval, Appointment holder, applicability decision, evidence-source conclusion, control operation, event, or historical date.

The migration should:

- Add only facts that are mechanically derivable from existing records
- Keep migration mechanics, model versions, and FileGRC guidance in the preview, result, and Git history. Generated resource descriptions, rationales, summaries, purpose, boundary, and Markdown must state only compliance facts.
- Leave new decisions unreviewed and expose them through derived checklist items
- Preserve questionable draft effective dates and other ambiguous facts for human review rather than silently deleting or reinterpreting them
- Convert compatible existing source mappings, obligations, and audit scope without widening their coverage
- Stop reading obsolete manual page-completion state. If it exists in committed source, preview its removal before applying the migration.
- Validate the proposed post-migration workspace with the complete target-model validator before reporting that the migration is ready
- Apply target-model creates and updates in one whole-workspace batch that names the target model and changes `dataModelVersion`
- Produce a reviewable file diff and the same post-migration assessments in browser, CLI, and agent output
- Keep v1-to-v2 migration support separate and deterministic

### Verification plan

Test the roadmap as one contract across domain functions, CLI, HTTP, browser, static output, and direct-file agent guidance:

- Every resource type returns useful guide, scaffold, finalization, and next-action output
- Every starter assertion has a generated-workspace contract test
- Every multi-record workflow has atomicity and stale-revision tests
- Every browser mutation has an equivalent CLI and HTTP path
- Every derived checklist item, Work Item, and assessment state is identical across interfaces
- Every stage has empty, partial, complete, not-applicable, external-system, overdue, and regressed fixtures
- Type 1, Type 2, external-reviewer, no-employee, no-vendor, fully outsourced, multi-service, overlapping-audit, late-entry, shallow-history, and mid-period-change fixtures cover the edge paths
- Packet tests cover subservice reports, bridge letters, zero populations, external audit portals, subsequent events, delivery approval, modified opinions, and next-cycle carryover
- Browser journey tests start from a fresh generated repository and prove that a SOC 2 newcomer can follow only surfaced TODOs to each milestone
- Agent journey tests start with no FileGRC context and reach the same milestones using only structured guide, scaffold, references, mutation preview, write, and verification output

Implement and verify the plan in vertical slices:

1. Assessment foundation. Add the shared assessment kernel, reproducible result envelope, derived checklist items, Work Item projection, mutation preview, and `workflowDelta`. Replace manual page completion. Keep all interfaces on the same read-only calculation.
2. Model v3 and starter migration. Add reviewed applicability facts, core Appointments, custom Appointment support, completion profiles, missing lifecycle fields, starter prompts, and the v2-to-v3 migration. Generate and validate fresh and migrated workspaces.
3. Guided program operation. Add batch flows, policy and control finalization, source-coverage dry runs, atomic domain transitions, direct-file reconciliation, obligation fanout, and complete Work Queue mutations across every interface.
4. Period Health. Apply the assessment kernel across candidate and formal periods, add effective-revision and source-history coverage, detect regressions and contemporaneity gaps, and enforce milestone-aware CI.
5. Audit lifecycle. Add engagement scope diffing, period feasibility, expected-occurrence coverage, populations, subservice assurance, external Audit Requests, subsequent events, delivery approval, closure, Type 1-to-Type 2 transition, and next-cycle carryover.

A slice is complete only when domain, CLI, HTTP, browser, static, generated guidance, migration, and fixture tests agree. Do not defer headless or browser parity to a later cleanup phase.

## Safety

- Resolve and validate all paths against the repository root.
- Reject duplicate IDs and broken references.
- Write to a temporary sibling file, flush it, and rename it into place.
- Bind the editable server to loopback by default. Any network deployment needs authentication in front of it.
- Do not follow external links or download evidence automatically.
- Escape rendered content by default.
- Treat Markdown as untrusted input and allow only a small supported subset.
- Never render raw secrets into generated output.
- Make evidence classification visible before export.

## Versioning contract

Models v1 through v7 are published and frozen. Model v8 is current. It adds structured Retention Schedule Items, reviewed Requirement Mappings, source-linked Commitments, and organization-defined obligation activities and event names. Compatible additions can update the active model with its starter data, generated docs, and tests. New workspaces receive current starter-library content. Existing workspaces receive exact, reviewable diffs only for unchanged starter defaults, and FileGRC requires explicit acceptance of the named proposal and its exact revision before writing them. Acceptance fails when the proposal changes after review. Customized or adopted Policy content and organization-owned Retention Schedule Items remain untouched. Accepting a starter proposal does not approve governed content, activate it, select a retention period or disposition, or mark a Control implemented. Keep packaged policy-library Markdown byte-identical to the corresponding create-workspace template and enforce that relationship in tests. A change that would make an existing workspace invalid needs a new model version, an explicit preview and apply migration, and agent-discoverable upgrade guidance.

Package versions stay unchanged during normal development and move together when both published packages change. Before 1.0, a release with any breaking published change increments the minor version. A release containing only backward-compatible published changes increments the patch version. A migration path helps users adopt a breaking data-model release, but the release still receives a minor version increment. Publish `filegrc` before `create-filegrc` so the generator can resolve its matching engine release.

## Delivery state

Implemented:

- Versioned model registry and generated model documentation
- npm workspace and both zero-build packages
- Generic policy, plan, acknowledgement, and training Markdown
- Data discovery, schema checks, relationship checks, and path checks
- Git repository state and per-file history
- Overview, list, detail, repository, search, and filter views
- Guided live JSON and Markdown CRUD, safe related-content deletion, stale-write detection, and a read-only static build
- Prompt-driven repository creation, sentence-safe template substitution, registry or local-package dependency resolution, lockfile creation, and Git initialization
- A six-record foundation profile and the default SOC 2 Security starter layer, with optional combined noninteractive service setup
- Full resource fixtures and unit and end-to-end tests using Node.js built-ins
- Browser journey checks and reviewed desktop, mobile, light, and dark screenshots for the main user flows
- SOC 2 Security Common Criteria and Description Criteria references, planned controls, core Appointments, recurring and event obligations, risk defaults, source-family coverage, and classification defaults in newly generated workspaces
- Model v3 with explicit v2-to-v3 migration preview and apply modes
- One shared workflow contract for browser, HTTP, CLI, static, direct-file, and agent use, including named assessments, deterministic Work Items, finalization checks, ranked next actions, mutation previews, and workflow deltas
- Guided applicability review, external independent review, event-risk, direct-file reconciliation, milestone, Period Health, audit transition, delivery, and closure flows
- Browser and HTTP parity for Action Item and Policy Event completion plus evidence attachment and removal

Next:

- Add licensed criteria content and optional trust-category mappings
- Add optional signing of the checksum manifest with an organization-controlled key

## Decisions still open

- Evidence size limits and confidential-evidence policy
