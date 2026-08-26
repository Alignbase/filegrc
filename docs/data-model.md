# GRC Data Model

<!-- Generated from packages/filegrc/model/v9.json. Do not edit by hand. -->

Model version: `9`

Model v9 adds reviewed Obligation rule revisions, rolled-up occurrence reconciliation, temporal Collection Reviews, and effective reporting routes to the model v8 program structure.

Each structured resource is one UTF-8 JSON file. Long-form work is an implicit Markdown companion beside that JSON file. Git supplies file authors, timestamps, diffs, commit messages, and revisions, so records do not duplicate those fields or file paths.

## Program path

The renderer, CLI, generated agent instructions, and this reference use the same five-step lifecycle:

### Step 1. Define Scope

Name the owners, criteria, service, Systems, and providers in scope.

- **People** (`person`): Record each person’s actual organizational job title. Keep named program authority, such as CISO, DPO, Policy Owner, or team chair, in dated Appointment records.
- **Appointments** (`appointment`): Record one person’s dated appointment to a named organizational or program responsibility. Scope it to the workspace, a team, or the records governed by that appointment.
- **Teams** (`team`): Review the starter Security and Risk Oversight team, including its members and chair. Membership and chairs are authoritative on the Team record.
- **Programs** (`program`): Define one management compliance or assurance Program with its goal, bounded Systems, selected Frameworks, Requirement applicability decisions, Controls, owners, risk method, and candidate period.
- **Frameworks** (`framework`): Confirm the criteria framework and version used for the program.
- **Requirements** (`requirement`): Keep the published criterion as catalog content. Record management applicability and rationale on the selected Program.
- **Commitments** (`commitment`): Record supplemental customer promises and service requirements that shape the scope or control design. The Commitment’s systemIds and controlIds are authoritative for what fulfills it.
- **Requirement Mappings** (`requirement-mapping`): Record a reviewed relationship among Requirements, Commitments, and Controls. Choose the comparison method and relationship explicitly, explain the rationale, and bind the review to every mapped source revision.
- **Systems** (`system`): Start with the complete bounded System management governs or the auditor will examine. Record its purpose, services, boundary, exclusions, Information Types, owners, and any applicable continuity objectives.
- **Components** (`component`): Add a Component only when it materially delivers a selected System, supports a Control, produces authoritative Evidence, or supports relevant operations. Give every System use a role and rationale.
- **Vendors** (`vendor`): Catalog material external provider relationships. Link a supplied Component when it meets the Component inclusion rules, but do not mirror every Vendor into a Component.
- **Classifications** (`classification`): Define an ordered information-handling category used by inventory and Evidence Artifacts.
- **Information Types** (`information-type`): Define a stable category of information and its default Classification, then link it from Systems, Components, and Vendors.

Headless commands:

- `npx filegrc setup`
- `npx filegrc guide person --json`
- `npx filegrc guide appointment --json`
- `npx filegrc guide system --json`
- `npx filegrc guide component --json`
- `npx filegrc guide requirement-mapping --json`
- `npx filegrc review-collection vendor --scaffold`
- `npx filegrc review-collection information-type --scaffold`
- `npx filegrc list system --json`

### Step 2. Approve Policies

Review and independently approve Policies, program Documents, and Training content.

- **Policies** (`policy`): Tailor each Policy to match what the company is committing to. Clear placeholders, assign an owner and separate approver, then bind approval to the reviewed content. Approval does not prove implementation. Activate the Policy during the Step 3 cutover after reviewing its implementation gaps.
- **Documents** (`document`): Complete required program Documents in Step 2, assign an owner and separate approver, and bind approval to the intended values and exact Markdown. Implement the linked requirements and activate that approved revision in Step 3. Prepare Audit Documents in Step 5.
- **Training** (`training`): Review and approve the exact Training content in Step 2, then activate the unchanged revision during Step 3 after its linked Controls and assignment Obligations are ready.

Headless commands:

- `npx filegrc guide policy --json`
- `npx filegrc guide document --json`
- `npx filegrc guide training --json`
- `npx filegrc list policy --json`
- `npx filegrc list document --json`
- `npx filegrc list training --json`
- `npx filegrc get POLICY_ID --mutation`

### Step 3. Implement Controls

Describe each Control and connect its evidence source.

- **Controls** (`control`): Finish each applicable starter Control with the procedure people follow, its owner, bounded System scope, operating Components, authoritative evidence-source Components, governing Policy and Requirement mappings, and implementation date. Put calendar and event schedules in Obligations.
- **Complementary controls** (`complementary-control`): Review whether any in-scope Control depends on a customer or carved-out provider action. Record each real dependency, or confirm that the current scope has none.
- **Retention Schedule Items** (`retention-schedule-item`): Use one structured row for each reviewed retention rule. Name its Information Types, scope, cutoff, period, disposition, sources, owner, and approval. Keep unknown organization values planned for management review.
- **Obligations** (`obligation`): Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.

Headless commands:

- `npx filegrc guide control --json`
- `npx filegrc list control --json`
- `npx filegrc get CONTROL_ID --mutation`
- `npx filegrc guide obligation --json`
- `npx filegrc guide retention-schedule-item --json`
- `npx filegrc review-collection retention-schedule-item --scaffold`
- `npx filegrc list obligation --json`
- `npx filegrc review-collection component --scaffold`
- `npx filegrc review-collection complementary-control --scaffold`
- `npx filegrc activate-content --scaffold`
- `npx filegrc activate-policies --scaffold`
- `npx filegrc evidence-map --json`
- `npx filegrc program-readiness --json`

### Step 4. Operate the Program

Complete scheduled and event work. Keep dated proof.

- **Policy Events** (`utility:policy-events`): Trigger the matching workflow when an event occurs. filegrc adds every required action to the Work Queue with its owner and deadline.
- **Work Queue** (`utility:work-queue`): Complete recurring work, Policy Event tasks, and assigned Action Items within their allowed windows, link the requested dated proof, and resolve overdue items.

Operating record guides:

- **Risk assessments** (`risk-assessment`): Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.
- **Risks** (`risk`): Record each risk identified by an assessment or operating activity. Assign an owner, rate it, document the chosen response, and link the Controls that treat it from the Risk record.
- **Policy Events** (`obligation-event`): When a policy-triggering event occurs, record it here and complete the actions filegrc creates for it.
- **Data requests** (`data-request`): Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.
- **Evidence Artifacts** (`evidence`): Create an Evidence Artifact when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source Component, link the Controls and operating records it supports, retain the fixed artifact or reference, and have another person verify it before audit use.
- **Policy reviews** (`policy-review`): Record scheduled and change-driven reviews of policies and governed documents, including the decision and any follow-up.
- **Meetings** (`meeting`): Record required oversight meetings, including attendees, decisions, minutes, and follow-up work.
- **Exceptions** (`exception`): Record and approve any time-limited departure from a policy or control before the departure begins.
- **Assets** (`asset`): Keep the inventory of important devices, software, media, and records current, including ownership, custody, and status.
- **Vendor reviews** (`vendor-review`): Document due diligence before relying on a provider, then repeat the review on schedule or after a material change.
- **Service accounts** (`service-account`): Catalog non-human accounts that need separate tracking, including their owner, purpose, System, privilege, and expiry.
- **Access grants** (`access-grant`): Record each person’s or service account’s access to a Component, including approval, provisioning, changes, and removal.
- **Access reviews** (`access-review`): Review access on schedule, record each decision, and assign any access changes that result.
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
- `npx filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD`
- `npx filegrc complete OBLIGATION_ID completion-mutation.json --json`
- `npx filegrc complete-action ACTION_ITEM_ID --scaffold --completed-on YYYY-MM-DD`
- `npx filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD --json`
- `npx filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD --expected-revision REVISION --json`
- `npx filegrc program-readiness --json`

### Step 5. Audit

Track the CPA engagement, fieldwork, and evidence packet.

- **Audits** (`audit`): Create this record after engaging the CPA firm, then select the Program and record the agreed scope, criteria, Systems, subservice treatments, and report period. Control Tests and Evidence Artifacts link back with auditId or auditIds.
- **Audit requests** (`audit-request`): When FileGRC is the approved request tracker, record each request from the audit team, assign an owner and due date, and link the approved response and evidence.
- **Audit populations** (`audit-population`): Record each complete Type 2 population with its source Component, fixed export, query, count, and reconciliation.
- **Control tests** (`control-test`): Record a management Control Test only when management performs and reviews one. The CPA firm records its own independent testing separately.
- **Audit Evidence & Packet** (`utility:audit-packet`): Review FileGRC operating records and Evidence Artifacts for the formal period, complete engagement preparation, and build the indexed audit packet.

Headless commands:

- `npx filegrc guide audit --json`
- `npx filegrc scaffold audit --title "YEAR SOC 2 TYPE"`
- `npx filegrc create AUDIT-MUTATION.json --json`
- `npx filegrc prepare-audit AUDIT_ID --json`
- `npx filegrc audit-readiness AUDIT_ID --json`
- `npx filegrc evidence-packet --audit AUDIT_ID --preview --json`

## Relation groups

Relationship fields use the named groups below. The registry expands each group to explicit resource types, so no relationship accepts an unrestricted wildcard.

| Group | Resource types |
| --- | --- |
| `accountable-party` | `person`, `team`, `appointment` |
| `appointment-scope` | `workspace`, `person`, `service-account`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
| `obligation-scope` | `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit`, `source-coverage`, `retention-schedule-item`, `requirement-mapping`, `component`, `information-type` |
| `obligation-template` | `person`, `system`, `asset`, `document`, `control`, `policy`, `training`, `retention-schedule-item`, `requirement-mapping` |
| `completion-record` | `access-grant`, `asset`, `control`, `document`, `evidence`, `control-test`, `finding`, `exception`, `action-item`, `policy-review`, `policy`, `attestation`, `meeting`, `risk-assessment`, `risk`, `vendor`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping` |
| `event-subject` | `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `policy`, `training`, `vendor`, `access-grant`, `vulnerability`, `incident` |
| `evidence-source-record` | `document`, `obligation`, `obligation-event`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
| `work-source` | `control`, `control-test`, `finding`, `exception`, `obligation`, `obligation-event`, `policy-review`, `meeting`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
| `work-blocker` | `person`, `appointment`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |

## Collection review confirmations

FileGRC derives record issues, but it cannot infer that management reviewed an apparently complete or empty collection. Each configured collection review records the conclusion, reviewer, date, current scope revision, and exact collection revision. A record or material scope change makes the confirmation stale.

| Resource type | Review | Allowed conclusions | What to review |
| --- | --- | --- | --- |
| `person` | Program participants | `complete` | Think through who actually owns, approves, operates, reviews, or supports the program, and add anyone missing. Confirm each person's current job title, affiliation, and status. |
| `framework` | Framework and criteria sources | `complete` | Confirm the selected Trust Services Categories match the service and planned audit. Confirm any other legal, contractual, privacy, or security framework the service must follow. Confirm the framework edition expected for the audit. |
| `vendor` | Vendor inventory | `complete`, `zero-population`, `externally-managed` | Add Vendors for material external commercial or service relationships. Confirm contracts, due diligence, criticality, information access, and monitoring. Do not mirror every Vendor into a Component or infer audit subservice treatment. |
| `system` | Bounded System scope | `complete` | Start with the service management governs or the auditor will examine. Confirm its purpose, services, boundary, exclusions, owners, and Information Types. Do not list applications, platforms, providers, or devices as separate Systems when they are Components, Vendors, or Assets. |
| `complementary-control` | Customer and provider responsibilities | `complete`, `zero-population` | Think through the customer and carved-out provider actions that in-scope Controls depend on, and add any missing Complementary Control. Confirm each statement names a specific action, responsible party, affected System, and dependent Control. Use zero population only when no in-scope Control depends on a customer or carved-out provider action. |
| `component` | Scoped Components | `complete`, `zero-population` | Start with each bounded System and include only Components that deliver its service, support Controls, produce authoritative Evidence, or support relevant operations. Confirm every System use has the right role and a specific rationale. Keep unrelated corporate tools and Vendor relationships outside the reviewed population. |
| `information-type` | Information Type inventory | `complete`, `zero-population` | Review near-duplicate names and choose one canonical Information Type only after confirming they mean the same thing. Retire superseded records through a reviewed migration that rewrites every relationship. Confirm every active Information Type has an approved classification and a retention schedule item or an explicit management-review prompt. |
| `retention-schedule-item` | Retention schedule | `complete`, `zero-population` | Confirm schedule coverage across Systems, Components, Vendors, source families, logs, backups, audit records, and the FileGRC repository. Confirm every active item has an approved cutoff, retention period, disposition action, owner, approver, and exact reviewed source revisions. Keep undecided periods and disposition behavior planned for management review. |

## Relationship constraints

Relationship constraints prevent cycles and duplicate active authority or access records.

- `person.managerId` must be acyclic.
- `requirement.parentRequirementId` must be acyclic.
- `commitment.supersedesId` must be acyclic.
- `policy.parentPolicyId` must be acyclic.
- `policy.supersedesId` must be acyclic.
- `document.supersedesId` must be acyclic.
- `appointment` records in `active` must be unique by `appointmentKind`, `scopeResourceIds`.
- `access-grant` records in `active` must be unique by `subjectId`, `componentId`, `accessLevel`, `role`, `privileged`.
- `collection-review` records in `active` must be unique by `resourceType`, `scopeResourceIds`.

## Obligation activities

The model owns each activity name, allowed recurrence modes and scope types, its default completion record, and every record type that can prove completion.

| Activity | Title | Recurrence | Scope resource types | Default completion | Accepted completion records |
| --- | --- | --- | --- | --- | --- |
| `custom` | Custom activity | `calendar`, `event` | `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit`, `source-coverage`, `retention-schedule-item`, `requirement-mapping`, `component`, `information-type` | `evidence` | `evidence` |
| `access-change` | Access change | `event` | `person`, `service-account`, `system`, `component` | `access-grant` | `access-grant`, `evidence` |
| `access-provisioning` | Access provisioning | `event` | `person`, `service-account`, `system`, `component` | `access-grant` | `access-grant`, `evidence` |
| `access-removal` | Access removal | `event` | `person`, `service-account`, `system`, `component` | `access-grant` | `access-grant`, `evidence` |
| `access-review` | Access review | `calendar`, `event` | `system`, `service-account`, `team`, `component` | `access-review` | `access-review` |
| `alert-path-test` | Alert path test | `calendar`, `event` | `system`, `document`, `control`, `component` | `control-test` | `control-test`, `exercise`, `evidence` |
| `asset-recovery` | Asset recovery | `event` | `person`, `asset` | `asset` | `asset`, `evidence` |
| `asset-registration` | Asset registration | `event` | `person`, `asset` | `asset` | `asset`, `evidence` |
| `backup-test` | Backup test | `calendar`, `event` | `system`, `component` | `backup-test` | `backup-test` |
| `change-review` | Change review | `calendar`, `event` | `system`, `policy`, `document`, `control`, `component` | `meeting` | `meeting`, `policy`, `control`, `evidence` |
| `control-design-review` | Control design and evidence-path review | `calendar`, `event` | `control`, `program`, `system`, `component` | `control-activity` | `control-activity` |
| `continuity-review` | Continuity review | `calendar`, `event` | `document`, `system`, `component` | `control-activity` | `control-activity` |
| `document-review` | Document review | `calendar`, `event` | `document` | `document` | `document`, `evidence` |
| `exception-review` | Exception review | `calendar`, `event` | `exception` | `exception` | `exception`, `evidence` |
| `exercise` | Exercise | `calendar`, `event` | `document`, `system`, `team`, `component` | `exercise` | `exercise` |
| `incident-retrospective` | Incident retrospective | `event` | `incident` | `incident` | `incident`, `document`, `evidence` |
| `endpoint-verification` | Endpoint verification | `calendar`, `event` | `system`, `asset`, `component` | `control-activity` | `control-activity` |
| `inventory-review` | Inventory review | `calendar`, `event` | `service-account`, `system`, `asset`, `vendor`, `component` | `control-activity` | `control-activity` |
| `log-review` | Log review | `calendar`, `event` | `system`, `component` | `control-activity` | `control-activity` |
| `meeting` | Meeting | `calendar`, `event` | `team` | `meeting` | `meeting` |
| `network-review` | Network review | `calendar`, `event` | `system`, `component` | `control-activity` | `control-activity` |
| `oversight-meeting` | Oversight meeting | `calendar`, `event` | `team` | `meeting` | `meeting` |
| `penetration-test` | Penetration test | `calendar`, `event` | `system`, `component` | `penetration-test` | `penetration-test` |
| `performance-review` | Performance review | `calendar`, `event` | `person` | `control-activity` | `control-activity` |
| `workforce-review` | Workforce screening and competence review | `calendar`, `event` | `person` | `control-activity` | `control-activity` |
| `personal-device-approval` | Personal device approval | `event` | `person`, `asset` | `control-activity` | `control-activity` |
| `policy-review` | Policy review | `calendar`, `event` | `policy`, `document` | `policy-review` | `policy-review` |
| `remediation` | Remediation | `calendar`, `event` | `finding`, `action-item`, `incident`, `vulnerability` | `action-item` | `action-item`, `finding`, `evidence` |
| `retention-review` | Retention review | `calendar`, `event` | `document`, `system`, `component` | `document` | `document`, `evidence` |
| `risk-assessment` | Risk assessment | `calendar`, `event` | `workspace`, `system`, `vendor`, `risk`, `control`, `program`, `component` | `risk-assessment` | `risk-assessment`, `risk`, `evidence` |
| `role-training` | Role training | `calendar`, `event` | `person`, `training` | `attestation` | `attestation`, `evidence` |
| `security-scan` | Security scan | `calendar`, `event` | `system`, `asset`, `component` | `control-activity` | `control-activity` |
| `training` | Training | `calendar`, `event` | `person`, `training` | `attestation` | `attestation`, `evidence` |
| `vendor-contract` | Vendor contract | `calendar`, `event` | `vendor`, `document` | `document` | `document`, `vendor`, `evidence` |
| `vendor-remediation` | Vendor remediation | `calendar`, `event` | `vendor`, `risk`, `finding`, `action-item` | `vendor` | `vendor`, `risk`, `document`, `action-item`, `evidence` |
| `vendor-review` | Vendor review | `calendar`, `event` | `vendor` | `vendor-review` | `vendor-review`, `evidence` |
| `vulnerability-scan` | Vulnerability scan | `calendar`, `event` | `system`, `component` | `vulnerability-scan` | `vulnerability-scan`, `evidence` |
| `workforce-acknowledgement` | Workforce acknowledgement | `calendar`, `event` | `person`, `policy`, `document` | `attestation` | `attestation`, `evidence` |

## Policy events

The model owns each event title and the minimum and maximum count for each subject resource type.

| Event | Title | Subject rules |
| --- | --- | --- |
| `person-started` | New Worker | `person` 1..1 |
| `person-ended` | Worker Departure | `person` 1..1 |
| `person-role-changed` | Job or Responsibility Change | `person` 1..1 |
| `personal-device-access-planned` | Personal Device Access | `person` 1..1, `asset` 0..1 |
| `vendor-access-planned` | Vendor Access | `vendor` 1..1 |
| `vendor-reassessment-needed` | Vendor Reassessment | `vendor` 1..1 |
| `system-material-change` | Material System Change | `system` 1..1, `component` 0..1 |
| `material-incident` | Material Incident | `incident` 1..1 |
| `vendor-activated` | Vendor Activation | `vendor` 1..1 |
| `vendor-terminated` | Vendor Termination | `vendor` 1..1 |
| `material-data-use-change` | Material Data-Use Change | `system` 1..1, `component` 0..1 |
| `incident-closed` | Incident Closure | `incident` 1..1 |
| `policy-revised` | Policy Revision | `policy` 1..1 |
| `emergency-change` | Emergency Change | `system` 1..1, `component` 0..1 |
| `exception-expired` | Exception Expiry | `exception` 1..1 |
| `service-account-created` | Service Account Creation | `service-account` 1..1 |
| `service-account-expired` | Service Account Expiry | `service-account` 1..1 |
| `vulnerability-confirmed` | Vulnerability Confirmation | `vulnerability` 1..1 |
| `vulnerability-overdue` | Overdue Vulnerability | `vulnerability` 1..1 |
| `asset-disposed` | Asset Disposal | `asset` 1..1 |
| `continuity-activated` | Continuity Activation | `system` 1..1, `component` 0..1 |

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
| `eventType` | string (id) | Conditional | Required when `mode` is `event`. Allowed when `mode` is `event`. |

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

### `applicability-review`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision` | enum | Yes | Values: `applicable`, `not-applicable`, `externally-managed`, `zero-population` |
| `rationale` | string | Yes |  |
| `reviewedByIds` | array of id | Yes | References: `person` |
| `reviewedOn` | date | Yes |  |
| `scopeRevision` | string | Yes |  |

### `external-activity-reference`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `reference` | string | Yes |  |
| `coverage` | object (`coverage-period`) | No |  |
| `reconciledByIds` | array of id | Yes | References: `person` |
| `reconciledOn` | date | Yes |  |
| `componentId` | id | Yes | References: `component` |

### `packet-delivery`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `classificationReviewedByIds` | array of id | Yes | References: `person` |
| `classificationReviewedOn` | date | Yes |  |
| `redactionDecision` | string | Yes |  |
| `recipient` | string | Yes |  |
| `deliverySystem` | string | Yes |  |
| `packetCommit` | string | Yes |  |
| `manifestChecksum` | string | Yes |  |
| `approvedByIds` | array of id | Yes | References: `person` |
| `approvedOn` | date | Yes |  |
| `deliveredOn` | date | Yes |  |
| `receiptReference` | string | No |  |

### `subsequent-events-review`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `reviewedByIds` | array of id | Yes | References: `person` |
| `reviewedOn` | date | Yes |  |
| `throughOn` | date | Yes |  |
| `conclusion` | string | Yes |  |
| `incidentIds` | array of id | No | References: `incident` |
| `findingIds` | array of id | No | References: `finding` |
| `evidenceIds` | array of id | No | References: `evidence` |

### `external-identifiers`

Allows dynamic keys whose values are string.

Key format: `namespace`.

### `program-applicability`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `requirementId` | id | Yes | References: `requirement` |
| `decision` | enum | Yes | Values: `applicable`, `not-applicable`, `undetermined` |
| `rationale` | string | Conditional | Required when `decision` is one of `applicable`, `not-applicable`. |
| `reviewedByIds` | array of id | Conditional | References: `person` Required when `decision` is one of `applicable`, `not-applicable`. |
| `reviewedOn` | date | Conditional | Required when `decision` is one of `applicable`, `not-applicable`. |
| `scopeRevision` | string | Conditional | Required when `decision` is one of `applicable`, `not-applicable`. |

### `system-use`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `systemId` | id | Yes | References: `system` |
| `roles` | array of enum | Yes | Values: `service-delivery`, `control-support`, `evidence-source`, `supporting-operations` |
| `rationale` | string | Yes |  |

### `retention-cutoff`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `basis` | enum | Yes | Values: `creation`, `receipt`, `calendar-year-end`, `fiscal-year-end`, `event` |
| `event` | string | Conditional | Required when `basis` is `event`. Allowed when `basis` is `event`. |

### `retention-period`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `basis` | enum | Yes | Values: `fixed`, `until-event`, `permanent` |
| `amount` | integer | Conditional | Minimum: `1`. Required when `basis` is `fixed`. Allowed when `basis` is `fixed`. |
| `unit` | enum | Conditional | Values: `day`, `month`, `year` Required when `basis` is `fixed`. Allowed when `basis` is `fixed`. |
| `event` | string | Conditional | Required when `basis` is `until-event`. Allowed when `basis` is `until-event`. |

### `custom-obligation-activity`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | Yes |  |
| `completionResourceTypes` | array of string | Yes |  |

### `information-use`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `informationTypeId` | id | Yes | References: `information-type` |
| `processingOperations` | array of enum | Yes | Values: `collect`, `use`, `store`, `process`, `transmit`, `share`, `delete`, `erase`, `anonymize` |

### `audit-subservice-treatment`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `vendorId` | id | Yes | References: `vendor` |
| `componentIds` | array of id | Yes | References: `component` |
| `method` | enum | Yes | Values: `carve-out`, `inclusive` |
| `rationale` | string | Yes |  |

### `scope-selector`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `resourceType` | enum | Yes | Values: `person`, `service-account`, `system`, `asset`, `vendor` |
| `statuses` | array of string | No |  |
| `criticalities` | array of enum | No | Values: `low`, `medium`, `high`, `critical` |
| `membershipMode` | enum | Yes | Values: `as-of` |
| `cutoff` | enum | Yes | Values: `window-start`, `window-end` |

### `obligation-member`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `resourceId` | id | Yes | Relation group: `obligation-scope`. |
| `effectiveFrom` | timestamp | No |  |
| `effectiveThrough` | timestamp | No |  |
| `disposition` | enum | Yes | Values: `expected`, `not-applicable`, `exception` |
| `result` | enum | Yes | Values: `pending`, `passed`, `failed`, `partial` |
| `completionResourceIds` | array of id | No | Relation group: `completion-record`. |
| `exceptionId` | id | No | References: `exception` |
| `rationale` | string | No |  |

## Common fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string (id) | Yes | ID |
| `type` | string | Yes | Type |
| `title` | string | Yes | Title |
| `tags` | array of string | No | Tags |
| `extensions` | object (`extensions`) | No | Extensions |
| `externalIds` | object (`external-identifiers`) | No | External identifiers |

## Record Markdown

Resources with no dedicated Markdown use an optional companion with the same basename as the JSON record. The renderer creates and discovers this file from the stable record location, so no path is stored in the record.

Record Markdown is shown by default for: `system`, `control-test`, `finding`, `exception`, `policy-review`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `source-coverage`, `control-activity`, `component`, `obligation-occurrence`, `reporting-route`. Other resources without dedicated Markdown can add it when structured fields are not enough.

## Program and audit readiness defaults

Program Readiness checks management scope, policy adoption, control implementation, and authoritative evidence mapping without requiring an audit record. Audit Readiness starts after a CPA firm is engaged and uses the defaults below to prepare Type 1 and Type 2 fieldwork.

Management documents:

- **System Description** (`soc2-system-description`): Complete before the auditor finalizes the description of the system.
- **Management Assertion** (`soc2-management-assertion`): Agree on final wording with the auditor and approve it for the reporting date or period.
- **Period Completeness Statement** (`soc2-period-completeness`): Complete after reconciling every audit population, including populations with zero items.
- **Management Representation Letter** (`soc2-management-representation`): Reconcile and sign the auditor-provided letter near the end of fieldwork.

Standard populations, including zero-event populations:

- **Workforce Starts, Role Changes, and Departures** (`workforce-changes`): source role `workforce`; start with Workforce Component. Export after the period closes and before the auditor selects samples.
- **Access Grants, Changes, Reviews, and Removals** (`access-changes`): source role `identity-access`; start with Identity provider and application access sources. Export after the period closes and before access samples are selected. Split this population when different Components require different queries.
- **Production and Infrastructure Changes** (`production-changes`): source role `production-change`; start with Source control, deployment, and infrastructure change sources. Export after the period closes and before change samples are selected. Split software and infrastructure populations when their source reports differ.
- **Security Events and Incidents** (`security-incidents`): source role `security-monitoring`; start with Incident and security monitoring sources. Export after the period closes, including a source report that proves a zero count when management identified no incidents.
- **Vulnerabilities and Security Scans** (`vulnerability-activity`): source role `vulnerability-management`; start with Vulnerability, dependency, and scanning tools. Export after the period closes and preserve scan coverage, findings, remediation, and exceptions.
- **Vendors and Vendor Changes** (`vendor-changes`): source role `vendor-management`; start with Vendor inventory, contract, and purchasing sources. Export after the period closes and reconcile additions, removals, material changes, and required reviews.
- **Devices and Other Important Assets** (`managed-assets`): source role `endpoint-asset`; start with Device management and asset inventory sources. Export after the period closes and reconcile assigned, active, lost, returned, and retired assets.
- **Training and Policy Acknowledgements** (`training-acknowledgements`): source role `training-acknowledgement`; start with Training, signature, and workforce sources. Export after the period closes and reconcile assignments, completions, acknowledgements, exceptions, and overdue work to the workforce population.
- **Backup Failures and Restoration Tests** (`backup-recovery`): source role `backup-recovery`; start with Backup, recovery, and monitoring sources. Export after the period closes and include scheduled jobs, failures, restorations, exercises, and follow-up work.
- **Security Exceptions and Control Findings** (`exceptions-findings`): source role `exception-finding`; start with Exception, finding, ticketing, and risk sources. Export after the period closes and reconcile open, closed, accepted, overdue, and remediated items.

Authoritative systems of record:

- **Workforce** (`workforce`): Connect the Component that is authoritative for starts, role changes, and departures. Bring the complete workforce-change population and reports used to reconcile access and responsibilities. Expected evidence: Export the workforce-change report used to manage starters, role changes, and departures. Identify the source during scoping. Preserve event records as changes occur and export the complete Type 2 population after the period closes.
- **Training and Acknowledgements** (`training-acknowledgement`): filegrc records training assignments, content revisions, completions, acknowledgements, exceptions, and overdue follow-up during Step 4. FileGRC operating records: `training`, `attestation`. Expected evidence: Export assignments and completions tied to a specific training or policy revision. Set up training and acknowledgement records before assignments begin. Preserve completion proof as work occurs, then reconcile the complete Type 2 population to the workforce population after close.
- **Identity and Access** (`identity-access`): Connect each Component that enforces access. Bring identity, role, privileged-access, authentication-setting, review, and removal exports. Expected evidence: Export users, roles, privileged access, or authentication settings from the identity or access Component. Identify sources during scoping. Capture configuration near the Type 1 date or at the start and end of a Type 2 period; export complete change and review populations after the Type 2 period closes.
- **Production Change** (`production-change`): Connect the source control, deployment, and infrastructure-change Components. Bring protection settings, reviews, test and approval records, deployments, emergency changes, and rollback evidence. Expected evidence: Capture a change from the source control or deployment Component showing review, testing, approval, deployment, and rollback information. Identify sources before the audit period. Preserve per-change evidence as changes occur and export the complete period population after a Type 2 period closes.
- **Security Monitoring** (`security-monitoring`): Connect logging and alerting Components. Bring configuration, coverage, alert delivery tests, alerts, investigations, and zero-event proof. filegrc records qualifying incidents and their response during Step 4. Expected evidence: Capture logging or alert configuration and a delivered test alert from the monitoring Component. Capture configuration and coverage at the Type 1 date or across the Type 2 period. Preserve cases as they occur and export complete alert and incident populations after close.
- **Vulnerability Management** (`vulnerability-management`): FileGRC records vulnerability scans and penetration tests during Step 4. Put the scanner output or independent report in an Evidence Artifact and link it from the operating record when fixed supporting proof is needed. FileGRC operating records: `vulnerability-scan`, `penetration-test`. Expected evidence: Export a result from the vulnerability or dependency scanner showing scope, coverage, findings, and severity. Confirm coverage before the audit period. Preserve scan and remediation evidence when generated and export the complete Type 2 population after close.
- **Endpoint Management** (`endpoint-asset`): Connect device-management and endpoint-compliance Components. Bring the complete device population, security configuration, compliance status, and exceptions. filegrc records asset ownership, custody, loss, return, and disposal during Step 4. Expected evidence: Export devices, security configuration, and compliance status from the endpoint-management Component. Identify sources before devices receive access. Capture configuration near the Type 1 date or across the Type 2 period and export the complete Type 2 population after close.
- **Backup and Recovery** (`backup-recovery`): FileGRC records restoration tests and continuity exercises during Step 4. Put backup Component output in an Evidence Artifact and link it from the operating record when fixed supporting proof is needed. FileGRC operating records: `backup-test`, `exercise`. Expected evidence: Export job history from the backup Component showing scheduled runs, successes, failures, and follow-up. Capture configuration at the Type 1 date or across the Type 2 period. Preserve restoration and exercise results when performed and export complete job and failure history after period close.
- **Vendors** (`vendor-management`): filegrc records vendor reviews, risk decisions, supporting reports, exceptions, and follow-up during Step 4. FileGRC operating records: `vendor-review`. Expected evidence: Capture a completed vendor review with its contract, assurance report, risk decision, and follow-up. Identify relevant subservice organizations during scoping. Complete reviews during operation, obtain current assurance reports before fieldwork, and document bridge coverage when a report ends before the report period.
- **Exceptions and Findings** (`exception-finding`): filegrc records control exceptions, findings, risk acceptance, remediation, verification, and overdue work during Step 4. FileGRC operating records: `exception`, `finding`, `action-item`. Expected evidence: Export open and closed exceptions or findings with owners, status, dates, and remediation verification. Record items as they arise. Keep their status and follow-up current, then include the complete period population in fieldwork.
- **Data Protection Configuration** (`data-handling`): Connect the Components authoritative for encryption settings and retention rules. Bring current configuration and approved schedules. Preserve completed disposal actions, exceptions, and verification during Step 4. Expected evidence: Capture encryption and retention settings from the relevant Component. Confirm configuration and retention rules before the audit period. Preserve disposal evidence when work occurs and capture configuration near the Type 1 date or across the Type 2 period.
- **Network Security** (`network-security`): Connect the Components authoritative for network boundaries, firewall rules, and remote access. Bring current configuration, rule reviews, approvals, changes, and exceptions. Expected evidence: Capture current firewall or network-access rules and confirm that remote and production access paths appear. Confirm boundary and remote-access configuration before the audit period. Preserve rule changes as they occur and capture current configuration near the Type 1 date or across the Type 2 period.
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

Authoritative catalog criteria selected and tailored by Program-scoped applicability decisions.

Instructions: Keep the published criterion as catalog content. Record management applicability and rationale on the selected Program.

Policy basis: The selected Framework defines the Requirements. Controls show how management addresses each applicable criterion; the publisher’s official text remains authoritative.

Timing: Review applicability during audit planning and after material scope, service, system, or framework changes.

When reviewing:

- Decide whether this criterion applies to the selected service, Trust Services Categories, customer commitments, and planned audit.
- Explain the decision using current service and system scope facts, not a generic statement.
- Before marking it not applicable, confirm that no in-scope promise or control objective depends on it.

Path: `data/requirements/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `frameworkId` | id | Yes | References: `framework` |
| `reference` | string | Yes |  |
| `description` | string | No |  |
| `parentRequirementId` | id | No | References: `requirement` |

#### `commitment`

Customer promises, service requirements, and approved business objectives beyond the baseline Framework and Policies. Link them to the Systems and Controls that fulfill them.

Instructions: Record supplemental customer promises and service requirements that shape the scope or control design. The Commitment’s systemIds and controlIds are authoritative for what fulfills it.

Policy basis: Contracts, service descriptions, and approved management decisions can create commitments that the system description and control design must address.

Timing: Create before relying on a promise, review during audit scoping, and supersede it when the service or agreement changes.

When reviewing:

- Confirm the statement reflects a real customer promise, service requirement, or approved business objective that applies to the current scope.
- Confirm which parts of the service the promise or objective affects.
- Use an external, zero-population, or not-applicable conclusion only when it is factually true for the current scope.

Default sources: `policy-information-security`

Path: `data/commitments/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `superseded`, `retired` |
| `commitmentKind` | enum | Yes | Values: `service`, `system-requirement`, `business-objective` |
| `statement` | string | Yes |  |
| `systemIds` | array of id | No | References: `system` |
| `sourceResourceIds` | array of id | No | References: `policy`, `document`, `framework`, `requirement` |
| `requirementIds` | array of id | No | References: `requirement` |
| `controlIds` | array of id | No | References: `control` |
| `customerFacing` | boolean | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active`. |
| `supersedesId` | id | No | References: `commitment` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |
| `applicabilityReview` | object (`applicability-review`) | No | Applicability review |

#### `complementary-control`

Actions a customer or carved-out provider must perform for a linked Control to work as described. A Complementary Control record is not required for SOC 2 when no external dependency applies.

Instructions: Review whether any in-scope Control depends on a customer or carved-out provider action. Record each real dependency, or confirm that the current scope has none.

Policy basis: The system description must explain relevant customer and subservice-organization responsibilities so readers understand where management’s Controls depend on others.

Timing: Review for every audit and after material customer-responsibility, vendor, contract, integration, or service changes.

When reviewing:

- Confirm that the linked Control actually depends on a customer or carved-out provider action.
- Make the statement specific enough for the responsible party to perform and for the system description to explain.
- Before marking it not applicable, confirm that management is not responsible for the action.

Default sources: `policy-information-security`

Path: `data/complementary-controls/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `superseded`, `retired` |
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
| `applicabilityReview` | object (`applicability-review`) | No | Applicability review |
| `componentIds` | array of id | No | Components References: `component` |

#### `control`

Management's actual Control implementation, mapped to Requirements, bounded Systems, operating Components, and authoritative evidence-source Components.

Instructions: Finish each applicable starter Control with the procedure people follow, its owner, bounded System scope, operating Components, authoritative evidence-source Components, governing Policy and Requirement mappings, and implementation date. Put calendar and event schedules in Obligations.

Policy basis: Controls translate approved Policies and applicable Requirements into owned procedures that management can operate and prove. FileGRC does not infer technical implementation from policy prose. Configuration facts belong in Controls, Components, Systems, Obligations, and Evidence.

Timing: A Control may be implemented while its governing Policy, required program Document, or Training is approved but inactive. Before marking it implemented, record its owner, actual procedure in Record Markdown, bounded System scope, operation pattern, authoritative evidence-source Components, implementation date, and enabled calendar or event Obligations. Confirm each source Component is active, has the evidence role required by the Control family and current access owners, and includes repeatable retrieval instructions in Record Markdown. Enabled Obligations remain dormant until all of their governing content is active and effective.

When reviewing:

- Confirm the Control is needed for the applicable Requirements, customer Commitments, and current service boundary.
- Confirm the procedure describes what people actually do, and keep starter-selection and FileGRC record-entry instructions out of the Control statement and activity. A Control may name FileGRC when FileGRC is an actual operating Component or evidence source.
- Use a not-applicable, external, or zero-population conclusion only when it is factually true for the current scope.

Default sources: `policy-information-security`

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
| `policyIds` | array of id | No | References: `policy` |
| `effectiveOn` | date | Conditional | Required when `status` is `implemented`. |
| `retiredOn` | date | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `operationPattern` | enum | Yes | Operation pattern Values: `continuous`, `event-driven`, `scheduled`, `mixed` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `not-applicable`, `retired`. Allowed when `status` is one of `not-applicable`, `retired`. |
| `applicabilityReview` | object (`applicability-review`) | No | Control applicability review |
| `procedureRevision` | string | No | Effective procedure revision |
| `procedureEffectiveOn` | date | No | Procedure effective date |
| `implementationReviewedByIds` | array of id | No | Implementation reviewers References: `person` |
| `implementationReviewedOn` | date | No | Implementation reviewed on |
| `componentIds` | array of id | No | Operating and supporting Components References: `component` |
| `evidenceSourceComponentIds` | array of id | Conditional | Authoritative evidence-source Components References: `component` Required when `status` is `implemented`. |

#### `control-test`

A test of one Control’s design or operation for a date or period, including method, population, samples, Evidence, result, and exceptions. Management-run Control Tests are not required for SOC 2 because the CPA firm tests independently.

Instructions: Record a management Control Test only when management performs and reviews one. The CPA firm records its own independent testing separately.

Policy basis: The information security policy requires management to monitor Controls. The CPA firm performs its own independent testing for the SOC 2 examination.

Timing: Plan from the Control operation pattern, linked Obligations, risk, and audit scope. Record the exact period or as-of date, link the complete population and sampled items when sampling applies, and complete review before relying on the result.

When reviewing:

- Confirm the test covers the intended Control, design or operating objective, and exact audit date or period.
- Confirm the method, population, sample, and results support the conclusion.
- Confirm every exception found during the test is recorded.

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

#### `collection-review`

A management confirmation that one model-defined resource collection was reviewed against the current scope and exact record revisions.

Instructions: A management confirmation that one model-defined resource collection was reviewed against the current scope and exact record revisions.

Policy basis: FileGRC cannot infer that an apparently complete or empty collection was reviewed. This record preserves who reviewed it, what conclusion they reached, and the exact collection state they reviewed.

Timing: Review during initial scoping and again whenever the collection or related scope facts change.

Path: `data/collection-reviews/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `retired` |
| `resourceType` | enum | Yes | Reviewed resource type Values: `person`, `framework`, `vendor`, `system`, `complementary-control`, `component`, `information-type`, `retention-schedule-item` Values come from the `collectionReviews` registry. |
| `decision` | enum | Conditional | Values: `complete`, `zero-population`, `externally-managed`, `not-applicable` Required when `status` is `active`. |
| `rationale` | string | Conditional | Required when `status` is `active`. |
| `reviewedByIds` | array of id | Conditional | Reviewed by References: `person` Required when `status` is `active`. |
| `reviewedOn` | date | Conditional | Reviewed on Required when `status` is `active`. |
| `collectionRevision` | string | Conditional | Reviewed collection revision Required when `status` is `active`. |
| `scopeRevision` | string | Conditional | Reviewed scope revision Required when `status` is `active`. |
| `scopeResourceIds` | array of id | Yes | References: `program`, `system`, `component` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is `retired`. Allowed when `status` is `retired`. |
| `authoritativeComponentId` | id | Conditional | Authoritative Component References: `component` Required when `decision` is `externally-managed` and `status` is `active`. |
| `supersedesId` | id | No | References: `collection-review` |
| `coverage` | object (`coverage-period`) | No | Reviewed temporal coverage |
| `knowledgeCutoffAt` | timestamp | No | Knowledge cutoff |
| `populationResourceIds` | array of id | No | Reviewed population Relation group: `obligation-scope`. References: `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit`, `source-coverage`, `retention-schedule-item`, `requirement-mapping`, `component`, `information-type` |

#### `requirement-mapping`

A reviewed assertion about how one set of Requirements, Commitments, or Controls relates to another without copying the authoritative source content.

Instructions: Record a reviewed relationship among Requirements, Commitments, and Controls. Choose the comparison method and relationship explicitly, explain the rationale, and bind the review to every mapped source revision.

Policy basis: Supplemental policies, contracts, privacy promises, and frameworks need explicit coverage semantics so a link is not mistaken for complete coverage.

Timing: Review when either mapped source changes and before relying on the mapping for program or audit scope.

When reviewing:

- Map at the smallest practical statement level.
- Choose syntactic, semantic, or functional comparison and explain the rationale.
- Do not infer equivalence from similar titles or missing mappings.

Path: `data/requirement-mappings/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `superseded`, `retired` |
| `sourceResourceIds` | array of id | Yes | References: `requirement`, `commitment`, `control` |
| `targetResourceIds` | array of id | Yes | References: `requirement`, `commitment`, `control` |
| `relationship` | enum | Conditional | Values: `equal-to`, `equivalent-to`, `subset-of`, `superset-of`, `intersects-with`, `no-relationship` Required when `status` is `active`. |
| `method` | enum | Conditional | Values: `syntactic`, `semantic`, `functional` Required when `status` is `active`. |
| `rationale` | string | Conditional | Required when `status` is `active`. |
| `reviewedByIds` | array of id | Conditional | References: `person` Required when `status` is `active`. |
| `reviewedOn` | date | Conditional | Required when `status` is `active`. |
| `reviewedSourceRevisions` | object (`string-map`) | Conditional | Required when `status` is `active`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `supersedesId` | id | No | References: `requirement-mapping` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |

#### `program`

A management-defined compliance or assurance program with its own goal, scope, criteria, Controls, owners, risk method, and candidate operating period.

Instructions: Define one management compliance or assurance Program with its goal, bounded Systems, selected Frameworks, Requirement applicability decisions, Controls, owners, risk method, and candidate period.

Policy basis: Management defines the assurance objective, bounded Systems, applicable criteria, Controls, owners, and risk method for each program.

Timing: Review before starting a candidate period, during audit planning, and after material scope, service, framework, or risk-method changes.

When reviewing:

- Select only the bounded Systems governed or examined by this Program.
- Record Requirement applicability against this Program's current scope.
- Keep unrelated corporate inventory outside this Program.

Path: `data/programs/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `retired` |
| `assuranceGoal` | enum | Yes | Program goal Values: `none`, `readiness`, `soc-2-type-1`, `soc-2-type-2` |
| `systemIds` | array of id | Conditional | Systems References: `system` Required when `status` is `active`. |
| `frameworkIds` | array of id | Conditional | Frameworks References: `framework` Required when `status` is `active`. |
| `requirementApplicability` | array of object (`program-applicability`) | No | Requirement applicability |
| `controlIds` | array of id | Conditional | Controls References: `control` Required when `status` is `active`. |
| `ownerIds` | array of id | Conditional | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` Required when `status` is `active`. |
| `riskMethodology` | object (`risk-methodology`) | Conditional | Risk methodology Required when `status` is `active`. |
| `candidateCoverage` | object (`coverage-period`) | No | Candidate period |
| `description` | string | No |  |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is `retired`. Allowed when `status` is `retired`. |

### Governance

#### `appointment`

One person’s dated appointment to a named organizational or program responsibility, such as CISO, DPO, Policy Owner, or team chair. Use the Person job title for the person’s ordinary organizational position.

Instructions: Record one person’s dated appointment to a named organizational or program responsibility. Scope it to the workspace, a team, or the records governed by that appointment.

Policy basis: The information security policy assigns named authority and accountability, while workforce procedures require responsibility changes and departures to be reviewed and transferred.

Timing: Create when management assigns a named responsibility. End the Appointment and create a new one when the holder changes. Reassign every linked responsibility before a holder departs.

Default sources: `policy-information-security`

Path: `data/appointments/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `ended` |
| `appointmentKind` | string (id) | Yes | Appointment kind |
| `holderId` | id | Conditional | Holder References: `person` Required when `status` is one of `active`, `ended`. |
| `scopeResourceIds` | array of id | Yes | Scope Relation group: `appointment-scope`. References: `workspace`, `person`, `service-account`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
| `startsOn` | date | Conditional | Required when `status` is one of `active`, `ended`. |
| `endsOn` | date | Conditional | Required when `status` is `ended`. |
| `appointedByIds` | array of id | No | Appointed by References: `person` |
| `responsibilities` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `ended`. Allowed when `status` is one of `ended`. |
| `independenceRationale` | string | No | Independence rationale |

#### `team`

Groups that share program responsibility, such as security oversight or incident response. Team records are not required for SOC 2 when named People hold the responsibilities directly.

Instructions: Review the starter Security and Risk Oversight team, including its members and chair. Membership and chairs are authoritative on the Team record.

Policy basis: The information security policy establishes security and risk oversight with independent review, while the continuity plan assigns response and recovery roles. Reviewers may be internal or external.

Timing: The security and risk oversight group meets at least quarterly. Update membership after responsibility or personnel changes, and preserve a chair who is separate from the policy owner.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

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

Governed plans, schedules, charters, procedures, standards, reports, and templates that are not Policies or another filegrc record type. A general Document catalog is not required for SOC 2. Required program Documents are approved before implementation and activated only after their requirements are implemented. Audit Documents stay with the engagement in Step 5.

Instructions: Complete required program Documents in Step 2, assign an owner and separate approver, and bind approval to the intended values and exact Markdown. Implement the linked requirements and activate that approved revision in Step 3. Prepare Audit Documents in Step 5.

Policy basis: Policies rely on governed documents for detailed plans, schedules, procedures, charters, and reports. Approval accepts the intended values and exact content. Activation records that the linked requirements were implemented and the approved Document was put into use.

Timing: Complete required program Documents in Step 2, obtain approval from a reviewer who is separate from the owner, implement their linked requirements in Step 3, then activate the unchanged approved revision. Follow the linked review Obligation after activation. Prepare Audit Documents in Step 5, then approve and activate each one there as separate revision-bound updates.

When reviewing:

- Write companion Markdown as a standalone company artifact. Keep FileGRC commands, record-entry instructions, readiness states, relationship IDs, and starter-library mechanics in guides and calculated work unless FileGRC itself is the document's subject.
- Replace every bracketed prompt with a reviewed fact before approval, activation, signature, or delivery.
- Describe the business fact in ordinary terms and keep resource relationships in the Document record and supporting records.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

Path: `data/documents/<id>.json`

Markdown companions:

- **Document**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `approved`, `active`, `superseded`, `retired` |
| `documentKind` | string | Yes |  |
| `workflowScope` | enum | Yes | Workflow scope Values: `program`, `engagement` |
| `template` | boolean | No |  |
| `approverIds` | array of id | Conditional | References: `person` Must not overlap `ownerIds`. Required when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `version` | string | No |  |
| `effectiveOn` | date | Conditional | Required when `status` is `active`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `approved`, `active`, `superseded`, `retired`. Allowed when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `supersedesId` | id | No | References: `document` |
| `systemIds` | array of id | No | References: `system` |
| `controlIds` | array of id | No | References: `control` |
| `relatedDocumentIds` | array of id | No | References: `document` |
| `audience` | array of string | No |  |
| `acknowledgementRequired` | boolean | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `trainingIds` | array of id | No | Related training References: `training` |
| `classificationId` | id | No | Classification References: `classification` |
| `approvedContentRevisions` | object (`content-revisions`) | Conditional | Approved content revisions Managed by filegrc. Required when `status` is one of `approved`, `active`, `superseded`, `retired`. Allowed when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `activatedOn` | date | Conditional | Activation date Required when `activationBasis` is `recorded`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `activationBasis` | enum | Conditional | Activation basis Values: `recorded`, `historical` Required when `status` is `active`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `activatedByIds` | array of id | Conditional | Activated by References: `person` Required when `activationBasis` is `recorded`. Allowed when `activationBasis` is `recorded`. |
| `activatedContentRevisions` | object (`content-revisions`) | Conditional | Activated content revisions Managed by filegrc. Required when `activationBasis` is `recorded`. Allowed when `activationBasis` is `recorded`. |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |
| `proposedEffectiveOn` | date | No | Proposed effective date Allowed when `status` is one of `draft`, `approved`. |
| `programRole` | enum | No | Program role Values: `required`, `conditional`, `alternative`, `supporting` Allowed when `workflowScope` is `program`. |
| `componentIds` | array of id | No | Components References: `component` |

#### `policy`

Management-approved requirements for the program. Approval accepts the requirements; activation makes them effective. Store the Policy text in Markdown and its owner, separate approver, scope, status, dates, and linked Controls in the record.

Instructions: Tailor each Policy to match what the company is committing to. Clear placeholders, assign an owner and separate approver, then bind approval to the reviewed content. Approval does not prove implementation. Activate the Policy during the Step 3 cutover after reviewing its implementation gaps.

Policy basis: A Policy says what the company commits to do by the date it takes effect. Approval means the company accepts those commitments. It does not prove the work is done. Controls and operating records describe how the company meets them and provide the proof.

Timing: Move a draft through independent review and approval without requiring every linked Control to be implemented. During Step 3, finish Controls, Components, evidence sources, governed plans, and schedules, review the per-Policy activation assessment, then activate the approved revision on its real effective date. Do not backdate adoption. The approver is usually internal and may be external, but must be separate from the owner and from the CPA auditor role. Review at least annually and after material changes.

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
| `effectiveOn` | date | Conditional | Required when `status` is `active`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
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
| `programRole` | enum | No | Program role Values: `required`, `conditional`, `alternative`, `supporting` |
| `proposedEffectiveOn` | date | No | Proposed effective date Allowed when `status` is one of `draft`, `in-review`, `approved`. |

#### `policy-review`

The result of a scheduled or change-driven review of Policies or governed Documents, including reviewers, decision, evidence, and follow-up. Edit the source record separately when changes are approved.

Instructions: Record scheduled and change-driven reviews of policies and governed documents, including the decision and any follow-up.

Policy basis: The Information Security Policy and Security Incident and Recovery Plan require periodic review and another review after specified material changes.

Timing: Complete annually and after a triggering change, incident, disruption, or policy condition. Link the exact scope, reviewers, result, and evidence.

When reviewing:

- Read the current Policy or governed Document.
- Confirm it still matches the service, current requirements, and actual practice.
- Record any needed change or follow-up.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

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

Policy basis: The information security policy requires people to complete assigned training and acknowledge applicable responsibilities.

Timing: Assign during onboarding, within 30 days for security training, annually for recurring training, and after material content changes that require acknowledgement.

Default sources: `policy-information-security`

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
| `reportingRouteId` | id | No | Delivered reporting route References: `reporting-route` |
| `reportingRouteRevision` | string | No | Delivered reporting route revision |

At least one of `evidenceIds` is required when `status` is `completed` and `attestationMethod` is one of `signed-document`, `external-record`.

#### `meeting`

One governance meeting, including its chair, attendees, agenda, minutes, decisions, raised issues, Evidence, and assigned follow-up.

Instructions: Record required oversight meetings, including attendees, decisions, minutes, and follow-up work.

Policy basis: The information security policy requires recorded security and risk oversight. The Security Incident and Recovery Plan requires management review of exercises and unresolved risks.

Timing: Hold security and risk oversight meetings at least quarterly. Create one immutable meeting record and Markdown minutes for each occurrence.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

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

Reusable, governed training content, including its audience, passing criteria, and linked Policies and Controls. Approve the exact content in Step 2, activate it during Step 3 implementation, define assignment schedules in Obligations, and record individual completions in Attestations.

Instructions: Review and approve the exact Training content in Step 2, then activate the unchanged revision during Step 3 after its linked Controls and assignment Obligations are ready.

Policy basis: The information security policy requires security training and added role-specific instruction when a person’s responsibilities or data access warrant it.

Timing: Approve the exact training content in Step 2. During Step 3, finish the linked Controls and Obligations, then activate the unchanged approved revision. Assign training through Obligations at onboarding, annually, and after relevant material changes or incidents.

When reviewing:

- Write workforce-facing material as standalone company training. Keep FileGRC commands, record-entry instructions, and data-model terms in guides and assignment records.
- State required behavior without implying that every user needs a paid product or that customer MFA applies without an approved requirement.
- Tie each completion to the exact training revision the person reviewed.

Default sources: `policy-information-security`

The UI labels the common `title` field as **Name**.

Path: `data/training/<id>.json`

Markdown companions:

- **Training**: `.md` beside the JSON record (required).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `in-review`, `approved`, `active`, `superseded`, `retired` |
| `audience` | array of string | No |  |
| `policyIds` | array of id | No | References: `policy` |
| `controlIds` | array of id | No | References: `control` |
| `passingCriteria` | string | No |  |
| `evidenceIds` | array of id | No | References: `evidence` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `approverIds` | array of id | Conditional | References: `person` Must not overlap `ownerIds`. Required when `status` is one of `in-review`, `approved`, `active`, `superseded`, `retired`. |
| `supersedesId` | id | No | References: `training` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |
| `effectiveOn` | date | Conditional | Required when `status` is `active`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `approved`, `active`, `superseded`, `retired`. Allowed when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `approvedContentRevisions` | object (`content-revisions`) | Conditional | Approved content revisions Managed by filegrc. Required when `status` is one of `approved`, `active`, `superseded`, `retired`. Allowed when `status` is one of `approved`, `active`, `superseded`, `retired`. |
| `activatedOn` | date | Conditional | Activation date Required when `activationBasis` is `recorded`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `activationBasis` | enum | Conditional | Activation basis Values: `recorded` Required when `status` is `active`. Allowed when `status` is one of `active`, `superseded`, `retired`. |
| `activatedByIds` | array of id | Conditional | Activated by References: `person` Required when `activationBasis` is `recorded`. Allowed when `activationBasis` is `recorded`. |
| `activatedContentRevisions` | object (`content-revisions`) | Conditional | Activated content revisions Managed by filegrc. Required when `activationBasis` is `recorded`. Allowed when `activationBasis` is `recorded`. |
| `proposedEffectiveOn` | date | No | Proposed effective date Allowed when `status` is one of `draft`, `in-review`, `approved`. |

#### `data-request`

One privacy, contractual, or other data request tracked by opaque reference, with scope, due date, decision, Evidence, and completion. Data Request tracking is not required for a SOC 2 Security-only report.

Instructions: Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.

Policy basis: The information security policy requires applicable requests to reach a responsible owner, meet the governing deadline, and keep erasable personal data out of immutable Git history.

Timing: Create on receipt, set the deadline from applicable law or contract, verify identity outside this repository when needed, and record completion.

Default sources: `policy-information-security`

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
| `componentIds` | array of id | No | Components References: `component` |

#### `retention-schedule-item`

One reviewed schedule item that states which Information Types and operational scope it covers, when retention starts, how long information is kept, and its approved disposition.

Instructions: Use one structured row for each reviewed retention rule. Name its Information Types, scope, cutoff, period, disposition, sources, owner, and approval. Keep unknown organization values planned for management review.

Policy basis: Management must translate legal, contractual, privacy, security, and business needs into explicit retention and disposition instructions without treating starter periods as organization facts.

Timing: Review before activation and after a source Policy, Requirement, Commitment, information use, System, Component, Vendor, or legal-hold process changes.

When reviewing:

- Confirm the Information Types and operational scope covered by this item.
- Confirm the cutoff, retention period, and disposition action from approved management sources.
- Keep the item planned until management approves every organization-specific value.

Default sources: `policy-information-security`, `document-data-retention-schedule`

Path: `data/retention-schedule-items/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `superseded`, `retired` |
| `description` | string | Yes |  |
| `informationTypeIds` | array of id | Conditional | Information Types References: `information-type` Required when `status` is `active`. |
| `scopeResourceIds` | array of id | Yes | Operational scope References: `program`, `system`, `component`, `vendor`, `audit`, `source-coverage` |
| `scheduleDocumentId` | id | Yes | Retention schedule References: `document` |
| `sourceResourceIds` | array of id | No | Authority and source records References: `policy`, `document`, `framework`, `requirement`, `commitment`, `control` |
| `cutoff` | object (`retention-cutoff`) | Conditional | Required when `status` is `active`. |
| `retentionPeriod` | object (`retention-period`) | Conditional | Required when `status` is `active`. |
| `dispositionAction` | enum | Conditional | Values: `delete`, `destroy`, `erase`, `anonymize`, `transfer`, `retain-permanently` Required when `status` is `active`. |
| `dispositionInstructions` | string | Conditional | Required when `status` is `active`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `approvedByIds` | array of id | Conditional | Approved by References: `person` Required when `status` is `active`. |
| `approvedOn` | date | Conditional | Required when `status` is `active`. |
| `reviewedSourceRevisions` | object (`string-map`) | Conditional | Reviewed source revisions Required when `status` is `active`. |
| `supersedesId` | id | No | References: `retention-schedule-item` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |
| `notes` | string | No |  |

#### `reporting-route`

An effective primary or alternate route for security reports and other approved communications, with its owner and failure dependencies.

Instructions: An effective primary or alternate route for security reports and other approved communications, with its owner and failure dependencies.

Policy basis: Workers need a usable route for security reports. An alternate is required only when an adopted Policy, Document, Commitment, or Risk decision calls for one.

Timing: Review through a linked Obligation and communicate a changed route to the affected audience. Preserve the route revision delivered with each assignment.

Path: `data/reporting-routes/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `retired` |
| `purpose` | enum | Yes | Values: `security-reporting`, `continuity-communication` |
| `priority` | enum | Yes | Values: `primary`, `alternate` |
| `channelKind` | enum | Yes | Values: `email`, `phone`, `web`, `other` |
| `route` | string | Yes |  |
| `effectiveAt` | timestamp | Conditional | Required when `status` is one of `active`, `retired`. |
| `endsAt` | timestamp | Conditional | Required when `status` is `retired`. |
| `dependencySystemIds` | array of id | No | References: `system` |
| `approvedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `active`, `retired`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `active`, `retired`. |
| `sourceResourceIds` | array of id | No | References: `policy`, `document`, `commitment`, `risk` |
| `ownerIds` | array of id | Yes | Relation group: `accountable-party`. References: `person`, `team`, `appointment` |

### Risk

#### `exception`

An approved, time-bound departure from a Policy or Control. Record its scope, reason, risk, compensating Controls, owner, approval, and expiry. An Exception record is not required for SOC 2 unless a departure is approved.

Instructions: Record and approve any time-limited departure from a policy or control before the departure begins.

Policy basis: The information security policy allows departures only with a business reason, assessed risk, compensating safeguards, approval, and an expiry or review date.

Timing: Approve before the departure begins, follow its linked review Obligation or expiry, and close or renew it through a new risk decision.

Default sources: `policy-information-security`

Path: `data/exceptions/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `requested`, `approved`, `revoked`, `closed` |
| `scopeResourceIds` | array of id | Yes | Relation group: `obligation-scope`. References: `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit`, `source-coverage`, `retention-schedule-item`, `requirement-mapping`, `component`, `information-type` |
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

Policy basis: The information security policy requires identified Risks to have an owner, rating, treatment decision, target date, and time-bound approval when accepted.

Timing: Assess the register at least annually and after material changes. Review High and Critical risks at least quarterly and accepted risks by their review date.

Default sources: `policy-information-security`

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
| `treatmentTargetOn` | date | No | Treatment target date |
| `reviewDueOn` | date | No | Next review due |
| `componentIds` | array of id | No | Components References: `component` |
| `informationTypeIds` | array of id | No | Affected Information Types References: `information-type` |

#### `risk-assessment`

One approved evaluation of a defined scope using the program’s risk method. It records participants, Systems, Vendors, conclusions, Evidence, and the Risks created or reassessed.

Instructions: Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.

Policy basis: The information security policy requires periodic and change-driven assessment of threats, assets, obligations, Controls, likelihood, impact, and treatment.

Timing: Complete at least annually and after a material change that could alter risk. Record new and changed risks instead of hiding them in the summary.

When reviewing:

- Confirm the assessment covered the real service, material dependencies, data, commitments, and recent changes.
- Confirm the ratings and responses match management's current view of each risk.
- Confirm no material risk was left out.

Default sources: `policy-information-security`

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
| `componentIds` | array of id | No | Components References: `component` |

### People and Access

#### `person`

People who own, approve, review, or perform program work, or receive access and training. Record each person’s actual organization job title here and keep named program authority in dated Appointments. Keep detailed personnel records in the HR system.

Instructions: Record each person’s actual organizational job title. Keep named program authority, such as CISO, DPO, Policy Owner, or team chair, in dated Appointment records.

Policy basis: The information security policy assigns work to named people and requires onboarding, training, role-change, and offboarding records.

Timing: Create before assigning work or access, update the job title after organizational changes, review Appointments separately, and mark inactive only after active Appointments are ended or transferred. Training is due within 30 days of starting and annually.

Default sources: `policy-information-security`

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
| `reviewDueOn` | date | No | Next review due |
| `nonExpiringRationale` | string | No | Non-expiring rationale |
| `componentIds` | array of id | No | Components References: `component` |

#### `access-grant`

One Person’s or Service Account’s access to one System, including business need, privilege, request, approval, provisioning, expiry, removal, ticket, and Evidence.

Instructions: Record each person’s or service account’s access to a Component, including approval, provisioning, changes, and removal.

Policy basis: The information security policy requires unique identity, documented business need, least privilege, approval, authorized provisioning, and prompt removal.

Timing: Record every grant and material change. Remove access at or before notice for involuntary or high-risk departures and within 24 hours for other departures.

Default sources: `policy-information-security`

Path: `data/access-grants/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `requested`, `approved`, `active`, `revoked`, `expired` |
| `subjectId` | id | Yes | References: `person`, `service-account` |
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
| `businessNeed` | string | No | Business need |
| `componentId` | id | Yes | Component References: `component` |

#### `access-review`

One review of a defined access population for a date or period, including Systems, reviewers, Access Grant decisions, exceptions, approval, Evidence, and source revision.

Instructions: Review access on schedule, record each decision, and assign any access changes that result.

Policy basis: The information security policy requires System owners to periodically confirm least privilege and remove dormant, expired, excessive, or unneeded access.

Timing: Review privileged and production access at least quarterly and other important-system access at least annually.

When reviewing:

- Confirm the review population is complete for every System and exact date or period in scope.
- Decide whether each person and service account still needs its exact access and privilege level.
- Confirm every removal, change, or exception has follow-up.

Default sources: `policy-information-security`

Path: `data/access-reviews/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `complete`, `canceled` |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is one of `in-progress`, `complete`. |
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
| `componentIds` | array of id | Yes | Components References: `component` |

### Systems and Vendors

#### `system`

The complete bounded system being governed or examined, including its services, boundary, information, Components, Controls, dependencies, and any applicable continuity objectives.

Instructions: Start with the complete bounded System management governs or the auditor will examine. Record its purpose, services, boundary, exclusions, Information Types, owners, and any applicable continuity objectives.

Policy basis: A SOC 2 program starts with the bounded System and the service commitments and system requirements the company has chosen to meet.

Timing: Define before selecting Components and Controls. Review after material service, boundary, architecture, information, continuity, or audit-scope changes.

When reviewing:

- Describe the complete service boundary rather than a single tool or provider.
- Record exclusions and the Information Types processed in the boundary.
- Add Components only when they materially deliver the service, support Controls, produce authoritative Evidence, or support relevant operations.

The UI labels the common `title` field as **Name**.

Path: `data/systems/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `deprecated`, `retired` |
| `purpose` | string | Yes |  |
| `servicesProvided` | array of string | Yes |  |
| `boundary` | string | Yes |  |
| `exclusions` | array of string | No |  |
| `criticality` | enum | Yes | Values: `low`, `medium`, `high`, `critical` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `informationTypeIds` | array of id | No | Information Types References: `information-type` |
| `classificationId` | id | No | Highest classification References: `classification` |
| `internetExposed` | boolean | No |  |
| `continuityObjectives` | object (`continuity-objectives`) | No |  |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `deprecated`, `retired`. Allowed when `status` is one of `deprecated`, `retired`. |

#### `asset`

Important devices, media, software, records, and other items tracked through acquisition, custody, use, return, and disposal. Assets support controls but do not define the service boundary.

Instructions: Keep the inventory of important devices, software, media, and records current, including ownership, custody, and status.

Policy basis: The information security policy requires important assets to have owners and custodians, protection based on classification, and secure return or disposal.

Timing: Record acquisition and assignment, review the inventory annually, update custody on change, and retire assets when use ends.

Default sources: `policy-information-security`

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
| `location` | string | No |  |
| `exceptionIds` | array of id | No | References: `exception` |
| `acquiredOn` | date | No |  |
| `retiredOn` | date | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | id | No | Classification References: `classification` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `lost`, `retired`, `disposed`. Allowed when `status` is one of `lost`, `retired`, `disposed`. |
| `componentIds` | array of id | No | Components References: `component` |

#### `vendor`

External organizations and commercial relationships, including contracts, due diligence, risk reviews, monitoring, assurance reports, dates, and general information-access facts.

Instructions: Catalog material external provider relationships. Link a supplied Component when it meets the Component inclusion rules, but do not mirror every Vendor into a Component.

Policy basis: The information security policy requires an inventory of important providers, risk-based review before access or reliance, suitable contract terms, and ongoing monitoring.

Timing: Create for a material external provider relationship. Review critical and high-risk Vendors at least annually and after material relationship, service, access, or incident changes. Do not create a Component unless a supplied capability also meets the Component inclusion rules.

Default sources: `policy-information-security`

The UI labels the common `title` field as **Name**.

Path: `data/vendors/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `evaluating`, `active`, `deprecated`, `terminated` |
| `category` | string | Yes |  |
| `criticality` | enum | Yes | Values: `low`, `medium`, `high`, `critical` |
| `description` | string | No |  |
| `standardAgreement` | boolean | No |  |
| `agreementDocumentId` | id | No | References: `document` |
| `startDate` | date | No |  |
| `endDate` | date | No |  |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | id | No | Highest accessible classification References: `classification` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `deprecated`, `terminated`. Allowed when `status` is one of `deprecated`, `terminated`. |
| `informationTypeIds` | array of id | No | Information Types accessible References: `information-type` |

#### `vendor-review`

One due-diligence or periodic review of a Vendor, covering the service, data, access, assurance, recovery, incidents, contracts, Risks, Evidence, and follow-up.

Instructions: Document due diligence before relying on a provider, then repeat the review on schedule or after a material change.

Policy basis: The information security policy requires review before a Vendor handles sensitive data or supports important services, plus periodic review of higher-risk providers.

Timing: Complete before access, at least annually for Critical and High-risk vendors, and after material service changes or incidents.

When reviewing:

- Confirm the review covers the Vendor’s current services, connected Systems, data access, criticality, subservice role, and contract terms.
- Evaluate current assurance reports, security and privacy terms, incident history, resilience, access model, and material changes.
- Make the approve, conditional, or reject decision match the risks and assign any needed follow-up.

Default sources: `policy-information-security`

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

#### `classification`

A controlled information-handling category used consistently across inventory and Evidence Artifacts.

Instructions: Define an ordered information-handling category used by inventory and Evidence Artifacts.

Policy basis: Management defines handling categories so information and retained evidence receive consistent protection.

Timing: Review with the data-handling policy and after a material legal, contractual, or information-use change.

Path: `data/classifications/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `active`, `retired` |
| `rank` | integer | Yes | Minimum: `0`. |
| `description` | string | Yes |  |
| `handlingRequirements` | string | No |  |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `deprecated`, `retired`. Allowed when `status` is one of `deprecated`, `retired`. |

#### `information-type`

A stable category of information processed by Systems, Components, Vendors, and risk workflows.

Instructions: Define a stable category of information and its default Classification, then link it from Systems, Components, and Vendors.

Policy basis: Information categories connect system boundaries and operational processing to approved handling rules.

Timing: Create when a stable information category enters scope and review after material processing or classification changes.

Path: `data/information-types/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `superseded`, `retired` |
| `classificationId` | id | Conditional | Default classification References: `classification` Required when `status` is `active`. |
| `description` | string | Yes |  |
| `supersedesId` | id | No | References: `information-type` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `superseded`, `retired`. Allowed when `status` is one of `superseded`, `retired`. |

#### `component`

A logical operational or technical building block that materially delivers a System, supports a Control, produces authoritative Evidence, or supports relevant operations.

Instructions: Add a Component only when it materially delivers a selected System, supports a Control, produces authoritative Evidence, or supports relevant operations. Give every System use a role and rationale.

Policy basis: System boundaries and Control implementations need explicit operational building blocks and evidence sources.

Timing: Create only when the capability materially participates in an in-scope System. Review after architecture, provider, Control, evidence, access, or continuity changes.

When reviewing:

- Choose at least one role for each related System and explain why the Component matters there.
- Link a Vendor only when that external organization primarily supplies this Component.
- Do not create Components for every Vendor, person, policy, procedure, data category, local utility, or occasional tool.

The UI labels the common `title` field as **Name**.

Path: `data/components/<id>.json`

Markdown companions:

- **Operations and evidence retrieval**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `deprecated`, `retired` |
| `componentKind` | enum | Yes | Values: `infrastructure`, `software`, `service`, `network`, `physical`, `external-system`, `interconnection` |
| `description` | string | Yes |  |
| `criticality` | enum | No | Values: `low`, `medium`, `high`, `critical` |
| `environment` | string | No |  |
| `vendorId` | id | No | References: `vendor` |
| `systemUses` | array of object (`system-use`) | Conditional | System uses Required when `status` is `active`. |
| `informationUses` | array of object (`information-use`) | No | Information use |
| `internetExposed` | boolean | No |  |
| `evidenceSourceKinds` | array of string | No | Evidence source roles |
| `evidenceOwnerIds` | array of id | No | Evidence access owners References: `person`, `team`, `appointment` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `classificationId` | id | No | Highest classification References: `classification` |
| `continuityObjectives` | object (`continuity-objectives`) | No |  |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `deprecated`, `retired`. Allowed when `status` is one of `deprecated`, `retired`. |

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
| `confirmedOn` | date | No | Confirmed on |
| `severityAssignedOn` | date | No | Severity assigned on |
| `targetRemediationOn` | date | No | Target remediation date |
| `severityChangedOn` | date | No | Severity changed on |
| `severityChangeReason` | string | No | Severity change reason |
| `componentIds` | array of id | No | Components References: `component` |

#### `vulnerability-scan`

One vulnerability scan activity, including tool, scope, Systems, operator, time, result, resulting Vulnerabilities, Evidence, failure reason, and review.

Instructions: Record each required scan, including its scope, timing, result, and evidence.

Policy basis: The information security policy requires management to monitor for weaknesses and scan internet-facing and production Systems.

Timing: Scan at least quarterly and after material changes when practical. Review failures and create vulnerability or finding records for confirmed results.

When reviewing:

- Confirm the scan covered the intended current Systems and attack surface.
- Confirm any exclusion, authentication failure, unreachable target, or other coverage gap is understood.
- Confirm every real finding has remediation or an accepted exception.

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
| `resultSummary` | string | Conditional | Required when `status` is `complete`. |
| `findingCountBySeverity` | object (`integer-map`) | No |  |
| `vulnerabilityIds` | array of id | No | References: `vulnerability` |
| `evidenceIds` | array of id | Conditional | References: `evidence` Required when `status` is `complete`. |
| `failureReason` | string | Conditional | Required when `status` is `failed`. Allowed when `status` is `failed`. |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `reviewedOn` | date | Conditional | Required when `status` is `complete`. Allowed when `status` is `complete`. |
| `scheduledFor` | date | No | Scheduled for |
| `componentIds` | array of id | No | Components References: `component` |

#### `incident`

One suspected or confirmed security or privacy event, with severity, timeline, scope, owner, affected Systems and Vendors, Evidence, Findings, and corrective work. An Incident record is not required for SOC 2 when no incident occurred.

Instructions: Record qualifying security or privacy events and manage their response and follow-up.

Policy basis: The information security policy requires prompt reporting, investigation, containment, recovery, evidence preservation, and review of notification duties.

Timing: Create on report or detection, update material events as they progress, and complete a retrospective within one week after a material incident.

Default sources: `policy-information-security`

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
| `classificationId` | id | No | Classification References: `classification` |
| `eradicatedAt` | timestamp | Conditional | Required when `status` is one of `eradicated`, `recovered`, `closed`. |
| `componentIds` | array of id | No | Components References: `component` |

#### `penetration-test`

One internal or external penetration test, including provider, scope, period, method, result, affected Systems, Evidence, Vulnerabilities, Findings, and review.

Instructions: Record each penetration test, including its provider, scope, period, result, and evidence.

Policy basis: The information security policy requires management to decide whether penetration testing is needed from exposure, material changes, customer commitments, technical capability, and risk, then track confirmed findings when testing is performed.

Timing: Use the cadence approved in the applicable Control, customer commitment, or risk decision. Review applicability at least annually and after material attack-surface or architecture changes; the review may conclude that no penetration test is required.

When reviewing:

- Confirm the testing decision, tester independence when required, scope, method, and cadence match the approved reason for testing.
- Confirm the report supports the recorded result.
- Confirm every issue has remediation, an accepted exception, or verified closure.

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
| `componentIds` | array of id | No | Components References: `component` |

### Resilience

#### `exercise`

One continuity, recovery, incident, or privacy simulation, including scenario, objective, participants, scope, result, Evidence, Findings, and follow-up.

Instructions: Record each incident or continuity exercise, including its objective, participants, result, and follow-up.

Policy basis: The information security policy requires incident-response testing. The Security Incident and Recovery Plan requires exercises and another review after material change or disruption.

Timing: Test incident response and continuity at least annually. Repeat after a material change when the prior exercise no longer represents the environment.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

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
| `componentIds` | array of id | No | Components References: `component` |

#### `backup-test`

One restore or recovery test, including the Systems and operators involved, timing, recovery result, reviewer, Evidence, Findings, and follow-up.

Instructions: Record each restore test, including the Systems tested, result, timing, evidence, and follow-up.

Policy basis: The information security policy and Security Incident and Recovery Plan require protected backups, monitored failures, and tested proof that important data can be restored and used.

Timing: Test restoration at least annually for important systems and after recovery changes that could invalidate prior evidence.

When reviewing:

- Confirm the test restored the intended Systems and data.
- Confirm the restored data was usable and the recovery targets were met.
- Record any failure, missed target, or needed follow-up.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

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
| `componentIds` | array of id | No | Components References: `component` |

### Evidence

#### `evidence`

A retained export, report, screenshot, signed record, fixed file, or approved external reference. FileGRC operating records may support an audit directly without wrappers.

Instructions: Create an Evidence Artifact when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source Component, link the Controls and operating records it supports, retain the fixed artifact or reference, and have another person verify it before audit use.

Policy basis: The information security policy requires retained proof from authoritative Components when FileGRC operating records do not contain the full result.

Timing: Create an Evidence Artifact only for a real retained artifact or approved reference. Identify its source Component or source records, Controls, collection and verification facts, coverage, revision, and classification.

When reviewing:

- Use artifactKind signed-record and artifactSubtype signed-management-representation for the fixed signed management representation letter.
- For a signed management representation, record the actual signing timestamp in businessEventAt; collectedOn records when FileGRC received the artifact, not when management signed it.
- Use artifactKind third-party-report and artifactSubtype soc2-report for the final report issued by the CPA firm, and record the report's actual issuance timestamp in sourceGeneratedAt.

Default sources: `policy-information-security`

Path: `data/evidence/<id>/evidence.json`

Markdown companions:

- **Evidence**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `draft`, `collected`, `verified`, `withdrawn` |
| `artifactKind` | enum | Yes | Values: `population-export`, `system-export`, `configuration-export`, `capture`, `signed-record`, `third-party-report`, `rendered-page`, `business-record`, `other` |
| `artifactSubtype` | string | No |  |
| `sourceKind` | enum | Yes | Values: `component`, `file`, `external-reference`, `rendered-page`, `authored-record` |
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
| `sourceResourceIds` | array of id | No | Relation group: `evidence-source-record`. References: `document`, `obligation`, `obligation-event`, `requirement`, `commitment`, `complementary-control`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `attestation`, `meeting`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
| `filePaths` | array of data-path | Conditional | Required when `sourceKind` is `file` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is one of `file`, `system`, `rendered-page`, `authored-record`. |
| `externalReference` | object (`external-reference`) | Conditional | Required when `sourceKind` is `external-reference` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is one of `external-reference`, `system`. |
| `sourceCommit` | string | Conditional | Required when `sourceKind` is `rendered-page` and `status` is one of `collected`, `verified`, `withdrawn`. |
| `capture` | object (`page-capture`) | Conditional | Required when `sourceKind` is `rendered-page` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is `rendered-page`. |
| `classificationId` | id | Conditional | Classification References: `classification` Required when `status` is one of `collected`, `verified`, `withdrawn`. |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `artifactKind` is `population-export`. |
| `withdrawal` | object (`withdrawal`) | Conditional | Required when `status` is `withdrawn`. Allowed when `status` is `withdrawn`. |
| `businessEventAt` | timestamp | No | Business event time |
| `sourceGeneratedAt` | timestamp | No | Source generation time |
| `collectedAt` | timestamp | No | Collection time |
| `verifiedAt` | timestamp | No | Verification time |
| `readinessTest` | boolean | No | Pre-period readiness test |
| `coveredSourceFamilyIds` | array of string | No | Covered source families |
| `retrievalMethodKey` | string (id) | No | Retrieval method key |
| `accessConfirmed` | boolean | No | Access confirmed |
| `retrievalResult` | enum | No | Retrieval result Values: `passed`, `failed`, `partial` |
| `sourceComponentId` | id | Conditional | Source Component References: `component` Required when `sourceKind` is `component` and `status` is one of `collected`, `verified`, `withdrawn`. Allowed when `sourceKind` is one of `component`, `rendered-page`. |
| `componentIds` | array of id | No | Components References: `component` |

At least one of **content Markdown** is required when `sourceKind` is `authored-record` and `status` is one of `collected`, `verified`, `expired`, `withdrawn`.

#### `source-coverage`

A reviewed decision about where one evidence source family is authoritative for a defined scope and period.

Instructions: A reviewed decision about where one evidence source family is authoritative for a defined scope and period.

Policy basis: Applicable control and audit work must identify an authoritative source for complete populations and retained evidence.

Timing: Review before an evidence period, after a source or retrieval change, and during period reconciliation.

When reviewing:

- Decide whether this source family applies to the current scope and audit period.
- Confirm the chosen source can produce the complete population or evidence needed.
- Use not applicable or zero population only when that conclusion is factually true.

Path: `data/source-coverage/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `active`, `retired` |
| `sourceFamilyId` | enum | Yes | Source family Values: `workforce`, `training-acknowledgement`, `identity-access`, `production-change`, `security-monitoring`, `vulnerability-management`, `endpoint-asset`, `backup-recovery`, `vendor-management`, `exception-finding`, `data-handling`, `network-security`, `governance`, `risk-management` |
| `coverageKind` | enum | Yes | Coverage kind Values: `filegrc`, `external-component`, `not-applicable`, `zero-population` |
| `scopeResourceIds` | array of id | Yes | References: `program`, `system`, `component`, `control`, `policy`, `person`, `team`, `vendor` |
| `excludedPopulation` | string | No |  |
| `retrieverIds` | array of id | Conditional | References: `person` Required when `coverageKind` is `external-component` and `status` is `active`. |
| `collectionCadence` | string | Conditional | Required when `status` is `active`. |
| `retentionScheduleItemIds` | array of id | No | Retention schedule items References: `retention-schedule-item` |
| `retentionNotes` | string | No | Legacy retention notes |
| `reconciliationMethod` | string | Conditional | Required when `status` is `active`. |
| `validFrom` | date | Conditional | Required when `status` is `active`. |
| `validThrough` | date | No |  |
| `applicabilityReview` | object (`applicability-review`) | Conditional | Required when `coverageKind` is one of `not-applicable`, `zero-population` and `status` is `active`. |
| `readinessTestEvidenceIds` | array of id | No | References: `evidence` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is `retired`. Allowed when `status` is `retired`. |
| `componentId` | id | Conditional | Authoritative Component References: `component` Required when `coverageKind` is `external-component` and `status` is `active`. |

#### `control-activity`

A completed or externally reconciled operating activity using a model-owned completion profile.

Instructions: A completed or externally reconciled operating activity using a model-owned completion profile.

Policy basis: Recurring control operation needs dated facts about who performed and reviewed the work, its scope, result, evidence, and follow-up.

Timing: Create one record for each required occurrence or reconciled external activity.

When reviewing:

- Confirm the activity actually occurred for the stated scope and period.
- Confirm the result and Evidence match the work performed.
- Confirm every exception or failed objective has follow-up.

Path: `data/control-activities/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `complete`, `externally-managed`, `canceled` |
| `profileId` | enum | Yes | Completion profile Values: `endpoint-verification`, `inventory-review`, `log-review`, `network-review`, `continuity-review`, `control-design-review`, `performance-review`, `workforce-review`, `personal-device-approval`, `security-scan` |
| `obligationId` | id | No | References: `obligation` |
| `controlIds` | array of id | No | References: `control` |
| `scopeResourceIds` | array of id | Yes | Relation group: `obligation-scope`. References: `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit`, `source-coverage`, `retention-schedule-item`, `requirement-mapping`, `component`, `information-type` |
| `performerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `completedAt` | timestamp | Conditional | Required when `status` is `complete`. |
| `method` | string | Conditional | Required when `status` is `complete`. |
| `result` | outcome | Conditional | Required when `status` is `complete`. |
| `reviewerIds` | array of id | Conditional | References: `person` Required when `status` is `complete`. |
| `reviewedOn` | date | Conditional | Required when `status` is `complete`. |
| `evidenceIds` | array of id | No | References: `evidence` |
| `followupActionIds` | array of id | No | References: `action-item` |
| `externalActivity` | object (`external-activity-reference`) | Conditional | Required when `status` is `externally-managed`. Allowed when `status` is `externally-managed`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

### Issues and Remediation

#### `obligation`

Reusable schedules for recurring or event-driven work. Obligations feed the Work Queue; completion records and linked Evidence prove that the work occurred. Obligations are not required for SOC 2.

Instructions: Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.

Policy basis: FileGRC uses Obligations to turn approved schedules into owned, dated work linked to scope and required proof. An enabled Obligation remains dormant until every governing Policy and required program Document is active and effective.

Timing: Configure and enable the schedule during Control implementation. Do not create occurrences while a governing Policy or required program Document is inactive. Start with the latest of the stored recurrence anchor, Policy effective dates, and governed Document effective dates, then create a separate completion record for every period.

Default sources: `policy-information-security`, `document-security-incident-recovery-plan`

Path: `data/obligations/<id>.json`

Markdown companions:

- **Instructions**: `.md` beside the JSON record (optional).

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `proposed`, `active`, `paused`, `retired` |
| `activityType` | enum | Yes | Values: `custom`, `access-change`, `access-provisioning`, `access-removal`, `access-review`, `alert-path-test`, `asset-recovery`, `asset-registration`, `backup-test`, `change-review`, `control-design-review`, `continuity-review`, `document-review`, `exception-review`, `exercise`, `incident-retrospective`, `endpoint-verification`, `inventory-review`, `log-review`, `meeting`, `network-review`, `oversight-meeting`, `penetration-test`, `performance-review`, `workforce-review`, `personal-device-approval`, `policy-review`, `remediation`, `retention-review`, `risk-assessment`, `role-training`, `security-scan`, `training`, `vendor-contract`, `vendor-remediation`, `vendor-review`, `vulnerability-scan`, `workforce-acknowledgement` Values come from the `obligationActivities` registry. |
| `customActivity` | object (`custom-obligation-activity`) | Conditional | Custom activity definition Required when `activityType` is `custom`. Allowed when `activityType` is `custom`. |
| `scheduleMode` | enum | Yes | Values: `rule`, `legacy` |
| `ruleIds` | array of id | No | References: `obligation-rule` |
| `activeRuleId` | id | Conditional | References: `obligation-rule` Required when `scheduleMode` is `rule` and `status` is one of `active`, `paused`, `retired`. |
| `triggerPrompt` | string | No |  |
| `scopeResourceIds` | array of id | No | Relation group: `obligation-scope`. References: `workspace`, `person`, `appointment`, `service-account`, `team`, `system`, `asset`, `document`, `framework`, `requirement`, `commitment`, `complementary-control`, `control`, `policy`, `training`, `risk`, `vendor`, `access-grant`, `vulnerability`, `incident`, `audit`, `source-coverage`, `retention-schedule-item`, `requirement-mapping`, `component`, `information-type` |
| `templateResourceId` | id | No | Relation group: `obligation-template`. References: `person`, `system`, `asset`, `document`, `control`, `policy`, `training`, `retention-schedule-item`, `requirement-mapping` |
| `controlIds` | array of id | No | References: `control` |
| `policyIds` | array of id | No | References: `policy` |
| `completionResourceIds` | array of id | No | Relation group: `completion-record`. References: `access-grant`, `asset`, `control`, `document`, `evidence`, `control-test`, `finding`, `exception`, `action-item`, `policy-review`, `policy`, `attestation`, `meeting`, `risk-assessment`, `risk`, `vendor`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `statusTransition` | object (`status-transition`) | Conditional | Required when `status` is one of `paused`, `retired`. Allowed when `status` is one of `paused`, `retired`. |
| `eventRiskLevels` | array of string | No | Event risk levels Values: `normal`, `high` |
| `recurrence` | object (`recurrence`) | Conditional | Required when `scheduleMode` is `legacy`. Allowed when `scheduleMode` is `legacy`. |
| `window` | object (`obligation-window`) | No | Allowed when `scheduleMode` is `legacy`. |
| `startsOn` | date | No | Allowed when `scheduleMode` is `legacy`. |
| `endsOn` | date | No | Allowed when `scheduleMode` is `legacy`. |

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
| `riskLevel` | enum | Conditional | Departure risk Values: `normal`, `high` Required when `eventType` is `person-ended`. |

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
| `sourceResourceId` | id | Yes | Relation group: `work-source`. References: `control`, `control-test`, `finding`, `exception`, `obligation`, `obligation-event`, `policy-review`, `meeting`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
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
| `componentIds` | array of id | No | Components References: `component` |

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
| `sourceResourceId` | id | Yes | Relation group: `work-source`. References: `control`, `control-test`, `finding`, `exception`, `obligation`, `obligation-event`, `policy-review`, `meeting`, `risk`, `risk-assessment`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` |
| `description` | string | No |  |
| `priority` | rating | No |  |
| `obligationId` | id | No | References: `obligation` |
| `obligationRuleId` | id | No | Governing obligation rule References: `obligation-rule` |
| `completedOn` | date | Conditional | Required when `status` is `done`. |
| `evidenceIds` | array of id | No | References: `evidence` |
| `completionResourceIds` | array of id | No | Relation group: `completion-record`. References: `access-grant`, `asset`, `control`, `document`, `evidence`, `control-test`, `finding`, `exception`, `action-item`, `policy-review`, `policy`, `attestation`, `meeting`, `risk-assessment`, `risk`, `vendor`, `vendor-review`, `access-review`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping` |
| `blockingResourceIds` | array of id | Conditional | Relation group: `work-blocker`. References: `person`, `appointment`, `team`, `system`, `asset`, `document`, `evidence`, `obligation`, `obligation-event`, `control`, `control-test`, `finding`, `exception`, `action-item`, `policy`, `policy-review`, `training`, `risk`, `risk-assessment`, `vendor`, `vendor-review`, `access-grant`, `access-review`, `vulnerability`, `vulnerability-scan`, `incident`, `exercise`, `backup-test`, `penetration-test`, `data-request`, `audit`, `audit-population`, `audit-request`, `source-coverage`, `control-activity`, `retention-schedule-item`, `requirement-mapping`, `obligation-rule`, `obligation-occurrence`, `reporting-route` Required when `status` is `blocked`. Allowed when `status` is `blocked`. |
| `completionWindow` | object (`completion-window`) | Conditional | Completion window Required when `status` is one of `open`, `in-progress`, `blocked`. |
| `cancellation` | object (`cancellation`) | Conditional | Required when `status` is `canceled`. Allowed when `status` is `canceled`. |

#### `obligation-rule`

One immutable reviewed revision of an Obligation schedule, population rule, and completion criteria.

Instructions: One immutable reviewed revision of an Obligation schedule, population rule, and completion criteria.

Policy basis: A reusable schedule must be reviewed before it governs work. The rule records the exact management rationale or authoritative source used for that decision.

Timing: Create a proposed revision, review it, then activate it at a real effective time. Never backdate a late decision or rewrite a prior effective rule.

Path: `data/obligation-rules/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `proposed`, `approved`, `active`, `retired` |
| `obligationId` | id | Yes | References: `obligation` |
| `activityDefinitionVersion` | string | No |  |
| `recurrence` | object (`recurrence`) | Yes |  |
| `window` | object (`obligation-window`) | No |  |
| `selector` | object (`scope-selector`) | No |  |
| `rationale` | string | Yes |  |
| `sourceResourceIds` | array of id | No | References: `policy`, `document`, `commitment`, `risk`, `appointment` |
| `approvedByIds` | array of id | Conditional | References: `person` Required when `status` is one of `approved`, `active`, `retired`. |
| `approvedOn` | date | Conditional | Required when `status` is one of `approved`, `active`, `retired`. |
| `effectiveAt` | timestamp | Conditional | Required when `status` is one of `active`, `retired`. |
| `timezone` | string (timezone) | Conditional | Required when `status` is one of `approved`, `active`, `retired`. |
| `cutoverDecision` | enum | No | Values: `new-windows-only`, `supersede-open-window`, `keep-open-window` |
| `supersedesId` | id | No | References: `obligation-rule` |
| `retiredOn` | date | Conditional | Required when `status` is `retired`. |

#### `obligation-occurrence`

The reviewed population and operating result for one rolled-up Obligation window or Policy Event action.

Instructions: The reviewed population and operating result for one rolled-up Obligation window or Policy Event action.

Policy basis: A rolled-up schedule passes only after management reconciles every expected member, including a reviewed zero population.

Timing: Reconcile after the captured membership rule can no longer add members and every member deadline is resolved. Correct a finalized record only with a superseding occurrence.

Path: `data/obligation-occurrences/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `open`, `reconciled`, `superseded` |
| `obligationId` | id | Yes | References: `obligation` |
| `ruleId` | id | Yes | References: `obligation-rule` |
| `occurrenceKey` | string | Yes |  |
| `coverage` | object (`coverage-period`) | Yes |  |
| `membershipCutoffAt` | date | Yes |  |
| `collectionReviewId` | id | No | References: `collection-review` |
| `collectionReviewCommit` | string | No |  |
| `collectionReviewRevision` | string | No |  |
| `collectionRevision` | string | No |  |
| `scopeRevision` | string | No |  |
| `members` | array of object (`obligation-member`) | Yes |  |
| `expectedCount` | integer | Yes | Minimum: `0`. |
| `completedCount` | integer | Yes | Minimum: `0`. |
| `conclusion` | enum | Conditional | Values: `complete`, `complete-with-exceptions`, `incomplete`, `zero-population` Required when `status` is `reconciled`. |
| `reviewedByIds` | array of id | Conditional | References: `person` Required when `status` is `reconciled`. |
| `reconciledAt` | timestamp | Conditional | Required when `status` is `reconciled`. |
| `supersedesId` | id | No | References: `obligation-occurrence` |
| `auditPopulationIds` | array of id | No | References: `audit-population` |
| `ownerIds` | array of id | Yes | Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `programId` | id | Yes | References: `program` |

### Audits

#### `audit`

One real SOC 2 engagement with a CPA firm, including the auditor-agreed scope and period, requests, fieldwork, Findings, opinion, and final report. Management’s candidate dates remain on the Workspace.

Instructions: Create this record after engaging the CPA firm, then select the Program and record the agreed scope, criteria, Systems, subservice treatments, and report period. Control Tests and Evidence Artifacts link back with auditId or auditIds.

Policy basis: A CPA firm independently examines the scoped service against the selected Framework. Management supplies the system description, Controls, operating records, and Evidence.

Timing: Create one record after a CPA firm is engaged, or earlier only when a customer deadline makes early coordination useful. Keep management candidate dates on the workspace and record the auditor-agreed Type 1 date or Type 2 period here.

Default sources: `policy-information-security`

Path: `data/audits/<id>.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `in-progress`, `fieldwork`, `report-draft`, `issued`, `delivered`, `complete` |
| `auditKind` | enum | Yes | Values: `readiness`, `soc-2-type-1`, `soc-2-type-2` |
| `frameworkIds` | array of id | Yes | References: `framework` |
| `scope` | string | Yes |  |
| `auditorVendorId` | id | Conditional | References: `vendor` Required when `status` is one of `in-progress`, `fieldwork`, `report-draft`, `issued`, `delivered`, `complete`. |
| `fieldworkStart` | date | Conditional | Required when `status` is one of `in-progress`, `fieldwork`, `report-draft`, `issued`, `delivered`, `complete`. |
| `fieldworkEnd` | date | Conditional | Required when `status` is one of `in-progress`, `fieldwork`, `report-draft`, `issued`, `delivered`, `complete`. |
| `reportDate` | date | Conditional | Required when `status` is one of `issued`, `delivered`, `complete`. |
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
| `opinion` | enum | Conditional | Values: `unmodified`, `qualified`, `adverse`, `disclaimer`, `not-issued` Required when `status` is one of `issued`, `delivered`, `complete` and `auditKind` is one of `soc-2-type-1`, `soc-2-type-2`. |
| `opinionDate` | date | Conditional | Required when `status` is one of `issued`, `delivered`, `complete` and `auditKind` is one of `soc-2-type-1`, `soc-2-type-2`. |
| `reportEvidenceId` | id | Conditional | References: `evidence` Required when `status` is one of `issued`, `delivered`, `complete`. |
| `managementResponseDocumentId` | id | No | References: `document` |
| `supplementalDocumentIds` | array of id | No | References: `document` |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `coverage` | object (`coverage-period`) | Conditional | Coverage Required when `status` is one of `in-progress`, `fieldwork`, `report-draft`, `issued`, `delivered`, `complete`. |
| `engagementTermsDocumentId` | id | No | Engagement terms References: `document` |
| `managementAcknowledgedByIds` | array of id | No | Management acknowledgement References: `person` |
| `managementAcknowledgedOn` | date | No | Acknowledged on |
| `signatoryAppointmentIds` | array of id | No | Authorized signatories References: `appointment` |
| `scopeRevision` | string | No | Reviewed scope revision |
| `subsequentEventsReview` | object (`subsequent-events-review`) | No |  |
| `packetDelivery` | object (`packet-delivery`) | No |  |
| `retentionNotes` | string | No |  |
| `retentionScheduleItemIds` | array of id | No | References: `retention-schedule-item` |
| `carryForwardActionIds` | array of id | No | References: `action-item` |
| `priorAuditId` | id | No | Prior audit References: `audit` |
| `programId` | id | Yes | Program References: `program` |
| `subserviceTreatments` | array of object (`audit-subservice-treatment`) | No | Subservice treatments |
| `subserviceConclusion` | enum | No | Subservice conclusion Values: `not-applicable`, `identified` |
| `subserviceConclusionRationale` | string | No | Subservice conclusion rationale |

#### `audit-population`

One complete set of Control-relevant events or items for a Type 2 period, with its source Component, exact query, count, reconciliation, and fixed export, including zero-event populations.

Instructions: Record each complete Type 2 population with its source Component, fixed export, query, count, and reconciliation.

Policy basis: The CPA firm needs complete and accurate populations to select samples and test Controls. The linked population-export Evidence preserves the exact source set management supplied.

Timing: Plan at the start of the engagement, export for the exact audit period, reconcile before fieldwork, and retain proof for zero-event populations.

Path: `data/audit-populations/<id>.json`

Record Markdown: shown by default as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | enum | Yes | Values: `planned`, `reconciled`, `not-applicable`, `superseded` |
| `auditId` | id | Yes | References: `audit` |
| `populationKind` | string | Yes |  |
| `controlIds` | array of id | No | References: `control` |
| `sourceEvidenceId` | id | Conditional | References: `evidence` Required when `status` is `reconciled`. |
| `reconciledByIds` | array of id | Conditional | References: `person` Required when `status` is `reconciled`. |
| `reconciledOn` | date | Conditional | Required when `status` is `reconciled`. |
| `conclusion` | enum | Conditional | Values: `complete`, `complete-with-exceptions`, `incomplete` Required when `status` is `reconciled`. |
| `reconciliationSummary` | string | No |  |
| `notApplicableReason` | string | Conditional | Required when `status` is `not-applicable`. |
| `ownerIds` | array of id | Yes | Owners Relation group: `accountable-party`. References: `person`, `team`, `appointment` |
| `coverage` | object (`coverage-period`) | Yes | Coverage |
| `sourceComponentId` | id | Conditional | Authoritative source Component References: `component` Required when `status` is `reconciled`. |
| `supersedesId` | id | No | Superseded audit population References: `audit-population` |

#### `audit-request`

One auditor request or prepared-by-client item, with its Audit, owner, due date, approved response, Requirements, Controls, Evidence, and follow-up. A separate Audit Request tracker is not required for SOC 2 when the CPA firm’s portal is authoritative.

Instructions: When FileGRC is the approved request tracker, record each request from the audit team, assign an owner and due date, and link the approved response and evidence.

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
| `externalReference` | object (`external-reference`) | No | External request reference |
| `responseRevision` | string | No | Response revision |
| `deliveryEvidenceId` | id | No | Delivery evidence References: `evidence` |
| `reconciledByIds` | array of id | No | Reconciled by References: `person` |
| `reconciledOn` | date | No | Reconciled on |
| `externalAuthorityComponentId` | id | No | External authority Component References: `component` |

### Repository

#### `workspace`

Repository-wide organization identity and defaults. Program scope and assurance decisions belong on Program records.

Instructions: Repository-wide organization identity and defaults. Program scope and assurance decisions belong on Program records.

Policy basis: Repository identity and default time settings apply across every Program in this workspace.

Timing: Review after an organization, repository, or default timezone change.

Path: `data/workspace.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dataModelVersion` | string | Yes | Data model version |
| `organizationName` | string | Yes | Organization |
| `timezone` | string (timezone) | Yes | Timezone |
| `description` | string | No | Description |

#### `renderer-settings`

Optional local interface and browser repository settings, including onboarding visibility and authoritative-branch synchronization. Renderer settings are not required for SOC 2 and do not change compliance records.

Instructions: Optional local interface and browser repository settings, including onboarding visibility and authoritative-branch synchronization. Renderer settings are not required for SOC 2 and do not change compliance records.

Policy basis: Renderer settings are a filegrc convenience, not a SOC 2 requirement, control, audit record, or substitute for evidence. Record lifecycle status represents approval; Git branches do not.

Timing: Change it when the team wants to rerun or suppress optional onboarding or change repository synchronization.

Path: `data/renderer.json`

Record Markdown: available when needed as an implicit companion file.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `showOnboarding` | boolean | Yes | Show onboarding |
| `repositoryMode` | enum | Yes | Repository mode Values: `trunk`, `manual` |
| `authoritativeBranch` | string (git-name) | Yes | Authoritative branch |
| `repositoryRemote` | string (git-name) | Yes | Repository remote |
