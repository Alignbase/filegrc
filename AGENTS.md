# FileGRC Repository Instructions

## Purpose

This monorepo builds FileGRC, a Git-native GRC system for SOC 2 work. It has two Node.js packages:

- `filegrc`: the zero-dependency FileGRC engine, which validates, searches, edits, and renders GRC data.
- `create-filegrc`: the FileGRC scaffolder, which creates a standalone SOC 2 repository.

The generated repository is the product. Keep it understandable to an engineer who opens it without prior context.

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
- Prefer explicit, inspectable behavior over automation that changes audit records without review.
- UI, HTTP, and CLI workflows must call the same domain functions so headless agents receive the same calculations, validation, and output as browser users.

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

The authoritative model registries are `packages/filegrc/model/v*.json`. Model v2 is current; v1 remains bundled for compatibility. `docs/data-model.md` is generated from the newest registry.

- Use UTF-8 JSON for structured records and Markdown for long-form content.
- Store canonical long-form Markdown beside its structured JSON record. FileGRC derives companion names from the JSON location and Markdown slot; do not store those paths in record data.
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
- Bind rendered-page evidence to the route, filters, audit period, and Git commit used to create it.
- Bind signed attestations to the exact Git revisions of the acknowledged policies, training, or other content.
- Do not commit secrets, credentials, session material, regulated personal data, or confidential reports unless the repository's access and retention rules explicitly permit them.
- Keep personal data out of immutable Git history when a later deletion request may require erasure. Use an opaque case ID and a reference to an approved system instead.
- Preserve closed and retired audit records when they explain historical control operation. Use deletion for mistakes and uncommitted drafts.
- Model recurring policy work as reusable obligations with an explicit allowed completion range and first overdue cutoff. Keep a policy rule with no cutoff due until completion instead of inventing a date.
- Model policy-triggering changes as one event record plus normal linked action items. Create the full checklist atomically and preserve exact timestamps when a policy uses hour-based deadlines.
- Build audit packets from model-defined dates, timestamps, period overlaps, obligation coverage, event checklists, policy and control context, and linked evidence. Keep packet output under `.filegrc/` and bind auditor-ready output to a clean Git revision.
- Every schema change needs compatibility fixtures and a documented migration path.
- Define fields, types, enums, relationships, conditional requirements, and default UI metadata once in the model registry. Validators, CRUD forms, filters, search indexing, CLI help, and generated model documentation must consume that registry.
- Do not hand-copy model definitions into validators, templates, generated repositories, or documentation.
- Generate `docs/data-model.md` from the registry. Do not edit generated model documentation by hand.
- Generated repositories declare `dataModelVersion` but do not contain a copy of the model.
- Updated `filegrc` releases must continue reading supported older data-model versions.
- Never migrate consumer data silently.

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

## Compatibility and releases

- Version the data model separately from package releases.
- Favor additive schema changes.
- Treat renamed fields, changed meanings, and stricter required fields as migrations.
- Test the engine against fixtures from every supported data-model version.
- Publish `filegrc` before publishing a `create-filegrc` release that depends on it.
- A generated repository must remain usable if it does not update immediately.

### Package version bumps

Version the two published packages independently. The root package is private and does not need to match either published version. A normal development commit does not need its own version bump, but every release must bump each package whose published behavior or files changed and update the lockfile.

For `filegrc`, a version bump is required when a release changes anything shipped from `bin/`, `src/`, or `model/`, including renderer behavior, CLI behavior, server APIs, validation, generated output, supported Node.js versions, or the bundled model registry. After 1.0:

- Patch: backward-compatible fixes, security fixes, performance work, and presentation or documentation corrections.
- Minor: backward-compatible features such as new commands, flags, API capabilities, renderer workflows, or support for a new data-model version.
- Major: removed or renamed public APIs, commands, flags, routes, response fields, changed CLI exit behavior, a higher Node.js minimum, removal of a supported data-model version, or any change that requires consumers to migrate before the engine can read their existing workspace.

For `create-filegrc`, a version bump is required when its CLI, prompts, dependency resolution, template, starter policies, starter records, scripts, or generated lockfile behavior changes. After 1.0:

- Patch: compatible corrections to generated content or scaffolding.
- Minor: backward-compatible generator features, optional prompts, or new starter files and records.
- Major: removed or renamed CLI options, changed meanings for existing prompts, destructive template behavior, or a generated-repository contract that existing automation cannot consume.

Before 1.0, treat the minor component as the breaking-change boundary because npm caret ranges do not cross `0.x` minor versions. Use patches for compatible releases and increment the minor version for breaking releases. After 1.0, use normal semantic versioning.

Bump both packages when the generator needs a new engine release. Publish `filegrc` first, then set `create-filegrc` to a released compatible range and publish it. Changes limited to root documentation, tests, internal development scripts, or CI do not require a published-package bump unless they alter shipped files or consumer behavior.

### Data-model versions

The integer `dataModelVersion` describes the stored record contract, not the installed package. Increment it when persisted fields, required values, enum meanings, relationships, resource types, lifecycle rules, or validation semantics change. Do not increment it for renderer-only layout, copy, or behavior that leaves the stored contract unchanged.

An additive model version may have a no-op migration for existing records, but selecting it must still be explicit. Never rewrite an existing workspace to a newer model during install, serve, build, validation, or a normal CRUD action.

Every new model version must include:

- The complete model registry for that version.
- Compatibility fixtures for the previous and new versions.
- A deterministic migration from the prior version, or a documented reason no record changes are needed.
- Validation of the full candidate workspace before source files change.
- Release metadata stating supported source and target versions.

Every `filegrc` release must also publish machine-readable upgrade metadata with its installed version, newest bundled model, supported models, available migration edges, minimum Node.js version, release classification, and release-notes location. Mirror the fields needed for a remote update check into npm package metadata so the CLI does not need to download or execute an unknown package to classify an available release.

### Consumer upgrade contract

Updating the `filegrc` dependency updates the engine and renderer only. It must not change `data/`, rewrite user policies, or start a migration. A current engine must continue to serve, build, validate, search, and edit every data-model version it claims to support.

Upgrade discovery must remain optional and offline-safe. The planned CLI and Repository-page flow should:

1. Show the installed engine version, declared dependency range, workspace model version, and newest model bundled with the installed engine without making a network request.
2. Offer an explicit **Check for Updates** action. Its CLI equivalent must support machine-readable output for agents. Only that user action may query the package registry.
3. Classify an available release as compatible, security-related, or migration-required and link to concise release and migration notes.
4. Keep dismissed network-check state under ignored `.filegrc/` state, not committed compliance data.

Engine upgrades and data migrations are separate operations. The intended safe flow is:

1. Validate and commit the current workspace so Git provides the rollback point.
2. Update `filegrc` and the lockfile, then validate again against the unchanged model version.
3. Preview the model migration and review its machine-readable plan.
4. Apply the migration explicitly, review the resulting Git diff, validate the target model, and commit it separately.

A migration must stage a complete candidate under ignored `.filegrc/` state, validate it against the target model, and show every file and field change before apply. Apply leaves source changes uncommitted. Migration code must be deterministic, idempotent, and able to resume or roll back after interruption.

Do not invent compliance facts to satisfy a new required field. If a value cannot be derived safely, stop before writing and request it in the migration plan. Preserve ambiguous or deprecated data until the user resolves it. Never delete records, attachments, Markdown, stable IDs, or unknown extensions as a migration shortcut.

Template and starter-policy changes apply automatically only to newly generated repositories. Existing repositories own their copies. If an existing workspace should adopt a starter-content correction, distribute it as a versioned advisory or explicit three-way proposal that preserves local edits and requires review. Never overwrite consumer policies, records, README files, or `AGENTS.md` during an engine update.

Dropping support for a model or requiring migration before basic reads is a breaking package release. An engine that sees a model it cannot read must fail clearly with the workspace model, its supported versions, and the safe next action. Release metadata must identify the engine ranges that support each model, the required migration path, and the rollback procedure. Migration support must ship before or with the release that needs it.

## Validation

After substantive changes, run `npm run validate`.

Run `pnpm dev` from the monorepo root for local UI development. It creates an ignored workspace under `.filegrc/dev-workspace` on first run, serves it with the current local engine, and restarts when imported source files change. Set `FILEGRC_DEV_PORT` to override port `8787`. Delete `.filegrc/dev-workspace` when you need fresh starter data.

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
