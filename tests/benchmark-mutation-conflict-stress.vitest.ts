// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  createMutationConflictStressScenario,
  runMutationConflictStressScenario,
  assertMutationConflictStressInvariants,
  MUTATION_CONFLICT_STRESS_N,
  MUTATION_CONFLICT_STRESS_BASE_VERSION,
  MUTATION_CONFLICT_STRESS_INVOCATION_ID,
  MUTATION_CONFLICT_STRESS_MAX_PARALLEL,
} from "../benchmark/mutation-conflict-stress.js";
import { createMutationConflictScenario } from "../benchmark/mutation-conflict.js";
import { runHorizons } from "../benchmark/harness.js";

describe("benchmark mutation-conflict-stress — issue #643", () => {
  it("stress scenario deterministic: same seed → same proposals, N=5 base 17", () => {
    const a = createMutationConflictStressScenario({ seed: 42 });
    const b = createMutationConflictStressScenario({ seed: 42 });
    expect(a.N).toBe(MUTATION_CONFLICT_STRESS_N);
    expect(a.baseStateVersion).toBe(MUTATION_CONFLICT_STRESS_BASE_VERSION);
    expect(a.invocationId).toBe(MUTATION_CONFLICT_STRESS_INVOCATION_ID);
    expect(JSON.stringify(a.proposals)).toBe(JSON.stringify(b.proposals));
    expect(JSON.stringify(a.initialHistory)).toBe(JSON.stringify(b.initialHistory));
    expect(a.schedulerEligible).toBe(true);
    // Base factory with same seed/N must produce identical proposals
    const base = createMutationConflictScenario({ seed: 42, N: 5, baseStateVersion: 17 });
    expect(JSON.stringify(a.proposals)).toBe(JSON.stringify(base.proposals));
  });

  it("N=5 stress: same baseStateVersion 17, all eligible for parallel, overlapping A.start<B.end proven", async () => {
    const result = await runMutationConflictStressScenario({ seed: 42 });
    expect(result.scenario.N).toBe(5);
    expect(result.scenario.baseStateVersion).toBe(17);
    expect(result.calls.length).toBe(5);
    expect(result.calls.every(c => c.invocationId === MUTATION_CONFLICT_STRESS_INVOCATION_ID)).toBe(true);
    expect(result.calls.every(c => c.baseStateVersion === MUTATION_CONFLICT_STRESS_BASE_VERSION)).toBe(true);
    expect(result.schedulerDecision.eligible).toBe(true);
    expect(result.schedulerDecision.decidedWinner).toBeNull();
    expect(result.invariants.sameInvocation).toBe(true);
    expect(result.invariants.sameBaseVersion).toBe(true);
    // Overlapping proof within first batch (4 parallel)
    const withinFirstBatch = result.calls.slice(0, 4);
    let overlappingInBatch = false;
    for (let i = 0; i < withinFirstBatch.length; i++) {
      for (let j = i + 1; j < withinFirstBatch.length; j++) {
        const a = withinFirstBatch[i]!;
        const b = withinFirstBatch[j]!;
        if (a.start < b.end && b.start < a.end) overlappingInBatch = true;
      }
    }
    expect(overlappingInBatch).toBe(true);
    expect(result.invariants.overlapping).toBe(true);
    expect(result.stressInvariants.overlapping).toBe(true);
  });

  it("N=5 stress: exactly one v18, 4 STATE_VERSION_CONFLICT, no partial mutation", async () => {
    const result = await runMutationConflictStressScenario({ seed: 42 });
    expect(result.committed.length).toBe(1);
    expect(result.conflicts.length).toBe(4);
    expect(result.invariants.exactlyOneSuccess).toBe(true);
    expect(result.invariants.nMinusOneConflicts).toBe(true);
    expect(result.stressInvariants.exactlyOneSuccess).toBe(true);
    expect(result.stressInvariants.nMinusOneConflicts).toBe(true);
    // 4 conflicts all STATE_VERSION_CONFLICT, no authoritative events
    for (const c of result.conflicts) {
      const r = c.result as { reason?: string; committed: boolean };
      expect(r.committed).toBe(false);
      expect(r.reason).toBe("STATE_VERSION_CONFLICT");
      expect(c.emittedEvents.length).toBe(0);
    }
    // Version exactly base+1 (17→18), not base+N
    expect(result.finalState.version).toBe(MUTATION_CONFLICT_STRESS_BASE_VERSION + 1);
    expect(result.finalState.version).toBe(18);
    expect(result.invariants.noPartialMutation).toBe(true);
    expect(result.stressInvariants.noPartialMutation).toBe(true);
    // EventLog only from winner, no extra
    expect(result.eventLog.length).toBe(result.committed[0].emittedEvents.length);
    expect(result.eventLog.length).toBeGreaterThan(0);
  });

  it("scheduler maxParallel:4 chunking respected under load (N=5 → 4+1, maxConcurrent==4)", async () => {
    const result = await runMutationConflictStressScenario({ seed: 42 });
    expect(result.stressMeta.maxParallel).toBe(MUTATION_CONFLICT_STRESS_MAX_PARALLEL);
    expect(result.stressMeta.maxParallel).toBe(4);
    expect(result.stressMeta.maxConcurrent).toBe(4);
    expect(result.stressMeta.chunkCount).toBe(2);
    expect(result.stressMeta.expectedChunkCount).toBe(2);
    expect(result.stressMeta.chunkBatchSizes).toEqual([4, 1]);
    expect(result.stressMeta.maxConcurrent).toBeLessThanOrEqual(result.stressMeta.maxParallel);
    expect(result.stressInvariants.schedulerChunkingRespected).toBe(true);
    expect(result.stressInvariants.maxConcurrentIsFour).toBe(true);
    // Proven via maxConcurrent never exceeding policy even though 5 dispatched
    expect(result.stressMeta.maxConcurrent).not.toBe(5);
    // Also prove overall overlapping still holds despite chunking (first batch parallel)
    expect(result.stressInvariants.overlapping).toBe(true);
  });

  it("EventLog authoritative, rebuilt state == committed, scheduler did not decide winner", async () => {
    const result = await runMutationConflictStressScenario({ seed: 123 });
    // EventLog authoritative: only winner's objective in final/rebuilt
    const winnerObjective = (result.committed[0].proposal.patch as { objective?: string }).objective;
    expect(result.finalState.objective).toBe(winnerObjective);
    expect(result.rebuiltCore.objective).toBe(winnerObjective);
    const loserObjectives = result.conflicts.map(c => (c.proposal.patch as { objective?: string }).objective);
    for (const lo of loserObjectives) {
      expect(lo).not.toBe(winnerObjective);
      expect(result.finalState.objective).not.toBe(lo);
      expect(result.rebuiltCore.objective).not.toBe(lo);
    }
    // Rebuilt == committed via EventLog → project
    expect(result.rebuiltCore.version).toBe(result.finalState.version);
    expect(JSON.stringify(result.rebuiltCore)).toBe(JSON.stringify(result.finalState));
    expect(result.invariants.rebuiltEqualsCommitted).toBe(true);
    expect(result.stressInvariants.rebuiltEqualsCommitted).toBe(true);
    // History length initial 17 + 1 committed
    expect(result.eventLogHistory.length).toBe(MUTATION_CONFLICT_STRESS_BASE_VERSION + result.eventLog.length);
    expect(result.rebuiltState.version).toBe(18);
    // Scheduler did not decide winner (CAS did)
    expect(result.schedulerDecision.decidedWinner).toBeNull();
    expect(result.schedulerDecision.eligible).toBe(true);
    expect(result.invariants.schedulerDidNotDecideWinner).toBe(true);
    expect(result.stressInvariants.schedulerDidNotDecideWinner).toBe(true);
    // Overall stress invariants pass
    expect(() => assertMutationConflictStressInvariants(result)).not.toThrow();
  });

  it("stress invariant holds across multiple seeds (deterministic under load)", async () => {
    for (const seed of [7, 99, 2024, 0, 1] as const) {
      const result = await runMutationConflictStressScenario({ seed });
      expect(result.committed.length).toBe(1);
      expect(result.conflicts.length).toBe(4);
      expect(result.finalState.version).toBe(18);
      expect(result.stressMeta.maxConcurrent).toBe(4);
      expect(result.stressMeta.chunkBatchSizes).toEqual([4, 1]);
      expect(result.invariants.overlapping).toBe(true);
      expect(result.stressInvariants.schedulerChunkingRespected).toBe(true);
      expect(() => assertMutationConflictStressInvariants(result)).not.toThrow();
    }
  });

  it("C vs D benchmark still passes horizon-invariant with stress scenario added", async () => {
    const stress = await runMutationConflictStressScenario({ seed: 42 });
    expect(stress.stressInvariants.exactlyOneSuccess).toBe(true);

    const report = runHorizons({ seed: 42 });
    expect(report.summary.cStateTokensBounded).toBe(true);
    expect(report.summary.cStateCompleteInvariant).toBe(true);
    expect(report.summary.dRecovers).toBe(true);
    expect(report.summary.dBounded).toBe(true);
    expect(report.summary.dPrecisionOk).toBe(true);
  });
});
