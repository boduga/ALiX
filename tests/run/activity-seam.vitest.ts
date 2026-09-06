import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelAdapter } from "../../src/providers/types.js";

// ── Real-loop seam test (tool_started / tool_completed are real seams) ────
// Standalone (no vi.mock of task-loop) so runTaskLoop is the real loop.

// ── Real-loop seam test (tool_started / tool_completed are real seams) ────

describe("real runTaskLoop onProgress seam", () => {
  it("fires tool_started then tool_completed with the tool name", async () => {
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    type TaskLoopDeps = import("../../src/run/task-loop.js").TaskLoopDeps;
    const { EventLog } = await import("../../src/events/event-log.js");
    const { MemoryStore } = await import("../../src/utils/memory/store.js");
    const { ScopeTracker } = await import("../../src/autonomy/scope-tracker.js");
    const { TaskStateMachine, RunLimiter } = await import("../../src/autonomy/state-machine.js");
    const { createContextBudget } = await import("../../src/config/context-budget.js");
    const { ToolExecutor } = await import("../../src/tools/executor.js");
    const tmpRoot = mkdtempSync(join(tmpdir(), "activity-seam-"));
    try {
      writeFileSync(join(tmpRoot, "a.txt"), "hello a", "utf8");
      const sessionDir = join(tmpRoot, ".alix", "sessions", "seam");
      mkdirSync(sessionDir, { recursive: true });
      const log = new EventLog(sessionDir);
      await log.init();
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
        log,
        tmpRoot,
      );
      const provider = (() => {
        let invocations = 0;
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
            parallelToolCalls: false,
          },
          editFormatPreference: "structured_patch",
          longContextStrategy: "trimmed_context",
          async complete(): Promise<{ text: string; toolCalls: any[]; usage: { inputTokens: number; outputTokens: number }; finishReason: string }> {
            const inv = invocations++;
            if (inv === 0) {
              return {
                text: "",
                toolCalls: [{ id: "call_1", name: "alix_file_read", args: { path: "a.txt" } }],
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
      const deps: TaskLoopDeps = {
        config: { models: { default: { provider: "mock", name: "mock" } }, permissions: {}, context: {} } as any,
        provider,
        providerTools: [
          { name: "alix_file_read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        ],
        mcpToolIndex: [],
        messages: [{ role: "user", content: "read a.txt" }],
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
        log,
        executor,
        mcpDiscovery: null,
        selectedTools: [{ name: "alix_file_read", execName: "file.read" }],
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

      await runTaskLoop(deps);

      // The real loop must emit tool_started (new seam) and tool_completed
      // (existing seam) with the same tool name — proving the activity wiring
      // observes real execution, not a dead code path.
      expect(progress).toContain("tool_started:alix_file_read");
      expect(progress).toContain("tool_completed:alix_file_read");
      expect(progress.indexOf("tool_started:alix_file_read")).toBeLessThan(
        progress.indexOf("tool_completed:alix_file_read"),
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});