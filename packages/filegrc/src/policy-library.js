import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { modelSupports } from "../model/index.js";
import { applyResourceBatch, contentRevision } from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { resolveDataPath } from "./paths.js";
import { loadWorkspace } from "./workspace.js";

export const INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID = "consolidated-information-security-policy-v3";
export const STRONG_AUTHENTICATION_LIBRARY_PROPOSAL_ID = INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID;

const POLICY_ID = "policy-information-security";
const POLICY_CONTENT_PATH = "policies/policy-information-security.md";
const POLICY_DISPLAY_PATH = `data/${POLICY_CONTENT_PATH}`;
const TRAINING_ID = "training-security-awareness";
const TRAINING_CONTENT_PATH = "training/training-security-awareness.md";
const TRAINING_DISPLAY_PATH = `data/${TRAINING_CONTENT_PATH}`;
const PRIOR_TRAINING_REVISIONS = new Set([
  "53583484d668697e78d82bc22136d78976191303a06f67d0ad2edb55ba5ee0c6",
  "0c6677c22932eb3734240125bc0f40418a13f31d0a31943f4ecd12754afed7fc",
  "9e020af0de1c137607ba4c3186f04be7a00e0d0006e7fc8c7a109e35faf353cf",
  "bf8ac1a9e22a215ed375b590f3cba767801e2e062069e147290bad2c98fd29aa"
]);
const CURRENT_TRAINING_REVISION = "7e55e8df6991d32085ca836c24e3b0015806d04523eca7ed4ee9e51043f05614";
const PRIOR_PASSWORD_MANAGER_TRAINING = "Use an approved password manager to generate and store a unique password for each account.";
const CURRENT_CREDENTIAL_STORAGE_TRAINING = "Use a unique password for each account and store it only through the credential-protection method approved for that System.";
const PRIOR_REMOTE_MFA_TRAINING = "Use approved remote-access methods and multi-factor authentication.";
const CURRENT_REMOTE_MFA_TRAINING = "Use approved remote-access methods and multi-factor authentication when the Policy, Control, customer commitment, or risk decision requires it.";
const PRIOR_SECRET_HANDLING_TRAINING = "Keep passwords, recovery codes, private keys, and authentication tokens out of email, chat, tickets, source code, and general-purpose documents.";
const CURRENT_SECRET_HANDLING_TRAINING = "Keep plaintext passwords, recovery codes, private keys, and authentication tokens out of email, chat, tickets, source code, and general-purpose documents. Approved source-controlled ciphertext must follow the Policy and keep decryption keys separate.";
const LEGACY_REPOSITORY_SECRET_TRAINING = "Do not put credentials, authentication tokens, or cryptographic keys in this repository or another general-purpose system.";
const PRIOR_REPOSITORY_SECRET_TRAINING = "Do not put plaintext credentials, authentication tokens, or cryptographic keys in this repository or another general-purpose System. Approved source-controlled ciphertext must meet the Policy's separate-key, access, and rotation conditions.";
const CURRENT_REPOSITORY_SECRET_TRAINING = "Do not put plaintext credentials, authentication tokens, or cryptographic keys in source repositories or general-purpose Systems. Approved source-controlled ciphertext must meet the Policy's separate-key, access, and rotation conditions.";
const PRIOR_SOURCE_SECRET_TRAINING = "Keep secrets out of source code, build output, tickets, chat, and logs.";
const CURRENT_SOURCE_SECRET_TRAINING = "Keep plaintext secrets out of source code, build output, tickets, chat, and logs. Repository access alone must never decrypt approved source-controlled ciphertext.";
const PRIOR_ENDPOINT_SETTING_TRAINING = "Company-managed devices use the automatic-lock setting recorded in the applicable Endpoint Control, Component, or System.";
const CURRENT_ENDPOINT_SETTING_TRAINING = "Company-managed devices must use the approved automatic-lock setting.";
const PRIOR_CONFIGURATION_RECORD_TRAINING = "The applicable Controls, Components, Systems, and governed schedules record the actual tools, settings, approval paths, and evidence.";
const CURRENT_CONFIGURATION_DOCUMENTATION_TRAINING = "Approved supporting standards, procedures, and schedules document the tools, settings, approval paths, and evidence.";
const DOCUMENT_CONTENT_UPDATES = [
  {
    id: "document-data-retention-schedule",
    path: "documents/document-data-retention-schedule.md",
    priorRevision: "45a408e8139bd57f42dda5ca5ae5c8cd4480b4e7bf08834f60058148a3a63475",
    currentRevision: "d80b99ce53d1012cc169bbbc2afab8d0597bfbe9f30ac0812a8d5bbeb2ed9f90",
    replacements: [
      ["FileGRC detects the bracketed prompts as approval blockers. Remove each prompt only after replacing it with a reviewed fact.", "Remove each bracketed prompt only after replacing it with a reviewed fact."],
      ["Record the authority, scope, owner, start date, and release decision outside this public template.", "Record the authority, scope, owner, start date, and release decision in controlled legal-hold records."]
    ],
    summary: "Keep FileGRC prompt handling in document guidance and make the Retention Schedule standalone."
  },
  {
    id: "document-security-incident-recovery-plan",
    path: "documents/document-security-incident-recovery-plan.md",
    priorRevision: "339ff564fa0ec26503c2498e8d3c44529957113cf782aa03ddb5b4e64c8f0404",
    currentRevision: "51a19e22f3e0b31196371676297bfa843f96295d2f6c72e81a969ce7bafc36ae",
    replacements: [
      ["Controls, Components, Systems, Obligations, and Evidence hold the actual technical configuration and proof of operation.", "Supporting procedures, system records, and retained evidence document the actual technical configuration and operation."],
      ["If an incident raises a legal, privacy, or insurance question, the incident lead gets suitable advice at that time. FileGRC does not require pre-arranged counsel, in-house counsel, or a standing legal retainer.", "If an incident raises a legal, privacy, or insurance question, the incident lead obtains suitable advice at that time. A pre-arranged counsel relationship or standing legal retainer is required only when management determines that the organization's obligations and risk warrant one."],
      ["[Complete before activation: Link every important System and record its approved recovery time objective, recovery point objective, maximum tolerable downtime, dependencies, owner, and critical customer commitments in the System record.]", "[Complete before activation: Document every important System's approved recovery time objective, recovery point objective, maximum tolerable downtime, dependencies, owner, and critical customer commitments.]"],
      ["For each important System, the applicable Control, Component, System, and Obligation records must identify:", "Supporting recovery documentation for each important System must identify:"],
      ["- Restore-validation method and governed schedule", "- Restore-validation method and approved schedule"],
      ["[Confirm or replace before activation: The starter proposal for important production data is a daily backup, 30-day retention period, and annual restore validation. Record the approved choice for every important System in its Control, Component, System, Retention Schedule, and Obligation records.]", "[Confirm or replace before activation: The proposed starting point for important production data is a daily backup, 30-day retention period, and annual restore validation. Document the approved choice for every important System in its recovery procedures and the Data Retention Schedule.]"],
      ["on the approved governed schedule", "on the approved schedule"]
    ],
    summary: "Express incident and recovery requirements as a standalone plan and keep FileGRC record-entry guidance outside it."
  },
  {
    id: "document-soc2-management-representation",
    path: "documents/document-soc2-management-representation.md",
    priorRevision: "59e7e5929eeb24fa6bc23e1ed1553206901c33ba249b372ad0f42282ab7a64c7",
    currentRevision: "83de736025d07d8085fba93a212a98e7b3e951aded9894b933eab1e77c3a0d29",
    replacements: [
      ["Signed letter evidence record: [Evidence ID]", "Signed letter reference: [Approved storage location or evidence reference]"]
    ],
    summary: "Keep the representation-letter template independent of FileGRC relationship fields."
  },
  {
    id: "document-soc2-period-completeness",
    path: "documents/document-soc2-period-completeness.md",
    priorRevision: "fffe936b701bfab19d1b2037b98bf3a82e2328a124926d714b7ac3a2df952391",
    currentRevision: "139bb7452fb7a0d6bf63564b43de01fe676a9bacfd5a5b2d639e8eaa24e65b60",
    replacements: [
      ["Management reconciled every audit-population record linked to this engagement to its authoritative source and included every item relevant to the in-scope system and controls. The generated `population-index.csv` is incorporated into this statement by reference and records each population ID, source system, query, timezone, count, validation, reviewer, conclusion, and fixed export.", "Management reconciled every population used for this engagement to its authoritative source and included every item relevant to the in-scope system and controls. The accompanying `population-index.csv` is incorporated into this statement by reference and records each population reference, source system, query, timezone, count, validation, reviewer, conclusion, and fixed export."],
      ["| Population | filegrc population ID | Result or exception |", "| Population | Population reference | Result or exception |"],
      ["For a population with zero items, retain the source-Component export or report that produced the zero count.", "For a population with zero items, retain the authoritative-source export or report that produced the zero count."],
      ["filegrc and the linked evidence contain the complete populations", "management's records and linked evidence contain the complete populations"]
    ],
    summary: "Make management's completeness statement independent of FileGRC record names."
  },
  {
    id: "document-soc2-system-description",
    path: "documents/document-soc2-system-description.md",
    priorRevision: "dc15bc2141be0d63a832eb6f7734bc7381e77582030534bcaf636138782f8e84",
    currentRevision: "929a7cd87ca78a2d9caa349cad0ae23583ad79184f26ba50c1694c62549aab9e",
    replacements: [
      ["reconcile it to the filegrc records", "reconcile it to management's authoritative records"],
      ["Link the filegrc commitment records.", "Reconcile the summary to supporting commitment records."],
      ["Reference the selected criteria and control matrix generated by filegrc.", "Reference the selected criteria and management's control matrix."]
    ],
    summary: "Keep the SOC 2 System Description as a generic management deliverable."
  }
];
const PRIOR_STARTER_POLICY_REVISIONS = new Set([
  "b0f9b988a8bd231fe70ce71b6a732970e709b7af7826c1b55f1532f511b6e511",
  "e87961c6a665d73e9d3cce96ab978df87579668e72ea236248680db1f69a5fa1",
  "2b50c75f4f138eebc7154a6b6e0e50b843f016c228632f7c71239ec27c18cbbf",
  "18f5e7b7e417b494a5cd241751269b3aafeb3ad9129002308c84c1c84419ee31",
  "432ba5797c2d23e02a6b09d07f1a33db29337b4bcb3ee7d68ce8495dc7c7c01c",
  "6775e6907c2a094c5f48090b12af14cb78b20d1e45178cbb5d3bf02cabde59c6",
  "992ef090273ae9bd25e729fe4a7a20817926f345cf7a01f242b877f319c4e342"
]);

const CONTROL_UPDATES = [
  {
    id: "control-policy-management",
    prior: [{
      title: "Policy management",
      statement: "The policy owner reviews governed policies and plans at least annually and after material changes, obtains approval from a separate independent approver, and retains the approved revisions in Git.",
      activity: "Review, approve, communicate, and version policies and plans.",
      requirementIds: ["requirement-soc2-cc5-1", "requirement-soc2-cc5-2", "requirement-soc2-cc5-3"]
    }],
    next: {
      title: "Control and policy management",
      statement: "Management selects and develops manual and technology Controls from approved objectives, commitments, risks, dependencies, and changes, and records each Control's owner, scope, procedure, operation pattern, evidence source, and implementation status. The policy owner reviews Controls, governed policies, and plans at least annually and after material changes, obtains separate approval for governed content, and retains approved revisions in Git.",
      activity: "Review Control design and evidence paths, correct gaps or approve time-bound Exceptions, and review, approve, communicate, and version governed policies and plans.",
      requirementIds: ["requirement-soc2-cc5-1", "requirement-soc2-cc5-2", "requirement-soc2-cc5-3"]
    },
    summary: "Make risk-based manual and technology Control design, evidence paths, and periodic reassessment testable under CC5.1 and CC5.2."
  },
  {
    id: "control-security-communication",
    prior: [{
      title: "Security communication",
      statement: "The organization communicates security responsibilities, approved reporting routes, material changes, and relevant control information to its workforce and outside parties.",
      activity: "Maintain reporting routes and communicate policies, changes, and security information."
    }],
    next: {
      title: "Security information and communication",
      statement: "Management obtains or generates, checks, and uses relevant and reliable information from internal and external sources to operate Controls, and communicates security responsibilities, approved reporting routes, material changes, and relevant Control information to its workforce and outside parties in time for action.",
      activity: "Record material information sources, scope, period, ownership, and known limits; maintain reporting routes; and communicate policies, changes, and security information."
    },
    summary: "Cover the information-quality and timely communication outcomes in CC2.1 through CC2.3."
  },
  {
    id: "control-workforce-expectations",
    prior: [
      {
        statement: "Workers agree to applicable conduct, confidentiality, acceptable-use, and security responsibilities before receiving access and are held accountable for violations.",
        activity: "Complete screening when appropriate, agreements, policy acknowledgement, and corrective action.",
        requirementIds: ["requirement-soc2-cc1-4"],
        operationPattern: "event-driven"
      },
      {
        statement: "Workers are screened before sensitive access when lawful and appropriate to role risk, have the competence needed for assigned duties, agree to applicable conduct, confidentiality, acceptable-use, intellectual-property, and security responsibilities before receiving access, and are held accountable for violations.",
        activity: "Record the role-based screening decision, confirm competence and authority, complete agreements and policy acknowledgement, and take corrective action when needed.",
        requirementIds: ["requirement-soc2-cc1-4"],
        operationPattern: "event-driven"
      }
    ],
    next: {
      statement: "Workers are screened before sensitive access when lawful and appropriate to role risk, have the competence needed for assigned duties, agree to applicable conduct, confidentiality, acceptable-use, intellectual-property, and security responsibilities before receiving access, and are held accountable for violations.",
      activity: "Record the role-based screening decision, confirm competence and authority, complete agreements and policy acknowledgement, and take corrective action when needed.",
      requirementIds: ["requirement-soc2-cc1-4", "requirement-soc2-cc1-5"],
      operationPattern: "mixed"
    },
    summary: "Add lawful, risk-based screening and workforce competence, map individual accountability, and support event and scheduled reviews without mandating a particular background-check product."
  },
  {
    id: "control-risk-assessment",
    prior: [{
      statement: "The organization assesses information security risk at least annually and after material changes, assigns owners and responses, and reviews high and critical risks at least quarterly.",
      activity: "Identify threats and changes, score risk, select treatment, and track review dates."
    }],
    next: {
      statement: "The organization defines security objectives and risk tolerance, assesses information security, fraud, misconduct, dependency, and change risk at least annually and after material changes, assigns owners and responses, and reviews high and critical risks at least quarterly.",
      activity: "Confirm objectives and risk tolerance, identify internal and external threats, fraud and misconduct scenarios, dependencies, and changes, score risk, select treatment, and track review dates."
    },
    summary: "Make objectives, risk tolerance, fraud, misconduct, dependencies, and material change explicit in the risk assessment."
  },
  {
    id: "control-monitoring-remediation",
    prior: [{
      statement: "Management reviews control operation, incidents, test results, exceptions, and findings, then assigns and tracks corrective work through completion.",
      activity: "Review control evidence and track deficiencies, owners, due dates, and verification."
    }],
    next: {
      statement: "Management reviews Control operation, source information, incidents, test results, Exceptions, and findings at least quarterly and after significant failures, then communicates deficiencies and assigns, tracks, and verifies corrective work through completion.",
      activity: "Review control evidence and track deficiencies, owners, due dates, and verification."
    },
    summary: "Set a testable monitoring cadence and require timely deficiency communication and verified correction."
  },
  {
    id: "control-strong-authentication",
    prior: [
      {
        statement: "Important systems use approved authentication settings, protected unique credentials, and multi-factor authentication for administrative, production, source-control, email, identity, and sensitive-data access when supported.",
        activity: "Configure and monitor authentication, credential storage, and privileged roles."
      },
      {
        statement: "Important Systems use approved strong-authentication settings, unique identities, and protected credentials. Multi-factor authentication is required for workforce and administrative access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data. Customer and external-user authentication requirements follow approved Controls, customer commitments, and risk decisions.",
        activity: "Configure and monitor authentication, credential storage, and privileged roles."
      },
      {
        statement: "Important Systems use approved strong-authentication settings, unique identities, protected credentials, changed or disabled default credentials, and separate administrative identities or roles when technically supported and appropriate to risk. Multi-factor authentication is required for workforce and administrative access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data. Customer and external-user authentication requirements follow approved Controls, customer commitments, and risk decisions.",
        activity: "Configure and monitor authentication, credential and recovery-material protection, default credentials, privileged identities or roles, and customer requirements."
      }
    ],
    next: {
      statement: "Important Systems use approved strong-authentication settings, unique identities, protected credentials, changed or disabled default credentials, and separate administrative identities or roles when technically supported and appropriate to risk. Multi-factor authentication is required for workforce and administrative access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data. Customer and external-user authentication requirements follow approved Controls, customer commitments, and risk decisions. Where required MFA is unavailable, management approves a time-bound Exception with a risk assessment, compensating Controls, an accountable owner, and a review or expiration date.",
      activity: "Configure and monitor authentication, credential and recovery-material protection, default credentials, privileged identities or roles, customer requirements, and approved MFA Exceptions."
    },
    summary: "Keep the scoped MFA commitment and its time-bound exception path, and add default-credential, recovery-material, and privileged-identity safeguards."
  },
  {
    id: "control-encryption-transmission",
    prior: [{
      statement: "Confidential and Restricted data is encrypted in transit over untrusted networks and at rest in approved systems and on devices, with protected key access.",
      activity: "Configure encryption and approved transfer methods based on classification."
    }],
    next: {
      statement: "Confidential and Restricted data is encrypted in transit over untrusted networks and at rest in approved Systems and on devices, with named key ownership, protected key access, and risk-based key lifecycle controls.",
      activity: "Configure encryption and approved transfer methods based on classification, and control key generation, storage, distribution, rotation, revocation, and recovery as applicable."
    },
    summary: "Add vendor-neutral ownership and lifecycle outcomes for cryptographic keys."
  },
  {
    id: "control-inventory-configuration",
    prior: [{
      statement: "The organization maintains inventories of important systems, company and approved personal devices, service accounts, vendors, and data stores, with owners, lifecycle state, and secure configuration expectations.",
      activity: "Maintain inventories, baselines, ownership, classification, and approved deviations."
    }],
    next: {
      statement: "The organization maintains inventories of important Systems, Components, company and approved personal devices, software, service accounts, Vendors, and data stores, with owners, lifecycle state, and secure configuration expectations. Unsupported or unneeded important assets are upgraded, isolated, replaced, or retired according to risk.",
      activity: "Maintain inventories, baselines, ownership, classification, lifecycle decisions, secure retirement, and approved deviations."
    },
    summary: "Add Component and software inventory coverage plus risk-based handling of unsupported and retired assets."
  },
  {
    id: "control-network-security",
    prior: [{
      statement: "The organization restricts network paths, protects remote access with approved encryption and authentication, and reviews material network access rules at least annually.",
      activity: "Manage boundaries, firewall rules, wireless safeguards, and remote production access."
    }],
    next: {
      statement: "The organization restricts network paths, separates production and nonproduction environments according to data and risk, protects remote access with approved encryption and authentication, and reviews material network access rules at least annually.",
      activity: "Manage boundaries, environment connections, firewall rules, wireless safeguards, and remote production access."
    },
    summary: "Add risk-based production and nonproduction environment separation."
  },
  {
    id: "control-change-management",
    prior: [
      {
        statement: "Material software and infrastructure changes are recorded, tested, approved, deployed through an authorized process, and recoverable. Review is independent when practical; a small team records a risk-appropriate compensating or post-deployment review, or an approved Exception, when independent pre-deployment review is not possible.",
        activity: "Record the reason, author, risk, reviewer or compensating review, test result, deployment, and rollback method.",
        operationPattern: "event-driven"
      },
      {
        statement: "Material software and infrastructure changes are recorded, receive a security design or threat analysis suited to their risk, are tested, approved, deployed through an authorized process, and are recoverable. Review is independent when practical; a small team records a risk-appropriate compensating or post-deployment review, or an approved Exception, when independent pre-deployment review is not possible.",
        activity: "Record the reason, author, risk, security analysis when applicable, reviewer or compensating review, test result, deployment, communication, and rollback method.",
        operationPattern: "event-driven"
      }
    ],
    next: {
      statement: "Source and deployment paths protect against unauthorized changes and malicious software. Material software and infrastructure changes are recorded, receive a security design or threat analysis suited to their risk, are tested, approved, deployed through an authorized process, and are recoverable. Review is independent when practical; a small team records a risk-appropriate compensating or post-deployment review, or an approved Exception, when independent pre-deployment review is not possible.",
      activity: "Record the reason, author, risk, security analysis when applicable, reviewer or compensating review, test result, deployment, communication, and rollback method.",
      operationPattern: "mixed"
    },
    summary: "Add risk-based security analysis and protection against unauthorized source and deployment changes."
  },
  {
    id: "control-penetration-testing",
    prior: [{
      activity: "Define scope, perform independent testing, review results, and track findings."
    }],
    next: {
      activity: "Review and record applicability and cadence. When testing is required, define its scope and independence, perform the test, review results, and track findings."
    },
    summary: "Keep penetration-testing execution conditional on the approved applicability and cadence decision."
  },
  {
    id: "control-data-retention-disposal",
    prior: [{ operationPattern: "event-driven" }],
    next: { operationPattern: "mixed" },
    summary: "Match the annual retention-schedule review and event-driven disposal activities."
  },
  {
    id: "control-endpoint-protection",
    prior: [
      {
        activity: "Use continuous platform protection where supported and verify endpoint configuration, update, and compliance state on the risk-based schedule recorded in an Obligation when periodic work is needed.",
        requirementIds: ["requirement-soc2-cc6-6", "requirement-soc2-cc7-1"]
      },
      {
        activity: "Use continuous platform protection where supported and verify endpoint configuration, update, and compliance state on the risk-based schedule recorded in an Obligation when periodic work is needed.",
        requirementIds: ["requirement-soc2-cc6-6", "requirement-soc2-cc6-8", "requirement-soc2-cc7-1"]
      }
    ],
    next: {
      activity: "Use continuous platform protection where supported and verify endpoint configuration, update, and compliance state on the approved risk-based schedule when periodic work is needed.",
      requirementIds: ["requirement-soc2-cc6-6", "requirement-soc2-cc6-8", "requirement-soc2-cc7-1"]
    },
    summary: "Map endpoint malware protection to CC6.8 and keep implementation scheduling out of the Control description."
  },
  {
    id: "control-vulnerability-management",
    prior: [{
      activity: "Choose scan coverage and cadence. Review the starter remediation targets of Critical 7 days, High 14 days, Medium 30 days, and Low 90 days, then record the approved targets or time-bound Exceptions."
    }],
    next: {
      activity: "Choose scan coverage and cadence, define approved risk-based remediation targets, and document time-bound Exceptions when a target cannot be met."
    },
    summary: "Keep starter-selection instructions and unapproved remediation targets out of the Control description."
  },
  {
    id: "control-logging-monitoring",
    prior: [{
      statement: "Important systems record and protect security and operational events, retain them according to the approved Data Retention Schedule, and use risk-based alerting, review, and alert-path testing recorded in the applicable Controls and Obligations.",
      activity: "Collect, protect, alert on, test, and review important log output and access."
    }],
    next: {
      statement: "Important Systems record and protect security and operational events, retain them according to the approved Data Retention Schedule, and use risk-based alerting, review, and alert-path testing. Systems with availability commitments, recovery objectives, or material operational dependencies also monitor the health, capacity, failure, and service indicators needed to detect degradation.",
      activity: "Collect, protect, alert on, test, and review important log output, access, and applicable health, capacity, failure, and service indicators."
    },
    summary: "Add conditional service-health and capacity monitoring without prescribing a monitoring product."
  },
  {
    id: "control-vendor-due-diligence",
    prior: [{
      statement: "New Vendors receive risk-based security and privacy review and suitable contractual safeguards before access to Confidential or Restricted data. Vendors that predate Policy adoption receive a documented transition review, deadline, or approved risk acceptance.",
      activity: "Assess service, data, access, assurance, recovery, incidents, and contract terms before access."
    }],
    next: {
      statement: "New Vendors receive risk-based security and privacy review and suitable contractual safeguards before access to Confidential or Restricted data or material reliance by an important service. Applicable contracts address permitted use and confidentiality, security responsibilities, incident notice, access and subprocessor restrictions, continuity, data return or deletion, termination, and assurance rights. Vendors that predate Policy adoption receive a documented transition review, deadline, or approved risk acceptance.",
      activity: "Assess service, data, access, assurance, recovery, incidents, dependencies, supplied Components, and applicable contract safeguards before access or material reliance."
    },
    summary: "Name the contract outcomes considered when a Vendor handles protected data or supports an important service."
  }
];

const OBLIGATION_UPDATES = [
  {
    id: "obligation-quarterly-security-risk-meeting",
    prior: [{ controlIds: ["control-security-governance"] }],
    next: {
      controlIds: [
        "control-security-governance",
        "control-security-communication",
        "control-monitoring-remediation"
      ]
    },
    summary: "Use the quarterly oversight population for governance, information quality, and Control monitoring."
  },
  {
    id: "obligation-annual-policy-review",
    prior: [{ controlIds: ["control-policy-management"] }],
    next: { controlIds: ["control-policy-management", "control-data-retention-disposal"] },
    summary: "Tie the annual Retention Schedule review to the Data Retention and Disposal Control."
  },
  {
    id: "obligation-annual-penetration-test",
    prior: [{
      title: "Annual independent penetration test",
      activityType: "penetration-test"
    }],
    next: {
      title: "Annual penetration-testing applicability and cadence review",
      activityType: "risk-assessment"
    },
    summary: "Review penetration-testing applicability annually without asserting that every service requires an annual test."
  }
];

const OBLIGATION_ADDITIONS = [
  {
    id: "obligation-annual-control-design-review",
    copyFrom: "obligation-annual-policy-review",
    title: "Annual Control design and evidence-path review",
    activityType: "control-design-review",
    controlIds: ["control-policy-management", "control-monitoring-remediation"]
  },
  {
    id: "obligation-annual-workforce-competence-review",
    copyFrom: "obligation-annual-security-training",
    title: "Annual workforce security-role competence review",
    activityType: "performance-review",
    controlIds: ["control-workforce-expectations"]
  },
  {
    id: "obligation-worker-start-screening",
    copyFrom: "obligation-worker-start-agreements",
    title: "Record the role-based screening and competence decision before sensitive access",
    activityType: "workforce-review",
    controlIds: ["control-workforce-expectations"]
  },
  {
    id: "obligation-worker-role-change-training",
    copyFrom: "obligation-worker-role-change-access",
    title: "Assign and complete applicable role-based security training",
    activityType: "role-training",
    window: { precision: "date", startsAfter: 0, dueAfter: 30 },
    controlIds: ["control-workforce-expectations", "control-security-training"]
  }
];

export async function assessPolicyLibraryUpgrades(input = process.cwd()) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  return (await buildPolicyLibraryPlan(loaded)).assessment;
}

export async function applyPolicyLibraryUpgrade(input = process.cwd(), proposalId, options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Review the policy-library diff and explicitly confirm the accepted proposal.");
  }
  if (proposalId !== INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID) {
    throw new Error(`Policy-library proposal "${proposalId || ""}" was not found.`);
  }
  return serializeWorkspaceMutation(input, async (root) => {
    const loaded = await loadWorkspace(root);
    const plan = await buildPolicyLibraryPlan(loaded);
    const proposal = plan.assessment.proposals.find(({ id }) => id === proposalId);
    if (!proposal) {
      throw new Error(`Policy-library proposal "${proposalId}" is no longer available. Review the current workspace before trying again.`);
    }
    if (!options.proposalRevision || options.proposalRevision !== proposal.revision) {
      throw new Error("The policy-library proposal changed or its revision was not confirmed. Review the current diff and accept its exact proposal revision.");
    }
    const result = await applyResourceBatch(root, plan.changes);
    return {
      operation: "policy-library-upgrade",
      acceptedProposalId: proposalId,
      changedPaths: proposal.changes.map(({ path }) => path),
      result: {
        createdResourceIds: result.created.map(({ id }) => id),
        updatedResourceIds: result.updated.map(({ id }) => id),
        validation: result.validation ? {
          ok: result.validation.ok,
          diagnostics: result.validation.diagnostics,
          counts: result.validation.counts
        } : null
      },
      assessment: await assessPolicyLibraryUpgrades(root)
    };
  });
}

async function buildPolicyLibraryPlan(loaded) {
  const byId = new Map(loaded.entries.map((entry) => [entry.record.id, entry]));
  const proposalChanges = [];
  const skipped = [];
  const creates = [];
  const updates = [];
  const expectedRevisions = {};
  const contentUpdates = {};
  const expectedContentRevisions = {};
  const libraryPolicy = await readFile(new URL("./policy-library/information-security-policy-v2.md", import.meta.url), "utf8");
  const latestPolicyRevision = normalizedPolicyRevision(libraryPolicy);

  const policyEntry = byId.get(POLICY_ID);
  if (!policyEntry || policyEntry.record.type !== "policy") {
    skipped.push(skippedItem(POLICY_ID, "missing", "The starter Information Security Policy is not present."));
  } else {
    const source = await readPolicySource(loaded);
    const sourceRevision = normalizedPolicyRevision(source, loaded.workspace?.organizationName);
    let recognizedStarter = false;
    if (["approved", "active", "superseded", "retired"].includes(policyEntry.record.status)) {
      skipped.push(skippedItem(POLICY_ID, "adopted", "Approved, active, superseded, and retired Policy content is never changed by a starter-library proposal."));
    } else if (sourceRevision === latestPolicyRevision) {
      recognizedStarter = true;
      skipped.push(skippedItem(POLICY_ID, "current", "The Information Security Policy already contains the current starter language."));
    } else if (!PRIOR_STARTER_POLICY_REVISIONS.has(sourceRevision)) {
      skipped.push(skippedItem(POLICY_ID, "customized", "The Information Security Policy differs from a recognized prior starter, so FileGRC will not rewrite it."));
    } else {
      recognizedStarter = true;
      const nextSource = materializePolicy(libraryPolicy, loaded.workspace?.organizationName, securityContactFromPolicy(source));
      proposalChanges.push({
        resourceType: "policy",
        resourceId: POLICY_ID,
        path: POLICY_DISPLAY_PATH,
        summary: "Replace unchanged prior starter language with the current standalone, risk-based security requirements.",
        diff: fullReplacementDiff(POLICY_DISPLAY_PATH, source, nextSource)
      });
      contentUpdates[POLICY_ID] = { content: nextSource };
      expectedContentRevisions[POLICY_ID] = {
        [POLICY_CONTENT_PATH]: contentRevision(source)
      };
    }
    if (recognizedStarter) {
      const currentAudience = policyEntry.record.audience || [];
      const nextAudience = ["employees", "contractors"];
      if (sameValue(currentAudience, ["employees", "contractors", "vendors"])) {
        updates.push({ ...policyEntry.record, audience: nextAudience });
        expectedRevisions[POLICY_ID] = policyEntry.revision;
        const displayPath = "data/policies/policy-information-security.json";
        proposalChanges.push({
          resourceType: "policy",
          resourceId: POLICY_ID,
          path: displayPath,
          summary: "Keep workforce acknowledgement separate from Vendor contract and oversight duties.",
          diff: replacementDiff(displayPath, [["audience", currentAudience, nextAudience]])
        });
      } else if (!sameValue(currentAudience, nextAudience)) {
        skipped.push(skippedItem(POLICY_ID, "customized", "The Policy audience differs from a recognized starter, so FileGRC will not rewrite it."));
      }
    }
  }

  const trainingEntry = byId.get(TRAINING_ID);
  if (!trainingEntry || trainingEntry.record.type !== "training") {
    skipped.push(skippedItem(TRAINING_ID, "missing", "The starter Security Awareness Training is not present."));
  } else {
    const source = await readResourceSource(loaded, TRAINING_CONTENT_PATH);
    const rawSourceRevision = contentRevision(source);
    const sourceRevision = normalizedTrainingRevision(source, loaded.workspace?.organizationName);
    if (["active", "retired"].includes(trainingEntry.record.status)) {
      skipped.push(skippedItem(TRAINING_ID, "adopted", "Active and retired Training content is never changed by a starter-library proposal."));
    } else if (sourceRevision === CURRENT_TRAINING_REVISION) {
      skipped.push(skippedItem(TRAINING_ID, "current", "The Security Awareness Training already contains the current starter language."));
    } else if (!PRIOR_TRAINING_REVISIONS.has(sourceRevision)) {
      skipped.push(skippedItem(TRAINING_ID, "customized", "The Security Awareness Training differs from the recognized prior starter, so FileGRC will not rewrite it."));
    } else {
      const nextSource = source
        .replace(PRIOR_PASSWORD_MANAGER_TRAINING, CURRENT_CREDENTIAL_STORAGE_TRAINING)
        .replace(PRIOR_REMOTE_MFA_TRAINING, CURRENT_REMOTE_MFA_TRAINING)
        .replace(PRIOR_SECRET_HANDLING_TRAINING, CURRENT_SECRET_HANDLING_TRAINING)
        .replace(LEGACY_REPOSITORY_SECRET_TRAINING, CURRENT_REPOSITORY_SECRET_TRAINING)
        .replace(PRIOR_REPOSITORY_SECRET_TRAINING, CURRENT_REPOSITORY_SECRET_TRAINING)
        .replace(PRIOR_SOURCE_SECRET_TRAINING, CURRENT_SOURCE_SECRET_TRAINING)
        .replace(PRIOR_ENDPOINT_SETTING_TRAINING, CURRENT_ENDPOINT_SETTING_TRAINING)
        .replace(PRIOR_CONFIGURATION_RECORD_TRAINING, CURRENT_CONFIGURATION_DOCUMENTATION_TRAINING);
      proposalChanges.push({
        resourceType: "training",
        resourceId: TRAINING_ID,
        path: TRAINING_DISPLAY_PATH,
        summary: "Keep credential storage vendor-neutral, align MFA with approved requirements, permit controlled source ciphertext, and remove FileGRC record-entry instructions from workforce training.",
        diff: fullReplacementDiff(TRAINING_DISPLAY_PATH, source, nextSource)
      });
      contentUpdates[TRAINING_ID] = { content: nextSource };
      expectedContentRevisions[TRAINING_ID] = {
        [TRAINING_CONTENT_PATH]: rawSourceRevision
      };
    }
  }

  for (const documentUpdate of DOCUMENT_CONTENT_UPDATES) {
    const entry = byId.get(documentUpdate.id);
    const displayPath = `data/${documentUpdate.path}`;
    if (!entry || entry.record.type !== "document") {
      skipped.push(skippedItem(documentUpdate.id, "missing", `The starter ${documentUpdate.id} Document is not present.`));
      continue;
    }
    const source = await readResourceSource(loaded, documentUpdate.path);
    const rawSourceRevision = contentRevision(source);
    const sourceRevision = normalizedDocumentRevision(source, loaded.workspace?.organizationName);
    if (entry.record.status !== "draft") {
      skipped.push(skippedItem(documentUpdate.id, "adopted", "Only draft governed Document content is eligible for a starter-library proposal."));
      continue;
    }
    if (sourceRevision === documentUpdate.currentRevision) {
      skipped.push(skippedItem(documentUpdate.id, "current", "The governed Document already contains the current standalone starter language."));
      continue;
    }
    if (sourceRevision !== documentUpdate.priorRevision) {
      skipped.push(skippedItem(documentUpdate.id, "customized", "The governed Document differs from the recognized prior starter, so FileGRC will not rewrite it."));
      continue;
    }
    const nextSource = documentUpdate.replacements.reduce(
      (current, [prior, next]) => current.replace(prior, next),
      source
    );
    if (normalizedDocumentRevision(nextSource, loaded.workspace?.organizationName) !== documentUpdate.currentRevision) {
      throw new Error(`The ${documentUpdate.id} starter update does not produce the current governed Document.`);
    }
    proposalChanges.push({
      resourceType: "document",
      resourceId: documentUpdate.id,
      path: displayPath,
      summary: documentUpdate.summary,
      diff: fullReplacementDiff(displayPath, source, nextSource)
    });
    contentUpdates[documentUpdate.id] = { content: nextSource };
    expectedContentRevisions[documentUpdate.id] = {
      [documentUpdate.path]: rawSourceRevision
    };
  }

  for (const controlUpdate of CONTROL_UPDATES) {
    const controlEntry = byId.get(controlUpdate.id);
    const displayPath = `data/controls/${controlUpdate.id}.json`;
    if (!controlEntry || controlEntry.record.type !== "control") {
      skipped.push(skippedItem(controlUpdate.id, "missing", `The starter ${controlUpdate.id} Control is not present.`));
      continue;
    }
    const currentValues = Object.fromEntries(
      Object.keys(controlUpdate.next).map((field) => [field, controlEntry.record[field]])
    );
    if (sameControlValues(currentValues, controlUpdate.next)) {
      skipped.push(skippedItem(controlUpdate.id, "current", "The Control already contains the current starter language."));
      continue;
    }
    if (controlEntry.record.status !== "planned") {
      skipped.push(skippedItem(controlUpdate.id, "operating", "Only planned Controls are eligible for starter-library text updates."));
      continue;
    }
    const prior = controlUpdate.prior.find((candidate) => sameControlValues(currentValues, candidate));
    if (!prior) {
      skipped.push(skippedItem(controlUpdate.id, "customized", "The Control statement or activity differs from a recognized prior starter, so FileGRC will not rewrite it."));
      continue;
    }
    updates.push({ ...controlEntry.record, ...controlUpdate.next });
    expectedRevisions[controlUpdate.id] = controlEntry.revision;
    proposalChanges.push({
      resourceType: "control",
      resourceId: controlUpdate.id,
      path: displayPath,
      summary: controlUpdate.summary,
      diff: replacementDiff(displayPath, Object.keys(controlUpdate.next)
        .filter((field) => !sameValue(prior[field], controlUpdate.next[field]))
        .map((field) => [field, prior[field], controlUpdate.next[field]]))
    });
  }

  for (const obligationUpdate of OBLIGATION_UPDATES) {
    const entry = byId.get(obligationUpdate.id);
    const displayPath = `data/obligations/${obligationUpdate.id}.json`;
    if (!entry || entry.record.type !== "obligation") {
      skipped.push(skippedItem(obligationUpdate.id, "missing", `The starter ${obligationUpdate.id} Obligation is not present.`));
      continue;
    }
    const currentValues = Object.fromEntries(
      Object.keys(obligationUpdate.next).map((field) => [field, entry.record[field]])
    );
    if (sameControlValues(currentValues, obligationUpdate.next)) {
      skipped.push(skippedItem(obligationUpdate.id, "current", "The Obligation already contains the current starter settings."));
      continue;
    }
    if (entry.record.status !== "proposed") {
      skipped.push(skippedItem(obligationUpdate.id, "operating", "Only proposed Obligations are eligible for starter-library updates."));
      continue;
    }
    const prior = obligationUpdate.prior.find((candidate) => sameControlValues(currentValues, candidate));
    if (!prior) {
      skipped.push(skippedItem(obligationUpdate.id, "customized", "The Obligation differs from a recognized prior starter, so FileGRC will not rewrite it."));
      continue;
    }
    updates.push({ ...entry.record, ...obligationUpdate.next });
    expectedRevisions[obligationUpdate.id] = entry.revision;
    proposalChanges.push({
      resourceType: "obligation",
      resourceId: obligationUpdate.id,
      path: displayPath,
      summary: obligationUpdate.summary,
      diff: replacementDiff(displayPath, Object.keys(obligationUpdate.next)
        .filter((field) => !sameValue(prior[field], obligationUpdate.next[field]))
        .map((field) => [field, prior[field], obligationUpdate.next[field]]))
    });
  }

  for (const addition of modelSupports(loaded.model, "program-scope") ? OBLIGATION_ADDITIONS : []) {
    if (byId.has(addition.id)) {
      skipped.push(skippedItem(addition.id, "present", "An Obligation with this ID already exists, so FileGRC will not replace it."));
      continue;
    }
    const source = byId.get(addition.copyFrom)?.record;
    if (!source || source.type !== "obligation" || source.status !== "proposed") {
      skipped.push(skippedItem(addition.id, "missing-basis", "The recognized proposed starter Obligation needed to derive this schedule is not available."));
      continue;
    }
    const record = {
      id: addition.id,
      type: "obligation",
      title: addition.title,
      status: "proposed",
      activityType: addition.activityType,
      recurrence: structuredClone(source.recurrence),
      ownerIds: [...(source.ownerIds || [])],
      startsOn: source.startsOn,
      ...(source.triggerPrompt ? { triggerPrompt: source.triggerPrompt } : {}),
      ...(addition.window || source.window ? { window: structuredClone(addition.window || source.window) } : {}),
      controlIds: [...addition.controlIds],
      policyIds: [...(source.policyIds || [])]
    };
    creates.push(record);
    const displayPath = `data/obligations/${addition.id}.json`;
    proposalChanges.push({
      resourceType: "obligation",
      resourceId: addition.id,
      path: displayPath,
      summary: `Add ${addition.title.toLowerCase()} as a reviewable proposed schedule.`,
      diff: fullReplacementDiff(displayPath, "", `${JSON.stringify(record, null, 2)}\n`)
    });
  }

  const proposals = proposalChanges.length ? [{
    id: INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID,
    revision: createHash("sha256").update(JSON.stringify(proposalChanges)).digest("hex"),
    title: "Review the SOC 2 Security starter corrections",
    policyIds: policyEntry ? [POLICY_ID] : [],
    status: "review",
    message: "Review the exact diff, then accept its named proposal and revision explicitly. FileGRC changes only recognized, unchanged starter defaults. It does not approve or activate the Policy, mark any Control implemented, or assert that an audit will pass.",
    changes: proposalChanges
  }] : [];
  return {
    assessment: {
      schemaVersion: 1,
      proposals,
      skipped
    },
    changes: {
      create: creates,
      update: updates,
      contentUpdates,
      expectedRevisions,
      expectedContentRevisions
    }
  };
}

async function readPolicySource(loaded) {
  return readResourceSource(loaded, POLICY_CONTENT_PATH);
}

async function readResourceSource(loaded, path) {
  try {
    return await readFile(resolveDataPath(loaded.root, path), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function normalizedPolicyRevision(source, organizationName) {
  let normalized = source.replaceAll("\r\n", "\n");
  if (organizationName) {
    normalized = normalized
      .replace(`for ${organizationName} and its in-scope services`, "for {{company_name}} and its in-scope services")
      .replaceAll(`\n${organizationName} inventories important Systems`, "\n{{company_name}} inventories important Systems")
      .replaceAll(`\n${organizationName} monitors trusted sources`, "\n{{company_name}} monitors trusted sources")
      .replace(`claims about facilities ${organizationName} does not operate`, "claims about facilities {{company_name}} does not operate");
  }
  normalized = normalized.replace(
    /through the primary route at [^\r\n]+ or the usable alternate route documented/,
    "through the primary route at {{security_contact_email}} or the usable alternate route documented"
  );
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizedTrainingRevision(source, organizationName) {
  let normalized = source.replaceAll("\r\n", "\n");
  if (organizationName) {
    normalized = normalized.replace(
      `This training applies to employees and contractors who use ${organizationName} systems or information.`,
      "This training applies to employees and contractors who use {{company_name}} systems or information."
    );
  }
  const securityContact = normalized.match(/Questions and incident reports should be sent to ([^\r\n]+)\./)?.[1];
  if (securityContact) normalized = normalized.replaceAll(securityContact, "{{security_contact_email}}");
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizedDocumentRevision(source, organizationName) {
  let normalized = source.replaceAll("\r\n", "\n");
  if (organizationName) {
    normalized = normalized
      .replace(`how long ${organizationName} keeps`, "how long {{company_name}} keeps")
      .replace(`affects ${organizationName} or an in-scope service`, "affects {{company_name}} or an in-scope service")
      .replace(`# ${organizationName} Management Representation Letter`, "# {{company_name}} Management Representation Letter")
      .replace(`# ${organizationName} Period Completeness Statement`, "# {{company_name}} Period Completeness Statement")
      .replace(`# ${organizationName} SOC 2 System Description`, "# {{company_name}} SOC 2 System Description");
  }
  normalized = normalized.replace(
    /The primary reporting route is [^\r\n]+\./,
    "The primary reporting route is {{security_contact_email}}."
  );
  return createHash("sha256").update(normalized).digest("hex");
}

function materializePolicy(source, organizationName, securityContact) {
  return source
    .replaceAll("{{company_name}}", organizationName || "Organization")
    .replaceAll("{{security_contact_email}}", securityContact || "security@example.com");
}

function securityContactFromPolicy(source) {
  return source.match(/through the primary route at ([^\r\n]+?) or the usable alternate route documented/)?.[1];
}

function sameControlValues(left, right) {
  return Object.keys(right).every((field) => sameValue(left[field], right[field]));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replacementDiff(path, replacements) {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    ...replacements.flatMap(([field, before, after]) => [
      `@@ ${field} @@`,
      `-${displayDiffValue(before)}`,
      `+${displayDiffValue(after)}`
    ])
  ].join("\n");
}

function displayDiffValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function fullReplacementDiff(path, before, after) {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ replace recognized starter content @@",
    ...before.replaceAll("\r\n", "\n").split("\n").map((line) => `-${line}`),
    ...after.replaceAll("\r\n", "\n").split("\n").map((line) => `+${line}`)
  ].join("\n");
}

function skippedItem(resourceId, reason, message) {
  return { resourceId, reason, message };
}
