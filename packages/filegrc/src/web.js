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
const READINESS_STAGES = [
  {
    id: "scope",
    number: "1",
    title: "Scope",
    description: "Systems and boundary",
    sections: [
      { id: "boundary", title: "Boundary", types: ["system", "asset"], nested: true, defaultOpen: true },
      { id: "dependencies", title: "Dependencies", types: ["vendor", "vendor-review"], nested: true, defaultOpen: false }
    ]
  },
  {
    id: "criteria",
    number: "2",
    title: "Criteria",
    description: "What the auditor evaluates",
    sections: [
      { id: "framework", title: "Framework", types: ["framework", "requirement"], nested: true, defaultOpen: true },
      { id: "service-description", title: "Supplements", types: ["commitment", "complementary-control"], nested: true, defaultOpen: false }
    ]
  },
  {
    id: "policies",
    number: "3",
    title: "Policies",
    description: "Rules the company adopts",
    sections: [
      { id: "library", title: "Policy Library", types: ["policy", "document"], defaultOpen: true }
    ]
  },
  {
    id: "controls",
    number: "4",
    title: "Controls",
    description: "How the rules operate",
    sections: [
      { id: "catalog", title: "Control Catalog", types: ["control"], defaultOpen: true },
      { id: "testing", title: "Testing", types: ["control-test"], defaultOpen: false }
    ]
  },
  {
    id: "run",
    number: "5",
    title: "Operate Controls",
    description: "Recurring and event work",
    sections: [
      { id: "queue", title: "Work Queue", types: ["obligation", "obligation-event", "action-item"], utility: "obligation-board", nested: true, defaultOpen: true },
      { id: "governance-risk", title: "Governance and Risk", types: ["policy-review", "meeting", "risk-assessment", "risk", "exception"], nested: true, defaultOpen: false },
      { id: "access-training", title: "Access and Training", types: ["access-grant", "access-review", "service-account", "training", "attestation"], nested: true, defaultOpen: false },
      { id: "security", title: "Security Operations", types: ["vulnerability-scan", "vulnerability", "penetration-test", "incident"], nested: true, defaultOpen: false },
      { id: "resilience", title: "Resilience", types: ["backup-test", "exercise"], nested: true, defaultOpen: false },
      { id: "evidence-issues", title: "Evidence and Issues", types: ["evidence", "finding", "data-request"], nested: true, defaultOpen: false }
    ]
  },
  {
    id: "audit",
    number: "6",
    title: "Audit",
    description: "Firm, requests, and report",
    sections: [
      { id: "engagement", title: "Engagement", types: ["audit", "audit-request"], defaultOpen: true },
      { id: "packet", title: "Evidence Delivery", types: [], utility: "audit-packet", defaultOpen: true }
    ]
  }
];
const ORGANIZATION_RESOURCE_TYPES = ["person", "team"];
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
  const route = parseRoute();
  const nav = buildNavigation(route);
  root.innerHTML = '<div class="shell">' + nav + '<div class="workspace"><header class="topbar">' + topbar(route) + '</header><main id="main"></main></div></div>';
  const main = root.querySelector("main");
  if (route.name === "home") renderHome(main);
  else if (route.name === "obligations") renderObligations(main);
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
  if (parts.length === 1 && parts[0] === "obligations") return { name: "obligations" };
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
      const links = renderSidebarUtility(section.utility, route, !section.nested) + resources.map(([type, definition]) => {
        return '<a class="' + (!section.nested ? "nav-direct " : "") + (route.type === type ? "current" : "") + '" href="#/resources/' + encodeURIComponent(type) + '"><span>' + esc(titleCase(definition.pluralTitle)) + '</span><span class="nav-control-slot" aria-hidden="true"></span></a>';
      }).join("");
      if (!section.nested) return links;
      return '<section class="nav-group nav-subgroup ' + (sectionOpen ? "open" : "") + '" data-group="' + esc(sectionKey) + '"><button class="nav-subheading" type="button" aria-expanded="' + sectionOpen + '" aria-controls="nav-group-' + esc(sectionKey) + '"><span>' + esc(section.title) + '</span><span class="chevron nav-control">›</span></button><div class="nav-items" id="nav-group-' + esc(sectionKey) + '">' + links + '</div></section>';
    }).join("");
    return '<section class="nav-group nav-stage ' + (stageOpen ? "open" : "") + '" data-group="' + esc(stage.id) + '"><button class="nav-heading" type="button" aria-expanded="' + stageOpen + '" aria-controls="nav-group-' + esc(stage.id) + '"><span class="nav-stage-number">' + esc(stage.number) + '</span><span class="nav-stage-copy"><strong>' + esc(stage.title) + '</strong><small>' + esc(stage.description) + '</small></span><span class="chevron nav-control">›</span></button><div class="nav-items" id="nav-group-' + esc(stage.id) + '">' + sections + '</div></section>';
  }).join("");
  const organizationCurrent = route.name === "organization" || route.name === "repository" || ["workspace", "renderer-settings", ...ORGANIZATION_RESOURCE_TYPES].includes(route.type);
  const organizationName = state.workspace.organizationName || "Organization";
  const initial = organizationName.trim().charAt(0).toUpperCase() || "O";
  return '<aside class="sidebar" id="sidebar-navigation"><button class="nav-close" type="button" aria-label="Close navigation">×</button><a href="#/" class="brand"' + (route.name === "home" ? ' aria-current="page"' : "") + '><img class="mark" src="./favicon.png" alt="" width="39" height="39"><span><strong>FileGRC</strong><small>SOC 2 workspace</small></span></a><nav class="sidebar-nav">' + stages + '</nav><div class="sidebar-footer"><a class="organization-nav ' + (organizationCurrent ? "current" : "") + '" href="#/organization"><span class="organization-mark">' + esc(initial) + '</span><span><strong>' + esc(organizationName) + '</strong><small>Organization</small></span><span class="organization-arrow">›</span></a></div></aside><button class="nav-scrim" type="button" aria-label="Close navigation"></button>';
}

function readinessStageForRoute(route) {
  return READINESS_STAGES.find((stage) => stage.sections.some((section) => section.types.includes(route.type)
    || (section.utility === "obligation-board" && route.name === "obligations")
    || (section.utility === "audit-packet" && route.name === "audit-packet")));
}

function readinessStageForType(type) {
  return READINESS_STAGES.find((stage) => stage.sections.some((section) => section.types.includes(type)));
}

function renderSidebarUtility(utility, route, direct = false) {
  const directClass = direct ? "nav-direct " : "";
  if (utility === "obligation-board") {
    return '<a class="' + directClass + (route.name === "obligations" ? "current" : "") + '" href="#/obligations"><span>Obligation Board</span><span class="nav-control-slot" aria-hidden="true"></span></a>';
  }
  if (utility === "audit-packet") {
    return '<a class="' + directClass + 'audit-packet-link ' + (route.name === "audit-packet" ? "current" : "") + '" href="#/audit-packet"><span>Evidence Packet</span><span class="nav-control-slot" aria-hidden="true"></span></a>';
  }
  return "";
}

function topbar(route) {
  const title = route.name === "home"
    ? "Program Overview"
    : route.name === "organization"
      ? "Organization"
      : route.name === "repository"
        ? "Repository"
        : route.name === "obligations"
          ? "Obligation Board"
          : route.name === "audit-packet"
            ? "Evidence Packet"
            : state.model.resources[route.type]?.pluralTitle || "FileGRC";
  return '<button class="mobile-nav" type="button" aria-label="Open navigation" aria-controls="sidebar-navigation" aria-expanded="false">☰</button><div><small class="eyebrow">' + esc(state.workspace.organizationName) + '</small><h1>' + esc(titleCase(title)) + '</h1></div><label class="search"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Search records" aria-label="Search records"><kbd>/</kbd></label><div class="topbar-status"><a class="validation-chip" href="#/repository"><span class="status-dot ' + (state.validation.ok ? "good" : "bad") + '"></span>' + (state.validation.ok ? "Data valid" : state.validation.counts.errors + " validation errors") + '</a><a class="repo-chip" href="#/repository"><span class="status-dot ' + (state.git.clean ? "good" : "warn") + '"></span>' + esc(state.git.available ? ((state.git.branch || "detached") + " · " + state.git.shortCommit) : "Git unavailable") + '</a></div>';
}

function renderHome(main) {
  const activeAudit = resourcesOfType("audit").find((item) => !["complete", "closed", "cancelled"].includes(item.record.status));
  main.innerHTML = '<div class="page home-page"><section class="hero overview-hero"><div><p class="kicker">Current program state</p><h2>' + esc(titleCase(state.workspace.title)) + '</h2><p>' + esc(state.workspace.description || "Governance, risk, controls, evidence, and audit work maintained as plain files in Git.") + '</p></div></section>' + readinessOverview() +
    '<div class="overview-grid"><section class="panel obligation-panel"><div class="panel-head"><div><p class="kicker">Policy obligations</p><h3>Due Windows</h3></div><a href="#/obligations">Open board</a></div>' + obligationPreview(state.obligations.items.filter((item) => item.status !== "complete").slice(0, 3)) + '</section>' +
    '<section class="panel event-reminder-panel"><div class="panel-head"><div><p class="kicker">Event reminders</p><h3>Did Something Change?</h3></div><a href="#/obligations">Start workflow</a></div>' + eventReminderPreview(state.obligations.triggers.slice(0, 4)) + '</section>' +
    '<section class="panel audit-panel"><div class="panel-head"><div><p class="kicker">Audit activity</p><h3>' + esc(titleCase(activeAudit?.record.title || "Plan the Engagement")) + '</h3></div>' + (activeAudit ? '<a href="#/resource/audit/' + encodeURIComponent(activeAudit.record.id) + '">Open audit</a>' : '<a href="#/resources/audit">Plan audit</a>') + '</div>' +
      (activeAudit ? auditProgress(activeAudit.record) + auditEngagementPrompt(activeAudit.record) : auditEngagementPrompt()) + '</section></div></div>';
}

function readinessOverview() {
  const inScopeSystems = resourcesOfType("system").filter(({ record }) => record.inScope && record.status !== "retired");
  const requirements = resourcesOfType("requirement").filter(({ record }) => record.applicability === "applicable");
  const policies = resourcesOfType("policy").filter(({ record }) => !["superseded", "retired"].includes(record.status));
  const approvedPolicies = policies.filter(({ record }) => ["approved", "active"].includes(record.status));
  const controls = resourcesOfType("control");
  const confirmedControls = controls.filter(({ record }) => record.status !== "planned");
  const evidence = resourcesOfType("evidence");
  const activeAudit = resourcesOfType("audit").find(({ record }) => !["complete", "closed", "cancelled"].includes(record.status));
  const stages = [
    ["Scope", "Define the service, system boundary, people, data, and vendors.", inScopeSystems.length ? "#/resources/system" : "#/resources/system?new=1", inScopeSystems.length + " in-scope " + pluralize("system", inScopeSystems.length), inScopeSystems.length ? "good" : "warn"],
    ["Criteria", "Record what the auditor will evaluate and whether it applies.", "#/resources/requirement", requirements.length + " applicable", requirements.length ? "neutral" : "warn"],
    ["Policies", "Set the rules and responsibilities the company adopts.", "#/resources/policy", approvedPolicies.length + " of " + policies.length + " approved", approvedPolicies.length === policies.length && policies.length ? "good" : "warn"],
    ["Controls", "Confirm the repeatable work that satisfies those rules and criteria.", "#/resources/control", confirmedControls.length + " of " + controls.length + " reviewed", confirmedControls.length === controls.length && controls.length ? "good" : "warn"],
    ["Operate Controls", "Complete recurring and event work, then attach dated evidence.", "#/obligations", state.obligations.counts.overdue ? state.obligations.counts.overdue + " overdue" : state.obligations.counts.due + " due · " + evidence.length + " evidence", state.obligations.counts.overdue ? "bad" : state.obligations.counts.due ? "warn" : "good"],
    ["Audit", "Track the firm, period, requests, evidence packet, findings, and report.", activeAudit ? "#/resources/audit" : "#/resources/audit?new=1", activeAudit ? "Engagement active" : "Not planned", activeAudit ? "good" : "neutral"]
  ];
  return '<section class="readiness-map"><div class="readiness-map-head"><div><p class="kicker">SOC 2 program path</p><h3>Follow the Audit Chain</h3></div><p>An auditor traces the system in scope to criteria, company rules, operating controls, and proof that those controls worked during the audit period.</p></div><div class="readiness-flow">' + stages.map(([title, body, href, status, tone], index) => '<a href="' + href + '"><span>' + (index + 1) + '</span><strong>' + esc(title) + '</strong><small>' + esc(body) + '</small><b class="readiness-state ' + esc(tone) + '">' + esc(status) + '</b></a>').join("") + '</div></section>';
}

function auditEngagementPrompt(audit = null) {
  const hasAuditor = audit?.auditorVendorId || (audit?.auditor && Object.keys(audit.auditor).length);
  if (hasAuditor) return "";
  const heading = audit ? "Auditor Not Recorded" : "Engage an Auditor Before the Target Date";
  return '<div class="audit-engagement"><div><strong>' + heading + '</strong><p>Shortlist independent CPA firms that perform SOC 2 examinations. Share the system boundary, Security scope, Type 1 or Type 2 goal, and target timing.</p></div><ul><li>Compare relevant service experience, schedule, fee, and evidence-request process.</li><li>Agree on scope and dates before the evidence period or as early as practical.</li><li>Store the selected firm and contact in the audit record.</li></ul>' + (!audit ? '<a class="button primary" href="#/resources/audit?new=1">Create audit record</a>' : "") + '</div>';
}

function renderObligations(main) {
  const plan = state.obligations;
  const visibleCardLimit = 6;
  const sections = ["upcoming", "due", "overdue"].map((status) => {
    const items = plan.items.filter((item) => item.status === status);
    const cards = items.map((item, index) => obligationCard(item, index >= visibleCardLimit)).join("");
    const more = items.length > visibleCardLimit
      ? '<button class="button obligation-more" type="button" data-expand-obligations="' + status + '" data-total="' + items.length + '" aria-expanded="false">Show ' + (items.length - visibleCardLimit) + ' more</button>'
      : "";
    return '<section class="obligation-column" data-obligation-column="' + status + '"><div class="obligation-column-head"><span class="badge status-' + status + '">' + esc(status) + '</span><strong>' + items.length + '</strong></div><div class="obligation-cards">' + (items.length ? cards : empty("Nothing " + status + ".")) + '</div>' + more + '</section>';
  }).join("");
  const triggers = plan.triggers.map((trigger) => '<article class="event-trigger-card"><div><p class="kicker">' + esc(trigger.eventType) + '</p><h3>' + esc(titleCase(trigger.prompt)) + '</h3><p>' + trigger.steps.length + ' policy actions will be created with their own owners and due windows.</p></div><ol>' + trigger.steps.map((step) => '<li><span>' + esc(step.title) + '</span><small>' + esc(eventStepSummary(step)) + '</small></li>').join("") + '</ol>' + (!state.readOnly ? '<button class="button primary" type="button" data-start-event="' + esc(trigger.eventType) + '">Start workflow</button>' : "") + '</article>').join("");
  const runs = plan.eventRuns
    .filter((run) => run.status !== "canceled")
    .sort((a, b) => String(b.occurredAt || b.occurredOn).localeCompare(String(a.occurredAt || a.occurredOn)));
  main.innerHTML = '<div class="page obligation-board-page"><div class="page-intro"><div><p class="kicker">Policy work queue</p><h2>Obligation Board</h2><p>Recurring work uses a compliant completion range and an explicit overdue cutoff. Event reminders create a tracked checklist when a policy-triggering change occurs.</p></div><div class="page-actions"><button class="button" type="button" data-scroll-events>Start policy event</button><a class="button" href="#/resources/obligation">Edit templates</a></div></div>' +
    '<div class="obligation-board">' + sections + '</div>' +
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
}

function obligationCard(item, collapsed = false) {
  const type = item.actionItemId ? "action-item" : "obligation";
  const id = item.actionItemId || item.obligationId;
  const completion = !item.actionItemId ? obligationCompletionPlan(item) : null;
  const action = !state.readOnly && item.status !== "upcoming" && completion
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
  const draft = !state.git.clean || !selected;
  const preflight = [
    ["Repository", state.git.available ? state.git.clean ? "Clean revision" : state.git.changes.length + " uncommitted" : "Git unavailable", "#/repository", state.git.clean ? "good" : "warn"],
    ["Engagement", selected ? selected.title : "No audit record", "#/resources/audit", selected ? "good" : "warn"],
    ["Evidence", evidence.length + " " + pluralize("record", evidence.length), "#/resources/evidence", evidence.length ? "good" : "neutral"],
    ["Policy work", state.obligations.counts.overdue ? state.obligations.counts.overdue + " overdue" : state.obligations.counts.due + " due", "#/obligations", state.obligations.counts.overdue ? "bad" : state.obligations.counts.due ? "warn" : "good"]
  ];
  main.innerHTML = '<div class="page audit-packet-page"><div class="page-intro"><div><p class="kicker">Audit evidence</p><h2>Build an Evidence Packet</h2><p>Select a period. The engine indexes every dated record, checks obligation and event coverage, includes linked evidence and active policy context, then writes an auditor-oriented HTML index, manifest, source records, Markdown, and fixed attachments.</p></div></div><section class="packet-preflight" aria-label="Packet readiness">' + preflight.map(([label, value, href, tone]) => '<a href="' + href + '"><span class="status-dot ' + tone + '"></span><span><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></span></a>').join("") + '</section><section class="panel packet-builder"><form id="packet-form"><label><span>Period start</span><input type="date" name="start" required value="' + esc(start) + '"></label><label><span>Period end</span><input type="date" name="end" required value="' + esc(end) + '"></label><label><span>Audit <small>optional</small></span><select name="auditId"><option value="">All In-Scope Program Records</option>' + audits.map(({ record }) => '<option value="' + esc(record.id) + '" ' + (record.id === selected?.id ? "selected" : "") + '>' + esc(record.title) + '</option>').join("") + '</select></label><button class="button primary" type="submit" ' + (state.readOnly ? "disabled" : "") + '>' + (draft ? "Generate draft" : "Generate packet") + '</button></form><p class="packet-note">' + (state.readOnly ? "Packet generation requires the local writable renderer or the CLI." : draft ? "Drafts expose coverage gaps now. Commit a clean revision and select an audit record before auditor delivery." : "The packet is derived under .filegrc/ and bound to the selected audit and current Git revision.") + '</p><div class="dialog-error" role="alert"></div></section><div id="packet-results"></div></div>';
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
          end: form.elements.end.value,
          auditId: form.elements.auditId.value || undefined
        })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      renderPacketResults(main.querySelector("#packet-results"), await response.json());
    } catch (caught) {
      error.textContent = caught.message;
    } finally {
      button.disabled = state.readOnly;
      button.textContent = draft ? "Generate draft" : "Generate packet";
    }
  });
}

function renderPacketResults(container, result) {
  const packet = result.packet;
  container.innerHTML = '<section class="metrics packet-metrics">' +
    metric("Dated records", packet.summary.datedRecords, packet.summary.records + " total source records", "neutral") +
    metric("Obligations", packet.summary.obligationOccurrences, packet.summary.eventRuns + " event workflows", "neutral") +
    metric("Evidence", packet.summary.evidence, packet.summary.policies + " policies · " + packet.summary.controls + " controls", "neutral") +
    metric("Review items", packet.summary.gaps, packet.revision.clean ? "Bound to " + packet.revision.shortCommit : "Workspace has uncommitted changes", packet.summary.gaps ? "warn" : "good") +
    '</section><section class="panel packet-output"><div class="panel-head"><div><p class="kicker">Generated packet</p><h3>' + esc(result.output) + '</h3></div>' + (result.packetUrl ? '<a class="button primary" href="' + esc(result.packetUrl) + '" target="_blank" rel="noreferrer">Open index</a>' : "") + '</div><p>The directory contains ' + result.files.length + ' files. Review every gap before sending it to an auditor.</p></section>' +
    '<div class="dashboard-grid"><section class="panel span-2"><div class="panel-head"><h3>Coverage Gaps and Warnings</h3></div>' + (packet.gaps.length ? '<div class="packet-gaps">' + packet.gaps.map((gap) => '<div><span class="badge ' + (gap.severity === "error" ? "bad" : "warn") + '">' + esc(gap.severity) + '</span><p>' + esc(gap.message) + '</p></div>').join("") + '</div>' : empty("No packet gaps were detected.")) + '</section><section class="panel"><div class="panel-head"><h3>Included Evidence</h3></div>' + (packet.evidence.length ? '<div class="packet-list">' + packet.evidence.slice(0, 12).map((item) => '<a href="#/resource/evidence/' + encodeURIComponent(item.id) + '"><strong>' + esc(item.title) + '</strong><small>' + esc(item.status) + ' · ' + esc(item.evidenceKind) + '</small></a>').join("") + '</div>' : empty("No evidence records matched.")) + '</section></div>';
}

function obligationPreview(items) {
  return items.length ? '<div class="obligation-preview">' + items.map((item) => '<a href="#/obligations"><span class="status-dot ' + (item.status === "overdue" ? "bad" : item.status === "due" ? "warn" : "neutral") + '"></span><span><strong>' + esc(item.title) + '</strong><small>' + esc(timingText(item)) + '</small></span></a>').join("") + '</div>' : empty("No open obligations.");
}

function eventReminderPreview(triggers) {
  return triggers.length ? '<div class="event-reminder-preview">' + triggers.map((trigger) => '<a href="#/obligations"><strong>' + esc(trigger.prompt) + '</strong><small>' + trigger.steps.length + ' required actions</small></a>').join("") + '</div>' : empty("No event reminders configured.");
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
  const fields = [...new Set(["title", ...(definition.listFields || [])])].filter((name) => name !== "title");
  const modelFields = { ...state.model.commonFields, ...definition.fields };
  const filters = Object.entries(modelFields).filter(([, field]) => field.filter).map(([name, field]) => {
    const observed = entries.flatMap(({ record }) => Array.isArray(record[name]) ? record[name] : [record[name]]).filter((value) => ["string", "number", "boolean"].includes(typeof value)).map(String);
    const values = [...new Set(observed)].sort();
    return { name, label: field.label || humanize(name), values };
  }).filter(({ values }) => values.length > 1);
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">' + esc(readinessStageForType(type)?.title || (ORGANIZATION_RESOURCE_TYPES.includes(type) ? "Organization" : groupTitle(definition.group))) + '</p><h2>' + esc(titleCase(definition.pluralTitle)) + '</h2></div>' + (!state.readOnly && !definition.singleton ? '<button class="button primary" id="new-resource">New ' + esc(definition.title.toLowerCase()) + '</button>' : "") + '</div>' + resourceGuide(type) +
    '<div class="list-tools"><label><span class="sr-only">Filter list</span><input id="list-search" type="search" placeholder="Filter ' + esc(definition.pluralTitle.toLowerCase()) + '"></label>' +
    filters.map(({ name, label, values }) => '<select class="field-filter" data-field="' + esc(name) + '" aria-label="Filter by ' + esc(label.toLowerCase()) + '"><option value="">Any ' + esc(properCase(label)) + '</option>' + values.map((value) => '<option value="' + esc(value) + '">' + esc(filterOptionLabel(value)) + '</option>').join("") + '</select>').join("") + '<span id="result-count" aria-live="polite">' + entries.length + ' records</span></div>' +
    '<section class="record-table-wrap"><table class="record-table"><thead><tr><th>' + esc(fieldLabel(type, "title")) + '</th>' + fields.map((name) => '<th>' + esc(fieldLabel(type, name)) + '</th>').join("") + '<th>Git file</th></tr></thead><tbody id="record-rows"></tbody></table></section>' +
    '<nav class="pagination list-pagination" aria-label="' + esc(definition.pluralTitle) + ' pages" hidden><button class="button" type="button" data-page="previous">Previous</button><span class="page-status" aria-live="polite"></span><button class="button" type="button" data-page="next">Next</button></nav></div>';
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
    main.querySelector("#record-rows").innerHTML = filtered.length ? visible.map((entry) => '<tr><td data-label="' + esc(fieldLabel(type, "title")) + '" data-primary-field><a class="record-title" href="#/resource/' + encodeURIComponent(type) + '/' + encodeURIComponent(entry.record.id) + '">' + esc(entry.record.title) + '</a></td>' + fields.map((name) => '<td data-label="' + esc(fieldLabel(type, name)) + '">' + formatValue(entry.record[name], name, type) + '</td>').join("") + '<td data-label="Git file"><code>' + esc(entry.relativePath.replace(/^data\//, "")) + '</code></td></tr>').join("") : '<tr><td colspan="' + (fields.length + 2) + '">' + empty("No records match this filter.") + '</td></tr>';
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
  main.innerHTML = '<div class="page"><div class="detail-head"><div><div class="breadcrumbs header-breadcrumbs"><a href="#/resources/' + encodeURIComponent(type) + '">' + esc(titleCase(definition.pluralTitle)) + '</a><span>/</span><span>' + esc(entry.record.title) + '</span></div><h2>' + esc(titleCase(entry.record.title)) + '</h2></div><div class="actions">' + (type === "audit" ? '<a class="button primary" href="#/audit-packet?auditId=' + encodeURIComponent(entry.record.id) + '">Evidence packet</a>' : "") + (!state.readOnly ? '<button class="button" id="edit-resource">Edit</button>' + (!definition.singleton ? '<button class="button danger" id="delete-resource">Delete</button>' : "") : "") + '</div></div><div class="detail-grid"><section class="panel detail-main">' +
    (narrativeContent || markdownContent ? narrativeContent + markdownContent + addRecordContent : '<div class="panel-head"><h3>Record</h3></div>' + empty("Add Record Markdown when this record needs context beyond its structured fields.") + addRecordContent) +
    '</section><aside><section class="panel"><div class="panel-head"><h3>Metadata</h3></div><dl class="metadata">' + sourceMetadata + visible.map(([name, value]) => '<div><dt>' + esc(fields[name]?.label || humanize(name)) + '</dt><dd>' + formatValue(value, name, type) + '</dd></div>').join("") + '</dl></section>' + resourceConnections(entry) + '<section class="panel"><div class="panel-head"><h3>File History</h3></div>' + (entry.history?.length ? '<div class="history">' + entry.history.map((commit) => '<div><code>' + esc(commit.shortCommit) + '</code><span><strong>' + esc(commit.subject) + '</strong><small>' + esc(commit.author) + ' · ' + esc(formatLocalDateTime(commit.timestamp)) + '</small></span></div>').join("") + '</div>' : empty("No committed history for this file.")) + '</section></aside></div></div>';
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
    ...ORGANIZATION_RESOURCE_TYPES,
    "workspace",
    "renderer-settings"
  ];
}

function renderOrganization(main) {
  const workspace = resourcesOfType("workspace")[0];
  const renderer = rendererSettingsEntry();
  const people = resourcesOfType("person");
  const teams = resourcesOfType("team");
  const organizationName = state.workspace.organizationName || "Organization";
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">Administration</p><h2>' + esc(titleCase(organizationName)) + '</h2><p>Manage the organization records that supply ownership, accountability, shared teams, and renderer behavior across the compliance program.</p></div>' + (workspace ? '<a class="button primary" href="#/resource/workspace/' + encodeURIComponent(workspace.record.id) + '">Organization profile</a>' : "") + '</div><div class="organization-grid"><section class="panel organization-profile"><div class="panel-head"><div><p class="kicker">Organization</p><h3>Program Settings</h3></div></div><dl class="metadata"><div><dt>Name</dt><dd>' + esc(organizationName) + '</dd></div><div><dt>Timezone</dt><dd>' + esc(state.workspace.timezone) + '</dd></div><div><dt>Data model</dt><dd>Version ' + esc(state.workspace.dataModelVersion) + '</dd></div><div><dt>Repository</dt><dd>' + (state.git.available ? esc((state.git.branch || "detached") + " · " + state.git.shortCommit) : "Git unavailable") + '</dd></div></dl></section><section class="panel organization-directory"><div class="panel-head"><div><p class="kicker">Directory</p><h3>People and Teams</h3></div></div><div class="organization-links"><a href="#/resources/person"><span><strong>People</strong><small>Owners, approvers, trainees, reviewers, and contacts</small></span><b>' + people.length + '</b></a><a href="#/resources/team"><span><strong>Teams</strong><small>Committees, response groups, and shared ownership</small></span><b>' + teams.length + '</b></a></div></section><section class="panel organization-tools"><div class="panel-head"><div><p class="kicker">Workspace</p><h3>Renderer and Repository</h3></div></div><div class="organization-links">' + (renderer ? '<a href="#/resource/renderer-settings/' + encodeURIComponent(renderer.record.id) + '"><span><strong>Renderer Settings</strong><small>Committed behavior, including onboarding</small></span><b>›</b></a>' : "") + '<a href="#/repository"><span><strong>Repository</strong><small>Validation, file changes, history, and commits</small></span><b>›</b></a></div></section></div></div>';
}

function renderRepository(main) {
  const settings = rendererSettingsEntry();
  const settingsLink = settings ? '<a class="button" href="#/resource/renderer-settings/' + encodeURIComponent(settings.record.id) + '">Renderer settings</a>' : "";
  const onboardingButton = settings && !state.readOnly ? '<button class="button" type="button" id="start-onboarding">Run onboarding</button>' : "";
  const commitButton = !state.readOnly && state.git.available && !state.git.clean
    ? '<button class="button primary" type="button" id="commit-workspace" ' + (state.validation.ok ? "" : 'disabled title="Fix validation errors before committing"') + '>Commit changes</button>'
    : "";
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">Audit trail</p><h2>Repository State</h2><p>Review the workspace diff, then commit it here or with Git. Git supplies authors, timestamps, messages, revisions, and file history.</p></div><div class="page-actions">' + commitButton + onboardingButton + settingsLink + '<a class="button" href="#/resource/workspace/workspace">Workspace settings</a></div></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Current Revision</h3></div><dl class="metadata"><div><dt>Branch</dt><dd>' + esc(state.git.branch || "Unavailable") + '</dd></div><div><dt>Commit</dt><dd><code>' + esc(state.git.commit || "Unavailable") + '</code></dd></div><div><dt>Working tree</dt><dd>' + (state.git.clean === null ? "Unavailable" : state.git.clean ? "Clean" : "Has changes") + '</dd></div><div><dt>Generated</dt><dd>' + esc(formatLocalDateTime(state.generatedAt)) + '</dd></div></dl></section><section class="panel span-2"><div class="panel-head"><h3>Uncommitted Changes</h3></div>' + (state.git.changes?.length ? '<ul class="changes">' + state.git.changes.map((change) => '<li><code>' + esc(change) + '</code></li>').join("") + '</ul>' : empty(state.git.available ? "No uncommitted changes." : state.git.message)) + '</section><section class="panel span-2"><div class="panel-head"><h3>Validation</h3><span class="badge ' + (state.validation.ok ? "good" : "bad") + '">' + (state.validation.ok ? "Passing" : "Needs attention") + '</span></div>' + (state.validation.diagnostics.length ? '<div class="diagnostics">' + state.validation.diagnostics.map((item) => '<div><span class="badge ' + item.severity + '">' + esc(item.severity) + '</span><code>' + esc(item.path) + '</code><p>' + esc(item.message) + '</p></div>').join("") + '</div>' : empty("Every record and relationship validates against model v" + state.model.modelVersion + ".")) + '</section></div></div>';
  main.querySelector("#commit-workspace")?.addEventListener("click", openCommitDialog);
  main.querySelector("#start-onboarding")?.addEventListener("click", requestOnboarding);
}

function openCommitDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "commit-dialog";
  dialog.setAttribute("aria-labelledby", "commit-dialog-title");
  dialog.innerHTML = '<form><div class="dialog-head"><div><p class="kicker">Git audit trail</p><h2 id="commit-dialog-title">Commit Workspace Changes</h2></div><button type="button" class="icon-button" aria-label="Close">×</button></div><p>Commit every change under this FileGRC workspace. Use a message that explains why the compliance records changed.</p><label><span>Commit message</span><input name="message" required maxlength="200" placeholder="Record quarterly access review"></label><div class="commit-files">' + state.git.changes.map((change) => '<code>' + esc(change) + '</code>').join("") + '</div><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-commit="cancel">Cancel</button><button type="submit" class="button primary">Commit changes</button></div></form>';
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
    button.textContent = "Committing…";
    try {
      const response = await localFetch("/api/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: form.elements.message.value })
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      state = await fetchJson("/api/state");
      dialog.close();
      render();
    } catch (error) {
      form.querySelectorAll("button,input").forEach((control) => { control.disabled = false; });
      button.textContent = "Commit changes";
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
  return '<section class="page-guide" aria-label="How to use ' + esc(definition.pluralTitle) + '"><div><span>Use</span><p>' + esc(definition.description) + '</p></div><div><span>Policy basis</span><p>' + esc(guidance.policyBasis) + '</p>' + sourceLinks + '</div><div><span>Timing</span><p>' + esc(guidance.cadence) + '</p>' + obligationLinks + '</div></section>';
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
  const auditEntry = systemEntry
    ? resourcesOfType("audit").find(({ record }) => ["planned", "in-progress", "fieldwork"].includes(record.status) && record.systemIds?.includes(systemEntry.record.id))
    : null;
  const owner = resourcesOfType("person").find(({ record }) => record.status === "active")?.record;
  return {
    systemId: systemEntry?.record.id || "",
    auditId: auditEntry?.record.id || "",
    serviceName: systemEntry?.record.title || "",
    scope: systemEntry?.record.description || "",
    ownerId: systemEntry?.record.ownerIds?.[0] || auditEntry?.record.ownerIds?.[0] || owner?.id || "",
    criticality: systemEntry?.record.criticality || "high",
    dataClassification: systemEntry?.record.dataClassification || "Confidential",
    internetExposed: systemEntry?.record.internetExposed === false ? "false" : "true",
    auditGoal: auditGoalFromKind(auditEntry?.record.auditKind)
  };
}

function onboardingSteps() {
  return [
    {
      target: null,
      kicker: "SOC 2 basics",
      title: "SOC 2 is an audit away",
      body: [
        "SOC 2 is just an auditor's report that you have adopted a set of policies meeting certain criteria.",
        "This includes information security criteria, but it can optionally include availability, processing integrity, confidentiality, and privacy criteria. Generally, customers requesting a SOC 2 report just need the information security criteria."
      ],
      sections: [
        {
          title: "Type 1",
          body: "An auditor evaluates whether your policies and controls are suitably designed and in place at a specific point in time. It is a snapshot rather than a test of ongoing operation. Type 1 is not required for Type 2, but Type 1 can be helpful as a short-term solution for urgent customer requests."
        },
        {
          title: "Type 2",
          body: "An auditor evaluates whether your controls operated consistently throughout a review period, most commonly six months. You provide dated evidence showing that the policies were followed across that period."
        }
      ],
      afterSections: "Just about all of the evidence needed for these audits will come from your software's production infrastructure + monitoring, or the business operations tracked in FileGRC."
    },
    {
      target: ".repo-chip",
      kicker: "Mental model",
      title: "Files are the program",
      body: "You or an agent add JSON records, Markdown, and evidence attachments under data/. This renderer edits those files, and Git records their history.",
      points: [
        "Use the UI, an editor, the CLI, or an agent; every path changes the same files.",
        "JSON holds structured records. Markdown holds policies, plans, minutes, and other long-form work.",
        "Review the workspace diff, then commit in Repository or with Git.",
        "The dashboard derives program status from the current repository state."
      ]
    },
    {
      target: ".readiness-map",
      kicker: "Program model",
      title: "Follow the audit chain",
      body: "The program runs in one direction: define the system scope, map the criteria, adopt policies, operate controls, retain dated proof, and give the auditor a coherent record of the period.",
      points: [
        "Criteria are external expectations. Policies are company rules. Controls state the repeatable work that meets both.",
        "Inventories and dated records of reviews, assessments, meetings, tests, and incidents show that controls are operating.",
        "Evidence proves an occurrence; Git proves the history of every artifact."
      ]
    },
    {
      target: ".obligation-panel",
      kicker: "Obligations",
      title: "Work the policy queue",
      body: "Recurring policy work appears as upcoming, due, or overdue. Each item shows the full allowed completion range, the first overdue date, and a live countdown to that cutoff.",
      points: [
        "Quarterly means any date in that cycle is valid unless the policy sets a narrower window.",
        "Link a dated completion record and its evidence to satisfy one occurrence.",
        "The UI and FileGRC CLI use the same calculation."
      ]
    },
    {
      target: ".event-reminder-panel",
      kicker: "Triggered work",
      title: "Complete a checklist when key events occur",
      body: "Use an event reminder for a new worker, departure, vendor, material system change, or incident. One action item is created for every policy requirement, with its own owner, evidence, due range, and cutoff.",
      points: [
        "The checklist stays open until every action is done and has the requested completion record or evidence.",
        "Hour-based rules keep the event time and exact cutoff; day-based rules keep the policy date range.",
        "Every action has a policy-based cutoff or a reasonable default deadline for the event.",
        "Agents start the identical workflow with the FileGRC CLI."
      ]
    },
    {
      target: ".audit-panel",
      kicker: "Audit",
      title: "Plan the engagement and generate evidence",
      body: "Engage an independent CPA firm early, record the agreed scope and period, then generate the period packet from the same files used to run the program.",
      points: [
        "Compare relevant experience, schedule, fee, and evidence-request process.",
        "Audit tracks the firm, dates, requests, findings, and report.",
        "The packet includes dated records, obligation coverage, Markdown, and fixed attachments.",
        "Coverage gaps identify missing completions, open event actions, unverified evidence, and uncommitted state.",
        "Agents generate the same result with the FileGRC CLI."
      ]
    },
    {
      target: null,
      kicker: "Initial scope",
      title: "Describe the service you plan to audit",
      body: "This creates or updates one in-scope system and, if selected, one planned audit. Add vendors, commitments, risks, and evidence after the system boundary is clear."
    }
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
  onboardingDialog.innerHTML = '<div class="onboarding-progress" style="--onboarding-step-count:' + steps.length + '" aria-label="Onboarding step ' + (onboardingStep + 1) + ' of ' + steps.length + '">' + progress + '</div><div class="onboarding-head"><p class="kicker">' + esc(step.kicker) + ' · ' + (onboardingStep + 1) + ' of ' + steps.length + '</p><h2 id="onboarding-title">' + esc(titleCase(step.title)) + '</h2></div>' + body + '<div class="dialog-error" role="alert"></div><div class="dialog-actions onboarding-actions"><button class="button text-button onboarding-skip" type="button" data-onboarding="skip">Skip onboarding</button>' + (onboardingStep ? '<button class="button" type="button" data-onboarding="back">Back</button>' : "") + '<button class="button primary" type="button" data-onboarding="next">' + (onboardingStep === steps.length - 1 ? "Save setup" : "Next") + '</button></div>';
  onboardingDialog.querySelector('[data-onboarding="skip"]').addEventListener("click", cancelOnboarding);
  onboardingDialog.querySelector('[data-onboarding="back"]')?.addEventListener("click", () => {
    captureOnboardingForm();
    onboardingStep -= 1;
    renderOnboardingStep();
  });
  onboardingDialog.querySelector('[data-onboarding="next"]').addEventListener("click", () => {
    if (onboardingStep === steps.length - 1) saveOnboarding();
    else {
      onboardingStep += 1;
      renderOnboardingStep();
    }
  });
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
  const currentAudit = onboardingDraft.auditId ? state.resources.find(({ record }) => record.id === onboardingDraft.auditId)?.record : null;
  const existing = [
    currentSystem ? "Updates system " + currentSystem.title + "." : "Creates a new in-scope system.",
    currentAudit ? "Updates planned audit " + currentAudit.title + " when an audit objective is selected." : ""
  ].filter(Boolean).join(" ");
  const gitStatus = state.git.available
    ? '<div class="onboarding-git-status"><span class="status-dot good"></span><span><strong>Git repository detected</strong><small>Setup changes will appear in the workspace diff before you commit them.</small></span></div>'
    : '<div class="onboarding-git-status warning"><span class="status-dot warn"></span><span><strong>Git setup needed</strong><small>Saving still works. Run <code>git init</code> at the workspace root before your first compliance commit.</small></span></div>';
  return '<p class="onboarding-body">' + esc(onboardingSteps().at(-1).body) + '</p>' + gitStatus + '<form id="onboarding-setup" class="onboarding-form"><label class="wide"><span>Service name</span><input name="serviceName" required maxlength="200" value="' + esc(onboardingDraft.serviceName) + '" placeholder="Customer-facing application"></label><label class="wide"><span>Scope description</span><textarea name="scope" required maxlength="2000" placeholder="What the service does and which production boundary is in scope">' + esc(onboardingDraft.scope) + '</textarea></label><label><span>Accountable owner</span><select name="ownerId" required><option value="">Select</option>' + people.map(({ record }) => '<option value="' + esc(record.id) + '" ' + (record.id === onboardingDraft.ownerId ? "selected" : "") + '>' + esc(record.title) + '</option>').join("") + '</select></label><label><span>Business criticality</span><select name="criticality" required>' + ["low", "medium", "high", "critical"].map((value) => '<option value="' + value + '" ' + (value === onboardingDraft.criticality ? "selected" : "") + '>' + esc(properCase(value)) + '</option>').join("") + '</select></label><label><span>Highest data classification</span><select name="dataClassification" required>' + classifications.map((value) => '<option value="' + esc(value) + '" ' + (value === onboardingDraft.dataClassification ? "selected" : "") + '>' + esc(properCase(value)) + '</option>').join("") + '</select></label><label><span>Internet exposed</span><select name="internetExposed" required><option value="true" ' + (onboardingDraft.internetExposed === "true" ? "selected" : "") + '>Yes</option><option value="false" ' + (onboardingDraft.internetExposed === "false" ? "selected" : "") + '>No</option></select></label><label class="wide"><span>Audit objective</span><select name="auditGoal" required><option value="none" ' + (onboardingDraft.auditGoal === "none" ? "selected" : "") + '>No Engagement Planned</option><option value="readiness" ' + (onboardingDraft.auditGoal === "readiness" ? "selected" : "") + '>Readiness Assessment</option><option value="type-1" ' + (onboardingDraft.auditGoal === "type-1" ? "selected" : "") + '>SOC 2 Type 1</option><option value="type-2" ' + (onboardingDraft.auditGoal === "type-2" ? "selected" : "") + '>SOC 2 Type 2</option></select><small>Dates, auditor, subservice method, and final scope stay unset until the engagement is planned.</small></label></form><p class="onboarding-write-note">' + esc(existing) + ' Saving writes JSON files but does not commit them.</p>';
}

function captureOnboardingForm() {
  const form = onboardingDialog?.querySelector("#onboarding-setup");
  if (!form) return;
  const data = new FormData(form);
  for (const name of ["serviceName", "scope", "ownerId", "criticality", "dataClassification", "internetExposed", "auditGoal"]) {
    onboardingDraft[name] = String(data.get(name) || "").trim();
  }
}

async function saveOnboarding() {
  if (onboardingBusy) return;
  const form = onboardingDialog?.querySelector("#onboarding-setup");
  if (!form?.reportValidity()) return;
  captureOnboardingForm();
  setOnboardingBusy(true, "Saving…");
  try {
    let systemEntry = onboardingDraft.systemId
      ? state.resources.find(({ record }) => record.type === "system" && record.id === onboardingDraft.systemId)
      : null;
    const systemId = systemEntry?.record.id || createResourceId("system", onboardingDraft.serviceName, state.resources.map(({ record }) => record.id));
    const system = {
      ...(systemEntry?.record || {}),
      schemaVersion: 1,
      id: systemId,
      type: "system",
      title: onboardingDraft.serviceName,
      status: systemEntry?.record.status || "active",
      criticality: onboardingDraft.criticality,
      ownerIds: [onboardingDraft.ownerId],
      description: onboardingDraft.scope,
      systemKind: systemEntry?.record.systemKind || "service",
      dataClassification: onboardingDraft.dataClassification,
      internetExposed: onboardingDraft.internetExposed === "true",
      inScope: true
    };
    await writeOnboardingResource(system, systemEntry);
    state = await fetchJson("/api/state");
    onboardingDraft.systemId = systemId;
    systemEntry = state.resources.find(({ record }) => record.id === systemId);

    if (onboardingDraft.auditGoal !== "none") {
      let auditEntry = onboardingDraft.auditId
        ? state.resources.find(({ record }) => record.type === "audit" && record.id === onboardingDraft.auditId)
        : null;
      const kind = auditKindFromGoal(onboardingDraft.auditGoal);
      const title = onboardingDraft.serviceName + " " + auditTitleFromGoal(onboardingDraft.auditGoal);
      const auditId = auditEntry?.record.id || createResourceId("audit", title, state.resources.map(({ record }) => record.id));
      const audit = {
        ...(auditEntry?.record || {}),
        schemaVersion: 1,
        id: auditId,
        type: "audit",
        title: auditEntry?.record.title || title,
        status: auditEntry?.record.status || "planned",
        auditKind: kind,
        frameworkIds: auditEntry?.record.frameworkIds || resourcesOfType("framework").filter(({ record }) => record.status === "active").map(({ record }) => record.id),
        scope: onboardingDraft.scope,
        ownerIds: [onboardingDraft.ownerId],
        systemIds: [...new Set([...(auditEntry?.record.systemIds || []), systemId])],
        contactIds: [...new Set([...(auditEntry?.record.contactIds || []), onboardingDraft.ownerId])]
      };
      await writeOnboardingResource(audit, auditEntry);
      state = await fetchJson("/api/state");
      onboardingDraft.auditId = auditId;
    }

    await persistOnboardingPreference(false);
    closeOnboarding();
    history.replaceState(null, "", "#/");
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
  await writeOnboardingResource({ ...entry.record, showOnboarding }, entry);
  state = await fetchJson("/api/state");
}

async function writeOnboardingResource(record, entry) {
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

function auditGoalFromKind(kind) {
  if (kind === "soc-2-type-1") return "type-1";
  if (kind === "soc-2-type-2") return "type-2";
  if (kind === "readiness") return "readiness";
  return "none";
}

function auditKindFromGoal(goal) {
  return goal === "type-1" ? "soc-2-type-1" : goal === "type-2" ? "soc-2-type-2" : "readiness";
}

function auditTitleFromGoal(goal) {
  return goal === "type-1" ? "SOC 2 Type 1" : goal === "type-2" ? "SOC 2 Type 2" : "SOC 2 readiness assessment";
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
    markdown.required || markdown.oneOf || !entry || entry.content?.[markdown.name]
  ));
  const recordContent = recordContentDefinition(type);
  const recordContentItem = recordContent ? entry?.content?.[recordContent.slot] : null;
  dialog.innerHTML = '<form><div class="dialog-head"><div><p class="kicker">' + (entry ? "Edit record" : options.obligationCompletion ? "Record obligation work" : "Create record") + '</p><h2 id="resource-editor-title">' + esc(titleCase(entry?.record.title || record.title || definition.title)) + '</h2></div><button type="button" class="icon-button" data-editor-dismiss aria-label="Close">×</button></div><p>' + esc(options.description || "Fill the core fields below. Git will record the author, time, reason, and diff when you commit this file.") + '</p><div class="form-grid">' + names.map((name) => editorField(type, name, fields[name], record[name], required.has(name) || conditionMatches(record, fields[name].requiredWhen), Boolean(entry), oneOf.has(name))).join("") + '</div>' +
    activeMarkdown.map((markdown) => {
      const generated = !entry?.content?.[markdown.name];
      const source = entry?.content?.[markdown.name]?.source ?? "# " + (record.title || "New " + definition.title) + "\n\nDescribe this " + definition.title.toLowerCase() + " here.\n";
      const requiredMark = markdown.required ? '<span class="required-mark">Required</span>' : markdown.oneOf ? '<span class="required-mark">One Required</span>' : "";
      return '<label class="content-editor-field" data-content-editor="' + esc(markdown.name) + '"><span>' + esc(markdown.label) + ' Markdown' + requiredMark + '</span><textarea data-markdown-slot="' + esc(markdown.name) + '" data-generated-content="' + generated + '" spellcheck="true" ' + (markdown.required ? "required" : "") + '>' + esc(source) + '</textarea></label>';
    }).join("") + renderRecordContentEditor(type, entry, options) +
    '<details class="advanced-editor"><summary>Advanced JSON</summary><p>Use this for optional fields, extensions, or bulk edits. Changes here replace the guided fields above.</p><textarea spellcheck="false" aria-label="Advanced resource JSON">' + esc(JSON.stringify(record, null, 2)) + '</textarea></details><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-editor-dismiss>Cancel</button><button type="submit" class="button primary" id="save-record">' + esc(options.saveLabel || "Save file") + '</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelectorAll("[data-editor-dismiss]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  wireEditorRequirements(dialog, record, fields, definition.oneOf || []);
  dialog.querySelector(".advanced-editor textarea").addEventListener("input", () => { dialog.dataset.jsonDirty = "true"; });
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
      if (!dialog.querySelector("form").reportValidity()) return;
      const updated = dialog.dataset.jsonDirty === "true"
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
    control = '<input type="' + inputType + '" value="' + esc(value ?? "") + '"' + placeholder + '>';
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

function wireEditorRequirements(dialog, base, fields, oneOfGroups) {
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
  root.querySelectorAll(".nav-heading, .nav-subheading").forEach((button) => button.addEventListener("click", () => {
    const group = button.closest(".nav-group");
    const open = group.classList.toggle("open");
    setNavigationGroupOpen(group.dataset.group, open);
    button.setAttribute("aria-expanded", String(open));
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
*{box-sizing:border-box}body{margin:0;min-width:320px;background:var(--paper)}button,input,select,textarea{font:inherit}a{color:inherit}.skip-link{position:fixed;left:1rem;top:-4rem;z-index:100;padding:.7rem 1rem;background:#fff}.skip-link:focus{top:1rem}.loading,.fatal{padding:3rem}.shell{display:grid;grid-template-columns:248px 1fr;min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:248px;background:var(--sidebar);color:#eef1ff;padding:25px 18px 18px;overflow:auto;z-index:20}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;margin:0 7px 27px}.brand .mark{display:block;width:39px;height:39px;border-radius:10px}.brand strong,.brand small{display:block}.brand strong{color:#fff;font-size:15px}.brand small{font-size:11px;color:#c5cae2;margin-top:2px}.nav-home,.nav-items a{display:flex;justify-content:space-between;align-items:center;text-decoration:none;border-radius:7px;padding:8px 10px;font-size:13px;color:#d5d9ed}.nav-home{margin-bottom:9px}.nav-home:hover,.nav-items a:hover,.nav-home.current,.nav-items a.current{background:#202066;color:#fff}.nav-heading{width:100%;border:0;background:none;color:#b4bbdc;text-transform:uppercase;letter-spacing:.11em;font-size:10px;font-weight:750;display:flex;align-items:center;justify-content:space-between;padding:13px 10px 5px;cursor:pointer}.chevron{display:grid;place-items:center;width:14px;height:22px;font-size:0;line-height:1;transform:none}.chevron:before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transform-origin:center;transition:transform .15s}.nav-items{display:none}.nav-group.open .nav-items{display:block}.nav-items small{font-size:10px;color:#b8bed7}.side-foot{position:sticky;bottom:-18px;margin:25px -18px -18px;padding:17px 25px;background:#000024;border-top:1px solid #34345f;color:#cbd0e5;font-size:11px;display:flex;align-items:center;gap:8px}.status-dot{width:8px;height:8px;border-radius:50%;background:#9aa39f;display:inline-block;flex:0 0 auto}.status-dot.good,.badge.good{background:#6abf8c}.status-dot.warn,.badge.warn{background:#e9a445}.status-dot.bad,.badge.bad{background:#dc6c5d}.status-dot.neutral{background:#9aabff}.workspace{grid-column:2;min-width:0}.topbar{height:86px;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:0 32px;display:flex;align-items:center;gap:23px;position:sticky;top:0;z-index:10}.topbar>div:first-of-type{min-width:190px}.topbar h1{font-size:17px;line-height:1.1;margin:3px 0 0}.eyebrow,.kicker{color:var(--accent);text-transform:uppercase;letter-spacing:.12em;font-weight:760;font-size:9px;margin:0}.search{height:39px;max-width:480px;flex:1;margin-left:auto;display:flex;align-items:center;gap:9px;background:#f2f4fa;border:1px solid #dfe3ef;border-radius:8px;padding:0 10px;color:#5d6475}.search input{border:0;outline:0;background:none;min-width:0;flex:1;font-size:13px}.search kbd{background:#fff;border:1px solid #dfe3ef;border-radius:4px;padding:1px 5px;font-size:10px}.repo-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);font-size:11px;white-space:nowrap;text-decoration:none}.mobile-nav{display:none}.page{padding:30px 34px 70px;max-width:1510px;margin:auto}.hero{color:#f8f9ff;background:linear-gradient(120deg,#000070,#000035);border-radius:13px;padding:28px 31px;display:flex;justify-content:space-between;align-items:end;min-height:158px;box-shadow:var(--shadow);position:relative;overflow:hidden}.hero:after{content:"";position:absolute;width:270px;height:270px;border:55px solid rgba(138,161,255,.1);border-radius:50%;right:-80px;top:-145px}.hero .kicker{color:#cbd3ff}.hero h2{font-family:Georgia,serif;font-weight:500;font-size:28px;margin:10px 0 8px;letter-spacing:-.02em}.hero p:not(.kicker){margin:0;color:#dde1f4;font-size:13px;max-width:650px}.hero-meta{display:flex;gap:15px;position:relative;z-index:1}.hero-meta span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#e6e8f7;border-left:1px solid #6874ab;padding-left:15px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}.metric{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 18px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.metric-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:flex;align-items:center;gap:7px}.metric>strong{display:block;font-family:Georgia,serif;font-size:25px;font-weight:500;margin:8px 0 2px}.metric>small{font-size:10px;color:#697184}.dashboard-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.panel{background:#fff;border:1px solid var(--line);border-radius:11px;padding:21px;min-width:0;box-shadow:0 2px 8px rgba(21,40,33,.025)}.span-2{grid-column:span 2}.panel-head{display:flex;align-items:start;justify-content:space-between;gap:15px;margin-bottom:18px}.panel-head h3{font-size:14px;margin:4px 0 0}.panel-head>a{font-size:11px;color:var(--accent);font-weight:700}.audit-progress{display:grid;grid-template-columns:105px 1fr;gap:11px 20px;align-items:end}.progress-number strong{font-family:Georgia,serif;font-size:30px;font-weight:500;display:block}.progress-number span{font-size:10px;color:var(--muted)}.progress{height:9px;background:#eceff7;border-radius:9px;overflow:hidden}.progress span{display:block;height:100%;background:linear-gradient(90deg,#0000a5,var(--accent-light));border-radius:9px}.progress-meta{grid-column:2;display:flex;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#5d6475}.due-list{display:grid}.due-list a{display:grid;grid-template-columns:60px 1fr;text-decoration:none;border-top:1px solid #e8ebf3;padding:10px 0;align-items:center}.due-list a:first-child{border:0;padding-top:0}.due-list time{font-size:10px;color:var(--accent);font-weight:750}.due-list strong,.due-list small{display:block}.due-list strong{font-size:11px}.due-list small{font-size:9px;color:var(--muted);margin-top:3px}.resource-bars{display:grid;gap:11px}.resource-bars a{display:grid;grid-template-columns:105px 1fr 20px;gap:9px;align-items:center;text-decoration:none;font-size:10px}.resource-bars i{height:5px;background:#e8ebf3;border-radius:5px;overflow:hidden}.resource-bars b{display:block;height:100%;background:#6676dd;border-radius:5px}.resource-bars strong{text-align:right}.catalog{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.catalog a{display:flex;justify-content:space-between;text-decoration:none;padding:9px 11px;background:#f2f4fa;border-radius:6px;font-size:10px}.catalog a:hover{background:var(--accent-soft)}.page-intro{display:flex;justify-content:space-between;align-items:end;margin-bottom:25px}.page-intro h2,.detail-head h2{font-family:Georgia,serif;font-size:31px;font-weight:500;margin:7px 0}.page-intro p:not(.kicker){color:var(--muted);max-width:700px;font-size:13px;margin:0}.button{border:1px solid #d0d5e3;background:#fff;border-radius:7px;padding:9px 13px;cursor:pointer;font-size:12px;font-weight:650}.button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.button.danger{color:var(--red)}.list-tools{display:flex;align-items:center;gap:10px;margin-bottom:12px}.list-tools label{flex:1}.list-tools input,.list-tools select{width:100%;border:1px solid var(--line);border-radius:7px;background:#fff;padding:10px 12px;font-size:12px}.list-tools select{width:auto}.list-tools>span{color:var(--muted);font-size:10px}.record-table-wrap{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:auto}.record-table{width:100%;border-collapse:collapse;font-size:11px}.record-table th{background:#f2f4fa;text-align:left;text-transform:uppercase;letter-spacing:.08em;color:#75817b;font-size:9px;padding:11px 14px;border-bottom:1px solid var(--line)}.record-table td{padding:13px 14px;border-bottom:1px solid #e8ebf3;vertical-align:top}.record-table tr:last-child td{border-bottom:0}.record-table code{font-size:9px;color:#5d6475}.record-title{display:block;color:var(--ink);font-weight:700;text-decoration:none}.record-table td>small{display:block;color:#6a7181;margin-top:3px}.record-table td[data-label="Description"]{min-width:260px;max-width:520px;color:var(--muted);line-height:1.45}.badge,.tag,.type-pill{display:inline-block;border-radius:99px;background:#eceff7;padding:3px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.tag{text-transform:none;margin:1px}.badge.status-active,.badge.status-approved,.badge.status-complete,.badge.status-passed,.badge.status-accepted{background:#ddefe5;color:#176143}.badge.status-open,.badge.status-high,.badge.status-critical,.badge.status-failed{background:#f5ded9;color:#8d352c}.badge.status-draft,.badge.status-planned,.badge.status-in-progress,.badge.status-medium{background:#f7e9cf;color:#855717}.breadcrumbs{display:flex;gap:8px;color:var(--muted);font-size:11px;margin-bottom:20px}.detail-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:22px}.detail-head h2{margin-bottom:4px}.detail-head>div>code{font-size:10px;color:var(--muted)}.actions{display:flex;gap:7px}.detail-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(270px,1fr);gap:14px}.detail-grid aside{display:grid;gap:14px;align-content:start}.detail-main{padding:29px}.content-label{color:#75817b;text-transform:uppercase;letter-spacing:.08em;font-size:9px;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:23px}.markdown{max-width:790px}.markdown h1{font-family:Georgia,serif;font-size:29px;font-weight:500}.markdown h2{font-family:Georgia,serif;font-size:23px;font-weight:500;margin-top:1.8em}.markdown h3{font-size:15px;margin-top:1.7em}.markdown p,.markdown li{font-size:13px;line-height:1.65;color:#272c3b}.markdown code{background:#eef0f6;border-radius:3px;padding:1px 4px}.markdown pre{padding:15px;background:#10162b;color:#e8ebff;border-radius:7px;overflow:auto}.markdown blockquote{border-left:3px solid var(--accent-light);padding:4px 15px;color:var(--muted);margin-left:0}.table-wrap{overflow:auto}.markdown table{border-collapse:collapse;width:100%;font-size:11px}.markdown th,.markdown td{border:1px solid var(--line);padding:8px;text-align:left}.metadata{margin:0}.metadata>div{display:grid;grid-template-columns:105px 1fr;gap:10px;border-top:1px solid #e8ebf3;padding:10px 0}.metadata>div:first-child{border-top:0;padding-top:0}.metadata dt{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#5d6475}.metadata dd{margin:0;font-size:11px;min-width:0}.compact-json{white-space:pre-wrap;font-size:9px}.git-panel>code{font-size:9px;word-break:break-all}.git-panel p{font-size:10px;color:var(--muted)}.relation{color:var(--accent);text-decoration:none}.history{display:grid}.history>div{display:grid;grid-template-columns:60px 1fr;gap:8px;padding:8px 0;border-top:1px solid #e8ebf3}.history>div:first-child{border-top:0}.history code{font-size:9px;color:var(--accent)}.history strong,.history small{display:block}.history strong{font-size:10px}.history small{font-size:9px;color:var(--muted);margin-top:2px}.empty{padding:25px;color:#697184;text-align:center;font-size:11px;background:#f4f5fa;border-radius:7px}.changes{padding-left:18px}.changes li{margin:8px 0}.diagnostics>div{display:grid;grid-template-columns:58px minmax(120px,180px) minmax(0,1fr);gap:10px;align-items:start;border-top:1px solid var(--line);padding:10px 0}.diagnostics p{margin:0;font-size:11px;overflow-wrap:anywhere}.diagnostics code{font-size:9px;overflow-wrap:anywhere}.editor,.search-results{width:min(760px,calc(100vw - 30px));border:0;border-radius:12px;padding:0;box-shadow:0 25px 80px rgba(0,0,24,.28)}dialog::backdrop{background:rgba(0,0,24,.55)}.editor form,.search-results{padding:23px}.dialog-head{display:flex;justify-content:space-between;align-items:start}.dialog-head h2{font-family:Georgia,serif;font-weight:500;margin:5px 0 0}.icon-button{border:0;background:#eceff7;width:32px;height:32px;border-radius:50%;font-size:22px;cursor:pointer}.editor form>p{font-size:11px;color:var(--muted)}.editor textarea{width:100%;height:440px;border:1px solid var(--line);border-radius:7px;background:#10162b;color:#e8ebff;padding:15px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}.dialog-actions{display:flex;justify-content:end;gap:8px;margin-top:14px}.dialog-error{color:var(--red);font-size:11px;min-height:18px;margin-top:7px}.result-list{display:grid;margin-top:17px;max-height:60vh;overflow:auto}.result-list a{display:block;text-decoration:none;padding:11px;border-top:1px solid var(--line)}.result-list strong,.result-list small{display:block}.result-list small{color:var(--muted);margin-top:3px}.muted{color:#737a8b}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.topbar-status{display:flex;align-items:center;gap:8px}.repo-chip,.validation-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);font-size:11px;white-space:nowrap;text-decoration:none}.repo-chip:hover,.validation-chip:hover{color:var(--ink);border-color:var(--accent-light)}
.icon-button{position:relative;display:grid;place-items:center;padding:0;color:var(--ink);font-size:0}.icon-button:before,.icon-button:after{content:"";position:absolute;width:13px;height:2px;border-radius:2px;background:currentColor;transform:rotate(45deg)}.icon-button:after{transform:rotate(-45deg)}
html,body{height:100%;overflow:hidden}.shell{grid-template-columns:248px minmax(0,1fr);height:100vh;min-height:0}.sidebar{display:flex;flex-direction:column;height:100vh;overflow:hidden;overscroll-behavior:contain}.workspace{height:100vh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.brand{flex:0 0 auto;margin-bottom:18px}.sidebar-nav{--nav-control-width:14px;flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding-right:1px}.nav-home{margin-bottom:10px}.nav-stage>.nav-heading{display:grid;grid-template-columns:24px minmax(0,1fr) var(--nav-control-width);gap:6px;align-items:center;padding:7px 6px;border-radius:7px;color:#d5d9ed;text-align:left;text-transform:none;letter-spacing:0}.nav-stage>.nav-heading:hover{background:rgba(255,255,255,.08);color:#fff}.nav-stage-number{display:grid;place-items:center;width:22px;height:22px;border:1px solid rgba(255,255,255,.26);border-radius:50%;font-size:8px}.nav-stage-copy,.nav-stage-copy strong,.nav-stage-copy small{display:block;min-width:0}.nav-stage-copy strong{font-size:10px;line-height:1.25}.nav-stage-copy small{margin-top:2px;color:#aeb6d8;font-size:8px;line-height:1.25;font-weight:500}.nav-stage>.nav-items{margin:2px 0 8px 17px;padding:1px 0 5px 12px;border-left:1px solid rgba(255,255,255,.14)}.nav-subgroup>.nav-subheading,.nav-subgroup>.nav-items a{width:100%;display:grid;grid-template-columns:minmax(0,1fr) var(--nav-control-width);gap:6px;align-items:center;padding-right:6px}.nav-subgroup>.nav-subheading{border:0;background:none;padding-top:7px;padding-bottom:4px;padding-left:7px;color:#919bc4;text-align:left;text-transform:uppercase;letter-spacing:.09em;font-size:8px;font-weight:780;cursor:pointer}.nav-control,.nav-control-slot{justify-self:end;width:var(--nav-control-width);text-align:right}.nav-subgroup>.nav-items{padding:1px 0 4px 3px}.nav-subgroup>.nav-items a{padding-top:6px;padding-bottom:6px;padding-left:8px;font-size:11px}.nav-group.open>.nav-heading>.chevron:before,.nav-group.open>.nav-subheading>.chevron:before{transform:rotate(45deg)}.nav-stage.open>.nav-items>.nav-subgroup:not(.open)>.nav-items{display:none}.sidebar-footer{flex:0 0 auto;margin:10px -18px -18px;padding:10px 18px 14px;background:#000024;border-top:1px solid rgba(255,255,255,.14)}.organization-nav{display:grid;grid-template-columns:32px minmax(0,1fr) 12px;gap:9px;align-items:center;padding:8px;border-radius:8px;color:#eef1ff;text-decoration:none}.organization-nav:hover,.organization-nav.current{background:rgba(255,255,255,.11)}.organization-mark{display:grid;place-items:center;width:32px;height:32px;border:1px solid rgba(255,255,255,.25);border-radius:50%;background:rgba(255,255,255,.08);font-size:11px;font-weight:800}.organization-nav strong,.organization-nav small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.organization-nav strong{font-size:10px}.organization-nav small{margin-top:2px;color:#aeb6d8;font-size:8px}.organization-arrow{color:#aeb6d8;font-size:16px}.organization-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.organization-links{display:grid}.organization-links a{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line);text-decoration:none}.organization-links a:first-child{padding-top:0;border-top:0}.organization-links strong,.organization-links small{display:block}.organization-links strong{font-size:11px}.organization-links small{margin-top:3px;color:var(--muted);font-size:9px;line-height:1.4}.organization-links b{color:var(--accent);font-size:11px}.organization-links a:hover strong{color:var(--accent)}
.nav-stage>.nav-items>a.nav-direct{display:grid;grid-template-columns:minmax(0,1fr) var(--nav-control-width);gap:6px;align-items:center;width:100%;padding:6px 6px 6px 7px;font-size:11px}
.button{text-decoration:none}
.home-page{padding-top:16px;padding-bottom:16px}.overview-hero{min-height:72px;padding:10px 20px;align-items:center}.overview-hero h2{font-size:22px;margin:3px 0 2px}.overview-hero p:not(.kicker){font-size:10px}.home-page .readiness-map{padding:12px 15px}.home-page .readiness-map-head{margin-bottom:8px}.home-page .readiness-flow a{padding:7px}
.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.overview-grid>.audit-panel{grid-column:1/-1}
.overview-grid>.panel{padding:15px}.overview-grid .panel-head{margin-bottom:10px}.overview-grid .audit-progress{gap:7px 20px}.overview-grid .progress-number strong{font-size:26px}.overview-grid .audit-engagement{padding:8px 11px}
.nav-close,.nav-scrim{display:none}.pagination{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px}.pagination[hidden]{display:none}.page-status{color:var(--muted);font-size:10px;min-width:150px;text-align:center}.button:disabled{cursor:not-allowed;opacity:.45}.search-pagination{padding-top:2px}
.list-tools{flex-wrap:wrap}.list-tools label{min-width:220px}
.setup-banner{margin:14px 0;background:#eef1ff;border:1px solid #ccd4ff;border-radius:11px;padding:19px 22px;display:grid;grid-template-columns:1fr 1.3fr;gap:25px;align-items:center}.setup-banner h3{margin:5px 0 6px;font-size:15px}.setup-banner p:not(.kicker){margin:0;color:var(--muted);font-size:11px;line-height:1.5}.setup-banner ol{margin:0;padding-left:22px;display:grid;gap:7px}.setup-banner li{font-size:11px}.setup-banner a{color:var(--accent);font-weight:700}.due-list time.overdue{color:var(--red)}.content-label{display:flex;align-items:center;justify-content:space-between;gap:12px}.text-button{border:0;background:none;color:var(--accent);font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:750;cursor:pointer;white-space:nowrap}.tag{white-space:normal;overflow-wrap:anywhere;max-width:100%}.editor{max-height:calc(100vh - 30px);overflow:auto}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:20px 0}.form-field>.field-label,.content-editor-field>span{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#3e4557;font-size:10px;font-weight:700;margin-bottom:6px}.required-mark{font-size:8px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em}.form-field input,.form-field select,.editor .form-field textarea{width:100%;height:auto;min-height:40px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink);padding:9px 10px;font:12px/1.4 inherit}.editor .form-field textarea{height:82px}.form-field input[readonly]{background:#eef0f6;color:#5d6475}.form-field>small{display:block;color:#6a7181;font-size:9px;margin-top:5px}.checkbox-list{display:grid;gap:5px;max-height:145px;overflow:auto;border:1px solid var(--line);border-radius:7px;padding:7px}.checkbox-list label{display:flex;align-items:center;gap:8px;padding:5px;border-radius:5px}.checkbox-list input{width:16px;min-height:16px;padding:0;flex:0 0 auto}.checkbox-list label:hover{background:#f2f4fa}.checkbox-list span,.checkbox-list small{display:block;font-size:10px}.checkbox-list small{color:var(--muted);margin-top:2px}.missing-options{padding:11px;border:1px dashed #d7c8a9;background:#fbf5e9;color:#795b23;border-radius:7px;font-size:10px}.content-editor-field{display:block;margin:17px 0}.editor .content-editor-field textarea,.editor .markdown-source{height:260px;background:#10162b;color:#e8ebff;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.advanced-editor{border-top:1px solid var(--line);margin-top:18px;padding-top:13px}.advanced-editor summary{cursor:pointer;color:var(--accent);font-size:11px;font-weight:750}.advanced-editor p{font-size:10px;color:var(--muted)}.editor .advanced-editor>textarea{height:320px}.alert-dialog{width:min(520px,calc(100vw - 30px));border:0;border-radius:12px;padding:23px;box-shadow:0 25px 80px rgba(0,0,24,.28)}.alert-dialog>p{font-size:12px;line-height:1.55;color:var(--muted)}.metadata dd{overflow-wrap:anywhere}
.record-content-action{display:flex;justify-content:flex-start;margin-top:20px}.record-content-details{border-top:1px solid var(--line);margin-top:18px;padding-top:13px}.record-content-details summary{cursor:pointer;color:var(--accent);font-size:11px;font-weight:750}.record-content-details>p{color:var(--muted);font-size:10px}.record-content-editor>span small{color:var(--muted);font-size:9px;font-weight:500}
.program-setup{grid-template-columns:minmax(250px,.75fr) minmax(440px,1.4fr)}.setup-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.setup-steps a{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px;align-items:start;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);text-decoration:none}.setup-steps a:hover{border-color:var(--accent-light)}.setup-steps a>span:first-child{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:10px}.setup-steps a.done>span:first-child{background:#dcefe4;color:#125733}.setup-steps strong,.setup-steps small{display:block}.setup-steps strong{font-size:10px}.setup-steps small{margin-top:3px;color:var(--muted);font-size:8px;line-height:1.4;font-weight:500}
.readiness-map{margin:14px 0;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:20px 22px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.readiness-map-head{display:grid;grid-template-columns:minmax(220px,.65fr) minmax(320px,1fr);gap:28px;align-items:end;margin-bottom:17px}.readiness-map-head h3{font-size:15px;margin:5px 0 0}.readiness-map-head>p{max-width:710px;color:var(--muted);font-size:11px;line-height:1.5;margin:0}.readiness-flow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}.readiness-flow a{display:grid;grid-template-columns:23px minmax(0,1fr);column-gap:8px;align-content:start;min-width:0;padding:11px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft);text-decoration:none}.readiness-flow a:hover{border-color:var(--accent-light);background:var(--accent-soft)}.readiness-flow a>span{grid-row:1/4;display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:var(--primary-gradient);color:#fff;font-size:8px;font-weight:800}.readiness-flow strong{font-size:10px;line-height:1.25}.readiness-flow small{grid-column:2;color:var(--muted);font-size:8px;line-height:1.4;margin-top:3px}.readiness-state{grid-column:2;justify-self:start;margin-top:8px;padding:3px 6px;border-radius:99px;background:var(--surface-muted);color:var(--muted);font-size:7px;line-height:1.2}.readiness-state.good{background:#dcefe4;color:#125733}.readiness-state.warn{background:#f6e8c9;color:#79500f}.readiness-state.bad{background:#f7dfdc;color:#873027}.audit-engagement{display:grid;grid-template-columns:minmax(210px,1fr) minmax(260px,1.25fr) auto;gap:20px;align-items:center;padding:14px 15px;border-radius:8px;background:var(--surface-soft)}.audit-engagement strong{font-size:11px}.audit-engagement p,.audit-engagement li{color:var(--muted);font-size:9px;line-height:1.5}.audit-engagement p{margin:5px 0 0}.audit-engagement ul{margin:0;padding-left:18px}.audit-engagement .button{white-space:nowrap;text-decoration:none}.resource-directory{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.resource-directory>section{min-width:0;padding:12px;border-radius:8px;background:var(--surface-soft)}.resource-directory h4{margin:0 0 7px;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.resource-directory a{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid var(--line);font-size:9px;text-decoration:none}.resource-directory a:first-of-type{border-top:0}.resource-directory a:hover span{color:var(--accent)}.resource-directory a strong{color:var(--muted);font-size:8px}.record-prose{max-width:790px}.record-prose section{padding:0 0 20px}.record-prose section+section{padding-top:20px;border-top:1px solid var(--line)}.record-prose h3{margin:0 0 7px;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.record-prose p{margin:0;font-size:14px;line-height:1.65;white-space:pre-wrap}.connections-panel .panel-head>span{display:grid;place-items:center;min-width:22px;height:22px;border-radius:99px;background:var(--surface-muted);color:var(--muted);font-size:8px}.connections{display:grid}.connections a{display:block;padding:9px 0;border-top:1px solid var(--line);text-decoration:none}.connections a:first-child{padding-top:0;border-top:0}.connections strong,.connections small{display:block}.connections strong{font-size:10px}.connections small{margin-top:3px;color:var(--muted);font-size:8px;line-height:1.4}.connections a:hover strong{color:var(--accent)}.connections-more{margin:9px 0 0;color:var(--muted);font-size:8px;line-height:1.4}.external-source{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;color:var(--accent);text-decoration:none}.external-source span,.external-source strong,.external-source small{display:block}.external-source strong{font-size:10px;line-height:1.35}.external-source small{margin-top:3px;color:var(--muted);font-size:8px;line-height:1.35;overflow-wrap:anywhere}.external-source b{font-size:11px}.external-source:hover strong{text-decoration:underline}
.page-guide{display:grid;grid-template-columns:1.05fr 1.25fr 1fr;gap:0;margin:-9px 0 16px;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.page-guide>div{padding:14px 16px;border-left:1px solid var(--line);min-width:0}.page-guide>div:first-child{border-left:0}.page-guide>div>span{display:block;color:var(--accent);text-transform:uppercase;letter-spacing:.09em;font-size:8px;font-weight:780;margin-bottom:6px}.page-guide p{color:var(--muted);font-size:10px;line-height:1.5;margin:0}.guide-links{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.guide-links a{color:var(--accent);background:var(--accent-soft);border-radius:99px;padding:4px 7px;text-decoration:none;font-size:8px;font-weight:700}
.page-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}.onboarding-dialog{width:min(470px,calc(100vw - 30px));max-height:calc(100vh - 32px);margin:0;border:1px solid var(--line);border-radius:13px;padding:0;background:var(--panel);color:var(--ink);box-shadow:0 28px 90px rgba(0,0,24,.38);overflow:auto}.onboarding-dialog::backdrop{background:transparent;backdrop-filter:none}.onboarding-shade{position:fixed;inset:0;z-index:60;pointer-events:none}.onboarding-shade span{position:absolute;background:rgba(0,0,24,.58)}.onboarding-progress{display:grid;grid-template-columns:repeat(var(--onboarding-step-count),1fr);gap:5px;padding:18px 24px 0}.onboarding-progress span{height:3px;border-radius:3px;background:var(--surface-muted)}.onboarding-progress span.active{background:var(--accent-light)}.onboarding-head{padding:22px 25px 0}.onboarding-head h2{font-family:Georgia,serif;font-size:25px;font-weight:500;letter-spacing:-.015em;margin:8px 0 0}.onboarding-body{color:var(--muted);font-size:12px;line-height:1.6;margin:13px 25px 0}.onboarding-body+.onboarding-body{margin-top:8px}.onboarding-points{display:grid;gap:9px;margin:18px 25px 4px;padding-left:19px}.onboarding-points li{font-size:11px;line-height:1.5;padding-left:3px}.onboarding-sections{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 25px 4px}.onboarding-sections section{padding:13px;border:1px solid var(--line);border-radius:8px;background:var(--surface-soft)}.onboarding-sections strong{font-size:11px}.onboarding-sections p{margin:6px 0 0;color:var(--muted);font-size:10px;line-height:1.5}.onboarding-actions{padding:12px 25px 23px}.onboarding-skip{margin-right:auto;color:var(--muted);text-transform:none;letter-spacing:0;font-size:11px}.onboarding-form{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin:18px 25px 0}.onboarding-form label{display:block;min-width:0}.onboarding-form label.wide{grid-column:1/-1}.onboarding-form label>span{display:block;color:var(--ink);font-size:10px;font-weight:720;margin-bottom:6px}.onboarding-form input,.onboarding-form select,.onboarding-form textarea{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:12px}.onboarding-form textarea{min-height:78px;resize:vertical}.onboarding-form small{display:block;color:var(--muted);font-size:9px;line-height:1.45;margin-top:5px}.onboarding-write-note{color:var(--muted);font-size:9px;line-height:1.5;margin:12px 25px 0}.onboarding-dialog>.dialog-error{margin:8px 25px 0}.onboarding-focus{outline:4px solid var(--accent-light)!important;outline-offset:5px;scroll-margin-top:102px}
.detail-head{margin-bottom:25px}.detail-head>div:first-child{min-width:0}.detail-head h2{margin:7px 0}.detail-head .header-breadcrumbs{margin:0;font-size:9px;line-height:normal;min-height:11px;align-items:center}.header-breadcrumbs span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}
@media(max-width:1200px){.readiness-flow{grid-template-columns:repeat(3,minmax(0,1fr))}.audit-engagement{grid-template-columns:1fr 1fr}.audit-engagement .button{grid-column:1/-1;justify-self:start}}
@media(max-width:1100px){.search{display:none}.topbar-status{margin-left:auto}.metrics{grid-template-columns:repeat(2,1fr)}.dashboard-grid,.organization-grid{grid-template-columns:repeat(2,1fr)}.catalog{grid-template-columns:repeat(3,1fr)}.span-2{grid-column:span 2}.resource-directory{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.shell{display:block}.sidebar{transform:translateX(-100%);transition:.2s;box-shadow:8px 0 30px rgba(0,0,0,.2)}.sidebar.shown{transform:translateX(0)}.workspace{min-width:0}.mobile-nav{display:block;border:0;background:none;font-size:20px}.topbar{height:72px;padding:0 16px}.topbar>div:first-of-type{min-width:0}.topbar-status{display:none}.search{display:flex;max-width:none}.search kbd,.topbar .eyebrow{display:none}.page{padding:20px 15px 60px}.hero{display:block;padding:23px}.hero-meta{margin-top:22px;flex-wrap:wrap}.metrics,.dashboard-grid,.organization-grid{grid-template-columns:1fr}.span-2{grid-column:auto}.catalog{grid-template-columns:repeat(2,1fr)}.detail-grid{grid-template-columns:1fr}.page-intro,.detail-head{display:block}.page-intro>.button,.actions{margin-top:15px}.record-table{min-width:720px}.readiness-map{padding:17px}.readiness-map-head{grid-template-columns:1fr;gap:8px}.readiness-flow{grid-template-columns:repeat(2,minmax(0,1fr))}.audit-engagement{grid-template-columns:1fr}.audit-engagement .button{grid-column:auto}.resource-directory{grid-template-columns:1fr}}
@media(max-width:760px){.setup-banner,.page-guide{grid-template-columns:1fr}.page-guide{margin-top:-5px}.page-guide>div{border-left:0;border-top:1px solid var(--line)}.page-guide>div:first-child{border-top:0}.form-grid{grid-template-columns:1fr}.record-table{min-width:0}.record-table thead{display:none}.record-table,.record-table tbody,.record-table tr{display:block}.record-table tr{padding:8px 12px;border-bottom:1px solid var(--line)}.record-table tr:last-child{border-bottom:0}.record-table td:not([data-label]){display:block}.record-table td[data-label]{display:grid;grid-template-columns:105px minmax(0,1fr);gap:10px;border:0;padding:7px 0;align-items:start}.record-table td[data-label]::before{content:attr(data-label);color:#75817b;text-transform:uppercase;letter-spacing:.07em;font-size:8px;font-weight:700}.record-table td[data-primary-field]{display:block;padding:8px 0 10px}.record-table td[data-primary-field]::before{display:none}.content-label{align-items:flex-start}.editor form{padding:18px}.diagnostics>div{grid-template-columns:58px minmax(0,1fr)}.diagnostics p{grid-column:1/-1}.changes code{overflow-wrap:anywhere}.onboarding-dialog{max-height:56vh}.onboarding-actions{position:sticky;bottom:0;background:var(--panel);border-top:1px solid var(--line)}}
@media(max-width:520px){.onboarding-form,.onboarding-sections,.setup-steps{grid-template-columns:1fr}.onboarding-form label.wide{grid-column:auto}.onboarding-actions{flex-wrap:wrap}.onboarding-skip{width:100%;order:3;margin:3px 0 0}.readiness-flow{grid-template-columns:1fr}.obligation-card-foot{align-items:flex-start;flex-direction:column}.obligation-action{align-self:flex-start}}
@media(min-width:761px){.detail-grid{grid-template-columns:minmax(270px,1fr) minmax(0,2fr)}.detail-grid aside{grid-column:1;grid-row:1}.detail-main{grid-column:2;grid-row:1}}
@media(max-width:760px){.sidebar{visibility:hidden;transition:transform .2s,visibility 0s .2s}.sidebar.shown{visibility:visible;transition-delay:0s}.nav-close{display:grid;place-items:center;position:absolute;top:25px;right:18px;width:34px;height:34px;border:1px solid #5966a4;border-radius:50%;background:#11174a;color:#eef1ff;font-size:20px;cursor:pointer}.nav-scrim{display:block;position:fixed;inset:0;border:0;background:rgba(0,0,24,.38);opacity:0;pointer-events:none;transition:opacity .2s;z-index:15}.sidebar.shown+.nav-scrim{opacity:1;pointer-events:auto}.pagination{justify-content:space-between;gap:8px}.page-status{min-width:0}}

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
.commit-dialog form>p{color:var(--muted);font-size:11px;line-height:1.55}
.commit-dialog label>span{display:block;font-size:10px;font-weight:720;margin-bottom:6px}
.commit-dialog input{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:12px}
.commit-files{display:grid;gap:5px;max-height:160px;overflow:auto;margin-top:14px;padding:10px;background:var(--surface-soft);border-radius:7px}
.commit-files code{font-size:9px;overflow-wrap:anywhere}
.onboarding-progress{grid-template-columns:repeat(var(--onboarding-step-count),1fr)}
.onboarding-git-status{display:flex;align-items:flex-start;gap:9px;margin:14px 25px 0;padding:10px 12px;border:1px solid var(--line);border-radius:7px;background:var(--surface-soft)}.onboarding-git-status .status-dot{margin-top:4px}.onboarding-git-status strong,.onboarding-git-status small{display:block}.onboarding-git-status strong{font-size:10px}.onboarding-git-status small{color:var(--muted);font-size:9px;line-height:1.45;margin-top:3px}.onboarding-git-status code{font-size:9px}
.badge.status-overdue{background:#f7dfdc;color:#873027}.badge.status-due{background:#f6e8c9;color:#79500f}.badge.status-upcoming{background:var(--accent-soft);color:var(--accent)}.badge.status-complete{background:#dcefe4;color:#125733}
.obligation-preview,.event-reminder-preview{display:grid;gap:8px}.obligation-preview a{display:flex;align-items:flex-start;gap:9px;text-decoration:none;padding:7px 0;border-top:1px solid var(--line)}.obligation-preview a:first-child{border-top:0;padding-top:0}.obligation-preview strong,.obligation-preview small,.event-reminder-preview strong,.event-reminder-preview small{display:block}.obligation-preview strong,.event-reminder-preview strong{font-size:10px}.obligation-preview small,.event-reminder-preview small{font-size:9px;color:var(--muted);margin-top:2px}.event-reminder-preview{grid-template-columns:repeat(2,minmax(0,1fr))}.event-reminder-preview a{padding:10px;border-radius:7px;background:var(--surface-soft);text-decoration:none}
.obligation-board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}.obligation-column{min-width:0}.obligation-column-head{display:flex;align-items:center;justify-content:space-between;margin:5px 1px 10px}.obligation-column-head>strong{font:500 22px Georgia,serif}.obligation-cards{display:grid;gap:9px}.obligation-card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent-light);border-radius:9px;padding:14px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.obligation-card.status-overdue{border-left-color:var(--red)}.obligation-card.status-due{border-left-color:#d89021}.obligation-card-head{display:flex;justify-content:space-between;gap:8px;text-transform:uppercase;letter-spacing:.06em;font-size:8px;color:var(--muted)}.obligation-card-head strong{color:var(--ink);text-align:right}.obligation-card h3{font-size:12px;margin:9px 0 7px}.obligation-card h3 a{text-decoration:none}.obligation-card p{font-size:9px;line-height:1.5;color:var(--muted);margin:0}.obligation-links{margin-top:10px}.workflow-section{margin-top:30px}.section-head{display:flex;justify-content:space-between;margin-bottom:13px}.section-head h2{font:500 24px Georgia,serif;margin:6px 0}.section-head p:not(.kicker){font-size:11px;color:var(--muted);margin:0;max-width:720px}.event-trigger-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.event-trigger-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;min-width:0}.event-trigger-card h3{font-size:13px;margin:6px 0}.event-trigger-card p:not(.kicker){font-size:10px;color:var(--muted);line-height:1.5;margin:0}.event-trigger-card ol{padding-left:20px;margin:15px 0;display:grid;gap:8px}.event-trigger-card li span,.event-trigger-card li small{display:block}.event-trigger-card li span{font-size:10px}.event-trigger-card li small{font-size:8px;color:var(--muted);margin-top:2px}.event-trigger-card>.button{margin-top:auto;align-self:flex-start}.event-run-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.event-run{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;min-width:0}.event-run-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.event-run-head h3{font-size:13px;margin:7px 0 3px}.event-run-head h3 a{text-decoration:none}.event-run-head small{font-size:9px;color:var(--muted)}.event-run-head>strong{font:500 22px Georgia,serif}.event-run>.progress{margin:13px 0}.event-actions{display:grid}.event-actions a{display:flex;gap:9px;text-decoration:none;padding:9px 0;border-top:1px solid var(--line);align-items:flex-start}.event-actions strong,.event-actions small{display:block}.event-actions strong{font-size:10px}.event-actions small{font-size:8px;color:var(--muted);margin-top:2px}
.obligation-card-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:9px;margin-top:10px}.obligation-card-foot .obligation-links{margin-top:0;min-width:0}.obligation-action{flex:0 0 auto;border:0;border-radius:6px;background:var(--accent-soft);color:var(--accent);padding:7px 9px;font-family:inherit;font-size:9px;font-weight:700;line-height:1;text-decoration:none;cursor:pointer}.obligation-action:hover{filter:brightness(1.08)}.obligation-action.blocked{background:var(--surface-muted);color:var(--muted)}.obligation-more{width:100%;margin-top:9px}.workflow-section{scroll-margin-top:92px}
.event-dialog label{display:block;margin-top:13px}.event-dialog label>span{display:block;font-size:10px;font-weight:720;margin-bottom:6px}.event-dialog input,.event-dialog select{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:12px}.event-dialog-steps{display:grid;gap:6px;margin-top:15px;padding:10px;background:var(--surface-soft);border-radius:7px}.event-dialog-steps strong,.event-dialog-steps small{display:block}.event-dialog-steps strong{font-size:10px}.event-dialog-steps small{font-size:8px;color:var(--muted);margin-top:2px}
.packet-builder form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:12px;align-items:end}.packet-builder label>span{display:block;font-size:9px;font-weight:720;margin-bottom:6px}.packet-builder input,.packet-builder select{width:100%;min-height:40px;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink);padding:9px 10px;font-size:11px}.packet-note,.packet-output>p{font-size:10px;color:var(--muted);margin:12px 0 0}.packet-output{margin:14px 0}.packet-output h3{overflow-wrap:anywhere}.packet-gaps{display:grid}.packet-gaps>div{display:grid;grid-template-columns:58px 1fr;gap:10px;border-top:1px solid var(--line);padding:10px 0}.packet-gaps>div:first-child{border-top:0}.packet-gaps p{font-size:10px;margin:0}.packet-list{display:grid}.packet-list a{display:block;text-decoration:none;border-top:1px solid var(--line);padding:9px 0}.packet-list a:first-child{border-top:0}.packet-list strong,.packet-list small{display:block}.packet-list strong{font-size:10px}.packet-list small{font-size:8px;color:var(--muted);margin-top:2px}
.packet-preflight{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}.packet-preflight a{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);text-decoration:none}.packet-preflight .status-dot{margin-top:4px}.packet-preflight small,.packet-preflight strong{display:block}.packet-preflight small{color:var(--muted);font-size:8px;text-transform:uppercase;letter-spacing:.07em}.packet-preflight strong{margin-top:3px;font-size:10px}
@media(max-width:900px){.obligation-board,.event-trigger-grid{grid-template-columns:1fr}.event-run-list{grid-template-columns:1fr}.packet-builder form,.packet-preflight{grid-template-columns:1fr 1fr}.packet-builder .button{align-self:end}}
@media(max-width:900px){.overview-grid{grid-template-columns:1fr}.overview-grid>.audit-panel{grid-column:auto}}
@media(max-width:520px){.event-reminder-preview,.packet-builder form,.packet-preflight{grid-template-columns:1fr}.packet-metrics{grid-template-columns:1fr}.obligation-card-head{display:block}.obligation-card-head strong{display:block;text-align:left;margin-top:3px}}

@media(prefers-color-scheme:dark){
  :root{--ink:#f4f5ff;--muted:#b8bfd3;--line:#343d5c;--paper:#000;--panel:#141a2e;--accent:#aab7ff;--accent-soft:#252e52;--accent-light:#9aabff;--focus:#bdc7ff;--amber:#ffd08a;--red:#ffaaa0;--surface-soft:#1b2238;--surface-muted:#252d48;--field:#11172a;--field-readonly:#1c2338;--shadow:0 12px 34px rgba(0,0,0,.3)}
  .topbar{background:rgba(0,0,0,.9)}
  .badge.good{background:#173b2b;color:#a8edc4}
  .badge.warn{background:#483714;color:#ffd991}
  .badge.bad{background:#4a252a;color:#ffb5ad}
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
