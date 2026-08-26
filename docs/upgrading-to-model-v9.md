# Upgrading to model v9

Model v9 adds reviewed Obligation rules, one rolled-up occurrence for each scheduled population, Git-bound temporal Collection Reviews, and effective Reporting Routes.

Preview and apply the migration:

```sh
npx filegrc migrate --to-model 9 --preview --json
npx filegrc migrate --to-model 9 --yes --json
```

The migration selects model v9 and keeps each existing Obligation schedule in legacy mode. It does not invent a management-approved rule, backdate a population review, split one Obligation into member-level tasks, or activate a Reporting Route.

After migration:

```sh
npx filegrc obligations --json
npx filegrc review-collection person --scaffold
npx filegrc program-readiness --json
```

Review each proposed Obligation rule before activation. FileGRC then calculates the selected population and keeps its member results inside one occurrence. Record a Collection Review only after committing the source collection and scope facts, because the review binds that Git revision. Create and approve a Reporting Route before completing work that must prove which route was communicated.

Git remains the version history. The migration does not add created, updated, author, or revision-log fields to records, and FileGRC does not create a commit unless you explicitly request one.
