# filegrc

filegrc is a zero-dependency Node.js engine for Git-native GRC workspaces. It validates structured JSON records and their Markdown companions, renders a local web app, provides safe CRUD operations, and builds a read-only audit view.

Program Readiness checks management-owned scope, policy adoption, control implementation, authoritative source configuration, and verified test captures without requiring an audit record. Audit Readiness starts after CPA engagement and checks the firm-agreed date or period, engagement-specific management documents, operating evidence, and Type 2 population completeness.

Controls linked to filegrc obligations show whether their Work Queue schedules are waiting for policy approval, ready for implementation, running, paused, or mixed. Marking a fully configured control implemented starts its enabled schedules when their governing policies are effective.

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
npx filegrc program-path --json
npx filegrc scaffold risk-assessment --title "2026 Annual Risk Assessment"
npx filegrc list risk --json
npx filegrc references risk-example --json
npx filegrc describe risk
npx filegrc search "access review"
npx filegrc evidence-test-drafts --preview --json
npx filegrc program-readiness --summary --json
npx filegrc program-readiness --require-ready
npx filegrc audit-readiness audit-id
npx filegrc prepare-audit audit-id
npx filegrc evidence-packet --start 2026-01-01 --end 2026-06-30 --audit audit-id
```

`filegrc serve --help` prints bind, port, environment, and safety options without starting the server. The editable server defaults to `127.0.0.1:8787`; set `FILEGRC_HOST`, `FILEGRC_PORT`, or the matching flags when needed.

`filegrc setup` provides the headless equivalent of browser onboarding. Run it without arguments for guided terminal setup, or pass all initial service-boundary fields and a management program goal as flags or a JSON payload. Add `--preview` to validate and inspect the planned service and workspace writes without saving. Add `--summary --json` for compact agent output. Selecting Type 1 or Type 2 updates the workspace goal and selected systems. Setup does not select framework records, link controls, create evidence, or create an audit record.

`filegrc program-path` gives agents the renderer’s six-step order, exact page Instructions, Use, Policy Basis, commands, current state, and next actions. `filegrc guide <type>` repeats the matching page guidance and adds fields, relationship candidates, Markdown slots, and timing for that record type.

`filegrc program-readiness` reports whether management can start a candidate Type 2 period. Add `--summary --json` for compact stage counts and next actions, or omit `--summary` for every readiness item. Use `--require-ready` in automation. The command does not require an audit ID or CPA firm.

`filegrc evidence-test-drafts --preview --json` reports the missing draft tests for external evidence without writing them. Run `filegrc evidence-test-drafts` after confirming applicable controls and authoritative source Systems. When a Step 5 operating record exists, put the fixed artifact in an External Evidence record and link it from that operating record.

`filegrc obligations` shows recurring work and a task-level preview for each Policy Event, including owners, deadlines, and requested proof. `filegrc trigger` adds the event and all of its Action Items to the Work Queue atomically, then prints the created task IDs and deadlines.

Long-form Markdown lives beside its JSON record. filegrc derives the Markdown path, so records do not store it.

Headless creates and updates accept either a record or `{ "record": {...}, "content": {...} }`, the same mutation shape used by the web app. Run `filegrc get <id> --mutation` before an update to include JSON and Markdown revision hashes; stale writes are rejected. Use `filegrc content <type> <id>` to read a companion and `--write <file|->` to replace it. `filegrc guide --json` is the compact action and resource index for agents.

Use `filegrc attach <evidence-id> <source-file>` to copy a fixed evidence file under its record and update `filePaths` without overwriting an existing attachment.

Use `filegrc detach <evidence-id> <attachment-name> --yes` for explicit removal. Evidence records with linked local attachments cannot be deleted.

The package requires Node.js 20 or newer. It uses Git for authors, commit timestamps, messages, diffs, and revisions. Browser commits are explicit. Without a remote they remain local; with a remote the browser commits and pushes together. Browser pulls use rebase. Agents and terminal users use Git directly; the filegrc CLI does not wrap pull, commit, or push.

The editable server has no authentication and binds to loopback by default. Put it behind trusted authentication before exposing it on a network, or publish the read-only static build.

The authoritative data model ships in this package. Import the public Node.js API from `filegrc` and the model loader from `filegrc/model`.
