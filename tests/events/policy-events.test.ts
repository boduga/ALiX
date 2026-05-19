import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  PolicyDecisionPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "../../src/events/types.js";

describe("Policy Event Payload Types", () => {
  it("PolicyDecisionPayload tracks security decisions", () => {
    const payload: PolicyDecisionPayload = {
      toolCallId: "call-123",
      capability: "file.write",
      decision: "ask",
      reason: "Matched tool policy for file.write (mode: ask)",
      matchedRuleId: "file.write-policy",
    };
    assert.equal(payload.decision, "ask");
    assert.ok(payload.reason.includes("file.write"));
  });

  it("PolicyDecisionPayload captures denied decisions", () => {
    const payload: PolicyDecisionPayload = {
      toolCallId: "call-456",
      capability: "file.read",
      decision: "deny",
      reason: "Path is protected: .env",
    };
    assert.equal(payload.decision, "deny");
    assert.ok(payload.reason.includes("protected"));
  });

  it("ApprovalRequestedPayload includes prompt and choices", () => {
    const payload: ApprovalRequestedPayload = {
      approvalId: "approval-789",
      toolCallId: "call-123",
      prompt: "Allow writing to src/index.ts?",
      choices: ["approve", "deny", "edit"],
    };
    assert.equal(payload.choices.length, 3);
    assert.ok(payload.prompt.includes("Allow"));
  });

  it("ApprovalResolvedPayload tracks resolution", () => {
    const payload: ApprovalResolvedPayload = {
      approvalId: "approval-789",
      decision: "approved",
      reason: "User approved",
    };
    assert.equal(payload.decision, "approved");
  });
});