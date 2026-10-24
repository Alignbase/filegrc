# FileGRC

FileGRC is a zero-dependency Node.js engine for Git-native GRC workspaces. It validates structured JSON records and their Markdown companions, renders a local web app, provides safe CRUD operations, and builds a read-only audit view.

Program Readiness checks management-owned scope, policy adoption, control implementation, and authoritative evidence mapping without requiring an audit record. Audit Readiness starts after CPA engagement and checks the firm-agreed date or period, engagement-specific management documents, operating evidence, and Type 2 population completeness.

The Controls list focuses on implementation and its next action. The Obligations list shows schedule state separately, including proposals, approved schedules, and Policies awaiting activation or their effective date. Enabled work starts when its governing content is effective and a linked Control is implemented.

Most users should create a complete workspace:

```sh
npx create-filegrc@latest company-grc
```

Inside a workspace:

```sh
npx filegrc validate
npx filegrc serve
npx filegrc setup --help
npx filegrc build
npx filegrc guide risk-assessment
npx filegrc program-path --next --json
npx filegrc scaffold risk-assessment --title "2026 Annual Risk Assessment"
npx filegrc list risk --json
npx filegrc references risk-example --json
npx filegrc describe risk
npx filegrc search "access review"
npx filegrc evidence-map --json
npx filegrc program-readiness --summary --json
npx filegrc program-readiness --require-ready
npx filegrc audit-readiness audit-id
npx filegrc prepare-audit audit-id
npx filegrc evidence-packet --start 2026-01-01 --end 2026-06-30 --audit audit-id
```

## Upgrade an existing workspace

Package updates may include optional starter Policy and Control revisions. Review them without writing:

```sh
npx filegrc policy-library
```

The command shows an exact diff only when the current text still matches the prior starter default. It skips customized, approved, active, superseded, and retired Policy content. Accept one named proposal revision only with the command printed by the review, which includes `--accept`, `--proposal-revision`, and `--yes`. Acceptance fails if the proposal changed after review. It changes only the listed defaults and does not approve a Policy, activate it, or mark a Control implemented.

The normal runtime uses data model v13. Model v11 adds Control oversight; existing model v10 workspaces start with a read-only preview:

```sh
npx filegrc migrate --to-model 11 --preview --json
```

Review every automatic, review-required, and unsupported item. Model v11 removes the old per-Control implementation approval fields. Owners can record implementation directly, while periodic Control oversight uses one Collection Review at the end of Step 3. Policy, Document, and Training approvals stay independent. Resolve unsupported items before applying the same migration with `--yes`. The [model v11 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v11.md) documents the review.

A model v2 workspace must migrate to v3 first:

```sh
npx filegrc migrate --to-model 3 --preview --json
```

The migration writes one atomic batch, validates model v3, changes no Git history, and is safe to rerun. The [model v3 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v3.md) explains every migration class and the review that follows. Apply it before previewing models v4, v5, and v6 in order.

A model v1 workspace must migrate to v2 first:

```sh
npx filegrc migrate --to-model 2 --preview --json
```

Follow the [model v2 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v2.md), then migrate one model version at a time through model v12.

`filegrc serve --help` prints bind, port, environment, and safety options without starting the server. The editable server prefers `127.0.0.1:8787` and chooses another available port when that port is occupied. Set `FILEGRC_HOST`, `FILEGRC_PORT`, or the matching flags when needed. In trunk mode, browser saves synchronize, commit, and push from the authoritative branch. Use `--allow-non-authoritative-writes` for local development in a task checkout; the override never commits or pushes.

`filegrc setup` provides the headless equivalent of browser onboarding. Run it without arguments for guided terminal setup, or pass all initial service-boundary fields and a management program goal as flags or a JSON payload. Add `--preview` to validate and inspect the planned System and Program writes without saving. Add `--summary --json` for compact agent output. Selecting Type 1 or Type 2 updates the Program goal and selected Systems. Setup does not select Framework records, link Controls, create Evidence Artifacts, or create an Audit record.

`filegrc program-path --next --json` gives an agent the current step and first action without loading the full lifecycle. Use `--summary` for compact status across all five steps, `--current` for the full current-step guide, or no compact flag for every step. `filegrc guide <type>` repeats the matching page guidance and adds fields, relationship candidates, Markdown slots, and timing for that record type.

`filegrc program-readiness` reports whether management can start a candidate Type 2 period. Add `--summary --json` for compact stage counts and next actions, or omit `--summary` for every readiness item. Use `--require-ready` in automation. Pass `--program PROGRAM_ID` when more than one active Program exists. The command does not require an Audit ID or CPA firm.

Step 2 uses one Policies page to review Policies, program Documents, and Training, while keeping their record types separate. Step 3 implements linked requirements, defines schedules as Obligations, and uses `filegrc activate-content --scaffold` to record the active Person, separate activation date, and revision for approved Documents and Training. Control implementation also checks expected evidence, authoritative source Components, and source readiness. During Step 4, create Evidence only when operation produces a real record or artifact. Keep engagement-scoped terms, management assertions, representation letters, and other Audit Documents in Step 5. Link each one to one Audit and use `filegrc activate-documents --audit AUDIT_ID --scaffold` after approval.

`filegrc obligations` shows recurring work and a task-level preview for each Policy Event, including owners, deadlines, and requested proof. `filegrc trigger` adds the event and all of its Action Items to the Work Queue atomically, then prints the created task IDs and deadlines.

Long-form Markdown lives beside its JSON record. FileGRC derives the Markdown path, so records do not store it.

Headless creates and updates require the `{ "record": {...}, "content": {...}, "revision": "...", "contentRevisions": {...} }` mutation envelope used by the web app. Run `filegrc scaffold` for a new mutation or `filegrc get <id> --mutation` before an update; stale record and Markdown writes are rejected. Use `filegrc content <type> <id>` to read a companion and `--write <file|->` to replace it. `filegrc guide --json` is the compact action and resource index for agents.

Use `filegrc attach <evidence-id> <source-file>` to copy a fixed evidence file under its record and update `filePaths` without overwriting an existing attachment.

Use `filegrc detach <evidence-id> <attachment-name> --yes` for explicit removal. Evidence records with linked local attachments cannot be deleted.

The package requires Node.js 20 or newer. It uses Git for authors, commit timestamps, messages, diffs, and revisions. New workspaces use trunk mode, which fetches and fast-forwards before each browser mutation, validates and commits the saved change, then pushes. Agents and terminal users use Git directly; the FileGRC CLI does not wrap pull, commit, or push.

The editable server has no authentication and binds to loopback by default. Put it behind trusted authentication before exposing it on a network, or publish the read-only static build.

The authoritative data model ships in this package. Import the public Node.js API from `filegrc` and the model loader from `filegrc/model`.

## Workflow notification contacts

`getWorkItems(root, options)` returns the same work items as `assessWorkflow(root, options).workItems`, including stable `ownerIds` and `notificationContacts`. Each contact contains `personId` and optional `email` from the Person record. `notificationContacts(ownerIds, resources)` resolves active Team members and chairs and active Appointment holders to active People, deduplicated and sorted by Person ID. Inactive People receive no contact entry. People without email still have a Person ID contact.

Core calculates work and exposes repository contacts. Autopilot manages notification settings and Person-to-Slack links in its database, using Core contact Person IDs to look up destinations.

## FileGRC Autopilot

Run your SOC 2 program automatically. FileGRC Autopilot is the optional hosted service for owner reminders and policy-driven escalation.

`filegrc automation` reports local FileGRC Autopilot configuration. Add `--json` for the stable contract or `--open` to open the dashboard, or the setup guide when configuration is unavailable. These commands do not check live service status.

After connecting a repository, the Autopilot webapp offers a reviewable PR adding `.filegrc/hosted-automation.json`:

```json
{ "version": 1, "connectionId": "opaque-non-secret-id" }
```

Version 1 accepts exactly these fields. The ID contains 1–128 ASCII letters, digits, underscores, or hyphens and grants no access. A valid marker means configured locally. Billing, access, and delivery health remain authoritative in the webapp. Removing the marker does not disconnect service.

Core builds dashboard links as `https://app.filegrc.com/connections/<encoded connectionId>?repository=<encoded owner/repo>`. It derives the optional repository hint from one supported GitHub `origin` URL without contacting GitHub, omitting it when unavailable or ambiguous. The hint grants no authorization. Invalid or unsupported markers produce warnings and leave local workflows available; Core never rewrites the marker.

Track this file in Git. Existing repositories that ignore `.filegrc/` should use `.filegrc/*` and add `!.filegrc/hosted-automation.json`. Person mappings and delivery policy remain separate files.

Model v12 requires a complete Program Obligation schedule-set review before activation. Use `npx filegrc review-collection obligation --program PROGRAM_ID --scaffold`, record adopted rules, replacements, retired duplicates, and intentionally inapplicable proposals, then preview and save the exact revision with an independent reviewer. Reporting Channel Sets need independent approval in Step 1; Step 3 verifies their effective coverage and usability at cutover. Existing model v11 workspaces preview `npx filegrc migrate --to-model 12 --preview --json`. See the [model v12 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v12.md).

## Hosted runtime compatibility

A hosted application can run one tested stable patch per supported compatibility line. Before 1.0, the line is the minor version, such as `0.17.x`. From 1.0 onward, it is the major version, such as `1.x`. Core accepts stable repository versions in its own line, including both older and newer patches, while retaining workspace model, record validation, and API contract checks. Prereleases, malformed versions, and other lines are rejected. Build metadata does not change the line. Diagnostic views remain available for model errors, with failed validation; ordinary mutations stay blocked.

Use `assessWorkspaceRuntimeCompatibility(root, { requiredApiContractVersion: 1 })` before presenting hosted operations. It returns `compatible`, `installedVersion`, `repositoryVersion`, `supportedLine`, `repositoryLine`, `dataModelVersion`, `supportedModelVersions`, `apiContractVersion`, and a nullable `reason`. Failures include a repair message. `workspaceEngineVersion` remains the raw lockfile reader; `assertWorkspaceEngineVersion` uses the compatibility policy and attaches the result to `error.compatibility` when rejecting an operation. Unmanaged workspaces may omit package files; package-managed workspaces still require a readable lockfile with a resolved version, including linked dependency targets.

Choose a tested runtime in the repository's line that supports its model and the adapter's API contract. For a local installation mismatch, run `npm ci`. Repair missing or malformed package files through normal dependency installation. Preview explicit migrations for unsupported older workspace models. Do not rewrite customer manifests, lockfiles, or workspace versions to bypass the guard. Published runtimes predating this policy retain their original exact-version mutation guard, so hosted adapters must deploy a runtime containing this change.

Patch releases must preserve readable records and generated records across their compatibility line. An incompatible record format, model requirement, or API contract needs a new compatibility line and an explicit upgrade path, rather than relaxed validation.

Model v13 adds scoped source retrieval, proof preservation, baseline execution and operating ownership checks. Existing v12 programs explicitly preview `npx filegrc migrate --to-model 13 --preview --json` before applying the upgrade. Use `npx filegrc program-readiness --json` for the missing facts, existing records, tangible checks and read/scaffold/preview/save commands shared with the browser. Active programs repair current gaps using actual dates and preserve historical activation and Control oversight. Reuse unchanged approvals; new or changed governed content, schedules and retention decisions use their existing independent reviews. See the [model v13 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v13.md).

### Apply an approved retention rule

Independent review approves the retention decision: data category and purpose,
cutoff, period, disposition, holds and required duties. The Policy Owner can apply
that complete unchanged rule to another service without approving the schedule
again. Matching a duration alone does not establish a fit.

```sh
npx filegrc apply-retention-rule RULE_ID --scaffold > application.json
# Fill the service scope, existing Information Types, actual owner authority,
# purpose, disposal implementation and every fit confirmation.
npx filegrc apply-retention-rule RULE_ID application.json --preview > reviewed-application.json
npx filegrc apply-retention-rule RULE_ID reviewed-application.json --yes
```

Preview binds the current service facts. Save rejects a changed service, rule or
approval instead of silently updating the decision. The browser's **Apply approved
rule** action uses the same checks. Original rule and approval records stay intact;
new applications retain the actual owner, date and exact approved source. Review
applications during periodic independent schedule oversight.

Use normal independent schedule review for a new category or purpose, a changed
cutoff or period, conflicting duties, unsupported disposal, or a material exception.
An application cannot supply missing independent approval. Retire an obsolete
application and record a new owner decision when the service facts change.
