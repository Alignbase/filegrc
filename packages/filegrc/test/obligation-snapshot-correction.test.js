import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeComprehensiveWorkspace } from "./fixtures.js";
import { runCli } from "../src/cli.js";
import {
  commitWorkspaceFiles,
  initializeGitWorkspace,
  writeJson,
  executeCli,
} from "./helpers.js";
import { contentRevision } from "../src/files.js";
import { loadWorkspace, validateWorkspace } from "../src/index.js";
import {
  scaffoldObligationOccurrence,
  saveObligationOccurrence,
  planObligations,
  assessCompletionForObligation,
} from "../src/obligations.js";
import {
  scaffoldObligationRuleCorrection,
  previewObligationRuleCorrection,
  correctObligationRule,
} from "../src/obligation-rule-correction.js";
import { currentSnapshotPopulation } from "../src/obligation-snapshot.js";
import { getGitSummary } from "../src/git.js";
import { completionCoversRequiredPeriod } from "../src/obligation-timing.js";
import { currentCalendarDate } from "../src/time.js";
import { addCalendarDays } from "../src/recurrence.js";

async function fixture(t, { unit = "year" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "filegrc-snapshot-correction-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeComprehensiveWorkspace(root, "11");
  let loaded = await loadWorkspace(root);
  const today = currentCalendarDate(loaded.workspace.timezone),
    start = addCalendarDays(today, -2),
    observed = addCalendarDays(today, -1);
  const oe = loaded.entries.find((e) => e.record.type === "obligation"),
    re = loaded.entries.find((e) => e.record.type === "obligation-rule");
  const obligation = {
    ...oe.record,
    activityType: "vendor-review",
    scopeResourceIds: [],
  };
  const rule = {
    ...re.record,
    recurrence: { mode: "calendar", unit, interval: 1, anchorDate: start },
    window: { precision: "date", startsAfter: 0, dueAfter: 30 },
    selector: {
      resourceType: "vendor",
      membershipMode: "as-of",
      cutoff: "window-end",
      statuses: ["active"],
    },
  };
  await writeJson(oe.path, obligation);
  await writeJson(re.path, rule);
  for (const e of loaded.entries.filter(
    (e) => e.record.type === "obligation-occurrence",
  ))
    await rm(e.path);
  const ve = loaded.entries.find((e) => e.record.type === "vendor-review");
  await writeJson(ve.path, {
    ...ve.record,
    completedOn: observed,
    coverage: { kind: "as-of", on: observed },
  });
  const ce = loaded.entries.find((e) => e.record.type === "component");
  await writeJson(ce.path, { ...ce.record, vendorId: "vendor-example" });
  await initializeGitWorkspace(root);
  await writeJson(join(root, "data/workspace.json"), {
    ...loaded.workspace,
    dataModelVersion: "13",
  });
  await commitWorkspaceFiles(root, "Adopt current model");
  const s = await scaffoldObligationOccurrence(root, {
    obligationId: obligation.id,
    windowStart: start,
    asOf: today,
  });
  await saveObligationOccurrence(root, { record: s.record });
  await commitWorkspaceFiles(root, "Record reviewed members");
  return {
    root,
    today,
    start,
    observed,
    obligation,
    rule,
    occurrence: s.record,
    ve,
  };
}
async function snapshotSuccessor(f) {
  let p = await scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id });
  p = {
    ...p,
    approvedByIds: ["person-example"],
    approvedOn: f.today,
    effectiveAt: new Date().toISOString(),
    confirmPointInTimeDuty: true,
    confirmRecordedPopulation: true,
    record: {
      ...p.record,
      rationale: "Review the actual observed population as a point snapshot.",
    },
    corrections: [
      { sourceOccurrenceId: f.occurrence.id, populationAsOf: f.observed },
    ],
  };
  const preview = await previewObligationRuleCorrection(f.root, p);
  await correctObligationRule(f.root, {
    ...p,
    confirmedRevision: preview.revision,
  });
  await commitWorkspaceFiles(
    f.root,
    "Approve snapshot successor without changing original duty timing",
  );
  return preview.rule;
}
const item = async (f) => {
  const l = await loadWorkspace(f.root);
  return planObligations(l.resources, {
    root: f.root,
    model: l.model,
    asOf: f.today,
    from: f.start,
    through: f.today,
    includeComplete: true,
  }).calendarItems.find((i) => i.obligationId === f.obligation.id);
};

test("reviewed successor preserves the original window, historic proof and management approval", async (t) => {
  const f = await fixture(t);
  const proof = await readFile(f.ve.path, "utf8");
  const before = await item(f);
  assert.equal(before.status, "waiting");
  assert.equal(before.timingStatus, "due");
  let p = await scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id });
  p = {
    ...p,
    approvedByIds: ["person-example"],
    approvedOn: f.today,
    effectiveAt: new Date().toISOString(),
    confirmPointInTimeDuty: true,
    confirmRecordedPopulation: true,
    record: {
      ...p.record,
      rationale:
        "Management confirms this duty inspects the service at the recorded review date.",
    },
    corrections: [
      { sourceOccurrenceId: f.occurrence.id, populationAsOf: f.observed },
    ],
  };
  const preview = await previewObligationRuleCorrection(f.root, p);
  await correctObligationRule(f.root, {
    ...p,
    confirmedRevision: preview.revision,
  });
  const l = await loadWorkspace(f.root);
  const original = l.resources.find((r) => r.id === f.rule.id);
  assert.deepEqual(
    { ...original, status: f.rule.status, retiredOn: undefined },
    { ...f.rule, retiredOn: undefined },
  );
  assert.equal(
    l.resources.find((r) => r.id === f.occurrence.id).status,
    "superseded",
  );
  const after = await item(f);
  assert.equal(after.dueWindowStart, f.start);
  assert.equal(after.dueWindowEnd, before.dueWindowEnd);
  assert.equal(after.membershipFinal, true);
  assert.equal(after.status, "due");
  assert.deepEqual(after.resolvedMemberIds, before.resolvedMemberIds);
  const final = await scaffoldObligationOccurrence(f.root, {
    obligationId: f.obligation.id,
    windowStart: f.start,
    asOf: f.today,
  });
  await saveObligationOccurrence(f.root, {
    record: {
      ...final.record,
      status: "reconciled",
      conclusion: "complete",
      reviewedByIds: ["person-example"],
      reconciledAt: new Date().toISOString(),
    },
    expectedRevision: final.revision,
  });
  assert.equal((await item(f)).status, "complete");
  assert.equal(await readFile(f.ve.path, "utf8"), proof);
  const v = await validateWorkspace(f.root);
  assert.equal(v.ok, true, JSON.stringify(v.diagnostics));
  await commitWorkspaceFiles(
    f.root,
    "Record management correction and reconciliation",
  );
  assert.equal((await validateWorkspace(f.root)).ok, true);
  const correction = await scaffoldObligationOccurrence(f.root, {
    obligationId: f.obligation.id,
    windowStart: f.start,
    asOf: f.today,
    correctFinalized: true,
  });
  assert.equal(
    correction.record.populationSourceRevision,
    preview.occurrences[0].populationSourceRevision,
  );
  await saveObligationOccurrence(f.root, {
    record: correction.record,
    expectedRevision: correction.revision,
  });
  const corrected = await loadWorkspace(f.root);
  assert.equal(
    corrected.resources.find((r) => r.id === final.record.id).status,
    "superseded",
  );
  assert.equal(
    (await validateWorkspace(f.root)).ok,
    true,
    JSON.stringify((await validateWorkspace(f.root)).diagnostics),
  );
});

test("snapshot correction rejects changed duties, backdating, stale confirmation and whole-period downgrades", async (t) => {
  const f = await fixture(t);
  let p = await scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id });
  p = {
    ...p,
    approvedByIds: ["person-example"],
    approvedOn: f.today,
    effectiveAt: new Date().toISOString(),
    confirmPointInTimeDuty: true,
    confirmRecordedPopulation: true,
    record: { ...p.record, rationale: "Confirm periodic point review." },
    corrections: [
      { sourceOccurrenceId: f.occurrence.id, populationAsOf: f.observed },
    ],
  };
  await assert.rejects(
    previewObligationRuleCorrection(f.root, { ...p, approvedOn: f.observed }),
    /actual authorization/,
  );
  await assert.rejects(
    previewObligationRuleCorrection(f.root, {
      ...p,
      record: { ...p.record, window: { ...p.record.window, dueAfter: 60 } },
    }),
    /Preserve/,
  );
  await assert.rejects(correctObligationRule(f.root, p), /Preview and confirm/);
  const l = await loadWorkspace(f.root),
    re = l.entries.find((e) => e.record.id === f.rule.id);
  await writeJson(re.path, {
    ...re.record,
    completionCoverage: "whole-period",
  });
  await assert.rejects(
    scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id }),
    /whole-period/,
  );
});

test("whole-period proof must cover its complete range and be executed after its end", async (t) => {
  const f = await fixture(t),
    l = await loadWorkspace(f.root),
    proof = l.resources.find((r) => r.type === "vendor-review");
  const requiredCoverage = {
    kind: "range",
    startsOn: f.start,
    endsOn: f.observed,
  };
  const options = { asOf: f.today, requiredCoverage };
  assert.equal(
    assessCompletionForObligation(proof, f.obligation, l, options).complete,
    false,
  );
  assert.equal(
    assessCompletionForObligation(
      { ...proof, coverage: requiredCoverage, completedOn: f.observed },
      f.obligation,
      l,
      options,
    ).complete,
    false,
  );
  assert.equal(
    assessCompletionForObligation(
      { ...proof, coverage: requiredCoverage, completedOn: f.today },
      f.obligation,
      l,
      options,
    ).complete,
    true,
  );
});

test("successor preserves unselected overlapping predecessor windows and their proof links", async (t) => {
  const f = await fixture(t, { unit: "day" });
  const other = await scaffoldObligationOccurrence(f.root, {
    obligationId: f.obligation.id,
    windowStart: f.observed,
    asOf: f.today,
  });
  await saveObligationOccurrence(f.root, { record: other.record });
  await commitWorkspaceFiles(f.root, "Record another open overlapping window");
  let p = await scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id });
  p = {
    ...p,
    approvedByIds: ["person-example"],
    approvedOn: f.today,
    effectiveAt: new Date().toISOString(),
    confirmPointInTimeDuty: true,
    confirmRecordedPopulation: true,
    record: {
      ...p.record,
      rationale: "Correct only the selected point review.",
    },
    corrections: [
      { sourceOccurrenceId: f.occurrence.id, populationAsOf: f.observed },
    ],
  };
  const preview = await previewObligationRuleCorrection(f.root, p);
  await correctObligationRule(f.root, {
    ...p,
    confirmedRevision: preview.revision,
  });
  const l = await loadWorkspace(f.root),
    plan = planObligations(l.resources, {
      root: f.root,
      model: l.model,
      asOf: f.today,
      from: f.start,
      through: f.today,
      includeComplete: true,
    });
  const retained = plan.calendarItems.find(
    (i) => i.occurrenceId === other.record.id,
  );
  assert.ok(retained);
  assert.equal(retained.ruleId, f.rule.id);
  assert.deepEqual(
    retained.completionResourceIds,
    other.record.members.flatMap((m) => m.completionResourceIds),
  );
  assert.equal(
    plan.calendarItems.filter((i) => i.dueWindowStart === f.observed).length,
    1,
  );
  const missing = planObligations(l.resources, {
    root: f.root,
    model: l.model,
    asOf: f.today,
    from: f.start,
    through: f.today,
    includeComplete: true,
  });
  assert.ok(missing.calendarItems.some((i) => i.dueWindowStart === f.today));
});

test("recorded non-applicability survives correction and known additions stay pending", async (t) => {
  const f = await fixture(t);
  let l = await loadWorkspace(f.root);
  const old = l.entries.find((e) => e.record.id === f.occurrence.id);
  const row = {
    ...old.record.members[0],
    disposition: "not-applicable",
    result: "pending",
    rationale: "The reviewed service has no applicable work in this procedure.",
  };
  await saveObligationOccurrence(f.root, {
    record: {
      ...old.record,
      members: [row],
      expectedCount: 0,
      completedCount: 0,
    },
    expectedRevision: contentRevision(old.source),
  });
  const vendor = l.resources.find((r) => r.type === "vendor"),
    component = l.resources.find((r) => r.type === "component");
  await writeJson(join(f.root, "data/vendors/vendor-new.json"), {
    ...vendor,
    id: "vendor-new",
    title: "New reviewed service",
  });
  await writeJson(join(f.root, "data/components/component-new.json"), {
    ...component,
    id: "component-new",
    title: "New service source",
    vendorId: "vendor-new",
  });
  await commitWorkspaceFiles(
    f.root,
    "Record explicit population decisions and eligible service",
  );
  let p = await scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id });
  p = {
    ...p,
    approvedByIds: ["person-example"],
    approvedOn: f.today,
    effectiveAt: new Date().toISOString(),
    confirmPointInTimeDuty: true,
    confirmRecordedPopulation: true,
    record: {
      ...p.record,
      rationale: "Confirm snapshot duty and retain prior disposition.",
    },
    corrections: [
      { sourceOccurrenceId: f.occurrence.id, populationAsOf: f.observed },
    ],
  };
  const preview = await previewObligationRuleCorrection(f.root, p);
  assert.deepEqual(
    preview.occurrences[0].members.find((m) => m.resourceId === row.resourceId),
    row,
  );
  assert.equal(
    preview.occurrences[0].members.find((m) => m.resourceId === "vendor-new")
      .result,
    "pending",
  );
  await correctObligationRule(f.root, {
    ...p,
    confirmedRevision: preview.revision,
  });
  const result = await item(f);
  assert.equal(result.status, "due");
  assert.equal(result.memberWorkComplete, false);
  assert.equal(result.expectedCount, 1);
});

test("fresh review-date snapshots freeze committed observed scope without converting it into period coverage", async (t) => {
  const f = await fixture(t, { unit: "day" });
  await snapshotSuccessor(f);
  const snapshot = await scaffoldObligationOccurrence(f.root, {
    obligationId: f.obligation.id,
    windowStart: f.today,
    populationAsOf: f.today,
    asOf: f.today,
  });
  await saveObligationOccurrence(f.root, { record: snapshot.record });
  await commitWorkspaceFiles(f.root, "Retain contemporaneous observed scope");
  let l = await loadWorkspace(f.root);
  assert.ok(snapshot.record.scopeRevision);
  assert.equal(snapshot.record.requiredCoverage, undefined);
  const current = () =>
    planObligations(l.resources, {
      root: f.root,
      model: l.model,
      asOf: f.today,
      from: f.today,
      through: f.today,
      includeComplete: true,
    }).calendarItems.find((i) => i.dueWindowStart === f.today);
  assert.equal(current().membershipFinal, true);
  const vendor = l.resources.find((r) => r.type === "vendor"),
    component = l.resources.find((r) => r.type === "component");
  await writeJson(join(f.root, "data/vendors/vendor-new.json"), {
    ...vendor,
    id: "vendor-new",
    title: "Service added after snapshot",
  });
  await writeJson(join(f.root, "data/components/component-new.json"), {
    ...component,
    id: "component-new",
    title: "Later service source",
    vendorId: "vendor-new",
  });
  await commitWorkspaceFiles(f.root, "Record later eligible service");
  l = await loadWorkspace(f.root);
  assert.deepEqual(current().expectedMemberIds, ["vendor-example"]);
  const v = await validateWorkspace(f.root);
  assert.equal(v.ok, true, JSON.stringify(v.diagnostics));
  await writeJson(join(f.root, "package-lock.json"), {
    lockfileVersion: 3,
    packages: { "node_modules/filegrc": { version: "0.20.8" } },
  });
  assert.ok(
    (await validateWorkspace(f.root)).diagnostics.some(
      (d) => d.code === "snapshot-runtime-adoption-required",
    ),
  );
});

test("unsaved predecessor cycles remain required when correcting another window", async (t) => {
  const f = await fixture(t, { unit: "day" });
  let p = await scaffoldObligationRuleCorrection(f.root, { ruleId: f.rule.id });
  p = {
    ...p,
    approvedByIds: ["person-example"],
    approvedOn: f.today,
    effectiveAt: new Date().toISOString(),
    confirmPointInTimeDuty: true,
    confirmRecordedPopulation: true,
    record: { ...p.record, rationale: "Correct this recorded review only." },
    corrections: [
      { sourceOccurrenceId: f.occurrence.id, populationAsOf: f.observed },
    ],
  };
  const preview = await previewObligationRuleCorrection(f.root, p);
  await correctObligationRule(f.root, {
    ...p,
    confirmedRevision: preview.revision,
  });
  const l = await loadWorkspace(f.root),
    plan = planObligations(l.resources, {
      root: f.root,
      model: l.model,
      asOf: f.today,
      from: f.start,
      through: f.today,
      includeComplete: true,
    });
  const unsaved = plan.calendarItems.find(
    (i) => i.dueWindowStart === f.observed,
  );
  assert.ok(unsaved);
  assert.equal(unsaved.ruleId, f.rule.id);
  assert.equal(unsaved.occurrenceId, null);
  assert.equal(unsaved.status, "due");
});

test("CLI scaffold observation date survives the normal completion envelope", async (t) => {
  const f = await fixture(t, { unit: "day" });
  await snapshotSuccessor(f);
  let l = await loadWorkspace(f.root);
  const proof = {
    ...l.resources.find((r) => r.type === "vendor-review"),
    id: "vendor-review-current",
    completedOn: f.today,
    coverage: { kind: "as-of", on: f.today },
  };
  await writeJson(
    join(f.root, "data/vendor-reviews/vendor-review-current.json"),
    proof,
  );
  await commitWorkspaceFiles(f.root, "Record current dated review");
  const result = await executeCli(runCli, process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "complete",
    f.obligation.id,
    "--root",
    f.root,
    "--scaffold",
    "--window-start",
    f.today,
    "--completed-on",
    f.today,
    "--population-as-of",
    f.today,
    "--json",
  ]);
  const mutation = JSON.parse(result.stdout);
  assert.equal(mutation.populationAsOf, f.today);
  mutation.record = proof;
  delete mutation.content;
  const file = join(f.root, "completion.json");
  await writeJson(file, mutation);
  await executeCli(runCli, process.execPath, [
    fileURLToPath(new URL("../bin/filegrc.js", import.meta.url)),
    "complete",
    f.obligation.id,
    file,
    "--root",
    f.root,
    "--json",
  ]);
  const saved = await loadWorkspace(f.root);
  assert.equal(
    saved.resources.find(
      (r) =>
        r.type === "obligation-occurrence" && r.coverage.startsOn === f.today,
    ).membershipCutoffAt,
    f.today,
  );
});

test("all newly supported operating coverage shapes require explicit runtime adoption", async (t) => {
  const f = await fixture(t),
    l = await loadWorkspace(f.root);
  await writeJson(join(f.root, "package-lock.json"), {
    lockfileVersion: 3,
    packages: { "node_modules/filegrc": { version: "0.20.8" } },
  });
  for (const type of [
    "meeting",
    "vulnerability-scan",
    "exercise",
    "backup-test",
    "control-activity",
  ]) {
    const e = l.entries.find((e) => e.record.type === type);
    assert.ok(e, type);
    await writeJson(e.path, {
      ...e.record,
      coverage: { kind: "as-of", on: f.today },
    });
    assert.ok(
      (await validateWorkspace(f.root)).diagnostics.some(
        (d) => d.code === "snapshot-runtime-adoption-required",
      ),
      type,
    );
    await writeJson(e.path, e.record);
  }
});

test("inclusive whole-period final days do not elapse at morning execution", () => {
  const coverage = {
    kind: "range",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
  };
  assert.equal(
    completionCoversRequiredPeriod(
      { coverage },
      coverage,
      "2026-10-31",
      "2026-10-31",
    ),
    false,
  );
  assert.equal(
    completionCoversRequiredPeriod(
      { coverage },
      coverage,
      "2026-10-31",
      "2026-11-01",
    ),
    false,
  );
  assert.equal(
    completionCoversRequiredPeriod(
      { coverage },
      coverage,
      "2026-11-01",
      "2026-11-01",
    ),
    true,
  );
});

test("committing today's inventory cannot establish an unsupported historic snapshot", async (t) => {
  const f = await fixture(t),
    l = await loadWorkspace(f.root),
    record = {
      ...f.occurrence,
      id: "occurrence-unsupported-history",
      scopeRevision: getGitSummary(f.root).commit,
      membershipCutoffAt: f.observed,
    };
  await writeJson(
    join(
      f.root,
      "data/obligation-occurrences/occurrence-unsupported-history.json",
    ),
    record,
  );
  await commitWorkspaceFiles(
    f.root,
    "Retain invalid imported date for provenance rejection",
  );
  const current = await loadWorkspace(f.root);
  assert.equal(
    currentSnapshotPopulation(current, record, {
      ...f.rule,
      selector: { ...f.rule.selector, cutoff: "review-date" },
    }),
    null,
  );
});

test("whole-period proof keeps its execution date after reconciliation and retirement", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const requiredCoverage = {
    kind: "range",
    startsOn: f.start,
    endsOn: f.start,
  };
  for (const retired of [false, true]) {
    const resources = loaded.resources.map((record) => {
      if (record.id === f.obligation.id)
        return { ...record, status: retired ? "retired" : "active" };
      if (record.id === f.rule.id)
        return {
          ...record,
          status: retired ? "retired" : "active",
          completionCoverage: "whole-period",
          recurrence: {
            mode: "calendar",
            unit: "day",
            interval: 1,
            anchorDate: f.start,
          },
          window: { precision: "date", startsAfter: 1, dueAfter: 2 },
          selector: { ...record.selector, cutoff: "window-start" },
        };
      if (record.type === "vendor-review")
        return { ...record, coverage: requiredCoverage };
      if (record.id === f.occurrence.id)
        return {
          ...record,
          status: "reconciled",
          coverage: { kind: "range", startsOn: f.observed, endsOn: f.today },
          membershipCutoffAt: f.observed,
          occurrenceKey: `${record.programId}:${record.obligationId}:${f.observed}`,
          requiredCoverage,
          conclusion: "complete",
          reviewedByIds: ["person-example"],
          reconciledAt: new Date().toISOString(),
        };
      return record;
    });
    const plan = planObligations(resources, {
      model: loaded.model,
      asOf: f.today,
      from: f.start,
      through: f.today,
      includeComplete: true,
    });
    const occurrence = plan.calendarItems.find(
      (entry) => entry.occurrenceId === f.occurrence.id,
    );
    assert.equal(
      occurrence.status,
      "complete",
      retired ? "retained history" : "current rule",
    );
    assert.deepEqual(occurrence.resolvedMemberIds, ["vendor-example"]);
  }
});

test("whole-period zero and N/A populations wait for the period independently of fixed population finality", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const endsOn = addCalendarDays(f.today, 3);
  for (const members of [
    [],
    [
      {
        ...f.occurrence.members[0],
        disposition: "not-applicable",
        result: "pending",
        rationale: "The fixed scope has no applicable work.",
      },
    ],
  ]) {
    const resources = loaded.resources.map((record) => {
      if (record.id === f.obligation.id)
        return { ...record, status: "retired" };
      if (record.id === f.rule.id)
        return {
          ...record,
          status: "retired",
          completionCoverage: "whole-period",
          selector: { ...record.selector, cutoff: "window-start" },
        };
      if (record.id === f.occurrence.id)
        return {
          ...record,
          requiredCoverage: { kind: "range", startsOn: f.start, endsOn },
          membershipCutoffAt: f.start,
          members,
          expectedCount: 0,
          completedCount: 0,
          status: "reconciled",
          conclusion: members.length
            ? "complete-with-exceptions"
            : "zero-population",
          reviewedByIds: ["person-example"],
          reconciledAt: new Date().toISOString(),
        };
      return record;
    });
    const item = planObligations(resources, {
      model: loaded.model,
      asOf: f.today,
      from: f.start,
      through: f.today,
      includeComplete: true,
    }).calendarItems[0];
    assert.equal(
      item.membershipFinal,
      true,
      "fixed-start population is still frozen",
    );
    assert.equal(item.periodFinal, false);
    assert.equal(item.resolutionsComplete, false);
    assert.equal(item.status, "waiting");
    assert.equal(item.awaitingPeriodEnd, true);
  }
});

test("open populations count expected work separately from reviewed non-applicability", async (t) => {
  const f = await fixture(t);
  const loaded = await loadWorkspace(f.root);
  const resources = loaded.resources.map((record) =>
    record.id === f.occurrence.id
      ? {
          ...record,
          members: record.members.map((member) => ({
            ...member,
            disposition: "not-applicable",
            result: "pending",
            rationale: "Reviewed population member is outside this duty.",
          })),
          expectedCount: 0,
          completedCount: 0,
        }
      : record,
  );
  for (const retired of [false, true]) {
    const scoped = resources.map((record) =>
      retired && [f.obligation.id, f.rule.id].includes(record.id)
        ? { ...record, status: "retired" }
        : record,
    );
    const item = planObligations(scoped, {
      model: loaded.model,
      asOf: f.today,
      from: f.start,
      through: f.today,
      includeComplete: true,
    }).calendarItems.find(
      (candidate) => candidate.occurrenceId === f.occurrence.id,
    );
    assert.equal(item.membershipFinal, false);
    assert.equal(item.memberWorkComplete, true);
    assert.equal(item.expectedCount, 0);
    assert.equal(item.completedCount, 0);
    assert.equal(item.status, "waiting");
  }
});
