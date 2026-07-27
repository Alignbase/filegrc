# GRC Data Model

<!-- Generated from packages/filegrc/model/v1.json. Do not edit by hand. -->

Model version: `1`

Stable, query-worthy GRC metadata. Long-form work is stored as implicit Markdown companion files beside each structured JSON record.

Each structured resource is one UTF-8 JSON file. Long-form work is an implicit Markdown companion beside that JSON file. Git supplies file authors, timestamps, diffs, commit messages, and revisions, so records do not duplicate those fields or file paths.

## Common fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | integer | Yes | Schema version |
| `id` | string (id) | Yes | ID |
| `type` | string | Yes | Type |
| `title` | string | Yes | Title |
| `ownerIds` | array of id | No | Owners References: `person`, `team` |
| `tags` | array of string | No | Tags |
| `relatedResourceIds` | array of id | No | Related resources References: `*` |
| `extensions` | object | No | Extensions |

## Record Markdown

Resources with no dedicated Markdown use an optional companion with the same basename as the JSON record. The renderer creates and discovers this file from the stable record location, so no path is stored in the record.

Record Markdown is shown by default for: `system`, `control-test`, `finding`, `exception`, `policy-review`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`. Other resources without dedicated Markdown can add it when structured fields are not enough.

## Program and audit readiness defaults

Program Readiness checks management scope, policy adoption, control implementation, authoritative source configuration, and verified test captures without requiring an audit record. Audit Readiness starts after a CPA firm is engaged and uses the defaults below to prepare Type 1 and Type 2 fieldwork.

Management documents:

- **System Description** (`soc2-system-description`): Complete before the auditor finalizes the description of the system.
- **Management Assertion** (`soc2-management-assertion`): Agree on final wording with the auditor and approve it for the reporting date or period.
- **Period Completeness Statement** (`soc2-period-completeness`): Complete after reconciling every audit population, including populations with zero items.
- **Management Representation Letter** (`soc2-management-representation`): Reconcile and sign the auditor-provided letter near the end of fieldwork.

Standard populations, including zero-event populations:

- **Workforce Starts, Role Changes, and Departures** (`workforce-changes`): source role `workforce`; start with HR or workforce system. Export after the period closes and before the auditor selects samples.
- **Access Grants, Changes, Reviews, and Removals** (`access-changes`): source role `identity-access`; start with Identity provider and application access sources. Export after the period closes and before access samples are selected. Split this population when different systems require different queries.
- **Production and Infrastructure Changes** (`production-changes`): source role `production-change`; start with Source control, deployment, and infrastructure change sources. Export after the period closes and before change samples are selected. Split software and infrastructure populations when their source reports differ.
- **Security Events and Incidents** (`security-incidents`): source role `security-monitoring`; start with Incident and security monitoring sources. Export after the period closes, including a source report that proves a zero count when management identified no incidents.
- **Vulnerabilities and Security Scans** (`vulnerability-activity`): source role `vulnerability-management`; start with Vulnerability, dependency, and scanning tools. Export after the period closes and preserve scan coverage, findings, remediation, and exceptions.
- **Vendors and Vendor Changes** (`vendor-changes`): source role `vendor-management`; start with Vendor inventory, contract, and purchasing sources. Export after the period closes and reconcile additions, removals, material changes, and required reviews.
- **Devices and Other Important Assets** (`managed-assets`): source role `endpoint-asset`; start with Device management and asset inventory sources. Export after the period closes and reconcile assigned, active, lost, returned, and retired assets.
- **Training and Policy Acknowledgements** (`training-acknowledgements`): source role `training-acknowledgement`; start with Training, signature, and workforce sources. Export after the period closes and reconcile assignments, completions, acknowledgements, exceptions, and overdue work to the workforce population.
- **Backup Failures and Restoration Tests** (`backup-recovery`): source role `backup-recovery`; start with Backup, recovery, and monitoring sources. Export after the period closes and include scheduled jobs, failures, restorations, exercises, and follow-up work.
- **Security Exceptions and Control Findings** (`exceptions-findings`): source role `exception-finding`; start with Exception, finding, ticketing, and risk sources. Export after the period closes and reconcile open, closed, accepted, overdue, and remediated items.

Authoritative systems of record:

- **Workforce** (`workforce`): Catalog the HR or workforce system that is authoritative for starts, role changes, and departures. Bring the complete workforce-change population and source reports used to reconcile access and responsibilities. Identify the source during scoping. Preserve event records as changes occur and export the complete Type 2 population after the period closes.
- **Training and Acknowledgements** (`training-acknowledgement`): Catalog training, signature, and acknowledgement systems. Bring assignments, content revisions, completion records, signatures, exceptions, and overdue follow-up. Identify sources before assignments begin. Preserve signatures and completion proof as work occurs, then reconcile the complete Type 2 population to the workforce population after close.
- **Identity and Access** (`identity-access`): Catalog the identity provider and each important application that enforces access. Bring identity, role, privileged-access, authentication-setting, review, and removal exports. Identify sources during scoping. Capture configuration near the Type 1 date or at the start and end of a Type 2 period; export complete change and review populations after the Type 2 period closes.
- **Production and Change** (`production-change`): Catalog source control, deployment, and infrastructure-change systems. Bring protection settings, reviews, test and approval records, deployments, emergency changes, and rollback evidence. Identify sources before the audit period. Preserve per-change evidence as changes occur and export the complete period population after a Type 2 period closes.
- **Monitoring and Incidents** (`security-monitoring`): Catalog logging, alerting, incident, and case-management systems. Bring configuration, coverage, alert delivery tests, alerts, investigations, incidents, recovery work, and zero-event proof. Capture configuration and coverage at the Type 1 date or across the Type 2 period. Preserve cases as they occur and export complete alert and incident populations after close.
- **Vulnerability Management** (`vulnerability-management`): Catalog vulnerability, dependency, scanning, penetration-test, and remediation systems. Bring scope and configuration, scan results, findings, tickets, exceptions, retests, and independent reports. Confirm coverage before the audit period. Preserve scan and remediation evidence when generated and export the complete Type 2 population after close.
- **Endpoints and Assets** (`endpoint-asset`): Catalog device-management, endpoint-compliance, and asset-inventory systems. Bring the complete device population, assignments, security configuration, compliance status, exceptions, loss, return, and disposal records. Identify sources before devices receive access. Capture configuration near the Type 1 date or across the Type 2 period and export the complete Type 2 population after close.
- **Backup and Recovery** (`backup-recovery`): Catalog backup, recovery, and continuity systems. Bring configuration, scheduled-job history, failures, restoration results, exercises, and follow-up work. Capture configuration at the Type 1 date or across the Type 2 period. Preserve restoration and exercise results when performed and export complete job and failure history after period close.
- **Vendors** (`vendor-management`): Catalog procurement, contract, and vendor-risk systems. Bring the vendor population, contracts, reviews, assurance reports, bridge coverage, incidents, and follow-up. Identify relevant subservice organizations during scoping. Obtain current assurance reports before fieldwork and bridge coverage through the report period when a report ends earlier.
- **Exceptions and Findings** (`exception-finding`): Catalog the repository or ticket system authoritative for control exceptions, findings, risk acceptance, remediation, verification, and overdue work. Record items as they arise. Reconcile open and closed records to their source throughout fieldwork and export the complete Type 2 population after the period closes.

## Resource groups

### Program

#### `framework`

External criteria sets and versions used to define program and audit scope.

Policy basis: Frameworks come from the selected audit criteria, not an internal policy. The starter includes SOC 2 Security and system-description references without licensed criteria text.

Timing: Add or retire a version only through a deliberate scope decision. Reconfirm the selected version when planning each audit.

The UI labels the common `title` field as **Name**.

Path: `data/frameworks/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `retired` |
| `version` | string | Yes |  |
| `publisher` | string | No |  |
| `description` | string | No |  |
| `sourceReference` | object | No |  |
| `effectiveOn` | date | No |  |
| `retiredOn` | date | No |  |

#### `requirement`

Individual criterion references used to document applicability and map controls, commitments, audits, and findings.

Policy basis: Requirements come from the selected framework. Controls explain how policy and actual operation address each applicable criterion. Starter descriptions are plain-language orientation only; use the publisher's official criteria for the examination.

Timing: Review applicability during audit planning and after material scope, service, system, or framework changes.

Path: `data/requirements/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `frameworkId` | id | Yes | References: `framework` |
| `reference` | string | Yes |  |
| `applicability` | enum | Yes | Values: `applicable`, `not-applicable`, `undetermined` |
| `description` | string | No |  |
| `parentRequirementId` | id | No | References: `requirement` |
| `applicabilityRationale` | string | No |  |
| `controlIds` | array of id | No | References: `control` |

#### `commitment`

Customer-facing commitments, internal system requirements, and business objectives that controls and the system description must support.

Policy basis: Policies define baseline safeguards; contracts, service descriptions, and approved business decisions supply the specific commitment.

Timing: Create before relying on a promise, review during audit scoping, and supersede it when the service or agreement changes.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/commitments/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `superseded`, `retired` |
| `commitmentKind` | enum | Yes | Values: `service`, `system-requirement`, `business-objective` |
| `statement` | string | Yes |  |
| `systemIds` | array of id | No | References: `system` |
| `sourceDocumentIds` | array of id | No | References: `document` |
| `requirementIds` | array of id | No | References: `requirement` |
| `controlIds` | array of id | No | References: `control` |
| `customerFacing` | boolean | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active` |
| `supersedesId` | id | No | References: `commitment` |

#### `complementary-control`

Controls expected from customers or subservice organizations and needed for the service organization's controls and commitments to work as described. A complementary-control record is not required for SOC 2 when no such dependency applies.

Policy basis: The system description and vendor model define these dependencies. Internal policies still require owners to identify, communicate, and monitor them.

Timing: Review for every audit and after material customer-responsibility, vendor, contract, integration, or service changes.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/complementary-controls/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `superseded`, `retired` |
| `responsibleParty` | enum | Yes | Values: `user-entity`, `subservice-organization` |
| `statement` | string | Yes |  |
| `systemIds` | array of id | Yes | References: `system` |
| `vendorId` | id | No | References: `vendor` |
| `requirementIds` | array of id | No | References: `requirement` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `relatedControlIds` | array of id | No | References: `control` |
| `sourceDocumentIds` | array of id | No | References: `document` |
| `effectiveOn` | date | No |  |

#### `control`

Turn each applicable policy and criterion into a control people can run and prove. Before marking it implemented, assign an owner and record its actual procedure, system scope, cadence, authoritative evidence source, linked policies and criteria, and implementation date.

Policy basis: Controls implement the linked policies and map that operation to applicable criteria. A policy statement alone does not prove implementation.

Timing: Before marking a control implemented, record its owner, actual procedure in Record Markdown, system scope, cadence, authoritative evidence sources, and implementation date. Then operate it at the stated frequency.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/controls/<id>.json`

Markdown companions:

- **Procedure**: `.md` beside the JSON record (required when `status` is `implemented`).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `implemented`, `partially-implemented`, `not-applicable`, `retired` |
| `statement` | string | Yes |  |
| `requirementIds` | array of id | Yes | References: `requirement` |
| `code` | string | No |  |
| `activity` | string | Yes |  |
| `controlType` | enum | No | Values: `preventive`, `detective`, `corrective` |
| `operationMode` | enum | Yes | Values: `manual`, `automated`, `hybrid` |
| `frequency` | string | Yes |  |
| `systemIds` | array of id | Conditional | References: `system` Required when `status` is `implemented` |
| `evidenceSourceIds` | array of id | Conditional | Authoritative evidence sources References: `system` Required when `status` is `implemented` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `policyIds` | array of id | No | References: `policy` |
| `riskIds` | array of id | No | References: `risk` |
| `effectiveOn` | date | Conditional | Required when `status` is `implemented` |
| `retiredOn` | date | No |  |

#### `control-test`

Management, internal-audit, or service-auditor tests of one control's design or operation for an as-of date or period. Management-run control-test records are not required for SOC 2; the auditor performs independent testing, while these records support readiness and internal assurance.

Policy basis: The information security policy requires control monitoring and audit evidence. Tests link procedures, samples, evidence, exceptions, findings, and review.

Timing: Plan from control frequency, risk, and audit scope. Record the exact period or as-of date, link the complete population and sampled items when sampling applies, and complete review before relying on the result.

Default sources: `policy-information-security`

Path: `data/control-tests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `not-performed`, `canceled` |
| `controlId` | id | Yes | References: `control` |
| `testKinds` | array of string | Yes |  |
| `performedBy` | enum | Yes | Values: `management`, `internal-audit`, `service-auditor` |
| `asOfDate` | date | No |  |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete` |
| `auditId` | id | No | References: `audit` |
| `testerIds` | array of id | No | References: `person` |
| `externalTester` | object | No |  |
| `sampleSize` | integer | No | Minimum: `0`. |
| `populationId` | id | No | References: `audit-population` |
| `sampleEvidenceIds` | array of id | No | References: `evidence` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `exceptionCount` | integer | No | Minimum: `0`. |
| `findingIds` | array of id | No | References: `finding` |
| `reviewerIds` | array of id | No | References: `person` |
| `reviewedOn` | date | No |  |
| `completedOn` | date | No |  |
| `sourceCommit` | string | No |  |
| `notPerformedReason` | string | Conditional | Required when `status` is `not-performed` |

### Governance

#### `team`

Committees, response teams, and accountable groups used for shared ownership, governance decisions, and meeting records. A separate team register is not required for SOC 2; named people can hold these responsibilities directly.

Policy basis: The information security policy establishes a security and risk oversight group chaired by a reviewer who is separate from the policy owner. The reviewer may be internal or external. The continuity plan assigns response and recovery roles.

Timing: The security and risk oversight group meets at least quarterly. Update membership after responsibility or personnel changes, and preserve a chair who is separate from the policy owner.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

The UI labels the common `title` field as **Name**.

Path: `data/teams/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `inactive` |
| `purpose` | string | Yes |  |
| `memberIds` | array of id | Yes | References: `person` |
| `chairIds` | array of id | No | References: `person` |
| `charterDocumentId` | id | No | References: `document` |
| `meetingCadence` | object | No |  |

#### `document`

Governed charters, plans, procedures, standards, agreements, reports, and templates whose Markdown and approvals belong in Git. A general document catalog is not required for SOC 2; use it for governed material that is not a policy or another record type.

Policy basis: Policies use documents for detailed procedures, plans, acknowledgements, assertions, and reports while Git supplies revision history.

Timing: Follow each record's review cadence. Starter governed documents are reviewed at least annually and after material changes or use, with an approver who is separate from the owner.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/documents/<id>.json`

Markdown companions:

- **Document**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `active`, `superseded`, `retired` |
| `documentKind` | string | Yes |  |
| `template` | boolean | No |  |
| `approverIds` | array of id | No | References: `person`, `team` Must not overlap `ownerIds`. |
| `version` | string | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active` |
| `approvedOn` | date | Conditional | Required when `status` is `active` |
| `reviewCadence` | object | No |  |
| `supersedesId` | id | No | References: `document` |
| `systemIds` | array of id | No | References: `system` |
| `controlIds` | array of id | No | References: `control` |
| `classification` | string | No |  |
| `relatedDocumentIds` | array of id | No | References: `document` |
| `audience` | array of string | No |  |
| `acknowledgementRequired` | boolean | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `policy`

Review and tailor every applicable policy, clear organization-specific placeholders, link its controls, and record approval and an effective date. The reviewer must be separate from the policy owner, but may be another person in the organization or an external reviewer.

Policy basis: Policies set the program's required behavior. Control, obligation, training, document, and attestation records make those requirements operational and auditable.

Timing: Move a draft through review and approval, set the effective date, link its controls, and clear organization-specific placeholders before activation. The approver is usually internal and may be external, but must be separate from the owner and from the CPA auditor role. Review at least annually and after material changes.

Default sources: `policy-information-security`

Path: `data/policies/<id>.json`

Markdown companions:

- **Policy**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `in-review`, `approved`, `active`, `superseded`, `retired` |
| `approverIds` | array of id | Yes | References: `person`, `team` Must not overlap `ownerIds`. |
| `policyNumber` | string | No |  |
| `policyKind` | string | No |  |
| `version` | string | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active` |
| `approvedOn` | date | Conditional | Required when `status` is `active` |
| `reviewCadence` | object | No |  |
| `nextReviewConstraint` | object | No |  |
| `supersedesId` | id | No | References: `policy` |
| `parentPolicyId` | id | No | References: `policy` |
| `relatedPolicyIds` | array of id | No | References: `policy` |
| `relatedDocumentIds` | array of id | No | References: `document` |
| `controlIds` | array of id | No | References: `control` |
| `requirementIds` | array of id | No | References: `requirement` |
| `audience` | array of string | No |  |
| `acknowledgementRequired` | boolean | No |  |

#### `policy-review`

Evidence that named reviewers checked governed policies or documents, recorded the result, approved changes, and assigned follow-up work.

Policy basis: Each starter policy and the continuity plan requires review at least annually and after specified material changes.

Timing: Complete annually and after a triggering change, incident, disruption, or policy condition. Link the exact scope, reviewers, result, and evidence.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/policy-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `scopeResourceIds` | array of id | Yes | References: `policy`, `document` |
| `reviewerIds` | array of id | Yes | References: `person` |
| `reviewedOn` | date | Yes |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete` |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
| `changesRequired` | boolean | No |  |
| `changeSummary` | string | No |  |
| `approverIds` | array of id | No | References: `person`, `team` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |

#### `attestation`

Per-person proof of policy acknowledgement, training completion, certification, or assigned work, tied to exact content revisions and signed evidence when needed.

Policy basis: The information security, data handling, workforce, and training materials require workers to review assigned content and acknowledge applicable responsibilities.

Timing: Assign during onboarding, within 30 days for security training, annually for recurring training, and after material content changes that require acknowledgement.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `policy-employee-handbook`

Path: `data/attestations/<id>.json`

Markdown companions:

- **Statement**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `pending`, `completed`, `waived`, `overdue` |
| `subjectResourceIds` | array of id | Yes | References: `policy`, `document`, `training`, `action-item` |
| `personId` | id | Yes | References: `person` |
| `attestationKind` | string | Yes |  |
| `assignedOn` | date | No |  |
| `dueOn` | date | No |  |
| `completedOn` | date | No |  |
| `attestationMethod` | enum | No | Values: `git-approval`, `signed-document`, `external-record` |
| `contentRevisions` | object | No |  |
| `attestedCommit` | string | No |  |
| `expiresOn` | date | No |  |
| `waivedByIds` | array of id | No | References: `person` |
| `waiverReason` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `meeting`

Governance meeting records with schedule, chair, attendees, agenda, minutes, decisions, risks, findings, evidence, and assigned actions.

Policy basis: The information security policy requires formal security and risk oversight minutes. The continuity plan requires oversight review of exercises and unresolved risks.

Timing: Hold security and risk oversight meetings at least quarterly. Create one immutable meeting record and Markdown minutes for each occurrence.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/meetings/<id>.json`

Markdown companions:

- **Agenda**: `-agenda.md` beside the JSON record (optional).
- **Minutes**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `complete`, `canceled` |
| `teamId` | id | Yes | References: `team` |
| `scheduledOn` | date | Yes |  |
| `chairIds` | array of id | Yes | References: `person` |
| `startedAt` | timestamp | No |  |
| `endedAt` | timestamp | No |  |
| `attendeeIds` | array of id | No | References: `person` |
| `externalAttendees` | array of object | No |  |
| `decisionSummary` | string | No |  |
| `riskIds` | array of id | No | References: `risk` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `training`

Reusable Markdown training with audience, assignment trigger, recurrence, completion window, linked policies and controls, and passing criteria.

Policy basis: The information security and data handling policies require security training, acknowledgements, and added role-based training where responsibilities or data warrant it.

Timing: Assign security training at onboarding, complete it within 30 days, repeat at least annually, and reassign after relevant material changes or incidents.

Default sources: `policy-information-security`, `policy-data-protection-handling`

The UI labels the common `title` field as **Name**.

Path: `data/training/<id>.json`

Markdown companions:

- **Training**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `active`, `retired` |
| `audience` | array of string | No |  |
| `assignmentTrigger` | string | No |  |
| `recurrence` | object | No |  |
| `completionWindowDays` | integer | No |  |
| `policyIds` | array of id | No | References: `policy` |
| `controlIds` | array of id | No | References: `control` |
| `passingCriteria` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `data-request`

Privacy, contractual, or other requests concerning data, tracked by opaque reference with scope, jurisdiction, due date, decision, evidence, and completion. Data-request tracking is not required for a SOC 2 Security-only report; use it when privacy criteria, law, or contracts make the workflow relevant.

Policy basis: The data handling policy requires requests to reach the responsible owner and keeps erasable personal data out of immutable Git history.

Timing: Create on receipt, set the deadline from applicable law or contract, verify identity outside this repository when needed, and record completion.

Default sources: `policy-data-protection-handling`

Path: `data/data-requests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `received`, `verifying`, `in-progress`, `completed`, `denied`, `canceled` |
| `requestKind` | string | Yes |  |
| `receivedOn` | date | Yes |  |
| `requesterReference` | string | Yes |  |
| `jurisdiction` | string | No |  |
| `dueOn` | date | No |  |
| `verifiedOn` | date | No |  |
| `scope` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `decision` | string | No |  |
| `decisionRationale` | string | No |  |
| `completedOn` | date | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `actionItemIds` | array of id | No | References: `action-item` |

### Risk

#### `exception`

Approved, time-bound departures from a policy or control, with scope, rationale, risk, compensating controls, owner, approval, and expiry. An exception record is not required for SOC 2 unless the organization approves a departure.

Policy basis: The information security and data handling policies require a business reason, risk assessment, compensating controls, suitable approval, and an expiration or review date.

Timing: Approve before the departure begins, review through its stated cadence or expiry, and close or renew it through a new risk decision.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/exceptions/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `requested`, `approved`, `expired`, `revoked`, `closed` |
| `scopeResourceIds` | array of id | Yes | References: `*` |
| `requestorIds` | array of id | Yes | References: `person` |
| `rationale` | string | Yes |  |
| `riskIds` | array of id | No | References: `risk` |
| `requestedOn` | date | No |  |
| `approvedByIds` | array of id | No | References: `person`, `team` |
| `approvedOn` | date | No |  |
| `expiresOn` | date | No |  |
| `reviewCadence` | object | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `closedOn` | date | No |  |

#### `risk`

Identified threats and business impacts with ownership, inherent and residual ratings, response, acceptance, affected scope, controls, and follow-up work.

Policy basis: The information security and data handling policies require risk identification, treatment, ownership, approval, target dates, and time-bound acceptance.

Timing: Assess the register at least annually and after material changes. Review High and Critical risks at least quarterly and accepted risks by their review date.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/risks/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `open`, `monitoring`, `accepted`, `closed`, `archived` |
| `description` | string | Yes |  |
| `categories` | array of string | Yes |  |
| `response` | enum | Yes | Values: `avoid`, `mitigate`, `transfer`, `accept`, `monitor` |
| `inherentRating` | object | Yes |  |
| `residualRating` | object | No |  |
| `acceptanceRationale` | string | No |  |
| `acceptedByIds` | array of id | No | References: `person`, `team` |
| `acceptedOn` | date | No |  |
| `acceptanceExpiresOn` | date | No |  |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `controlIds` | array of id | No | References: `control` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `requirementIds` | array of id | No | References: `requirement` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `reviewCadence` | object | No |  |

#### `risk-assessment`

Point-in-time assessment records for a defined scope, methodology, participants, systems, vendors, risks, conclusions, evidence, and approval.

Policy basis: The information security and data handling policies require assessment of threats, assets, obligations, controls, likelihood, impact, treatment, and material changes.

Timing: Complete at least annually and after a material change that could alter risk. Record new and changed risks instead of hiding them in the summary.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/risk-assessments/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `assessmentDate` | date | Yes |  |
| `assessmentKind` | enum | Yes | Values: `enterprise-risk`, `system-risk`, `privacy-impact`, `vendor-risk`, `business-impact` |
| `scope` | string | Yes |  |
| `assessorIds` | array of id | Yes | References: `person` |
| `reviewerIds` | array of id | Yes | References: `person` Must not overlap `assessorIds`. |
| `methodology` | string | Conditional | Required when `status` is `complete` |
| `trigger` | string | No |  |
| `attendeeIds` | array of id | No | References: `person` |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `riskIds` | array of id | No | References: `risk` |
| `newRiskIds` | array of id | No | References: `risk` |
| `changedRiskIds` | array of id | No | References: `risk` |
| `summary` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `approvedOn` | date | Conditional | Required when `status` is `complete` |
| `sourceCommit` | string | No |  |

### People and Access

#### `person`

Minimal workforce records used for ownership, approval, training, access, attendance, and accountability without turning Git into an HR system.

Policy basis: The information security policy and employee handbook require named responsibility, onboarding, training, role changes, performance review, and offboarding.

Timing: Create before assigning work or access, update after role changes, and mark inactive at departure. Training is due within 30 days of starting and annually.

Default sources: `policy-information-security`, `policy-employee-handbook`

The UI labels the common `title` field as **Name**.

Path: `data/people/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `inactive`, `external` |
| `email` | string (email) | No |  |
| `role` | string | No |  |
| `department` | string | No |  |
| `managerId` | id | No | References: `person` |
| `startDate` | date | No |  |
| `endDate` | date | No |  |
| `employmentType` | string | No |  |
| `teamIds` | array of id | No | References: `team` |

#### `service-account`

Non-human identities used by automation or applications, with purpose, ownership, system scope, authentication, privilege, and expiry. A separate service-account register is not required for SOC 2; use this page when non-human identities need their own inventory.

Policy basis: The information security policy requires important identities to be inventoried, owned, protected, reviewed, and removed when unneeded.

Timing: Create before use. Review privileged and production access quarterly and other important access annually; retire or expire unused accounts.

Default sources: `policy-information-security`

The UI labels the common `title` field as **Name**.

Path: `data/service-accounts/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `disabled`, `retired` |
| `purpose` | string | Yes |  |
| `systemIds` | array of id | Yes | References: `system` |
| `accountIdentifier` | string | No |  |
| `authenticationMethod` | string | No |  |
| `privileged` | boolean | No |  |
| `expiresOn` | date | No |  |
| `lastReviewedOn` | date | No |  |

#### `access-grant`

One person's or service account's access to one system, including business role, privilege, request, approval, provisioning, expiry, removal, ticket, and evidence.

Policy basis: The information security and data handling policies require unique identity, business need, least privilege, approval, authorized provisioning, and prompt removal.

Timing: Record every grant and material change. Remove access at or before notice for involuntary or high-risk departures and within 24 hours for other departures.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/access-grants/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `requested`, `approved`, `active`, `revoked`, `expired` |
| `subjectKind` | enum | Yes | Values: `person`, `service-account` |
| `subjectId` | id | Yes | References: `person`, `service-account` |
| `systemId` | id | Yes | References: `system` |
| `accessLevel` | string | Yes |  |
| `privileged` | boolean | Yes |  |
| `role` | string | No |  |
| `requestedOn` | date | No |  |
| `approvedByIds` | array of id | No | References: `person` |
| `approvedOn` | date | No |  |
| `provisionedByIds` | array of id | No | References: `person` |
| `provisionedOn` | date | No |  |
| `expiresOn` | date | No |  |
| `deprovisionedByIds` | array of id | No | References: `person` |
| `deprovisionedOn` | date | No |  |
| `deprovisionReason` | string | No |  |
| `ticketReference` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `access-review`

Point-in-time review of a defined access population, with systems, reviewers, period, grant decisions, exceptions, approval, evidence, and source revision.

Policy basis: The information security and data handling policies require owners to confirm least privilege and remove dormant, expired, excessive, or unneeded access.

Timing: Review privileged and production access at least quarterly and other important-system access at least annually.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/access-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `reviewDate` | date | Yes |  |
| `reviewerIds` | array of id | Yes | References: `person` |
| `systemIds` | array of id | Yes | References: `system` |
| `scope` | string | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete` |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
| `grantDecisions` | array of object | No |  |
| `populationCount` | integer | No | Minimum: `0`. |
| `exceptionCount` | integer | No | Minimum: `0`. |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `approvedByIds` | array of id | No | References: `person` |
| `approvedOn` | date | No |  |
| `sourceCommit` | string | No |  |

### Systems and Vendors

#### `system`

Start with the service boundary and every application, service, or platform that supports it. A third-party application is still a System because it operates controls or produces evidence; link it to the provider's separate Vendor record with vendorId. Mark in-scope systems, assign owners, record data and dependencies, and document how to obtain evidence.

Policy basis: The information security, data handling, and continuity policies require inventories of important systems with owners, criticality, classification, scope, and recovery needs.

Timing: Complete the in-scope inventory before policy approval and control implementation. Review it at least annually and after material architecture, data, vendor, service, recovery, or evidence-source changes. Test report access and extraction before the candidate period begins.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `document-business-continuity-disaster-recovery`

The UI labels the common `title` field as **Name**.

Path: `data/systems/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `deprecated`, `retired` |
| `criticality` | enum | Yes | Values: `low`, `medium`, `high`, `critical` |
| `description` | string | No |  |
| `systemKind` | string | No |  |
| `environment` | string | No |  |
| `vendorId` | id | No | References: `vendor` |
| `dataClassification` | string | No |  |
| `dataTypes` | array of string | No |  |
| `internetExposed` | boolean | No |  |
| `inScope` | boolean | No |  |
| `parentSystemId` | id | No | References: `system` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `subserviceVendorIds` | array of id | No | References: `vendor` |
| `evidenceSourceKinds` | array of string | No | Evidence source roles |
| `evidenceOwnerIds` | array of id | No | Evidence access owners References: `person`, `team` |
| `continuityObjectives` | object | No |  |

#### `asset`

Maintain important devices, media, software, records, and other physical or logical items during program operation. Assign an owner and custodian, record criticality and lifecycle, and keep the inventory current. Assets support controls but are not part of defining the service boundary.

Policy basis: The information security, mobile computing, and data handling policies require important assets to be inventoried, protected according to classification, and securely returned or disposed.

Timing: Record acquisition and assignment, review the inventory annually, update custody on change, and retire assets when use ends.

Default sources: `policy-information-security`, `policy-mobile-computing-communications`, `policy-data-protection-handling`

The UI labels the common `title` field as **Name**.

Path: `data/assets/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `lost`, `retired`, `disposed` |
| `assetKind` | string | Yes |  |
| `criticality` | enum | Yes | Values: `low`, `medium`, `high`, `critical` |
| `custodianIds` | array of id | Yes | References: `person`, `team` |
| `businessPurpose` | string | No |  |
| `serialOrAssetTag` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `location` | string | No |  |
| `dataClassification` | string | No |  |
| `exceptionIds` | array of id | No | References: `exception` |
| `acquiredOn` | date | No |  |
| `retiredOn` | date | No |  |

#### `vendor`

Use Vendors for supplier relationships, contracts, due diligence, subprocessors, continuity, and supplier risk. A vendor-provided application should also have a System record linked through vendorId because controls and evidence attach to the application, while reviews and contracts attach to the provider.

Policy basis: The information security and data handling policies require vendor inventory, risk-based review before access, suitable contract terms, and monitoring of important providers.

Timing: Create before access or reliance. Review Critical and High-risk vendors at least annually and after material service changes or incidents.

Default sources: `policy-information-security`, `policy-data-protection-handling`

The UI labels the common `title` field as **Name**.

Path: `data/vendors/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `evaluating`, `active`, `deprecated`, `terminated` |
| `category` | string | Yes |  |
| `criticality` | enum | Yes | Values: `low`, `medium`, `high`, `critical` |
| `description` | string | No |  |
| `service` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `dataClassification` | string | No |  |
| `dataTypes` | array of string | No |  |
| `subprocessor` | boolean | No |  |
| `standardAgreement` | boolean | No |  |
| `agreementDocumentId` | id | No | References: `document` |
| `backupVendorId` | id | No | References: `vendor` |
| `startDate` | date | No |  |
| `endDate` | date | No |  |
| `reviewCadence` | object | No |  |

#### `vendor-review`

Pre-access due diligence and periodic vendor reviews covering service, data, access, assurance, recovery, incidents, contracts, risks, evidence, and follow-up.

Policy basis: The information security and data handling policies require review before a vendor handles sensitive data and periodic review of Critical and High-risk providers.

Timing: Complete before access, at least annually for Critical and High-risk vendors, and after material service changes or incidents.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/vendor-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `approved`, `conditional`, `rejected`, `complete` |
| `vendorIds` | array of id | Yes | References: `vendor` |
| `reviewerIds` | array of id | Yes | References: `person` |
| `reviewedOn` | date | Yes |  |
| `outcome` | outcome | No |  |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
| `scope` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `riskIds` | array of id | No | References: `risk` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `nextReviewConstraint` | object | No |  |

### Security Operations

#### `vulnerability`

Confirmed weaknesses with severity, affected systems, source, dates, external IDs, owner, due date, risk treatment, evidence, and remediation verification. A separate FileGRC vulnerability register is not required for SOC 2 when a scanner or ticket system remains the source of truth and retains usable audit evidence.

Policy basis: The information security policy requires owned, risk-based remediation or a documented exception with compensating controls and approval.

Timing: Remediate Critical, High, Medium, and Low vulnerabilities within 7, 14, 30, and 30 days unless an approved exception applies.

Default sources: `policy-information-security`

Path: `data/vulnerabilities/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `in-progress`, `risk-accepted`, `remediated`, `closed`, `false-positive` |
| `severity` | enum | Yes | Values: `informational`, `low`, `medium`, `high`, `critical`, `unknown` |
| `description` | string | Yes |  |
| `systemIds` | array of id | Yes | References: `system` |
| `discoveredOn` | date | Yes |  |
| `source` | string | No |  |
| `externalIdentifier` | string | No |  |
| `cveIds` | array of string | No |  |
| `cvss` | number | No |  |
| `exploitability` | string | No |  |
| `dueOn` | date | No |  |
| `riskId` | id | No | References: `risk` |
| `acceptedByIds` | array of id | No | References: `person` |
| `acceptanceExpiresOn` | date | No |  |
| `remediatedOn` | date | No |  |
| `verifiedByIds` | array of id | No | References: `person` |
| `verifiedOn` | date | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `actionItemIds` | array of id | No | References: `action-item` |

#### `vulnerability-scan`

Scan activities with kind, tools, scope, systems, operator, timestamps, severity counts, resulting vulnerabilities, evidence, failure reason, and review.

Policy basis: The information security policy requires monitoring for vulnerabilities and scanning internet-facing and production systems.

Timing: Scan at least quarterly and after material changes when practical. Review failures and create vulnerability or finding records for confirmed results.

Default sources: `policy-information-security`

Path: `data/vulnerability-scans/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `running`, `complete`, `failed` |
| `scanKind` | string | Yes |  |
| `scope` | string | Yes |  |
| `operatorIds` | array of id | Yes | References: `person` |
| `tools` | array of string | No |  |
| `scheduledOn` | date | No |  |
| `startedAt` | timestamp | No |  |
| `completedAt` | timestamp | No |  |
| `systemIds` | array of id | No | References: `system` |
| `resultSummary` | string | No |  |
| `findingCountBySeverity` | object | No |  |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `failureReason` | string | No |  |
| `reviewerIds` | array of id | No | References: `person` |
| `reviewedOn` | date | No |  |

#### `incident`

Suspected and confirmed security or privacy events with severity, chronology, scope, ownership, evidence, affected systems and vendors, findings, and corrective work. An incident record is not required for SOC 2 when no incident has occurred.

Policy basis: The information security and data handling policies require immediate reporting, investigation, containment, recovery, evidence preservation, and notification review.

Timing: Create on report or detection, update material events as they progress, and complete a retrospective within one week after a material incident.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/incidents/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `suspected`, `declared`, `contained`, `eradicated`, `recovered`, `closed` |
| `severity` | rating | Yes |  |
| `detectedAt` | timestamp | Yes |  |
| `description` | string | Yes |  |
| `occurredAt` | timestamp | No |  |
| `declaredAt` | timestamp | No |  |
| `containedAt` | timestamp | No |  |
| `recoveredAt` | timestamp | No |  |
| `closedAt` | timestamp | No |  |
| `reportedBy` | object | No |  |
| `detectionSource` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `dataClassification` | string | No |  |
| `riskIds` | array of id | No | References: `risk` |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |

#### `penetration-test`

Internal or external penetration tests with scope, period, provider, method, result, affected systems, evidence, vulnerabilities, findings, and review.

Policy basis: The information security policy requires an independent test of the in-scope service's external attack surface and tracked resolution of results.

Timing: Perform at least annually and reconsider scope after material attack-surface or architecture changes.

Default sources: `policy-information-security`

Path: `data/penetration-tests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `testKind` | string | Yes |  |
| `scope` | string | Yes |  |
| `periodStart` | date | Yes |  |
| `periodEnd` | date | Yes |  |
| `provider` | string | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete` |
| `systemIds` | array of id | No | References: `system` |
| `rulesOfEngagementDocumentId` | id | No | References: `document` |
| `methodology` | string | No |  |
| `resultSummary` | string | No |  |
| `findingIds` | array of id | No | References: `finding` |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `reviewerIds` | array of id | No | References: `person` |
| `reviewedOn` | date | No |  |

### Resilience

#### `exercise`

Continuity, recovery, incident, privacy, and other simulations with scenario, objective, participants, scope, result, evidence, findings, and actions.

Policy basis: The information security policy requires annual incident testing. The continuity plan requires annual exercises and review after material change or disruption.

Timing: Test incident response and continuity at least annually. Repeat after a material change when the prior exercise no longer represents the environment.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/exercises/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `exerciseKind` | string | Yes |  |
| `scheduledOn` | date | Yes |  |
| `facilitatorIds` | array of id | Yes | References: `person` |
| `scenario` | string | No |  |
| `objective` | string | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete` |
| `participantIds` | array of id | No | References: `person` |
| `teamIds` | array of id | No | References: `team` |
| `systemIds` | array of id | No | References: `system` |
| `startedAt` | timestamp | No |  |
| `completedAt` | timestamp | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |

#### `backup-test`

Restore and recovery tests with systems, operators, date, timing, recovery results, reviewer, evidence, findings, and follow-up work.

Policy basis: The information security policy and continuity plan require protected backups, failure monitoring, and proof that data can be restored and used.

Timing: Test restoration at least annually for important systems and after recovery changes that could invalidate prior evidence.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/backup-tests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `running`, `passed`, `failed` |
| `systemIds` | array of id | Yes | References: `system` |
| `testDate` | date | Yes |  |
| `operatorIds` | array of id | Yes | References: `person` |
| `outcome` | outcome | No |  |
| `reviewerIds` | array of id | No | References: `person` |
| `startedAt` | timestamp | No |  |
| `completedAt` | timestamp | No |  |
| `recoveryTimeMinutes` | integer | No |  |
| `recoveryPointMinutes` | integer | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |

### Evidence

#### `evidence`

Use this page first to record a verified test capture for each selected control family, which proves evidence can be collected before the candidate period begins. During operation, add screenshots, signed forms, reports, exports, and other proof with their source systems, controls, collectors, dates, and verification.

Policy basis: The information security policy requires retained audit evidence. Acknowledgement and training workflows require signatures or repository revisions tied to the exact content reviewed.

Timing: Test every selected control family before the candidate period begins. Once operation starts, collect evidence whenever the control or activity runs, verify it before audit use, cover the stated period, and retain it according to classification and record rules.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/evidence/<id>/evidence.json`

Markdown companions:

- **Evidence**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `collected`, `verified`, `expired`, `withdrawn` |
| `evidenceKind` | string | Yes |  |
| `source` | string | Yes |  |
| `collectedOn` | date | Yes |  |
| `classification` | string | Yes |  |
| `filePaths` | array of data-path | No |  |
| `externalReference` | object | No |  |
| `periodStart` | date | Conditional | Required when `evidenceKind` is `population-export` |
| `periodEnd` | date | Conditional | Required when `evidenceKind` is `population-export` |
| `generatedAt` | timestamp | Conditional | Generated at Required when `evidenceKind` is `population-export` |
| `timezone` | string (timezone) | Conditional | Report timezone Required when `evidenceKind` is `population-export` |
| `queryDescription` | string | Conditional | Query or report parameters Required when `evidenceKind` is `population-export` |
| `populationCount` | integer | Conditional | Population count Minimum: `0`. Required when `evidenceKind` is `population-export` |
| `completenessValidation` | string | Conditional | Completeness validation Required when `evidenceKind` is `population-export` |
| `accuracyValidation` | string | Conditional | Accuracy validation Required when `evidenceKind` is `population-export` |
| `sourceSystemId` | id | Conditional | Source system References: `system` Required when `evidenceKind` is `population-export` |
| `systemIds` | array of id | No | References: `system` |
| `controlIds` | array of id | No | References: `control` |
| `auditIds` | array of id | No | References: `audit` |
| `collectorIds` | array of id | Yes | References: `person` |
| `verifierIds` | array of id | Conditional | References: `person` Required when `status` is `verified` |
| `verifiedOn` | date | Conditional | Required when `status` is `verified` |
| `expiresOn` | date | No |  |
| `sourceResourceIds` | array of id | No | References: `*` |
| `sourceCommit` | string | No |  |
| `capture` | object | No |  |

At least one of `filePaths`, `externalReference`, **content Markdown** is required.

### Findings and Work

#### `obligation`

Use obligations to run recurring and event-driven policy work such as meetings, reviews, scans, tests, training, and exercises. Work stays proposed until its governing policy takes effect, then the Work Queue shows what to complete and when. Obligation records are not required for SOC 2; they are FileGRC's scheduling layer.

Policy basis: Obligations turn policy language into an owned schedule and link each task to its policies, controls, scope, and completion records.

Timing: Treat starter work as proposed until every governing policy is active and its effective date has arrived. Then use the recurrence and activation date, and create a separate completion record for every period.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `document-business-continuity-disaster-recovery`

Path: `data/obligations/<id>.json`

Markdown companions:

- **Instructions**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `paused`, `retired` |
| `activityType` | string | Yes |  |
| `recurrence` | object | Yes |  |
| `triggerPrompt` | string | No |  |
| `window` | object | No |  |
| `completionResourceTypes` | array of string | No |  |
| `scopeResourceIds` | array of id | No | References: `*` |
| `templateResourceId` | id | No | References: `*` |
| `controlIds` | array of id | No | References: `control` |
| `policyIds` | array of id | No | References: `policy` |
| `startsOn` | date | No |  |
| `endsOn` | date | No |  |
| `completionResourceIds` | array of id | No | References: `*` |

#### `obligation-event`

One occurrence of a policy-triggering event, with its subject, applicable obligation templates, generated action checklist, owners, and completion state. Obligation-event records are not required for SOC 2; they keep event-driven policy work complete and auditable.

Policy basis: Event runs make onboarding, offboarding, material changes, incidents, and similar policy triggers explicit and auditable.

Timing: Create when the event occurs or is scheduled. Complete every generated action within its policy window, then close the event.

Path: `data/obligation-events/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `complete`, `canceled` |
| `eventType` | string | Yes |  |
| `occurredOn` | date | Yes |  |
| `occurredAt` | timestamp | No |  |
| `subjectResourceIds` | array of id | No | References: `*` |
| `obligationIds` | array of id | Yes | References: `obligation` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `completedOn` | date | Conditional | Required when `status` is `complete` |

#### `finding`

Create a Finding when a control test, review, risk assessment, security test, incident review, management meeting, or audit identifies a confirmed gap. FileGRC does not create Findings automatically because management must confirm and describe the issue. Track ownership, severity, remediation, evidence, and independent verification here. A Finding record is not required for SOC 2 when no gap has been identified.

Policy basis: The information security policy requires issues from monitoring, audits, incidents, scans, and reviews to be tracked through corrective action.

Timing: Create when identified, assign a risk-based due date, review while open, and close only after remediation is verified.

Default sources: `policy-information-security`

Path: `data/findings/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `accepted`, `remediating`, `resolved`, `closed` |
| `severity` | rating | Yes |  |
| `sourceResourceId` | id | Yes | References: `*` |
| `description` | string | Yes |  |
| `controlIds` | array of id | No | References: `control` |
| `riskIds` | array of id | No | References: `risk` |
| `systemIds` | array of id | No | References: `system` |
| `identifiedOn` | date | No |  |
| `dueOn` | date | No |  |
| `actionItemIds` | array of id | No | References: `action-item` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `resolvedOn` | date | No |  |
| `verifiedByIds` | array of id | No | References: `person` |
| `verifiedOn` | date | No |  |

#### `action-item`

Owned follow-up work from findings, risks, incidents, meetings, reviews, tests, exceptions, audits, and other GRC activity. A separate action-item tracker is not required for SOC 2; use this page when follow-up should stay linked to its source and evidence.

Policy basis: Starter policies require material issues and review decisions to produce named owners, due dates, evidence, and tracked corrective work.

Timing: Create when work is assigned, review until complete, record blockers, and link completion evidence before closing.

Path: `data/action-items/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `in-progress`, `blocked`, `done`, `canceled` |
| `assigneeIds` | array of id | Yes | References: `person`, `team` |
| `sourceResourceId` | id | Yes | References: `*` |
| `description` | string | No |  |
| `priority` | rating | No |  |
| `obligationId` | id | No | References: `obligation` |
| `dueWindowStart` | date | No |  |
| `dueWindowEnd` | date | No |  |
| `overdueOn` | date | No |  |
| `dueWindowStartAt` | timestamp | No |  |
| `dueWindowEndAt` | timestamp | No |  |
| `overdueAt` | timestamp | No |  |
| `dueOn` | date | No |  |
| `completedOn` | date | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `completionResourceIds` | array of id | No | References: `*` |
| `blockingResourceIds` | array of id | No | References: `*` |

### Audits

#### `audit`

Use this page after the program is collecting evidence to record a real SOC 2 engagement, the CPA firm, auditor-agreed scope and dates, requests, fieldwork, findings, and the final report. Create one earlier only when a customer deadline calls for early coordination.

Policy basis: An independent CPA firm performs the examination against the selected criteria. Policies, controls, operating records, and evidence show how the organization meets them.

Timing: Create one record after a CPA firm is engaged, or earlier only when a customer deadline makes early coordination useful. Keep management candidate dates on the workspace and record the auditor-agreed Type 1 date or Type 2 period here.

Default sources: `policy-information-security`

Path: `data/audits/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `fieldwork`, `complete` |
| `auditKind` | enum | Yes | Values: `readiness`, `soc-2-type-1`, `soc-2-type-2` |
| `frameworkIds` | array of id | Yes | References: `framework` |
| `scope` | string | Yes |  |
| `auditor` | object | No |  |
| `auditorVendorId` | id | No | References: `vendor` |
| `typeOneAsOf` | date | No | Auditor-agreed Type 1 date |
| `periodStart` | date | No | Auditor-agreed Type 2 period start |
| `periodEnd` | date | No | Auditor-agreed Type 2 period end |
| `fieldworkStart` | date | No |  |
| `fieldworkEnd` | date | No |  |
| `reportDate` | date | No |  |
| `systemIds` | array of id | No | References: `system` |
| `requirementIds` | array of id | No | References: `requirement` |
| `controlIds` | array of id | No | References: `control` |
| `contactIds` | array of id | No | References: `person` |
| `assessmentCoverage` | object | No |  |
| `systemDescriptionDocumentId` | id | No | References: `document` |
| `managementAssertionDocumentId` | id | No | References: `document` |
| `periodCompletenessDocumentId` | id | No | References: `document` |
| `managementRepresentationDocumentId` | id | No | References: `document` |
| `complementaryControlIds` | array of id | No | References: `complementary-control` |
| `complementaryControlsConclusion` | enum | No | Complementary controls conclusion Values: `identified`, `not-applicable` |
| `subserviceVendorIds` | array of id | No | References: `vendor` |
| `subserviceMethod` | enum | No | Values: `carve-out`, `inclusive`, `not-applicable` |
| `controlTestIds` | array of id | No | References: `control-test` |
| `opinion` | enum | No | Values: `unmodified`, `qualified`, `adverse`, `disclaimer`, `not-issued` |
| `opinionDate` | date | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `reportEvidenceId` | id | No | References: `evidence` |
| `managementResponseDocumentId` | id | No | References: `document` |
| `supplementalDocumentIds` | array of id | No | References: `document` |

#### `audit-population`

One complete population of events or items for a Type 2 period. Management records the authoritative source, exact query, count, reconciliation, and fixed export, including when the count is zero.

Policy basis: Management must supply complete and accurate populations so the auditor can select samples and test controls. The linked population-export evidence remains the fixed source artifact.

Timing: Plan at the start of the engagement, export for the exact audit period, reconcile before fieldwork, and retain proof for zero-event populations.

Path: `data/audit-populations/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `reconciled`, `incomplete`, `not-applicable` |
| `auditId` | id | Yes | References: `audit` |
| `populationKind` | string | Yes |  |
| `periodStart` | date | Yes |  |
| `periodEnd` | date | Yes |  |
| `controlIds` | array of id | No | References: `control` |
| `sourceSystemId` | id | Conditional | Authoritative source system References: `system` Required when `status` is `reconciled` |
| `sourceEvidenceId` | id | Conditional | References: `evidence` Required when `status` is `reconciled` |
| `reconciledByIds` | array of id | Conditional | References: `person` Required when `status` is `reconciled` |
| `reconciledOn` | date | Conditional | Required when `status` is `reconciled` |
| `conclusion` | enum | Conditional | Values: `complete`, `complete-with-exceptions`, `incomplete` Required when `status` is `reconciled` |
| `reconciliationSummary` | string | No |  |
| `notApplicableReason` | string | Conditional | Required when `status` is `not-applicable` |

#### `audit-request`

One auditor request or prepared-by-client item with engagement, reference, description, owner, due date, response, criteria, controls, evidence, and follow-up. A separate FileGRC request tracker is not required for SOC 2 when the auditor's system remains the source of truth.

Policy basis: Audit requests turn the engagement scope into owned deliverables and preserve the exact evidence and response supplied to the auditor.

Timing: Create on receipt, assign immediately, meet the auditor due date, bind evidence to the requested period and Git revision, and close only after acceptance.

Path: `data/audit-requests/<id>.json`

Markdown companions:

- **Response**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `in-progress`, `submitted`, `accepted`, `needs-follow-up`, `closed` |
| `auditId` | id | Yes | References: `audit` |
| `requestReference` | string | Yes |  |
| `description` | string | Yes |  |
| `requestedOn` | date | No |  |
| `dueOn` | date | No |  |
| `submittedOn` | date | No |  |
| `closedOn` | date | No |  |
| `requirementIds` | array of id | No | References: `requirement` |
| `controlIds` | array of id | No | References: `control` |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `auditorNotes` | string | No |  |
| `actionItemIds` | array of id | No | References: `action-item` |

### Repository

#### `workspace`

Program-wide settings used by validation and rendering, including the organization, assurance goal, management candidate period, program scope, time zone, risk method, and classification scheme.

Policy basis: The information security and data handling policies depend on these settings. The program scope and management candidate period let evidence collection begin before a CPA firm confirms the formal engagement period.

Timing: Review during the annual policy and risk reviews, before starting a candidate evidence period, and after a material scope or methodology change.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/workspace.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataModelVersion` | string | Yes | Data model version |
| `organizationName` | string | Yes | Organization |
| `timezone` | string (timezone) | Yes | Timezone |
| `description` | string | No | Description |
| `repositoryUrl` | string | No | Repository URL |
| `assuranceGoal` | enum | No | Program goal Values: `none`, `readiness`, `soc-2-type-1`, `soc-2-type-2` |
| `candidateTypeOneAsOf` | date | No | Management candidate Type 1 date |
| `candidatePeriodStart` | date | No | Management candidate Type 2 period start |
| `candidatePeriodEnd` | date | No | Management candidate Type 2 period end |
| `frameworkIds` | array of id | No | Program frameworks References: `framework` |
| `requirementIds` | array of id | No | Program requirements References: `requirement` |
| `controlIds` | array of id | No | Program controls References: `control` |
| `systemIds` | array of id | No | Program systems References: `system` |
| `riskMethodology` | object | No | Risk methodology |
| `classificationDefinitions` | object | No | Classifications |

#### `renderer-settings`

Committed settings that control optional renderer behavior without changing the underlying compliance records or Git workflow. Renderer settings are not required for SOC 2.

Policy basis: This record configures the local renderer. It is not a SOC 2 control, policy, audit record, or substitute for evidence.

Timing: Change it when the team wants to rerun or suppress an optional renderer workflow, then review and commit the resulting diff.

Path: `data/renderer.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `showOnboarding` | boolean | Yes | Show onboarding |
| `completedStagePageIds` | array of string | No | Manually completed program pages |
