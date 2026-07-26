# GRC Data Model

<!-- Generated from packages/soc2/model/v1.json. Do not edit by hand. -->

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

A compliance framework and version.

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

A criterion or requirement within a framework.

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

A service commitment, system requirement, or business objective.

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

A control operated by a customer or subservice organization.

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

An organization-defined control.

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

A point-in-time or period test of one control.

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

A committee, response team, or accountable group.

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

A governed charter, plan, procedure, standard, agreement, report, or template.

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

A governed policy and its Markdown content.

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

A review of policies or other governed documents.

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

A person's acknowledgement, training completion, or certification.

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

Governance meeting metadata, minutes, decisions, and actions.

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

Reusable training content and assignment rules.

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

A privacy or contractual request concerning data.

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

An approved, time-bound departure from an expected control or policy.

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

A risk and its response lifecycle.

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

A point-in-time assessment of a risk scope.

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

A workforce member or internal participant, with minimal personal data.

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

A non-human identity used by automation or an application.

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

One person's or service account's access to one system.

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

A point-in-time review of system access.

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

A logical application, service, infrastructure, or business-system boundary.

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

An individually managed physical or logical item.

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

A third party that provides a product or service.

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

Vendor due diligence or periodic review.

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

A security weakness or grouped set of weaknesses.

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

A vulnerability scan activity and its coverage.

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

A suspected or confirmed security or privacy incident.

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

An internal or external penetration test.

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

A continuity, recovery, incident, privacy, or other simulation.

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

A restore or recovery test.

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

Supporting material and the metadata needed to use it in an audit.

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

Recurring or event-driven GRC work.

Path: `data/obligations/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `paused`, `retired` |
| `activityType` | string | Yes |  |
| `recurrence` | object | Yes |  |
| `scopeResourceIds` | array of id | No | References: `*` |
| `templateResourceId` | id | No | References: `*` |
| `controlIds` | array of id | No | References: `control` |
| `policyIds` | array of id | No | References: `policy` |
| `startsOn` | date | No |  |
| `endsOn` | date | No |  |
| `completionResourceIds` | array of id | No | References: `*` |
| `instructionsPath` | string (data-path) | No | References long-form content under `data/`. |

#### `finding`

An audit exception, deficiency, review issue, or other tracked gap.

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

Follow-up work from a GRC activity or finding.

Path: `data/action-items/<id>.json`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `in-progress`, `blocked`, `done`, `canceled` |
| `assigneeIds` | array of id | Yes | References: `person`, `team` |
| `sourceResourceId` | id | Yes | References: `*` |
| `description` | string | No |  |
| `priority` | rating | No |  |
| `dueOn` | date | No |  |
| `completedOn` | date | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `blockingResourceIds` | array of id | No | References: `*` |

### Audits

#### `audit`

An audit or readiness engagement.

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

One auditor request or prepared-by-client item.

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

Repository-wide configuration.

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

## Compatibility

The model version is independent from the package version. The engine reads supported older model registries without changing consumer data. A migration must be explicit and documented.
