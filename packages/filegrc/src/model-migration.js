import { createResourceId } from "./id.js";
import { applyResourceBatch, contentRevision } from "./files.js";
import { loadWorkspace } from "./workspace.js";
import { loadModel } from "../model/index.js";
import { legacyCoverage } from "./coverage.js";
import { readFile } from "node:fs/promises";
import { resolveDataPath } from "./paths.js";
import { markdownEntries } from "./resource-markdown.js";

const TARGET_MODEL_VERSION = "2";
const EXTENSION_NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const LEGACY_POLICY_OWNER_ROLE = "Policy Owner";
const ACCOUNTABILITY_FIELDS = new Set(["ownerIds", "evidenceOwnerIds"]);
const OWNER_RESOURCE_TYPES = new Set([
  "service-account", "system", "asset", "document", "obligation", "obligation-event",
  "commitment", "control", "finding", "exception", "policy", "training", "risk", "vendor",
  "vulnerability", "incident", "penetration-test", "data-request", "audit",
  "audit-population", "audit-request"
]);
const CADENCE_MIGRATIONS = new Map([
  ["team:meetingCadence", {
    activityType: "oversight-meeting",
    relation: "scope"
  }],
  ["document:reviewCadence", {
    activityType: "document-review",
    relation: "template"
  }],
  ["exception:reviewCadence", {
    activityType: "exception-review",
    relation: "scope"
  }],
  ["policy:reviewCadence", {
    activityType: "policy-review",
    relation: "template"
  }],
  ["training:recurrence", {
    activityType: "training",
    relation: "template"
  }],
  ["risk:reviewCadence", {
    activityType: "risk-assessment",
    relation: "scope"
  }],
  ["vendor:reviewCadence", {
    activityType: "vendor-review",
    relation: "scope"
  }]
]);
const STAGE_PAGE_ID_MIGRATIONS = new Map([
  ["scope:complementary-control", "controls:complementary-control"]
]);

export async function planModelMigration(input = process.cwd(), options = {}) {
  const loaded = await loadWorkspace(input);
  if (!loaded.workspace || !Object.hasOwn(loaded.workspace, "dataModelVersion")) {
    throw new Error("Model migration requires the Workspace record to declare dataModelVersion.");
  }
  const sourceVersion = String(loaded.workspace.dataModelVersion);
  if (sourceVersion === TARGET_MODEL_VERSION) {
    return emptyPlan(sourceVersion);
  }
  if (sourceVersion !== "1") {
    throw new Error(`Model migration supports v1 workspaces, not v${sourceVersion}.`);
  }
  if (!loaded.workspace?.id) throw new Error("Model migration requires a valid Workspace record.");

  const byId = new Map(loaded.resources.map((record) => [record.id, record]));
  const revisionById = new Map(loaded.entries.map((entry) => [
    entry.record.id,
    contentRevision(entry.source)
  ]));
  const updateById = new Map();
  const create = [];
  const missing = [];
  const conflicts = [];
  const manualActions = [];
  const notes = [];
  const usedIds = loaded.resources.map(({ id }) => id);
  const policyOwnerCount = loaded.resources.filter((record) => (
    record.type === "person"
    && String(record.role || "").trim() === LEGACY_POLICY_OWNER_ROLE
  )).length;

  const editable = (record) => {
    if (!record) return null;
    if (!updateById.has(record.id)) updateById.set(record.id, structuredClone(record));
    return updateById.get(record.id);
  };
  const addIds = (record, field, ids) => {
    const current = Array.isArray(record[field]) ? record[field] : [];
    record[field] = [...new Set([...current, ...ids])];
  };

  for (const record of loaded.resources) {
    if (Object.hasOwn(record, "schemaVersion")) delete editable(record).schemaVersion;
    if (Array.isArray(record.ownerIds) && !OWNER_RESOURCE_TYPES.has(record.type)) {
      manualActions.push({
        resourceId: record.id,
        field: "ownerIds",
        value: record.ownerIds,
        message: `Model v2 does not define generic ownership for ${record.type}. Move these IDs to the type-specific accountable, performer, reviewer, collector, or approver field, then remove ownerIds.`
      });
    }
  }

  const workspace = editable(loaded.workspace);
  const scopedSystemIds = new Set(workspace.systemIds || []);
  for (const system of loaded.resources.filter(({ type }) => type === "system")) {
    if (system.inScope === true) scopedSystemIds.add(system.id);
    if (Object.hasOwn(system, "inScope")) delete editable(system).inScope;
  }
  workspace.systemIds = [...scopedSystemIds];
  delete workspace.repositoryUrl;

  const classificationIds = migrateClassificationDefinitions(
    workspace,
    loaded.workspace.classificationDefinitions,
    conflicts
  );
  for (const record of loaded.resources) {
    const oldField = Object.hasOwn(record, "dataClassification")
      ? "dataClassification"
      : Object.hasOwn(record, "classification")
        ? "classification"
        : null;
    if (!oldField) continue;
    const migrated = editable(record);
    const classificationId = resolveClassificationId(record[oldField], classificationIds);
    if (classificationId) migrated.classificationId = classificationId;
    else {
      manualActions.push({
        resourceId: record.id,
        field: oldField,
        value: record[oldField],
        message: "Map this value to one of the Workspace classificationDefinitions IDs and store it as classificationId."
      });
    }
    delete migrated[oldField];
  }

  migrateCoverageFields(workspace, loaded.workspace, {
    target: "candidateCoverage",
    asOfFields: ["candidateTypeOneAsOf"],
    startFields: ["candidatePeriodStart"],
    endFields: ["candidatePeriodEnd"]
  }, missing, manualActions);
  for (const record of loaded.resources) {
    const settings = coverageMigrationSettings(record);
    if (settings) migrateCoverageFields(editable(record), record, settings, missing, manualActions);
    if (record.type === "evidence" && record.capture && typeof record.capture === "object") {
      const capture = structuredClone(record.capture);
      migrateCoverageFields(capture, record.capture, {
        target: "coverage",
        startFields: ["periodStart"],
        endFields: ["periodEnd"]
      }, missing, manualActions, record.id, "capture.");
      editable(record).capture = capture;
    }
  }

  for (const person of loaded.resources.filter(({ type }) => type === "person")) {
    const migratedPerson = editable(person);
    migratedPerson.affiliation = person.status === "external" ? "external" : "internal";
    if (person.status === "external") migratedPerson.status = "active";
    if (Array.isArray(person.teamIds)) {
      for (const teamId of person.teamIds) {
        const team = byId.get(teamId);
        if (team?.type !== "team") {
          conflicts.push({
            resourceId: person.id,
            field: "teamIds",
            message: `Team "${teamId}" was not found.`
          });
          continue;
        }
        addIds(editable(team), "memberIds", [person.id]);
      }
      delete editable(person).teamIds;
    }

    const role = String(person.role || "").trim();
    if (!role) continue;
    if (role !== LEGACY_POLICY_OWNER_ROLE) {
      if (String(person.jobTitle || "").trim() === role) {
        delete editable(person).role;
      } else {
        manualActions.push({
          resourceId: person.id,
          field: "role",
          value: role,
          message: "Set the actual organization jobTitle and create any named Appointment this value represented, then remove role."
        });
      }
      continue;
    }

    const existingAppointment = loaded.resources.find((record) => (
      record.type === "appointment"
      && record.appointmentKind === "policy-owner"
      && record.holderId === person.id
      && record.status === "active"
    ));
    const appointment = existingAppointment || {
      id: createResourceId("appointment", "Policy Owner", [...usedIds, ...create.map(({ id }) => id)]),
      type: "appointment",
      title: "Policy Owner",
      status: "active",
      appointmentKind: "policy-owner",
      holderId: person.id,
      scopeResourceIds: [loaded.workspace.id],
      ...(options.startsOn ? { startsOn: options.startsOn } : {}),
      responsibilities: "Own the information security program and the records that reference this Appointment."
    };
    if (!existingAppointment) create.push(appointment);
    const jobTitle = person.jobTitle || (policyOwnerCount === 1 ? options.jobTitle : undefined);
    if (!jobTitle) missing.push({ resourceId: person.id, field: "jobTitle" });
    if (!existingAppointment && !options.startsOn) {
      missing.push({ resourceId: person.id, field: "startsOn" });
    }
    if (jobTitle) migratedPerson.jobTitle = jobTitle;
    delete migratedPerson.role;

    for (const record of loaded.resources) {
      for (const field of ACCOUNTABILITY_FIELDS) {
        if (!Array.isArray(record[field]) || !record[field].includes(person.id)) continue;
        editable(record)[field] = record[field].map((id) => id === person.id ? appointment.id : id);
      }
    }
  }

  const targetModel = loadModel(TARGET_MODEL_VERSION);
  for (const record of loaded.resources.filter((candidate) => approvalBound(candidate))) {
    const migrated = editable(record);
    const revisions = {};
    for (const item of markdownEntries(targetModel, migrated)) {
      try {
        revisions[item.path] = contentRevision(await readFile(resolveDataPath(loaded.root, item.path), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    migrated.approvedContentRevisions = revisions;
    notes.push({
      resourceId: record.id,
      message: "Bound the existing approval to the current companion Markdown revisions. Confirm that these are the revisions the recorded approvers approved."
    });
  }
  for (const attestation of loaded.resources.filter((candidate) => (
    candidate.type === "attestation"
    && candidate.status === "completed"
    && candidate.attestationMethod === "git-approval"
  ))) {
    const migrated = editable(attestation);
    const revisions = {};
    for (const id of attestation.subjectResourceIds || []) {
      const subject = updateById.get(id) || byId.get(id);
      if (!subject) continue;
      for (const item of markdownEntries(targetModel, subject)) {
        try {
          revisions[item.path] = contentRevision(
            await readFile(resolveDataPath(loaded.root, item.path), "utf8")
          );
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    migrated.contentRevisions = revisions;
    notes.push({
      resourceId: attestation.id,
      message: "Bound the completed git approval to the current subject Markdown revisions. Confirm that these are the revisions the named person attested to."
    });
  }

  for (const obligation of loaded.resources.filter(({ type }) => type === "obligation")) {
    const migrated = editable(obligation);
    delete migrated.completionResourceTypes;
    const activity = targetModel.obligationActivities?.[obligation.activityType];
    if (!activity) {
      manualActions.push({
        resourceId: obligation.id,
        field: "activityType",
        value: obligation.activityType,
        message: "Choose a registered model-v2 obligation activity type."
      });
    } else {
      if (!activity.recurrenceModes.includes(obligation.recurrence?.mode)) {
        manualActions.push({
          resourceId: obligation.id,
          field: "recurrence.mode",
          value: obligation.recurrence?.mode,
          message: `${obligation.activityType} requires ${activity.recurrenceModes.join(" or ")} recurrence in model v2.`
        });
      }
      for (const [field, ids] of [
        ["scopeResourceIds", obligation.scopeResourceIds || []],
        ["templateResourceId", obligation.templateResourceId ? [obligation.templateResourceId] : []]
      ]) {
        const invalid = ids.filter((id) => {
          const target = byId.get(id);
          return target && !activity.scopeResourceTypes.includes(target.type);
        });
        if (invalid.length) {
          manualActions.push({
            resourceId: obligation.id,
            field,
            value: invalid,
            message: `${obligation.activityType} scope must reference ${activity.scopeResourceTypes.join(" or ")} records in model v2.`
          });
        }
      }
    }
    if (obligation.recurrence?.mode === "event" && !targetModel.policyEvents?.[obligation.recurrence.eventType]) {
      manualActions.push({
        resourceId: obligation.id,
        field: "recurrence.eventType",
        value: obligation.recurrence.eventType,
        message: "Choose a registered model-v2 Policy Event type."
      });
    }
    if (obligation.window) {
      const window = migrateObligationWindow(obligation.window);
      if (window) migrated.window = window;
      else {
        manualActions.push({
          resourceId: obligation.id,
          field: "window",
          value: obligation.window,
          message: "Choose either date precision with day offsets or timestamp precision with hour offsets, then set startsAfter and dueAfter."
        });
      }
    } else if (obligation.recurrence?.mode === "event") {
      missing.push({ resourceId: obligation.id, field: "window" });
    }
  }

  for (const eventRecord of loaded.resources.filter(({ type }) => type === "obligation-event")) {
    const event = targetModel.policyEvents?.[eventRecord.eventType];
    if (!event) continue;
    const counts = new Map();
    const invalid = [];
    const allowed = new Set(event.subjectRules.map(({ resourceType }) => resourceType));
    for (const id of new Set(eventRecord.subjectResourceIds || [])) {
      const target = byId.get(id);
      if (!target) continue;
      counts.set(target.type, (counts.get(target.type) || 0) + 1);
      if (!allowed.has(target.type)) invalid.push(id);
    }
    const cardinalityInvalid = event.subjectRules.some(({ resourceType, minimum = 0, maximum }) => {
      const count = counts.get(resourceType) || 0;
      return count < minimum || (Number.isInteger(maximum) && count > maximum);
    });
    if (invalid.length || cardinalityInvalid) {
      manualActions.push({
        resourceId: eventRecord.id,
        field: "subjectResourceIds",
        value: eventRecord.subjectResourceIds,
        message: `Choose subjects that satisfy the ${eventRecord.eventType} model-v2 type and cardinality rules.`
      });
    }
  }

  for (const review of loaded.resources.filter(({ type }) => type === "vendor-review")) {
    const migrated = editable(review);
    if (Array.isArray(review.vendorIds) && review.vendorIds.length === 1) {
      migrated.vendorId = review.vendorIds[0];
    } else if (Array.isArray(review.vendorIds) && review.vendorIds.length > 1) {
      manualActions.push({
        resourceId: review.id,
        field: "vendorIds",
        value: review.vendorIds,
        message: "Split this record into one Vendor Review per Vendor, with its own decision, coverage, evidence, and follow-up."
      });
    }
    delete migrated.vendorIds;
    const legacyDecision = ["approved", "conditional", "rejected"].includes(review.status)
      ? review.status
      : ["approved", "conditional", "rejected"].includes(review.outcome)
        ? review.outcome
        : null;
    if (["approved", "conditional", "rejected"].includes(review.status)) migrated.status = "complete";
    if (legacyDecision) migrated.decision = legacyDecision;
    if ((migrated.status === "complete") && !migrated.decision) {
      manualActions.push({
        resourceId: review.id,
        field: "decision",
        value: review.outcome,
        message: "Record the completed Vendor Review decision as approved, conditional, or rejected."
      });
    }
    delete migrated.outcome;
  }

  for (const test of loaded.resources.filter(({ type }) => type === "backup-test")) {
    const migrated = editable(test);
    if (["passed", "failed"].includes(test.status)) {
      migrated.status = "complete";
      migrated.outcome = test.status;
    }
  }

  for (const grant of loaded.resources.filter(({ type }) => type === "access-grant")) {
    delete editable(grant).subjectKind;
  }

  for (const risk of loaded.resources.filter(({ type }) => type === "risk")) {
    const migrated = editable(risk);
    if (risk.status === "accepted") migrated.status = "monitoring";
    const acceptanceFields = [
      "acceptanceRationale",
      "acceptedByIds",
      "acceptedOn",
      "acceptanceExpiresOn"
    ];
    if (acceptanceFields.some((field) => !migrationValueMissing(risk[field]))) {
      migrated.acceptance = {
        ...(risk.acceptanceRationale ? { rationale: risk.acceptanceRationale } : {}),
        ...(risk.acceptedByIds ? { acceptedByIds: risk.acceptedByIds } : {}),
        ...(risk.acceptedOn ? { acceptedOn: risk.acceptedOn } : {}),
        ...(risk.acceptanceExpiresOn ? { expiresOn: risk.acceptanceExpiresOn } : {})
      };
    }
    for (const field of acceptanceFields) delete migrated[field];
  }

  for (const vulnerability of loaded.resources.filter(({ type }) => type === "vulnerability")) {
    const migrated = editable(vulnerability);
    if (vulnerability.acceptedByIds || vulnerability.acceptanceExpiresOn) {
      manualActions.push({
        resourceId: vulnerability.id,
        field: "exceptionId",
        value: {
          acceptedByIds: vulnerability.acceptedByIds,
          acceptanceExpiresOn: vulnerability.acceptanceExpiresOn
        },
        message: "Create or select the approved Exception that authorizes this Vulnerability risk acceptance, set exceptionId, then remove the legacy inline acceptance fields."
      });
    }
    delete migrated.acceptedByIds;
    delete migrated.acceptanceExpiresOn;
  }

  for (const exception of loaded.resources.filter(({ type }) => type === "exception")) {
    const migrated = editable(exception);
    const approvalFields = ["approvedByIds", "approvedOn", "expiresOn"];
    if (approvalFields.some((field) => !migrationValueMissing(exception[field]))) {
      migrated.approval = {
        ...(exception.approvedByIds ? { approvedByIds: exception.approvedByIds } : {}),
        ...(exception.approvedOn ? { approvedOn: exception.approvedOn } : {}),
        ...(exception.expiresOn ? { expiresOn: exception.expiresOn } : {})
      };
    }
    if (exception.status === "expired") {
      migrated.status = "closed";
      migrated.resolution = {
        ...(exception.expiresOn ? { resolvedOn: exception.expiresOn } : {}),
        rationale: "The approved exception period expired without renewal."
      };
    } else if (["revoked", "closed"].includes(exception.status) && exception.closedOn) {
      migrated.resolution = {
        resolvedOn: exception.closedOn,
        rationale: exception.status === "revoked"
          ? "The exception approval was revoked."
          : "The exception was closed."
      };
    }
    for (const field of [...approvalFields, "closedOn"]) delete migrated[field];
  }

  for (const attestation of loaded.resources.filter(({ type }) => type === "attestation")) {
    const migrated = editable(attestation);
    if (attestation.status === "overdue") migrated.status = "pending";
    delete migrated.attestedCommit;
  }

  for (const [type, oldField] of [
    ["policy-review", "reviewedOn"],
    ["vendor-review", "reviewedOn"],
    ["access-review", "reviewDate"],
    ["risk-assessment", "assessmentDate"],
    ["backup-test", "testDate"]
  ]) {
    for (const record of loaded.resources.filter((candidate) => candidate.type === type)) {
      if (!record[oldField]) continue;
      const migrated = editable(record);
      if (type === "backup-test" && migrated.status === "complete") {
        if (!migrated.completedAt) missing.push({ resourceId: record.id, field: "completedAt" });
        migrated.scheduledFor = record[oldField];
      } else if (migrated.status === "complete") migrated.completedOn = record[oldField];
      else migrated.scheduledFor = record[oldField];
      delete migrated[oldField];
    }
  }

  for (const type of ["meeting", "vulnerability-scan", "exercise"]) {
    for (const record of loaded.resources.filter((candidate) => candidate.type === type)) {
      if (!record.scheduledOn) continue;
      const migrated = editable(record);
      migrated.scheduledFor = record.scheduledOn;
      delete migrated.scheduledOn;
    }
  }

  for (const record of loaded.resources.filter(({ type }) => type === "backup-test")) {
    const migrated = editable(record);
    if (
      migrated.status === "complete"
      && !migrated.completedAt
      && !missing.some((item) => item.resourceId === record.id && item.field === "completedAt")
    ) {
      missing.push({ resourceId: record.id, field: "completedAt" });
    }
    delete migrated.completedOn;
  }

  for (const audit of loaded.resources.filter(({ type }) => type === "audit")) {
    const migrated = editable(audit);
    if (audit.auditor && !audit.auditorVendorId) {
      manualActions.push({
        resourceId: audit.id,
        field: "auditor",
        value: audit.auditor,
        message: "Create or select the CPA firm Vendor, set auditorVendorId, add any external auditor contacts as People, then remove auditor."
      });
    } else delete migrated.auditor;
    if (audit.assessmentCoverage) {
      manualActions.push({
        resourceId: audit.id,
        field: "assessmentCoverage",
        value: audit.assessmentCoverage,
        message: "Move useful scope details into scope, systemIds, requirementIds, controlIds, or Record Markdown, then remove assessmentCoverage."
      });
    } else delete migrated.assessmentCoverage;
  }

  for (const population of loaded.resources.filter(({ type }) => type === "audit-population")) {
    if (population.status !== "incomplete") continue;
    const migrated = editable(population);
    migrated.status = "reconciled";
    migrated.conclusion = "incomplete";
    notes.push({
      resourceId: population.id,
      message: "Moved the incomplete result from Audit Population status to conclusion; status now records whether reconciliation occurred."
    });
  }

  migrateInverseArrays(loaded.resources, byId, editable, conflicts, {
    sourceType: "system",
    sourceField: "commitmentIds",
    targetType: "commitment",
    targetField: "systemIds"
  });
  migrateInverseArrays(loaded.resources, byId, editable, conflicts, {
    sourceType: "requirement",
    sourceField: "controlIds",
    targetType: "control",
    targetField: "requirementIds"
  });
  migrateInverseArrays(loaded.resources, byId, editable, conflicts, {
    sourceType: "control",
    sourceField: "commitmentIds",
    targetType: "commitment",
    targetField: "controlIds"
  });
  migrateInverseArrays(loaded.resources, byId, editable, conflicts, {
    sourceType: "control",
    sourceField: "riskIds",
    targetType: "risk",
    targetField: "controlIds"
  });
  migrateInverseArrays(loaded.resources, byId, editable, conflicts, {
    sourceType: "policy",
    sourceField: "controlIds",
    targetType: "control",
    targetField: "policyIds"
  });
  migrateInverseArrays(loaded.resources, byId, editable, conflicts, {
    sourceType: "audit",
    sourceField: "evidenceIds",
    targetType: "evidence",
    targetField: "auditIds"
  });

  for (const vendor of loaded.resources.filter(({ type }) => type === "vendor")) {
    if (!Array.isArray(vendor.systemIds)) continue;
    for (const systemId of vendor.systemIds) {
      const system = byId.get(systemId);
      if (system?.type !== "system") {
        conflicts.push({
          resourceId: vendor.id,
          field: "systemIds",
          message: `System "${systemId}" was not found.`
        });
      } else if (system.vendorId && system.vendorId !== vendor.id) {
        conflicts.push({
          resourceId: system.id,
          field: "vendorId",
          message: `System already names vendor "${system.vendorId}", but vendor "${vendor.id}" also links it.`
        });
      } else {
        editable(system).vendorId = vendor.id;
      }
    }
    delete editable(vendor).systemIds;
  }

  for (const audit of loaded.resources.filter(({ type }) => type === "audit")) {
    if (!Array.isArray(audit.controlTestIds)) continue;
    for (const testId of audit.controlTestIds) {
      const controlTest = byId.get(testId);
      if (controlTest?.type !== "control-test") {
        conflicts.push({
          resourceId: audit.id,
          field: "controlTestIds",
          message: `Control Test "${testId}" was not found.`
        });
      } else if (controlTest.auditId && controlTest.auditId !== audit.id) {
        conflicts.push({
          resourceId: controlTest.id,
          field: "auditId",
          message: `Control Test already names audit "${controlTest.auditId}", but audit "${audit.id}" also links it.`
        });
      } else {
        editable(controlTest).auditId = audit.id;
      }
    }
    delete editable(audit).controlTestIds;
  }

  for (const evidence of loaded.resources.filter(({ type }) => type === "evidence")) {
    const migrated = editable(evidence);
    if (evidence.status === "expired") {
      migrated.status = evidence.verifierIds?.length && evidence.verifiedOn ? "verified" : "collected";
      if (!evidence.expiresOn) missing.push({ resourceId: evidence.id, field: "expiresOn" });
      notes.push({
        resourceId: evidence.id,
        message: "Removed the stored expired state. Model v2 derives expiry from expiresOn while preserving the collected or verified workflow state."
      });
    }
    const oldKind = String(evidence.evidenceKind || "").trim();
    if (oldKind) {
      const { artifactKind, artifactSubtype } = migrateEvidenceKind(oldKind);
      migrated.artifactKind = artifactKind;
      if (artifactSubtype) migrated.artifactSubtype = artifactSubtype;
      delete migrated.evidenceKind;
    } else if (!evidence.artifactKind) {
      missing.push({ resourceId: evidence.id, field: "artifactKind" });
    }
    migrated.sourceKind = evidenceSourceKind(evidence, migrated.artifactKind);
    if (Object.hasOwn(evidence, "source")) {
      migrated.sourceDescription = evidence.source;
      delete migrated.source;
    }
    if (
      evidence.status !== "draft"
      && migrated.sourceKind === "rendered-page"
    ) {
      for (const field of ["capture", "sourceCommit"]) {
        if (!migrated[field] || (Array.isArray(migrated[field]) && migrated[field].length === 0)) {
          missing.push({ resourceId: evidence.id, field });
        }
      }
    }
    const hadCollectionDraftFields = Object.hasOwn(evidence, "collectionTestFamilyId")
      || Object.hasOwn(evidence, "collectionTestPrompt");
    if (hadCollectionDraftFields) {
      delete migrated.collectionTestFamilyId;
      delete migrated.collectionTestPrompt;
      if (evidence.status === "draft") {
        notes.push({
          resourceId: evidence.id,
          message: "This former collection-test draft remains a normal draft External Evidence record. Review, complete, withdraw, or delete it separately."
        });
      }
    }
  }

  for (const action of loaded.resources.filter(({ type }) => type === "action-item")) {
    const migrated = editable(action);
    if (!action.completionWindow) {
      const completionWindow = migrateCompletionWindow(action, loaded.workspace.timezone);
      if (completionWindow) migrated.completionWindow = completionWindow;
      else if (["open", "in-progress", "blocked"].includes(action.status)) {
        missing.push({ resourceId: action.id, field: "completionWindow" });
      }
    }
    for (const field of [
      "dueWindowStart", "dueWindowEnd", "overdueOn",
      "dueWindowStartAt", "dueWindowEndAt", "overdueAt", "dueOn"
    ]) delete migrated[field];
  }

  for (const record of loaded.resources) {
    if (!Array.isArray(record.relatedResourceIds)) continue;
    const targets = record.relatedResourceIds.map((id) => byId.get(id));
    if (record.type === "document" && targets.every((target) => target?.type === "training")) {
      addIds(editable(record), "trainingIds", record.relatedResourceIds);
      delete editable(record).relatedResourceIds;
    } else {
      manualActions.push({
        resourceId: record.id,
        field: "relatedResourceIds",
        value: record.relatedResourceIds,
        message: "Replace each catch-all relationship with the model-defined field that states what the relationship means, then remove relatedResourceIds."
      });
    }
  }

  for (const record of loaded.resources) {
    for (const [key, migration] of CADENCE_MIGRATIONS) {
      const [type, field] = key.split(":");
      if (record.type !== type || !Object.hasOwn(record, field)) continue;
      const recurrence = record[field];
      if (!validMigratableRecurrence(recurrence, record)) {
        manualActions.push({
          resourceId: record.id,
          field,
          value: recurrence,
          message: `Create an Obligation that preserves this schedule, then remove ${field}.`
        });
        continue;
      }
      const existing = [...loaded.resources, ...create].find((candidate) => (
        candidate.type === "obligation"
        && (
          candidate.templateResourceId === record.id
          || (candidate.scopeResourceIds || []).includes(record.id)
        )
        && candidate.activityType === migration.activityType
      ));
      if (!existing) {
        const ownerIds = cadenceOwnerIds(record);
        if (!ownerIds.length) {
          manualActions.push({
            resourceId: record.id,
            field,
            value: recurrence,
            message: "Assign the Obligation owner, create the schedule, then remove this legacy cadence field."
          });
          continue;
        }
        const title = cadenceTitle(record, migration.activityType);
        const obligation = {
          id: createResourceId("obligation", title, [...usedIds, ...create.map(({ id }) => id)]),
          type: "obligation",
          title,
          status: "active",
          activityType: migration.activityType,
          recurrence: {
            ...recurrence,
            anchorDate: recurrence.anchorDate || record.effectiveOn || record.startsOn
          },
          ownerIds,
          ...(migration.relation === "template"
            ? { templateResourceId: record.id }
            : { scopeResourceIds: [record.id] }),
          ...(record.type === "policy" ? { policyIds: [record.id] } : {}),
          ...(record.effectiveOn || record.startsOn
            ? { startsOn: record.effectiveOn || record.startsOn }
            : {})
        };
        create.push(obligation);
        notes.push({
          resourceId: record.id,
          message: `Created Obligation "${obligation.id}" from ${field}; Obligations are the schedule authority in model v2.`
        });
      }
      delete editable(record)[field];
    }
    for (const field of ["nextReviewConstraint"]) {
      if (!Object.hasOwn(record, field)) continue;
      manualActions.push({
        resourceId: record.id,
        field,
        value: record[field],
        message: `Replace ${field} with an explicit Obligation deadline, then remove the legacy field.`
      });
    }
  }

  const obligationsByControl = new Map();
  for (const obligation of [...loaded.resources, ...create].filter((record) => (
    record.type === "obligation" && recordIsNotRetired(record)
  ))) {
    for (const controlId of obligation.controlIds || []) {
      if (!obligationsByControl.has(controlId)) obligationsByControl.set(controlId, []);
      obligationsByControl.get(controlId).push(obligation);
    }
  }
  for (const control of loaded.resources.filter(({ type }) => type === "control")) {
    const migrated = editable(control);
    if (Object.hasOwn(control, "frequency")) {
      migrated.operationPattern = controlOperationPattern(control.frequency);
      delete migrated.frequency;
    } else if (!control.operationPattern) {
      missing.push({ resourceId: control.id, field: "operationPattern" });
    }
    if (
      control.status === "implemented"
      && ["scheduled", "event-driven", "mixed"].includes(migrated.operationPattern)
      && !(obligationsByControl.get(control.id) || []).length
    ) {
      manualActions.push({
        resourceId: control.id,
        field: "operationPattern",
        value: migrated.operationPattern,
        message: "Link an active Obligation that defines this implemented Control's schedule before applying model v2."
      });
    }
  }

  const renderer = loaded.resources.find(({ type }) => type === "renderer-settings");
  if (renderer) {
    const migrated = editable(renderer);
    if (!migrated.repositoryMode) migrated.repositoryMode = "manual";
    if (!migrated.authoritativeBranch) migrated.authoritativeBranch = "main";
    if (!migrated.repositoryRemote) migrated.repositoryRemote = "origin";
    if (Array.isArray(migrated.completedStagePageIds)) {
      migrated.completedStagePageIds = [...new Set(
        migrated.completedStagePageIds.map((id) => STAGE_PAGE_ID_MIGRATIONS.get(id) || id)
      )].sort();
    }
  }

  editable(loaded.workspace).dataModelVersion = TARGET_MODEL_VERSION;
  const migratedRecords = [
    ...loaded.resources.map((record) => updateById.get(record.id) || record),
    ...create
  ];
  collectModelShapeActions(
    migratedRecords,
    targetModel,
    missing,
    manualActions
  );
  collectRelationshipConstraintActions(
    migratedRecords,
    targetModel,
    manualActions
  );
  collectRelationTypeActions(
    migratedRecords,
    targetModel,
    manualActions
  );
  const update = [
    ...[...updateById.values()].filter(({ id }) => id !== loaded.workspace.id),
    updateById.get(loaded.workspace.id)
  ];
  return {
    schemaVersion: 1,
    sourceModelVersion: sourceVersion,
    targetModelVersion: TARGET_MODEL_VERSION,
    ready: !missing.length && !conflicts.length && !manualActions.length,
    missing,
    conflicts,
    manualActions,
    notes,
    summary: {
      create: create.length,
      update: update.length
    },
    changes: {
      create,
      update,
      expectedRevisions: Object.fromEntries(
        update.map(({ id }) => [id, revisionById.get(id)])
      ),
      validateWholeWorkspace: true
    }
  };
}

export async function migrateModel(input = process.cwd(), options = {}) {
  const plan = await planModelMigration(input, options);
  if (plan.sourceModelVersion === TARGET_MODEL_VERSION) return { ...plan, applied: false };
  if (!plan.ready) {
    throw new Error(
      "Model migration needs review. Run `npx filegrc migrate --to-model 2 --preview --json` "
      + "and resolve every missing value, conflict, and manual action."
    );
  }
  const result = await applyResourceBatch(input, plan.changes);
  return { ...plan, applied: true, result };
}

function migrateInverseArrays(resources, byId, editable, conflicts, mapping) {
  for (const source of resources.filter(({ type }) => type === mapping.sourceType)) {
    if (!Array.isArray(source[mapping.sourceField])) continue;
    for (const targetId of source[mapping.sourceField]) {
      const target = byId.get(targetId);
      if (target?.type !== mapping.targetType) {
        conflicts.push({
          resourceId: source.id,
          field: mapping.sourceField,
          message: `${mapping.targetType} "${targetId}" was not found.`
        });
        continue;
      }
      const migrated = editable(target);
      const current = Array.isArray(migrated[mapping.targetField]) ? migrated[mapping.targetField] : [];
      migrated[mapping.targetField] = [...new Set([...current, source.id])];
    }
    delete editable(source)[mapping.sourceField];
  }
}

function emptyPlan(version) {
  return {
    schemaVersion: 1,
    sourceModelVersion: version,
    targetModelVersion: TARGET_MODEL_VERSION,
    ready: true,
    missing: [],
    conflicts: [],
    manualActions: [],
    notes: [],
    summary: { create: 0, update: 0 },
    changes: {
      create: [],
      update: [],
      expectedRevisions: {},
      validateWholeWorkspace: true
    }
  };
}

function migrateClassificationDefinitions(workspace, definitions, conflicts) {
  const migrated = {};
  const ids = new Map();
  for (const [name, description] of Object.entries(definitions || {})) {
    const id = normalizeClassificationId(name);
    if (!id) continue;
    if (Object.hasOwn(migrated, id) && migrated[id] !== description) {
      conflicts.push({
        resourceId: workspace.id,
        field: "classificationDefinitions",
        message: `Classification names "${ids.get(id)}" and "${name}" both normalize to "${id}".`
      });
      continue;
    }
    migrated[id] = description;
    ids.set(id, name);
  }
  workspace.classificationDefinitions = migrated;
  return new Map([...ids].flatMap(([id, original]) => [
    [id.toLowerCase(), id],
    [String(original).trim().toLowerCase(), id]
  ]));
}

function normalizeClassificationId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveClassificationId(value, ids) {
  const text = String(value || "").trim().toLowerCase();
  return ids.get(text) || ids.get(normalizeClassificationId(text)) || null;
}

function coverageMigrationSettings(record) {
  if (record.type === "control-test") {
    return { target: "coverage", asOfFields: ["asOfDate"], startFields: ["periodStart"], endFields: ["periodEnd"] };
  }
  if (record.type === "audit") {
    return { target: "coverage", asOfFields: ["typeOneAsOf"], startFields: ["periodStart"], endFields: ["periodEnd"] };
  }
  if ([
    "evidence", "policy-review", "vendor-review", "access-review",
    "penetration-test", "audit-population", "audit-request"
  ].includes(record.type)) {
    return { target: "coverage", startFields: ["periodStart"], endFields: ["periodEnd"] };
  }
  return null;
}

function migrateCoverageFields(
  target,
  source,
  settings,
  missing,
  manualActions,
  resourceId = source.id,
  fieldPrefix = ""
) {
  const fields = [
    ...(settings.asOfFields || []),
    ...(settings.startFields || []),
    ...(settings.endFields || [])
  ];
  const present = fields.filter((field) => source[field]);
  if (!target[settings.target]) {
    const coverage = legacyCoverage(source, settings);
    if (coverage) target[settings.target] = coverage;
    else if (present.length) {
      manualActions.push({
        resourceId,
        field: `${fieldPrefix}${settings.target}`,
        value: Object.fromEntries(present.map((field) => [field, source[field]])),
        message: "Complete the as-of date or both range dates and store them as a model-v2 coverage object."
      });
    }
  }
  for (const field of fields) delete target[field];
}

function migrateObligationWindow(window) {
  if (window.precision && Number.isInteger(window.dueAfter)) return structuredClone(window);
  const hasDays = Number.isInteger(window.startOffsetDays) || Number.isInteger(window.endOffsetDays);
  const hasHours = Number.isInteger(window.startOffsetHours) || Number.isInteger(window.endOffsetHours);
  if (hasDays === hasHours) return null;
  if (hasDays && Number.isInteger(window.endOffsetDays)) {
    return {
      precision: "date",
      startsAfter: window.startOffsetDays || 0,
      dueAfter: window.endOffsetDays
    };
  }
  if (hasHours && Number.isInteger(window.endOffsetHours)) {
    return {
      precision: "timestamp",
      startsAfter: window.startOffsetHours || 0,
      dueAfter: window.endOffsetHours
    };
  }
  return null;
}

function migrateEvidenceKind(value) {
  const direct = new Set([
    "population-export", "system-export", "configuration-export",
    "signed-record", "third-party-report", "business-record"
  ]);
  if (direct.has(value)) return { artifactKind: value };
  if (value === "rendered-record") return { artifactKind: "rendered-page" };
  if (["test-capture", "screenshot", "capture"].includes(value)) {
    return { artifactKind: "capture", artifactSubtype: value === "capture" ? undefined : value };
  }
  if (value === "signed-management-representation") {
    return { artifactKind: "signed-record", artifactSubtype: value };
  }
  if (value === "export" || value.endsWith("-export")) {
    return { artifactKind: "system-export", artifactSubtype: value };
  }
  if (/soc|assurance|vendor-report|third-party-report/.test(value)) {
    return { artifactKind: "third-party-report", artifactSubtype: value };
  }
  if (["attachment", "narrative", "review", "risk-governance"].includes(value)) {
    return { artifactKind: "business-record", artifactSubtype: value };
  }
  return { artifactKind: "other", artifactSubtype: value };
}

function evidenceSourceKind(record, artifactKind) {
  if (record.capture || artifactKind === "rendered-page") return "rendered-page";
  if (record.sourceSystemId) return "system";
  if (record.externalReference) return "external-reference";
  if (Array.isArray(record.filePaths) && record.filePaths.length) return "file";
  return "authored-record";
}

function migrateCompletionWindow(record, timezone) {
  const dueAt = record.dueWindowEndAt || record.overdueAt;
  if (dueAt) {
    return {
      precision: "timestamp",
      startsAt: record.dueWindowStartAt || dueAt,
      dueAt,
      overdueAt: record.overdueAt || dueAt,
      timezone: timezone || "UTC"
    };
  }
  const dueOn = record.dueWindowEnd || record.dueOn || record.overdueOn;
  if (!dueOn) return null;
  return {
    precision: "date",
    startsOn: record.dueWindowStart || dueOn,
    dueOn,
    overdueOn: record.overdueOn || nextCalendarDate(dueOn)
  };
}

function nextCalendarDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validMigratableRecurrence(value, record) {
  return Boolean(
    value
    && !Array.isArray(value)
    && typeof value === "object"
    && value.mode === "calendar"
    && Number.isSafeInteger(value.interval)
    && value.interval > 0
    && ["day", "week", "month", "year"].includes(value.unit)
    && (value.anchorDate || record.effectiveOn || record.startsOn)
  );
}

function cadenceOwnerIds(record) {
  if (Array.isArray(record.ownerIds) && record.ownerIds.length) return record.ownerIds;
  if (record.type === "team") return [record.id];
  return [];
}

function cadenceTitle(record, activityType) {
  if (activityType === "training") return `Complete ${record.title}`;
  if (activityType === "oversight-meeting") return `Hold ${record.title} meeting`;
  return `Review ${record.title}`;
}

function controlOperationPattern(frequency) {
  const value = String(frequency || "").toLowerCase();
  const continuous = /continuous|ongoing/.test(value);
  const eventDriven = /\bper\b|\bbefore\b|\bonboarding\b|\bafter\b|as issues arise|material change|material disruption|incident/.test(value);
  const scheduled = /daily|weekly|monthly|quarterly|annually|annual|yearly/.test(value);
  if ([continuous, eventDriven, scheduled].filter(Boolean).length > 1) return "mixed";
  if (continuous) return "continuous";
  if (eventDriven) return "event-driven";
  return "scheduled";
}

function recordIsNotRetired(record) {
  return record.status !== "retired";
}

function approvalBound(record) {
  if (record.type === "policy") return ["approved", "active", "superseded", "retired"].includes(record.status);
  if (record.type === "document") return ["active", "superseded", "retired"].includes(record.status);
  return false;
}

function collectModelShapeActions(records, model, missing, manualActions) {
  const reportedManual = new Set(manualActions.map(({ resourceId, field }) => `${resourceId}:${field}`));
  const reportedMissing = new Set(missing.map(({ resourceId, field }) => `${resourceId}:${field}`));
  for (const record of records) {
    const definition = model.resources[record.type];
    if (!definition) continue;
    const fields = { ...model.commonFields, ...definition.fields };
    const required = new Set([
      ...Object.entries(model.commonFields).filter(([, field]) => field.required).map(([name]) => name),
      ...(definition.required || [])
    ]);
    for (const [name, field] of Object.entries(fields)) {
      if (field.requiredWhen && migrationConditionMatches(record, field.requiredWhen)) required.add(name);
    }
    for (const name of required) {
      if (!migrationValueMissing(record[name])) continue;
      const key = `${record.id}:${name}`;
      if (reportedMissing.has(key)) continue;
      missing.push({ resourceId: record.id, field: name });
      reportedMissing.add(key);
    }
    for (const name of Object.keys(record)) {
      if (fields[name]) continue;
      const key = `${record.id}:${name}`;
      if (reportedManual.has(key)) continue;
      manualActions.push({
        resourceId: record.id,
        field: name,
        value: record[name],
        message: `Field "${name}" is not part of model v2. Move organization-specific data under a namespaced extensions object or remove the obsolete field.`
      });
      reportedManual.add(key);
    }
    for (const [name, field] of Object.entries(fields)) {
      if (
        !migrationValueMissing(record[name])
        && field.allowedWhen
        && !migrationConditionMatches(record, field.allowedWhen)
      ) {
        const key = `${record.id}:${name}`;
        if (!reportedManual.has(key)) {
          manualActions.push({
            resourceId: record.id,
            field: name,
            value: record[name],
            message: `Field "${name}" is not allowed for the selected ${Object.keys(field.allowedWhen).join(" and ")} in model v2.`
          });
          reportedManual.add(key);
        }
      }
      if (field.type === "object" && field.objectType && record[name] && !Array.isArray(record[name])) {
        collectObjectShapeActions(
          record.id,
          name,
          record[name],
          field.objectType,
          model,
          missing,
          manualActions,
          reportedMissing,
          reportedManual
        );
      }
      if (field.type === "array" && field.itemObjectType && Array.isArray(record[name])) {
        for (const [index, item] of record[name].entries()) {
          if (!item || Array.isArray(item) || typeof item !== "object") continue;
          collectObjectShapeActions(
            record.id,
            `${name}[${index}]`,
            item,
            field.itemObjectType,
            model,
            missing,
            manualActions,
            reportedMissing,
            reportedManual
          );
        }
      }
    }
  }
}

function collectRelationshipConstraintActions(records, model, manualActions) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const reported = new Set(manualActions.map(({ resourceId, field }) => `${resourceId}:${field}`));
  for (const constraint of model.relationshipConstraints?.acyclic || []) {
    const candidates = records.filter(({ type }) => type === constraint.resourceType);
    for (const record of candidates) {
      const chain = [];
      const positions = new Map();
      let current = record;
      while (current?.type === constraint.resourceType) {
        if (positions.has(current.id)) {
          const cycle = [...chain.slice(positions.get(current.id)), current.id];
          const key = `${record.id}:${constraint.field}`;
          if (!reported.has(key)) {
            manualActions.push({
              resourceId: record.id,
              field: constraint.field,
              value: record[constraint.field],
              message: `Break the model-v2 relationship cycle: ${cycle.join(" -> ")}.`
            });
            reported.add(key);
          }
          break;
        }
        positions.set(current.id, chain.length);
        chain.push(current.id);
        current = byId.get(current[constraint.field]);
      }
    }
  }

  for (const constraint of model.relationshipConstraints?.unique || []) {
    const keys = new Map();
    for (const record of records) {
      if (record.type !== constraint.resourceType) continue;
      if (constraint.statuses && !constraint.statuses.includes(record.status)) continue;
      const keyValue = JSON.stringify((constraint.fields || []).map((field) => (
        Array.isArray(record[field]) ? [...record[field]].sort() : record[field] ?? null
      )));
      const previous = keys.get(keyValue);
      if (!previous) {
        keys.set(keyValue, record);
        continue;
      }
      const key = `${record.id}:${constraint.fields.join(",")}`;
      if (!reported.has(key)) {
        manualActions.push({
          resourceId: record.id,
          field: constraint.fields.join(", "),
          value: Object.fromEntries(constraint.fields.map((field) => [field, record[field]])),
          message: `Resolve the duplicate active ${constraint.resourceType} relationship shared with "${previous.id}".`
        });
        reported.add(key);
      }
    }
  }
}

function collectRelationTypeActions(records, model, manualActions) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const reported = new Set(manualActions.map(({ resourceId, field }) => `${resourceId}:${field}`));
  const checkRelation = (resourceId, fieldName, value, field) => {
    if (!field?.relation || migrationValueMissing(value)) return;
    const ids = Array.isArray(value) ? value : [value];
    const invalid = ids.filter((id) => {
      const target = byId.get(id);
      return target && !field.relation.includes("*") && !field.relation.includes(target.type);
    });
    if (!invalid.length) return;
    const key = `${resourceId}:${fieldName}`;
    if (reported.has(key)) return;
    manualActions.push({
      resourceId,
      field: fieldName,
      value: invalid,
      message: `Replace IDs whose resource type is not allowed by model v2 (${field.relation.join(" or ")}).`
    });
    reported.add(key);
  };
  const checkObject = (resourceId, prefix, value, schema) => {
    if (!schema || !value || Array.isArray(value) || typeof value !== "object") return;
    for (const [name, property] of Object.entries(schema.properties || {})) {
      const nested = value[name];
      checkRelation(resourceId, `${prefix}.${name}`, nested, property);
      if (property.type === "object" && property.objectType) {
        checkObject(resourceId, `${prefix}.${name}`, nested, model.objectTypes?.[property.objectType]);
      }
    }
  };
  for (const record of records) {
    const definition = model.resources[record.type];
    if (!definition) continue;
    for (const [name, field] of Object.entries({ ...model.commonFields, ...definition.fields })) {
      const value = record[name];
      checkRelation(record.id, name, value, field);
      if (field.type === "object" && field.objectType) {
        checkObject(record.id, name, value, model.objectTypes?.[field.objectType]);
      }
      if (field.type === "array" && field.itemObjectType && Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
          checkObject(record.id, `${name}[${index}]`, item, model.objectTypes?.[field.itemObjectType]);
        }
      }
    }
  }
}

function collectObjectShapeActions(
  resourceId,
  path,
  value,
  objectType,
  model,
  missing,
  manualActions,
  reportedMissing,
  reportedManual
) {
  const schema = model.objectTypes?.[objectType];
  if (!schema) return;
  const properties = schema.properties || {};
  if (schema.keyFormat === "namespace") {
    for (const name of Object.keys(value)) {
      if (EXTENSION_NAMESPACE_PATTERN.test(name)) continue;
      const field = `${path}.${name}`;
      const key = `${resourceId}:${field}`;
      if (!reportedManual.has(key)) {
        manualActions.push({
          resourceId,
          field,
          value: value[name],
          message: "Extension namespaces must use lowercase dot-separated names."
        });
        reportedManual.add(key);
      }
    }
  }
  const required = new Set(schema.required || []);
  for (const [name, property] of Object.entries(properties)) {
    if (property.requiredWhen && migrationConditionMatches(value, property.requiredWhen)) required.add(name);
    if (
      !migrationValueMissing(value[name])
      && property.allowedWhen
      && !migrationConditionMatches(value, property.allowedWhen)
    ) {
      const field = `${path}.${name}`;
      const key = `${resourceId}:${field}`;
      if (!reportedManual.has(key)) {
        manualActions.push({
          resourceId,
          field,
          value: value[name],
          message: `Nested field "${field}" is not allowed for the selected ${Object.keys(property.allowedWhen).join(" and ")} in model v2.`
        });
        reportedManual.add(key);
      }
    }
  }
  for (const name of required) {
    if (!migrationValueMissing(value[name])) continue;
    const field = `${path}.${name}`;
    const key = `${resourceId}:${field}`;
    if (!reportedMissing.has(key)) {
      missing.push({ resourceId, field });
      reportedMissing.add(key);
    }
  }
  for (const [name, nested] of Object.entries(value)) {
    const property = properties[name];
    if (!property) {
      if (schema.additionalProperties === true) continue;
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        if (
          schema.additionalProperties.type === "object"
          && schema.additionalProperties.objectType
          && nested
          && !Array.isArray(nested)
          && typeof nested === "object"
        ) {
          collectObjectShapeActions(
            resourceId,
            `${path}.${name}`,
            nested,
            schema.additionalProperties.objectType,
            model,
            missing,
            manualActions,
            reportedMissing,
            reportedManual
          );
        }
        continue;
      }
      const field = `${path}.${name}`;
      const key = `${resourceId}:${field}`;
      if (!reportedManual.has(key)) {
        manualActions.push({
          resourceId,
          field,
          value: nested,
          message: `Nested field "${field}" is not part of model v2. Move organization-specific data under extensions or replace it with a defined property.`
        });
        reportedManual.add(key);
      }
      continue;
    }
    if (
      property.type === "object"
      && property.objectType
      && nested
      && !Array.isArray(nested)
      && typeof nested === "object"
    ) {
      collectObjectShapeActions(
        resourceId,
        `${path}.${name}`,
        nested,
        property.objectType,
        model,
        missing,
        manualActions,
        reportedMissing,
        reportedManual
      );
    }
  }
}

function migrationConditionMatches(record, condition) {
  return Object.entries(condition).every(([name, expected]) => (
    Array.isArray(expected) ? expected.includes(record[name]) : record[name] === expected
  ));
}

function migrationValueMissing(value) {
  return value === undefined
    || value === null
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}
