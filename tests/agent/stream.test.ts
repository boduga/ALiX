import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCI, shouldAutoDisableStreaming } from "../../src/agent/stream.js";

describe("isCI", () => {
  it("returns false for an empty env", () => {
    assert.equal(isCI({}), false);
  });

  it("detects provider-specific CI env vars", () => {
    assert.equal(isCI({ GITHUB_ACTIONS: "true" }), true);
    assert.equal(isCI({ GITLAB_CI: "true" }), true);
    assert.equal(isCI({ TF_BUILD: "true" }), true);
    assert.equal(isCI({ JENKINS_URL: "https://ci.example.com" }), true);
    assert.equal(isCI({ CIRCLECI: "true" }), true);
  });

  it("detects the generic CI catch-all", () => {
    assert.equal(isCI({ CI: "true" }), true);
    assert.equal(isCI({ CONTINUOUS_INTEGRATION: "true" }), true);
  });

  it("treats a non-empty value as truthy (ci-info / @actions/core convention)", () => {
    assert.equal(isCI({ CI: "false" }), true);
  });
});

describe("shouldAutoDisableStreaming", () => {
  it("returns a boolean", () => {
    const result = shouldAutoDisableStreaming({});
    assert.equal(typeof result, "boolean");
  });

  it("returns true in a CI environment", () => {
    assert.equal(shouldAutoDisableStreaming({ GITHUB_ACTIONS: "true" }), true);
  });

  it("returns false in a local context even without a TTY", () => {
    // Local non-TTY (piped/redirected) still streams — the gate no longer
    // auto-disables on a missing TTY, only on CI.
    assert.equal(shouldAutoDisableStreaming({}), false);
  });
});
