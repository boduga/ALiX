/**
 * P8.5a.2 fix #2 — CLI rejects invalid --adapter with a clean error.
 *
 * The CLI's own validation runs first (it sees the bad string before
 * constructing any stores), so it must emit the same error message the
 * orchestrator would throw. This guards the CLI layer even if the
 * orchestrator's defense-in-depth validation is later refactored.
 *
 * Note: the CLI uses `console.error` + `process.exit(1)`. We capture both
 * to assert the user-visible behavior end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleLearningCommand } from "../../../src/cli/commands/learning.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "learning-refresh-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("alix learning refresh — invalid --adapter (fix #2)", () => {
  it("rejects --adapter bogus: emits clean error and exits non-zero", async () => {
    const expectedError =
      'Invalid --adapter value: "bogus". Must be one of: recommendation | risk | governance | all.';
    let capturedExit: Error | undefined;
    try {
      await handleLearningCommand(["refresh", "--adapter", "bogus"]);
    } catch (err) {
      capturedExit = err as Error;
    }

    // CLI must call process.exit(1) on validation failure.
    expect(capturedExit?.message).toBe("process.exit(1)");

    // The user-visible error must include the offending value AND the
    // valid options list — defense against silent typos.
    const errorCalls = errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const combined = errorCalls.join("\n");
    expect(combined).toContain("Invalid --adapter value: \"bogus\"");
    expect(combined).toContain("recommendation | risk | governance | all");
  });
});