/**
 * operator-cancel-seam.vitest.ts — REAL runTaskLoop operator-cancellation
 * seam (Task 6.1, 6.3).
 *
 * Standalone (no vi.mock of task-loop): drives the actual runTaskLoop with a
 * provider whose `complete()` (or mid-stream) never resolves — simulating a
 * genuinely hung upstream call. The deps carry the shared CancellationToken +
 * AbortSignal pair. Operator cancel must RELEASE the run immediately
 * (ExecutionCancelledError, not a wall-clock wait on the provider's own
 * transport bound) and must NEVER surface as a timeout or a plain failure.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelAdapter } from "../../src/providers/types.js";
import type { TaskLoopDeps } from "../../src/run/task-loop.js";

async function buildHarness(opts?: { streaming?: boolean }): Promise<{
  cleanup: () => void;
  deps: TaskLoopDeps;
  startedCalls: () => number;
  completedCalls: () => number;
}> {
  const { EventLog } = await import("../../src/events/event-log.js");
  const { MemoryStore } = await import("../../src/utils/memory/store.js");
  const { ScopeTracker } = await import("../../src/autonomy/scope-tracker.js");
  const { TaskStateMachine, RunLimiter } = await import("../../src/autonomy/state-machine.js");
  const { createContextBudget } = await import("../../src/config/context-budget.js");
  const { ToolExecutor } = await import("../../src/tools/executor.js");

  const tmpRoot = mkdtempSync(join(tmpdir(), "operator-cancel-seam-"));
  const sessionDir = join(tmpRoot, ".alix", "sessions", "cancel-seam");
  mkdirSync(sessionDir, { recursive: true });
  const eventLog = new EventLog(sessionDir);
  await eventLog.init();
  const memoryStore = new MemoryStore(join(tmpRoot, "memory"));
  await memoryStore.init();
  const executor = new ToolExecutor(
    {
      version: 1,
      model: { provider: "mock", name: "mock-model" },
      permissions: {
        default: "allow",
        tools: {},
        protectedPaths: [],
        allowNetworkDomains: [],
        denyCommands: [],
        sessionMode: "auto",
      },
      context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
      runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
      ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const },
    } as any,
    eventLog,
    tmpRoot,
  );

  let started = 0;
  let completed = 0;
  const hang = new Promise<void>(() => {}); // never resolves on its own
  const streaming = opts?.streaming === true;
  const provider = {
    id: "mock",
    capabilities: {
      provider: "mock",
      model: "mock",
      inputTokenLimit: 100_000,
      outputTokenLimit: 16_384,
      supportsTools: false,
      supportsStreaming: streaming,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "trimmed_context",
    // Non-streaming: the upstream call never returns — only an operator
    // cancel (via the raced signal) can release the run.
    async complete(): Promise<never> {
      started++;
      completed++;
      return hang as Promise<never>;
    },
    // Streaming: emits one private reasoning chunk (never written to stdout)
    // then hangs mid-stream — a cancel must release the run promptly and
    // must NOT trigger the fail-soft complete() fallback.
    async *stream(): AsyncGenerator<any> {
      started++;
      yield { type: "reasoning_delta", text: "thinking hard" };
      await hang;
    },
  } as unknown as ModelAdapter;

  const deps: TaskLoopDeps = {
    config: { models: { default: { provider: "mock", name: "mock", streaming } }, permissions: {}, context: {} } as any,
    provider,
    providerTools: [],
    mcpToolIndex: [],
    messages: [{ role: "user", content: "do the thing" }],
    sessionState: {
      created: new Set(),
      deleted: new Set(),
      changed: new Set(),
      fatalErrors: [],
      pendingScopeExpansion: false,
    },
    stateMachine: new TaskStateMachine(new RunLimiter({ maxIterations: 5, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60_000 })),
    scope: new ScopeTracker(),
    session: { sessionId: "cancel-seam", actor: "system" },
    log: eventLog,
    executor,
    mcpDiscovery: null,
    selectedTools: [],
    hooks: {},
    maxIterations: 5,
    contextBudget: createContextBudget({ contextWindowTokens: 100_000 }, {}),
    tokenizer: "cl100k_base",
    task: "cancel seam test task",
    taskType: "docs",
    depth: "quick",
    memoryStore,
    sessionId: "cancel-seam",
    sessionDir,
    systemPrompt: "You are a test assistant.",
  };
  return {
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
    deps,
    startedCalls: () => started,
    completedCalls: () => completed,
  };
}

describe("real runTaskLoop operator-cancellation seam (Task 6.1/6.3)", () => {
  it("a cancel releases a hung provider complete() as ExecutionCancelledError — never a timeout, never a failure result", async () => {
    const { CancellationToken, ExecutionCancelledError } = await import("../../src/runtime/cancellation-token.js");
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    const h = await buildHarness();
    try {
      const token = new CancellationToken();
      const controller = new AbortController();
      h.deps.cancellationToken = token;
      h.deps.cancelSignal = controller.signal;

      const loop = runTaskLoop(h.deps);
      // Wait until the loop is genuinely blocked inside provider.complete().
      await vi.waitFor(() => {
        expect(h.startedCalls()).toBe(1);
      });

      // Operator presses the cancel key — flips the token AND aborts the signal.
      token.cancel("operator stop");
      controller.abort("operator stop");

      const start = Date.now();
      await expect(loop).rejects.toBeInstanceOf(ExecutionCancelledError);
      // Released promptly by the raced signal — NOT by waiting on the
      // provider's own transport timeout (default 180s).
      expect(Date.now() - start).toBeLessThan(2_000);
    } finally {
      h.cleanup();
    }
  });

  it("without cancellation the loop stays blocked (no false positive release)", async () => {
    const { CancellationToken } = await import("../../src/runtime/cancellation-token.js");
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    const h = await buildHarness();
    try {
      const token = new CancellationToken();
      const controller = new AbortController();
      h.deps.cancellationToken = token;
      h.deps.cancelSignal = controller.signal;

      const loop = runTaskLoop(h.deps);
      await vi.waitFor(() => {
        expect(h.startedCalls()).toBe(1);
      });
      // Give a hung-but-not-cancelled run a beat: it must still be pending
      // (no premature rejection), confirming the wrapper does not impose its
      // own wall-clock deadline.
      let settled = false;
      loop.then(
        () => { settled = true; },
        () => { settled = true; },
      );
      await new Promise((r) => setTimeout(r, 150));
      expect(settled).toBe(false);

      token.cancel("operator stop");
      controller.abort("operator stop");
      await expect(loop).rejects.toMatchObject({ name: "ExecutionCancelledError" });
    } finally {
      h.cleanup();
    }
  });

  it("a cancel releases a hung mid-stream generator promptly and never fail-soft falls back to complete()", async () => {
    const { CancellationToken, ExecutionCancelledError } = await import("../../src/runtime/cancellation-token.js");
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    const h = await buildHarness({ streaming: true });
    try {
      const token = new CancellationToken();
      const controller = new AbortController();
      h.deps.cancellationToken = token;
      h.deps.cancelSignal = controller.signal;

      const loop = runTaskLoop(h.deps);
      await vi.waitFor(() => {
        expect(h.startedCalls()).toBe(1); // stream generator entered
      });

      token.cancel("operator stop");
      controller.abort("operator stop");

      // Released promptly by the raced signal — even though the generator is
      // stuck in its own internal await and can never accept a return().
      const start = Date.now();
      await expect(loop).rejects.toBeInstanceOf(ExecutionCancelledError);
      expect(Date.now() - start).toBeLessThan(2_000);
      // The generator was not re-invoked and the abort never triggered the
      // fail-soft complete() fallback (a cancel is not a network hiccup).
      expect(h.startedCalls()).toBe(1);
      expect(h.completedCalls()).toBe(0);
    } finally {
      h.cleanup();
    }
  });
});
