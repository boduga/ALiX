import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LocalRuntimeExecutor,
  executeRoute,
  type RuntimeContext,
} from "../../src/runtime/route-executor.js";
import { DaemonRuntimeExecutor } from "../../src/daemon/daemon-runtime-executor.js";
import { executeGroundedChatBehavior } from "../../src/runtime/route-execution.js";
import { taskRouter } from "../../src/runtime/task-router.js";
import type { TaskRoute } from "../../src/runtime/task-router.js";

/**
 * Parity contract — local and daemon execution must produce the same routing
 * behavior for every route kind, with daemon-specific code limited to
 * adaptation (config source + socket sink). There is exactly ONE
 * implementation of each behavior (src/runtime/route-execution.ts); both
 * executors delegate to it.
 *
 * The daemon executor loads config from disk, so this suite HOME-isolates the
 * process to keep loadConfig hermetic (no operator config merge, no live
 * provider calls).
 */

function makeFakeClient() {
  const frames: string[] = [];
  const client = {
    write: (data: string) => { frames.push(data); },
    destroyed: false,
    writable: true,
  } as any;
  return { client, frames };
}

function parseFrames(frames: string[]): any[] {
  return frames
    .map((f) => {
      try { return JSON.parse(f.trim()); } catch { return null; }
    })
    .filter(Boolean);
}

function assistantTexts(frames: string[]): string[] {
  return parseFrames(frames)
    .filter((f) => f.type === "assistant.text")
    .map((f) => f.text);
}

describe("route executor parity — local vs daemon", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "parity-test-"));
  const homeDir = join(tmpDir, "home");
  const savedHome = process.env.HOME;
  let config: any;

  before(async () => {
    process.env.HOME = homeDir;
    mkdirSync(join(tmpDir, ".alix", "sessions"), { recursive: true });
    writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
      models: { default: { provider: "mock", name: "mock" } },
      mcpServers: [],
    }));
    const { loadConfig } = await import("../../src/config/loader.js");
    config = await loadConfig(tmpDir);
  });

  after(() => {
    process.env.HOME = savedHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ToolExecutor derives its sessionId from `log.sessionDir`
  // (.alix/sessions/<id>) and appends events during execute, so the
  // event-log stub must carry both.
  function makeEventLog(): any {
    return {
      sessionDir: join(tmpDir, ".alix", "sessions", "parity"),
      append: async () => {},
    };
  }

  function makeLocalCtx(): RuntimeContext {
    return {
      cwd: tmpDir,
      sessionId: "parity",
      sessionDir: join(tmpDir, ".alix", "sessions", "parity"),
      eventLog: makeEventLog(),
      config,
    };
  }

  function makeDaemon() {
    const { client, frames } = makeFakeClient();
    const executor = new DaemonRuntimeExecutor({
      client,
      sessionId: "parity",
      taskId: "task_parity",
      cwd: tmpDir,
      eventLog: makeEventLog(),
    });
    return { executor, client, frames };
  }

  it("direct: local and daemon produce identical single-call generation output", async () => {
    const route: TaskRoute = await taskRouter("Write Fibonacci function in Python");
    assert.equal(route.kind, "direct");

    const local = await new LocalRuntimeExecutor().executeDirect(route as any, makeLocalCtx());
    const { executor, frames } = makeDaemon();
    const daemonText = await executor.executeDirect(route as any, makeLocalCtx());

    assert.equal(daemonText, local, "daemon must produce the same text as local");
    assert.match(local, /Write Fibonacci function in Python/);
    const texts = assistantTexts(frames);
    assert.equal(texts.length, 1, "exactly one assistant.text frame");
    assert.equal(texts[0], local);
    assert.equal(parseFrames(frames)[0].sessionId, "parity");
  });

  it("chat: local and daemon produce identical single-call output", async () => {
    const route = { kind: "chat", prompt: "say hello" } as TaskRoute;

    const local = await new LocalRuntimeExecutor().executeChat(route as any, makeLocalCtx());
    const { executor, frames } = makeDaemon();
    const daemonText = await executor.executeChat(route as any, makeLocalCtx());

    assert.equal(daemonText, local, "daemon must produce the same text as local");
    const texts = assistantTexts(frames);
    assert.equal(texts.length, 1);
    assert.equal(texts[0], local);
  });

  it("grounded_chat (model answers directly, no tool call): local and daemon identical", async () => {
    const route = {
      kind: "grounded_chat",
      prompt: "latest Node.js version",
      allowedTools: ["web.search", "web_fetch"],
      diagnostic: { classification: "external_retrieval", route: "grounded_chat", reason: "test" },
    } as TaskRoute;

    const local = await new LocalRuntimeExecutor().executeGroundedChat(route as any, makeLocalCtx());
    const { executor, frames } = makeDaemon();
    const daemonText = await executor.executeGroundedChat(route as any, makeLocalCtx());

    assert.equal(daemonText, local, "daemon must produce the same text as local");
    const texts = assistantTexts(frames);
    assert.equal(texts.length, 1);
    assert.equal(texts[0], local);
  });

  it("tool: local and daemon execute the same shell tool; daemon emits marker + result", async () => {
    const route = {
      kind: "tool",
      tool: "shell.run",
      args: { command: "echo parity" },
    } as TaskRoute;

    const local = await new LocalRuntimeExecutor().executeTool(route as any, makeLocalCtx());
    assert.match(local, /parity/, "tool output must be the echo text");

    const { executor, frames } = makeDaemon();
    const daemonText = await executor.executeTool(route as any, makeLocalCtx());
    assert.equal(daemonText, local, "daemon tool result must equal local");

    const texts = assistantTexts(frames);
    assert.equal(texts.length, 2, "daemon emits the tool marker frame, then the result");
    assert.match(texts[0], /^→ shell\.run/, "first frame is the invocation marker");
    assert.equal(texts[1], local);
  });

  it("web-only grounded chat has NO shell capability, and the allowlist rejection is single-source", async () => {
    // Bug class: the router must never grant a shell tool to a grounded_chat
    // route, and the executor must reject any attempted shell call with the
    // same message everywhere (there is only one implementation).
    const route = await taskRouter("what is the latest linux LTS version");
    assert.equal(route.kind, "grounded_chat");
    if (route.kind === "grounded_chat") {
      assert.deepEqual(route.allowedTools, ["web.search", "web_fetch"]);
      assert.ok(
        !route.allowedTools.some((t) => t.includes("shell")),
        "grounded_chat must not expose a shell tool",
      );
    }

    // A model that nevertheless attempts a shell tool is rejected by the
    // single shared behavior — inject a provider that returns such a call.
    const rejectingProvider = {
      complete: async () => ({
        text: "",
        toolCalls: [{ id: "t1", name: "alix_shell_run", args: { command: "uname -a" } }],
      }),
    } as any;

    const grounded = {
      kind: "grounded_chat",
      prompt: "what is my os",
      allowedTools: ["web.search", "web_fetch"],
      diagnostic: { classification: "external_retrieval", route: "grounded_chat", reason: "test" },
    } as any;

    const rejected = await executeGroundedChatBehavior(grounded, config, {
      eventLog: makeEventLog(),
      cwd: tmpDir,
      providerFactory: async () => rejectingProvider,
    });
    assert.equal(rejected, 'Tool "alix_shell_run" is not allowed for this query type.');
  });

  it("config is loaded exactly once for a daemon request", async () => {
    const { executor } = makeDaemon();
    const c1 = await executor.getConfig();
    const c2 = await executor.getConfig();
    assert.equal(c1, c2, "getConfig must return the cached instance");

    // A route operation uses the same cached config — no second load.
    const route = { kind: "chat", prompt: "say hello" } as TaskRoute;
    await executor.executeChat(route as any, makeLocalCtx());
    const c3 = await executor.getConfig();
    assert.equal(c3, c1, "executor operations must reuse the request's config instance");

    // And it resolves the mock provider from the hermetic project config.
    assert.equal(c1.models.default.provider, "mock");
  });

  it("DaemonRuntimeExecutor has no agent path (agent routes go to runTask)", async () => {
    const { executor } = makeDaemon();
    const route = { kind: "agent", task: "count files" } as any;
    await assert.rejects(
      () => executor.executeAgent(route, makeLocalCtx()),
      /runTask/,
      "agent routes are handled by handleRun, not the executor",
    );
  });

  it("executeRoute dispatches through the daemon executor like the local one", async () => {
    const route = await taskRouter("2 + 2");
    assert.equal(route.kind, "direct");

    const local = await executeRoute(route, makeLocalCtx(), new LocalRuntimeExecutor());
    const { executor, frames } = makeDaemon();
    const daemonResult = await executeRoute(route, makeLocalCtx(), executor);

    assert.equal(daemonResult, local, "shared dispatcher produces identical result");
    const texts = assistantTexts(frames);
    assert.equal(texts.length, 1);
    assert.equal(texts[0], "4");
  });
});
