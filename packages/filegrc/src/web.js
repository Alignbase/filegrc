import { createResourceId } from "./id.js";
import {
  calendarOccurrence,
  calendarOccurrenceIndex,
  formatCalendarDateUtc,
  nextCalendarOccurrence,
  parseCalendarDate,
  utcCalendarDate,
  validCalendarRecurrence
} from "./recurrence.js";
import { formatCalendarDate, formatLocalDateTime } from "./time.js";

export function renderIndex(state = null) {
  const snapshot = state
    ? `<script id="filegrc-data" type="application/json">${safeJson(state)}</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>FileGRC</title>
  <link rel="icon" type="image/png" href="./favicon.png">
  <link rel="stylesheet" href="./filegrc.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div id="app"><div class="loading">Loading workspace…</div></div>
  ${snapshot}
  <script src="./filegrc-app.js" defer></script>
</body>
</html>`;
}

export const APP_SCRIPT = String.raw`
const root = document.querySelector("#app");
let state;
const LIST_PAGE_SIZE = 25;
const SEARCH_PAGE_SIZE = 25;
const NAV_GROUP_STORAGE_KEY = "filegrc.sidebar.groups.v3";
let latestPacketResult = null;
let latestPacketState = null;
const READINESS_STAGES = [
  {
    id: "scope",
    number: "1",
    title: "Define Scope",
    description: "Ownership, criteria, and service boundary",
    summary: "Confirm the people and teams responsible for the program, set the management goal, review the criteria and customer commitments in scope, then define the customer-facing service, supporting systems, and supplier dependencies.",
    sections: [
      { id: "ownership", title: "Program Ownership", description: "Confirm the people and teams that own, approve, review, and operate the program.", steps: ["Replace the starter people with the organization’s actual owners and reviewers.", "Review the starter Security and Risk Oversight team, its members, and its chair.", "Add other teams only when the organization assigns shared responsibility to them."], types: ["person", "team"], defaultOpen: true },
      { id: "criteria", title: "Criteria", description: "Confirm the criteria used for the program, resolve whether each requirement applies, and record customer commitments that shape the service or control design.", steps: ["Review the included Security criteria references.", "Mark each requirement applicable or not applicable with a rationale.", "Record customer commitments and keep optional criteria out until management deliberately adds them."], types: ["framework", "requirement", "commitment"], defaultOpen: true },
      { id: "boundary", title: "Service Boundary", description: "Record the service and its supporting technology and providers. An application or platform is a System because it operates controls or produces evidence; the company providing it is a Vendor because contracts, due diligence, and supplier risk belong to that relationship.", steps: ["Create a Vendor record for each material provider.", "Create System records for the customer-facing service and each supporting application, platform, or internal system that is in scope or produces evidence, then connect vendor-provided Systems to their providers.", "Assign owners, classification, dependencies, and a clear in-scope decision to each System, and keep supplier reviews with the Vendor."], types: ["vendor", "system"], defaultOpen: false }
    ]
  },
  {
    id: "policies",
    number: "2",
    title: "Approve Policies",
    description: "Tailor, review, approve, and adopt",
    summary: "Turn every applicable policy and governed plan into the organization’s actual rules, remove placeholders, link governed controls, and establish approval and effective dates before scheduled work begins. The reviewer must be separate from the owner, is usually internal, and may be external.",
    sections: [
      { id: "library", title: "Policy Library", description: "Review, approve, and activate policies and governed plans without treating starter text as adopted practice.", steps: ["Review policy Markdown and replace every organization placeholder.", "Confirm the owner, separate approver, audience, linked controls, and review cadence.", "Record approval and effective dates before changing the status to active."], types: ["policy", "document"], defaultOpen: true }
    ]
  },
  {
    id: "controls",
    number: "3",
    title: "Implement Controls",
    description: "Tailor and finish the starter control set",
    summary: "Review the starter catalog against the scoped service, then give every applicable internal control an actual procedure, owner, system scope, cadence, policy and criteria mappings, authoritative evidence source, and implementation date. Mark it implemented only after the procedure is operating, then record any controls that customers or carved-out providers must perform.",
    sections: [
      { id: "catalog", title: "Control Catalog", description: "Finish the starter controls, record applicable complementary controls, and see whether FileGRC tracks operation through Work Queue or evidence records.", steps: ["Open every planned control and confirm its mappings and suggested frequency.", "Write the real procedure in Record Markdown and add system scope and evidence sources.", "Record any required customer or carved-out provider controls as Complementary Controls."], types: ["control", "complementary-control"], defaultOpen: true }
    ]
  },
  {
    id: "evidence",
    number: "4",
    title: "Prepare Evidence",
    description: "Connect sources and prove collection works",
    summary: "Before the candidate period starts, link controls to their authoritative Systems, record the export owner and repeatable extraction instructions, and save a verified test export or capture for every selected control family.",
    sections: [
      { id: "collection", title: "Evidence Setup", description: "Connect authoritative systems first, then verify a real test export or capture for every selected control family.", steps: ["Treat an application as a System when it operates a control or produces evidence.", "If a third party provides that application, also create a Vendor and link the System to it.", "Create verified test-export or test-capture Evidence linked to the source System and control."], relatedLinks: [{ label: "Source Systems", href: "#/resources/system" }, { label: "Controls", href: "#/resources/control" }], types: ["evidence"], defaultOpen: true }
    ]
  },
  {
    id: "run",
    number: "5",
    title: "Operate the Program",
    description: "Run the work and retain dated proof",
    summary: "Record the management candidate start date when reliable evidence collection begins. Maintain current risk assessments and risks, updating the control set when needed. Complete recurring and event-driven work, run continuous and per-transaction controls, and keep dated evidence current throughout the period.",
    sections: [
      { id: "risk", title: "Risk", description: "Maintain the program’s risk assessments and risk register as the service, threats, suppliers, and control needs change.", steps: ["Complete and approve risk assessments on schedule and after material changes.", "Record risks that need treatment, acceptance, or ongoing tracking.", "Add or update controls when the assessment identifies a new or changed response."], types: ["risk-assessment", "risk"], defaultOpen: true },
      { id: "queue", title: "Work Queue", description: "Complete recurring, event-driven, privacy, and contractual work within its required window.", steps: ["Review proposed work while policies are drafts.", "Complete due work within its allowed window and link dated proof.", "Start event workflows when hiring, departures, incidents, or material changes occur, and track applicable data requests through completion."], types: ["obligation", "obligation-event", "data-request"], utility: "obligation-board", defaultOpen: true },
      { id: "governance", title: "Governance", description: "Record formal reviews, oversight meetings, and approved policy or control exceptions.", steps: ["Complete scheduled policy reviews and oversight meetings.", "Record decisions, attendees, follow-up work, and evidence.", "Approve time-bound exceptions before the departure begins."], types: ["policy-review", "meeting", "exception"], defaultOpen: false },
      { id: "inventories", title: "Assets and Vendors", description: "Maintain the asset inventory and recurring reviews of supplier relationships during operation.", steps: ["Keep ownership, custody, status, and lifecycle current for important assets.", "Perform vendor reviews on schedule and after material supplier changes.", "Link fixed reports and review evidence to the operating records."], types: ["asset", "vendor-review"], defaultOpen: false },
      { id: "access-training", title: "Access and Training", description: "Inventory service accounts before recording access decisions, periodic reviews, assignments, and acknowledgements.", steps: ["Catalog service accounts that need separate tracking.", "Preserve access approvals and removals as they occur, then complete periodic access reviews and resolve exceptions.", "Assign training and retain acknowledgement evidence for the exact content revision."], types: ["service-account", "access-grant", "access-review", "training", "attestation"], defaultOpen: false },
      { id: "security", title: "Security Operations", description: "Record vulnerability work, independent testing, and incident response activity for the period.", steps: ["Retain scan scope, results, vulnerabilities, remediation, and exceptions.", "Track penetration testing and follow-up findings.", "Start the incident workflow when a qualifying event occurs."], types: ["vulnerability-scan", "vulnerability", "penetration-test", "incident"], defaultOpen: false },
      { id: "resilience", title: "Resilience", description: "Preserve proof that backups, restoration, continuity, and incident exercises work as designed.", steps: ["Record backup restoration tests and their results.", "Run continuity and incident exercises on schedule.", "Assign and close follow-up work from failed objectives or lessons learned."], types: ["backup-test", "exercise"], defaultOpen: false },
      { id: "issues", title: "Issues and Remediation", description: "Track identified gaps and their corrective work through independent verification.", steps: ["Create a Finding when a review, test, incident, risk assessment, or audit identifies a gap.", "Use Action Items for owned remediation work and link them back to the Finding.", "Close the Finding only after remediation is independently verified."], types: ["finding", "action-item"], defaultOpen: false }
    ]
  },
  {
    id: "audit",
    number: "6",
    title: "Audit",
    description: "Firm, formal period, fieldwork, and report",
    summary: "After the program is collecting reliable evidence, create an Audit record for the real CPA engagement, keep the firm-agreed report period separate from management’s candidate dates, complete management documents, populations, requests, evidence delivery, and fieldwork, then preserve the findings, responses, opinion, and final report.",
    sections: [
      { id: "engagement", title: "Engagement", description: "Record the actual CPA engagement, formal scope and dates, requests, and management responses.", steps: ["Create the Audit after the CPA firm is engaged.", "Record the firm-agreed type, scope, systems, criteria, and dates.", "Track incoming requests and approved response material."], types: ["audit", "audit-request"], defaultOpen: true },
      { id: "fieldwork", title: "Fieldwork", description: "Prepare management documents, reconcile Type 2 populations, support testing, and build the indexed packet.", steps: ["Initialize engagement-specific management documents and populations.", "Reconcile complete populations to authoritative source exports before linking them to control tests.", "Link sample evidence and resolve fieldwork requests and findings.", "Build a delivery packet from a clean Git revision."], types: ["audit-population", "control-test"], utility: "audit-packet", defaultOpen: true }
    ]
  }
];
const STAGE_PAGE_SUMMARIES = {
  person: "Confirm the people who will own, approve, review, or operate the program. Replace the starter names and contact details with the organization’s actual people.",
  team: "Review the starter Security and Risk Oversight team, including its members and chair. Add another team only when the organization assigns shared responsibility to it.",
  system: "Catalog all in-scope systems for the program. Treat anything that operates a control or produces evidence as a System, including software provided by a vendor (like HR software).",
  vendor: "Catalog the companies that provide in-scope software or services. Link each vendor-provided System to the company that provides it.",
  framework: "Confirm the criteria framework and version used for the program.",
  requirement: "Review each criterion, decide whether it applies, and record the reason for that decision.",
  commitment: "Record supplemental customer promises and service requirements that shape the scope or control design.",
  policy: "Tailor each policy to match how the organization works. Clear placeholders, assign an owner and separate approver, then record its approval and effective dates.",
  document: "Tailor the governed plans and other supporting documents the program needs. Assign owners and approvers, then keep the approved Markdown in Git.",
  control: "Finish each applicable starter control with the procedure people will follow, its owner, scope, cadence, evidence source, and implementation date.",
  "complementary-control": "Record anything customers or carved-out providers must do for your controls to work as intended.",
  evidence: "Collect a real test export or capture for each selected control family. Link it to the control and source System, then record who collected and verified it.",
  "risk-assessment": "Complete and approve an assessment of the risks to the in-scope service, systems, vendors, and commitments.",
  risk: "Record each risk identified by an assessment or operating activity. Assign an owner, rate it, and document the chosen response.",
  obligation: "Review the recurring work proposed by effective policies. Confirm who owns it, when it is due, and what proof completion requires.",
  "obligation-event": "When a policy-triggering event occurs, record it here and complete the actions FileGRC creates for it.",
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
  finding: "Record a confirmed gap identified by a review, test, assessment, incident, meeting, or audit, then track it through verified closure.",
  "action-item": "Assign and track a specific piece of follow-up work from another program record.",
  audit: "Create this record after engaging the CPA firm, then record the agreed scope, criteria, Systems, and report period.",
  "audit-request": "Record each request from the audit team, assign an owner and due date, and link the approved response and evidence.",
  "data-request": "Record privacy or contractual requests when they apply to the audit scope or the organization’s commitments.",
  "control-test": "Record how an in-scope control was tested, what was sampled, the result, and any exceptions.",
  "audit-population": "Record each complete Type 2 population with its source System, fixed export, query, count, and reconciliation.",
  "utility:audit-packet": "Complete the engagement documents and populations, respond to fieldwork, and build the indexed evidence packet."
};
const STAGE_PAGE_ID_ALIASES = {
  "controls:complementary-control": ["scope:complementary-control"]
};
const OBLIGATION_COMPLETION_TYPES = {
  "access-review": "access-review",
  "backup-test": "backup-test",
  "continuity-review": "evidence",
  exercise: "exercise",
  "inventory-review": "evidence",
  "log-review": "evidence",
  meeting: "meeting",
  "network-review": "evidence",
  "penetration-test": "penetration-test",
  "performance-review": "evidence",
  "policy-review": "policy-review",
  "risk-assessment": "risk-assessment",
  "security-scan": "evidence",
  training: "attestation",
  "vendor-review": "vendor-review",
  "vulnerability-scan": "vulnerability-scan"
};
const RECORD_TEXT_FIELDS = new Set(["description", "statement", "activity", "purpose", "scope", "objective", "applicabilityRationale", "summary", "rationale", "acceptanceRationale", "businessPurpose", "changeSummary", "decisionSummary", "decisionRationale", "recommendation", "remediationPlan", "auditorNotes", "notPerformedReason"]);
const TITLE_CASE_MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "per", "the", "to", "via", "vs"]);
const navigationGroupState = readNavigationGroupState();
let onboardingDialog = null;
let onboardingShade = null;
let onboardingStep = 0;
let onboardingDraft = null;
let onboardingBusy = false;
let resourceGuideCleanup = null;

start().catch((error) => {
  root.innerHTML = '<main class="fatal"><h1>Could Not Load the Workspace</h1><pre></pre></main>';
  root.querySelector("pre").textContent = error.stack || error.message;
});

async function start() {
  const embedded = document.querySelector("#filegrc-data");
  state = embedded ? JSON.parse(embedded.textContent) : await fetchJson("/api/state");
  window.addEventListener("hashchange", render);
  window.addEventListener("resize", positionCurrentOnboarding);
  window.addEventListener("scroll", positionCurrentOnboarding, true);
  render();
  if (!state.readOnly && rendererSettingsEntry()?.record.showOnboarding === true) {
    queueMicrotask(requestOnboarding);
  }
}

function render() {
  resourceGuideCleanup?.();
  resourceGuideCleanup = null;
  const route = parseRoute();
  const nav = buildNavigation(route);
  root.innerHTML = '<div class="shell">' + nav + '<div class="workspace"><header class="topbar">' + topbar(route) + '</header><main id="main"></main></div></div>';
  const main = root.querySelector("main");
  if (route.name === "home") renderHome(main);
  else if (route.name === "stage") renderStageOverview(main, route.stageId, route.params);
  else if (route.name === "obligations") renderObligations(main, route.params);
  else if (route.name === "audit-packet") renderAuditPacket(main, route.params);
  else if (route.name === "list") renderList(main, route.type, route.params);
  else if (route.name === "detail") renderDetail(main, route.type, route.id);
  else if (route.name === "organization") renderOrganization(main);
  else if (route.name === "repository") renderRepository(main);
  else renderNotFound(main);
  bindCommon();
}

function parseRoute() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?", 2);
  let parts;
  try {
    parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { name: "missing" };
  }
  if (!parts.length) return { name: "home" };
  if (parts.length === 2 && parts[0] === "stage" && parts[1]) return { name: "stage", stageId: parts[1], params: new URLSearchParams(query) };
  if (parts.length === 1 && parts[0] === "obligations") return { name: "obligations", params: new URLSearchParams(query) };
  if (parts.length === 1 && parts[0] === "audit-packet") return { name: "audit-packet", params: new URLSearchParams(query) };
  if (parts.length === 2 && parts[0] === "resources" && parts[1]) return { name: "list", type: parts[1], params: new URLSearchParams(query) };
  if (parts.length === 3 && parts[0] === "resource" && parts[1] && parts[2]) return { name: "detail", type: parts[1], id: parts[2] };
  if (parts.length === 1 && parts[0] === "organization") return { name: "organization" };
  if (parts.length === 1 && parts[0] === "repository") return { name: "repository" };
  return { name: "missing" };
}

function buildNavigation(route) {
  const currentStage = readinessStageForRoute(route);
  const stages = READINESS_STAGES.map((stage) => {
    const stagePageCurrent = (route.name === "stage" && route.stageId === stage.id)
      || (stage.id === "run" && route.name === "obligations");
    const stageOpen = navigationGroupState[stage.id] ?? currentStage?.id === stage.id;
    const sections = stage.sections.map((section) => {
      const sectionKey = stage.id + ":" + section.id;
      const sectionCurrent = (route.type && section.types.includes(route.type))
        || (section.utility === "obligation-board" && route.name === "obligations")
        || (section.utility === "audit-packet" && route.name === "audit-packet");
      const sectionOpen = navigationGroupState[sectionKey] ?? (sectionCurrent || section.defaultOpen);
      const resources = section.types
        .map((type) => [type, state.model.resources[type]])
        .filter(([, definition]) => definition);
      const direct = stage.sections.length === 1 || sectionDestinations(section).length === 1;
      const links = resources.map(([type, definition]) => {
        return '<a class="' + (direct ? "nav-direct " : "") + (route.type === type ? "current" : "") + '" href="#/resources/' + encodeURIComponent(type) + '"><span>' + esc(titleCase(definition.pluralTitle)) + '</span><span class="nav-control-slot" aria-hidden="true"></span></a>';
      }).join("") + renderSidebarUtility(section.utility, route, direct);
      if (direct) return links;
      return '<section class="nav-group nav-subgroup ' + (sectionOpen ? "open" : "") + '" data-group="' + esc(sectionKey) + '"><button class="nav-subheading-row nav-subgroup-toggle" type="button" aria-label="' + (sectionOpen ? "Collapse " : "Expand ") + esc(section.title) + '" aria-expanded="' + sectionOpen + '" aria-controls="nav-group-' + esc(sectionKey) + '"><span class="nav-subheading">' + esc(section.title) + '</span><svg class="nav-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5"></path></svg></button><div class="nav-items" id="nav-group-' + esc(sectionKey) + '">' + links + '</div></section>';
    }).join("");
    return '<section class="nav-group nav-stage ' + (stageOpen ? "open" : "") + '" data-group="' + esc(stage.id) + '"><div class="nav-heading-row"><a class="nav-heading ' + (stagePageCurrent ? "current" : "") + '" href="#/stage/' + encodeURIComponent(stage.id) + '"><span class="nav-stage-number">' + esc(stage.number) + '</span><span class="nav-stage-copy"><strong>' + esc(stage.title) + '</strong><small>' + esc(stage.description) + '</small></span></a><button class="nav-toggle nav-stage-toggle" type="button" aria-label="' + (stageOpen ? "Collapse " : "Expand ") + esc(stage.title) + '" aria-expanded="' + stageOpen + '" aria-controls="nav-group-' + esc(stage.id) + '"><svg class="nav-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5"></path></svg></button></div><div class="nav-items" id="nav-group-' + esc(stage.id) + '">' + sections + '</div></section>';
  }).join("");
  const organizationCurrent = route.name === "organization" || route.name === "repository" || ["workspace", "renderer-settings"].includes(route.type);
  const organizationName = state.workspace.organizationName || "Organization";
  const initial = organizationName.trim().charAt(0).toUpperCase() || "O";
  return '<aside class="sidebar" id="sidebar-navigation"><button class="nav-close" type="button" aria-label="Close navigation">×</button><a href="#/" class="brand"' + (route.name === "home" ? ' aria-current="page"' : "") + '><img class="mark" src="./favicon.png" alt="" width="39" height="39"><span><strong>FileGRC</strong><small>SOC 2 workspace</small></span></a><nav class="sidebar-nav">' + stages + '</nav><div class="sidebar-footer"><a class="organization-nav ' + (organizationCurrent ? "current" : "") + '" href="#/organization"><span class="organization-mark">' + esc(initial) + '</span><span><strong>' + esc(organizationName) + '</strong><small>Organization</small></span><span class="organization-arrow">›</span></a></div></aside><button class="nav-scrim" type="button" aria-label="Close navigation"></button>';
}

function readinessStageForRoute(route) {
  if (route.name === "stage") return READINESS_STAGES.find((stage) => stage.id === route.stageId);
  return READINESS_STAGES.find((stage) => stage.sections.some((section) => section.types.includes(route.type)
    || (section.utility === "obligation-board" && route.name === "obligations")
    || (section.utility === "audit-packet" && route.name === "audit-packet")));
}

function readinessStageForType(type) {
  return READINESS_STAGES.find((stage) => stage.sections.some((section) => section.types.includes(type)));
}

function renderSidebarUtility(utility, route, direct = false) {
  const directClass = direct ? "nav-direct " : "";
  if (utility === "obligation-board") return "";
  if (utility === "audit-packet") {
    return '<a class="' + directClass + 'audit-packet-link ' + (route.name === "audit-packet" ? "current" : "") + '" href="#/audit-packet"><span>Audit Readiness</span><span class="nav-control-slot" aria-hidden="true"></span></a>';
  }
  return "";
}

function topbar(route) {
  const title = route.name === "home"
    ? "Program Overview"
    : route.name === "stage"
      ? READINESS_STAGES.find((stage) => stage.id === route.stageId)?.title || "Program"
    : route.name === "organization"
      ? "Organization"
      : route.name === "repository"
        ? "Repository"
        : route.name === "obligations"
          ? "Work Queue"
          : route.name === "audit-packet"
            ? "Audit Readiness"
            : state.model.resources[route.type]?.pluralTitle || "FileGRC";
  return '<button class="mobile-nav" type="button" aria-label="Open navigation" aria-controls="sidebar-navigation" aria-expanded="false">☰</button><div><small class="eyebrow">' + esc(state.workspace.organizationName) + '</small><h1>' + esc(titleCase(title)) + '</h1></div><label class="search"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Search records" aria-label="Search records"><kbd>/</kbd></label><div class="topbar-status"><a class="validation-chip" href="#/repository"><span class="status-dot ' + (state.validation.ok ? "good" : "bad") + '"></span>' + (state.validation.ok ? "Data valid" : state.validation.counts.errors + " validation errors") + '</a><a class="repo-chip" href="#/repository"><span class="status-dot ' + (state.git.clean ? "good" : "warn") + '"></span>' + esc(state.git.available ? ((state.git.branch || "detached") + " · " + state.git.shortCommit) : "Git unavailable") + '</a></div>';
}

function renderHome(main) {
  const activeAudit = resourcesOfType("audit").find((item) => !["complete", "closed", "cancelled"].includes(item.record.status));
  const program = state.programReadiness;
  const activeFirm = activeAudit && (activeAudit.record.auditorVendorId || (activeAudit.record.auditor && Object.keys(activeAudit.record.auditor).length));
  const setupPending = rendererSettingsEntry()?.record.showOnboarding === true;
  const acceptedEventTriggers = state.obligations.triggers.filter(({ programStatus }) => programStatus !== "proposed");
  const openObligations = state.obligations.items.filter((item) => item.status !== "complete");
  const obligationHeading = openObligations.some((item) => item.status !== "proposed") ? "Due Windows" : "Starter Proposals";
  const setupBanner = setupPending
    ? '<section class="setup-banner"><div><p class="kicker">Setup incomplete</p><h3>Define the initial service boundary</h3><p>Record the management program goal and the systems that should enter policy and control review.</p></div><ol><li>Describe the service boundary.</li><li>Choose the program goal.</li><li><button class="text-button" type="button" id="resume-setup">Resume setup</button></li></ol></section>'
    : "";
  const auditPanel = program.evidenceReady
    ? '<section class="panel audit-panel"><div class="panel-head"><div><p class="kicker">Optional next phase</p><h3>' + esc(activeFirm ? titleCase(activeAudit.record.title) : "Target: " + program.target.label) + '</h3></div>' + (activeAudit ? '<a href="#/resource/audit/' + encodeURIComponent(activeAudit.record.id) + '">Open audit</a>' : '<a href="#/resources/audit">Engagements</a>') + '</div>' +
      (activeAudit ? auditProgress(activeAudit.record) + auditEngagementPrompt(activeAudit.record) : auditEngagementPrompt()) + '</section>'
    : "";
  main.innerHTML = '<div class="page home-page"><section class="hero overview-hero"><div><p class="kicker">Current program state</p><h2>' + esc(titleCase(state.workspace.title)) + '</h2><p>' + esc(state.workspace.description || "Governance, risk, controls, evidence, and audit work maintained as plain files in Git.") + '</p></div></section>' + setupBanner + readinessOverview() +
    '<div class="overview-grid"><section class="panel obligation-panel"><div class="panel-head"><div><p class="kicker">Policy obligations</p><h3>' + obligationHeading + '</h3></div><a href="#/stage/run">Open board</a></div>' + obligationPreview(openObligations.slice(0, 3)) + '</section>' +
    '<section class="panel event-reminder-panel"><div class="panel-head"><div><p class="kicker">Event reminders</p><h3>Did Something Change?</h3></div><a href="#/stage/run?section=events">' + (acceptedEventTriggers.length ? "Start workflow" : "Review proposals") + '</a></div>' + eventReminderPreview(state.obligations.triggers.slice(0, 4)) + '</section>' +
    auditPanel + '</div></div>';
  main.querySelector("#resume-setup")?.addEventListener("click", requestOnboarding);
}

function readinessOverview() {
  const progress = programPathProgress();
  const nextHref = nextProgramStageHref();
  const programStage = (id, body, href) => {
    const stage = READINESS_STAGES.find((candidate) => candidate.id === id);
    const current = stageProgress(stage);
    const remaining = current.total - current.complete;
    const status = !remaining ? "Complete" : current.complete ? remaining + " remaining" : current.total + " to confirm";
    return [stage.title, body, href, status, !remaining ? "good" : current.complete ? "warn" : "neutral"];
  };
  const stages = [
    programStage("scope", "Confirm program ownership, criteria, and commitments, then describe the service, supporting systems, and dependencies.", "#/stage/scope"),
    programStage("policies", "Tailor the policy set, obtain independent management approval, and establish effective dates.", "#/stage/policies"),
    programStage("controls", "Finish the internal control set with actual procedures, owners, scope, and evidence sources, then record any complementary controls.", "#/stage/controls"),
    programStage("evidence", "For each control family, finish the source-system instructions and verify a real test export or capture.", "#/stage/evidence"),
    programStage("run", "Begin the candidate period, maintain risk assessments, work the FileGRC queue, run the remaining controls, and retain dated evidence.", "#/stage/run"),
    programStage("audit", "Engage the CPA firm, confirm the formal period, complete fieldwork, and generate the final evidence packet.", "#/stage/audit")
  ];
  return '<section class="readiness-map"><div class="readiness-map-head"><div><p class="kicker">SOC 2 program path</p><h3>Prepare, Operate, Then Audit</h3></div><div class="readiness-progress-summary"><div><span>Program Progress</span><strong>' + progress.percent + '%</strong><div class="progress"><span style="width:' + progress.percent + '%"></span></div><small>' + esc(progress.complete + " of " + progress.total + " program pages complete") + '</small></div><a class="button primary" href="' + nextHref + '">Continue</a></div></div><div class="readiness-flow">' + stages.map(([title, body, href, status, tone], index) => '<a href="' + href + '"><span>' + (index + 1) + '</span><strong>' + esc(title) + '</strong><small>' + esc(body) + '</small><b class="readiness-state ' + esc(tone) + '">' + esc(status) + '</b></a>').join("") + '</div></section>';
}

function nextProgramStageHref() {
  const nextStage = READINESS_STAGES.find((stage) => {
    const progress = stageProgress(stage);
    return progress.complete < progress.total;
  }) || READINESS_STAGES.at(-1);
  if (!nextStage) return "#/stage/scope";
  return "#/stage/" + encodeURIComponent(nextStage.id);
}

function renderStageOverview(main, stageId, params = new URLSearchParams()) {
  const stage = READINESS_STAGES.find((candidate) => candidate.id === stageId);
  if (!stage) return renderNotFound(main);
  if (stage.id === "run") return renderObligations(main, params);
  const progress = stageProgress(stage);
  main.innerHTML = '<div class="page stage-overview-page"><nav class="breadcrumbs"><a href="#/">Overview</a><span>/</span><span>' + esc(stage.title) + '</span></nav>' +
    '<section class="stage-overview-hero"><div><p class="kicker">Step ' + esc(stage.number) + ' of 6</p><h2>' + esc(stage.title) + '</h2><p>' + esc(stage.summary) + '</p></div>' + stageProgressCard(progress) + '</section>' +
    renderStagePageIndex(stage) + '</div>';
}

function renderStagePageIndex(stage) {
  const destinations = stagePageDestinations(stage);
  const cards = destinations.map((destination, index) => stagePageCard(stage, destination, index)).join("");
  return '<section class="stage-pages" aria-label="Step ' + esc(stage.number) + ' pages"><div class="stage-page-grid">' + cards + '</div></section>';
}

function stagePageDestinations(stage) {
  return stage.sections.flatMap((section) => sectionDestinations(section)
    .filter((destination) => destination.utility !== "obligation-board")
    .map((destination) => ({ ...destination, section })));
}

function stagePageId(stage, destination) {
  return stage.id + ":" + (destination.type || "utility:" + destination.utility);
}

function stagePageComplete(pageId) {
  const completedPageIds = rendererSettingsEntry()?.record.completedStagePageIds || [];
  return [pageId, ...(STAGE_PAGE_ID_ALIASES[pageId] || [])].some((id) => completedPageIds.includes(id));
}

function stagePageCard(stage, destination, index) {
  const details = destination.type ? resourceRollup(destination.type) : utilityRollup(destination.utility);
  const summaryKey = destination.type || "utility:" + destination.utility;
  const summary = STAGE_PAGE_SUMMARIES[summaryKey] || destination.section.description;
  const stepLabel = "Step " + stage.number + "." + String.fromCharCode(97 + index);
  const pageId = stagePageId(stage, destination);
  const complete = stagePageComplete(pageId);
  const completionControl = state.readOnly
    ? '<span class="stage-page-completion-state ' + (complete ? "complete" : "") + '">' + (complete ? "Complete" : "Not marked complete") + '</span>'
    : '<button class="button stage-page-completion ' + (complete ? "complete" : "") + '" type="button" data-stage-page-completion="' + esc(pageId) + '" data-complete="' + complete + '">' + (complete ? "Mark incomplete" : "Mark complete") + '</button>';
  return '<article class="stage-page-card ' + (complete ? "complete" : "") + '"><a class="stage-page-card-link" href="' + destination.href + '" aria-label="Open ' + esc(destination.label) + '"></a><div class="stage-page-card-head"><div><small>' + esc(stepLabel) + '</small><h3>' + esc(destination.label) + '</h3></div><span class="stage-page-rollup"><strong>' + esc(details.value) + '</strong><small>' + esc(details.label) + '</small></span></div><p>' + esc(summary) + '</p><div class="stage-page-card-foot"><span class="stage-page-open" aria-hidden="true">Open ›</span>' + completionControl + '</div></article>';
}

function stageProgress(stage) {
  const pages = stagePageDestinations(stage);
  const complete = pages.filter((destination) => stagePageComplete(stagePageId(stage, destination))).length;
  return progressFromCounts(complete, pages.length, "page");
}

function programPathProgress() {
  const progress = READINESS_STAGES.map((stage) => stageProgress(stage));
  return progressFromCounts(
    progress.reduce((sum, current) => sum + current.complete, 0),
    progress.reduce((sum, current) => sum + current.total, 0),
    "program page"
  );
}

function progressFromCounts(complete, total, noun) {
  if (!total) return { percent: 0, complete: 0, total: 0, status: "Not started", tone: "neutral", detail: "No " + pluralize(noun, 2) + " are configured yet." };
  const percent = Math.round((complete / total) * 100);
  const detail = complete + " of " + total + " " + pluralize(noun, total) + " marked complete.";
  if (complete === total) return { percent: 100, complete, total, status: "Complete", tone: "good", detail };
  if (!complete) return { percent: 0, complete, total, status: "Not started", tone: "warn", detail };
  return { percent, complete, total, status: "In progress", tone: "warn", detail };
}

function stageProgressCard(progress) {
  return '<div class="stage-progress-card"><div><span class="badge ' + esc(progress.tone) + '">' + esc(progress.status) + '</span><strong>' + progress.percent + '%</strong></div><div class="progress"><span style="width:' + progress.percent + '%"></span></div><p>' + esc(progress.detail) + '</p></div>';
}

function sectionDestinations(section) {
  const destinations = [];
  for (const type of section.types) {
    const definition = state.model.resources[type];
    if (!definition) continue;
    destinations.push({ type, kind: "Record page", label: titleCase(definition.pluralTitle), href: "#/resources/" + encodeURIComponent(type), description: definition.description });
  }
  if (section.utility === "obligation-board") destinations.push({ utility: section.utility, kind: "Working page", label: "Work Queue", href: "#/stage/run", description: "Complete recurring and event work with its due windows and linked proof." });
  if (section.utility === "audit-packet") destinations.push({ utility: section.utility, kind: "Working page", label: "Audit Readiness", href: "#/audit-packet", description: "Prepare engagement documents, populations, fieldwork, and the evidence packet." });
  return destinations;
}

function resourceRollup(type) {
  const records = resourcesOfType(type).map(({ record }) => record);
  if (!records.length) return { value: "0", label: "No records yet" };
  const statuses = new Map();
  records.forEach((record) => {
    if (record.status) statuses.set(record.status, (statuses.get(record.status) || 0) + 1);
  });
  const statusText = [...statuses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([status, count]) => count + " " + humanize(status).toLowerCase()).join(" · ");
  return { value: String(records.length), label: statusText || pluralize("record", records.length) };
}

function utilityRollup(utility) {
  if (utility === "obligation-board") {
    const open = state.obligations.items.filter((item) => item.status !== "complete");
    return { value: String(open.length), label: open.length ? "Open work items" : "No work due" };
  }
  if (utility === "audit-packet") {
    const audits = resourcesOfType("audit");
    return { value: String(audits.length), label: audits.length ? pluralize("engagement", audits.length) : "No engagement yet" };
  }
  return { value: "0", label: "Not started" };
}

function auditEngagementPrompt(audit = null) {
  const hasAuditor = audit?.auditorVendorId || (audit?.auditor && Object.keys(audit.auditor).length);
  if (hasAuditor) return "";
  const heading = audit ? "CPA Firm Not Recorded" : "Optional: Engage a CPA Firm Early";
  return '<div class="audit-engagement"><div><strong>' + heading + '</strong><p>The program can keep operating while management selects a firm. Engage early when a customer deadline, unusual scope, or other timing risk needs CPA input.</p></div><ul><li>Share the program boundary, goal, and evidence-source plan.</li><li>Keep management candidate dates separate from the firm-agreed report period.</li><li>Create or update the audit record only for a real engagement.</li></ul>' + (!audit ? '<a class="button" href="#/resources/audit?new=1">Create engagement</a>' : "") + '</div>';
}

function renderObligations(main, params = new URLSearchParams()) {
  const stage = READINESS_STAGES.find((candidate) => candidate.id === "run");
  const plan = state.obligations;
  const controls = resourcesOfType("control");
  const linkedControlIds = new Set(resourcesOfType("obligation").flatMap(({ record }) => record.controlIds || []));
  const scheduledControls = controls.filter(({ record }) => linkedControlIds.has(record.id)).length;
  const visibleCardLimit = 6;
  const sections = ["proposed", "upcoming", "due", "overdue"].map((status) => {
    const items = plan.items.filter((item) => item.status === status);
    const cards = items.map((item, index) => obligationCard(item, index >= visibleCardLimit)).join("");
    const more = items.length > visibleCardLimit
      ? '<button class="button obligation-more" type="button" data-expand-obligations="' + status + '" data-total="' + items.length + '" aria-expanded="false">Show ' + (items.length - visibleCardLimit) + ' more</button>'
      : "";
    return '<section class="obligation-column" data-obligation-column="' + status + '"><div class="obligation-column-head"><span class="badge status-' + status + '">' + esc(status) + '</span><strong>' + items.length + '</strong></div><div class="obligation-cards">' + (items.length ? cards : empty("Nothing " + status + ".")) + '</div>' + more + '</section>';
  }).join("");
  const triggers = plan.triggers.map((trigger) => '<article class="event-trigger-card"><div><p class="kicker">' + esc(trigger.programStatus === "proposed" ? "Starter proposal" : trigger.eventType) + '</p><h3>' + esc(titleCase(trigger.prompt)) + '</h3><p>' + trigger.steps.length + (trigger.programStatus === "proposed" ? ' proposed actions become available after every linked policy is active and effective.' : ' policy actions will be created with their own owners and due windows.') + '</p></div><ol>' + trigger.steps.map((step) => '<li><span>' + esc(step.title) + '</span><small>' + esc(eventStepSummary(step)) + '</small></li>').join("") + '</ol>' + (!state.readOnly && trigger.programStatus !== "proposed" ? '<button class="button primary" type="button" data-start-event="' + esc(trigger.eventType) + '">Start workflow</button>' : "") + '</article>').join("");
  const runs = plan.eventRuns
    .filter((run) => run.status !== "canceled")
    .sort((a, b) => String(b.occurredAt || b.occurredOn).localeCompare(String(a.occurredAt || a.occurredOn)));
  main.innerHTML = '<div class="page obligation-board-page stage-overview-page"><nav class="breadcrumbs"><a href="#/">Overview</a><span>/</span><span>' + esc(stage.title) + '</span></nav>' +
    '<section class="stage-overview-hero"><div><p class="kicker">Step ' + esc(stage.number) + ' of 6</p><h2>' + esc(stage.title) + '</h2><p>' + esc(stage.summary) + '</p></div>' + stageProgressCard(stageProgress(stage)) + '</section>' +
    renderStagePageIndex(stage) +
    '<section class="workflow-section work-queue-section"><div class="section-head"><div><p class="kicker">Recurring and event work</p><h2>Work Queue</h2><p>This board schedules work linked to ' + scheduledControls + ' of ' + controls.length + ' controls. Other controls operate continuously or per transaction in their source systems and are documented through evidence records. Starter work remains a proposal until every governing policy is active and effective.</p></div><div class="page-actions"><button class="button" type="button" data-scroll-events>Start policy event</button><a class="button" href="#/resources/obligation">Edit schedules</a></div></div>' +
    '<div class="obligation-board">' + sections + '</div>' +
    '</section>' +
    '<section class="workflow-section event-reminders"><div class="section-head"><div><p class="kicker">Ongoing reminders</p><h2>Start a Policy Event</h2><p>Use these when the underlying event happens. The generated checklist remains a normal set of Git-tracked records.</p></div></div><div class="event-trigger-grid">' + (triggers || empty("No event-driven obligations are configured.")) + '</div></section>' +
    '<section class="workflow-section"><div class="section-head"><div><p class="kicker">Event execution</p><h2>Active and Recent Workflows</h2><p>Link the requested completion records and evidence on each action item before marking it done.</p></div></div><div class="event-run-list">' + (runs.length ? runs.map(eventRunCard).join("") : empty("No policy events have been started.")) + '</div></section></div>';
  main.querySelectorAll("[data-start-event]").forEach((button) => button.addEventListener("click", () => {
    const trigger = plan.triggers.find((item) => item.eventType === button.dataset.startEvent);
    if (trigger) openObligationEventDialog(trigger);
  }));
  main.querySelector("[data-scroll-events]")?.addEventListener("click", () => main.querySelector(".event-reminders")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  main.querySelectorAll("[data-expand-obligations]").forEach((button) => button.addEventListener("click", () => {
    const column = button.closest("[data-obligation-column]");
    const expanded = button.getAttribute("aria-expanded") === "true";
    column.querySelectorAll(".obligation-card[data-collapsed]").forEach((card) => { card.hidden = expanded; });
    button.setAttribute("aria-expanded", String(!expanded));
    button.textContent = expanded ? "Show " + (Number(button.dataset.total) - visibleCardLimit) + " more" : "Show fewer";
    if (expanded) column.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  main.querySelectorAll("[data-record-obligation]").forEach((button) => button.addEventListener("click", () => {
    const item = plan.items.find((candidate) => candidate.key === button.dataset.recordObligation);
    if (item) openObligationCompletion(item);
  }));
  const requestedEvent = params.get("event");
  if (requestedEvent || params.get("section") === "events") {
    queueMicrotask(() => {
      main.querySelector(".event-reminders")?.scrollIntoView({ block: "start" });
      if (requestedEvent) main.querySelector('[data-start-event="' + CSS.escape(requestedEvent) + '"]')?.click();
    });
  }
}

function obligationCard(item, collapsed = false) {
  const type = item.actionItemId ? "action-item" : "obligation";
  const id = item.actionItemId || item.obligationId;
  const completion = !item.actionItemId ? obligationCompletionPlan(item) : null;
  const action = !state.readOnly && !["upcoming", "proposed"].includes(item.status) && completion
    ? completion.blocked
      ? '<a class="obligation-action blocked" href="' + completion.href + '">' + esc(completion.blocked) + '</a>'
      : '<button class="obligation-action" type="button" data-record-obligation="' + esc(item.key) + '">Record work</button>'
    : "";
  return '<article class="obligation-card status-' + esc(item.status) + '"' + (collapsed ? ' data-collapsed hidden' : "") + '><div class="obligation-card-head"><span>' + esc(item.kind === "event" ? "Event action" : item.activityType || "Recurring") + '</span><strong>' + esc(timingText(item)) + '</strong></div><h3><a href="#/resource/' + type + '/' + encodeURIComponent(id) + '">' + esc(titleCase(item.title)) + '</a></h3><p>' + esc(windowText(item)) + '</p><div class="obligation-card-foot"><div class="obligation-links">' + (item.policyIds || []).map(formatReference).join("") + '</div>' + action + '</div></article>';
}

function obligationCompletionPlan(item) {
  const type = OBLIGATION_COMPLETION_TYPES[item.activityType] || "evidence";
  if (["access-review", "backup-test"].includes(type) && !resourcesOfType("system").some(({ record }) => record.inScope && record.status !== "retired")) {
    return { type, blocked: "Add system first", href: "#/resources/system?new=1" };
  }
  if (type === "vendor-review" && !resourcesOfType("vendor").some(({ record }) => record.status !== "terminated")) {
    return { type, blocked: "Add vendor first", href: "#/resources/vendor?new=1" };
  }
  if (type === "meeting" && !resourcesOfType("team").length) {
    return { type, blocked: "Add team first", href: "#/resources/team?new=1" };
  }
  return { type };
}

function openObligationCompletion(item) {
  const obligation = state.resources.find(({ record }) => record.type === "obligation" && record.id === item.obligationId);
  if (!obligation) return showError("The obligation template could not be found.");
  const completion = obligationCompletionPlan(item);
  if (completion.blocked) return;
  openEditor(completion.type, null, {
    seed: obligationCompletionSeed(completion.type, item, obligation.record),
    obligationCompletion: {
      obligationId: item.obligationId,
      revision: obligation.revision
    },
    description: "Record the work performed during this occurrence. Saving creates the dated record and links it to the obligation. Add supporting evidence on this record or as a linked evidence record." + (item.status === "overdue" ? " The missed occurrence remains overdue when work is performed after its policy cutoff." : ""),
    saveLabel: "Save and link"
  });
}

function obligationCompletionSeed(type, item, obligation) {
  const date = currentDate();
  const timestamp = new Date().toISOString();
  const people = resourcesOfType("person").filter(({ record }) => record.status === "active").map(({ record }) => record.id);
  const ownerIds = (item.ownerIds || []).filter((id) => people.includes(id));
  const responsiblePeople = ownerIds.length ? ownerIds : people.slice(0, 1);
  const inScopeSystems = resourcesOfType("system").filter(({ record }) => record.inScope && record.status !== "retired").map(({ record }) => record.id);
  const activeVendors = resourcesOfType("vendor").filter(({ record }) => record.status !== "terminated").map(({ record }) => record.id);
  const title = item.title + " · " + formatCalendarDate(item.dueWindowStart);
  const common = { title };
  if (type === "meeting") {
    return { ...common, status: "complete", teamId: resourcesOfType("team")[0]?.record.id, chairIds: responsiblePeople, scheduledOn: date };
  }
  if (type === "policy-review") {
    return { ...common, status: "complete", scopeResourceIds: obligation.scopeResourceIds || [], reviewerIds: responsiblePeople, reviewedOn: date, outcome: "passed", changesRequired: false, periodStart: item.dueWindowStart, periodEnd: item.dueWindowEnd };
  }
  if (type === "risk-assessment") {
    return { ...common, status: "complete", assessmentDate: date, assessmentKind: "enterprise-risk", scope: "In-scope SOC 2 systems and dependencies", assessorIds: responsiblePeople, reviewerIds: responsiblePeople, methodology: state.workspace.riskMethodology?.method || "Documented risk methodology", approvedOn: date };
  }
  if (type === "attestation") {
    return { ...common, status: "completed", subjectResourceIds: [obligation.templateResourceId, ...(obligation.scopeResourceIds || [])].filter(Boolean), personId: responsiblePeople[0], attestationKind: item.activityType || "completion", assignedOn: item.dueWindowStart, dueOn: item.dueWindowEnd, completedOn: date, attestationMethod: "git-approval" };
  }
  if (type === "access-review") {
    return { ...common, status: "complete", reviewDate: date, reviewerIds: responsiblePeople, systemIds: inScopeSystems, scope: "Privileged, production, and important-system access", outcome: "passed", periodStart: item.dueWindowStart, periodEnd: item.dueWindowEnd };
  }
  if (type === "vulnerability-scan") {
    return { ...common, status: "complete", scanKind: "vulnerability", scope: "In-scope systems", operatorIds: responsiblePeople, scheduledOn: date, completedAt: timestamp, systemIds: inScopeSystems, resultSummary: "Document the scan result and link findings or evidence." };
  }
  if (type === "penetration-test") {
    return { ...common, status: "complete", testKind: "independent", scope: "In-scope systems and service boundary", periodStart: date, periodEnd: date, ownerIds: responsiblePeople, outcome: "passed", systemIds: inScopeSystems };
  }
  if (type === "exercise") {
    return { ...common, status: "complete", exerciseKind: item.title.toLowerCase().includes("continuity") ? "business-continuity" : "incident-response", scheduledOn: date, facilitatorIds: responsiblePeople, objective: item.title, outcome: "passed", systemIds: inScopeSystems, completedAt: timestamp };
  }
  if (type === "backup-test") {
    return { ...common, status: "passed", systemIds: inScopeSystems, testDate: date, operatorIds: responsiblePeople, outcome: "passed", completedAt: timestamp };
  }
  if (type === "vendor-review") {
    return { ...common, status: "complete", vendorIds: activeVendors, reviewerIds: responsiblePeople, reviewedOn: date, outcome: "passed", periodStart: item.dueWindowStart, periodEnd: item.dueWindowEnd };
  }
  return {
    ...common,
    status: "collected",
    evidenceKind: item.activityType || "control-operation",
    source: "Internal control operation",
    collectedOn: date,
    classification: "Internal",
    periodStart: item.dueWindowStart,
    periodEnd: item.dueWindowEnd,
    controlIds: item.controlIds || [],
    sourceResourceIds: [item.obligationId]
  };
}

function eventRunCard(run) {
  const percentage = run.actions.length ? Math.round((run.completeCount / run.actions.length) * 100) : 0;
  const occurred = run.occurredAt ? formatLocalDateTime(run.occurredAt) : formatCalendarDate(run.occurredOn);
  return '<article class="event-run"><div class="event-run-head"><div><span class="badge status-' + esc(run.status) + '">' + esc(run.status) + '</span><h3><a href="#/resource/obligation-event/' + encodeURIComponent(run.id) + '">' + esc(run.title) + '</a></h3><small>' + esc(occurred) + ' · ' + run.completeCount + ' of ' + run.actions.length + ' complete</small></div><strong>' + percentage + '%</strong></div><div class="progress"><span style="width:' + percentage + '%"></span></div><div class="event-actions">' + run.actions.map((action) => '<a href="#/resource/action-item/' + encodeURIComponent(action.actionItemId) + '"><span class="status-dot ' + (action.status === "complete" ? "good" : action.status === "overdue" ? "bad" : "warn") + '"></span><span><strong>' + esc(action.title) + '</strong><small>' + esc(action.status === "complete" ? "Complete" : windowText(action) + " · " + timingText(action)) + '</small></span></a>').join("") + '</div></article>';
}

function openObligationEventDialog(trigger) {
  const subjectType = trigger.eventType.startsWith("person") || trigger.eventType.includes("person-") ? "person"
    : trigger.eventType.startsWith("vendor") ? "vendor"
      : trigger.eventType.startsWith("system") ? "system"
        : trigger.eventType.includes("incident") ? "incident"
          : null;
  const subjects = subjectType ? resourcesOfType(subjectType) : [];
  const needsTimestamp = trigger.steps.some((step) => Number.isInteger(step.window?.endOffsetHours));
  const eventField = needsTimestamp
    ? '<label><span>Event time <small>your local time</small></span><input name="occurredAt" type="datetime-local" required value="' + esc(currentLocalDateTime()) + '"></label>'
    : '<label><span>Event date</span><input name="occurredOn" type="date" required value="' + esc(currentDate()) + '"></label>';
  const dialog = document.createElement("dialog");
  dialog.className = "commit-dialog event-dialog";
  dialog.setAttribute("aria-labelledby", "event-dialog-title");
  dialog.innerHTML = '<form><div class="dialog-head"><div><p class="kicker">Policy event</p><h2 id="event-dialog-title">' + esc(titleCase(trigger.prompt)) + '</h2></div><button type="button" class="icon-button" aria-label="Close">×</button></div><p>This creates one event record and ' + trigger.steps.length + ' linked action items. Review and commit them like any other compliance change.</p>' + eventField +
    (subjects.length ? '<label><span>Subject</span><select name="subject"><option value="">Select</option>' + subjects.map(({ record }) => '<option value="' + esc(record.id) + '">' + esc(record.title) + '</option>').join("") + '</select></label>' : "") +
    '<label><span>Workflow name <small>optional</small></span><input name="title" maxlength="200" placeholder="' + esc(trigger.prompt.replace(/\?$/, "")) + '"></label><div class="event-dialog-steps">' + trigger.steps.map((step) => '<div><strong>' + esc(step.title) + '</strong><small>' + esc(eventStepSummary(step)) + '</small></div>').join("") + '</div><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-event="cancel">Cancel</button><button type="submit" class="button primary">Create checklist</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector(".icon-button").addEventListener("click", () => dialog.close());
  dialog.querySelector('[data-event="cancel"]').addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    form.querySelectorAll("button,input,select").forEach((control) => { control.disabled = true; });
    try {
      const response = await localFetch("/api/obligation-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: trigger.eventType,
          occurredOn: form.elements.occurredOn?.value || undefined,
          occurredAt: form.elements.occurredAt?.value ? new Date(form.elements.occurredAt.value).toISOString() : undefined,
          subjectResourceIds: form.elements.subject?.value ? [form.elements.subject.value] : [],
          title: form.elements.title.value
        })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      state = await fetchJson("/api/state");
      dialog.close();
      render();
    } catch (error) {
      form.querySelectorAll("button,input,select").forEach((control) => { control.disabled = false; });
      form.querySelector(".dialog-error").textContent = error.message;
    }
  });
  dialog.querySelector('input[name="occurredOn"], input[name="occurredAt"]').focus();
}

function renderAuditPacket(main, params = new URLSearchParams()) {
  const audits = resourcesOfType("audit");
  const evidence = resourcesOfType("evidence");
  const requestedAudit = params.get("auditId");
  const selected = audits.find(({ record }) => record.id === requestedAudit)?.record || audits.find(({ record }) => record.status !== "complete")?.record || null;
  const today = currentDate();
  const start = selected?.periodStart || selected?.typeOneAsOf || today.slice(0, 4) + "-01-01";
  const end = selected?.periodEnd || selected?.typeOneAsOf || today;
  const typeOne = selected?.auditKind === "soc-2-type-1";
  const draft = !state.git.clean || !selected;
  const preparation = state.auditPreparations?.[selected?.id || "none"] || state.auditPreparations?.none;
  const preflight = [
    ["Repository", state.git.available ? state.git.clean ? "Clean revision" : state.git.changes.length + " uncommitted" : "Git unavailable", "#/repository", state.git.clean ? "good" : "warn"],
    ["Engagement", selected ? selected.title : "No audit record", "#/resources/audit", selected ? "good" : "warn"],
    ["Evidence", evidence.length + " " + pluralize("record", evidence.length), "#/resources/evidence", evidence.length ? "good" : "warn"],
    ["Policy work", state.obligations.counts.overdue ? state.obligations.counts.overdue + " overdue" : state.obligations.counts.due ? state.obligations.counts.due + " due" : state.obligations.counts.proposed ? state.obligations.counts.proposed + " proposals" : "No work due", "#/stage/run", state.obligations.counts.overdue ? "bad" : state.obligations.counts.due ? "warn" : state.obligations.counts.proposed ? "neutral" : "good"]
  ];
  const dateFields = typeOne
    ? '<label><span>As-of date</span><input type="date" name="start" required value="' + esc(start) + '"></label>'
    : '<label><span>Period start</span><input type="date" name="start" required value="' + esc(start) + '"></label><label><span>Period end</span><input type="date" name="end" required value="' + esc(end) + '"></label>';
  main.innerHTML = '<div class="page audit-packet-page"><div class="page-intro"><div><p class="kicker">Engagement readiness and evidence</p><h2>Prepare Fieldwork</h2><p>Use this page after a CPA firm is engaged. Confirm the firm-agreed period, complete engagement-specific management documents, reconcile Type 2 populations, and build the indexed packet with its control matrix, delivery indexes, history, and checksums. Complete program adoption and test captures on the preceding stage pages.</p></div></div><section class="packet-preflight" aria-label="Packet readiness">' + preflight.map(([label, value, href, tone]) => '<a href="' + href + '"><span class="status-dot ' + tone + '"></span><span><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></span></a>').join("") + '</section>' + renderAuditPreparation(preparation) + '<section class="panel packet-builder"><div class="panel-head"><div><p class="kicker">Evidence delivery</p><h3>' + (typeOne ? "Build the As-of Packet" : "Build the Period Packet") + '</h3></div></div><form id="packet-form">' + dateFields + '<label><span>Audit <small>required for delivery</small></span><select name="auditId"><option value="">Draft Without Audit Scope</option>' + audits.map(({ record }) => '<option value="' + esc(record.id) + '" ' + (record.id === selected?.id ? "selected" : "") + '>' + esc(record.title) + '</option>').join("") + '</select></label><button class="button primary" type="submit" ' + (state.readOnly ? "disabled" : "") + '>' + (draft ? "Generate draft" : "Generate packet") + '</button></form><p class="packet-note">' + (state.readOnly ? "Packet generation requires the local writable renderer or the CLI." : draft ? "Drafts expose coverage gaps now. Commit a clean revision and select an audit record before delivery." : "The packet is derived under .filegrc/ and bound to the selected audit and current Git revision. FileGRC checks preparation and integrity; the engagement team determines evidence sufficiency.") + '</p><div class="dialog-error" role="alert"></div></section><div id="packet-results"></div></div>';
  main.querySelector('select[name="auditId"]').addEventListener("change", (event) => {
    const next = event.currentTarget.value;
    location.hash = "#/audit-packet" + (next ? "?auditId=" + encodeURIComponent(next) : "");
  });
  main.querySelector("#initialize-audit-work")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const error = main.querySelector(".audit-preparation-error");
    button.disabled = true;
    button.textContent = "Initializing…";
    error.textContent = "";
    try {
      const response = await localFetch("/api/audit-preparation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auditId: selected.id })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      state = await fetchJson("/api/state");
      render();
    } catch (caught) {
      error.textContent = caught.message;
      button.disabled = false;
      button.textContent = "Initialize audit work";
    }
  });
  main.querySelector("#packet-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const error = main.querySelector(".dialog-error");
    button.disabled = true;
    button.textContent = "Generating…";
    error.textContent = "";
    try {
      const response = await localFetch("/api/evidence-packet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start: form.elements.start.value,
          end: form.elements.end?.value || form.elements.start.value,
          auditId: form.elements.auditId.value || undefined
        })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      latestPacketResult = await response.json();
      latestPacketState = state;
      const results = root.querySelector("#packet-results");
      if (results) renderPacketResults(results, latestPacketResult);
    } catch (caught) {
      error.textContent = caught.message;
    } finally {
      button.disabled = state.readOnly;
      button.textContent = draft ? "Generate draft" : "Generate packet";
    }
  });
  if (latestPacketResult && latestPacketState === state && latestPacketResult.packet.audit?.id === selected?.id) {
    renderPacketResults(main.querySelector("#packet-results"), latestPacketResult);
  }
}

function renderAuditPreparation(preparation) {
  if (!preparation) return "";
  const setupButton = preparation.canInitialize && !state.readOnly
    ? '<button class="button primary" type="button" id="initialize-audit-work">Initialize audit work</button>'
    : "";
  const heading = preparation.audit ? preparation.audit.title : "No Audit Selected";
  const status = preparation.status === "management-ready" ? "Management work complete" : preparation.counts.action + " actions remaining";
  const stages = preparation.stages.map((stage) => {
    const items = stage.items.map((item) => {
      const href = item.resourceId
        ? '#/resource/' + encodeURIComponent(item.resourceType) + '/' + encodeURIComponent(item.resourceId)
        : item.resourceType
          ? '#/resources/' + encodeURIComponent(item.resourceType)
          : "";
      const content = '<span class="preparation-status ' + esc(item.status) + '" aria-hidden="true">' + preparationStatusMark(item.status) + '</span><span><strong>' + esc(item.title) + '</strong><small>' + esc(item.message) + '</small></span>';
      return href ? '<a href="' + href + '">' + content + '</a>' : '<div>' + content + '</div>';
    }).join("");
    return '<details class="preparation-stage" ' + (stage.status === "action" ? "open" : "") + '><summary><span><strong>' + esc(stage.title) + '</strong><small>' + esc(stage.description) + '</small></span><b>' + (stage.counts.action ? stage.counts.action + " remaining" : stage.counts.later ? "Later in fieldwork" : stage.id === "auditor" ? "Auditor owned" : "Complete") + '</b></summary><div class="preparation-items">' + items + '</div></details>';
  }).join("");
  return '<section class="panel audit-preparation"><div class="panel-head"><div><p class="kicker">Management preparation</p><h3>' + esc(heading) + '</h3><p>' + esc(preparation.progress.complete + " of " + preparation.progress.total + " management items complete · " + status) + '</p></div>' + setupButton + '</div><div class="preparation-progress" aria-label="' + esc(preparation.progress.percent + "% complete") + '"><span style="width:' + preparation.progress.percent + '%"></span></div><p class="audit-preparation-note">Initialization creates engagement-specific management documents from the starter templates and, for Type 2, the standard population plan. It does not approve policies, mark controls implemented, or invent evidence.</p><div class="audit-preparation-error dialog-error" role="alert"></div><div class="preparation-stages">' + stages + '</div></section>';
}

function preparationStatusMark(status) {
  if (status === "complete") return "✓";
  if (status === "action") return "!";
  if (status === "later") return "◷";
  return "→";
}

function renderPacketResults(container, result) {
  const packet = result.packet;
  const ready = packet.readiness.status === "delivery-ready";
  container.innerHTML = '<section class="metrics packet-metrics">' +
    metric("Dated records", packet.summary.datedRecords, packet.summary.records + " total source records", "neutral") +
    metric("Obligations", packet.summary.obligationOccurrences, packet.summary.eventRuns + " event workflows", "neutral") +
    metric("Evidence", packet.summary.evidence, packet.summary.policies + " policies · " + packet.summary.controls + " controls", "neutral") +
    metric("Review items", packet.summary.gaps, packet.summary.errors + " errors · " + packet.summary.warnings + " warnings", packet.summary.errors ? "bad" : packet.summary.warnings ? "warn" : "good") +
    '</section><section class="panel packet-output"><div class="panel-head"><div><p class="kicker">' + (ready ? "FileGRC management checks passed" : "Draft packet") + '</p><h3>' + esc(result.output) + '</h3></div>' + (result.packetUrl ? '<a class="button primary" href="' + esc(result.packetUrl) + '" target="_blank" rel="noreferrer">Open index</a>' : "") + '</div><p>The directory contains ' + result.files.length + ' files. ' + (ready ? "Verify the checksums, reconcile external deliveries, and let the engagement team confirm evidence sufficiency." : "Do not deliver it until every error is resolved and each warning has been reviewed.") + '</p></section>' +
    '<div class="dashboard-grid"><section class="panel span-2"><div class="panel-head"><h3>Coverage Gaps and Warnings</h3></div>' + (packet.gaps.length ? '<div class="packet-gaps">' + packet.gaps.map((gap) => '<div><span class="badge ' + (gap.severity === "error" ? "bad" : "warn") + '">' + esc(gap.severity) + '</span><p>' + esc(gap.message) + '</p></div>').join("") + '</div>' : empty("No packet gaps were detected.")) + '</section><section class="panel"><div class="panel-head"><h3>Included Evidence</h3></div>' + (packet.evidence.length ? '<div class="packet-list">' + packet.evidence.slice(0, 12).map((item) => '<a href="#/resource/evidence/' + encodeURIComponent(item.id) + '"><strong>' + esc(item.title) + '</strong><small>' + esc(item.status) + ' · ' + esc(item.evidenceKind) + '</small></a>').join("") + '</div>' : empty("No evidence records matched.")) + '</section></div>';
}

function obligationPreview(items) {
  return items.length ? '<div class="obligation-preview">' + items.map((item) => '<a href="#/stage/run"><span class="status-dot ' + (item.status === "overdue" ? "bad" : item.status === "due" ? "warn" : "neutral") + '"></span><span><strong>' + esc(item.title) + '</strong><small>' + esc(timingText(item)) + '</small></span></a>').join("") + '</div>' : empty("No open obligations.");
}

function eventReminderPreview(triggers) {
  return triggers.length ? '<div class="event-reminder-preview">' + triggers.map((trigger) => {
    const proposed = trigger.programStatus === "proposed";
    const href = proposed ? "#/stage/run?section=events" : "#/stage/run?event=" + encodeURIComponent(trigger.eventType);
    return '<a href="' + href + '"><strong>' + esc(trigger.prompt) + '</strong><small>' + trigger.steps.length + (proposed ? ' proposed actions' : ' required actions') + '</small></a>';
  }).join("") + '</div>' : empty("No event reminders configured.");
}

function windowText(item) {
  if (item.dueWindowEndAt) {
    return formatLocalDateTime(item.dueWindowStartAt) + " through " + formatLocalDateTime(item.dueWindowEndAt) + ". Overdue after that cutoff.";
  }
  return item.dueWindowEnd
    ? formatCalendarDate(item.dueWindowStart) + " through " + formatCalendarDate(item.dueWindowEnd) + ". Overdue " + formatCalendarDate(item.overdueOn) + "."
    : "Deadline unavailable; review the source obligation.";
}

function timingText(item) {
  if (item.canceledAction) return "Action canceled; resolve or cancel the event";
  if (item.missingCompletion) return "Link required completion proof";
  if (item.status === "proposed") return "Starter proposal";
  if (item.status === "overdue" && Number.isInteger(item.hoursOverdue)) {
    return item.hoursOverdue === 0 ? "Overdue less than 1 hour" : item.hoursOverdue + " hour" + (item.hoursOverdue === 1 ? "" : "s") + " overdue";
  }
  if (item.status === "overdue") return item.daysOverdue === 0 ? "Overdue today" : item.daysOverdue + " day" + (item.daysOverdue === 1 ? "" : "s") + " overdue";
  if (item.status === "due" && Number.isInteger(item.hoursUntilOverdue)) {
    return item.hoursUntilOverdue === 0 ? "Cutoff now" : item.hoursUntilOverdue + " hour" + (item.hoursUntilOverdue === 1 ? "" : "s") + " until overdue";
  }
  if (item.status === "due") return item.overdueOn ? item.daysUntilOverdue + " day" + (item.daysUntilOverdue === 1 ? "" : "s") + " until overdue" : "Due now";
  if (item.status === "upcoming" && Number.isInteger(item.hoursUntilStart)) {
    return "Opens in " + item.hoursUntilStart + " hour" + (item.hoursUntilStart === 1 ? "" : "s");
  }
  if (item.status === "upcoming") return "Opens in " + item.daysUntilStart + " day" + (item.daysUntilStart === 1 ? "" : "s");
  return "Complete";
}

function relativeEventWindow(window) {
  if (Number.isInteger(window?.endOffsetHours)) {
    return window.endOffsetHours === 0 ? "Due at the event time" : "Due within " + window.endOffsetHours + " hours";
  }
  if (Number.isInteger(window?.endOffsetDays)) {
    return window.endOffsetDays === 0 ? "Due on the event date" : "Due within " + window.endOffsetDays + " days";
  }
  return "Due within 30 days";
}

function eventStepSummary(step) {
  const owners = (step.ownerIds || []).map((id) => state.resources.find(({ record }) => record.id === id)?.record.title || id);
  const proof = (step.completionResourceTypes || []).map(humanize);
  return [
    relativeEventWindow(step.window),
    owners.length ? "Owner: " + owners.join(", ") : "",
    proof.length ? "Proof: " + proof.join(" or ") : ""
  ].filter(Boolean).join(" · ");
}

function renderList(main, type, params = new URLSearchParams()) {
  const definition = state.model.resources[type];
  if (!definition) return renderNotFound(main);
  const entries = resourcesOfType(type);
  const requestedPage = Number(params.get("page"));
  let pageNumber = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const fields = [...new Set(["title", ...(definition.listFields || []), ...(type === "control" ? ["$operationTracking"] : [])])].filter((name) => name !== "title");
  const modelFields = { ...state.model.commonFields, ...definition.fields };
  const filters = Object.entries(modelFields).filter(([, field]) => field.filter).map(([name, field]) => {
    const observed = entries.flatMap(({ record }) => Array.isArray(record[name]) ? record[name] : [record[name]]).filter((value) => ["string", "number", "boolean"].includes(typeof value)).map(String);
    const values = [...new Set(observed)].sort();
    return { name, label: field.label || humanize(name), values };
  }).filter(({ values }) => values.length > 1);
  const createButton = !state.readOnly && !definition.singleton ? '<button class="button primary" id="new-resource">New ' + esc(definition.title.toLowerCase()) + '</button>' : "";
  const guideTrigger = '<button class="guide-trigger" id="resource-guide-trigger" type="button" aria-label="About ' + esc(definition.pluralTitle) + '" aria-haspopup="dialog" aria-controls="resource-guide" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"></circle><path d="M7.8 7.5a2.4 2.4 0 1 1 3.25 2.25c-.7.31-1.05.72-1.05 1.5v.25M10 14.5v.1"></path></svg></button>';
  const listTools = '<div class="list-tools list-header-tools"><label><span class="sr-only">Filter list</span><input id="list-search" type="search" placeholder="Filter ' + esc(definition.pluralTitle.toLowerCase()) + '"></label>' +
    filters.map(({ name, label, values }) => '<select class="field-filter" data-field="' + esc(name) + '" aria-label="Filter by ' + esc(label.toLowerCase()) + '"><option value="">Any ' + esc(properCase(label)) + '</option>' + values.map((value) => '<option value="' + esc(value) + '">' + esc(filterOptionLabel(value)) + '</option>').join("") + '</select>').join("") + '<span id="result-count" aria-live="polite">' + entries.length + ' records</span>' + createButton + '</div>';
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">' + esc(readinessStageForType(type)?.title || groupTitle(definition.group)) + '</p><div class="page-title-line"><h2>' + esc(titleCase(definition.pluralTitle)) + '</h2>' + guideTrigger + '</div></div>' + listTools + '</div>' + resourceGuide(type) + resourceWorkflowPanel(type, entries) +
    '<section class="record-table-wrap"><table class="record-table"><thead><tr><th>' + esc(fieldLabel(type, "title")) + '</th>' + fields.map((name) => '<th>' + esc(fieldLabel(type, name)) + '</th>').join("") + '<th>Git file</th></tr></thead><tbody id="record-rows"></tbody></table></section>' +
    '<nav class="pagination list-pagination" aria-label="' + esc(definition.pluralTitle) + ' pages" hidden><button class="button" type="button" data-page="previous">Previous</button><span class="page-status" aria-live="polite"></span><button class="button" type="button" data-page="next">Next</button></nav></div>';
  resourceGuideCleanup = setupResourceGuide(main);
  const pagination = main.querySelector(".list-pagination");
  const pageStatus = pagination.querySelector(".page-status");
  const previous = pagination.querySelector('[data-page="previous"]');
  const next = pagination.querySelector('[data-page="next"]');
  const renderRows = () => {
    const query = main.querySelector("#list-search").value.toLowerCase();
    const selections = [...main.querySelectorAll(".field-filter")].filter((select) => select.value).map((select) => [select.dataset.field, select.value]);
    const filtered = entries.filter((entry) => (!query || entrySearchText(entry).includes(query)) && selections.every(([field, expected]) => Array.isArray(entry.record[field]) ? entry.record[field].map(String).includes(expected) : String(entry.record[field] ?? "") === expected));
    const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
    pageNumber = Math.min(pageNumber, totalPages);
    const start = (pageNumber - 1) * LIST_PAGE_SIZE;
    const visible = filtered.slice(start, start + LIST_PAGE_SIZE);
    main.querySelector("#result-count").textContent = filtered.length + (filtered.length === 1 ? " record" : " records");
    main.querySelector("#record-rows").innerHTML = filtered.length ? visible.map((entry) => '<tr><td data-label="' + esc(fieldLabel(type, "title")) + '" data-primary-field><a class="record-title" href="#/resource/' + encodeURIComponent(type) + '/' + encodeURIComponent(entry.record.id) + '">' + esc(entry.record.title) + '</a></td>' + fields.map((name) => '<td data-label="' + esc(fieldLabel(type, name)) + '">' + (name === "$operationTracking" ? controlOperationTracking(entry.record) : formatValue(entry.record[name], name, type)) + '</td>').join("") + '<td data-label="Git file"><code>' + esc(entry.relativePath.replace(/^data\//, "")) + '</code></td></tr>').join("") : '<tr><td colspan="' + (fields.length + 2) + '">' + empty("No records match this filter.") + '</td></tr>';
    pagination.hidden = totalPages === 1;
    previous.disabled = pageNumber === 1;
    next.disabled = pageNumber === totalPages;
    const firstVisible = filtered.length ? start + 1 : 0;
    const lastVisible = Math.min(start + LIST_PAGE_SIZE, filtered.length);
    pageStatus.textContent = "Page " + pageNumber + " of " + totalPages + " · " + firstVisible + "–" + lastVisible + " of " + filtered.length;
  };
  main.querySelector("#list-search").value = params.get("q") || "";
  main.querySelectorAll(".field-filter").forEach((select) => { select.value = params.get(select.dataset.field) || ""; });
  const syncRoute = (mode = "replace") => {
    const next = new URLSearchParams();
    const query = main.querySelector("#list-search").value.trim();
    if (query) next.set("q", query);
    main.querySelectorAll(".field-filter").forEach((select) => { if (select.value) next.set(select.dataset.field, select.value); });
    if (pageNumber > 1) next.set("page", String(pageNumber));
    history[mode + "State"](null, "", "#/resources/" + encodeURIComponent(type) + (next.size ? "?" + next : ""));
  };
  const updateFilters = () => {
    pageNumber = 1;
    renderRows();
    syncRoute();
  };
  main.querySelector("#list-search").addEventListener("input", updateFilters);
  main.querySelectorAll(".field-filter").forEach((select) => select.addEventListener("change", updateFilters));
  previous.addEventListener("click", () => {
    pageNumber -= 1;
    renderRows();
    syncRoute("push");
    root.querySelector(".workspace").scrollTo({ top: 0 });
  });
  next.addEventListener("click", () => {
    pageNumber += 1;
    renderRows();
    syncRoute("push");
    root.querySelector(".workspace").scrollTo({ top: 0 });
  });
  renderRows();
  syncRoute();
  main.querySelector("#new-resource")?.addEventListener("click", () => openEditor(type));
  if (params.get("new") === "1" && !state.readOnly && !definition.singleton) queueMicrotask(() => openEditor(type));
}

function renderDetail(main, type, id) {
  const entry = resourcesOfType(type).find(({ record }) => record.id === id);
  const definition = state.model.resources[type];
  if (!entry || !definition) return renderNotFound(main);
  const fields = { ...state.model.commonFields, ...definition.fields };
  const recordContent = recordContentDefinition(type);
  const narrative = recordNarrative(entry.record, fields);
  const narrativeNames = new Set(narrative.map(([name]) => name));
  const visible = Object.entries(entry.record).filter(([name]) => (
    !["schemaVersion", "id", "type", "title"].includes(name)
    && !fields[name]?.content
    && !narrativeNames.has(name)
  ));
  const content = Object.entries(entry.content);
  const sourceMetadata = '<div><dt>Source file</dt><dd><code>' + esc(entry.relativePath) + '</code></dd></div><div><dt>Workspace revision</dt><dd>' + (state.git.available ? '<code>' + esc(state.git.shortCommit) + '</code>' : "Unavailable until the workspace is committed.") + '</dd></div>';
  const narrativeContent = narrative.length
    ? '<div class="content-label"><span>Record</span></div><div class="record-prose">' + narrative.map(([name, value]) => '<section><h3>' + esc(titleCase(fields[name]?.label || humanize(name))) + '</h3><p>' + esc(value) + '</p></section>').join("") + '</div>'
    : "";
  const markdownContent = content.map(([name, item]) => '<article class="markdown"><div class="content-label"><span>' + esc(fieldLabel(type, name)) + ' · ' + esc(item.path) + '</span>' + (!state.readOnly ? '<button class="text-button" data-edit-content="' + esc(name) + '">Edit Markdown</button>' : "") + '</div>' + item.html + '</article>').join("");
  const addRecordContent = recordContent && !entry.content[recordContent.slot] && !state.readOnly
    ? '<div class="record-content-action"><button class="button" type="button" id="add-record-content">Add Record Markdown</button></div>'
    : "";
  const hasRecordBody = Boolean(narrativeContent || markdownContent);
  const addRecordContentAction = !hasRecordBody && addRecordContent
    ? '<button class="button" type="button" id="add-record-content">Add Record Markdown</button>'
    : "";
  const detailMain = hasRecordBody
    ? '<section class="panel detail-main">' + narrativeContent + markdownContent + addRecordContent + '</section>'
    : "";
  main.innerHTML = '<div class="page"><div class="detail-head"><div><div class="breadcrumbs header-breadcrumbs"><a href="#/resources/' + encodeURIComponent(type) + '">' + esc(titleCase(definition.pluralTitle)) + '</a><span>/</span><span>' + esc(entry.record.title) + '</span></div><h2>' + esc(titleCase(entry.record.title)) + '</h2></div><div class="actions">' + (type === "audit" ? '<a class="button primary" href="#/audit-packet?auditId=' + encodeURIComponent(entry.record.id) + '">Evidence packet</a>' : "") + addRecordContentAction + (!state.readOnly ? '<button class="button" id="edit-resource">Edit</button>' + (!definition.singleton ? '<button class="button danger" id="delete-resource">Delete</button>' : "") : "") + '</div></div><div class="detail-grid ' + (hasRecordBody ? "" : "detail-grid-structured") + '">' + detailMain +
    '<aside><section class="panel"><div class="panel-head"><h3>Metadata</h3></div><dl class="metadata">' + sourceMetadata + visible.map(([name, value]) => '<div><dt>' + esc(fields[name]?.label || humanize(name)) + '</dt><dd>' + formatValue(value, name, type) + '</dd></div>').join("") + '</dl></section>' + resourceConnections(entry) + '<section class="panel"><div class="panel-head"><h3>File History</h3></div>' + (entry.history?.length ? '<div class="history">' + entry.history.map((commit) => '<div><code>' + esc(commit.shortCommit) + '</code><span><strong>' + esc(commit.subject) + '</strong><small>' + esc(commit.author) + ' · ' + esc(formatLocalDateTime(commit.timestamp)) + '</small></span></div>').join("") + '</div>' : empty("No committed history for this file.")) + '</section></aside></div></div>';
  main.querySelector("#edit-resource")?.addEventListener("click", () => openEditor(type, entry));
  main.querySelector("#add-record-content")?.addEventListener("click", () => openEditor(type, entry, { addRecordContent: true }));
  main.querySelectorAll("[data-edit-content]").forEach((button) => button.addEventListener("click", () => openContentEditor(entry, button.dataset.editContent)));
  main.querySelector("#delete-resource")?.addEventListener("click", async () => {
    if (!confirm('Delete "' + entry.record.title + '"? Use deletion only for mistakes and uncommitted drafts. Unshared Markdown authored for this record will also be deleted.')) return;
    try {
      const response = await localFetch("/api/resource/" + encodeURIComponent(type) + "/" + encodeURIComponent(id) + "?revision=" + encodeURIComponent(entry.revision), { method: "DELETE" });
      if (!response.ok) return showError(await responseMessage(response));
      state = await fetchJson("/api/state");
      location.hash = "#/resources/" + encodeURIComponent(type);
    } catch (error) {
      showError(error.message);
    }
  });
}

function recordNarrative(record, fields) {
  return Object.entries(record).filter(([name, value]) => RECORD_TEXT_FIELDS.has(name) && fields[name]?.type === "string" && String(value || "").trim());
}

function recordContentDefinition(type) {
  const config = state.model.recordContent;
  const definition = state.model.resources[type];
  if (!definition || !config?.slot || definition.markdown) return null;
  return {
    slot: config.slot,
    label: config.label,
    mode: config.defaultResourceTypes.includes(type) ? "default" : "optional"
  };
}

function resourceConnections(entry) {
  const connections = new Map();
  const entriesById = new Map(state.resources.map((item) => [item.record.id, item]));
  const add = (connectedEntry, reason) => {
    if (!connectedEntry || connectedEntry.record.id === entry.record.id) return;
    const existing = connections.get(connectedEntry.record.id) || { entry: connectedEntry, reasons: new Set() };
    existing.reasons.add(reason);
    connections.set(connectedEntry.record.id, existing);
  };
  const currentFields = { ...state.model.commonFields, ...state.model.resources[entry.record.type].fields };
  Object.entries(currentFields).forEach(([name, definition]) => {
    if (!definition.relation) return;
    const values = Array.isArray(entry.record[name]) ? entry.record[name] : [entry.record[name]];
    values.filter((value) => typeof value === "string").forEach((id) => add(entriesById.get(id), "Linked from " + fieldLabel(entry.record.type, name)));
  });
  state.resources.forEach((candidate) => {
    if (candidate.record.id === entry.record.id) return;
    const fields = { ...state.model.commonFields, ...state.model.resources[candidate.record.type].fields };
    Object.entries(fields).forEach(([name, definition]) => {
      if (!definition.relation) return;
      const values = Array.isArray(candidate.record[name]) ? candidate.record[name] : [candidate.record[name]];
      if (values.includes(entry.record.id)) add(candidate, "Linked by " + state.model.resources[candidate.record.type].title + " · " + fieldLabel(candidate.record.type, name));
    });
  });
  const typeOrder = navigationResourceTypes();
  const sorted = [...connections.values()].sort((first, second) => {
    const firstIndex = typeOrder.indexOf(first.entry.record.type);
    const secondIndex = typeOrder.indexOf(second.entry.record.type);
    const firstType = firstIndex < 0 ? Number.MAX_SAFE_INTEGER : firstIndex;
    const secondType = secondIndex < 0 ? Number.MAX_SAFE_INTEGER : secondIndex;
    return firstType - secondType || first.entry.record.title.localeCompare(second.entry.record.title);
  });
  if (!sorted.length) return "";
  const visible = sorted.slice(0, 14);
  return '<section class="panel connections-panel"><div class="panel-head"><h3>Connections</h3><span>' + sorted.length + '</span></div><div class="connections">' + visible.map(({ entry: connected, reasons }) => '<a href="#/resource/' + encodeURIComponent(connected.record.type) + '/' + encodeURIComponent(connected.record.id) + '"><strong>' + esc(connected.record.title) + '</strong><small>' + esc([...reasons].join(" · ")) + '</small></a>').join("") + '</div>' + (sorted.length > visible.length ? '<p class="connections-more">' + (sorted.length - visible.length) + ' more connections are available through the linked records.</p>' : "") + '</section>';
}

function navigationResourceTypes() {
  return [
    ...READINESS_STAGES.flatMap((stage) => stage.sections.flatMap((section) => section.types)),
    "workspace",
    "renderer-settings"
  ];
}

function renderOrganization(main) {
  const workspace = resourcesOfType("workspace")[0];
  const renderer = rendererSettingsEntry();
  const organizationName = state.workspace.organizationName || "Organization";
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">Administration</p><h2>' + esc(titleCase(organizationName)) + '</h2><p>Manage organization settings, renderer behavior, and repository state.</p></div>' + (workspace ? '<a class="button primary" href="#/resource/workspace/' + encodeURIComponent(workspace.record.id) + '">Organization profile</a>' : "") + '</div><div class="organization-grid"><section class="panel organization-profile"><div class="panel-head"><div><p class="kicker">Organization</p><h3>Program Settings</h3></div></div><dl class="metadata"><div><dt>Name</dt><dd>' + esc(organizationName) + '</dd></div><div><dt>Timezone</dt><dd>' + esc(state.workspace.timezone) + '</dd></div><div><dt>Data model</dt><dd>Version ' + esc(state.workspace.dataModelVersion) + '</dd></div><div><dt>Repository</dt><dd>' + (state.git.available ? esc((state.git.branch || "detached") + " · " + state.git.shortCommit) : "Git unavailable") + '</dd></div></dl></section><section class="panel organization-tools"><div class="panel-head"><div><p class="kicker">Workspace</p><h3>Renderer and Repository</h3></div></div><div class="organization-links">' + (renderer ? '<a href="#/resource/renderer-settings/' + encodeURIComponent(renderer.record.id) + '"><span><strong>Renderer Settings</strong><small>Committed behavior, including onboarding</small></span><b>›</b></a>' : "") + '<a href="#/repository"><span><strong>Repository</strong><small>Validation, file changes, history, and commits</small></span><b>›</b></a></div></section></div></div>';
}

function renderRepository(main) {
  const settings = rendererSettingsEntry();
  const settingsLink = settings ? '<a class="button" href="#/resource/renderer-settings/' + encodeURIComponent(settings.record.id) + '">Renderer settings</a>' : "";
  const onboardingButton = settings && !state.readOnly ? '<button class="button" type="button" id="start-onboarding">Run onboarding</button>' : "";
  const hasRemote = Boolean(state.git.upstream || state.git.remotes?.length);
  const pullDisabled = !state.git.clean
    ? "Commit or discard workspace changes before pulling"
    : !state.git.branch
      ? "Check out a branch before pulling"
      : !state.git.upstream
        ? "Push this branch first or configure an upstream"
        : "";
  const pushDisabled = !state.git.clean
    ? "Commit or discard workspace changes before pushing"
    : !state.validation.ok
      ? "Fix validation errors before pushing"
      : !state.git.branch
        ? "Check out a branch before pushing"
        : !state.git.upstream && !state.git.remotes?.length
          ? "Add a Git remote before pushing"
          : "";
  const pullButton = !state.readOnly && state.git.available && hasRemote
    ? '<button class="button" type="button" data-git-action="pull" ' + (pullDisabled ? 'disabled title="' + esc(pullDisabled) + '"' : "") + '>Pull with rebase</button>'
    : "";
  const commitButton = !state.readOnly && state.git.available && !state.git.clean
    ? '<button class="button primary" type="button" id="commit-workspace" ' + (!state.git.branch
      ? 'disabled title="Check out a branch before committing"'
      : state.validation.ok ? "" : 'disabled title="Fix validation errors before committing"') + '>' + (hasRemote ? "Commit and push" : "Commit locally") + '</button>'
    : "";
  const pushButton = !state.readOnly && state.git.available && hasRemote
    ? '<button class="button primary" type="button" data-git-action="push" ' + (pushDisabled ? 'disabled title="' + esc(pushDisabled) + '"' : "") + '>Push</button>'
    : "";
  const repositoryInstructions = !state.git.branch
    ? "This workspace is on a detached HEAD. Check out a branch before using browser commit, pull, or push."
    : hasRemote
    ? "Pull remote changes with rebase, review the workspace diff, then commit and push together."
    : "Review the workspace diff, then commit it locally. Add a Git remote when you want browser pull and push.";
  const validationBody = state.validation.diagnostics.length
    ? '<div class="diagnostics">' + state.validation.diagnostics.map((item) => '<div><span class="badge ' + item.severity + '">' + esc(item.severity) + '</span><code>' + esc(item.path) + '</code><p>' + esc(item.message) + '</p></div>').join("") + '</div>'
    : empty("No validation problems.");
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">Audit trail</p><h2>Repository State</h2><p>' + repositoryInstructions + ' Git supplies authors, timestamps, messages, revisions, and file history.</p><p class="repository-sync-status" role="status" aria-live="polite"></p></div><div class="page-actions">' + pullButton + commitButton + pushButton + onboardingButton + settingsLink + '<a class="button" href="#/resource/workspace/workspace">Workspace settings</a></div></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Current Revision</h3></div><dl class="metadata"><div><dt>Branch</dt><dd>' + esc(state.git.branch || (state.git.available ? "Detached HEAD" : "Unavailable")) + '</dd></div><div><dt>Upstream</dt><dd>' + esc(state.git.upstream || "Not configured") + '</dd></div><div><dt>Remotes</dt><dd>' + esc(state.git.remotes?.join(", ") || "None configured") + '</dd></div><div><dt>Commit</dt><dd><code>' + esc(state.git.commit || "Unavailable") + '</code></dd></div><div><dt>Working tree</dt><dd>' + (state.git.clean === null ? "Unavailable" : state.git.clean ? "Clean" : "Has changes") + '</dd></div><div><dt>Generated</dt><dd>' + esc(formatLocalDateTime(state.generatedAt)) + '</dd></div></dl></section><section class="panel span-2"><div class="panel-head"><h3>Uncommitted Changes</h3></div>' + (state.git.changes?.length ? '<ul class="changes">' + state.git.changes.map((change) => '<li><code>' + esc(change) + '</code></li>').join("") + '</ul>' : empty(state.git.available ? "No uncommitted changes." : state.git.message)) + '</section><section class="panel span-2"><div class="panel-head"><h3>Validation</h3><span class="badge ' + (state.validation.ok ? "good" : "bad") + '">' + (state.validation.ok ? "Passing" : "Needs attention") + '</span></div>' + validationBody + '</section></div></div>';
  main.querySelector("#commit-workspace")?.addEventListener("click", openCommitDialog);
  main.querySelectorAll("[data-git-action]").forEach((button) => button.addEventListener("click", () => runRepositoryGitAction(button.dataset.gitAction)));
  main.querySelector("#start-onboarding")?.addEventListener("click", requestOnboarding);
}

async function runRepositoryGitAction(action) {
  const buttons = [...document.querySelectorAll("[data-git-action]")];
  const disabled = buttons.map((button) => button.disabled);
  const active = buttons.find((button) => button.dataset.gitAction === action);
  const status = document.querySelector(".repository-sync-status");
  const label = action === "pull" ? "Pulling…" : "Pushing…";
  if (status) {
    status.textContent = "";
    status.classList.remove("error");
  }
  buttons.forEach((button) => { button.disabled = true; });
  if (active) active.textContent = label;
  try {
    const response = await localFetch("/api/git/" + action, { method: "POST" });
    if (!response.ok) throw new Error(await responseMessage(response));
    const result = await response.json();
    state = await fetchJson("/api/state");
    render();
    const currentStatus = document.querySelector(".repository-sync-status");
    if (currentStatus) currentStatus.textContent = action === "pull"
      ? result.updated
        ? "Pulled " + result.upstream + " with rebase at " + result.shortCommit + "."
        : result.branch + " is current with " + result.upstream + "."
      : "Pushed " + result.shortCommit + " to " + result.upstream + ".";
  } catch (cause) {
    buttons.forEach((button, index) => { button.disabled = disabled[index]; });
    if (active) active.textContent = action === "pull" ? "Pull with rebase" : "Push";
    if (status) {
      status.textContent = cause.message;
      status.classList.add("error");
    }
  }
}

function openCommitDialog() {
  const hasRemote = Boolean(state.git.upstream || state.git.remotes?.length);
  const actionLabel = hasRemote ? "Commit and push" : "Commit locally";
  const busyLabel = hasRemote ? "Committing and pushing…" : "Committing…";
  const dialog = document.createElement("dialog");
  dialog.className = "commit-dialog";
  dialog.setAttribute("aria-labelledby", "commit-dialog-title");
  dialog.innerHTML = '<form><div class="dialog-head"><div><p class="kicker">Git audit trail</p><h2 id="commit-dialog-title">' + (hasRemote ? "Commit and Push Workspace Changes" : "Commit Workspace Changes") + '</h2></div><button type="button" class="icon-button" aria-label="Close">×</button></div><p>' + (hasRemote ? "Commit every change under this FileGRC workspace, then push the commit to its Git remote." : "Commit every change under this FileGRC workspace. Add a Git remote later when you are ready to sync it.") + ' Use a message that explains why the compliance records changed.</p><label><span>Commit message</span><input name="message" required maxlength="200" placeholder="Record quarterly access review"></label><div class="commit-files">' + state.git.changes.map((change) => '<code>' + esc(change) + '</code>').join("") + '</div><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-commit="cancel">Cancel</button><button type="submit" class="button primary">' + actionLabel + '</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector(".icon-button").addEventListener("click", () => dialog.close());
  dialog.querySelector('[data-commit="cancel"]').addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    form.querySelectorAll("button,input").forEach((control) => { control.disabled = true; });
    button.textContent = busyLabel;
    try {
      const response = await localFetch("/api/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: form.elements.message.value })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json();
      state = await fetchJson("/api/state");
      dialog.close();
      render();
      const status = document.querySelector(".repository-sync-status");
      if (status) {
        status.textContent = result.pushed
          ? "Committed and pushed " + result.shortCommit + " to " + result.upstream + "."
          : result.pushSkipped
            ? "Committed " + result.shortCommit + " locally. Add a Git remote when you are ready to sync."
            : "Committed " + result.shortCommit + " locally, but the push failed. " + result.pushError;
        status.classList.toggle("error", !result.pushed && !result.pushSkipped);
      }
    } catch (error) {
      form.querySelectorAll("button,input").forEach((control) => { control.disabled = false; });
      button.textContent = actionLabel;
      form.querySelector(".dialog-error").textContent = error.message;
    }
  });
  dialog.querySelector('input[name="message"]').focus();
}

function resourceGuide(type) {
  const definition = state.model.resources[type];
  const guidance = definition?.guidance;
  if (!definition || !guidance) return "";
  const sources = (guidance.sourceResourceIds || [])
    .map((id) => state.resources.find(({ record }) => record.id === id))
    .filter(Boolean);
  const activityTypes = new Set(guidance.obligationActivityTypes || []);
  const obligations = activityTypes.size
    ? resourcesOfType("obligation").filter(({ record }) => record.status === "active" && activityTypes.has(record.activityType))
    : [];
  const sourceLinks = sources.length
    ? '<div class="guide-links">' + sources.map(({ record }) => '<a href="#/resource/' + encodeURIComponent(record.type) + '/' + encodeURIComponent(record.id) + '">' + esc(record.title) + '</a>').join("") + '</div>'
    : "";
  const obligationLinks = obligations.length
    ? '<div class="guide-links">' + obligations.map(({ record }) => {
      const cadence = formatCadence(record.recurrence);
      return '<a href="#/resource/obligation/' + encodeURIComponent(record.id) + '">' + esc(record.title) + (cadence ? ' · ' + esc(cadence) : "") + '</a>';
    }).join("") + '</div>'
    : "";
  return '<section class="page-guide resource-guide-popover" id="resource-guide" role="dialog" aria-label="How to use ' + esc(definition.pluralTitle) + '" hidden><div><span>Use</span><p>' + esc(definition.description) + '</p></div><div><span>Policy basis</span><p>' + esc(guidance.policyBasis) + '</p>' + sourceLinks + '</div><div><span>Timing</span><p>' + esc(guidance.cadence) + '</p>' + obligationLinks + '</div></section>';
}

function resourceWorkflowPanel(type, entries) {
  if (type === "control") {
    const planned = entries.filter(({ record }) => record.status === "planned").length;
    const implemented = entries.filter(({ record }) => record.status === "implemented").length;
    const linkedControlIds = new Set(resourcesOfType("obligation").flatMap(({ record }) => record.controlIds || []));
    const scheduled = entries.filter(({ record }) => linkedControlIds.has(record.id)).length;
    return '<section class="stage-instructions" aria-label="Control implementation instructions"><div class="stage-instructions-head"><div><p class="kicker">Step 3 · What to do here</p><h3>Finish the Starter Control Set</h3></div><span>' + implemented + ' implemented · ' + planned + ' planned</span></div><div class="stage-instruction-grid"><div><b>Already set up</b><p>This workspace has ' + entries.length + ' control records with starter statements, criteria and policy mappings, and suggested frequencies. They describe the expected control set, but planned records are not implemented controls.</p></div><div><b>Finish each control</b><p>Confirm it applies, replace the starter text with your actual procedure, assign its owner and system scope, connect an authoritative evidence source, set the implementation date, then mark it implemented.</p></div><div><b>Know what FileGRC runs</b><p>' + scheduled + ' controls have recurring or event work linked to the Work Queue. FileGRC schedules and records that work after policies take effect. People and source systems still perform and enforce the controls.</p><a href="#/stage/run">Open Work Queue</a></div></div></section>';
  }
  if (type === "evidence") {
    const evidenceStage = state.programReadiness?.stages?.find((stage) => stage.id === "evidence");
    const sourceItems = (evidenceStage?.items || []).filter((item) => item.id.startsWith("source-"));
    const testItems = (evidenceStage?.items || []).filter((item) => item.id.startsWith("test-"));
    const sourceComplete = sourceItems.filter((item) => item.status === "complete").length;
    const testComplete = testItems.filter((item) => item.status === "complete").length;
    return '<section class="stage-instructions" aria-label="Evidence preparation instructions"><div class="stage-instructions-head"><div><p class="kicker">Step 4 · Complete in order</p><h3>Prove Evidence Collection Works</h3></div><span>' + testComplete + ' of ' + testItems.length + ' test captures verified</span></div><div class="stage-instruction-grid evidence-instruction-grid"><div><span class="instruction-number">1</span><b>Connect authoritative sources</b><p>For every selected control family, link the controls to the system that produces the evidence. On that system, name who can export it, assign its evidence-source role, and write repeatable extraction instructions in Markdown.</p><small>' + sourceComplete + ' of ' + sourceItems.length + ' control families configured</small><a href="#/resources/system">Review source systems</a></div><div><span class="instruction-number">2</span><b>Run a test capture</b><p>Export or capture a real sample, create a verified evidence record with kind <code>test-export</code> or <code>test-capture</code>, and link it to the source system and a control in that family.</p><small>' + testComplete + ' of ' + testItems.length + ' control families tested</small><a href="#/resources/evidence?new=1">Add test capture</a></div></div><p class="stage-instructions-note">When both steps cover every selected control family, FileGRC marks the program Evidence Ready. Start the candidate period only after that point.</p></section>';
  }
  return "";
}

function setupResourceGuide(main) {
  const trigger = main.querySelector("#resource-guide-trigger");
  const guide = main.querySelector("#resource-guide");
  if (!trigger || !guide) return () => {};
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let pinned = false;
  let hideTimer = null;
  const cancelHide = () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = null;
  };
  const position = () => {
    const pageElement = main.querySelector(".page");
    const page = pageElement?.getBoundingClientRect();
    const header = trigger.closest(".page-intro")?.getBoundingClientRect();
    if (!pageElement || !page || !header) return;
    const pageStyle = getComputedStyle(pageElement);
    const paddingLeft = Number.parseFloat(pageStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(pageStyle.paddingRight) || 0;
    const left = Math.max(15, page.left + paddingLeft);
    const contentWidth = page.width - paddingLeft - paddingRight;
    const top = Math.max(10, Math.min(header.bottom + 10, window.innerHeight - 90));
    guide.style.left = left + "px";
    guide.style.top = top + "px";
    guide.style.width = Math.max(240, Math.min(contentWidth, window.innerWidth - left - 15)) + "px";
    guide.style.maxHeight = Math.max(120, window.innerHeight - top - 15) + "px";
  };
  const show = () => {
    cancelHide();
    guide.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    position();
  };
  const hide = (force = false) => {
    cancelHide();
    if (pinned && !force) return;
    guide.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer = window.setTimeout(() => hide(), 160);
  };
  trigger.addEventListener("mouseenter", show, options);
  trigger.addEventListener("mouseleave", scheduleHide, options);
  trigger.addEventListener("focus", show, options);
  trigger.addEventListener("blur", scheduleHide, options);
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    pinned = !pinned;
    if (pinned) show();
    else hide(true);
  }, options);
  guide.addEventListener("mouseenter", cancelHide, options);
  guide.addEventListener("mouseleave", scheduleHide, options);
  guide.addEventListener("focusin", cancelHide, options);
  guide.addEventListener("focusout", scheduleHide, options);
  document.addEventListener("pointerdown", (event) => {
    if (guide.hidden || trigger.contains(event.target) || guide.contains(event.target)) return;
    pinned = false;
    hide(true);
  }, options);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || guide.hidden) return;
    pinned = false;
    hide(true);
    trigger.focus({ preventScroll: true });
  }, options);
  window.addEventListener("resize", position, options);
  return () => {
    cancelHide();
    listeners.abort();
  };
}

function rendererSettingsEntry() {
  return state.resources.find(({ record }) => record.type === "renderer-settings");
}

function requestOnboarding() {
  if (state.readOnly || onboardingDialog || !rendererSettingsEntry()) return;
  if (parseRoute().name !== "home") {
    history.replaceState(null, "", "#/");
    render();
  }
  onboardingStep = 0;
  onboardingDraft = initialOnboardingDraft();
  onboardingBusy = false;
  onboardingShade = document.createElement("div");
  onboardingShade.className = "onboarding-shade";
  onboardingShade.setAttribute("aria-hidden", "true");
  onboardingShade.innerHTML = "<span></span><span></span><span></span><span></span>";
  document.body.append(onboardingShade);
  onboardingDialog = document.createElement("dialog");
  onboardingDialog.className = "onboarding-dialog";
  onboardingDialog.setAttribute("aria-labelledby", "onboarding-title");
  document.body.append(onboardingDialog);
  onboardingDialog.showModal();
  onboardingDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelOnboarding();
  });
  onboardingDialog.addEventListener("close", () => {
    clearOnboardingFocus();
    onboardingShade?.remove();
    onboardingShade = null;
    onboardingDialog.remove();
    onboardingDialog = null;
    onboardingDraft = null;
    onboardingBusy = false;
  });
  renderOnboardingStep();
}

function initialOnboardingDraft() {
  const systemEntry = resourcesOfType("system").find(({ record }) => record.inScope && record.status !== "retired");
  const owner = resourcesOfType("person").find(({ record }) => record.status === "active")?.record;
  return {
    systemId: systemEntry?.record.id || "",
    serviceName: systemEntry?.record.title || "",
    scope: systemEntry?.record.description || "",
    ownerId: systemEntry?.record.ownerIds?.[0] || owner?.id || "",
    criticality: systemEntry?.record.criticality || "high",
    dataClassification: systemEntry?.record.dataClassification || "Confidential",
    internetExposed: systemEntry?.record.internetExposed === false ? "false" : "true",
    programGoal: programGoalFromKind(state.workspace.assuranceGoal)
  };
}

function onboardingSteps() {
  const files = {
    target: ".repo-chip",
    kicker: "Mental model",
    title: "Files are the program",
    body: "You or an agent add JSON records, Markdown, and evidence attachments under data/. This renderer edits those files, and Git records their history.",
    points: [
      "Use the UI, an editor, the CLI, or an agent; every path changes the same files.",
      "JSON holds structured records. Markdown holds policies, plans, minutes, and other long-form work.",
      "Repository pulls with rebase, then commits and pushes reviewed changes together.",
      "Agents and terminal users run git pull --rebase, git commit, and git push directly.",
      "The dashboard derives program status from the current repository state."
    ]
  };
  const path = {
    target: ".readiness-map",
    kicker: "Program model",
    title: "Follow the audit chain",
    body: "The shortest dependable path is to define scope, approve policies, implement controls, prepare the evidence process, and operate the program before audit fieldwork begins.",
    points: [
      "Scope starts with the people and oversight team, applicable criteria, commitments, material vendors, and in-scope systems.",
      "Program operation includes current risk assessments and risks, which may add or change controls as conditions change.",
      "Evidence preparation means cataloging authoritative systems, documenting extraction, and testing captures before the candidate period.",
      "The CPA firm, formal report period, fieldwork, and final report are the last stage. Engage earlier only when timing or scope needs outside input."
    ]
  };
  const obligations = {
    target: ".obligation-panel",
    kicker: "Obligations",
    title: "Work the policy queue",
    body: "Recurring policy work appears as upcoming, due, or overdue. Each item shows the full allowed completion range, the first overdue date, and a live countdown to that cutoff.",
    points: [
      "Quarterly means any date in that cycle is valid unless the policy sets a narrower window.",
      "Link a dated completion record and its evidence to satisfy one occurrence.",
      "The UI and FileGRC CLI use the same calculation."
    ]
  };
  const events = {
    target: ".event-reminder-panel",
    kicker: "Triggered work",
    title: "Complete a checklist when key events occur",
    body: "Use an event reminder for a new worker, role change, departure, personal device, vendor change or incident, material system or data-use change, or security incident. One action item is created for every policy requirement, with its own owner, evidence, due range, and cutoff.",
    points: [
      "The checklist stays open until every action is done and has the requested completion record or evidence.",
      "Hour-based rules keep the event time and exact cutoff; day-based rules keep the policy date range.",
      "Every action has a policy-based cutoff or a reasonable default deadline for the event.",
      "Agents start the identical workflow with the FileGRC CLI."
    ]
  };
  const reportTypes = {
    target: null,
    kicker: "SOC 2 report types",
    title: "Choose the report goal",
    body: [
      "SOC 2 is an independent CPA report on controls relevant to the selected Trust Services Criteria.",
      "Most customer requests focus on Security. Add Availability, Processing Integrity, Confidentiality, or Privacy only when the service and customer need call for them."
    ],
    sections: [
      {
        title: "Type 1",
        body: "A CPA evaluates whether the controls are suitably designed and implemented at a point in time. Type 1 is optional before Type 2, but it can help with an urgent customer request."
      },
      {
        title: "Type 2",
        body: "A CPA evaluates whether the controls operated consistently throughout an agreed review period, often six months. Dated evidence must cover that period."
      }
    ],
    afterSections: "Most evidence comes from production, identity, monitoring, and business systems. FileGRC records where it comes from and how it was collected."
  };
  const audit = {
    target: ".audit-panel",
    kicker: "Final stage",
    title: "Engage the firm and prepare fieldwork",
    body: "Once the program is ready and evidence collection is running, record the CPA firm and the agreed scope and period. Then reconcile populations, answer requests, and generate the delivery packet.",
    points: [
      "The audit record holds the firm-agreed date or period; the workspace keeps management's earlier candidate dates.",
      "Audit Readiness identifies missing management documents, populations, exact-period evidence, and request work.",
      "The CPA firm selects samples, tests controls, evaluates exceptions, and issues the report."
    ]
  };
  const setup = {
    target: null,
    kicker: "Initial scope",
    title: "Describe the service you plan to audit",
    body: "This records the management goal and creates the first in-scope system. It does not create an audit engagement. Next, finish Step 1 by confirming the starter people and oversight team, criteria, commitments, vendors, and systems."
  };
  return [
    files,
    path,
    obligations,
    events,
    reportTypes,
    audit,
    setup
  ];
}

function renderOnboardingStep() {
  if (!onboardingDialog) return;
  const steps = onboardingSteps();
  const step = steps[onboardingStep];
  clearOnboardingFocus();
  const progress = steps.map((_, index) => '<span class="' + (index <= onboardingStep ? "active" : "") + '"></span>').join("");
  const explanation = step.sections
    ? '<div class="onboarding-sections">' + step.sections.map((section) => '<section><strong>' + esc(section.title) + '</strong><p>' + esc(section.body) + '</p></section>').join("") + '</div>'
    : step.points ? '<ul class="onboarding-points">' + step.points.map((point) => '<li>' + esc(point) + '</li>').join("") + '</ul>'
      : "";
  const description = (Array.isArray(step.body) ? step.body : [step.body]).map((paragraph) => '<p class="onboarding-body">' + esc(paragraph) + '</p>').join("");
  const afterSections = step.afterSections ? '<p class="onboarding-body onboarding-after-sections">' + esc(step.afterSections) + '</p>' : "";
  const body = onboardingStep === steps.length - 1
    ? onboardingSetupForm()
    : description + explanation + afterSections;
  const finalActions = onboardingStep === steps.length - 1
    ? '<button class="button" type="button" data-onboarding="draft">Save draft</button><button class="button primary" type="button" data-onboarding="next">Complete setup</button>'
    : '<button class="button primary" type="button" data-onboarding="next">Next</button>';
  onboardingDialog.innerHTML = '<div class="onboarding-progress" style="--onboarding-step-count:' + steps.length + '" aria-label="Onboarding step ' + (onboardingStep + 1) + ' of ' + steps.length + '">' + progress + '</div><div class="onboarding-head"><p class="kicker">' + esc(step.kicker) + ' · ' + (onboardingStep + 1) + ' of ' + steps.length + '</p><h2 id="onboarding-title">' + esc(titleCase(step.title)) + '</h2></div>' + body + '<div class="dialog-error" role="alert"></div><div class="dialog-actions onboarding-actions"><button class="button text-button onboarding-skip" type="button" data-onboarding="skip">Skip onboarding</button>' + (onboardingStep ? '<button class="button" type="button" data-onboarding="back">Back</button>' : "") + finalActions + '</div>';
  onboardingDialog.querySelector('[data-onboarding="skip"]').addEventListener("click", cancelOnboarding);
  onboardingDialog.querySelector('[data-onboarding="back"]')?.addEventListener("click", () => {
    captureOnboardingForm();
    onboardingStep -= 1;
    renderOnboardingStep();
  });
  onboardingDialog.querySelector('[data-onboarding="next"]').addEventListener("click", () => {
    if (onboardingStep === steps.length - 1) saveOnboarding(false);
    else {
      onboardingStep += 1;
      renderOnboardingStep();
    }
  });
  onboardingDialog.querySelector('[data-onboarding="draft"]')?.addEventListener("click", () => saveOnboarding(true));
  const target = onboardingTarget(step);
  if (target) {
    target.classList.add("onboarding-focus");
    const rect = target.getBoundingClientRect();
    const dialogWidth = onboardingDialog.offsetWidth;
    const fitsBeside = rect.right + 18 + dialogWidth <= window.innerWidth - 16 || rect.left - dialogWidth - 18 >= 16;
    target.scrollIntoView({ block: fitsBeside ? "center" : "start" });
  }
  requestAnimationFrame(() => {
    positionOnboardingDialog(target);
    positionOnboardingShade(target);
  });
  (onboardingStep === steps.length - 1
    ? onboardingDialog.querySelector('input[name="serviceName"]')
    : onboardingDialog.querySelector('[data-onboarding="next"]'))?.focus();
}

function onboardingSetupForm() {
  const people = resourcesOfType("person").filter(({ record }) => record.status === "active");
  const classifications = Object.keys(state.workspace.classificationDefinitions || {});
  if (onboardingDraft.dataClassification && !classifications.includes(onboardingDraft.dataClassification)) {
    classifications.push(onboardingDraft.dataClassification);
  }
  const currentSystem = onboardingDraft.systemId ? state.resources.find(({ record }) => record.id === onboardingDraft.systemId)?.record : null;
  const existing = [
    currentSystem ? "Updates system " + currentSystem.title + "." : "Creates a new in-scope system.",
    "Records a management program goal without creating an audit engagement."
  ].filter(Boolean).join(" ");
  const gitStatus = state.git.available && !state.git.branch
    ? '<div class="onboarding-git-status warning"><span class="status-dot warn"></span><span><strong>Detached HEAD detected</strong><small>Setup changes can be saved, but browser commits, pulls, and pushes are disabled until you check out a branch.</small></span></div>'
    : state.git.available && state.git.remotes?.length
    ? '<div class="onboarding-git-status"><span class="status-dot good"></span><span><strong>Git repository and remote detected</strong><small>Setup changes will appear in the workspace diff. Browser commits push to the configured remote.</small></span></div>'
    : state.git.available
      ? '<div class="onboarding-git-status warning"><span class="status-dot warn"></span><span><strong>Git remote needed</strong><small>Saving and local commits still work. Add a remote before the browser can push.</small></span></div>'
      : '<div class="onboarding-git-status warning"><span class="status-dot warn"></span><span><strong>Git setup needed</strong><small>Saving still works. Run <code>git init</code> at the workspace root before your first compliance commit.</small></span></div>';
  return '<p class="onboarding-body">' + esc(onboardingSteps().at(-1).body) + '</p>' + gitStatus + '<form id="onboarding-setup" class="onboarding-form"><label class="wide"><span>Service name</span><input name="serviceName" required maxlength="200" value="' + esc(onboardingDraft.serviceName) + '" placeholder="Customer-facing application"></label><label class="wide"><span>Scope description</span><textarea name="scope" required maxlength="2000" placeholder="What the service does and which production boundary is in scope">' + esc(onboardingDraft.scope) + '</textarea></label><label><span>Accountable owner</span><select name="ownerId" required><option value="">Select</option>' + people.map(({ record }) => '<option value="' + esc(record.id) + '" ' + (record.id === onboardingDraft.ownerId ? "selected" : "") + '>' + esc(record.title) + '</option>').join("") + '</select></label><label><span>Business criticality</span><select name="criticality" required>' + ["low", "medium", "high", "critical"].map((value) => '<option value="' + value + '" ' + (value === onboardingDraft.criticality ? "selected" : "") + '>' + esc(properCase(value)) + '</option>').join("") + '</select></label><label><span>Highest data classification</span><select name="dataClassification" required>' + classifications.map((value) => '<option value="' + esc(value) + '" ' + (value === onboardingDraft.dataClassification ? "selected" : "") + '>' + esc(properCase(value)) + '</option>').join("") + '</select></label><label><span>Internet exposed</span><select name="internetExposed" required><option value="true" ' + (onboardingDraft.internetExposed === "true" ? "selected" : "") + '>Yes</option><option value="false" ' + (onboardingDraft.internetExposed === "false" ? "selected" : "") + '>No</option></select></label><label class="wide"><span>Program goal</span><select name="programGoal" required><option value="none" ' + (onboardingDraft.programGoal === "none" ? "selected" : "") + '>No Assurance Goal Yet</option><option value="readiness" ' + (onboardingDraft.programGoal === "readiness" ? "selected" : "") + '>Program Readiness</option><option value="type-1" ' + (onboardingDraft.programGoal === "type-1" ? "selected" : "") + '>SOC 2 Type 1</option><option value="type-2" ' + (onboardingDraft.programGoal === "type-2" ? "selected" : "") + '>SOC 2 Type 2</option></select><small>This records management intent only. It does not create an engagement or establish the formal report period.</small></label></form><p class="onboarding-write-note">' + esc(existing) + ' Save draft keeps the system planned. Saving writes JSON files but does not commit them. Complete the remaining Step 1 pages next.</p>';
}

function captureOnboardingForm() {
  const form = onboardingDialog?.querySelector("#onboarding-setup");
  if (!form) return;
  const data = new FormData(form);
  for (const name of ["serviceName", "scope", "ownerId", "criticality", "dataClassification", "internetExposed", "programGoal"]) {
    onboardingDraft[name] = String(data.get(name) || "").trim();
  }
}

async function saveOnboarding(draft = false) {
  if (onboardingBusy) return;
  const form = onboardingDialog?.querySelector("#onboarding-setup");
  if (!form?.reportValidity()) return;
  captureOnboardingForm();
  setOnboardingBusy(true, draft ? "Saving draft…" : "Completing…");
  try {
    const response = await localFetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceName: onboardingDraft.serviceName,
        boundary: onboardingDraft.scope,
        ownerId: onboardingDraft.ownerId,
        criticality: onboardingDraft.criticality,
        dataClassification: onboardingDraft.dataClassification,
        internetExposed: onboardingDraft.internetExposed === "true",
        programGoal: onboardingDraft.programGoal,
        systemId: onboardingDraft.systemId,
        draft
      })
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    state = await fetchJson("/api/state");
    closeOnboarding();
    history.replaceState(null, "", draft ? "#/" : "#/stage/scope");
    render();
  } catch (error) {
    setOnboardingBusy(false);
    const errorNode = onboardingDialog?.querySelector(".dialog-error");
    if (errorNode) errorNode.textContent = error.message;
  }
}

async function cancelOnboarding() {
  if (!onboardingDialog || onboardingBusy) return;
  setOnboardingBusy(true, "Skipping…");
  try {
    await persistOnboardingPreference(false);
    closeOnboarding();
    render();
  } catch (error) {
    setOnboardingBusy(false);
    const errorNode = onboardingDialog?.querySelector(".dialog-error");
    if (errorNode) errorNode.textContent = error.message;
  }
}

async function persistOnboardingPreference(showOnboarding) {
  const entry = rendererSettingsEntry();
  if (!entry) throw new Error("Renderer settings are unavailable.");
  await writeRendererSettingsResource({ ...entry.record, showOnboarding }, entry);
  state = await fetchJson("/api/state");
}

async function writeRendererSettingsResource(record, entry) {
  const url = entry
    ? "/api/resource/" + encodeURIComponent(record.type) + "/" + encodeURIComponent(record.id)
    : "/api/resources";
  const response = await localFetch(url, {
    method: entry ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record, revision: entry?.revision })
  });
  if (!response.ok) throw new Error(await responseMessage(response));
}

async function toggleStagePageCompletion(button) {
  const entry = rendererSettingsEntry();
  if (!entry) throw new Error("Renderer settings are unavailable.");
  const completed = new Set(entry.record.completedStagePageIds || []);
  const pageId = button.dataset.stagePageCompletion;
  if (button.dataset.complete === "true") {
    completed.delete(pageId);
    (STAGE_PAGE_ID_ALIASES[pageId] || []).forEach((id) => completed.delete(id));
  } else {
    completed.add(pageId);
  }
  await writeRendererSettingsResource({
    ...entry.record,
    completedStagePageIds: [...completed].sort()
  }, entry);
  state = await fetchJson("/api/state");
}

function setOnboardingBusy(busy, label = "") {
  if (!onboardingDialog) return;
  onboardingBusy = busy;
  onboardingDialog.querySelectorAll("button,input,select,textarea").forEach((control) => { control.disabled = busy; });
  const next = onboardingDialog.querySelector('[data-onboarding="next"]');
  if (next && label) next.textContent = label;
  const skip = onboardingDialog.querySelector('[data-onboarding="skip"]');
  if (skip && label && onboardingStep !== onboardingSteps().length - 1) skip.textContent = label;
  if (!busy) renderOnboardingStep();
}

function positionOnboardingDialog(target) {
  if (!onboardingDialog) return;
  const viewportPadding = 16;
  const gap = 18;
  const width = onboardingDialog.offsetWidth;
  const height = onboardingDialog.offsetHeight;
  let left = Math.max(viewportPadding, (window.innerWidth - width) / 2);
  let top = Math.max(viewportPadding, (window.innerHeight - height) / 2);
  if (target) {
    const rect = target.getBoundingClientRect();
    const right = rect.right + gap;
    const leftSide = rect.left - width - gap;
    const below = rect.bottom + gap;
    const above = rect.top - height - gap;
    const beside = right + width <= window.innerWidth - viewportPadding || leftSide >= viewportPadding;
    if (right + width <= window.innerWidth - viewportPadding) left = right;
    else if (leftSide >= viewportPadding) left = leftSide;
    else {
      left = Math.min(
        Math.max(viewportPadding, rect.left + (rect.width - width) / 2),
        Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
      );
      if (below + height <= window.innerHeight - viewportPadding) top = below;
      else if (above >= viewportPadding) top = above;
    }
    if (beside) {
      top = Math.min(Math.max(viewportPadding, rect.top), Math.max(viewportPadding, window.innerHeight - height - viewportPadding));
    }
  }
  onboardingDialog.style.left = Math.round(left) + "px";
  onboardingDialog.style.top = Math.round(top) + "px";
}

function positionCurrentOnboarding() {
  if (!onboardingDialog) return;
  const target = onboardingTarget(onboardingSteps()[onboardingStep]);
  positionOnboardingDialog(target);
  positionOnboardingShade(target);
}

function onboardingTarget(step) {
  const selectors = Array.isArray(step?.target) ? step.target : [step?.target];
  for (const selector of selectors.filter(Boolean)) {
    const target = root.querySelector(selector);
    if (!target) continue;
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    if (style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0) return target;
  }
  return null;
}

function positionOnboardingShade(target) {
  if (!onboardingShade) return;
  const panels = [...onboardingShade.children];
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (!target) {
    setShadePanel(panels[0], 0, 0, viewportWidth, viewportHeight);
    panels.slice(1).forEach((panel) => setShadePanel(panel, 0, 0, 0, 0));
    return;
  }
  const gap = 11;
  const rect = target.getBoundingClientRect();
  const holeLeft = Math.max(0, Math.min(viewportWidth, rect.left - gap));
  const holeTop = Math.max(0, Math.min(viewportHeight, rect.top - gap));
  const holeRight = Math.max(holeLeft, Math.min(viewportWidth, rect.right + gap));
  const holeBottom = Math.max(holeTop, Math.min(viewportHeight, rect.bottom + gap));
  setShadePanel(panels[0], 0, 0, viewportWidth, holeTop);
  setShadePanel(panels[1], 0, holeBottom, viewportWidth, viewportHeight - holeBottom);
  setShadePanel(panels[2], 0, holeTop, holeLeft, holeBottom - holeTop);
  setShadePanel(panels[3], holeRight, holeTop, viewportWidth - holeRight, holeBottom - holeTop);
}

function setShadePanel(panel, left, top, width, height) {
  Object.assign(panel.style, {
    left: Math.round(left) + "px",
    top: Math.round(top) + "px",
    width: Math.max(0, Math.round(width)) + "px",
    height: Math.max(0, Math.round(height)) + "px"
  });
}

function clearOnboardingFocus() {
  root.querySelectorAll(".onboarding-focus").forEach((element) => element.classList.remove("onboarding-focus"));
}

function closeOnboarding() {
  if (!onboardingDialog) return;
  onboardingBusy = false;
  clearOnboardingFocus();
  onboardingDialog.close();
}

function programGoalFromKind(kind) {
  if (kind === "soc-2-type-1") return "type-1";
  if (kind === "soc-2-type-2") return "type-2";
  if (kind === "readiness") return "readiness";
  return "none";
}

function openEditor(type, entry = null, options = {}) {
  const definition = state.model.resources[type];
  const fields = { ...state.model.commonFields, ...definition.fields };
  const record = structuredClone(entry?.record || seedRecord(type, definition));
  const markdownDefinitions = dedicatedMarkdownDefinitions(type);
  if (!entry && options.seed) {
    Object.assign(record, options.seed);
    record.id = createResourceId(type, record.title, state.resources.map(({ record: existing }) => existing.id));
  }
  const required = new Set([
    ...Object.entries(state.model.commonFields).filter(([, field]) => field.required).map(([name]) => name),
    ...(definition.required || [])
  ]);
  const oneOf = new Set((definition.oneOf || []).flat().filter((name) => !name.startsWith("$markdown:")));
  const names = [...new Set([
    "title",
    ...required,
    ...(definition.listFields || []),
    ...Object.entries(fields).filter(([, field]) => field.requiredWhen).map(([name]) => name),
    ...oneOf
  ])].filter((name) => !["schemaVersion", "id", "type"].includes(name) && fields[name]);
  const dialog = document.createElement("dialog");
  dialog.className = "editor";
  dialog.setAttribute("aria-labelledby", "resource-editor-title");
  const activeMarkdown = markdownDefinitions.filter((markdown) => (
    markdown.required || markdown.requiredWhen || markdown.oneOf || !entry || entry.content?.[markdown.name]
  ));
  const recordContent = recordContentDefinition(type);
  const recordContentItem = recordContent ? entry?.content?.[recordContent.slot] : null;
  dialog.innerHTML = '<form><div class="dialog-head"><div><p class="kicker">' + (entry ? "Edit record" : options.obligationCompletion ? "Record obligation work" : "Create record") + '</p><h2 id="resource-editor-title">' + esc(titleCase(entry?.record.title || record.title || definition.title)) + '</h2></div><button type="button" class="icon-button" data-editor-dismiss aria-label="Close">×</button></div><p>' + esc(options.description || "Fill the core fields below. Git will record the author, time, reason, and diff when you commit this file.") + '</p><div class="form-grid">' + names.map((name) => editorField(type, name, fields[name], record[name], required.has(name) || conditionMatches(record, fields[name].requiredWhen), Boolean(entry), oneOf.has(name))).join("") + '</div>' +
    activeMarkdown.map((markdown) => {
      const generated = !entry?.content?.[markdown.name];
      const source = entry?.content?.[markdown.name]?.source ?? "# " + (record.title || "New " + definition.title) + "\n\nDescribe this " + definition.title.toLowerCase() + " here.\n";
      const requiredNow = markdown.required || conditionMatches(record, markdown.requiredWhen);
      const requiredMark = markdown.required || markdown.requiredWhen ? '<span class="required-mark" ' + (requiredNow ? "" : "hidden") + '>Required</span>' : markdown.oneOf ? '<span class="required-mark">One Required</span>' : "";
      return '<label class="content-editor-field" data-content-editor="' + esc(markdown.name) + '"><span>' + esc(markdown.label) + ' Markdown' + requiredMark + '</span><textarea data-markdown-slot="' + esc(markdown.name) + '" data-generated-content="' + generated + '" spellcheck="true" ' + (requiredNow ? "required" : "") + '>' + esc(source) + '</textarea></label>';
    }).join("") + renderRecordContentEditor(type, entry, options) +
    '<details class="advanced-editor"><summary>Advanced JSON</summary><p>Use this for optional fields, extensions, or bulk edits. Changes here replace the guided fields above.</p><textarea spellcheck="false" aria-label="Advanced resource JSON">' + esc(JSON.stringify(record, null, 2)) + '</textarea></details><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-editor-dismiss>Cancel</button><button type="submit" class="button primary" id="save-record">' + esc(options.saveLabel || "Save file") + '</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelectorAll("[data-editor-dismiss]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  wireEditorRequirements(dialog, record, fields, definition.oneOf || [], markdownDefinitions);
  dialog.querySelector(".advanced-editor textarea").addEventListener("input", () => {
    dialog.dataset.jsonDirty = "true";
    dialog.querySelector("form").noValidate = true;
  });
  if (!entry) {
    const titleInput = dialog.querySelector('[data-field-group="title"] input');
    let previousTitle = record.title;
    titleInput?.addEventListener("input", () => {
      const nextTitle = titleInput.value;
      const nextId = createResourceId(type, nextTitle, state.resources.map(({ record }) => record.id));
      const previousHeading = "# " + (previousTitle || "New " + definition.title);
      const nextHeading = "# " + (nextTitle || "New " + definition.title);
      dialog.querySelectorAll('[data-generated-content="true"]').forEach((textarea) => {
        if (textarea.value.startsWith(previousHeading + "\n")) {
          textarea.value = nextHeading + textarea.value.slice(previousHeading.length);
        }
      });
      record.id = nextId;
      record.title = nextTitle;
      dialog.querySelector(".advanced-editor textarea").value = JSON.stringify(record, null, 2);
      previousTitle = nextTitle;
    });
  }
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const advanced = dialog.dataset.jsonDirty === "true";
      if (!advanced && !dialog.querySelector("form").reportValidity()) return;
      const updated = advanced
        ? JSON.parse(dialog.querySelector(".advanced-editor textarea").value)
        : readGuidedRecord(dialog, record, fields);
      const content = {};
      dialog.querySelectorAll("[data-markdown-slot]").forEach((textarea) => {
        const markdown = markdownDefinitions.find(({ name }) => name === textarea.dataset.markdownSlot);
        const existing = entry?.content?.[markdown.name];
        if (textarea.value.trim() || existing || markdown.required) {
          const path = markdownPathFor(updated.type, updated.id, markdown.name);
          content[path] = textarea.value;
        }
      });
      const recordContentSource = dialog.querySelector("[data-record-content]");
      if (recordContent && recordContentSource) {
        const existing = entry?.content?.[recordContent.slot];
        if (recordContentSource.value.trim() || existing) {
          const path = markdownPathFor(updated.type, updated.id, recordContent.slot);
          content[path] = recordContentSource.value;
        }
      }
      const url = entry
        ? "/api/resource/" + encodeURIComponent(type) + "/" + encodeURIComponent(entry.record.id)
        : options.obligationCompletion ? "/api/obligation-completions" : "/api/resources";
      const contentRevisions = Object.fromEntries([
        ...activeMarkdown.map(({ name }) => [entry?.content?.[name]?.path, entry?.content?.[name]?.revision]),
        [recordContentItem?.path, recordContentItem?.revision]
      ].filter(([path, revision]) => path && revision));
      const response = await localFetch(url, {
        method: entry ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          record: updated,
          content,
          revision: entry?.revision || options.obligationCompletion?.revision,
          contentRevisions,
          obligationId: options.obligationCompletion?.obligationId
        })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      state = await fetchJson("/api/state");
      dialog.close();
      location.hash = "#/resource/" + encodeURIComponent(updated.type) + "/" + encodeURIComponent(updated.id);
      render();
    } catch (error) {
      dialog.querySelector(".dialog-error").textContent = error.message;
    }
  });
}

function seedRecord(type, definition) {
  const record = { schemaVersion: 1, id: createResourceId(type, "new", state.resources.map(({ record }) => record.id)), type, title: "" };
  const fields = { ...state.model.commonFields, ...definition.fields };
  for (const name of definition.required || []) {
    const field = fields[name];
    if (record[name] !== undefined) continue;
    if (field.relation) {
      const candidates = relationCandidates(field);
      record[name] = field.type === "array" ? (candidates.length === 1 ? [candidates[0].record.id] : []) : (candidates.length === 1 ? candidates[0].record.id : "");
    }
    else if (field.type === "array") record[name] = [];
    else if (field.type === "object") record[name] = {};
    else if (field.type === "boolean") record[name] = false;
    else if (field.type === "integer" || field.type === "number") record[name] = 0;
    else if (field.values?.length) record[name] = field.values[0];
    else record[name] = "";
  }
  for (const choices of definition.oneOf || []) {
    if (choices.some((name) => record[name] !== undefined)) continue;
    const name = choices.find((candidate) => fields[candidate]);
    if (name) record[name] = fields[name].type === "array" ? [] : "";
  }
  return record;
}

function dedicatedMarkdownDefinitions(type) {
  const definition = state.model.resources[type];
  const choices = new Set((definition.oneOf || []).flat().filter((name) => name.startsWith("$markdown:")).map((name) => name.slice("$markdown:".length)));
  return Object.entries(definition.markdown || {}).map(([name, markdown]) => ({
    name,
    label: markdown.label || humanize(name),
    primary: Boolean(markdown.primary),
    required: Boolean(markdown.required),
    requiredWhen: markdown.requiredWhen || null,
    oneOf: choices.has(name)
  }));
}

function markdownPathFor(type, id, name) {
  const definition = state.model.resources[type];
  const markdown = definition.markdown?.[name];
  const primary = markdown ? Boolean(markdown.primary) : !definition.markdown && name === state.model.recordContent.slot;
  const recordPath = definition.singleton || definition.collection + "/" + (definition.recordPath || "{id}.json").replaceAll("{id}", id);
  const slash = recordPath.lastIndexOf("/");
  const directory = slash === -1 ? "" : recordPath.slice(0, slash + 1);
  const filename = recordPath.slice(slash + 1).replace(/\.json$/, "");
  const suffix = primary ? "" : "-" + name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return directory + filename + suffix + ".md";
}

function renderRecordContentEditor(type, entry, options) {
  const config = recordContentDefinition(type);
  if (!config) return "";
  const item = entry?.content?.[config.slot];
  const source = item?.source || "";
  const editor = '<label class="content-editor-field record-content-editor"><span>' + esc(config.label) + ' Markdown <small>optional</small></span><textarea data-record-content spellcheck="true" placeholder="Document the work performed, method, results, decisions, and follow-up.">' + esc(source) + '</textarea></label>';
  if (config.mode === "default") return editor;
  const open = item || options.addRecordContent;
  return '<details class="record-content-details" ' + (open ? "open" : "") + '><summary>' + (item ? "Record Markdown" : "Add Record Markdown") + '</summary><p>Use this when the structured fields do not capture the full record.</p>' + editor + '</details>';
}

function editorField(type, name, field, value, required, editing, oneOfRequired = false) {
  const label = fieldLabel(type, name);
  const requiredMark = required || field.requiredWhen || oneOfRequired
    ? '<span class="required-mark" ' + (required || oneOfRequired ? "" : "hidden") + '>' + (oneOfRequired ? "One Required" : "Required") + '</span>'
    : "";
  const help = name === "title"
    ? (editing ? "Renaming this record will not change its stable ID." : "A stable ID and file name will be generated from this value.")
    : field.relation ? relationHelp(field)
    : "";
  let control;
  if (field.relation && field.type === "array") {
    const candidates = relationCandidates(field);
    control = candidates.length
      ? '<div class="checkbox-list">' + candidates.map(({ record }) => '<label><input type="checkbox" value="' + esc(record.id) + '" ' + ((value || []).includes(record.id) ? "checked" : "") + '><span>' + esc(record.title) + '<small>' + esc(record.id) + '</small></span></label>').join("") + '</div>'
      : required ? '<select><option value="">No Matching Resources Exist Yet</option></select>' : '<div class="missing-options">No matching resources exist yet.</div>';
    return fieldWrap(name, "relation-array", label, requiredMark, control, help, required);
  }
  if (field.relation) {
    const candidates = relationCandidates(field);
    control = candidates.length
      ? '<select><option value="">Select a Resource</option>' + candidates.map(({ record }) => '<option value="' + esc(record.id) + '" ' + (value === record.id ? "selected" : "") + '>' + esc(record.title) + ' · ' + esc(record.id) + '</option>').join("") + '</select>'
      : required ? '<select><option value="">No Matching Resources Exist Yet</option></select>' : '<div class="missing-options">No matching resources exist yet.</div>';
    return fieldWrap(name, "relation", label, requiredMark, control, help, required);
  }
  if (field.type === "enum" || field.type === "rating" || field.type === "outcome") {
    const values = field.values || (field.type === "rating" ? state.model.primitives.rating : state.model.primitives.outcome) || [];
    control = '<select><option value="">Select</option>' + values.map((item) => '<option value="' + esc(item) + '" ' + (value === item ? "selected" : "") + '>' + esc(properCase(item)) + '</option>').join("") + '</select>';
    return fieldWrap(name, "string", label, requiredMark, control, help, required);
  }
  if (field.type === "boolean") {
    control = '<select><option value="">Not Set</option><option value="true" ' + (value === true ? "selected" : "") + '>Yes</option><option value="false" ' + (value === false ? "selected" : "") + '>No</option></select>';
    return fieldWrap(name, "boolean", label, requiredMark, control, help, required);
  }
  if (field.type === "object") {
    control = '<textarea spellcheck="false" placeholder="{ }">' + esc(value === undefined ? "" : JSON.stringify(value, null, 2)) + '</textarea>';
    return fieldWrap(name, "object", label, requiredMark, control, "JSON object", required);
  }
  if (field.type === "array") {
    control = '<textarea placeholder="One value per line">' + esc((value || []).join("\n")) + '</textarea>';
    return fieldWrap(name, "array", label, requiredMark, control, "One value per line", required);
  }
  if (["description", "statement", "scope", "rationale", "purpose"].some((part) => name.toLowerCase().includes(part))) {
    control = '<textarea>' + esc(value ?? "") + '</textarea>';
  } else {
    const inputType = field.type === "date" ? "date" : field.type === "number" || field.type === "integer" ? "number" : field.format === "email" ? "email" : "text";
    const placeholder = name === "title" && !editing ? ' placeholder="Enter ' + esc(label.toLowerCase()) + '"' : "";
    const minimum = field.minimum !== undefined ? ' min="' + esc(field.minimum) + '"' : "";
    const maximum = field.maximum !== undefined ? ' max="' + esc(field.maximum) + '"' : "";
    control = '<input type="' + inputType + '" value="' + esc(value ?? "") + '"' + placeholder + minimum + maximum + '>';
  }
  return fieldWrap(name, field.type, label, requiredMark, control, help, required);
}

function fieldWrap(name, kind, label, requiredMark, control, help, required) {
  const labelId = "field-label-" + name;
  let labelledControl = control.replace(/^<([a-z]+)/, '<$1 aria-labelledby="' + esc(labelId) + '"');
  if (required && /^(input|select|textarea)$/.test(labelledControl.match(/^<([a-z]+)/)?.[1] || "")) {
    labelledControl = labelledControl.replace(/^<([a-z]+)/, "<$1 required");
  }
  return '<div class="form-field" data-field-group="' + esc(name) + '" data-kind="' + esc(kind) + '" data-required="' + (required ? "true" : "false") + '"><div class="field-label" id="' + esc(labelId) + '">' + esc(label) + requiredMark + '</div>' + labelledControl + (help ? '<small>' + esc(help) + '</small>' : "") + '</div>';
}

function wireEditorRequirements(dialog, base, fields, oneOfGroups, markdownDefinitions = []) {
  const refreshGroup = (group, required) => {
    group.dataset.required = required ? "true" : "false";
    const mark = group.querySelector(".required-mark");
    if (mark) mark.hidden = !required;
    const checkboxes = [...group.querySelectorAll('input[type="checkbox"]')];
    if (checkboxes.length) {
      const hasSelection = checkboxes.some((checkbox) => checkbox.checked);
      const requiredIndex = hasSelection ? checkboxes.findIndex((checkbox) => checkbox.checked) : 0;
      checkboxes.forEach((checkbox, index) => { checkbox.required = required && index === requiredIndex; });
      return;
    }
    const control = group.querySelector("input,select,textarea");
    if (control) control.required = required;
  };
  const currentValue = (name) => {
    const markdownName = name.startsWith("$markdown:") ? name.slice("$markdown:".length) : null;
    if (markdownName) return dialog.querySelector('[data-markdown-slot="' + CSS.escape(markdownName) + '"]')?.value;
    const group = dialog.querySelector('[data-field-group="' + CSS.escape(name) + '"]');
    if (!group) return base[name];
    if (group.dataset.kind === "relation-array") {
      return [...group.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    }
    const control = group.querySelector("input,select,textarea");
    if (!control) return base[name];
    if (group.dataset.kind === "boolean") return control.value === "" ? undefined : control.value === "true";
    if (group.dataset.kind === "integer" || group.dataset.kind === "number") return control.value === "" ? undefined : Number(control.value);
    return control.value;
  };
  const refresh = () => {
    for (const [name, field] of Object.entries(fields)) {
      if (!field.requiredWhen) continue;
      const group = dialog.querySelector('[data-field-group="' + CSS.escape(name) + '"]');
      if (!group) continue;
      const required = Object.entries(field.requiredWhen).every(([conditionName, expected]) => currentValue(conditionName) === expected);
      refreshGroup(group, required);
    }
    for (const group of dialog.querySelectorAll('[data-kind="relation-array"][data-required="true"]')) {
      refreshGroup(group, true);
    }
    for (const markdown of markdownDefinitions) {
      if (!markdown.requiredWhen) continue;
      const required = Object.entries(markdown.requiredWhen).every(([conditionName, expected]) => currentValue(conditionName) === expected);
      const wrapper = dialog.querySelector('[data-content-editor="' + CSS.escape(markdown.name) + '"]');
      const control = wrapper?.querySelector("textarea");
      const mark = wrapper?.querySelector(".required-mark");
      if (control) control.required = required;
      if (mark) mark.hidden = !required;
    }
    for (const names of oneOfGroups) {
      const choices = names.map((name) => {
        const markdownName = name.startsWith("$markdown:") ? name.slice("$markdown:".length) : null;
        const group = dialog.querySelector('[data-field-group="' + CSS.escape(name) + '"]');
        const value = currentValue(name);
        const present = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== "";
        return { control: markdownName ? dialog.querySelector('[data-markdown-slot="' + CSS.escape(markdownName) + '"]') : group?.querySelector("input,select,textarea"), present };
      }).filter(({ control }) => control);
      choices.forEach(({ control }) => {
        control.required = false;
        control.setCustomValidity("");
      });
      const choice = choices.find(({ present }) => present) || choices[0];
      if (choice) {
        choice.control.required = true;
        choice.control.setCustomValidity(choice.present ? "" : "Provide at least one of: " + names.map((name) => humanize(name.replace(/^\$markdown:/, "") + (name.startsWith("$markdown:") ? " Markdown" : ""))).join(", ") + ".");
      }
    }
  };
  for (const group of dialog.querySelectorAll("[data-field-group]")) {
    refreshGroup(group, group.dataset.required === "true");
  }
  dialog.querySelector("form").addEventListener("input", refresh);
  dialog.querySelector("form").addEventListener("change", refresh);
  refresh();
}

function readGuidedRecord(dialog, base, fields) {
  const record = structuredClone(base);
  for (const group of dialog.querySelectorAll("[data-field-group]")) {
    const name = group.dataset.fieldGroup;
    const kind = group.dataset.kind;
    let value;
    if (kind === "relation-array") value = [...group.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    else {
      const control = group.querySelector("input,select,textarea");
      const raw = control?.value ?? "";
      if (kind === "array") value = raw.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
      else if (kind === "object") value = raw.trim() ? JSON.parse(raw) : undefined;
      else if (kind === "boolean") value = raw === "" ? undefined : raw === "true";
      else if (kind === "integer") value = raw === "" ? undefined : Number(raw);
      else if (kind === "number") value = raw === "" ? undefined : Number(raw);
      else value = raw;
    }
    if ((value === "" || value === undefined || (Array.isArray(value) && !value.length)) && group.dataset.required !== "true") delete record[name];
    else record[name] = value;
  }
  return record;
}

function relationCandidates(field) {
  return state.resources.filter(({ record }) => field.relation.includes("*") || field.relation.includes(record.type));
}

function relationHelp(field) {
  return "References " + (field.relation.includes("*") ? "any resource" : field.relation.map((type) => state.model.resources[type]?.pluralTitle || type).join(" or "));
}

function openContentEditor(entry, name) {
  const item = entry.content[name];
  if (!item) return;
  const dialog = document.createElement("dialog");
  dialog.className = "editor content-dialog";
  dialog.setAttribute("aria-labelledby", "content-editor-title");
  dialog.innerHTML = '<form method="dialog"><div class="dialog-head"><div><p class="kicker">Edit Markdown</p><h2 id="content-editor-title">' + esc(titleCase(entry.record.title)) + '</h2></div><button value="cancel" class="icon-button" aria-label="Close">×</button></div><p><code>' + esc(item.path) + '</code></p><textarea class="markdown-source" spellcheck="true" aria-label="Markdown content">' + esc(item.source) + '</textarea><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button value="cancel" class="button">Cancel</button><button type="button" class="button primary" id="save-content">Save Markdown</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("#save-content").addEventListener("click", async () => {
    try {
      const response = await localFetch("/api/content", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: item.path, source: dialog.querySelector(".markdown-source").value, revision: item.revision }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      state = await fetchJson("/api/state");
      dialog.close();
      render();
    } catch (error) {
      dialog.querySelector(".dialog-error").textContent = error.message;
    }
  });
}

function bindCommon() {
  root.querySelectorAll("[data-stage-page-completion]").forEach((button) => button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await toggleStagePageCompletion(button);
      render();
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      button.title = error.message;
    }
  }));
  root.querySelectorAll(".nav-toggle, .nav-subgroup-toggle").forEach((button) => button.addEventListener("click", () => {
    const group = button.closest(".nav-group");
    const open = group.classList.toggle("open");
    setNavigationGroupOpen(group.dataset.group, open);
    button.setAttribute("aria-expanded", String(open));
    const label = button.closest(".nav-heading-row, .nav-subheading-row")?.querySelector(".nav-heading, .nav-subheading")?.textContent.trim() || "group";
    button.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + label);
  }));
  const navButton = root.querySelector(".mobile-nav");
  const sidebar = root.querySelector(".sidebar");
  const workspace = root.querySelector(".workspace");
  const setNavigation = (open) => {
    sidebar.classList.toggle("shown", open);
    workspace.inert = open;
    navButton?.setAttribute("aria-expanded", String(open));
    navButton?.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    if (open) sidebar.querySelector(".nav-close")?.focus();
  };
  navButton?.addEventListener("click", () => setNavigation(!sidebar.classList.contains("shown")));
  root.querySelector(".nav-close")?.addEventListener("click", () => {
    setNavigation(false);
    navButton?.focus();
  });
  root.querySelector(".nav-scrim")?.addEventListener("click", () => {
    setNavigation(false);
    navButton?.focus();
  });
  const search = root.querySelector("#global-search");
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && search.value.trim()) {
      event.preventDefault();
      globalSearch(search.value);
    }
  });
  document.onkeydown = (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("shown")) {
      setNavigation(false);
      navButton?.focus();
      return;
    }
    if (event.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName)) {
      event.preventDefault();
      search?.focus();
    }
  };
}

function globalSearch(query) {
  query = query.trim();
  const matches = state.resources.filter((entry) => entrySearchText(entry).includes(query.toLowerCase()));
  let pageNumber = 1;
  const dialog = document.createElement("dialog");
  dialog.className = "search-results";
  dialog.setAttribute("aria-labelledby", "search-results-title");
  dialog.innerHTML = '<div class="dialog-head"><div><p class="kicker">Search</p><h2 id="search-results-title">' + esc(query) + '</h2></div><button class="icon-button" aria-label="Close">×</button></div><div class="result-list"></div><nav class="pagination search-pagination" aria-label="Search result pages" hidden><button class="button" type="button" data-search-page="previous">Previous</button><span class="page-status" aria-live="polite"></span><button class="button" type="button" data-search-page="next">Next</button></nav>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector(".icon-button").onclick = () => dialog.close();
  const results = dialog.querySelector(".result-list");
  const pagination = dialog.querySelector(".search-pagination");
  const previous = pagination.querySelector('[data-search-page="previous"]');
  const next = pagination.querySelector('[data-search-page="next"]');
  const pageStatus = pagination.querySelector(".page-status");
  const renderResults = () => {
    const totalPages = Math.max(1, Math.ceil(matches.length / SEARCH_PAGE_SIZE));
    const start = (pageNumber - 1) * SEARCH_PAGE_SIZE;
    const visible = matches.slice(start, start + SEARCH_PAGE_SIZE);
    results.innerHTML = visible.length ? visible.map(({ record }) => '<a href="#/resource/' + encodeURIComponent(record.type) + '/' + encodeURIComponent(record.id) + '"><strong>' + esc(record.title) + '</strong><small>' + esc(state.model.resources[record.type].title) + '</small></a>').join("") : empty("No matching records.");
    results.querySelectorAll("a").forEach((link) => link.onclick = () => dialog.close());
    pagination.hidden = totalPages === 1;
    previous.disabled = pageNumber === 1;
    next.disabled = pageNumber === totalPages;
    const firstVisible = matches.length ? start + 1 : 0;
    const lastVisible = Math.min(start + SEARCH_PAGE_SIZE, matches.length);
    pageStatus.textContent = "Page " + pageNumber + " of " + totalPages + " · " + firstVisible + "–" + lastVisible + " of " + matches.length;
  };
  previous.addEventListener("click", () => {
    pageNumber -= 1;
    renderResults();
    results.scrollTop = 0;
  });
  next.addEventListener("click", () => {
    pageNumber += 1;
    renderResults();
    results.scrollTop = 0;
  });
  renderResults();
  dialog.addEventListener("close", () => dialog.remove());
}

function auditProgress(audit) {
  const requests = resourcesOfType("audit-request").filter(({ record }) => record.auditId === audit.id);
  if (!requests.length) {
    return '<div class="audit-progress-empty"><strong>No audit requests yet</strong><span>Add them when the auditor sends the request list.</span></div>';
  }
  const complete = requests.filter(({ record }) => ["complete", "accepted", "closed"].includes(record.status)).length;
  const percentage = requests.length ? Math.round((complete / requests.length) * 100) : 0;
  return '<div class="audit-progress"><div class="progress-number"><strong>' + percentage + '%</strong><span>requests complete</span></div><div class="progress"><span style="width:' + percentage + '%"></span></div><div class="progress-meta"><span>' + complete + ' complete</span><span>' + (requests.length - complete) + ' open</span><span>' + requests.length + ' total</span></div></div>';
}

function metric(label, value, note, tone) {
  return '<section class="metric"><div class="metric-label"><span class="status-dot ' + tone + '"></span>' + esc(label) + '</div><strong>' + esc(value) + '</strong><small>' + esc(note) + '</small></section>';
}
function countOverdue(entries) { const today = currentDate(); return entries.filter(({ record }) => dueDate(record) && dueDate(record) < today).length; }
function dueDate(record) {
  const explicit = record.dueOn || record.nextDueOn || record.reviewDueOn || record.expiresOn || record.acceptanceExpiresOn || record.scheduledOn;
  if (explicit) return explicit;
  if (record.type !== "obligation" || record.status !== "active") return null;
  const recurrence = record.recurrence?.anchorDate
    ? record.recurrence
    : { ...(record.recurrence || {}), anchorDate: record.startsOn };
  return nextCalendarOccurrence(recurrence, currentDate());
}
function currentDate() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: state.workspace.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year + "-" + values.month + "-" + values.day;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function currentLocalDateTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function formatCadence(value) {
  if (!value || typeof value !== "object") return "";
  if (value.mode === "calendar" && Number.isInteger(value.interval) && value.interval > 0 && value.unit) {
    return value.interval === 1 ? "Every " + value.unit : "Every " + value.interval + " " + value.unit + "s";
  }
  return value.mode ? humanize(value.mode) : "";
}
function resourcesOfType(type) { return state.resources.filter(({ record }) => record.type === type); }
function searchText(record) {
  const definition = state.model.resources[record.type];
  if (!definition) return "";
  const fields = { ...state.model.commonFields, ...definition.fields };
  const values = [record.id, record.type];
  Object.entries(fields).forEach(([name, field]) => {
    if (!field.search || record[name] === undefined) return;
    values.push(...(Array.isArray(record[name]) ? record[name] : [record[name]]));
  });
  return values.map(String).join(" ").toLowerCase();
}
function entrySearchText(entry) {
  return (searchText(entry.record) + " " + Object.values(entry.content || {}).map((item) => item.source || "").join(" ")).toLowerCase();
}
function readNavigationGroupState() {
  try {
    const value = JSON.parse(window.localStorage.getItem(NAV_GROUP_STORAGE_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, open]) => typeof open === "boolean"));
  } catch {
    return {};
  }
}
function setNavigationGroupOpen(group, open) {
  navigationGroupState[group] = open;
  try {
    window.localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify(navigationGroupState));
  } catch {
    // Browser storage may be unavailable; the current page still keeps the state.
  }
}
function groupTitle(id) { return state.model.groups.find((group) => group.id === id)?.title || "Program"; }
function fieldDefinition(type, name) { return state.model.resources[type]?.fields?.[name] || state.model.commonFields[name]; }
function fieldLabel(type, name) {
  if (name === "$operationTracking") return "Operation tracking";
  if (name === "title") return state.model.resources[type]?.titleLabel || state.model.commonFields.title.label;
  const recordContent = recordContentDefinition(type);
  if (recordContent && name === recordContent.slot) return recordContent.label;
  const markdown = dedicatedMarkdownDefinitions(type).find((item) => item.name === name);
  if (markdown) return markdown.label;
  return fieldDefinition(type, name)?.label || humanize(name);
}
function filterOptionLabel(value) { return state.resources.find(({ record }) => record.id === value)?.record.title || properCase(value); }
function humanize(value) { return String(value).replace(/[-_]+/g, " ").replace(/Ids?$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()); }
function properCase(value) { return humanize(value).replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\bSoc 2\b/g, "SOC 2"); }
function titleCase(value) {
  const words = String(value).split(/\s+/);
  return words.map((word, index) => {
    const bare = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if ((/[A-Z]/.test(bare) && !/[a-z]/.test(bare)) || /^[A-Z]{2,}[a-z]?$/.test(bare) || /[a-z][A-Z]/.test(bare)) return word;
    if (index > 0 && index < words.length - 1 && TITLE_CASE_MINOR_WORDS.has(bare.toLowerCase())) return word.toLowerCase();
    return word.toLowerCase().replace(/(^|[-/])([a-z])/g, (_, boundary, letter) => boundary + letter.toUpperCase());
  }).join(" ");
}
function conditionMatches(record, condition) { return Boolean(condition) && Object.entries(condition).every(([name, expected]) => record[name] === expected); }
function formatValue(value, field, type) {
  if (value === undefined || value === null || value === "") return '<span class="muted">Not set</span>';
  const definition = fieldDefinition(type, field);
  if (definition?.type === "date") return esc(formatCalendarDate(value));
  if (definition?.type === "timestamp") return esc(formatLocalDateTime(value));
  if (field === "status" || field.endsWith("Rating") || field === "severity" || field === "outcome") return '<span class="badge status-' + esc(String(value)) + '">' + esc(String(value)) + '</span>';
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? '<code>' + esc(JSON.stringify(item)) + '</code>' : formatReference(item)).join(" ") : '<span class="muted">None</span>';
  if (field === "sourceReference" && typeof value === "object") {
    const href = safeExternalUrl(value.url);
    if (href) return '<a class="external-source" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer"><span><strong>' + esc(value.title || "Official source") + '</strong><small>' + esc(href) + '</small></span><b aria-hidden="true">↗</b></a>';
  }
  if (typeof value === "object") return '<pre class="compact-json">' + esc(JSON.stringify(value, null, 2)) + '</pre>';
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const reference = state.resources.find(({ record }) => record.id === value);
  if (reference) return '<a class="tag relation" href="#/resource/' + encodeURIComponent(reference.record.type) + '/' + encodeURIComponent(reference.record.id) + '">' + esc(reference.record.title) + '</a>';
  return esc(String(value));
}
function controlOperationTracking(control) {
  const obligations = resourcesOfType("obligation").filter(({ record }) => (record.controlIds || []).includes(control.id));
  return obligations.length
    ? '<span class="operation-tracking"><strong>Work Queue</strong><small>' + obligations.length + ' linked ' + pluralize("schedule", obligations.length) + '</small></span>'
    : '<span class="operation-tracking"><strong>Evidence records</strong><small>No scheduled obligation</small></span>';
}
function formatReference(value) {
  const reference = state.resources.find(({ record }) => record.id === value);
  return reference ? '<a class="tag relation" href="#/resource/' + encodeURIComponent(reference.record.type) + '/' + encodeURIComponent(reference.record.id) + '">' + esc(reference.record.title) + '</a>' : '<span class="tag">' + esc(value) + '</span>';
}
function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
${createResourceId.toString()}
${parseCalendarDate.toString()}
${utcCalendarDate.toString()}
${formatCalendarDateUtc.toString()}
${validCalendarRecurrence.toString()}
${calendarOccurrence.toString()}
${calendarOccurrenceIndex.toString()}
${nextCalendarOccurrence.toString()}
${formatCalendarDate.toString()}
${formatLocalDateTime.toString()}
function empty(message) { return '<div class="empty">' + esc(message) + '</div>'; }
function pluralize(noun, count) { return count === 1 ? noun : noun + "s"; }
function renderNotFound(main) { main.innerHTML = '<div class="page">' + empty("That resource does not exist.") + '</div>'; }
function showError(message) {
  const dialog = document.createElement("dialog");
  dialog.className = "alert-dialog";
  dialog.setAttribute("aria-labelledby", "alert-dialog-title");
  dialog.innerHTML = '<div class="dialog-head"><div><p class="kicker">Could not complete the action</p><h2 id="alert-dialog-title">Review the Record</h2></div><button class="icon-button" aria-label="Close">×</button></div><p>' + esc(message) + '</p><div class="dialog-actions"><button class="button primary">Close</button></div>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
}
async function responseMessage(response) {
  const source = await response.text();
  try { return JSON.parse(source).error || source; } catch { return source; }
}
async function localFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error("The FileGRC server is unavailable. Restart npm run serve, or pnpm dev in the monorepo, and try again.");
  }
}
async function fetchJson(url, options) { const response = await localFetch(url, options); if (!response.ok) throw new Error(await responseMessage(response)); return response.json(); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
`;

export const APP_STYLES = String.raw`
:root{--ink:#151827;--muted:#5d6475;--line:#dfe3ef;--paper:#f6f7fb;--panel:#fff;--accent:#0000a5;--accent-soft:#eef1ff;--accent-light:#8aa1ff;--focus:#0000e0;--amber:#8a5200;--red:#a13a31;--sidebar:linear-gradient(135deg,#000070 0%,#000035 60%);--primary-gradient:linear-gradient(135deg,#000070 0%,#000035 60%);--surface-soft:#f2f4fa;--surface-muted:#eceff7;--field:#fff;--field-readonly:#eef0f6;--code-bg:#10162b;--code-ink:#e8ebff;--shadow:0 8px 28px rgba(0,0,53,.08);color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper);font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-width:320px;background:var(--paper)}button,input,select,textarea{font:inherit}a{color:inherit}.skip-link{position:fixed;left:1rem;top:-4rem;z-index:100;padding:.7rem 1rem;background:#fff}.skip-link:focus{top:1rem}.loading,.fatal{padding:3rem}.shell{display:grid;grid-template-columns:248px 1fr;min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:248px;background:var(--sidebar);color:#eef1ff;padding:25px 18px 18px;overflow:auto;z-index:20}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;margin:0 7px 27px}.brand .mark{display:block;width:39px;height:39px;border-radius:10px}.brand strong,.brand small{display:block}.brand strong{color:#fff;font-size:18px}.brand small{font-size:13.2px;color:#c5cae2;margin-top:2px}.nav-home,.nav-items a{display:flex;justify-content:space-between;align-items:center;text-decoration:none;border-radius:7px;padding:8px 10px;font-size:15.6px;color:#d5d9ed}.nav-home{margin-bottom:9px}.nav-home:hover,.nav-items a:hover,.nav-home.current,.nav-items a.current{background:#202066;color:#fff}.nav-heading{width:100%;border:0;background:none;color:#b4bbdc;text-transform:uppercase;letter-spacing:.11em;font-size:12px;font-weight:750;display:flex;align-items:center;justify-content:space-between;padding:13px 10px 5px;cursor:pointer}.chevron{display:grid;place-items:center;width:14px;height:22px;font-size:0;line-height:1;transform:none}.chevron:before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transform-origin:center;transition:transform .15s}.nav-items{display:none}.nav-group.open .nav-items{display:block}.nav-items small{font-size:12px;color:#b8bed7}.side-foot{position:sticky;bottom:-18px;margin:25px -18px -18px;padding:17px 25px;background:#000024;border-top:1px solid #34345f;color:#cbd0e5;font-size:13.2px;display:flex;align-items:center;gap:8px}.status-dot{width:8px;height:8px;border-radius:50%;background:#9aa39f;display:inline-block;flex:0 0 auto}.status-dot.good,.badge.good{background:#6abf8c}.status-dot.warn,.badge.warn{background:#e9a445}.status-dot.bad,.badge.bad{background:#dc6c5d}.status-dot.neutral{background:#9aabff}.workspace{grid-column:2;min-width:0}.topbar{height:86px;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:0 32px;display:flex;align-items:center;gap:23px;position:sticky;top:0;z-index:10}.topbar>div:first-of-type{min-width:190px}.topbar h1{font-size:20.4px;line-height:1.1;margin:3px 0 0}.eyebrow,.kicker{color:var(--accent);text-transform:uppercase;letter-spacing:.12em;font-weight:760;font-size:10.8px;margin:0}.search{height:39px;max-width:480px;flex:1;margin-left:auto;display:flex;align-items:center;gap:9px;background:#f2f4fa;border:1px solid #dfe3ef;border-radius:8px;padding:0 10px;color:#5d6475}.search input{border:0;outline:0;background:none;min-width:0;flex:1;font-size:15.6px}.search kbd{background:#fff;border:1px solid #dfe3ef;border-radius:4px;padding:1px 5px;font-size:12px}.repo-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);font-size:13.2px;white-space:nowrap;text-decoration:none}.mobile-nav{display:none}.page{padding:30px 34px 70px;max-width:1510px;margin:auto}.hero{color:#f8f9ff;background:linear-gradient(120deg,#000070,#000035);border-radius:13px;padding:28px 31px;display:flex;justify-content:space-between;align-items:end;min-height:158px;box-shadow:var(--shadow);position:relative;overflow:hidden}.hero:after{content:"";position:absolute;width:270px;height:270px;border:55px solid rgba(138,161,255,.1);border-radius:50%;right:-80px;top:-145px}.hero .kicker{color:#cbd3ff}.hero h2{font-family:Georgia,serif;font-weight:500;font-size:33.6px;margin:10px 0 8px;letter-spacing:-.02em}.hero p:not(.kicker){margin:0;color:#dde1f4;font-size:15.6px;max-width:650px}.hero-meta{display:flex;gap:15px;position:relative;z-index:1}.hero-meta span{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#e6e8f7;border-left:1px solid #6874ab;padding-left:15px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}.metric{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 18px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.metric-label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:flex;align-items:center;gap:7px}.metric>strong{display:block;font-family:Georgia,serif;font-size:30px;font-weight:500;margin:8px 0 2px}.metric>small{font-size:12px;color:#697184}.dashboard-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.panel{background:#fff;border:1px solid var(--line);border-radius:11px;padding:21px;min-width:0;box-shadow:0 2px 8px rgba(21,40,33,.025)}.span-2{grid-column:span 2}.panel-head{display:flex;align-items:start;justify-content:space-between;gap:15px;margin-bottom:18px}.panel-head h3{font-size:16.8px;margin:4px 0 0}.panel-head>a{font-size:13.2px;color:var(--accent);font-weight:700}.audit-progress{display:grid;grid-template-columns:105px 1fr;gap:11px 20px;align-items:end}.progress-number strong{font-family:Georgia,serif;font-size:36px;font-weight:500;display:block}.progress-number span{font-size:12px;color:var(--muted)}.progress{height:9px;background:#eceff7;border-radius:9px;overflow:hidden}.progress span{display:block;height:100%;background:linear-gradient(90deg,#0000a5,var(--accent-light));border-radius:9px}.progress-meta{grid-column:2;display:flex;justify-content:space-between;font-size:10.8px;text-transform:uppercase;letter-spacing:.08em;color:#5d6475}.due-list{display:grid}.due-list a{display:grid;grid-template-columns:60px 1fr;text-decoration:none;border-top:1px solid #e8ebf3;padding:10px 0;align-items:center}.due-list a:first-child{border:0;padding-top:0}.due-list time{font-size:12px;color:var(--accent);font-weight:750}.due-list strong,.due-list small{display:block}.due-list strong{font-size:13.2px}.due-list small{font-size:10.8px;color:var(--muted);margin-top:3px}.resource-bars{display:grid;gap:11px}.resource-bars a{display:grid;grid-template-columns:105px 1fr 20px;gap:9px;align-items:center;text-decoration:none;font-size:12px}.resource-bars i{height:5px;background:#e8ebf3;border-radius:5px;overflow:hidden}.resource-bars b{display:block;height:100%;background:#6676dd;border-radius:5px}.resource-bars strong{text-align:right}.catalog{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.catalog a{display:flex;justify-content:space-between;text-decoration:none;padding:9px 11px;background:#f2f4fa;border-radius:6px;font-size:12px}.catalog a:hover{background:var(--accent-soft)}.page-intro{display:flex;justify-content:space-between;align-items:end;margin-bottom:25px}.page-intro h2,.detail-head h2{font-family:Georgia,serif;font-size:37.2px;font-weight:500;margin:7px 0}.page-intro p:not(.kicker){color:var(--muted);max-width:700px;font-size:15.6px;margin:0}.button{border:1px solid #d0d5e3;background:#fff;border-radius:7px;padding:9px 13px;cursor:pointer;font-size:14.4px;font-weight:650}.button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.button.danger{color:var(--red)}.list-tools{display:flex;align-items:center;gap:10px;margin-bottom:12px}.list-tools label{flex:1}.list-tools input,.list-tools select{width:100%;border:1px solid var(--line);border-radius:7px;background:#fff;padding:10px 12px;font-size:14.4px}.list-tools select{width:auto}.list-tools>span{color:var(--muted);font-size:12px}.record-table-wrap{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:auto}.record-table{width:100%;border-collapse:collapse;font-size:13.2px}.record-table th{background:#f2f4fa;text-align:left;text-transform:uppercase;letter-spacing:.08em;color:#75817b;font-size:10.8px;padding:11px 14px;border-bottom:1px solid var(--line)}.record-table td{padding:13px 14px;border-bottom:1px solid #e8ebf3;vertical-align:top}.record-table tr:last-child td{border-bottom:0}.record-table code{font-size:10.8px;color:#5d6475}.record-title{display:block;color:var(--ink);font-weight:700;text-decoration:none}.record-table td>small{display:block;color:#6a7181;margin-top:3px}.record-table td[data-label="Description"]{min-width:260px;max-width:520px;color:var(--muted);line-height:1.45}.badge,.tag,.type-pill{display:inline-block;border-radius:99px;background:#eceff7;padding:3px 7px;font-size:10.8px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.tag{text-transform:none;margin:1px}.badge.status-active,.badge.status-approved,.badge.status-complete,.badge.status-passed,.badge.status-accepted{background:#ddefe5;color:#176143}.badge.status-open,.badge.status-high,.badge.status-critical,.badge.status-failed{background:#f5ded9;color:#8d352c}.badge.status-draft,.badge.status-planned,.badge.status-in-progress,.badge.status-medium{background:#f7e9cf;color:#855717}.breadcrumbs{display:flex;gap:8px;color:var(--muted);font-size:13.2px;margin-bottom:20px}.detail-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:22px}.detail-head h2{margin-bottom:4px}.detail-head>div>code{font-size:12px;color:var(--muted)}.actions{display:flex;gap:7px}.detail-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(270px,1fr);gap:14px}.detail-grid aside{display:grid;gap:14px;align-content:start}.detail-main{padding:29px}.content-label{color:#75817b;text-transform:uppercase;letter-spacing:.08em;font-size:10.8px;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:23px}.markdown{max-width:790px}.markdown h1{font-family:Georgia,serif;font-size:34.8px;font-weight:500}.markdown h2{font-family:Georgia,serif;font-size:27.6px;font-weight:500;margin-top:1.8em}.markdown h3{font-size:18px;margin-top:1.7em}.markdown p,.markdown li{font-size:15.6px;line-height:1.65;color:#272c3b}.markdown code{background:#eef0f6;border-radius:3px;padding:1px 4px}.markdown pre{padding:15px;background:#10162b;color:#e8ebff;border-radius:7px;overflow:auto}.markdown blockquote{border-left:3px solid var(--accent-light);padding:4px 15px;color:var(--muted);margin-left:0}.table-wrap{overflow:auto}.markdown table{border-collapse:collapse;width:100%;font-size:13.2px}.markdown th,.markdown td{border:1px solid var(--line);padding:8px;text-align:left}.metadata{margin:0}.metadata>div{display:grid;grid-template-columns:105px 1fr;gap:10px;border-top:1px solid #e8ebf3;padding:10px 0}.metadata>div:first-child{border-top:0;padding-top:0}.metadata dt{font-size:10.8px;text-transform:uppercase;letter-spacing:.06em;color:#5d6475}.metadata dd{margin:0;font-size:13.2px;min-width:0}.compact-json{white-space:pre-wrap;font-size:10.8px}.git-panel>code{font-size:10.8px;word-break:break-all}.git-panel p{font-size:12px;color:var(--muted)}.relation{color:var(--accent);text-decoration:none}.history{display:grid}.history>div{display:grid;grid-template-columns:60px 1fr;gap:8px;padding:8px 0;border-top:1px solid #e8ebf3}.history>div:first-child{border-top:0}.history code{font-size:10.8px;color:var(--accent)}.history strong,.history small{display:block}.history strong{font-size:12px}.history small{font-size:10.8px;color:var(--muted);margin-top:2px}.empty{padding:25px;color:#697184;text-align:center;font-size:13.2px;background:#f4f5fa;border-radius:7px}.changes{padding-left:18px}.changes li{margin:8px 0}.diagnostics>div{display:grid;grid-template-columns:58px minmax(120px,180px) minmax(0,1fr);gap:10px;align-items:start;border-top:1px solid var(--line);padding:10px 0}.diagnostics p{margin:0;font-size:13.2px;overflow-wrap:anywhere}.diagnostics code{font-size:10.8px;overflow-wrap:anywhere}.editor,.search-results{width:min(760px,calc(100vw - 30px));border:0;border-radius:12px;padding:0;box-shadow:0 25px 80px rgba(0,0,24,.28)}dialog::backdrop{background:rgba(0,0,24,.55)}.editor form,.search-results{padding:23px}.dialog-head{display:flex;justify-content:space-between;align-items:start}.dialog-head h2{font-family:Georgia,serif;font-weight:500;margin:5px 0 0}.icon-button{border:0;background:#eceff7;width:32px;height:32px;border-radius:50%;font-size:26.4px;cursor:pointer}.editor form>p{font-size:13.2px;color:var(--muted)}.editor textarea{width:100%;height:440px;border:1px solid var(--line);border-radius:7px;background:#10162b;color:#e8ebff;padding:15px;font:13.2px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}.dialog-actions{display:flex;justify-content:end;gap:8px;margin-top:14px}.dialog-error{color:var(--red);font-size:13.2px;min-height:18px;margin-top:7px}.result-list{display:grid;margin-top:17px;max-height:60vh;overflow:auto}.result-list a{display:block;text-decoration:none;padding:11px;border-top:1px solid var(--line)}.result-list strong,.result-list small{display:block}.result-list small{color:var(--muted);margin-top:3px}.muted{color:#737a8b}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.topbar-status{display:flex;align-items:center;gap:8px}.repo-chip,.validation-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);font-size:13.2px;white-space:nowrap;text-decoration:none}.repo-chip:hover,.validation-chip:hover{color:var(--ink);border-color:var(--accent-light)}
.audit-progress-empty{padding:11px 13px;border-radius:8px;background:var(--surface-soft)}.audit-progress-empty strong,.audit-progress-empty span{display:block}.audit-progress-empty strong{font-size:13.2px}.audit-progress-empty span{margin-top:4px;color:var(--muted);font-size:10.8px}
.icon-button{position:relative;display:grid;place-items:center;padding:0;color:var(--ink);font-size:0}.icon-button:before,.icon-button:after{content:"";position:absolute;width:13px;height:2px;border-radius:2px;background:currentColor;transform:rotate(45deg)}.icon-button:after{transform:rotate(-45deg)}
html,body{height:100%;overflow:hidden}.shell{grid-template-columns:248px minmax(0,1fr);height:100vh;min-height:0}.sidebar{display:flex;flex-direction:column;height:100vh;overflow:hidden;overscroll-behavior:contain}.workspace{height:100vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.topbar{height:63px}
.sidebar-nav{scrollbar-width:none;-ms-overflow-style:none}.sidebar-nav::-webkit-scrollbar{display:none}
.brand{flex:0 0 auto;margin-bottom:18px}.sidebar-nav{--nav-control-width:14px;flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding-right:1px}.nav-home{margin-bottom:10px}.nav-stage>.nav-heading{display:grid;grid-template-columns:24px minmax(0,1fr) var(--nav-control-width);gap:6px;align-items:center;padding:7px 6px;border-radius:7px;color:#d5d9ed;text-align:left;text-transform:none;letter-spacing:0}.nav-stage>.nav-heading:hover{background:rgba(255,255,255,.08);color:#fff}.nav-stage-number{display:grid;place-items:center;width:22px;height:22px;border:1px solid rgba(255,255,255,.26);border-radius:50%;font-size:9.6px}.nav-stage-copy,.nav-stage-copy strong,.nav-stage-copy small{display:block;min-width:0}.nav-stage-copy strong{font-size:12px;line-height:1.25}.nav-stage-copy small{margin-top:2px;color:#aeb6d8;font-size:9.6px;line-height:1.25;font-weight:500}.nav-stage>.nav-items{margin:2px 0 8px 17px;padding:1px 0 5px 12px;border-left:1px solid rgba(255,255,255,.14)}.nav-subgroup>.nav-subheading,.nav-subgroup>.nav-items a{width:100%;display:grid;grid-template-columns:minmax(0,1fr) var(--nav-control-width);gap:6px;align-items:center;padding-right:6px}.nav-subgroup>.nav-subheading{border:0;background:none;padding-top:7px;padding-bottom:4px;padding-left:7px;color:#919bc4;text-align:left;text-transform:uppercase;letter-spacing:.09em;font-size:9.6px;font-weight:780;cursor:pointer}.nav-control,.nav-control-slot{justify-self:end;width:var(--nav-control-width);text-align:right}.nav-subgroup>.nav-items{padding:1px 0 4px 3px}.nav-subgroup>.nav-items a{padding-top:6px;padding-bottom:6px;padding-left:8px;font-size:13.2px}.nav-group.open>.nav-heading>.chevron:before,.nav-group.open>.nav-subheading>.chevron:before{transform:rotate(45deg)}.nav-stage.open>.nav-items>.nav-subgroup:not(.open)>.nav-items{display:none}.sidebar-footer{flex:0 0 auto;margin:10px -18px -18px;padding:10px 18px 14px;background:#000024;border-top:1px solid rgba(255,255,255,.14)}.organization-nav{display:grid;grid-template-columns:32px minmax(0,1fr) 12px;gap:9px;align-items:center;padding:8px;border-radius:8px;color:#eef1ff;text-decoration:none}.organization-nav:hover,.organization-nav.current{background:rgba(255,255,255,.11)}.organization-mark{display:grid;place-items:center;width:32px;height:32px;border:1px solid rgba(255,255,255,.25);border-radius:50%;background:rgba(255,255,255,.08);font-size:13.2px;font-weight:800}.organization-nav strong,.organization-nav small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.organization-nav strong{font-size:12px}.organization-nav small{margin-top:2px;color:#aeb6d8;font-size:9.6px}.organization-arrow{color:#aeb6d8;font-size:19.2px}.organization-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.organization-links{display:grid}.organization-links a{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line);text-decoration:none}.organization-links a:first-child{padding-top:0;border-top:0}.organization-links strong,.organization-links small{display:block}.organization-links strong{font-size:13.2px}.organization-links small{margin-top:3px;color:var(--muted);font-size:10.8px;line-height:1.4}.organization-links b{color:var(--accent);font-size:13.2px}.organization-links a:hover strong{color:var(--accent)}
.nav-stage>.nav-items>a.nav-direct{display:grid;grid-template-columns:minmax(0,1fr) var(--nav-control-width);gap:6px;align-items:center;width:100%;padding:6px 6px 6px 7px;font-size:13.2px}
.nav-heading-row{display:grid;grid-template-columns:minmax(0,1fr) 24px;gap:2px;align-items:stretch}.nav-heading-row>.nav-heading{display:grid;grid-template-columns:24px minmax(0,1fr);gap:6px;align-items:center;width:100%;padding:7px 6px;border-radius:7px;color:#d5d9ed;text-align:left;text-transform:none;letter-spacing:0;text-decoration:none}.nav-heading-row>.nav-heading:hover,.nav-heading-row>.nav-heading.current{background:rgba(255,255,255,.1);color:#fff}.nav-toggle{display:grid;place-items:center;width:24px;height:auto;min-height:100%;padding:0;border:0;border-radius:6px;background:none;color:#aeb6d8;cursor:pointer}.nav-toggle:hover{background:rgba(255,255,255,.1);color:#fff}.nav-chevron{display:block;width:12px;height:12px;place-self:center;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s}.nav-subheading-row{display:grid;grid-template-columns:minmax(0,1fr) 22px;gap:2px;align-items:center;width:100%;padding:0;border:0;border-radius:6px;background:none;color:#919bc4;cursor:pointer}.nav-subheading-row:hover{background:rgba(255,255,255,.1);color:#fff}.nav-subheading-row>.nav-subheading{display:flex;align-items:center;min-width:0;padding:7px;color:inherit;text-align:left;text-transform:uppercase;letter-spacing:.09em;font-size:9.6px;font-weight:780}.nav-group.open>.nav-heading-row .nav-chevron,.nav-group.open>.nav-subheading-row .nav-chevron{transform:rotate(90deg)}
.stage-overview-hero{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:28px;align-items:center;padding:26px 28px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}.stage-overview-hero h2,.group-overview-head h2{font:500 37.2px Georgia,serif;margin:7px 0}.stage-overview-hero>div>p:not(.kicker),.group-overview-head>div>p:not(.kicker){max-width:760px;color:var(--muted);font-size:14.4px;line-height:1.55;margin:0}.stage-progress-card{padding:15px 17px;background:var(--paper);border:1px solid var(--line);border-radius:9px}.stage-progress-card>div:first-child{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}.stage-progress-card>div:first-child>strong{font:500 33.6px Georgia,serif}.stage-progress-card p{color:var(--muted);font-size:10.8px;line-height:1.45;margin:9px 0 0}.badge.neutral{background:#e5e8f2;color:#555e73}.stage-overview-layout{display:grid;grid-template-columns:320px minmax(0,1fr);gap:15px;margin-top:15px;align-items:start}.stage-plan ol,.group-plan ol{display:grid;gap:12px;padding-left:20px;margin:0}.stage-plan li,.group-plan li{padding-left:4px;color:var(--ink);font-size:13.2px;line-height:1.5}.stage-groups{min-width:0}.stage-groups>.section-head{margin:4px 0 13px}.stage-group-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stage-group-card{position:relative;display:block;min-height:138px;padding:18px 38px 17px 18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;text-decoration:none;box-shadow:0 2px 8px rgba(21,40,33,.025)}.stage-group-card:hover{border-color:var(--accent-light)}.stage-group-card h3{font-size:15.6px;margin:0 0 7px}.stage-group-card p{color:var(--muted);font-size:12px;line-height:1.5;margin:0}.stage-group-card small{display:block;color:var(--accent);font-size:9.6px;font-weight:700;margin-top:12px}.stage-group-arrow{position:absolute;right:16px;top:16px;color:var(--accent);font-size:24px}.group-overview-head{display:flex;justify-content:space-between;align-items:end;gap:25px;margin-bottom:15px}.stage-status-link{display:grid;grid-template-columns:auto auto;align-items:center;gap:4px 12px;min-width:155px;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:9px;text-decoration:none}.stage-status-link>strong{font:500 28.8px Georgia,serif;text-align:right}.stage-status-link>small{grid-column:1/-1;color:var(--muted);font-size:9.6px;text-align:right}.relationship-note{display:grid;grid-template-columns:250px minmax(0,1fr);gap:20px;align-items:center;margin-bottom:15px;padding:17px 20px;background:var(--accent-soft);border:1px solid #cbd3ff;border-radius:10px}.relationship-note h3{font-size:15.6px;margin:5px 0 0}.relationship-note>p{color:var(--muted);font-size:12px;line-height:1.55;margin:0}.relationship-note code{font-size:10.8px}.group-plan{margin-bottom:24px}.group-related-links{display:flex;align-items:center;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--line)}.group-related-links>span{color:var(--muted);font-size:10.8px;margin-right:auto}.group-destinations>.section-head{margin-bottom:12px}.group-destination-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.group-destination-card{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:16px;min-height:150px;padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;text-decoration:none;box-shadow:0 2px 8px rgba(21,40,33,.025)}.group-destination-card:hover{border-color:var(--accent-light)}.group-destination-card h3{font-size:15.6px;margin:5px 0 7px}.group-destination-card p:not(.kicker){color:var(--muted);font-size:10.8px;line-height:1.5;margin:0}.destination-rollup{align-self:center;text-align:right}.destination-rollup strong,.destination-rollup small{display:block}.destination-rollup strong{font:500 32.4px Georgia,serif}.destination-rollup small{color:var(--muted);font-size:9.6px;line-height:1.35;margin-top:3px}
.stage-pages{margin-top:24px}.stage-page-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stage-page-card{position:relative;display:flex;flex-direction:column;min-width:0;padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 8px rgba(21,40,33,.025);transition:border-color .15s,box-shadow .15s}.stage-page-card:hover{border-color:var(--accent-light);box-shadow:0 5px 16px rgba(21,40,33,.07)}.stage-page-card.complete{border-color:#b9dac6}.stage-page-card-link{position:absolute;inset:0;z-index:1;border-radius:10px}.stage-page-card-link:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.stage-page-card-head{display:flex;align-items:center;justify-content:space-between;gap:18px}.stage-page-card-head h3{font-size:15.6px;line-height:1.35;margin:4px 0 0}.stage-page-card-head>div>small{display:block;color:var(--accent);font-size:9.6px;font-weight:700}.stage-page-card>p{color:var(--muted);font-size:12px;line-height:1.5;margin:13px 0 0}.stage-page-rollup{display:flex;flex:0 0 104px;flex-direction:column;justify-content:center;text-align:right}.stage-page-rollup strong,.stage-page-rollup small{display:block}.stage-page-rollup strong{font:500 24px Georgia,serif}.stage-page-rollup small{color:var(--muted);font-size:9.6px;line-height:1.35;margin-top:2px}.stage-page-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:15px}.stage-page-completion{position:relative;z-index:2;color:var(--accent)}.stage-page-completion.complete{color:#176143;border-color:#b9dac6;background:#edf7f1}.stage-page-completion-state{color:var(--muted);font-size:10.8px}.stage-page-completion-state.complete{color:#176143;font-weight:700}.stage-page-open{color:var(--accent);font-size:12px;font-weight:700}.work-queue-section{margin-top:28px}.work-queue-section>.section-head{align-items:end}
.button{text-decoration:none}
.home-page{padding-top:16px;padding-bottom:16px}.overview-hero{min-height:72px;padding:10px 20px;align-items:center}.overview-hero h2{font-size:26.4px;margin:3px 0 2px}.overview-hero p:not(.kicker){font-size:12px}.home-page .readiness-map{padding:12px 15px}.home-page .readiness-map-head{margin-bottom:8px}.home-page .readiness-flow a{padding:7px}
.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.overview-grid>.audit-panel{grid-column:1/-1}
.overview-grid>.panel{padding:15px}.overview-grid .panel-head{margin-bottom:10px}.overview-grid .audit-progress{gap:7px 20px}.overview-grid .progress-number strong{font-size:31.2px}.overview-grid .audit-engagement{padding:8px 11px}
.nav-close,.nav-scrim{display:none}.pagination{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px}.pagination[hidden]{display:none}.page-status{color:var(--muted);font-size:12px;min-width:150px;text-align:center}.button:disabled{cursor:not-allowed;opacity:.45}.search-pagination{padding-top:2px}
.list-tools{flex-wrap:wrap}.list-tools label{min-width:220px}.list-header-tools{flex:1;justify-content:flex-end;margin:0 0 0 28px}.list-header-tools label{flex:1 1 220px;max-width:360px}.list-header-tools select{max-width:190px}.list-header-tools .button{white-space:nowrap}
.setup-banner{margin:14px 0;background:#eef1ff;border:1px solid #ccd4ff;border-radius:11px;padding:19px 22px;display:grid;grid-template-columns:1fr 1.3fr;gap:25px;align-items:center}.setup-banner h3{margin:5px 0 6px;font-size:18px}.setup-banner p:not(.kicker){margin:0;color:var(--muted);font-size:13.2px;line-height:1.5}.setup-banner ol{margin:0;padding-left:22px;display:grid;gap:7px}.setup-banner li{font-size:13.2px}.setup-banner a{color:var(--accent);font-weight:700}.due-list time.overdue{color:var(--red)}.content-label{display:flex;align-items:center;justify-content:space-between;gap:12px}.text-button{border:0;background:none;color:var(--accent);font-size:10.8px;text-transform:uppercase;letter-spacing:.06em;font-weight:750;cursor:pointer;white-space:nowrap}.tag{white-space:normal;overflow-wrap:anywhere;max-width:100%}.editor{max-height:calc(100vh - 30px);overflow:auto}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:20px 0}.form-field>.field-label,.content-editor-field>span{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#3e4557;font-size:12px;font-weight:700;margin-bottom:6px}.required-mark{font-size:9.6px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em}.form-field input,.form-field select,.editor .form-field textarea{width:100%;height:auto;min-height:40px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink);padding:9px 10px;font:14.4px/1.4 inherit}.editor .form-field textarea{height:82px}.form-field input[readonly]{background:#eef0f6;color:#5d6475}.form-field>small{display:block;color:#6a7181;font-size:10.8px;margin-top:5px}.checkbox-list{display:grid;gap:5px;max-height:145px;overflow:auto;border:1px solid var(--line);border-radius:7px;padding:7px}.checkbox-list label{display:flex;align-items:center;gap:8px;padding:5px;border-radius:5px}.checkbox-list input{width:16px;min-height:16px;padding:0;flex:0 0 auto}.checkbox-list label:hover{background:#f2f4fa}.checkbox-list span,.checkbox-list small{display:block;font-size:12px}.checkbox-list small{color:var(--muted);margin-top:2px}.missing-options{padding:11px;border:1px dashed #d7c8a9;background:#fbf5e9;color:#795b23;border-radius:7px;font-size:12px}.content-editor-field{display:block;margin:17px 0}.editor .content-editor-field textarea,.editor .markdown-source{height:260px;background:#10162b;color:#e8ebff;font:13.2px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.advanced-editor{border-top:1px solid var(--line);margin-top:18px;padding-top:13px}.advanced-editor summary{cursor:pointer;color:var(--accent);font-size:13.2px;font-weight:750}.advanced-editor p{font-size:12px;color:var(--muted)}.editor .advanced-editor>textarea{height:320px}.alert-dialog{width:min(520px,calc(100vw - 30px));border:0;border-radius:12px;padding:23px;box-shadow:0 25px 80px rgba(0,0,24,.28)}.alert-dialog>p{font-size:14.4px;line-height:1.55;color:var(--muted)}.metadata dd{overflow-wrap:anywhere}
.record-content-action{display:flex;justify-content:flex-start;margin-top:20px}.record-content-details{border-top:1px solid var(--line);margin-top:18px;padding-top:13px}.record-content-details summary{cursor:pointer;color:var(--accent);font-size:13.2px;font-weight:750}.record-content-details>p{color:var(--muted);font-size:12px}.record-content-editor>span small{color:var(--muted);font-size:10.8px;font-weight:500}
.program-setup{grid-template-columns:minmax(250px,.75fr) minmax(440px,1.4fr)}.setup-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.setup-steps a{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px;align-items:start;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);text-decoration:none}.setup-steps a:hover{border-color:var(--accent-light)}.setup-steps a>span:first-child{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:12px}.setup-steps a.done>span:first-child{background:#dcefe4;color:#125733}.setup-steps strong,.setup-steps small{display:block}.setup-steps strong{font-size:12px}.setup-steps small{margin-top:3px;color:var(--muted);font-size:9.6px;line-height:1.4;font-weight:500}
.readiness-map{margin:14px 0;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:20px 22px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.readiness-map-head{display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,420px);gap:28px;align-items:center;margin-bottom:17px}.readiness-map-head h3{font-size:18px;margin:5px 0 0}.readiness-progress-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 14px;align-items:center}.readiness-progress-summary>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 12px;align-items:baseline}.readiness-progress-summary>div>span{color:var(--muted);font-size:9.6px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.readiness-progress-summary>div>strong{font-size:9.6px;font-weight:700;line-height:1.2}.readiness-progress-summary .progress,.readiness-progress-summary small{grid-column:1/-1}.readiness-progress-summary small{color:var(--muted);font-size:9.6px}.readiness-progress-summary>.button{white-space:nowrap}.readiness-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.readiness-flow a{display:grid;grid-template-columns:23px minmax(0,1fr);column-gap:8px;align-content:start;min-width:0;padding:11px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft);text-decoration:none}.readiness-flow a:hover{border-color:var(--accent-light);background:var(--accent-soft)}.readiness-flow a>span{grid-row:1/4;display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:var(--primary-gradient);color:#fff;font-size:9.6px;font-weight:800}.readiness-flow strong{font-size:12px;line-height:1.25}.readiness-flow small{grid-column:2;color:var(--muted);font-size:9.6px;line-height:1.4;margin-top:3px}.readiness-state{grid-column:2;justify-self:start;margin-top:8px;padding:3px 6px;border-radius:99px;background:var(--surface-muted);color:var(--muted);font-size:8.4px;line-height:1.2}.readiness-state.good{background:#dcefe4;color:#125733}.readiness-state.warn{background:#f6e8c9;color:#79500f}.readiness-state.bad{background:#f7dfdc;color:#873027}.audit-engagement{display:grid;grid-template-columns:minmax(210px,1fr) minmax(260px,1.25fr) auto;gap:20px;align-items:center;padding:14px 15px;border-radius:8px;background:var(--surface-soft)}.audit-engagement strong{font-size:13.2px}.audit-engagement p,.audit-engagement li{color:var(--muted);font-size:10.8px;line-height:1.5}.audit-engagement p{margin:5px 0 0}.audit-engagement ul{margin:0;padding-left:18px}.audit-engagement .button{white-space:nowrap;text-decoration:none}.resource-directory{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.resource-directory>section{min-width:0;padding:12px;border-radius:8px;background:var(--surface-soft)}.resource-directory h4{margin:0 0 7px;color:var(--muted);font-size:10.8px;text-transform:uppercase;letter-spacing:.08em}.resource-directory a{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--line);font-size:10.8px;text-decoration:none}.resource-directory a:first-of-type{border-top:0}.resource-directory a:hover span{color:var(--accent)}.resource-directory a strong{color:var(--muted);font-size:9.6px}.record-prose{max-width:790px}.record-prose section{padding:0 0 20px}.record-prose section+section{padding-top:20px;border-top:1px solid var(--line)}.record-prose h3{margin:0 0 7px;color:var(--muted);font-size:10.8px;text-transform:uppercase;letter-spacing:.08em}.record-prose p{margin:0;font-size:16.8px;line-height:1.65;white-space:pre-wrap}.connections-panel .panel-head>span{display:grid;place-items:center;min-width:22px;height:22px;border-radius:99px;background:var(--surface-muted);color:var(--muted);font-size:9.6px}.connections{display:grid}.connections a{display:block;padding:9px 0;border-top:1px solid var(--line);text-decoration:none}.connections a:first-child{padding-top:0;border-top:0}.connections strong,.connections small{display:block}.connections strong{font-size:12px}.connections small{margin-top:3px;color:var(--muted);font-size:9.6px;line-height:1.4}.connections a:hover strong{color:var(--accent)}.connections-more{margin:9px 0 0;color:var(--muted);font-size:9.6px;line-height:1.4}.external-source{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;color:var(--accent);text-decoration:none}.external-source span,.external-source strong,.external-source small{display:block}.external-source strong{font-size:12px;line-height:1.35}.external-source small{margin-top:3px;color:var(--muted);font-size:9.6px;line-height:1.35;overflow-wrap:anywhere}.external-source b{font-size:13.2px}.external-source:hover strong{text-decoration:underline}
.page-title-line{display:flex;align-items:center;gap:8px}.guide-trigger{display:grid;place-items:center;width:24px;height:24px;flex:0 0 auto;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--panel);color:var(--muted);cursor:pointer}.guide-trigger svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}.guide-trigger:hover{border-color:var(--accent-light);color:var(--accent)}.guide-trigger:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.page-guide{display:grid;grid-template-columns:1.05fr 1.25fr 1fr;gap:0;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.resource-guide-popover{position:fixed;z-index:40;overflow:auto;box-shadow:0 18px 50px rgba(0,0,24,.24)}.resource-guide-popover[hidden]{display:none}.page-guide>div{padding:14px 16px;border-left:1px solid var(--line);min-width:0}.page-guide>div:first-child{border-left:0}.page-guide>div>span{display:block;color:var(--accent);text-transform:uppercase;letter-spacing:.09em;font-size:9.6px;font-weight:780;margin-bottom:6px}.page-guide p{color:var(--muted);font-size:12px;line-height:1.5;margin:0}.guide-links{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.guide-links a{color:var(--accent);background:var(--accent-soft);border-radius:99px;padding:4px 7px;text-decoration:none;font-size:9.6px;font-weight:700}.stage-instructions{margin:0 0 16px;padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.stage-instructions-head{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:15px}.stage-instructions-head h3{font-size:18px;margin:5px 0 0}.stage-instructions-head>span{color:var(--muted);font-size:12px}.stage-instruction-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden}.stage-instruction-grid>div{position:relative;padding:14px 16px;border-left:1px solid var(--line);min-width:0}.stage-instruction-grid>div:first-child{border-left:0}.stage-instruction-grid b{display:block;font-size:13.2px}.stage-instruction-grid p{color:var(--muted);font-size:12px;line-height:1.5;margin:6px 0 0}.stage-instruction-grid a{display:inline-block;color:var(--accent);font-size:12px;font-weight:700;margin-top:10px}.stage-instruction-grid small{display:block;color:var(--muted);font-size:10.8px;margin-top:9px}.evidence-instruction-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.evidence-instruction-grid>div{padding-left:48px}.instruction-number{position:absolute;left:16px;top:14px;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:10.8px;font-weight:800}.stage-instructions-note{color:var(--muted);font-size:12px;margin:12px 0 0}.operation-tracking strong,.operation-tracking small{display:block}.operation-tracking strong{font-size:12px}.operation-tracking small{color:var(--muted);font-size:9.6px;margin-top:3px}
.page-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.repository-sync-status{min-height:18px;margin:7px 0 0;color:var(--muted);font-size:13.2px}.repository-sync-status.error{color:var(--red)}.onboarding-dialog{width:min(470px,calc(100vw - 30px));max-height:calc(100vh - 32px);margin:0;border:1px solid var(--line);border-radius:13px;padding:0;background:var(--panel);color:var(--ink);box-shadow:0 28px 90px rgba(0,0,24,.38);overflow:auto}.onboarding-dialog::backdrop{background:transparent;backdrop-filter:none}.onboarding-shade{position:fixed;inset:0;z-index:60;pointer-events:none}.onboarding-shade span{position:absolute;background:rgba(0,0,24,.58)}.onboarding-progress{display:grid;grid-template-columns:repeat(var(--onboarding-step-count),1fr);gap:5px;padding:18px 24px 0}.onboarding-progress span{height:3px;border-radius:3px;background:var(--surface-muted)}.onboarding-progress span.active{background:var(--accent-light)}.onboarding-head{padding:22px 25px 0}.onboarding-head h2{font-family:Georgia,serif;font-size:30px;font-weight:500;letter-spacing:-.015em;margin:8px 0 0}.onboarding-body{color:var(--muted);font-size:14.4px;line-height:1.6;margin:13px 25px 0}.onboarding-body+.onboarding-body{margin-top:8px}.onboarding-points{display:grid;gap:9px;margin:18px 25px 4px;padding-left:19px}.onboarding-points li{font-size:13.2px;line-height:1.5;padding-left:3px}.onboarding-sections{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 25px 4px}.onboarding-sections section{padding:13px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft)}.onboarding-sections strong{font-size:13.2px}.onboarding-sections p{margin:6px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.onboarding-actions{padding:12px 25px 23px}.onboarding-skip{margin-right:auto;color:var(--muted);text-transform:none;letter-spacing:0;font-size:13.2px}.onboarding-form{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin:18px 25px 0}.onboarding-form label{display:block;min-width:0}.onboarding-form label.wide{grid-column:1/-1}.onboarding-form label>span{display:block;color:var(--ink);font-size:12px;font-weight:720;margin-bottom:6px}.onboarding-form input,.onboarding-form select,.onboarding-form textarea{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:14.4px}.onboarding-form textarea{min-height:78px;resize:vertical}.onboarding-form small{display:block;color:var(--muted);font-size:10.8px;line-height:1.45;margin-top:5px}.onboarding-write-note{color:var(--muted);font-size:10.8px;line-height:1.5;margin:12px 25px 0}.onboarding-dialog>.dialog-error{margin:8px 25px 0}.onboarding-focus{outline:4px solid var(--accent-light)!important;outline-offset:5px;scroll-margin-top:102px}
.page-intro,.detail-head{align-items:center;margin-bottom:12px}.actions{align-items:center}.detail-head>div:first-child{min-width:0}.detail-head h2{margin:7px 0}.detail-head .header-breadcrumbs{margin:0;font-size:10.8px;line-height:normal;min-height:11px;align-items:center}.header-breadcrumbs span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}
@media(max-width:1200px){.readiness-flow{grid-template-columns:repeat(3,minmax(0,1fr))}.audit-engagement{grid-template-columns:1fr 1fr}.audit-engagement .button{grid-column:1/-1;justify-self:start}}
@media(max-width:1100px){.search{display:none}.topbar-status{margin-left:auto}.metrics{grid-template-columns:repeat(2,1fr)}.dashboard-grid,.organization-grid{grid-template-columns:repeat(2,1fr)}.catalog{grid-template-columns:repeat(3,1fr)}.span-2{grid-column:span 2}.resource-directory{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.shell{display:block}.sidebar{transform:translateX(-100%);transition:.2s;box-shadow:8px 0 30px rgba(0,0,0,.2)}.sidebar.shown{transform:translateX(0)}.workspace{min-width:0}.mobile-nav{display:block;border:0;background:none;font-size:24px}.topbar{height:72px;padding:0 16px}.topbar>div:first-of-type{min-width:0}.topbar-status{display:none}.search{display:flex;max-width:none}.search kbd,.topbar .eyebrow{display:none}.page{padding:20px 15px 60px}.hero{display:block;padding:23px}.hero-meta{margin-top:22px;flex-wrap:wrap}.metrics,.dashboard-grid,.organization-grid{grid-template-columns:1fr}.span-2{grid-column:auto}.catalog{grid-template-columns:repeat(2,1fr)}.detail-grid{grid-template-columns:1fr}.page-intro,.detail-head{display:block}.page-intro>.button,.actions{margin-top:15px}.page-intro>.list-header-tools{justify-content:flex-start;margin:15px 0 0}.list-header-tools label{max-width:none}.record-table{min-width:720px}.readiness-map{padding:17px}.readiness-map-head{grid-template-columns:1fr;gap:8px}.readiness-flow{grid-template-columns:repeat(2,minmax(0,1fr))}.audit-engagement{grid-template-columns:1fr}.audit-engagement .button{grid-column:auto}.resource-directory{grid-template-columns:1fr}}
@media(max-width:760px){.setup-banner,.page-guide,.stage-instruction-grid,.evidence-instruction-grid,.stage-overview-hero,.relationship-note,.group-destination-card,.stage-page-grid{grid-template-columns:1fr}.page-guide>div,.stage-instruction-grid>div{border-left:0;border-top:1px solid var(--line)}.page-guide>div:first-child,.stage-instruction-grid>div:first-child{border-top:0}.stage-instructions-head,.group-overview-head{display:block}.stage-instructions-head>span{display:block;margin-top:7px}.stage-progress-card,.stage-status-link{margin-top:15px}.destination-rollup{text-align:left}.form-grid{grid-template-columns:1fr}.record-table{min-width:0}.record-table thead{display:none}.record-table,.record-table tbody,.record-table tr{display:block}.record-table tr{padding:8px 12px;border-bottom:1px solid var(--line)}.record-table tr:last-child{border-bottom:0}.record-table td:not([data-label]){display:block}.record-table td[data-label]{display:grid;grid-template-columns:105px minmax(0,1fr);gap:10px;border:0;padding:7px 0;align-items:start}.record-table td[data-label]::before{content:attr(data-label);color:#75817b;text-transform:uppercase;letter-spacing:.07em;font-size:9.6px;font-weight:700}.record-table td[data-primary-field]{display:block;padding:8px 0 10px}.record-table td[data-primary-field]::before{display:none}.content-label{align-items:flex-start}.editor form{padding:18px}.diagnostics>div{grid-template-columns:58px minmax(0,1fr)}.diagnostics p{grid-column:1/-1}.changes code{overflow-wrap:anywhere}.onboarding-dialog{max-height:56vh}.onboarding-actions{position:sticky;bottom:0;background:var(--panel);border-top:1px solid var(--line)}}
@media(max-width:520px){.onboarding-form,.onboarding-sections,.setup-steps{grid-template-columns:1fr}.onboarding-form label.wide{grid-column:auto}.onboarding-actions{flex-wrap:wrap}.onboarding-skip{width:100%;order:3;margin:3px 0 0}.readiness-flow{grid-template-columns:1fr}.obligation-card-foot{align-items:flex-start;flex-direction:column}.obligation-action{align-self:flex-start}}
@media(min-width:761px){.detail-grid{grid-template-columns:minmax(270px,1fr) minmax(0,2fr)}.detail-grid aside{grid-column:1;grid-row:1}.detail-main{grid-column:2;grid-row:1}}
@media(min-width:761px){.detail-grid.detail-grid-structured{grid-template-columns:1fr}.detail-grid-structured aside{grid-column:1;grid-row:1;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}.detail-grid-structured aside>.panel{align-self:start}}
@media(max-width:760px){.sidebar{visibility:hidden;transition:transform .2s,visibility 0s .2s}.sidebar.shown{visibility:visible;transition-delay:0s}.nav-close{display:grid;place-items:center;position:absolute;top:25px;right:18px;width:34px;height:34px;border:1px solid #5966a4;border-radius:50%;background:#11174a;color:#eef1ff;font-size:24px;cursor:pointer}.nav-scrim{display:block;position:fixed;inset:0;border:0;background:rgba(0,0,24,.38);opacity:0;pointer-events:none;transition:opacity .2s;z-index:15}.sidebar.shown+.nav-scrim{opacity:1;pointer-events:auto}.pagination{justify-content:space-between;gap:8px}.page-status{min-width:0}}
@media(max-width:760px){.topbar{height:56px}.nav-close{font-size:0}.nav-close:before,.nav-close:after{content:"";position:absolute;width:13px;height:2px;border-radius:2px;background:currentColor;transform:rotate(45deg)}.nav-close:after{transform:rotate(-45deg)}}

body,button,input,select,textarea,dialog{color:var(--ink)}
button,input,select,textarea{accent-color:var(--accent)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
::selection{background:var(--accent-light);color:#000035}
.skip-link{background:var(--panel);color:var(--ink);box-shadow:var(--shadow)}
.sidebar{background:var(--sidebar);color:#eef1ff}
.brand .mark{background:transparent}
.brand small{color:#c5cae2}
.nav-home,.nav-items a{color:#d5d9ed}
.nav-home:hover,.nav-items a:hover,.nav-home.current,.nav-items a.current{background:rgba(255,255,255,.11);color:#fff}
.nav-heading{color:#b4bbdc}
.nav-items small{color:#b8bed7}
.side-foot{background:#000024;border-color:rgba(255,255,255,.14);color:#cbd0e5;z-index:1}
.topbar{background:rgba(255,255,255,.9)}
.search{background:var(--surface-soft);border-color:var(--line);color:var(--muted)}
.search kbd{background:var(--panel);border-color:var(--line);color:var(--ink)}
.hero{color:#f8f9ff;background:var(--primary-gradient)}
.hero:after{border-color:rgba(138,161,255,.16)}
.hero .kicker{color:#cbd3ff}
.hero p:not(.kicker){color:#dde1f4}
.hero-meta span{color:#e6e8f7;border-color:#6874ab}
.metric,.panel,.record-table-wrap{background:var(--panel)}
.metric>small,.progress-meta,.content-label,.record-table th,.record-table code,.record-table td>small,.metadata dt{color:var(--muted)}
.progress,.resource-bars i{background:var(--surface-muted)}
.progress span{background:linear-gradient(90deg,#0000a5,var(--accent-light))}
.due-list a,.record-table td,.metadata>div,.history>div,.diagnostics>div,.result-list a{border-color:var(--line)}
.resource-bars b{background:#6676dd}
.catalog a,.record-table th,.empty{background:var(--surface-soft)}
.catalog a:hover{background:var(--accent-soft)}
.button{background:var(--panel);border-color:var(--line);color:var(--ink)}
.button.primary{background:var(--primary-gradient);border-color:#000070;color:#fff}
.button.primary:hover{filter:brightness(1.18)}
.list-tools input,.list-tools select,.form-field input,.form-field select,.editor .form-field textarea{background:var(--field);border-color:var(--line);color:var(--ink)}
input::placeholder,textarea::placeholder{color:var(--muted);opacity:1}
.badge,.tag,.type-pill,.markdown code,.icon-button{background:var(--surface-muted)}
.badge.good{background:#dcefe4;color:#125733}
.badge.warn{background:#f6e8c9;color:#79500f}
.badge.bad{background:#f7dfdc;color:#873027}
.badge.status-active,.badge.status-approved,.badge.status-complete,.badge.status-passed,.badge.status-accepted{background:#dcefe4;color:#125733}
.badge.status-open,.badge.status-high,.badge.status-critical,.badge.status-failed{background:#f7dfdc;color:#873027}
.badge.status-draft,.badge.status-planned,.badge.status-in-progress,.badge.status-medium{background:#f6e8c9;color:#79500f}
.markdown p,.markdown li{color:var(--ink)}
.markdown pre,.editor textarea,.editor .content-editor-field textarea,.editor .markdown-source{background:var(--code-bg);color:var(--code-ink)}
.markdown blockquote{border-color:var(--accent-light)}
.empty{color:var(--muted)}
.editor,.search-results,.alert-dialog{background:var(--panel);color:var(--ink);box-shadow:var(--shadow)}
dialog::backdrop{background:rgba(0,0,24,.62)}
.muted,.form-field>small{color:var(--muted)}
.setup-banner{background:var(--accent-soft);border-color:#ccd4ff}
.form-field>.field-label,.content-editor-field>span{color:var(--ink)}
.form-field input[readonly]{background:var(--field-readonly);color:var(--muted)}
.checkbox-list{border-color:var(--line)}
.checkbox-list label:hover{background:var(--surface-soft)}
.missing-options{border-color:#d5ad55;background:#fff7dc;color:#6d4707}
.nav-close{border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.1);color:#fff}
.nav-scrim{background:rgba(0,0,24,.52)}
.record-table td[data-label]::before{color:var(--muted)}
.commit-dialog{width:min(560px,calc(100vw - 30px));max-height:calc(100vh - 32px);border:1px solid var(--line);border-radius:13px;padding:0;background:var(--panel);color:var(--ink);box-shadow:var(--shadow);overflow:auto}
.commit-dialog form{padding:23px}
.commit-dialog form>p{color:var(--muted);font-size:13.2px;line-height:1.55}
.commit-dialog label>span{display:block;font-size:12px;font-weight:720;margin-bottom:6px}
.commit-dialog input{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:14.4px}
.commit-files{display:grid;gap:5px;max-height:160px;overflow:auto;margin-top:14px;padding:10px;background:var(--surface-soft);border-radius:7px}
.commit-files code{font-size:10.8px;overflow-wrap:anywhere}
.onboarding-progress{grid-template-columns:repeat(var(--onboarding-step-count),1fr)}
.onboarding-git-status{display:flex;align-items:flex-start;gap:9px;margin:14px 25px 0;padding:10px 12px;border:1px solid var(--line);border-radius:7px;background:var(--surface-soft)}.onboarding-git-status .status-dot{margin-top:4px}.onboarding-git-status strong,.onboarding-git-status small{display:block}.onboarding-git-status strong{font-size:12px}.onboarding-git-status small{color:var(--muted);font-size:10.8px;line-height:1.45;margin-top:3px}.onboarding-git-status code{font-size:10.8px}
.badge.status-overdue{background:#f7dfdc;color:#873027}.badge.status-due{background:#f6e8c9;color:#79500f}.badge.status-upcoming,.badge.status-proposed{background:var(--accent-soft);color:var(--accent)}.badge.status-complete{background:#dcefe4;color:#125733}
.obligation-preview,.event-reminder-preview{display:grid;gap:8px}.obligation-preview a{display:flex;align-items:flex-start;gap:9px;text-decoration:none;padding:7px 0;border-top:1px solid var(--line)}.obligation-preview a:first-child{border-top:0;padding-top:0}.obligation-preview strong,.obligation-preview small,.event-reminder-preview strong,.event-reminder-preview small{display:block}.obligation-preview strong,.event-reminder-preview strong{font-size:12px}.obligation-preview small,.event-reminder-preview small{font-size:10.8px;color:var(--muted);margin-top:2px}.event-reminder-preview{grid-template-columns:repeat(2,minmax(0,1fr))}.event-reminder-preview a{padding:10px;border-radius:7px;background:var(--surface-soft);text-decoration:none}
.obligation-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;align-items:start}.obligation-column{min-width:0}.obligation-column-head{display:flex;align-items:center;justify-content:space-between;margin:5px 1px 10px}.obligation-column-head>strong{font:500 26.4px Georgia,serif}.obligation-cards{display:grid;gap:9px}.obligation-card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent-light);border-radius:9px;padding:14px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.obligation-card.status-overdue{border-left-color:var(--red)}.obligation-card.status-due{border-left-color:#d89021}.obligation-card-head{display:flex;justify-content:space-between;gap:8px;text-transform:uppercase;letter-spacing:.06em;font-size:9.6px;color:var(--muted)}.obligation-card-head strong{color:var(--ink);text-align:right}.obligation-card h3{font-size:14.4px;margin:9px 0 7px}.obligation-card h3 a{text-decoration:none}.obligation-card p{font-size:10.8px;line-height:1.5;color:var(--muted);margin:0}.obligation-links{margin-top:10px}.workflow-section{margin-top:30px}.section-head{display:flex;justify-content:space-between;margin-bottom:13px}.section-head h2{font:500 28.8px Georgia,serif;margin:6px 0}.section-head p:not(.kicker){font-size:13.2px;color:var(--muted);margin:0;max-width:720px}.event-trigger-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.event-trigger-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;min-width:0}.event-trigger-card h3{font-size:15.6px;margin:6px 0}.event-trigger-card p:not(.kicker){font-size:12px;color:var(--muted);line-height:1.5;margin:0}.event-trigger-card ol{padding-left:20px;margin:15px 0;display:grid;gap:8px}.event-trigger-card li span,.event-trigger-card li small{display:block}.event-trigger-card li span{font-size:12px}.event-trigger-card li small{font-size:9.6px;color:var(--muted);margin-top:2px}.event-trigger-card>.button{margin-top:auto;align-self:flex-start}.event-run-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.event-run{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;min-width:0}.event-run-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.event-run-head h3{font-size:15.6px;margin:7px 0 3px}.event-run-head h3 a{text-decoration:none}.event-run-head small{font-size:10.8px;color:var(--muted)}.event-run-head>strong{font:500 26.4px Georgia,serif}.event-run>.progress{margin:13px 0}.event-actions{display:grid}.event-actions a{display:flex;gap:9px;text-decoration:none;padding:9px 0;border-top:1px solid var(--line);align-items:flex-start}.event-actions strong,.event-actions small{display:block}.event-actions strong{font-size:12px}.event-actions small{font-size:9.6px;color:var(--muted);margin-top:2px}
.obligation-card-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:9px;margin-top:10px}.obligation-card-foot .obligation-links{margin-top:0;min-width:0}.obligation-action{flex:0 0 auto;border:0;border-radius:6px;background:var(--accent-soft);color:var(--accent);padding:7px 9px;font-family:inherit;font-size:10.8px;font-weight:700;line-height:1;text-decoration:none;cursor:pointer}.obligation-action:hover{filter:brightness(1.08)}.obligation-action.blocked{background:var(--surface-muted);color:var(--muted)}.obligation-more{width:100%;margin-top:9px}.workflow-section{scroll-margin-top:92px}
.event-dialog label{display:block;margin-top:13px}.event-dialog label>span{display:block;font-size:12px;font-weight:720;margin-bottom:6px}.event-dialog input,.event-dialog select{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:14.4px}.event-dialog-steps{display:grid;gap:6px;margin-top:15px;padding:10px;background:var(--surface-soft);border-radius:7px}.event-dialog-steps strong,.event-dialog-steps small{display:block}.event-dialog-steps strong{font-size:12px}.event-dialog-steps small{font-size:9.6px;color:var(--muted);margin-top:2px}
.packet-builder form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:12px;align-items:end}.packet-builder label>span{display:block;font-size:10.8px;font-weight:720;margin-bottom:6px}.packet-builder input,.packet-builder select{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:13.2px}.packet-note,.packet-output>p{font-size:12px;color:var(--muted);margin:12px 0 0}.packet-output{margin:14px 0}.packet-output h3{overflow-wrap:anywhere}.packet-gaps{display:grid}.packet-gaps>div{display:grid;grid-template-columns:58px 1fr;gap:10px;border-top:1px solid var(--line);padding:10px 0}.packet-gaps>div:first-child{border-top:0}.packet-gaps p{font-size:12px;margin:0}.packet-list{display:grid}.packet-list a{display:block;text-decoration:none;border-top:1px solid var(--line);padding:9px 0}.packet-list a:first-child{border-top:0}.packet-list strong,.packet-list small{display:block}.packet-list strong{font-size:12px}.packet-list small{font-size:9.6px;color:var(--muted);margin-top:2px}
.packet-preflight{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}.packet-preflight a{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);text-decoration:none}.packet-preflight .status-dot{margin-top:4px}.packet-preflight small,.packet-preflight strong{display:block}.packet-preflight small{color:var(--muted);font-size:9.6px;text-transform:uppercase;letter-spacing:.07em}.packet-preflight strong{margin-top:3px;font-size:12px}
.audit-preparation{margin-bottom:12px}.audit-preparation .panel-head{align-items:flex-start}.audit-preparation .panel-head h3{margin:3px 0}.audit-preparation .panel-head p:not(.kicker){margin:4px 0 0;color:var(--muted);font-size:10.8px}.preparation-progress{height:5px;margin:12px 0 0;border-radius:99px;background:var(--surface-muted);overflow:hidden}.preparation-progress span{display:block;height:100%;border-radius:inherit;background:var(--primary-gradient)}.audit-preparation-note{margin:9px 0 0;color:var(--muted);font-size:10.8px;line-height:1.5}.preparation-stages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.preparation-stage{border:1px solid var(--line);border-radius:8px;background:var(--surface-soft);overflow:hidden}.preparation-stage summary{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:11px 12px;cursor:pointer;list-style:none}.preparation-stage summary::-webkit-details-marker{display:none}.preparation-stage summary span,.preparation-stage summary strong,.preparation-stage summary small{display:block}.preparation-stage summary strong{font-size:12px}.preparation-stage summary small{margin-top:3px;color:var(--muted);font-size:9.6px;line-height:1.4}.preparation-stage summary b{flex:none;color:var(--muted);font-size:9.6px;font-weight:650}.preparation-items{border-top:1px solid var(--line);background:var(--panel)}.preparation-items>a,.preparation-items>div{display:grid;grid-template-columns:22px minmax(0,1fr);gap:9px;padding:10px 12px;border-top:1px solid var(--line);text-decoration:none}.preparation-items>:first-child{border-top:0}.preparation-items strong,.preparation-items small{display:block}.preparation-items strong{font-size:10.8px}.preparation-items small{margin-top:3px;color:var(--muted);font-size:9.6px;line-height:1.45}.preparation-status{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--surface-muted);color:var(--muted);font-size:10.8px;font-weight:800}.preparation-status.complete{background:#dcefe4;color:#125733}.preparation-status.action{background:#f7dfdc;color:#873027}.preparation-status.later{background:#f6e8c9;color:#79500f}.preparation-status.external,.preparation-status.info{background:var(--accent-soft);color:var(--accent)}.audit-preparation-error:empty{display:none}
@media(max-width:900px){.obligation-board,.event-trigger-grid{grid-template-columns:1fr}.event-run-list{grid-template-columns:1fr}.packet-builder form,.packet-preflight{grid-template-columns:1fr 1fr}.packet-builder .button{align-self:end}}
@media(max-width:1000px){.stage-overview-layout{grid-template-columns:1fr}.stage-page-grid,.group-destination-grid{grid-template-columns:1fr}}
@media(max-width:760px){.preparation-stages{grid-template-columns:1fr}}
@media(max-width:900px){.overview-grid{grid-template-columns:1fr}.overview-grid>.audit-panel{grid-column:auto}}
@media(max-width:520px){.event-reminder-preview,.packet-builder form,.packet-preflight{grid-template-columns:1fr}.packet-metrics{grid-template-columns:1fr}.obligation-card-head{display:block}.obligation-card-head strong{display:block;text-align:left;margin-top:3px}}

@media(prefers-color-scheme:dark){
  :root{--ink:#f4f5ff;--muted:#b8bfd3;--line:#343d5c;--paper:#000;--panel:#141a2e;--accent:#aab7ff;--accent-soft:#252e52;--accent-light:#9aabff;--focus:#bdc7ff;--amber:#ffd08a;--red:#ffaaa0;--surface-soft:#1b2238;--surface-muted:#252d48;--field:#11172a;--field-readonly:#1c2338;--shadow:0 12px 34px rgba(0,0,0,.3)}
  .topbar{background:rgba(0,0,0,.9)}
  .badge.good{background:#173b2b;color:#a8edc4}
  .badge.warn{background:#483714;color:#ffd991}
  .badge.bad{background:#4a252a;color:#ffb5ad}
  .badge.neutral{background:#252d48;color:#c8cff0}
  .badge.status-active,.badge.status-approved,.badge.status-complete,.badge.status-passed,.badge.status-accepted{background:#173b2b;color:#a8edc4}
  .badge.status-open,.badge.status-high,.badge.status-critical,.badge.status-failed{background:#4a252a;color:#ffb5ad}
  .badge.status-draft,.badge.status-planned,.badge.status-in-progress,.badge.status-medium{background:#483714;color:#ffd991}
  .badge.status-overdue{background:#4a252a;color:#ffb5ad}
  .badge.status-due{background:#483714;color:#ffd991}
  .badge.status-complete{background:#173b2b;color:#a8edc4}
  .missing-options{border-color:#77612f;background:#382f19;color:#ffdc92}
  .status-dot.neutral{background:#9aabff}
}
`;

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
