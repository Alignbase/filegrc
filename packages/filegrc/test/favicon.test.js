import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FAVICON_PNG, LOGO_MARK_PNG } from "../src/favicon.js";

test("uses the FileGRC commit page favicon", () => {
  assert.deepEqual(
    [...FAVICON_PNG.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  assert.equal(FAVICON_PNG.readUInt32BE(16), 64);
  assert.equal(FAVICON_PNG.readUInt32BE(20), 64);
  assert.equal(
    createHash("sha256").update(FAVICON_PNG).digest("hex"),
    "70a3f128009b62097fb34b7b57149e91f8e3a0478c194622fad2ee7ad83613cf"
  );
});

test("uses the transparent FileGRC mark on dark surfaces", () => {
  assert.deepEqual(
    [...LOGO_MARK_PNG.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  assert.equal(LOGO_MARK_PNG.readUInt32BE(16), 64);
  assert.equal(LOGO_MARK_PNG.readUInt32BE(20), 64);
  assert.equal(
    createHash("sha256").update(LOGO_MARK_PNG).digest("hex"),
    "73eb99aa200fb877b302e39404e16e2e7c16260379cf2765b4b01eea34cf9f28"
  );
});
