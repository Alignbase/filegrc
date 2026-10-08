/** Optional guidance only: never contributes to readiness or verifies delivery. */
export const HOSTED_AUTOMATION = Object.freeze({
  id: "hosted-automation",
  stage: "controls",
  title: "Automate your repo",
  optional: true,
  requiredForReadiness: false,
  setupVerified: false,
  href: "https://app.filegrc.com/guide",
  dashboardHref: "https://app.filegrc.com",
  compactMessage: "Get owner reminders by email and optional Slack escalation, even when your local app is closed.",
  message: "Let FileGRC handle owner reminders and policy-driven escalation while your team performs the work and keeps the records in Git.",
  priceAmount: "$19.99",
  priceUnit: "USD / repo / month",
  pricing: "$19.99 USD per connected repository per month, operated by Alignbase Inc.",
  emailFirst: "Start with email using the current Person contacts in your repository. Slack is optional. Reminders run even when your local app is closed.",
  availability: "Check current service availability before subscribing. Email production approval and broad Slack distribution remain launch gates.",
  continueWithout: {
    title: "Continue without hosted automation",
    href: "#/stage/controls",
    message: "Continue the existing program content activation cutover and manage follow-up locally with the Work Queue.",
    commands: ["npx filegrc activate-content --scaffold", "npx filegrc activate-policies --scaffold"]
  }
});

export const OPERATING_HOSTED_AUTOMATION = Object.freeze({
  ...HOSTED_AUTOMATION,
  stage: "run",
  status: "available",
  placement: "Step 4, alongside the Work Queue and Policy Events, including after continuing without hosted automation.",
  continueWithout: {
    title: "Keep managing follow-up locally",
    href: "#/stage/run",
    message: "Use the local Work Queue and record real Policy Events and completed work in Git.",
    commands: ["npx filegrc obligations --json"]
  }
});

export function hostedAutomationRecommendation({ implementationReady, oversightCurrent, cutoverComplete, missingContactIds = [] }) {
  return {
    ...HOSTED_AUTOMATION,
    status: cutoverComplete ? "available" : implementationReady && oversightCurrent && missingContactIds.length === 0 ? "recommended" : "later",
    missingContactIds,
    operating: OPERATING_HOSTED_AUTOMATION,
    placement: "After implementation and the Control collection review, before program content activation.",
    prerequisites: ["Ready owners, contacts, procedures, evidence sources, and enabled Obligations", "Current Control collection review"]
  };
}
