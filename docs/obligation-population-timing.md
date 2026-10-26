# Obligation populations and work coverage

A recurring review or test can inspect conditions on one date. Its yearly or monthly cadence does not by itself require proof covering every day in that period. Management must choose the criterion that matches the actual governing procedure.

FileGRC 0.21 adds optional model v13 fields. Adopt the 0.21 dependency line and deploy tested readers before saving them. Earlier runtimes reject that dependency line. Unchanged prior workspaces keep their original rules and population cutoffs; installing this release does not convert them or require a model migration.

For a snapshot, set the rule's `completionCoverage` to `point-in-time` and selector `cutoff` to `review-date`. Supply `--population-as-of YYYY-MM-DD` when recording or scaffolding reconciliation. Use the actual population observation date, which may differ from the completion or edit date. A new same-day snapshot binds committed source scope. Commit that occurrence on its observation date to retain contemporaneous proof; later historical recording uses the temporal Collection Review route. A past snapshot needs an immutable temporal Collection Review, or the supported correction below backed by retained occurrence rows. Do not infer historical populations from today's inventory.

For a whole-period duty, set `completionCoverage` to `whole-period`. The required range runs from the recurrence cycle's first day through the day before the next cycle, separately from the allowed execution window. Set an explicit allowed window that permits work after that period ends in every reachable calendar cycle, including leap years and longer months. FileGRC rejects a deadline on or before a required period end. Invalid open windows remain actionable Due or Overdue instead of Waiting. A reviewed successor may retire an invalid rule and supersede its open occurrence; the retained timing defects remain warnings and never establish completed work. Completion proof must state an explicit `coverage` range containing the entire required range, with actual execution after its full inclusive final day. A point result or early test cannot satisfy it. Selector `coverage-end` keeps the population open through that required period's inclusive end. Existing window-start and window-end cutoffs retain their inclusive behavior.

When every current member has valid proof or a reviewed disposition but the population or required period remains open, Work Queue shows Waiting with its original deadline and cutoff or period end. Even zero or non-applicable populations wait until a whole-period duty ends. New eligible or unresolved members restore actionable work. Waiting suppresses due reminders, while period and audit completeness still require final population reconciliation. The day after a fixed cutoff, reconcile the final population; FileGRC does not silently close it. For a legacy window-end cutoff, that first final reconciliation day is also the first overdue day. Timely member proof remains timely, but the occurrence stays Overdue until its required reconciliation is recorded. FileGRC adds no implicit documentation grace or period coverage.

## Correct an inappropriate open snapshot rule

Use this route only when the actual duty was a point review or test. It does not remove an explicit whole-period duty, postpone a deadline, expand proof scope, or approve independent schedule oversight.

```sh
npx filegrc correct-obligation-rule RULE_ID --scaffold --json > correction.json
```

Fill the successor title and rationale, actual current `approvedByIds`, `approvedOn` and `effectiveAt`, and both confirmations. In `corrections`, select supported open occurrences and their actual `populationAsOf` dates. Keep `sourceRevision` and `expectedRevisions` unchanged. The successor preserves frequency, anchor, allowed window and selector filters. Its source occurrence and all prior approvals remain auditable. The correction retains passed, failed, exception and non-applicable rows, plus proof links. Known eligible additions enter as pending work.

```sh
npx filegrc correct-obligation-rule RULE_ID correction.json --preview --json > preview.json
```

Review every resulting date, member disposition, proof link and new pending member. Copy the preview's `revision` into the payload's `confirmedRevision`, then apply the unchanged payload:

```sh
npx filegrc correct-obligation-rule RULE_ID correction.json --yes --json
npx filegrc reconcile-obligation OBLIGATION_ID --scaffold --window-start ORIGINAL_START --json > occurrence.json
```

Review and fill the normal reconciliation conclusion, reviewers and actual reconciliation time. Save that mutation through `reconcile-obligation`, validate, and inspect the Git diff before committing. Keep original operating records byte-for-byte unchanged when their work facts remain accurate. A limited recovery test continues to prove only the recovery scope it actually tested.
