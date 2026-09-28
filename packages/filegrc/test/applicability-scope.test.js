import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadModel } from "../model/index.js";
import {
  applicabilityReviewIsCurrent,
  applicabilityScopeRevision
} from "../src/applicability-scope.js";
import { planApplicabilityReview } from "../src/batch-review.js";
import { createAppStateSection } from "../src/state.js";
import { loadWorkspace } from "../src/workspace.js";
import { makeComprehensiveWorkspace } from "./fixtures.js";

test("model v7 rejects legacy applicability revisions and binds dependent reviews to requirement decisions", () => {
  const requirement = { id: "requirement-one", type: "requirement", frameworkId: "framework-one", reference: "CC1.1" };
  const control = { id: "control-one", type: "control", title: "Control one", policyIds: ["policy-one"] };
  const system = { id: "system-one", type: "system", title: "System one" };
  const secondSystem = { id: "system-two", type: "system", title: "System two" };
  const framework = { id: "framework-one", type: "framework", title: "Framework", version: "1", status: "active" };
  const policy = { id: "policy-one", type: "policy", status: "active", policyKind: "information-security" };
  const component = {
    id: "component-one",
    type: "component",
    status: "active",
    vendorId: "vendor-one",
    description: "Runs the service.",
    systemUses: [{ systemId: system.id, roles: ["service-delivery"] }]
  };
  const vendor = { id: "vendor-one", type: "vendor", status: "active", category: "hosting" };
  const program = {
    id: "program-one",
    type: "program",
    systemIds: [system.id, secondSystem.id],
    frameworkIds: ["framework-one"],
    controlIds: [control.id],
    riskMethodology: "Likelihood and impact",
    requirementApplicability: [{ requirementId: requirement.id, decision: "applicable", rationale: "In scope." }]
  };
  const resources = [program, system, secondSystem, framework, requirement, control, policy, component, vendor];
  const model7 = loadModel("7");

  assert.equal(applicabilityReviewIsCurrent(
    { scopeRevision: "forged" },
    control,
    program,
    resources,
    model7
  ), false);
  assert.equal(applicabilityReviewIsCurrent(
    { scopeRevision: "legacy-git-revision" },
    control,
    program,
    resources,
    loadModel("6")
  ), true);

  const applicableRevision = applicabilityScopeRevision(control, program, resources, model7);
  assert.equal(
    applicabilityScopeRevision(control, { ...program, systemIds: [...program.systemIds].reverse() }, resources, model7),
    applicableRevision
  );
  assert.equal(
    applicabilityScopeRevision({ ...control, ownerIds: ["person-one", "person-two"] }, program, resources, model7),
    applicabilityScopeRevision({ ...control, ownerIds: ["person-two", "person-one"] }, program, resources, model7)
  );
  const structuredMethod = {
    method: "Score likelihood and impact",
    likelihoodScale: ["unlikely", "likely"],
    impactScale: ["low", "high"],
    ratingBands: { low: "1-2", high: "3-4" }
  };
  const structuredRevision = applicabilityScopeRevision(control, { ...program, riskMethodology: structuredMethod }, resources, model7);
  assert.notEqual(
    applicabilityScopeRevision(control, {
      ...program,
      riskMethodology: { ...structuredMethod, likelihoodScale: [...structuredMethod.likelihoodScale].reverse() }
    }, resources, model7),
    structuredRevision
  );
  const changedProgram = {
    ...program,
    requirementApplicability: [{ requirementId: requirement.id, decision: "not-applicable", rationale: "Changed rationale." }]
  };
  assert.notEqual(
    applicabilityScopeRevision(control, changedProgram, resources, model7),
    applicableRevision
  );
  assert.notEqual(
    applicabilityScopeRevision(control, { ...program, riskMethodology: "Threat, likelihood, and impact" }, resources, model7),
    applicableRevision
  );
  for (const changed of [
    { ...framework, version: "2" },
    { ...policy, requirementIds: ["requirement-two"] },
    { ...component, description: "Stores and processes customer data." },
    { ...vendor, criticality: "critical" }
  ]) {
    assert.notEqual(
      applicabilityScopeRevision(
        control,
        program,
        resources.map((resource) => resource.id === changed.id ? changed : resource),
        model7
      ),
      applicableRevision
    );
  }
  for (const changed of [
    { ...policy, status: "in-review" },
    { ...policy, version: "2", effectiveOn: "2026-09-27" },
    { ...policy, approvedContentRevisions: { body: "changed" } }
  ]) {
    assert.equal(applicabilityScopeRevision(control, program, resources.map((resource) => (
      resource.id === policy.id ? changed : resource
    )), model7), applicableRevision);
  }
  const unselectedControl = { id: "control-two", type: "control", title: "Control two", policyIds: [policy.id] };
  const unselectedRevision = applicabilityScopeRevision(unselectedControl, program, resources, model7);
  assert.equal(
    applicabilityScopeRevision(
      unselectedControl,
      program,
      resources.map((resource) => resource.id === policy.id ? { ...policy, version: "2" } : resource),
      model7
    ),
    unselectedRevision
  );
  assert.equal(
    applicabilityScopeRevision(requirement, changedProgram, resources, model7),
    applicabilityScopeRevision(requirement, program, resources, model7),
    "a Requirement review should not stale only because its own decision was saved"
  );
});

test("a Policy lifecycle change preserves 42 Requirement and two Commitment scope reviews", () => {
  const model = loadModel("11");
  const policy = { id: "policy-one", type: "policy", status: "approved", version: "1" };
  const system = { id: "system-one", type: "system", title: "Service" };
  const framework = { id: "framework-one", type: "framework", status: "active", title: "Criteria" };
  const requirements = Array.from({ length: 42 }, (_, index) => ({
    id: `requirement-${index + 1}`, type: "requirement", frameworkId: framework.id,
    reference: `CC${index + 1}`
  }));
  const commitments = Array.from({ length: 2 }, (_, index) => ({
    id: `commitment-${index + 1}`, type: "commitment", status: "active",
    systemIds: [system.id], requirementIds: [requirements[index].id],
    policyIds: [policy.id]
  }));
  const control = { id: "control-one", type: "control", policyIds: [policy.id] };
  const program = {
    id: "program-one", type: "program", systemIds: [system.id],
    frameworkIds: [framework.id], controlIds: [control.id],
    requirementApplicability: []
  };
  const resources = [policy, system, framework, control, ...requirements, ...commitments];
  const reviews = [...requirements, ...commitments].map((record) => ({
    record,
    review: { decision: "applicable", scopeRevision: applicabilityScopeRevision(
      record, program, resources, model, { legacyPolicyStatus: "current" }
    ) }
  }));
  const changed = resources.map((record) => record.id === policy.id
    ? { ...record, status: "in-review" } : record);
  assert.equal(reviews.filter(({ record, review }) => applicabilityReviewIsCurrent(
    review, record, program, changed, model
  )).length, 44);
  const activated = resources.map((record) => record.id === policy.id
    ? { ...record, status: "active", effectiveOn: "2026-09-27" } : record);
  assert.equal(reviews.filter(({ record, review }) => applicabilityReviewIsCurrent(
    review, record, program, activated, model
  )).length, 44);
  const revisedPolicy = activated.map((record) => record.id === policy.id
    ? { ...record, version: "2" } : record);
  assert.equal(reviews.every(({ record, review }) => !applicabilityReviewIsCurrent(
    review, record, program, revisedPolicy, model
  )), true, "legacy reviews stay stale when their former Policy revision cannot be verified");
  const changedScope = changed.map((record) => record.id === system.id
    ? { ...record, boundary: "Expanded service boundary" } : record);
  assert.equal(reviews.every(({ record, review }) => !applicabilityReviewIsCurrent(
    review, record, program, changedScope, model
  )), true);
});

test("mixed batches bind dependent reviews to the post-review Requirement decisions", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-mixed-applicability-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "7");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const requirement = loaded.resources.find(({ type, id }) => (
    type === "requirement" && !(program.requirementApplicability || []).some(({ requirementId }) => requirementId === id)
  )) || loaded.resources.find(({ type }) => type === "requirement");
  const control = loaded.resources.find(({ type }) => type === "control");
  const plan = await planApplicabilityReview(root, {
    reviewedByIds: ["person-independent-approver-example"],
    reviewedOn: "2026-08-22",
    decisions: [
      { id: requirement.id, decision: "applicable", rationale: "Required for the selected service scope." },
      { id: control.id, decision: "applicable", rationale: "Implements the selected service requirements." }
    ]
  });
  const reviewedProgram = plan.changes.update.find(({ id }) => id === program.id);
  const reviewedControl = plan.changes.update.find(({ id }) => id === control.id);

  assert.equal(applicabilityReviewIsCurrent(
    reviewedControl.applicabilityReview,
    reviewedControl,
    reviewedProgram,
    loaded.resources,
    loaded.model
  ), true);
});

test("browser state distinguishes a stale review from a missing review", async (context) => {
  const root = await mkdtemp(`${tmpdir()}/filegrc-applicability-status-`);
  context.after(() => import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })));
  await makeComprehensiveWorkspace(root, "11");
  const loaded = await loadWorkspace(root);
  const program = loaded.resources.find(({ type }) => type === "program");
  const stale = loaded.resources.find(({ type }) => type === "requirement");
  const missing = { ...stale, id: "requirement-unreviewed" };
  loaded.resources.push(missing);
  program.requirementApplicability = [{
    requirementId: stale.id,
    decision: "applicable",
    rationale: "Prior management decision.",
    scopeRevision: "filegrc:applicability-scope:v1:sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }];
  const section = await createAppStateSection(loaded, "program", { programId: program.id });
  assert.equal(section.applicabilityReviewStatuses[stale.id], "stale");
  assert.equal(section.applicabilityReviewStatuses[missing.id], "missing");
  const criteria = section.programReadiness.stages.find(({ id }) => id === "scope").items
    .find(({ id }) => id === "criteria");
  assert.ok(criteria.staleRequirementIds.includes(stale.id));
  assert.ok(criteria.missingDecisionRequirementIds.includes(missing.id));
});
