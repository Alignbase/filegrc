import assert from "node:assert/strict";
import test from "node:test";
import { assessSourceCoverageReadiness, sourceCoverageComplete } from "../src/source-coverage.js";

const sourceCoverage = {
  id: "source-coverage-identity",
  type: "source-coverage",
  status: "active",
  sourceFamilyId: "identity-access",
  coverageKind: "external-system",
  systemId: "system-identity",
  scopeResourceIds: ["workspace"],
  retrieverIds: ["person-owner"],
  collectionCadence: "Monthly and after material access changes.",
  retention: "Retain through the audit and contractual period.",
  reconciliationMethod: "Compare the export count and filters with the system report.",
  validFrom: "2026-08-03",
  ownerIds: ["person-owner"]
};

const sourceFamily = {
  id: "identity-access",
  title: "Identity and access",
  controlCodes: ["IAM-01"]
};

function loaded(candidateCoverage, records = []) {
  return {
    workspace: {
      id: "workspace",
      type: "workspace",
      ...(candidateCoverage ? { candidateCoverage } : {})
    },
    model: {
      resources: { "source-coverage": {} },
      evidenceSourceFamilies: [sourceFamily]
    },
    resources: [
      {
        id: "control-access",
        type: "control",
        status: "implemented",
        code: "IAM-01"
      },
      sourceCoverage,
      ...records
    ]
  };
}

test("requires a passed source retrieval test after a candidate period is selected", () => {
  assert.equal(sourceCoverageComplete(sourceCoverage, loaded()), true);

  const candidate = { kind: "range", startsOn: "2026-08-03", endsOn: "2027-01-31" };
  assert.equal(sourceCoverageComplete(sourceCoverage, loaded(candidate)), false);
  assert.equal(
    assessSourceCoverageReadiness(loaded(candidate), ["control-access"])[0].complete,
    false
  );

  const testEvidence = {
    id: "evidence-source-test",
    type: "evidence",
    sourceSystemId: "system-identity",
    readinessTest: true,
    coveredSourceFamilyIds: ["identity-access"],
    accessConfirmed: true,
    retrievalResult: "passed"
  };
  const testedCoverage = {
    ...sourceCoverage,
    readinessTestEvidenceIds: [testEvidence.id]
  };
  const tested = loaded(candidate, [testEvidence]);
  tested.resources = tested.resources.map((record) => (
    record.id === sourceCoverage.id ? testedCoverage : record
  ));
  assert.equal(sourceCoverageComplete(testedCoverage, tested), true);
  assert.equal(
    assessSourceCoverageReadiness(tested, ["control-access"])[0].complete,
    true
  );
});
