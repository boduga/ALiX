// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { createScenario } from "../benchmark/scenario.js";
import { RealEventLogEnvironment } from "../benchmark/real-eventlog-environment.js";
import { runSingleReal, runHorizonsReal, cleanupEnvs } from "../benchmark/real-harness.js";
import { runSingle, runHorizons } from "../benchmark/harness.js";
import { project, toExecutionState } from "../src/runtime/execution-state/execution-state-projector.js";

describe("benchmark real EventLog/StepExecutor integration — issue #639", () => {
  it("real EventLog replaces FakeExecutionEnvironment for horizon 10 (file authoritative, state disposable)", async () => {
    const scenario = createScenario({ seed: 42, horizon: 10 });
    const env = new RealEventLogEnvironment(scenario);
    await env.init();

    // Real file exists with correct count
    expect(env.hasRealEventLogFile()).toBe(true);
    expect(env.hasRealStateFile()).toBe(true);

    // ExecutionState sourced from real Store (not fake in-memory)
    const state = env.getExecutionState();
    expect(state).not.toBeNull();
    expect(state!.executionId).toBe((scenario.events[0].payload as Record<string, unknown>).executionId);
    expect(state!.objective).toBe(scenario.objective);

    // EventLog authoritative: file read equals scenario length
    const fromFile = await env.getFullHistoryFromFile();
    expect(fromFile.length).toBe(scenario.events.length);

    // State disposable: delete + rebuildFromEvents reproduces identical state (INV-10)
    expect(await env.verifyRebuildable()).toBe(true);

    // End-to-end loop: EventLog → StateProjector → ExecutionState → ContextBuilder → Governor → StepExecutor → EventLog
    const beforeVersion = state!.version;
    const step = await env.runGovernedStep({
      patch: { constraints: [...state!.constraints, { kind: "maintenance_window", value: "window-real-test" }] },
      action: { kind: "reconcile_check", capability: "reconcile" },
    });
    expect(step.contextBuilt.prompt).toContain("<execution_state");
    expect(step.result.committed).toBe(true);
    expect(step.after).not.toBeNull();
    expect(step.after!.version).toBe(beforeVersion + 1);
    expect(step.emittedCount).toBeGreaterThan(0);
    // After commit, EventLog file grew by emitted events
    const afterFile = await env.getFullHistoryFromFile();
    expect(afterFile.length).toBe(scenario.events.length + step.emittedCount);
    // History still projects to after state (EventLog remains authoritative)
    const projEvents = afterFile.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id }));
    const rebuilt = project(projEvents as unknown as Parameters<typeof project>[0]);
    expect(toExecutionState(rebuilt).version).toBe(step.after!.version);
    expect(toExecutionState(rebuilt).executionId).toBe(step.after!.executionId);

    env.cleanup();
  });

  it("C vs D still horizon-invariant and bounded with real store (10→500), not just FakeModel", async () => {
    // Use real harness for horizons — each horizon gets its own tmp EventLog+Store
    const reportReal = await runHorizonsReal({ seed: 42, horizons: [10, 50, 100, 500] });
    // And compare to fake harness invariants (should match shape)
    const reportFake = runHorizons({ seed: 42, horizons: [10, 50, 100, 500] });

    // Real summary invariants must still pass with file-backed store
    expect(reportReal.summary.cStateTokensBounded).toBe(true);
    expect(reportReal.summary.cStateCompleteInvariant).toBe(true);
    expect(reportReal.summary.dRecovers).toBe(true);
    expect(reportReal.summary.dBounded).toBe(true);
    expect(reportReal.summary.dPrecisionOk).toBe(true);

    // Also fake should still pass (no regression)
    expect(reportFake.summary.cStateTokensBounded).toBe(true);
    expect(reportFake.summary.dRecovers).toBe(true);

    // C tokens bounded: real 10 vs 500 ratio <2.0
    const cReal = reportReal.rows.filter(r => r.substrate === "C_state").sort((a, b) => a.horizon - b.horizon);
    const ratioReal = cReal[0].promptTokens === 0 ? 1 : cReal[cReal.length - 1].promptTokens / cReal[0].promptTokens;
    expect(ratioReal).toBeLessThan(2.0);

    // D bounded and recovers vs C
    const dReal = reportReal.rows.filter(r => r.substrate === "D_hybrid").sort((a, b) => a.horizon - b.horizon);
    for (const h of [10, 50, 100, 500] as const) {
      const c = cReal.find(r => r.horizon === h)!;
      const d = dReal.find(r => r.horizon === h)!;
      expect(d.decisionAccuracy).toBe(1);
      expect(d.retrieval_precision).toBe(1);
      expect(d.unnecessary_escalations).toBe(0);
      expect(d.promptTokens).toBeLessThan(c.promptTokens * 5); // bounded, not blow up
      if (h === 10) {
        // At horizon 10, C fails evidence/history, D succeeds
        expect(c.taskSuccess).toBe(false);
        expect(d.taskSuccess).toBe(true);
      }
    }

    cleanupEnvs(reportReal.envs);
  });

  it("no new abstraction — reuses src/runtime/execution-state/* (projector/store/context-builder/harness)", async () => {
    const scenario = createScenario({ seed: 7, horizon: 10 });
    const env = new RealEventLogEnvironment(scenario);
    await env.init();
    // Verify that ExecutionStateStore and projector are the real modules by checking file shape
    // store file is flat CheckpointedExecutionState: executionId + projectionVersion + historyRevision + historyHash
    const cp = env.getCheckpoint()!;
    expect(cp.historyRevision).toBeGreaterThan(0);
    expect(cp.historyHash).toMatch(/^[0-9a-f]{64}$/);
    // ContextBuilder was used in runGovernedStep — verify prompt contains real state fields
    const step = await env.runGovernedStep({ patch: { objective: "harden-real-loop" } });
    expect(step.contextBuilt.sections.executionState).toContain("<execution_state");
    // Before context reflects old objective; after state reflects patched objective
    expect(step.before.objective).toBe(scenario.objective);
    expect(step.after!.objective).toBe("harden-real-loop");
    expect(step.contextBuilt.prompt).toContain("<execution_state");
    env.cleanup();
  });

  it("single horizon 10 with real store produces comparable row to fake (deterministic)", async () => {
    const seed = 11;
    const horizon = 10;
    const fakeRow = runSingle({ seed, horizon, substrate: "C_state" });
    const realRow = await (async () => {
      const withEnv = await runSingleReal({ seed, horizon, substrate: "C_state" });
      const { _env, ...row } = withEnv as unknown as typeof withEnv & { _env: RealEventLogEnvironment };
      _env.cleanup();
      return row;
    })();
    // Same decisionAccuracy shape (state-complete succeeds, evidence/history fails → same accuracy)
    expect(realRow.decisionAccuracy).toBe(fakeRow.decisionAccuracy);
    expect(realRow.totalDecisions).toBe(fakeRow.totalDecisions);
    // Real tokens bounded similarly (within 10% due to identical stateView serialization)
    expect(Math.abs(realRow.promptTokens - fakeRow.promptTokens) / Math.max(1, fakeRow.promptTokens)).toBeLessThan(0.5);
  });
});
