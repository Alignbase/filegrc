# filegrc Repository Instructions

## Purpose

This monorepo builds filegrc, a Git-native GRC system for SOC 2 work. It has two Node.js packages:

- `filegrc`: the zero-dependency filegrc engine, which validates, searches, edits, and renders GRC data.
- `create-filegrc`: the filegrc scaffolder, which creates a standalone SOC 2 repository.

The generated repository is the product. Keep it understandable to an engineer who opens it without prior context.

## Agent-facing product surface

Treat headless use as a first-class interface. An agent with no filegrc context must be able to discover the right record type, inspect current relationship candidates, create or update JSON and Markdown through one validated payload, complete scheduled and event work, prepare an audit, and verify the result without opening the renderer.

- Keep the generated root `AGENTS.md` as the program and Git guide.
- Keep `data/AGENTS.md` as the universal record workflow. Add collection-level `AGENTS.md` files only where a wrong action has material compliance, privacy, or audit consequences.
- Keep `filegrc guide`, `types`, `list`, `get`, `references`, `scaffold`, CRUD, `content`, obligations, events, program readiness, audit readiness, and evidence packets model-driven.
- Scaffold files are prompts, not compliance facts. They must keep incomplete work in a non-final state and make missing required values obvious.
- Browser and CLI mutations must use the same domain functions and the same `{ record, content }` shape.
- Every resource type must pass automated guide and scaffold coverage. Test first-class multi-record workflows through the CLI as well as their domain functions.

## Product principles

- Git is the system of record. GRC records live as plain, reviewable files under `data/`.
- Git supplies file history, authors, timestamps, diffs, commit messages, and revision IDs.
- Domain events still need explicit dates. Do not replace dates such as `occurredOn`, `approvedOn`, or `completedOn` with Git metadata.
- Do not store a second change log or duplicate Git-derived fields such as `createdAt`, `updatedAt`, `createdBy`, or `updatedBy`.
- The engine must work locally, in CI, and in a basic server environment with only a supported Node.js release and Git.
- The current repository state must remain useful without a network connection.
- Data files are authoritative. Rendered pages, indexes, caches, and reports are derived output.
- Never fetch external references automatically. A user may open or import one explicitly.
- Keep the model generic. Organization-specific fields belong in namespaced extensions.
- Keep the default starter Security-only and as simple as the Security Common Criteria permit. Do not turn optional Trust Services Categories or common implementation choices into default records or readiness gates. Require category-specific details, including numeric recovery objectives, only when management selects that category or an approved commitment or risk decision requires them.
- Prefer explicit, inspectable behavior over automation that changes audit records without review.
- UI, HTTP, and CLI workflows must call the same domain functions so headless agents receive the same calculations, validation, and output as browser users.

## Standards alignment

- Use AICPA SOC 2 terms for the assurance subject matter and use NIST OSCAL as the main interoperability reference for machine-readable GRC structure.
- Preserve OSCAL's useful separation among catalogs and requirements, profile-like applicability and tailoring, bounded Systems, Components, inventory items, control implementation, assessment plans, and assessment results. Keep FileGRC's flat, Git-reviewable records and typed ID relationships instead of reproducing OSCAL's nested document structure.
- Use OSCAL names only when the FileGRC concept has the same meaning. In particular, reserve `Profile` and `tailoring` for control selection or modification, `parameter` for a defined requirement placeholder and its assigned value, and `Component`, `Information Type`, and `inventory item` for their established model roles. Do not rename a broader FileGRC workflow to an OSCAL term merely because the records overlap.
- Keep FileGRC IDs canonical. Store OSCAL and other standards identifiers in `externalIds` or model-defined mappings, and preserve source provenance and reviewed mapping rationale rather than copying authoritative source text.
- Model organization-specific decisions separately from reusable catalog or starter content. A library upgrade may propose catalog, Policy, or template changes, but it must not overwrite management applicability, parameters, Controls, schedules, Commitments, or other organization-owned records.
- Do not claim OSCAL compatibility from conceptual alignment alone. Claim compatibility only for an explicit import or export path that validates its output against the supported official OSCAL schema and documents any lossy or FileGRC-specific mappings.

## Source truth and derived workflow axiom

- Files under `data/`, including companion Markdown, are the authoritative program record. Store organization facts, decisions, relationships, status, dates, and evidence references there.
- Individual resource files do not need to describe everything required for program or audit readiness. Do not copy generic readiness instructions, calculated TODO lists, or derived blocker state into every record.
- The active model, authoritative records, policy content, and Git state are the inputs to shared domain functions that calculate applicability, missing work, blockers, allowed actions, program readiness, audit readiness, and evidence-packet readiness.
- The browser, HTTP API, and CLI, including machine-readable CLI output used by agents, must expose the same derived workflow state and next actions from those shared domain functions. No interface may maintain its own readiness rules or require users to infer work that another interface calculates.
- Use progressive disclosure in every interface. A program stage states the outcome, a page states its purpose, and current record or action UI shows the detailed checks needed now. Keep complete criteria available through guides, workflow output, record editors, and action previews instead of repeating them in high-level descriptions.
- Mark a derived item `blocked` only when it cannot proceed until named prerequisite records are resolved. Missing records, editable errors, and management decisions are `ready` when the user or agent can act on them now, even when they prevent an assessment from passing.
- Keep derived workflow output disposable and reproducible. It may be rendered, indexed, or cached for use, but it must never become a second source of truth.
- A user or agent who edits source files directly must receive the same validation, guidance, and readiness result as a user who performs the equivalent work through the browser or CLI.
- Persist a TODO only when the TODO is itself an authoritative program record, such as an assigned Action Item with an owner, deadline, and completion proof. Derive informational next steps and blockers instead of storing them.
- When FileGRC cannot infer that management reviewed a complete or empty collection, persist a model-defined Collection Review with the conclusion, reviewer, date, current scope revision, and calculated collection revision. Keep the review criteria in the model, show them in every interface, and mark the confirmation stale when a reviewed record or material scope fact changes.

## Package constraints

### `filegrc`

- Use Node.js built-in modules only.
- Do not add runtime, development, test, build, or rendering dependencies.
- Do not require a compilation or bundling step.
- Use `node:test` and other built-in tooling for tests.
- Keep file parsing, validation, Git access, HTTP handling, and rendering behind small internal interfaces.
- CRUD operations may write files but must not create commits unless the user explicitly requests it.
- Writes must be atomic and must reject paths outside the workspace.

### `create-filegrc`

- Follow the `npx create-*` convention and support `npx create-filegrc@latest`.
- Generate a private Node.js project whose only package dependency is `filegrc`.
- Resolve the current `filegrc` release when generating, write a normal semver range, and create a lockfile. Do not write the literal dependency specifier `latest`.
- Do not overwrite a non-empty target without explicit user approval.
- Initialize Git when the target is not already inside a Git worktree.
- Keep the template usable without private services or organization-specific values.
- Define create-time prompts once in `packages/create-filegrc/template-parameters.json`.
- Keep create-time prompts limited to values needed throughout the initial repository. Prefer documented defaults and later edits for optional configuration.
- Replace every template token during creation and fail if a token is unknown or remains unresolved.

## Data rules

The active authoritative model registry is the standalone `packages/filegrc/model/v8.json`. Models v1 through v7 are published and frozen for migrations, compatibility tests, and reference. Breaking changes belong in a new model version with an explicit migration path. Keep the active model, starter data, generated docs, and tests in sync.

- Use UTF-8 JSON for structured records and Markdown for long-form content.
- Store canonical long-form Markdown beside its structured JSON record. filegrc derives companion names from the JSON location and Markdown slot; do not store those paths in record data.
- Structure fields only when the engine needs them for validation, filtering, relationships, lifecycle rules, due-date calculations, or audit-period completeness.
- Put variable procedures, questionnaires, interviews, per-item decisions, detailed results, and provider-specific analysis in Record Markdown. The model's `recordContent` settings determine when the renderer shows this companion body by default.
- Do not reproduce a source form as a nested schema. Add a field only after a stable cross-workflow need is clear.
- Store all internally authored long-form content in Markdown. Policies, plans, charters, procedures, minutes, training material, assertions, narratives, templates, and audit responses must not use PDF or DOCX as their canonical format.
- Treat signed forms, third-party reports, screenshots, and immutable exports as evidence attachments. They may be PDF or image files because their fixed representation is part of the evidence.
- Use one stable, globally unique, human-readable ID per resource.
- Use ISO 8601 dates and timestamps.
- Store relationships as resource IDs, not relative file paths.
- Treat IDs as immutable after a record is committed.
- Keep attachments behind evidence records. Do not scatter unexplained files through `data/`.
- Keep each policy and governed document approver separate from its owner. The reviewer may be another person in the organization or an external person. Use an internal reviewer with enough authority and separation to challenge the owner when one is available. Otherwise, appoint a qualified external reviewer.
- Bind Policy and governed Document approvals to the exact companion Markdown revisions reviewed. Move changed approved content back through review before recording a new approval.
- Keep identity separate from assigned authority. A Person records the individual’s actual organization job title. A dated Appointment records named authority such as CISO, DPO, Policy Owner, or team chair and may be used by accountable-party fields. Fields that prove who performed, reviewed, collected, verified, attended, or attested to work must continue to name the actual Person.
- Keep Team membership authoritative on the Team record.
- Bind rendered-page evidence to the route, filters, audit period, and Git commit used to create it.
- Bind signed attestations to the exact Git revisions of the acknowledged policies, training, or other content.
- Do not commit secrets, credentials, session material, regulated personal data, or confidential reports unless the repository's access and retention rules explicitly permit them.
- Keep personal data out of immutable Git history when a later deletion request may require erasure. Use an opaque case ID and a reference to an approved system instead.
- Preserve closed and retired audit records when they explain historical control operation. Use deletion for mistakes and uncommitted drafts.
- Model recurring policy work as reusable obligations with an explicit allowed completion range and first overdue cutoff. Every actionable obligation needs a deadline; use the end of its policy period or a reasonable policy-aligned event window when the source does not name one.
- Model policy-triggering changes as one event record plus normal linked action items. Create the full checklist atomically and preserve exact timestamps when a policy uses hour-based deadlines.
- Enforce each Policy Event’s model-defined subject types and cardinality, and each Obligation activity’s allowed recurrence modes and scope resource types.
- Keep scheduled dates separate from actual completion dates. Completed operating records must name their actors, result, supporting evidence, review, coverage, and completion time when the model requires them.
- Use one Vendor Review per Vendor so its decision, coverage, evidence, and follow-up are unambiguous.
- Build audit packets from an explicit Type 1 or Type 2 engagement, its exact date or period and scope, model-defined dates, policy and control context, and linked evidence. Add obligation coverage, event checklists, populations, and samples for Type 2. Keep packet output under `.filegrc/` and bind delivery-ready output to a clean Git revision.
- Never report filegrc management checks as passed when the required scope, management documents, approved policy coverage, implemented control coverage, source Components, evidence, or Type 2 population work is missing. Do not imply that filegrc decides whether evidence is sufficient or appropriate; the engagement team makes that judgment.
- Export auditor control, population, and evidence indexes, committed historical source versions, and per-file checksums with every packet. External references remain warnings because the packet is not self-contained.
- Use one `audit-population` record for each complete management population and link its fixed `population-export` evidence. Record the evidence generation time, exact query or report parameters, timezone, count, and completeness and accuracy checks, including when the count is zero. Link the population and sampled-item evidence from the related control test.
- Catalog every authoritative evidence source as a `component`, assign its `evidenceSourceKinds`, name the people who can obtain evidence, and keep extraction instructions in Record Markdown. A reconciled population and its Evidence Artifact must name the same source Component. Split a population when its items require different source Components or queries.
- Every Evidence Artifact names its collector. Verified Evidence Artifacts also name their verifier and verification date. A source export links the cataloged source Component.
- Define fields, types, enums, relationships, conditional requirements, and default UI metadata once in the model registry. Validators, CRUD forms, filters, search indexing, CLI help, and generated model documentation must consume that registry.
- Do not hand-copy model definitions into validators, templates, generated repositories, or documentation.
- Generate `docs/data-model.md` from the registry. Do not edit generated model documentation by hand.
- Generated repositories declare one required workspace `dataModelVersion`, do not repeat schema versions on individual records, and do not contain a copy of the model.
- Reject unknown top-level record fields. Organization-specific values belong under the common `extensions` object.

## Private reference material

Private exports may be inspected to understand generic workflows, but they are not source content.

- Do not copy names, identifiers, prose, screenshots, reports, URLs, or business records from private reference material.
- Do not mention the source organization in repository files, examples, fixtures, commit messages, release notes, or generated output.
- Derive only generic resource types, field meanings, relationships, and workflow patterns.
- Before finishing work informed by private material, scan all changed files for source names and copied values.

## Documentation

- `docs/architecture.md` is the persistent product and implementation plan.
- `docs/data-model.md` is the generated human-readable reference for resource types, shared primitives, and relationship rules.
- The root `README.md` is a symlink to `packages/create-filegrc/template/README.md`.
- The generated README is short, external-facing, and written directly to engineers.
- The generated `AGENTS.md` explains how agents and engineers maintain a generated repository.
- The README screenshot must come from generic seed data and contain no private or production information.
- State the product boundary clearly: this repository manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.

## Versions and releases

Use semantic versioning for published releases. Keep package versions unchanged during normal development, then update the coordinated package, template, and lockfile versions as part of a release.

Before 1.0, increment the minor version for any release with a breaking change and increment the patch version when every published change is backward compatible. Choose the release level from the highest-impact published change. `filegrc` includes `bin/`, `src/`, and `model/`. `create-filegrc` includes its CLI, prompts, dependency resolution, template, starter records, policies, and generated lockfile behavior. Root-only documentation, tests, and development scripts do not need a release.

Treat a data-model change as breaking when an existing workspace would become invalid or when a published workflow, command, API, or model field stops working. Give breaking data-model changes a new model version, an explicit preview and apply migration, and agent-discoverable upgrade guidance. A documented migration makes the break manageable, but it does not make the release backward compatible.

Publish `filegrc` before any `create-filegrc` release that depends on it. A package update must never rewrite a consumer's policies or compliance records without an explicit command and reviewable Git diff.

### Release checklist

1. Compare `HEAD` with the latest release tag and confirm the next semantic version. The publish workflow is coordinated and requires `filegrc` and `create-filegrc` to match the release tag, so every npm release bumps both package manifests.
2. Update every coordinated version copy. The current surfaces are the root `package.json`, both publishable package manifests, `packages/create-filegrc/template/package.json`, `site/package.json`, the root lockfile entries, and the minimal generated lockfile fallback in `packages/create-filegrc/src/index.js`. Search for the old exact version after editing so a copy is not missed.
3. Install from the lockfile with `npm ci`. Run `CI=true npm run validate` with the same Node major used by `.github/workflows/publish.yml`, then run `npm run site:build`, both `npm pack --dry-run --workspace` checks, `npm audit`, and the private-source and secret scans. When the active Node version differs from the workflow, use a version manager or an isolated Node package command and print `node --version` before validation.
4. Generate and validate a fresh consumer repository when the template or scaffolder changed. Test it with the unreleased local `filegrc` package so the smoke test does not resolve the previous npm release.
5. Commit all release changes and pre-release fixes before creating the tag. Push `main`, create the version tag at that exact commit, verify `main` and the tag resolve to the same commit, then publish the GitHub release. Publishing the GitHub release starts `.github/workflows/publish.yml`.
6. Follow the publish workflow through validation, package inspection, trusted publishing, both npm publishes, and the installed README smoke test. The GitHub release alone does not mean the npm release completed.
7. Verify both package versions and `latest` tags from the npm registry. Verify each package has a provenance attestation, then confirm the worktree is clean and `main`, the Git tag, and the GitHub release all resolve to the intended commit.

Keep Git test repositories deterministic. When a test initializes its working repository on `main` and later clones a bare remote, initialize the bare remote with `--initial-branch=main` too. Do not depend on a developer or runner's global `init.defaultBranch`.

If a hosted validation run appears stuck, compare it with the exact workflow Node version locally. After cancelling a stuck run, inspect its completed job log before retrying because `node:test` may wait on open server handles after an earlier assertion failure.

Before recovering a failed release, query npm for both package versions. If neither package was published, delete the failed GitHub release and tag before recreating them at a corrected commit. If one package was published, do not move the tag or reuse the version for changed source. Rerun the idempotent workflow from the same tagged commit to publish the missing package, or cut a new patch release when source changes are required.

## Validation

After substantive changes, run `npm run validate`.

Use `npm run validate:fast` while iterating on engine code. It omits the process-heavy Git, packet, server, and headless CLI integration files plus the site validation. It does not replace `npm run validate`, which remains the complete CI and release check. Use `npm run test:full` when you need the complete package tests without the documentation and site checks.

Run `pnpm dev` from the monorepo root for local UI development. It creates an ignored workspace under `.filegrc/dev-workspace` on first run, serves it with the current local engine, and restarts when imported source files change. This internal development server enables the explicit non-authoritative write override, so browser changes stay local and are never committed or pushed. It prefers port `8787`, or `FILEGRC_DEV_PORT` when set, and automatically selects an available local port when that port is occupied. Delete `.filegrc/dev-workspace` when you need fresh starter data.

Before completing a change:

1. Validate JSON and internal resource references.
2. Run unit and end-to-end tests relevant to the change.
3. Generate a fresh consumer repository when template behavior changed.
4. Run `filegrc validate` against supported fixtures.
5. Scan changed files for private source material and secrets.

## Writing

- Speak directly to engineers.
- Use short sentences and concrete terms.
- Avoid marketing language, inflated claims, and filler.
- Do not imply that using this repository alone makes an organization compliant.
