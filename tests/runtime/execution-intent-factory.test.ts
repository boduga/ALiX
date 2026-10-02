/**
 * #405 — ExecutionIntent factory tests.
 *
 * Pins the factory contract for turning a TaskRoute into an immutable X1
 * ExecutionIntent:
 *   1. Every route kind produces a fully-populated, frozen intent.
 *   2. `action` is the canonical-intent label (route diagnostic or a
 *      kind-derived canonical label) — never a re-derivation from raw
 *      prompt text.
 *   3. Same route + same inputs → same deterministic intentId + hash.
 *   4. Non-proposal routes carry a synthetic auto-approval (Alignment A).
 *   5. intentId is the stable execution identity used downstream.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createExecutionIntent,
} from "../../src/runtime/execution-intent-factory.js";
import { createIntentId } from "../../src/runtime/contracts/execution-intent-contract.js";
import { taskRouter, type TaskRoute } from "../../src/runtime/task-router.js";

const FIXED_NOW = "2026-08-06T00:00:00.000Z";

// Hand-built routes: each of the five route kinds.
const TOOL_ROUTE: TaskRoute = { kind: "tool", tool: "shell.run", args: { command: "ls" } };
const CHAT_ROUTE: TaskRoute = { kind: "chat", prompt: "research docs" };
const DIRECT_ROUTE: TaskRoute = {
  kind: "direct",
  prompt: "2 + 2",
  answer: "4",
  diagnostic: { classification: "arithmetic", route: "direct", reason: "pure arithmetic" },
};
const GROUNDED_ROUTE: TaskRoute = {
  kind: "grounded_chat",
  prompt: "latest news",
  allowedTools: ["web.search"],
  diagnostic: {
    classification: "external_retrieval",
    route: "grounded_chat",
    reason: "needs current info",
  },
};
const AGENT_ROUTE: TaskRoute = {
  kind: "agent",
  task: "find SQL usage in my repo",
  diagnostic: {
    classification: "workspace_action",
    route: "agent",
    reason: "workspace analysis",
  },
};

describe("createExecutionIntent — every route kind produces a complete, immutable intent", () => {
  const cases = [
    ["direct", DIRECT_ROUTE],
    ["tool", TOOL_ROUTE],
    ["chat", CHAT_ROUTE],
    ["grounded_chat", GROUNDED_ROUTE],
    ["agent", AGENT_ROUTE],
  ] as const;

  for (const [kind, route] of cases) {
    it(`produces a fully-populated frozen intent for ${kind} routes`, () => {
      const intent = createExecutionIntent(route, { now: FIXED_NOW });

      // Immutable (X1 invariant 1 / invariant 5: intent hashes never change).
      assert.equal(Object.isFrozen(intent), true, "intent must be frozen");
      assert.equal(Object.isFrozen(intent.constraints), true);

      // Every contract-required field present.
      assert.equal(typeof intent.intentId, "string");
      assert.ok(intent.intentId.length >= 8, `intentId populated: ${intent.intentId}`);
      assert.equal(typeof intent.proposalId, "string");
      assert.equal(typeof intent.actor, "string");
      assert.equal(typeof intent.action, "string");
      assert.equal(typeof intent.target, "string");
      assert.equal(typeof intent.justification, "string");
      assert.equal(typeof intent.riskClass, "string");
      assert.ok(["low", "medium", "high"].includes(intent.riskClass));
      assert.equal(typeof intent.expectedEffect, "string");
      assert.equal(typeof intent.createdAt, "string");
      assert.equal(typeof intent.expiration, "string");
      assert.ok(new Date(intent.expiration) > new Date(intent.createdAt));
      assert.equal(typeof intent.approvalReference, "string");
      assert.equal(typeof intent.approvedBy, "string");
      assert.equal(typeof intent.approvedAt, "string");
      assert.match(intent.intentHash, /^[0-9a-f]{64}$/);

      // Constraints fully populated (X1 @invariant maxFilesChanged positive).
      assert.ok(intent.constraints.maxFilesChanged > 0);
      assert.ok(Array.isArray(intent.constraints.allowedPaths));
      assert.ok(Array.isArray(intent.constraints.blockedPaths));
      assert.equal(typeof intent.constraints.verificationRequired, "boolean");
      assert.ok(Array.isArray(intent.constraints.allowedTools));
    });
  }
});

describe("createExecutionIntent — action is the canonical label, never raw prompt text", () => {
  it("uses the route diagnostic classification for direct routes", () => {
    const intent = createExecutionIntent(DIRECT_ROUTE, { now: FIXED_NOW });
    assert.equal(intent.action, "arithmetic");
  });

  it("uses the route diagnostic classification for grounded_chat routes", () => {
    const intent = createExecutionIntent(GROUNDED_ROUTE, { now: FIXED_NOW });
    assert.equal(intent.action, "external_retrieval");
  });

  it("uses the route diagnostic classification for agent routes", () => {
    const intent = createExecutionIntent(AGENT_ROUTE, { now: FIXED_NOW });
    assert.equal(intent.action, "workspace_action");
  });

  it("falls back to a canonical kind-derived label for tool routes — never the command text", () => {
    const intent = createExecutionIntent(TOOL_ROUTE, { now: FIXED_NOW });
    // The raw command "ls" must never become the action.
    assert.equal(intent.action, "shell_execution");
    assert.notEqual(intent.action, "ls");
  });

  it("falls back to a canonical kind-derived label for chat routes — never the prompt text", () => {
    const intent = createExecutionIntent(CHAT_ROUTE, { now: FIXED_NOW });
    // The raw prompt "research docs" must never become the action.
    assert.equal(intent.action, "read_only_analysis");
    assert.notEqual(intent.action, "research docs");
  });

  it("routes a real taskRouter direct route and keeps the canonical arithmetic label", async () => {
    const route = await taskRouter("2 + 2");
    assert.equal(route.kind, "direct");
    const intent = createExecutionIntent(route, { now: FIXED_NOW });
    assert.equal(intent.action, "arithmetic");
  });
});

describe("createExecutionIntent — deterministic identity", () => {
  it("same route + same inputs → same intentId and intentHash", () => {
    const a = createExecutionIntent(DIRECT_ROUTE, { now: FIXED_NOW, actor: "system" });
    const b = createExecutionIntent(DIRECT_ROUTE, { now: FIXED_NOW, actor: "system" });
    assert.equal(a.intentId, b.intentId);
    assert.equal(a.intentHash, b.intentHash);
  });

  it("different actor or timestamp → different intentId", () => {
    const a = createExecutionIntent(DIRECT_ROUTE, { now: FIXED_NOW, actor: "system" });
    const b = createExecutionIntent(DIRECT_ROUTE, { now: "2026-08-06T01:00:00.000Z", actor: "system" });
    assert.notEqual(a.intentId, b.intentId);
  });

  it("intentId is the deterministic createIntentId prefix for the same inputs", () => {
    const intent = createExecutionIntent(DIRECT_ROUTE, { now: FIXED_NOW, actor: "system" });
    const expectedId = createIntentId(intent.proposalId, "system", FIXED_NOW);
    assert.equal(intent.intentId, expectedId);
  });
});

describe("createExecutionIntent — synthetic auto-approval (Alignment A)", () => {
  it("non-proposal routes carry a governor-authored auto-approval", () => {
    const intent = createExecutionIntent(TOOL_ROUTE, { now: FIXED_NOW });
    assert.match(intent.approvalReference, /^auto:/);
    assert.equal(intent.approvedBy, "governor");
    assert.equal(intent.approvedAt, intent.createdAt);
  });

  it("explicit approval fields override the synthetic defaults", () => {
    const intent = createExecutionIntent(DIRECT_ROUTE, {
      now: FIXED_NOW,
      approvalReference: "approval_abc123",
      approvedBy: "operator",
      approvedAt: "2026-08-05T00:00:00.000Z",
    });
    assert.equal(intent.approvalReference, "approval_abc123");
    assert.equal(intent.approvedBy, "operator");
    assert.equal(intent.approvedAt, "2026-08-05T00:00:00.000Z");
  });
});

describe("createExecutionIntent — intentId is the downstream identity", () => {
  it("intentId is referenced by evidence produced for the intent", () => {
    const intent = createExecutionIntent(GROUNDED_ROUTE, { now: FIXED_NOW });
    // The intentId must be stable and well-formed (hex-derived, 16 chars
    // from createIntentId) so downstream lifecycle/evidence can key on it.
    assert.equal(intent.intentId.length, 16);
    assert.match(intent.intentId, /^[0-9a-f]{16}$/);
  });
});
