import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelAdapter } from "../../src/providers/types.js";

// ── Real-loop seam tests (tool_started / tool_completed are real seams) ────
// Standalone (no vi.mock of task-loop) so runTaskLoop is the real loop.
// Covers BOTH execution paths: the serial branch (parallelToolCalls:false)
// and the parallel branch (parallelToolCalls:true + 2+ safe tool calls); each
// must fire tool_started before tool_completed for every executed tool.

type Deps = import("../../src/run/task-loop.js").TaskLoopDeps;

interface Harness {
  tmpRoot: string;
  cleanup: () => void;
  deps: Deps;
  progress: string[];
}

// Real async initialization (EventLog needs init()).
async function buildHarness(opts: {
  parallelToolCalls: boolean;
  firstToolCalls: Array<{ id: string; name: string; args: Record<string, string> }>;
}): Promise<Harness> {
  const { EventLog } = await import("../../src/events/event-log.js");
  const { MemoryStore } = await import("../../src/utils/memory/store.js");
  const { ScopeTracker } = await import("../../src/autonomy/scope-tracker.js");
  const { TaskStateMachine, RunLimiter } = await import("../../src/autonomy/state-machine.js");
  const { createContextBudget } = await import("../../src/config/context-budget.js");
  const { ToolExecutor } = await import("../../src/tools/executor.js");
  const { runTaskLoop } = await import("../../src/run/task-loop.js");

  const tmpRoot = mkdtempSync(join(tmpdir(), "activity-seam-"));
  writeFileSync(join(tmpRoot, "a.txt"), "hello a", "utf8");
  writeFileSync(join(tmpRoot, "b.txt"), "hello b", "utf8");
  const sessionDir = join(tmpRoot, ".alix", "sessions", "seam");
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

  let invocations = 0;
  const provider = (() => {
    return {
      id: "mock",
      capabilities: {
        provider: "mock",
        model: "mock",
        inputTokenLimit: 100_000,
        outputTokenLimit: 16_384,
        supportsTools: true,
        supportsStreaming: false,
        supportsStructuredOutput: false,
        supportsVision: false,
        parallelToolCalls: opts.parallelToolCalls,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "trimmed_context",
      async complete(): Promise<{ text: string; toolCalls: any[]; usage: { inputTokens: number; outputTokens: number }; finishReason: string }> {
        const inv = invocations++;
        if (inv === 0) {
          return {
            text: "",
            toolCalls: opts.firstToolCalls,
            usage: { inputTokens: 100, outputTokens: 50 },
            finishReason: "tool_calls",
          };
        }
        return {
          text: "done.",
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 50 },
          finishReason: "stop",
        };
      },
    };
  })() as unknown as ModelAdapter;

  const progress: string[] = [];
  const toolNames = opts.firstToolCalls.map((c) => c.name);
  const deps: Deps = {
    config: { models: { default: { provider: "mock", name: "mock" } }, permissions: {}, context: {} } as any,
    provider,
    providerTools: toolNames.map((name) => ({
      name,
      description: "read",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    })),
    mcpToolIndex: [],
    messages: [{ role: "user", content: "read files" }],
    sessionState: {
      created: new Set(),
      deleted: new Set(),
      changed: new Set(),
      fatalErrors: [],
      pendingScopeExpansion: false,
    },
    stateMachine: new TaskStateMachine(new RunLimiter({ maxIterations: 5, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60_000 })),
    scope: new ScopeTracker(),
    session: { sessionId: "seam", actor: "system" },
    log: eventLog,
    executor,
    mcpDiscovery: null,
    selectedTools: Array.from(new Set(toolNames)).map((name) => ({ name, execName: "file.read" })),
    hooks: {},
    maxIterations: 5,
    contextBudget: createContextBudget({ contextWindowTokens: 100_000 }, {}),
    tokenizer: "cl100k_base",
    task: "seam test task",
    taskType: "docs",
    depth: "quick",
    memoryStore,
    sessionId: "seam",
    sessionDir,
    systemPrompt: "You are a test assistant.",
    onProgress: (kind, description) => {
      progress.push(`${kind}:${description ?? ""}`);
    },
  };
  return {
    tmpRoot,
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
    deps,
    progress,
  };
}

describe("real runTaskLoop tool-progress seam", () => {
  it("serial branch — tool_started then tool_completed with the tool name", async () => {
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    const h = await buildHarness({
      parallelToolCalls: false,
      firstToolCalls: [{ id: "call_1", name: "alix_file_read", args: { path: "a.txt" } }],
    });
    try {
      await runTaskLoop(h.deps);
      const p = h.progress;
      expect(p).toContain("tool_started:alix_file_read");
      expect(p).toContain("tool_completed:alix_file_read");
      expect(p.indexOf("tool_started:alix_file_read")).toBeLessThan(
        p.indexOf("tool_completed:alix_file_read"),
      );
    } finally {
      h.cleanup();
    }
  });

  it("parallel branch — each of 2+ safe tools fires tool_started then tool_completed", async () => {
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    const h = await buildHarness({
      parallelToolCalls: true,
      firstToolCalls: [
        { id: "call_a", name: "alix_file_read", args: { path: "a.txt" } },
        { id: "call_b", name: "alix_file_read", args: { path: "b.txt" } },
      ],
    });
    try {
      await runTaskLoop(h.deps);
      const p = h.progress;
      // Both executed tools must surface the start→finish lifecycle on the
      // parallel branch (the seam was added there too, not just serial).
      const started = p.filter((e) => e === "tool_started:alix_file_read");
      const completed = p.filter((e) => e === "tool_completed:alix_file_read");
      expect(started.length).toBe(2);
      expect(completed.length).toBe(2);
      expect(p.indexOf("tool_started:alix_file_read")).toBeLessThan(
        p.indexOf("tool_completed:alix_file_read"),
      );
    } finally {
      h.cleanup();
    }
  });
});