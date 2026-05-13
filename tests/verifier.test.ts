import test from "node:test";
import assert from "node:assert/strict";
import { discoverVerification } from "../src/verifier/verifier.js";

test("discovers npm test script", async () => {
  const checks = await discoverVerification("fixtures/sample-repo");
  assert.equal(checks[0]?.command, "npm test");
});
