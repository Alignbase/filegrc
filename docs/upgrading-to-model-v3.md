# Upgrade a workspace to data model v3

Model v3 replaces manual page completion with one derived workflow and adds the records needed to guide source coverage, scope confirmation, policy events, control operation, and the audit lifecycle. The migration changes workspace files but does not commit them.

Start from a clean Git worktree on the branch where you maintain the FileGRC workspace. Install `filegrc` 0.5.0 or newer, then preview the migration:

```sh
npx filegrc migrate --to-model 3 --preview --json
```

The preview classifies every proposed change:

- `automatic` contains facts FileGRC can derive without a management decision.
- `reviewRequired` contains new prompts that remain planned or incomplete after migration.
- `unsupported` contains source records that would be invalid in model v3. Resolve every unsupported item before applying.

The preview also includes `fileDiff`, `missing`, `manualActions`, and the exact create and update batch. It is ready when `ready` is `true`.

Apply the same migration only after reviewing the preview and committing or backing up the current workspace:

```sh
npx filegrc migrate --to-model 3 --yes --json
```

The command writes one atomic, whole-workspace batch, validates it against model v3, changes `dataModelVersion` as part of that batch, and returns the post-migration workflow assessment. It does not create a Git commit. If validation fails, FileGRC restores every file it changed.

Model v1 workspaces must migrate to model v2 first:

```sh
npx filegrc migrate --to-model 2 --preview --json
```

Follow the [model v2 upgrade guide](upgrading-to-model-v2.md), apply that migration, then preview model v3.

## Automatic changes

When the source records support them, the migration:

- Removes obsolete `renderer-settings.completedStagePageIds` because model v3 derives every page state.
- Creates planned Policy Owner and Independent Policy Reviewer Appointments that are missing. It does not assign holders or dates.
- Creates one planned Collection Review for People, Frameworks, Vendors, Systems, and Complementary Controls.
- Creates one planned Source Coverage prompt for every model-defined evidence source family and assigns the Policy Owner Appointment as its proposed owner.
- Moves a non-active Policy or Document `effectiveOn` date to `proposedEffectiveOn`.
- Merges `high-risk-person-ended` into the `person-ended` Policy Event and keeps the high-risk filter.
- Adds the required departure risk level to existing departure events.
- Selects model v3 in the Workspace record.

New planned records are prompts. They do not prove that management reviewed a collection, assigned an Appointment, accepted an applicability decision, confirmed a source, operated a control, completed work, or approved content.

## Work to review after migration

Run:

```sh
npx filegrc workflow --json
npx filegrc program-path --next --json
```

The workflow will guide management through the remaining decisions. Common review items include:

- Assigning and activating the core Appointments.
- Confirming complete or empty scope collections.
- Reviewing Requirement, Commitment, Complementary Control, and Control applicability.
- Confirming each evidence source family’s authoritative recordkeeping path.
- Reviewing proposed Policy and governed Document effective dates.
- Adding model v3 timing facts to Risks, Vulnerabilities, Access Grants, and Service Accounts when they apply.
- Completing new Control implementation review and evidence-source readiness checks.
- Supplying the new audit lifecycle, delivery, closure, and subsequent-events facts as an engagement progresses.

FileGRC keeps these decisions incomplete until a user or agent records them. The browser and CLI calculate the same next actions from the migrated source files.

## Items that stop the migration

The preview reports an unsupported item when model v3 cannot preserve a source record without a decision or missing fact. Examples include:

- A done obligation Action Item without the required completion record.
- A blocked Action Item without named blocking resources.
- A value that is no longer allowed by a model v3 enum or condition.
- A required model v3 field that is missing from an existing final record.
- An unknown top-level or nested field.
- A relationship whose target type is not allowed.
- A parent or supersession cycle.

Edit the model v2 source records, rerun validation, and preview again. Do not edit `dataModelVersion` by hand or copy the model into the workspace.

## Review the Git diff

After the migration:

```sh
npm run validate
git diff -- data
```

Review every created and changed record. Commit the migration separately so its source facts and later management decisions remain easy to audit. If you need to abandon an uncommitted migration, restore the files with your normal Git workflow.
