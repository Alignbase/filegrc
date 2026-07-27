# Information Security Policy

## Purpose

This policy defines the information security program for {{company_name}}. Its goals are to protect the confidentiality, integrity, and availability of company and customer information and to support reliable operation of in-scope services.

## Scope

This policy applies to:

- Employees, contractors, vendors, and other authorized users
- Company-managed and personally owned devices used for company work
- Applications, infrastructure, repositories, networks, data, and business processes managed by or for {{company_name}}
- Vendors that store, process, transmit, secure, or recover company or customer data

More specific standards and procedures may set stricter requirements.

## Governance and responsibilities

{{policy_owner_name}} owns the information security program and this policy. Questions and incident reports should be sent to {{security_contact_email}}.

The policy owner:

- Maintains security policies, risks, controls, and improvement plans.
- Reports material security matters to company leadership.
- Coordinates incidents, exercises, reviews, and audit work.
- Approves security exceptions or obtains the required approval.

An external independent reviewer chairs the security and risk oversight group. This person must be separate from the policy owner and must not operate the controls under review. The reviewer approves policies and governed plans, challenges management's assessment of control operation, and records independent decisions.

The security and risk oversight group meets at least quarterly to review the risk register, material incidents, significant findings, vendor and access review results, policy changes, exercises, and overdue work. Each meeting has formal minutes, decisions, and assigned actions. A one-person company must appoint a qualified external person to fill the independent reviewer role before it approves the program.

System and process owners classify their systems and data, approve access, maintain safeguards, respond to findings, and keep recovery information current.

Managers ensure that workers complete required onboarding, training, access changes, offboarding, and a documented performance review at least annually. Every user must follow policy, protect credentials and devices, and report suspected security events.

## Risk management

{{company_name}} performs an information security risk assessment at least annually and after a material change that could alter risk. The assessment identifies threats, affected assets and obligations, existing controls, likelihood, impact, treatment, owners, and target dates.

Risks are tracked until they are mitigated, transferred, avoided, or accepted by a person with suitable authority. Accepted risks need a reason, approval, and review date. High and critical risks are reviewed at least quarterly.

## Asset and system management

{{company_name}} maintains inventories of important systems, devices, software, service accounts, vendors, and data stores. Each item has an owner and, when relevant, a criticality, data classification, lifecycle status, and recovery objective.

Owners must approve new systems before they process Confidential or Restricted data. Unsupported or unneeded assets must be upgraded, isolated, or retired.

Company data and software must be removed from retired devices through an approved process. Disposal records must identify the asset, method, date, and responsible person.

## Workforce security

Where lawful and appropriate to the role, {{company_name}} may perform background checks before granting sensitive access. Workers must agree to applicable confidentiality, acceptable-use, and intellectual-property terms.

Workers complete security training within 30 days of starting and at least annually. People with privileged access or security, engineering, finance, privacy, or people-operations duties complete applicable role-based training within 30 days of starting those duties or changing roles. The onboarding or role-change checklist records the assigned training or why a module does not apply.

Managers notify access administrators promptly of role changes and departures. Access for an involuntary or high-risk departure must be removed at or before notification. All other departing-worker access must be removed within 24 hours after employment or services end. Company property and active credentials must be recovered or disabled.

## Identity and access control

Access is based on business need and least privilege.

- Each user receives a unique identity. Shared accounts are prohibited unless a documented technical need, named owner, access control, and logging make them necessary.
- Multi-factor authentication is required for administrative access, source control, production systems, email, identity systems, and systems containing Confidential or Restricted data when the system supports it.
- Passwords must be unique, stored in an approved password manager, and never shared in plaintext.
- Systems must enforce approved password, authentication, and lockout settings appropriate to their risk and technical capability.
- Only authorized administrators may change password or lockout settings.
- Default credentials must be changed or disabled before use.
- Privileged access must use separate administrative roles or accounts where practical.
- Access requests and material changes require approval from the manager or system owner.
- Owners review privileged and production access at least quarterly and other important access at least annually.
- Dormant, expired, or unneeded access must be removed.

Service accounts require a named owner, stated purpose, minimum permissions, and protected credentials. Secrets must not be committed to source control.

## Data protection

The Data Protection and Handling Policy defines classification, approved use, sharing, retention, and disposal. At a minimum:

- Collect and retain only data needed for an approved purpose.
- Encrypt Confidential and Restricted data in transit over untrusted networks.
- Encrypt Confidential and Restricted data at rest in approved systems and on devices.
- Keep production data out of development and test systems unless approved and equally protected.
- Restrict data exports and public links.
- Store credentials and cryptographic keys in approved protected systems.

## Endpoint and mobile security

Devices used for company work must:

- Run a supported operating system and current security software.
- Use full-disk encryption when supported.
- Lock automatically after no more than 15 minutes of inactivity.
- Require authentication after locking or restarting.
- Install security updates within the vulnerability-remediation targets in this policy unless an approved exception applies.
- Use malware protection and host firewall controls appropriate to the platform.
- Permit remote lock or wipe when company-managed and supported.

Lost, stolen, compromised, or unexpectedly reconfigured devices must be reported immediately. The Mobile Computing and Communications Policy defines additional requirements.

Malware protection must run continuous protection where the platform supports it and a full or equivalent periodic scan at least monthly.

## Network and infrastructure security

Owners must:

- Limit inbound and outbound connectivity to approved business needs.
- Separate production from development, test, and general user environments where practical.
- Use encrypted administrative protocols and restrict management interfaces.
- Review firewall rules and other material network access at least annually.
- Disable unused services, ports, accounts, and default configurations.
- Protect cloud and infrastructure management interfaces with multi-factor authentication.
- Record infrastructure configuration in reviewed code or another controlled system where practical.

Important systems use documented secure configuration baselines. Owners review deviations, remove unnecessary defaults, and track approved exceptions. A material change to system behavior, security, availability, or customer commitments must include an appropriate communication plan.

Wireless networks used for company work must use current encryption and authentication. Public or untrusted networks require an approved protected connection.

Remote production access is limited to approved users, requires multi-factor authentication, and must originate from a trusted network or use an approved encrypted connection. Users on public or otherwise untrusted networks must use the additional safeguards approved for remote access.

## Secure development and change management

Software and infrastructure changes must be recorded, reviewed, tested, approved, and recoverable in proportion to risk. The record should identify the reason, author, reviewer, test result, deployment, and rollback method.

Production changes should be made through an approved deployment process. Emergency changes may use an expedited review, but they must be documented and reviewed after service is stable.

Development practices include:

- Peer review for material code and infrastructure changes
- Automated or manual security tests suited to the change
- Separation of production duties where practical
- Protected branches and controlled deployment credentials
- Dependency and secret scanning where supported
- No production secrets in source code, test fixtures, or logs
- Validation of input and authorization at trust boundaries

## Vulnerability and patch management

{{company_name}} monitors trusted sources for vulnerabilities affecting in-scope systems. It scans internet-facing and production systems at least quarterly and after a material change when practical. An independent penetration test is performed at least annually for the external attack surface of the in-scope service.

The security owner assigns the final severity using a recognized technical scoring method together with exploit availability, reachability, affected privileges, data classification, exposure, and business impact. The remediation clock starts when {{company_name}} confirms the finding and assigns an owner. A later severity change must record the reason and date.

Confirmed vulnerabilities are assigned a target based on their final severity:

| Severity | Target remediation time |
| --- | --- |
| Critical | 7 days |
| High | 14 days |
| Medium | 30 days |
| Low | 90 days |

If remediation cannot meet the target, the owner must document the reason, exposure, compensating controls, revised date, and risk approval.

## Logging and monitoring

Important systems must record security-relevant activity needed to investigate misuse and support operations. Depending on the system, this includes:

- Authentication success and failure
- Privileged and administrative actions
- Access-control and identity changes
- Production deployments and configuration changes
- Access to Restricted data
- Security control failures and alerts

Logs must use synchronized time, restrict alteration and access, and avoid unnecessary secrets or personal data. Security logs for important systems are retained for at least 12 months unless a longer contractual or legal period applies.

Owners review or alert on events based on risk. Alerts must have an assigned response path. The annual incident response exercise tests at least one representative alert from generation through acknowledgement, escalation, and fallback. A material change to an alert or response path receives an appropriate test within 30 days, or the owner records why no test applies.

Owners review important log output and access to logs at least quarterly. They also monitor process health, network use, processor load, memory use, disk capacity, and other indicators needed to detect service degradation. Important systems have documented alert thresholds and response ownership.

## Incident response

Anyone who suspects unauthorized access, malware, data loss, credential exposure, security-control failure, or other security harm must report it immediately to {{security_contact_email}}.

The Incident Response Plan defines severity, materiality, declaration, roles, escalation, evidence handling, notification assessment, recovery, and closure. The incident lead will:

1. Record and assess the report.
2. Contain the event and preserve evidence.
3. Remove the cause and recover affected service.
4. Coordinate legal, contractual, privacy, insurance, customer, and regulatory review.
5. Communicate through authorized channels.
6. Document the outcome, lessons, and follow-up work.

The incident lead assigns a severity based on actual or likely harm. High-severity incidents receive immediate leadership and technical escalation, frequent status updates, and review of external notification duties. Lower-severity events still receive an owner, documented resolution, and escalation if impact grows.

{{company_name}} tests its incident process and a representative alert path at least annually. Material incidents receive a retrospective within one week and tracked corrective actions.

## Business continuity, backup, and recovery

Important systems have recovery objectives based on business impact. Unless a system has an approved objective that requires stronger safeguards, important production data is backed up at least daily and retained for at least 30 days. Backups must restrict access, report failures, and be restored in a test at least annually.

The Business Continuity and Disaster Recovery Plan defines activation, response, communication, and recovery duties. Continuity and recovery exercises are recorded with results and follow-up work.

## Vendor security

Vendors receive access only after an appropriate security and privacy review. The review considers the service, data, access, availability needs, incident history, independent assurance, recovery capability, and contract terms.

Contracts with vendors that handle Confidential or Restricted data should address:

- Permitted data use and confidentiality
- Security safeguards
- Incident notification
- Subprocessor controls
- Service continuity
- Data return and deletion
- Audit or assurance rights when warranted

Critical and high-risk vendors are reviewed at least annually. A material service change, data-use change, or vendor incident triggers a reassessment within 30 days. The owner updates the vendor, risk, contract, data-use, and follow-up records affected by the reassessment.

## Physical security

Company facilities and equipment must be protected according to their risk. Access to nonpublic work areas is limited to authorized people. Visitors must be controlled and accompanied where sensitive work or information is present.

Remote workers must follow the Clear Desk and Clear Screen Policy and protect devices and conversations from unauthorized viewing or access.

## Compliance, exceptions, and enforcement

{{company_name}} identifies security, privacy, contractual, and regulatory obligations that apply to its work and maps them to responsible controls. Evidence should be retained according to the applicable audit and record-retention period.

An exception to this policy requires:

- A specific scope and business reason
- A risk assessment
- Compensating controls
- An accountable owner
- An expiration or review date
- Approval from {{policy_owner_name}} or a person with greater authority

Violations may result in access removal, corrective action, contract remedies, or other action allowed by law and agreement.

## Review

The policy owner reviews this policy at least annually and after a material change to systems, services, risks, or obligations. The external independent reviewer, who must be separate from the policy owner, approves this policy and other governed policies and plans. The security and risk oversight group reviews material changes and records its decision in meeting minutes. Git history records approvals and changes.
