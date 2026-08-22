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
    { ...policy, status: "retired" },
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
  const unselectedControl = { id: "control-two", type: "control", title: "Control two", policyIds: [policy.id] };
  const unselectedRevision = applicabilityScopeRevision(unselectedControl, program, resources, model7);
  assert.notEqual(
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
