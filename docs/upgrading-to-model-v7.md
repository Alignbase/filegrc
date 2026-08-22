# Upgrade to data model v7

Model v7 keeps FileGRC and migration history out of compliance-entity narratives and lifecycle values.

Preview the one-step upgrade from model v6:

```sh
npx filegrc migrate --to-model 7 --preview --json
```

Review the complete file diff, then apply that exact migration:

```sh
npx filegrc migrate --to-model 7 --yes --json
npx filegrc validate --json
```

The migration changes `activationBasis: legacy-v4` on issued engagement Documents to the neutral `historical` basis. It returns Training with `activationBasis: legacy-v5` to `approved`, removes the old combined effective state, and lists the prior effective date in the migration report. Record a current Step 3 activation before treating that Training as operating. The migration does not invent an activation actor, date, content revision, management decision, or operating fact. Git retains the prior model and source values.

Applicability decisions recorded before v7 use a whole-workspace revision rather than the new resource-specific scope fingerprint. They remain visible but stale after migration. Review them once against the current scope; later changes will stale only the decisions whose material inputs changed.

Migration instructions, model-version context, and unmapped legacy fields remain in the migration preview and result. They are not written into resource descriptions, rationales, summaries, purpose, boundary, Markdown, or extensions.

Workspaces older than model v6 must migrate one version at a time and review each preview before applying it.
