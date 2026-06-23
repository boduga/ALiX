/**
 * P8.5c.4 — `alix explain proposal` CLI tests.
 *
 * Covers the terminal + JSON renderers and the dispatcher validation:
 *   1. Empty stores → terminal output contains the integrity footer + 0/6.
 *   2. `--json` → valid JSON matching ProposalExplanation shape.
 *   3. Empty stores → refresh hint rendered.
 *   4. Missing proposal id → error + exit(1).
 *   5. Unknown subcommand → error + exit(1).
 *
 * Uses temp-dir + vi.spyOn(process, "cwd") so the assembler reads empty
 * stores. The CLI itself is read-only; these tests assert rendering only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleExplainCommand } from "../../../src/cli/commands/explain.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "explain-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // Throw on exit so the error path terminates (and we can assert exit code).
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number | string | null) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function terminalOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

describe("alix explain proposal — CLI", () => {
  it("empty stores: terminal output shows all layers not available + integrity footer", async () => {
    await handleExplainCommand(["proposal", "prop-1"]);

    const output = terminalOutput();
    expect(output).toContain("Outcome");
    expect(output).toContain("not available");
    expect(output).toContain("Explanation Integrity");
    expect(output).toContain("0/6 layers available");
  });

  it("--json: prints valid JSON matching ProposalExplanation contract", async () => {
    await handleExplainCommand(["proposal", "prop-1", "--json"]);

    const output = terminalOutput();
    const parsed = JSON.parse(output);
    expect(parsed.proposalId).toBe("prop-1");
    expect(parsed.explanationIntegrity.totalLayers).toBe(6);
    // Assert the full contract shape that P8.5b Dashboard will consume:
    expect(parsed.explanationIntegrity.completenessPercent).toBe(0);
    expect(parsed.outcome).toHaveProperty("status");
    expect(parsed.recommendation).toHaveProperty("status");
    expect(parsed.risk).toHaveProperty("status");
    expect(parsed.governance).toHaveProperty("status");
    expect(parsed.learning).toHaveProperty("signalsByAdapter");
    expect(parsed.learning).toHaveProperty("totalSignals");
    expect(parsed.calibration).toHaveProperty("profilesByTarget");
    expect(parsed.calibration).toHaveProperty("adjustments");
    expect(parsed.learningRefreshHint).not.toBeNull();
  });

  it("empty stores: refresh hint rendered when Learning layer empty", async () => {
    await handleExplainCommand(["proposal", "prop-1"]);

    const output = terminalOutput();
    expect(output).toContain("learning refresh");
  });

  it("missing proposal id: errors and exits non-zero", async () => {
    let capturedExit: Error | undefined;
    try {
      await handleExplainCommand(["proposal"]);
    } catch (err) {
      capturedExit = err as Error;
    }

    expect(errorSpy).toHaveBeenCalled();
    expect(capturedExit?.message).toBe("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("unknown subcommand: errors and exits non-zero", async () => {
    let capturedExit: Error | undefined;
    try {
      await handleExplainCommand(["bogus"]);
    } catch (err) {
      capturedExit = err as Error;
    }

    expect(errorSpy).toHaveBeenCalled();
    expect(capturedExit?.message).toBe("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
