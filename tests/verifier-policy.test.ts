import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRunVerification } from "../src/verifier/verifier.js";

describe("shouldRunVerification", () => {
  it("returns skip when ask mode and scope not approved", () => {
    const result = shouldRunVerification("ask", false);
    assert.ok(result.skipReason !== undefined, "should skip");
  });

  it("returns empty when auto mode", () => {
    const result = shouldRunVerification("auto", false);
    assert.strictEqual(result.skipReason, undefined);
  });

  it("returns empty when ask mode but scope approved", () => {
    const result = shouldRunVerification("ask", true);
    assert.strictEqual(result.skipReason, undefined);
  });
});
