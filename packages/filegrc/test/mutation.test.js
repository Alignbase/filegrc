import assert from "node:assert/strict";
import test from "node:test";
import { normalizeResourceMutation } from "../src/mutation.js";

test("new resource mutations accept absent or null revisions without weakening updates", () => {
  const record = { id: "example", type: "risk" };
  for (const revision of [undefined, null]) {
    assert.equal(normalizeResourceMutation({ record, revision }).revision, undefined);
    assert.throws(() => normalizeResourceMutation({ record, revision }, { requireRevision: true }), /revision is required/);
  }
  for (const revision of [false, 1, {}, []]) {
    assert.throws(() => normalizeResourceMutation({ record, revision }), /revision must be a string/);
  }
  assert.throws(() => normalizeResourceMutation({ record, revision: "" }, { requireRevision: true }), /revision is required/);
  assert.equal(normalizeResourceMutation({ record, revision: "current" }, { requireRevision: true }).revision, "current");
});
