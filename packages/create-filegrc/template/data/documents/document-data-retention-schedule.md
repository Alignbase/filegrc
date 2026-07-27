# Data Retention Schedule

## Use

This schedule records how long {{company_name}} keeps important record classes and what happens when each period ends. The policy owner and data owners must complete the organization-specific rows before approval.

Retention periods may come from law, contract, tax, audit, security, or a documented business need. Use the longest applicable period, but do not keep data indefinitely without a reason.

## Schedule

| Record class | System or location | Owner | Trigger | Retention | End-of-period action | Authority or reason |
| --- | --- | --- | --- | --- | --- | --- |
| Security logs for important systems | Complete before approval | Complete before approval | Log event | At least 12 months | Delete through the approved system lifecycle | Information Security Policy |
| Important production backups | Complete before approval | Complete before approval | Backup creation | At least 30 days | Expire through the protected backup cycle | Information Security Policy |
| SOC 2 policies, control records, and audit evidence | Git repository and approved evidence locations | Policy owner | End of the relevant audit period | Complete before approval based on audit, contract, and legal needs | Archive or securely delete | Audit and business requirements |
| Customer and service records | Complete before approval | Complete before approval | Complete before approval | Complete before approval | Delete or anonymize | Contract, law, and business need |
| Workforce and contractor records | Approved people or payroll system | Complete before approval | End of employment or services | Complete before approval | Securely delete | Employment, tax, and legal requirements |
| Vendor and contract records | Complete before approval | Complete before approval | End of relationship or contract | Complete before approval | Securely delete | Contract, audit, and legal requirements |
| Incident and investigation records | Approved incident and evidence systems | Incident owner | Incident closure | Complete before approval | Archive or securely delete | Legal, insurance, contract, and security needs |

Add rows for each important data class in the system and vendor inventories. A row is incomplete until it names the source system, owner, trigger, period, disposal action, and authority.

## Holds and exceptions

An approved legal hold, investigation, or preservation duty suspends normal deletion for the affected records. Record the authority, scope, owner, start date, and release decision outside this public template.

Any retention exception needs a reason, owner, approval, compensating safeguards, and expiration or next review date.

## Review and disposal evidence

Review this schedule at least annually and within 30 days after a material change to systems, data use, vendors, contracts, or applicable duties. The approver must be separate from the owner.

For material disposal work, retain a record of the record class, source, date range, method, completion date, responsible person, exceptions, and verification.
