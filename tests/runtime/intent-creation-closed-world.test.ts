/**
 * #408 — Closed-world intent-creation invariant.
 *
 * The no-reclassification rule is pinned mechanically, the same way the
 * canonical-intent chain pins its own invariant
 * (action-classifier.test.ts → "canonical-intent chain — closed-world
 * invariant"). For each canonical intent, a positive-corpus prompt routed
 * via taskRouter then converted to an ExecutionIntent must yield `action`
 * equal to the canonical label — never the raw prompt text. Two prompts
 * with different canonical intents produce structurally different intents,
 * determined by the label, not by a re-derivation from prompt text.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExecutionIntent } from "../../src/runtime/execution-intent-factory.js";
import { taskRouter, type TaskRoute } from "../../src/runtime/task-router.js";

const FIXED_NOW = "2026-08-06T00:00:00.000Z";

/**
 * The chain's canonical positive corpus (mirrors CANONICAL_CASES in
 * action-classifier.test.ts). `intent` is the canonical label the chain
 * expects Layer 1 / Layer 3 to produce for this prompt.
 */
const CANONICAL_CASES: Array<{
  intent: string;
  kind: TaskRoute["kind"];
  prompt: string;
  note: string;
}> = [
  { intent: "arithmetic", kind: "direct", prompt: "2 + 2", note: "arithmetic" },
  {
    intent: "generation",
    kind: "direct",
    prompt: "Write a Fibonacci function in Python that returns the sequence",
    note: "generation",
  },
  {
    intent: "external_retrieval",
    kind: "grounded_chat",
    prompt: "latest Kubernetes release version",
    note: "external_retrieval",
  },
  {
    intent: "workspace_action",
    kind: "agent",
    prompt: "is curl installed on this machine",
    note: "workspace_state (workspace_action)",
  },
  {
    intent: "workspace_mutation",
    kind: "agent",
    prompt: "remove the cache from npm",
    note: "workspace_mutation",
  },
  {
    intent: "shell_execution",
    kind: "tool",
    prompt: "ls",
    note: "shell_execution (bare)",
  },
  {
    intent: "shell_execution",
    kind: "tool",
    prompt: "list files",
    note: "shell_execution (natural-language phrase — Layer 3)",
  },
  {
    intent: "read_only_analysis",
    kind: "chat",
    prompt: "what is dependency injection",
    note: "read_only_analysis",
  },
  {
    intent: "planning",
    kind: "agent",
    prompt: "should I use X or Y",
    note: "planning",
  },
];

describe("canonical-intent chain — closed-world intent-creation invariant", () => {
  for (const c of CANONICAL_CASES) {
    it(`${c.note}: intent.action == "${c.intent}" for "${c.prompt}"`, async () => {
      const route = await taskRouter(c.prompt);
      assert.equal(route.kind, c.kind);
      const intent = createExecutionIntent(route, { now: FIXED_NOW });

      // The action is the canonical label — never a re-derivation from
      // the raw prompt text.
      assert.equal(intent.action, c.intent);
      assert.notEqual(intent.action, c.prompt);
    });
  }

  it("never uses raw prompt text as the action, and clamps ambiguous to a canonical label", async () => {
    const route = await taskRouter("some completely unrelated thing");
    const intent = createExecutionIntent(route, { now: FIXED_NOW });
    assert.notEqual(intent.action, "some completely unrelated thing");
    // The action must always belong to the canonical taxonomy — even when
    // the classifier returns "ambiguous" (spec c1).
    const CANONICAL = new Set([
      "arithmetic", "generation", "workspace_action", "workspace_mutation",
      "external_retrieval", "shell_execution", "read_only_analysis", "planning",
    ]);
    assert.ok(CANONICAL.has(intent.action), `action "${intent.action}" must be a canonical intent`);
  });

  it("two prompts with different canonical intents produce structurally different intents", async () => {
    const arithmetic = await taskRouter("2 + 2");
    const retrieval = await taskRouter("latest Kubernetes release version");

    const arithmeticIntent = createExecutionIntent(arithmetic, { now: FIXED_NOW, actor: "system" });
    const retrievalIntent = createExecutionIntent(retrieval, { now: FIXED_NOW, actor: "system" });

    assert.equal(arithmeticIntent.action, "arithmetic");
    assert.equal(retrievalIntent.action, "external_retrieval");
    assert.notEqual(arithmeticIntent.action, retrievalIntent.action);
    assert.notEqual(arithmeticIntent.intentHash, retrievalIntent.intentHash);
    assert.notEqual(arithmeticIntent.intentId, retrievalIntent.intentId);
  });

  it("the intent is keyed by the canonical label, not re-derived from prompt text", async () => {
    // The same canonical label across different prompts still yields the
    // canonical label as action (dispatch determined by Layer 1, not text).
    const a = await taskRouter("ls");
    const intent = createExecutionIntent(a, { now: FIXED_NOW });
    assert.equal(intent.action, "shell_execution");
    assert.notEqual(intent.action, "ls");
  });
});
