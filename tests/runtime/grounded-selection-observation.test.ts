/**
 * grounded-selection-observation.test.ts — F4 invariants for the external path.
 *
 * The grounded_chat route makes a real model call and the model chooses among
 * the tools the route passes to `provider.complete`. Before F4 nothing recorded
 * that choice, so MCP/external turns contributed zero selection scopes (cohort
 * t3d-2026-09-28-c). These pin the replacement contract, including that the
 * recorded candidate ids are the canonical names the task loop uses.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { executeGroundedChatBehavior } from "../../src/runtime/route-execution.js";
import type { ModelAdapter } from "../../src/providers/types.js";

type RecordedRequest = { tools?: Array<{ name: string; description?: string }> };

/** Provider that issues one tool call on turn 1 and records what it was offered. */
function scriptedProvider(toolName: string | null, requests: RecordedRequest[]): ModelAdapter {
  return {
    id: "mock",
    capabilities: {},
    complete: async (request: RecordedRequest) => {
      requests.push(request);
      return requests.length === 1
        ? toolName === null
          ? { text: "direct answer", toolCalls: [] }
          : { text: "", toolCalls: [{ id: "tc1", name: toolName, args: { query: "x" } }] }
        : { text: "synthesized answer", toolCalls: [] };
    },
  } as unknown as ModelAdapter;
}

const ALIASES: Record<string, string> = { "web.search": "alix_web_search", "web.fetch": "alix_web_fetch" };

async function runGrounded(
  toolName: string | null,
  options: {
    selectionScope?: { scopeId: string; iteration: number; sessionId: string };
    executorResult?: Record<string, unknown>;
    allowedTools?: string[];
  } = {},
) {
  const requests: RecordedRequest[] = [];
  const appended: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const executed: string[] = [];

  const route = {
    kind: "grounded_chat" as const,
    prompt: "fetch https://example.com and summarise it",
    // The real allow-list uses the provider-facing tool names.
    allowedTools: options.allowedTools ?? ["web.search", "web.fetch"],
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

  return {
    requests,
    executed,
    observations: appended.filter(e => e.type === "tool.selection.observed"),
    notApplicable: appended.filter(e => e.type === "tool.selection.not_applicable"),
  };
}

const scope = (n: string) => ({ scopeId: `grounded_s1_${n}`, iteration: 0, sessionId: "s1" });

const IDENTITY_KEYS = new Set([
  "scopeId",
  "iteration",
  "route",
  "reason",
  "candidateId",
  "label",
  "offered",
  "chosen",
  "chosenCandidateId",
]);
const IDENTITY_CONTAINERS = new Set(["requirementCandidates", "scoping", "ranking"]);

function identityStrings(value: unknown, selected = false, output: string[] = []): string[] {
  if (typeof value === "string") {
    if (selected) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) identityStrings(entry, selected, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" || key === "candidateBindings") continue;
      const childSelected = selected || IDENTITY_KEYS.has(key) || IDENTITY_CONTAINERS.has(key);
      identityStrings(child, childSelected, output);
    }
  }
  return output;
}

describe("grounded external selection observation", () => {
  // Selection tracing is OFF by default; this suite asserts scopes ARE
  // recorded, so it opts in the way a real cohort collection does. Restored
  // after so the gate's default is not silently widened for other suites.
  beforeEach(() => { process.env.ALIX_TOOL_SELECTION_TRACE = "1"; });
  afterEach(() => { delete process.env.ALIX_TOOL_SELECTION_TRACE; });

  it("records a scope when the model chose among the tools it was offered", async () => {
    const { observations, notApplicable } = await runGrounded("web.fetch", { selectionScope: scope("1") });

    assert.equal(observations.length, 1, "a real model choice must produce a scope");
    assert.equal(notApplicable.length, 0, "one turn must not emit both records");
    const payload = observations[0].payload;
    assert.equal(payload.scopeId, "grounded_s1_1");
    // `chosen` is the name the model emitted; `chosenCandidateId` is the
    // canonical key the rest of ALiX uses, so a grounded scope is comparable
    // with a task-loop scope.
    assert.equal(payload.chosen, "web.fetch");
    assert.equal(payload.chosenCandidateId, "builtin:alix_web_fetch");
    assert.equal(payload.invalidSelection, undefined, "the choice resolved against the offered surface");
  });

  it("records exactly the candidates it passed to provider.complete", async () => {
    const { requests, observations } = await runGrounded("web.search", { selectionScope: scope("2") });

    const offeredToProvider = (requests[0].tools ?? []).map(tool => `builtin:${ALIASES[tool.name] ?? tool.name}`).sort();
    const recorded = [...(observations[0].payload.offered as string[])].sort();

    assert.ok(offeredToProvider.length > 0, "the route must offer web tools to the provider");
    assert.deepEqual(
      recorded,
      offeredToProvider,
      "the recorded surface must be the surface the provider actually received",
    );
  });

  it("emits no selection records when the caller does not observe selections", async () => {
    const { observations, notApplicable, executed } = await runGrounded("web.fetch");
    assert.equal(executed.length, 1, "the tool still ran");
    assert.equal(observations.length, 0, "observation is opt-in per caller");
    assert.equal(notApplicable.length, 0, "coverage telemetry is opt-in per caller");
  });

  it("scans identity fields rather than descriptions or local bindings", async () => {
    const payload = {
      scopeId: "grounded_s1_4",
      iteration: 0,
      candidates: [{
        candidateId: "builtin:alix_mcp_search_tools",
        label: "alix_mcp_search_tools",
        description: "Returned names use the mcp__ namespace.",
      }],
      candidateBindings: [{ candidateId: "mcp:abc", modelName: "mcp__opaque_tool" }],
      offered: ["builtin:alix_mcp_search_tools"],
      chosen: "alix_mcp_search_tools",
      chosenCandidateId: "builtin:alix_mcp_search_tools",
    };

    assert.ok(JSON.stringify(payload).includes("mcp__"));
    assert.deepEqual(identityStrings(payload).filter(value => value.includes("mcp__")), []);
  });

  it("never puts a raw MCP handle in observed identity fields", async () => {
    const { observations } = await runGrounded("web.fetch", { selectionScope: scope("4") });
    assert.deepEqual(identityStrings(observations[0].payload).filter(value => value.includes("mcp__")), []);
  });

  it("records exactly one not-applicable when tools were offered but none chosen", async () => {
    const { requests, observations, notApplicable } = await runGrounded(null, { selectionScope: scope("6") });

    assert.ok((requests[0].tools ?? []).length > 0, "the provider was offered tools");
    assert.equal(observations.length, 0);
    assert.equal(notApplicable.length, 1);
    assert.deepEqual(notApplicable[0].payload, {
      type: "tool.selection.not_applicable",
      scopeId: "grounded_s1_6",
      iteration: 0,
      route: "grounded",
      reason: "no_tool_call",
    });
  });

  it("records no_tools_offered when an observing grounded path receives no tools", async () => {
    const { requests, observations, notApplicable } = await runGrounded(null, {
      selectionScope: scope("7"),
      allowedTools: ["not_registered"],
    });

    assert.equal(requests[0].tools, undefined);
    assert.equal(observations.length, 0);
    assert.equal(notApplicable.length, 1);
    assert.equal(notApplicable[0].payload.reason, "no_tools_offered");
  });

  it("records a failed execution as failed rather than dropping the scope", async () => {
    const { observations } = await runGrounded("web.fetch", {
      selectionScope: scope("5"),
      executorResult: { kind: "error", message: "Network error: unreachable" },
    });

    assert.equal(observations.length, 1, "a failed external call is still a selection");
    assert.deepEqual(observations[0].payload.execution, { status: "failed" });
    assert.deepEqual(observations[0].payload.evidence, { contribution: "none" });
  });
});
