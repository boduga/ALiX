import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  PatchProposalPayload,
  PatchParsedPayload,
  PatchAppliedPayload,
  PatchRejectedPayload,
  PatchCheckpointCreatedPayload,
  PatchRolledBackPayload,
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

  it("PatchParsedPayload validates a proposal", () => {
    const payload: PatchParsedPayload = {
      proposalId: "test-123",
      validated: true,
      errors: [],
    };
    assert.equal(payload.validated, true);
    assert.deepEqual(payload.errors, []);
  });

  it("PatchParsedPayload captures validation errors", () => {
    const payload: PatchParsedPayload = {
      proposalId: "test-123",
      validated: false,
      errors: ["Invalid search pattern", "Unclosed bracket"],
    };
    assert.equal(payload.validated, false);
    assert.equal(payload.errors && payload.errors.length, 2);
  });

  it("PatchRejectedPayload provides rejection reason", () => {
    const payload: PatchRejectedPayload = {
      proposalId: "test-123",
      reason: "Contains dangerous operation",
    };
    assert.equal(payload.reason, "Contains dangerous operation");
  });

  it("PatchCheckpointCreatedPayload tracks checkpoint files", () => {
    const payload: PatchCheckpointCreatedPayload = {
      checkpointId: "ckpt-789",
      proposalId: "test-123",
      files: ["src/index.ts", "src/utils.ts", "src/types.ts"],
    };
    assert.equal(payload.checkpointId, "ckpt-789");
    assert.equal(payload.files.length, 3);
  });

  it("PatchRolledBackPayload records rollback reason", () => {
    const payload: PatchRolledBackPayload = {
      proposalId: "test-123",
      checkpointId: "ckpt-789",
      reason: "User requested undo",
    };
    assert.equal(payload.checkpointId, "ckpt-789");
    assert.equal(payload.reason, "User requested undo");
  });
});