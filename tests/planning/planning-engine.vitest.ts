// tests/planning/planning-engine.vitest.ts
//
// P11.3 — PlanningEngine orchestrator tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, rmdirSync, mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RootCauseStore } from "../../src/reasoning/root-cause-store.js";
import { StrategicPlanStore } from "../../src/planning/strategic-plan-store.js";
import { PlanningEngine } from "../../src/planning/planning-engine.js";
import type { RootCauseAnalysis } from "../../src/reasoning/reasoning-types.js";
import { PlanningEngineError } from "../../src/planning/planning-types.js";
import { DEFAULT_PLANNING_CONFIG } from "../../src/planning/planning-config.js";

function makeAnalysis(overrides?: Partial<RootCauseAnalysis>): RootCauseAnalysis {
  return {
    schemaVersion: "p11.2.0",
    analysisId: "reason-test-1",
    generatedAt: "2026-07-03T12:00:00.000Z",
    correlationGraphId: "abc123",
    status: "ok",
    findings: [],
    meta: { totalSubsystemsExamined: 8, degradedSubsystems: 0, totalEdgesAnalyzed: 0 },
    ...overrides,
  };
}

function makeDir(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `p11-3-${name}-`));
  return d;
}

function cleanDir(dir: string): void {
  try {
    const files = ["strategic-plans.jsonl", "root-causes.jsonl"];
    for (const f of files) {
      try { unlinkSync(join(dir, f)); } catch { /* ok */ }
    }
    rmdirSync(dir);
  } catch { /* ok */ }
}

describe("PlanningEngine", () => {
  let reasoningDir: string;
  let planningDir: string;

  beforeEach(() => {
    reasoningDir = makeDir("reasoning");
    planningDir = makeDir("planning");
  });

  afterEach(() => {
    cleanDir(reasoningDir);
    cleanDir(planningDir);
  });

  // T19: run returns plan when analysis exists
  it("returns a plan when a root cause analysis exists", async () => {
    const rootStore = new RootCauseStore(reasoningDir);
    const planStore = new StrategicPlanStore(planningDir);
    const analysis = makeAnalysis({
      analysisId: "reason-test-run",
      status: "no_degradation",
    });
    await rootStore.save(analysis);

    const engine = new PlanningEngine(rootStore, planStore, DEFAULT_PLANNING_CONFIG);
    const plan = await engine.run();
    expect(plan).toBeDefined();
    expect(plan.rootCauseAnalysisId).toBe("reason-test-run");
    expect(plan.status).toBe("no_degradation");
  });

  // T20: run throws when no analysis
  it("throws PlanningEngineError when no analysis exists", async () => {
    const rootStore = new RootCauseStore(reasoningDir);
    const planStore = new StrategicPlanStore(planningDir);
    const engine = new PlanningEngine(rootStore, planStore, DEFAULT_PLANNING_CONFIG);
    await expect(engine.run()).rejects.toThrow(PlanningEngineError);
  });

  // T21: loadLatest returns null when empty
  it("loadLatest returns null when no plans exist", async () => {
    const rootStore = new RootCauseStore(reasoningDir);
    const planStore = new StrategicPlanStore(planningDir);
    const engine = new PlanningEngine(rootStore, planStore, DEFAULT_PLANNING_CONFIG);
    const result = await engine.loadLatest();
    expect(result).toBeNull();
  });
});
