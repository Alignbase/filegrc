import { applyResourceBatch } from "./files.js";
import { createResourceId } from "./id.js";
import { currentCalendarDate } from "./time.js";
import { loadWorkspace } from "./workspace.js";

export async function scaffoldExternalReviewerGovernance(input = process.cwd()) {
  const loaded = await loadWorkspace(input);
  if (!["3", "4"].includes(String(loaded.model.modelVersion))) {
    throw new Error("External reviewer setup requires a model v3 or v4 workspace.");
  }
  return {
    reviewerName: null,
    jobTitle: null,
    email: null,
    organization: null,
    startsOn: currentCalendarDate(loaded.workspace.timezone),
    independenceRationale: null,
    appointedByIds: [],
    instructions: "Replace every null required value with current facts. The reviewer must be independent from policy ownership and operating work. Preview the completed file before applying it."
  };
}

export async function planExternalReviewerGovernance(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  if (!["3", "4"].includes(String(loaded.model.modelVersion))) {
    throw new Error("External reviewer setup requires a model v3 or v4 workspace.");
  }
  const name = required(options.reviewerName, "External reviewer name");
  const startsOn = required(options.startsOn, "Appointment start date");
  const existingPerson = loaded.resources.find((record) => (
    record.type === "person"
    && record.affiliation === "external"
    && (
      record.id === options.reviewerId
      || record.email && options.email && record.email.toLowerCase() === String(options.email).toLowerCase()
    )
  ));
  const jobTitle = required(
    options.jobTitle || existingPerson?.jobTitle,
    "External reviewer organizational job title"
  );
  const person = {
    ...(existingPerson || {
      id: options.reviewerId || createResourceId("person", name, loaded.resources.map(({ id }) => id)),
      type: "person"
    }),
    title: name,
    status: "active",
    affiliation: "external",
    jobTitle,
    ...(options.email ? { email: String(options.email) } : {}),
    ...(options.organization ? { organization: String(options.organization) } : {})
  };
  const workspaceId = loaded.workspace.id;
  const creates = existingPerson ? [] : [person];
  const updates = existingPerson ? [person] : [];
  const appointmentIds = [];
  const appointmentSpecs = [
    {
      kind: "independent-policy-reviewer",
      title: "Independent Policy Reviewer",
      responsibilities: "Review and approve policies and governed documents independently from the owner, chair security and risk oversight, and challenge management decisions."
    }
  ];
  for (const spec of appointmentSpecs) {
    const existing = loaded.resources.find((record) => (
      record.type === "appointment"
      && record.appointmentKind === spec.kind
      && record.status !== "ended"
    ));
    const appointment = {
      ...(existing || {
        id: createResourceId("appointment", spec.title, [
          ...loaded.resources.map(({ id }) => id),
          ...creates.map(({ id }) => id)
        ]),
        type: "appointment",
        title: spec.title
      }),
      status: "active",
      appointmentKind: spec.kind,
      holderId: person.id,
      scopeResourceIds: [workspaceId],
      startsOn,
      responsibilities: existing?.responsibilities || spec.responsibilities,
      independenceRationale: required(
        options.independenceRationale,
        "Independence rationale"
      ),
      ...(options.appointedByIds?.length
        ? { appointedByIds: [...new Set(options.appointedByIds.map(String))] }
        : {})
    };
    appointmentIds.push(appointment.id);
    if (existing) updates.push(appointment);
    else creates.push(appointment);
  }

  const team = loaded.resources.find((record) => (
    record.type === "team" && record.id === "team-security-risk-oversight"
  )) || loaded.resources.find((record) => record.type === "team" && /oversight/i.test(record.title));
  if (team) {
    updates.push({
      ...team,
      status: "active",
      memberIds: [...new Set([...(team.memberIds || []), person.id])],
      chairIds: [...new Set([...(team.chairIds || []), appointmentIds[0]])]
    });
  } else {
    creates.push({
      id: createResourceId("team", "Security and Risk Oversight", [
        ...loaded.resources.map(({ id }) => id),
        ...creates.map(({ id }) => id)
      ]),
      type: "team",
      title: "Security and Risk Oversight",
      status: "active",
      purpose: "Provide independent review of security, risk, policies, incidents, findings, and overdue work.",
      memberIds: [person.id],
      chairIds: [appointmentIds[0]]
    });
  }

  for (const policy of loaded.resources.filter((record) => (
    record.type === "policy"
    && ["draft", "in-review"].includes(record.status)
    && !(record.approverIds || []).includes(person.id)
  ))) {
    updates.push({
      ...policy,
      approverIds: [...new Set([...(policy.approverIds || []), person.id])]
    });
  }
  return {
    operation: "external-reviewer-governance",
    reviewerId: person.id,
    appointmentIds,
    changes: {
      create: creates,
      update: deduplicateUpdates(updates),
      validateWholeWorkspace: true
    }
  };
}

export async function setupExternalReviewerGovernance(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Preview the external reviewer governance bundle and confirm the write.");
  }
  const plan = await planExternalReviewerGovernance(input, options);
  const result = await applyResourceBatch(input, plan.changes);
  return { ...plan, result };
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function deduplicateUpdates(records) {
  const byId = new Map();
  for (const record of records) byId.set(record.id, record);
  return [...byId.values()];
}
