// tests/reasoning/executive-reason-handler.vitest.ts
//
// P11.2 — CLI handler tests for `alix executive reason`.
// Uses vi.spyOn to capture console output and mock process.exit to throw,
// so we can verify error paths without stdout pollution.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleReasonCommand } from "../../src/cli/commands/executive-reason-handler.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIG_CWD = process.cwd;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("executive reason CLI handler", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "p11-2-cli-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempRoot as any);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("--latest without saved analysis prints message", async () => {
    await handleReasonCommand(["--latest"]);
    expect(console.log).toHaveBeenCalledWith(
      "No saved root cause analysis found.",
    );
  });

  it("default mode without correlation graph catches error", async () => {
    await expect(handleReasonCommand([])).rejects.toThrow("process.exit");
    expect(console.error).toHaveBeenCalled();
    const errorCall = (console.error as any).mock.calls[0][0];
    expect(errorCall).toContain("graph");
  });
});
