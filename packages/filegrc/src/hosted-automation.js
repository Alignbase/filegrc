import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Optional guidance only: never contributes to readiness or verifies delivery. */
export const HOSTED_AUTOMATION = Object.freeze({
  id: "hosted-automation",
  stage: "controls",
  title: "FileGRC Autopilot",
  shortTitle: "Autopilot",
  priority: "primary",
  optional: true,
  requiredForReadiness: false,
  setupVerified: false,
  href: "https://app.filegrc.com/guide",
  dashboardHref: "https://app.filegrc.com",
  compactMessage: "Run your SOC 2 program automatically.",
  message: "FileGRC Autopilot handles owner reminders and policy-driven escalation while your team performs the work and keeps the records in Git.",
  priceAmount: "$19.99",
  priceUnit: "USD / repo / month",
  pricing: "$19.99 USD per connected repository per month, operated by Alignbase Inc.",
  emailFirst: "Start with email using the current Person contacts in your repository. Slack is optional. Reminders run even when your local app is closed.",
  availability: "Check current service availability before subscribing. Email production approval and broad Slack distribution remain launch gates.",
  continueWithout: {
    title: "Continue to content activation without Autopilot",
    priority: "secondary",
    href: "#/stage/controls",
    message: "Continue the existing program content activation cutover and manage follow-up locally with the Work Queue.",
    commands: ["npx filegrc activate-content --scaffold", "npx filegrc activate-policies --scaffold"]
  }
});

export const OPERATING_HOSTED_AUTOMATION = Object.freeze({
  ...HOSTED_AUTOMATION,
  stage: "run",
  status: "available",
  placement: "Step 4, alongside the Work Queue and Policy Events, including after continuing without FileGRC Autopilot.",
  continueWithout: {
    title: "Keep managing follow-up locally",
    priority: "secondary",
    href: "#/stage/run",
    message: "Use the local Work Queue and record real Policy Events and completed work in Git.",
    commands: ["npx filegrc obligations --json"]
  }
});

export function hostedAutomationRecommendation({ implementationReady, oversightCurrent, cutoverComplete, missingContactIds = [], connection }) {
  return hostedAutomationForConnection({
    ...HOSTED_AUTOMATION,
    status: cutoverComplete ? "available" : implementationReady && oversightCurrent && missingContactIds.length === 0 ? "recommended" : "later",
    missingContactIds,
    operating: OPERATING_HOSTED_AUTOMATION,
    placement: "After implementation and the Control collection review, before program content activation.",
    prerequisites: ["Ready owners, contacts, procedures, evidence sources, and enabled Obligations", "Current Control collection review"]
  }, connection);
}

const MARKER_PATH = ".filegrc/hosted-automation.json";

// Repository context is an untrusted hint, never an authorization claim.
export function githubRepository(remote) {
  if (typeof remote !== "string" || /\s/.test(remote)) return null;
  let path;
  const scp = /^git@github\.com:([^?#\s]+)$/.exec(remote);
  if (scp) path = scp[1];
  else {
    try {
      const url = new URL(remote);
      if (url.hostname !== "github.com" || !["https:", "ssh:"].includes(url.protocol)
        || url.port || url.search || url.hash) return null;
      path = url.pathname.slice(1);
    } catch { return null; }
  }
  path = path.replace(/\.git$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)
    && !path.split("/").some(part => [".", ".."].includes(part)) ? path : null;
}

async function originRepository(root) {
  try {
    const { runGitCommand } = await import("./git.js");
    const remotes = (await runGitCommand(root, ["config", "--get-all", "remote.origin.url"], { timeoutMs: 5000 })).split(/\r?\n/);
    return remotes.length === 1 ? githubRepository(remotes[0]) : null;
  } catch { return null; }
}

export async function assessHostedAutomation(root) {
  const result = {
    contractVersion: 1, configurationStatus: "absent", markerVersion: null,
    connectionId: null, dashboardHref: null, setupHref: HOSTED_AUTOMATION.href,
    liveStatus: "unknown", diagnostics: []
  };
  const warn = (status, message) => {
    result.configurationStatus = status;
    result.diagnostics.push({ severity: "warning", code: `${status}-hosted-automation`, path: MARKER_PATH, message });
    return result;
  };
  let marker;
  try { marker = JSON.parse(await readFile(join(root, MARKER_PATH), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return result;
    return warn("invalid", "Cannot read FileGRC Autopilot marker. Expected a UTF-8 JSON object.");
  }
  if (!marker || typeof marker !== "object" || Array.isArray(marker)
    || !Number.isInteger(marker.version) || marker.version < 1) {
    return warn("invalid", "Expected a JSON object with a positive integer marker version.");
  }
  if (marker.version !== 1) return warn("unsupported", "This FileGRC Autopilot marker version is unsupported. Upgrade Core or review setup; the file was left unchanged.");
  if (typeof marker.connectionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(marker.connectionId)
    || Object.keys(marker).some(key => !["version", "connectionId"].includes(key))) {
    return warn("invalid", "Expected exactly version (positive integer) and connectionId (1–128 letters, digits, underscores, or hyphens).");
  }
  result.configurationStatus = "configured";
  result.markerVersion = 1;
  result.connectionId = marker.connectionId;
  result.dashboardHref = `${HOSTED_AUTOMATION.dashboardHref}/connections/${encodeURIComponent(marker.connectionId)}`;
  const repository = await originRepository(root);
  if (repository) result.dashboardHref += `?repository=${encodeURIComponent(repository)}`;
  return result;
}

export function hostedAutomationForConnection(recommendation, connection) {
  if (!connection || connection.configurationStatus === "absent") return recommendation;
  const configured = connection.configurationStatus === "configured";
  return {
    ...recommendation, connection, status: "available",
    title: configured ? "Open FileGRC Autopilot" : "Review FileGRC Autopilot setup",
    href: configured ? connection.dashboardHref : connection.setupHref,
    compactMessage: configured
      ? "FileGRC Autopilot is configured locally. Live status is unknown. Removing the marker does not disconnect service."
      : connection.diagnostics.map(({ message }) => message).join(" "),
    ...(recommendation.operating ? { operating: hostedAutomationForConnection(recommendation.operating, connection) } : {})
  };
}

/** Keep optional recommendations distinct from required program work. */
export function programPathRecommendation(recommendation, stageId) {
  if (stageId === "controls" && recommendation?.status === "recommended") return recommendation;
  if (stageId === "run") return recommendation?.operating || OPERATING_HOSTED_AUTOMATION;
  return null;
}
