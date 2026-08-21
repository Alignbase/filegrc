# filegrc

filegrc is a zero-dependency Node.js engine for Git-native GRC workspaces. It validates structured JSON records and their Markdown companions, renders a local web app, provides safe CRUD operations, and builds a read-only audit view.

Program Readiness checks management-owned scope, policy adoption, control implementation, and authoritative evidence mapping without requiring an audit record. Audit Readiness starts after CPA engagement and checks the firm-agreed date or period, engagement-specific management documents, operating evidence, and Type 2 population completeness.

Controls linked to filegrc Obligations show whether their scheduled work is waiting for policy approval, ready for implementation, running, paused, or mixed. Marking a fully configured Control implemented starts its enabled work when the governing content is effective.

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

The normal runtime uses data model v6. Start a model v5 upgrade with a read-only preview:

```sh
npx filegrc migrate --to-model 6 --preview --json
```

Review every automatic, review-required, and unsupported item. Model v6 gives Training the same separate approval and activation lifecycle as other governed content. It preserves active model v5 Training with a visible legacy basis and removes Training schedule fields, because Obligations now own assignment timing. Resolve unsupported items before applying the same migration with `--yes`. The [model v6 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v6.md) documents the review.

A model v2 workspace must migrate to v3 first:

```sh
npx filegrc migrate --to-model 3 --preview --json
```

The migration writes one atomic batch, validates model v3, changes no Git history, and is safe to rerun. The [model v3 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v3.md) explains every migration class and the review that follows. Apply it before previewing models v4, v5, and v6 in order.

A model v1 workspace must migrate to v2 first:

```sh
npx filegrc migrate --to-model 2 --preview --json
```

Follow the [model v2 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v2.md), then run the model v3, v4, v5, and v6 previews in order.

`filegrc serve --help` prints bind, port, environment, and safety options without starting the server. The editable server prefers `127.0.0.1:8787` and chooses another available port when that port is occupied. Set `FILEGRC_HOST`, `FILEGRC_PORT`, or the matching flags when needed. In trunk mode, browser saves synchronize, commit, and push from the authoritative branch. Use `--allow-non-authoritative-writes` for local development in a task checkout; the override never commits or pushes.

`filegrc setup` provides the headless equivalent of browser onboarding. Run it without arguments for guided terminal setup, or pass all initial service-boundary fields and a management program goal as flags or a JSON payload. Add `--preview` to validate and inspect the planned System and Program writes without saving. Add `--summary --json` for compact agent output. Selecting Type 1 or Type 2 updates the Program goal and selected Systems. Setup does not select Framework records, link Controls, create Evidence Artifacts, or create an Audit record.

`filegrc program-path --next --json` gives an agent the current step and first action without loading the full lifecycle. Use `--summary` for compact status across all five steps, `--current` for the full current-step guide, or no compact flag for every step. `filegrc guide <type>` repeats the matching page guidance and adds fields, relationship candidates, Markdown slots, and timing for that record type.

`filegrc program-readiness` reports whether management can start a candidate Type 2 period. Add `--summary --json` for compact stage counts and next actions, or omit `--summary` for every readiness item. Use `--require-ready` in automation. Pass `--program PROGRAM_ID` when more than one active Program exists. The command does not require an Audit ID or CPA firm.

Step 2 uses one Policies page to review Policies, program Documents, and Training, while keeping their record types separate. Step 3 implements linked requirements, defines schedules as Obligations, and uses `filegrc activate-content --scaffold` to record the active Person, separate activation date, and revision for approved Documents and Training. Control implementation also checks expected evidence, authoritative source Components, and source readiness. During Step 4, create Evidence only when operation produces a real record or artifact. Keep engagement-scoped terms, management assertions, representation letters, and other Audit Documents in Step 5. Link each one to one Audit and use `filegrc activate-documents --audit AUDIT_ID --scaffold` after approval.

`filegrc obligations` shows recurring work and a task-level preview for each Policy Event, including owners, deadlines, and requested proof. `filegrc trigger` adds the event and all of its Action Items to the Work Queue atomically, then prints the created task IDs and deadlines.

Long-form Markdown lives beside its JSON record. filegrc derives the Markdown path, so records do not store it.

Headless creates and updates require the `{ "record": {...}, "content": {...}, "revision": "...", "contentRevisions": {...} }` mutation envelope used by the web app. Run `filegrc scaffold` for a new mutation or `filegrc get <id> --mutation` before an update; stale record and Markdown writes are rejected. Use `filegrc content <type> <id>` to read a companion and `--write <file|->` to replace it. `filegrc guide --json` is the compact action and resource index for agents.

Use `filegrc attach <evidence-id> <source-file>` to copy a fixed evidence file under its record and update `filePaths` without overwriting an existing attachment.

Use `filegrc detach <evidence-id> <attachment-name> --yes` for explicit removal. Evidence records with linked local attachments cannot be deleted.

The package requires Node.js 20 or newer. It uses Git for authors, commit timestamps, messages, diffs, and revisions. New workspaces use trunk mode, which fetches and fast-forwards before each browser mutation, validates and commits the saved change, then pushes. Agents and terminal users use Git directly; the filegrc CLI does not wrap pull, commit, or push.

The editable server has no authentication and binds to loopback by default. Put it behind trusted authentication before exposing it on a network, or publish the read-only static build.

The authoritative data model ships in this package. Import the public Node.js API from `filegrc` and the model loader from `filegrc/model`.
