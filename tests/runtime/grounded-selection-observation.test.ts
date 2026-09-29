/**
 * grounded-selection-observation.test.ts — F4 invariants for the external path.
 *
 * The grounded_chat route makes a real model call and the model chooses among
 * the tools the route passes to `provider.complete`. Before F4 nothing recorded
 * that choice, so MCP/external turns contributed zero selection scopes (cohort
 * t3d-2026-09-28-c). These pin the replacement contract, including that the
 * recorded candidate ids are the canonical names the task loop uses.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeGroundedChatBehavior } from "../../src/runtime/route-execution.js";
import type { ModelAdapter } from "../../src/providers/types.js";

type RecordedRequest = { tools?: Array<{ name: string; description?: string }> };

/** Provider that issues one tool call on turn 1 and records what it was offered. */
function scriptedProvider(toolName: string, requests: RecordedRequest[]): ModelAdapter {
  return {
    id: "mock",
    capabilities: {},
    complete: async (request: RecordedRequest) => {
      requests.push(request);
      return requests.length === 1
        ? { text: "", toolCalls: [{ id: "tc1", name: toolName, args: { query: "x" } }] }
        : { text: "synthesized answer", toolCalls: [] };
    },
  } as unknown as ModelAdapter;
}

const ALIASES: Record<string, string> = { web_search: "alix_web_search", web_fetch: "alix_web_fetch" };

async function runGrounded(
  toolName: string,
  options: {
    selectionScope?: { scopeId: string; iteration: number; sessionId: string };
    executorResult?: Record<string, unknown>;
  } = {},
) {
  const requests: RecordedRequest[] = [];
  const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const executed: string[] = [];

  const route = {
    kind: "grounded_chat" as const,
    prompt: "fetch https://example.com and summarise it",
    // The real allow-list uses the provider-facing tool names.
    allowedTools: ["web_search", "web_fetch"],
    diagnostic: { classification: "external_retrieval" },
  };

  await executeGroundedChatBehavior(route as never, { permissions: { allowNetworkDomains: [] } } as never, {
    cwd: process.cwd(),
    eventLog: { append: async (event: { type: string; payload: Record<string, unknown> }) => { appended.push(event); } },
    providerFactory: async () => scriptedProvider(toolName, requests),
    toolExecutorFactory: async () => ({
      execute: async (request: { name: string }) => {
        executed.push(request.name);
        return options.executorResult ?? { kind: "success" as const, output: "fetched body" };
      },
    }),
    toolCandidateAliases: ALIASES,
    ...(options.selectionScope ? { selectionScope: options.selectionScope } : {}),
  } as never);

  return { requests, executed, observations: appended.filter(e => e.type === "tool.selection.observed") };
}

const scope = (n: string) => ({ scopeId: `grounded_s1_${n}`, iteration: 0, sessionId: "s1" });

describe("grounded external selection observation", () => {
  it("records a scope when the model chose among the tools it was offered", async () => {
    const { observations } = await runGrounded("web_fetch", { selectionScope: scope("1") });

    assert.equal(observations.length, 1, "a real model choice must produce a scope");
    const payload = observations[0].payload;
    assert.equal(payload.scopeId, "grounded_s1_1");
    // `chosen` is the name the model emitted; `chosenCandidateId` is the
    // canonical key the rest of ALiX uses, so a grounded scope is comparable
    // with a task-loop scope.
    assert.equal(payload.chosen, "web_fetch");
    assert.equal(payload.chosenCandidateId, "builtin:alix_web_fetch");
    assert.equal(payload.invalidSelection, undefined, "the choice resolved against the offered surface");
  });

  it("records exactly the candidates it passed to provider.complete", async () => {
    const { requests, observations } = await runGrounded("web_search", { selectionScope: scope("2") });

    const offeredToProvider = (requests[0].tools ?? []).map(tool => `builtin:${ALIASES[tool.name] ?? tool.name}`).sort();
    const recorded = [...(observations[0].payload.offered as string[])].sort();

    assert.ok(offeredToProvider.length > 0, "the route must offer web tools to the provider");
    assert.deepEqual(
      recorded,
      offeredToProvider,
      "the recorded surface must be the surface the provider actually received",
    );
  });

  it("emits no scope when the caller does not observe selections", async () => {
    const { observations, executed } = await runGrounded("web_fetch");
    assert.equal(executed.length, 1, "the tool still ran");
    assert.equal(observations.length, 0, "observation is opt-in per caller");
  });

  it("never serializes a raw MCP handle into the frozen scope", async () => {
    const { observations } = await runGrounded("web_fetch", { selectionScope: scope("4") });
    const serialized = JSON.stringify(observations[0].payload);
    assert.ok(!serialized.includes("mcp__"), "frozen scope must carry no raw MCP handle");
  });

  it("records a failed execution as failed rather than dropping the scope", async () => {
    const { observations } = await runGrounded("web_fetch", {
      selectionScope: scope("5"),
      executorResult: { kind: "error", message: "Network error: unreachable" },
    });

    assert.equal(observations.length, 1, "a failed external call is still a selection");
    assert.deepEqual(observations[0].payload.execution, { status: "failed" });
    assert.deepEqual(observations[0].payload.evidence, { contribution: "none" });
  });
});
