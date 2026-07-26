# FileGRC SOC 2 program

This repository holds a SOC 2 GRC program managed with FileGRC. JSON files under `data/` hold structured records. Markdown files under `data/content/` hold policies, plans, training, minutes, and other long-form material. Git records the review trail.

![SOC 2 program overview](docs/filegrc-home.png)

## Create a workspace

```sh
npx create-filegrc@latest company-grc
cd company-grc
npm run validate
npm run serve
```

You need Node.js 20 or newer and Git. The setup command initializes Git when needed, then asks for the company name, your name as the initial policy owner, and a security contact email.

Open the local URL printed by `npm run serve`. FileGRC provides the program overview, resource pages, Markdown and record editing, search, filters, validation results, and Git history. Its obligation board shows recurring policy work as upcoming, due, or overdue, including the full allowed completion range and overdue cutoff. Event reminders create complete checklists for changes such as hiring, departures, vendors, system changes, and incidents.

The audit page builds a period evidence packet containing dated operating records, obligation coverage, event workflows, linked evidence, policies, controls, raw records, Markdown, and fixed attachments. It also reports missing completion and evidence coverage. Review changes on Repository, then create a validated commit there or use the Git CLI.

The same workflows are available headlessly:

```sh
npx filegrc obligations --json
npx filegrc complete obligation-id completion-record.json
npx filegrc trigger person-started --occurred-on 2026-07-25 --subject person-id
npx filegrc evidence-packet --start 2026-01-01 --end 2026-03-31
```

The first local run explains the file and Git workflow, policy deadlines, event checklists, and bulk evidence preparation before offering optional setup for the initial service boundary and audit objective. Completing or skipping onboarding updates `data/renderer.json`. You can restart it from Repository or bypass the UI and edit the same files directly.

The local server has no authentication and binds to loopback by default. Do not expose its write API to an untrusted network.

Run `npm run build` to create a read-only site under `.filegrc/site/`. Commit the source records first, then pin evidence to the Git revision shown in the app when you provide rendered pages to an auditor.

Review the starter drafts against actual practice before approving them. Read `AGENTS.md` before changing records or adding automation.

The starter uses the SOC 2 Security category. It includes Common Criteria and Description Criteria reference IDs, a planned control catalog, a security and risk oversight team, recurring work from the included policies, a 5x5 risk method, and four data classifications. It does not include the licensed criteria text. Add optional trust categories, systems, vendors, service commitments, audit scope, and evidence during setup.

## Scope

This repository manages GRC records and audit evidence. It does not replace identity systems, infrastructure logs, monitoring, endpoint controls, backups, vulnerability tooling, deployment controls, or incident detection. Record those systems and link their evidence here.

The included framework mappings, controls, policies, schedules, and training are starting material. Planned controls are not proof of implementation. Review them for your systems, contracts, laws, and actual practices before approval.
