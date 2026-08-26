import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import {
  applyPolicyLibraryUpgrade,
  assessPolicyLibraryUpgrades,
  INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID
} from "../src/index.js";
import { createFilegrc } from "../../create-filegrc/src/index.js";
import { executeCli, makeWorkspace, writeJson } from "./helpers.js";

const execute = (executable, args) => executeCli(runCli, executable, args);
const cli = fileURLToPath(new URL("../bin/filegrc.js", import.meta.url));
const latestStarterPolicy = fileURLToPath(new URL("../../create-filegrc/template/data/policies/policy-information-security.md", import.meta.url));
const libraryPolicy = fileURLToPath(new URL("../src/policy-library/information-security-policy-v2.md", import.meta.url));
const priorStarterPolicy = fileURLToPath(new URL("./fixtures/policy-information-security-v1.md", import.meta.url));
const policyPath = (...parts) => join(...parts, "data", "policies", "policy-information-security.md");
const trainingPath = (...parts) => join(...parts, "data", "training", "training-security-awareness.md");
const CURRENT_PASSWORD_TRAINING = "Use a unique password for each account and store it only through the credential-protection method approved for that System.";
const PRIOR_PASSWORD_TRAINING = "Use an approved password manager to generate and store a unique password for each account.";
const CURRENT_REMOTE_MFA_TRAINING = "Use approved remote-access methods and multi-factor authentication when the Policy, Control, customer commitment, or risk decision requires it.";
const PRIOR_REMOTE_MFA_TRAINING = "Use approved remote-access methods and multi-factor authentication.";
const CURRENT_SECRET_TRAINING = "Keep plaintext passwords, recovery codes, private keys, and authentication tokens out of email, chat, tickets, source code, and general-purpose documents. Approved source-controlled ciphertext must follow the Policy and keep decryption keys separate.";
const PRIOR_SECRET_TRAINING = "Keep passwords, recovery codes, private keys, and authentication tokens out of email, chat, tickets, source code, and general-purpose documents.";
const CURRENT_REPOSITORY_SECRET_TRAINING = "Do not put plaintext credentials, authentication tokens, or cryptographic keys in source repositories or general-purpose Systems. Approved source-controlled ciphertext must meet the Policy's separate-key, access, and rotation conditions.";
const PRIOR_REPOSITORY_SECRET_TRAINING = "Do not put plaintext credentials, authentication tokens, or cryptographic keys in this repository or another general-purpose System. Approved source-controlled ciphertext must meet the Policy's separate-key, access, and rotation conditions.";
const LEGACY_REPOSITORY_SECRET_TRAINING = "Do not put credentials, authentication tokens, or cryptographic keys in this repository or another general-purpose system.";
const CURRENT_SOURCE_SECRET_TRAINING = "Keep plaintext secrets out of source code, build output, tickets, chat, and logs. Repository access alone must never decrypt approved source-controlled ciphertext.";
const PRIOR_SOURCE_SECRET_TRAINING = "Keep secrets out of source code, build output, tickets, chat, and logs.";
const CURRENT_ENDPOINT_SETTING_TRAINING = "Company-managed devices must use the approved automatic-lock setting.";
const PRIOR_ENDPOINT_SETTING_TRAINING = "Company-managed devices use the automatic-lock setting recorded in the applicable Endpoint Control, Component, or System.";
const CURRENT_CONFIGURATION_DOCUMENTATION_TRAINING = "Approved supporting standards, procedures, and schedules document the tools, settings, approval paths, and evidence.";
const PRIOR_CONFIGURATION_RECORD_TRAINING = "The applicable Controls, Components, Systems, and governed schedules record the actual tools, settings, approval paths, and evidence.";
const CURRENT_POLICY_DEFINITIONS = `## Definitions

- **Worker:** An employee or contractor.
- **System:** An application, service, process, or infrastructure used to store or process information or support an in-scope service.
- **Component:** A technology, process, facility, or provider-supplied element within or supporting a System.
- **Control:** An administrative, technical, or physical safeguard.
- **Evidence:** Retained information that supports a security fact, decision, or activity.
- **Vendor:** An external party that provides a product or service.
- **Exception:** A management-approved, time-bound departure from a requirement.
- **Important System or Component:** A System or Component included in the approved service boundary or relied upon to meet a security objective, service commitment, recovery objective, Control, or Evidence need.
- **Approved:** Authorized by the accountable owner or management under the applicable governance process.

These definitions set the minimum scope. Management may classify additional assets as important based on risk.`;
const PRIOR_POLICY_DEFINITIONS = "In this Policy, a Worker is an employee or contractor. A System is an application, service, process, or infrastructure used to store or process information or support an in-scope service. A Component is a technology, process, facility, or provider-supplied element within or supporting a System. A Control is an administrative, technical, or physical safeguard. Evidence is retained information that supports a security fact, decision, or activity. A Vendor is an external party that provides a product or service. An Exception is a management-approved, time-bound departure from a requirement. An important System or Component is one included in the approved service boundary or relied upon to meet a security objective, service commitment, recovery objective, Control, or Evidence need. Approved means authorized by the accountable owner or management under the applicable governance process. These definitions set the minimum scope; management may classify additional assets as important based on risk.";
const CURRENT_POLICY_INDEX = [
  "## Consolidated policy index",
  "",
  "- **Governance and workforce:** Information Security Governance and Organization; Risk Management and Compliance; Personnel and Human Resources Security; Security Awareness and Training; Acceptable Use, Clear Desk, and Clear Screen.",
  "- **Assets, data, and access:** Asset Management; Data Classification, Handling, and Protection; Access Control; Identification, Authentication, and Password.",
  "- **Technology protection:** Cryptography, Encryption, Key, and Secrets Management; Endpoint, Mobile Device, BYOD, and Malware Protection; Remote Access and Remote Work; Physical and Environmental Security; Network and Communications Security; Configuration Management and System Maintenance.",
  "- **Engineering and security operations:** Secure Development and Change Management; Vulnerability, Patch, and Penetration Testing; Logging, Monitoring, and Audit Trail; Incident Response.",
  "- **Resilience and third parties:** Business Continuity and Disaster Recovery; Backup and Restoration; Vendor, Third-Party, and Supply Chain Risk Management; Exceptions, Compliance, Enforcement, and Policy Review.",
  "",
  ""
].join("\n");
const PRIOR_POLICY_INDEX_PARAGRAPH = "This is a consolidated policy. Its sections use security-policy names commonly requested in customer questionnaires and assurance reviews, including governance, risk management, personnel security, acceptable use, asset management, data protection, access control, authentication, cryptography, endpoint security, remote access, physical security, network security, configuration management, secure development, vulnerability management, logging and monitoring, incident response, continuity, backup, and Vendor risk management. A questionnaire response may cite this Policy and the applicable section, but it must reflect the organization's actual scope, implemented Controls, approved Exceptions, and available Evidence. A section title does not establish a separate document or prove that a Control operates.";
const CURRENT_POLICY_INDEX_PARAGRAPH = "This consolidated Policy uses security-policy names commonly requested in customer questionnaires and assurance reviews. A questionnaire response may cite this Policy and the applicable section, but it must reflect the organization's actual scope, implemented Controls, approved Exceptions, and available Evidence. A section title does not establish a separate document or prove that a Control operates.";
const CURRENT_POLICY_MFA_LIST = [
  "- **Workforce and administrative access:** MFA is required for access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data.",
  "- **Customer and external-user access:** MFA is required when an approved Control, customer commitment, or risk decision requires it.",
  "- **Exceptions:** Where required MFA is unavailable, management must approve a time-bound Exception with a risk assessment, compensating Controls, an accountable owner, and a review or expiration date."
].join("\n");
const CURRENT_POLICY_ROLE_LIST = [
  "- **Policy Owner:** Maintains this Policy, the risk program, Controls, approved supporting plans, Exceptions, and improvement work.",
  "- **System and process owners:** Approve access, maintain safeguards, keep inventories and recovery facts current, and resolve findings.",
  "- **Independent reviewer:** Remains separate from the Policy Owner, approves the Policy, and challenges management's assessment of Control operation."
].join("\n");
const PRIOR_POLICY_ROLE_PARAGRAPH = "The current Policy Owner maintains this Policy, the risk program, Controls, approved supporting plans, Exceptions, and improvement work. System and process owners approve access, maintain safeguards, keep inventories and recovery facts current, and resolve findings. An independent reviewer who is separate from the Policy Owner approves the Policy and challenges management's assessment of Control operation.";
const CURRENT_POLICY_KEY_LIST = `Encryption keys and other secrets require:

- **Ownership and access:** Named ownership and least-privilege access.
- **Generation and storage:** Protected generation and storage.
- **Distribution and use:** Controlled distribution and use.
- **Rotation and revocation:** Rotation or replacement based on risk and events, and revocation when access or trust ends.
- **Recovery:** Recoverability when loss would prevent an approved business or recovery process.`;
const PRIOR_POLICY_KEY_PARAGRAPH = "Encryption keys and other secrets require named ownership, least-privilege access, protected generation and storage, controlled distribution and use, rotation or replacement based on risk and events, revocation when access or trust ends, and recoverability when loss would prevent an approved business or recovery process.";
const CURRENT_POLICY_ACCOUNT_LIST = [
  "- **Privileged access:** Limited to approved duties and uses separate administrative identities or roles where technically supported and appropriate to risk.",
  "- **Shared accounts:** Require a documented technical need, named owner, restricted use, protected credentials, and logging.",
  "- **Service accounts:** Require a named owner, approved purpose, minimum permissions, protected credentials, lifecycle dates or review, and monitoring appropriate to risk."
].join("\n");
const PRIOR_POLICY_ACCOUNT_PARAGRAPH = "Privileged access is limited to approved duties and uses separate administrative identities or roles where technically supported and appropriate to risk. Shared accounts require a documented technical need, named owner, restricted use, protected credentials, and logging. Service accounts require a named owner, approved purpose, minimum permissions, protected credentials, lifecycle dates or review, and monitoring appropriate to risk.";
const CURRENT_POLICY_CONTRACT_LIST = `When applicable to the service and risk, contracts address:

- Permitted use and confidentiality.
- Security responsibilities and incident notice.
- Access and subprocessor restrictions.
- Continuity and data return or deletion.
- Termination.
- Assurance or audit rights.

Management does not require every term for every Vendor, but records omissions that create material risk or conflict with an approved commitment.`;
const PRIOR_POLICY_CONTRACT_PARAGRAPH = "When applicable to the service and risk, contracts address permitted use and confidentiality, security responsibilities, incident notice, access and subprocessor restrictions, continuity, data return or deletion, termination, and assurance or audit rights. Management does not require every term for every Vendor, but records omissions that create material risk or conflict with an approved commitment.";
const CURRENT_CONTINUITY_POLICY = "Each important System records recovery priorities, dependencies, responsible people, alternate communication and access needs, and a backup or alternate recovery approach suited to its commitments, business impact, data risk, dependencies, and technical capability. Numeric recovery targets are required only when an approved customer commitment, included Availability criterion, or management risk decision calls for them.";
const PRIOR_CONTINUITY_POLICY = "Each important System records approved recovery priorities and objectives, dependencies, responsible people, alternate communication and access needs, and a backup or alternate recovery approach. Management selects continuity strategies according to service commitments, business impact, data risk, dependencies, and technical capability.";
const CURRENT_BACKUP_POLICY = "Important Systems use backups or an approved alternate recovery approach suited to their recovery needs and any approved recovery targets.";
const PRIOR_BACKUP_POLICY = "Important Systems use backups or an approved alternate recovery approach that meets their recovery objectives.";
const CURRENT_RETENTION_SECTION = `## Schedule

The structured Retention Schedule Items linked to this document are its schedule rows. Each approved item must name the covered Information Types and operational scope, owner, cutoff, period, disposition action, instructions, and authority. Planned items are review prompts and are not approved retention behavior.

Management must cover important information used by Systems, Components, and Vendors, including security logs, backups or alternate recovery copies, governance records, audit evidence, customer and service records, and incident records when those classes exist. No starter period or disposition action is an approved organization value.`;
const PRIOR_RETENTION_SECTION = `## Schedule

| Record class | System or location | Owner | Trigger | Retention | End-of-period action | Authority or reason |
| --- | --- | --- | --- | --- | --- | --- |
| Security logs for important Systems | [Complete before approval: Systems or Components] | [Complete before approval: owner] | Log event | [Confirm or replace proposed default before approval: 12 months, adjusted for investigation, contract, legal, audit, and risk needs] | [Complete before approval: disposal action] | [Complete before approval: authority or reason] |
| Production backups or alternate recovery copies | [Complete before approval: Systems or Components] | [Complete before approval: owner] | Backup or recovery-copy creation | [Confirm or replace proposed default before approval: 30 days, adjusted to approved System recovery needs] | [Complete before approval: expiration or disposal action] | [Complete before approval: recovery need, commitment, or risk decision] |
| SOC 2 Policies, Control records, and audit Evidence | Git repository and approved Evidence locations | Policy owner | End of the relevant audit period | [Complete before approval based on audit, contract, and legal needs] | Archive or securely delete | Audit and business requirements |
| Customer and service records | [Complete before approval: Systems or Components] | [Complete before approval: owner] | [Complete before approval: trigger] | [Complete before approval: retention] | Delete or anonymize | Contract, law, and business need |
| Incident and investigation records | Approved incident and Evidence Systems | Incident owner | Incident closure | [Complete before approval: retention] | Archive or securely delete | Legal, insurance, contract, and security needs |

Add rows for each important data class in the System and Vendor inventories. A row is incomplete until it names the source System or Component, owner, trigger, period, disposal action, and authority. Remove each bracketed prompt only after replacing it with a reviewed fact.`;

function previousProductSpecificTraining(source) {
  return source
    .replace(CURRENT_REPOSITORY_SECRET_TRAINING, PRIOR_REPOSITORY_SECRET_TRAINING)
    .replace(CURRENT_ENDPOINT_SETTING_TRAINING, PRIOR_ENDPOINT_SETTING_TRAINING)
    .replace(CURRENT_CONFIGURATION_DOCUMENTATION_TRAINING, PRIOR_CONFIGURATION_RECORD_TRAINING);
}

const PRIOR_DOCUMENT_BOUNDARY_REPLACEMENTS = {
  "document-data-retention-schedule": {
    path: "document-data-retention-schedule.md",
    replacements: [
      [CURRENT_RETENTION_SECTION, PRIOR_RETENTION_SECTION],
      ["| Production backups or alternate recovery copies | [Complete before approval: Systems or Components] | [Complete before approval: owner] | Backup or recovery-copy creation | [Confirm or replace proposed default before approval: 30 days, adjusted to approved System recovery needs] | [Complete before approval: expiration or disposal action] | [Complete before approval: recovery need, commitment, or risk decision] |", "| Production backups or alternate recovery copies | [Complete before approval: Systems or Components] | [Complete before approval: owner] | Backup or recovery-copy creation | [Confirm or replace proposed default before approval: 30 days, adjusted to approved System recovery objectives] | [Complete before approval: expiration or disposal action] | [Complete before approval: continuity objective or risk decision] |"],
      ["Remove each bracketed prompt only after replacing it with a reviewed fact.", "FileGRC detects the bracketed prompts as approval blockers. Remove each prompt only after replacing it with a reviewed fact."],
      ["Record the authority, scope, owner, start date, and release decision in controlled legal-hold records.", "Record the authority, scope, owner, start date, and release decision outside this public template."]
    ]
  },
  "document-security-incident-recovery-plan": {
    path: "document-security-incident-recovery-plan.md",
    replacements: [
      ["Use the current approved primary security Reporting Route. If it is unavailable, use the current approved alternate Reporting Route. Those records are the source of truth for each channel, destination, owner, priority, and effective period.", "The primary reporting route is security@example.test."],
      ["[Complete before activation: Describe how workers can find the alternate Reporting Route when the primary email, identity, or collaboration System is unavailable, compromised, or involved in the concern. Do not copy the route destination here or include plaintext credentials, private keys, tokens, or recovery codes.]", "[Complete before activation: Name a usable alternate reporting route, its owner, protected location, and how workers can find it when the primary email, identity, or collaboration System is unavailable, compromised, or involved in the concern. Do not put plaintext credentials, private keys, tokens, or recovery codes in this plan.]"],
      ["[Complete before activation: Identify every important System's recovery priority, dependencies, owner, backup or alternate recovery approach, and critical customer commitments. Record numeric recovery targets only when an approved commitment, included Availability criterion, or risk decision requires them.]", "[Complete before activation: Document every important System's approved recovery time objective, recovery point objective, maximum tolerable downtime, dependencies, owner, and critical customer commitments.]"],
      ["- Dependencies, fallback paths, and validation steps\n- Any recovery targets required by an approved commitment, included Availability criterion, or risk decision", "- Dependencies, fallback paths, and validation steps"],
      ["Supporting procedures, system records, and retained evidence document the actual technical configuration and operation.", "Controls, Components, Systems, Obligations, and Evidence hold the actual technical configuration and proof of operation."],
      ["If an incident raises a legal, privacy, or insurance question, the incident lead obtains suitable advice at that time. A pre-arranged counsel relationship or standing legal retainer is required only when management determines that the organization's obligations and risk warrant one.", "If an incident raises a legal, privacy, or insurance question, the incident lead gets suitable advice at that time. FileGRC does not require pre-arranged counsel, in-house counsel, or a standing legal retainer."],
      ["[Complete before activation: Document every important System's approved recovery time objective, recovery point objective, maximum tolerable downtime, dependencies, owner, and critical customer commitments.]", "[Complete before activation: Link every important System and record its approved recovery time objective, recovery point objective, maximum tolerable downtime, dependencies, owner, and critical customer commitments in the System record.]"],
      ["Supporting recovery documentation for each important System must identify:", "For each important System, the applicable Control, Component, System, and Obligation records must identify:"],
      ["- Restore-validation method and approved schedule", "- Restore-validation method and governed schedule"],
      ["[Confirm or replace before activation: The proposed starting point for important production data is a daily backup, 30-day retention period, and annual restore validation. Document the approved choice for every important System in its recovery procedures and the Data Retention Schedule.]", "[Confirm or replace before activation: The starter proposal for important production data is a daily backup, 30-day retention period, and annual restore validation. Record the approved choice for every important System in its Control, Component, System, Retention Schedule, and Obligation records.]"],
      ["on the approved schedule", "on the approved governed schedule"]
    ]
  },
  "document-soc2-management-representation": {
    path: "document-soc2-management-representation.md",
    replacements: [["Signed letter reference: [Approved storage location or evidence reference]", "Signed letter evidence record: [Evidence ID]"]]
  },
  "document-soc2-period-completeness": {
    path: "document-soc2-period-completeness.md",
    replacements: [
      ["Management reconciled every population used for this engagement to its authoritative source and included every item relevant to the in-scope system and controls. The accompanying `population-index.csv` is incorporated into this statement by reference and records each population reference, source system, query, timezone, count, validation, reviewer, conclusion, and fixed export.", "Management reconciled every audit-population record linked to this engagement to its authoritative source and included every item relevant to the in-scope system and controls. The generated `population-index.csv` is incorporated into this statement by reference and records each population ID, source system, query, timezone, count, validation, reviewer, conclusion, and fixed export."],
      ["| Population | Population reference | Result or exception |", "| Population | filegrc population ID | Result or exception |"],
      ["For a population with zero items, retain the authoritative-source export or report that produced the zero count.", "For a population with zero items, retain the source-Component export or report that produced the zero count."],
      ["management's records and linked evidence contain the complete populations", "filegrc and the linked evidence contain the complete populations"]
    ]
  },
  "document-soc2-system-description": {
    path: "document-soc2-system-description.md",
    replacements: [
      ["reconcile it to management's authoritative records", "reconcile it to the filegrc records"],
      ["Reconcile the summary to supporting commitment records.", "Link the filegrc commitment records."],
      ["Reference the selected criteria and management's control matrix.", "Reference the selected criteria and control matrix generated by filegrc."]
    ]
  }
};

const PRIOR_PRODUCT_POLICY_REPLACEMENTS = [
  ["Controls, approved supporting plans, Exceptions", "Controls, governed plans, Exceptions"],
  ["Management reviews the security program on its approved schedule", "Management reviews the security program on its approved governed schedule"],
  ["review material access rules on the approved schedule.", "review material access rules on the governed schedule."],
  [
    "This is a consolidated policy. Its sections use security-policy names commonly requested in customer questionnaires and assurance reviews, including governance, risk management, personnel security, acceptable use, asset management, data protection, access control, authentication, cryptography, endpoint security, remote access, physical security, network security, configuration management, secure development, vulnerability management, logging and monitoring, incident response, continuity, backup, and Vendor risk management. A questionnaire response may cite this Policy and the applicable section, but it must reflect the organization's actual scope, implemented Controls, approved Exceptions, and available Evidence. A section title does not establish a separate document or prove that a Control operates.",
    "This is a consolidated policy. Its sections use security-policy names commonly requested in customer questionnaires and assurance reviews, including governance, risk management, personnel security, acceptable use, asset management, data protection, access control, authentication, cryptography, endpoint security, remote access, physical security, network security, configuration management, secure development, vulnerability management, logging and monitoring, incident response, continuity, backup, and Vendor risk management. A questionnaire response may cite this Policy and the applicable section. A section title does not establish a separate document, prove that a Control operates, or support an unverified claim. Confirm the linked Control, System, Component, Obligation, and Evidence before answering."
  ],
  [
    "This Policy establishes management requirements. Approval means the company accepts those requirements, which become effective only on the recorded effective date. Approval does not by itself demonstrate implementation or operation. Management documents supporting procedures, configurations, Control operation, and Evidence separately.",
    "A Policy says what the company commits to do by the date it takes effect. Approval means the company accepts those commitments. It does not prove the work is done. Controls and operating records describe how the company meets them and provide the proof. FileGRC does not infer technical implementation from this prose. Configuration facts belong in Controls, Components, Systems, governed schedules, and Evidence."
  ],
  [
    CURRENT_POLICY_DEFINITIONS,
    "In this Policy, a Worker is an employee or contractor. An important System or Component is one included in the approved service boundary or relied upon to meet a security objective, service commitment, recovery objective, Control, or Evidence need. Approved means recorded by the accountable owner or management through the applicable FileGRC record. These definitions set the minimum scope; management may classify additional assets as important based on risk."
  ],
  ["Management documents the participants, cadence, decisions, and follow-up for each review.", "The Security Governance Control and Obligations record the actual participants, cadence, decisions, and follow-up."],
  ["Management identifies security risks and applicable legal, regulatory, contractual, customer, and service commitments, then assigns responsibility through approved requirements, Controls, Systems, Vendor oversight, and governance records. Management obtains qualified legal or other professional advice when an obligation is uncertain.", "Management identifies security risks and applicable legal, regulatory, contractual, customer, and service commitments, then assigns responsibility through Requirements, Controls, Systems, Vendors, and governed records. FileGRC is not legal advice, so management obtains suitable advice when an obligation is uncertain."],
  ["Management documents the assessment method, cadence, decisions, and follow-up.", "The Risk Assessment Control and Obligations record the actual method and cadence."],
  ["Each Control has a documented owner, scope, procedure, operating pattern, Evidence source, implementation status, and review path. Management reviews Control design", "Each Control records an owner, scope, procedure, operation pattern, evidence source, implementation status, and review path. Management reviews the Control design"],
  ["Management documents approved timing, Evidence, and escalation requirements for onboarding, access changes, and offboarding in supporting procedures and schedules.", "The Workforce Expectations, Access Control, and Offboarding Controls and their event windows record approved timing, Evidence, and escalation rules."],
  ["Management documents the covered population, schedules, acknowledgements, completion, and Evidence in the training program records.", "The Security Training Control and Obligations record scope, schedules, acknowledgements, and Evidence."],
  ["The Data Retention Schedule defines the approved period and disposal method for important in-scope record classes. Supporting standards, procedures, and system records document implementation.", "The Data Retention Schedule records the approved period and disposal method for important in-scope record classes. Systems, Controls, and Components record the actual implementation."],
  ["documents selected methods and configurations in approved standards, procedures, or system records", "records actual configuration in the applicable Controls, Systems, and Components"],
  ["source files, tickets, chat, logs, policy records, audit records, or other general-purpose business records", "source files, tickets, chat, logs, or FileGRC records"],
  ["Management documents password length, composition, reuse, lockout, session, and recovery settings in approved authentication standards or System-specific procedures.", "Password length, composition, reuse, lockout, session, and recovery settings belong in the applicable Control, System, or Component rather than this Policy."],
  ["Management documents the continuous protections in use", "The Endpoint Protection Control describes the continuous protections in use"],
  ["Management documents remote-access configuration and session restrictions in approved standards, procedures, or System records.", "Remote access configuration and session restrictions belong in the applicable Network, Access, System, and Component records."],
  ["Management documents the selected coverage, targets, cadence, and review decisions.", "The applicable Controls and Obligations record those choices."],
  ["Owners document risk-based alerts, review paths, thresholds, and response ownership in approved standards, procedures, and schedules.", "Owners define risk-based alerts, review paths, thresholds, and response ownership in Controls, Components, Systems, and governed schedules."],
  ["Management documents backup or alternate-recovery scope, frequency, retention, encryption and access needs, monitoring, failure response, procedures, and test schedules.", "The applicable Controls, Components, Systems, Retention Schedule, and Obligations record scope, frequency, retention, encryption and access needs, monitoring, failure response, procedures, and test schedules."],
  ["Management documents Vendor monitoring cadence and change-driven reassessment windows in approved Vendor-management procedures and schedules.", "Vendor monitoring cadence and change-driven reassessment windows belong in the Vendor Controls and Obligations."],
  ["The Policy Owner reviews this Policy on the approved schedule", "The Policy Owner reviews this Policy on the approved governed schedule"],
  ["The organization retains the reviewed Policy version, approval, effective date, and change history under its document-control process.", "Git history and FileGRC records preserve the reviewed content, approval, activation, and later changes."]
];

function previousProductSpecificPolicy(source) {
  return PRIOR_PRODUCT_POLICY_REPLACEMENTS.reduce((current, [next, prior]) => {
    assert.ok(current.includes(next), `current Policy source is missing expected text: ${next}`);
    return current.replace(next, prior);
  }, previousPolicyFormatting(source));
}

function previousPolicyFormatting(source) {
  return previousPolicyDetailLists(source)
    .replace("## Purpose and scope", "## Purpose, scope, and consolidated policy index")
    .replace(CURRENT_POLICY_INDEX_PARAGRAPH, PRIOR_POLICY_INDEX_PARAGRAPH)
    .replace(CURRENT_POLICY_INDEX, "")
    .replace(/^### .+\n\n/gm, "")
    .replace(CURRENT_POLICY_MFA_LIST, INTERIM_MFA);
}

function previousPolicyDetailLists(source) {
  return source
    .replace(CURRENT_CONTINUITY_POLICY, PRIOR_CONTINUITY_POLICY)
    .replace(CURRENT_BACKUP_POLICY, PRIOR_BACKUP_POLICY)
    .replace(CURRENT_POLICY_ROLE_LIST, PRIOR_POLICY_ROLE_PARAGRAPH)
    .replace(CURRENT_POLICY_KEY_LIST, PRIOR_POLICY_KEY_PARAGRAPH)
    .replace(CURRENT_POLICY_ACCOUNT_LIST, PRIOR_POLICY_ACCOUNT_PARAGRAPH)
    .replace(CURRENT_POLICY_CONTRACT_LIST, PRIOR_POLICY_CONTRACT_PARAGRAPH);
}

const OLD_SECRETS = "Confidential and Restricted data must use approved Systems, encryption in transit over untrusted networks, encryption at rest, least-privilege access, and protected transfer methods. Credentials, private keys, tokens, and recovery codes belong in approved secrets-management Systems and must not appear in source files, tickets, chat, logs, or FileGRC records.";
const INTERIM_SECRETS = "Confidential and Restricted data must use approved Systems, encryption in transit over untrusted networks, encryption at rest, least-privilege access, and protected transfer methods. Plaintext credentials, private keys, tokens, and recovery codes must not appear in source files, tickets, chat, logs, or FileGRC records. Source-controlled ciphertext may be used when management approves the encryption method, decryption keys are stored separately in an approved secrets-management System, repository access alone cannot decrypt the material, and access and rotation are controlled.";
const OLD_MFA = "Multi-factor authentication is required for administrative, production, source-control, email, identity, and Confidential or Restricted data access. When a System cannot support MFA, management must approve a time-bound Exception with risk assessment, compensating Controls, an accountable owner, and a review or expiration date.";
const INTERIM_MFA = "Multi-factor authentication is required for workforce and administrative access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data. Customer or external-user MFA is required when an approved Control, customer commitment, or risk decision requires it. Where required MFA is unavailable, management must approve a time-bound Exception with a risk assessment, compensating Controls, an accountable owner, and a review or expiration date.";
const OLD_STRONG_AUTHENTICATION = "Important systems use approved authentication settings, protected unique credentials, and multi-factor authentication for administrative, production, source-control, email, identity, and sensitive-data access when supported.";
const INTERIM_STRONG_AUTHENTICATION = "Important Systems use approved strong-authentication settings, unique identities, and protected credentials. Multi-factor authentication is required for workforce and administrative access to production, source control, email, identity, and Systems that provide access to Confidential or Restricted data. Customer and external-user authentication requirements follow approved Controls, customer commitments, and risk decisions.";

const PRIOR_CONTROLS = [
  {
    id: "control-workforce-expectations",
    title: "Workforce expectations",
    statement: "Workers agree to applicable conduct, confidentiality, acceptable-use, and security responsibilities before receiving access and are held accountable for violations.",
    activity: "Complete screening when appropriate, agreements, policy acknowledgement, and corrective action.",
    requirementIds: ["requirement-soc2-cc1-4"],
    operationPattern: "event-driven"
  },
  {
    id: "control-strong-authentication",
    title: "Strong authentication",
    statement: OLD_STRONG_AUTHENTICATION,
    activity: "Configure and monitor authentication, credential storage, and privileged roles.",
    requirementIds: ["requirement-soc2-cc6-1", "requirement-soc2-cc6-2", "requirement-soc2-cc6-6"]
  },
  {
    id: "control-encryption-transmission",
    title: "Encryption and secure transmission",
    statement: "Confidential and Restricted data is encrypted in transit over untrusted networks and at rest in approved systems and on devices, with protected key access.",
    activity: "Configure encryption and approved transfer methods based on classification.",
    requirementIds: ["requirement-soc2-cc6-1", "requirement-soc2-cc6-7"]
  },
  {
    id: "control-inventory-configuration",
    title: "System inventory and secure configuration",
    statement: "The organization maintains inventories of important systems, company and approved personal devices, service accounts, vendors, and data stores, with owners, lifecycle state, and secure configuration expectations.",
    activity: "Maintain inventories, baselines, ownership, classification, and approved deviations.",
    requirementIds: ["requirement-soc2-cc6-1", "requirement-soc2-cc7-1"]
  },
  {
    id: "control-network-security",
    title: "Network and remote-access security",
    statement: "The organization restricts network paths, protects remote access with approved encryption and authentication, and reviews material network access rules at least annually.",
    activity: "Manage boundaries, firewall rules, wireless safeguards, and remote production access.",
    requirementIds: ["requirement-soc2-cc6-6", "requirement-soc2-cc6-7"]
  },
  {
    id: "control-change-management",
    title: "Change management",
    statement: "Material software and infrastructure changes are recorded, tested, approved, deployed through an authorized process, and recoverable. Review is independent when practical; a small team records a risk-appropriate compensating or post-deployment review, or an approved Exception, when independent pre-deployment review is not possible.",
    activity: "Record the reason, author, risk, reviewer or compensating review, test result, deployment, and rollback method.",
    operationPattern: "event-driven",
    requirementIds: ["requirement-soc2-cc6-8", "requirement-soc2-cc8-1"]
  },
  {
    id: "control-penetration-testing",
    title: "Penetration testing",
    statement: "Management records whether independent penetration testing is needed for the in-scope service, then documents its scope and cadence from exposure, change, customer commitments, and risk decisions. Findings are tracked to resolution or approved risk treatment.",
    activity: "Define scope, perform independent testing, review results, and track findings.",
    requirementIds: ["requirement-soc2-cc7-1", "requirement-soc2-cc7-2"]
  },
  {
    id: "control-logging-monitoring",
    title: "Logging and monitoring",
    statement: "Important systems record and protect security and operational events, retain them according to the approved Data Retention Schedule, and use risk-based alerting, review, and alert-path testing recorded in the applicable Controls and Obligations.",
    activity: "Collect, protect, alert on, test, and review important log output and access.",
    requirementIds: ["requirement-soc2-cc7-2", "requirement-soc2-cc7-3"]
  },
  {
    id: "control-vendor-due-diligence",
    title: "Vendor due diligence and contracting",
    statement: "New Vendors receive risk-based security and privacy review and suitable contractual safeguards before access to Confidential or Restricted data. Vendors that predate Policy adoption receive a documented transition review, deadline, or approved risk acceptance.",
    activity: "Assess service, data, access, assurance, recovery, incidents, and contract terms before access.",
    requirementIds: ["requirement-soc2-cc9-2"]
  },
  {
    id: "control-policy-management",
    title: "Policy management",
    statement: "The policy owner reviews governed policies and plans at least annually and after material changes, obtains approval from a separate independent approver, and retains the approved revisions in Git.",
    activity: "Review, approve, communicate, and version policies and plans.",
    requirementIds: ["requirement-soc2-cc5-1", "requirement-soc2-cc5-2", "requirement-soc2-cc5-3"]
  },
  {
    id: "control-security-communication",
    title: "Security communication",
    statement: "The organization communicates security responsibilities, approved reporting routes, material changes, and relevant control information to its workforce and outside parties.",
    activity: "Maintain reporting routes and communicate policies, changes, and security information.",
    requirementIds: ["requirement-soc2-cc2-1", "requirement-soc2-cc2-2", "requirement-soc2-cc2-3"]
  },
  {
    id: "control-risk-assessment",
    title: "Risk assessment and treatment",
    statement: "The organization assesses information security risk at least annually and after material changes, assigns owners and responses, and reviews high and critical risks at least quarterly.",
    activity: "Identify threats and changes, score risk, select treatment, and track review dates.",
    requirementIds: [
      "requirement-soc2-cc3-1",
      "requirement-soc2-cc3-2",
      "requirement-soc2-cc3-3",
      "requirement-soc2-cc3-4",
      "requirement-soc2-cc9-1"
    ]
  },
  {
    id: "control-monitoring-remediation",
    title: "Control monitoring and remediation",
    statement: "Management reviews control operation, incidents, test results, exceptions, and findings, then assigns and tracks corrective work through completion.",
    activity: "Review control evidence and track deficiencies, owners, due dates, and verification.",
    requirementIds: ["requirement-soc2-cc4-1", "requirement-soc2-cc4-2"]
  },
  {
    id: "control-data-retention-disposal",
    title: "Data retention and disposal",
    statement: "Data owners apply the approved Data Retention Schedule and disposal methods to active, local, backup, and Vendor-held copies, subject to legal holds and approved Exceptions.",
    activity: "Apply approved retention and disposal methods to active, local, backup, and vendor-held copies.",
    requirementIds: ["requirement-soc2-cc6-5"],
    operationPattern: "event-driven"
  },
  {
    id: "control-endpoint-protection",
    title: "Endpoint protection",
    statement: "Devices that access company systems use approved configuration, encryption, screen locking, supported software, security updates, and continuous malware protection when supported.",
    activity: "Use continuous platform protection where supported and verify endpoint configuration, update, and compliance state on the risk-based schedule recorded in an Obligation when periodic work is needed.",
    requirementIds: ["requirement-soc2-cc6-6", "requirement-soc2-cc7-1"]
  }
];

test("keeps the fresh-workspace Policy and packaged policy-library content identical", async () => {
  const source = await readFile(latestStarterPolicy, "utf8");
  assert.equal(source, await readFile(libraryPolicy, "utf8"));
  assert.doesNotMatch(source, /FileGRC/i);
});

test("offers scan-friendly requirement lists as a reviewable upgrade", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-lists-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = policyPath(root);
  const current = await readFile(path, "utf8");
  const prior = previousPolicyDetailLists(current);
  assert.notEqual(prior, current);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["policy-information-security"]);
  assert.match(review.proposals[0].changes[0].diff, /^\+\- \*\*Policy Owner:\*\*/m);
  assert.match(review.proposals[0].changes[0].diff, /^\+\- \*\*Service accounts:\*\*/m);
  assert.equal(await readFile(path, "utf8"), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(path, "utf8"), current);
});

test("offers the readable policy structure as a reviewable upgrade", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-formatting-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = policyPath(root);
  const current = await readFile(path, "utf8");
  const prior = previousPolicyFormatting(current);
  assert.notEqual(prior, current);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["policy-information-security"]);
  assert.match(review.proposals[0].changes[0].diff, /^\+## Consolidated policy index$/m);
  assert.match(review.proposals[0].changes[0].diff, /^\+### Multi-factor authentication$/m);
  assert.equal(await readFile(path, "utf8"), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(path, "utf8"), current);
});

test("offers the glossary-formatted Definitions section as a reviewable upgrade", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-definitions-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = policyPath(root);
  const current = await readFile(path, "utf8");
  const prior = previousPolicyFormatting(current).replace(CURRENT_POLICY_DEFINITIONS, PRIOR_POLICY_DEFINITIONS);
  assert.notEqual(prior, current);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["policy-information-security"]);
  assert.match(review.proposals[0].changes[0].diff, /^\+## Definitions$/m);
  assert.match(review.proposals[0].changes[0].diff, /^\+\- \*\*Worker:\*\*/m);
  assert.equal(await readFile(path, "utf8"), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(path, "utf8"), current);
});

test("offers the standalone Policy as an explicit upgrade to the immediately prior starter", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-standalone-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = policyPath(root);
  const current = await readFile(path, "utf8");
  const prior = previousProductSpecificPolicy(current);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["policy-information-security"]);
  assert.match(review.proposals[0].changes[0].diff, /-.*FileGRC does not infer technical implementation/);
  assert.match(review.proposals[0].changes[0].diff, /\+.*The organization retains the reviewed Policy version/);
  assert.equal(await readFile(path, "utf8"), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(path, "utf8"), current);
});

test("offers standalone governed Documents as a reviewable upgrade and changes nothing before acceptance", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-documents-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const organizationSchedulePath = join(root, "data", "retention-schedule-items", "retention-schedule-item-source-governance.json");
  const organizationScheduleBefore = await readFile(organizationSchedulePath, "utf8");
  const scheduleRecordPath = join(root, "data", "documents", "document-data-retention-schedule.json");
  const scheduleRecord = JSON.parse(await readFile(scheduleRecordPath, "utf8"));
  await writeJson(scheduleRecordPath, {
    ...scheduleRecord,
    controlIds: ["control-data-classification-inventory", "control-data-retention-disposal", "control-policy-management"]
  });
  const currentSources = new Map();
  const priorSources = new Map();
  for (const [id, update] of Object.entries(PRIOR_DOCUMENT_BOUNDARY_REPLACEMENTS)) {
    const path = join(root, "data", "documents", update.path);
    const current = await readFile(path, "utf8");
    const prior = update.replacements.reduce((source, [next, previous]) => source.replace(next, previous), current);
    currentSources.set(id, current);
    priorSources.set(id, prior);
    await writeFile(path, prior, "utf8");
  }

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(
    new Set(review.proposals[0].changes.map(({ resourceId }) => resourceId)),
    new Set(Object.keys(PRIOR_DOCUMENT_BOUNDARY_REPLACEMENTS))
  );
  assert.equal(review.proposals[0].changes.every(({ resourceType }) => resourceType === "document"), true);
  assert.match(review.proposals[0].changes.find(({ resourceId }) => resourceId === "document-soc2-system-description").diff, /management's authoritative records/);
  for (const [id, update] of Object.entries(PRIOR_DOCUMENT_BOUNDARY_REPLACEMENTS)) {
    assert.equal(await readFile(join(root, "data", "documents", update.path), "utf8"), priorSources.get(id));
  }

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(organizationSchedulePath, "utf8"), organizationScheduleBefore);
  assert.deepEqual(
    JSON.parse(await readFile(scheduleRecordPath, "utf8")).controlIds,
    [
      "control-data-classification-inventory",
      "control-data-retention-disposal",
      "control-policy-management",
      "control-logging-monitoring",
      "control-backup-restoration"
    ]
  );
  for (const [id, update] of Object.entries(PRIOR_DOCUMENT_BOUNDARY_REPLACEMENTS)) {
    assert.equal(await readFile(join(root, "data", "documents", update.path), "utf8"), currentSources.get(id));
  }
});

test("leaves customized, approved, and active governed Documents untouched", async (context) => {
  for (const status of ["customized", "approved", "active"]) {
    const parent = await mkdtemp(join(tmpdir(), `filegrc-policy-library-document-${status}-`));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
    const root = join(parent, "program");
    await createFilegrc({
      target: root,
      companyName: "Test Organization",
      policyOwnerName: "Program Owner",
      policyOwnerJobTitle: "Chief Executive Officer",
      policyOwnerEmail: "owner@example.test",
      securityContactEmail: "security@example.test",
      timezone: "UTC",
      filegrcVersion: "1.2.3",
      install: false,
      effectiveDate: "2026-01-01"
    });
    const update = PRIOR_DOCUMENT_BOUNDARY_REPLACEMENTS["document-soc2-system-description"];
    const path = join(root, "data", "documents", update.path);
    const current = await readFile(path, "utf8");
    let source = update.replacements.reduce((value, [next, previous]) => value.replace(next, previous), current);
    if (status === "customized") source += "\nOrganization-specific system description instruction.\n";
    await writeFile(path, source, "utf8");
    if (status !== "customized") {
      const recordPath = join(root, "data", "documents", "document-soc2-system-description.json");
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      await writeJson(recordPath, { ...record, status });
    }

    const review = await assessPolicyLibraryUpgrades(root);
    assert.equal(review.proposals.some(({ changes }) => changes.some(({ resourceId }) => resourceId === "document-soc2-system-description")), false);
    assert.equal(review.skipped.find(({ resourceId }) => resourceId === "document-soc2-system-description").reason, status === "customized" ? "customized" : "adopted");
    assert.equal(await readFile(path, "utf8"), source);
  }
});

test("preserves customized retention Markdown while proposing additive Control links", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-custom-retention-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const markdownPath = join(root, "data", "documents", "document-data-retention-schedule.md");
  const recordPath = join(root, "data", "documents", "document-data-retention-schedule.json");
  const customized = (await readFile(markdownPath, "utf8")) + "\nOrganization-specific retention review note.\n";
  await writeFile(markdownPath, customized, "utf8");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  await writeJson(recordPath, {
    ...record,
    controlIds: (record.controlIds || []).filter((id) => !["control-logging-monitoring", "control-backup-restoration"].includes(id))
  });
  await unlink(join(root, "data", "controls", "control-logging-monitoring.json"));

  const review = await assessPolicyLibraryUpgrades(root);
  const changes = review.proposals.flatMap(({ changes }) => changes)
    .filter(({ resourceId }) => resourceId === "document-data-retention-schedule");
  assert.equal(changes.some(({ path }) => path.endsWith(".md")), false);
  assert.equal(changes.some(({ path, diff }) => path.endsWith(".json") && /control-backup-restoration/.test(diff)), true);
  assert.equal(changes.some(({ diff }) => /control-logging-monitoring/.test(diff)), false);
  assert.equal(review.skipped.some(({ resourceId, reason }) => resourceId === "control-logging-monitoring" && reason === "missing"), true);
  assert.equal(await readFile(markdownPath, "utf8"), customized);
});

test("reviews and explicitly accepts the consolidated Information Security starter update", async (context) => {
  const root = await makePriorStarterWorkspace(context);
  const originalPolicy = await readFile(policyPath(root), "utf8");
  const review = await assessPolicyLibraryUpgrades(root);
  assert.equal(review.proposals.length, 1);
  const proposal = review.proposals[0];
  assert.equal(proposal.id, INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID);
  assert.equal(proposal.changes.length, 2 + PRIOR_CONTROLS.length);
  assert.deepEqual(
    new Set(proposal.changes.map(({ resourceId }) => resourceId)),
    new Set(["policy-information-security", ...PRIOR_CONTROLS.map(({ id }) => id)])
  );
  assert.match(proposal.changes[0].diff, /^--- a\/data\/policies\/policy-information-security\.md/m);
  assert.match(proposal.changes[0].diff, /\+## Identification, Authentication, and Password Policy/);
  assert.match(proposal.changes[0].diff, /\+## Vendor, Third-Party, and Supply Chain Risk Management Policy/);
  assert.match(proposal.changes[1].diff, /\["employees","contractors"\]/);
  assert.match(proposal.changes.find(({ resourceId }) => resourceId === "control-workforce-expectations").diff, /role-based screening decision/);
  assert.match(proposal.changes.find(({ resourceId }) => resourceId === "control-strong-authentication").diff, /Customer and external-user authentication requirements follow approved Controls/);
  assert.match(proposal.changes.find(({ resourceId }) => resourceId === "control-strong-authentication").diff, /time-bound Exception with a risk assessment/);
  assert.equal(await readFile(policyPath(root), "utf8"), originalPolicy);

  await assert.rejects(
    applyPolicyLibraryUpgrade(root, proposal.id),
    /explicitly confirm/
  );
  await assert.rejects(
    applyPolicyLibraryUpgrade(root, proposal.id, { confirmed: true }),
    /proposal changed or its revision was not confirmed/
  );
  const applied = await applyPolicyLibraryUpgrade(root, proposal.id, {
    confirmed: true,
    proposalRevision: proposal.revision
  });
  assert.deepEqual(applied.changedPaths, proposal.changes.map(({ path }) => path));

  const nextPolicy = await readFile(policyPath(root), "utf8");
  assert.equal(nextPolicy, (await readFile(latestStarterPolicy, "utf8"))
    .replaceAll("{{company_name}}", "Test Organization")
    .replaceAll("{{security_contact_email}}", "security@example.com"));
  assert.match(nextPolicy, /Source-controlled ciphertext may be used/);
  assert.match(nextPolicy, /\*\*Customer and external-user access:\*\* MFA is required when an approved Control/);
  assert.match(nextPolicy, /This Policy does not require every System to receive an annual penetration test/);

  const strongAuthentication = await readControl(root, "control-strong-authentication");
  assert.match(strongAuthentication.statement, /changed or disabled default credentials/);
  assert.match(strongAuthentication.statement, /separate administrative identities or roles/);
  assert.match(strongAuthentication.statement, /Where required MFA is unavailable, management approves a time-bound Exception/);
  assert.equal(strongAuthentication.status, "planned");
  const policy = JSON.parse(await readFile(join(root, "data", "policies", "policy-information-security.json"), "utf8"));
  assert.equal(policy.status, "draft");
  assert.deepEqual(policy.audience, ["employees", "contractors"]);
  assert.equal((await assessPolicyLibraryUpgrades(root)).proposals.length, 0);
});

test("proposes only the missing review schedules in an existing v4 starter workspace", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-v4-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });

  const addedIds = [
    "obligation-annual-control-design-review",
    "obligation-annual-workforce-competence-review",
    "obligation-worker-start-screening",
    "obligation-worker-role-change-training"
  ];
  for (const id of addedIds) await unlink(join(root, "data", "obligations", `${id}.json`));
  const priorValues = {
    "obligation-quarterly-security-risk-meeting": {
      controlIds: ["control-security-governance"]
    },
    "obligation-annual-policy-review": {
      controlIds: ["control-policy-management"]
    },
    "obligation-annual-penetration-test": {
      title: "Annual independent penetration test",
      activityType: "penetration-test"
    }
  };
  for (const [id, values] of Object.entries(priorValues)) {
    const path = join(root, "data", "obligations", `${id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeJson(path, { ...record, ...values });
  }
  const unchangedControl = await readFile(join(root, "data", "controls", "control-strong-authentication.json"), "utf8");
  const unchangedPolicy = await readFile(policyPath(root), "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.equal(review.proposals.length, 1);
  const proposal = review.proposals[0];
  assert.equal(proposal.changes.length, 7);
  assert.equal(proposal.changes.every(({ resourceType }) => resourceType === "obligation"), true);
  assert.deepEqual(
    new Set(proposal.changes.map(({ resourceId }) => resourceId)),
    new Set([...Object.keys(priorValues), ...addedIds])
  );

  const applied = await applyPolicyLibraryUpgrade(root, proposal.id, {
    confirmed: true,
    proposalRevision: proposal.revision
  });
  assert.deepEqual(new Set(applied.result.createdResourceIds), new Set(addedIds));
  assert.equal(applied.result.validation.ok, true, JSON.stringify(applied.result.validation.diagnostics));
  assert.equal(await readFile(join(root, "data", "controls", "control-strong-authentication.json"), "utf8"), unchangedControl);
  assert.equal(await readFile(policyPath(root), "utf8"), unchangedPolicy);
  const policy = JSON.parse(await readFile(join(root, "data", "policies", "policy-information-security.json"), "utf8"));
  assert.equal(policy.status, "draft");
  const controls = await Promise.all((await readdir(join(root, "data", "controls")))
    .filter((file) => file.endsWith(".json"))
    .map((file) => readFile(join(root, "data", "controls", file), "utf8").then(JSON.parse)));
  assert.equal(controls.every(({ status }) => status === "planned"), true);
  assert.equal((await assessPolicyLibraryUpgrades(root)).proposals.length, 0);
});

test("reviews and explicitly accepts the vendor-neutral Training correction", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-training-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = trainingPath(root);
  const current = await readFile(path, "utf8");
  const prior = previousProductSpecificTraining(current)
    .replace(CURRENT_PASSWORD_TRAINING, PRIOR_PASSWORD_TRAINING)
    .replace(CURRENT_REMOTE_MFA_TRAINING, PRIOR_REMOTE_MFA_TRAINING)
    .replace(CURRENT_SECRET_TRAINING, PRIOR_SECRET_TRAINING)
    .replace(PRIOR_REPOSITORY_SECRET_TRAINING, LEGACY_REPOSITORY_SECRET_TRAINING)
    .replace(CURRENT_SOURCE_SECRET_TRAINING, PRIOR_SOURCE_SECRET_TRAINING);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.equal(review.proposals.length, 1);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["training-security-awareness"]);
  assert.match(review.proposals[0].changes[0].diff, /credential-protection method approved for that System/);
  assert.match(review.proposals[0].changes[0].diff, /customer commitment, or risk decision requires it/);
  assert.match(review.proposals[0].changes[0].diff, /Approved source-controlled ciphertext must follow the Policy/);
  assert.equal(await readFile(path, "utf8"), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(path, "utf8"), current);
  assert.equal((await assessPolicyLibraryUpgrades(root)).proposals.length, 0);
});

test("recognizes prior vendor-neutral Training revisions before the ciphertext corrections", async (context) => {
  for (const [name, transform] of [
    ["initial", (source) => previousProductSpecificTraining(source)
      .replace(CURRENT_SECRET_TRAINING, PRIOR_SECRET_TRAINING)
      .replace(PRIOR_REPOSITORY_SECRET_TRAINING, LEGACY_REPOSITORY_SECRET_TRAINING)
      .replace(CURRENT_SOURCE_SECRET_TRAINING, PRIOR_SOURCE_SECRET_TRAINING)],
    ["partial", (source) => previousProductSpecificTraining(source)
      .replace(PRIOR_REPOSITORY_SECRET_TRAINING, LEGACY_REPOSITORY_SECRET_TRAINING)
      .replace(CURRENT_SOURCE_SECRET_TRAINING, PRIOR_SOURCE_SECRET_TRAINING)]
  ]) {
    const parent = await mkdtemp(join(tmpdir(), `filegrc-policy-library-training-ciphertext-${name}-`));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
    const root = join(parent, "program");
    await createFilegrc({
      target: root,
      companyName: "Test Organization",
      policyOwnerName: "Program Owner",
      policyOwnerJobTitle: "Chief Executive Officer",
      policyOwnerEmail: "owner@example.test",
      securityContactEmail: "security@example.test",
      timezone: "UTC",
      filegrcVersion: "1.2.3",
      install: false,
      effectiveDate: "2026-01-01"
    });
    const path = trainingPath(root);
    const current = await readFile(path, "utf8");
    await writeFile(path, transform(current), "utf8");

    const review = await assessPolicyLibraryUpgrades(root);
    assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["training-security-awareness"]);
    assert.match(review.proposals[0].changes[0].diff, /Repository access alone must never decrypt/);
    await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
      confirmed: true,
      proposalRevision: review.proposals[0].revision
    });
    assert.equal(await readFile(path, "utf8"), current);
  }
});

test("offers generic workforce Training as an explicit upgrade to the immediately prior starter", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-training-generic-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = trainingPath(root);
  const current = await readFile(path, "utf8");
  const prior = previousProductSpecificTraining(current);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["training-security-awareness"]);
  assert.match(review.proposals[0].changes[0].diff, /\+.*source repositories or general-purpose Systems/);
  assert.match(review.proposals[0].changes[0].diff, /\+Approved supporting standards, procedures, and schedules/);
  assert.equal(await readFile(path, "utf8"), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.equal(await readFile(path, "utf8"), current);
});

test("leaves customized and active Training content untouched", async (context) => {
  for (const state of ["customized", "active"]) {
    const parent = await mkdtemp(join(tmpdir(), `filegrc-policy-library-training-${state}-`));
    context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
    const root = join(parent, "program");
    await createFilegrc({
      target: root,
      companyName: "Test Organization",
      policyOwnerName: "Program Owner",
      policyOwnerJobTitle: "Chief Executive Officer",
      policyOwnerEmail: "owner@example.test",
      securityContactEmail: "security@example.test",
      timezone: "UTC",
      filegrcVersion: "1.2.3",
      install: false,
      effectiveDate: "2026-01-01"
    });
    const path = trainingPath(root);
    let source = previousProductSpecificTraining(await readFile(path, "utf8"))
      .replace(CURRENT_PASSWORD_TRAINING, PRIOR_PASSWORD_TRAINING)
      .replace(CURRENT_REMOTE_MFA_TRAINING, PRIOR_REMOTE_MFA_TRAINING)
      .replace(CURRENT_SECRET_TRAINING, PRIOR_SECRET_TRAINING)
      .replace(PRIOR_REPOSITORY_SECRET_TRAINING, LEGACY_REPOSITORY_SECRET_TRAINING)
      .replace(CURRENT_SOURCE_SECRET_TRAINING, PRIOR_SOURCE_SECRET_TRAINING);
    if (state === "customized") source += "\nOrganization-specific training instruction.\n";
    await writeFile(path, source, "utf8");
    if (state === "active") {
      const recordPath = join(root, "data", "training", "training-security-awareness.json");
      const record = JSON.parse(await readFile(recordPath, "utf8"));
      await writeJson(recordPath, { ...record, status: "active" });
    }

    const review = await assessPolicyLibraryUpgrades(root);
    assert.equal(review.proposals.some(({ changes }) => changes.some(({ resourceId }) => resourceId === "training-security-awareness")), false);
    assert.equal(review.skipped.find(({ resourceId }) => resourceId === "training-security-awareness").reason, state === "active" ? "adopted" : "customized");
    assert.equal(await readFile(path, "utf8"), source);
  }
});

test("recognizes the interim MFA and encrypted-configuration starter", async (context) => {
  const root = await makePriorStarterWorkspace(context, "-interim", { interim: true });
  const review = await assessPolicyLibraryUpgrades(root);
  assert.equal(review.proposals[0].id, INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID);
  assert.match(review.proposals[0].changes[0].diff, /Identification, Authentication, and Password Policy/);
  assert.match(review.proposals[0].changes.find(({ resourceId }) => resourceId === "control-strong-authentication").diff, /changed or disabled default credentials/);
});

test("reviews the time-bound MFA exception correction without changing the Control automatically", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-mfa-exception-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = join(root, "data", "controls", "control-strong-authentication.json");
  const current = JSON.parse(await readFile(path, "utf8"));
  const prior = {
    ...current,
    statement: current.statement.replace(/ Where required MFA is unavailable, management approves a time-bound Exception.*$/, ""),
    activity: current.activity.replace(", customer requirements, and approved MFA Exceptions", ", and customer requirements")
  };
  await writeJson(path, prior);

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["control-strong-authentication"]);
  assert.match(review.proposals[0].changes[0].diff, /time-bound Exception with a risk assessment/);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), prior);

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), current);
});

test("reviews generic Control activities without changing planned Controls automatically", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-control-boundary-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "Test Organization",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const priorActivities = {
    "control-endpoint-protection": "Use continuous platform protection where supported and verify endpoint configuration, update, and compliance state on the risk-based schedule recorded in an Obligation when periodic work is needed.",
    "control-vulnerability-management": "Choose scan coverage and cadence. Review the starter remediation targets of Critical 7 days, High 14 days, Medium 30 days, and Low 90 days, then record the approved targets or time-bound Exceptions.",
    "control-continuity-exercise": "Maintain the plan, contacts, recovery objectives, exercises, results, and follow-up work."
  };
  const current = new Map();
  for (const [id, activity] of Object.entries(priorActivities)) {
    const path = join(root, "data", "controls", `${id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    current.set(id, record);
    await writeJson(path, { ...record, activity });
  }
  const backupPath = join(root, "data", "controls", "control-backup-restoration.json");
  const currentBackup = JSON.parse(await readFile(backupPath, "utf8"));
  current.set(currentBackup.id, currentBackup);
  await writeJson(backupPath, {
    ...currentBackup,
    statement: "Each important System has backup scope, frequency, retention, monitoring, and restore validation that meet its approved recovery objectives, or a documented alternate recovery approach when backups are not the chosen safeguard.",
    activity: "Record System recovery objectives and backup or alternate recovery procedures, monitor the chosen safeguards, and validate recovery on the approved schedule."
  });

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(
    new Set(review.proposals[0].changes.map(({ resourceId }) => resourceId)),
    new Set([...Object.keys(priorActivities), currentBackup.id])
  );
  for (const [id, activity] of Object.entries(priorActivities)) {
    assert.equal((await readControl(root, id)).activity, activity);
  }

  await applyPolicyLibraryUpgrade(root, review.proposals[0].id, {
    confirmed: true,
    proposalRevision: review.proposals[0].revision
  });
  for (const [id, record] of current) assert.deepEqual(await readControl(root, id), record);
});

test("recognizes a prior starter when the organization name is also policy vocabulary", async (context) => {
  const root = await makePriorStarterWorkspace(context, "-organization-name", { organizationName: "Management" });
  const review = await assessPolicyLibraryUpgrades(root);
  assert.equal(review.proposals[0].id, INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID);
  assert.equal(review.proposals[0].changes[0].resourceId, "policy-information-security");
});

test("recognizes prior Training when the organization name is also training vocabulary", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "filegrc-policy-library-training-organization-name-"));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const root = join(parent, "program");
  await createFilegrc({
    target: root,
    companyName: "System",
    policyOwnerName: "Program Owner",
    policyOwnerJobTitle: "Chief Executive Officer",
    policyOwnerEmail: "owner@example.test",
    securityContactEmail: "security@example.test",
    timezone: "UTC",
    filegrcVersion: "1.2.3",
    install: false,
    effectiveDate: "2026-01-01"
  });
  const path = trainingPath(root);
  const prior = previousProductSpecificTraining(await readFile(path, "utf8"))
    .replace(CURRENT_PASSWORD_TRAINING, PRIOR_PASSWORD_TRAINING)
    .replace(CURRENT_REMOTE_MFA_TRAINING, PRIOR_REMOTE_MFA_TRAINING)
    .replace(CURRENT_SECRET_TRAINING, PRIOR_SECRET_TRAINING)
    .replace(PRIOR_REPOSITORY_SECRET_TRAINING, LEGACY_REPOSITORY_SECRET_TRAINING)
    .replace(CURRENT_SOURCE_SECRET_TRAINING, PRIOR_SOURCE_SECRET_TRAINING);
  await writeFile(path, prior, "utf8");

  const review = await assessPolicyLibraryUpgrades(root);
  assert.deepEqual(review.proposals[0].changes.map(({ resourceId }) => resourceId), ["training-security-awareness"]);
  assert.equal(review.skipped.some(({ resourceId, reason }) => (
    resourceId === "training-security-awareness" && reason === "customized"
  )), false);
});

test("leaves customized and adopted Policy content untouched", async (context) => {
  for (const status of ["draft", "approved", "active"]) {
    const root = await makePriorStarterWorkspace(context, `-${status}`);
    const path = policyPath(root);
    const source = await readFile(path, "utf8");
    const customSource = status === "draft" ? `${source}\nOrganization-specific authentication decision.\n` : source;
    await writeFile(path, customSource, "utf8");
    const policyRecordPath = join(root, "data", "policies", "policy-information-security.json");
    const policy = JSON.parse(await readFile(policyRecordPath, "utf8"));
    await writeJson(policyRecordPath, { ...policy, status });

    const review = await assessPolicyLibraryUpgrades(root);
    assert.ok(review.proposals[0]);
    assert.equal(review.proposals[0].changes.some(({ resourceId }) => resourceId === "policy-information-security"), false);
    assert.equal(review.skipped.find(({ resourceId }) => resourceId === "policy-information-security").reason, status === "draft" ? "customized" : "adopted");
    assert.equal(await readFile(path, "utf8"), customSource);
  }
});

test("acceptance updates recognized defaults and leaves a customized Control untouched", async (context) => {
  const root = await makePriorStarterWorkspace(context, "-custom-control");
  const path = join(root, "data", "controls", "control-network-security.json");
  const custom = { ...await readControl(root, "control-network-security"), statement: "Organization-specific network control." };
  await writeJson(path, custom);

  const review = await assessPolicyLibraryUpgrades(root);
  const proposal = review.proposals[0];
  assert.equal(proposal.changes.some(({ resourceId }) => resourceId === "control-network-security"), false);
  assert.equal(review.skipped.find(({ resourceId }) => resourceId === "control-network-security").reason, "customized");
  await applyPolicyLibraryUpgrade(root, proposal.id, {
    confirmed: true,
    proposalRevision: proposal.revision
  });
  assert.equal((await readControl(root, "control-network-security")).statement, custom.statement);
  assert.match((await readControl(root, "control-change-management")).statement, /security design or threat analysis/);
});

test("rejects acceptance when the reviewed proposal changes", async (context) => {
  const root = await makePriorStarterWorkspace(context, "-changed-after-review");
  const review = await assessPolicyLibraryUpgrades(root);
  const proposal = review.proposals[0];
  const originalPolicy = await readFile(policyPath(root), "utf8");
  const path = join(root, "data", "controls", "control-network-security.json");
  const control = await readControl(root, "control-network-security");
  await writeJson(path, { ...control, statement: "A newly customized network Control." });

  await assert.rejects(
    applyPolicyLibraryUpgrade(root, proposal.id, {
      confirmed: true,
      proposalRevision: proposal.revision
    }),
    /proposal changed or its revision was not confirmed/
  );
  assert.equal(await readFile(policyPath(root), "utf8"), originalPolicy);
});

test("does not propose starter text changes for an operating Control", async (context) => {
  const root = await makePriorStarterWorkspace(context, "-operating-control");
  const path = join(root, "data", "controls", "control-logging-monitoring.json");
  const control = await readControl(root, "control-logging-monitoring");
  await writeJson(path, { ...control, status: "implemented" });
  const review = await assessPolicyLibraryUpgrades(root);
  assert.equal(review.proposals[0].changes.some(({ resourceId }) => resourceId === control.id), false);
  assert.equal(review.skipped.find(({ resourceId }) => resourceId === control.id).reason, "operating");
});

test("exposes the review and acceptance flow through the CLI", async (context) => {
  const root = await makePriorStarterWorkspace(context, "-cli");
  const preview = JSON.parse((await execute(process.execPath, [cli, "policy-library", "--root", root, "--json"])).stdout);
  assert.equal(preview.proposals[0].id, INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID);
  assert.match(preview.proposals[0].changes[0].diff, /^--- /);
  await assert.rejects(
    execute(process.execPath, [cli, "policy-library", "--root", root, "--accept", INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID]),
    /explicitly confirm/
  );
  const accepted = JSON.parse((await execute(process.execPath, [
    cli,
    "policy-library",
    "--root",
    root,
    "--accept",
    INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID,
    "--proposal-revision",
    preview.proposals[0].revision,
    "--yes",
    "--json"
  ])).stdout);
  assert.equal(accepted.acceptedProposalId, INFORMATION_SECURITY_LIBRARY_PROPOSAL_ID);
});

async function makePriorStarterWorkspace(context, suffix = "", options = {}) {
  const root = await mkdtemp(join(tmpdir(), `filegrc-policy-library${suffix}-`));
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeWorkspace(root);
  const organizationName = options.organizationName || "Test Organization";
  if (organizationName !== "Test Organization") {
    const workspacePath = join(root, "data", "workspace.json");
    const workspace = JSON.parse(await readFile(workspacePath, "utf8"));
    await writeJson(workspacePath, { ...workspace, organizationName });
  }
  await Promise.all([
    mkdir(join(root, "data", "policies"), { recursive: true }),
    mkdir(join(root, "data", "controls"), { recursive: true }),
    mkdir(join(root, "data", "frameworks"), { recursive: true }),
    mkdir(join(root, "data", "requirements"), { recursive: true })
  ]);
  await writeJson(join(root, "data", "frameworks", "framework-aicpa-trust-services-criteria.json"), {
    id: "framework-aicpa-trust-services-criteria",
    type: "framework",
    title: "AICPA Trust Services Criteria",
    status: "active",
    version: "2017 with revised points of focus 2022"
  });
  const requirementReferences = new Set([
    ...PRIOR_CONTROLS.flatMap(({ requirementIds }) => requirementIds || []).map((id) => id.replace("requirement-soc2-", "").toUpperCase().replace("-", ".")),
    "CC1.5",
    "CC6.8"
  ]);
  for (const reference of requirementReferences) {
    const slug = reference.toLowerCase().replace(".", "-");
    await writeJson(join(root, "data", "requirements", `requirement-soc2-${slug}.json`), {
      id: `requirement-soc2-${slug}`,
      type: "requirement",
      title: reference,
      frameworkId: "framework-aicpa-trust-services-criteria",
      reference,
      applicability: "applicable"
    });
  }
  await writeJson(join(root, "data", "policies", "policy-information-security.json"), {
    id: "policy-information-security",
    type: "policy",
    title: "Information Security Policy",
    status: "draft",
    ownerIds: ["person-owner"],
    audience: ["employees", "contractors", "vendors"],
    acknowledgementRequired: true
  });
  let source = (await readFile(priorStarterPolicy, "utf8"))
    .replaceAll("{{company_name}}", organizationName)
    .replaceAll("{{security_contact_email}}", "security@example.com");
  if (options.interim) source = source.replace(OLD_SECRETS, INTERIM_SECRETS).replace(OLD_MFA, INTERIM_MFA);
  await writeFile(policyPath(root), source, "utf8");
  for (const prior of PRIOR_CONTROLS) {
    const statement = options.interim && prior.id === "control-strong-authentication"
      ? INTERIM_STRONG_AUTHENTICATION
      : prior.statement;
    await writeJson(join(root, "data", "controls", `${prior.id}.json`), {
      id: prior.id,
      type: "control",
      title: prior.title,
      status: "planned",
      statement,
      ownerIds: ["person-owner"],
      requirementIds: prior.requirementIds || [],
      activity: prior.activity,
      controlType: "preventive",
      operationMode: "hybrid",
      operationPattern: prior.operationPattern || "continuous",
      policyIds: ["policy-information-security"]
    });
  }
  return root;
}

async function readControl(root, id) {
  return JSON.parse(await readFile(join(root, "data", "controls", `${id}.json`), "utf8"));
}
