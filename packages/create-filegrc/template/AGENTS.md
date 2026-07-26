# FileGRC SOC 2 Workspace Instructions

## Purpose

This repository is {{company_name}}’s FileGRC workspace for its SOC 2 program. Engineers and agents maintain the source records under `data/`. The `filegrc` package validates, searches, edits, and renders those files.

Using this repository does not establish compliance by itself. Records must match actual practice and evidence must prove that controls operated during the audit period.

## Working rules

- Read `README.md` and run `npm run validate` before broad changes.
- Treat `data/` as the source of truth. Do not hand-edit `.filegrc/` output.
- Use UTF-8 JSON for structured records and Markdown for long-form work.
- Keep one resource in each JSON file.
- Let the local app generate IDs from each record’s name or title. When editing JSON directly, keep IDs globally unique, human-readable, and lowercase kebab-case.
- Use ISO 8601 dates and RFC 3339 timestamps.
- Store relationships as resource IDs.
- Put policies, plans, charters, procedures, meeting minutes, training, assertions, narratives, templates, and audit responses in Markdown beside their JSON records. FileGRC derives the Markdown name, so records do not contain file paths.
- Put signed forms, screenshots, third-party reports, and immutable exports behind evidence records. These files may be PDF, image, CSV, or another fixed format.
- Never fetch an external evidence reference automatically.
- Do not store secrets, credentials, session data, or personal data that may need to be erased from Git history.
- Keep the editable local server on loopback or behind trusted authentication. Use the read-only static build for audit sharing.

## Git is the audit trail

Git supplies file authors, commit timestamps, messages, diffs, and revisions. Do not add fields such as `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, or a second change log.

Domain events still need explicit dates. Keep values such as `occurredOn`, `approvedOn`, `reviewedOn`, `completedOn`, and audit-period dates in their records.

Make focused commits with messages that explain the reason for the change. The engine never creates commits automatically. Review the workspace diff, then use Commit changes on Repository or the Git CLI. The renderer validates the workspace and requires an explicit message before it creates a commit.

Do not rewrite or remove committed records that explain prior audit periods. Close or retire them. Delete only mistakes and uncommitted drafts.

## Data model

`data/workspace.json` selects the model through `dataModelVersion`. The installed `filegrc` package owns the authoritative model. Do not copy or invent a local schema.

Run these commands when working with records:

```sh
npm run validate
npx filegrc describe risk
npx filegrc search "access review"
npm run serve
```

Prefer existing fields. Put organization-specific values under `extensions` with a namespace owned by {{company_name}}. Add structure only when validation, filtering, relationships, due dates, or audit completeness need it. Variable procedures, interviews, observations, rationale, and detailed results belong in the record's Markdown companion.

Never change a resource ID after it is committed. Create a replacement and link the records if identity truly changes.

The local app keeps IDs out of the guided form, generates them during creation, and leaves them unchanged when a record is renamed. It presents the core model fields and relationship pickers. Use its advanced JSON section for optional fields and extensions. It rejects a save if the source file changed after the editor opened, so reload and reapply the change instead of overwriting newer work.

## Renderer settings and onboarding

`data/renderer.json` stores committed renderer preferences. New workspaces set `showOnboarding` to `true`. Completing or skipping onboarding sets it to `false`; the app does not commit that change.

Onboarding explains the file and Git workflow, recurring obligations, event checklists, and bulk evidence preparation, then collects the initial service boundary, owner, business criticality, highest data classification, internet exposure, and optional audit objective. It creates or updates a `system` record and may create a planned `audit` record. Treat both as drafts to review against actual scope.

The renderer is optional. Agents may set `showOnboarding` to `false` and maintain all records headlessly. Restart onboarding from Repository when useful. Read-only builds never run it.

## Starter baseline

The generated workspace starts with the SOC 2 Security category:

- Active framework records for the 2017 Trust Services Criteria with revised points of focus (2022) and the 2018 SOC 2 Description Criteria with revised implementation guidance (2022)
- The 33 Common Criteria reference IDs from CC1.1 through CC9.2, without the licensed criteria text
- The nine Description Criteria reference IDs from DC1 through DC9, without the licensed criteria text
- Planned controls mapped to those references and the included policies
- A security and risk oversight team chaired by the initial policy owner
- Recurring obligations for the reviews, scans, tests, training, and meetings required by the included policies
- A default 5x5 risk method and Public, Internal, Confidential, and Restricted data classifications

Treat every planned control as a proposal until its owner, scope, operation, and evidence match actual practice. Do not mark a control implemented because a policy describes it. Add Availability, Processing Integrity, Confidentiality, or Privacy criteria only when they are in scope.

The recurring obligations mirror the fixed cadences in the starter policies. Update the policy, control, and obligation together when an approved cadence changes. Create separate completion records, such as meetings, reviews, scans, tests, exercises, and attestations, for each period.

## Policy work queue

Run the same obligation planner used by the web app:

```sh
npx filegrc obligations --json
npx filegrc obligations --from 2026-01-01 --through 2026-12-31 --complete --json
```

A calendar obligation’s recurrence anchor starts its first allowed cycle. Unless `window` narrows that range, completion is allowed from the cycle start through the day before the next cycle, and the item becomes overdue on the next cycle’s first day. Use **Record work** in the obligation board, or create and link a completion atomically with:

```sh
npx filegrc complete obligation-id completion-record.json
```

Keep prior completion links because the planner matches each dated record to its own period.

Event obligations are templates. Do not mark a template complete or replace it for each occurrence. Start a workflow in the obligation board or run:

```sh
npx filegrc trigger person-started --occurred-on 2026-07-25 --subject person-new-worker --json
npx filegrc trigger person-ended --occurred-at 2026-07-25T16:30:00-05:00 --subject person-departing-worker --json
```

The command creates one `obligation-event` and its complete action checklist in a single validated write. Hour-based deadlines require an RFC 3339 event timestamp so an immediate or 24-hour cutoff is exact. Day-based deadlines use the event’s calendar date. Link the requested completion resources and evidence to each action item, then mark the actions done and the event complete. Every generated action has a cutoff. FileGRC applies a 30-day deadline when an older or custom event obligation omits one.

## Period evidence packets

Preview coverage before writing output:

```sh
npx filegrc evidence-packet --start 2026-01-01 --end 2026-03-31 --preview --json
npx filegrc evidence-packet --start 2026-01-01 --end 2026-03-31 --audit audit-2026-type-2
```

The packet includes every resource with a model-defined date or timestamp in the period, records whose explicit period overlaps it, recurring obligation occurrences, event workflows, linked evidence, active policies, mapped controls, and selected audit scope. Output under `.filegrc/evidence-packets/` is derived and must not be hand-edited or committed.

Treat a packet as ready to send only when its review list is clear and its manifest names a clean Git revision. The generator copies raw records, Markdown, and local fixed attachments. It lists external evidence references without fetching them. Run the UI and CLI against the same committed revision when comparing results.

## Content and approvals

The seed policy owner is {{policy_owner_name}} and the reporting address is {{security_contact_email}}. Replace ownership or contacts when responsibilities change.

Policy and training attestations must identify the exact Git revision of the content that a person acknowledged. Store signatures as evidence attachments and link their evidence IDs from the attestation.

Committee and risk meeting minutes are `meeting` resources with a primary Markdown companion. An optional `-agenda.md` companion holds the agenda. Record attendees, decisions, risks discussed, and action item IDs. Keep action tracking in `action-item` records.

## Audit evidence

A rendered-page evidence capture must identify:

- The route and filters shown
- The audit or evidence period
- The exact Git commit
- The capture timestamp and method
- The source resource IDs
- The screenshot or fixed export

Commit the evidence record and attachment together. Do not claim that a current page proves a prior period unless it is rendered from or bound to the correct revision.

## Validation

After substantive edits:

1. Run `npm run validate`.
2. Review JSON and Markdown diffs.
3. Check every new relationship and attachment.
4. Confirm dates describe the business event, not the edit time.
5. Run `npm run build` when producing a read-only audit view.

Do not loosen validation to make a bad record pass. Fix the record or update the installed engine through its normal versioned model process.
