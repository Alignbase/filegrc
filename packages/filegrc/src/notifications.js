import { currentPartyPeople } from "./parties.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function notificationContacts(ownerIds, resources) {
  const byId = new Map(resources.filter(isObject).map((record) => [record.id, record]));
  return [...currentPartyPeople(ownerIds, byId)].sort().map((personId) => {
    const person = byId.get(personId);
    return {
      personId,
      ...(person.email ? { email: person.email } : {})
    };
  });
}
