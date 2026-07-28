# {{company_name}} SOC 2 Program

This private workspace holds {{company_name}}'s SOC 2 program records and audit evidence. JSON under `data/` stores structured records, Markdown stores long-form work, and Git records reviewed changes.

The workspace uses filegrc {{filegrc_version}} through the dependency range `{{filegrc_version_range}}`.

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
npx filegrc program-path --json
npx filegrc obligations --json
npx filegrc validate --json
```

Read `AGENTS.md` and `data/AGENTS.md` before broad changes.

## Finish initial setup

The starter policies, controls, and obligations are proposals. They do not state that {{company_name}} operates the described controls.

1. Run `npx filegrc setup` for guided service and goal setup, or use browser onboarding. Then finish Step 1 by adding the real reviewers and operators, finishing the oversight team, and confirming applicable criteria, commitments, material vendors, and in-scope systems.
2. Review the starter policies, appoint a reviewer who is separate from the policy owner, and activate only the policies that match current practice. The reviewer will usually be another person in the organization, but may be external.
3. Review the starter control set, implement each applicable control with its actual procedure, scope, cadence, evidence sources, and implementation date, and confirm any linked Work Queue schedules are enabled. Marking a control implemented starts eligible schedules. Then record any complementary customer or subservice controls.
4. Open each generated External Evidence draft, choose its authoritative source System, collect the named artifact, and have another person verify it.
5. Run `npx filegrc program-readiness --require-ready`, record the management candidate period start when reliable evidence collection begins, maintain risk assessments and risks, update controls when needed, use Work Queue for scheduled work, and trigger Policy Events when changes create required actions. `npx filegrc obligations` previews every event task, owner, deadline, and requested proof before the trigger creates anything.
6. Engage a CPA firm, record the separate firm-agreed period in an audit record, review filegrc Evidence and External Evidence, and prepare fieldwork.

filegrc manages GRC records and audit evidence. It does not replace infrastructure logging, monitoring, identity, backup, endpoint, or incident-detection systems.
