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
            └── docs/filegrc-home.png
```

The template README is the source for the monorepo root README. If its screenshot uses a relative path, the monorepo will expose a matching root path without copying the image.

## Package responsibilities

### `filegrc`

`filegrc` is a zero-dependency Node.js package with no build step. It owns:

- The authoritative, versioned GRC data model
- Data discovery and parsing
- Schema and relationship validation
- Git history queries
- Search and filtering
- Safe file creation, editing, and deletion
- Local HTTP serving
- Static audit-overview generation
- Recurring and event-driven obligation planning
- Audit-period evidence packet generation
- HTML, CSS, and browser JavaScript assets

Commands:

```text
filegrc serve
filegrc build
filegrc validate
filegrc model
filegrc describe <resource-type>
filegrc obligations
filegrc trigger <event-type>
filegrc evidence-packet
```

`filegrc serve` provides the interactive local view and CRUD operations. `filegrc build` creates a read-only static view. `filegrc validate` is suitable for local use and CI.

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
- A security and risk oversight team with a quarterly meeting cadence
- Recurring obligations derived from the fixed review, scan, test, training, and meeting cadences in the starter policies
- Event obligations for workforce changes, vendor access, material system changes, and incidents
- A default 5x5 likelihood-and-impact risk method
- Public, Internal, Confidential, and Restricted classification definitions

The baseline does not redistribute licensed criteria text. It stores reference IDs and an official source link. It also does not create organization-specific systems, vendors, risks, service commitments, audit periods, or evidence. Optional renderer onboarding collects one initial system boundary and may create one planned readiness, Type 1, or Type 2 engagement. It does not add optional trust categories or claim that the initial scope is complete.

Every starter control is `planned`. A user must confirm the owner, system scope, actual operation, and evidence before marking it implemented. A policy statement alone does not prove that a control operates.

## Storage

Structured resources use JSON because Node.js can parse it without dependencies and tools can edit it reliably. All internally authored long-form content uses Markdown, including policies, charters, plans, procedures, minutes, system descriptions, assertions, narratives, templates, and audit responses.

Signed forms, third-party reports, screenshots, and immutable exports are evidence rather than canonical documents. These files may remain PDF, image, CSV, or another fixed format when that representation is part of the proof. Evidence records describe every supporting file or external reference.

```text
data/
├── workspace.json
├── renderer.json
├── content/
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
└── audit-requests/
```

Most records are one JSON file. Long-form content is a Markdown companion beside that JSON file, and the model names each supported Markdown slot. The primary companion uses the JSON basename with `.md`; secondary companions add a semantic suffix such as `-agenda.md`. Records do not store Markdown paths. The renderer and CLI derive them from the stable record location. Evidence that includes local files gets its own directory containing `evidence.json`, an optional `evidence.md`, and the files it describes.

Policies and other authored documents do not carry embedded change-control tables. Git is their change history. A human-facing policy version remains available when it has contractual or organizational meaning.

Generated or cached data never belongs in these directories.

## Policy obligations

An active `obligation` is a reusable policy rule. Calendar obligations define a recurrence whose anchor is the first day of a compliant cycle. Unless the policy narrows it, the allowed completion window runs through the day before the next cycle and becomes overdue on the next cycle’s first day. A dated record explicitly linked through `completionResourceIds` satisfies the occurrence whose window contains that date.

Event obligations define an `eventType`, a prompt, owners, completion record types, and a due window relative to the event. Starting one event creates an `obligation-event` and all required `action-item` records as one validated write. Day windows preserve policies such as “within 30 days.” Hour windows preserve exact timestamps for rules such as same-time or 24-hour access removal. The starter obligations use policy-specific cutoffs. FileGRC applies a 30-day deadline when a custom event obligation omits one, so every generated action can become overdue.

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

CRUD operations write files atomically but do not create hidden commits. Record and Markdown updates use content revisions, so a stale browser cannot overwrite a newer filesystem change. Deleting a draft also deletes authored Markdown that no other resource references. The Repository page shows the workspace diff and offers an explicit Commit changes action after validation. It scopes the commit to the workspace and uses the configured Git identity. The Git CLI remains available for every workflow.

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

For a period review, the evidence-packet engine indexes every model-defined date and timestamp in the selected range, plus records whose explicit period overlaps it. It then adds recurring obligation coverage, event checklists, linked evidence, active policies, mapped controls and requirements, and selected audit scope. It reports missing completions, incomplete event actions, unverified or revision-unbound evidence, and a dirty Git worktree.

Packet output is derived under `.filegrc/evidence-packets/`. It contains an auditor-oriented HTML index, a machine-readable manifest with per-record Git history, raw JSON source records, governed Markdown, and fixed local attachments. External references are listed but never fetched. The packet records the source revision and whether the worktree was clean, so uncommitted output is clearly marked as not ready to send.

`prepareEvidencePacket` and `writeEvidencePacket` are shared by the audit page, HTTP API, and `filegrc evidence-packet`. UI and headless callers therefore select the same records and receive the same coverage gaps.

People who do not have repository access may acknowledge policies, training, or tasks with a signed PDF or image. The corresponding attestation records the signer, signing date, acknowledgement statement, exact content revisions, and evidence file. Repository collaborators may use a reviewed Git commit as an attestation when the workflow permits it.

Training material is canonical Markdown. A reusable `training` record defines its audience and assignment cadence. One `attestation` per assigned person records completion, the exact training revision, and any signed evidence.

## Rendering

The homepage provides an audit-oriented program overview:

- Data validation state
- Control and evidence counts
- Open findings, exceptions, actions, and audit requests
- Active audit request progress
- Open dates and deadlines
- Governance and risk resource counts
- The complete resource catalog
- Current Git revision and uncommitted-change count

Primary pages group the resource catalog into:

- Program: frameworks, requirements, commitments, complementary controls, controls, and control tests
- Governance: policies, documents, teams, meetings, training, attestations, and data requests
- Risk: risks, assessments, exceptions, and related committee meetings
- People and Access: people, service accounts, grants, and access reviews
- Systems and Vendors: systems, assets, vendors, and vendor reviews
- Security Operations: vulnerabilities, scans, incidents, and penetration tests
- Resilience: continuity assessments, exercises, recovery objectives, and backup tests
- Evidence: screenshots, signed acknowledgements, reports, exports, and their provenance
- Findings and Work: findings, actions, obligations, and due dates
- Audits: engagements, requests, control testing, exceptions, responses, and reports
- Repository: Git history, uncommitted changes, validation, and workspace settings

For active obligations, the dashboard derives the next calendar occurrence from the recurrence rule and anchor date. Explicit operational due dates take precedence. Each completed occurrence remains a separate operating record with its own evidence.

Each resource type gets a responsive list page with search and filters, plus a detail page that combines the current record, linked resources, Markdown, and Git history. Both views show model-defined guidance for the resource's purpose, policy basis, and timing. When the workspace contains the referenced policies, documents, or recurring obligations, the guide links to those current records and schedules. The sidebar and list-page context use the same six stages: Scope, Criteria, Policies, Controls, Operate Controls, and Audit. The dashboard reports data validity separately from setup and operating state so a valid starter schema is not presented as audit readiness.

The local app generates guided fields and relationship pickers from the model, with advanced JSON available for optional fields and extensions. Global and list search include authored Markdown. Static builds provide the same browsing, search, and filter flows without write actions.

New generated workspaces include `data/renderer.json` with `showOnboarding` set to `true`. The local renderer uses it to offer a short modal workflow covering the operating model: artifacts are files, Git is the audit trail, recurring obligations form the work queue, and evidence can be prepared in reviewed batches. Its setup step collects only compliance-domain scope: the initial service boundary, owner, business criticality, highest data classification, internet exposure, and optional audit objective. It creates or updates a system and optional planned audit, then sets `showOnboarding` to `false`. Skipping also sets the flag to `false`. These writes remain uncommitted until a user or agent reviews and commits them from Repository or the Git CLI.

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
- Full resource fixtures, unit and end-to-end tests using Node.js built-ins, and browser screenshot coverage for every current page
- SOC 2 Security Common Criteria and Description Criteria references, planned controls, oversight ownership, recurring obligations, risk defaults, and classification defaults in newly generated workspaces

Next:

- Add evidence capture metadata and audit completeness reports
- Add licensed criteria content and optional trust-category mappings

## Decisions still open

- Evidence size limits and confidential-evidence policy
