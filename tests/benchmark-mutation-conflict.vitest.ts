// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  createMutationConflictScenario,
  runMutationConflictScenario,
  assertMutationConflictInvariants,
  MUTATION_CONFLICT_BASE_VERSION,
  MUTATION_CONFLICT_INVOCATION_ID,
} from "../benchmark/mutation-conflict.js";
import { runHorizons } from "../benchmark/harness.js";

describe("benchmark mutation-conflict — issue #638", () => {
  it("scenario deterministic: same seed → same proposals and baseStateVersion", () => {
    const a = createMutationConflictScenario({ seed: 42, N: 2 });
    const b = createMutationConflictScenario({ seed: 42, N: 2 });
    expect(a.baseStateVersion).toBe(MUTATION_CONFLICT_BASE_VERSION);
    expect(a.invocationId).toBe(MUTATION_CONFLICT_INVOCATION_ID);
    expect(JSON.stringify(a.proposals)).toBe(JSON.stringify(b.proposals));
    expect(JSON.stringify(a.initialHistory)).toBe(JSON.stringify(b.initialHistory));
    expect(a.schedulerEligible).toBe(true);
  });

  it("scenario support N=2 and N>2 deterministic", () => {
    const s2 = createMutationConflictScenario({ seed: 7, N: 2 });
    const s3 = createMutationConflictScenario({ seed: 7, N: 3 });
    const s5 = createMutationConflictScenario({ seed: 7, N: 5 });
    expect(s2.N).toBe(2);
    expect(s3.N).toBe(3);
    expect(s5.N).toBe(5);
    expect(s2.proposals.length).toBe(2);
    expect(s3.proposals.length).toBe(3);
    expect(s5.proposals.length).toBe(5);
    // all share same baseStateVersion
    expect(s2.proposals.every(p => p.baseStateVersion === 17)).toBe(true);
    expect(s3.proposals.every(p => p.baseStateVersion === 17)).toBe(true);
  });

  it("N=2 overlapping execution proof A.start < B.end && B.start < A.end, scheduler eligible", async () => {
    const result = await runMutationConflictScenario({ seed: 42, N: 2 });
    // same invocationId and baseStateVersion
    expect(result.scenario.invocationId).toBe(MUTATION_CONFLICT_INVOCATION_ID);
    expect(result.calls.every(c => c.invocationId === MUTATION_CONFLICT_INVOCATION_ID)).toBe(true);
    expect(result.calls.every(c => c.baseStateVersion === MUTATION_CONFLICT_BASE_VERSION)).toBe(true);
    // scheduler says eligible for concurrent execution
    expect(result.schedulerDecision.eligible).toBe(true);
    expect(result.schedulerDecision.decidedWinner).toBeNull();
    // overlapping timestamps proof
    const [a, b] = result.calls;
    expect(a.start < b.end && b.start < a.end).toBe(true);
    expect(result.invariants.overlapping).toBe(true);
    expect(result.invariants.sameInvocation).toBe(true);
    expect(result.invariants.sameBaseVersion).toBe(true);
  });

  it("N=2 exactly one success + N-1 STATE_VERSION_CONFLICT, no conflicting call produces authoritative mutation event", async () => {
    const result = await runMutationConflictScenario({ seed: 42, N: 2 });
    expect(result.committed.length).toBe(1);
    expect(result.conflicts.length).toBe(1);
    expect(result.invariants.exactlyOneSuccess).toBe(true);
    expect(result.invariants.nMinusOneConflicts).toBe(true);
    // Check conflict reason
    for (const c of result.conflicts) {
      const r = c.result as { reason?: string; committed: boolean };
      expect(r.committed).toBe(false);
      expect(r.reason).toBe("STATE_VERSION_CONFLICT");
      expect(c.emittedEvents.length).toBe(0);
    }
    // No conflicting call produces authoritative mutation event: eventLog only has committed events
    expect(result.eventLog.length).toBe(result.committed[0].emittedEvents.length);
    expect(result.eventLog.length).toBeGreaterThan(0);
  });

  it("N=2 no partial mutation, version v17→v18 only, scheduler did not decide winner, rebuilt state == sole committed event-derived state", async () => {
    const result = await runMutationConflictScenario({ seed: 42, N: 2 });
    // No partial mutation: version incremented by exactly 1
    expect(result.finalState.version).toBe(MUTATION_CONFLICT_BASE_VERSION + 1);
    expect(result.finalState.version).toBe(18);
    expect(result.invariants.noPartialMutation).toBe(true);
    // Rebuilt state equals committed event-derived state: EventLog → project → v18 reproduces exactly
    expect(result.rebuiltCore.version).toBe(result.finalState.version);
    expect(JSON.stringify(result.rebuiltCore)).toBe(JSON.stringify(result.finalState));
    expect(result.invariants.rebuiltEqualsCommitted).toBe(true);
    expect(result.invariants.schedulerDidNotDecideWinner).toBe(true);
    // Overall invariants pass
    expect(() => assertMutationConflictInvariants(result)).not.toThrow();
    // Events.jsonl proof shape: same invocation → overlapping → one success + N-1 conflicts
    expect(result.scenario.N).toBe(2);
    expect(result.calls.length).toBe(2);
    expect(result.calls[0].executionId).toBe(result.calls[1].executionId);
  });

  it("N=3 and N=5 general N invariant: exactly one commit, N-1 conflicts, rebuilt equals committed", async () => {
    for (const N of [3, 5] as const) {
      const result = await runMutationConflictScenario({ seed: 99, N });
      expect(result.committed.length).toBe(1);
      expect(result.conflicts.length).toBe(N - 1);
      expect(result.invariants.exactlyOneSuccess).toBe(true);
      expect(result.invariants.nMinusOneConflicts).toBe(true);
      expect(result.finalState.version).toBe(MUTATION_CONFLICT_BASE_VERSION + 1);
      expect(result.invariants.noPartialMutation).toBe(true);
      expect(result.invariants.rebuiltEqualsCommitted).toBe(true);
      expect(JSON.stringify(result.rebuiltCore)).toBe(JSON.stringify(result.finalState));
      expect(result.invariants.overlapping).toBe(true);
      expect(result.invariants.schedulerDidNotDecideWinner).toBe(true);
      expect(() => assertMutationConflictInvariants(result)).not.toThrow();
      // All conflicts are STATE_VERSION_CONFLICT
      for (const c of result.conflicts) {
        expect((c.result as { reason: string }).reason).toBe("STATE_VERSION_CONFLICT");
      }
      // No partial mutation: eventLog only from winner
      expect(result.eventLog.length).toBeGreaterThan(0);
      expect(result.eventLog.length).toBe(result.committed[0].emittedEvents.length);
    }
  });

  it("eventLog → project → v18 must reproduce exactly the successful mutation (no last-writer-wins)", async () => {
    const result = await runMutationConflictScenario({ seed: 123, N: 2 });
    // EventLog authoritative: only winner's objective present in rebuilt state
    const winnerObjective = (result.committed[0].proposal.patch as { objective?: string }).objective;
    expect(result.finalState.objective).toBe(winnerObjective);
    expect(result.rebuiltCore.objective).toBe(winnerObjective);
    // Loser's objective not in final state
    const loserObjective = (result.conflicts[0].proposal.patch as { objective?: string }).objective;
    expect(loserObjective).not.toBe(winnerObjective);
    expect(result.finalState.objective).not.toBe(loserObjective);
    expect(result.rebuiltCore.objective).not.toBe(loserObjective);
    // No last-writer-wins: version is 18, not 19, and history length is initial 17 + 1
    expect(result.eventLogHistory.length).toBe(MUTATION_CONFLICT_BASE_VERSION + result.eventLog.length);
    expect(result.rebuiltState.version).toBe(18);
  });

  it("C vs D benchmark still passes horizon-invariant and selective recovery with this scenario added", async () => {
    // Run the mutation-conflict proof first (proves it doesn't mutate shared global)
    const mc = await runMutationConflictScenario({ seed: 42, N: 2 });
    expect(mc.invariants.exactlyOneSuccess).toBe(true);

    // Re-run horizon invariants (C vs D primary bake-off) — must still pass
    const report = runHorizons({ seed: 42 });
    expect(report.summary.cStateTokensBounded).toBe(true);
    expect(report.summary.cStateCompleteInvariant).toBe(true);
    expect(report.summary.dRecovers).toBe(true);
    expect(report.summary.dBounded).toBe(true);
    expect(report.summary.dPrecisionOk).toBe(true);
  });
});
