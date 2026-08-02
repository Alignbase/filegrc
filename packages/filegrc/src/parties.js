const CURRENT_PERSON_STATUSES = new Set(["active", "external"]);
const CURRENT_TEAM_STATUSES = new Set(["active"]);
const CURRENT_APPOINTMENT_STATUSES = new Set(["active"]);

export function partyPeople(ids = [], byId, options = {}, seen = new Set()) {
  const people = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const record = byId.get(id);
    if (
      record?.type === "person"
      && (!options.personStatuses || options.personStatuses.has(record.status))
    ) {
      people.add(id);
    }
    if (
      record?.type === "team"
      && (!options.teamStatuses || options.teamStatuses.has(record.status))
    ) {
      for (const personId of partyPeople(
        [...(record.memberIds || []), ...(record.chairIds || [])],
        byId,
        options,
        seen
      )) {
        people.add(personId);
      }
    }
    if (
      record?.type === "appointment"
      && (!options.appointmentStatuses || options.appointmentStatuses.has(record.status))
    ) {
      for (const personId of partyPeople(
        [record.holderId],
        byId,
        options,
        seen
      )) {
        people.add(personId);
      }
    }
  }
  return people;
}

export function currentPartyPeople(ids = [], byId) {
  return partyPeople(ids, byId, {
    personStatuses: CURRENT_PERSON_STATUSES,
    teamStatuses: CURRENT_TEAM_STATUSES,
    appointmentStatuses: CURRENT_APPOINTMENT_STATUSES
  });
}

export function partiesIndependent(ownerIds = [], approverIds = [], byId) {
  const owners = partyPeople(ownerIds, byId);
  const approvers = partyPeople(approverIds, byId);
  return owners.size > 0
    && approvers.size > 0
    && ![...owners].some((id) => approvers.has(id));
}
