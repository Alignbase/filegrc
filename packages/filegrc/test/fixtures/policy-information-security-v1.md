# Information Security Policy

## Purpose and scope

This Policy defines the information security requirements for {{company_name}} and its in-scope services. It applies to employees, contractors, authorized users, Systems, Components, devices, code, data, facilities, and Vendors used to provide or protect those services. Vendor requirements apply through approved contracts and oversight.

A Policy says what the company commits to do by the date it takes effect. Approval means the company accepts those commitments. It does not prove the work is done. Controls and operating records describe how the company meets them and provide the proof. FileGRC does not infer technical implementation from this prose. Configuration facts belong in Controls, Components, Systems, governed schedules, and Evidence.

## Integrity, accountability, and reporting

Everyone in scope must act honestly, protect company and customer information, follow approved security processes, disclose conflicts that could affect security decisions, and preserve accurate records. Fraud, deliberate control bypass, false evidence, credential sharing, unauthorized access, concealment of a security event, and retaliation for a good-faith report are prohibited.

Suspected security events, control failures, fraud, or policy violations must be reported promptly through the primary route at {{security_contact_email}} or the usable alternate route documented in the Security Incident and Recovery Plan. A person may use the alternate route when the primary route is unavailable, compromised, or involved in the concern. Management investigates credible reports, limits disclosure to people who need the information, preserves relevant records, and records corrective action.

Management evaluates conduct against these requirements and addresses violations consistently. Contractors and Vendor personnel follow equivalent requirements when their work or access can affect the in-scope service.

## Governance and risk management

The current Policy Owner maintains this Policy, the risk program, Controls, governed plans, Exceptions, and improvement work. System and process owners approve access, maintain safeguards, keep inventories and recovery facts current, and resolve findings. An independent reviewer who is separate from the Policy owner approves the Policy and challenges management's assessment of Control operation.

Management reviews the security program on its approved governed schedule and after material change. Reviews cover objectives, service commitments, fraud and misconduct risk, threats, system and Vendor changes, incidents, findings, Exceptions, overdue work, and Control results. Risks receive an owner, response, target date, approval when accepted, and a review date. The Risk Assessment Control and Obligations record the actual method and cadence.

## Workforce security and acceptable use

Workers must accept applicable confidentiality, acceptable-use, and security responsibilities before receiving access. They receive security training on the approved onboarding and recurring schedules. Role-specific instruction is assigned when a person's access or duties require it.

Users must:

- Use approved identities, devices, applications, storage, messaging, meeting, and transfer services.
- Protect credentials, authentication devices, company equipment, customer information, and security records.
- Keep company data out of personal accounts and unapproved applications.
- Lock unattended devices and protect papers, screens, and conversations from unauthorized access.
- Report lost, stolen, compromised, or unexpectedly reconfigured devices promptly.
- Return company property and stop using company access when employment, services, or the business need ends.

Managers notify access administrators of starts, role changes, and departures. The Access Control and Offboarding Controls and their event windows record the approved timing, evidence, and escalation rules.

## Assets, data, and retention

{{company_name}} inventories important Systems, Components, devices, software, service accounts, Vendors, and data stores. Records identify an owner, purpose, lifecycle state, classification, dependencies, and recovery needs where relevant.

Data owners classify information as Public, Internal, Confidential, or Restricted and approve its collection, use, access, storage, sharing, retention, and disposal. When classification is uncertain, users protect the data as Confidential until an owner decides. Collect and retain only information needed for an approved purpose.

Confidential and Restricted data must use approved Systems, encryption in transit over untrusted networks, encryption at rest, least-privilege access, and protected transfer methods. Credentials, private keys, tokens, and recovery codes belong in approved secrets-management Systems and must not appear in source files, tickets, chat, logs, or FileGRC records.

Production data must not enter development or test Systems unless an owner approves the use and equivalent protection. Public links and exports of Confidential or Restricted data require explicit authorization. Legal holds and active investigations suspend normal disposal for affected records.

The Data Retention Schedule records the approved period and disposal method for important in-scope record classes. Systems, Controls, and Components record the actual implementation. Disposal must address active copies, local copies, media, backups, and Vendor-held copies where practical, with dated proof when the Control requires it.

## Identity and access

Access requires a documented business need, owner approval, a unique identity, and least privilege. Authorized administrators provision, change, and remove access. Shared accounts require a documented technical need, named owner, restricted use, and logging.

Multi-factor authentication is required for administrative, production, source-control, email, identity, and Confidential or Restricted data access. When a System cannot support MFA, management must approve a time-bound Exception with risk assessment, compensating Controls, an accountable owner, and a review or expiration date.

Authentication settings, privileged roles, service-account ownership, credential protection, access-review populations, review cadence, and removal deadlines belong in the applicable Controls, Components, Systems, and Obligations.

## Endpoint, remote work, and physical protection

Devices used for company work must run supported software, install security updates, require authentication, lock automatically, use encryption and host protections appropriate to the platform, and permit remote removal when company-managed and technically supported. Users must not disable management, security, logging, encryption, or remote-removal safeguards.

Platforms such as macOS may provide continuous native malware and application protection without a user-triggered full scan. The Endpoint Protection Control describes the continuous protections in use and the periodic process that verifies configuration, update, and compliance state. A scheduled scan applies only when the selected technology and risk decision require one.

Personal-device access requires prior approval, registration, verified safeguards, defined company-data boundaries, and exit steps. Remote workers must protect devices, paper, screens, calls, home networks, and travel locations. Public or untrusted networks require approved encrypted access. Physical access to nonpublic work areas and protected assets is limited to authorized people.

## Infrastructure and secure change

Owners restrict network paths and management interfaces to approved business needs, use encrypted administrative protocols, disable unnecessary defaults and services, protect remote production access, and maintain secure configuration baselines. Deviations require review and, when material, an approved Exception.

Software and infrastructure changes must be recorded, tested, approved, deployed through an authorized process, and recoverable in proportion to risk. Use independent pre-deployment review when practical. When team size or urgency makes that separation impossible, record a risk-appropriate compensating or post-deployment review. Use a time-bound Exception when the remaining departure is material.

Development and deployment Controls address protected branches, controlled credentials, dependency and secret detection, input and authorization checks, production-data restrictions, security testing, emergency change review, and rollback.

## Vulnerability, logging, and monitoring

{{company_name}} monitors trusted sources for vulnerabilities affecting in-scope Systems. Management selects scanning coverage, penetration-testing applicability, remediation targets, and review cadence from exposure, change, customer commitments, and risk. The applicable Controls and Obligations record those choices. A missed target requires documented exposure, compensating Controls, a revised date, and risk approval or Exception.

Important Systems record and protect the security and operational events needed to investigate misuse and operate the service. Logs use synchronized time, restrict alteration and access, and avoid unnecessary secrets or personal data. Each System's retention period belongs in the approved Data Retention Schedule.

Owners define risk-based alerts, review paths, thresholds, and response ownership in Controls, Components, Systems, and governed schedules. Representative alert paths are tested from generation through acknowledgement, escalation, and fallback on the approved schedule and after a material path change.

## Incident response, recovery, and continuity

The Security Incident and Recovery Plan defines reporting, alternate access, severity, declaration, roles, containment, evidence handling, notification assessment, communication, recovery, closure, and exercises. Suspected unauthorized access, malware, data loss, credential exposure, or security-Control failure must be reported promptly.

Each important System records approved continuity objectives, dependencies, a backup or alternate recovery approach, monitoring, and restore-validation needs. The applicable Controls, Components, Systems, and Obligations record the actual frequency, retention, procedures, access owners, and test schedule. Management records incident and recovery exercises, results, findings, and follow-up work.

## Vendor security

New Vendors receive a risk-based security review and suitable contractual safeguards before access to Confidential or Restricted data. Reviews consider service scope, data, access, assurance, recovery, incident history, dependencies, and contract terms.

For a Vendor already in use when this Policy becomes effective, the owner records a transition review and deadline or an approved risk acceptance. Policy adoption does not imply that a historical pre-access review occurred. Vendor monitoring cadence and change-driven reassessment windows belong in the Vendor Controls and Obligations.

## Exceptions, enforcement, and review

An Exception requires a specific scope and reason, risk assessment, compensating Controls, accountable owner, approval, and expiration or review date. Violations may result in access removal, corrective action, contract remedies, or other action allowed by law and agreement.

The Policy Owner reviews this Policy on the approved governed schedule and after a material change to services, Systems, risks, commitments, or obligations. The independent reviewer approves each revised version. Git history and FileGRC records preserve the reviewed content, approval, activation, and later changes.
