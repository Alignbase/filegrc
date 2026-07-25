export function renderIndex(state = null) {
  const snapshot = state
    ? `<script id="soc2-data" type="application/json">${safeJson(state)}</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>SOC 2 workspace</title>
  <link rel="stylesheet" href="./soc2.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div id="app"><div class="loading">Loading workspace…</div></div>
  ${snapshot}
  <script src="./soc2-app.js" defer></script>
</body>
</html>`;
}

export const APP_SCRIPT = String.raw`
const root = document.querySelector("#app");
let state;
let activeGroup = null;

start().catch((error) => {
  root.innerHTML = '<main class="fatal"><h1>Could not load the workspace</h1><pre></pre></main>';
  root.querySelector("pre").textContent = error.stack || error.message;
});

async function start() {
  const embedded = document.querySelector("#soc2-data");
  state = embedded ? JSON.parse(embedded.textContent) : await fetchJson("/api/state");
  window.addEventListener("hashchange", render);
  render();
}

function render() {
  const route = parseRoute();
  const nav = buildNavigation(route);
  root.innerHTML = '<div class="shell">' + nav + '<div class="workspace"><header class="topbar">' + topbar(route) + '</header><main id="main"></main></div></div>';
  const main = root.querySelector("main");
  if (route.name === "home") renderHome(main);
  else if (route.name === "list") renderList(main, route.type, route.params);
  else if (route.name === "detail") renderDetail(main, route.type, route.id);
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
  if (parts[0] === "resources" && parts[1]) return { name: "list", type: parts[1], params: new URLSearchParams(query) };
  if (parts[0] === "resource" && parts[1] && parts[2]) return { name: "detail", type: parts[1], id: parts[2] };
  if (parts[0] === "repository") return { name: "repository" };
  return { name: "missing" };
}

function buildNavigation(route) {
  const grouped = new Map(state.model.groups.filter((group) => group.id !== "repository").map((group) => [group.id, []]));
  const currentGroup = state.model.resources[route.type]?.group;
  Object.entries(state.model.resources).forEach(([type, definition]) => {
    if (type !== "workspace" && grouped.has(definition.group)) grouped.get(definition.group).push([type, definition]);
  });
  const navGroups = [...grouped.entries()].map(([group, resources]) => {
    const definition = state.model.groups.find((item) => item.id === group);
    const open = currentGroup === group || (activeGroup === null ? ["program", "governance", "risk", "audits"].includes(group) : activeGroup === group);
    return '<section class="nav-group ' + (open ? "open" : "") + '" data-group="' + esc(group) + '"><button class="nav-heading" type="button" aria-expanded="' + open + '" aria-controls="nav-group-' + esc(group) + '"><span>' + esc(definition.title) + '</span><span class="chevron">›</span></button><div class="nav-items" id="nav-group-' + esc(group) + '">' + resources.map(([type, item]) => {
      const count = resourcesOfType(type).length;
      const current = (route.type === type);
      return '<a class="' + (current ? "current" : "") + '" href="#/resources/' + encodeURIComponent(type) + '"><span>' + esc(item.pluralTitle) + '</span><small>' + count + '</small></a>';
    }).join("") + '</div></section>';
  }).join("");
  return '<aside class="sidebar"><a href="#/" class="brand"><span class="mark">S2</span><span><strong>SOC 2</strong><small>GRC workspace</small></span></a><nav><a class="nav-home ' + (route.name === "home" ? "current" : "") + '" href="#/"><span>Overview</span></a>' + navGroups + '<a class="nav-home ' + (route.name === "repository" ? "current" : "") + '" href="#/repository"><span>Repository</span></a></nav><div class="side-foot"><span class="status-dot ' + (state.validation.ok ? "good" : "bad") + '"></span><span>' + (state.validation.ok ? "Data valid" : state.validation.counts.errors + " validation errors") + '</span></div></aside>';
}

function topbar(route) {
  const title = route.name === "home" ? "Program overview" : route.name === "repository" ? "Repository" : state.model.resources[route.type]?.pluralTitle || "SOC 2";
  return '<button class="mobile-nav" type="button" aria-label="Toggle navigation">☰</button><div><small class="eyebrow">' + esc(state.workspace.organizationName) + '</small><h1>' + esc(title) + '</h1></div><label class="search"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Search records" aria-label="Search records"><kbd>/</kbd></label><div class="repo-chip"><span class="status-dot ' + (state.git.clean ? "good" : "warn") + '"></span>' + esc(state.git.available ? ((state.git.branch || "detached") + " · " + state.git.shortCommit) : "Git unavailable") + '</div>';
}

function renderHome(main) {
  const controls = resourcesOfType("control");
  const evidence = resourcesOfType("evidence");
  const today = currentDate();
  const workTypes = new Set(["finding", "exception", "action-item", "audit-request"]);
  const openWork = state.resources.filter(({ record }) => workTypes.has(record.type) && isOpenWork(record));
  const activeAudit = resourcesOfType("audit").find((item) => !["complete", "closed", "cancelled"].includes(item.record.status));
  const scheduled = state.resources
    .map((entry) => ({ entry, date: dueDate(entry.record) }))
    .filter(({ entry, date }) => date && !isClosedStatus(entry.record.status))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);
  const policyDrafts = resourcesOfType("policy").filter(({ record }) => record.status === "draft");
  const governanceTypes = ["policy", "document", "meeting", "training", "attestation"];
  const riskTypes = ["risk", "vendor-review", "access-review", "vulnerability", "incident"];
  main.innerHTML = '<div class="page home-page"><section class="hero"><div><p class="kicker">Current program state</p><h2>' + esc(state.workspace.title) + '</h2><p>' + esc(state.workspace.description || "Governance, risk, controls, evidence, and audit work maintained as plain files in Git.") + '</p></div><div class="hero-meta"><span>Model v' + esc(state.workspace.dataModelVersion) + '</span><span>' + state.resources.length + ' records</span><span>' + (state.git.available ? (state.git.clean ? "Working tree clean" : state.git.changes.length + " uncommitted changes") : "Git unavailable") + '</span></div></section>' +
    (!state.git.commit ? '<section class="setup-banner"><div><p class="kicker">Start here</p><h3>Finish the initial program setup</h3><p>The starter content is intentionally unapproved. Review it against actual practice, define the first controls, then commit the baseline.</p></div><ol><li><a href="#/resources/policy">Review ' + policyDrafts.length + ' policy drafts</a></li><li>Review the <a href="#/resources/document">starter documents</a> and <a href="#/resources/training">training</a></li><li><a href="#/resources/control">Define controls and owners</a></li><li><a href="#/repository">Validate and commit the baseline</a></li></ol></section>' : "") +
    '<section class="metrics">' +
      metric("Validation", state.validation.ok ? "Passing" : state.validation.counts.errors + " errors", state.validation.ok ? "All records and links check out" : state.validation.counts.warnings + " warnings", state.validation.ok ? "good" : "bad") +
      metric("Controls", controls.length, countStatus(controls, "implemented") + " implemented", "neutral") +
      metric("Evidence", evidence.length, countStatus(evidence, "verified") + " verified", "neutral") +
      metric("Open work", openWork.length, countOverdue(openWork) + " past due", countOverdue(openWork) ? "warn" : "neutral") +
    '</section>' +
    '<div class="dashboard-grid"><section class="panel span-2"><div class="panel-head"><div><p class="kicker">Audit activity</p><h3>' + esc(activeAudit?.record.title || "No active audit") + '</h3></div>' + (activeAudit ? '<a href="#/resource/audit/' + encodeURIComponent(activeAudit.record.id) + '">Open audit</a>' : '<a href="#/resources/audit">View audits</a>') + '</div>' +
      (activeAudit ? auditProgress(activeAudit.record) : empty("Add an audit record to track its scope, period, requests, and evidence.")) + '</section>' +
    '<section class="panel"><div class="panel-head"><div><p class="kicker">Schedule</p><h3>Dates and deadlines</h3></div></div>' +
      (scheduled.length ? '<div class="due-list">' + scheduled.map(({ entry, date }) => '<a href="#/resource/' + encodeURIComponent(entry.record.type) + '/' + encodeURIComponent(entry.record.id) + '"><time class="' + (date < today ? "overdue" : "") + '">' + (date < today ? "Overdue · " : "") + shortDate(date) + '</time><span><strong>' + esc(entry.record.title) + '</strong><small>' + esc(state.model.resources[entry.record.type].title) + '</small></span></a>').join("") + '</div>' : empty("No open work has a scheduled date.")) + '</section>' +
    '<section class="panel"><div class="panel-head"><div><p class="kicker">Governance</p><h3>Program library</h3></div></div>' + resourceBars(governanceTypes) + '</section>' +
    '<section class="panel"><div class="panel-head"><div><p class="kicker">Risk and operations</p><h3>Operating records</h3></div></div>' + resourceBars(riskTypes) + '</section>' +
    '<section class="panel span-2"><div class="panel-head"><div><p class="kicker">Program map</p><h3>All resources</h3></div></div><div class="catalog">' + Object.entries(state.model.resources).filter(([type]) => type !== "workspace").map(([type, definition]) => '<a href="#/resources/' + encodeURIComponent(type) + '"><span>' + esc(definition.pluralTitle) + '</span><strong>' + resourcesOfType(type).length + '</strong></a>').join("") + '</div></section></div></div>';
}

function renderList(main, type, params = new URLSearchParams()) {
  const definition = state.model.resources[type];
  if (!definition) return renderNotFound(main);
  const entries = resourcesOfType(type);
  const fields = [...new Set(["title", ...(definition.listFields || [])])].filter((name) => name !== "title");
  const modelFields = { ...state.model.commonFields, ...definition.fields };
  const filters = Object.entries(modelFields).filter(([, field]) => field.filter).map(([name, field]) => {
    const observed = entries.flatMap(({ record }) => Array.isArray(record[name]) ? record[name] : [record[name]]).filter((value) => ["string", "number", "boolean"].includes(typeof value)).map(String);
    const values = [...new Set(observed)].sort();
    return { name, label: field.label || humanize(name), values };
  }).filter(({ values }) => values.length > 1);
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">' + esc(groupTitle(definition.group)) + '</p><h2>' + esc(definition.pluralTitle) + '</h2><p>' + esc(definition.description) + '</p></div>' + (!state.readOnly && !definition.singleton ? '<button class="button primary" id="new-resource">New ' + esc(definition.title.toLowerCase()) + '</button>' : "") + '</div>' +
    '<div class="list-tools"><label><span class="sr-only">Filter list</span><input id="list-search" type="search" placeholder="Filter ' + esc(definition.pluralTitle.toLowerCase()) + '"></label>' +
    filters.map(({ name, label, values }) => '<select class="field-filter" data-field="' + esc(name) + '" aria-label="Filter by ' + esc(label.toLowerCase()) + '"><option value="">Any ' + esc(label.toLowerCase()) + '</option>' + values.map((value) => '<option value="' + esc(value) + '">' + esc(filterOptionLabel(value)) + '</option>').join("") + '</select>').join("") + '<span id="result-count">' + entries.length + ' records</span></div>' +
    '<section class="record-table-wrap"><table class="record-table"><thead><tr><th>Title</th>' + fields.map((name) => '<th>' + esc(fieldLabel(type, name)) + '</th>').join("") + '<th>Git file</th></tr></thead><tbody id="record-rows"></tbody></table></section></div>';
  const renderRows = () => {
    const query = main.querySelector("#list-search").value.toLowerCase();
    const selections = [...main.querySelectorAll(".field-filter")].filter((select) => select.value).map((select) => [select.dataset.field, select.value]);
    const filtered = entries.filter((entry) => (!query || entrySearchText(entry).includes(query)) && selections.every(([field, expected]) => Array.isArray(entry.record[field]) ? entry.record[field].map(String).includes(expected) : String(entry.record[field] ?? "") === expected));
    main.querySelector("#result-count").textContent = filtered.length + (filtered.length === 1 ? " record" : " records");
    main.querySelector("#record-rows").innerHTML = filtered.length ? filtered.map((entry) => '<tr><td data-label="Title"><a class="record-title" href="#/resource/' + encodeURIComponent(type) + '/' + encodeURIComponent(entry.record.id) + '">' + esc(entry.record.title) + '</a><small>' + esc(entry.record.id) + '</small></td>' + fields.map((name) => '<td data-label="' + esc(fieldLabel(type, name)) + '">' + formatValue(entry.record[name], name) + '</td>').join("") + '<td data-label="Git file"><code>' + esc(entry.relativePath.replace(/^data\//, "")) + '</code></td></tr>').join("") : '<tr><td colspan="' + (fields.length + 2) + '">' + empty("No records match this filter.") + '</td></tr>';
  };
  main.querySelector("#list-search").value = params.get("q") || "";
  main.querySelectorAll(".field-filter").forEach((select) => { select.value = params.get(select.dataset.field) || ""; });
  renderRows();
  const updateFilters = () => {
    const next = new URLSearchParams();
    const query = main.querySelector("#list-search").value.trim();
    if (query) next.set("q", query);
    main.querySelectorAll(".field-filter").forEach((select) => { if (select.value) next.set(select.dataset.field, select.value); });
    history.replaceState(null, "", "#/resources/" + encodeURIComponent(type) + (next.size ? "?" + next : ""));
    renderRows();
  };
  main.querySelector("#list-search").addEventListener("input", updateFilters);
  main.querySelectorAll(".field-filter").forEach((select) => select.addEventListener("change", updateFilters));
  main.querySelector("#new-resource")?.addEventListener("click", () => openEditor(type));
}

function renderDetail(main, type, id) {
  const entry = resourcesOfType(type).find(({ record }) => record.id === id);
  const definition = state.model.resources[type];
  if (!entry || !definition) return renderNotFound(main);
  const fields = { ...state.model.commonFields, ...definition.fields };
  const visible = Object.entries(entry.record).filter(([name]) => !["schemaVersion", "id", "type", "title", "notesPath", "contentPath"].includes(name));
  const content = Object.entries(entry.content);
  main.innerHTML = '<div class="page"><div class="breadcrumbs"><a href="#/resources/' + encodeURIComponent(type) + '">' + esc(definition.pluralTitle) + '</a><span>/</span><span>' + esc(entry.record.title) + '</span></div><div class="detail-head"><div><span class="type-pill">' + esc(definition.title) + '</span><h2>' + esc(entry.record.title) + '</h2><code>' + esc(entry.record.id) + '</code></div><div class="actions">' + (!state.readOnly ? '<button class="button" id="edit-resource">Edit record</button>' + (!definition.singleton ? '<button class="button danger" id="delete-resource">Delete</button>' : "") : "") + '</div></div><div class="detail-grid"><section class="panel detail-main">' +
    (content.length ? content.map(([name, item]) => '<article class="markdown"><div class="content-label"><span>' + esc(fields[name]?.label || humanize(name)) + ' · ' + esc(item.path) + '</span>' + (!state.readOnly ? '<button class="text-button" data-edit-content="' + esc(name) + '">Edit Markdown</button>' : "") + '</div>' + item.html + '</article>').join("") : '<div class="panel-head"><h3>Record</h3></div>' + empty("This record has no long-form Markdown.")) +
    '</section><aside><section class="panel"><div class="panel-head"><h3>Metadata</h3></div><dl class="metadata">' + visible.map(([name, value]) => '<div><dt>' + esc(fields[name]?.label || humanize(name)) + '</dt><dd>' + formatValue(value, name) + '</dd></div>').join("") + '</dl></section><section class="panel git-panel"><div class="panel-head"><h3>Source</h3></div><code>' + esc(entry.relativePath) + '</code><p>' + (state.git.available ? 'Workspace revision <strong>' + esc(state.git.shortCommit) + '</strong>' : "Commit this workspace to add file history.") + '</p></section><section class="panel"><div class="panel-head"><h3>File history</h3></div>' + (entry.history?.length ? '<div class="history">' + entry.history.map((commit) => '<div><code>' + esc(commit.shortCommit) + '</code><span><strong>' + esc(commit.subject) + '</strong><small>' + esc(commit.author) + ' · ' + esc(shortDate(commit.timestamp)) + '</small></span></div>').join("") + '</div>' : empty("No committed history for this file.")) + '</section></aside></div></div>';
  main.querySelector("#edit-resource")?.addEventListener("click", () => openEditor(type, entry));
  main.querySelectorAll("[data-edit-content]").forEach((button) => button.addEventListener("click", () => openContentEditor(entry, button.dataset.editContent)));
  main.querySelector("#delete-resource")?.addEventListener("click", async () => {
    if (!confirm('Delete "' + entry.record.title + '"? Use deletion only for mistakes and uncommitted drafts. Unshared Markdown authored for this record will also be deleted.')) return;
    const response = await fetch("/api/resource/" + encodeURIComponent(type) + "/" + encodeURIComponent(id) + "?revision=" + encodeURIComponent(entry.revision), { method: "DELETE" });
    if (!response.ok) return showError(await responseMessage(response));
    state = await fetchJson("/api/state");
    location.hash = "#/resources/" + encodeURIComponent(type);
  });
}

function renderRepository(main) {
  main.innerHTML = '<div class="page"><div class="page-intro"><div><p class="kicker">Audit trail</p><h2>Repository state</h2><p>Git supplies authors, timestamps, commit messages, revisions, and diffs for every tracked record.</p></div><a class="button" href="#/resource/workspace/workspace">Workspace settings</a></div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Current revision</h3></div><dl class="metadata"><div><dt>Branch</dt><dd>' + esc(state.git.branch || "Unavailable") + '</dd></div><div><dt>Commit</dt><dd><code>' + esc(state.git.commit || "Unavailable") + '</code></dd></div><div><dt>Working tree</dt><dd>' + (state.git.clean === null ? "Unavailable" : state.git.clean ? "Clean" : "Has changes") + '</dd></div><div><dt>Generated</dt><dd>' + esc(formatDateTime(state.generatedAt)) + '</dd></div></dl></section><section class="panel span-2"><div class="panel-head"><h3>Uncommitted changes</h3></div>' + (state.git.changes?.length ? '<ul class="changes">' + state.git.changes.map((change) => '<li><code>' + esc(change) + '</code></li>').join("") + '</ul>' : empty(state.git.available ? "No uncommitted changes." : state.git.message)) + '</section><section class="panel span-2"><div class="panel-head"><h3>Validation</h3><span class="badge ' + (state.validation.ok ? "good" : "bad") + '">' + (state.validation.ok ? "Passing" : "Needs attention") + '</span></div>' + (state.validation.diagnostics.length ? '<div class="diagnostics">' + state.validation.diagnostics.map((item) => '<div><span class="badge ' + item.severity + '">' + esc(item.severity) + '</span><code>' + esc(item.path) + '</code><p>' + esc(item.message) + '</p></div>').join("") + '</div>' : empty("Every record and relationship validates against model v" + state.model.modelVersion + ".")) + '</section></div></div>';
}

function openEditor(type, entry = null) {
  const definition = state.model.resources[type];
  const record = structuredClone(entry?.record || seedRecord(type, definition));
  const fields = { ...state.model.commonFields, ...definition.fields };
  const required = new Set([
    ...Object.entries(state.model.commonFields).filter(([, field]) => field.required).map(([name]) => name),
    ...(definition.required || [])
  ]);
  const oneOf = new Set((definition.oneOf || []).flat());
  const names = [...new Set([
    "id",
    "title",
    ...required,
    ...(definition.listFields || []),
    ...Object.entries(fields).filter(([name, field]) => field.content && name !== "notesPath" && (record[name] || required.has(name) || oneOf.has(name))).map(([name]) => name),
    ...oneOf
  ])].filter((name) => !["schemaVersion", "type"].includes(name) && fields[name]);
  const dialog = document.createElement("dialog");
  dialog.className = "editor";
  dialog.setAttribute("aria-labelledby", "resource-editor-title");
  const contentNames = names.filter((name) => fields[name].content);
  dialog.innerHTML = '<form method="dialog"><div class="dialog-head"><div><p class="kicker">' + (entry ? "Edit record" : "Create record") + '</p><h2 id="resource-editor-title">' + esc(entry?.record.title || definition.title) + '</h2></div><button value="cancel" class="icon-button" aria-label="Close">×</button></div><p>Fill the core fields below. Git will record the author, time, reason, and diff when you commit this file.</p><div class="form-grid">' + names.map((name) => editorField(type, name, fields[name], record[name], required.has(name), Boolean(entry))).join("") + '</div>' +
    contentNames.map((name) => {
      const path = record[name];
      const source = entry?.content?.[name]?.source ?? "# " + record.title + "\n\nDescribe this " + definition.title.toLowerCase() + " here.\n";
      return '<label class="content-editor-field" data-content-editor="' + esc(name) + '"><span>' + esc(fields[name].label || humanize(name)) + ' Markdown</span><textarea data-content-source="' + esc(name) + '" spellcheck="true">' + esc(source) + '</textarea></label>';
    }).join("") +
    '<details class="advanced-editor"><summary>Advanced JSON</summary><p>Use this for optional fields, extensions, or bulk edits. Changes here replace the guided fields above.</p><textarea spellcheck="false" aria-label="Advanced resource JSON">' + esc(JSON.stringify(record, null, 2)) + '</textarea></details><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button value="cancel" class="button">Cancel</button><button type="button" class="button primary" id="save-record">Save file</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector(".advanced-editor textarea").addEventListener("input", () => { dialog.dataset.jsonDirty = "true"; });
  if (!entry) {
    const idInput = dialog.querySelector('[data-field-group="id"] input');
    let previousId = record.id;
    idInput?.addEventListener("input", () => {
      for (const name of contentNames) {
        const pathInput = dialog.querySelector('[data-field-group="' + CSS.escape(name) + '"] input');
        if (pathInput?.value === contentPathFor(type, previousId, name)) {
          pathInput.value = contentPathFor(type, idInput.value, name);
        }
      }
      previousId = idInput.value;
    });
  }
  dialog.querySelector("#save-record").addEventListener("click", async () => {
    try {
      const updated = dialog.dataset.jsonDirty === "true"
        ? JSON.parse(dialog.querySelector(".advanced-editor textarea").value)
        : readGuidedRecord(dialog, record, fields);
      const content = {};
      dialog.querySelectorAll("[data-content-source]").forEach((textarea) => {
        const path = updated[textarea.dataset.contentSource];
        if (path) content[path] = textarea.value;
      });
      const url = entry ? "/api/resource/" + encodeURIComponent(type) + "/" + encodeURIComponent(entry.record.id) : "/api/resources";
      const contentRevisions = Object.fromEntries(contentNames.map((name) => [entry?.content?.[name]?.path, entry?.content?.[name]?.revision]).filter(([path, revision]) => path && revision));
      const response = await fetch(url, { method: entry ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ record: updated, content, revision: entry?.revision, contentRevisions }) });
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
  const record = { schemaVersion: 1, id: type + "-new", type, title: "New " + definition.title };
  const fields = { ...state.model.commonFields, ...definition.fields };
  for (const name of definition.required || []) {
    const field = fields[name];
    if (record[name] !== undefined) continue;
    if (field.relation) {
      const candidates = relationCandidates(field);
      record[name] = field.type === "array" ? (candidates.length === 1 ? [candidates[0].record.id] : []) : (candidates.length === 1 ? candidates[0].record.id : "");
    }
    else if (field.content) record[name] = "content/" + type + "-new.md";
    else if (field.type === "array") record[name] = [];
    else if (field.type === "object") record[name] = {};
    else if (field.type === "boolean") record[name] = false;
    else if (field.type === "integer" || field.type === "number") record[name] = 0;
    else if (field.values?.length) record[name] = field.values[0];
    else record[name] = "";
  }
  for (const choices of definition.oneOf || []) {
    if (choices.some((name) => record[name] !== undefined)) continue;
    const name = choices.find((candidate) => fields[candidate]?.content) || choices[0];
    record[name] = fields[name]?.content ? "content/" + type + "-new.md" : fields[name]?.type === "array" ? [] : "";
  }
  for (const [name, field] of Object.entries(fields)) {
    if (field.content && name !== "notesPath" && record[name] === undefined) {
      record[name] = contentPathFor(type, record.id, name);
    }
  }
  return record;
}

function contentPathFor(type, id, name) {
  const suffix = name === "contentPath" ? "" : "-" + name.replace(/Path$/, "").replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
  return "content/" + id + suffix + ".md";
}

function editorField(type, name, field, value, required, editing) {
  const label = field.label || humanize(name);
  const requiredMark = required ? '<span class="required-mark">Required</span>' : "";
  const help = field.relation ? relationHelp(field) : field.content ? (editing ? "Keep this content path stable after creation." : "Path under data/content/ ending in .md") : "";
  let control;
  if (field.relation && field.type === "array") {
    const candidates = relationCandidates(field);
    control = candidates.length
      ? '<div class="checkbox-list">' + candidates.map(({ record }) => '<label><input type="checkbox" value="' + esc(record.id) + '" ' + ((value || []).includes(record.id) ? "checked" : "") + '><span>' + esc(record.title) + '<small>' + esc(record.id) + '</small></span></label>').join("") + '</div>'
      : '<div class="missing-options">No matching resources exist yet.</div>';
    return fieldWrap(name, "relation-array", label, requiredMark, control, help, required);
  }
  if (field.relation) {
    const candidates = relationCandidates(field);
    control = candidates.length
      ? '<select><option value="">Select a resource</option>' + candidates.map(({ record }) => '<option value="' + esc(record.id) + '" ' + (value === record.id ? "selected" : "") + '>' + esc(record.title) + ' · ' + esc(record.id) + '</option>').join("") + '</select>'
      : '<div class="missing-options">No matching resources exist yet.</div>';
    return fieldWrap(name, "relation", label, requiredMark, control, help, required);
  }
  if (field.type === "enum" || field.type === "rating" || field.type === "outcome") {
    const values = field.values || (field.type === "rating" ? state.model.primitives.rating : state.model.primitives.outcome) || [];
    control = '<select><option value="">Select</option>' + values.map((item) => '<option value="' + esc(item) + '" ' + (value === item ? "selected" : "") + '>' + esc(item) + '</option>').join("") + '</select>';
    return fieldWrap(name, "string", label, requiredMark, control, help, required);
  }
  if (field.type === "boolean") {
    control = '<select><option value="">Not set</option><option value="true" ' + (value === true ? "selected" : "") + '>Yes</option><option value="false" ' + (value === false ? "selected" : "") + '>No</option></select>';
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
    control = '<input type="' + inputType + '" value="' + esc(value ?? "") + '" ' + (editing && (name === "id" || field.content) ? "readonly" : "") + '>';
  }
  return fieldWrap(name, field.type, label, requiredMark, control, help || (editing && name === "id" ? "IDs cannot change after creation." : ""), required);
}

function fieldWrap(name, kind, label, requiredMark, control, help, required) {
  const labelId = "field-label-" + name;
  const labelledControl = control.replace(/^<([a-z]+)/, '<$1 aria-labelledby="' + esc(labelId) + '"');
  return '<div class="form-field" data-field-group="' + esc(name) + '" data-kind="' + esc(kind) + '" data-required="' + (required ? "true" : "false") + '"><div class="field-label" id="' + esc(labelId) + '">' + esc(label) + requiredMark + '</div>' + labelledControl + (help ? '<small>' + esc(help) + '</small>' : "") + '</div>';
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
      else if (kind === "integer") value = raw === "" ? undefined : Number.parseInt(raw, 10);
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
  dialog.innerHTML = '<form method="dialog"><div class="dialog-head"><div><p class="kicker">Edit Markdown</p><h2 id="content-editor-title">' + esc(entry.record.title) + '</h2></div><button value="cancel" class="icon-button" aria-label="Close">×</button></div><p><code>' + esc(item.path) + '</code></p><textarea class="markdown-source" spellcheck="true" aria-label="Markdown content">' + esc(item.source) + '</textarea><div class="dialog-error" role="alert"></div><div class="dialog-actions"><button value="cancel" class="button">Cancel</button><button type="button" class="button primary" id="save-content">Save Markdown</button></div></form>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("#save-content").addEventListener("click", async () => {
    try {
      const response = await fetch("/api/content", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: item.path, source: dialog.querySelector(".markdown-source").value, revision: item.revision }) });
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
  root.querySelectorAll(".nav-heading").forEach((button) => button.addEventListener("click", () => {
    const group = button.closest(".nav-group");
    group.classList.toggle("open");
    activeGroup = group.classList.contains("open") ? group.dataset.group : "";
    button.setAttribute("aria-expanded", String(group.classList.contains("open")));
  }));
  root.querySelector(".mobile-nav")?.addEventListener("click", () => root.querySelector(".sidebar").classList.toggle("shown"));
  const search = root.querySelector("#global-search");
  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && search.value.trim()) {
      event.preventDefault();
      globalSearch(search.value);
    }
  });
  document.onkeydown = (event) => {
    if (event.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName)) {
      event.preventDefault();
      search?.focus();
    }
  };
}

function globalSearch(query) {
  const matches = state.resources.filter((entry) => entrySearchText(entry).includes(query.toLowerCase()));
  const dialog = document.createElement("dialog");
  dialog.className = "search-results";
  dialog.setAttribute("aria-labelledby", "search-results-title");
  dialog.innerHTML = '<div class="dialog-head"><div><p class="kicker">Search</p><h2 id="search-results-title">' + esc(query) + '</h2></div><button class="icon-button" aria-label="Close">×</button></div><div class="result-list">' + (matches.length ? matches.slice(0, 50).map(({ record }) => '<a href="#/resource/' + encodeURIComponent(record.type) + '/' + encodeURIComponent(record.id) + '"><strong>' + esc(record.title) + '</strong><small>' + esc(state.model.resources[record.type].title) + ' · ' + esc(record.id) + '</small></a>').join("") : empty("No matching records.")) + '</div>' + (matches.length > 50 ? '<p class="result-limit">Showing the first 50 of ' + matches.length + ' matches. Refine your search to narrow the list.</p>' : "");
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector(".icon-button").onclick = () => dialog.close();
  dialog.querySelectorAll("a").forEach((link) => link.onclick = () => dialog.close());
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
function resourceBars(types) {
  const values = types.map((type) => [type, state.model.resources[type], resourcesOfType(type).length]).filter(([, definition]) => definition);
  const max = Math.max(1, ...values.map(([, , count]) => count));
  return '<div class="resource-bars">' + values.map(([type, definition, count]) => '<a href="#/resources/' + encodeURIComponent(type) + '"><span>' + esc(definition.pluralTitle) + '</span><i><b style="width:' + (count ? Math.max(4, (count / max) * 100) : 0) + '%"></b></i><strong>' + count + '</strong></a>').join("") + '</div>';
}
function countStatus(entries, status) { return entries.filter(({ record }) => record.status === status).length; }
function countOverdue(entries) { const today = currentDate(); return entries.filter(({ record }) => dueDate(record) && dueDate(record) < today).length; }
function dueDate(record) { return record.dueOn || record.nextDueOn || record.reviewDueOn || record.expiresOn || record.acceptanceExpiresOn || record.scheduledOn || null; }
function isClosedStatus(status) { return ["complete", "completed", "closed", "canceled", "cancelled", "retired", "superseded", "passed", "failed", "verified", "withdrawn", "remediated", "false-positive"].includes(status); }
function isOpenWork(record) {
  const statuses = {
    "action-item": ["open", "in-progress", "blocked"],
    "audit-request": ["open", "in-progress", "submitted", "needs-follow-up"],
    exception: ["requested"],
    finding: ["open", "accepted", "remediating"]
  };
  return statuses[record.type]?.includes(record.status) || false;
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
function groupTitle(id) { return state.model.groups.find((group) => group.id === id)?.title || "Program"; }
function fieldLabel(type, name) { const field = state.model.resources[type]?.fields?.[name] || state.model.commonFields[name]; return field?.label || humanize(name); }
function filterOptionLabel(value) { return state.resources.find(({ record }) => record.id === value)?.record.title || value; }
function humanize(value) { return String(value).replace(/Ids?$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()); }
function formatValue(value, field) {
  if (value === undefined || value === null || value === "") return '<span class="muted">Not set</span>';
  if (field === "status" || field.endsWith("Rating") || field === "severity" || field === "outcome") return '<span class="badge status-' + esc(String(value)) + '">' + esc(String(value)) + '</span>';
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? '<code>' + esc(JSON.stringify(item)) + '</code>' : formatReference(item)).join(" ") : '<span class="muted">None</span>';
  if (typeof value === "object") return '<pre class="compact-json">' + esc(JSON.stringify(value, null, 2)) + '</pre>';
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (/On$|Date$|Start$|End$|At$/.test(field)) return esc(shortDate(String(value)));
  const reference = state.resources.find(({ record }) => record.id === value);
  if (reference) return '<a class="tag relation" href="#/resource/' + encodeURIComponent(reference.record.type) + '/' + encodeURIComponent(reference.record.id) + '">' + esc(reference.record.title) + '</a>';
  return esc(String(value));
}
function formatReference(value) {
  const reference = state.resources.find(({ record }) => record.id === value);
  return reference ? '<a class="tag relation" href="#/resource/' + encodeURIComponent(reference.record.type) + '/' + encodeURIComponent(reference.record.id) + '">' + esc(reference.record.title) + '</a>' : '<span class="tag">' + esc(value) + '</span>';
}
function shortDate(value) { const date = new Date(value.length === 10 ? value + "T00:00:00Z" : value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date); }
function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function empty(message) { return '<div class="empty">' + esc(message) + '</div>'; }
function renderNotFound(main) { main.innerHTML = '<div class="page">' + empty("That resource does not exist.") + '</div>'; }
function showError(message) {
  const dialog = document.createElement("dialog");
  dialog.className = "alert-dialog";
  dialog.setAttribute("aria-labelledby", "alert-dialog-title");
  dialog.innerHTML = '<div class="dialog-head"><div><p class="kicker">Could not complete the action</p><h2 id="alert-dialog-title">Review the record</h2></div><button class="icon-button" aria-label="Close">×</button></div><p>' + esc(message) + '</p><div class="dialog-actions"><button class="button primary">Close</button></div>';
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
}
async function responseMessage(response) {
  const source = await response.text();
  try { return JSON.parse(source).error || source; } catch { return source; }
}
async function fetchJson(url, options) { const response = await fetch(url, options); if (!response.ok) throw new Error(await responseMessage(response)); return response.json(); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
`;

export const APP_STYLES = String.raw`
:root{--ink:#17221e;--muted:#66736d;--line:#dfe5e1;--paper:#f6f7f4;--panel:#fff;--green:#1d6650;--green-2:#dfece6;--lime:#b8d776;--amber:#ad6b16;--red:#a44236;--sidebar:#13231e;--shadow:0 8px 28px rgba(21,40,33,.07);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper);font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-width:320px;background:var(--paper)}button,input,select,textarea{font:inherit}a{color:inherit}.skip-link{position:fixed;left:1rem;top:-4rem;z-index:100;padding:.7rem 1rem;background:#fff}.skip-link:focus{top:1rem}.loading,.fatal{padding:3rem}.shell{display:grid;grid-template-columns:248px 1fr;min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:248px;background:var(--sidebar);color:#dce7e2;padding:25px 18px 18px;overflow:auto;z-index:20}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;margin:0 7px 27px}.brand .mark{display:grid;place-items:center;width:39px;height:39px;border-radius:10px;background:var(--lime);color:#15271f;font-weight:800;letter-spacing:-.04em}.brand strong,.brand small{display:block}.brand strong{color:#fff;font-size:15px}.brand small{font-size:11px;color:#91a59d;margin-top:2px}.nav-home,.nav-items a{display:flex;justify-content:space-between;align-items:center;text-decoration:none;border-radius:7px;padding:8px 10px;font-size:13px;color:#b9c9c2}.nav-home{margin-bottom:9px}.nav-home:hover,.nav-items a:hover,.nav-home.current,.nav-items a.current{background:#203a31;color:#fff}.nav-heading{width:100%;border:0;background:none;color:#718b81;text-transform:uppercase;letter-spacing:.11em;font-size:10px;font-weight:750;display:flex;align-items:center;justify-content:space-between;padding:13px 10px 5px;cursor:pointer}.chevron{font-size:18px;transform:rotate(0);transition:.15s}.nav-group.open .chevron{transform:rotate(90deg)}.nav-items{display:none}.nav-group.open .nav-items{display:block}.nav-items small{font-size:10px;color:#769087}.side-foot{position:sticky;bottom:-18px;margin:25px -18px -18px;padding:17px 25px;background:#101e1a;border-top:1px solid #294038;color:#9cb0a8;font-size:11px;display:flex;align-items:center;gap:8px}.status-dot{width:8px;height:8px;border-radius:50%;background:#9aa39f;display:inline-block;flex:0 0 auto}.status-dot.good,.badge.good{background:#6abf8c}.status-dot.warn,.badge.warn{background:#e9a445}.status-dot.bad,.badge.bad{background:#dc6c5d}.status-dot.neutral{background:#7ba399}.workspace{grid-column:2;min-width:0}.topbar{height:86px;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:0 32px;display:flex;align-items:center;gap:23px;position:sticky;top:0;z-index:10}.topbar>div:first-of-type{min-width:190px}.topbar h1{font-size:17px;line-height:1.1;margin:3px 0 0}.eyebrow,.kicker{color:var(--green);text-transform:uppercase;letter-spacing:.12em;font-weight:760;font-size:9px;margin:0}.search{height:39px;max-width:480px;flex:1;margin-left:auto;display:flex;align-items:center;gap:9px;background:#f2f4f1;border:1px solid #e0e5e1;border-radius:8px;padding:0 10px;color:#6f7a75}.search input{border:0;outline:0;background:none;min-width:0;flex:1;font-size:13px}.search kbd{background:#fff;border:1px solid #d8dfda;border-radius:4px;padding:1px 5px;font-size:10px}.repo-chip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;color:var(--muted);font-size:11px;white-space:nowrap}.mobile-nav{display:none}.page{padding:30px 34px 70px;max-width:1510px;margin:auto}.hero{color:#eaf2ee;background:linear-gradient(120deg,#183c31,#245846);border-radius:13px;padding:28px 31px;display:flex;justify-content:space-between;align-items:end;min-height:158px;box-shadow:var(--shadow);position:relative;overflow:hidden}.hero:after{content:"";position:absolute;width:270px;height:270px;border:55px solid rgba(184,215,118,.1);border-radius:50%;right:-80px;top:-145px}.hero .kicker{color:#b8d776}.hero h2{font-family:Georgia,serif;font-weight:500;font-size:28px;margin:10px 0 8px;letter-spacing:-.02em}.hero p:not(.kicker){margin:0;color:#b9cec5;font-size:13px;max-width:650px}.hero-meta{display:flex;gap:15px;position:relative;z-index:1}.hero-meta span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#c6d8d0;border-left:1px solid #547568;padding-left:15px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}.metric{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 18px;box-shadow:0 2px 8px rgba(21,40,33,.025)}.metric-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:flex;align-items:center;gap:7px}.metric>strong{display:block;font-family:Georgia,serif;font-size:25px;font-weight:500;margin:8px 0 2px}.metric>small{font-size:10px;color:#87918c}.dashboard-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.panel{background:#fff;border:1px solid var(--line);border-radius:11px;padding:21px;min-width:0;box-shadow:0 2px 8px rgba(21,40,33,.025)}.span-2{grid-column:span 2}.panel-head{display:flex;align-items:start;justify-content:space-between;gap:15px;margin-bottom:18px}.panel-head h3{font-size:14px;margin:4px 0 0}.panel-head>a{font-size:11px;color:var(--green);font-weight:700}.audit-progress{display:grid;grid-template-columns:105px 1fr;gap:11px 20px;align-items:end}.progress-number strong{font-family:Georgia,serif;font-size:30px;font-weight:500;display:block}.progress-number span{font-size:10px;color:var(--muted)}.progress{height:9px;background:#e7ebe8;border-radius:9px;overflow:hidden}.progress span{display:block;height:100%;background:linear-gradient(90deg,#287259,var(--lime));border-radius:9px}.progress-meta{grid-column:2;display:flex;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#7d8983}.due-list{display:grid}.due-list a{display:grid;grid-template-columns:60px 1fr;text-decoration:none;border-top:1px solid #edf0ee;padding:10px 0;align-items:center}.due-list a:first-child{border:0;padding-top:0}.due-list time{font-size:10px;color:var(--green);font-weight:750}.due-list strong,.due-list small{display:block}.due-list strong{font-size:11px}.due-list small{font-size:9px;color:var(--muted);margin-top:3px}.resource-bars{display:grid;gap:11px}.resource-bars a{display:grid;grid-template-columns:105px 1fr 20px;gap:9px;align-items:center;text-decoration:none;font-size:10px}.resource-bars i{height:5px;background:#edf0ee;border-radius:5px;overflow:hidden}.resource-bars b{display:block;height:100%;background:#81aa9a;border-radius:5px}.resource-bars strong{text-align:right}.catalog{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.catalog a{display:flex;justify-content:space-between;text-decoration:none;padding:9px 11px;background:#f5f7f5;border-radius:6px;font-size:10px}.catalog a:hover{background:var(--green-2)}.page-intro{display:flex;justify-content:space-between;align-items:end;margin-bottom:25px}.page-intro h2,.detail-head h2{font-family:Georgia,serif;font-size:31px;font-weight:500;margin:7px 0}.page-intro p:not(.kicker){color:var(--muted);max-width:700px;font-size:13px;margin:0}.button{border:1px solid #ccd5d0;background:#fff;border-radius:7px;padding:9px 13px;cursor:pointer;font-size:12px;font-weight:650}.button.primary{background:var(--green);border-color:var(--green);color:#fff}.button.danger{color:var(--red)}.list-tools{display:flex;align-items:center;gap:10px;margin-bottom:12px}.list-tools label{flex:1}.list-tools input,.list-tools select{width:100%;border:1px solid var(--line);border-radius:7px;background:#fff;padding:10px 12px;font-size:12px}.list-tools select{width:auto}.list-tools>span{color:var(--muted);font-size:10px}.record-table-wrap{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:auto}.record-table{width:100%;border-collapse:collapse;font-size:11px}.record-table th{background:#f5f7f5;text-align:left;text-transform:uppercase;letter-spacing:.08em;color:#75817b;font-size:9px;padding:11px 14px;border-bottom:1px solid var(--line)}.record-table td{padding:13px 14px;border-bottom:1px solid #edf0ee;vertical-align:top}.record-table tr:last-child td{border-bottom:0}.record-table code{font-size:9px;color:#64736c}.record-title{display:block;color:var(--ink);font-weight:700;text-decoration:none}.record-table td>small{display:block;color:#8a948f;margin-top:3px}.badge,.tag,.type-pill{display:inline-block;border-radius:99px;background:#edf1ee;padding:3px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.tag{text-transform:none;margin:1px}.badge.status-active,.badge.status-approved,.badge.status-complete,.badge.status-passed,.badge.status-accepted{background:#ddefe5;color:#176143}.badge.status-open,.badge.status-high,.badge.status-critical,.badge.status-failed{background:#f5ded9;color:#8d352c}.badge.status-draft,.badge.status-planned,.badge.status-in-progress,.badge.status-medium{background:#f7e9cf;color:#855717}.breadcrumbs{display:flex;gap:8px;color:var(--muted);font-size:11px;margin-bottom:20px}.detail-head{display:flex;justify-content:space-between;align-items:end;margin-bottom:22px}.detail-head h2{margin-bottom:4px}.detail-head>div>code{font-size:10px;color:var(--muted)}.actions{display:flex;gap:7px}.detail-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(270px,1fr);gap:14px}.detail-grid aside{display:grid;gap:14px;align-content:start}.detail-main{padding:29px}.content-label{color:#75817b;text-transform:uppercase;letter-spacing:.08em;font-size:9px;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:23px}.markdown{max-width:790px}.markdown h1{font-family:Georgia,serif;font-size:29px;font-weight:500}.markdown h2{font-family:Georgia,serif;font-size:23px;font-weight:500;margin-top:1.8em}.markdown h3{font-size:15px;margin-top:1.7em}.markdown p,.markdown li{font-size:13px;line-height:1.65;color:#38463f}.markdown code{background:#f1f3f1;border-radius:3px;padding:1px 4px}.markdown pre{padding:15px;background:#15241f;color:#dfe9e4;border-radius:7px;overflow:auto}.markdown blockquote{border-left:3px solid var(--lime);padding:4px 15px;color:var(--muted);margin-left:0}.table-wrap{overflow:auto}.markdown table{border-collapse:collapse;width:100%;font-size:11px}.markdown th,.markdown td{border:1px solid var(--line);padding:8px;text-align:left}.metadata{margin:0}.metadata>div{display:grid;grid-template-columns:105px 1fr;gap:10px;border-top:1px solid #edf0ee;padding:10px 0}.metadata>div:first-child{border-top:0;padding-top:0}.metadata dt{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#7d8883}.metadata dd{margin:0;font-size:11px;min-width:0}.compact-json{white-space:pre-wrap;font-size:9px}.git-panel>code{font-size:9px;word-break:break-all}.git-panel p{font-size:10px;color:var(--muted)}.relation{color:var(--green);text-decoration:none}.history{display:grid}.history>div{display:grid;grid-template-columns:60px 1fr;gap:8px;padding:8px 0;border-top:1px solid #edf0ee}.history>div:first-child{border-top:0}.history code{font-size:9px;color:var(--green)}.history strong,.history small{display:block}.history strong{font-size:10px}.history small{font-size:9px;color:var(--muted);margin-top:2px}.empty{padding:25px;color:#7f8a85;text-align:center;font-size:11px;background:#f7f8f6;border-radius:7px}.changes{padding-left:18px}.changes li{margin:8px 0}.diagnostics>div{display:grid;grid-template-columns:58px minmax(120px,180px) minmax(0,1fr);gap:10px;align-items:start;border-top:1px solid var(--line);padding:10px 0}.diagnostics p{margin:0;font-size:11px;overflow-wrap:anywhere}.diagnostics code{font-size:9px;overflow-wrap:anywhere}.editor,.search-results{width:min(760px,calc(100vw - 30px));border:0;border-radius:12px;padding:0;box-shadow:0 25px 80px rgba(13,29,23,.28)}dialog::backdrop{background:rgba(8,20,16,.55)}.editor form,.search-results{padding:23px}.dialog-head{display:flex;justify-content:space-between;align-items:start}.dialog-head h2{font-family:Georgia,serif;font-weight:500;margin:5px 0 0}.icon-button{border:0;background:#eef1ef;width:32px;height:32px;border-radius:50%;font-size:22px;cursor:pointer}.editor form>p{font-size:11px;color:var(--muted)}.editor textarea{width:100%;height:440px;border:1px solid var(--line);border-radius:7px;background:#14231e;color:#dce8e2;padding:15px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2}.dialog-actions{display:flex;justify-content:end;gap:8px;margin-top:14px}.dialog-error{color:var(--red);font-size:11px;min-height:18px;margin-top:7px}.result-list{display:grid;margin-top:17px;max-height:60vh;overflow:auto}.result-list a{display:block;text-decoration:none;padding:11px;border-top:1px solid var(--line)}.result-list strong,.result-list small{display:block}.result-list small{color:var(--muted);margin-top:3px}.muted{color:#929b96}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.list-tools{flex-wrap:wrap}.list-tools label{min-width:220px}.result-limit{margin:12px 0 0;color:var(--muted);font-size:10px}
.setup-banner{margin:14px 0;background:#f0f5e7;border:1px solid #d7e3bd;border-radius:11px;padding:19px 22px;display:grid;grid-template-columns:1fr 1.3fr;gap:25px;align-items:center}.setup-banner h3{margin:5px 0 6px;font-size:15px}.setup-banner p:not(.kicker){margin:0;color:var(--muted);font-size:11px;line-height:1.5}.setup-banner ol{margin:0;padding-left:22px;display:grid;gap:7px}.setup-banner li{font-size:11px}.setup-banner a{color:var(--green);font-weight:700}.due-list time.overdue{color:var(--red)}.content-label{display:flex;align-items:center;justify-content:space-between;gap:12px}.text-button{border:0;background:none;color:var(--green);font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:750;cursor:pointer;white-space:nowrap}.tag{white-space:normal;overflow-wrap:anywhere;max-width:100%}.editor{max-height:calc(100vh - 30px);overflow:auto}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:20px 0}.form-field>.field-label,.content-editor-field>span{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#53615a;font-size:10px;font-weight:700;margin-bottom:6px}.required-mark{font-size:8px;color:var(--green);text-transform:uppercase;letter-spacing:.06em}.form-field input,.form-field select,.editor .form-field textarea{width:100%;height:auto;min-height:40px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink);padding:9px 10px;font:12px/1.4 inherit}.editor .form-field textarea{height:82px}.form-field input[readonly]{background:#f1f3f1;color:#69756f}.form-field>small{display:block;color:#85908b;font-size:9px;margin-top:5px}.checkbox-list{display:grid;gap:5px;max-height:145px;overflow:auto;border:1px solid var(--line);border-radius:7px;padding:7px}.checkbox-list label{display:flex;align-items:center;gap:8px;padding:5px;border-radius:5px}.checkbox-list input{width:16px;min-height:16px;padding:0;flex:0 0 auto}.checkbox-list label:hover{background:#f4f6f4}.checkbox-list span,.checkbox-list small{display:block;font-size:10px}.checkbox-list small{color:var(--muted);margin-top:2px}.missing-options{padding:11px;border:1px dashed #d7c8a9;background:#fbf5e9;color:#795b23;border-radius:7px;font-size:10px}.content-editor-field{display:block;margin:17px 0}.editor .content-editor-field textarea,.editor .markdown-source{height:260px;background:#14231e;color:#dce8e2;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.advanced-editor{border-top:1px solid var(--line);margin-top:18px;padding-top:13px}.advanced-editor summary{cursor:pointer;color:var(--green);font-size:11px;font-weight:750}.advanced-editor p{font-size:10px;color:var(--muted)}.editor .advanced-editor>textarea{height:320px}.alert-dialog{width:min(520px,calc(100vw - 30px));border:0;border-radius:12px;padding:23px;box-shadow:0 25px 80px rgba(13,29,23,.28)}.alert-dialog>p{font-size:12px;line-height:1.55;color:var(--muted)}.metadata dd{overflow-wrap:anywhere}
@media(max-width:1100px){.metrics{grid-template-columns:repeat(2,1fr)}.dashboard-grid{grid-template-columns:repeat(2,1fr)}.catalog{grid-template-columns:repeat(3,1fr)}.span-2{grid-column:span 2}.repo-chip{display:none}}
@media(max-width:760px){.shell{display:block}.sidebar{transform:translateX(-100%);transition:.2s;box-shadow:8px 0 30px rgba(0,0,0,.2)}.sidebar.shown{transform:translateX(0)}.workspace{min-width:0}.mobile-nav{display:block;border:0;background:none;font-size:20px}.topbar{height:72px;padding:0 16px}.topbar>div:first-of-type{min-width:0}.search{max-width:none}.search kbd,.topbar .eyebrow{display:none}.page{padding:20px 15px 60px}.hero{display:block;padding:23px}.hero-meta{margin-top:22px;flex-wrap:wrap}.metrics,.dashboard-grid{grid-template-columns:1fr}.span-2{grid-column:auto}.catalog{grid-template-columns:repeat(2,1fr)}.detail-grid{grid-template-columns:1fr}.page-intro,.detail-head{display:block}.page-intro>.button,.actions{margin-top:15px}.record-table{min-width:720px}}
@media(max-width:760px){.setup-banner{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.record-table{min-width:0}.record-table thead{display:none}.record-table,.record-table tbody,.record-table tr{display:block}.record-table tr{padding:8px 12px;border-bottom:1px solid var(--line)}.record-table tr:last-child{border-bottom:0}.record-table td:not([data-label]){display:block}.record-table td[data-label]{display:grid;grid-template-columns:105px minmax(0,1fr);gap:10px;border:0;padding:7px 0;align-items:start}.record-table td[data-label]::before{content:attr(data-label);color:#75817b;text-transform:uppercase;letter-spacing:.07em;font-size:8px;font-weight:700}.record-table td[data-label="Title"]{display:block;padding:8px 0 10px}.record-table td[data-label="Title"]::before{display:none}.content-label{align-items:flex-start}.editor form{padding:18px}.diagnostics>div{grid-template-columns:58px minmax(0,1fr)}.diagnostics p{grid-column:1/-1}.changes code{overflow-wrap:anywhere}}
`;

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
