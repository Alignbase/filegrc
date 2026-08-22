# Upgrading to model v8

Model v8 adds structured retention decisions and reviewed mappings for supplemental requirements. It also lets an organization define obligation completion types and event names without changing FileGRC's model registry.

Preview and apply the migration one version at a time:

```sh
npx filegrc migrate --to-model 8 --preview --json
npx filegrc migrate --to-model 8 --yes --json
```

The migration makes only lossless structural changes:

- Component `informationUses[].activities` becomes `processingOperations`.
- Commitment `sourceDocumentIds` becomes `sourceResourceIds` and keeps every existing Document ID.
- Source Coverage `retention` and Audit `retentionDecision` become `retentionNotes`.
- The Workspace selects model v8.

Narrative retention text does not become an approved Retention Schedule Item. The preview reports review work for active source-coverage records and Component information uses, because management must select the Information Types, scope, cutoff, period, disposition behavior, sources, and approval facts.

After migration, run:

```sh
npx filegrc program-readiness --json
npx filegrc review-collection information-type --scaffold
npx filegrc review-collection retention-schedule-item --scaffold
npx filegrc program-amendment SOURCE_RESOURCE_ID --json
```

Review near-duplicate Information Types before consolidating them. FileGRC reports candidates but does not merge records or rewrite their relationships. A source Policy, Document, Framework, Requirement, or Commitment change makes a linked retention review stale until its exact current source revision is reviewed again.

Starter-library upgrades may update recognized draft Markdown and its starter JSON relationships in one atomic proposal. They preserve organization-specific Retention Schedule Items and customized or adopted governed content.
