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

The authoritative model registry is `packages/filegrc/model/v1.json`. Model v1 is published. Before changing it, decide whether existing v1 workspaces remain valid. Keep compatible v1 changes, starter data, generated docs, and tests in sync. Add a new model version and an explicit migration path when a change would make existing v1 workspaces invalid.

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
- Keep each policy and governed document approver separate from its owner. The reviewer may be another person in the organization or an external person. Most organizations use an internal reviewer with enough authority and separation to challenge the owner. A one-person organization needs an external reviewer because no second internal person is available.
- Bind rendered-page evidence to the route, filters, audit period, and Git commit used to create it.
- Bind signed attestations to the exact Git revisions of the acknowledged policies, training, or other content.
- Do not commit secrets, credentials, session material, regulated personal data, or confidential reports unless the repository's access and retention rules explicitly permit them.
- Keep personal data out of immutable Git history when a later deletion request may require erasure. Use an opaque case ID and a reference to an approved system instead.
- Preserve closed and retired audit records when they explain historical control operation. Use deletion for mistakes and uncommitted drafts.
- Model recurring policy work as reusable obligations with an explicit allowed completion range and first overdue cutoff. Every actionable obligation needs a deadline; use the end of its policy period or a reasonable policy-aligned event window when the source does not name one.
- Model policy-triggering changes as one event record plus normal linked action items. Create the full checklist atomically and preserve exact timestamps when a policy uses hour-based deadlines.
- Build audit packets from an explicit Type 1 or Type 2 engagement, its exact date or period and scope, model-defined dates, policy and control context, and linked evidence. Add obligation coverage, event checklists, populations, and samples for Type 2. Keep packet output under `.filegrc/` and bind delivery-ready output to a clean Git revision.
- Never report filegrc management checks as passed when the required scope, management documents, approved policy coverage, implemented control coverage, source systems, evidence, or Type 2 population work is missing. Do not imply that filegrc decides whether evidence is sufficient or appropriate; the engagement team makes that judgment.
- Export auditor control, population, and evidence indexes, committed historical source versions, and per-file checksums with every packet. External references remain warnings because the packet is not self-contained.
- Use one `audit-population` record for each complete management population and link its fixed `population-export` evidence. Record the evidence generation time, exact query or report parameters, timezone, count, and completeness and accuracy checks, including when the count is zero. Link the population and sampled-item evidence from the related control test.
- Catalog every authoritative evidence source as a `system`, assign its `evidenceSourceKinds`, name the people who can obtain evidence, and keep extraction instructions in Record Markdown. A reconciled population and its export must name the same source system. Split a population when its items require different source systems or queries.
- Every evidence record names its collector. Verified evidence also names its verifier and verification date. A source-system export links the cataloged system of record.
- Define fields, types, enums, relationships, conditional requirements, and default UI metadata once in the model registry. Validators, CRUD forms, filters, search indexing, CLI help, and generated model documentation must consume that registry.
- Do not hand-copy model definitions into validators, templates, generated repositories, or documentation.
- Generate `docs/data-model.md` from the registry. Do not edit generated model documentation by hand.
- Generated repositories declare `dataModelVersion` but do not contain a copy of the model.

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

At release time, bump each package whose published files or behavior changed. `filegrc` includes `bin/`, `src/`, and `model/`. `create-filegrc` includes its CLI, prompts, dependency resolution, template, starter records, policies, and generated lockfile behavior. Root-only documentation, tests, and development scripts do not need a package bump.

Publish `filegrc` before any `create-filegrc` release that depends on it. A package update must never rewrite a consumer's policies or compliance records without an explicit command and reviewable Git diff.

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
