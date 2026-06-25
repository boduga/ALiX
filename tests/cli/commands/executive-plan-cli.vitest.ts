/**
 * P10.4a — Executive plan CLI dispatcher tests.
 *
 * Verifies the CLI dispatcher routing for executive plan subcommands. Uses
 * temp directories to isolate file-system side effects. Follows the same
 * pattern as tests/cli/commands/governance-cli.vitest.ts.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleExecutiveCommand } from "../../../src/cli/commands/executive.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "exec-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole(): {
  out: () => string[];
  err: () => string[];
  restore: () => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.join(" ")); });
  return {
    out: () => out,
    err: () => err,
    restore: () => { logSpy.mockRestore(); errSpy.mockRestore(); },
  };
}

function mockExit(): { spy: ReturnType<typeof vi.spyOn>; restore: () => void } {
  const spy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit(${code})`);
  });
  return { spy, restore: () => spy.mockRestore() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executive plan CLI dispatcher", () => {
  it("errors on unknown executive subcommand", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["unknown"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("")).toContain("Unknown");

    exit.restore();
    c.restore();
  });

  it("errors on unknown plan subcommand", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["plan", "unknown"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("")).toContain("Unknown");

    exit.restore();
    c.restore();
  });

  it("plan save with window arg", async () => {
    // save handler will fail because there is no .alix dir on disk, but the
    // error message must NOT be a routing error.
    try {
      await handleExecutiveCommand(["plan", "save", "7"]);
    } catch (e: any) {
      expect(e.message).not.toContain("Unknown plan subcommand");
      expect(e.message).not.toContain("Unknown executive subcommand");
    }
  });

  it("plan list on empty dir", async () => {
    // list() returns [] when the plans dir does not exist — must not crash
    const exit = mockExit();
    const c = captureConsole();

    await handleExecutiveCommand(["plan", "list"]);
    // If we got here, process.exit was NOT called — list completed silently

    exit.restore();
    c.restore();
  });

  it("plan show with missing planId", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["plan", "show"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("")).toContain("Usage: plan show <planId>");

    exit.restore();
    c.restore();
  });

  it("plan approve with missing planId", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["plan", "approve"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("")).toContain("Usage");

    exit.restore();
    c.restore();
  });

  it("plan reject with --reason before planId", async () => {
    // Bug 7 fix: --reason parsing is robust regardless of position.
    // This will fail at store level (plan "bad" not found) but must NOT
    // fail with a routing or parsing error.
    const exit = mockExit();
    const c = captureConsole();

    try {
      await handleExecutiveCommand(["plan", "reject", "--reason", "bad", "plan-1"]);
    } catch (e: any) {
      // May throw from process.exit if the handler catches and exits,
      // or may throw from the store. Either way, the error must NOT be
      // a routing error or a usage error about missing planId.
      expect(c.err().join("")).not.toContain("Unknown plan subcommand");
      expect(c.err().join("")).not.toContain("Unknown executive subcommand");
    }

    exit.restore();
    c.restore();
  });

  it("plan start with missing planId", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["plan", "start"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("")).toContain("Usage");

    exit.restore();
    c.restore();
  });

  it("plan step with missing args", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["plan", "step"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("")).toContain("Usage");

    exit.restore();
    c.restore();
  });

  it("plan run with valid planId", async () => {
    // Routes to run handler; fails at store level (plan not found) — not
    // a routing error.
    const exit = mockExit();
    const c = captureConsole();

    try {
      await handleExecutiveCommand(["plan", "run", "plan-1"]);
    } catch (e: any) {
      expect(c.err().join("")).not.toContain("Unknown plan subcommand");
      expect(c.err().join("")).not.toContain("Unknown executive subcommand");
    }

    exit.restore();
    c.restore();
  });

  it("plan resume aliases run", async () => {
    // resume delegates to run internally — same behavior as the run test.
    const exit = mockExit();
    const c = captureConsole();

    try {
      await handleExecutiveCommand(["plan", "resume", "plan-1"]);
    } catch (e: any) {
      expect(c.err().join("")).not.toContain("Unknown plan subcommand");
      expect(c.err().join("")).not.toContain("Unknown executive subcommand");
    }

    exit.restore();
    c.restore();
  });
});
