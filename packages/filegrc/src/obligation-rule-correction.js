import { isDeepStrictEqual } from "node:util";
import { loadWorkspace } from "./workspace.js";
import {
  applyResourceBatch,
  contentRevision,
  INTERNAL_WORKFLOW_CAPABILITIES,
} from "./files.js";
import { serializeWorkspaceMutation } from "./mutation.js";
import { createResourceId } from "./id.js";
import { getGitSummary } from "./git.js";
import { currentCalendarDate, isRfc3339Timestamp } from "./time.js";
import { parseCalendarDate } from "./recurrence.js";
import { recordedCorrectionPopulation } from "./obligation-snapshot.js";
import { calculateRevision, revisionsMatch } from "./revisions.js";

export async function scaffoldObligationRuleCorrection(input, options = {}) {
  const loaded = await loadWorkspace(input);
  const source = loaded.entries.find(
    (e) =>
      e.record.type === "obligation-rule" && e.record.id === options.ruleId,
  );
  if (!source || source.record.status !== "active")
    throw new Error("Select an active rule to correct through a successor.");
  if (
    !source.record.selector ||
    source.record.completionCoverage === "whole-period"
  )
    throw new Error(
      "Snapshot correction cannot remove a whole-period duty or replace an unscoped rule. Use normal prospective rule review.",
    );
  const obligation = loaded.entries.find(
    (e) => e.record.id === source.record.obligationId,
  );
  const occurrences = loaded.entries.filter(
    (e) =>
      e.record.type === "obligation-occurrence" &&
      e.record.ruleId === source.record.id &&
      e.record.status === "open",
  );
  const rule = structuredClone(source.record);
  for (const key of [
    "approvedByIds",
    "approvedOn",
    "effectiveAt",
    "retiredOn",
    "timezone",
    "supersedesId",
    "cutoverDecision",
  ])
    delete rule[key];
  rule.id = createResourceId(
    "obligation-rule",
    `${source.record.title} snapshot correction`,
    loaded.resources.map((r) => r.id),
  );
  Object.assign(rule, {
    title: `${source.record.title} snapshot correction`,
    status: "proposed",
    selector: { ...rule.selector, cutoff: "review-date" },
    completionCoverage: "point-in-time",
    rationale: null,
  });
  return {
    ruleId: source.record.id,
    record: rule,
    approvedByIds: [],
    approvedOn: null,
    effectiveAt: null,
    confirmPointInTimeDuty: false,
    confirmRecordedPopulation: false,
    corrections: occurrences.map(({ record }) => ({
      sourceOccurrenceId: record.id,
      populationAsOf: null,
    })),
    sourceRevision: getGitSummary(loaded.root).commit,
    expectedRevisions: Object.fromEntries(
      [source, obligation, ...occurrences].map((e) => [
        e.record.id,
        contentRevision(e.source),
      ]),
    ),
    instructions:
      "Record the actual management authorization, rationale and observation date for each selected open occurrence. Preserve the existing frequency, allowed window, proof, member dispositions and earlier approvals. Remove unselected occurrences from corrections; they remain governed by their original rule. This does not approve shared schedule-set oversight.",
  };
}

export async function previewObligationRuleCorrection(
  input,
  payload,
  options = {},
) {
  const loaded = await loadWorkspace(input),
    scaffold = await scaffoldObligationRuleCorrection(input, {
      ruleId: payload.ruleId,
    });
  const prior = loaded.resources.find((r) => r.id === payload.ruleId),
    obligation = loaded.resources.find((r) => r.id === prior.obligationId);
  if (!payload.confirmPointInTimeDuty || !payload.confirmRecordedPopulation)
    throw new Error(
      "Confirm that the actual governing duty is point-in-time work and the retained population is supported by its recorded work.",
    );
  const approvedOn = payload.approvedOn,
    effectiveAt = payload.effectiveAt,
    now = options.now ? new Date(options.now) : new Date();
  const today = currentCalendarDate(loaded.workspace.timezone, now);
  if (
    !parseCalendarDate(approvedOn) ||
    approvedOn !== today ||
    !isRfc3339Timestamp(effectiveAt) ||
    currentCalendarDate(loaded.workspace.timezone, new Date(effectiveAt)) !==
      today ||
    new Date(effectiveAt) > now
  ) {
    throw new Error(
      "Record today's actual authorization date and effective timestamp, without backdating or future authorization.",
    );
  }
  if (
    !payload.approvedByIds?.length ||
    payload.approvedByIds.some(
      (id) =>
        !loaded.resources.some(
          (r) => r.id === id && r.type === "person" && r.status === "active",
        ),
    )
  )
    throw new Error(
      "Name the active People who actually authorized the correction.",
    );
  const expectedRule = {
    ...scaffold.record,
    id: payload.record?.id,
    title: payload.record?.title,
    rationale: payload.record?.rationale,
  };
  if (
    !isDeepStrictEqual(expectedRule, payload.record) ||
    !String(payload.record.rationale || "").trim()
  )
    throw new Error(
      "A snapshot correction may change only its identity, title, rationale, cutoff and point-in-time completion criterion. Preserve the approved frequency, window and selector filters.",
    );
  if (
    !payload.corrections?.length ||
    new Set(payload.corrections.map((c) => c.sourceOccurrenceId)).size !==
      payload.corrections.length
  )
    throw new Error("Select each supported open occurrence once.");
  for (const [id, revision] of Object.entries(scaffold.expectedRevisions)) {
    if (!revisionsMatch("content", payload.expectedRevisions?.[id], revision))
      throw new Error(
        "The source rule, Obligation or open occurrence changed. Scaffold the correction again.",
      );
  }
  if (payload.sourceRevision !== scaffold.sourceRevision)
    throw new Error("The committed population source changed. Scaffold again.");
  const rule = {
    ...payload.record,
    status: "active",
    approvedByIds: [...new Set(payload.approvedByIds)],
    approvedOn,
    effectiveAt,
    timezone: loaded.workspace.timezone,
    supersedesId: prior.id,
    cutoverDecision: "correct-open-window",
  };
  const updates = [
    { ...prior, status: "retired", retiredOn: today },
    {
      ...obligation,
      activeRuleId: rule.id,
      ruleIds: [...new Set([...(obligation.ruleIds || []), rule.id])],
    },
  ];
  const ids = loaded.resources.map((r) => r.id),
    occurrences = [];
  for (const correction of payload.corrections) {
    const source = loaded.resources.find(
      (r) => r.id === correction.sourceOccurrenceId,
    );
    const date = correction.populationAsOf;
    if (
      source?.type !== "obligation-occurrence" ||
      source.status !== "open" ||
      source.ruleId !== prior.id
    )
      throw new Error(
        "Only an open occurrence of this exact source rule can be corrected.",
      );
    if (
      !parseCalendarDate(date) ||
      date < source.coverage.startsOn ||
      date > source.coverage.endsOn ||
      date > today
    )
      throw new Error(
        "Use the actual population observation date inside the original allowed window, never a future date.",
      );
    const occurrence = {
      ...structuredClone(source),
      id: createResourceId(
        "obligation-occurrence",
        `${source.id} snapshot correction ${today}`,
        ids,
      ),
      title: `${source.title} snapshot correction`,
      status: "open",
      ruleId: rule.id,
      membershipCutoffAt: date,
      supersedesId: source.id,
      populationSourceRevision: payload.sourceRevision,
    };
    ids.push(occurrence.id);
    for (const key of [
      "collectionReviewId",
      "collectionReviewCommit",
      "collectionReviewRevision",
      "collectionRevision",
      "scopeRevision",
      "requiredCoverage",
      "conclusion",
      "reviewedByIds",
      "reconciledAt",
    ])
      delete occurrence[key];
    const population = recordedCorrectionPopulation(loaded, occurrence, rule);
    if (!population)
      throw new Error(
        "The original occurrence and population must be retained in the selected committed source before correction.",
      );
    const members = new Map(
      occurrence.members.map((member) => [member.resourceId, member]),
    );
    occurrence.members = population.memberIds.map(
      (id) =>
        members.get(id) || {
          resourceId: id,
          disposition: "expected",
          result: "pending",
          completionResourceIds: [],
        },
    );
    occurrence.expectedCount = occurrence.members.filter(
      (m) => m.disposition === "expected",
    ).length;
    occurrence.completedCount = occurrence.members.filter(
      (m) => m.disposition === "expected" && m.result === "passed",
    ).length;
    occurrences.push(occurrence);
    updates.push({ ...source, status: "superseded" });
  }
  const reviewed = { ...payload };
  delete reviewed.confirmedRevision;
  const revision = calculateRevision("content", JSON.stringify(reviewed));
  return {
    revision,
    rule,
    occurrences,
    updates,
    instructions:
      "Review the preserved dates, original and new population rows, N/A decisions and proof links. This writes a successor and open corrections; reconcile their actual results separately.",
  };
}

export async function correctObligationRule(input, payload, options = {}) {
  return serializeWorkspaceMutation(input, async (root) => {
    const preview = await previewObligationRuleCorrection(
      root,
      payload,
      options,
    );
    if (!revisionsMatch("content", payload.confirmedRevision, preview.revision))
      throw new Error(
        "Preview and confirm this exact correction before saving.",
      );
    await applyResourceBatch(root, {
      workflowCapability:
        INTERNAL_WORKFLOW_CAPABILITIES.obligationRuleCorrection,
      create: [preview.rule, ...preview.occurrences],
      update: preview.updates,
      expectedRevisions: payload.expectedRevisions,
    });
    return { rule: preview.rule, occurrences: preview.occurrences };
  });
}
