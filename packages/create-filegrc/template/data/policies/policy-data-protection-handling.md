# Data Protection and Handling Policy

## Purpose

This policy defines how {{company_name}} classifies, accesses, uses, stores, shares, retains, and disposes of data.

## Scope

This policy applies to employees, contractors, vendors, systems, devices, and records that create, receive, process, store, or transmit data on behalf of {{company_name}}.

## Responsibilities

The current Policy Owner owns this policy. System and data owners decide which data a system may process, assign classifications, approve access, and set retention requirements. Everyone in scope must handle data according to its classification and report suspected loss or misuse.

Questions and reports should be sent to {{security_contact_email}}.

## Data classification

Data owners assign the highest classification required by the data in a record, file, system, or transfer.

| Classification | Description | Examples | Minimum handling |
| --- | --- | --- | --- |
| Public | Approved for public release | Published web content and public documentation | Protect integrity and use approved publishing processes |
| Internal | Intended for the workforce and approved partners | Internal procedures and routine business records | Limit access to people with a business need |
| Confidential | Disclosure could harm {{company_name}}, a customer, or another person | Contracts, financial records, customer data, source code, and security records | Approved systems, access control, encryption in transit and at rest, and protected sharing |
| Restricted | Disclosure or alteration could cause severe harm or trigger legal duties | Credentials, cryptographic keys, regulated data, and highly sensitive security material | Explicit approval, least privilege, encryption in transit and at rest, and additional monitoring |

When classification is uncertain, treat the data as Confidential until its owner decides.

Credentials, private keys, authentication tokens, and recovery codes must be stored in an approved secrets-management system. Do not put them in source files, tickets, chat messages, policy records, or other general-purpose repositories.

## Data inventory and ownership

{{company_name}} maintains records of systems and important data stores. Those records identify:

- An accountable owner
- Business purpose
- Data types and classification
- Source and authorized recipients
- Retention or deletion requirements
- Important vendors and processing locations
- Security and recovery needs

Owners review their records at least annually and after a material change.

## Collection and use

Collect only data needed for an approved business purpose. Tell people how their personal data will be used when required. Do not reuse data for an incompatible purpose without review and approval.

Access must follow least privilege. Owners approve access based on job duties, and managers or system owners review access at least quarterly for systems containing Restricted data and at least annually for other important systems.

Do not browse, copy, export, or analyze data out of curiosity or for personal use.

## Access approval and removal

Access to Confidential or Restricted data follows this process:

1. A manager or data owner requests access for a stated role and business need.
2. The reviewer checks that the requested access is the minimum needed.
3. The system owner or security owner approves elevated or sensitive access.
4. An authorized administrator provisions the access and records the decision.
5. Access changes and removals follow the same approval and recording requirements. Departures and role changes are handled promptly under the Information Security Policy.

## Storage

Internal, Confidential, and Restricted data must be stored in services approved for its classification. Local storage should be limited to a business need.

Confidential and Restricted data must be encrypted in transit over untrusted networks and at rest in approved systems and on devices. Encryption keys and data must have separate access controls where practical.

Production data must not be copied into development or test systems unless the owner approves the use and those systems meet the same protection requirements. Prefer generated or de-identified test data.

Paper records containing Confidential or Restricted data must be secured when unattended and destroyed with an approved method.

## Sharing and transfer

Before sharing Confidential or Restricted data, verify:

- The recipient and business need
- The minimum data required
- The recipient's authorization
- The transfer method and destination
- Contractual, privacy, and geographic restrictions

Use approved encrypted channels. Do not send Restricted data through personal email, consumer file-sharing accounts, or unapproved messaging services.

Public links must not be used for Confidential or Restricted data. Time-limit external access where the system supports it, and remove access when the business need ends.

## Vendors and subprocessors

Vendors that process Confidential or Restricted data must complete a security and privacy review before access begins. Contracts must state the permitted use, protection, incident notification, return or deletion, and any required audit rights.

Owners review critical vendors at least annually and when the service or data use changes materially.

## Retention and disposal

Keep data only as long as required for its business purpose and applicable legal, contractual, tax, audit, or security needs. Data owners document retention rules for important record classes in the Data Retention Schedule.

When retention ends, delete or anonymize the data through an approved process. Approved methods include cryptographic erase or secure wiping for reusable media and physical destruction, pulverization, or shredding for media that will not be reused. Choose a method suited to the medium and data classification.

Disposal must cover active systems, local copies, and vendor-held data where practical. Backup copies may expire through the normal protected backup cycle if they cannot be selectively deleted.

Legal holds and active investigations suspend normal deletion for the affected data.

The policy owner reviews the Data Retention Schedule at least annually and within 30 days after a material change to systems, data use, vendors, contracts, or applicable duties. The schedule's approver must be separate from its owner.

## Personal data requests

Requests to access, correct, export, restrict, or delete personal data must be sent to the responsible privacy or legal owner. Track the request using the minimum personal data needed. This repository should use an opaque case ID and an approved-system reference when keeping the person's identity in Git would conflict with deletion duties.

## Security incidents

Report suspected loss, unauthorized access, unintended disclosure, or improper disposal immediately to {{security_contact_email}}. Do not delete evidence, contact affected people, or make external statements unless the incident lead authorizes it.

{{company_name}} will investigate, contain, document, and notify affected parties as required by its incident process and applicable obligations.

## Training and compliance

Workers receive data-handling training when they join and at least annually. Additional training may be required for people who handle Restricted data.

People who develop or materially change applications complete secure-development training within 30 days of starting those duties or changing into a covered role. Training covers common application risks, access control, input handling, secrets, logging, dependencies, and secure review.

Violations may result in access removal, corrective action, contract remedies, or other action allowed by law and agreement.

Exceptions require a documented business reason, owner, risk assessment, compensating controls, expiration date, and approval from the current Policy Owner.

## Review

{{company_name}} assesses data-protection risks at least annually, either as part of the information security risk assessment or as a separate assessment. The assessment covers material changes in data use, systems, vendors, contracts, and applicable duties.

The policy owner reviews this policy at least annually and after a material change to data use, law, contracts, or systems. Git history records approvals and changes.
