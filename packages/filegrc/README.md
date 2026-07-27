# FileGRC

FileGRC is a zero-dependency Node.js engine for Git-native GRC workspaces. It validates structured JSON records and their Markdown companions, renders a local web app, provides safe CRUD operations, and builds a read-only audit view.

Program Readiness checks management-owned scope, policy adoption, control implementation, authoritative source configuration, and verified test captures without requiring an audit record. Audit Readiness starts after CPA engagement and checks the firm-agreed date or period, engagement-specific management documents, operating evidence, and Type 2 population completeness.

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
npx filegrc scaffold risk-assessment --title "2026 Annual Risk Assessment"
npx filegrc list risk --json
npx filegrc references risk-example --json
npx filegrc describe risk
npx filegrc search "access review"
npx filegrc program-readiness --require-ready
npx filegrc audit-readiness audit-id
npx filegrc prepare-audit audit-id
npx filegrc evidence-packet --start 2026-01-01 --end 2026-06-30 --audit audit-id
```

`filegrc serve --help` prints bind, port, environment, and safety options without starting the server. The editable server defaults to `127.0.0.1:8787`; set `FILEGRC_HOST`, `FILEGRC_PORT`, or the matching flags when needed.

`filegrc setup` provides the headless equivalent of browser onboarding. It accepts all initial service-boundary fields and a management program goal as flags or a JSON payload. Selecting Type 1 or Type 2 updates the workspace goal and program scope. It does not create an audit record.

`filegrc program-readiness` reports whether management can start a candidate Type 2 period. Use `--require-ready` in automation. The command does not require an audit ID or CPA firm.

Long-form Markdown lives beside its JSON record. FileGRC derives the Markdown path, so records do not store it.

Headless creates and updates accept either a record or `{ "record": {...}, "content": {...} }`, the same mutation shape used by the web app. Run `filegrc get <id> --mutation` before an update to include JSON and Markdown revision hashes; stale writes are rejected. Use `filegrc content <type> <id>` to read a companion and `--write <file|->` to replace it. `filegrc guide --json` is the compact action and resource index for agents.

Use `filegrc attach <evidence-id> <source-file>` to copy a fixed evidence file under its record and update `filePaths` without overwriting an existing attachment.

Use `filegrc detach <evidence-id> <attachment-name> --yes` for explicit removal. Evidence records with linked local attachments cannot be deleted.

The package requires Node.js 20 or newer. It uses Git for authors, commit timestamps, messages, diffs, and revisions. Browser commits are explicit. Without a remote they remain local; with a remote the browser commits and pushes together. Browser pulls use rebase. Agents and terminal users use Git directly; the FileGRC CLI does not wrap pull, commit, or push.

The editable server has no authentication and binds to loopback by default. Put it behind trusted authentication before exposing it on a network, or publish the read-only static build.

The authoritative data model ships in this package. Import the public Node.js API from `filegrc` and the model loader from `filegrc/model`.
