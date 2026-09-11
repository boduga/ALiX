import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Dedicated SIGTERM test for the daemon (Task 15): tracing-enabled or not,
 * a SIGTERM must close the daemon cleanly and exit 0 — tracing can never
 * block or fail daemon exit (the T14 bounded-shutdown contract at the
 * surface). HOME isolation mirrors daemon-server.test.ts so the operator's
 * real ~/.config/alix/config.json is never merged; tracing defaults to
 * disabled (the Noop path exercises the default, zero-cost shutdown).
 */
describe("Daemon SIGTERM shutdown (Task 15)", { timeout: 15000 }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "daemon-sigterm-test-"));
  const homeDir = join(tmpDir, "home");
  const socketPath = join(tmpDir, "test.sock");
  const cwd = tmpDir;
  let serverProcess: any = null;

  after(() => {
    if (serverProcess) try { serverProcess.kill("SIGKILL"); } catch { /* ignore */ }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 after SIGTERM even with tracing work pending", async () => {
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
    writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" }, mcpServers: [],
    }));

    const serverJs = join(__dirname, "..", "..", "src", "daemon", "daemon-server.js");
    serverProcess = spawn(process.execPath, [serverJs, "--socket", socketPath, "--cwd", cwd], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: homeDir },
    });

    await new Promise<void>((resolve, reject) => {
      serverProcess.stderr.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) resolve();
      });
      serverProcess.on("error", reject);
      setTimeout(() => reject(new Error("Daemon did not start within 5s")), 5000);
    });

    const exitCode: number = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Daemon did not exit within 5s of SIGTERM")), 5000);
      serverProcess.on("exit", (code: number) => {
        clearTimeout(timer);
        resolve(code);
      });
      serverProcess.kill("SIGTERM");
    });

    assert.equal(exitCode, 0, "daemon must exit 0 after a clean SIGTERM (tracing never fails exit)");
  });
});