# filegrc

![filegrc, run a SOC 2 program as files in Git](docs/filegrc-social-preview.png)

Run a SOC 2 program as files in Git.

filegrc gives founder-led engineering teams one place to adopt policies, implement controls, run recurring work, collect evidence, and prepare an audit.

It is open source, MIT licensed, and runs locally.

Use a dedicated private repository for your FileGRC workspace. The browser commits and pushes each saved program change, so a standalone repository keeps the compliance audit trail separate from application development history.

```sh
npx create-filegrc@latest company-grc
cd company-grc
npm run validate
npm run serve
```

Requires Node.js 20 or newer and Git.

Existing model v8 workspaces must run `npx filegrc migrate --to-model 9 --preview --json` after installing a model v9 package. The migration keeps current Obligation schedules in legacy mode until management reviews and activates rule-based replacements. Older workspaces migrate one model version at a time. See the [model v9 upgrade guide](https://github.com/Alignbase/filegrc/blob/main/docs/upgrading-to-model-v9.md).

## How it works

The repository is the program. There is no separate application database.

- **JSON** holds records that filegrc validates, filters, and connects.
- **Markdown** holds policies, procedures, plans, minutes, and narratives.
- **Git** exclusively supplies authors, commit timestamps, revisions, diffs, renames, prior versions, and commit messages.

Use the same source through the local web app, a text editor, the CLI, or CI. Browser and CLI actions call the same rules, so engineers and agents see the same validation and readiness results.

New workspaces use `main` as the authoritative browser branch. Browser saves fetch and fast-forward from `origin`, validate the change, and create a focused local commit. The UI then unlocks for navigation while Git push continues in the background. Other writes remain locked until the Repository status confirms `Synced`; a failed push keeps the local commit and offers Retry sync. Draft, proposed, approved, and retired records all live on that branch because record status, not a Git branch, represents approval.

Detached and feature-branch checkouts are read-only in the browser by default. Developers can run `npx filegrc serve --allow-non-authoritative-writes` for local task-worktree edits; that override never commits or pushes. CLI and agent workflows continue to manage Git explicitly.

## One path from setup to audit

![filegrc SOC 2 program overview](docs/filegrc-home.png)

1. **Define scope.** Set program ownership, choose the criteria, and define the service, Systems, and providers in scope.
2. **Approve policies.** Review Policies, program Documents, and Training in one table. Have someone other than the owner approve each exact revision. Approval does not mean the linked Controls are implemented.
3. **Implement controls.** Implement the approved requirements, define how each Control works, connect its Evidence sources, and configure Obligations. Activate each unchanged approved Document or Training record with a separate activation date and revision, then activate the selected Policy cutover set.
4. **Operate the program.** Run scheduled and event-driven work, maintain risk, and retain dated evidence.
5. **Audit.** Set up the CPA engagement, support fieldwork, and prepare the evidence packet.

A Policy says what the company commits to do by the date it takes effect. Approval means the company accepts those commitments. It does not prove the work is done. Controls and operating records describe how the company meets them and provide the proof.

FileGRC does not infer technical implementation from Policy prose. Configuration facts belong in Controls, Components, Systems, Obligations, and Evidence. A Control may be implemented while its governing Policy, required program Document, or Training is approved but inactive. Enabled Obligations remain dormant until all of their governing content is active and effective.

Control implementation includes evidence-source, Obligation, and governed-content readiness. Use `npx filegrc program-readiness --json` to review incomplete Control or Component records plus `documentActivations`, `trainingActivations`, and `policyActivations`. Activate ready program Documents and Training with `npx filegrc activate-content --scaffold`; name the active Person who performs activation, and keep approval and activation as separate dates and content-revision bindings. Then use the Controls-page review or `npx filegrc activate-policies --scaffold` to choose which approved Policies take effect. Evidence Readiness requires active Policies, required program Documents, Training, implemented Controls, configured evidence sources, and enabled Obligations before the candidate period can begin. Create Evidence during Step 4 only after operation produces a real record or artifact. Create engagement terms, management assertions, representation letters, and other Audit Documents in Step 5, link each to one Audit, approve it, then activate it with `npx filegrc activate-documents --audit AUDIT_ID --scaffold`.

The Program Overview shows what is done, what is blocked, and what to do next.

## The routine work stays connected

- **Work Queue** turns policy schedules and follow-up into upcoming, blocked, due, and overdue work, with named blockers when a task cannot proceed.
- **Policy Events** create the right tasks for hiring, departures, incidents, vendor changes, and other events.
- **Program Readiness** checks whether you can begin a reliable evidence period.
- **Period Health** checks role, policy, control, source, obligation, and Git-history continuity across candidate and formal Type 2 dates.
- **Audit Readiness** checks the engagement, period, documents, evidence, and Type 2 populations.
- **Evidence packets** collect the scoped records, attachments, history, indexes, and checksums for delivery.

![filegrc audit readiness](docs/filegrc-audit.png)

The Security starter uses one consolidated Information Security Policy with familiar policy-family headings, one Security Incident and Recovery Plan, one focused Data Retention Schedule, one Security Awareness Training record, and the Controls and Obligations needed for the Security common criteria. The headings make common customer and Vendor questionnaire topics easy to locate, but they do not prove implementation or create separate policy documents. Confirm the applicable Control status and Evidence before answering a questionnaire.

These records are proposals, so review them against how your company actually works. Suggested retention periods and schedule cadences are starting points, not adopted requirements. Add Privacy, Confidentiality, Availability, Processing Integrity, employment, anti-bribery, or other broader GRC material only when the company chooses to expand the scope.

## Built for engineers and agents

The browser is helpful, but it is not required. An agent can discover the model, inspect valid relationships, create records, complete scheduled work, trigger events, and check the result from the CLI.

```sh
npx filegrc program-path --next --json
npx filegrc reconcile --preview --json
npx filegrc workflow --json # full checklist when needed
npx filegrc period-health --require-healthy --json
npx filegrc review-applicability decisions.json --preview --json
npx filegrc review-collection person --scaffold
npx filegrc guide risk-assessment --json
npx filegrc obligations --json
npx filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD
npx filegrc program-readiness --summary --json
npx filegrc audit-readiness audit-id --json
npx filegrc evidence-packet --audit audit-id
npm run check:milestone
```

Read `AGENTS.md` and `data/AGENTS.md` inside a generated workspace for the full headless workflow.

## Clear boundaries

filegrc manages GRC records and audit evidence. Your workforce, identity, source control, infrastructure, monitoring, endpoint, backup, training, signature, procurement, and vendor systems still operate the controls and produce source evidence.

The independent CPA firm still selects samples, tests controls, evaluates exceptions, decides whether evidence is sufficient, and issues the SOC 2 report.

For a SOC 2 engagement, scope all 33 Security Common Criteria, all nine Description Criteria, and any optional Trust Services Categories included in the report. The Security Common Criteria remain mandatory. Record any criterion from an optional category judged not relevant under DC8 instead of omitting a Description Criterion.

Do not put plaintext credentials, private keys, tokens, recovery codes, or personal data that may need erasure into Git. Source-controlled ciphertext is allowed only under the Information Security Policy's approved encryption, separate-key, access, and rotation conditions. The editable local server has no authentication and binds to loopback by default.

Learn more at [filegrc.com](https://filegrc.com) or [view the source on GitHub](https://github.com/Alignbase/filegrc).
