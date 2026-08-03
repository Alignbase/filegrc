# GRC Data Model

<!-- Generated from packages/filegrc/model/v2.json. Do not edit by hand. -->

Model version: `2`

Stable, query-worthy GRC metadata. Long-form work is stored as implicit Markdown companion files beside each structured JSON record.

Each structured resource is one UTF-8 JSON file. Long-form work is an implicit Markdown companion beside that JSON file. Git supplies file authors, timestamps, diffs, commit messages, and revisions, so records do not duplicate those fields or file paths.

## Program path

The renderer, CLI, generated agent instructions, and this reference use the same five-step lifecycle:

### Step 1. Define Scope

Confirm the people, dated appointments, and teams responsible for the program, set the management goal, review the criteria and customer commitments in scope, then define the customer-facing service, supporting systems, and supplier dependencies.

- **People** (`person`): Record each person’s actual organizational job title. Keep named program authority, such as CISO, DPO, Policy Owner, or team chair, in dated Appointment records.
- **Appointments** (`appointment`): Record one person’s dated appointment to a named organizational or program responsibility. Scope it to the workspace, a team, or the records governed by that appointment.
- **Teams** (`team`): Review the starter Security and Risk Oversight team, including its members and chair. Membership and chairs are authoritative on the Team record.
- **Frameworks** (`framework`): Confirm the criteria framework and version used for the program.
- **Requirements** (`requirement`): Review each criterion, decide whether it applies, and record the reason for that decision.
- **Commitments** (`commitment`): Record supplemental customer promises and service requirements that shape the scope or control design. The Commitment’s systemIds and controlIds are authoritative for what fulfills it.
- **Vendors** (`vendor`): Catalog the companies that provide in-scope software or services. Link each vendor-provided System with the System’s vendorId.
- **Systems** (`system`): Catalog all in-scope systems for the program. Treat anything that operates a control or produces evidence as a System, including software provided by a vendor (like HR software). Set vendorId on each vendor-provided System; the Vendor’s System list is derived. For every authoritative evidence source, set its source roles, name current access owners, and write repeatable retrieval instructions in Record Markdown before implementing the linked Controls.

Headless commands:

- `npx filegrc setup`
- `npx filegrc guide person --json`
- `npx filegrc guide appointment --json`
- `npx filegrc guide system --json`
- `npx filegrc list system --json`

### Step 2. Approve Policies

Turn every applicable policy and governed plan into the organization’s actual rules, remove placeholders, confirm that Controls link to their governing Policies, and establish approval and effective dates before scheduled work begins. The reviewer must be separate from the owner, is usually internal, and may be external.

- **Policies** (`policy`): Tailor each policy to match how the organization works. Clear placeholders, assign an owner and separate approver, then record its approval and effective dates. Controls link to their governing Policies.
- **Documents** (`document`): Tailor the governed plans and other supporting documents the program needs. Assign owners and approvers, then keep the approved Markdown in Git.

Headless commands:

- `npx filegrc guide policy --json`
- `npx filegrc list policy --json`
- `npx filegrc get POLICY_ID --mutation`

### Step 3. Implement Controls

Review the starter catalog against the scoped service, then give every applicable internal control an actual procedure, owner, system scope, operation pattern, policy and criteria mappings, and implementation date. Put calendar and event schedules in Obligations. Connect the Control to the exact authoritative Systems that produce its evidence, and complete each source’s role, access ownership, and retrieval instructions before marking the Control implemented. Then record any controls that customers or carved-out providers must perform.

- **Controls** (`control`): Finish each applicable starter control with the procedure people will follow, its owner, scope, operation pattern, governing Policy and Requirement mappings, authoritative evidence source Systems, and implementation date. Put calendar and event schedules in Obligations. Confirm that each source is active, has the required evidence role and access owners, and includes repeatable retrieval instructions in Record Markdown.
- **Complementary controls** (`complementary-control`): Record anything customers or carved-out providers must do for your controls to work as intended.

Headless commands:

- `npx filegrc guide control --json`
- `npx filegrc list control --json`
- `npx filegrc get CONTROL_ID --mutation`
- `npx filegrc evidence-map --json`
- `npx filegrc program-readiness --json`

### Step 4. Operate the Program

Record the management candidate start date when reliable evidence collection begins. Maintain current risk assessments and risks, updating the control set when needed. Complete recurring and event-driven work, run continuous and per-transaction controls, and keep dated evidence current throughout the period.

- **Policy Events** (`utility:policy-events`): Trigger the matching workflow when an event occurs. filegrc adds every required action to the Work Queue with its owner and deadline.
- **Work Queue** (`utility:work-queue`): Complete recurring work, Policy Event tasks, and assigned Action Items within their allowed windows, link the requested dated proof, and resolve overdue items.

Operating record guides:

- **Risk assessments** (`risk-assessment`): Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.
- **Risks** (`risk`): Record each risk identified by an assessment or operating activity. Assign an owner, rate it, document the chosen response, and link the Controls that treat it from the Risk record.
- **Obligations** (`obligation`): Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.
- **Policy Events** (`obligation-event`): When a policy-triggering event occurs, record it here and complete the actions filegrc creates for it.
- **Data requests** (`data-request`): Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.
- **External Evidence** (`evidence`): Create External Evidence when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source System, link the Controls and operating record it supports, retain the fixed artifact or reference, and have another person verify it before audit use.
- **Policy reviews** (`policy-review`): Record scheduled and change-driven reviews of policies and governed documents, including the decision and any follow-up.
- **Meetings** (`meeting`): Record required oversight meetings, including attendees, decisions, minutes, and follow-up work.
- **Exceptions** (`exception`): Record and approve any time-limited departure from a policy or control before the departure begins.
- **Assets** (`asset`): Keep the inventory of important devices, software, media, and records current, including ownership, custody, and status.
- **Vendor reviews** (`vendor-review`): Document due diligence before relying on a provider, then repeat the review on schedule or after a material change.
- **Service accounts** (`service-account`): Catalog non-human accounts that need separate tracking, including their owner, purpose, System, privilege, and expiry.
- **Access grants** (`access-grant`): Record each person’s or service account’s access to a System, including approval, provisioning, changes, and removal.
- **Access reviews** (`access-review`): Review access on schedule, record each decision, and assign any access changes that result.
- **Training** (`training`): Maintain the training content people must complete, along with its audience, timing, and passing requirements.
- **Attestations** (`attestation`): Record each person’s completion or acknowledgement against the exact policy or training revision.
- **Vulnerability scans** (`vulnerability-scan`): Record each required scan, including its scope, timing, result, and evidence.
- **Vulnerabilities** (`vulnerability`): Track confirmed weaknesses that need separate remediation, acceptance, or closure.
- **Penetration tests** (`penetration-test`): Record each penetration test, including its provider, scope, period, result, and evidence.
- **Incidents** (`incident`): Record qualifying security or privacy events and manage their response and follow-up.
- **Backup tests** (`backup-test`): Record each restore test, including the Systems tested, result, timing, evidence, and follow-up.
- **Exercises** (`exercise`): Record each incident or continuity exercise, including its objective, participants, result, and follow-up.
- **Findings** (`finding`): Create a Finding only for a confirmed gap that needs separate remediation tracking. Keep the report details in the source record’s Markdown, then assign the Finding, set its due date, and verify closure.
- **Action items** (`action-item`): Create an Action Item only when follow-up needs its own assignee, deadline, and completion proof. Point it to the record that created the work, then work it from Work Queue.

Headless commands:

- `npx filegrc obligations --json`
- `npx filegrc trigger EVENT_TYPE (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) --subject RESOURCE_ID --json`
- `npx filegrc complete OBLIGATION_ID completion-mutation.json --expected-revision REVISION --json`
- `npx filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD --expected-revision REVISION --json`
- `npx filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD --expected-revision REVISION --json`
- `npx filegrc program-readiness --json`

### Step 5. Audit

After the program is collecting reliable evidence, create an Audit record for the real CPA engagement, keep the firm-agreed report period separate from management’s candidate dates, complete management documents, populations, requests, evidence delivery, and fieldwork, then preserve the findings, responses, opinion, and final report.

- **Audits** (`audit`): Create this record after engaging the CPA firm, then record the agreed scope, criteria, Systems, and report period. Control Tests and External Evidence link back with auditId or auditIds.
- **Audit requests** (`audit-request`): Record each request from the audit team, assign an owner and due date, and link the approved response and evidence.
- **Audit populations** (`audit-population`): Record each complete Type 2 population with its source System, fixed export, query, count, and reconciliation.
- **Control tests** (`control-test`): Record how an in-scope control was tested, what was sampled, the result, and any exceptions.
- **Audit Evidence & Packet** (`utility:audit-packet`): Review filegrc Evidence and External Evidence for the formal period, complete engagement preparation, and build the indexed audit packet.

Headless commands:

- `npx filegrc guide audit --json`
- `npx filegrc prepare-audit AUDIT_ID --json`
- `npx filegrc audit-readiness AUDIT_ID --json`
- `npx filegrc evidence-packet --audit AUDIT_ID --preview --json`

## Relation groups

Relationship fields use the named groups below. The registry expands each group to explicit resource types, so no relationship accepts an unrestricted wildcard.

| Group | Resource types |
| --- | --- |
| `accountable-party` | `person`, `team`, `appointment` |
| `appointment-scope` | `workspace`, `person`, `service-account`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `obligation-scope` | `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit` |
| `obligation-template` | `person`, `system`, `asset`, `document`, `control`, `policy`, `training` |
| `completion-record` | `access-grant`, `asset`, `control`, `document`, `evidence`, `control-test`, `finding`, `exception`, `action-item`, `policy-review`, `policy`, `attestation`, `meeting`, `risk-assessment`, `risk`, `vendor`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `audit-request` |
| `event-subject` | `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `policy`, `training`, `vendor`, `access-grant`, `vulnerability`, `incident` |
| `evidence-source-record` | `document`, `obligation`, `obligation-event`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `work-source` | `control`, `control-test`, `finding`, `exception`, `obligation`, `obligation-event`, `policy-review`, `meeting`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `work-blocker` | `person`, `appointment`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |

## Relationship constraints

Relationship constraints prevent cycles and duplicate active authority or access records.

- `person.managerId` must be acyclic.
- `system.parentSystemId` must be acyclic.
- `requirement.parentRequirementId` must be acyclic.
- `commitment.supersedesId` must be acyclic.
- `policy.parentPolicyId` must be acyclic.
- `policy.supersedesId` must be acyclic.
- `document.supersedesId` must be acyclic.
- `vendor.backupVendorId` must be acyclic.
- `appointment` records in `active` must be unique by `appointmentKind`, `scopeResourceIds`.
- `access-grant` records in `active` must be unique by `subjectId`, `systemId`, `accessLevel`, `role`, `privileged`.

## Obligation activities

The model owns each activity name, allowed recurrence modes and scope types, its default completion record, and every record type that can prove completion.

| Activity | Title | Recurrence | Scope resource types | Default completion | Accepted completion records |
| --- | --- | --- | --- | --- | --- |
| `access-change` | Access change | `event` | `person`, `service-account`, `system` | `access-grant` | `access-grant`, `evidence` |
| `access-provisioning` | Access provisioning | `event` | `person`, `service-account`, `system` | `access-grant` | `access-grant`, `evidence` |
| `access-removal` | Access removal | `event` | `person`, `service-account`, `system` | `access-grant` | `access-grant`, `evidence` |
| `access-review` | Access review | `calendar`, `event` | `system`, `service-account`, `team` | `access-review` | `access-review` |
| `alert-path-test` | Alert path test | `calendar`, `event` | `system`, `document`, `control` | `control-test` | `control-test`, `exercise`, `evidence` |
| `asset-recovery` | Asset recovery | `event` | `person`, `asset` | `asset` | `asset`, `evidence` |
| `asset-registration` | Asset registration | `event` | `person`, `asset` | `asset` | `asset`, `evidence` |
| `backup-test` | Backup test | `calendar`, `event` | `system` | `backup-test` | `backup-test` |
| `change-review` | Change review | `calendar`, `event` | `system`, `policy`, `document`, `control` | `meeting` | `meeting`, `policy`, `control`, `evidence` |
| `continuity-review` | Continuity review | `calendar`, `event` | `document`, `system` | `evidence` | `evidence` |
| `document-review` | Document review | `calendar`, `event` | `document` | `document` | `document`, `evidence` |
| `exception-review` | Exception review | `calendar`, `event` | `exception` | `exception` | `exception`, `evidence` |
| `exercise` | Exercise | `calendar`, `event` | `document`, `system`, `team` | `exercise` | `exercise` |
| `incident-retrospective` | Incident retrospective | `event` | `incident` | `incident` | `incident`, `document`, `evidence` |
| `inventory-review` | Inventory review | `calendar`, `event` | `service-account`, `system`, `asset`, `vendor` | `evidence` | `evidence` |
| `log-review` | Log review | `calendar`, `event` | `system` | `evidence` | `evidence` |
| `meeting` | Meeting | `calendar`, `event` | `team` | `meeting` | `meeting` |
| `network-review` | Network review | `calendar`, `event` | `system` | `evidence` | `evidence` |
| `oversight-meeting` | Oversight meeting | `calendar`, `event` | `team` | `meeting` | `meeting` |
| `penetration-test` | Penetration test | `calendar`, `event` | `system` | `penetration-test` | `penetration-test` |
| `performance-review` | Performance review | `calendar`, `event` | `person` | `evidence` | `evidence` |
| `personal-device-approval` | Personal device approval | `event` | `person`, `asset` | `evidence` | `evidence` |
| `policy-review` | Policy review | `calendar`, `event` | `policy`, `document` | `policy-review` | `policy-review` |
| `remediation` | Remediation | `calendar`, `event` | `finding`, `action-item`, `incident`, `vulnerability` | `action-item` | `action-item`, `finding` |
| `retention-review` | Retention review | `calendar`, `event` | `document`, `system` | `document` | `document`, `evidence` |
| `risk-assessment` | Risk assessment | `calendar`, `event` | `workspace`, `system`, `vendor`, `risk`, `control` | `risk-assessment` | `risk-assessment`, `risk`, `evidence` |
| `role-training` | Role training | `calendar`, `event` | `person`, `training` | `attestation` | `attestation`, `evidence` |
| `security-scan` | Security scan | `calendar`, `event` | `system`, `asset` | `evidence` | `evidence` |
| `training` | Training | `calendar`, `event` | `person`, `training` | `attestation` | `attestation`, `evidence` |
| `vendor-contract` | Vendor contract | `calendar`, `event` | `vendor`, `document` | `document` | `document`, `vendor` |
| `vendor-remediation` | Vendor remediation | `calendar`, `event` | `vendor`, `risk`, `finding`, `action-item` | `vendor` | `vendor`, `risk`, `document`, `action-item`, `evidence` |
| `vendor-review` | Vendor review | `calendar`, `event` | `vendor` | `vendor-review` | `vendor-review`, `evidence` |
| `vulnerability-scan` | Vulnerability scan | `calendar`, `event` | `system` | `vulnerability-scan` | `vulnerability-scan`, `evidence` |
| `workforce-acknowledgement` | Workforce acknowledgement | `calendar`, `event` | `person`, `policy`, `document` | `attestation` | `attestation`, `evidence` |

## Policy events

The model owns each event title and the minimum and maximum count for each subject resource type.

| Event | Title | Subject rules |
| --- | --- | --- |
| `person-started` | New Worker | `person` 1..1 |
| `person-ended` | Worker Departure | `person` 1..1 |
| `high-risk-person-ended` | High-Risk Departure | `person` 1..1 |
| `person-role-changed` | Job or Responsibility Change | `person` 1..1 |
| `personal-device-access-planned` | Personal Device Access | `person` 1..1, `asset` 0..1 |
| `vendor-access-planned` | Vendor Access | `vendor` 1..1 |
| `vendor-reassessment-needed` | Vendor Reassessment | `vendor` 1..1 |
| `system-material-change` | Material System Change | `system` 1..1 |
| `material-incident` | Material Incident | `incident` 1..1 |

## Nested object schemas

Named object schemas reject unknown keys unless the schema explicitly allows a typed map or arbitrary JSON. Conditional properties are valid only for the selected discriminator.

### `string-map`

Allows dynamic keys whose values are string.

### `integer-map`

Allows dynamic keys whose values are integer.

### `json-map`

Allows arbitrary JSON properties.

### `extensions`

Allows dynamic keys whose values are object (`json-map`).

Key format: `namespace`.

### `risk-methodology`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `method` | string | Yes |  |
| `likelihoodScale` | array of string | Yes |  |
| `impactScale` | array of string | Yes |  |
| `ratingBands` | object (`string-map`) | Yes |  |

### `continuity-objectives`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `recoveryTimeHours` | integer | No | Minimum: `0`. |
| `recoveryPointHours` | integer | No | Minimum: `0`. |
| `maximumTolerableDowntimeHours` | integer | No | Minimum: `0`. |

### `source-reference`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | No |  |
| `url` | string | No |  |
| `publisher` | string | No |  |
| `version` | string | No |  |

### `external-reference`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `system` | string | No |  |
| `reference` | string | No |  |
| `url` | string | No |  |

### `page-capture`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `route` | string | Yes |  |
| `filters` | object (`json-map`) | Yes |  |
| `capturedAt` | timestamp | Yes |  |
| `method` | string | Yes |  |
| `coverage` | object (`coverage-period`) | No |  |

### `recurrence`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `mode` | enum | Yes | Values: `calendar`, `event` |
| `unit` | enum | Conditional | Values: `day`, `week`, `month`, `year` Required when `mode` is `calendar`. Allowed when `mode` is `calendar`. |
| `interval` | integer | Conditional | Minimum: `1`. Required when `mode` is `calendar`. Allowed when `mode` is `calendar`. |
| `anchorDate` | date | No | Allowed when `mode` is `calendar`. |
| `eventType` | enum (id) | Conditional | Values: `person-started`, `person-ended`, `high-risk-person-ended`, `person-role-changed`, `personal-device-access-planned`, `vendor-access-planned`, `vendor-reassessment-needed`, `system-material-change`, `material-incident` Values come from the `policyEvents` registry. Required when `mode` is `event`. Allowed when `mode` is `event`. |

### `obligation-window`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `precision` | enum | Yes | Values: `date`, `timestamp` |
| `startsAfter` | integer | No |  |
| `dueAfter` | integer | Yes |  |

### `completion-window`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `precision` | enum | Yes | Values: `date`, `timestamp` |
| `startsOn` | date | Conditional | Required when `precision` is `date`. Allowed when `precision` is `date`. |
| `dueOn` | date | Conditional | Required when `precision` is `date`. Allowed when `precision` is `date`. |
| `overdueOn` | date | Conditional | Required when `precision` is `date`. Allowed when `precision` is `date`. |
| `startsAt` | timestamp | Conditional | Required when `precision` is `timestamp`. Allowed when `precision` is `timestamp`. |
| `dueAt` | timestamp | Conditional | Required when `precision` is `timestamp`. Allowed when `precision` is `timestamp`. |
| `overdueAt` | timestamp | Conditional | Required when `precision` is `timestamp`. Allowed when `precision` is `timestamp`. |
| `timezone` | string (timezone) | Conditional | Required when `precision` is `timestamp`. Allowed when `precision` is `timestamp`. |

### `external-tester`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `firm` | string | Yes |  |
| `contactName` | string | No |  |
| `email` | string (email) | No |  |

### `content-revisions`

Allows dynamic keys whose values are string.

Key format: `data-path`.

### `external-attendee`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | Yes |  |
| `organization` | string | No |  |
| `role` | string | No |  |
| `email` | string (email) | No |  |

### `risk-rating`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `likelihood` | string | Yes |  |
| `impact` | string | Yes |  |
| `rating` | rating | Yes |  |
| `score` | number | No |  |

### `access-grant-decision`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `accessGrantId` | id | Yes | References: `access-grant` |
| `decision` | enum | Yes | Values: `retain`, `change`, `remove` |
| `rationale` | string | No |  |

### `person-reference`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | No |  |
| `email` | string (email) | No |  |
| `channel` | string | No |  |

### `coverage-period`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | enum | Yes | Values: `as-of`, `range` |
| `on` | date | Conditional | Required when `kind` is `as-of`. Allowed when `kind` is `as-of`. |
| `startsOn` | date | Conditional | Required when `kind` is `range`. Allowed when `kind` is `range`. |
| `endsOn` | date | Conditional | Required when `kind` is `range`. Allowed when `kind` is `range`. |

### `risk-acceptance`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `rationale` | string | Yes |  |
| `acceptedByIds` | array of id | Yes | References: `person` |
| `acceptedOn` | date | Yes |  |
| `expiresOn` | date | Yes |  |

### `exception-approval`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `approvedByIds` | array of id | Yes | References: `person` |
| `approvedOn` | date | Yes |  |
| `expiresOn` | date | Yes |  |

### `exception-resolution`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `resolvedByIds` | array of id | Yes | References: `person` |
| `resolvedOn` | date | Yes |  |
| `rationale` | string | Yes |  |

### `cancellation`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `canceledByIds` | array of id | Yes | References: `person` |
| `canceledOn` | date | Yes |  |
| `reason` | string | Yes |  |

### `withdrawal`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `withdrawnByIds` | array of id | Yes | References: `person` |
| `withdrawnOn` | date | Yes |  |
| `reason` | string | Yes |  |

### `status-transition`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `changedByIds` | array of id | Yes | References: `person` |
| `changedOn` | date | Yes |  |
| `reason` | string | Yes |  |

## Common fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string (id) | Yes | ID |
| `type` | string | Yes | Type |
| `title` | string | Yes | Title |
| `tags` | array of string | No | Tags |
| `extensions` | object (`extensions`) | No | Extensions |

## Record Markdown

Resources with no dedicated Markdown use an optional companion with the same basename as the JSON record. The renderer creates and discovers this file from the stable record location, so no path is stored in the record.

Record Markdown is shown by default for: `system`, `control-test`, `finding`, `exception`, `policy-review`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`. Other resources without dedicated Markdown can add it when structured fields are not enough.

## Program and audit readiness defaults

Program Readiness checks management scope, policy adoption, control implementation, and authoritative evidence mapping without requiring an audit record. Audit Readiness starts after a CPA firm is engaged and uses the defaults below to prepare Type 1 and Type 2 fieldwork.

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

- **Workforce System** (`workforce`): Catalog the HR or workforce system that is authoritative for starts, role changes, and departures. Bring the complete workforce-change population and source reports used to reconcile access and responsibilities. Expected evidence: Export a workforce-change report from the HR or workforce system containing starters, role changes, and departures. Identify the source during scoping. Preserve event records as changes occur and export the complete Type 2 population after the period closes.
- **Training and Acknowledgements** (`training-acknowledgement`): filegrc records training assignments, content revisions, completions, acknowledgements, exceptions, and overdue follow-up during Step 4. FileGRC operating records: `training`, `attestation`. Expected evidence: Export assignments and completions tied to a specific training or policy revision. Set up training and acknowledgement records before assignments begin. Preserve completion proof as work occurs, then reconcile the complete Type 2 population to the workforce population after close.
- **Identity and Access Systems** (`identity-access`): Catalog the identity provider and each important application that enforces access. Bring identity, role, privileged-access, authentication-setting, review, and removal exports. Expected evidence: Export users, roles, privileged access, or authentication settings from the identity provider or an in-scope application. Identify sources during scoping. Capture configuration near the Type 1 date or at the start and end of a Type 2 period; export complete change and review populations after the Type 2 period closes.
- **Production Change Systems** (`production-change`): Catalog source control, deployment, and infrastructure-change systems. Bring protection settings, reviews, test and approval records, deployments, emergency changes, and rollback evidence. Expected evidence: Capture a change from the source control or deployment system showing review, testing, approval, deployment, and rollback information. Identify sources before the audit period. Preserve per-change evidence as changes occur and export the complete period population after a Type 2 period closes.
- **Security Monitoring Systems** (`security-monitoring`): Catalog logging and alerting systems. Bring configuration, coverage, alert delivery tests, alerts, investigations, and zero-event proof. filegrc records qualifying incidents and their response during Step 4. Expected evidence: Capture logging or alert configuration and a delivered test alert from the monitoring system. Capture configuration and coverage at the Type 1 date or across the Type 2 period. Preserve cases as they occur and export complete alert and incident populations after close.
- **Vulnerability Management** (`vulnerability-management`): filegrc records vulnerability scans and penetration tests during Step 4. Put the scanner output or independent report in an External Evidence record and link it from the operating record when fixed supporting proof is needed. FileGRC operating records: `vulnerability-scan`, `penetration-test`. Expected evidence: Export a result from the vulnerability or dependency scanner showing scope, coverage, findings, and severity. Confirm coverage before the audit period. Preserve scan and remediation evidence when generated and export the complete Type 2 population after close.
- **Endpoint Management Systems** (`endpoint-asset`): Catalog device-management and endpoint-compliance systems. Bring the complete device population, security configuration, compliance status, and exceptions. filegrc records asset ownership, custody, loss, return, and disposal during Step 4. Expected evidence: Export devices, security configuration, and compliance status from the endpoint-management system. Identify sources before devices receive access. Capture configuration near the Type 1 date or across the Type 2 period and export the complete Type 2 population after close.
- **Backup and Recovery** (`backup-recovery`): filegrc records restoration tests and continuity exercises during Step 4. Put backup-system output in an External Evidence record and link it from the operating record when fixed supporting proof is needed. FileGRC operating records: `backup-test`, `exercise`. Expected evidence: Export job history from the backup system showing scheduled runs, successes, failures, and follow-up. Capture configuration at the Type 1 date or across the Type 2 period. Preserve restoration and exercise results when performed and export complete job and failure history after period close.
- **Vendors** (`vendor-management`): filegrc records vendor reviews, risk decisions, supporting reports, exceptions, and follow-up during Step 4. FileGRC operating records: `vendor-review`. Expected evidence: Capture a completed vendor review with its contract, assurance report, risk decision, and follow-up. Identify relevant subservice organizations during scoping. Complete reviews during operation, obtain current assurance reports before fieldwork, and document bridge coverage when a report ends before the report period.
- **Exceptions and Findings** (`exception-finding`): filegrc records control exceptions, findings, risk acceptance, remediation, verification, and overdue work during Step 4. FileGRC operating records: `exception`, `finding`, `action-item`. Expected evidence: Export open and closed exceptions or findings with owners, status, dates, and remediation verification. Record items as they arise. Keep their status and follow-up current, then include the complete period population in fieldwork.
- **Data Protection Configuration** (`data-handling`): Catalog the systems authoritative for encryption settings and retention rules. Bring current configuration and approved schedules. Preserve completed disposal actions, exceptions, and verification during Step 4. Expected evidence: Capture encryption and retention settings from an in-scope System. Confirm configuration and retention rules before the audit period. Preserve disposal evidence when work occurs and capture configuration near the Type 1 date or across the Type 2 period.
- **Network Security Systems** (`network-security`): Catalog the systems authoritative for network boundaries, firewall rules, and remote access. Bring current configuration, rule reviews, approvals, changes, and exceptions. Expected evidence: Capture current firewall or network-access rules from the network system and confirm that remote and production access paths appear. Confirm boundary and remote-access configuration before the audit period. Preserve rule changes as they occur and capture current configuration near the Type 1 date or across the Type 2 period.
- **Governance** (`governance`): filegrc records policy approvals, oversight reviews, meetings, decisions, assigned actions, and completion proof in Steps 2 and 4. FileGRC operating records: `policy-review`, `meeting`. Expected evidence: Capture one completed oversight review or policy approval with the participants, decisions, dates, and follow-up work. Approve policies before they take effect. Preserve oversight records and decisions when the work occurs.
- **Risk Management** (`risk-management`): filegrc records risk assessments, risks, treatment decisions, reviews, and follow-up during Step 4. FileGRC operating records: `risk-assessment`, `risk`. Expected evidence: Export the risk register with owners, ratings, treatment decisions, review dates, and open actions. Complete the initial assessment while operating the program. Preserve risk changes and reviews as they occur, then include the current register in fieldwork.

## Resource groups

### Program

#### `framework`

Published criteria sets and versions used to define the program and audit scope.

Instructions: Confirm the criteria framework and version used for the program.

Policy basis: The CPA examination uses the selected Framework. filegrc’s starter references provide orientation but do not replace the publisher’s official criteria.

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
| `sourceReference` | object (`source-reference`) | No |  |
| `effectiveOn` | date | No |  |
| `retiredOn` | date | No |  |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `retired`. Allowed when `status` is one of `retired`. |

#### `requirement`

Individual criteria used to record applicability and connect the Framework to Controls, Commitments, Audits, and Findings.

Instructions: Review each criterion, decide whether it applies, and record the reason for that decision.

Policy basis: The selected Framework defines the Requirements. Controls show how management addresses each applicable criterion; the publisher’s official text remains authoritative.

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

#### `commitment`

Customer promises, service requirements, and approved business objectives beyond the baseline Framework and Policies. Link them to the Systems and Controls that fulfill them.

Instructions: Record supplemental customer promises and service requirements that shape the scope or control design. The Commitment’s systemIds and controlIds are authoritative for what fulfills it.

Policy basis: Contracts, service descriptions, and approved management decisions can create commitments that the system description and control design must address.

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
| `effectiveOn` | date | Conditional | Required when `status` is `active`. |
| `supersedesId` | id | No | References: `commitment` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |

#### `complementary-control`

Actions a customer or carved-out provider must perform for a linked Control to work as described. A Complementary Control record is not required for SOC 2 when no external dependency applies.

Instructions: Record anything customers or carved-out providers must do for your controls to work as intended.

Policy basis: The system description must explain relevant customer and subservice-organization responsibilities so readers understand where management’s Controls depend on others.

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
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |

#### `control`

Management’s actual safeguards and procedures, mapped to Policies, Requirements, Systems, and authoritative evidence sources. The Work Queue schedules recurring operation where configured; Evidence shows that operation occurred. A Control is ready for implementation only when each source System is active, has the required evidence role and current access owners, and includes repeatable retrieval instructions.

Instructions: Finish each applicable starter control with the procedure people will follow, its owner, scope, operation pattern, governing Policy and Requirement mappings, authoritative evidence source Systems, and implementation date. Put calendar and event schedules in Obligations. Confirm that each source is active, has the required evidence role and access owners, and includes repeatable retrieval instructions in Record Markdown.

Policy basis: Controls translate approved Policies and applicable Requirements into owned procedures that management can operate and prove. Policy text alone does not show implementation.

Timing: Before marking a Control implemented, record its owner, actual procedure in Record Markdown, system scope, operation pattern, authoritative evidence source Systems, and implementation date. Put every calendar or event schedule in a linked Obligation. Confirm each source System is active, has the evidence role required by the Control family and current access owners, and includes repeatable retrieval instructions in Record Markdown. filegrc-managed Controls also require enabled schedules with effective governing policies. Marking the Control implemented starts eligible schedules.

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
| `systemIds` | array of id | Conditional | References: `system` Required when `status` is `implemented`. |
| `evidenceSourceIds` | array of id | Conditional | Authoritative evidence sources References: `system` Required when `status` is `implemented`. |
| `policyIds` | array of id | No | References: `policy` |
| `effectiveOn` | date | Conditional | Required when `status` is `implemented`. |
| `retiredOn` | date | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `operationPattern` | enum | Yes | Operation pattern Values: `continuous`, `event-driven`, `scheduled`, `mixed` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `not-applicable`, `retired`. Allowed when `status` is one of `not-applicable`, `retired`. |

#### `control-test`

A test of one Control’s design or operation for a date or period, including method, population, samples, Evidence, result, and exceptions. Management-run Control Tests are not required for SOC 2 because the CPA firm tests independently.

Instructions: Record how an in-scope control was tested, what was sampled, the result, and any exceptions.

Policy basis: The information security policy requires management to monitor Controls. The CPA firm performs its own independent testing for the SOC 2 examination.

Timing: Plan from the Control operation pattern, linked Obligations, risk, and audit scope. Record the exact period or as-of date, link the complete population and sampled items when sampling applies, and complete review before relying on the result.

Default sources: `policy-information-security`

Path: `data/control-tests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `not-performed`, `canceled` |
| `controlId` | id | Yes | References: `control` |
| `testKinds` | array of string | Yes |  |
| `performedBy` | enum | Yes | Values: `management`, `internal-audit`, `service-auditor` |
| `outcome` | outcome | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `auditId` | id | No | References: `audit` |
| `testerIds` | array of id | No | References: `person` |
| `externalTester` | object (`external-tester`) | No |  |
| `sampleSize` | integer | No | Minimum: `0`. |
| `populationId` | id | No | References: `audit-population` |
| `sampleEvidenceIds` | array of id | No | References: `evidence` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `exceptionCount` | integer | No | Minimum: `0`. |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `reviewedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `completedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |
| `sourceCommit` | string | No |  |
| `notPerformedReason` | string | Conditional | Required when `status` is `not-performed`. |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `status` is `complete`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

At least one of `testerIds`, `externalTester` is required when `status` is `complete`.

### Governance

#### `appointment`

One person’s dated appointment to a named organizational or program responsibility, such as CISO, DPO, Policy Owner, or team chair. Use the Person job title for the person’s ordinary organizational position.

Instructions: Record one person’s dated appointment to a named organizational or program responsibility. Scope it to the workspace, a team, or the records governed by that appointment.

Policy basis: The information security policy assigns named authority and accountability, while workforce procedures require responsibility changes and departures to be reviewed and transferred.

Timing: Create when management assigns a named responsibility. End the Appointment and create a new one when the holder changes. Reassign every linked responsibility before a holder departs.

Default sources: `policy-information-security`, `policy-employee-handbook`

Path: `data/appointments/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `ended` |
| `appointmentKind` | string (id) | Yes | Appointment kind |
| `holderId` | id | Yes | Holder References: `person` |
| `scopeResourceIds` | array of id | Yes | Scope Relation group: `appointment-scope`. References: `workspace`, `person`, `service-account`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `startsOn` | date | Conditional | Required when `status` is one of `active`, `ended`. |
| `endsOn` | date | Conditional | Required when `status` is `ended`. |
| `appointedByIds` | array of id | No | Appointed by References: `person` |
| `responsibilities` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `ended`. Allowed when `status` is one of `ended`. |

#### `team`

Groups that share program responsibility, such as security oversight or incident response. Team records are not required for SOC 2 when named People hold the responsibilities directly.

Instructions: Review the starter Security and Risk Oversight team, including its members and chair. Membership and chairs are authoritative on the Team record.

Policy basis: The information security policy establishes security and risk oversight with independent review, while the continuity plan assigns response and recovery roles. Reviewers may be internal or external.

Timing: The security and risk oversight group meets at least quarterly. Update membership after responsibility or personnel changes, and preserve a chair who is separate from the policy owner.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

The UI labels the common `title` field as **Name**.

Path: `data/teams/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `inactive` |
| `purpose` | string | Yes |  |
| `memberIds` | array of id | Yes | References: `person` |
| `chairIds` | array of id | No | References: `person`, `appointment` |
| `charterDocumentId` | id | No | References: `document` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `inactive`. Allowed when `status` is one of `inactive`. |

#### `document`

Governed plans, charters, procedures, standards, reports, and templates that are not Policies or another filegrc record type. A general document catalog is not required for SOC 2.

Instructions: Tailor the governed plans and other supporting documents the program needs. Assign owners and approvers, then keep the approved Markdown in Git.

Policy basis: Policies rely on governed documents for detailed plans, procedures, charters, and reports. Git preserves the approved text and its revision history.

Timing: Follow the linked review Obligation. Starter governed documents are reviewed at least annually and after material changes or use, with an approver who is separate from the owner.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/documents/<id>.json`

Markdown companions:

- **Document**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `active`, `superseded`, `retired` |
| `documentKind` | string | Yes |  |
| `template` | boolean | No |  |
| `approverIds` | array of id | Conditional | References: `person` Must not overlap `ownerIds`. Required when `status` is one of `active`, `superseded`, `retired`. |
| `version` | string | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `active`, `superseded`, `retired`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `supersedesId` | id | No | References: `document` |
| `systemIds` | array of id | No | References: `system` |
| `controlIds` | array of id | No | References: `control` |
| `relatedDocumentIds` | array of id | No | References: `document` |
| `audience` | array of string | No |  |
| `acknowledgementRequired` | boolean | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `trainingIds` | array of id | No | Related training References: `training` |
| `classificationId` | string | No | Classification |
| `approvedContentRevisions` | object (`content-revisions`) | Conditional | Approved content revisions Managed by filegrc. Required when `status` is one of `active`, `superseded`, `retired`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |

#### `policy`

Management-approved rules for the program. Store the policy text in Markdown and its owner, separate approver, scope, status, dates, and linked Controls in the record.

Instructions: Tailor each policy to match how the organization works. Clear placeholders, assign an owner and separate approver, then record its approval and effective dates. Controls link to their governing Policies.

Policy basis: Policies state management’s required behavior. Controls, Obligations, Documents, Training, and Attestations put that behavior into operation and preserve proof.

Timing: Move a draft through review and approval, set the effective date, link its controls, and clear organization-specific placeholders before activation. The approver is usually internal and may be external, but must be separate from the owner and from the CPA auditor role. Review at least annually and after material changes.

Default sources: `policy-information-security`

Path: `data/policies/<id>.json`

Markdown companions:

- **Policy**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `in-review`, `approved`, `active`, `superseded`, `retired` |
| `approverIds` | array of id | Conditional | References: `person` Must not overlap `ownerIds`. Required when `status` is one of `in-review`, `approved`, `active`, `superseded`, `retired`. |
| `policyNumber` | string | No |  |
| `policyKind` | string | No |  |
| `version` | string | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `approved`, `active`, `superseded`, `retired`. Allowed when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `supersedesId` | id | No | References: `policy` |
| `parentPolicyId` | id | No | References: `policy` |
| `relatedPolicyIds` | array of id | No | References: `policy` |
| `relatedDocumentIds` | array of id | No | References: `document` |
| `requirementIds` | array of id | No | References: `requirement` |
| `audience` | array of string | No |  |
| `acknowledgementRequired` | boolean | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `approvedContentRevisions` | object (`content-revisions`) | Conditional | Approved content revisions Managed by filegrc. Required when `status` is one of `approved`, `active`, `superseded`, `retired`. Allowed when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |

#### `policy-review`

The result of a scheduled or change-driven review of Policies or governed Documents, including reviewers, decision, evidence, and follow-up. Edit the source record separately when changes are approved.

Instructions: Record scheduled and change-driven reviews of policies and governed documents, including the decision and any follow-up.

Policy basis: Each starter Policy and the continuity plan requires periodic review and another review after specified material changes.

Timing: Complete annually and after a triggering change, incident, disruption, or policy condition. Link the exact scope, reviewers, result, and evidence.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/policy-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `scopeResourceIds` | array of id | Yes | References: `policy`, `document` |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is one of `in-progress`, `complete`. |
| `outcome` | outcome | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `changesRequired` | boolean | No |  |
| `changeSummary` | string | No |  |
| `approverIds` | array of id | No | References: `person` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |
| `completedOn` | date | Conditional | Completed on Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

#### `attestation`

One person’s acknowledgement, training completion, certification, or assigned-work confirmation. Bind it to the exact content revision and signed Evidence when required.

Instructions: Record each person’s completion or acknowledgement against the exact policy or training revision.

Policy basis: The information security policy, data handling policy, and workforce materials require people to complete assigned training and acknowledge applicable responsibilities.

Timing: Assign during onboarding, within 30 days for security training, annually for recurring training, and after material content changes that require acknowledgement.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `policy-employee-handbook`

Path: `data/attestations/<id>.json`

Markdown companions:

- **Statement**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `pending`, `completed`, `waived` |
| `subjectResourceIds` | array of id | Yes | References: `policy`, `document`, `training`, `action-item` |
| `personId` | id | Yes | References: `person` |
| `attestationKind` | string | Yes |  |
| `assignedOn` | date | Yes |  |
| `dueOn` | date | No |  |
| `completedOn` | date | Conditional | Required when `status` is `completed`. Allowed when `status` is `completed`. |
| `attestationMethod` | enum | Conditional | Values: `git-approval`, `signed-document`, `external-record` Required when `status` is `completed`. Allowed when `status` is `completed`. |
| `contentRevisions` | object (`content-revisions`) | Conditional | Managed by filegrc. Required when `status` is `completed` and `attestationMethod` is `git-approval`. Allowed when `status` is `completed` and `attestationMethod` is `git-approval`. |
| `expiresOn` | date | No |  |
| `waivedByIds` | array of id | Conditional | References: `person` Required when `status` is `waived`. Allowed when `status` is `waived`. |
| `waiverReason` | string | Conditional | Required when `status` is `waived`. Allowed when `status` is `waived`. |
| `evidenceIds` | array of id | No | References: `evidence` |

At least one of `evidenceIds` is required when `status` is `completed` and `attestationMethod` is one of `signed-document`, `external-record`.

#### `meeting`

One governance meeting, including its chair, attendees, agenda, minutes, decisions, raised issues, Evidence, and assigned follow-up.

Instructions: Record required oversight meetings, including attendees, decisions, minutes, and follow-up work.

Policy basis: The information security policy requires recorded security and risk oversight. The continuity plan requires management review of exercises and unresolved risks.

Timing: Hold security and risk oversight meetings at least quarterly. Create one immutable meeting record and Markdown minutes for each occurrence.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/meetings/<id>.json`

Markdown companions:

- **Agenda**: `-agenda.md` beside the JSON record (optional).
- **Minutes**: `.md` beside the JSON record (required when `status` is `complete`).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `complete`, `canceled` |
| `teamId` | id | Yes | References: `team` |
| `chairIds` | array of id | Yes | References: `person` |
| `startedAt` | timestamp | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `endedAt` | timestamp | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `attendeeIds` | array of id | No | References: `person` |
| `externalAttendees` | array of object (`external-attendee`) | No |  |
| `decisionSummary` | string | No |  |
| `riskIds` | array of id | No | References: `risk` |
| `evidenceIds` | array of id | No | References: `evidence` |
| `scheduledFor` | date | Yes | Scheduled for |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

At least one of `attendeeIds`, `externalAttendees` is required when `status` is `complete`.

#### `training`

Reusable training content and assignment rules, including audience, trigger, completion window, passing criteria, and linked Policies and Controls. Obligations define assignment schedules. Individual completions belong in Attestations.

Instructions: Maintain the training content people must complete, along with its audience, timing, and passing requirements.

Policy basis: The information security and data handling policies require security training and added role-based training when a person’s responsibilities or data access warrant it.

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
| `completionWindowDays` | integer | No |  |
| `policyIds` | array of id | No | References: `policy` |
| `controlIds` | array of id | No | References: `control` |
| `passingCriteria` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `retired`. Allowed when `status` is one of `retired`. |

#### `data-request`

One privacy, contractual, or other data request tracked by opaque reference, with scope, due date, decision, Evidence, and completion. Data Request tracking is not required for a SOC 2 Security-only report.

Instructions: Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.

Policy basis: The data handling policy requires applicable requests to reach a responsible owner, meet the governing deadline, and keep erasable personal data out of immutable Git history.

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
| `dueOn` | date | Yes |  |
| `verifiedOn` | date | Conditional | Required when `status` is one of `in-progress`, `completed`, `denied`. |
| `scope` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `decision` | enum | Conditional | Values: `fulfilled`, `partially-fulfilled`, `denied` Required when `status` is one of `completed`, `denied`. |
| `decisionRationale` | string | Conditional | Required when `status` is `denied`. |
| `decidedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `completed`, `denied`. |
| `completedOn` | date | Conditional | Required when `status` is one of `completed`, `denied`, `canceled`. |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is one of `completed`, `denied`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Risk

#### `exception`

An approved, time-bound departure from a Policy or Control. Record its scope, reason, risk, compensating Controls, owner, approval, and expiry. An Exception record is not required for SOC 2 unless a departure is approved.

Instructions: Record and approve any time-limited departure from a policy or control before the departure begins.

Policy basis: The information security and data handling policies allow departures only with a business reason, assessed risk, compensating safeguards, approval, and an expiry or review date.

Timing: Approve before the departure begins, follow its linked review Obligation or expiry, and close or renew it through a new risk decision.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/exceptions/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `requested`, `approved`, `revoked`, `closed` |
| `scopeResourceIds` | array of id | Yes | Relation group: `obligation-scope`. References: `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit` |
| `requestorIds` | array of id | Yes | References: `person` |
| `rationale` | string | Yes |  |
| `riskIds` | array of id | No | References: `risk` |
| `requestedOn` | date | Yes |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `approval` | object (`exception-approval`) | Conditional | Required when `status` is one of `approved`, `revoked`, `closed`. Allowed when `status` is one of `approved`, `revoked`, `closed`. |
| `resolution` | object (`exception-resolution`) | Conditional | Required when `status` is one of `revoked`, `closed`. Allowed when `status` is one of `revoked`, `closed`. |

#### `risk`

One identified threat or business impact that needs treatment or ongoing tracking. Record its owner, ratings, response, affected scope, Controls, acceptance, and follow-up.

Instructions: Record each risk identified by an assessment or operating activity. Assign an owner, rate it, document the chosen response, and link the Controls that treat it from the Risk record.

Policy basis: The information security and data handling policies require identified Risks to have an owner, rating, treatment decision, target date, and time-bound approval when accepted.

Timing: Assess the register at least annually and after material changes. Review High and Critical risks at least quarterly and accepted risks by their review date.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/risks/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `open`, `monitoring`, `closed`, `archived` |
| `description` | string | Yes |  |
| `categories` | array of string | Yes |  |
| `response` | enum | Yes | Values: `avoid`, `mitigate`, `transfer`, `accept`, `monitor` |
| `inherentRating` | object (`risk-rating`) | Yes |  |
| `residualRating` | object (`risk-rating`) | No |  |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `controlIds` | array of id | No | References: `control` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `requirementIds` | array of id | No | References: `requirement` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `acceptance` | object (`risk-acceptance`) | Conditional | Required when `response` is `accept`. Allowed when `response` is `accept`. |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `closed`, `archived`. Allowed when `status` is one of `closed`, `archived`. |

#### `risk-assessment`

One approved evaluation of a defined scope using the program’s risk method. It records participants, Systems, Vendors, conclusions, Evidence, and the Risks created or reassessed.

Instructions: Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.

Policy basis: The information security and data handling policies require periodic and change-driven assessment of threats, assets, obligations, Controls, likelihood, impact, and treatment.

Timing: Complete at least annually and after a material change that could alter risk. Record new and changed risks instead of hiding them in the summary.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/risk-assessments/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `assessmentKind` | enum | Yes | Values: `enterprise-risk`, `system-risk`, `privacy-impact`, `vendor-risk`, `business-impact` |
| `scope` | string | Yes |  |
| `assessorIds` | array of id | Conditional | References: `person` Required when `status` is one of `in-progress`, `complete`. |
| `reviewerIds` | array of id | Conditional | References: `person` Must not overlap `assessorIds`. Required when `status` is `complete`. |
| `methodology` | string | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `trigger` | string | No |  |
| `attendeeIds` | array of id | No | References: `person` |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `commitmentIds` | array of id | No | References: `commitment` |
| `riskIds` | array of id | No | References: `risk` |
| `newRiskIds` | array of id | No | References: `risk` |
| `changedRiskIds` | array of id | No | References: `risk` |
| `summary` | string | Conditional | Required when `status` is `complete`. |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `approvedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `sourceCommit` | string | No |  |
| `scheduledFor` | date | No | Scheduled for |
| `completedOn` | date | Conditional | Completed on Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### People and Access

#### `person`

People who own, approve, review, or perform program work, or receive access and training. Record each person’s actual organization job title here and keep named program authority in dated Appointments. Keep detailed personnel records in the HR system.

Instructions: Record each person’s actual organizational job title. Keep named program authority, such as CISO, DPO, Policy Owner, or team chair, in dated Appointment records.

Policy basis: The information security policy and employee handbook assign work to named people and require onboarding, training, role-change, and offboarding records.

Timing: Create before assigning work or access, update the job title after organizational changes, review Appointments separately, and mark inactive only after active Appointments are ended or transferred. Training is due within 30 days of starting and annually.

Default sources: `policy-information-security`, `policy-employee-handbook`

The UI labels the common `title` field as **Name**.

Path: `data/people/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `inactive` |
| `email` | string (email) | No |  |
| `jobTitle` | string | No | Organization job title |
| `department` | string | No |  |
| `managerId` | id | No | References: `person` |
| `startDate` | date | No |  |
| `endDate` | date | No |  |
| `employmentType` | string | No |  |
| `organization` | string | No |  |
| `affiliation` | enum | Yes | Values: `internal`, `external` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `inactive`. Allowed when `status` is one of `inactive`. |

#### `service-account`

Non-human identities that need separate tracking. Record the account’s purpose, owner, Systems, authentication, privilege, review, and expiry here. A separate register is not required for SOC 2.

Instructions: Catalog non-human accounts that need separate tracking, including their owner, purpose, System, privilege, and expiry.

Policy basis: The information security policy requires important human and non-human identities to have an owner, protection, periodic review, and prompt removal when no longer needed.

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
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `disabled`, `retired`. Allowed when `status` is one of `disabled`, `retired`. |

#### `access-grant`

One Person’s or Service Account’s access to one System, including business need, privilege, request, approval, provisioning, expiry, removal, ticket, and Evidence.

Instructions: Record each person’s or service account’s access to a System, including approval, provisioning, changes, and removal.

Policy basis: The information security and data handling policies require unique identity, documented business need, least privilege, approval, authorized provisioning, and prompt removal.

Timing: Record every grant and material change. Remove access at or before notice for involuntary or high-risk departures and within 24 hours for other departures.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/access-grants/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `requested`, `approved`, `active`, `revoked`, `expired` |
| `subjectId` | id | Yes | References: `person`, `service-account` |
| `systemId` | id | Yes | References: `system` |
| `accessLevel` | string | Yes |  |
| `privileged` | boolean | Yes |  |
| `role` | string | No |  |
| `requestedOn` | date | Yes |  |
| `approvedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `approved`, `active`, `revoked`, `expired`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `approved`, `active`, `revoked`, `expired`. |
| `provisionedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `active`, `revoked`, `expired`. |
| `provisionedOn` | date | Conditional | Required when `status` is one of `active`, `revoked`, `expired`. |
| `expiresOn` | date | No |  |
| `deprovisionedByIds` | array of id | No | References: `person` |
| `deprovisionedOn` | date | Conditional | Required when `status` is one of `revoked`, `expired`. Allowed when `status` is one of `revoked`, `expired`. |
| `deprovisionReason` | string | Conditional | Required when `status` is one of `revoked`, `expired`. Allowed when `status` is one of `revoked`, `expired`. |
| `ticketReference` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |

#### `access-review`

One review of a defined access population for a date or period, including Systems, reviewers, Access Grant decisions, exceptions, approval, Evidence, and source revision.

Instructions: Review access on schedule, record each decision, and assign any access changes that result.

Policy basis: The information security and data handling policies require System owners to periodically confirm least privilege and remove dormant, expired, excessive, or unneeded access.

Timing: Review privileged and production access at least quarterly and other important-system access at least annually.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/access-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is one of `in-progress`, `complete`. |
| `systemIds` | array of id | Yes | References: `system` |
| `scope` | string | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `grantDecisions` | array of object (`access-grant-decision`) | No |  |
| `populationCount` | integer | No | Minimum: `0`. |
| `exceptionCount` | integer | No | Minimum: `0`. |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `approvedByIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `approvedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `sourceCommit` | string | No |  |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |
| `completedOn` | date | Conditional | Completed on Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Systems and Vendors

#### `system`

Applications, services, and platforms that support the scoped service, operate controls, or produce evidence. Record vendor-provided software as a System and link it to its Vendor. Before implementing a Control that relies on a System for evidence, add the System’s evidence source roles and access owners and document repeatable retrieval instructions in Record Markdown.

Instructions: Catalog all in-scope systems for the program. Treat anything that operates a control or produces evidence as a System, including software provided by a vendor (like HR software). Set vendorId on each vendor-provided System; the Vendor’s System list is derived. For every authoritative evidence source, set its source roles, name current access owners, and write repeatable retrieval instructions in Record Markdown before implementing the linked Controls.

Policy basis: The information security, data handling, and continuity policies require management to know which Systems are in scope, who owns them, what data they handle, how critical they are, and where evidence comes from.

Timing: Complete the in-scope inventory before policy approval and control implementation. For each authoritative evidence source, assign its source roles and current access owners, document the exact report, filters, date range, timezone, export format, and reconciliation steps in Record Markdown, and test retrieval before implementing the linked Controls. Review the inventory at least annually and after material architecture, data, vendor, service, recovery, or evidence-source changes.

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
| `dataTypes` | array of string | No |  |
| `internetExposed` | boolean | No |  |
| `parentSystemId` | id | No | References: `system` |
| `subserviceVendorIds` | array of id | No | References: `vendor` |
| `evidenceSourceKinds` | array of string | No | Evidence source roles |
| `evidenceOwnerIds` | array of id | No | Evidence access owners References: `person`, `team`, `appointment` |
| `continuityObjectives` | object (`continuity-objectives`) | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | string | No | Classification |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `deprecated`, `retired`. Allowed when `status` is one of `deprecated`, `retired`. |

#### `asset`

Important devices, media, software, records, and other items tracked through acquisition, custody, use, return, and disposal. Assets support controls but do not define the service boundary.

Instructions: Keep the inventory of important devices, software, media, and records current, including ownership, custody, and status.

Policy basis: The information security, mobile computing, and data handling policies require important assets to have owners and custodians, protection based on classification, and secure return or disposal.

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
| `custodianIds` | array of id | Yes | References: `person`, `team`, `appointment` |
| `businessPurpose` | string | No |  |
| `serialOrAssetTag` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `location` | string | No |  |
| `exceptionIds` | array of id | No | References: `exception` |
| `acquiredOn` | date | No |  |
| `retiredOn` | date | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | string | No | Classification |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `lost`, `retired`, `disposed`. Allowed when `status` is one of `lost`, `retired`, `disposed`. |

#### `vendor`

Provider companies and supplier relationships. Keep contracts, due diligence, subprocessors, continuity, and supplier risk here; record vendor software separately as Systems so Controls and Evidence can link to it.

Instructions: Catalog the companies that provide in-scope software or services. Link each vendor-provided System with the System’s vendorId.

Policy basis: The information security and data handling policies require an inventory of important providers, risk-based review before access or reliance, suitable contract terms, and ongoing monitoring.

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
| `dataTypes` | array of string | No |  |
| `subprocessor` | boolean | No |  |
| `standardAgreement` | boolean | No |  |
| `agreementDocumentId` | id | No | References: `document` |
| `backupVendorId` | id | No | References: `vendor` |
| `startDate` | date | No |  |
| `endDate` | date | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | string | No | Classification |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `deprecated`, `terminated`. Allowed when `status` is one of `deprecated`, `terminated`. |

#### `vendor-review`

One due-diligence or periodic review of a Vendor, covering the service, data, access, assurance, recovery, incidents, contracts, Risks, Evidence, and follow-up.

Instructions: Document due diligence before relying on a provider, then repeat the review on schedule or after a material change.

Policy basis: The information security and data handling policies require review before a Vendor handles sensitive data or supports important services, plus periodic review of higher-risk providers.

Timing: Complete before access, at least annually for Critical and High-risk vendors, and after material service changes or incidents.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/vendor-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is one of `in-progress`, `complete`. |
| `scope` | string | No |  |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `riskIds` | array of id | No | References: `risk` |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `status` is `complete`. |
| `decision` | enum | Conditional | Values: `approved`, `conditional`, `rejected` Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |
| `completedOn` | date | Conditional | Completed on Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `vendorId` | id | Yes | References: `vendor` |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Security Operations

#### `vulnerability`

One confirmed weakness that needs remediation, an approved Exception, or verified closure. A separate Vulnerability register is not required for SOC 2 when the scanner or ticket system retains complete, usable records.

Instructions: Track confirmed weaknesses that need separate remediation, acceptance, or closure.

Policy basis: The information security policy requires confirmed Vulnerabilities to receive owned, risk-based remediation or an approved Exception with compensating Controls.

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
| `exceptionId` | id | Conditional | References: `exception` Required when `status` is `risk-accepted`. Allowed when `status` is `risk-accepted`. |
| `remediatedOn` | date | Conditional | Required when `status` is one of `remediated`, `closed`. Allowed when `status` is one of `remediated`, `closed`. |
| `dispositionRationale` | string | Conditional | Required when `status` is `false-positive`. Allowed when `status` is `false-positive`. |
| `verifiedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `remediated`, `closed`, `false-positive`. |
| `verifiedOn` | date | Conditional | Required when `status` is one of `remediated`, `closed`, `false-positive`. |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is one of `remediated`, `closed`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |

#### `vulnerability-scan`

One vulnerability scan activity, including tool, scope, Systems, operator, time, result, resulting Vulnerabilities, Evidence, failure reason, and review.

Instructions: Record each required scan, including its scope, timing, result, and evidence.

Policy basis: The information security policy requires management to monitor for weaknesses and scan internet-facing and production Systems.

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
| `startedAt` | timestamp | No |  |
| `completedAt` | timestamp | Conditional | Required when `status` is one of `complete`, `failed`. Allowed when `status` is one of `complete`, `failed`. |
| `systemIds` | array of id | No | References: `system` |
| `resultSummary` | string | Conditional | Required when `status` is `complete`. |
| `findingCountBySeverity` | object (`integer-map`) | No |  |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `failureReason` | string | Conditional | Required when `status` is `failed`. Allowed when `status` is `failed`. |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `reviewedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |

#### `incident`

One suspected or confirmed security or privacy event, with severity, timeline, scope, owner, affected Systems and Vendors, Evidence, Findings, and corrective work. An Incident record is not required for SOC 2 when no incident occurred.

Instructions: Record qualifying security or privacy events and manage their response and follow-up.

Policy basis: The information security and data handling policies require prompt reporting, investigation, containment, recovery, evidence preservation, and review of notification duties.

Timing: Create on report or detection, update material events as they progress, and complete a retrospective within one week after a material incident.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/incidents/<id>.json`

Markdown companions:

- **Incident record and retrospective**: `.md` beside the JSON record (required when `status` is `closed`).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `suspected`, `declared`, `contained`, `eradicated`, `recovered`, `closed` |
| `severity` | rating | Yes |  |
| `detectedAt` | timestamp | Yes |  |
| `description` | string | Yes |  |
| `occurredAt` | timestamp | No |  |
| `declaredAt` | timestamp | Conditional | Required when `status` is one of `declared`, `contained`, `eradicated`, `recovered`, `closed`. |
| `containedAt` | timestamp | Conditional | Required when `status` is one of `contained`, `eradicated`, `recovered`, `closed`. |
| `recoveredAt` | timestamp | Conditional | Required when `status` is one of `recovered`, `closed`. |
| `closedAt` | timestamp | Conditional | Required when `status` is one of `closed`. |
| `reportedBy` | object (`person-reference`) | No |  |
| `detectionSource` | string | No |  |
| `systemIds` | array of id | No | References: `system` |
| `vendorIds` | array of id | No | References: `vendor` |
| `riskIds` | array of id | No | References: `risk` |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `closed`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | string | No | Classification |
| `eradicatedAt` | timestamp | Conditional | Required when `status` is one of `eradicated`, `recovered`, `closed`. |

#### `penetration-test`

One internal or external penetration test, including provider, scope, period, method, result, affected Systems, Evidence, Vulnerabilities, Findings, and review.

Instructions: Record each penetration test, including its provider, scope, period, result, and evidence.

Policy basis: The information security policy requires independent testing of the in-scope service’s external attack surface and tracked resolution of confirmed results.

Timing: Perform at least annually and reconsider scope after material attack-surface or architecture changes.

Default sources: `policy-information-security`

Path: `data/penetration-tests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `testKind` | string | Yes |  |
| `scope` | string | Yes |  |
| `provider` | string | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `systemIds` | array of id | No | References: `system` |
| `rulesOfEngagementDocumentId` | id | No | References: `document` |
| `methodology` | string | No |  |
| `resultSummary` | string | No |  |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `reviewedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `coverage` | object (`coverage-period`) | Yes | Coverage |
| `scheduledFor` | date | No | Scheduled for |
| `completedOn` | date | Conditional | Completed on Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Resilience

#### `exercise`

One continuity, recovery, incident, or privacy simulation, including scenario, objective, participants, scope, result, Evidence, Findings, and follow-up.

Instructions: Record each incident or continuity exercise, including its objective, participants, result, and follow-up.

Policy basis: The information security policy requires incident-response testing. The continuity plan requires exercises and another review after material change or disruption.

Timing: Test incident response and continuity at least annually. Repeat after a material change when the prior exercise no longer represents the environment.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/exercises/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `exerciseKind` | string | Yes |  |
| `facilitatorIds` | array of id | Yes | References: `person` |
| `scenario` | string | No |  |
| `objective` | string | No |  |
| `outcome` | outcome | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `participantIds` | array of id | No | References: `person` |
| `teamIds` | array of id | No | References: `team` |
| `systemIds` | array of id | No | References: `system` |
| `startedAt` | timestamp | No |  |
| `completedAt` | timestamp | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `scheduledFor` | date | Yes | Scheduled for |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

#### `backup-test`

One restore or recovery test, including the Systems and operators involved, timing, recovery result, reviewer, Evidence, Findings, and follow-up.

Instructions: Record each restore test, including the Systems tested, result, timing, evidence, and follow-up.

Policy basis: The information security policy and continuity plan require protected backups, monitored failures, and tested proof that important data can be restored and used.

Timing: Test restoration at least annually for important systems and after recovery changes that could invalidate prior evidence.

Default sources: `policy-information-security`, `document-business-continuity-disaster-recovery`

Path: `data/backup-tests/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `running`, `complete`, `canceled` |
| `systemIds` | array of id | Yes | References: `system` |
| `operatorIds` | array of id | Conditional | References: `person` Required when `status` is one of `running`, `complete`. |
| `outcome` | outcome | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `startedAt` | timestamp | No |  |
| `completedAt` | timestamp | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `recoveryTimeMinutes` | integer | No |  |
| `recoveryPointMinutes` | integer | No |  |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Evidence

#### `evidence`

External Evidence holds exports, reports, screenshots, signed files, and approved external references collected from other Systems. Step 4 records created in filegrc do not need a separate record here. Step 5 reviews and packages both evidence paths for the CPA firm.

Instructions: Create External Evidence when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source System, link the Controls and operating record it supports, retain the fixed artifact or reference, and have another person verify it before audit use.

Policy basis: The information security and data handling policies require retained proof from authoritative Systems when filegrc's own operating records do not contain the full result.

Timing: Create External Evidence only when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source System, link the Controls and operating record it supports, record collection facts, verify it before audit use, cover the stated date or period, and retain it according to classification and record rules.

Default sources: `policy-information-security`, `policy-data-protection-handling`

Path: `data/evidence/<id>/evidence.json`

Markdown companions:

- **Evidence**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `collected`, `verified`, `withdrawn` |
| `artifactKind` | enum | Yes | Values: `population-export`, `system-export`, `configuration-export`, `capture`, `signed-record`, `third-party-report`, `rendered-page`, `business-record`, `other` |
| `artifactSubtype` | string | No |  |
| `sourceKind` | enum | Yes | Values: `system`, `file`, `external-reference`, `rendered-page`, `authored-record` |
| `sourceDescription` | string | Conditional | Required when `status` is one of `collected`, `verified`, `withdrawn`. |
| `collectedOn` | date | Conditional | Required when `status` is one of `collected`, `verified`, `withdrawn`. |
| `generatedAt` | timestamp | Conditional | Generated at Required when `artifactKind` is `population-export`. |
| `timezone` | string (timezone) | Conditional | Report timezone Required when `artifactKind` is `population-export`. |
| `queryDescription` | string | Conditional | Query or report parameters Required when `artifactKind` is `population-export`. |
| `populationCount` | integer | Conditional | Population count Minimum: `0`. Required when `artifactKind` is `population-export`. |
| `completenessValidation` | string | Conditional | Completeness validation Required when `artifactKind` is `population-export`. |
| `accuracyValidation` | string | Conditional | Accuracy validation Required when `artifactKind` is `population-export`. |
| `systemIds` | array of id | No | References: `system` |
| `controlIds` | array of id | No | References: `control` |
| `auditIds` | array of id | No | References: `audit` |
| `collectorIds` | array of id | Conditional | References: `person` Required when `status` is one of `collected`, `verified`, `withdrawn`. |
| `verifierIds` | array of id | Conditional | References: `person` Required when `status` is `verified`. |
| `verifiedOn` | date | Conditional | Required when `status` is `verified`. |
| `expiresOn` | date | No |  |
| `sourceResourceIds` | array of id | No | Relation group: `evidence-source-record`. References: `document`, `obligation`, `obligation-event`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `filePaths` | array of data-path | Conditional | Required when `sourceKind` is `file` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is one of `file`, `system`, `rendered-page`, `authored-record`. |
| `externalReference` | object (`external-reference`) | Conditional | Required when `sourceKind` is `external-reference` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is one of `external-reference`, `system`. |
| `sourceSystemId` | id | Conditional | Source system References: `system` Required when `sourceKind` is `system` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is one of `system`, `rendered-page`. |
| `sourceCommit` | string | Conditional | Required when `sourceKind` is `rendered-page` and `status` is one of `collected`, `verified`, `withdrawn`. |
| `capture` | object (`page-capture`) | Conditional | Required when `sourceKind` is `rendered-page` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is `rendered-page`. |
| `classificationId` | string | Conditional | Classification Required when `status` is one of `collected`, `verified`, `withdrawn`. |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `artifactKind` is `population-export`. |
| `withdrawal` | object (`withdrawal`) | Conditional | Required when `status` is `withdrawn`. Allowed when `status` is `withdrawn`. |

At least one of **content Markdown** is required when `sourceKind` is `authored-record` and `status` is one of `collected`, `verified`, `expired`, `withdrawn`.

### Issues and Remediation

#### `obligation`

Reusable schedules for recurring or event-driven work. Obligations feed the Work Queue; completion records and linked Evidence prove that the work occurred. Obligations are not required for SOC 2.

Instructions: Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.

Policy basis: filegrc uses Obligations to turn policy and control cadence into owned, dated work linked to its scope and required proof.

Timing: Treat starter work as proposed until every governing policy is active and effective and, when the obligation names controls, at least one linked control is implemented. Then use the recurrence and activation date, and create a separate completion record for every period.

Default sources: `policy-information-security`, `policy-data-protection-handling`, `document-business-continuity-disaster-recovery`

Path: `data/obligations/<id>.json`

Markdown companions:

- **Instructions**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `paused`, `retired` |
| `activityType` | enum | Yes | Values: `access-change`, `access-provisioning`, `access-removal`, `access-review`, `alert-path-test`, `asset-recovery`, `asset-registration`, `backup-test`, `change-review`, `continuity-review`, `document-review`, `exception-review`, `exercise`, `incident-retrospective`, `inventory-review`, `log-review`, `meeting`, `network-review`, `oversight-meeting`, `penetration-test`, `performance-review`, `personal-device-approval`, `policy-review`, `remediation`, `retention-review`, `risk-assessment`, `role-training`, `security-scan`, `training`, `vendor-contract`, `vendor-remediation`, `vendor-review`, `vulnerability-scan`, `workforce-acknowledgement` Values come from the `obligationActivities` registry. |
| `recurrence` | object (`recurrence`) | Yes |  |
| `triggerPrompt` | string | No |  |
| `window` | object (`obligation-window`) | No |  |
| `scopeResourceIds` | array of id | No | Relation group: `obligation-scope`. References: `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit` |
| `templateResourceId` | id | No | Relation group: `obligation-template`. References: `person`, `system`, `asset`, `document`, `control`, `policy`, `training` |
| `controlIds` | array of id | No | References: `control` |
| `policyIds` | array of id | No | References: `policy` |
| `startsOn` | date | No |  |
| `endsOn` | date | No |  |
| `completionResourceIds` | array of id | No | Relation group: `completion-record`. References: `access-grant`, `asset`, `control`, `document`, `evidence`, `control-test`, `finding`, `exception`, `action-item`, `policy-review`, `policy`, `attestation`, `meeting`, `risk-assessment`, `risk`, `vendor`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `audit-request` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `paused`, `retired`. Allowed when `status` is one of `paused`, `retired`. |

#### `obligation-event`

One occurrence of an event such as hiring, departure, material change, or incident. It connects the event to the checklist generated from applicable Obligations. Policy Events are not required for SOC 2.

Instructions: When a policy-triggering event occurs, record it here and complete the actions filegrc creates for it.

Policy basis: Policies require specific, time-bound actions after certain events. A Policy Event preserves the trigger, applicable checklist, owners, and completion state.

Timing: Create when the event occurs or is scheduled. Complete every generated action within its policy window, then close the event.

Path: `data/obligation-events/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `complete`, `canceled` |
| `eventType` | string | Yes |  |
| `occurredOn` | date | Yes |  |
| `occurredAt` | timestamp | No |  |
| `subjectResourceIds` | array of id | No | Relation group: `event-subject`. References: `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `policy`, `training`, `vendor`, `access-grant`, `vulnerability`, `incident` |
| `obligationIds` | array of id | Yes | References: `obligation` |
| `completedOn` | date | Conditional | Required when `status` is `complete`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

#### `finding`

A confirmed gap that needs tracking after a control test, review, risk assessment, security test, incident review, management meeting, or audit. Keep observations and report details in the source record’s Markdown. Create a Finding only when the gap needs its own owner, due date, remediation state, or verified closure. A Finding record is not required for SOC 2 when no confirmed gap needs tracking.

Instructions: Create a Finding only for a confirmed gap that needs separate remediation tracking. Keep the report details in the source record’s Markdown, then assign the Finding, set its due date, and verify closure.

Policy basis: The information security policy requires confirmed issues from monitoring, audits, incidents, scans, and reviews to remain tracked until corrective action is verified.

Timing: Create only after management confirms the gap. Use the Finding itself for straightforward remediation, add Action Items only for separate assigned tasks, and close only after remediation is verified.

Default sources: `policy-information-security`

Path: `data/findings/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `accepted`, `remediating`, `resolved`, `closed` |
| `severity` | rating | Yes |  |
| `sourceResourceId` | id | Yes | Relation group: `work-source`. References: `control`, `control-test`, `finding`, `exception`, `obligation`, `obligation-event`, `policy-review`, `meeting`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `description` | string | Yes |  |
| `controlIds` | array of id | No | References: `control` |
| `riskIds` | array of id | No | References: `risk` |
| `exceptionId` | id | Conditional | References: `exception` Required when `status` is `accepted`. Allowed when `status` is `accepted`. |
| `systemIds` | array of id | No | References: `system` |
| `identifiedOn` | date | No |  |
| `dueOn` | date | Conditional | Required when `status` is one of `open`, `remediating`, `resolved`. |
| `evidenceIds` | array of id | No | References: `evidence` |
| `resolvedOn` | date | Conditional | Required when `status` is one of `resolved`, `closed`. |
| `verifiedByIds` | array of id | Conditional | References: `person` Required when `status` is `closed`. |
| `verifiedOn` | date | Conditional | Required when `status` is `closed`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |

#### `action-item`

One owned, dated follow-up task linked to the Finding, Policy Event, Risk, Incident, review, test, meeting, Exception, or request that created it. Action Items appear in Work Queue. Use one only when work needs separate assignment, timing, and completion proof. A separate Action Item tracker is not required for SOC 2.

Instructions: Create an Action Item only when follow-up needs its own assignee, deadline, and completion proof. Point it to the record that created the work, then work it from Work Queue.

Policy basis: Policies require material issues and review decisions to produce owned, dated corrective work with proof of completion.

Timing: Create when separate follow-up is assigned. Set a deadline, work it from Work Queue, record blockers, and link completion evidence before closing.

Path: `data/action-items/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `in-progress`, `blocked`, `done`, `canceled` |
| `assigneeIds` | array of id | Yes | References: `person`, `team`, `appointment` |
| `sourceResourceId` | id | Yes | Relation group: `work-source`. References: `control`, `control-test`, `finding`, `exception`, `obligation`, `obligation-event`, `policy-review`, `meeting`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `description` | string | No |  |
| `priority` | rating | No |  |
| `obligationId` | id | No | References: `obligation` |
| `completedOn` | date | Conditional | Required when `status` is `done`. |
| `evidenceIds` | array of id | No | References: `evidence` |
| `completionResourceIds` | array of id | No | Relation group: `completion-record`. References: `access-grant`, `asset`, `control`, `document`, `evidence`, `control-test`, `finding`, `exception`, `action-item`, `policy-review`, `policy`, `attestation`, `meeting`, `risk-assessment`, `risk`, `vendor`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `audit-request` |
| `blockingResourceIds` | array of id | No | Relation group: `work-blocker`. References: `person`, `appointment`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request` |
| `completionWindow` | object (`completion-window`) | Conditional | Completion window Required when `status` is one of `open`, `in-progress`, `blocked`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Audits

#### `audit`

One real SOC 2 engagement with a CPA firm, including the auditor-agreed scope and period, requests, fieldwork, Findings, opinion, and final report. Management’s candidate dates remain on the Workspace.

Instructions: Create this record after engaging the CPA firm, then record the agreed scope, criteria, Systems, and report period. Control Tests and External Evidence link back with auditId or auditIds.

Policy basis: A CPA firm independently examines the scoped service against the selected Framework. Management supplies the system description, Controls, operating records, and Evidence.

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
| `auditorVendorId` | id | Conditional | References: `vendor` Required when `status` is one of `in-progress`, `fieldwork`, `complete`. |
| `fieldworkStart` | date | Conditional | Required when `status` is one of `fieldwork`, `complete`. |
| `fieldworkEnd` | date | Conditional | Required when `status` is one of `fieldwork`, `complete`. |
| `reportDate` | date | Conditional | Required when `status` is `complete`. |
| `systemIds` | array of id | No | References: `system` |
| `requirementIds` | array of id | No | References: `requirement` |
| `controlIds` | array of id | No | References: `control` |
| `contactIds` | array of id | No | References: `person` |
| `systemDescriptionDocumentId` | id | No | References: `document` |
| `managementAssertionDocumentId` | id | No | References: `document` |
| `periodCompletenessDocumentId` | id | No | References: `document` |
| `managementRepresentationDocumentId` | id | No | References: `document` |
| `complementaryControlIds` | array of id | No | References: `complementary-control` |
| `complementaryControlsConclusion` | enum | No | Complementary controls conclusion Values: `identified`, `not-applicable` |
| `subserviceVendorIds` | array of id | No | References: `vendor` |
| `subserviceMethod` | enum | No | Values: `carve-out`, `inclusive`, `not-applicable` |
| `opinion` | enum | Conditional | Values: `unmodified`, `qualified`, `adverse`, `disclaimer`, `not-issued` Required when `status` is `complete` and `auditKind` is one of `soc-2-type-1`, `soc-2-type-2`. |
| `opinionDate` | date | Conditional | Required when `status` is `complete` and `auditKind` is one of `soc-2-type-1`, `soc-2-type-2`. |
| `reportEvidenceId` | id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `managementResponseDocumentId` | id | No | References: `document` |
| `supplementalDocumentIds` | array of id | No | References: `document` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `status` is one of `in-progress`, `fieldwork`, `complete`. |

#### `audit-population`

One complete set of control-relevant events or items for a Type 2 period, with its source System, exact query, count, reconciliation, and fixed export, including zero-event populations.

Instructions: Record each complete Type 2 population with its source System, fixed export, query, count, and reconciliation.

Policy basis: The CPA firm needs complete and accurate populations to select samples and test Controls. The linked population-export Evidence preserves the exact source set management supplied.

Timing: Plan at the start of the engagement, export for the exact audit period, reconcile before fieldwork, and retain proof for zero-event populations.

Path: `data/audit-populations/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `reconciled`, `not-applicable` |
| `auditId` | id | Yes | References: `audit` |
| `populationKind` | string | Yes |  |
| `controlIds` | array of id | No | References: `control` |
| `sourceSystemId` | id | Conditional | Authoritative source system References: `system` Required when `status` is `reconciled`. |
| `sourceEvidenceId` | id | Conditional | References: `evidence` Required when `status` is `reconciled`. |
| `reconciledByIds` | array of id | Conditional | References: `person` Required when `status` is `reconciled`. |
| `reconciledOn` | date | Conditional | Required when `status` is `reconciled`. |
| `conclusion` | enum | Conditional | Values: `complete`, `complete-with-exceptions`, `incomplete` Required when `status` is `reconciled`. |
| `reconciliationSummary` | string | No |  |
| `notApplicableReason` | string | Conditional | Required when `status` is `not-applicable`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `coverage` | object (`coverage-period`) | Yes | Coverage |

#### `audit-request`

One auditor request or prepared-by-client item, with its Audit, owner, due date, approved response, Requirements, Controls, Evidence, and follow-up. A separate Audit Request tracker is not required for SOC 2 when the CPA firm’s portal is authoritative.

Instructions: Record each request from the audit team, assign an owner and due date, and link the approved response and evidence.

Policy basis: Audit Requests turn fieldwork into owned, dated deliverables and preserve the exact response and Evidence supplied to the CPA firm.

Timing: Create on receipt, assign immediately, meet the auditor due date, bind evidence to the requested period and Git revision, and close only after acceptance.

Path: `data/audit-requests/<id>.json`

Markdown companions:

- **Response**: `.md` beside the JSON record (required when `status` is one of `submitted`, `accepted`, `needs-follow-up`, `closed`).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `in-progress`, `submitted`, `accepted`, `needs-follow-up`, `closed` |
| `auditId` | id | Yes | References: `audit` |
| `requestReference` | string | Yes |  |
| `description` | string | Yes |  |
| `requestedOn` | date | Yes |  |
| `dueOn` | date | Yes |  |
| `submittedOn` | date | Conditional | Required when `status` is one of `submitted`, `accepted`, `needs-follow-up`, `closed`. |
| `closedOn` | date | Conditional | Required when `status` is `closed`. |
| `requirementIds` | array of id | No | References: `requirement` |
| `controlIds` | array of id | No | References: `control` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is one of `submitted`, `accepted`, `needs-follow-up`, `closed`. |
| `auditorNotes` | string | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `coverage` | object (`coverage-period`) | No | Coverage |
| `acceptedOn` | date | Conditional | Required when `status` is one of `accepted`, `closed`. |
| `acceptedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `accepted`, `closed`. |

### Repository

#### `workspace`

Settings shared across the program: organization, SOC 2 goal, candidate period, scope, time zone, risk method, and data classifications.

Instructions: Settings shared across the program: organization, SOC 2 goal, candidate period, scope, time zone, risk method, and data classifications.

Policy basis: Policies, risk assessments, evidence checks, and readiness calculations use this scope and these methods. Candidate dates let management preserve evidence before the CPA firm agrees to the audit period.

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
| `assuranceGoal` | enum | No | Program goal Values: `none`, `readiness`, `soc-2-type-1`, `soc-2-type-2` |
| `frameworkIds` | array of id | No | Program frameworks References: `framework` |
| `requirementIds` | array of id | No | Program requirements References: `requirement` |
| `controlIds` | array of id | No | Program controls References: `control` |
| `systemIds` | array of id | No | Program systems References: `system` |
| `riskMethodology` | object (`risk-methodology`) | No | Risk methodology |
| `classificationDefinitions` | object (`string-map`) | No | Classifications |
| `candidateCoverage` | object (`coverage-period`) | No | Management candidate coverage |

#### `renderer-settings`

Optional local interface and browser repository settings, including onboarding visibility, manually completed Step pages, and authoritative-branch synchronization. Renderer settings are not required for SOC 2 and do not change compliance records.

Instructions: Optional local interface and browser repository settings, including onboarding visibility, manually completed Step pages, and authoritative-branch synchronization. Renderer settings are not required for SOC 2 and do not change compliance records.

Policy basis: Renderer settings are a filegrc convenience, not a SOC 2 requirement, control, audit record, or substitute for evidence. Record lifecycle status represents approval; Git branches do not.

Timing: Change it when the team wants to rerun or suppress an optional renderer workflow or change repository synchronization.

Path: `data/renderer.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `showOnboarding` | boolean | Yes | Show onboarding |
| `completedStagePageIds` | array of string | No | Manually completed program pages |
| `repositoryMode` | enum | Yes | Repository mode Values: `trunk`, `manual` |
| `authoritativeBranch` | string (git-name) | Yes | Authoritative branch |
| `repositoryRemote` | string (git-name) | Yes | Repository remote |
