import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const FRAMEWORK_ID = "framework-aicpa-trust-services-criteria";
const DESCRIPTION_FRAMEWORK_ID = "framework-aicpa-soc2-description-criteria";
const OWNER_ID = "person-policy-owner";
const OVERSIGHT_TEAM_ID = "team-security-risk-oversight";
const INFORMATION_SECURITY_POLICY_ID = "policy-information-security";
const DATA_POLICY_ID = "policy-data-protection-handling";
const RETENTION_SCHEDULE_ID = "document-data-retention-schedule";
const ROLE_TRAINING_IDS = [
  "training-secure-development",
  "training-privileged-sensitive-roles",
  "training-anti-bribery-high-risk-roles"
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
  ["DC8", "Criteria not relevant", "Identify any trust services criteria within an included category that are not relevant to the system and explain why."],
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
    frequency: "Quarterly",
    policies: [INFORMATION_SECURITY_POLICY_ID, "policy-anti-bribery-corruption"]
  },
  {
    id: "control-policy-management",
    code: "GOV-02",
    title: "Policy management",
    statement: "The policy owner reviews governed policies and plans at least annually and after material changes, obtains approval from a separate independent approver, and retains the approved revisions in Git.",
    requirements: ["CC5.1", "CC5.2", "CC5.3"],
    activity: "Review, approve, communicate, and version policies and plans.",
    controlType: "preventive",
    operationMode: "manual",
    frequency: "Annually and after material changes",
    policies: [
      "policy-anti-bribery-corruption",
      "policy-clear-desk-screen",
      DATA_POLICY_ID,
      INFORMATION_SECURITY_POLICY_ID,
      "policy-mobile-computing-communications"
    ]
  },
  {
    id: "control-security-communication",
    code: "GOV-03",
    title: "Security communication",
    statement: "The organization communicates security responsibilities, approved reporting routes, material changes, and relevant control information to its workforce and outside parties.",
    requirements: ["CC2.1", "CC2.2", "CC2.3"],
    activity: "Maintain reporting routes and communicate policies, changes, and security information.",
    controlType: "preventive",
    operationMode: "hybrid",
    frequency: "Ongoing and after material changes",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "control-workforce-expectations",
    code: "HR-01",
    title: "Workforce expectations",
    statement: "Workers agree to applicable conduct, confidentiality, acceptable-use, and security responsibilities before receiving access and are held accountable for violations.",
    requirements: ["CC1.4"],
    activity: "Complete screening when appropriate, agreements, policy acknowledgement, and corrective action.",
    controlType: "preventive",
    operationMode: "manual",
    frequency: "Before access and on material change",
    policies: [INFORMATION_SECURITY_POLICY_ID, "policy-anti-bribery-corruption"]
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
    frequency: "Onboarding and annually",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID, "policy-anti-bribery-corruption"]
  },
  {
    id: "control-performance-review",
    code: "HR-03",
    title: "Workforce performance review",
    statement: "Managers conduct a documented performance review at least annually and address responsibilities, conduct, and corrective action as appropriate to each worker's role.",
    requirements: ["CC1.5"],
    activity: "Complete and retain annual performance reviews and resulting corrective work.",
    controlType: "detective",
    operationMode: "manual",
    frequency: "Annually",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-risk-assessment",
    code: "RSK-01",
    title: "Risk assessment and treatment",
    statement: "The organization assesses information security risk at least annually and after material changes, assigns owners and responses, and reviews high and critical risks at least quarterly.",
    requirements: ["CC3.1", "CC3.2", "CC3.3", "CC3.4", "CC9.1"],
    activity: "Identify threats and changes, score risk, select treatment, and track review dates.",
    controlType: "detective",
    operationMode: "manual",
    frequency: "Annually, quarterly for high risks, and after material changes",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "control-monitoring-remediation",
    code: "MON-01",
    title: "Control monitoring and remediation",
    statement: "Management reviews control operation, incidents, test results, exceptions, and findings, then assigns and tracks corrective work through completion.",
    requirements: ["CC4.1", "CC4.2"],
    activity: "Review control evidence and track deficiencies, owners, due dates, and verification.",
    controlType: "detective",
    operationMode: "manual",
    frequency: "Quarterly and as issues arise",
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
    frequency: "Per access event",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "control-strong-authentication",
    code: "IAM-02",
    title: "Strong authentication",
    statement: "Important systems use approved authentication settings, protected unique credentials, and multi-factor authentication for administrative, production, source-control, email, identity, and sensitive-data access when supported.",
    requirements: ["CC6.1", "CC6.2", "CC6.6"],
    activity: "Configure and monitor authentication, credential storage, and privileged roles.",
    controlType: "preventive",
    operationMode: "hybrid",
    frequency: "Continuous",
    policies: [INFORMATION_SECURITY_POLICY_ID, "policy-mobile-computing-communications"]
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
    frequency: "Quarterly, annually, and per workforce event",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
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
    frequency: "Continuous",
    policies: [INFORMATION_SECURITY_POLICY_ID, "policy-clear-desk-screen", "policy-mobile-computing-communications"]
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
    frequency: "Annually and after material changes",
    policies: [DATA_POLICY_ID, INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-encryption-transmission",
    code: "DATA-02",
    title: "Encryption and secure transmission",
    statement: "Confidential and Restricted data is encrypted in transit over untrusted networks and at rest in approved systems and on devices, with protected key access.",
    requirements: ["CC6.1", "CC6.7"],
    activity: "Configure encryption and approved transfer methods based on classification.",
    controlType: "preventive",
    operationMode: "automated",
    frequency: "Continuous",
    policies: [DATA_POLICY_ID, INFORMATION_SECURITY_POLICY_ID, "policy-mobile-computing-communications"]
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
    frequency: "Per retention event",
    policies: [DATA_POLICY_ID, INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-inventory-configuration",
    code: "OPS-01",
    title: "System inventory and secure configuration",
    statement: "The organization maintains inventories of important systems, company and approved personal devices, service accounts, vendors, and data stores, with owners, lifecycle state, and secure configuration expectations.",
    requirements: ["CC6.1", "CC7.1"],
    activity: "Maintain inventories, baselines, ownership, classification, and approved deviations.",
    controlType: "preventive",
    operationMode: "hybrid",
    frequency: "Ongoing with annual review",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-endpoint-protection",
    code: "OPS-02",
    title: "Endpoint protection",
    statement: "Devices that access company systems use approved configuration, encryption, screen locking, supported software, security updates, and continuous malware protection when supported.",
    requirements: ["CC6.6", "CC7.1"],
    activity: "Manage endpoint safeguards and perform a full or equivalent malware scan at least monthly.",
    controlType: "preventive",
    operationMode: "automated",
    frequency: "Continuous with monthly scanning",
    policies: [INFORMATION_SECURITY_POLICY_ID, "policy-mobile-computing-communications"]
  },
  {
    id: "control-network-security",
    code: "NET-01",
    title: "Network and remote-access security",
    statement: "The organization restricts network paths, protects remote access with approved encryption and authentication, and reviews material network access rules at least annually.",
    requirements: ["CC6.6", "CC6.7"],
    activity: "Manage boundaries, firewall rules, wireless safeguards, and remote production access.",
    controlType: "preventive",
    operationMode: "hybrid",
    frequency: "Continuous with annual review",
    policies: [INFORMATION_SECURITY_POLICY_ID, "policy-mobile-computing-communications"]
  },
  {
    id: "control-change-management",
    code: "CHG-01",
    title: "Change management",
    statement: "Material software and infrastructure changes are recorded, reviewed, tested, approved, deployed through an authorized process, and recoverable; emergency changes receive later review.",
    requirements: ["CC6.8", "CC8.1"],
    activity: "Record the reason, author, reviewer, test result, deployment, and rollback method.",
    controlType: "preventive",
    operationMode: "hybrid",
    frequency: "Per change",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-vulnerability-management",
    code: "VUL-01",
    title: "Vulnerability management",
    statement: "The organization monitors for vulnerabilities and scans internet-facing and production systems at least quarterly and after material changes when practical. Critical, High, Medium, and Low vulnerabilities are remediated within 7, 14, 30, and 30 days unless an approved exception applies.",
    requirements: ["CC7.1", "CC7.2", "CC7.3"],
    activity: "Identify, validate, prioritize, remediate, or approve time-bound exceptions for vulnerabilities.",
    controlType: "detective",
    operationMode: "hybrid",
    frequency: "Quarterly and after material changes",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-penetration-testing",
    code: "PEN-01",
    title: "Penetration testing",
    statement: "An independent penetration test evaluates the external attack surface of the in-scope service at least annually, with findings tracked to resolution or approved risk treatment.",
    requirements: ["CC7.1", "CC7.2"],
    activity: "Define scope, perform independent testing, review results, and track findings.",
    controlType: "detective",
    operationMode: "manual",
    frequency: "Annually",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-logging-monitoring",
    code: "LOG-01",
    title: "Logging and monitoring",
    statement: "Important systems record security and operational events, protect and retain security logs for at least 12 months, and provide risk-based alerting, quarterly review, annual end-to-end alert-path testing, and testing after material alerting changes.",
    requirements: ["CC7.2", "CC7.3"],
    activity: "Collect, protect, alert on, test, and review important log output and access.",
    controlType: "detective",
    operationMode: "hybrid",
    frequency: "Continuous with quarterly review",
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
    frequency: "Per event",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
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
    frequency: "Annually",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-backup-restoration",
    code: "BCP-01",
    title: "Backup and restoration",
    statement: "Important production data is backed up at least daily and retained for at least 30 days unless an approved stronger objective applies, with failures monitored and restoration tested annually.",
    requirements: ["CC7.5", "CC9.1"],
    activity: "Protect and monitor backups, then test retrieval and use of restored data.",
    controlType: "corrective",
    operationMode: "hybrid",
    frequency: "Daily with annual restoration test",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-continuity-exercise",
    code: "BCP-02",
    title: "Continuity planning and exercise",
    statement: "The organization maintains recovery priorities and responsibilities, reviews emergency contacts annually, and tests its continuity and disaster recovery plan at least annually.",
    requirements: ["CC7.5", "CC9.1"],
    activity: "Maintain the plan, contacts, recovery objectives, exercises, results, and follow-up work.",
    controlType: "corrective",
    operationMode: "manual",
    frequency: "Annually and after material disruption",
    policies: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "control-vendor-due-diligence",
    code: "VEN-01",
    title: "Vendor due diligence and contracting",
    statement: "Vendors receive access to Confidential or Restricted data only after risk-based security and privacy review and suitable contractual safeguards.",
    requirements: ["CC9.2"],
    activity: "Assess service, data, access, assurance, recovery, incidents, and contract terms before access.",
    controlType: "preventive",
    operationMode: "manual",
    frequency: "Before access and after material changes",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
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
    frequency: "Annually and after material changes or incidents",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
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
    frequency: "Per exception",
    policies: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
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
    controlIds: ["control-security-governance"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-policy-review",
    title: "Annual policy and governed-plan review",
    activityType: "policy-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    scopeResourceIds: [
      "policy-anti-bribery-corruption",
      "policy-clear-desk-screen",
      DATA_POLICY_ID,
      INFORMATION_SECURITY_POLICY_ID,
      "policy-mobile-computing-communications",
      "document-business-continuity-disaster-recovery",
      "document-incident-response-plan",
      RETENTION_SCHEDULE_ID
    ],
    controlIds: ["control-policy-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-risk-assessment",
    title: "Annual information security risk assessment",
    activityType: "risk-assessment",
    recurrence: calendar("year", 1),
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-risk-assessment"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-annual-security-training",
    title: "Annual security awareness training",
    activityType: "training",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    scopeResourceIds: ["training-security-awareness"],
    templateResourceId: "training-security-awareness",
    controlIds: ["control-security-training"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-annual-performance-review",
    title: "Annual workforce performance review",
    activityType: "performance-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-performance-review"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-quarterly-privileged-access-review",
    title: "Quarterly privileged and production access review",
    activityType: "access-review",
    recurrence: calendar("month", 3),
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-annual-access-review",
    title: "Annual important-system access review",
    activityType: "access-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-annual-inventory-review",
    title: "Annual system, company and personal device, vendor, and data inventory review",
    activityType: "inventory-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-inventory-configuration", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-monthly-malware-scan",
    title: "Monthly endpoint malware scan",
    activityType: "security-scan",
    recurrence: calendar("month", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-endpoint-protection"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-network-access-review",
    title: "Annual firewall and network access review",
    activityType: "network-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-network-security"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-quarterly-vulnerability-scan",
    title: "Quarterly vulnerability scan",
    activityType: "vulnerability-scan",
    recurrence: calendar("month", 3),
    ownerIds: [OWNER_ID],
    controlIds: ["control-vulnerability-management"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-penetration-test",
    title: "Annual independent penetration test",
    activityType: "penetration-test",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-penetration-testing"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-quarterly-log-review",
    title: "Quarterly security log and log-access review",
    activityType: "log-review",
    recurrence: calendar("month", 3),
    ownerIds: [OWNER_ID],
    controlIds: ["control-logging-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-incident-exercise",
    title: "Annual incident response and alert-path exercise",
    activityType: "exercise",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    scopeResourceIds: ["document-incident-response-plan"],
    templateResourceId: "document-incident-response-plan",
    controlIds: ["control-incident-exercise", "control-logging-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-backup-restoration-test",
    title: "Annual backup restoration test",
    activityType: "backup-test",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-backup-restoration"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-continuity-exercise",
    title: "Annual business continuity and disaster recovery exercise",
    activityType: "exercise",
    recurrence: calendar("year", 1),
    ownerIds: [OVERSIGHT_TEAM_ID],
    scopeResourceIds: ["document-business-continuity-disaster-recovery"],
    templateResourceId: "document-business-continuity-disaster-recovery",
    controlIds: ["control-continuity-exercise"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-annual-critical-vendor-review",
    title: "Annual critical and high-risk vendor review",
    activityType: "vendor-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    controlIds: ["control-vendor-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-annual-emergency-contact-review",
    title: "Annual emergency contact review",
    activityType: "continuity-review",
    recurrence: calendar("year", 1),
    ownerIds: [OWNER_ID],
    scopeResourceIds: ["document-business-continuity-disaster-recovery"],
    controlIds: ["control-continuity-exercise"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-worker-start-agreements",
    title: "Collect workforce agreements and policy acknowledgements",
    activityType: "workforce-acknowledgement",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(0),
    completionResourceTypes: ["attestation", "evidence"],
    ownerIds: [OWNER_ID],
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
    completionResourceTypes: ["access-grant", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-authorization"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-worker-start-assets",
    title: "Register issued devices in the asset inventory",
    activityType: "asset-registration",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(0),
    completionResourceTypes: ["asset"],
    ownerIds: [OWNER_ID],
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
    completionResourceTypes: ["attestation", "evidence"],
    ownerIds: [OWNER_ID],
    scopeResourceIds: ["training-security-awareness"],
    templateResourceId: "training-security-awareness",
    controlIds: ["control-security-training"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-worker-start-role-training",
    title: "Complete or document non-applicability of role-based training",
    activityType: "role-training",
    recurrence: event("person-started"),
    triggerPrompt: "New employee or contractor?",
    window: eventWindow(30),
    completionResourceTypes: ["attestation", "evidence"],
    ownerIds: [OWNER_ID],
    scopeResourceIds: ROLE_TRAINING_IDS,
    controlIds: ["control-security-training"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID, "policy-anti-bribery-corruption"]
  },
  {
    id: "obligation-worker-end-access",
    title: "Revoke departing-worker access",
    activityType: "access-removal",
    recurrence: event("person-ended"),
    triggerPrompt: "Employee or contractor departing?",
    window: eventWindowHours(24),
    completionResourceTypes: ["access-grant", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-worker-end-assets",
    title: "Recover company property and disable active credentials",
    activityType: "asset-recovery",
    recurrence: event("person-ended"),
    triggerPrompt: "Employee or contractor departing?",
    window: eventWindow(7),
    completionResourceTypes: ["asset", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-review-offboarding", "control-inventory-configuration"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  },
  {
    id: "obligation-high-risk-departure-access",
    title: "Revoke access at or before departure notice",
    activityType: "access-removal",
    recurrence: event("high-risk-person-ended"),
    triggerPrompt: "Involuntary or high-risk departure?",
    window: eventWindowHours(0),
    completionResourceTypes: ["access-grant", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-worker-role-change-access",
    title: "Reassess and update access for the new role",
    activityType: "access-change",
    recurrence: event("person-role-changed"),
    triggerPrompt: "Worker role changed?",
    window: eventWindow(3),
    completionResourceTypes: ["access-grant", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-authorization", "control-access-review-offboarding"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-worker-role-change-training",
    title: "Complete or document non-applicability of training for the new role",
    activityType: "role-training",
    recurrence: event("person-role-changed"),
    triggerPrompt: "Worker role changed?",
    window: eventWindow(30),
    completionResourceTypes: ["attestation", "evidence"],
    ownerIds: [OWNER_ID],
    scopeResourceIds: ROLE_TRAINING_IDS,
    controlIds: ["control-security-training"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID, "policy-anti-bribery-corruption"]
  },
  {
    id: "obligation-personal-device-approval",
    title: "Approve personal-device access and security conditions before use",
    activityType: "personal-device-approval",
    recurrence: event("personal-device-access-planned"),
    triggerPrompt: "Personal device needs company access?",
    window: eventWindow(0),
    completionResourceTypes: ["evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-access-authorization", "control-endpoint-protection"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, "policy-mobile-computing-communications"]
  },
  {
    id: "obligation-personal-device-registration",
    title: "Register and verify the approved personal device before use",
    activityType: "asset-registration",
    recurrence: event("personal-device-access-planned"),
    triggerPrompt: "Personal device needs company access?",
    window: eventWindow(0),
    completionResourceTypes: ["asset", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-inventory-configuration", "control-endpoint-protection"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, "policy-mobile-computing-communications"]
  },
  {
    id: "obligation-vendor-access-review",
    title: "Complete vendor security and privacy review before access",
    activityType: "vendor-review",
    recurrence: event("vendor-access-planned"),
    triggerPrompt: "New vendor access or data use?",
    window: eventWindow(0),
    completionResourceTypes: ["vendor-review", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-vendor-due-diligence"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-vendor-access-contract",
    title: "Record required vendor contract safeguards and data use",
    activityType: "vendor-contract",
    recurrence: event("vendor-access-planned"),
    triggerPrompt: "New vendor access or data use?",
    window: eventWindow(0),
    completionResourceTypes: ["document", "vendor"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-vendor-due-diligence"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-vendor-material-change-review",
    title: "Reassess vendor security and privacy after a material change or incident",
    activityType: "vendor-review",
    recurrence: event("vendor-reassessment-needed"),
    triggerPrompt: "Vendor changed materially or had an incident?",
    window: eventWindow(30),
    completionResourceTypes: ["vendor-review", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-vendor-monitoring"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-vendor-material-change-records",
    title: "Update vendor, risk, contract, data-use, and follow-up records",
    activityType: "vendor-remediation",
    recurrence: event("vendor-reassessment-needed"),
    triggerPrompt: "Vendor changed materially or had an incident?",
    window: eventWindow(30),
    completionResourceTypes: ["vendor", "risk", "document", "action-item", "evidence"],
    ownerIds: [OWNER_ID],
    controlIds: ["control-vendor-monitoring", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-system-change-risk",
    title: "Assess security and data-protection risk from the change",
    activityType: "risk-assessment",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    completionResourceTypes: ["risk-assessment", "risk", "evidence"],
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-risk-assessment"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-system-change-scan",
    title: "Run a vulnerability scan when practical",
    activityType: "vulnerability-scan",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    completionResourceTypes: ["vulnerability-scan", "evidence"],
    ownerIds: [OWNER_ID],
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
    completionResourceTypes: ["meeting", "policy", "control", "evidence"],
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-policy-management", "control-security-communication"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-system-change-retention",
    title: "Review data lifecycle and update the retention schedule",
    activityType: "retention-review",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    completionResourceTypes: ["document", "evidence"],
    ownerIds: [OWNER_ID],
    scopeResourceIds: [RETENTION_SCHEDULE_ID],
    templateResourceId: RETENTION_SCHEDULE_ID,
    controlIds: ["control-data-retention-disposal", "control-data-classification-inventory"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID, DATA_POLICY_ID]
  },
  {
    id: "obligation-system-change-alert-path",
    title: "Test affected security alert and response paths or document non-applicability",
    activityType: "alert-path-test",
    recurrence: event("system-material-change"),
    triggerPrompt: "Material system, service, or data-use change?",
    window: eventWindow(30),
    completionResourceTypes: ["control-test", "exercise", "evidence"],
    ownerIds: [OWNER_ID],
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
    completionResourceTypes: ["incident", "document", "evidence"],
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
    completionResourceTypes: ["action-item", "finding"],
    ownerIds: [OVERSIGHT_TEAM_ID],
    controlIds: ["control-monitoring-remediation"],
    policyIds: [INFORMATION_SECURITY_POLICY_ID]
  }
];

export function baselineRecordPaths() {
  return baselineRecordFiles("2000-01-01").map(({ path }) => path);
}

export function baselineRecordFiles(effectiveDate) {
  const framework = {
    schemaVersion: 1,
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
    schemaVersion: 1,
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
    schemaVersion: 1,
    id: requirementId(reference),
    type: "requirement",
    title: `${reference}: ${name}`,
    frameworkId: FRAMEWORK_ID,
    reference,
    applicability: "applicable",
    description,
    applicabilityRationale: "Included in the default SOC 2 Security baseline. Confirm applicability and exact interpretation with the selected auditor.",
    tags: ["security", "common-criteria"]
  }));
  const descriptionRequirements = descriptionCriteria.map(([reference, name, description]) => ({
    schemaVersion: 1,
    id: requirementId(reference),
    type: "requirement",
    title: `${reference}: ${name}`,
    frameworkId: DESCRIPTION_FRAMEWORK_ID,
    reference,
    applicability: "applicable",
    description,
    applicabilityRationale: "Included for preparing the system description. Confirm the official criterion and expected presentation with the selected auditor.",
    tags: ["description-criteria"]
  }));
  const controlRecords = controls.map((control) => ({
    schemaVersion: 1,
    id: control.id,
    type: "control",
    title: control.title,
    status: "planned",
    statement: control.statement,
    ownerIds: [OWNER_ID],
    requirementIds: control.requirements.map(requirementId),
    code: control.code,
    activity: control.activity,
    controlType: control.controlType,
    operationMode: control.operationMode,
    frequency: control.frequency,
    policyIds: control.policies
  }));
  const team = {
    schemaVersion: 1,
    id: OVERSIGHT_TEAM_ID,
    type: "team",
    title: "Security and Risk Oversight",
    status: "inactive",
    purpose: "Provide independent oversight of the security program, risk register, incidents, findings, vendor and access reviews, policy changes, exercises, and overdue work. The chair must be separate from the policy owner and people who operate the controls under review.",
    memberIds: [OWNER_ID],
    chairIds: [],
    meetingCadence: calendar("month", 3, effectiveDate)
  };
  const programRepository = {
    schemaVersion: 1,
    id: "system-filegrc-program-repository",
    type: "system",
    title: "filegrc Program Repository",
    status: "active",
    criticality: "high",
    ownerIds: [OWNER_ID],
    description: "The Git repository that is authoritative for filegrc governance records, approvals, exceptions, findings, acknowledgements, evidence indexes, and their revision history.",
    systemKind: "governance-system-of-record",
    environment: "Git repository",
    dataClassification: "Confidential",
    internetExposed: false,
    inScope: false,
    evidenceSourceKinds: ["training-acknowledgement", "exception-finding"],
    evidenceOwnerIds: [OWNER_ID]
  };
  const obligationRecords = obligations.map((obligation) => ({
    schemaVersion: 1,
    id: obligation.id,
    type: "obligation",
    title: obligation.title,
    status: "active",
    activityType: obligation.activityType,
    recurrence: obligation.recurrence.mode === "calendar"
      ? { ...obligation.recurrence, anchorDate: effectiveDate }
      : obligation.recurrence,
    ownerIds: obligation.ownerIds,
    startsOn: effectiveDate,
    ...(obligation.triggerPrompt ? { triggerPrompt: obligation.triggerPrompt } : {}),
    ...(obligation.window ? { window: obligation.window } : {}),
    ...(obligation.completionResourceTypes ? { completionResourceTypes: obligation.completionResourceTypes } : {}),
    ...(obligation.scopeResourceIds ? { scopeResourceIds: obligation.scopeResourceIds } : {}),
    ...(obligation.templateResourceId ? { templateResourceId: obligation.templateResourceId } : {}),
    controlIds: obligation.controlIds,
    policyIds: obligation.policyIds
  }));

  return [
    recordFile("frameworks", framework),
    recordFile("frameworks", descriptionFramework),
    ...commonRequirements.map((record) => recordFile("requirements", record)),
    ...descriptionRequirements.map((record) => recordFile("requirements", record)),
    ...controlRecords.map((record) => recordFile("controls", record)),
    recordFile("systems", programRepository),
    recordFile("teams", team),
    ...obligationRecords.map((record) => recordFile("obligations", record))
  ];
}

export async function writeBaselineRecords(target, effectiveDate) {
  for (const { path: relativePath, record } of baselineRecordFiles(effectiveDate)) {
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

function eventWindow(endOffsetDays = 30) {
  return {
    startOffsetDays: 0,
    endOffsetDays
  };
}

function eventWindowHours(endOffsetHours) {
  return {
    startOffsetHours: 0,
    endOffsetHours
  };
}

function requirementId(reference) {
  return `requirement-soc2-${reference.toLowerCase().replace(".", "-")}`;
}

function recordFile(collection, record) {
  return { path: join("data", collection, `${record.id}.json`), record };
}
