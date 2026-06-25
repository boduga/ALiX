/**
 * P10.5a — Executive evaluate CLI integration tests.
 *
 * Verifies the `alix executive evaluate <planId> [--json]` subcommand.
 * Creates real plan files, state files, and trend snapshots on disk,
 * then exercises the CLI dispatcher with mocked cwd.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { handleExecutiveCommand } from "../../../src/cli/commands/executive.js";
import type { PersistedExecutionPlan } from "../../../src/executive/executive-plan-types.js";
import type { PlanExecutionState } from "../../../src/executive/executive-plan-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Compute the contentHash for a plan JSON object the same way PlanStore does:
 * strip contentHash, serialize the remainder, SHA-256 it.
 */
function computePlanHash(plan: Record<string, unknown>): string {
  const { contentHash: _, ...content } = plan;
  return sha256(JSON.stringify(content));
}

function writePlan(dir: string, plan: Record<string, unknown>): void {
  const hash = computePlanHash(plan);
  const full = { ...plan, contentHash: hash };
  writeFileSync(join(dir, `${plan.id}.json`), JSON.stringify(full, null, 2), "utf-8");
}

function writeState(dir: string, state: PlanExecutionState): void {
  writeFileSync(
    join(dir, `${state.planId}-state.json`),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

function writeTrends(dir: string, snapshots: Record<string, unknown>[]): void {
  const lines = snapshots.map(s => JSON.stringify(s)).join("\n");
  writeFileSync(join(dir, "trends.jsonl"), lines + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Console capture helpers
// ---------------------------------------------------------------------------

function captureConsole() {
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

function mockExit() {
  const spy = vi.spyOn(process, "exit").mockImplementation((_code?: string | number | null) => {
    throw new Error(`process.exit(${_code})`);
  });
  return { spy, restore: () => spy.mockRestore() };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCompletedPlan(planId: string): Record<string, unknown> {
  return {
    id: planId,
    objectives: ["stabilize-workflow"],
    steps: [
      {
        id: "step-obj-1-workflow-diagnose_root_cause",
        stepNumber: 1,
        title: "Diagnose root causes",
        action: "diagnose_root_cause",
        objectiveId: "stabilize-workflow",
        targetSubsystem: "workflow",
        riskLevel: "high",
        priorityScore: 80,
        objectiveScore: 75,
        status: "pending",
        dependsOn: [],
        estimatedDurationMinutes: 30,
      },
      {
        id: "step-obj-1-workflow-create_remediation_proposal",
        stepNumber: 2,
        title: "Create remediation proposal",
        action: "create_remediation_proposal",
        objectiveId: "stabilize-workflow",
        targetSubsystem: "workflow",
        riskLevel: "high",
        priorityScore: 80,
        objectiveScore: 75,
        status: "pending",
        dependsOn: ["step-obj-1-workflow-diagnose_root_cause"],
        estimatedDurationMinutes: 45,
      },
      {
        id: "step-obj-1-workflow-apply_remediation",
        stepNumber: 3,
        title: "Apply remediation",
        action: "apply_remediation",
        objectiveId: "stabilize-workflow",
        targetSubsystem: "workflow",
        riskLevel: "high",
        priorityScore: 80,
        objectiveScore: 75,
        status: "pending",
        dependsOn: ["step-obj-1-workflow-create_remediation_proposal"],
        estimatedDurationMinutes: 60,
      },
    ],
    generatedAt: "2026-06-10T00:00:00.000Z",
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
  };
}

function makeCompletedState(planId: string): PlanExecutionState {
  return {
    planId,
    status: "completed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: {
      createdAt: "2026-06-10T00:00:00.000Z",
      completedAt: "2026-06-15T00:00:00.000Z",
    },
  };
}

function makePlanState(planId: string, status: PlanExecutionState["status"]): PlanExecutionState {
  return {
    planId,
    status,
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: "2026-06-10T00:00:00.000Z" },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "eval-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executive evaluate CLI", () => {
  it("outputs evaluation table for completed plan with data", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("test-plan-1"));
    writeState(plansDir, makeCompletedState("test-plan-1"));
    writeTrends(execDir, [
      {
        id: "baseline-snap",
        generatedAt: "2026-06-09T00:00:00.000Z",
        windowDays: 7,
        subsystemScores: { workflow: 45, governance: 70, learning: 80 },
      },
      {
        id: "current-snap",
        generatedAt: "2026-06-15T00:00:00.000Z",
        windowDays: 7,
        subsystemScores: { workflow: 72, governance: 75, learning: 82 },
      },
    ]);

    const exit = mockExit();
    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "test-plan-1"]);

    expect(exit.spy).not.toHaveBeenCalled();
    const output = c.out().join("\n");
    expect(output).toContain("test-plan-1");
    expect(output).toContain("completed");
    expect(output).toContain("improved");
    expect(output).toContain("+27");

    exit.restore();
    c.restore();
  });

  it("outputs JSON when --json flag passed", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("test-plan-2"));
    writeState(plansDir, makeCompletedState("test-plan-2"));
    writeTrends(execDir, [
      {
        id: "baseline-snap",
        generatedAt: "2026-06-09T00:00:00.000Z",
        windowDays: 7,
        subsystemScores: { workflow: 40 },
      },
      {
        id: "current-snap",
        generatedAt: "2026-06-15T00:00:00.000Z",
        windowDays: 7,
        subsystemScores: { workflow: 80 },
      },
    ]);

    const exit = mockExit();
    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "test-plan-2", "--json"]);

    expect(exit.spy).not.toHaveBeenCalled();
    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("completed");
    expect(parsed.planId).toBe("test-plan-2");

    exit.restore();
    c.restore();
  });

  it("shows error when planId is missing", async () => {
    const exit = mockExit();
    const c = captureConsole();

    await expect(handleExecutiveCommand(["evaluate"]))
      .rejects.toThrow("process.exit");
    expect(c.err().join("")).toContain("Usage");

    exit.restore();
    c.restore();
  });

  it("returns plan_not_found JSON when plan does not exist", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    mkdirSync(join(execDir, "plans"), { recursive: true });

    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "nonexistent-plan", "--json"]);

    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("plan_not_found");
    expect(parsed.planId).toBe("nonexistent-plan");
    expect(parsed.warnings.length).toBeGreaterThan(0);

    c.restore();
  });

  it("shows plan_not_executed for a draft plan", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("draft-plan"));
    writeState(plansDir, makePlanState("draft-plan", "draft"));

    const exit = mockExit();
    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "draft-plan", "--json"]);

    expect(exit.spy).not.toHaveBeenCalled();
    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("plan_not_executed");

    exit.restore();
    c.restore();
  });

  it("shows insufficient_data when no trend snapshots exist", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("no-trend-plan"));
    writeState(plansDir, makeCompletedState("no-trend-plan"));
    // Do NOT create trends.jsonl

    const exit = mockExit();
    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "no-trend-plan", "--json"]);

    expect(exit.spy).not.toHaveBeenCalled();
    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("insufficient_data");

    exit.restore();
    c.restore();
  });

  it("returns plan_not_found JSON on contentHash mismatch", async () => {
    const plansDir = join(tempRoot, ".alix", "executive", "plans");
    mkdirSync(plansDir, { recursive: true });

    // Write a plan file with wrong contentHash
    const planData = { id: "tampered-plan", steps: [], contentHash: "0".repeat(64) };
    writeFileSync(join(plansDir, "tampered-plan.json"), JSON.stringify(planData), "utf-8");

    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "tampered-plan", "--json"]);

    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("plan_not_found");
    expect(parsed.planId).toBe("tampered-plan");
    expect(parsed.warnings.length).toBeGreaterThan(0);

    c.restore();
  });

  it("returns plan_not_found JSON when state file is missing", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("no-state-plan"));
    // Do NOT create state file

    const c = captureConsole();

    await handleExecutiveCommand(["evaluate", "no-state-plan", "--json"]);

    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("plan_not_found");
    expect(parsed.planId).toBe("no-state-plan");
    expect(parsed.warnings.length).toBeGreaterThan(0);

    c.restore();
  });
});
