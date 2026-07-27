# FileGRC

Run a SOC 2 program as files in Git.

FileGRC gives a founder-led engineering team one place to adopt policies, track recurring compliance work, respond to company events, and prepare an audit. JSON holds structured records, Markdown holds long-form work, and Git supplies the change history.

There is no separate application database. The repository is the program, so engineers and agents can use the same data through the web app, a text editor, or the CLI.

![FileGRC SOC 2 program overview](docs/filegrc-home.png)

## Why it exists

SOC 2 work tends to scatter across documents, calendars, tickets, screenshots, and the auditor’s request list. That makes it hard to answer basic questions: What is due? Which policy requires it? What changed during the audit period? Is the evidence complete?

FileGRC keeps that work connected:

- A starter Security program links criteria references, policies, planned controls, owners, and schedules.
- The obligation board turns policy timing into upcoming, due, and overdue work.
- Event checklists cover hiring, departures, vendor changes, incidents, and other policy triggers.
- Audit Readiness says what management work, source-system exports, and evidence are still missing.
- The packet builder produces a scoped, indexed delivery with source files, attachments, history, and checksums.

The starter content is a proposal, not a claim of compliance. Review every policy and planned control against how your company actually operates before approving it.

## Start a workspace

You need Node.js 20 or newer and Git.

```sh
npx create-filegrc@latest company-grc
cd company-grc
npm run validate
npm run serve
```

Setup asks for the company name, the initial policy owner, and a security contact email. It initializes Git when needed. The first local run then helps define the service boundary, an independent approver, and an optional audit goal.

Open the printed local URL. You can commit locally from Repository without configuring a remote. Add a remote when the team is ready to share the workspace, then the browser can pull with rebase and push reviewed commits.

The creation summary reports the resolved engine version, install result, and whether the target joined an existing Git worktree. Generated workspaces receive an organization-specific README with their engine version, validation commands, and remaining setup work.

## How it works

1. Add or edit compliance artifacts under `data/`.
2. FileGRC validates relationships, renders the current program, and calculates policy work.
3. Commit focused changes with a message that explains why the records changed.
4. Git preserves the author, time, message, diff, and prior version.
5. For an audit, define the Type 1 date or Type 2 period and generate an evidence packet from the selected revision.

Long-form policies, procedures, plans, minutes, training, assertions, and audit responses are Markdown companions beside their JSON records. Screenshots, signed acknowledgements, reports, and fixed exports are attachments linked through evidence records.

## Run the program

Use Overview to follow the audit chain: scope, criteria, policies, controls, operation, and audit. The sidebar follows the same order.

Use Obligation Board for recurring work and event checklists. Each item shows its allowed completion window and overdue cutoff, based on the policy that created it. Link a dated completion record and evidence to close the occurrence.

Use the resource pages to maintain systems, people, vendors, risks, controls, tests, incidents, training, meetings, and evidence. The question-mark guide on each list explains what the record type is for, which policies call for it, and when to update it.

Agents use the same logic headlessly:

```sh
npx filegrc guide risk-assessment --json
npx filegrc scaffold risk-assessment --title "2026 Annual Risk Assessment"
npx filegrc list risk --json
npx filegrc obligations --json
npx filegrc complete obligation-id completion-record.json
npx filegrc trigger person-started --occurred-on 2026-07-25 --subject person-id
npx filegrc complete-action action-item-id completion-record.json --completed-on 2026-07-25
npx filegrc complete-event obligation-event-id --completed-on 2026-07-25
npx filegrc search "access review"
```

`guide` reports the policy context, timing, required fields, valid values, relationship candidates, and Markdown locations for every resource type. `scaffold` produces the same JSON and Markdown mutation shape used by the browser. Read `AGENTS.md` and `data/AGENTS.md` for the full headless workflow.

## Prepare the audit

Record the audit firm, scope, and exact date or period. Audit Readiness then checks management-owned preparation, including the system description, assertion, policy and control state, source systems, evidence, and Type 2 populations.

![FileGRC audit readiness](docs/filegrc-audit.png)

For a Type 2 audit, reconcile each complete period population to its authoritative system after the period closes. A zero-item population still needs its source export and query. FileGRC packages the selected records, Markdown, fixed attachments, historical versions, indexes, and SHA-256 checksums.

```sh
npx filegrc prepare-audit audit-id
npx filegrc audit-readiness audit-id --json
npx filegrc evidence-packet --audit audit-id
```

FileGRC checks management preparation and packet integrity. The independent CPA firm still selects samples, tests controls, evaluates exceptions, decides whether evidence is sufficient, and issues the SOC 2 report.

## What belongs elsewhere

FileGRC does not replace workforce, identity, source-control, deployment, infrastructure, monitoring, endpoint, backup, vulnerability, training, signature, procurement, contract, or vendor-risk systems.

Catalog each authoritative system in FileGRC, record how to export from it, and attach or reference the fixed evidence when Audit Readiness asks for it. The generated external-delivery index identifies files that still need to be supplied through an auditor portal or another approved channel.

The starter uses the SOC 2 Security category and does not include licensed criteria text. Add Availability, Processing Integrity, Confidentiality, or Privacy only when they are in scope.

## Repository safety

The editable server has no authentication and binds to loopback by default. Do not expose it to an untrusted network. Use `npm run build` for a read-only site.

Do not put secrets or personal data that may need erasure into Git. Read `AGENTS.md` before broad record changes or automation work.
