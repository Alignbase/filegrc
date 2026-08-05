import { createResource } from "./files.js";
import { createResourceId } from "./id.js";
import { loadWorkspace } from "./workspace.js";

export async function planNextAuditCycle(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  if (String(loaded.model.modelVersion) !== "3") {
    throw new Error("Audit-cycle carry-forward requires a model v3 workspace.");
  }
  const prior = loaded.resources.find((record) => (
    record.type === "audit" && record.id === options.priorAuditId
  ));
  if (!prior) throw new Error("A prior Audit record is required.");
  const startsOn = required(options.startsOn, "Next period start");
  const endsOn = required(options.endsOn, "Next period end");
  if (startsOn > endsOn) throw new Error("The next period end must be on or after its start.");
  const priorEnd = prior.coverage?.endsOn || prior.coverage?.on;
  if (prior.auditKind === "soc-2-type-1" && priorEnd && startsOn <= priorEnd) {
    throw new Error(`A Type 2 operating period must start after the Type 1 as-of date ${priorEnd}.`);
  }
  const title = String(options.title || nextTitle(prior, startsOn, endsOn)).trim();
  const audit = {
    id: options.id || createResourceId("audit", title, loaded.resources.map(({ id }) => id)),
    type: "audit",
    title,
    status: "planned",
    auditKind: "soc-2-type-2",
    priorAuditId: prior.id,
    coverage: { kind: "range", startsOn, endsOn },
    frameworkIds: [...(prior.frameworkIds || [])],
    systemIds: [...(prior.systemIds || [])],
    requirementIds: [...(prior.requirementIds || [])],
    controlIds: [...(prior.controlIds || [])],
    complementaryControlIds: [...(prior.complementaryControlIds || [])],
    subserviceVendorIds: [...(prior.subserviceVendorIds || [])],
    ...(prior.subserviceMethod ? { subserviceMethod: prior.subserviceMethod } : {}),
    ...(prior.complementaryControlsConclusion
      ? { complementaryControlsConclusion: prior.complementaryControlsConclusion }
      : {}),
    ...(prior.auditorVendorId ? { auditorVendorId: prior.auditorVendorId } : {}),
    contactIds: [...(prior.contactIds || [])],
    ownerIds: [...(prior.ownerIds || [])],
    signatoryAppointmentIds: [...(prior.signatoryAppointmentIds || [])],
    scope: String(options.scope || prior.scope || "").trim(),
    ...(String(options.scopeRevision || "").trim()
      ? { scopeRevision: String(options.scopeRevision).trim() }
      : {})
  };
  return {
    operation: prior.auditKind === "soc-2-type-1" ? "type-1-to-type-2" : "next-audit-cycle",
    priorAuditId: prior.id,
    audit,
    carriedForward: [
      "frameworkIds",
      "systemIds",
      "requirementIds",
      "controlIds",
      "complementaryControlIds",
      "subserviceVendorIds",
      "subserviceMethod",
      "auditorVendorId",
      "contactIds",
      "ownerIds",
      "signatoryAppointmentIds",
      "scope"
    ],
    reviewRequired: [
      "coverage",
      "scopeRevision",
      "criteria and control changes since the prior audit",
      "source and policy continuity",
      "subservice assurance coverage",
      "new or changed commitments"
    ]
  };
}

export async function createNextAuditCycle(input = process.cwd(), options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Preview the next audit cycle and confirm the write.");
  }
  const plan = await planNextAuditCycle(input, options);
  const result = await createResource(input, plan.audit);
  return { ...plan, result };
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function nextTitle(prior, startsOn, endsOn) {
  const year = endsOn.slice(0, 4) || startsOn.slice(0, 4);
  return `${year} SOC 2 Type 2 audit after ${prior.title}`;
}
