import assert from "node:assert/strict";
import test from "node:test";
import { createResourceId } from "../src/id.js";

test("creates stable resource IDs from user-facing titles", () => {
  assert.equal(createResourceId("person", "Jordan Lee"), "person-jordan-lee");
  assert.equal(createResourceId("person", "  José Álvarez  "), "person-jose-alvarez");
  assert.equal(createResourceId("policy", "Access & Identity"), "policy-access-identity");
});

test("keeps generated IDs unique across the workspace", () => {
  const used = ["person-jordan-lee", "person-jordan-lee-2"];
  assert.equal(createResourceId("person", "Jordan Lee", used), "person-jordan-lee-3");
  assert.equal(createResourceId("person", "!!!", used), "person-new");
});
