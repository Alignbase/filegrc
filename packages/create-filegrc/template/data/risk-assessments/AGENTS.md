# Risk Assessment Instructions

Use a `risk-assessment` for the dated assessment process and one `risk` record for each threat or business impact that needs its own owner, rating, response, or follow-up.

## Workflow

1. Run `npx filegrc guide risk-assessment --json`.
2. List the current people, systems, vendors, commitments, risks, controls, findings, and evidence that define the scope.
3. Scaffold the assessment and keep it `planned` or `in-progress` while the work is underway.
4. Write the method, inputs reviewed, threats considered, observations, decisions, and conclusion in Record Markdown.
5. Create or update the individual `risk` records. Link all risks considered with `riskIds`, newly identified risks with `newRiskIds`, and materially changed risks with `changedRiskIds`.
6. Link evidence, findings, and follow-up action items. Do not hide an unresolved issue in the narrative.
7. Use a reviewer who is not one of the assessors. Set `methodology` and `approvedOn` before marking the assessment `complete`.
8. Run validation, review the full diff, and commit the assessment, risk changes, and evidence together when practical.

The assessment summary does not replace the Record Markdown or the linked risk register. A complete assessment must let a reviewer reconstruct the scope, method, inputs, conclusions, and resulting changes without guessing.
