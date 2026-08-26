import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const FRAMEWORK_ID = "framework-aicpa-trust-services-criteria";
const DESCRIPTION_FRAMEWORK_ID = "framework-aicpa-soc2-description-criteria";
const PROGRAM_LEAD_ID = "person-program-lead";
const POLICY_OWNER_APPOINTMENT_ID = "appointment-policy-owner";
const OVERSIGHT_TEAM_ID = "team-security-risk-oversight";
const INFORMATION_SECURITY_POLICY_ID = "policy-information-security";
const RETENTION_SCHEDULE_ID = "document-data-retention-schedule";
const SECURITY_PLAN_ID = "document-security-incident-recovery-plan";
const FILEGRC_INFORMATION_TYPE_ID = "information-type-grc-records";
const FILEGRC_SOURCE_FAMILIES = [
  "training-acknowledgement",
  "exception-finding",
  "governance",
  "risk-management",
  "vendor-management"
];
const FILEGRC_SOURCE_CONTROL_CODES = new Set([
  "GOV-01",
  "GOV-02",
  "GOV-03",
  "HR-01",
  "HR-02",
  "RSK-01",
  "MON-01",
  "EXC-01",
  "VEN-01",
  "VEN-02"
]);
const SOURCE_FAMILIES = [
  ["workforce", "Workforce"],
  ["training-acknowledgement", "Training and Acknowledgements"],
  ["identity-access", "Identity and Access"],
  ["production-change", "Production Change"],
  ["security-monitoring", "Security Monitoring"],
  ["vulnerability-management", "Vulnerability Management"],
  ["endpoint-asset", "Endpoint Management"],
  ["backup-recovery", "Backup and Recovery"],
  ["vendor-management", "Vendors"],
  ["exception-finding", "Exceptions and Findings"],
  ["data-handling", "Data Protection Configuration"],
  ["network-security", "Network Security"],
  ["governance", "Governance"],
  ["risk-management", "Risk Management"]
];

const commonCriteria = [
  ["CC1.1", "Integrity and ethical values", "Set, communicate, and enforce standards for integrity and ethical conduct."],
  ["CC1.2", "Independent oversight", "Provide independent oversight of the system of internal control."],
  ["CC1.3", "Roles and accountability structure", "Define reporting lines, authority, and responsibility for achieving objectives."],
  ["CC1.4", "Competent workforce", "Attract, develop, and retain people with the competence needed for assigned responsibilities."],
  ["CC1.5", "Individual accountability", "Hold people accountable for their internal-control responsibilities."],
  ["CC2.1", "Useful information", "Obtain, generate, and use relevant, reliable information to operate controls."],
  ["CC2.2", "Internal communication", "Communicate objectives, responsibilities, and control information within the organization."],
  ["CC2.3", "External communication", "Communicate relevant control matters with customers, vendors, regulators, and other outside parties."],
  ["CC3.1", "Clear objectives", "Define objectives clearly enough to identify and assess risks to them."],
  ["CC3.2", "Risk identification and analysis", "Identify and analyze risks that could prevent the organization from meeting its objectives."],
  ["CC3.3", "Fraud risk", "Consider how fraud could affect achievement of objectives."],
  ["CC3.4", "Change risk", "Identify and assess changes that could materially affect internal control."],
  ["CC4.1", "Control monitoring", "Use ongoing or separate evaluations to confirm that controls are present and working."],
  ["CC4.2", "Deficiency communication", "Evaluate control deficiencies and communicate them in time for corrective action."],
  ["CC5.1", "Risk-based control activities", "Select and develop control activities that reduce identified risks."],
  ["CC5.2", "Technology controls", "Select and develop general controls over technology that supports the program."],
  ["CC5.3", "Policies and procedures", "Put control activities into practice through clear policies and procedures."],
  ["CC6.1", "Logical access safeguards", "Use logical access safeguards to protect information and system resources."],
  ["CC6.2", "Identity lifecycle", "Authorize identities and credentials before access and remove them when no longer needed."],
  ["CC6.3", "Access authorization", "Grant, change, and remove access according to role, responsibility, and least privilege."],
  ["CC6.4", "Physical access", "Restrict physical access to facilities and protected assets."],
  ["CC6.5", "Secure asset disposal", "Remove logical and physical protections only after assets and data are safely disposed."],
  ["CC6.6", "External threat protection", "Protect system boundaries against threats originating outside the system."],
  ["CC6.7", "Data transmission and movement", "Authorize and protect information while it is transmitted, moved, or removed."],
  ["CC6.8", "Unauthorized software protection", "Prevent or detect unauthorized and malicious software."],
  ["CC7.1", "Configuration and vulnerability monitoring", "Detect configuration changes and new vulnerabilities that could weaken the system."],
  ["CC7.2", "Anomaly monitoring", "Monitor system components for anomalies and events that may require investigation."],
  ["CC7.3", "Security event evaluation", "Evaluate detected events and determine whether they are security incidents."],
  ["CC7.4", "Incident response", "Respond to identified incidents through a defined response process."],
  ["CC7.5", "Incident recovery", "Recover from incidents, restore operations, and address resulting weaknesses."],
  ["CC8.1", "Change management", "Authorize, design, test, approve, and implement system changes through a controlled process."],
  ["CC9.1", "Risk mitigation", "Select and operate responses to risks from disruption, change, and business dependencies."],
  ["CC9.2", "Vendor and partner risk", "Assess and manage risks created by vendors and business partners."]
];
const descriptionCriteria = [
  ["DC1", "Services provided", "Describe the nature of the service and the types of services the system provides."],
  ["DC2", "Service commitments and requirements", "Describe the principal commitments made to customers and the system requirements needed to meet them."],
  ["DC3", "System components", "Describe the infrastructure, software, people, procedures, and data that make up the system."],
  ["DC4", "System incidents", "Describe significant system incidents caused by control failures or resulting in a significant failure to meet service commitments or system requirements."],
  ["DC5", "Applicable criteria and controls", "Identify the applicable trust services criteria and the controls designed to address them."],
  ["DC6", "Complementary user entity controls", "Describe controls that customers are expected to operate for the service organization's controls to work as intended."],
  ["DC7", "Subservice organizations and controls", "Describe relevant subservice organizations, how their controls are treated, and complementary controls they are expected to operate."],
  ["DC8", "Criteria not relevant", "Confirm that every Security Common Criterion applies. Identify any criterion from an included optional Trust Services Category that is not relevant to the system and explain the limited circumstances."],
  ["DC9", "Significant changes", "Describe significant system changes during the reporting period that could affect a report user's understanding of the system."]
];
const commonCriteriaReferences = commonCriteria.map(([reference]) => reference);

const controls = [
  {
    id: "control-security-governance",
    code: "GOV-01",
    title: "Security governance",
    statement: "Management assigns security responsibilities, and a reviewer who is separate from the policy owner and control operators independently reviews the program, risks, incidents, findings, policy approvals, and overdue work at least quarterly.",
    requirements: ["CC1.1", "CC1.2", "CC1.3", "CC1.5"],
    activity: "Assign an independent reviewer who is separate from program ownership and record quarterly oversight decisions, approvals, and actions.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "scheduled",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-policy-management",
    code: "GOV-02",
    title: "Control and policy management",
    statement: "Management selects and develops manual and technology Controls from approved objectives, commitments, risks, dependencies, and changes, and records each Control's owner, scope, procedure, operation pattern, evidence source, and implementation status. The policy owner reviews Controls, governed policies, and plans at least annually and after material changes, obtains separate approval for governed content, and retains approved revisions in Git.",
    requirements: ["CC5.1", "CC5.2", "CC5.3"],
    activity: "Review Control design and evidence paths, correct gaps or approve time-bound Exceptions, and review, approve, communicate, and version governed policies and plans.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-security-communication",
    code: "GOV-03",
    title: "Security information and communication",
    statement: "Management obtains or generates, checks, and uses relevant and reliable information from internal and external sources to operate Controls, and communicates security responsibilities, approved reporting routes, material changes, and relevant Control information to its workforce and outside parties in time for action.",
    requirements: ["CC2.1", "CC2.2", "CC2.3"],
    activity: "Record material information sources, scope, period, ownership, and known limits; maintain reporting routes; and communicate policies, changes, and security information.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-workforce-expectations",
    code: "HR-01",
    title: "Workforce expectations",
    statement: "Workers are screened before sensitive access when lawful and appropriate to role risk, have the competence needed for assigned duties, agree to applicable conduct, confidentiality, acceptable-use, intellectual-property, and security responsibilities before receiving access, and are held accountable for violations.",
    requirements: ["CC1.4", "CC1.5"],
    activity: "Record the role-based screening decision, confirm competence and authority, complete agreements and policy acknowledgement, and take corrective action when needed.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-security-training",
    code: "HR-02",
    title: "Security training and acknowledgement",
    statement: "Employees and contractors complete general security training within 30 days of starting and at least annually. Workers complete applicable role-based training within 30 days of starting a covered role or changing roles, with completion tied to the content revision reviewed.",
    requirements: ["CC1.4", "CC2.2"],
    activity: "Assign general and role-based training, document non-applicability where needed, collect completion attestations, and follow up on overdue assignments.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-risk-assessment",
    code: "RSK-01",
    title: "Risk assessment and treatment",
    statement: "The organization defines security objectives and risk tolerance, assesses information security, fraud, misconduct, dependency, and change risk at least annually and after material changes, assigns owners and responses, and reviews high and critical risks at least quarterly.",
    requirements: ["CC3.1", "CC3.2", "CC3.3", "CC3.4", "CC9.1"],
    activity: "Confirm objectives and risk tolerance, identify internal and external threats, fraud and misconduct scenarios, dependencies, and changes, score risk, select treatment, and track review dates.",
    controlType: "detective",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-monitoring-remediation",
    code: "MON-01",
    title: "Control monitoring and remediation",
    statement: "Management reviews Control operation, source information, incidents, test results, Exceptions, and findings at least quarterly and after significant failures, then communicates deficiencies and assigns, tracks, and verifies corrective work through completion.",
    requirements: ["CC4.1", "CC4.2"],
    activity: "Review control evidence and track deficiencies, owners, due dates, and verification.",
    controlType: "detective",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-access-authorization",
    code: "IAM-01",
    title: "Access authorization and least privilege",
    statement: "Access requires a documented business need and approval, uses unique identities and least privilege, and is provisioned or changed only by authorized administrators.",
    requirements: ["CC6.1", "CC6.2", "CC6.3"],
    activity: "Request, approve, provision, change, and record access.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "event-driven",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-strong-authentication",
    code: "IAM-02",
    title: "Strong authentication",
    statement: "Important Systems use approved strong-authentication settings, unique identities, protected credentials, changed or disabled default credentials, and separate administrative identities or roles when technically supported and appropriate to risk. Multi-factor authentication is required for workforce and administrative access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data. Customer and external-user authentication requirements follow approved Controls, customer commitments, and risk decisions. Where required MFA is unavailable, management approves a time-bound Exception with a risk assessment, compensating Controls, an accountable owner, and a review or expiration date.",
    requirements: ["CC6.1", "CC6.2", "CC6.6"],
    activity: "Configure and monitor authentication, credential and recovery-material protection, default credentials, privileged identities or roles, customer requirements, and approved MFA Exceptions.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "continuous",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-access-review-offboarding",
    code: "IAM-03",
    title: "Access review and offboarding",
    statement: "Owners review privileged and production access at least quarterly and other important access at least annually. Access ends at or before notice for involuntary or high-risk departures and within 24 hours for other departures.",
    requirements: ["CC6.2", "CC6.3"],
    activity: "Review access populations, record decisions, and remove dormant, expired, or unneeded access.",
    controlType: "detective",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-physical-workspace-security",
    code: "PHY-01",
    title: "Physical and workspace security",
    statement: "The organization restricts physical access to nonpublic work areas and requires workers to protect devices, papers, screens, and conversations from unauthorized access.",
    requirements: ["CC6.4"],
    activity: "Control visitors and facilities, secure workspaces, and report loss or exposure.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "continuous",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-data-classification-inventory",
    code: "DATA-01",
    title: "Data classification and inventory",
    statement: "Data owners classify important data, record its approved purpose and location, and review data inventories at least annually and after material changes.",
    requirements: ["CC2.1", "CC6.1"],
    activity: "Maintain classification, ownership, system, vendor, and processing records.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-encryption-transmission",
    code: "DATA-02",
    title: "Encryption and secure transmission",
    statement: "Confidential and Restricted data is encrypted in transit over untrusted networks and at rest in approved Systems and on devices, with named key ownership, protected key access, and risk-based key lifecycle controls.",
    requirements: ["CC6.1", "CC6.7"],
    activity: "Configure encryption and approved transfer methods based on classification, and control key generation, storage, distribution, rotation, revocation, and recovery as applicable.",
    controlType: "preventive",
    operationMode: "automated",
    operationPattern: "continuous",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-data-retention-disposal",
    code: "DATA-03",
    title: "Data retention and disposal",
    statement: "Owners maintain an approved retention schedule for important record classes, review it at least annually and after material data-use changes, and delete, anonymize, or securely destroy data and media when retention ends.",
    requirements: ["CC6.5"],
    activity: "Apply approved retention and disposal methods to active, local, backup, and vendor-held copies.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-inventory-configuration",
    code: "OPS-01",
    title: "System inventory and secure configuration",
    statement: "The organization maintains inventories of important Systems, Components, company and approved personal devices, software, service accounts, Vendors, and data stores, with owners, lifecycle state, and secure configuration expectations. Unsupported or unneeded important assets are upgraded, isolated, replaced, or retired according to risk.",
    requirements: ["CC6.1", "CC7.1"],
    activity: "Maintain inventories, baselines, ownership, classification, lifecycle decisions, secure retirement, and approved deviations.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-endpoint-protection",
    code: "OPS-02",
    title: "Endpoint protection",
    statement: "Devices that access company systems use approved configuration, encryption, screen locking, supported software, security updates, and continuous malware protection when supported.",
    requirements: ["CC6.6", "CC6.8", "CC7.1"],
    activity: "Use continuous platform protection where supported and verify endpoint configuration, update, and compliance state on the approved risk-based schedule when periodic work is needed.",
    controlType: "preventive",
    operationMode: "automated",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-network-security",
    code: "NET-01",
    title: "Network and remote-access security",
    statement: "The organization restricts network paths, separates production and nonproduction environments according to data and risk, protects remote access with approved encryption and authentication, and reviews material network access rules at least annually.",
    requirements: ["CC6.6", "CC6.7"],
    activity: "Manage boundaries, environment connections, firewall rules, wireless safeguards, and remote production access.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-change-management",
    code: "CHG-01",
    title: "Change management",
    statement: "Source and deployment paths protect against unauthorized changes and malicious software. Material software and infrastructure changes are recorded, receive a security design or threat analysis suited to their risk, are tested, approved, deployed through an authorized process, and are recoverable. Review is independent when practical; a small team records a risk-appropriate compensating or post-deployment review, or an approved Exception, when independent pre-deployment review is not possible.",
    requirements: ["CC6.8", "CC8.1"],
    activity: "Record the reason, author, risk, security analysis when applicable, reviewer or compensating review, test result, deployment, communication, and rollback method.",
    controlType: "preventive",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-vulnerability-management",
    code: "VUL-01",
    title: "Vulnerability management",
    statement: "The organization monitors for vulnerabilities, chooses scan coverage and cadence based on exposure and risk, and assigns each confirmed vulnerability an approved risk-based remediation target or time-bound Exception.",
    requirements: ["CC7.1", "CC7.2", "CC7.3"],
    activity: "Choose scan coverage and cadence, define approved risk-based remediation targets, and document time-bound Exceptions when a target cannot be met.",
    controlType: "detective",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-penetration-testing",
    code: "PEN-01",
    title: "Penetration testing",
    statement: "Management records whether independent penetration testing is needed for the in-scope service, then documents its scope and cadence from exposure, change, customer commitments, and risk decisions. Findings are tracked to resolution or approved risk treatment.",
    requirements: ["CC7.1", "CC7.2"],
    activity: "Review and record applicability and cadence. When testing is required, define its scope and independence, perform the test, review results, and track findings.",
    controlType: "detective",
    operationMode: "manual",
    operationPattern: "scheduled",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-logging-monitoring",
    code: "LOG-01",
    title: "Logging and monitoring",
    statement: "Important Systems record and protect security and operational events, retain them according to the approved Data Retention Schedule, and use risk-based alerting, review, and alert-path testing. Systems with availability commitments, recovery objectives, or material operational dependencies also monitor the health, capacity, failure, and service indicators needed to detect degradation.",
    requirements: ["CC7.2", "CC7.3"],
    activity: "Collect, protect, alert on, test, and review important log output, access, and applicable health, capacity, failure, and service indicators.",
    controlType: "detective",
    operationMode: "hybrid",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-incident-response",
    code: "IR-01",
    title: "Incident response",
    statement: "Reported security events are assigned an owner and severity, investigated, contained, recovered, communicated, and closed with evidence and corrective work appropriate to impact. Material incidents receive a retrospective within one week.",
    requirements: ["CC7.3", "CC7.4", "CC7.5"],
    activity: "Triage events, preserve evidence, coordinate response and notification review, and complete retrospectives.",
    controlType: "corrective",
    operationMode: "hybrid",
    operationPattern: "event-driven",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-incident-exercise",
    code: "IR-02",
    title: "Incident response exercise",
    statement: "The organization tests its incident process and a representative alert path from generation through acknowledgement, escalation, and fallback at least annually, then records participants, scenario, results, findings, and follow-up work.",
    requirements: ["CC7.4", "CC7.5"],
    activity: "Plan, conduct, review, and document an incident response and alert-path exercise.",
    controlType: "detective",
    operationMode: "manual",
    operationPattern: "scheduled",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-backup-restoration",
    code: "BCP-01",
    title: "Backup and restoration",
    statement: "Each important System has risk-based backup or alternate recovery scope, frequency, retention, monitoring, and restore validation suited to its recovery needs and any approved recovery targets.",
    requirements: ["CC7.5", "CC9.1"],
    activity: "Record backup or alternate recovery procedures, monitor the chosen safeguards, and validate recovery on the approved schedule.",
    controlType: "corrective",
    operationMode: "hybrid",
    operationPattern: "scheduled",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-continuity-exercise",
    code: "BCP-02",
    title: "Continuity planning and exercise",
    statement: "The organization maintains recovery priorities and responsibilities, reviews emergency contacts annually, and tests its continuity and disaster recovery plan at least annually.",
    requirements: ["CC7.5", "CC9.1"],
    activity: "Maintain the plan, contacts, recovery priorities, exercises, results, and follow-up work.",
    controlType: "corrective",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-vendor-due-diligence",
    code: "VEN-01",
    title: "Vendor due diligence and contracting",
    statement: "New Vendors receive risk-based security and privacy review and suitable contractual safeguards before access to Confidential or Restricted data or material reliance by an important service. Applicable contracts address permitted use and confidentiality, security responsibilities, incident notice, access and subprocessor restrictions, continuity, data return or deletion, termination, and assurance rights. Vendors that predate Policy adoption receive a documented transition review, deadline, or approved risk acceptance.",
    requirements: ["CC9.2"],
    activity: "Assess service, data, access, assurance, recovery, incidents, dependencies, supplied Components, and applicable contract safeguards before access or material reliance.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "event-driven",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-vendor-monitoring",
    code: "VEN-02",
    title: "Vendor monitoring",
    statement: "Owners review critical and high-risk vendors at least annually and reassess affected vendors within 30 days after a material service change or incident, then track risks, findings, and follow-up work.",
    requirements: ["CC4.1", "CC9.2"],
    activity: "Review vendor performance, assurance, recovery, access, incidents, and contract obligations.",
    controlType: "detective",
    operationMode: "manual",
    operationPattern: "mixed",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-security-exceptions",
    code: "EXC-01",
    title: "Security exception management",
    statement: "Security exceptions require a business reason, owner, risk assessment, compensating controls, approval, and an expiration or review date.",
    requirements: ["CC5.3", "CC9.1"],
    activity: "Request, assess, approve, monitor, and close time-bound exceptions.",
    controlType: "preventive",
    operationMode: "manual",
    operationPattern: "event-driven",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  }
];

const obligations = [
  {
    id: "obligation-quarterly-security-risk-meeting",
    title: "Quarterly security and risk oversight meeting",
    activityType: "meeting",
    recurrence: calendar("month", 3),
    ownerIds: [OVERSIGHT_TEAM_ID],
    scopeResourceIds: [OVERSIGHT_TEAM_ID],
    controlIds: [
      "control-security-governance",
      "control-security-communication",
      "control-monitoring-remediation"
    ],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-policy-review",
    title: "Annual policy and governed-plan review",
    activityType: "policy-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    scopeResourceIds: [
      INFORMATION_SECURITY_POLICY_ID,
      SECURITY_PLAN_ID,
      RETENTION_SCHEDULE_ID
    ],
    controlIds: ["control-policy-management", "control-data-retention-disposal"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-control-design-review",
    title: "Annual Control design and evidence-path review",
    activityType: "control-design-review",
    recurrence: calendar("year", 1),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-policy-management", "control-monitoring-remediation"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-risk-assessment",
    title: "Annual information security risk assessment",
    activityType: "risk-assessment",
    recurrence: calendar("year", 1),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-risk-assessment"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-workforce-competence-review",
    title: "Annual workforce security-role competence review",
    activityType: "performance-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-workforce-expectations"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-security-training",
    title: "Annual security awareness training",
    activityType: "training",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    scopeResourceIds: ["training-security-awareness"],
    templateResourceId: "training-security-awareness",
    controlIds: [
      "control-security-communication",
      "control-workforce-expectations",
      "control-security-training"
    ],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-quarterly-privileged-access-review",
    title: "Quarterly privileged and production access review",
    activityType: "access-review",
    recurrence: calendar("month", 3),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-access-review",
    title: "Annual important-system access review",
    activityType: "access-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-inventory-review",
    title: "Annual system, company and personal device, vendor, and data inventory review",
    activityType: "inventory-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-inventory-configuration", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-monthly-endpoint-protection-verification",
    title: "Monthly endpoint protection configuration verification",
    activityType: "endpoint-verification",
    recurrence: calendar("month", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-endpoint-protection"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-network-access-review",
    title: "Annual firewall and network access review",
    activityType: "network-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-network-security"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-quarterly-vulnerability-scan",
    title: "Quarterly vulnerability scan",
    activityType: "vulnerability-scan",
    recurrence: calendar("month", 3),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vulnerability-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-penetration-test",
    title: "Annual penetration-testing applicability and cadence review",
    activityType: "risk-assessment",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-penetration-testing"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-quarterly-log-review",
    title: "Quarterly security log and log-access review",
    activityType: "log-review",
    recurrence: calendar("month", 3),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-logging-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-incident-exercise",
    title: "Annual incident response and alert-path exercise",
    activityType: "exercise",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    scopeResourceIds: [SECURITY_PLAN_ID],
    templateResourceId: SECURITY_PLAN_ID,
    controlIds: ["control-incident-exercise", "control-logging-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-backup-restoration-test",
    title: "Annual backup restoration test",
    activityType: "backup-test",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-backup-restoration"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-continuity-exercise",
    title: "Annual business continuity and disaster recovery exercise",
    activityType: "exercise",
    recurrence: calendar("year", 1),
    ownerIds: [OVERSIGHT_TEAM_ID],
    scopeResourceIds: [SECURITY_PLAN_ID],
    templateResourceId: SECURITY_PLAN_ID,
    controlIds: ["control-continuity-exercise"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-critical-vendor-review",
    title: "Annual critical and high-risk vendor review",
    activityType: "vendor-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-due-diligence", "control-vendor-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-emergency-contact-review",
    title: "Annual emergency contact review",
    activityType: "continuity-review",
    recurrence: calendar("year", 1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    scopeResourceIds: [SECURITY_PLAN_ID],
    controlIds: ["control-continuity-exercise"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-start-screening",
    title: "Record the role-based screening and competence decision before sensitive access",
    activityType: "workforce-review",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-workforce-expectations"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-start-agreements",
    title: "Collect workforce agreements and policy acknowledgements",
    activityType: "workforce-acknowledgement",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-workforce-expectations"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-start-access",
    title: "Approve and record initial access",
    activityType: "access-provisioning",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-authorization"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-start-assets",
    title: "Register issued devices in the asset inventory",
    activityType: "asset-registration",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-inventory-configuration"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-start-training",
    title: "Complete security training and retain acknowledgement evidence",
    activityType: "training",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    scopeResourceIds: ["training-security-awareness"],
    templateResourceId: "training-security-awareness",
    controlIds: ["control-security-training"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-end-access",
    title: "Revoke departing-worker access",
    activityType: "access-removal",
    recurrence: event("person-ended"),
    triggerPrompt: "Employee or contractor departing?",
    window: eventWindowHours(24),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-end-assets",
    title: "Recover company property and disable active credentials",
    activityType: "asset-recovery",
    recurrence: event("person-ended"),
    triggerPrompt: "Employee or contractor departing?",
    window: eventWindow(7),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-review-offboarding", "control-inventory-configuration"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-high-risk-departure-access",
    title: "Revoke access at or before departure notice",
    activityType: "access-removal",
    recurrence: event("person-ended"),
    eventRiskLevels: ["high"],
    triggerPrompt: "Involuntary or high-risk departure?",
    window: eventWindowHours(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-role-change-access",
    title: "Reassess and update access for the new role",
    activityType: "access-change",
    recurrence: event("person-role-changed"),
    triggerPrompt: "Worker role changed?",
    window: eventWindow(3),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-authorization", "control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-role-change-training",
    title: "Assign and complete applicable role-based security training",
    activityType: "role-training",
    recurrence: event("person-role-changed"),
    triggerPrompt: "Worker role changed?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-workforce-expectations", "control-security-training"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-personal-device-approval",
    title: "Approve personal-device access and security conditions before use",
    activityType: "personal-device-approval",
    recurrence: event("personal-device-access-planned"),
    triggerPrompt: "Personal device needs company access?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-authorization", "control-endpoint-protection"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-personal-device-registration",
    title: "Register and verify the approved personal device before use",
    activityType: "asset-registration",
    recurrence: event("personal-device-access-planned"),
    triggerPrompt: "Personal device needs company access?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-inventory-configuration", "control-endpoint-protection"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vendor-access-review",
    title: "Complete vendor security and privacy review before access",
    activityType: "vendor-review",
    recurrence: event("vendor-access-planned"),
    triggerPrompt: "New vendor access or data use?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-due-diligence"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vendor-access-contract",
    title: "Record required vendor contract safeguards and data use",
    activityType: "vendor-contract",
    recurrence: event("vendor-access-planned"),
    triggerPrompt: "New vendor access or data use?",
    window: eventWindow(0),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-due-diligence"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vendor-material-change-review",
    title: "Reassess vendor security and privacy after a material change or incident",
    activityType: "vendor-review",
    recurrence: event("vendor-reassessment-needed"),
    triggerPrompt: "Vendor changed materially or had an incident?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vendor-material-change-records",
    title: "Update vendor, risk, contract, data-use, and follow-up records",
    activityType: "vendor-remediation",
    recurrence: event("vendor-reassessment-needed"),
    triggerPrompt: "Vendor changed materially or had an incident?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-monitoring", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-system-change-risk",
    title: "Assess security and data-protection risk from the change",
    activityType: "risk-assessment",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-risk-assessment"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-system-change-scan",
    title: "Run a vulnerability scan when practical",
    activityType: "vulnerability-scan",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vulnerability-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-system-change-governance",
    title: "Review policy, control, and communication impacts",
    activityType: "change-review",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-policy-management", "control-security-communication"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-system-change-retention",
    title: "Review data lifecycle and update the retention schedule",
    activityType: "retention-review",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    scopeResourceIds: [RETENTION_SCHEDULE_ID],
    templateResourceId: RETENTION_SCHEDULE_ID,
    controlIds: ["control-data-retention-disposal", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-system-change-alert-path",
    title: "Test affected security alert and response paths or document non-applicability",
    activityType: "alert-path-test",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-logging-monitoring", "control-incident-exercise"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-material-incident-retrospective",
    title: "Complete the material-incident retrospective",
    activityType: "incident-retrospective",
    recurrence: event("material-incident"),
    triggerPrompt: "Material security incident?",
    window: eventWindow(7),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-incident-response"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-material-incident-actions",
    title: "Assign and track corrective actions",
    activityType: "remediation",
    recurrence: event("material-incident"),
    triggerPrompt: "Material security incident?",
    window: eventWindow(7),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-monitoring-remediation", "control-security-exceptions"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vendor-activation-review",
    title: "Complete vendor activation review",
    activityType: "vendor-review",
    recurrence: event("vendor-activated"),
    triggerPrompt: "Vendor activated?",
    window: eventWindow(30),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-due-diligence", "control-vendor-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vendor-termination-closeout",
    title: "Revoke vendor access and confirm data return or disposal",
    activityType: "access-removal",
    recurrence: event("vendor-terminated"),
    triggerPrompt: "Vendor terminated?",
    window: eventWindow(7),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vendor-monitoring", "control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-data-use-change-assessment",
    title: "Assess the changed data use and control impact",
    activityType: "risk-assessment",
    recurrence: event("material-data-use-change"),
    triggerPrompt: "Material data-use change?",
    window: eventWindow(30),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-risk-assessment", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-incident-closure-review",
    title: "Complete incident closure and lessons-learned review",
    activityType: "incident-retrospective",
    recurrence: event("incident-closed"),
    triggerPrompt: "Incident closed?",
    window: eventWindow(7),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-incident-response", "control-monitoring-remediation"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-policy-revision-approval",
    title: "Review and approve the revised policy",
    activityType: "policy-review",
    recurrence: event("policy-revised"),
    triggerPrompt: "Policy materially revised?",
    window: eventWindow(30),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-policy-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-emergency-change-review",
    title: "Complete emergency-change post-review",
    activityType: "change-review",
    recurrence: event("emergency-change"),
    triggerPrompt: "Emergency change completed?",
    window: eventWindow(2),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-change-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-exception-expiry-review",
    title: "Review expired exception and compensating controls",
    activityType: "exception-review",
    recurrence: event("exception-expired"),
    triggerPrompt: "Exception expired?",
    window: eventWindow(1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-monitoring-remediation", "control-security-exceptions"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-service-account-creation-review",
    title: "Authorize and review the new service account",
    activityType: "access-provisioning",
    recurrence: event("service-account-created"),
    triggerPrompt: "Service account created?",
    window: eventWindow(3),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-authorization"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-service-account-expiry",
    title: "Disable or renew the expired service account",
    activityType: "access-removal",
    recurrence: event("service-account-expired"),
    triggerPrompt: "Service account expired?",
    window: eventWindow(1),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vulnerability-confirmed-remediation",
    title: "Assign confirmed vulnerability remediation",
    activityType: "remediation",
    recurrence: event("vulnerability-confirmed"),
    triggerPrompt: "Vulnerability confirmed?",
    window: eventWindow(3),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-vulnerability-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-vulnerability-overdue-escalation",
    title: "Escalate overdue vulnerability remediation",
    activityType: "remediation",
    recurrence: event("vulnerability-overdue"),
    triggerPrompt: "Vulnerability remediation overdue?",
    window: eventWindow(1),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-vulnerability-management", "control-monitoring-remediation"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-asset-disposal-proof",
    title: "Record asset sanitization and disposal proof",
    activityType: "asset-recovery",
    recurrence: event("asset-disposed"),
    triggerPrompt: "Asset disposed?",
    window: eventWindow(7),
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    controlIds: ["control-inventory-configuration", "control-data-retention-disposal"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-continuity-activation-review",
    title: "Review continuity activation, recovery, and follow-up",
    activityType: "continuity-review",
    recurrence: event("continuity-activated"),
    triggerPrompt: "Continuity plan activated?",
    window: eventWindow(7),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-continuity-exercise", "control-monitoring-remediation"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  }
];

export function baselineRecordPaths(starter = "security") {
  return baselineRecordFiles("2000-01-01", starter).map(({ path }) => path);
}

export function baselineRecordFiles(effectiveDate, starter = "security") {
  const framework = {
    id: FRAMEWORK_ID,
    type: "framework",
    title: "AICPA Trust Services Criteria",
    status: "active",
    version: "2017 with revised points of focus (2022)",
    publisher: "AICPA",
    description: "Default SOC 2 Security-category baseline. Criterion references are included for mapping; obtain the official criteria text from the publisher.",
    sourceReference: {
      title: "2017 Trust Services Criteria (With Revised Points of Focus - 2022)",
      url: "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022"
    }
  };
  const descriptionFramework = {
    id: DESCRIPTION_FRAMEWORK_ID,
    type: "framework",
    title: "AICPA SOC 2 Description Criteria",
    status: "active",
    version: "2018 with revised implementation guidance (2022)",
    publisher: "AICPA",
    description: "Criteria used to prepare and evaluate the service organization's system description. Reference IDs are included; obtain the official criteria text from the publisher.",
    sourceReference: {
      title: "2018 SOC 2 Description Criteria (With Revised Implementation Guidance - 2022)",
      url: "https://www.aicpa-cima.com/resources/download/get-description-criteria-for-your-organizations-soc-2-r-report"
    }
  };
  const commonRequirements = commonCriteria.map(([reference, name, description]) => ({
    id: requirementId(reference),
    type: "requirement",
    title: `${reference}: ${name}`,
    frameworkId: FRAMEWORK_ID,
    reference,
    description,
    tags: ["security", "common-criteria"]
  }));
  const descriptionRequirements = descriptionCriteria.map(([reference, name, description]) => ({
    id: requirementId(reference),
    type: "requirement",
    title: `${reference}: ${name}`,
    frameworkId: DESCRIPTION_FRAMEWORK_ID,
    reference,
    description,
    tags: ["description-criteria"]
  }));
  const controlRecords = controls.map((control) => ({
    id: control.id,
    type: "control",
    title: control.title,
    status: "planned",
    statement: control.statement,
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    requirementIds: control.requirements.map(requirementId),
    code: control.code,
    activity: control.activity,
    controlType: control.controlType,
    operationMode: control.operationMode,
    operationPattern: control.operationPattern,
    policyIds: control.policies,
    ...(FILEGRC_SOURCE_CONTROL_CODES.has(control.code)
      ? { evidenceSourceComponentIds: ["component-filegrc-program-repository"] }
      : {})
  }));
  const team = {
    id: OVERSIGHT_TEAM_ID,
    type: "team",
    title: "Security and Risk Oversight",
    status: "planned",
    purpose: "Provide independent oversight of the security program, risk register, incidents, findings, vendor and access reviews, policy changes, exercises, and overdue work. The chair must be separate from the policy owner and people who operate the controls under review.",
    memberIds: [PROGRAM_LEAD_ID],
    chairIds: []
  };
  const programRepository = {
    id: "component-filegrc-program-repository",
    type: "component",
    title: "filegrc Program Repository",
    status: "planned",
    componentKind: "software",
    criticality: "high",
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
    description: "The Git repository that is authoritative for filegrc governance records, approvals, exceptions, findings, acknowledgements, evidence indexes, and their revision history.",
    environment: "Git repository",
    classificationId: "confidential",
    internetExposed: false,
    systemUses: [],
    informationUses: [{
      informationTypeId: FILEGRC_INFORMATION_TYPE_ID,
      processingOperations: ["collect", "store", "use", "share", "delete"]
    }],
    evidenceSourceKinds: FILEGRC_SOURCE_FAMILIES,
    evidenceOwnerIds: [POLICY_OWNER_APPOINTMENT_ID]
  };
  const obligationRecords = obligations.map((obligation) => {
    const ruleId = `${obligation.id.replace(/^obligation-/, "obligation-rule-")}-v1`;
    return {
      id: obligation.id,
      type: "obligation",
      title: obligation.title,
      status: "proposed",
      activityType: obligation.activityType,
      scheduleMode: "rule",
      ruleIds: [ruleId],
      ownerIds: obligation.ownerIds,
      ...(obligation.triggerPrompt ? { triggerPrompt: obligation.triggerPrompt } : {}),
      ...(obligation.eventRiskLevels ? { eventRiskLevels: obligation.eventRiskLevels } : {}),
      ...(obligation.scopeResourceIds ? { scopeResourceIds: obligation.scopeResourceIds } : {}),
      ...(obligation.templateResourceId ? { templateResourceId: obligation.templateResourceId } : {}),
      controlIds: obligation.controlIds,
      policyIds: obligation.policyIds
    };
  });
  const obligationRuleRecords = obligations.map((obligation) => ({
    id: `${obligation.id.replace(/^obligation-/, "obligation-rule-")}-v1`,
    type: "obligation-rule",
    title: `${obligation.title} rule v1`,
    status: "proposed",
    obligationId: obligation.id,
    activityDefinitionVersion: "1",
    recurrence: obligation.recurrence.mode === "calendar"
      ? { ...obligation.recurrence, anchorDate: effectiveDate }
      : obligation.recurrence,
    ...(obligation.window ? { window: obligation.window } : {}),
    ...(starterObligationSelector(obligation.id) ? { selector: starterObligationSelector(obligation.id) } : {}),
    rationale: "Starter proposal derived from the linked Policy. Management must review the cadence, population, completion criteria, and timing before activation.",
    sourceResourceIds: [...(obligation.policyIds || [])]
  }));
  const sourceCoverageRecords = SOURCE_FAMILIES.map(([sourceFamilyId, title]) => {
    const filegrcManaged = FILEGRC_SOURCE_FAMILIES.includes(sourceFamilyId);
    return {
      id: `source-coverage-${sourceFamilyId}`,
      type: "source-coverage",
      title: `${title} coverage`,
      status: filegrcManaged ? "active" : "planned",
      sourceFamilyId,
      coverageKind: filegrcManaged ? "filegrc" : "external-component",
      scopeResourceIds: ["program-soc-2"],
      ownerIds: [POLICY_OWNER_APPOINTMENT_ID],
      ...(filegrcManaged ? {
        collectionCadence: "Record work when it occurs and export the complete population for the audit period.",
        retentionScheduleItemIds: [`retention-schedule-item-source-${sourceFamilyId}`],
        reconciliationMethod: "Export the complete filegrc source-family population, compare it with related in-scope records and Work Queue activity, and investigate omissions or duplicates.",
        validFrom: effectiveDate
      } : {})
    };
  });

  const informationType = {
    id: FILEGRC_INFORMATION_TYPE_ID,
    type: "information-type",
    title: "Governance, risk, compliance, and audit records",
    status: "active",
    classificationId: "confidential",
    description: "Structured program records, approvals, work history, and evidence indexes stored in the FileGRC repository."
  };
  const retentionScheduleItems = SOURCE_FAMILIES.map(([sourceFamilyId, title]) => ({
    id: `retention-schedule-item-source-${sourceFamilyId}`,
    type: "retention-schedule-item",
    title: `${title} retention review`,
    status: "planned",
    description: "Management must select the covered Information Types, cutoff, retention period, and disposition behavior before activation.",
    informationTypeIds: FILEGRC_SOURCE_FAMILIES.includes(sourceFamilyId) ? [FILEGRC_INFORMATION_TYPE_ID] : [],
    scopeResourceIds: [`source-coverage-${sourceFamilyId}`],
    scheduleDocumentId: RETENTION_SCHEDULE_ID,
    sourceResourceIds: [INFORMATION_SECURITY_POLICY_ID, RETENTION_SCHEDULE_ID],
    ownerIds: [POLICY_OWNER_APPOINTMENT_ID]
  }));

  const foundation = [
    recordFile("information-types", informationType),
    recordFile("components", programRepository),
    recordFile("teams", team)
  ];
  if (starter === "foundation") return foundation;
  if (starter !== "security") throw new Error(`Unknown starter profile "${starter}".`);
  return [
    recordFile("frameworks", framework),
    recordFile("frameworks", descriptionFramework),
    ...commonRequirements.map((record) => recordFile("requirements", record)),
    ...descriptionRequirements.map((record) => recordFile("requirements", record)),
    ...controlRecords.map((record) => recordFile("controls", record)),
    ...foundation,
    ...sourceCoverageRecords.map((record) => recordFile("source-coverage", record)),
    ...retentionScheduleItems.map((record) => recordFile("retention-schedule-items", record)),
    ...obligationRecords.map((record) => recordFile("obligations", record)),
    ...obligationRuleRecords.map((record) => recordFile("obligation-rules", record))
  ];
}

function starterObligationSelector(obligationId) {
  const definitions = {
    "obligation-annual-workforce-competence-review": { resourceType: "person", statuses: ["active"] },
    "obligation-annual-access-review": { resourceType: "system", statuses: ["active"], criticalities: ["high", "critical"] },
    "obligation-annual-network-access-review": { resourceType: "system", statuses: ["active"], criticalities: ["high", "critical"] },
    "obligation-quarterly-vulnerability-scan": { resourceType: "system", statuses: ["active"], criticalities: ["high", "critical"] },
    "obligation-quarterly-log-review": { resourceType: "system", statuses: ["active"], criticalities: ["high", "critical"] },
    "obligation-annual-backup-restoration-test": { resourceType: "system", statuses: ["active"], criticalities: ["high", "critical"] },
    "obligation-annual-critical-vendor-review": { resourceType: "vendor", statuses: ["active"], criticalities: ["high", "critical"] }
  };
  const definition = definitions[obligationId];
  return definition ? {
    ...definition,
    membershipMode: "as-of",
    cutoff: "window-end"
  } : null;
}

export async function writeBaselineRecords(target, effectiveDate, starter = "security") {
  for (const { path: relativePath, record } of baselineRecordFiles(effectiveDate, starter)) {
    const path = join(target, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
}

function calendar(unit, interval, anchorDate) {
  return {
    mode: "calendar",
    unit,
    interval,
    ...(anchorDate ? { anchorDate } : {})
  };
}

function event(eventType) {
  return { mode: "event", eventType };
}

function eventWindow(dueAfter = 30) {
  return {
    precision: "date",
    startsAfter: 0,
    dueAfter
  };
}

function eventWindowHours(dueAfter) {
  return {
    precision: "timestamp",
    startsAfter: 0,
    dueAfter
  };
}

function requirementId(reference) {
  return `requirement-soc2-${reference.toLowerCase().replace(".", "-")}`;
}

function recordFile(collection, record) {
  return { path: join("data", collection, `${record.id}.json`), record };
}
