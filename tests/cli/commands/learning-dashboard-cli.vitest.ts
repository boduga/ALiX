/**
 * P8.5b.3 — CLI integration tests for `alix learning dashboard`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleLearningCommand } from "../../../src/cli/commands/learning.js";
import { OutcomeStore } from "../../../src/adaptation/outcome-store.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "db-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});
afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("alix learning dashboard CLI", () => {
  it("renders dashboard with empty stores", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleLearningCommand(["dashboard"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("LEARNING DASHBOARD");
    expect(output).toContain("EXPLANATION INTEGRITY");
    expect(output).toContain("CHAIN INTEGRITY");
    log.mockRestore();
  });

  it("outputs valid JSON with --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // Seed one OutcomeRecord so we get a non-zero report
    const os = new OutcomeStore(join(tempRoot, ".alix", "adaptation", "outcomes"));
    await os.append({
      id: "out-1",
      subject: "x",
      outcome: "success",
      reasons: [],
      generatedAt: new Date().toISOString(),
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "a",
      observationWindowDays: 7,
    } as any);
    await handleLearningCommand(["dashboard", "--json"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe("p8.5b.0");
    expect(parsed.explanationIntegrity).toBeDefined();
    expect(parsed.calibrationHealth).toBeDefined();
    expect(parsed.chainAlerts).toBeDefined();
    log.mockRestore();
  });

  it("errors on invalid --window", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await handleLearningCommand(["dashboard", "--window", "abc"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    err.mockRestore();
    exit.mockRestore();
  });
});
