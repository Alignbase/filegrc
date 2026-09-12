# Upgrading to model v11

Model v11 removes mandatory independent approval from each implemented Control. A Control owner can record implementation once the procedure, scope, mappings, operation pattern, implementation date, Obligations, and evidence sources are complete. FileGRC counts that implementation in program readiness immediately.

Control oversight now uses a periodic, Git-bound Collection Review over the Program's implemented Controls. FileGRC reveals this action after the implementation work areas are ready and before management activates program content. The review captures the exact implemented Control population and revisions and becomes stale after a reviewed Control or Program scope changes. Independent approval of Policies, governed Documents, and Training content remains unchanged. A migrated workspace with content that was already active keeps those lifecycle facts and records the new Control collection review without repeating activation.

Preview and apply the migration:

```sh
npx filegrc migrate --to-model 11 --preview --json
npx filegrc migrate --to-model 11 --yes --json
```

The migration updates the Workspace model version and removes `implementationReviewedByIds` and `implementationReviewedOn` from Control records. It does not create a Control Collection Review or infer a review conclusion. After committing the migrated workspace, scaffold the first review with:

```sh
npx filegrc review-collection control --scaffold
```
