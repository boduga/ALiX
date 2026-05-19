import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  PatchProposalPayload,
  PatchParsedPayload,
  PatchAppliedPayload,
} from "../../src/events/types.js";

describe("Patch Event Payload Types", () => {
  it("PatchProposalPayload has required fields", () => {
    const payload: PatchProposalPayload = {
      proposalId: "test-123",
      format: "search_replace",
      provider: "anthropic",
      model: "claude-sonnet-4",
      files: [{ path: "src/index.ts", operation: "modify" }],
      requiresApproval: false,
    };
    assert.equal(payload.proposalId, "test-123");
    assert.equal(payload.format, "search_replace");
    assert.equal(payload.files.length, 1);
  });

  it("PatchAppliedPayload tracks changed files", () => {
    const payload: PatchAppliedPayload = {
      proposalId: "test-123",
      checkpointId: "ckpt-456",
      changedFiles: ["src/index.ts", "src/utils.ts"],
    };
    assert.equal(payload.changedFiles.length, 2);
  });
});