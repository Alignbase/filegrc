import assert from "node:assert/strict";
import test from "node:test";
import { currentPartyPeople, partiesIndependent, partyPeople } from "../src/parties.js";

test("resolves active appointments to their current person holder", () => {
  const records = [
    { id: "person-lead", type: "person", status: "active" },
    { id: "person-reviewer", type: "person", status: "active" },
    {
      id: "appointment-policy-owner",
      type: "appointment",
      status: "active",
      holderId: "person-lead"
    },
    {
      id: "appointment-policy-reviewer",
      type: "appointment",
      status: "active",
      holderId: "person-reviewer"
    },
    {
      id: "team-oversight",
      type: "team",
      status: "active",
      memberIds: ["person-lead", "person-reviewer"],
      chairIds: ["appointment-policy-reviewer"]
    }
  ];
  const byId = new Map(records.map((record) => [record.id, record]));

  assert.deepEqual([...currentPartyPeople(["appointment-policy-owner"], byId)], ["person-lead"]);
  assert.deepEqual(
    [...currentPartyPeople(["team-oversight"], byId)].sort(),
    ["person-lead", "person-reviewer"]
  );
  assert.equal(
    partiesIndependent(["appointment-policy-owner"], ["appointment-policy-reviewer"], byId),
    true
  );
  assert.equal(
    partiesIndependent(["appointment-policy-owner"], ["team-oversight"], byId),
    false
  );
});

test("ended appointments remain historical parties but are not current", () => {
  const records = [
    { id: "person-lead", type: "person", status: "inactive" },
    {
      id: "appointment-policy-owner",
      type: "appointment",
      status: "ended",
      holderId: "person-lead"
    }
  ];
  const byId = new Map(records.map((record) => [record.id, record]));

  assert.deepEqual([...partyPeople(["appointment-policy-owner"], byId)], ["person-lead"]);
  assert.deepEqual([...currentPartyPeople(["appointment-policy-owner"], byId)], []);
});
