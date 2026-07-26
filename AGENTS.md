# SOC 2 Repository Instructions

## Purpose

This monorepo builds a Git-native GRC system for SOC 2 work. It has two Node.js packages:

- `soc2`: a zero-dependency engine that validates, searches, edits, and renders GRC data.
- `create-soc2`: a scaffolder that creates a standalone SOC 2 repository.

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

## Package constraints

### `soc2`

- Use Node.js built-in modules only.
- Do not add runtime, development, test, build, or rendering dependencies.
- Do not require a compilation or bundling step.
- Use `node:test` and other built-in tooling for tests.
- Keep file parsing, validation, Git access, HTTP handling, and rendering behind small internal interfaces.
- CRUD operations may write files but must not create commits unless the user explicitly requests it.
- Writes must be atomic and must reject paths outside the workspace.

### `create-soc2`

- Follow the `npx create-*` convention and support `npx create-soc2@latest`.
- Generate a private Node.js project whose only package dependency is `soc2`.
- Resolve the current `soc2` release when generating, write a normal semver range, and create a lockfile. Do not write the literal dependency specifier `latest`.
- Do not overwrite a non-empty target without explicit user approval.
- Initialize Git when the target is not already inside a Git worktree.
- Keep the template usable without private services or organization-specific values.
- Define create-time prompts once in `packages/create-soc2/template-parameters.json`.
- Keep create-time prompts limited to values needed throughout the initial repository. Prefer documented defaults and later edits for optional configuration.
- Replace every template token during creation and fail if a token is unknown or remains unresolved.

## Data rules

The authoritative, versioned model is `packages/soc2/model/v1.json`. `docs/data-model.md` is generated from that registry.

- Use UTF-8 JSON for structured records and Markdown for long-form content.
- Store canonical long-form Markdown under `data/content/` and reference it from structured records with paths relative to `data/`.
- Structure fields only when the engine needs them for validation, filtering, relationships, lifecycle rules, due-date calculations, or audit-period completeness.
- Put variable procedures, questionnaires, interviews, per-item decisions, detailed results, and provider-specific analysis in Markdown through `notesPath`.
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
- Every schema change needs compatibility fixtures and a documented migration path.
- Define fields, types, enums, relationships, conditional requirements, and default UI metadata once in the model registry. Validators, CRUD forms, filters, search indexing, CLI help, and generated model documentation must consume that registry.
- Do not hand-copy model definitions into validators, templates, generated repositories, or documentation.
- Generate `docs/data-model.md` from the registry. Do not edit generated model documentation by hand.
- Generated repositories declare `dataModelVersion` but do not contain a copy of the model.
- Updated `soc2` releases must continue reading supported older data-model versions.
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
- The root `README.md` is a symlink to `packages/create-soc2/template/README.md`.
- The generated README is short, external-facing, and written directly to engineers.
- The generated `AGENTS.md` explains how agents and engineers maintain a generated repository.
- The README screenshot must come from generic seed data and contain no private or production information.
- State the product boundary clearly: this repository manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.

## Compatibility and releases

- Version the data model separately from package releases.
- Favor additive schema changes.
- Treat renamed fields, changed meanings, and stricter required fields as migrations.
- Test the engine against fixtures from every supported data-model version.
- Publish `soc2` before publishing a `create-soc2` release that depends on it.
- A generated repository must remain usable if it does not update immediately.

## Validation

After substantive changes, run `npm run validate`.

Run `pnpm dev` from the monorepo root for local UI development. It creates an ignored workspace under `.soc2/dev-workspace` on first run, serves it with the current local engine, and restarts when imported source files change. Set `SOC2_DEV_PORT` to override port `8787`. Delete `.soc2/dev-workspace` when you need fresh starter data.

Before completing a change:

1. Validate JSON and internal resource references.
2. Run unit and end-to-end tests relevant to the change.
3. Generate a fresh consumer repository when template behavior changed.
4. Run `soc2 validate` against supported fixtures.
5. Scan changed files for private source material and secrets.

## Writing

- Speak directly to engineers.
- Use short sentences and concrete terms.
- Avoid marketing language, inflated claims, and filler.
- Do not imply that using this repository alone makes an organization compliant.
