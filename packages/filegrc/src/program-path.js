export const RESOURCE_INSTRUCTIONS = {
  person: "Record each person’s actual organizational job title. Keep named program authority, such as CISO, DPO, Policy Owner, or team chair, in dated Appointment records.",
  appointment: "Record one person’s dated appointment to a named organizational or program responsibility. Scope it to the workspace, a team, or the records governed by that appointment.",
  team: "Review the starter Security and Risk Oversight team, including its members and chair. Membership and chairs are authoritative here; Person teamIds is a legacy field.",
  system: "Catalog all in-scope systems for the program. Treat anything that operates a control or produces evidence as a System, including software provided by a vendor (like HR software). Set vendorId on each vendor-provided System; the Vendor’s System list is derived.",
  vendor: "Catalog the companies that provide in-scope software or services. Link each vendor-provided System with the System’s vendorId.",
  framework: "Confirm the criteria framework and version used for the program.",
  requirement: "Review each criterion, decide whether it applies, and record the reason for that decision.",
  commitment: "Record supplemental customer promises and service requirements that shape the scope or control design. The Commitment’s systemIds and controlIds are authoritative for what fulfills it.",
  policy: "Tailor each policy to match how the organization works. Clear placeholders, assign an owner and separate approver, then record its approval and effective dates. Controls link to their governing Policies.",
  document: "Tailor the governed plans and other supporting documents the program needs. Assign owners and approvers, then keep the approved Markdown in Git.",
  control: "Finish each applicable starter control with the procedure people will follow, its owner, scope, cadence, governing Policy and Requirement mappings, evidence source, and implementation date.",
  "complementary-control": "Record anything customers or carved-out providers must do for your controls to work as intended.",
  evidence: "Create External Evidence when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source System, link the Controls and operating record it supports, retain the fixed artifact or reference, and have another person verify it before audit use.",
  "risk-assessment": "Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.",
  risk: "Record each risk identified by an assessment or operating activity. Assign an owner, rate it, document the chosen response, and link the Controls that treat it from the Risk record.",
  obligation: "Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.",
  "obligation-event": "When a policy-triggering event occurs, record it here and complete the actions filegrc creates for it.",
  "policy-review": "Record scheduled and change-driven reviews of policies and governed documents, including the decision and any follow-up.",
  meeting: "Record required oversight meetings, including attendees, decisions, minutes, and follow-up work.",
  exception: "Record and approve any time-limited departure from a policy or control before the departure begins.",
  asset: "Keep the inventory of important devices, software, media, and records current, including ownership, custody, and status.",
  "vendor-review": "Document due diligence before relying on a provider, then repeat the review on schedule or after a material change.",
  "access-grant": "Record each person’s or service account’s access to a System, including approval, provisioning, changes, and removal.",
  "access-review": "Review access on schedule, record each decision, and assign any access changes that result.",
  "service-account": "Catalog non-human accounts that need separate tracking, including their owner, purpose, System, privilege, and expiry.",
  training: "Maintain the training content people must complete, along with its audience, timing, and passing requirements.",
  attestation: "Record each person’s completion or acknowledgement against the exact policy or training revision.",
  "vulnerability-scan": "Record each required scan, including its scope, timing, result, and evidence.",
  vulnerability: "Track confirmed weaknesses that need separate remediation, acceptance, or closure.",
  "penetration-test": "Record each penetration test, including its provider, scope, period, result, and evidence.",
  incident: "Record qualifying security or privacy events and manage their response and follow-up.",
  "backup-test": "Record each restore test, including the Systems tested, result, timing, evidence, and follow-up.",
  exercise: "Record each incident or continuity exercise, including its objective, participants, result, and follow-up.",
  finding: "Create a Finding only for a confirmed gap that needs separate remediation tracking. Keep the report details in the source record’s Markdown, then assign the Finding, set its due date, and verify closure.",
  "action-item": "Create an Action Item only when follow-up needs its own assignee, deadline, and completion proof. Point it to the record that created the work, then work it from Work Queue.",
  audit: "Create this record after engaging the CPA firm, then record the agreed scope, criteria, Systems, and report period. Control Tests and External Evidence link back with auditId or auditIds.",
  "audit-request": "Record each request from the audit team, assign an owner and due date, and link the approved response and evidence.",
  "data-request": "Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.",
  "control-test": "Record how an in-scope control was tested, what was sampled, the result, and any exceptions.",
  "audit-population": "Record each complete Type 2 population with its source System, fixed export, query, count, and reconciliation."
};

export const POLICY_EVENT_NAMES = {
  "person-started": "New Worker",
  "person-ended": "Worker Departure",
  "high-risk-person-ended": "High-Risk Departure",
  "person-role-changed": "Job or Responsibility Change",
  "personal-device-access-planned": "Personal Device Access",
  "vendor-access-planned": "Vendor Access",
  "vendor-reassessment-needed": "Vendor Reassessment",
  "system-material-change": "Material System Change",
  "material-incident": "Material Incident"
};

export function policyEventName(eventType) {
  return POLICY_EVENT_NAMES[eventType] || humanize(eventType);
}

export const PROGRAM_PATH = [
  {
    id: "scope",
    number: 1,
    title: "Define Scope",
    description: "Ownership, criteria, and service boundary",
    summary: "Confirm the people, dated appointments, and teams responsible for the program, set the management goal, review the criteria and customer commitments in scope, then define the customer-facing service, supporting systems, and supplier dependencies.",
    sections: [
      { id: "ownership", title: "Program Ownership", description: "Confirm the people, appointments, and teams that own, approve, review, and operate the program.", steps: ["Confirm the initial program lead’s actual job title and the separate Policy Owner Appointment.", "Add the organization’s real appointments, reviewers, and operators.", "Review the starter Security and Risk Oversight team, its members, and its chair.", "Add other teams only when the organization assigns shared responsibility to them."], types: ["person", "appointment", "team"], defaultOpen: true },
      { id: "criteria", title: "Criteria", description: "Confirm the criteria used for the program, resolve whether each requirement applies, and record customer commitments that shape the service or control design.", steps: ["Review the included Security criteria references.", "Mark each requirement applicable or not applicable with a rationale.", "Record customer commitments and keep optional criteria out until management deliberately adds them."], types: ["framework", "requirement", "commitment"], defaultOpen: true },
      { id: "boundary", title: "Service Boundary", description: "Record the service and its supporting technology and providers. An application or platform is a System because it operates controls or produces evidence; the company providing it is a Vendor because contracts, due diligence, and supplier risk belong to that relationship.", steps: ["Create a Vendor record for each material provider.", "Create System records for the customer-facing service and each supporting application, platform, or internal system that is in scope or produces evidence, then connect vendor-provided Systems to their providers.", "Assign owners, classification, dependencies, and a clear in-scope decision to each System, and keep supplier reviews with the Vendor."], types: ["vendor", "system"], defaultOpen: false }
    ],
    resourceTypes: ["person", "appointment", "team", "framework", "requirement", "commitment", "vendor", "system"],
    commands: [
      "filegrc setup",
      "filegrc guide person --json",
      "filegrc guide appointment --json",
      "filegrc guide system --json",
      "filegrc list system --json"
    ]
  },
  {
    id: "policies",
    number: 2,
    title: "Approve Policies",
    description: "Tailor, review, approve, and adopt",
    summary: "Turn every applicable policy and governed plan into the organization’s actual rules, remove placeholders, confirm that Controls link to their governing Policies, and establish approval and effective dates before scheduled work begins. The reviewer must be separate from the owner, is usually internal, and may be external.",
    sections: [
      { id: "library", title: "Policy Library", description: "Review, approve, and activate policies and governed plans without treating starter text as adopted practice.", steps: ["Review policy Markdown and replace every organization placeholder.", "Confirm the owner, separate approver, audience, review cadence, and Controls that point to the Policy.", "Record approval and effective dates before changing the status to active."], types: ["policy", "document"], defaultOpen: true }
    ],
    resourceTypes: ["policy", "document"],
    commands: [
      "filegrc guide policy --json",
      "filegrc list policy --json",
      "filegrc get POLICY_ID --mutation"
    ]
  },
  {
    id: "controls",
    number: 3,
    title: "Implement Controls",
    description: "Tailor and finish the starter control set",
    summary: "Review the starter catalog against the scoped service, then give every applicable internal control an actual procedure, owner, system scope, cadence, policy and criteria mappings, authoritative evidence source, and implementation date. Mark it implemented only after the procedure is operating, then record any controls that customers or carved-out providers must perform.",
    sections: [
      { id: "catalog", title: "Control Catalog", description: "Finish the starter controls, record applicable complementary controls, and see whether filegrc tracks operation through Work Queue or evidence records.", steps: ["Open every planned control and confirm its mappings and suggested frequency.", "Write the real procedure in Record Markdown and add system scope and evidence sources.", "Record any required customer or carved-out provider controls as Complementary Controls."], types: ["control", "complementary-control"], defaultOpen: true }
    ],
    resourceTypes: ["control", "complementary-control"],
    commands: [
      "filegrc guide control --json",
      "filegrc list control --json",
      "filegrc get CONTROL_ID --mutation"
    ]
  },
  {
    id: "evidence",
    number: 4,
    title: "Map Evidence",
    description: "Connect controls to authoritative sources",
    summary: "Before starting the candidate period, map every selected control to the authoritative Systems that produce its evidence. Name current evidence access owners and write repeatable retrieval instructions for each source.",
    sections: [
      { id: "mapping", title: "Evidence Map", description: "Review the evidence expected for every selected control family and resolve missing or incomplete source mappings.", steps: ["Review each evidence family and the Controls it supports.", "Map each Control to the exact authoritative source Systems.", "Assign current evidence access owners and record repeatable retrieval instructions in each source System’s Record Markdown.", "Resolve every incomplete mapping before starting the candidate period."], relatedLinks: [{ type: "system", label: "Source Systems", href: "#/resources/system?stage=evidence" }, { type: "control", label: "Controls", href: "#/resources/control?stage=evidence" }], types: [], defaultOpen: true }
    ],
    resourceTypes: [],
    utilities: [
      {
        id: "evidence-map",
        title: "Evidence Map",
        instructions: "Review every selected control family, its expected evidence, authoritative source Systems, access owners, and retrieval instructions. Fix the source System and Control records rather than creating placeholder Evidence.",
        use: "Confirm where evidence will come from before operation begins. The map is derived from authoritative program records and creates no evidence.",
        policyBasis: "Management needs repeatable access to records that show how each selected Control operates. Actual External Evidence is created during program operation or audit work when a real artifact exists.",
        commands: ["filegrc evidence-map --json", "filegrc program-readiness --json"]
      }
    ],
    commands: [
      "filegrc evidence-map --json",
      "filegrc guide system --json",
      "filegrc list system --json",
      "filegrc guide control --json",
      "filegrc program-readiness --json"
    ]
  },
  {
    id: "run",
    number: 5,
    title: "Operate the Program",
    description: "Run the work and retain dated proof",
    summary: "Record the management candidate start date when reliable evidence collection begins. Maintain current risk assessments and risks, updating the control set when needed. Complete recurring and event-driven work, run continuous and per-transaction controls, and keep dated evidence current throughout the period.",
    sections: [
      { id: "risk", title: "Risk", description: "Maintain the program’s risk assessments and risk register as the service, threats, suppliers, and control needs change.", steps: ["Complete and approve risk assessments on schedule and after material changes.", "Record risks that need treatment, acceptance, or ongoing tracking.", "Add or update controls when the assessment identifies a new or changed response."], types: ["risk-assessment", "risk"], defaultOpen: true },
      { id: "queue", title: "Work Queue", description: "Complete recurring work, Policy Event tasks, and assigned follow-up within their required windows.", steps: ["Review proposed work while policies are drafts.", "Complete due work within its allowed window and link dated proof.", "Start Policy Events when hiring, departures, incidents, or material changes occur; every other open Action Item appears here automatically."], types: ["obligation", "obligation-event", "data-request"], utility: "obligation-board", defaultOpen: true },
      { id: "evidence", title: "External Evidence", description: "Create records only for real exports, reports, screenshots, signed files, or approved external references collected during operation.", steps: ["Create External Evidence when the artifact exists or an operating record needs fixed supporting proof.", "Select the authoritative source System, link the Controls and source operating record, and retain the fixed attachment or approved reference.", "Record the collector and classification, then have another person verify the evidence before audit use."], types: ["evidence"], defaultOpen: true },
      { id: "governance", title: "Governance", description: "Record formal reviews, oversight meetings, and approved policy or control exceptions.", steps: ["Complete scheduled policy reviews and oversight meetings.", "Record decisions, attendees, follow-up work, and evidence.", "Approve time-bound exceptions before the departure begins."], types: ["policy-review", "meeting", "exception"], defaultOpen: false },
      { id: "inventories", title: "Assets and Vendors", description: "Maintain the asset inventory and recurring reviews of supplier relationships during operation.", steps: ["Keep ownership, custody, status, and lifecycle current for important assets.", "Perform vendor reviews on schedule and after material supplier changes.", "Link fixed reports and review evidence to the operating records."], types: ["asset", "vendor-review"], defaultOpen: false },
      { id: "access-training", title: "Access and Training", description: "Inventory service accounts before recording access decisions, periodic reviews, assignments, and acknowledgements.", steps: ["Catalog service accounts that need separate tracking.", "Preserve access approvals and removals as they occur, then complete periodic access reviews and resolve exceptions.", "Assign training and retain acknowledgement evidence for the exact content revision."], types: ["service-account", "access-grant", "access-review", "training", "attestation"], defaultOpen: false },
      { id: "security", title: "Security Operations", description: "Record vulnerability work, independent testing, and incident response activity for the period.", steps: ["Retain scan scope, results, vulnerabilities, remediation, and exceptions.", "Track penetration testing and follow-up findings.", "Start the incident workflow when a qualifying event occurs."], types: ["vulnerability-scan", "vulnerability", "penetration-test", "incident"], defaultOpen: false },
      { id: "resilience", title: "Resilience", description: "Preserve proof that backups, restoration, continuity, and incident exercises work as designed.", steps: ["Record backup restoration tests and their results.", "Run continuity and incident exercises on schedule.", "Assign and close follow-up work from failed objectives or lessons learned."], types: ["backup-test", "exercise"], defaultOpen: false },
      { id: "issues", title: "Issues and Remediation", description: "Keep observations in the source report and track only confirmed gaps that need a separate remediation lifecycle.", steps: ["Create a Finding only when a confirmed gap needs its own owner, due date, status, or verified closure.", "Use the Finding itself for straightforward remediation; create Action Items only for separate assigned tasks.", "Work Action Items from Work Queue and close the Finding only after remediation is independently verified."], types: ["finding"], defaultOpen: false }
    ],
    resourceTypes: [
      "risk-assessment",
      "risk",
      "obligation",
      "obligation-event",
      "data-request",
      "evidence",
      "policy-review",
      "meeting",
      "exception",
      "asset",
      "vendor-review",
      "service-account",
      "access-grant",
      "access-review",
      "training",
      "attestation",
      "vulnerability-scan",
      "vulnerability",
      "penetration-test",
      "incident",
      "backup-test",
      "exercise",
      "finding"
    ],
    supportingResourceTypes: ["action-item"],
    utilities: [
      {
        id: "policy-events",
        title: "Policy Events",
        instructions: "Trigger the matching workflow when an event occurs. filegrc adds every required action to the Work Queue with its owner and deadline.",
        use: "Preview the full workflow before triggering it, then create the event and every linked task in one validated write.",
        policyBasis: "Active event obligations translate policy-triggering changes into owned, deadline-bound Action Items. Proposed workflows remain unavailable until their governing policies and linked controls are ready.",
        commands: ["filegrc obligations --json", "filegrc trigger EVENT_TYPE (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) --subject RESOURCE_ID --json"]
      },
      {
        id: "work-queue",
        title: "Work Queue",
        instructions: "Complete recurring work, Policy Event tasks, and assigned Action Items within their allowed windows, link the requested dated proof, and resolve overdue items.",
        use: "See proposed, upcoming, due, and overdue policy work together with every open Action Item. Continuous and per-transaction controls still operate in their source Systems and need dated operating records or evidence.",
        policyBasis: "Effective policies and implemented linked controls activate reusable obligations. Policy Events and source records create owned Action Items. Each occurrence or task retains its own deadline, completion record, and evidence.",
        commands: ["filegrc obligations --json", "filegrc complete OBLIGATION_ID completion-mutation.json --json"]
      }
    ],
    commands: [
      "filegrc obligations --json",
      "filegrc trigger EVENT_TYPE (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) --subject RESOURCE_ID --json",
      "filegrc complete OBLIGATION_ID completion-mutation.json --json",
      "filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD --json",
      "filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD --json",
      "filegrc program-readiness --json"
    ]
  },
  {
    id: "audit",
    number: 6,
    title: "Audit",
    description: "Firm, formal period, fieldwork, and report",
    summary: "After the program is collecting reliable evidence, create an Audit record for the real CPA engagement, keep the firm-agreed report period separate from management’s candidate dates, complete management documents, populations, requests, evidence delivery, and fieldwork, then preserve the findings, responses, opinion, and final report.",
    sections: [
      { id: "engagement", title: "Engagement", description: "Record the actual CPA engagement, formal scope and dates, requests, and management responses.", steps: ["Create the Audit after the CPA firm is engaged.", "Record the firm-agreed type, scope, systems, criteria, and dates.", "Track incoming requests and approved response material."], types: ["audit", "audit-request"], defaultOpen: true },
      { id: "fieldwork", title: "Fieldwork", description: "Prepare management documents, reconcile Type 2 populations, review both evidence paths, support testing, and build the indexed packet.", steps: ["Initialize engagement-specific management documents and populations.", "Review dated filegrc Evidence and verified External Evidence for the formal period.", "Reconcile complete populations, link samples, and resolve fieldwork requests and findings.", "Build the packet from a clean Git revision; it includes filegrc records, Markdown, External Evidence, attachments, indexes, history, and checksums."], types: ["audit-population", "control-test"], utility: "audit-packet", defaultOpen: true }
    ],
    resourceTypes: ["audit", "audit-request", "audit-population", "control-test"],
    utilities: [
      {
        id: "audit-packet",
        title: "Audit Evidence & Packet",
        instructions: "Review filegrc Evidence and External Evidence for the formal period, complete engagement preparation, and build the indexed audit packet.",
        use: "Prepare management documents and populations, answer fieldwork requests, review both evidence paths, and compile a delivery bound to a clean Git revision.",
        policyBasis: "Management prepares the scoped records, evidence, populations, assertions, and responses. The CPA firm selects samples, evaluates evidence and exceptions, and issues the report.",
        commands: ["filegrc audit-readiness AUDIT_ID --json", "filegrc evidence-packet --audit AUDIT_ID --preview --json"]
      }
    ],
    commands: [
      "filegrc guide audit --json",
      "filegrc prepare-audit AUDIT_ID --json",
      "filegrc audit-readiness AUDIT_ID --json",
      "filegrc evidence-packet --audit AUDIT_ID --preview --json"
    ]
  }
];

export function buildAgentProgramPath(model) {
  return PROGRAM_PATH.map((stage) => {
    const programResourceTypes = [...stage.resourceTypes, ...(stage.supportingResourceTypes || [])];
    const resourcePages = programResourceTypes.map((type, index) => {
      const definition = model.resources[type];
      return {
        order: stage.id === "run" ? null : `${stage.number}.${String.fromCharCode(97 + index)}`,
        type,
        title: definition.pluralTitle,
        instructions: RESOURCE_INSTRUCTIONS[type] || definition.description,
        use: definition.description,
        policyBasis: definition.guidance.policyBasis,
        guide: `npx filegrc guide ${type} --json`,
        list: `npx filegrc list ${type} --json`
      };
    });
    const utilityPages = (stage.utilities || []).map((utility, index) => ({
      order: stage.id === "run" ? null : `${stage.number}.${String.fromCharCode(97 + stage.resourceTypes.length + index)}`,
      utility: utility.id,
      title: utility.title,
      instructions: utility.instructions,
      use: utility.use,
      policyBasis: utility.policyBasis,
      commands: utility.commands.map(agentCommand)
    }));
    return {
      ...stage,
      commands: stage.commands.map(agentCommand),
      pages: stage.id === "run" ? utilityPages : [...resourcePages, ...utilityPages],
      ...(stage.id === "run" ? { operatingRecords: resourcePages } : {})
    };
  });
}

function agentCommand(command) {
  return command.startsWith("filegrc ") ? `npx ${command}` : command;
}

export function resourceProgramContext(type) {
  const stage = PROGRAM_PATH.find((candidate) => (
    candidate.resourceTypes.includes(type) || (candidate.supportingResourceTypes || []).includes(type)
  ));
  if (!stage) return null;
  const index = [...stage.resourceTypes, ...(stage.supportingResourceTypes || [])].indexOf(type);
  return {
    id: stage.id,
    number: stage.number,
    title: stage.title,
    order: stage.id === "run" ? null : `${stage.number}.${String.fromCharCode(97 + index)}`
  };
}

function humanize(value) {
  return String(value || "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
