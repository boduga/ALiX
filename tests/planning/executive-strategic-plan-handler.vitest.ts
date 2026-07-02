// tests/planning/executive-strategic-plan-handler.vitest.ts
//
// P11.3 — CLI handler tests for `alix executive strategic-plan`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, rmdirSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We'll test the handler by mocking process.cwd() to a temp dir.
// For simplicity, test the two code paths through the store directly.

describe("handleStrategicPlanCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "p11-3-handler-test-"));
  });

  afterEach(() => {
    try {
      const files = ["strategic-plans.jsonl", "root-causes.jsonl"];
      for (const f of files) {
        try { unlinkSync(join(tmpDir, f)); } catch { /* ok */ }
      }
      rmdirSync(tmpDir);
    } catch { /* ok */ }
  });

  // T22: --latest without saved plan prints message
  it("prints helpful message when --latest is used without saved data", async () => {
    // Hide console.log output during test
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    // Simulate by calling the handler directly via dynamic import
    // We need to mock process.cwd to return our temp dir
    const originalCwd = process.cwd;
    process.cwd = () => tmpDir;

    try {
      const { handleStrategicPlanCommand } = await import(
        "../../src/cli/commands/executive-strategic-plan-handler.js"
      );
      await handleStrategicPlanCommand(["--latest"]);

      expect(spy).toHaveBeenCalledWith("No saved strategic plan found.");
    } finally {
      process.cwd = originalCwd;
      spy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  // T23: Default mode runs and prints summary
  it("runs the engine and prints a summary", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const originalCwd = process.cwd;
    process.cwd = () => tmpDir;

    try {
      // First save a root cause analysis so the engine has data
      const { RootCauseStore } = await import("../../src/reasoning/root-cause-store.js");
      const rootStore = new RootCauseStore(join(tmpDir, ".alix", "reasoning"));
      await rootStore.save({
        schemaVersion: "p11.2.0",
        analysisId: "reason-test-handler",
        generatedAt: "2026-07-03T12:00:00.000Z",
        correlationGraphId: "abc123",
        status: "no_degradation",
        findings: [],
        meta: { totalSubsystemsExamined: 8, degradedSubsystems: 0, totalEdgesAnalyzed: 0 },
      });

      const { handleStrategicPlanCommand } = await import(
        "../../src/cli/commands/executive-strategic-plan-handler.js"
      );
      await handleStrategicPlanCommand([]);

      // Should have printed at least the header
      const calls = spy.mock.calls.map((c: string[]) => c[0]);
      expect(calls.some((c: string) => c.includes("Strategic Plan"))).toBe(true);
    } finally {
      process.cwd = originalCwd;
      spy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
