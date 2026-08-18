# ADR 0001: Model v4 programs, systems, components, and information

- Status: Accepted
- Date: 2026-08-14
- Scope: FileGRC data model v4 and the v3-to-v4 migration

## Context

Model v3 uses `system` for two different concepts. It can mean the complete bounded service that management governs and a tool, platform, application, repository, or provider service used inside that boundary. This makes scope, control implementation, evidence provenance, and SOC 2 system descriptions hard to state precisely. It also puts program facts such as the assurance goal, selected criteria, controls, systems, risk method, and candidate period on the repository-wide Workspace record.

Model v4 must use AICPA SOC 2 terms for the subject matter and borrow the useful separation in NIST OSCAL between a system, its components, inventory items, control implementation, and assessment results. FileGRC will keep flat JSON records and ID relationships. OSCAL is an interoperability reference, not FileGRC's native storage format.

## Decision

### Workspace

Workspace identifies the repository and organization. It stores `dataModelVersion`, organization name, repository description, and default timezone. It does not define a compliance program or its scope.

One repository can hold more than one Program. Commands that calculate readiness require a Program when more than one active Program exists. A single active Program remains the default for compact CLI and browser workflows.

### Program

Program is management's defined compliance or assurance program. It stores:

- assurance goal;
- selected Systems;
- selected Frameworks;
- Program-scoped Requirement applicability decisions;
- selected management Controls;
- accountable owners;
- the risk methodology;
- candidate coverage dates; and
- optional namespaced external identifiers.

Requirement records remain catalog content. They no longer store management applicability. Each Program stores an array of applicability decisions with the Requirement ID, decision, rationale, reviewer, review date, and scope revision. An applicable decision selects the Requirement. This avoids changing a Framework catalog when two Programs reach different decisions.

### System

System is the complete bounded system being governed or examined. It follows the AICPA SOC 2 use of “system,” not the everyday synonym for a software product.

A System stores its purpose, services provided, boundary, exclusions, owners, Information Types, continuity objectives, lifecycle state, and related Commitments. Controls keep the authoritative direction for Control-to-System scope. Components keep the authoritative direction for Component-to-System use. Reverse links are derived.

The five component sections in an AICPA SOC 2 system description are derived as follows:

| System-description section | FileGRC source |
| --- | --- |
| Infrastructure | related Components with `componentKind: infrastructure`, `network`, `physical`, `external-system`, or `interconnection`, plus linked Assets when management inventories specific instances |
| Software | related Components with `componentKind: software` or `service` |
| People | System and Program owners, Control owners and operators, Teams, Appointments, and people named by operating records |
| Procedures | approved Policies and Documents plus Control companion Markdown and linked Obligations |
| Data | System Information Types, Component information uses, Classification records, and Evidence Artifact classifications |

This derivation does not copy the same narrative into each record. The management system-description Document remains the approved narrative supplied to the auditor.

### Component

Component is a logical operational or technical building block that materially delivers a System's services, operates or supports a Control, produces authoritative evidence, or supports relevant operations.

`componentKind` is controlled to:

- `infrastructure`;
- `software`;
- `service`;
- `network`;
- `physical`;
- `external-system`; and
- `interconnection`.

A Component stores zero or one primary `vendorId`, owners, lifecycle state, Information Type uses, evidence source roles, evidence access owners, continuity objectives, and `systemUses`. Each `systemUses` entry contains one `systemId`, one or more roles, and a rationale. Roles are `service-delivery`, `control-support`, `evidence-source`, and `supporting-operations`. The pair of Component and System is unique. A Component may have different roles and rationales for different Systems.

A Component is relevant to a System only when the corresponding use has at least one role and a non-empty rationale. Merely buying, installing, or occasionally running a tool does not make it a Component.

### Vendor

Vendor is an external organization and its commercial relationship. It stores contracts, due diligence, risk reviews, monitoring, assurance reports, relationship dates, owners, criticality, and the Information Types it can access.

The following invariants apply:

- a Vendor does not require a Component;
- a Component does not require a Vendor;
- a Vendor may supply several Components;
- a Component has at most one primary Vendor;
- Vendor criticality or data access does not place it inside a System boundary;
- Vendor-to-System relationships are derived through Components;
- creating a Vendor does not create a Component; and
- a utility or tool becomes a Component only when it materially participates in service delivery, control operation, or retained evidence production.

Model v4 removes Vendor `service`, `subprocessor`, and `backupVendorId`. Supplied capabilities belong on Components. Alternate supplier choices belong on a Component or continuity plan. Subprocessor and SOC 2 subservice treatment are contextual decisions and are not global Vendor properties.

An Audit stores subservice treatment entries for its scope. Each entry names a Vendor, relevant Components, `inclusive` or `carve-out` treatment, and a rationale. FileGRC does not add an Audit Subservice Treatment resource.

### Asset

Asset remains an inventory item with custody and lifecycle. It represents a specific device, deployed instance, account, medium, or other item management tracks individually. It references one or more Components. Its System membership is normally derived through those Components.

Component and Asset remain separate because a control can rely on one logical capability while inventory contains many changing instances. Combining them would either duplicate control relationships on every device or erase custody, serial number, acquisition, and retirement facts.

### Classification and Information Type

Model v4 normalizes both concepts.

Classification defines an ordered handling category and its handling description. Records use Classification IDs instead of values defined in Workspace.

Information Type defines a stable category of information and its default Classification. Systems list the Information Types they process. Component information-use entries state whether each type is stored, processed, or transmitted. Vendors list Information Types they can access. Risks list affected Information Types. Evidence Artifacts name their Classification.

This adds two small flat resources, but prevents uncontrolled copies of `dataTypes` strings and lets validation enforce consistent references. Organization-specific details still belong in namespaced extensions.

### Controls

Control is management's implementation. It stores:

- `systemIds`, the Systems where the Control applies;
- `componentIds`, the Components that operate or support it; and
- `evidenceSourceComponentIds`, the Components that produce its authoritative evidence.

An implemented Control must relate only to Components with a relevant, rationalized System use. An evidence-source Component must include the `evidence-source` role for at least one System where the Control applies, declare the needed evidence source kind, name current evidence access owners, and include repeatable retrieval instructions in companion Markdown.

Control status records implementation state. Design adequacy and operating effectiveness remain conclusions of reviews and Control Tests.

### Evidence Artifact

The resource type remains `evidence` and the collection remains `data/evidence/` so stable IDs, paths, commands, and Git history survive. Its user-facing title becomes Evidence Artifact.

An Evidence Artifact is a retained export, report, screenshot, signed record, fixed file, or approved external reference. It may name a `sourceComponentId`, source records, Controls, Audits, collection and verification facts, coverage, source Git revision, attachments or reference, and checksum. `sourceKind: component` replaces `sourceKind: system`.

FileGRC operating records, meetings, tests, reviews, and activities may support an audit directly. They do not need Evidence Artifact wrappers.

### External identifiers

Every resource may carry an `externalIds` object. Keys are lowercase namespaced identifiers such as `oscal`, `aicpa.example`, or `company.example`; values are external IDs. FileGRC IDs remain canonical and immutable.

The conceptual OSCAL mapping is:

| FileGRC | OSCAL concept |
| --- | --- |
| Framework and Requirement | Catalog |
| Program applicability | Profile |
| System | SSP system |
| Component | implemented component |
| Asset | inventory item |
| Control | control implementation |
| Evidence Artifact | evidence or resource |
| Control Test and Finding | assessment result concepts |

FileGRC will not claim OSCAL compatibility until an exporter validates generated data against the official OSCAL schema.

## V3 System field mapping

| v3 System field | v4 destination | Migration class |
| --- | --- | --- |
| `id`, `title`, `status` | same System fields when the record remains a System; same Component fields when converted | automatic after identity decision |
| `description` | System `boundary` for bounded Systems; Component `description` for Components | automatic with review note |
| `systemKind` | evidence for System-or-Component classification; removed after mapping | automatic or review-required |
| `criticality` | Component `criticality`; retained on System as service criticality | automatic |
| `environment` | Component `environment`; System extension if it describes the whole boundary | automatic for Component, review-required for System |
| `vendorId` | Component `vendorId`; never used alone to place a Vendor or Component in scope | automatic for Component, review-required for System |
| `dataTypes` | normalized Information Type IDs, then System `informationTypeIds` or Component `informationUses` | automatic with review note |
| `internetExposed` | System `internetExposed` when it describes the boundary; Component `internetExposed` otherwise | automatic after identity decision |
| `parentSystemId` | Component `systemUses` when parent remains a System; otherwise requires a reviewed target System | automatic or review-required |
| `subserviceVendorIds` | removed; Audit subservice treatments must be decided per engagement | review-required, never inferred |
| `evidenceSourceKinds` | Component `evidenceSourceKinds` | automatic for Component; review-required when an old bounded System carried the field |
| `evidenceOwnerIds` | Component `evidenceOwnerIds` | automatic for Component; review-required when an old bounded System carried the field |
| `continuityObjectives` | same field on the retained System or converted Component | automatic |
| `ownerIds` | same field on the retained System or converted Component | automatic |
| `classificationId` | System `classificationId` or Component `classificationId`, referencing a Classification record | automatic |
| `statusTransition`, `tags`, `extensions` | same concept on the retained identity | automatic |

## V3 relationship mapping

The migration rewrites every v3 relationship to System in one atomic batch.

| v3 source | v3 field | v4 mapping |
| --- | --- | --- |
| Workspace | `systemIds` | new Program `systemIds`, retaining only records classified as Systems |
| Service Account | `systemIds` | retained System IDs plus `componentIds` for converted records |
| System | `parentSystemId` | Component `systemUses`; no System hierarchy is inferred |
| Asset | `systemIds` | `componentIds` for converted records; retained exceptional System links require review and are removed after Component selection |
| Document | `systemIds` | retained System IDs; converted IDs become `componentIds` |
| Evidence | `systemIds` | retained System context plus converted `componentIds` |
| Evidence | `sourceSystemId` | `sourceComponentId`; a source that remains a bounded System requires a Component decision |
| Commitment | `systemIds` | retained System IDs; a converted target requires review because commitments describe bounded Systems |
| Complementary Control | `systemIds` | retained System IDs; converted IDs become `componentIds` when they identify the supported implementation |
| Control | `systemIds` | retained System IDs; converted IDs become `componentIds` |
| Control | `evidenceSourceIds` | `evidenceSourceComponentIds`; retained bounded Systems require review |
| Finding | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Risk | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Risk Assessment | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Access Grant | `systemId` | `componentId`; a bounded-System target requires review |
| Access Review | `systemIds` | `componentIds` for converted records; retained bounded-System targets require review |
| Vulnerability | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Vulnerability Scan | `systemIds` | `componentIds` for converted records; retained bounded-System targets require review |
| Incident | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Exercise | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Backup Test | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Penetration Test | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Data Request | `systemIds` | retained System IDs plus `componentIds` for converted records |
| Audit | `systemIds` | retained engagement System scope; `programId` links the source Program |
| Audit Population | `sourceSystemId` | `sourceComponentId`; bounded-System targets require review |
| Audit Request | `externalAuthoritySystemId` | `externalAuthorityComponentId`; bounded-System targets require review |
| Collection Review | `scopeResourceIds` | Workspace becomes Program for program-scoped reviews; retained Systems remain |
| Collection Review | `authoritativeSystemId` | `authoritativeComponentId`; bounded-System targets require review |
| Source Coverage | `systemId` | `componentId` and `coverageKind: external-component` |
| Source Coverage | `scopeResourceIds` | Workspace becomes Program; retained Systems remain; converted records use Component IDs |

Relationships not listed above keep their v3 authoritative direction. The migration also moves Workspace Framework, Requirement, Control, assurance, risk-method, and candidate-period fields to Program; moves Requirement applicability into Program decisions; normalizes Vendor and System `dataTypes`; converts classification definitions into Classification records; and updates Audit subservice fields without inferring treatment.

## Migration and compatibility

The CLI supports `migrate --to-model 4 --preview --json` and the same command with `--yes`. Preview returns every change as `automatic`, `review-required`, or `unsupported`, plus before-and-after file data.

The migration preserves IDs when a record keeps its identity. A converted old System keeps its ID even though its `type` and directory change, so references and Git searches remain recognizable. The batch write moves the JSON and companion Markdown atomically, rewrites all relationships, validates the complete v4 candidate, and updates Workspace last. A v3 write cannot validate against v4, and a v4 package rejects a partially migrated candidate.

Classification rules are deliberately conservative:

- An old root System remains a System automatically only when it is selected in Workspace scope, has no parent, has no Vendor, and is the subject of a service Commitment or is explicitly `systemKind: service`.
- An old record becomes a Component automatically when it has a parent System, has a Vendor, or its kind is one of application, infrastructure, platform, repository, evidence-source, software, network, physical, external-system, or interconnection, provided a target bounded System can be identified.
- Any old System satisfying both rules, neither rule, or pointing only to another would-be Component is review-required.
- A migration override file may record `systemDecisions` with `system` or `component` and the target System uses. Preview reports these decisions before apply.

The migration never infers subservice or subprocessor status. It never scopes a Vendor or Component because an old System has `vendorId`. Dated evidence, coverage, Git revisions, attachments, and existing paths below each Evidence directory remain unchanged. Unsupported items prevent apply. Review-required items remain explicit but do not prevent apply when the resulting v4 records can safely stay planned; identity ambiguity and relationship ambiguity do prevent apply because guessing would corrupt scope.

The upgrade guide documents the override payload and report. v1 and v2 remain readable only for their existing staged migrations. A v2 workspace migrates to v3 before v4.

## Rejected alternatives

### Adopt OSCAL JSON as native storage

Rejected because OSCAL's nested documents, UUID conventions, profile merge behavior, and back-matter links would make ordinary Git review and one-record edits harder. It would also force FileGRC workflows to mirror schema concepts that are not needed for a small management program.

### Keep one System type and add a subtype

Rejected because scope and evidence rules would still need subtype checks everywhere, and users would continue calling vendors' products Systems beside the bounded SOC 2 System.

### Mirror every Vendor as a Component

Rejected because the commercial relationship and the operational capability have different lifecycles and scope rules. It would also put payroll firms, banks, and occasional tools into technical boundary diagrams without a factual basis.

### Combine Component and Asset

Rejected because logical control support is many-to-many and stable, while inventory items are specific, numerous, and lifecycle-driven.

### Keep classifications and data types in Workspace

Rejected because repeated free-form strings cannot be validated or related consistently across Systems, Components, Vendors, Risks, and Evidence Artifacts.

### Add a full OSCAL Profile

Rejected until FileGRC needs catalog merging or parameter tailoring. Program-scoped applicability decisions cover the current workflow with fewer records.

### Add relationship resources

Rejected because Component `systemUses` carries the required role and rationale without creating a second collection and reverse-link maintenance problem.

## Consequences

Readiness, workflow, browser pickers, onboarding, audit preparation, population checks, evidence mapping, and packets must resolve operational scope from Program and Component uses. Unrelated Components and Assets do not affect a Program. Vendor inventory review stays separate and hashes every Vendor because a material external relationship does not need to supply a Component. Other scoped collection reviews hash only the selected Program and the records in their calculated population, so unrelated inventory changes do not make them stale.

The starter workspace creates one planned Program and one bounded System. It creates only Components that meet the positive inclusion rules. Starter records are prompts and do not assert that a provider, subservice treatment, or evidence source exists.

## Unresolved decisions

The following may require a later model version if real use cases demand them:

- multiple primary Vendors for one Component;
- reusable parameter tailoring or merged Framework profiles;
- Component-to-Component dependency metadata beyond an interconnection Component;
- separate logical and physical information-flow records;
- an official OSCAL import or export contract; and
- Program-specific Control variants when one management implementation cannot be shared safely across Programs.

None is implemented speculatively in v4.
