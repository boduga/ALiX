import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  executeRoute,
  LocalRuntimeExecutor,
  type RuntimeContext,
  type RuntimeExecutor,
  type RouteDiagnostic,
} from "../../src/runtime/route-executor.js";
import { taskRouter, type TaskRoute } from "../../src/runtime/task-router.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeCtx(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    cwd: "/tmp",
    sessionId: "test",
    sessionDir: "/tmp/.alix/sessions/test",
    eventLog: {} as any,
    config: { model: { provider: "mock", name: "mock-model" } } as any,
    ...overrides,
  };
}

describe("executeRoute dispatch", () => {
  const mockCtx = makeCtx();

  const mockExecutor: RuntimeExecutor = {
    executeDirect: async (r) => `direct:${r.prompt}:${r.answer ?? ""}`,
    executeTool: async (r) => `tool:${r.tool}:${JSON.stringify(r.args)}`,
    executeChat: async (r) => `chat:${r.prompt}`,
    executeGroundedChat: async (r) => `grounded:${r.prompt}:${r.allowedTools.join(",")}`,
    executeAgent: async (r) => `agent:${r.task}`,
  };

  it("dispatches tool route to executeTool", async () => {
    const result = await executeRoute(
      { kind: "tool", tool: "shell.run", args: { command: "ls" } },
      mockCtx, mockExecutor,
    );
    assert.equal(result, 'tool:shell.run:{"command":"ls"}');
  });

  it("dispatches chat route to executeChat", async () => {
    const result = await executeRoute(
      { kind: "chat", prompt: "hello" },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "chat:hello");
  });

  it("dispatches grounded_chat route to executeGroundedChat", async () => {
    const result = await executeRoute(
      {
        kind: "grounded_chat",
        prompt: "latest news",
        allowedTools: ["web.search"],
        diagnostic: { classification: "external_retrieval", route: "grounded_chat", reason: "test" },
      },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "grounded:latest news:web.search");
  });

  it("dispatches agent route to executeAgent", async () => {
    const result = await executeRoute(
      {
        kind: "agent",
        task: "fix bugs",
        diagnostic: { classification: "workspace_action", route: "agent", reason: "test" },
      },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "agent:fix bugs");
  });

  it("dispatches direct route to executeDirect", async () => {
    const route: TaskRoute = await taskRouter("2 + 2");
    assert.equal(route.kind, "direct");
    const result = await executeRoute(route, mockCtx, mockExecutor);
    assert.equal(result, "direct:2 + 2:4");
  });
});

// ── Diagnostic forwarding (Task 2) ─────────────────────────────────────

describe("executeRoute — onRouteDiagnostic forwarding", () => {
  it("forwards the route diagnostic to ctx.onRouteDiagnostic for direct routes", async () => {
    const observed: RouteDiagnostic[] = [];
    const ctx = makeCtx({
      onRouteDiagnostic: (d) => observed.push(d),
    });
    const mockExecutor: RuntimeExecutor = {
      executeDirect: async () => "ok",
      executeTool: async () => "ok",
      executeChat: async () => "ok",
      executeGroundedChat: async () => "ok",
      executeAgent: async () => "ok",
    };

    const route = await taskRouter("2 + 2");
    await executeRoute(route, ctx, mockExecutor);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].classification, "arithmetic");
    assert.equal(observed[0].route, "direct");
  });

  it("forwards the diagnostic for grounded_chat routes", async () => {
    const observed: RouteDiagnostic[] = [];
    const ctx = makeCtx({ onRouteDiagnostic: (d) => observed.push(d) });
    const mockExecutor: RuntimeExecutor = {
      executeDirect: async () => "ok",
      executeTool: async () => "ok",
      executeChat: async () => "ok",
      executeGroundedChat: async () => "ok",
      executeAgent: async () => "ok",
    };

    const route = await taskRouter("Search latest docs");
    assert.equal(route.kind, "grounded_chat");
    await executeRoute(route, ctx, mockExecutor);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].classification, "external_retrieval");
    assert.equal(observed[0].route, "grounded_chat");
  });

  it("forwards the diagnostic for workspace_action → agent routes", async () => {
    const observed: RouteDiagnostic[] = [];
    const ctx = makeCtx({ onRouteDiagnostic: (d) => observed.push(d) });
    const mockExecutor: RuntimeExecutor = {
      executeDirect: async () => "ok",
      executeTool: async () => "ok",
      executeChat: async () => "ok",
      executeGroundedChat: async () => "ok",
      executeAgent: async () => "ok",
    };

    const route = await taskRouter("Find SQL usage in my repo");
    assert.equal(route.kind, "agent");
    await executeRoute(route, ctx, mockExecutor);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].classification, "workspace_action");
    assert.equal(observed[0].route, "agent");
  });

  it("does NOT call onRouteDiagnostic for tool routes (no diagnostic attached)", async () => {
    let called = 0;
    const ctx = makeCtx({ onRouteDiagnostic: () => called++ });
    const mockExecutor: RuntimeExecutor = {
      executeDirect: async () => "ok",
      executeTool: async () => "ok",
      executeChat: async () => "ok",
      executeGroundedChat: async () => "ok",
      executeAgent: async () => "ok",
    };

    await executeRoute(
      { kind: "tool", tool: "shell.run", args: { command: "ls" } },
      ctx, mockExecutor,
    );
    assert.equal(called, 0);
  });

  it("swallows callback failures (diagnostic channel must never break dispatch)", async () => {
    const ctx = makeCtx({
      onRouteDiagnostic: () => {
        throw new Error("observer crashed");
      },
    });
    const mockExecutor: RuntimeExecutor = {
      executeDirect: async () => "still-ok",
      executeTool: async () => "ok",
      executeChat: async () => "ok",
      executeGroundedChat: async () => "ok",
      executeAgent: async () => "ok",
    };

    const route = await taskRouter("2 + 2");
    const result = await executeRoute(route, ctx, mockExecutor);
    assert.equal(result, "still-ok");
  });

  it("does not call onRouteDiagnostic when the callback is absent", async () => {
    // Plain context, no onRouteDiagnostic — should not throw.
    const ctx = makeCtx();
    const mockExecutor: RuntimeExecutor = {
      executeDirect: async () => "ok",
      executeTool: async () => "ok",
      executeChat: async () => "ok",
      executeGroundedChat: async () => "ok",
      executeAgent: async () => "ok",
    };
    const route = await taskRouter("2 + 2");
    const result = await executeRoute(route, ctx, mockExecutor);
    assert.equal(result, "ok");
  });
});

// ── LocalRuntimeExecutor.executeDirect (Task 2) ────────────────────────

describe("LocalRuntimeExecutor.executeDirect", () => {
  it("returns the pre-computed `answer` for arithmetic direct routes", async () => {
    const ctx = makeCtx();
    const executor = new LocalRuntimeExecutor();
    const result = await executor.executeDirect(
      {
        kind: "direct",
        prompt: "2 + 2",
        answer: "4",
        diagnostic: {
          classification: "arithmetic",
          route: "direct",
          reason: "test",
        },
      },
      ctx,
    );
    assert.equal(result, "4");
  });

  it("makes a single provider call for standalone_generation direct routes", async () => {
    const ctx = makeCtx();
    const executor = new LocalRuntimeExecutor();
    const result = await executor.executeDirect(
      {
        kind: "direct",
        prompt: "Write Fibonacci function in Python",
        diagnostic: {
          classification: "standalone_generation",
          route: "direct",
          reason: "test",
        },
      },
      ctx,
    );
    // The mock provider's `complete` returns a deterministic string
    // containing the user prompt — this proves a single provider call
    // was made and no tool executor was invoked.
    assert.match(result, /Write Fibonacci function in Python/);
  });
});

// ── Direct path must not import ToolExecutor / runTask (Task 2) ──────

describe("LocalRuntimeExecutor.executeDirect — import boundaries", () => {
  it("does not import ToolExecutor in route-executor.ts", async () => {
    // Read the compiled output (the test runs from dist/tests/...).
    // Static `import` statements from a side-effecting module would be
    // preserved by tsc; dynamic `await import(...)` calls would not.
    // We assert there is no *static* import to the tools/executor or
    // agent/agent-loop modules from this file.
    const source = await readFile(
      resolve(__dirname, "../../src/runtime/route-executor.js"),
      "utf8",
    );
    // Look for static import statements (top of file, `import ... from`).
    // We split on lines and only flag lines that look like a static
    // import — not dynamic `import(...)` calls inside method bodies.
    const importLines = source
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l));
    const offenders = importLines.filter(
      (l) =>
        /ToolExecutor/.test(l) ||
        /runTask/.test(l) ||
        /agent-loop/.test(l) ||
        /\/tools\/executor/.test(l) ||
        /\/agent\/agent-loop/.test(l),
    );
    assert.deepEqual(
      offenders,
      [],
      `route-executor.js has a static import of a side-effecting module:\n${offenders.join("\n")}`,
    );
  });
});
