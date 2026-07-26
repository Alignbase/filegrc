# SOC 2 program

This repository holds a plain-file SOC 2 GRC program. JSON files under `data/` hold structured records. Markdown files under `data/content/` hold policies, plans, training, minutes, and other long-form material. Git records the review trail.

![SOC 2 program overview](docs/soc2-home.png)

## Create a workspace

```sh
npx create-soc2@latest company-soc2
cd company-soc2
npm run validate
npm run serve
```

You need Node.js 20 or newer and Git. The setup command asks for the company name, your name as the initial policy owner, and a security contact email.

Open the local URL printed by `npm run serve`. The web app provides the program overview, resource pages, Markdown and record editing, search, filters, validation results, and Git history. It never commits changes for you.

The local server has no authentication and binds to loopback by default. Do not expose its write API to an untrusted network.

Run `npm run build` to create a read-only site under `.soc2/site/`. Commit the source records first, then pin evidence to the Git revision shown in the app when you provide rendered pages to an auditor.

Review the starter drafts against actual practice before approving them. Read `AGENTS.md` before changing records or adding automation.

The starter uses the SOC 2 Security category. It includes Common Criteria and Description Criteria reference IDs, a planned control catalog, a security and risk oversight team, recurring work from the included policies, a 5x5 risk method, and four data classifications. It does not include the licensed criteria text. Add optional trust categories, systems, vendors, service commitments, audit scope, and evidence during setup.

## Scope

This repository manages GRC records and audit evidence. It does not replace identity systems, infrastructure logs, monitoring, endpoint controls, backups, vulnerability tooling, deployment controls, or incident detection. Record those systems and link their evidence here.

The included framework mappings, controls, policies, schedules, and training are starting material. Planned controls are not proof of implementation. Review them for your systems, contracts, laws, and actual practices before approval.
