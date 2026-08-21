# Upgrade to data model v6

Model v6 makes Training governed content. Management approves the exact Training revision in Step 2, then activates that unchanged revision in Step 3 after its linked Controls and assignment Obligation are ready. Individual assignments and completions remain Step 4 work.

Training no longer stores `assignmentTrigger` or `completionWindowDays`. Obligations are the only source for calendar and event assignment timing, completion windows, owners, and proof requirements.

## Preview

From a model v5 workspace, run:

```sh
npx filegrc migrate --to-model 6 --preview --json
```

The preview classifies each change:

- Automatic changes rename `approvedByIds` to `approverIds`, preserve `effectiveContentRevisions` as `approvedContentRevisions`, and select model v6.
- Review-required changes list removed Training schedule values and the matching Obligation IDs, when any exist.
- Existing active or retired Training receives `activationBasis: legacy-v5`. This preserves its historical state without inventing an activation actor, activation date, or second revision.
- Unsupported changes must be resolved before apply.

Review every Training record. Confirm that its approver is separate from its owner, its linked Controls are correct, and one enabled Obligation defines each required assignment schedule. Create or edit the Obligation in Step 3 when the preview reports no matching schedule.

## Apply

After the preview is ready and the diff is understood, run:

```sh
npx filegrc migrate --to-model 6 --yes --json
```

The migration writes one atomic batch and validates the complete model v6 workspace. It does not create a Git commit.

## Continue the lifecycle

Use the Policies page to review Policies, program Documents, and Training in one table. New or changed Training moves through `draft`, `in-review`, and `approved` in Step 2. FileGRC binds approval to the exact companion Markdown revision.

In Step 3, implement the linked Controls, enable the assignment Obligation, and review the activation payload:

```sh
npx filegrc activate-content --scaffold
```

Record the active Person who performs the activation and the actual activation and effective dates. Step 4 then uses the Obligation to produce assignments and Attestations against the active Training revision.
