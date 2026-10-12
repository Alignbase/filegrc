# Upgrade to model v12

Model v12 requires management to review the complete Obligation schedule set before activating program content. It also requires independent Reporting Channel Set approval in Step 1 and checks channel usability and effective coverage at Step 3 cutover.

Commit the current v11 workspace first so existing activation history remains retrievable. Preview the migration, then apply the same target:

```sh
npx filegrc migrate --to-model 12 --preview --json
npx filegrc migrate --to-model 12 --yes --json
```

The migration changes only the Workspace model version. It preserves content, approvals, operating rules, historical occurrences, and prior Collection Reviews. It does not infer adoption or exclusion decisions. Existing operation remains recorded, while readiness exposes missing reviews. Older workspaces migrate one version at a time.

Applicability reviews for Requirements, Controls, Commitments, and Complementary Controls remain current when the reviewed scope facts still match model v11's decision semantics, including existing Git-backed compatibility checks. The version change alone does not require another applicability decision. Changed criteria, linked scope, statements, or requirement decisions still require review. Stored review revisions and reviewer dates remain unchanged. This compatibility does not satisfy the new Obligation schedule-set review.

For each Program, inspect its Controls, governing content, linked Obligations, and all active and proposed rules. Commit the reviewed source records, then scaffold the review:

```sh
npx filegrc review-collection obligation --program PROGRAM_ID --scaffold > schedules.json
npx filegrc review-collection obligation --program PROGRAM_ID schedules.json --preview --json
npx filegrc review-collection obligation --program PROGRAM_ID schedules.json --yes --json
```

Fill each `scheduleDecisions` entry with a rationale and one disposition:

- `adopted`: the active schedule and approved rule cover the work at cutover. Name the current rule-chain head as `ruleId` for rule-based schedules; the exact review also covers its approved predecessors at their effective intervals. Name `ruleId` and explicitly list unused pending rule proposals in `excludedRuleIds`.
- `replaced`: name adopted `replacementObligationIds` covering the same selected Controls and required event. The original must be proposed or retired.
- `retired`: the schedule is a retired duplicate with its recorded lifecycle reason.
- `inapplicable`: explain why the proposed or retired schedule does not apply to this Program.

The review needs an independent active Person, today's workspace-local date, and the exact displayed `expectedCollectionRevision`. It covers active rules as well as proposals. A changed schedule, rule, governing requirement, or selected scope requires another review before activation. Content activation itself does not reopen the schedule review.

Do not activate every starter proposal. Resolve the intended schedules and exclusions, finish Control oversight, then preview `activate-content` with the intended effective date. Reporting channels need a committed independent approval of the exact proposal and must be usable and effective when the governing requirement starts. Approval alone does not establish operational readiness.
