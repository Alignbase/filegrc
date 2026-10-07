import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { currentPartyPeople } from "./parties.js";

const CONFIG_PATH = ".filegrc/notifications.json";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// This configuration contains addresses only. Delivery belongs to the caller.
export function validateNotificationConfig(config, resources = []) {
  const diagnostics = [];
  const issue = (field, message) => diagnostics.push({
    severity: "error", code: "invalid-notification-config", path: CONFIG_PATH, field, message
  });
  if (!isObject(config)) {
    issue("", "Notification configuration must be an object.");
    return diagnostics;
  }
  for (const key of Object.keys(config)) {
    if (key !== "slack") issue(key, `Unknown notification configuration field: ${key}.`);
  }
  if (!Object.hasOwn(config, "slack")) return diagnostics;
  if (!isObject(config.slack)) {
    issue("slack", "slack must map Person IDs to Slack identities.");
    return diagnostics;
  }
  for (const [personId, identity] of Object.entries(config.slack)) {
    const field = `slack.${personId}`;
    const matches = resources.filter((record) => record?.id === personId);
    if (matches.length !== 1 || matches[0].type !== "person") {
      issue(field, `Slack routing must reference one existing Person; ${personId} is missing, ambiguous, or is not a Person.`);
    }
    if (!isObject(identity)) {
      issue(field, "Slack identity must be an object with workspaceId and userId.");
      continue;
    }
    for (const key of Object.keys(identity)) {
      if (!["workspaceId", "userId"].includes(key)) issue(`${field}.${key}`, `Unknown Slack identity field: ${key}.`);
    }
    for (const [key, pattern] of [["workspaceId", /^T[A-Z0-9]+$/], ["userId", /^[UW][A-Z0-9]+$/]]) {
      if (typeof identity[key] !== "string" || !pattern.test(identity[key])) {
        issue(`${field}.${key}`, `${key} must be a Slack ${key === "workspaceId" ? "workspace ID beginning with T" : "user ID beginning with U or W"} using uppercase letters and digits.`);
      }
    }
  }
  return diagnostics;
}

export async function loadNotificationConfig(root, resources = []) {
  let config;
  try {
    config = JSON.parse(await readFile(join(root, CONFIG_PATH), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { config: {}, diagnostics: [] };
    return { config: {}, diagnostics: [{
      severity: "error", code: "invalid-notification-config", path: CONFIG_PATH,
      message: `Cannot read notification configuration: ${error.message}`
    }] };
  }
  const diagnostics = validateNotificationConfig(config, resources);
  return { config, diagnostics };
}

export function notificationContacts(ownerIds, resources, config = {}) {
  const byId = new Map(resources.filter(isObject).map((record) => [record.id, record]));
  const valid = validateNotificationConfig(config, resources).length === 0;
  return [...currentPartyPeople(ownerIds, byId)].sort().map((personId) => {
    const person = byId.get(personId);
    return {
      personId,
      ...(person.email ? { email: person.email } : {}),
      ...(valid && Object.hasOwn(config.slack || {}, personId) ? { slack: { ...config.slack[personId] } } : {})
    };
  });
}
