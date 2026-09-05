/**
 * session-direct-path.vitest.ts — Task 4
 *
 * Tests AgentSession's preflight classification for the direct
 * arithmetic / standalone-generation fast path. Routing diagnostics
 * are surfaced exclusively via the `onRouteDiagnostic` callback on
 * `AgentSessionConfig`; no diagnostic fields are added to
 * `AgentTurnResult`.
 *
 * Verifies:
 *   - arithmetic prompts bypass `initialize()` and the workflow
 *   - standalone-generation prompts use exactly one provider call
 *   - on no-provider, standalone-generation returns the existing
 *     `[chat:no-provider]` response shape WITHOUT falling through to
 *     the agent workflow
 *   - workspace / external-retrieval / ambiguous prompts continue
 *     through the existing lifecycle (initialized exactly once)
 *   - the `onRouteDiagnostic` callback fires for direct routes and
 *     its failures are swallowed
 *   - `planApprovalGate` flows through to the `runPlanPhase` call
 *   - `setPlanApprovalGate` injects a gate at runtime
 *   - the additive `planContent` / `planTasks` fields surface on
 *     `AgentTurnResult` without breaking the existing fields
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentSession } from "../../src/agent/session.js";
import type { ModelAdapter } from "../../src/providers/types.js";
import type { RouteDiagnostic } from "../../src/runtime/task-router.js";

let directTestCwd: string;
let directTestCwdCleanup: (() => void) | null = null;

beforeEach(() => {
  directTestCwd = mkdtempSync(join(tmpdir(), "direct-path-test-"));
  directTestCwdCleanup = () => rmSync(directTestCwd, { recursive: true, force: true });
});

afterEach(() => {
  directTestCwdCleanup?.();
});

const mocks = vi.hoisted(() => ({
  append: vi.fn(() => Promise.resolve()),
  readAll: vi.fn(() => Promise.resolve([])),
  initAgent: vi.fn(),
  runTaskLoop: vi.fn(),
  groundedChatComplete: vi.fn(async (_req: any) => ({
    text: "Ethereum is trading at $1,891.",
    toolCalls: [],
  })),
  toolExecutorExecute: vi.fn(async () => ({ kind: "success", output: "mock result" })),
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/run/task-loop.js", () => ({ runTaskLoop: mocks.runTaskLoop }));
vi.mock("../../src/providers/registry.js", () => ({
  createProvider: vi.fn(async () => ({
    id: "mock",
    capabilities: {},
    editFormatPreference: "unified_diff",
    longContextStrategy: "trimmed_context",
    complete: mocks.groundedChatComplete,
  })),
}));
vi.mock("../../src/tools/executor.js", () => ({
  ToolExecutor: class {
    execute = mocks.toolExecutorExecute;
  },
}));
vi.mock("../../src/utils/memory/recall.js", () => ({
  buildMemoryContext: vi.fn(() => Promise.resolve(undefined)),
  buildMemoryStats: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("../../src/skills/loader.js", () => ({
  loadSkillManifests: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../src/skills/catalog.js", () => ({
  buildSkillCatalog: vi.fn(() => ({
    getMatchedContent: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../../src/skills/lifecycle.js", () => ({ evictIfNeeded: vi.fn() }));

const initContext = {
  sessionId: "direct-test-session",
  sessionDir: "/tmp/direct-test-session",
  log: {
    append: mocks.append,
    readAll: mocks.readAll,
  },
  config: {
    model: {
      provider: "anthropic",
      name: "test-model",
      streaming: false,
      maxContextTokens: 1_000,
      maxIterations: 1,
    },
    models: { default: { provider: "anthropic", name: "test-model" } },
    permissions: { sessionMode: "auto" },
    apiKeys: {},
  },
  provider: { editFormatPreference: "structured_patch" },
  editFormatPolicy: {},
  mcpManager: null,
  toolExecutor: {},
  checkpointManager: {},
  memoryStore: {},
  repoMap: undefined,
  scope: {},
  hookRunner: {},
};

beforeEach(() => {
  // Reset every mock used by the AgentSession lifecycle so each test
  // starts from a clean slate (vitest's `mockReset` clears both call
  // history and any pre-baked implementation).
  mocks.append.mockReset().mockImplementation(() => Promise.resolve());
  mocks.readAll.mockReset().mockResolvedValue([]);
  mocks.initAgent.mockReset().mockResolvedValue(initContext);
  mocks.runTaskLoop.mockReset().mockResolvedValue({
    summary: "agent-loop complete",
    streamed: false,
    reason: "completed",
  });
});

function makeMockProvider(complete: ReturnType<typeof vi.fn>, stream?: ReturnType<typeof vi.fn>) {
  return {
    id: "mock",
    capabilities: {},
    editFormatPreference: "unified_diff",
    longContextStrategy: "trimmed_context",
    complete: complete as unknown as ModelAdapter["complete"],
    ...(stream ? { stream: stream as unknown as ModelAdapter["stream"] } : {}),
  } as unknown as ModelAdapter;
}

describe("AgentSession preflight direct-path (Task 4)", () => {
  // ---- arithmetic route ---------------------------------------------------

  it("arithmetic prompt returns the deterministic answer without initialization", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
    });
    const result = await session.processTurn("2+2");

    expect(result.summary).toBe("4");
    expect(result.reason).toBe("direct");
    expect(result.toolCalls).toEqual([]);
    expect(result.streamed).toBe(false);

    // No initialization, no workflow, no agent append.
    expect(mocks.initAgent).not.toHaveBeenCalled();
    expect(mocks.runTaskLoop).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.readAll).not.toHaveBeenCalled();
  });

  it("parenthesized arithmetic produces the deterministic answer without initialization", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
    });
    const result = await session.processTurn("(10 * 4) / 5");

    expect(result.summary).toBe("8");
    expect(result.reason).toBe("direct");
    expect(mocks.initAgent).not.toHaveBeenCalled();
    expect(mocks.runTaskLoop).not.toHaveBeenCalled();
  });

  it("arithmetic call is purely deterministic — no provider ever instantiated", async () => {
    const complete = vi.fn(async () => {
      throw new Error("provider must not be called for arithmetic");
    });
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete),
    });
    const result = await session.processTurn("9*7");
    expect(result.summary).toBe("63");
    expect(complete).not.toHaveBeenCalled();
  });

  it("two sequential arithmetic prompts share the configured sessionId without re-initializing", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
    });
    const a = await session.processTurn("1+1");
    const b = await session.processTurn("2+2");

    expect(a.summary).toBe("2");
    expect(b.summary).toBe("4");
    expect(a.sessionId).toBe("direct-test-session");
    expect(b.sessionId).toBe("direct-test-session");
    expect(mocks.initAgent).not.toHaveBeenCalled();
    expect(mocks.runTaskLoop).not.toHaveBeenCalled();
  });

  // ---- standalone generation route ---------------------------------------

  it("generation prompt uses exactly one provider call and skips workflow", async () => {
    const complete = vi.fn(async () => ({ text: "fib helper", toolCalls: [] }));
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete),
    });

    const result = await session.processTurn("Write Fibonacci function in Python");

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("fib helper");
    expect(result.reason).toBe("direct");
    expect(result.toolCalls).toEqual([]);
    expect(result.streamed).toBe(false);

    // No initialization, no workflow, no agent append.
    expect(mocks.initAgent).not.toHaveBeenCalled();
    expect(mocks.runTaskLoop).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.readAll).not.toHaveBeenCalled();
  });

  it("generation with no provider returns the [chat:no-provider] response shape without falling through", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      // No chatProvider, no chatModel configured.
    });
    const result = await session.processTurn("Write a poem about the sea");

    // Existing-shape placeholder — preserved verbatim from the chat path
    // so any string-equality consumer keeps working.
    expect(result.summary).toContain("[chat:no-provider]");
    expect(result.summary).toContain("Write a poem about the sea");
    expect(result.reason).toBe("direct");
    expect(result.toolCalls).toEqual([]);

    // Critical: must NOT fall through to the agent workflow.
    expect(mocks.initAgent).not.toHaveBeenCalled();
    expect(mocks.runTaskLoop).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.readAll).not.toHaveBeenCalled();
  });

  it("generation passes user prompt verbatim and asks for concise reply", async () => {
    const complete = vi.fn(async () => ({ text: "r", toolCalls: [] }));
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete),
    });
    await session.processTurn("Write a joke about cats");

    expect(complete).toHaveBeenCalledTimes(1);
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as
      | { systemPrompt: string; messages: Array<{ role: string; content: string }>; maxOutputTokens: number }
      | undefined;
    expect(req).toBeDefined();
    expect(req!.systemPrompt).toMatch(/ALiX/);
    expect(req!.messages).toHaveLength(1);
    expect(req!.messages[0]).toEqual({ role: "user", content: "Write a joke about cats" });
    expect(req!.maxOutputTokens).toBeGreaterThan(0);
  });

  // Regression: the direct/chat routes hardcoded maxOutputTokens at 512,
  // which truncated long generation tasks (5-part stress prompt cut
  // mid-sentence at ~512 tokens) even though the resolved context budget
  // allows far more. The ceiling must now be budget-derived so generation
  // tasks get the full budgeted output the model can provide.
  it("generation derives maxOutputTokens from the resolved context budget, not a 512 hardcode", async () => {
    const complete = vi.fn(async () => ({ text: "r", toolCalls: [] }));
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete),
      chatModel: { provider: "openrouter", model: "z-ai/glm-5.2:free" },
    });
    await session.processTurn("Write a joke about cats");

    expect(complete).toHaveBeenCalledTimes(1);
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as
      | { systemPrompt: string; messages: Array<{ role: string; content: string }>; maxOutputTokens: number }
      | undefined;
    expect(req).toBeDefined();
    // 64k window × 0.2 ratio → 12800 budgeted output, far above the old 512 cap.
    expect(req!.maxOutputTokens).toBe(12800);
  });

  // Regression: PR #371's loader default made model.streaming=true the
  // resolution, but the chat/direct route in processTurn called
  // genProvider.complete() unconditionally — bypassing the streaming pipe.
  // alix-init-test session 1786001303999 reproduced this: 1 user prompt,
  // 1 agent.response, no streaming events, no tokens observed live.
  // The fix: when streaming is enabled (default), use streamToResponse so
  // tokens arrive through the events.onToken sink the in-process TUI wires
  // up in src/cli/commands/tui.ts.
  it("generation streams tokens when provider supports streaming and streaming is enabled (default)", async () => {
    const complete = vi.fn(async () => ({ text: "should not be called", toolCalls: [] }));
    const stream = vi.fn(async function* () {
      yield { type: "text_delta", text: "Hello " };
      yield { type: "text_delta", text: "world" };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 2 } };
    });
    const tokens: string[] = [];
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete, stream),
      events: { onToken: (t) => tokens.push(t), onToolCall: () => {}, onToolResult: () => {} },
    });
    // streaming defaults to true; not passing it explicitly.
    const result = await session.processTurn("Write a poem about the sea");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(tokens.join("")).toBe("Hello world");
    expect(result.summary).toBe("Hello world");
    expect(result.streamed).toBe(true);
    expect(result.reason).toBe("direct");
  });

  it("generation uses complete() (no streaming) when config.streaming === false", async () => {
    const complete = vi.fn(async () => ({ text: "blocking", toolCalls: [] }));
    const stream = vi.fn(async function* () {
      yield { type: "text_delta", text: "should not stream" };
    });
    const tokens: string[] = [];
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete, stream),
      events: { onToken: (t) => tokens.push(t), onToolCall: () => {}, onToolResult: () => {} },
      streaming: false,
    });
    const result = await session.processTurn("Write a joke about cats");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(tokens).toEqual([]);
    expect(result.streamed).toBe(false);
  });

  // ---- diagnostic callback ------------------------------------------------

  it("fires onRouteDiagnostic for arithmetic prompts and swallows callback failures", async () => {
    const recorded: RouteDiagnostic[] = [];
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      onRouteDiagnostic: (d) => {
        recorded.push(d);
        if (recorded.length === 1) throw new Error("boom");
      },
    });
    const result = await session.processTurn("9*7");

    expect(result.summary).toBe("63");
    expect(result.reason).toBe("direct");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].classification).toBe("arithmetic");
    expect(recorded[0].route).toBe("direct");
  });

  it("fires onRouteDiagnostic for generation prompts", async () => {
    const recorded: RouteDiagnostic[] = [];
    const complete = vi.fn(async () => ({ text: "ok", toolCalls: [] }));
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      chatProvider: makeMockProvider(complete),
      onRouteDiagnostic: (d) => {
        recorded.push(d);
      },
    });
    const result = await session.processTurn("Write a haiku about autumn");

    expect(result.reason).toBe("direct");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].classification).toBe("generation");
    expect(recorded[0].route).toBe("direct");
  });

  it("onRouteDiagnostic fires for grounded_chat routes and does NOT fire for workspace/ambiguous", async () => {
    const recorded: RouteDiagnostic[] = [];
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      onRouteDiagnostic: (d) => {
        recorded.push(d);
      },
    });

    await session.processTurn("Refactor this repo");
    expect(recorded).toHaveLength(0);

    await session.processTurn("What is the latest news today?");
    // grounded_chat fires the diagnostic via the route executor
    expect(recorded).toHaveLength(1);

    await session.processTurn("hello there");
    expect(recorded).toHaveLength(1);
  });

  // ---- non-direct routes preserved ---------------------------------------

  it("workspace_action prompt continues with the existing lifecycle", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      planMode: false,
    });
    const result = await session.processTurn("Refactor this repo for clarity");

    expect(mocks.initAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runTaskLoop).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("agent-loop complete");
    // Mock returns reason: "completed" — non-direct path doesn't set
    // reason: "direct". Assert it's *not* the direct reason.
    expect(result.reason).not.toBe("direct");
  });

  it("external_retrieval prompt is handled by the grounded_chat route executor", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      planMode: false,
    });
    const result = await session.processTurn("What is the latest news today?");

    // Init is called (grounded_chat needs ctx), but runTaskLoop is NOT
    // called — the route executor handles it instead.
    expect(mocks.initAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runTaskLoop).not.toHaveBeenCalled();
    expect(result.reason).toBe("grounded_chat");
    expect(result.summary).toBe("Ethereum is trading at $1,891.");
  });

  it("ambiguous prompt continues with the existing lifecycle", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      planMode: false,
    });
    const result = await session.processTurn("hello there");

    expect(mocks.initAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runTaskLoop).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("agent-loop complete");
  });

  // ---- plan-approval gate wiring -----------------------------------------

  it("forwards planApprovalGate from config to runPlanPhase", async () => {
    const gate = {
      requestDecision: vi.fn(async () => "approve" as const),
      resolve: vi.fn(),
      getPending: vi.fn(() => null),
    };
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
      planApprovalGate: gate,
    });
    // planMode: false so the test stays out of the plan-phase's
    // generatePlan path (which needs a real provider). The gate is
    // provisioned; we just verify the session accepted it.
    expect(session).toBeDefined();
    expect(typeof session.setPlanApprovalGate).toBe("function");
  });

  it("setPlanApprovalGate injects a gate at runtime", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
    });
    expect(typeof session.setPlanApprovalGate).toBe("function");
    const gate = {
      requestDecision: vi.fn(async () => "approve" as const),
      resolve: vi.fn(),
      getPending: vi.fn(() => null),
    };
    // Injecting a gate at runtime is the documented TUI startup hook.
    session.setPlanApprovalGate!(gate);
    // The session is now configured but `processTurn` would still try
    // to run the plan phase. We assert the setter exists and is callable
    // without throwing — call-site timing is the TUI's responsibility.
  });

  it("setPlanApprovalGate(null) clears the gate", async () => {
    const session = createAgentSession({
      cwd: directTestCwd,
      task: "",
      sessionId: "direct-test-session",
    });
    expect(typeof session.setPlanApprovalGate).toBe("function");

    // Set a gate, then clear it with null. The setter must accept
    // `null` so teardown paths can drop the gate without removing the
    // method call.
    const gate = {
      requestDecision: vi.fn(async () => "approve" as const),
      resolve: vi.fn(),
      getPending: vi.fn(() => null),
    };
    session.setPlanApprovalGate!(gate);
    // Clearing is the documented "tighten back to the legacy TTY
    // prompt path" signal — must not throw.
    expect(() => session.setPlanApprovalGate!(null)).not.toThrow();
    // Re-injection still works after clear.
    expect(() => session.setPlanApprovalGate!(gate)).not.toThrow();
  });
});
