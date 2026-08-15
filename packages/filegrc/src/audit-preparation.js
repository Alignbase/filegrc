import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  coverageContains,
  coverageEnd,
  coverageLabel,
  coverageMatches,
  coverageOverlaps,
  coverageStart
} from "./coverage.js";
import { createResource, createResources, deleteResource, updateResource } from "./files.js";
import { createResourceId } from "./id.js";
import { currentPartyPeople, partiesIndependent } from "./parties.js";
import { resolveDataPath } from "./paths.js";
import { assessProgramReadiness } from "./program-readiness.js";
import { markdownEntries } from "./resource-markdown.js";
import { loadWorkspace } from "./workspace.js";

const NON_EVIDENCE_RECORD_TYPES = new Set([
  "audit",
  "audit-population",
  "audit-request",
  "commitment",
  "complementary-control",
  "control",
  "control-test",
  "document",
  "evidence",
  "framework",
  "obligation",
  "organization",
  "person",
  "policy",
  "renderer-settings",
  "requirement",
  "system",
  "team",
  "training",
  "vendor",
  "workspace"
]);

export async function assessAuditPreparation(input, options = {}) {
  const loaded = input?.resources && input?.model && input?.entries
    ? input
    : await loadWorkspace(input);
  const records = loaded.resources;
  const byId = new Map(records.map((record) => [record.id, record]));
  const audits = records.filter((record) => record.type === "audit");
  const audit = options.auditId
    ? audits.find((record) => record.id === options.auditId)
    : options.selectDefault === false
      ? null
      : audits.find((record) => !["complete", "closed", "canceled"].includes(record.status)) || audits[0];
  if (options.auditId && !audit) throw new Error(`Audit "${options.auditId}" was not found.`);

  const programReadiness = options.programReadiness || await assessProgramReadiness(loaded, {
    generatedAt: options.generatedAt,
    programId: audit?.programId
  });
  const stages = [
    programFoundationStage(programReadiness, loaded.workspace),
    engagementStage(audit, byId, programReadiness),
    scopeStage(audit, records, byId, programReadiness)
  ];
  const fieldworkSections = audit
    ? [
        await documentsStage(loaded, audit, byId),
        evidenceStage(audit, records, byId, loaded.model),
        populationsStage(audit, records, byId, loaded.model)
      ]
    : [];
  stages.push(fieldworkStage(audit, fieldworkSections));
  stages.push(auditorStage());

  for (const stage of stages) {
    stage.counts = countStatuses(stage.items);
    stage.status = stage.counts.action ? "action" : stage.counts.later ? "later" : "complete";
  }
  const items = stages.flatMap((stage) => stage.items);
  const counts = countStatuses(items);
  const managedItems = items.filter((item) => !["external", "info", "later"].includes(item.status));
  const completedManagedItems = managedItems.filter((item) => item.status === "complete");
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    audit: audit ? auditSummary(audit) : null,
    status: !audit ? "not-started" : counts.action ? "needs-work" : "management-ready",
    progress: {
      complete: completedManagedItems.length,
      total: managedItems.length,
      percent: managedItems.length ? Math.round((completedManagedItems.length / managedItems.length) * 100) : 0
    },
    counts,
    canInitialize: Boolean(audit
      && ["soc-2-type-1", "soc-2-type-2"].includes(audit.auditKind)
      && coverageStart(audit.coverage)
      && coverageEnd(audit.coverage)
      && initializationNeeded(audit, records, loaded.model)),
    stages
  };
}

export async function prepareAuditWorkspace(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const audit = loaded.resources.find((record) => record.type === "audit" && record.id === options.auditId);
  if (!audit) throw new Error(`Audit "${options.auditId || ""}" was not found.`);
  if (!["soc-2-type-1", "soc-2-type-2"].includes(audit.auditKind)) {
    throw new Error("Audit preparation requires a SOC 2 Type 1 or Type 2 engagement.");
  }
  if (audit.auditKind === "soc-2-type-2" && audit.coverage?.kind !== "range") {
    throw new Error("Set the Type 2 audit period before initializing audit preparation.");
  }
  if (audit.auditKind === "soc-2-type-1" && audit.coverage?.kind !== "as-of") {
    throw new Error("Set the Type 1 as-of date before initializing audit preparation.");
  }

  const model = loaded.model.auditReadiness || {};
  const auditEntry = loaded.entries.find((entry) => entry.record.id === audit.id);
  const auditRevision = createHash("sha256").update(auditEntry.source).digest("hex");
  const documents = loaded.resources.filter((record) => record.type === "document");
  const nextAudit = { ...audit };
  const linkedDocuments = [];
  const createdDocuments = [];
  const existingIds = loaded.resources.map((record) => record.id);
  try {
    for (const definition of applicableManagementDocuments(audit, model)) {
      const linked = nextAudit[definition.field]
        ? documents.find((record) => record.id === nextAudit[definition.field])
        : null;
      if (linked && linked.template !== true) continue;
      const template = linked
        || documents.find((record) => record.documentKind === definition.kind && record.template === true)
        || documents.find((record) => record.documentKind === definition.kind);
      if (!template) continue;
      const source = await primaryMarkdown(loaded, template);
      if (!source) throw new Error(`The ${definition.title} template has no Markdown content.`);
      const id = createResourceId("document", `${audit.id} ${definition.kind}`, existingIds);
      existingIds.push(id);
      const document = engagementDocument(template, definition, audit, id);
      const content = materializeManagementMarkdown(source, audit, loaded.resources);
      await createResource(loaded.root, document, { content: { content } });
      documents.push(document);
      createdDocuments.push(document);
      nextAudit[definition.field] = id;
      linkedDocuments.push(id);
    }
  } catch (error) {
    for (const document of createdDocuments.reverse()) {
      await deleteResource(loaded.root, document.type, document.id).catch(() => {});
    }
    throw error;
  }

  const existingKinds = new Set(loaded.resources
    .filter((record) => record.type === "audit-population" && record.auditId === audit.id)
    .map((record) => record.populationKind));
  const selectedControls = (audit.controlIds || [])
    .map((id) => loaded.resources.find((record) => record.id === id))
    .filter(Boolean);
  const v4 = String(loaded.model.modelVersion) === "4";
  const sourceSystems = loaded.resources.filter((record) => record.type === (v4 ? "component" : "system"));
  const populations = (audit.auditKind === "soc-2-type-2" ? model.populationTemplates || [] : [])
    .filter((template) => !existingKinds.has(template.kind))
    .map((template) => {
      const id = createResourceId(
        "audit-population",
        `${template.kind} ${audit.id}`,
        existingIds
      );
      existingIds.push(id);
      const controlIds = selectedControls
        .filter((control) => (template.controlCodes || []).includes(control.code))
        .map((control) => control.id);
      const matchingSources = sourceSystems.filter((system) => (
        (system.evidenceSourceKinds || []).includes(template.sourceKind)
      ));
      return {
        id,
        type: "audit-population",
        title: template.title,
        status: "planned",
        auditId: audit.id,
        populationKind: template.kind,
        coverage: structuredClone(audit.coverage),
        ownerIds: [...audit.ownerIds],
        ...(controlIds.length ? { controlIds } : {}),
        ...(matchingSources.length === 1 ? { [v4 ? "sourceComponentId" : "sourceSystemId"]: matchingSources[0].id } : {}),
        reconciliationSummary: `Authoritative source to confirm: ${template.sourcePrompt}. ${template.timing || ""}`.trim()
      };
    });

  try {
    if (populations.length) await createResources(loaded.root, populations);
    if (JSON.stringify(nextAudit) !== JSON.stringify(audit)) {
      await updateResource(loaded.root, "audit", audit.id, nextAudit, { expectedRevision: auditRevision });
    }
  } catch (error) {
    for (const population of populations.reverse()) {
      await deleteResource(loaded.root, population.type, population.id).catch(() => {});
    }
    for (const document of createdDocuments.reverse()) {
      await deleteResource(loaded.root, document.type, document.id).catch(() => {});
    }
    throw error;
  }
  return {
    auditId: audit.id,
    linkedDocumentIds: linkedDocuments,
    createdDocumentIds: createdDocuments.map((record) => record.id),
    createdPopulationIds: populations.map((record) => record.id)
  };
}

function scopeStage(audit, records, byId, programReadiness) {
  const items = [];
  if (!audit) {
    items.push(item(
      "formal-period",
      "later",
      "Confirm the formal report scope and period",
      "Create the engagement after selecting a CPA firm. Keep operating the management program and preserving evidence in the meantime.",
      { type: "audit" }
    ));
    return stage("period", "Confirm the Formal Period", "Record the auditor-agreed report scope and dates without overwriting management's candidate period.", items);
  }

  const periodComplete = audit.auditKind === "soc-2-type-2"
    ? audit.coverage?.kind === "range"
    : audit.auditKind === "soc-2-type-1"
      ? audit.coverage?.kind === "as-of"
      : false;
  items.push(item(
    "period",
    periodComplete ? "complete" : "action",
    "Set the auditor-agreed report type and date",
    periodComplete
      ? audit.auditKind === "soc-2-type-2"
        ? `Auditor-agreed Type 2 period: ${coverageLabel(audit.coverage)}.`
        : `Auditor-agreed Type 1 as-of date: ${coverageLabel(audit.coverage)}.`
      : audit.auditKind === "soc-2-type-1"
        ? "Set the Type 1 as-of date."
        : audit.auditKind === "soc-2-type-2"
          ? "Set the exact Type 2 start and end dates."
          : "Change this readiness record to a Type 1 or Type 2 engagement before planning the report.",
    audit
  ));
  if (audit.auditKind === "soc-2-type-2" && programReadiness.target.candidateCoverage) {
    const candidate = coverageLabel(programReadiness.target.candidateCoverage);
    const agreed = coverageLabel(audit.coverage);
    items.push(item(
      "candidate-period-comparison",
      "info",
      "Compare candidate and auditor-agreed periods",
      agreed
        ? `Management candidate: ${candidate}. Auditor agreed: ${agreed}. Preserve both sets of dates when they differ.`
        : `Management candidate: ${candidate}. The formal period remains unset until the CPA firm agrees to it.`,
      audit
    ));
  }

  const systems = (audit.systemIds || []).map((id) => byId.get(id)).filter(Boolean);
  const completeSystems = systems.filter((system) => (
    system.status === "active"
    && system.description
    && system.classificationId
    && (system.ownerIds || []).length
  ));
  items.push(item(
    "systems",
    systems.length && completeSystems.length === systems.length ? "complete" : "action",
    "Define the service boundary",
    systems.length
      ? `${completeSystems.length} of ${systems.length} selected systems are active, explicitly in scope, owned, classified, and described.`
      : "Select every in-scope service and supporting system, then describe its owner, environment, data, vendors, and boundary.",
    systems[0] || { type: "system" }
  ));

  const engagementStart = coverageStart(audit.coverage);
  const commitments = records.filter((record) => record.type === "commitment"
    && record.status === "active"
    && systems.some((system) => (record.systemIds || []).includes(system.id)));
  const completeCommitments = commitments.filter((commitment) => (
    commitment.statement
    && (commitment.ownerIds || []).length
    && commitment.effectiveOn
    && (!engagementStart || commitment.effectiveOn <= engagementStart)
    && (commitment.requirementIds || []).length
    && (commitment.controlIds || []).length
  ));
  const systemsWithoutCommitments = systems.filter((system) => !completeCommitments.some((commitment) => (
    (commitment.systemIds || []).includes(system.id)
  )));
  items.push(item(
    "commitments",
    systems.length && !systemsWithoutCommitments.length ? "complete" : "action",
    "Record commitments and system requirements",
    systems.length
      ? `${completeCommitments.length} complete active commitments cover ${systems.length - systemsWithoutCommitments.length} of ${systems.length} in-scope systems.`
      : "Record customer commitments and internal system requirements after defining the service boundary.",
    commitments[0] || { type: "commitment" }
  ));

  const frameworkRequirementIds = records
    .filter((record) => record.type === "requirement" && (audit.frameworkIds || []).includes(record.frameworkId))
    .map((record) => record.id);
  const unresolvedRequirements = frameworkRequirementIds
    .map((id) => byId.get(id))
    .filter((requirement) => (
      requirement.applicability === "undetermined"
      || (requirement.applicability === "not-applicable" && !requirement.applicabilityRationale)
    ));
  const applicableRequirementIds = frameworkRequirementIds.filter((id) => byId.get(id)?.applicability === "applicable");
  const missingApplicableRequirements = applicableRequirementIds.filter((id) => !(audit.requirementIds || []).includes(id));
  const selectedRequirements = (audit.requirementIds || []).map((id) => byId.get(id)).filter(Boolean);
  const unexpectedRequirements = selectedRequirements.filter((requirement) => (
    !(audit.frameworkIds || []).includes(requirement.frameworkId)
    || requirement.applicability !== "applicable"
  ));
  const descriptionCriteriaSelected = selectedRequirements.some((requirement) => (
    (requirement.tags || []).includes("description-criteria")
    || /^DC\d+/i.test(requirement.reference || "")
  ));
  const criteriaComplete = (audit.frameworkIds || []).length
    && (audit.requirementIds || []).length
    && (audit.controlIds || []).length
    && !unresolvedRequirements.length
    && !missingApplicableRequirements.length
    && !unexpectedRequirements.length
    && descriptionCriteriaSelected;
  items.push(item(
    "criteria",
    criteriaComplete ? "complete" : "action",
    "Confirm criteria and controls in scope",
    criteriaComplete
      ? `${audit.requirementIds.length} applicable criteria and ${audit.controlIds.length} controls are selected, with applicability resolved for the selected frameworks.`
      : unresolvedRequirements.length
        ? `Resolve applicability and record a rationale for ${unresolvedRequirements.length} selected-framework criteria.`
        : missingApplicableRequirements.length
          ? `Add ${missingApplicableRequirements.length} applicable selected-framework criteria to the engagement.`
          : unexpectedRequirements.length
            ? `Remove ${unexpectedRequirements.length} criteria that are not applicable members of the selected frameworks.`
            : !descriptionCriteriaSelected
              ? "Select the applicable SOC 2 description criteria as well as the Trust Services Criteria."
          : "Select the Security criteria, any optional Trust Services Categories, and the controls included in this report.",
    audit
  ));

  const expectedSubserviceVendorIds = new Set(systems.flatMap((system) => system.subserviceVendorIds || []));
  const missingSubserviceVendorIds = [...expectedSubserviceVendorIds].filter((id) => !(audit.subserviceVendorIds || []).includes(id));
  const inclusiveSystemIds = records
    .filter((record) => record.type === "system" && (audit.subserviceVendorIds || []).includes(record.vendorId))
    .map((record) => record.id);
  const inclusiveControlCount = (audit.controlIds || [])
    .map((id) => byId.get(id))
    .filter((control) => (control?.systemIds || []).some((id) => inclusiveSystemIds.includes(id)))
    .length;
  const subserviceComplete = Boolean(audit.subserviceMethod)
    && !((audit.subserviceVendorIds || []).length && audit.subserviceMethod === "not-applicable")
    && !missingSubserviceVendorIds.length
    && !(audit.subserviceMethod === "inclusive" && (!inclusiveSystemIds.length || !inclusiveControlCount));
  items.push(item(
    "subservices",
    subserviceComplete ? "complete" : "action",
    "Decide how subservice organizations are presented",
    subserviceComplete
      ? `${displayValue(audit.subserviceMethod)} method selected for ${(audit.subserviceVendorIds || []).length} subservice organizations${audit.subserviceMethod === "inclusive" ? `, with ${inclusiveControlCount} included controls` : ""}.`
      : missingSubserviceVendorIds.length
        ? `Add ${missingSubserviceVendorIds.length} subservice organizations already identified by the in-scope systems.`
        : audit.subserviceMethod === "inclusive"
        ? "For the inclusive method, catalog the subservice systems and include the subservice controls the auditor will examine."
      : "Identify relevant infrastructure and service providers, then agree on carve-out, inclusive, or not-applicable treatment.",
    audit
  ));

  const relevantComplementaryControls = records.filter((record) => (
    record.type === "complementary-control"
    && record.status === "active"
    && (record.systemIds || []).some((id) => (audit.systemIds || []).includes(id))
  ));
  const selectedComplementaryControls = (audit.complementaryControlIds || []).map((id) => byId.get(id)).filter(Boolean);
  const complementaryComplete = audit.complementaryControlsConclusion === "not-applicable"
    ? !relevantComplementaryControls.length
    : audit.complementaryControlsConclusion === "identified"
      && selectedComplementaryControls.length
      && selectedComplementaryControls.every((control) => (
        control.status === "active"
        && (control.systemIds || []).some((id) => (audit.systemIds || []).includes(id))
      ));
  items.push(item(
    "complementary-controls",
    complementaryComplete ? "complete" : "action",
    "Resolve customer and subservice dependencies",
    complementaryComplete
      ? audit.complementaryControlsConclusion === "identified"
        ? `${audit.complementaryControlIds.length} complementary controls are selected.`
        : "Management recorded that no complementary controls are needed for the described service."
      : audit.complementaryControlsConclusion === "not-applicable" && relevantComplementaryControls.length
        ? `${relevantComplementaryControls.length} active complementary controls apply to the in-scope systems, which conflicts with the not-applicable conclusion.`
      : "State whether customers or subservice organizations must operate complementary controls. If they do, record and select each one.",
    audit
  ));

  return stage("period", "Confirm the Formal Period", "Record the auditor-agreed report type, date or period, scope, criteria, systems, and dependency treatment.", items);
}

function programFoundationStage(programReadiness, workspace) {
  const ready = programReadiness.evidenceReady;
  return stage("program", "Program Readiness", "The management program can be prepared and operated without an audit record or CPA firm.", [
    item(
      "evidence-ready",
      ready ? "complete" : "action",
      "Reach the Evidence Ready gate",
      ready
        ? `${programReadiness.target.label} is evidence-ready. ${programReadiness.operating ? "Evidence collection is running." : "Management can begin the candidate period."}`
        : `${programReadiness.counts.action} program-readiness actions remain across scope, policies, controls, and evidence preparation.`,
      workspace || { type: "workspace" }
    )
  ]);
}

function engagementStage(audit, byId, programReadiness) {
  if (!audit) {
    return stage("engagement", "Engage the Auditor", "Select a CPA firm after the program is evidence-ready, or earlier when a customer deadline makes coordination urgent.", [
      item(
        "engagement",
        programReadiness.evidenceReady ? "action" : "later",
        "Create the CPA engagement",
        programReadiness.evidenceReady
          ? "Select the independent CPA firm, sign the engagement, then create the audit record with the firm and contacts."
          : "Finish the management program first. Early auditor engagement remains available when a customer deadline requires it.",
        { type: "audit" }
      )
    ]);
  }
  const auditor = audit.auditorVendorId ? byId.get(audit.auditorVendorId) : null;
  const named = Boolean(auditor);
  const currentOwners = [...currentPartyPeople(audit.ownerIds, byId)]
    .map((id) => byId.get(id))
    .filter(Boolean);
  return stage("engagement", "Engage the Auditor", "Record the independent CPA firm and the current management owner who authorizes and coordinates the engagement.", [
    item(
      "engagement-record",
      "complete",
      "Create the engagement record",
      `${audit.title} tracks the formal scope, dates, requests, fieldwork, and report.`,
      audit
    ),
    item(
      "auditor",
      named ? "complete" : "action",
      "Record the independent CPA firm",
      named
        ? `${auditor.title} is recorded for the engagement.`
        : "Select the CPA firm and record it here. The independent management policy reviewer is a different role.",
      audit
    ),
    item(
      "engagement-owner",
      currentOwners.length ? "complete" : "action",
      "Confirm the management engagement owner",
      currentOwners.length
        ? `${currentOwners.map(({ title }) => title).join(" and ")} currently owns management coordination for the engagement.`
        : "Assign the audit to a current Person, Team, or Appointment. The audit owner may coordinate management and evidence work without a separate audit-specific title.",
      audit,
      {
        commands: [
          `npx filegrc get ${audit.id} --mutation`,
          "npx filegrc audit-readiness AUDIT_ID --json"
        ]
      }
    )
  ]);
}

function fieldworkStage(audit, sections) {
  if (!audit) {
    return stage("fieldwork", "Prepare Fieldwork", "Build engagement-specific documents, exact-period evidence, and Type 2 populations after the firm and period are recorded.", [
      item("fieldwork-later", "later", "Prepare engagement-specific fieldwork", "This work starts after the CPA engagement and formal period exist.", { type: "audit" })
    ]);
  }
  const items = sections.flatMap((section) => section.items.map((current) => ({
    ...current,
    id: `${section.id}-${current.id}`,
    section: section.title
  })));
  return stage(
    "fieldwork",
    "Prepare Fieldwork",
    "Complete management documents, exact-period operating evidence, and Type 2 population reconciliations for the engagement.",
    items
  );
}

async function documentsStage(loaded, audit, byId) {
  const definitions = applicableManagementDocuments(audit, loaded.model.auditReadiness || {});
  const items = [];
  for (const definition of definitions) {
    const document = audit?.[definition.field] ? byId.get(audit[definition.field]) : null;
    const source = document ? await primaryMarkdown(loaded, document) : "";
    const contentIssues = managementDocumentContentIssues(source, definition, audit);
    const engagementEnd = coverageEnd(audit?.coverage);
    if (document?.approvedOn && engagementEnd && document.approvedOn < engagementEnd) {
      contentIssues.push(`Approve the final document on or after the engagement ${audit.auditKind === "soc-2-type-1" ? "date" : "period end"}.`);
    }
    if (definition.kind === "soc2-period-completeness" && document?.approvedOn && audit) {
      const latestReconciliation = loaded.resources
        .filter((record) => record.type === "audit-population" && record.auditId === audit.id)
        .map((record) => record.reconciledOn)
        .filter(Boolean)
        .sort()
        .at(-1);
      if (latestReconciliation && document.approvedOn < latestReconciliation) {
        contentIssues.push("Approve the period completeness statement after the last population reconciliation.");
      }
    }
    if (definition.kind === "soc2-management-representation" && document) {
      const signedEvidence = (document.evidenceIds || [])
        .map((id) => byId.get(id))
        .find((record) => (
          record?.type === "evidence"
          && record.status === "verified"
          && (record.filePaths || []).length
        ));
      if (!signedEvidence) contentIssues.push("Link a verified fixed-format copy of the signed representation letter as evidence.");
      else if (!signedEvidence.collectedOn || (engagementEnd && signedEvidence.collectedOn < engagementEnd)) {
        contentIssues.push(`The signed representation must be dated on or after the engagement ${audit.auditKind === "soc-2-type-1" ? "date" : "period end"}.`);
      }
    }
    const complete = Boolean(
      document
      && document.type === "document"
      && document.template !== true
      && document.status === "active"
      && document.approvedOn
      && document.effectiveOn
      && (document.ownerIds || []).length
      && (document.approverIds || []).length
      && partiesIndependent(document.ownerIds, document.approverIds, byId)
      && source
      && !contentIssues.length
    );
    const representationLater = definition.kind === "soc2-management-representation"
      && audit
      && !["fieldwork", "complete"].includes(audit.status);
    items.push(item(
      definition.kind,
      complete ? "complete" : representationLater ? "later" : "action",
      definition.title,
      complete
        ? "Linked Markdown is complete, active, approved, and effective."
        : document
          ? `${definition.timing} ${contentIssues[0] || "Complete and approve the engagement-specific document."}`
          : `Link the starter ${definition.title.toLowerCase()} to this audit. ${definition.timing}`,
      document || { type: "document" }
    ));
  }
  return stage("documents", "Management Documents", "Prepare management's description, assertions, completeness work, and closing representations.", items);
}

function evidenceStage(audit, records, byId, model) {
  const controls = (audit?.controlIds || []).map((id) => byId.get(id)).filter(Boolean);
  const evidence = records.filter((record) => record.type === "evidence");
  const externalEvidence = evidence.filter((record) => (
    record.status === "verified"
    && (record.artifactKind !== "rendered-page" || record.sourceCommit)
    && evidenceRelevantToAuditDate(record, audit)
  ));
  const managedFamilies = (model.evidenceSourceFamilies || []).filter((family) => family.filegrcManaged === true);
  const externalFamilies = (model.evidenceSourceFamilies || []).filter((family) => family.filegrcManaged !== true);
  const evidenceFamiliesFor = (control) => (model.evidenceSourceFamilies || []).filter((family) => (
    (family.controlCodes || []).includes(control.code)
  ));
  const filegrcRecords = records.filter((record) => (
    !NON_EVIDENCE_RECORD_TYPES.has(record.type)
    && controlIdsForRecord(record, byId).size
    && recordRelevantToAuditDate(record, audit, model)
  ));
  const reconciledZeroPopulationControlIds = new Set(records
    .filter((record) => (
      record.type === "audit-population"
      && record.auditId === audit.id
      && record.status === "reconciled"
      && record.conclusion === "complete"
      && byId.get(record.sourceEvidenceId)?.populationCount === 0
    ))
    .flatMap((record) => record.controlIds || []));
  const managedControls = controls.filter((control) => managedFamilies.some((family) => (
    (family.controlCodes || []).includes(control.code)
  )));
  const controlsWithFilegrcRecords = managedControls.filter((control) => filegrcRecords.some((record) => (
    controlIdsForRecord(record, byId).has(control.id)
  )) || reconciledZeroPopulationControlIds.has(control.id));
  const externalControls = controls.filter((control) => externalFamilies.some((family) => (
    (family.controlCodes || []).includes(control.code)
  )) || !evidenceFamiliesFor(control).length);
  const controlsWithExternalEvidence = externalControls.filter((control) => externalEvidence.some((record) => (
    controlIdsForRecord(record, byId).has(control.id)
  )));
  const items = [
    item(
      "filegrc-evidence",
      managedControls.length && controlsWithFilegrcRecords.length === managedControls.length ? "complete" : managedControls.length ? "action" : "info",
      "Review filegrc Evidence",
      managedControls.length
        ? `${controlsWithFilegrcRecords.length} of ${managedControls.length} selected controls that use filegrc workflows have a dated operating record or reconciled zero-event population for the formal period. Complete each Step 4 record, link it to the control, and add results in its structured fields or Markdown.`
        : "No selected controls use a dedicated filegrc operating record.",
      filegrcRecords[0] || { type: managedFamilies[0]?.operationRecordTypes?.[0] || "control" }
    ),
    item(
      "external-evidence",
      externalControls.length && controlsWithExternalEvidence.length === externalControls.length ? "complete" : externalControls.length ? "action" : "info",
      "Review Evidence Artifacts",
      externalControls.length
        ? `${controlsWithExternalEvidence.length} of ${externalControls.length} selected controls that rely on external Components have verified Evidence Artifacts for the formal period. Confirm the source Component, date or period, control links, collector, verifier, and retained artifact or approved external reference.`
        : "No selected controls require a separate Evidence Artifact.",
      externalEvidence[0] || { type: "evidence" }
    )
  ];
  const v4 = String(model.modelVersion) === "4";
  const systems = records.filter((record) => record.type === (v4 ? "component" : "system") && record.status === "active");
  const sourceId = (record) => v4 ? record.sourceComponentId : record.sourceSystemId;
  for (const source of model.evidenceSourceFamilies || []) {
    const relevantControls = controls.filter((control) => (source.controlCodes || []).includes(control.code));
    if (!relevantControls.length) {
      items.push(item(
        `source-${source.id}`,
        "info",
        source.title,
        `No mapped controls from this source category are selected. ${source.timing}`
      ));
      continue;
    }
    if (source.filegrcManaged === true) {
      const sourceRecords = filegrcRecords.filter((record) => (
        relevantControls.some((control) => controlIdsForRecord(record, byId).has(control.id))
      ));
      const coveredControls = relevantControls.filter((control) => sourceRecords.some((record) => (
        controlIdsForRecord(record, byId).has(control.id)
      )) || reconciledZeroPopulationControlIds.has(control.id));
      const zeroPopulationControls = relevantControls.filter((control) => (
        reconciledZeroPopulationControlIds.has(control.id)
      ));
      items.push(item(
        `filegrc-${source.id}`,
        coveredControls.length === relevantControls.length ? "complete" : "action",
        source.title,
        coveredControls.length === relevantControls.length
          ? `${sourceRecords.length} dated filegrc ${sourceRecords.length === 1 ? "record" : "records"} and ${zeroPopulationControls.length} reconciled zero-population ${zeroPopulationControls.length === 1 ? "conclusion cover" : "conclusions cover"} ${relevantControls.length} mapped controls. Supporting artifacts are linked from the operating records or population export.`
          : `${coveredControls.length} of ${relevantControls.length} mapped controls have a dated ${source.operationRecordTypes.map(displayValue).join(" or ")} record for the formal period. Complete the Step 4 work and attach or reference any supporting external artifact on that record.`,
        sourceRecords[0] || { type: source.operationRecordTypes[0] }
      ));
      continue;
    }
    const sourceSystems = systems.filter((system) => (
      (system.evidenceSourceKinds || []).some((kind) => (source.sourceKinds || []).includes(kind))
    ));
    const coveredControls = relevantControls.filter((control) => externalEvidence.some((record) => (
      sourceSystems.some((system) => system.id === sourceId(record))
      && controlIdsForRecord(record, byId).has(control.id)
    )));
    const status = sourceSystems.length && coveredControls.length === relevantControls.length ? "complete" : "action";
    const message = !sourceSystems.length
      ? `${source.description} Add the authoritative systems to Systems and assign these evidence source roles: ${(source.sourceKinds || []).map(displayValue).join(", ")}. ${source.timing}`
      : coveredControls.length !== relevantControls.length
        ? `${sourceSystems.map((system) => system.title).join(", ")} ${sourceSystems.length === 1 ? "is" : "are"} cataloged, but verified source evidence covers ${coveredControls.length} of ${relevantControls.length} mapped controls. ${source.timing}`
        : `${sourceSystems.map((system) => system.title).join(", ")} provide verified source evidence for ${relevantControls.length} mapped controls. ${source.timing}`;
    items.push(item(
      `source-${source.id}`,
      status,
      source.title,
      message,
      externalEvidence.find((record) => sourceSystems.some((system) => system.id === sourceId(record)))
        || sourceSystems[0]
        || { type: v4 ? "component" : "system" }
    ));
  }
  return stage("evidence", "Audit Evidence", `Review both evidence paths: dated filegrc operating records and verified ${v4 ? "Evidence Artifacts from authoritative Components" : "External Evidence from authoritative systems"}. filegrc includes both in the audit packet.`, items);
}

function populationsStage(audit, records, byId, model) {
  if (audit && audit.auditKind !== "soc-2-type-2") {
    return stage(
      "populations",
      "Population Completeness",
      "Complete period populations apply to Type 2 operating-effectiveness testing.",
      [item("type-2-only", "info", "No Type 2 population plan required", "A Type 1 report evaluates design and implementation as of one date. The auditor may still request specific inventories or evidence.")]
    );
  }
  const populations = audit
    ? records.filter((record) => record.type === "audit-population" && record.auditId === audit.id)
    : [];
  const templates = model.auditReadiness?.populationTemplates || [];
  const items = templates.map((template) => {
    const population = populations.find((record) => record.populationKind === template.kind);
    const result = populationResult(population, audit, byId);
    return item(
      `population-${template.kind}`,
      result.status,
      template.title,
      result.message || `Use ${template.sourcePrompt} as the starting point, then record the exact authoritative source.`,
      population || { type: "audit-population" }
    );
  });
  return stage(
    "populations",
    "Population Completeness",
    "Management reconciles complete populations for the exact period. A zero count still needs a source export and recorded query.",
    items
  );
}

function auditorStage() {
  return stage("auditor", "Fieldwork and Report", "filegrc prepares the record set but does not make the CPA firm's independent judgments.", [
    item("firm-eligibility", "external", "Firm eligibility and independence", "Confirm directly with the engagement partner that the firm and signing practitioner meet applicable licensing, peer-review, ethics, and independence requirements. Keep the signed engagement terms with the audit record if management needs a copy."),
    item("sampling", "external", "Sample selection and independent testing", "The auditor chooses samples, performs tests, evaluates exceptions, and decides whether more work is needed."),
    item("report", "external", "Report and opinion", "Management reviews and signs its representations. The auditor issues the final report and opinion."),
    item("criteria", "external", "Authoritative criteria and examination guidance", "filegrc stores reference IDs and orientation text. Use the publisher's current official criteria and the engagement team's examination guidance for scope, evaluation, and reporting.")
  ]);
}

function populationResult(population, audit, byId) {
  if (!population) return { status: "action", message: "Initialize this population for the engagement." };
  if (!coverageMatches(
    population.coverage,
    coverageStart(audit?.coverage),
    coverageEnd(audit?.coverage)
  )) {
    return { status: "action", message: "The population period does not match the exact audit period." };
  }
  if (population.status === "not-applicable") {
    if ((population.controlIds || []).length) {
      return { status: "action", message: "This population is linked to in-scope controls, so it cannot be marked not applicable. Reconcile it or remove the incorrect control links." };
    }
    return population.notApplicableReason
      ? { status: "complete", message: `Not applicable: ${population.notApplicableReason}` }
      : { status: "action", message: "Document why this population does not apply." };
  }
  if (population.status !== "reconciled") {
    return { status: "action", message: `${displayValue(population.status)}. Export and reconcile the complete population, even when its count is zero.` };
  }
  const evidence = byId.get(population.sourceEvidenceId);
  const requiredEvidence = [
    "generatedAt",
    "timezone",
    "queryDescription",
    "populationCount",
    "completenessValidation",
    "accuracyValidation"
  ];
  const evidenceComplete = evidence
    && evidence.type === "evidence"
    && evidence.artifactKind === "population-export"
    && evidence.status === "verified"
    && (population.sourceComponentId || population.sourceSystemId)
    && (evidence.sourceComponentId || evidence.sourceSystemId) === (population.sourceComponentId || population.sourceSystemId)
    && coverageMatches(
      evidence.coverage,
      coverageStart(audit.coverage),
      coverageEnd(audit.coverage)
    )
    && requiredEvidence.every((field) => evidence[field] !== undefined && evidence[field] !== null && evidence[field] !== "");
  const reconciliationComplete = (population.reconciledByIds || []).length
    && population.reconciledOn
    && ["complete", "complete-with-exceptions"].includes(population.conclusion)
    && (population.conclusion !== "complete-with-exceptions" || population.reconciliationSummary);
  const generatedOn = timestampDate(evidence?.generatedAt, evidence?.timezone);
  const sequenceComplete = Number.isInteger(evidence?.populationCount)
    && evidence.populationCount >= 0
    && generatedOn > coverageEnd(audit.coverage)
    && population.reconciledOn >= generatedOn;
  if (!evidenceComplete || !reconciliationComplete || !sequenceComplete) {
    return { status: "action", message: "Finish the reconciliation and link a verified population export with its exact query, timezone, count, completeness check, and accuracy check." };
  }
  return {
    status: "complete",
    message: `${evidence.populationCount} items reconciled from ${evidence.sourceDescription || "the authoritative source"}${population.conclusion === "complete-with-exceptions" ? " with documented exceptions" : ""}.`
  };
}

function timestampDate(value, timezone) {
  if (!value || !timezone) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(instant);
    const fields = Object.fromEntries(parts.map(({ type, value: item }) => [type, item]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch {
    return null;
  }
}

async function primaryMarkdown(loaded, record) {
  const definition = loaded.model.resources[record.type];
  const item = markdownEntries(loaded.model, record).find((entry) => (
    definition.markdown?.[entry.name]?.primary || entry.name === loaded.model.recordContent?.slot
  ));
  if (!item) return "";
  try {
    return await readFile(resolveDataPath(loaded.root, item.path), "utf8");
  } catch {
    return "";
  }
}

function initializationNeeded(audit, records, model) {
  const readiness = model.auditReadiness || {};
  const needsDocumentLink = applicableManagementDocuments(audit, readiness)
    .some((definition) => {
      const linked = records.find((record) => record.id === audit[definition.field]);
      return (!linked || linked.template === true) && records.some((record) => (
        record.type === "document" && record.documentKind === definition.kind
      ));
    });
  const populationKinds = new Set(records
    .filter((record) => record.type === "audit-population" && record.auditId === audit.id)
    .map((record) => record.populationKind));
  const needsPopulation = audit.auditKind === "soc-2-type-2" && (readiness.populationTemplates || [])
    .some((template) => !populationKinds.has(template.kind));
  return needsDocumentLink || needsPopulation;
}

function applicableManagementDocuments(audit, readiness) {
  return (readiness.managementDocuments || []).filter((definition) => (
    !audit || !definition.engagementKinds?.length || definition.engagementKinds.includes(audit.auditKind)
  ));
}

function evidenceOverlaps(record, start, end) {
  return coverageOverlaps(record.coverage, start, end)
    || (record.collectedOn && record.collectedOn >= start && record.collectedOn <= end);
}

function evidenceRelevantToAuditDate(record, audit) {
  if (!audit) return false;
  if (audit.auditKind === "soc-2-type-1") {
    const date = coverageStart(audit.coverage);
    return Boolean(date) && (
      coverageContains(record.coverage, date)
      || record.collectedOn === date
    );
  }
  const start = coverageStart(audit.coverage);
  const end = coverageEnd(audit.coverage);
  return Boolean(start && end) && evidenceOverlaps(record, start, end);
}

function recordRelevantToAuditDate(record, audit, model) {
  if (!audit) return false;
  const start = coverageStart(audit.coverage);
  const end = coverageEnd(audit.coverage);
  if (!start || !end) return false;
  if (coverageOverlaps(record.coverage, start, end)) return true;
  const definition = model.resources[record.type];
  const fields = { ...model.commonFields, ...(definition?.fields || {}) };
  return Object.entries(fields).some(([name, field]) => {
    const value = record[name];
    if (field.type === "date") return value >= start && value <= end;
    if (field.type === "timestamp" && typeof value === "string") {
      const date = value.slice(0, 10);
      return date >= start && date <= end;
    }
    return false;
  });
}

function controlIdsForRecord(record, byId, seen = new Set()) {
  const ids = new Set();
  if (!record || seen.has(record.id)) return ids;
  seen.add(record.id);
  if (record.type === "control") ids.add(record.id);
  for (const id of record.controlIds || []) ids.add(id);
  if (record.controlId) ids.add(record.controlId);
  if (record.obligationId) {
    for (const id of byId.get(record.obligationId)?.controlIds || []) ids.add(id);
  }
  for (const candidate of byId.values()) {
    if (
      candidate.type === "obligation"
      && (candidate.completionResourceIds || []).includes(record.id)
    ) {
      for (const id of candidate.controlIds || []) ids.add(id);
    }
  }
  for (const subjectId of record.subjectResourceIds || []) {
    for (const id of controlIdsForRecord(byId.get(subjectId), byId, seen)) ids.add(id);
  }
  for (const sourceId of record.sourceResourceIds || []) {
    for (const id of controlIdsForRecord(byId.get(sourceId), byId, seen)) ids.add(id);
  }
  if (record.sourceResourceId) {
    for (const id of controlIdsForRecord(byId.get(record.sourceResourceId), byId, seen)) ids.add(id);
  }
  return ids;
}

function hasMeaningfulValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).some((item) => (
    typeof item === "string" ? item.trim() : item && typeof item === "object" ? hasMeaningfulValue(item) : false
  ));
}

function containsOpenPlaceholder(source) {
  return /\[[^\]\n]{2,}\](?!\()/u.test(source);
}

function managementDocumentContentIssues(source, definition, audit) {
  if (!source) return ["Add the required Markdown content."];
  if (containsOpenPlaceholder(source)) return ["Replace every bracketed preparation placeholder before approval."];
  const words = source.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  if (definition.minimumWords && words.length < definition.minimumWords) {
    return [`Add substantive content; this document has ${words.length} words and the preparation check expects at least ${definition.minimumWords}.`];
  }
  const missingHeadings = (definition.requiredHeadings || []).filter((heading) => (
    !new RegExp(`^#{1,6}\\s+.*\\b${escapeRegExp(heading)}\\b`, "imu").test(source)
  ));
  if (missingHeadings.length) return [`Add the missing description sections: ${missingHeadings.join(", ")}.`];
  if (definition.dateBinding === "engagement" && audit) {
    const dates = [coverageStart(audit.coverage), coverageEnd(audit.coverage)];
    if (dates.some((date) => date && !source.includes(date))) {
      return ["Name the exact engagement date or period in the document."];
    }
  }
  return [];
}

function engagementDocument(template, definition, audit, id) {
  const {
    approvedOn,
    effectiveOn,
    evidenceIds,
    id: ignoredId,
    status: ignoredStatus,
    supersedesId,
    template: ignoredTemplate,
    title: ignoredTitle,
    ...shared
  } = template;
  return {
    ...shared,
    id,
    title: `${audit.title}: ${definition.title}`,
    status: "draft",
    ownerIds: [...audit.ownerIds],
    ...(audit.systemIds?.length ? { systemIds: [...audit.systemIds] } : {}),
    version: "0.1"
  };
}

function materializeManagementMarkdown(source, audit, records) {
  const keep = audit.auditKind === "soc-2-type-1" ? "type-1" : "type-2";
  const discard = keep === "type-1" ? "type-2" : "type-1";
  const withoutDiscarded = source.replace(
    new RegExp(`<!-- ${discard}:start -->[\\s\\S]*?<!-- ${discard}:end -->\\s*`, "g"),
    ""
  );
  const systems = (audit.systemIds || [])
    .map((id) => records.find((record) => record.id === id)?.title)
    .filter(Boolean)
    .join(", ");
  const categoryTags = new Set(["security", "availability", "processing-integrity", "confidentiality", "privacy"]);
  const categories = [...new Set((audit.requirementIds || [])
    .flatMap((id) => records.find((record) => record.id === id)?.tags || [])
    .filter((tag) => categoryTags.has(tag))
    .map(displayValue))]
    .join(", ");
  const period = audit.auditKind === "soc-2-type-1"
    ? coverageStart(audit.coverage) || "[as-of date]"
    : coverageStart(audit.coverage) && coverageEnd(audit.coverage)
      ? coverageLabel(audit.coverage)
      : "[start date] through [end date]";
  return withoutDiscarded
    .replaceAll(`<!-- ${keep}:start -->`, "")
    .replaceAll(`<!-- ${keep}:end -->`, "")
    .replaceAll("[as-of date]", coverageStart(audit.coverage) || "[as-of date]")
    .replaceAll("[start date]", coverageStart(audit.coverage) || "[start date]")
    .replaceAll("[end date]", coverageEnd(audit.coverage) || "[end date]")
    .replaceAll("[engagement date or period]", period)
    .replaceAll("[engagement scope]", audit.scope || "[engagement scope]")
    .replaceAll("[in-scope systems]", systems || "[in-scope systems]")
    .replaceAll("[selected categories]", categories || "[selected categories]")
    .replaceAll(
      "[Carve-out, inclusive, or not applicable]",
      audit.subserviceMethod ? displayValue(audit.subserviceMethod) : "[Carve-out, inclusive, or not applicable]"
    );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function auditSummary(audit) {
  return {
    id: audit.id,
    title: audit.title,
    status: audit.status,
    kind: audit.auditKind,
    coverage: audit.coverage || null
  };
}

function stage(id, title, description, items) {
  return { id, title, description, items };
}

function item(id, status, title, message, resource = {}) {
  return {
    id,
    status,
    title,
    message,
    ...(resource.type ? { resourceType: resource.type } : {}),
    ...(resource.id ? { resourceId: resource.id } : {})
  };
}

function countStatuses(items) {
  const counts = { complete: 0, action: 0, later: 0, external: 0, info: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

function displayValue(value) {
  return String(value || "not started").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
