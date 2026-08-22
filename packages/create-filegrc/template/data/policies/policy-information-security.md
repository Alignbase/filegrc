# Information Security Policy

## Purpose and scope

This Policy defines the information security requirements for {{company_name}} and its in-scope services. It applies to employees, contractors, authorized users, Systems, Components, devices, code, data, facilities, and Vendors used to provide or protect those services. Vendor requirements apply through approved contracts and oversight.

This consolidated Policy uses security-policy names commonly requested in customer questionnaires and assurance reviews. A questionnaire response may cite this Policy and the applicable section, but it must reflect the organization's actual scope, implemented Controls, approved Exceptions, and available Evidence. A section title does not establish a separate document or prove that a Control operates.

This Policy establishes management requirements. Approval means the company accepts those requirements, which become effective only on the recorded effective date. Approval does not by itself demonstrate implementation or operation. Management documents supporting procedures, configurations, Control operation, and Evidence separately.

## Consolidated policy index

- **Governance and workforce:** Information Security Governance and Organization; Risk Management and Compliance; Personnel and Human Resources Security; Security Awareness and Training; Acceptable Use, Clear Desk, and Clear Screen.
- **Assets, data, and access:** Asset Management; Data Classification, Handling, and Protection; Access Control; Identification, Authentication, and Password.
- **Technology protection:** Cryptography, Encryption, Key, and Secrets Management; Endpoint, Mobile Device, BYOD, and Malware Protection; Remote Access and Remote Work; Physical and Environmental Security; Network and Communications Security; Configuration Management and System Maintenance.
- **Engineering and security operations:** Secure Development and Change Management; Vulnerability, Patch, and Penetration Testing; Logging, Monitoring, and Audit Trail; Incident Response.
- **Resilience and third parties:** Business Continuity and Disaster Recovery; Backup and Restoration; Vendor, Third-Party, and Supply Chain Risk Management; Exceptions, Compliance, Enforcement, and Policy Review.

## Definitions

- **Worker:** An employee or contractor.
- **System:** An application, service, process, or infrastructure used to store or process information or support an in-scope service.
- **Component:** A technology, process, facility, or provider-supplied element within or supporting a System.
- **Control:** An administrative, technical, or physical safeguard.
- **Evidence:** Retained information that supports a security fact, decision, or activity.
- **Vendor:** An external party that provides a product or service.
- **Exception:** A management-approved, time-bound departure from a requirement.
- **Important System or Component:** A System or Component included in the approved service boundary or relied upon to meet a security objective, service commitment, recovery objective, Control, or Evidence need.
- **Approved:** Authorized by the accountable owner or management under the applicable governance process.

These definitions set the minimum scope. Management may classify additional assets as important based on risk.

## Information Security Governance and Organization Policy

### Roles and oversight

- **Policy Owner:** Maintains this Policy, the risk program, Controls, approved supporting plans, Exceptions, and improvement work.
- **System and process owners:** Approve access, maintain safeguards, keep inventories and recovery facts current, and resolve findings.
- **Independent reviewer:** Remains separate from the Policy Owner, approves the Policy, and challenges management's assessment of Control operation.

### Program review

Management reviews the security program on its approved schedule and after material change. Reviews cover objectives, service commitments, applicable duties, fraud and misconduct risk, threats, system and Vendor changes, incidents, findings, Exceptions, overdue work, and Control results. Management documents the participants, cadence, decisions, and follow-up for each review.

### Information and communication

Management obtains or generates, checks, and uses relevant information from internal and external sources to operate and evaluate Controls. Control reports identify their source, scope, period, owner, and known limits when those facts affect a decision. Material security and Control information is communicated in time to the people and outside parties responsible for acting on it.

### Conduct and reporting

Everyone in scope must act honestly, protect company and customer information, follow approved security processes, disclose conflicts that could affect security decisions, and preserve accurate records. Fraud, deliberate Control bypass, false Evidence, credential sharing, unauthorized access, concealment of a security event, and retaliation for a good-faith report are prohibited.

Suspected security events, Control failures, fraud, or policy violations must be reported promptly through the primary route at {{security_contact_email}} or the usable alternate route documented in the Security Incident and Recovery Plan. A person may use the alternate route when the primary route is unavailable, compromised, or involved in the concern. Management investigates credible reports, limits disclosure to people who need the information, preserves relevant records, and records corrective action.

## Risk Management and Compliance Policy

### Obligations and risk assessment

Management identifies security risks and applicable legal, regulatory, contractual, customer, and service commitments, then assigns responsibility through approved requirements, Controls, Systems, Vendor oversight, and governance records. Management obtains qualified legal or other professional advice when an obligation is uncertain.

Risk assessment considers objectives, information, threats, vulnerabilities, fraud, dependencies, service and technology changes, likelihood, impact, existing Controls, and risk tolerance. Risks receive an owner, response, target date, approval when accepted, and a review date. Management reassesses risk on the approved schedule and after material change. Management documents the assessment method, cadence, decisions, and follow-up.

### Control design and review

Management selects and develops manual and technology Controls that respond to approved objectives, commitments, risks, system dependencies, and changes. Each Control has a documented owner, scope, procedure, operating pattern, Evidence source, implementation status, and review path. Management reviews Control design at least annually and after material change, then corrects gaps or records a time-bound Exception.

## Personnel and Human Resources Security Policy

### Responsibilities and screening

Management defines security responsibilities for workers and confirms that people have the competence and authority needed for their assigned duties. Screening or reference checks are performed before sensitive access when lawful, proportionate to the role and risk, and approved by management. Screening is not required when management records that it is unlawful, unavailable, or not warranted for the role.

### Workforce lifecycle

Workers must accept applicable confidentiality, acceptable-use, intellectual-property, and security responsibilities before receiving access. Managers notify access administrators of starts, role changes, extended absences when relevant, and departures. Company property and access are returned, disabled, or removed when employment, services, or business need ends. Management documents approved timing, Evidence, and escalation requirements for onboarding, access changes, and offboarding in supporting procedures and schedules.

### Competence review

Management reviews at least annually and after a material role change whether workers remain capable of their assigned security and Control duties and assigns training, supervision, reassignment, or corrective action when needed. The review may be limited to security and Control responsibilities and does not mandate a broader performance-management process.

## Security Awareness and Training Policy

Workers receive security awareness training on approved onboarding and recurring schedules. Role-specific instruction is assigned when access or duties require it, including for privileged administration, engineering, incident response, privacy, finance, and people operations when applicable.

Training addresses reporting, credential and device protection, data handling, social engineering, acceptable use, incident responsibilities, and current risks relevant to the audience. Completion is tied to the content revision reviewed and followed up when overdue. Management documents the covered population, schedules, acknowledgements, completion, and Evidence in the training program records.

## Acceptable Use, Clear Desk, and Clear Screen Policy

Users must:

- Use approved identities, devices, applications, storage, messaging, meeting, and transfer services.
- Protect credentials, authentication devices, company equipment, customer information, and security records.
- Keep company data out of personal accounts and unapproved applications.
- Lock unattended devices and protect papers, screens, conversations, and remote meetings from unauthorized access.
- Keep Confidential and Restricted information from unattended work areas and dispose of it through approved methods.
- Report lost, stolen, compromised, or unexpectedly reconfigured devices promptly.
- Return company property and stop using company access when employment, services, or business need ends.

Users must not bypass security safeguards, install unauthorized software, connect unapproved devices or storage, use company Systems for unlawful activity, or disclose information without authorization.

## Asset Management Policy

{{company_name}} inventories important Systems, Components, company and approved personal devices, software, service accounts, Vendors, and data stores. Records identify an owner, purpose, lifecycle state, classification, dependencies, and recovery needs where relevant.

Owners approve assets before they process Confidential or Restricted data or support an important service. Unsupported or unneeded important assets must be upgraded, isolated, replaced, or retired according to risk. Retirement removes company data, software, credentials, access, and inventory assignments through an approved process and retains dated disposal Evidence when the applicable Control requires it.

## Data Classification, Handling, and Protection Policy

### Classification and minimization

Data owners classify information as Public, Internal, Confidential, or Restricted and approve its collection, use, access, storage, sharing, retention, and disposal. When classification is uncertain, users protect the data as Confidential until an owner decides. Collect and retain only information needed for an approved purpose.

### Handling and transfer

Confidential and Restricted data must use approved Systems, least-privilege access, protected transfer methods, and safeguards appropriate to its classification and risk. Production data must not enter development or test Systems unless an owner approves the use and equivalent protection. Public links and exports of Confidential or Restricted data require explicit authorization.

### Media, retention, and disposal

Removable media containing Confidential or Restricted data requires owner approval, encryption where supported, controlled custody, and approved disposal. Owners must consider active copies, local copies, media, backups, and Vendor-held copies when applying retention or deletion. Legal holds and active investigations suspend normal disposal for affected records.

The Data Retention Schedule defines the approved period and disposal method for important in-scope record classes. Supporting standards, procedures, and system records document implementation. Disposal must be suitable for the media and classification, with dated proof when the Control requires it.

## Cryptography, Encryption, Key, and Secrets Management Policy

### Encryption requirements

Confidential and Restricted data must use approved encryption in transit over untrusted networks and encryption at rest. Management selects cryptographic methods based on data classification, exposure, technical capability, commitments, and risk, and documents selected methods and configurations in approved standards, procedures, or system records.

### Key and secret management

Encryption keys and other secrets require:

- **Ownership and access:** Named ownership and least-privilege access.
- **Generation and storage:** Protected generation and storage.
- **Distribution and use:** Controlled distribution and use.
- **Rotation and revocation:** Rotation or replacement based on risk and events, and revocation when access or trust ends.
- **Recovery:** Recoverability when loss would prevent an approved business or recovery process.

Plaintext credentials, private keys, tokens, and recovery codes must not appear in source files, tickets, chat, logs, policy records, audit records, or other general-purpose business records. Source-controlled ciphertext may be used when management approves the encryption method, decryption keys are stored separately in an approved secrets-management System, repository access alone cannot decrypt the material, and access and rotation are controlled.

## Access Control Policy

### Access lifecycle

Access requires a documented business need, owner approval, a unique identity, and least privilege. Authorized administrators provision, change, and remove access. Owners review privileged and production access and other important access on the approved schedules. Dormant, expired, excessive, or unneeded access must be removed.

### Privileged, shared, and service accounts

- **Privileged access:** Limited to approved duties and uses separate administrative identities or roles where technically supported and appropriate to risk.
- **Shared accounts:** Require a documented technical need, named owner, restricted use, protected credentials, and logging.
- **Service accounts:** Require a named owner, approved purpose, minimum permissions, protected credentials, lifecycle dates or review, and monitoring appropriate to risk.

## Identification, Authentication, and Password Policy

### Authentication and passwords

Important Systems use approved strong-authentication settings, unique identities, protected credentials, and safeguards against common authentication attacks. Default credentials must be changed or disabled before use. Only authorized administrators may change authentication and lockout settings.

Passwords and other authenticators must meet settings approved for the System's risk and technical capability. Users must not reuse company passwords in personal services, share authenticators, or store them in plaintext. Systems protect stored authenticators and recovery material against unauthorized disclosure and use. Management documents password length, composition, reuse, lockout, session, and recovery settings in approved authentication standards or System-specific procedures.

### Multi-factor authentication

- **Workforce and administrative access:** MFA is required for access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data.
- **Customer and external-user access:** MFA is required when an approved Control, customer commitment, or risk decision requires it.
- **Exceptions:** Where required MFA is unavailable, management must approve a time-bound Exception with a risk assessment, compensating Controls, an accountable owner, and a review or expiration date.

## Endpoint, Mobile Device, BYOD, and Malware Protection Policy

### Company devices and platform protection

Devices used for company work must run supported software, install security updates, require authentication, lock automatically, use encryption and host protections appropriate to the platform, and permit remote removal when company-managed and technically supported. Users must not disable management, security, logging, encryption, or remote-removal safeguards.

Platforms may provide continuous native malware and application protection without a user-triggered full scan. Management documents the continuous protections in use and the periodic process that verifies configuration, update, and compliance state. A scheduled scan applies only when the selected technology and risk decision require one.

### Personal devices

Personal-device access requires prior approval, registration, verified safeguards, defined company-data boundaries, and exit steps. Management may restrict or prohibit personal-device use based on data, access, legal, customer, support, or recovery needs.

## Remote Access and Remote Work Policy

Remote access to important Systems is limited to authorized users, uses approved encryption and authentication, and is protected in proportion to data, privilege, network trust, and risk. Remote production administration requires MFA and approved access paths. Public or untrusted networks require approved encrypted access and any additional safeguards selected for the risk.

Remote workers must protect devices, papers, screens, calls, home networks, and travel locations. Management documents remote-access configuration and session restrictions in approved standards, procedures, or System records.

## Physical and Environmental Security Policy

Physical access to nonpublic work areas, infrastructure, and protected assets is limited to authorized people. Visitors are controlled and accompanied where sensitive work or information is present. Keys, badges, and other physical access methods are issued, reviewed, recovered, and disabled according to risk.

Owners protect important equipment and media against theft, tampering, damage, and environmental conditions relevant to their location. Facilities supplied by Vendors are addressed through Vendor review, contracts, and assurance rather than unsupported claims about facilities {{company_name}} does not operate.

## Network and Communications Security Policy

Owners restrict inbound, outbound, and internal network paths and management interfaces to approved business needs. They use approved encrypted administrative protocols, disable unnecessary services and ports, protect remote production access, and review material access rules on the approved schedule.

Production, development, test, and general-user environments must be separated to the extent needed for their data, exposure, privileges, and change risk. Connections between environments require approved paths and safeguards. Wireless and other local networks used for company work require authentication and encryption appropriate to current risk and technical capability.

## Configuration Management and System Maintenance Policy

Important Systems and Components use documented secure configuration expectations based on trusted guidance, technical capability, and risk. Owners change or disable unnecessary default accounts, credentials, services, ports, features, and configurations. Deviations require review and, when material, an approved Exception.

Configuration and maintenance work must use authorized access, protect credentials and data, record material changes, and validate security and service behavior. Unsupported important Systems or Components are upgraded, isolated, replaced, or retired according to the Asset Management Policy.

## Secure Development and Change Management Policy

### Change control

Software and infrastructure changes must be recorded, tested, approved, deployed through an authorized process, and recoverable in proportion to risk. Use independent pre-deployment review when practical. When team size or urgency makes that separation impossible, record a risk-appropriate compensating or post-deployment review. Use a time-bound Exception when the remaining departure is material.

### Security design and development safeguards

Material or high-risk designs and changes receive a documented security analysis suited to the change. This may include threat analysis, abuse cases, architecture review, data-flow review, or another approved method. Based on applicability and risk, Development and deployment Controls address protected branches, controlled credentials, dependency and secret detection, input and authorization checks, production-data restrictions, security testing, emergency change review, deployment approval, communication, and rollback.

## Vulnerability, Patch, and Penetration Testing Policy

### Vulnerability and patch management

{{company_name}} monitors trusted sources for vulnerabilities affecting in-scope Systems and Components. Management selects scanning coverage, penetration-testing applicability, remediation targets, and review cadence from exposure, material change, customer commitments, technical capability, and risk. Management documents the selected coverage, targets, cadence, and review decisions.

Findings receive validated scope, severity, an owner, treatment, and target date. A missed target requires documented exposure, compensating Controls, a revised date, and risk approval or Exception. Security updates are obtained from trusted sources, tested when appropriate, and applied according to the approved risk-based targets.

### Penetration testing

Penetration testing is performed when an approved Control, customer commitment, material exposure, significant change, or risk decision requires it. Its independence, scope, method, and cadence must fit the reason for testing. This Policy does not require every System to receive an annual penetration test.

## Logging, Monitoring, and Audit Trail Policy

### Logging and audit trails

Important Systems record and protect the security and operational events needed to investigate misuse, operate the service, and meet approved commitments. Depending on risk, events may include authentication activity, privileged actions, identity and access changes, production changes, access to Restricted data, security alerts, and Control failures.

Logs use synchronized time, restrict alteration and access, and avoid unnecessary secrets or personal data. Each System's retention period belongs in the approved Data Retention Schedule. Owners document risk-based alerts, review paths, thresholds, and response ownership in approved standards, procedures, and schedules.

### Monitoring and alert testing

Systems with availability commitments, recovery objectives, or material operational dependencies monitor the health, capacity, failure, and service indicators needed to detect degradation. Representative alert paths are tested from generation through acknowledgement, escalation, and fallback on the approved schedule and after a material path change. This requirement does not prescribe a particular monitoring or log-management product.

## Incident Response Policy

The Security Incident and Recovery Plan defines reporting, alternate access, severity, declaration, roles, containment, Evidence handling, notification assessment, communication, recovery, closure, and exercises. Suspected unauthorized access, malware, data loss, credential exposure, service disruption, or security-Control failure must be reported promptly.

Reported events receive an owner, assessment, and documented resolution or escalation. Responders preserve relevant Evidence, limit access, coordinate required legal, contractual, privacy, insurance, customer, and regulatory review, validate recovery, and track corrective work. Management exercises the process and representative alert paths on their approved schedules and after material changes when warranted.

## Business Continuity and Disaster Recovery Policy

Each important System records recovery priorities, dependencies, responsible people, alternate communication and access needs, and a backup or alternate recovery approach suited to its commitments, business impact, data risk, dependencies, and technical capability. Numeric recovery targets are required only when an approved customer commitment, included Availability criterion, or management risk decision calls for them.

The Security Incident and Recovery Plan records activation, communication, response, recovery, and return-to-normal responsibilities. Management tests continuity and disaster recovery on the approved schedule, records results and findings, and tracks follow-up work.

## Backup and Restoration Policy

Important Systems use backups or an approved alternate recovery approach suited to their recovery needs and any approved recovery targets. Management documents backup or alternate-recovery scope, frequency, retention, encryption and access needs, monitoring, failure response, procedures, and test schedules.

Backup or recovery access is limited to authorized people and protected from the failures it is intended to address. Restoration or alternate recovery is validated on the approved schedule and after material change when prior results no longer represent the System. Policy adoption does not assert that every System uses daily backups or a fixed retention period.

## Vendor, Third-Party, and Supply Chain Risk Management Policy

### Due diligence

New Vendors receive a risk-based security and privacy review and suitable contractual safeguards before access to Confidential or Restricted data or material reliance by an important service. Reviews consider service scope, data, access, assurance, recovery, incident history, dependencies, supplied Components, and contract terms.

### Contract safeguards

When applicable to the service and risk, contracts address:

- Permitted use and confidentiality.
- Security responsibilities and incident notice.
- Access and subprocessor restrictions.
- Continuity and data return or deletion.
- Termination.
- Assurance or audit rights.

Management does not require every term for every Vendor, but records omissions that create material risk or conflict with an approved commitment.

### Existing Vendors and ongoing monitoring

For a Vendor already in use when this Policy becomes effective, the owner records a transition review and deadline or an approved risk acceptance. Policy adoption does not imply that a historical pre-access review occurred. Management documents Vendor monitoring cadence and change-driven reassessment windows in approved Vendor-management procedures and schedules.

## Exceptions, Compliance, Enforcement, and Policy Review

### Exceptions and enforcement

An Exception requires a specific scope and reason, risk assessment, compensating Controls, accountable owner, approval, and expiration or review date. Violations may result in access removal, corrective action, contract remedies, or other action allowed by law and agreement.

### Policy review

The Policy Owner reviews this Policy on the approved schedule and after a material change to services, Systems, risks, commitments, or obligations. The independent reviewer approves each revised version. The organization retains the reviewed Policy version, approval, effective date, and change history under its document-control process.

### Representations

Questionnaire, customer, auditor, and management representations must reflect the Policy revision, actual Control status, scope, Exceptions, and available Evidence. The presence of this consolidated Policy or one of its section headings does not justify answering that a Control is implemented when it is planned, partial, not applicable, or unsupported by Evidence.
