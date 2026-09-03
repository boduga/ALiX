// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { runSingle, runHorizons } from "../benchmark/harness.js";
import { createScenario } from "../benchmark/scenario.js";
import { FakeExecutionEnvironment } from "../benchmark/fake-environment.js";
import { FakeModel } from "../benchmark/fake-model.js";
import { assembleContext } from "../benchmark/substrates.js";
import { REQUIRED_HORIZONS } from "../benchmark/types.js";

describe("benchmark harness — issue #628", () => {
  it("same seed deterministic byte-identical events", () => {
    const a = createScenario({ seed: 42, horizon: 50 });
    const b = createScenario({ seed: 42, horizon: 50 });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.decisionPoints)).toBe(JSON.stringify(b.decisionPoints));
  });

  it("different seed diverges", () => {
    const a = createScenario({ seed: 1, horizon: 50 });
    const b = createScenario({ seed: 2, horizon: 50 });
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });

  it("FakeModel isolates substrate — state-complete correct on C, evidence/history fails on C", () => {
    const scenario = createScenario({ seed: 11, horizon: 10 });
    const env = new FakeExecutionEnvironment(scenario);
    const model = new FakeModel();
    const scPoint = scenario.decisionPoints.find(p => p.category === "state-complete")!;
    const evPoint = scenario.decisionPoints.find(p => p.category === "evidence-dependent")!;
    const histPoint = scenario.decisionPoints.find(p => p.category === "history-dependent")!;
    // C state: state-complete succeeds, others fail
    const cSc = assembleContext("C_state", env, scPoint);
    expect(model.decide(cSc.modelContext, scPoint).correct).toBe(true);
    const cEv = assembleContext("C_state", env, evPoint);
    expect(model.decide(cEv.modelContext, evPoint).correct).toBe(false);
    const cHist = assembleContext("C_state", env, histPoint);
    expect(model.decide(cHist.modelContext, histPoint).correct).toBe(false);
    // A full history succeeds everywhere
    const aEv = assembleContext("A_full_history", env, evPoint);
    expect(model.decide(aEv.modelContext, evPoint).correct).toBe(true);
    const aHist = assembleContext("A_full_history", env, histPoint);
    expect(model.decide(aHist.modelContext, histPoint).correct).toBe(true);
    // B summary: state-complete succeeds, evidence/history fail (lossy)
    const bSc = assembleContext("B_summary_fixed", env, scPoint);
    expect(model.decide(bSc.modelContext, scPoint).correct).toBe(true);
    const bEv = assembleContext("B_summary_fixed", env, evPoint);
    expect(model.decide(bEv.modelContext, evPoint).correct).toBe(false);
  });

  it("D hybrid targeted fetch recovers evidence/history requiring retrieval", () => {
    const scenario = createScenario({ seed: 21, horizon: 10 });
    const env = new FakeExecutionEnvironment(scenario);
    const model = new FakeModel();
    const evPoint = scenario.decisionPoints.find(p => p.category === "evidence-dependent")!;
    const histPoint = scenario.decisionPoints.find(p => p.category === "history-dependent")!;
    // D without slice fails
    const dEvBase = assembleContext("D_hybrid", env, evPoint, { includeEvidence: false });
    expect(model.decide(dEvBase.modelContext, evPoint).correct).toBe(false);
    // D with targeted evidence succeeds
    const dEvFetched = assembleContext("D_hybrid", env, evPoint, { includeEvidence: true });
    expect(model.decide(dEvFetched.modelContext, evPoint).correct).toBe(true);
    const dHistBase = assembleContext("D_hybrid", env, histPoint, { includeHistory: false });
    expect(model.decide(dHistBase.modelContext, histPoint).correct).toBe(false);
    const dHistFetched = assembleContext("D_hybrid", env, histPoint, { includeHistory: true });
    expect(model.decide(dHistFetched.modelContext, histPoint).correct).toBe(true);
  });

  it("machine-readable rows contain required fields", () => {
    const row = runSingle({ seed: 42, horizon: 10, substrate: "C_state" });
    expect(row.scenario).toBeDefined();
    expect(row.seed).toBe(42);
    expect(row.horizon).toBe(10);
    expect(row.substrate).toBe("C_state");
    expect(typeof row.taskSuccess).toBe("boolean");
    expect(typeof row.decisionAccuracy).toBe("number");
    expect(typeof row.promptTokens).toBe("number");
    expect(typeof row.stateTokens).toBe("number");
    expect(typeof row.evidenceTokens).toBe("number");
    expect(typeof row.historyTokens).toBe("number");
    expect(typeof row.escalations).toBe("number");
    expect(typeof row.retrieval_precision).toBe("number");
    expect(typeof row.state_sufficiency).toBe("number");
    expect(typeof row.unnecessary_escalations).toBe("number");
    expect(typeof row.cumulativeTokens).toBe("number");
  });

  it("harness runs same scenario/seed/governance for A/B/C/D produces comparable rows", () => {
    const report = runHorizons({ seed: 123, horizons: [10] });
    const rows10 = report.rows.filter(r => r.horizon === 10);
    expect(rows10.length).toBe(4); // A/B/C/D
    // Same governance object across all rows (reference check via generated report)
    for (const r of rows10) {
      expect(r.scenario).toBe(rows10[0].scenario);
      expect(r.seed).toBe(123);
      expect(r.horizon).toBe(10);
    }
    // A succeeds, C partially succeeds (state-only), D succeeds, B partially
    const bySub = Object.fromEntries(rows10.map(r => [r.substrate, r])) as Record<string, typeof rows10[number]>;
    expect(bySub["A_full_history"].taskSuccess).toBe(true);
    expect(bySub["C_state"].taskSuccess).toBe(false); // fails evidence/history
    expect(bySub["D_hybrid"].taskSuccess).toBe(true); // recovers
    expect(bySub["D_hybrid"].retrieval_precision).toBe(1);
    expect(bySub["D_hybrid"].unnecessary_escalations).toBe(0);
  });

  it("C horizon-invariant 10→500: promptTokens bounded, state-complete accuracy 1.0", () => {
    const report = runHorizons({ seed: 42, horizons: [10, 50, 100, 500] });
    const cRows = report.rows.filter(r => r.substrate === "C_state").sort((a, b) => a.horizon - b.horizon);
    expect(cRows.length).toBe(4);
    const c10 = cRows[0].promptTokens;
    const c500 = cRows[cRows.length - 1].promptTokens;
    // Bounded: ratio < 2.0 (O(1) not O(T))
    expect(c500 / c10).toBeLessThan(2.0);
    // A grows linearly — much larger at 500 than at 10
    const aRows = report.rows.filter(r => r.substrate === "A_full_history").sort((a, b) => a.horizon - b.horizon);
    const a10 = aRows[0].promptTokens;
    const a500 = aRows[aRows.length - 1].promptTokens;
    expect(a500 / a10).toBeGreaterThan(3.0);
    // C taskSuccess false (evidence/history missing) but state-complete decisions all correct
    // Verify via direct check
    for (const h of [10, 50, 100, 500] as const) {
      const scenario = createScenario({ seed: 42, horizon: h });
      const env = new FakeExecutionEnvironment(scenario);
      const model = new FakeModel();
      for (const p of scenario.decisionPoints.filter(d => d.category === "state-complete")) {
        const ctx = assembleContext("C_state", env, p);
        expect(model.decide(ctx.modelContext, p).correct).toBe(true);
      }
    }
  });

  it("D recovers evidence/history-dependent where C fails", () => {
    for (const h of [10, 50] as const) {
      const c = runSingle({ seed: 99, horizon: h, substrate: "C_state" });
      const d = runSingle({ seed: 99, horizon: h, substrate: "D_hybrid" });
      expect(c.taskSuccess).toBe(false);
      expect(d.taskSuccess).toBe(true);
      expect(d.decisionAccuracy).toBe(1);
      expect(c.decisionAccuracy).toBeLessThan(1);
    }
  });

  it("D context bounded and retrieves only when required", () => {
    const report = runHorizons({ seed: 42, horizons: [10, 50, 100, 500] });
    const dRows = report.rows.filter(r => r.substrate === "D_hybrid").sort((a, b) => a.horizon - b.horizon);
    const aRows = report.rows.filter(r => r.substrate === "A_full_history").sort((a, b) => a.horizon - b.horizon);
    // D bounded: like C, D's peak prompt at 500 << A at 500
    const d500 = dRows[dRows.length - 1].promptTokens;
    const a500 = aRows[aRows.length - 1].promptTokens;
    expect(d500).toBeLessThan(a500);
    // D precision: only necessary escalations, zero unnecessary
    for (const r of dRows) {
      expect(r.retrieval_precision).toBe(1);
      expect(r.unnecessary_escalations).toBe(0);
      // escalations should equal count of evidence+history decisions (non-state)
      // At horizon 10, numDecisions=3 → 2 escalations (evidence+history)
      // So historical_retrieval_rate ~ 2/3
    }
  });

  it("required horizons length and summary invariants", () => {
    expect(REQUIRED_HORIZONS).toEqual([10, 50, 100, 500]);
    const report = runHorizons({ seed: 42 });
    expect(report.summary.cStateTokensBounded).toBe(true);
    expect(report.summary.cStateCompleteInvariant).toBe(true);
    expect(report.summary.dRecovers).toBe(true);
    expect(report.summary.dBounded).toBe(true);
    expect(report.summary.dPrecisionOk).toBe(true);
  });

  it("4-group metrics present per row", () => {
    const row = runSingle({ seed: 42, horizon: 50, substrate: "D_hybrid" });
    // correctness group
    expect(typeof row.taskSuccess).toBe("boolean");
    expect(typeof row.decisionAccuracy).toBe("number");
    // context efficiency
    expect(row.promptTokens).toBeGreaterThan(0);
    expect(row.cumulativeTokens).toBeGreaterThan(0);
    expect(typeof row.tokensPerStep).toBe("number");
    // adaptive
    expect(typeof row.escalations).toBe("number");
    expect(typeof row.historical_retrieval_rate).toBe("number");
    // horizon is in row itself
    expect(row.horizon).toBe(50);
  });
});
