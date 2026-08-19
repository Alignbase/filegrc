# Data Retention Schedule

## Use

This schedule records how long {{company_name}} keeps important record classes and what happens when each period ends. The policy owner and data owners must complete the organization-specific rows before approval.

Retention periods may come from law, contract, tax, audit, security, or a documented business need. Use the longest applicable period, but do not keep data indefinitely without a reason.

## Schedule

| Record class | System or location | Owner | Trigger | Retention | End-of-period action | Authority or reason |
| --- | --- | --- | --- | --- | --- | --- |
| Security logs for important Systems | [Complete before approval: Systems or Components] | [Complete before approval: owner] | Log event | [Confirm or replace proposed default before approval: 12 months, adjusted for investigation, contract, legal, audit, and risk needs] | [Complete before approval: disposal action] | [Complete before approval: authority or reason] |
| Production backups or alternate recovery copies | [Complete before approval: Systems or Components] | [Complete before approval: owner] | Backup or recovery-copy creation | [Confirm or replace proposed default before approval: 30 days, adjusted to approved System recovery objectives] | [Complete before approval: expiration or disposal action] | [Complete before approval: continuity objective or risk decision] |
| SOC 2 Policies, Control records, and audit Evidence | Git repository and approved Evidence locations | Policy owner | End of the relevant audit period | [Complete before approval based on audit, contract, and legal needs] | Archive or securely delete | Audit and business requirements |
| Customer and service records | [Complete before approval: Systems or Components] | [Complete before approval: owner] | [Complete before approval: trigger] | [Complete before approval: retention] | Delete or anonymize | Contract, law, and business need |
| Incident and investigation records | Approved incident and Evidence Systems | Incident owner | Incident closure | [Complete before approval: retention] | Archive or securely delete | Legal, insurance, contract, and security needs |

Add rows for each important data class in the System and Vendor inventories. A row is incomplete until it names the source System or Component, owner, trigger, period, disposal action, and authority. FileGRC detects the bracketed prompts as approval blockers. Remove each prompt only after replacing it with a reviewed fact.

## Holds and exceptions

An approved legal hold, investigation, or preservation duty suspends normal deletion for the affected records. Record the authority, scope, owner, start date, and release decision outside this public template.

Any retention exception needs a reason, owner, approval, compensating safeguards, and expiration or next review date.

## Review and disposal evidence

Review this schedule at least annually and within 30 days after a material change to systems, data use, vendors, contracts, or applicable duties. The approver must be separate from the owner.

For material disposal work, retain a record of the record class, source, date range, method, completion date, responsible person, exceptions, and verification.
