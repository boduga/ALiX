import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AdaptivePolicy, type ExecutionSignals } from "../../src/adaptive/policy.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function sig(overrides: Partial<ExecutionSignals> = {}): ExecutionSignals {
  return {
    latestObservationRequired: false,
    historicalDependency: false,
    repeatedFailure: false,
    highUncertainty: false,
    multiStepInteraction: false,
    ...overrides,
  };
}

// ─── 7-row table-driven tests (§16-19) ────────────────────────────────────

describe("AdaptivePolicy — 7-row table (STATE_ONLY+ODA … HISTORY_AWARE+ReAct)", () => {
  const rows: Array<{
    name: string;
    signals: ExecutionSignals;
    expected: { contextMode: string; reasoningMode: string };
  }> = [
    {
      name: "1: default STATE_ONLY + ODA",
      signals: sig(),
      expected: { contextMode: "STATE_ONLY", reasoningMode: "ODA" },
    },
    {
      name: "2: highUncertainty → STATE_ONLY + ReAct (reasoning only)",
      signals: sig({ highUncertainty: true }),
      expected: { contextMode: "STATE_ONLY", reasoningMode: "ReAct" },
    },
    {
      name: "3: multiStepInteraction → STATE_ONLY + ReAct (reasoning only)",
      signals: sig({ multiStepInteraction: true }),
      expected: { contextMode: "STATE_ONLY", reasoningMode: "ReAct" },
    },
    {
      name: "4: repeatedFailure → STATE_WITH_EVIDENCE + ODA",
      signals: sig({ repeatedFailure: true }),
      expected: { contextMode: "STATE_WITH_EVIDENCE", reasoningMode: "ODA" },
    },
    {
      name: "5: repeatedFailure + highUncertainty → STATE_WITH_EVIDENCE + ReAct",
      signals: sig({ repeatedFailure: true, highUncertainty: true }),
      expected: { contextMode: "STATE_WITH_EVIDENCE", reasoningMode: "ReAct" },
    },
    {
      name: "6: historicalDependency → HISTORY_AWARE + ODA",
      signals: sig({ historicalDependency: true }),
      expected: { contextMode: "HISTORY_AWARE", reasoningMode: "ODA" },
    },
    {
      name: "7: historicalDependency + highUncertainty + multiStepInteraction → HISTORY_AWARE + ReAct",
      signals: sig({
        historicalDependency: true,
        highUncertainty: true,
        multiStepInteraction: true,
      }),
      expected: { contextMode: "HISTORY_AWARE", reasoningMode: "ReAct" },
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const d = AdaptivePolicy.decide(row.signals);
      expect(d.contextMode).toBe(row.expected.contextMode);
      expect(d.reasoningMode).toBe(row.expected.reasoningMode);
      // EventLog authoritative + ExecutionState anchor never bypassed (§13)
      expect(d.anchors.eventLogAuthoritative).toBe(true);
      expect(d.anchors.executionStateAnchor).toBe(true);
      expect(d.anchors.historySelective).toBe(true);
    });
  }
});

// ─── 5 invariants ─────────────────────────────────────────────────────────

describe("AdaptivePolicy invariants", () => {
  it("1. deterministic: same signals → same decision (deep equal, sorted triggers)", () => {
    const s = sig({ repeatedFailure: true, highUncertainty: true });
    const a = AdaptivePolicy.decide(s);
    const b = AdaptivePolicy.decide(s);
    expect(a).toEqual(b);
    // Also with shuffled construction order — triggers are sorted
    const c = AdaptivePolicy.decide(sig({ highUncertainty: true, repeatedFailure: true }));
    expect(a.triggers).toEqual(c.triggers);
    expect([...a.triggers].sort()).toEqual(a.triggers);
  });

  it("2. no StepExecutor dependency (static file check)", () => {
    const src = readFileSync("src/adaptive/policy.ts", "utf8");
    expect(src).not.toMatch(/StepExecutor/);
    // Also must not import executor / runtime execution
    expect(src).not.toMatch(/from\s+["'].*executor.*["']/i);
    expect(src).not.toMatch(/from\s+["'].*execution-state.*["']/i);
  });

  it("3. no state mutation: input is not mutated, decision is frozen and pure", () => {
    const s = sig({ historicalDependency: true, highUncertainty: true });
    const frozen = Object.freeze({ ...s });
    const snapshot = JSON.stringify(frozen);
    const d = AdaptivePolicy.decide(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
    // decision is frozen
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.triggers)).toBe(true);
    // calling again with same frozen does not throw or mutate
    const d2 = AdaptivePolicy.decide(frozen);
    expect(d2).toEqual(d);
    // returned objects are not the same ref as input
    expect(d as unknown as ExecutionSignals).not.toBe(frozen as unknown as object);
  });

  it("4. hysteresis: repeatedFailure escalation is sticky; HISTORY_AWARE precedence is stable", () => {
    // repeatedFailure keeps at least STATE_WITH_EVIDENCE (does not flap to STATE_ONLY)
    const withFailure = AdaptivePolicy.decide(sig({ repeatedFailure: true }));
    expect(withFailure.contextMode).toBe("STATE_WITH_EVIDENCE");
    const withFailureAgain = AdaptivePolicy.decide(sig({ repeatedFailure: true }));
    expect(withFailureAgain.contextMode).toBe("STATE_WITH_EVIDENCE");
    expect(withFailure).toEqual(withFailureAgain);

    // historicalDependency preempts repeatedFailure (HISTORY_AWARE precedence)
    const both = AdaptivePolicy.decide(sig({ historicalDependency: true, repeatedFailure: true }));
    expect(both.contextMode).toBe("HISTORY_AWARE");

    // Removing historicalDependency while repeatedFailure persists falls back to
    // STATE_WITH_EVIDENCE, not STATE_ONLY — hysteresis prevents wholesale collapse
    const afterHistoryCleared = AdaptivePolicy.decide(sig({ repeatedFailure: true }));
    expect(afterHistoryCleared.contextMode).toBe("STATE_WITH_EVIDENCE");
    expect(afterHistoryCleared.contextMode).not.toBe("STATE_ONLY");

    // latestObservationRequired alone does not flap contextMode either — stays deterministic
    const obsOnly1 = AdaptivePolicy.decide(sig({ latestObservationRequired: true }));
    const obsOnly2 = AdaptivePolicy.decide(sig({ latestObservationRequired: true }));
    expect(obsOnly1.contextMode).toBe("STATE_ONLY");
    expect(obsOnly1).toEqual(obsOnly2);
  });

  it("5. EventLog authoritative and ExecutionState anchor never bypassed (all modes)", () => {
    const allSignals: ExecutionSignals[] = [
      sig(),
      sig({ repeatedFailure: true }),
      sig({ historicalDependency: true }),
      sig({ historicalDependency: true, highUncertainty: true }),
      sig({ repeatedFailure: true, multiStepInteraction: true }),
    ];
    for (const s of allSignals) {
      const d = AdaptivePolicy.decide(s);
      expect(d.anchors.eventLogAuthoritative).toBe(true);
      expect(d.anchors.executionStateAnchor).toBe(true);
      // HISTORY_AWARE is selective history anchored on state, never wholesale dump
      expect(d.anchors.historySelective).toBe(true);
      // Even HISTORY_AWARE must report state anchor
      if (d.contextMode === "HISTORY_AWARE") {
        expect(d.anchors.executionStateAnchor).toBe(true);
      }
    }
  });

  it("orthogonality: context signals only affect contextMode, reasoning signals only affect reasoningMode", () => {
    const base = sig({ historicalDependency: true }); // HISTORY_AWARE + ODA
    const baseDecision = AdaptivePolicy.decide(base);

    // Vary reasoning signals — contextMode must not change
    const withReasoning = AdaptivePolicy.decide(
      sig({ historicalDependency: true, highUncertainty: true, multiStepInteraction: true })
    );
    expect(withReasoning.contextMode).toBe(baseDecision.contextMode);

    const base2 = sig({ repeatedFailure: true }); // STATE_WITH_EVIDENCE + ODA
    const base2Decision = AdaptivePolicy.decide(base2);
    const withReasoning2 = AdaptivePolicy.decide(
      sig({ repeatedFailure: true, highUncertainty: true })
    );
    expect(withReasoning2.contextMode).toBe(base2Decision.contextMode);

    // Vary context signals — reasoningMode must not change
    const reasoningBase = sig({ highUncertainty: true }); // STATE_ONLY + ReAct
    const reasoningDecision = AdaptivePolicy.decide(reasoningBase);
    const withContext = AdaptivePolicy.decide(
      sig({ highUncertainty: true, historicalDependency: true })
    );
    expect(withContext.reasoningMode).toBe(reasoningDecision.reasoningMode);

    const reasoningBase2 = sig(); // STATE_ONLY + ODA
    const reasoningDecision2 = AdaptivePolicy.decide(reasoningBase2);
    const withContext2 = AdaptivePolicy.decide(sig({ repeatedFailure: true }));
    expect(withContext2.reasoningMode).toBe(reasoningDecision2.reasoningMode);
  });
});
