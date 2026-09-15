// Temporary #690 verification probe — intentionally failing. Do NOT merge.
import test from "node:test";
import assert from "node:assert/strict";

test("CI protection probe — intentionally failing", () => {
  assert.equal(1, 2, "deliberate failure to verify required-check enforcement");
});
