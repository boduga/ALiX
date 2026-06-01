import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldAutoDisableStreaming } from "../../src/agent/stream.js";

describe("shouldAutoDisableStreaming", () => {
  it("returns a boolean", () => {
    const result = shouldAutoDisableStreaming();
    assert.equal(typeof result, "boolean");
  });

  it("returns true when no TTY (CI environment)", () => {
    // In test env, no TTY -> should disable
    const result = shouldAutoDisableStreaming();
    assert.equal(result, true);
  });
});