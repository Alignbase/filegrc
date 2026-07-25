# SOC 2 Workspace Instructions

## Purpose

This repository is {{company_name}}’s plain-file GRC workspace. Engineers and agents maintain the source records under `data/`. The `soc2` package validates, searches, edits, and renders those files.

Using this repository does not establish compliance by itself. Records must match actual practice and evidence must prove that controls operated during the audit period.

## Working rules

- Read `README.md` and run `npm run validate` before broad changes.
- Treat `data/` as the source of truth. Do not hand-edit `.soc2/` output.
- Use UTF-8 JSON for structured records and Markdown for long-form work.
- Keep one resource in each JSON file.
- Keep IDs stable, globally unique, human-readable, and lowercase kebab-case.
- Use ISO 8601 dates and RFC 3339 timestamps.
- Store relationships as resource IDs.
- Put policies, plans, charters, procedures, meeting minutes, training, assertions, narratives, templates, and audit responses in Markdown under `data/content/`.
- Put signed forms, screenshots, third-party reports, and immutable exports behind evidence records. These files may be PDF, image, CSV, or another fixed format.
- Never fetch an external evidence reference automatically.
- Do not store secrets, credentials, session data, or personal data that may need to be erased from Git history.
- Keep the editable local server on loopback or behind trusted authentication. Use the read-only static build for audit sharing.

## Git is the audit trail

Git supplies file authors, commit timestamps, messages, diffs, and revisions. Do not add fields such as `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, or a second change log.

Domain events still need explicit dates. Keep values such as `occurredOn`, `approvedOn`, `reviewedOn`, `completedOn`, and audit-period dates in their records.

Make focused commits with messages that explain the reason for the change. The engine writes files but never creates commits automatically. Review `git diff` before every commit.

Do not rewrite or remove committed records that explain prior audit periods. Close or retire them. Delete only mistakes and uncommitted drafts.

## Data model

`data/workspace.json` selects the model through `dataModelVersion`. The installed `soc2` package owns the authoritative model. Do not copy or invent a local schema.

Run these commands when working with records:

```sh
npm run validate
npx soc2 describe risk
npx soc2 search "access review"
npm run serve
```

Prefer existing fields. Put organization-specific values under `extensions` with a namespace owned by {{company_name}}. Add structure only when validation, filtering, relationships, due dates, or audit completeness need it. Variable procedures, interviews, observations, rationale, and detailed results belong in Markdown through `notesPath`.

Never change a resource ID after it is committed. Create a replacement and link the records if identity truly changes.

The local app presents the core model fields and relationship pickers. Use its advanced JSON section for optional fields and extensions. It rejects a save if the source file changed after the editor opened, so reload and reapply the change instead of overwriting newer work.

## Content and approvals

The seed policy owner is {{policy_owner_name}} and the reporting address is {{security_contact_email}}. Replace ownership or contacts when responsibilities change.

Policy and training attestations must identify the exact Git revision of the content that a person acknowledged. Store signatures as evidence attachments and link their evidence IDs from the attestation.

Committee and risk meeting minutes are `meeting` resources with Markdown in `minutesPath`. Use `agendaPath` for the agenda and `notesPath` only for extra working notes. Record attendees, decisions, risks discussed, and action item IDs. Keep action tracking in `action-item` records.

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
