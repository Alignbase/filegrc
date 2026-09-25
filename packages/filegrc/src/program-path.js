import { ACTIVE_MODEL_VERSION, modelSupports } from "../model/index.js";

export const RESOURCE_INSTRUCTIONS = {
  program: "Set the Program goal, owners, Systems, Frameworks, criteria decisions, and risk method.",
  person: "Record the person’s actual job title and current status.",
  appointment: "Assign a named authority to one Person with its start date and scope.",
  team: "Confirm the Team’s members and chair.",
  system: "Define the service boundary, exclusions, owners, and information it handles.",
  component: "Record a material service or evidence source and its role in each linked System.",
  vendor: "Record each material external provider and the Components it supplies.",
  classification: "Confirm the handling categories and apply them to information and evidence.",
  "information-type": "Name a stable category of information, set its default Classification, and link its uses.",
  framework: "Select the criteria Framework and version used by the Program.",
  requirement: "Review whether this criterion applies to the Program and record the decision and rationale.",
  commitment: "Record a real customer or service promise and link the Systems and Controls that fulfill it.",
  "requirement-mapping": "Compare the supplemental source with the Requirement or Control, record the relationship and rationale, then review the source revisions.",
  "reporting-route-set": "Replace the reporting-route placeholders with real normal and fallback channels, name the responsible role, and commit the proposal.",
  policy: "Replace Policy placeholders with actual commitments, then have a separate approver approve the exact Markdown revision.",
  document: "Complete the Document Markdown and intended values, assign an owner, and have a separate approver approve the exact revision.",
  control: "Open this Control’s current next steps. Set up the activity, record how it works, and mark it Implemented when it works.",
  "complementary-control": "Record each real customer or carved-out provider dependency, or confirm that the current scope has none.",
  evidence: "Record a real artifact or approved reference, link its source and supported work, then have another person verify it.",
  "risk-assessment": "Assess the in-scope service, record conclusions, and obtain an independent review.",
  risk: "Name the threat and impact, assign an owner, rate the risk, and record its response.",
  obligation: "Confirm the owner, cadence or trigger, deadline, and proof, then enable the rule when its Control is ready.",
  "retention-schedule-item": "Set the Information Types, scope, cutoff, period, disposition, and sources for one retention rule.",
  "obligation-event": "Record the actual event date and subject, then complete its linked Work Queue actions.",
  "policy-review": "Record the review date, reviewer, decision, and any required follow-up.",
  meeting: "Record attendees, decisions, minutes, and assigned follow-up for the meeting.",
  exception: "Record the scope, owner, approval, and expiry before the departure begins.",
  asset: "Record an important Asset’s owner, custody, location, and status.",
  "vendor-review": "Review one Vendor’s current risk and evidence, then record the decision and follow-up.",
  "access-grant": "Record the approved privilege, recipient, Component, and provisioning or removal dates.",
  "access-review": "Review the current access list, record each decision, and assign the required changes.",
  "service-account": "Record a non-human account’s owner, purpose, System, privilege, and expiry.",
  training: "Complete the content and audience, then have a separate approver approve the exact revision.",
  attestation: "Record the person’s dated acknowledgement of the exact active content revision.",
  "vulnerability-scan": "Record the scan scope, date, result, and supporting evidence.",
  vulnerability: "Track a confirmed weakness through its owner, response, and closure proof.",
  "penetration-test": "Record the test provider, scope, period, results, evidence, and follow-up.",
  incident: "Record the event, response decisions, dates, evidence, and follow-up.",
  "backup-test": "Record the restore target, date, result, evidence, and follow-up.",
  exercise: "Record the scenario, participants, date, result, and follow-up.",
  finding: "Record a confirmed gap that needs its own owner, due date, remediation, and verified closure.",
  "action-item": "Assign separate follow-up with an owner, deadline, source record, and completion proof.",
  audit: "After engaging the CPA firm, record the agreed type, scope, Systems, criteria, and period.",
  "audit-request": "Record the auditor’s request, owner, due date, and approved response.",
  "data-request": "Record the request scope, decision, response, and supporting evidence.",
  "control-test": "Record a management test only when it was performed and reviewed; link its result and evidence.",
  "audit-population": "Record the complete Type 2 population, source query, count, fixed export, and reconciliation."
};

export const RESOURCE_OUTPUTS = {
  program: "A Program record with the selected goal, scope, owners, criteria decisions, and risk method.",
  person: "A Person record with their actual job title and current status.",
  appointment: "A dated Appointment that names the holder, authority, and scope.",
  team: "A Team record with its current members and chair.",
  system: "A bounded System record with its services, data, owners, and exclusions.",
  component: "A Component record linked to each System it supports, with a role and rationale.",
  vendor: "A Vendor record for each material provider relationship.",
  classification: "Reviewed handling categories used by the program's records.",
  "information-type": "An Information Type with its default Classification and actual uses.",
  framework: "The Framework and version selected for the Program.",
  requirement: "A reviewed applicability decision on the Program for each selected Requirement.",
  commitment: "A Commitment linked to the Systems and Controls that fulfill it.",
  "requirement-mapping": "A reviewed mapping with its comparison, rationale, and source revisions.",
  "reporting-route-set": "A proposed set of normal and fallback reporting routes with an owner and approval path.",
  policy: "An independently approved Policy bound to its exact Markdown revision.",
  document: "A governed Document with reviewed Markdown, an owner, and a separate approver.",
  control: "An implemented Control with its actual procedure, scope, owner, source, and start date.",
  "complementary-control": "A recorded customer or provider dependency, or a current review confirming none.",
  evidence: "A verified Evidence Artifact linked to its source and supported work.",
  "risk-assessment": "A completed, independently reviewed Risk Assessment with its conclusions.",
  risk: "A rated Risk with an owner, response, and linked treatment Controls.",
  obligation: "An enabled schedule or event rule with an owner, deadline, and required proof.",
  "retention-schedule-item": "A reviewed retention row with its scope, cutoff, period, disposition, and sources.",
  "obligation-event": "A dated Policy Event with its linked Work Queue actions.",
  "policy-review": "A dated review with its decision, reviewer, and follow-up.",
  meeting: "Meeting minutes with attendees, decisions, and assigned follow-up.",
  exception: "A time-limited Exception with approval, scope, and expiry.",
  asset: "An inventory record with the Asset's owner, custody, and status.",
  "vendor-review": "A dated Vendor Review with a decision, evidence, and follow-up.",
  "access-grant": "A current Access Grant showing approval, privilege, and lifecycle dates.",
  "access-review": "A dated Access Review with decisions and assigned changes.",
  "service-account": "A Service Account record with its owner, purpose, privilege, and expiry.",
  training: "Approved Training content bound to its exact revision.",
  attestation: "A person's dated acknowledgement bound to the exact content revision.",
  "vulnerability-scan": "A dated scan record with scope, results, and linked evidence.",
  vulnerability: "A tracked weakness with its owner, response, and closure proof.",
  "penetration-test": "A test record with scope, provider, results, and follow-up.",
  incident: "An Incident record with response decisions, dates, evidence, and follow-up.",
  "backup-test": "A dated restore test with its result, evidence, and follow-up.",
  exercise: "A dated exercise with participants, result, and follow-up.",
  finding: "A confirmed Finding with an owner, due date, remediation, and verified closure.",
  "action-item": "An assigned Action Item with a deadline and completion proof.",
  audit: "An Audit record with the CPA-agreed type, scope, and period.",
  "audit-request": "An owned Audit Request with a due date and approved response.",
  "data-request": "A Data Request record with its scope, decision, and response.",
  "control-test": "A reviewed management Control Test with results and linked evidence.",
  "audit-population": "A reconciled Type 2 population linked to its fixed source export."
};

export const RESOURCE_PAGE_SUMMARIES = {
  person: "Confirm who works on the program.",
  appointment: "Assign named authority.",
  team: "Confirm shared owners and members.",
  program: "Choose the goal, scope, criteria, controls, owners, and risk method.",
  framework: "Confirm the SOC 2 framework.",
  requirement: "Decide which SOC 2 criteria apply.",
  commitment: "Record customer promises that affect scope.",
  "requirement-mapping": "Review how supplemental promises relate to Requirements and Controls.",
  "reporting-route-set": "Set the normal and fallback ways people report security concerns.",
  vendor: "List material external providers.",
  system: "Define the service boundary.",
  component: "Connect each material Component to a System.",
  classification: "Define handling levels.",
  "information-type": "Define information categories.",
  "retention-schedule-item": "Review each structured retention rule.",
  policy: "Tailor the starter Policy and have someone other than its owner approve it.",
  document: "Adapt and approve plans.",
  control: "Put each Control in place and record how it works.",
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
    summary: "A reviewed Program scope with owners, criteria, Systems, and material providers.",
    sections: [
      { id: "ownership", title: "Program Ownership", description: "Confirm who owns the program, plus the normal security reporting channel and its fallback.", steps: ["Confirm the program lead, policy owner, independent reviewer, and oversight team.", "Replace the reporting-channel placeholders with real normal and fallback routes, then commit the proposal."], types: ["person", "appointment", "team", "reporting-route-set"], defaultOpen: true },
      { id: "criteria", title: "Program and Criteria", description: "Define the Program, confirm its Frameworks, record Program-scoped Requirement applicability, and connect customer commitments that shape the System or Control design.", steps: ["Set the Program goal, owners, risk method, and tentative timing.", "Review each selected criterion for this service and record its applicability decision.", "Replace the starter Commitment prompt with the real promise; add only needed supplemental mappings."], types: ["program", "framework", "requirement", "commitment", "requirement-mapping"], defaultOpen: true },
      { id: "boundary", title: "System Boundary", description: "Start with the bounded System. Add Components that materially deliver the service, support Controls, produce authoritative Evidence, or support relevant operations. Keep Vendor relationships and specific Assets separate.", steps: ["Define the service and exclusions in a bounded System selected by the Program.", "Add material Components and Vendors with their actual System relationships.", "Record the Information Types and Classifications the service uses."], types: ["system", "component", "vendor", "classification", "information-type"], defaultOpen: false }
    ],
    resourceTypes: ["person", "appointment", "team", "reporting-route-set", "program", "framework", "requirement", "commitment", "requirement-mapping", "system", "component", "vendor", "classification", "information-type"],
    commands: [
      "filegrc setup",
      "filegrc guide person --json",
      "filegrc guide appointment --json",
      "filegrc reporting-route-sets --json",
      "filegrc guide system --json",
      "filegrc guide component --json",
      "filegrc guide requirement-mapping --json",
      "filegrc review-collection vendor --scaffold",
      "filegrc review-collection classification --scaffold",
      "filegrc review-collection information-type --scaffold",
      "filegrc list system --json"
    ]
  },
  {
    id: "policies",
    number: 2,
    title: "Approve Policies",
    description: "Approve governed content and retention decisions",
    summary: "Approved Policies, program Documents, Training content, and retention decisions.",
    sections: [
      { id: "policy-content", title: "Policies", description: "Approve the program's governing content.", instructions: "Open each Policy, program Document, and Training record. Replace placeholders, confirm the owner and intended values, then have a separate person approve the exact Markdown revision.", output: "Approved content bound to the reviewed revisions.", steps: ["Replace placeholders with the company's real rules, plans, and training material.", "Confirm the owner, separate approver, linked Controls, audience, and intended values.", "Record the independent approval and date against each exact Markdown revision."], types: [], relatedLinks: [{ type: "policy", label: "Policies", href: "#/policies" }], defaultOpen: true },
      { id: "retention", title: "Data Retention Schedule", description: "Approve the schedule document and its completed rows together.", steps: ["Review the governing schedule and any legal hold or exception rules.", "Complete a row for each distinct information use, cutoff, retention period, and disposition.", "Have a separate reviewer approve the complete document and row set."], types: [], utility: "retention-schedule", defaultOpen: true }
    ],
    resourceTypes: [],
    supportingResourceTypes: ["policy", "document", "training", "retention-schedule-item"],
    commands: [
      "filegrc guide policy --json",
      "filegrc guide document --json",
      "filegrc guide training --json",
      "filegrc list policy --json",
      "filegrc list document --json",
      "filegrc list training --json",
      "filegrc get POLICY_ID --mutation",
      "filegrc guide retention-schedule-item --json",
      "filegrc review-collection retention-schedule-item --scaffold"
    ]
  },
  {
    id: "controls",
    number: 3,
    title: "Implement Controls",
    description: "Implement and prepare to operate",
    summary: "Implemented Controls with ready evidence sources and enabled work schedules.",
    sections: [
      { id: "controls", title: "Controls", description: "Put each selected Control into use and record what is actually in place.", steps: ["Open each Control for its specific setup action and current missing checks.", "Configure the activity and record its procedure, Systems, owner, and evidence sources.", "Mark it Implemented with its real start date after its sources and schedules are ready."], types: ["control"], defaultOpen: true },
      { id: "complementary-controls", title: "Complementary Controls", description: "Record customer or provider responsibilities that form part of the implementation boundary, or confirm there are none.", steps: ["Identify any customer or carved-out provider action an in-scope Control depends on.", "Record each dependency, or confirm that the current scope has none."], types: ["complementary-control"], defaultOpen: true },
      { id: "evidence-sources", title: "Evidence Sources", description: "Check that every Control points to an authoritative source that can produce its expected evidence.", steps: ["For each Control family, link an active Component with the required source kind, access owners, and retrieval instructions."], types: [], utility: "evidence-sources", defaultOpen: true },
      { id: "obligations", title: "Obligations", description: "Configure the calendar and event schedules that operate the Controls.", steps: ["Check the owner, trigger or cadence, due window, and required proof for each Obligation.", "Enable the rules that will run the implemented Controls."], types: ["obligation"], defaultOpen: true }
    ],
    resourceTypes: ["control", "complementary-control", "obligation"],
    commands: [
      "filegrc guide control --json",
      "filegrc list control --json",
      "filegrc get CONTROL_ID --mutation",
      "filegrc guide obligation --json",
      "filegrc list obligation --json",
      "filegrc review-collection component --scaffold",
      "filegrc review-collection complementary-control --scaffold",
      "filegrc review-collection control --scaffold",
      "filegrc activate-content --scaffold",
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
    summary: "Dated operating records and linked proof for work actually performed.",
    sections: [
      { id: "risk", title: "Risk", description: "Maintain the program’s risk assessments and risk register as the service, threats, suppliers, and control needs change.", steps: ["Complete and approve the required Risk Assessments.", "Record each risk that needs a response, owner, and treatment Controls."], types: ["risk-assessment", "risk"], defaultOpen: true },
      { id: "queue", title: "Work Queue", description: "Complete recurring occurrences, Policy Event tasks, and assigned follow-up within their required windows.", steps: ["Complete due Work Queue occurrences with dated proof.", "Trigger a Policy Event when its real-world event occurs, then complete the linked Action Items."], types: ["obligation-event", "data-request"], utility: "obligation-board", defaultOpen: true },
      { id: "evidence", title: "Evidence Artifacts", description: "Create records only for real exports, reports, screenshots, signed files, or approved external references collected during operation.", steps: ["Create an Evidence Artifact only when a real file or approved external reference exists.", "Link its source Component, supported Controls and work record, and fixed artifact or reference.", "Record the collector and Classification, then verify the artifact."], types: ["evidence"], defaultOpen: true },
      { id: "governance", title: "Governance", description: "Record formal reviews, oversight meetings, and approved policy or control exceptions.", steps: ["Complete scheduled policy reviews and oversight meetings with decisions and evidence.", "Create separate Action Items only for follow-up with its own owner and deadline.", "Approve any time-limited Exception before the departure begins."], types: ["policy-review", "meeting", "exception"], defaultOpen: false },
      { id: "inventories", title: "Assets and Vendors", description: "Maintain the asset inventory and recurring reviews of supplier relationships during operation.", steps: ["Keep important Assets and Vendor relationships current.", "Complete Vendor Reviews on schedule or after material changes, with a decision and evidence."], types: ["asset", "vendor-review"], defaultOpen: false },
      { id: "access-training", title: "Access and Training Completion", description: "Inventory service accounts and retain access decisions, Training assignments, and acknowledgements produced during operation.", steps: ["Catalog Service Accounts that need separate tracking.", "Record access decisions and removals as they occur; complete scheduled Access Reviews.", "Keep Training assignments and Attestations tied to the exact active content revision."], types: ["service-account", "access-grant", "access-review", "attestation"], defaultOpen: false },
      { id: "security", title: "Security Operations", description: "Record vulnerability work, applicable penetration testing, and incident response activity for the period.", steps: ["Record required scans and tests with their real scope, results, and evidence.", "Track confirmed weaknesses and their remediation.", "Start the Incident workflow when a qualifying event occurs."], types: ["vulnerability-scan", "vulnerability", "penetration-test", "incident"], defaultOpen: false },
      { id: "resilience", title: "Resilience", description: "Preserve proof that backups, restoration, continuity, and incident exercises work as designed.", steps: ["Run scheduled restore tests and continuity or incident exercises.", "Record the result and evidence, then assign follow-up for failed objectives."], types: ["backup-test", "exercise"], defaultOpen: false },
      { id: "issues", title: "Issues and Remediation", description: "Keep observations in the source report and track only confirmed gaps that need a separate remediation lifecycle.", steps: ["Create a Finding for a confirmed gap that needs a separate owner, deadline, or closure review.", "Use Action Items only for separately assigned tasks.", "Close the Finding after remediation is independently verified."], types: ["finding"], defaultOpen: false }
    ],
    resourceTypes: [
      "risk-assessment",
      "risk",
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
        policyBasis: "Active and effective Policies start enabled reusable Obligations. Each calendar occurrence stays one rolled-up item whose reconciliation binds the selected population to its completion records. Policy Events and source records create owned Action Items.",
        commands: [
          "filegrc obligations --json",
          "filegrc activate-obligation-rule RULE_ID --scaffold",
          "filegrc complete OBLIGATION_ID --scaffold --window-start YYYY-MM-DD --completed-on YYYY-MM-DD",
          "filegrc complete OBLIGATION_ID completion-mutation.json --json",
          "filegrc reconcile-obligation OBLIGATION_ID --scaffold --window-start YYYY-MM-DD"
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
    summary: "A CPA engagement record and a reviewable, period-bound evidence packet.",
    sections: [
      { id: "engagement", title: "Engagement", description: "Record the actual CPA engagement, formal scope and dates, requests, and management responses.", steps: ["After engaging the CPA firm, create the Audit with its agreed type, scope, and date or period.", "Track firm requests with owners, due dates, and approved responses."], types: ["audit", "audit-request"], defaultOpen: true },
      { id: "fieldwork", title: "Fieldwork", description: "Complete engagement documents, populations, requests, and the evidence packet.", steps: ["Complete engagement Documents and, for Type 2, reconcile each population to its fixed export.", "Review dated operating records and verified Evidence Artifacts for the agreed period; link samples and answer requests.", "Build and review the indexed packet from a clean Git revision."], types: ["audit-population", "control-test"], relatedLinks: [{ type: "document", label: "Audit Documents", href: "#/resources/document?stage=audit&documentScope=audit", summary: "Complete and approve engagement Documents, then link the required ones from each Audit.", instructions: "Complete each required engagement Document, link it from its Audit, obtain separate approval of the exact Markdown revision, then activate that approved revision for that Audit.", output: "Active Audit Documents linked to their Audits and bound to their approved revisions." }], utility: "audit-packet", defaultOpen: true }
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
      "filegrc guide document --json",
      "filegrc list document --json",
      "filegrc scaffold audit --title \"YEAR SOC 2 TYPE\"",
      "filegrc create AUDIT-MUTATION.json --json",
      "filegrc prepare-audit AUDIT_ID --json",
      "filegrc activate-documents --scaffold --audit AUDIT_ID",
      "filegrc audit-readiness AUDIT_ID --json",
      "filegrc evidence-packet --audit AUDIT_ID --preview --json"
    ]
  }
];

export function programPathForModel(model = ACTIVE_MODEL_VERSION) {
  if (modelSupports(model, "retention-schedule-approval")) return PROGRAM_PATH;
  return PROGRAM_PATH.map((stage) => {
    if (stage.id === "policies") {
      return {
        ...stage,
        description: "Review governed content and approvals",
        summary: "Review and independently approve Policies, program Documents, and Training content.",
        sections: [{
          ...stage.sections[0],
          relatedLinks: [{ type: "policy", label: "Policies", href: "#/stage/policies" }]
        }],
        supportingResourceTypes: stage.supportingResourceTypes.filter((type) => type !== "retention-schedule-item"),
        commands: stage.commands.filter((command) => !command.includes("retention-schedule-item"))
      };
    }
    if (stage.id === "controls") {
      const retention = {
        id: "retention",
        title: "Retention Schedule",
        description: "Review each retention rule against current information uses and approved sources.",
        steps: ["Confirm scope, cutoff, period, disposition, sources, owner, and approval for each rule."],
        types: ["retention-schedule-item"],
        defaultOpen: true
      };
      return {
        ...stage,
        description: "Finish controls and their evidence sources",
        summary: "Describe each Control and connect its evidence source.",
        sections: [...stage.sections.slice(0, 3), retention, ...stage.sections.slice(3)],
        resourceTypes: [...stage.resourceTypes.slice(0, 2), "retention-schedule-item", ...stage.resourceTypes.slice(2)],
        commands: [
          ...stage.commands.slice(0, 5),
          "filegrc guide retention-schedule-item --json",
          "filegrc review-collection retention-schedule-item --scaffold",
          ...stage.commands.slice(5)
        ]
      };
    }
    return stage;
  });
}

export function buildAgentProgramPath(model) {
  return programPathForModel(model).map((stage) => {
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
        output: RESOURCE_OUTPUTS[type] || `A validated ${definition.title} record.`,
        use: definition.description,
        policyBasis: definition.guidance.policyBasis,
        guide: `npx filegrc guide ${type} --json`,
        list: `npx filegrc list ${type} --json`
      };
    });
    const relatedPages = stage.sections.flatMap((section) => section.relatedLinks || [])
      .filter((link) => link.instructions)
      .map((link, index) => ({
        order: `${stage.number}.${String.fromCharCode(97 + stage.resourceTypes.length + index)}`,
        type: link.type,
        title: link.label,
        summary: link.summary,
        instructions: link.instructions,
        output: link.output,
        guide: `npx filegrc program-path --json`,
        list: `npx filegrc list ${link.type} --json`
      }));
    const utilityPages = (stage.utilities || []).map((utility, index) => ({
      order: stage.id === "run" ? null : `${stage.number}.${String.fromCharCode(97 + stage.resourceTypes.length + relatedPages.length + index)}`,
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
      pages: stage.id === "run" ? utilityPages : [...resourcePages, ...relatedPages, ...utilityPages],
      ...(stage.id === "run" ? { operatingRecords: resourcePages } : {})
    };
  });
}

function agentCommand(command) {
  return command.startsWith("filegrc ") ? `npx ${command}` : command;
}

export function resourceProgramContext(type, model) {
  const stage = programPathForModel(model).find((candidate) => (
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
