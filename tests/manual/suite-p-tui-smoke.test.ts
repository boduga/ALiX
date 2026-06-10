/**
 * suite-p-tui-smoke.test.ts — Automated TUI smoke tests.
 *
 * Sends keystrokes to alix tui and checks output.
 * Each test uses a short timeout to prevent hanging.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function runTui(input: string, args: string[] = [], timeout = 8000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn("node", ["dist/src/cli.js", "tui", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); resolve({ stdout, stderr, code: null }); }, timeout);
    proc.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

describe("TUI smoke", () => {
  it("shows welcome text in direct mode", async () => {
    const { stdout } = await runTui("", []);
    assert.ok(stdout.includes("ALiX TUI"), `Expected welcome, got: ${stdout.slice(0, 100)}`);
    assert.ok(stdout.includes("Execution mode: direct"), `Expected direct mode, got: ${stdout.slice(0, 100)}`);
  });

  it("shows help on ? input", async () => {
    const { stdout } = await runTui("?\n", []);
    assert.ok(stdout.includes("Commands:") || stdout.includes("Panels:"), `Expected help text, got: ${stdout.slice(0, 200)}`);
  });

  it("accepts --mode bypass", async () => {
    const { stdout } = await runTui("", ["--mode", "bypass"]);
    assert.ok(stdout.includes("bypass"), `Expected bypass mode, got: ${stdout.slice(0, 100)}`);
  });

  it("daemon mode shows error when not running", async () => {
    const { stdout, stderr } = await runTui("", ["--daemon"]);
    const combined = stdout + stderr;
    assert.ok(combined.includes("Daemon is not running") || combined.includes("ERROR"), `Expected daemon error, got: ${combined.slice(0, 200)}`);
  });

  it("cycles panels on Tab", async () => {
    const { stdout } = await runTui("\t\n", []);
    assert.ok(stdout.includes("daemon") || stdout.includes("Panel:"), `Expected panel cycle, got: ${stdout.slice(0, 200)}`);
  });

  it("renders daemon panel on Enter after Tab", async () => {
    const { stdout } = await runTui("\t\n\n", []);
    assert.ok(stdout.includes("Daemon") || stdout.includes("Status"), `Expected daemon panel, got: ${stdout.slice(0, 200)}`);
  });
});
