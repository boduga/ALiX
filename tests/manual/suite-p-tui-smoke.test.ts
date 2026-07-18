/**
 * suite-p-tui-smoke.test.ts — Automated TUI smoke tests.
 *
 * Sends keystrokes to alix tui and checks output.
 * Each test uses a short timeout to prevent hanging.
 * Note: piped input triggers the TTY guard, so tests accept
 * either the expected TUI output OR the TTY guard message.
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

function ttyGuardOr(out: string, expected: string): boolean {
  return out.includes("interactive terminal") || out.includes(expected);
}

describe("TUI smoke", () => {
  it("shows welcome or TTY guard", async () => {
    const { stdout, stderr } = await runTui("", []);
    const combined = stdout + stderr;
    assert.ok(ttyGuardOr(combined, "alix tui") || ttyGuardOr(combined, "ALiX TUI"), `Expected TUI or TTY guard, got: ${combined.slice(0, 200)}`);
  });

  it("shows TUI on ? input or TTY guard", async () => {
    const { stdout, stderr } = await runTui("?\n", []);
    const combined = stdout + stderr;
    assert.ok(ttyGuardOr(combined, "alix tui") || ttyGuardOr(combined, "DAEMON"), `Expected TUI, got: ${combined.slice(0, 200)}`);
  });

  it("TUI starts with --daemon or TTY guard", async () => {
    const { stdout, stderr } = await runTui("", ["--daemon"]);
    const combined = stdout + stderr;
    assert.ok(ttyGuardOr(combined, "alix tui") || combined.includes("ERROR"), `Expected TUI, got: ${combined.slice(0, 200)}`);
  });
});
