# GRC Data Model

<!-- Generated from packages/filegrc/model/v1.json. Do not edit by hand. -->

Model version: `1`

Stable, query-worthy GRC metadata. Variable procedures, questionnaires, observations, rationale, and detailed results belong in Markdown through contentPath or notesPath.

Each structured resource is one UTF-8 JSON file. Long-form work is Markdown under `data/content/`. Git supplies file authors, timestamps, diffs, commit messages, and revisions, so records do not duplicate those fields.

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
| `notesPath` | string (data-path) | No | Notes References long-form content under `data/`. |
| `extensions` | object | No | Extensions |

## Resource groups

### Program

#### `framework`

External criteria sets and versions used to define program and audit scope.

Policy basis: Frameworks come from the selected audit criteria, not an internal policy. The starter includes SOC 2 Security and system-description references without licensed criteria text.

Timing: Add or retire a version only through a deliberate scope decision. Reconfirm the selected version when planning each audit.

The UI labels the common `title` field as **Name**.

Path: `data/frameworks/<id>.json`

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

Policy basis: Requirements come from the selected framework. Controls explain how policy and actual operation address each applicable criterion.

Timing: Review applicability during audit planning and after material scope, service, system, or framework changes.

Path: `data/requirements/<id>.json`

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
| `effectiveOn` | date | No |  |
| `supersedesId` | id | No | References: `commitment` |

#### `complementary-control`

Controls expected from customers or subservice organizations and needed for the service organization's controls and commitments to work as described.

Policy basis: The system description and vendor model define these dependencies. Internal policies still require owners to identify, communicate, and monitor them.

Timing: Review for every audit and after material customer-responsibility, vendor, contract, integration, or service changes.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/complementary-controls/<id>.json`

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

Testable operating statements that translate policies and requirements into owned activities, system scope, frequency, and expected evidence.

Policy basis: Controls implement the linked policies and map that operation to applicable criteria. A policy statement alone does not prove implementation.

Timing: Operate at the frequency on each control. Review ownership, scope, design, and evidence during annual risk and policy reviews and after material changes.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/controls/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `implemented`, `partially-implemented`, `not-applicable`, `retired` |
| `statement` | string | Yes |  |
| `requirementIds` | array of id | Yes | References: `requirement` |
| `code` | string | No |  |
| `activity` | string | No |  |
| `controlType` | enum | No | Values: `preventive`, `detective`, `corrective` |
| `operationMode` | enum | No | Values: `manual`, `automated`, `hybrid` |
| `frequency` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `complementaryControlIds` | array of id | No | References: `complementary-control` |
| `policyIds` | array of id | No | References: `policy` |
| `riskIds` | array of id | No | References: `risk` |
| `effectiveOn` | date | No |  |
| `retiredOn` | date | No |  |

#### `control-test`

Management, internal-audit, or service-auditor tests of one control's design or operation for an as-of date or period.

Policy basis: The information security policy requires control monitoring and audit evidence. Tests link procedures, samples, evidence, exceptions, findings, and review.

Timing: Plan from control frequency, risk, and audit scope. Record the exact period or as-of date and complete review before relying on the result.

Default sources: `policy-information-security`

Path: `data/control-tests/<id>.json`

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
| `populationCount` | integer | No |  |
| `sampleSize` | integer | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `exceptionCount` | integer | No |  |
| `findingIds` | array of id | No | References: `finding` |
| `reviewerIds` | array of id | No | References: `person` |
| `reviewedOn` | date | No |  |
| `completedOn` | date | No |  |
| `sourceCommit` | string | No |  |
| `notPerformedReason` | string | Conditional | Required when `status` is `not-performed` |

### Governance

#### `team`

Committees, response teams, and accountable groups used for shared ownership, governance decisions, and meeting records.

Policy basis: The information security policy establishes a security and risk oversight group. The continuity plan assigns response and recovery roles.

Timing: The security and risk oversight group meets at least quarterly. Update membership after responsibility or personnel changes.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

The UI labels the common `title` field as **Name**.

Path: `data/teams/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `inactive` |
| `purpose` | string | Yes |  |
| `memberIds` | array of id | Yes | References: `person` |
| `chairIds` | array of id | No | References: `person` |
| `charterDocumentId` | id | No | References: `document` |
| `meetingCadence` | object | No |  |

#### `document`

Governed charters, plans, procedures, standards, agreements, reports, and templates whose Markdown and approvals belong in Git.

Policy basis: Policies use documents for detailed procedures, plans, acknowledgements, assertions, and reports while Git supplies revision history.

Timing: Follow each record's review cadence. Starter governed documents are reviewed at least annually and after material changes or use.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/documents/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `active`, `superseded`, `retired` |
| `documentKind` | string | Yes |  |
| `contentPath` | string (data-path) | Yes | References long-form content under `data/`. |
| `approverIds` | array of id | No | References: `person`, `team` |
| `version` | string | No |  |
| `effectiveOn` | date | No |  |
| `approvedOn` | date | No |  |
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

Approved rules and responsibilities with Markdown content, owners, approvers, audience, acknowledgement rules, related controls, and Git history.

Policy basis: Policies set the program's required behavior. Control, obligation, training, document, and attestation records make those requirements operational and auditable.

Timing: Review at least annually and after material changes. Record approval and require a new acknowledgement when a material update affects the audience.

Default sources: `policy-information-security`

Path: `data/policies/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `in-review`, `approved`, `active`, `superseded`, `retired` |
| `contentPath` | string (data-path) | Yes | References long-form content under `data/`. |
| `approverIds` | array of id | Yes | References: `person`, `team` |
| `policyNumber` | string | No |  |
| `policyKind` | string | No |  |
| `version` | string | No |  |
| `effectiveOn` | date | No |  |
| `approvedOn` | date | No |  |
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
| `statementPath` | string (data-path) | No | References long-form content under `data/`. |
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
| `agendaPath` | string (data-path) | No | References long-form content under `data/`. |
| `minutesPath` | string (data-path) | No | References long-form content under `data/`. |
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

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `active`, `retired` |
| `contentPath` | string (data-path) | Yes | References long-form content under `data/`. |
| `audience` | array of string | No |  |
| `assignmentTrigger` | string | No |  |
| `recurrence` | object | No |  |
| `completionWindowDays` | integer | No |  |
| `policyIds` | array of id | No | References: `policy` |
| `controlIds` | array of id | No | References: `control` |
| `passingCriteria` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `data-request`

Privacy, contractual, or other requests concerning data, tracked by opaque reference with scope, jurisdiction, due date, decision, evidence, and completion.

Policy basis: The data handling policy requires requests to reach the responsible owner and keeps erasable personal data out of immutable Git history.

Timing: Create on receipt, set the deadline from applicable law or contract, verify identity outside this repository when needed, and record completion.

Default sources: `policy-data-protection-handling`

Path: `data/data-requests/<id>.json`

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

Approved, time-bound departures from a policy or control, with scope, rationale, risk, compensating controls, owner, approval, and expiry.

Policy basis: The information security and data handling policies require a business reason, risk assessment, compensating controls, suitable approval, and an expiration or review date.

Timing: Approve before the departure begins, review through its stated cadence or expiry, and close or renew it through a new risk decision.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/exceptions/<id>.json`

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

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `assessmentDate` | date | Yes |  |
| `assessmentKind` | enum | Yes | Values: `enterprise-risk`, `system-risk`, `privacy-impact`, `vendor-risk`, `business-impact` |
| `scope` | string | Yes |  |
| `assessorIds` | array of id | Yes | References: `person` |
| `reviewerIds` | array of id | Yes | References: `person` |
| `methodology` | string | No |  |
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
| `approvedOn` | date | No |  |
| `sourceCommit` | string | No |  |

### People and Access

#### `person`

Minimal workforce records used for ownership, approval, training, access, attendance, and accountability without turning Git into an HR system.

Policy basis: The information security policy and employee handbook require named responsibility, onboarding, training, role changes, performance review, and offboarding.

Timing: Create before assigning work or access, update after role changes, and mark inactive at departure. Training is due within 30 days of starting and annually.

Default sources: `policy-information-security`, `policy-employee-handbook`

The UI labels the common `title` field as **Name**.

Path: `data/people/<id>.json`

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

Non-human identities used by automation or applications, with purpose, ownership, system scope, authentication, privilege, and expiry.

Policy basis: The information security policy requires important identities to be inventoried, owned, protected, reviewed, and removed when unneeded.

Timing: Create before use. Review privileged and production access quarterly and other important access annually; retire or expire unused accounts.

Default sources: `policy-information-security`

The UI labels the common `title` field as **Name**.

Path: `data/service-accounts/<id>.json`

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
| `populationCount` | integer | No |  |
| `exceptionCount` | integer | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `findingIds` | array of id | No | References: `finding` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `approvedByIds` | array of id | No | References: `person` |
| `approvedOn` | date | No |  |
| `sourceCommit` | string | No |  |

### Systems and Vendors

#### `system`

Applications, services, infrastructure, and business-system boundaries used to define audit scope, ownership, data, vendors, and recovery objectives.

Policy basis: The information security, data handling, and continuity policies require inventories of important systems with owners, criticality, classification, scope, and recovery needs.

Timing: Review at least annually and after material architecture, data, vendor, service, or recovery changes.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `document-business-continuity-disaster-recovery`

The UI labels the common `title` field as **Name**.

Path: `data/systems/<id>.json`

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
| `continuityObjectives` | object | No |  |

#### `asset`

Individually managed devices, media, software, records, or other physical and logical items with an owner, custodian, criticality, and lifecycle.

Policy basis: The information security, mobile computing, and data handling policies require important assets to be inventoried, protected according to classification, and securely returned or disposed.

Timing: Record acquisition and assignment, review the inventory annually, update custody on change, and retire assets when use ends.

Default sources: `policy-information-security`, `policy-mobile-computing-communications`, `policy-data-protection-handling`

The UI labels the common `title` field as **Name**.

Path: `data/assets/<id>.json`

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

Third parties that provide products or services, with ownership, service, criticality, data, systems, contracts, subprocessors, continuity, and review cadence.

Policy basis: The information security and data handling policies require vendor inventory, risk-based review before access, suitable contract terms, and monitoring of important providers.

Timing: Create before access or reliance. Review Critical and High-risk vendors at least annually and after material service changes or incidents.

Default sources: `policy-information-security`, `policy-data-protection-handling`

The UI labels the common `title` field as **Name**.

Path: `data/vendors/<id>.json`

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

Confirmed weaknesses with severity, affected systems, source, dates, external IDs, owner, due date, risk treatment, evidence, and remediation verification.

Policy basis: The information security policy requires owned, risk-based remediation or a documented exception with compensating controls and approval.

Timing: Remediate Critical, High, Medium, and Low vulnerabilities within 7, 14, 30, and 30 days unless an approved exception applies.

Default sources: `policy-information-security`

Path: `data/vulnerabilities/<id>.json`

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

Suspected and confirmed security or privacy events with severity, chronology, scope, ownership, evidence, affected systems and vendors, findings, and corrective work.

Policy basis: The information security and data handling policies require immediate reporting, investigation, containment, recovery, evidence preservation, and notification review.

Timing: Create on report or detection, update material events as they progress, and complete a retrospective within one week after a material incident.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/incidents/<id>.json`

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

Screenshots, signed forms, reports, exports, and other proof, bound to source records, dates, systems, controls, audits, files, and Git revisions.

Policy basis: The information security policy requires retained audit evidence. Acknowledgement and training workflows require signatures or repository revisions tied to the exact content reviewed.

Timing: Collect when a control or activity operates, verify before audit use, cover the stated period, and expire or retain according to classification and record rules.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/evidence/<id>/evidence.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `collected`, `verified`, `expired`, `withdrawn` |
| `evidenceKind` | string | Yes |  |
| `source` | string | Yes |  |
| `collectedOn` | date | Yes |  |
| `classification` | string | Yes |  |
| `filePaths` | array of data-path | No |  |
| `externalReference` | object | No |  |
| `contentPath` | string (data-path) | No | References long-form content under `data/`. |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
| `systemIds` | array of id | No | References: `system` |
| `controlIds` | array of id | No | References: `control` |
| `auditIds` | array of id | No | References: `audit` |
| `collectorIds` | array of id | No | References: `person` |
| `verifierIds` | array of id | No | References: `person` |
| `verifiedOn` | date | No |  |
| `expiresOn` | date | No |  |
| `sourceResourceIds` | array of id | No | References: `*` |
| `sourceCommit` | string | No |  |
| `capture` | object | No |  |

At least one of `filePaths`, `externalReference`, `contentPath` is required.

### Findings and Work

#### `obligation`

Recurring or event-driven work generated from policy commitments, including meetings, reviews, scans, tests, training, and exercises.

Policy basis: Obligations turn policy language into an owned schedule and link each task to its policies, controls, scope, and completion records.

Timing: Use the recurrence and start date on each record. Create separate completion records for every period instead of overwriting the obligation.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `document-business-continuity-disaster-recovery`

Path: `data/obligations/<id>.json`

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
| `instructionsPath` | string (data-path) | No | References long-form content under `data/`. |

#### `obligation-event`

One occurrence of a policy-triggering event, with its subject, applicable obligation templates, generated action checklist, owners, and completion state.

Policy basis: Event runs make onboarding, offboarding, material changes, incidents, and similar policy triggers explicit and auditable.

Timing: Create when the event occurs or is scheduled. Complete every generated action within its policy window, then close the event.

Path: `data/obligation-events/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `complete`, `canceled` |
| `eventType` | string | Yes |  |
| `occurredOn` | date | Yes |  |
| `occurredAt` | timestamp | No |  |
| `subjectResourceIds` | array of id | No | References: `*` |
| `obligationIds` | array of id | Yes | References: `obligation` |
| `actionItemIds` | array of id | No | References: `action-item` |
| `completedOn` | date | No |  |

#### `finding`

Audit exceptions, control deficiencies, review issues, and other gaps that need ownership, severity, remediation, evidence, and independent verification.

Policy basis: The information security policy requires issues from monitoring, audits, incidents, scans, and reviews to be tracked through corrective action.

Timing: Create when identified, assign a risk-based due date, review while open, and close only after remediation is verified.

Default sources: `policy-information-security`

Path: `data/findings/<id>.json`

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

Owned follow-up work from findings, risks, incidents, meetings, reviews, tests, exceptions, audits, and other GRC activity.

Policy basis: Starter policies require material issues and review decisions to produce named owners, due dates, evidence, and tracked corrective work.

Timing: Create when work is assigned, review until complete, record blockers, and link completion evidence before closing.

Path: `data/action-items/<id>.json`

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

Audit and readiness engagements with criteria, scope, type or period, systems, controls, tests, auditor, system description, assertion, evidence, findings, and opinion.

Policy basis: The information security policy requires applicable obligations, controls, and evidence to support audit work. The selected frameworks define the actual criteria.

Timing: Create one record per engagement. Set an as-of date for Type 1 or a start and end period for Type 2, then keep requests and tests within that scope.

Default sources: `policy-information-security`

Path: `data/audits/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `fieldwork`, `complete` |
| `auditKind` | string | Yes |  |
| `frameworkIds` | array of id | Yes | References: `framework` |
| `scope` | string | Yes |  |
| `auditor` | object | No |  |
| `auditorVendorId` | id | No | References: `vendor` |
| `typeOneAsOf` | date | No |  |
| `periodStart` | date | No |  |
| `periodEnd` | date | No |  |
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
| `complementaryControlIds` | array of id | No | References: `complementary-control` |
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

#### `audit-request`

One auditor request or prepared-by-client item with engagement, reference, description, owner, due date, response, criteria, controls, evidence, and follow-up.

Policy basis: Audit requests turn the engagement scope into owned deliverables and preserve the exact evidence and response supplied to the auditor.

Timing: Create on receipt, assign immediately, meet the auditor due date, bind evidence to the requested period and Git revision, and close only after acceptance.

Path: `data/audit-requests/<id>.json`

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
| `responsePath` | string (data-path) | No | References long-form content under `data/`. |
| `evidenceIds` | array of id | No | References: `evidence` |
| `auditorNotes` | string | No |  |
| `actionItemIds` | array of id | No | References: `action-item` |

### Repository

#### `workspace`

Program-wide settings used by validation and rendering, including the organization, time zone, risk method, and classification scheme.

Policy basis: The information security and data handling policies depend on these settings. Change the method or classifications with the related policies and controls.

Timing: Review during the annual policy and risk reviews and after a material scope or methodology change.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/workspace.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataModelVersion` | string | Yes | Data model version |
| `organizationName` | string | Yes | Organization |
| `timezone` | string (timezone) | Yes | Timezone |
| `description` | string | No | Description |
| `repositoryUrl` | string | No | Repository URL |
| `riskMethodology` | object | No | Risk methodology |
| `classificationDefinitions` | object | No | Classifications |

#### `renderer-settings`

Committed settings that control optional renderer behavior without changing the underlying compliance records or Git workflow.

Policy basis: This record configures the local renderer. It is not a SOC 2 control, policy, audit record, or substitute for evidence.

Timing: Change it when the team wants to rerun or suppress an optional renderer workflow, then review and commit the resulting diff.

Path: `data/renderer.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `showOnboarding` | boolean | Yes | Show onboarding |

## Compatibility

The model version is independent from the package version. The engine reads supported older model registries without changing consumer data. A migration must be explicit and documented.
