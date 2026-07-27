# Audit Population Instructions

Use one `audit-population` for one complete Type 2 population produced by one authoritative system and query. Split populations when different systems or queries generate the items.

Reconcile after the period closes:

1. Confirm the exact audit period and related controls.
2. Select the cataloged source system whose `evidenceSourceKinds` covers the population.
3. Export the complete population with fixed parameters and timezone.
4. Create verified `population-export` evidence with the same source system, period, query, generation time, count, completeness check, and accuracy check.
5. Link the export with `sourceEvidenceId`, name the reconciler, record the date and conclusion, and write the method and exceptions in Record Markdown.

A zero count still needs its query, fixed export, and reconciliation. A population linked to an in-scope control cannot be marked not applicable.
