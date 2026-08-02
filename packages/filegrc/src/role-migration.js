import { createResourceId } from "./id.js";
import { applyResourceBatch, contentRevision } from "./files.js";
import { loadWorkspace } from "./workspace.js";

const LEGACY_POLICY_OWNER_ROLE = "Policy Owner";
const ACCOUNTABILITY_FIELDS = new Set(["ownerIds", "evidenceOwnerIds"]);

export async function planRoleMigration(input, options = {}) {
  const loaded = typeof input === "object" && input.entries ? input : await loadWorkspace(input);
  if (!loaded.workspace?.id) throw new Error("Role migration requires a valid Workspace record.");
  const people = loaded.resources.filter((record) => (
    record.type === "person"
    && String(record.role || "").trim() === LEGACY_POLICY_OWNER_ROLE
  ));
  const review = loaded.resources
    .filter((record) => (
      record.type === "person"
      && String(record.role || "").trim()
      && String(record.role || "").trim() !== LEGACY_POLICY_OWNER_ROLE
    ))
    .map(({ id, title, role }) => ({ id, title, role }));
  const usedIds = loaded.resources.map(({ id }) => id);
  const revisionById = new Map(loaded.entries.map((entry) => [
    entry.record.id,
    contentRevision(entry.source)
  ]));
  const create = [];
  const updateById = new Map();
  const appointments = [];
  const missing = [];

  for (const person of people) {
    const existingAppointment = loaded.resources.find((record) => (
      record.type === "appointment"
      && record.appointmentKind === "policy-owner"
      && record.holderId === person.id
      && record.status === "active"
    ));
    const appointment = existingAppointment || {
      schemaVersion: 1,
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

    const jobTitle = person.jobTitle
      || options.jobTitles?.[person.id]
      || (people.length === 1 ? options.jobTitle : undefined);
    if (!jobTitle) missing.push({ personId: person.id, field: "jobTitle" });
    if (!existingAppointment && !options.startsOn) {
      missing.push({ personId: person.id, field: "startsOn" });
    }
    const migratedPerson = { ...person, ...(jobTitle ? { jobTitle } : {}) };
    delete migratedPerson.role;
    updateById.set(person.id, migratedPerson);

    const references = [];
    for (const record of loaded.resources) {
      const definition = loaded.model.resources[record.type];
      if (!definition) continue;
      const fields = { ...loaded.model.commonFields, ...definition.fields };
      for (const [fieldName, field] of Object.entries(fields)) {
        if (
          !ACCOUNTABILITY_FIELDS.has(fieldName)
          || !field.relation?.includes("appointment")
          || !Array.isArray(record[fieldName])
          || !record[fieldName].includes(person.id)
        ) {
          continue;
        }
        const current = updateById.get(record.id) || record;
        const migrated = {
          ...current,
          [fieldName]: current[fieldName].map((id) => id === person.id ? appointment.id : id)
        };
        updateById.set(record.id, migrated);
        references.push({ type: record.type, id: record.id, field: fieldName });
      }
    }
    appointments.push({
      personId: person.id,
      appointmentId: appointment.id,
      existing: Boolean(existingAppointment),
      references
    });
  }

  return {
    candidates: people.map(({ id, title, jobTitle, role }) => ({ id, title, jobTitle: jobTitle || null, role })),
    review,
    appointments,
    missing,
    changes: {
      create,
      update: [...updateById.values()],
      expectedRevisions: Object.fromEntries(
        [...updateById.keys()].map((id) => [id, revisionById.get(id)])
      )
    }
  };
}

export async function migrateLegacyRoles(input, options = {}) {
  const plan = await planRoleMigration(input, options);
  if (!plan.candidates.length) return { ...plan, applied: false };
  if (plan.missing.length) {
    const fields = plan.missing.map(({ personId, field }) => `${personId}.${field}`).join(", ");
    throw new Error(`Role migration needs explicit values for: ${fields}.`);
  }
  const result = await applyResourceBatch(input, plan.changes);
  return {
    ...plan,
    applied: true,
    result
  };
}
