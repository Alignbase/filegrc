# {{company_name}} SOC 2 Program

This private workspace holds {{company_name}}'s SOC 2 program records and audit evidence. JSON under `data/` stores structured records, Markdown stores long-form work, and Git records reviewed changes.

The workspace uses FileGRC {{filegrc_version}} through the dependency range `{{filegrc_version_range}}`.

## Work locally

You need Node.js 20 or newer and Git.

```sh
npm install
npm run validate
npm run serve
```

The editable server binds to loopback by default and has no authentication. Do not expose it to an untrusted network.

Agents and terminal users can inspect the workspace without the browser:

```sh
npx filegrc guide --json
npx filegrc obligations --json
npx filegrc validate --json
```

Read `AGENTS.md` and `data/AGENTS.md` before broad changes.

## Finish initial setup

The starter policies, controls, and obligations are proposals. They do not state that {{company_name}} operates the described controls.

1. Define the service boundary and accountable owner in browser onboarding, or run `npx filegrc setup --help`.
2. Appoint an external independent reviewer who is separate from {{policy_owner_name}} and the people who operate the controls under review.
3. Compare the starter policies and planned controls with current operations, then edit or remove anything that does not match.
4. Approve the reviewed baseline, run `npm run validate`, inspect the Git diff, and commit the accepted program.

FileGRC manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.
