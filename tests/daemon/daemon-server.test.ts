import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Integration test for the daemon server's route execution.
 *
 * Spawns daemon-server.js on a temp socket, submits tasks of each
 * route kind, and verifies the response stream.
 */
describe("Daemon server route execution", { timeout: 30000 }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "daemon-srv-test-"));
  // HOME isolation so loadConfig does not merge the operator's real
  // ~/.config/alix/config.json — otherwise the project's `mock` config is
  // overridden by a canonical `models.default` from the real home and the
  // route execution hits a live provider (and "Plan" never appears).
  const homeDir = join(tmpDir, "home");
  const socketPath = join(tmpDir, "test.sock");
  const cwd = tmpDir;
  let serverProcess: any = null;

  before(() => {
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
    mkdirSync(join(tmpDir, ".alix", "sessions"), { recursive: true });
    writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" }, mcpServers: [],
    }));
  });

  after(() => {
    if (serverProcess) try { serverProcess.kill(); } catch { /* ignore */ }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverJs = join(__dirname, "..", "..", "src", "daemon", "daemon-server.js");
      serverProcess = spawn(process.execPath, [serverJs, "--socket", socketPath, "--cwd", cwd], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: homeDir },
      });
      serverProcess.stderr.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) resolve();
      });
      serverProcess.on("error", reject);
      setTimeout(() => reject(new Error("Daemon did not start within 5s")), 5000);
    });
  }

  function submitWithRoute(task: string, route: any): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const messages: string[] = [];
      const client = connect(socketPath, () => {
        client.write(JSON.stringify({ command: "run", task, cwd: tmpDir, route }) + "\n");
      });
      client.on("data", (data: Buffer) => {
        const chunk = data.toString("utf8");
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          messages.push(line);
          try {
            const msg = JSON.parse(line);
            // Close on either terminal frame — the daemon may take the
            // direct fast path (Task 3) for `direct` routes.
            if (msg.type === "session.ended" || msg.type === "direct.completed") client.end();
          } catch { /* skip malformed lines */ }
        }
      });
      client.on("error", reject);
      client.on("close", () => resolve(messages));
    });
  }

  it("executes tool route via daemon", async () => {
    await startDaemon();
    const messages = await submitWithRoute("echo hello", {
      kind: "tool", tool: "shell.run", args: { command: "echo hello" },
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("hello")), "expected tool output 'hello'");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
    assert.ok(messages.some(m => m.includes("session.ended")), "expected session.ended");
  });

  it("executes chat route via daemon", async () => {
    const messages = await submitWithRoute("say hello", {
      kind: "chat", prompt: "say hello",
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
    // Mock provider returns a canned response
    assert.ok(messages.some(m => m.includes("Plan")), "expected mock provider response");
  });

  it("executes grounded_chat route via daemon (mock falls through to direct answer)", async () => {
    const messages = await submitWithRoute("latest Node.js version", {
      kind: "grounded_chat", prompt: "latest Node.js version", allowedTools: ["web_search"],
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
  });

  it("executes agent route (falls through to runTask) via daemon", async () => {
    const messages = await submitWithRoute("count files", {
      kind: "agent", task: "count files in current directory",
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
  });

  it("backward compatible: raw task without route is classified server-side", async () => {
    const messages: string[] = [];
    const client = connect(socketPath, () => {
      client.write(JSON.stringify({ command: "run", task: "echo backward-compat", cwd: tmpDir }) + "\n");
    });
    client.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        messages.push(line);
        try {
          const msg = JSON.parse(line);
          if (msg.type === "session.ended" || msg.type === "direct.completed") client.end();
        } catch { /* skip */ }
      }
    });
    await new Promise<void>((resolve, reject) => {
      client.on("error", reject);
      client.on("close", () => {
        assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text for backward-compat task");
        assert.ok(messages.some(m => m.includes("backward-compat")), "expected shell output");
        assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
        resolve();
      });
    });
  });
});

// ─── Task 3: Direct (ephemeral) protocol fast path ─────────────────────

/**
 * Submit a request to the daemon over a fresh socket. Closes when either
 * `session.ended` OR `direct.completed` is received, whichever comes
 * first. Returns the parsed message stream.
 */
function submitRequest(
  socketPath: string,
  body: Record<string, unknown>,
  endAfter: string[] = ["session.ended", "direct.completed"],
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const client = connect(socketPath, () => {
      client.write(JSON.stringify(body) + "\n");
    });
    client.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          messages.push(msg);
          if (endAfter.includes(msg.type)) client.end();
        } catch { /* skip malformed */ }
      }
    });
    client.on("error", reject);
    client.on("close", () => resolve(messages));
    // Safety net.
    setTimeout(() => {
      try { client.destroy(); } catch {}
      resolve(messages);
    }, 5000);
  });
}

/** Parse every JSON-line frame in a raw message buffer. */
function parseFrames(raw: string[]): any[] {
  const out: any[] = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

describe("Daemon direct protocol fast path (Task 3)", { timeout: 30000 }, () => {
  // ── HOME-isolated daemon: `process.env.HOME` is overridden for the
  // ── child process so its `homedir()` resolves to `homeDir`. This
  // ── lets the test directly inspect `~/.alix/daemon-tasks.json` to
  // ── prove the direct path creates no TaskRegistry entry.
  const tmpDir = mkdtempSync(join(tmpdir(), "daemon-direct-test-"));
  const homeDir = join(tmpDir, "home");
  const socketPath = join(tmpDir, "test.sock");
  const cwd = tmpDir;
  let serverProcess: any = null;
  // Path the daemon will read & write for TaskRegistry.
  const registryPath = join(homeDir, ".alix", "daemon-tasks.json");

  before(async () => {
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
    // Deliberately NOT creating `.alix/sessions` — the direct path
    // must not create it.
    writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" }, mcpServers: [],
    }));

    await new Promise<void>((resolve, reject) => {
      const serverJs = join(__dirname, "..", "..", "src", "daemon", "daemon-server.js");
      serverProcess = spawn(process.execPath, [serverJs, "--socket", socketPath, "--cwd", cwd], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: homeDir },
      });
      serverProcess.stderr.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) resolve();
      });
      serverProcess.on("error", reject);
      setTimeout(() => reject(new Error("Daemon did not start within 5s")), 5000);
    });
  });

  after(() => {
    if (serverProcess) try { serverProcess.kill(); } catch { /* ignore */ }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Frame shape & ordering ──────────────────────────────────────────

  it("arithmetic direct request emits exactly [request.received, direct.completed] in order", async () => {
    const messages = await submitRequest(
      socketPath,
      { command: "direct", task: "2 + 2", requestId: "req_order_arith" },
      ["direct.completed"],
    );
    // Exact ordering: the brief's diagram is
    //   requestId → request.received → direct.completed
    // i.e. exactly two frames, in that order, on the wire.
    assert.equal(messages.length, 2, `expected exactly 2 frames, got ${messages.length}: ${JSON.stringify(messages)}`);
    assert.equal(messages[0].type, "request.received");
    assert.equal(messages[0].requestId, "req_order_arith");
    assert.equal(messages[1].type, "direct.completed");
    assert.equal(messages[1].requestId, "req_order_arith");
    assert.equal(messages[1].text, "4");
  });

  it("generation direct request emits exactly [request.received, direct.completed] in order", async () => {
    const messages = await submitRequest(
      socketPath,
      {
        command: "direct",
        task: "Write Fibonacci function in Python",
        requestId: "req_order_sg",
      },
      ["direct.completed"],
    );
    assert.equal(messages.length, 2, `expected exactly 2 frames, got ${messages.length}: ${JSON.stringify(messages)}`);
    assert.equal(messages[0].type, "request.received");
    assert.equal(messages[0].requestId, "req_order_sg");
    assert.equal(messages[1].type, "direct.completed");
    assert.equal(messages[1].requestId, "req_order_sg");
    // Mock provider returns a canned response containing the user prompt;
    // the prompt appearing exactly once proves a single provider call.
    const text: string = messages[1].text;
    const occurrences = text.split("Write Fibonacci function in Python").length - 1;
    assert.equal(occurrences, 1, `expected prompt to appear exactly once, got ${occurrences}`);
    assert.match(text, /Write Fibonacci function in Python/, "direct generation must call the provider once with the prompt");
  });

  it("generation makes exactly one provider call (no tool loop)", async () => {
    // The mock provider's `complete()` returns the prompt in its body;
    // a single occurrence is the proof. If a tool loop were running,
    // we'd see multiple provider invocations and the prompt would appear
    // more than once (or not at all).
    const messages = await submitRequest(
      socketPath,
      {
        command: "direct",
        task: "Compose a haiku about TypeScript",
        requestId: "req_one_provider",
      },
      ["direct.completed"],
    );
    assert.equal(messages.length, 2);
    const text: string = messages[1].text;
    // Mock provider yields a single complete() response; verify the
    // surface matches: no streamed delta markers, no multi-step markers.
    assert.doesNotMatch(text, /Tool result from /i, "no tool loop in direct path");
    assert.doesNotMatch(text, /Step \d/i, "no multi-step markers in direct path");
    // Single invocation marker: the prompt appears verbatim once.
    const promptOccurrences = text.split("Compose a haiku about TypeScript").length - 1;
    assert.equal(promptOccurrences, 1, `expected exactly 1 provider call, prompt occurs ${promptOccurrences} times`);
  });

  // ── No session / no registry / no event directory ──────────────────

  it("no session events for direct requests", async () => {
    const messages = await submitRequest(
      socketPath,
      { command: "direct", task: "1 + 1", requestId: "req_no_session" },
      ["direct.completed"],
    );
    const types = messages.map((m) => m.type);
    for (const forbidden of [
      "session.started",
      "session.ended",
      "task.accepted",
      "task.completed",
      "task.created",
      "task.cancelled",
    ]) {
      assert.ok(
        !types.includes(forbidden),
        `direct path must not emit ${forbidden}, got ${types.join(",")}`,
      );
    }
  });

  it("no .alix/sessions or .alix/plans directories created for direct requests", async () => {
    await submitRequest(
      socketPath,
      { command: "direct", task: "3 + 4", requestId: "req_no_dirs" },
      ["direct.completed"],
    );
    await new Promise((r) => setTimeout(r, 100));
    const alixDir = join(tmpDir, ".alix");
    assert.ok(existsSync(alixDir), ".alix should exist (config.json lives there)");
    const entries = readdirSync(alixDir);
    assert.ok(
      !entries.includes("sessions") || readdirSync(join(alixDir, "sessions")).length === 0,
      ".alix/sessions must not be created (or must be empty) for direct requests",
    );
    assert.ok(
      !entries.includes("plans"),
      ".alix/plans must not be created for direct requests",
    );
  });

  it("HOME-isolated TaskRegistry has no entry for direct requests", async () => {
    // Send a direct request, then directly inspect the daemon's
    // HOME-isolated registry file. The daemon writes to
    // `~/.alix/daemon-tasks.json` (= homeDir/.alix/daemon-tasks.json).
    //
    // Before: capture the registry (likely absent or empty).
    const before = existsSync(registryPath)
      ? readFileSync(registryPath, "utf8")
      : "[]";

    await submitRequest(
      socketPath,
      { command: "direct", task: "5 + 5", requestId: "req_no_registry" },
      ["direct.completed"],
    );

    // Give the daemon's serialised enqueueSave a moment to flush
    // (in case anything was queued). It shouldn't have written
    // anything for the direct request.
    await new Promise((r) => setTimeout(r, 250));

    const after = existsSync(registryPath)
      ? readFileSync(registryPath, "utf8")
      : "[]";

    // The registry file should be byte-identical (or completely absent)
    // before and after the direct request. If anything were written, it
    // would mean `registry.create()` was called.
    assert.equal(
      after,
      before,
      `registry file must not change for direct requests.\nbefore=${before}\nafter=${after}`,
    );

    // Belt-and-braces: if the file exists, parse it and assert zero
    // entries whose id starts with "req_" (the direct path's requestId
    // prefix). The TaskRegistry generates `task_<ts>_<rand>` ids, so
    // any "req_..." id would be a leak.
    if (existsSync(registryPath)) {
      const parsed = JSON.parse(after);
      assert.ok(Array.isArray(parsed), "registry must be a JSON array");
      const directLeaks = parsed.filter(
        (t: any) => typeof t?.id === "string" && t.id.startsWith("req_"),
      );
      assert.deepEqual(
        directLeaks,
        [],
        `no TaskRegistry entries may have a direct-path requestId (req_*); got ${JSON.stringify(directLeaks)}`,
      );
    }
  });

  // ── Direct command still works (retained as a non-production path) ─

  it("explicit `direct` command still works for callers that supply requestId", async () => {
    const messages = await submitRequest(
      socketPath,
      { command: "direct", task: "(10 * 4) / 5", requestId: "req_explicit" },
      ["direct.completed"],
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0].requestId, "req_explicit");
    assert.equal(messages[1].requestId, "req_explicit");
    assert.equal(messages[1].text, "8");
  });

  it("non-direct routes via the explicit `direct` command are rejected ephemerally", async () => {
    const messages = await submitRequest(
      socketPath,
      { command: "direct", task: "ls -la", requestId: "req_not_direct" },
      ["direct.completed"],
    );
    const types = messages.map((m) => m.type);
    for (const t of types) {
      assert.ok(!t.startsWith("session."), `non-direct route must not emit ${t}, got ${types.join(",")}`);
    }
    const completed = messages.find((m) => m.type === "direct.completed");
    assert.ok(completed, "expected direct.completed");
    assert.equal(completed.requestId, "req_not_direct");
    assert.match(completed.text, /error|tool|not direct|not eligible/i);
  });

  // ── Production path: `run` command classified server-side ──────────

  it("`run` command with arithmetic input classifies first and emits only direct frames", async () => {
    // PRODUCTION PATH: client sends a `run` command WITHOUT a route.
    // The daemon classifies internally and uses the direct fast path
    // because the route is direct.
    const messages = await submitRequest(
      socketPath,
      { command: "run", task: "2 + 2", cwd: cwd },
      ["direct.completed", "session.ended"],
    );
    const types = messages.map((m) => m.type);
    // The daemon may take either terminal path depending on classification.
    // For "2 + 2" the classification is `direct`, so we expect direct frames.
    assert.ok(
      types.includes("direct.completed"),
      `expected direct.completed for arithmetic run, got ${types.join(",")}`,
    );
    assert.ok(
      !types.includes("session.started"),
      `arithmetic run must not create a session, got ${types.join(",")}`,
    );
    assert.ok(
      !types.includes("task.created"),
      `arithmetic run must not touch the registry, got ${types.join(",")}`,
    );
    const completed = messages.find((m) => m.type === "direct.completed");
    assert.equal(completed.text, "4");
  });

  it("`run` command with non-direct input preserves the full session lifecycle", async () => {
    // PRODUCTION PATH: non-direct prompt (a workspace action).
    // The daemon must classify it as `agent` and take the lifecycle
    // path. The direct fast path must NOT be applied here.
    const messages = await submitRequest(
      socketPath,
      { command: "run", task: "Find SQL usage in my repo", cwd: cwd },
      ["direct.completed", "session.ended"],
      // give it more time — agent path is slower
      // 5s safety net will release us anyway
    );
    const types = messages.map((m) => m.type);
    assert.ok(types.includes("session.started"), `workspace run must emit session.started, got ${types.join(",")}`);
    assert.ok(!types.includes("direct.completed"), `workspace run must NOT take the direct path, got ${types.join(",")}`);
  });

  it("regression guard: regular tool run still emits the full session lifecycle", async () => {
    // Pre-existing tool-route behaviour must be preserved.
    const messages = await submitRequest(
      socketPath,
      {
        command: "run",
        task: "echo regression",
        cwd: cwd,
        route: { kind: "tool", tool: "shell.run", args: { command: "echo regression" } },
      },
      ["session.ended"],
    );
    const types = messages.map((m) => m.type);
    assert.ok(types.includes("session.started"), "regular run must still emit session.started");
    assert.ok(types.includes("task.completed"), "regular run must still emit task.completed");
    assert.ok(types.includes("session.ended"), "regular run must still emit session.ended");
    assert.ok(!types.includes("direct.completed"), "regular run must not emit direct.completed");
  });
});