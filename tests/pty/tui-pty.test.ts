/**
 * tui-pty.test.ts — Real-terminal regression test for the TUI hang.
 *
 * Spawns `alix tui` in a real PTY (via node-pty) and verifies that input
 * is actually delivered. Pre-fix, `process.stdin` stayed paused in TTY
 * mode and the `> ` prompt hung forever even though the TTY guard passed.
 *
 * Gated behind ALIX_PTY_TESTS=1 — node-pty needs a C++ build and is not
 * always available in CI containers. Run locally with:
 *
 *   ALIX_PTY_TESTS=1 npm run test:pty:tui
 *
 * or via the npm script:
 *   npm run test:pty:tui
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn as ptySpawn, type IPty, type IDisposable } from "node-pty";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ENABLED = process.env.ALIX_PTY_TESTS === "1";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve dist/src/cli.js relative to the repo root. After build this file
// lives at dist/tests/pty/tui-pty.test.js, so target is dist/src/cli.js
// (i.e. go up two levels from __dirname to dist/, then into src/cli.js).
const CLI = join(__dirname, "..", "..", "src", "cli.js");

const waitFor = (proc: IPty, needle: string, timeoutMs: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    let buf = "";
    let sub: IDisposable | null = null;
    const onData = (d: string) => {
      buf += d;
      if (buf.includes(needle)) {
        if (sub) { sub.dispose(); sub = null; }
        clearTimeout(timer);
        resolve(buf);
      }
    };
    sub = proc.onData(onData);
    const timer = setTimeout(() => {
      if (sub) { sub.dispose(); sub = null; }
      reject(new Error(`Timed out waiting for ${JSON.stringify(needle)} in:\n${buf}`));
    }, timeoutMs);
  });
};

describe("TUI PTY regression", { skip: !ENABLED }, () => {
  let proc: IPty | null = null;
  let exitSub: IDisposable | null = null;

  after(() => {
    if (exitSub) { try { exitSub.dispose(); } catch { /* ignore */ } exitSub = null; }
    if (proc) {
      try { proc.kill(); } catch { /* already dead */ }
      proc = null;
    }
  });

  it("accepts interactive input over a real PTY", async () => {
    if (!ENABLED) return; // double-guard if describe skip ever gets re-ordered

    const exitPromise = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
      proc = ptySpawn(process.execPath, [CLI, "tui", "--mode", "bypass"], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: { ...process.env, ALIX_TUI_TEST: "1", CI: "true" } as Record<string, string>,
      });
      exitSub = proc.onExit(({ exitCode, signal }) => resolve({ exitCode, signal }));
    });

    assert.ok(proc, "pty process must spawn");

    // 1. Wait for the welcome banner.
    await waitFor(proc!, "ALiX TUI", 10_000);

    // 2. Help command: `?` + Enter.
    proc!.write("?\r");
    const afterHelp = await waitFor(proc!, "Commands:", 5_000);
    assert.ok(afterHelp.includes("Commands:"), "expected help text 'Commands:' in output");

    // 3. Tab navigation — literal "tab" text. (A real \t keypress moves the
    //    cursor to the next tab stop in cooked mode and is not delivered to
    //    the readline `line` event, so the text fallback is the only path
    //    that fires in the TUI for tab navigation.)
    proc!.write("tab\r");
    const afterTabText = await waitFor(proc!, "Panel: ", 5_000);
    assert.ok(afterTabText.includes("Panel: "), "expected 'Panel: ' after literal 'tab'");

    // 4. Exit cleanly.
    proc!.write("exit\r");
    const { exitCode, signal } = await Promise.race([
      exitPromise,
      new Promise<{ exitCode: number; signal?: number }>((_, reject) =>
        setTimeout(() => reject(new Error("TUI did not exit within 5s of 'exit'")), 5_000)),
    ]);
    assert.ok(signal === undefined || signal === 0, `TUI killed by signal ${signal}`);
    assert.strictEqual(exitCode, 0, `TUI exited with code ${exitCode}`);
  });
});
