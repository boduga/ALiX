// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { runHorizons } from "../benchmark/harness.js";
import { createScenario } from "../benchmark/scenario.js";
import { FakeExecutionEnvironment } from "../benchmark/fake-environment.js";
import { FakeModel } from "../benchmark/fake-model.js";
import { assembleContext } from "../benchmark/substrates.js";
import { REQUIRED_HORIZONS } from "../benchmark/types.js";

/**
 * CI thresholds for boundedness + retrieval precision — issue #645.
 *
 * Encodes the ExecutionState POC properties as hard CI gates that fail the PR
 * when:
 *  - context grows with horizon (O(T) leak where O(1) is required), or
 *  - retrieval precision drops (unnecessary escalations or missing targeted fetch).
 *
 * Canonical seed 42 is the deterministic POC baseline. Token counts are
 * deterministic via estimateTokens(JSON.length/4); values below are the
 * measured POC snapshot (dist/benchmark/harness.js via `node -e runHorizons`):
 *
 *  C_state:       92 → 94  flat, ratio <2.0   (bounded O(1))
 *  A_full_history: 578 → 27031 linear, >> C at 500
 *  D_hybrid:     144 → 165 bounded, ratio <2.5, retrieval_precision 1.0
 *
 * Fail-closed: any threshold violation = failing test = failing CI lane.
 */
describe("benchmark CI thresholds — issue #645", () => {
  // Single shared report — deterministic, no I/O, cheap (<50ms).
  const report = runHorizons({ seed: 42, horizons: [10, 50, 100, 500] });
  const by = (substrate: string) =>
    report.rows
      .filter(r => r.substrate === substrate)
      .sort((a, b) => a.horizon - b.horizon);

  it("REQUIRED_HORIZONS is 10/50/100/500", () => {
    expect([...REQUIRED_HORIZONS]).toEqual([10, 50, 100, 500]);
  });

  it("C prompt bounded 92→94 flat (ratio <2.0) vs A 578→27031 linear", () => {
    const cRows = by("C_state");
    const aRows = by("A_full_history");
    expect(cRows.length).toBe(4);
    expect(aRows.length).toBe(4);

    const c10 = cRows.find(r => r.horizon === 10)!.promptTokens;
    const c50 = cRows.find(r => r.horizon === 50)!.promptTokens;
    const c100 = cRows.find(r => r.horizon === 100)!.promptTokens;
    const c500 = cRows.find(r => r.horizon === 500)!.promptTokens;

    // POC snapshot — pin exact bounded values (state+latest observation only)
    expect(c10).toBe(92);
    expect(c50).toBe(92);
    expect(c100).toBe(94);
    expect(c500).toBe(94);

    // Hard gate: bounded means ratio <2.0 (O(1) not O(T))
    expect(c500 / c10).toBeLessThan(2.0);
    // Also bounded across intermediate steps
    expect(c100 / c10).toBeLessThan(2.0);
    expect(c50 / c10).toBeLessThan(2.0);

    const a10 = aRows.find(r => r.horizon === 10)!.promptTokens;
    const a50 = aRows.find(r => r.horizon === 50)!.promptTokens;
    const a100 = aRows.find(r => r.horizon === 100)!.promptTokens;
    const a500 = aRows.find(r => r.horizon === 500)!.promptTokens;

    // POC snapshot — A grows with horizon (full history O(T))
    expect(a10).toBe(578);
    expect(a50).toBe(2645);
    expect(a100).toBe(5288);
    expect(a500).toBe(27031);

    // A grows linearly — ratio must be >> C's
    expect(a500 / a10).toBeGreaterThan(3.0);
    expect(a500).toBeGreaterThan(c500 * 10);
    // Monotone growth (each larger horizon strictly larger prompt)
    expect(a50).toBeGreaterThan(a10);
    expect(a100).toBeGreaterThan(a50);
    expect(a500).toBeGreaterThan(a100);
  });

  it("C state-complete accuracy 1.0 at every horizon (10/50/100/500)", () => {
    for (const h of [10, 50, 100, 500] as const) {
      const scenario = createScenario({ seed: 42, horizon: h });
      const env = new FakeExecutionEnvironment(scenario);
      const model = new FakeModel();
      const statePoints = scenario.decisionPoints.filter(p => p.category === "state-complete");
      expect(statePoints.length).toBeGreaterThan(0);
      for (const p of statePoints) {
        const ctx = assembleContext("C_state", env, p);
        const d = model.decide(ctx.modelContext, p);
        expect(d.correct, `C_state state-complete must be 1.0 at horizon ${h} point ${p.id}`).toBe(true);
      }
    }
    // Also via summary invariants
    expect(report.summary.cStateCompleteInvariant).toBe(true);
    expect(report.summary.cStateTokensBounded).toBe(true);
  });

  it("D bounded 144→165 (ratio <2.5) and retrieval_precision 1.0", () => {
    const dRows = by("D_hybrid");
    const aRows = by("A_full_history");
    expect(dRows.length).toBe(4);

    const d10 = dRows.find(r => r.horizon === 10)!.promptTokens;
    const d50 = dRows.find(r => r.horizon === 50)!.promptTokens;
    const d100 = dRows.find(r => r.horizon === 100)!.promptTokens;
    const d500 = dRows.find(r => r.horizon === 500)!.promptTokens;

    // POC snapshot — D = C base + targeted slice, still bounded
    expect(d10).toBe(144);
    expect(d50).toBe(161);
    expect(d100).toBe(164);
    expect(d500).toBe(165);

    expect(d500 / d10).toBeLessThan(2.5);
    expect(d100 / d10).toBeLessThan(2.5);
    // D at 500 still far smaller than A at 500
    const a500 = aRows.find(r => r.horizon === 500)!.promptTokens;
    expect(d500).toBeLessThan(a500);

    // D bounded invariant from summary
    expect(report.summary.dBounded).toBe(true);
  });

  it("D retrieval_precision 1.0 and unnecessary_escalations 0 at every horizon", () => {
    const dRows = by("D_hybrid");
    for (const r of dRows) {
      expect(r.retrieval_precision, `D retrieval_precision must be 1.0 at horizon ${r.horizon}`).toBe(1);
      expect(r.unnecessary_escalations, `D unnecessary_escalations must be 0 at horizon ${r.horizon}`).toBe(0);
    }
    expect(report.summary.dPrecisionOk).toBe(true);
  });

  it("D recovers where C fails — decisionAccuracy 1.0 and taskSuccess at 10/50/100/500", () => {
    const cRows = by("C_state");
    const dRows = by("D_hybrid");
    for (const h of [10, 50, 100, 500] as const) {
      const c = cRows.find(r => r.horizon === h)!;
      const d = dRows.find(r => r.horizon === h)!;
      // D recovers evidence/history-dependent → full accuracy
      expect(d.decisionAccuracy, `D decisionAccuracy must be 1.0 at horizon ${h}`).toBe(1);
      expect(d.taskSuccess, `D taskSuccess must be true at horizon ${h}`).toBe(true);
      // C fails on evidence/history → accuracy <1 and taskSuccess false
      expect(c.decisionAccuracy).toBeLessThan(1);
      expect(c.taskSuccess).toBe(false);
      // D strictly more accurate than C at every horizon
      expect(d.decisionAccuracy).toBeGreaterThan(c.decisionAccuracy);
    }
    expect(report.summary.dRecovers).toBe(true);
  });

  it("thresholds fail PR if context grows with horizon or precision drops (smoke)", () => {
    // Composite guard — mirrors what CI would block on. Each sub-check above
    // isolates the failure signal; this one asserts the overall report summary
    // so a single PR breakage is immediately obvious in CI output.
    expect(report.summary).toEqual({
      cStateTokensBounded: true,
      cStateCompleteInvariant: true,
      dRecovers: true,
      dBounded: true,
      dPrecisionOk: true,
    });
  });
});
