/**
 * P10.5b — Executive outcomes CLI integration tests.
 * Tests `alix executive outcomes list` and `alix executive outcomes show`.
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleExecutiveCommand } from "../../../src/cli/commands/executive.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); errSpy.mockRestore(); } };
}

function mockExit() {
  const spy = vi.spyOn(process, "exit").mockImplementation((_code?: any) => {
    throw new Error(`process.exit(${_code})`);
  });
  return { spy, restore: () => spy.mockRestore() };
}

function makeReport(planId: string, generatedAt: string, delta: number, status: string) {
  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId,
    planStatus: "completed" as const,
    evaluationStatus: status as any,
    evaluatedSubsystems: ["workflow"],
    objectives: [],
    overallDelta: delta,
    warnings: [],
  };
}

describe("executive outcomes CLI", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "outcomes-cli-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("outcomes list shows saved reports", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    store.save(makeReport("plan-a", "2026-06-26T10:00:00.000Z", 40, "completed") as any);
    store.save(makeReport("plan-b", "2026-06-25T10:00:00.000Z", -10, "degraded") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "list"]);
    const output = c.out().join("\n");
    expect(output).toContain("plan-a");
    expect(output).toContain("plan-b");
    expect(output).toContain("+40");
    expect(output).toContain("-10");
    c.restore();
  });

  it("outcomes list empty", async () => {
    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "list"]);
    expect(c.out().join("")).toContain("No outcome reports");
    c.restore();
  });

  it("outcomes list --json returns structured data", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    store.save(makeReport("plan-a", "2026-06-26T10:00:00.000Z", 40, "completed") as any);
    store.save(makeReport("plan-b", "2026-06-25T10:00:00.000Z", 0, "plan_not_executed") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "list", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].planId).toBe("plan-a");
    expect(parsed[1].evaluationStatus).toBe("plan_not_executed");
    c.restore();
  });

  it("outcomes show loads and renders a report", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    const id = store.save(makeReport("show-me", "2026-06-26T10:00:00.000Z", 50, "completed") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "show", id]);
    const output = c.out().join("\n");
    expect(output).toContain("show-me");
    expect(output).toContain("+50");
    c.restore();
  });

  it("outcomes show --json returns full report", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    const id = store.save(makeReport("json-show", "2026-06-26T10:00:00.000Z", 30, "completed") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "show", id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.planId).toBe("json-show");
    expect(parsed.overallDelta).toBe(30);
    c.restore();
  });

  it("outcomes show missing report exits with error", async () => {
    const exit = mockExit();
    const c = captureConsole();
    await expect(handleExecutiveCommand(["outcomes", "show", "nonexistent"])).rejects.toThrow("process.exit");
    expect(c.err().join("")).toContain("not found");
    exit.restore();
    c.restore();
  });
});
