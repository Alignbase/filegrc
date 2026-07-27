# FileGRC Architecture and Delivery Plan

## Status

The first end-to-end implementation is in place. Model v1, validation, Git metadata, search, filtering, atomic CRUD, policy obligations, event checklists, evidence packets, the local web app, static builds, onboarding, the generator, generic policies, training, acknowledgements, and tests all run from this monorepo.

Later passes can add licensed framework content, deeper control mappings, and guided evidence capture.

## Product

FileGRC is a Git-native GRC workspace for SOC 2 programs. Engineers and agents maintain plain files, while a small Node.js engine renders an audit overview and provides validation, search, filtering, and CRUD utilities.

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
    │   │   └── v1.json
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

### Headless agent contract

A generated workspace must be operable by an agent that knows Git and JSON but has no FileGRC context. The root `AGENTS.md` explains the program and Git behavior. `data/AGENTS.md` defines the universal record workflow. Collection-level instruction files add compact rules for areas where a wrong action could weaken an audit, lose evidence, or expose data.

`filegrc guide --json` is the compact action and type index. A type-specific guide combines the model definition with current relationship candidates, policy basis, cadence, storage location, and Markdown slots. `filegrc scaffold` produces an incomplete `{ record, content }` mutation with a generated ID and explicit missing values. Scaffolds remain in a non-final lifecycle state and must not contain fabricated compliance facts.

`filegrc get <id> --mutation` exports the complete record, existing Markdown, and their revisions. `filegrc update` consumes that shape and rejects a stale JSON or Markdown revision. Create and update therefore use the same payload and domain functions as the HTTP and browser paths.

Every model resource must have automated guide and scaffold coverage. Multi-record commands must validate their domain rules and write through one serialized mutation. This includes obligation completion, policy event creation and closure, audit preparation, and evidence attachment management. Program Readiness must use the same domain calculation in the CLI, HTTP state, static state, and browser.

## Model registry

The `filegrc` package is the only source of truth for the data model:

```text
packages/filegrc/model/v1.json
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

The engine loads the registry directly. Validation, CRUD forms, relationship pickers, list columns, filters, search indexing, CLI descriptions, and generated reference documentation all use the same definitions.

`packages/filegrc/model/index.js` loads the registry and exposes a stable Node.js API.

Generated repositories contain only their records and a `dataModelVersion` in `data/workspace.json`. They do not receive copied schema files.

`docs/data-model.md` is generated from v1. `npm run validate` fails when the generated document differs from the registry.

The registry may expose a JSON Schema projection for editors and outside tools, but that projection is generated output. It is not a second schema authority.

### `create-filegrc`

`create-filegrc` creates a standalone repository with:

- A private `package.json`
- One dependency, `filegrc`
- A lockfile
- Scripts for serving, building, and validation
- Generic seed records
- A high-level README
- Detailed consumer instructions in `AGENTS.md`
- A `data/` directory using the current data-model version

The generator resolves the current `filegrc` release and records a normal semver range. This keeps initial output current while the lockfile makes installs repeatable.

The generator reads `packages/create-filegrc/template-parameters.json` and asks for three values:

- Company name
- Policy owner name, shown to the user as "Your name"
- Security contact email

It generates the initial effective date from the current date. These four values replace tokens such as `{{company_name}}` in the template. Creation fails if the template contains an undeclared token or if any token remains after rendering.

This is the smallest useful initial prompt set. The company name identifies the program and appears in policy text. The policy owner gives the seed records an accountable person. The security email gives people one report and escalation route. Timezone defaults to UTC, and users can edit it later. Jurisdiction, industry, risk scoring, retention periods, control owners, system scope, and audit plans do not need create-time prompts.

## Starter SOC 2 baseline

`create-filegrc` generates a Security-category baseline before organization-specific onboarding:

- The AICPA 2017 Trust Services Criteria with revised points of focus (2022)
- All 33 Common Criteria reference IDs from CC1.1 through CC9.2
- The AICPA 2018 SOC 2 Description Criteria with revised implementation guidance (2022)
- All nine Description Criteria reference IDs from DC1 through DC9
- A planned control catalog mapped to the Common Criteria and starter policies
- A security and risk oversight team chaired by a reviewer who is separate from the policy owner. The reviewer may be internal or external.
- Recurring obligations derived from the fixed review, scan, test, training, and meeting cadences in the starter policies
- Event obligations for workforce starts, role changes, departures, personal devices, vendor access and reassessment, material system or data-use changes, and incidents
- General and role-based training, including conditional secure-development, privileged-role, and anti-bribery modules
- A governed data retention schedule plus annual and material-change review work
- Annual incident-response and end-to-end alert-path testing
- A default 5x5 likelihood-and-impact risk method
- Public, Internal, Confidential, and Restricted classification definitions

The baseline does not redistribute licensed criteria text. It stores reference IDs and an official source link. It also does not create organization-specific systems, vendors, risks, service commitments, audit periods, or evidence. Optional renderer onboarding collects one initial system boundary and an optional management goal, then stores them on the workspace. It does not create an audit engagement, appoint the independent management reviewer, add optional trust categories, or claim that the initial scope is complete.

Every starter control is `planned`. A user must confirm the owner, system scope, actual procedure, cadence, evidence source, implementation date, and mappings before marking it implemented. A policy statement alone does not prove that a control operates.

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

An `obligation` is a reusable policy rule. It remains a proposal until every governing policy is active and its effective date has arrived. Calendar obligations define a recurrence whose anchor is the first day of a compliant cycle. If a governing policy takes effect after the stored recurrence anchor, the policy effective date becomes the first cycle anchor. Unless the policy narrows it, the allowed completion window runs through the day before the next cycle and becomes overdue on the next cycle’s first day. A dated record explicitly linked through `completionResourceIds` satisfies the occurrence whose window contains that date.

Event obligations define an `eventType`, a prompt, owners, completion record types, and a due window relative to the event. FileGRC rejects an event while a governing policy is still a proposal. Starting an active event creates an `obligation-event` and all required `action-item` records as one validated write. Day windows preserve policies such as “within 30 days.” Hour windows preserve exact timestamps for rules such as same-time or 24-hour access removal. The starter obligations use policy-specific cutoffs. FileGRC applies a 30-day deadline when a custom event obligation omits one, so every generated action can become overdue.

`planObligations` is the shared calculation used by the dashboard, obligation board, HTTP API, and `filegrc obligations` CLI command. `createObligationEvent` is the shared write path used by the UI, API, and `filegrc trigger`. Calendar completion uses one validated mutation to create the dated operating record and append it to the obligation's `completionResourceIds`; the obligation board, API, and `filegrc complete` use that same transaction. The planner does not write derived occurrence records for calendar schedules.

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

CRUD operations write files atomically but do not create hidden commits. Record and Markdown updates use content revisions, so a stale browser cannot overwrite a newer filesystem change. Deleting a draft also deletes authored Markdown that no other resource references. The Repository page shows the workspace diff and creates a validated local commit when no remote exists. Once a remote is configured, it also pulls with rebase and pushes immediately after a browser commit. A failed push leaves the local commit intact and reports the failure. Agents and terminal users own synchronization and use native Git commands.

## Program readiness

Program Readiness answers whether management can begin a candidate Type 2 period. It has no audit ID or CPA firm requirement. The stages are:

1. Define scope.
2. Approve policies.
3. Implement controls.
4. Prepare evidence by configuring sources and testing collection.
5. Operate the program.

The Evidence Ready gate requires an assurance goal, selected systems, criteria, controls, effective policies, implemented controls, cataloged authoritative systems, and one verified test export or capture for every selected control family. `assessProgramReadiness` supplies the same calculation to `filegrc program-readiness`, the homepage progress tracker, HTTP state, and static state. Current risk assessments and risks belong to program operation, where their conclusions may add or change controls. Audit preparation still requires a current independently reviewed assessment.

The renderer adds Audit as the sixth and final lifecycle stage. That stage covers the CPA firm, formal period, fieldwork, evidence packet, and report. Criteria remain part of scope because management must decide what applies before adopting policies.

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

The evidence-packet engine supports a Type 1 as-of date and a Type 2 period. It selects records explicitly related to the engagement, its scope, systems, controls, criteria, policies, dependencies, and evidence, so an unrelated dated record is not disclosed just because it falls in the date range. Type 2 adds recurring obligation coverage, event checklists, complete populations, and samples. Delivery-ready checks cover management's work and packet integrity. They do not claim that the engagement team found the evidence sufficient or appropriate.

Packet output is derived under `.filegrc/evidence-packets/`. It contains an auditor-oriented HTML index, a machine-readable manifest, a control matrix, source-system index, external-evidence delivery index, evidence index, Type 2 population index, raw JSON source records, governed Markdown, fixed local attachments, committed historical versions, and per-file SHA-256 checksums. External references are listed but never fetched and keep the packet in review-required state. The packet records the source revision and whether the worktree was clean, so incomplete or uncommitted output is visibly marked as a draft.

The model registry owns the four management-document definitions, ten standard population kinds, and authoritative source-system guidance used by every interface. `prepareAuditWorkspace` creates engagement-specific documents from the local starter templates. For Type 2, it also creates missing population records, maps starter controls by code, and selects a source system when exactly one cataloged system has the required evidence role. It does not approve or complete the resulting records. `assessAuditPreparation` begins with Program Readiness, then checks the CPA engagement, firm-agreed period, fieldwork records, and auditor-owned steps. It provides the same scoped checklist to the renderer, CLI, static build, and packet readiness checks.

Each `audit-population` records management’s reconciliation state for one complete population. The population and its linked `population-export` evidence must name the same cataloged source system. The evidence records the exact query or report parameters, timezone, generation timestamp, record count, and completeness and accuracy validation. Split populations when source systems or queries differ. A zero-event population still needs a fixed source export and query. A population linked to an in-scope control cannot be dismissed as not applicable.

`assessAuditPreparation`, `prepareEvidencePacket`, `generateEvidencePacket`, and `writeEvidencePacket` are shared by the audit page, HTTP API, CLI, and static state. UI and headless callers therefore receive the same management checklist, selected records, and coverage gaps. Packet generation waits for in-flight workspace writes and blocks new ones until its source snapshot is copied and checked.

People who do not have repository access may acknowledge policies, training, or tasks with a signed PDF or image. The corresponding attestation records the signer, signing date, acknowledgement statement, exact content revisions, and evidence file. Repository collaborators may use a reviewed Git commit as an attestation when the workflow permits it.

Training material is canonical Markdown. A reusable `training` record defines its audience and assignment cadence. One `attestation` per assigned person records completion, the exact training revision, and any signed evidence.

## Rendering

The homepage includes a program progress tracker and an Evidence Collection Running milestone. Its six-step path is Define Scope, Approve Policies, Implement Controls, Prepare Evidence, Operate the Program, and Audit. Each step links to its overview page rather than a separate readiness checklist. Continue opens the first step page with unfinished work. Page completion tracks the user’s progress through the path, while Program Readiness separately checks whether management can begin reliable evidence collection. Audit remains last, though the Audit area stays available when a customer deadline needs early CPA input. Validation and Git status remain visible in the top bar.

The sidebar groups records by their job:

- Define Scope: people and the oversight team, criteria, commitments, material vendors, and in-scope systems
- Approve Policies: policies and governed documents
- Implement Controls: the starter control set, implementation fields, complementary customer or subservice controls, and operation-tracking status
- Prepare Evidence: authoritative source configuration followed by verified test exports or captures
- Operate the Program: risk assessments and risks, the Work Queue, data requests, asset inventory, vendor reviews, governance, access, security, resilience, training, findings, and exceptions
- Audit: engagements and requests, populations, tests, packet preparation, fieldwork, and reports

Resource types are nested only when the extra grouping adds meaning. Organization settings remain anchored at the bottom.

The Controls page explains what the generated workspace already supplies and what management must tailor before a planned control becomes implemented. Its operation-tracking column distinguishes controls linked to recurring or event work in FileGRC from controls documented through evidence records. The Evidence page presents source configuration and test collection as two ordered tasks and shows control-family coverage for both.

Each of the six lifecycle steps has its own overview route. Clicking a step label opens that page, while its separate chevron expands or collapses the step in place. Nested subgroup rows toggle their drawers and do not have separate overview pages. Step pages link each record or working page in order, summarize record counts, and let users mark each page complete or incomplete. New workspaces start at zero percent until the user confirms the work.

Third-party software commonly needs both a `system` and a `vendor`. The application is the System because it operates controls and produces evidence. The provider is the Vendor because contracts, due diligence, and supplier risk belong to the relationship. `system.vendorId` connects them, and evidence names the System as its source.

For obligations whose governing policies are active and effective, the dashboard derives the next calendar occurrence from the recurrence rule and applicable policy effective date. Explicit operational due dates take precedence. Each completed occurrence remains a separate operating record with its own evidence. Starter obligations remain proposals until policy adoption.

Each resource type gets a responsive list page with search and filters, plus a detail page that combines the current record, linked resources, Markdown, and Git history. Both views show model-defined guidance for the resource's purpose, policy basis, and timing. When the workspace contains the referenced policies, documents, or recurring obligations, the guide links to those current records and schedules. The dashboard reports data validity, Program Readiness, evidence collection, and Audit Readiness separately, so a valid starter schema is not presented as an operating program or active engagement.

The local app generates guided fields and relationship pickers from the model, with advanced JSON available for optional fields and extensions. Global and list search include authored Markdown. Static builds provide the same browsing, search, and filter flows without write actions.

New generated workspaces include `data/renderer.json` with `showOnboarding` set to `true`. The local renderer explains the file and Git model, the program path, policy obligations, and event checklists before covering report types and the final audit stage. The setup step collects the initial service boundary, owner, business criticality, highest data classification, internet exposure, and optional Type 1 or Type 2 management goal. It creates or updates a system, stores the scope and goal on the workspace, and sets `showOnboarding` to `false`. It does not create an audit. The final screen opens the Step 1 overview so management can confirm the starter people and oversight team, criteria, commitments, vendors, and systems before approving policies. Skipping also sets the flag to `false`. These writes remain uncommitted until a user or agent reviews and commits them from Repository or the Git CLI.

Onboarding never runs in a read-only build. It can be restarted from Repository, or bypassed entirely by editing the same data files through an agent or other tooling. Repositories created before the renderer settings record remain valid and do not start onboarding automatically.

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

## Pre-release contract

FileGRC has one data model, v1, and both packages stay at `0.1.0` during normal development. Before the first npm publication, schema and template changes update that single contract directly. There is no migration command or historical reader yet because no consumer release exists.

After the first publication, reassess versioning from the contract that actually shipped. Do not add speculative compatibility code now.

## Delivery state

Implemented:

- Versioned model registry and generated model documentation
- npm workspace and both zero-build packages
- Generic policy, plan, acknowledgement, and training Markdown
- Data discovery, schema checks, relationship checks, and path checks
- Git repository state and per-file history
- Overview, list, detail, repository, search, and filter views
- Guided live JSON and Markdown CRUD, safe related-content deletion, stale-write detection, and a read-only static build
- Prompt-driven repository creation, dependency resolution, lockfile creation, and Git initialization
- Full resource fixtures and unit and end-to-end tests using Node.js built-ins
- Browser journey checks and reviewed desktop, mobile, light, and dark screenshots for the main user flows
- SOC 2 Security Common Criteria and Description Criteria references, planned controls, oversight ownership, recurring obligations, risk defaults, and classification defaults in newly generated workspaces

Next:

- Add licensed criteria content and optional trust-category mappings
- Add optional signing of the checksum manifest with an organization-controlled key

## Decisions still open

- Evidence size limits and confidential-evidence policy
