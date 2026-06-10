import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  const socketPath = join(tmpDir, "test.sock");
  const cwd = tmpDir;
  let serverProcess: any = null;

  before(() => {
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
    mkdirSync(join(tmpDir, ".alix", "sessions"), { recursive: true });
    writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" },
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
        client.write(JSON.stringify({ command: "run", task, route }) + "\n");
      });
      client.on("data", (data: Buffer) => {
        const chunk = data.toString("utf8");
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          messages.push(line);
          try {
            const msg = JSON.parse(line);
            if (msg.type === "session.ended") client.end();
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
      kind: "grounded_chat", prompt: "latest Node.js version", allowedTools: ["web.search"],
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
      client.write(JSON.stringify({ command: "run", task: "echo backward-compat" }) + "\n");
    });
    client.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        messages.push(line);
        try {
          const msg = JSON.parse(line);
          if (msg.type === "session.ended") client.end();
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
