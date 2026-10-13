# Upgrade to model v13

Model v13 adds concrete operating preparation checks before activation and before FileGRC recommends observation start. It introduces optional Program operating ownership facts, an explicit schedule preparation purpose, and source-method and external-test proof facts. Existing v12 workspaces remain supported with their v12 rules until management explicitly migrates.

Commit the current v12 workspace, inspect the preview, then apply it:

```sh
npx filegrc migrate --to-model 13 --preview --json
npx filegrc migrate --to-model 13 --yes --json
npx filegrc program-readiness --json
```

The migration changes only `Workspace.dataModelVersion`. It preserves IDs, Markdown, policies, approvals, schedules, candidate dates, activation dates, completed operating work and frozen occurrences. It does not fill ownership, claim a rehearsal happened, approve content or backdate evidence. The readiness output names missing facts, related records, tangible checks and CLI commands for each Program.

For a Program that already operates, keep running adopted work. Perform missing checks now and use actual collection and completion dates. Existing Control collection oversight remains historical proof; the upgrade alone does not require another launch review or content activation. Current readiness can show gaps until those facts are present. New or changed content cannot activate while current preparation remains incomplete.

## Prepare baseline and evidence collection

For each scoped source, use its actual query or export instructions to retrieve a safe example or a checked zero-result report. Confirm the collector can access the source, the query covers the intended Systems or Controls, and the owner can check filters, counts and failed collection. Record the actual retrieval result through the normal Evidence lifecycle and link it from Source Coverage. Keep a named method key on Source Coverage and its rehearsal when management uses that key to distinguish extraction methods.

Choose collection cadence before source or artifact expiry. Reuse the authoritative preservation row when its scope and source bindings still match. Change a row only when the proof, cutoff, period or disposition needs a different decision, then use the existing whole-schedule independent approval. Preserve necessary Control proof, such as settings, approvals, results, event metadata or scoped exports. Do not retain all logs or deleted customer content by default.

An adopted test-execution rule needs a real completed result for its actual population. An applicability or cadence review only decides whether and when a test is needed. Reuse operating results through their normal model-required actors, result, date, scope and review facts. Use a source report as Evidence when the fixed representation is the actual proof; an internally recorded result does not need an extra wrapper unless its model requires Evidence. For an external test report, name the activity in `artifactSubtype`, its actual `businessEventAt` and its reported `operatingResult`. A retrieval rehearsal does not count as executing that test.

Keep baseline preparation separate from recurring completion. A result completes an occurrence only when the normal occurrence reconciliation accepts its actual date, scope, result and population. Reconcile supported empty populations instead of creating fictional subjects or tests.

## Confirm operating ownership

Record `Program.operatingOwnership` using existing People, Appointments, Teams, source Components, program Documents and Evidence:

- Name who discovers real source changes and triggers the matching adopted event rules. Keep each task's queue owner on its existing Obligation.
- Name who checks due, overdue, blocked and failed-collection work, and record the actual queue-check cadence.
- Set the cadence for comparing source changes with recorded events and generated tasks. Document missing events, duplicates, late triggers and failed-query handling in the procedure.
- Link the existing program procedure that describes retrieval, matching triggers, reconciliation, queue checks and escalation conditions. Reuse its unchanged exact independent approval. New or changed text follows the existing Document approval workflow.
- Have the assigned people rehearse retrieval, compare a safe example or zero result with existing real events and task previews, open the queue and walk through an escalation condition. Do not create a fictional Policy Event. Link the dated rehearsal Evidence to the procedure, the relevant Obligation IDs and the discovery Components.

Manual operation is supported. This workflow adds no blanket handoff approval or universal independent Evidence verification. Existing Evidence collection/verification and operating-record review rules still apply. Changed governed content, schedules and preservation decisions retain their existing independent approval requirements.

This is a breaking model and workflow change. Before 1.0 it belongs in a minor release, with this explicit preview/apply migration. Package versions stay unchanged until release preparation.
