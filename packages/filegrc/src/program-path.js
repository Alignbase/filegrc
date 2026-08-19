export const RESOURCE_INSTRUCTIONS = {
  program: "Define one management compliance or assurance Program with its goal, bounded Systems, selected Frameworks, Requirement applicability decisions, Controls, owners, risk method, and candidate period.",
  person: "Record each person’s actual organizational job title. Keep named program authority, such as CISO, DPO, Policy Owner, or team chair, in dated Appointment records.",
  appointment: "Record one person’s dated appointment to a named organizational or program responsibility. Scope it to the workspace, a team, or the records governed by that appointment.",
  team: "Review the starter Security and Risk Oversight team, including its members and chair. Membership and chairs are authoritative on the Team record.",
  system: "Start with the complete bounded System management governs or the auditor will examine. Record its purpose, services, boundary, exclusions, Information Types, owners, and continuity objectives.",
  component: "Add a Component only when it materially delivers a selected System, supports a Control, produces authoritative Evidence, or supports relevant operations. Give every System use a role and rationale.",
  vendor: "Catalog material external provider relationships. Link a supplied Component when it meets the Component inclusion rules, but do not mirror every Vendor into a Component.",
  classification: "Define an ordered information-handling category used by inventory and Evidence Artifacts.",
  "information-type": "Define a stable category of information and its default Classification, then link it from Systems, Components, and Vendors.",
  framework: "Confirm the criteria framework and version used for the program.",
  requirement: "Keep the published criterion as catalog content. Record management applicability and rationale on the selected Program.",
  commitment: "Record supplemental customer promises and service requirements that shape the scope or control design. The Commitment’s systemIds and controlIds are authoritative for what fulfills it.",
  policy: "Tailor each Policy to match what the company is committing to. Clear placeholders, assign an owner and separate approver, then bind approval to the reviewed content. Approval does not prove implementation. Activate the Policy during the Step 3 cutover after reviewing its implementation gaps.",
  document: "Tailor the governed plans and other supporting documents the program needs. Assign owners and approvers, then keep the approved Markdown in Git.",
  control: "Finish each applicable starter Control with the procedure people follow, its owner, bounded System scope, operating Components, authoritative evidence-source Components, governing Policy and Requirement mappings, and implementation date. Put calendar and event schedules in Obligations.",
  "complementary-control": "Review whether any in-scope Control depends on a customer or carved-out provider action. Record each real dependency, or confirm that the current scope has none.",
  evidence: "Create an Evidence Artifact when a real export, report, screenshot, signed file, or approved external reference exists. Select its authoritative source Component, link the Controls and operating records it supports, retain the fixed artifact or reference, and have another person verify it before audit use.",
  "risk-assessment": "Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.",
  risk: "Record each risk identified by an assessment or operating activity. Assign an owner, rate it, document the chosen response, and link the Controls that treat it from the Risk record.",
  obligation: "Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.",
  "obligation-event": "When a policy-triggering event occurs, record it here and complete the actions filegrc creates for it.",
  "policy-review": "Record scheduled and change-driven reviews of policies and governed documents, including the decision and any follow-up.",
  meeting: "Record required oversight meetings, including attendees, decisions, minutes, and follow-up work.",
  exception: "Record and approve any time-limited departure from a policy or control before the departure begins.",
  asset: "Keep the inventory of important devices, software, media, and records current, including ownership, custody, and status.",
  "vendor-review": "Document due diligence before relying on a provider, then repeat the review on schedule or after a material change.",
  "access-grant": "Record each person’s or service account’s access to a Component, including approval, provisioning, changes, and removal.",
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
  audit: "Create this record after engaging the CPA firm, then select the Program and record the agreed scope, criteria, Systems, subservice treatments, and report period. Control Tests and Evidence Artifacts link back with auditId or auditIds.",
  "audit-request": "When FileGRC is the approved request tracker, record each request from the audit team, assign an owner and due date, and link the approved response and evidence.",
  "data-request": "Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.",
  "control-test": "Record a management Control Test only when management performs and reviews one. The CPA firm records its own independent testing separately.",
  "audit-population": "Record each complete Type 2 population with its source Component, fixed export, query, count, and reconciliation."
};

export const RESOURCE_PAGE_SUMMARIES = {
  person: "Confirm who works on the program.",
  appointment: "Assign named authority.",
  team: "Confirm shared owners and members.",
  program: "Choose the goal, scope, criteria, controls, owners, and risk method.",
  framework: "Confirm the SOC 2 framework.",
  requirement: "Decide which SOC 2 criteria apply.",
  commitment: "Record customer promises that affect scope.",
  vendor: "List material external providers.",
  system: "Define the service boundary.",
  component: "Connect each material Component to a System.",
  classification: "Define handling levels.",
  "information-type": "Define information categories.",
  policy: "Tailor the starter Policy and have someone other than its owner approve it.",
  document: "Adapt and approve plans.",
  control: "Describe each Control and its evidence source.",
  "complementary-control": "Record customer or provider responsibilities, or confirm there are none.",
  audit: "Record the CPA engagement and scope.",
  "audit-request": "Track fieldwork requests and responses.",
  "audit-population": "Prepare Type 2 populations for sampling.",
  "control-test": "Record management testing when it occurs."
};

export const PROGRAM_PATH = [
  {
    id: "scope",
    number: 1,
    title: "Define Scope",
    description: "Ownership, criteria, and service boundary",
    summary: "Name the owners, criteria, service, Systems, and providers in scope.",
    sections: [
      { id: "ownership", title: "Program Ownership", description: "Confirm the people, appointments, and teams that own, approve, review, and operate the program.", steps: ["Confirm the initial program lead’s actual job title and the separate Policy Owner Appointment.", "Add the organization’s real appointments, reviewers, and operators.", "Review the starter Security and Risk Oversight team, its members, and its chair.", "Add other teams only when the organization assigns shared responsibility to them."], types: ["person", "appointment", "team"], defaultOpen: true },
      { id: "criteria", title: "Program and Criteria", description: "Define the Program, confirm its Frameworks, record Program-scoped Requirement applicability, and connect customer commitments that shape the System or Control design.", steps: ["Confirm the Program goal, owners, risk method, and candidate period.", "Review the included Security criteria references and record each applicability decision on the Program.", "Record customer commitments and keep optional criteria out until the company chooses to add them."], types: ["program", "framework", "requirement", "commitment"], defaultOpen: true },
      { id: "boundary", title: "System Boundary", description: "Start with the bounded System. Add Components that materially deliver the service, support Controls, produce authoritative Evidence, or support relevant operations. Keep Vendor relationships and specific Assets separate.", steps: ["Create the complete bounded System and select it on the Program.", "Add only relevant Components, with a role and rationale for each System use.", "Create Vendors for material external provider relationships and link supplied Components when factual.", "Normalize Information Types and Classifications used by the System, Components, Vendors, Risks, and Evidence Artifacts."], types: ["system", "component", "vendor", "classification", "information-type"], defaultOpen: false }
    ],
    resourceTypes: ["person", "appointment", "team", "program", "framework", "requirement", "commitment", "system", "component", "vendor", "classification", "information-type"],
    commands: [
      "filegrc setup",
      "filegrc guide person --json",
      "filegrc guide appointment --json",
      "filegrc guide system --json",
      "filegrc guide component --json",
      "filegrc review-collection person --scaffold",
      "filegrc review-collection framework --scaffold",
      "filegrc review-collection vendor --scaffold",
      "filegrc review-collection system --scaffold",
      "filegrc review-collection component --scaffold",
      "filegrc list system --json"
    ]
  },
  {
    id: "policies",
    number: 2,
    title: "Approve Policies",
    description: "Tailor, review, and approve",
    summary: "Adapt and approve the starter policies.",
    sections: [
      { id: "library", title: "Policy Library", description: "Review and approve Policy requirements without treating approval as proof of technical implementation.", steps: ["Review Policy Markdown and replace every organization placeholder.", "Confirm the owner, separate approver, audience, review Obligation, and Controls that point to the Policy.", "Record approval against the exact reviewed content. Leave the Policy approved and inactive until the Step 3 implementation cutover."], types: ["policy"], defaultOpen: true }
    ],
    resourceTypes: ["policy"],
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
    description: "Finish controls and their evidence sources",
    summary: "Describe each Control and connect its evidence source.",
    sections: [
      { id: "catalog", title: "Control Catalog", description: "Finish the starter Controls, governed plans, schedules, and authoritative evidence sources, then review the approved Policies together at implementation cutover.", steps: ["Open every planned Control and confirm its mappings and operation pattern.", "Write the real procedure in Record Markdown, add bounded System scope, and map the operating and authoritative evidence-source Components.", "Create or enable every calendar and event schedule as an Obligation. Enabled work remains dormant until its governing Policy is active.", "Confirm each source Component is active, has an evidence-source role and rationale in the Control's System scope, has current access owners, and includes repeatable retrieval instructions in Record Markdown.", "Complete required governed plans, then use Review policy activation on the Controls page to inspect each Policy’s planned or partial Controls, missing Components or sources, missing schedules, and unresolved Exceptions.", "Choose the approved Policies that should take effect, set the real effective date, and confirm the Step 3 cutover. You can activate with a documented gap or approved Exception, but Evidence Readiness still requires active and operating Policies."], types: ["control", "complementary-control", "document"], defaultOpen: true }
    ],
    resourceTypes: ["control", "complementary-control", "document"],
    commands: [
      "filegrc guide control --json",
      "filegrc list control --json",
      "filegrc get CONTROL_ID --mutation",
      "filegrc review-collection complementary-control --scaffold",
      "filegrc activate-policies --scaffold",
      "filegrc evidence-map --json",
      "filegrc program-readiness --json"
    ]
  },
  {
    id: "run",
    number: 4,
    title: "Operate the Program",
    description: "Run the work and retain dated proof",
    summary: "Complete scheduled and event work. Keep dated proof.",
    sections: [
      { id: "risk", title: "Risk", description: "Maintain the program’s risk assessments and risk register as the service, threats, suppliers, and control needs change.", steps: ["Complete and approve risk assessments on schedule and after material changes.", "Record risks that need treatment, acceptance, or ongoing tracking.", "Add or update controls when the assessment identifies a new or changed response."], types: ["risk-assessment", "risk"], defaultOpen: true },
      { id: "queue", title: "Work Queue", description: "Complete recurring work, Policy Event tasks, and assigned follow-up within their required windows.", steps: ["Review proposed work while policies are drafts.", "Complete due work within its allowed window and link dated proof.", "Start Policy Events when hiring, departures, incidents, or material changes occur; every other open Action Item appears here automatically."], types: ["obligation", "obligation-event", "data-request"], utility: "obligation-board", defaultOpen: true },
      { id: "evidence", title: "Evidence Artifacts", description: "Create records only for real exports, reports, screenshots, signed files, or approved external references collected during operation.", steps: ["Create an Evidence Artifact when the artifact exists or an operating record needs fixed supporting proof.", "Select the authoritative source Component, link the Controls and source operating record, and retain the fixed attachment or approved reference.", "Record the collector and Classification, then have another person verify the artifact before audit use."], types: ["evidence"], defaultOpen: true },
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
        summary: "Start a guided checklist when a policy-triggering change occurs.",
        instructions: "Trigger the matching workflow when an event occurs. filegrc adds every required action to the Work Queue with its owner and deadline.",
        use: "Preview the full workflow before triggering it, then create the event and every linked task in one validated write.",
        policyBasis: "Active event Obligations translate policy-triggering changes into owned, deadline-bound Action Items. They remain dormant until their governing Policies are active and effective.",
        commands: ["filegrc obligations --json", "filegrc trigger EVENT_TYPE (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) --subject RESOURCE_ID --json"]
      },
      {
        id: "work-queue",
        title: "Work Queue",
        summary: "Complete scheduled, event-driven, and assigned work by its due date.",
        instructions: "Complete recurring work, Policy Event tasks, and assigned Action Items within their allowed windows, link the requested dated proof, and resolve overdue items.",
        use: "See proposed, upcoming, blocked, due, and overdue policy work together with every open Action Item. Continuous and per-transaction Controls still operate through their Components and need dated operating records or Evidence.",
        policyBasis: "Active and effective Policies start enabled reusable Obligations. Policy Events and source records create owned Action Items. Each occurrence or task retains its own deadline, completion record, and evidence.",
        commands: [
          "filegrc obligations --json",
          "filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD",
          "filegrc complete OBLIGATION_ID completion-mutation.json --json"
        ]
      }
    ],
    commands: [
      "filegrc obligations --json",
      "filegrc trigger EVENT_TYPE (--occurred-on YYYY-MM-DD | --occurred-at RFC3339) --subject RESOURCE_ID --json",
      "filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD",
      "filegrc complete OBLIGATION_ID completion-mutation.json --json",
      "filegrc complete-action ACTION_ITEM_ID --scaffold --completed-on YYYY-MM-DD",
      "filegrc complete-action ACTION_ITEM_ID completion-mutation.json --completed-on YYYY-MM-DD --json",
      "filegrc complete-event OBLIGATION_EVENT_ID --completed-on YYYY-MM-DD --expected-revision REVISION --json",
      "filegrc program-readiness --json"
    ]
  },
  {
    id: "audit",
    number: 5,
    title: "Audit",
    description: "Firm, formal period, fieldwork, and report",
    summary: "Track the CPA engagement, fieldwork, and evidence packet.",
    sections: [
      { id: "engagement", title: "Engagement", description: "Record the actual CPA engagement, formal scope and dates, requests, and management responses.", steps: ["Create the Audit after the CPA firm is engaged.", "Record the firm-agreed type, scope, systems, criteria, and dates.", "Track incoming requests and approved response material."], types: ["audit", "audit-request"], defaultOpen: true },
      { id: "fieldwork", title: "Fieldwork", description: "Prepare management documents, reconcile Type 2 populations, review both evidence paths, support testing, and build the indexed packet.", steps: ["Initialize engagement-specific management documents and populations.", "Review dated FileGRC operating records and verified Evidence Artifacts for the formal period.", "Reconcile complete populations, link samples, and resolve fieldwork requests and Findings.", "Build the packet from a clean Git revision; it includes FileGRC records, Markdown, Evidence Artifacts, attachments, indexes, history, and checksums."], types: ["audit-population", "control-test"], utility: "audit-packet", defaultOpen: true }
    ],
    resourceTypes: ["audit", "audit-request", "audit-population", "control-test"],
    utilities: [
      {
        id: "audit-packet",
        title: "Audit Evidence & Packet",
        summary: "Review readiness and build the evidence packet.",
        instructions: "Review FileGRC operating records and Evidence Artifacts for the formal period, complete engagement preparation, and build the indexed audit packet.",
        use: "Prepare management documents and populations, answer fieldwork requests, review both evidence paths, and compile a delivery bound to a clean Git revision.",
        policyBasis: "Management prepares the scoped records, evidence, populations, assertions, and responses. The CPA firm selects samples, evaluates evidence and exceptions, and issues the report.",
        commands: ["filegrc audit-readiness AUDIT_ID --json", "filegrc evidence-packet --audit AUDIT_ID --preview --json"]
      }
    ],
    commands: [
      "filegrc guide audit --json",
      "filegrc scaffold audit --title \"YEAR SOC 2 TYPE\"",
      "filegrc create AUDIT-MUTATION.json --json",
      "filegrc prepare-audit AUDIT_ID --json",
      "filegrc audit-readiness AUDIT_ID --json",
      "filegrc evidence-packet --audit AUDIT_ID --preview --json"
    ]
  }
];

export function buildAgentProgramPath(model) {
  return PROGRAM_PATH.map((stage) => {
    const programResourceTypes = [...stage.resourceTypes, ...(stage.supportingResourceTypes || [])]
      .filter((type) => model.resources[type]);
    const resourcePages = programResourceTypes.map((type, index) => {
      const definition = model.resources[type];
      return {
        order: stage.id === "run" ? null : `${stage.number}.${String.fromCharCode(97 + index)}`,
        type,
        title: definition.pluralTitle,
        summary: RESOURCE_PAGE_SUMMARIES[type] || definition.description,
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
      summary: utility.summary,
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
