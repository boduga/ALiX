import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  ContextItemRef,
  ContextBundleCreatedPayload,
  RepoMapCreatedPayload,
} from "../../src/events/types.js";

describe("Context Event Payload Types", () => {
  it("ContextItemRef includes all required fields", () => {
    const ref: ContextItemRef = {
      path: "src/index.ts",
      kind: "file",
      score: 0.95,
      reason: "explicitly mentioned by user",
    };
    assert.equal(ref.path, "src/index.ts");
    assert.ok(ref.score > 0.9);
    assert.ok(ref.reason);
  });

  it("ContextBundleCreatedPayload tracks token budget", () => {
    const payload: ContextBundleCreatedPayload = {
      bundleId: "bundle-123",
      taskType: "bugfix",
      usedTokens: 5000,
      maxTokens: 20000,
      primaryFiles: [],
      supportingFiles: [],
      tests: [],
      omittedCount: 3,
    };
    assert.equal(payload.usedTokens, 5000);
    assert.equal(payload.maxTokens, 20000);
    assert.equal(payload.omittedCount, 3);
  });

  it("RepoMapCreatedPayload tracks map stats", () => {
    const payload: RepoMapCreatedPayload = {
      sourceFileCount: 42,
      testFileCount: 15,
      symbolCount: 280,
      dependencyCount: 350,
    };
    assert.equal(payload.sourceFileCount, 42);
    assert.ok(payload.symbolCount > 0);
  });
});
