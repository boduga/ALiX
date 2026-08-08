import { describe, it, expect } from "vitest";
import {
  assembleContext,
  ContextBudgetOverflowError,
  type CandidateContextItem,
  type ContextItemProvenance,
} from "../../src/config/context-assembly.js";
import {
  createContextBudget,
  preflight,
  type ContextBudget,
} from "../../src/config/context-budget.js";
import type { ModelDescriptor } from "../../src/config/context-limits.js";

// ─── Fixtures ────────────────────────────────────────────────────────────

/** Exact-availableInput budget: reserve exactly 8,000 so availableInput is
 *  fully controlled. Same immutable shape the factory produces. */
function budget(availableInputTokens: number): ContextBudget {
  const budgetReservation = 8_000;
  return Object.freeze({
    contextWindowTokens: availableInputTokens + budgetReservation,
    budgetReservation,
    requestedMaxOutputTokens: budgetReservation,
    availableInputTokens,
    policyReservation: 8_000,
  });
}

function descriptor(windowTokens: number): ModelDescriptor {
  return {
    provider: "test",
    model: "test-model",
    contextWindowTokens: windowTokens,
    tokenizer: "cl100k_base",
    safetyFactor: 1.2,
  };
}

let itemSeq = 0;

/** Deterministic candidate item builder. The policy reads only `category` and
 *  `tokens`; id/kind/provenance ride along as telemetry. */
function item(
  category: CandidateContextItem["category"],
  tokens: number,
  overrides: {
    id?: string;
    kind?: string;
    rawTokens?: number;
    provenance?: Partial<ContextItemProvenance>;
  } = {}
): CandidateContextItem {
  itemSeq += 1;
  const kind = overrides.kind ?? "generic";
  return {
    id: overrides.id ?? `item-${itemSeq}`,
    kind,
    category,
    tokens,
    rawTokens: overrides.rawTokens ?? tokens,
    provenance: {
      category,
      kind,
      createdAt: overrides.provenance?.createdAt ?? 1_700_000_000_000 + itemSeq,
      source: overrides.provenance?.source ?? "test",
    },
  };
}

// ─── Tier ordering + whole-item admission ────────────────────────────────

describe("assembleContext — tier ordering and whole-item admission", () => {
  it("admits items in tier order (T1→T6) regardless of input order", () => {
    const candidate = [
      item("older_context", 10, { id: "older" }),
      item("mandatory_system_governance", 10, { id: "sys" }),
      item("recent_conversation", 10, { id: "conv" }),
      item("current_task", 10, { id: "task" }),
      item("current_execution_state", 10, { id: "state" }),
      item("recent_tool_results", 10, { id: "tools" }),
    ];
    const result = assembleContext(candidate, budget(1_000));
    expect(result.admitted.map((i) => i.id)).toEqual([
      "sys", "task", "state", "conv", "tools", "older",
    ]);
    expect(result.dropped).toEqual([]);
  });

  it("preserves source order within a tier", () => {
    const candidate = [
      item("recent_conversation", 10, { id: "b" }),
      item("recent_conversation", 10, { id: "a" }),
      item("recent_conversation", 10, { id: "c" }),
    ];
    const result = assembleContext(candidate, budget(1_000));
    expect(result.admitted.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("admits whole items only — newest T4 items kept, oldest dropped under pressure", () => {
    // available = 30; sys(10) + newest conv c(10) + b(10) fit; oldest a(10) dropped.
    const candidate = [
      item("mandatory_system_governance", 10, { id: "sys" }),
      item("recent_conversation", 10, { id: "a" }),
      item("recent_conversation", 10, { id: "b" }),
      item("recent_conversation", 10, { id: "c" }),
    ];
    const result = assembleContext(candidate, budget(30));
    expect(result.admitted.map((i) => i.id)).toEqual(["sys", "c", "b"]);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["a"]);
  });

  it("applies recency ordering to T4/T5 when the strategy is explicit recency (default)", () => {
    const candidate = [
      item("recent_conversation", 10, { id: "oldest" }),
      item("recent_conversation", 10, { id: "newest" }),
    ];
    const result = assembleContext(candidate, budget(15));
    expect(result.admitted.map((i) => i.id)).toEqual(["newest"]);
  });

  it("reverts to chronological order when ordering is explicitly 'relevance' for T4 (declared, unimplemented → non-recency fallback)", () => {
    // Only 'recency'/'recency-dedup' admit newest-first. Any other strategy —
    // e.g. 'relevance' — preserves source order (chronological) until a gated
    // algorithm ships. This test pins the fallback.
    const candidate = [
      item("recent_conversation", 10, { id: "oldest" }),
      item("recent_conversation", 10, { id: "newest" }),
    ];
    const result = assembleContext(candidate, budget(15), { recent_conversation: "relevance" });
    expect(result.admitted.map((i) => i.id)).toEqual(["oldest"]);
  });

  it("never admits a partial item", () => {
    const candidate = [item("older_context", 100, { id: "big" })];
    const result = assembleContext(candidate, budget(50));
    expect(result.admitted).toEqual([]);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["big"]);
  });
});

// ─── Skip-and-continue; never size-aware ─────────────────────────────────

describe("assembleContext — skip-and-continue within a tier (never size-aware)", () => {
  it("skips an item that does not fit and continues within the same tier", () => {
    // available = 120; mandatory = 0; big(300) skips, small(100) still fits.
    const candidate = [
      item("recent_tool_results", 300, { id: "big" }),
      item("recent_tool_results", 100, { id: "small" }),
    ];
    const result = assembleContext(candidate, budget(120));
    expect(result.dropped.map((d) => d.item.id)).toEqual(["big"]);
    expect(result.admitted.map((i) => i.id)).toEqual(["small"]);
    expect(result.dropped[0].reason).toBe("budget_exhausted");
  });

  // line ~132-141 — under newest-first, medium (newest) is admitted, large (older) dropped:
  it("admits the newest item first even when an older larger item fits first in source order", () => {
    const candidate = [
      item("recent_conversation", 30, { id: "large" }),
      item("recent_conversation", 20, { id: "medium" }),
    ];
    const result = assembleContext(candidate, budget(40));
    expect(result.admitted.map((i) => i.id)).toEqual(["medium"]);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["large"]);
  });

  it("admits the fitting source-order subsequence — never reorders by size", () => {
    // T6 (older_context) stays chronological — §4A reverses admission only for
    // T4/T5 (recent_conversation / recent_tool_results), never older_context.
    // available = 60: large(50) admitted, medium(30) skipped, small(10) admitted.
    // A size-aware selector would have returned [small, medium] instead.
    const candidate = [
      item("older_context", 50, { id: "large" }),
      item("older_context", 30, { id: "medium" }),
      item("older_context", 10, { id: "small" }),
    ];
    const result = assembleContext(candidate, budget(60));
    expect(result.admitted.map((i) => i.id)).toEqual(["large", "small"]);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["medium"]);
  });
});

// ─── Tier 3 protected unit ───────────────────────────────────────────────

describe("assembleContext — Tier 3 protected unit (execution state)", () => {
  it("admits Tier 3 as a unit and fully token-accounts it", () => {
    // available = 200; mandatory sys+task = 20; T3 digest(70) + ledger(60) = 130.
    const candidate = [
      item("mandatory_system_governance", 10, { id: "sys" }),
      item("current_task", 10, { id: "task" }),
      item("current_execution_state", 70, { id: "digest", kind: "digest" }),
      item("current_execution_state", 60, { id: "ledger", kind: "ledger" }),
      item("recent_conversation", 10, { id: "conv" }),
    ];
    const result = assembleContext(candidate, budget(200));
    expect(result.admitted.map((i) => i.id)).toEqual(["sys", "task", "digest", "ledger", "conv"]);
    expect(result.protectedTokens).toBe(130);
    // fully token-accounted: 200 − 20 (mandatory) − 130 (T3) − 10 (conv) = 40
    expect(result.remainingTokens).toBe(40);
    expect(result.admittedTokens).toBe(20 + 130 + 10);
  });

  it("drops the ENTIRE Tier 3 unit when it does not fit as a whole (all-or-nothing)", () => {
    // available = 120; mandatory = 20 → remaining 100; T3 digest(70)+ledger(60)=130 > 100.
    // Even though digest(70) would individually fit, the protected unit is atomic.
    const candidate = [
      item("mandatory_system_governance", 10, { id: "sys" }),
      item("current_task", 10, { id: "task" }),
      item("current_execution_state", 70, { id: "digest", kind: "digest" }),
      item("current_execution_state", 60, { id: "ledger", kind: "ledger" }),
    ];
    const result = assembleContext(candidate, budget(120));
    expect(result.admitted.map((i) => i.id)).toEqual(["sys", "task"]);
    expect(result.dropped.map((d) => d.item.id).sort()).toEqual(["digest", "ledger"]);
    for (const d of result.dropped) {
      expect(d.reason).toBe("protected_unit_exceeded_budget");
    }
    expect(result.protectedTokens).toBe(0);
    // Dropping T3 frees its would-be budget for best-effort tiers.
    expect(result.remainingTokens).toBe(100);
  });

  it("frees Tier 3 budget for best-effort tiers when the protected unit is dropped", () => {
    // available = 150; mandatory = 20 → 130; T3 = 140 (too big); conv(50) then fits.
    const candidate = [
      item("mandatory_system_governance", 10, { id: "sys" }),
      item("current_task", 10, { id: "task" }),
      item("current_execution_state", 140, { id: "state", kind: "execution_state" }),
      item("recent_conversation", 50, { id: "conv" }),
    ];
    const result = assembleContext(candidate, budget(150));
    expect(result.admitted.map((i) => i.id)).toEqual(["sys", "task", "conv"]);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["state"]);
    expect(result.remainingTokens).toBe(150 - 20 - 50);
  });
});

// ─── Mandatory region (T1+T2) ────────────────────────────────────────────

describe("assembleContext — mandatory region (T1+T2) irreducibility", () => {
  it("raises the typed irreducible ContextBudgetOverflowError when mandatory does not fit", () => {
    const candidate = [
      item("mandatory_system_governance", 300, { id: "sys" }),
      item("current_task", 300, { id: "task" }),
      item("older_context", 10, { id: "older" }),
    ];
    expect(() => assembleContext(candidate, budget(500))).toThrow(ContextBudgetOverflowError);
    try {
      assembleContext(candidate, budget(500));
      throw new Error("assembleContext should have thrown for an irreducible mandatory overflow");
    } catch (err) {
      expect(err).toBeInstanceOf(ContextBudgetOverflowError);
      const e = err as ContextBudgetOverflowError;
      expect(e.kind).toBe("context_budget_overflow");
      expect(e.reducible).toBe(false);
      expect(e.overageTokens).toBe(600 - 500);
      expect(e.mandatoryTokens).toBe(600);
      expect(e.availableInputTokens).toBe(500);
      expect(e.contextWindowTokens).toBe(8_500); // 500 + 8,000 reserve (test fixture)
    }
  });

  it("counts BOTH Tier 1 and Tier 2 as mandatory — system alone fitting is not enough", () => {
    // sys(300) alone fits 500, but sys+task(300+300=600) does not → irreducible.
    const candidate = [
      item("mandatory_system_governance", 300, { id: "sys" }),
      item("current_task", 300, { id: "task" }),
    ];
    expect(() => assembleContext(candidate, budget(500))).toThrow(ContextBudgetOverflowError);
  });

  it("admits the entire mandatory region once it fits — mandatory items are never dropped", () => {
    const candidate = [
      item("mandatory_system_governance", 200, { id: "sys" }),
      item("current_task", 200, { id: "task" }),
      item("recent_tool_results", 1_000, { id: "huge-tool" }),
    ];
    const result = assembleContext(candidate, budget(500));
    expect(result.admitted.map((i) => i.id)).toEqual(["sys", "task"]);
    expect(result.mandatoryTokens).toBe(400);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["huge-tool"]);
  });
});

// ─── Provenance ──────────────────────────────────────────────────────────

describe("assembleContext — provenance rides along, policy ignores it", () => {
  it("carries provenance untouched on admitted and dropped items", () => {
    const candidate = [
      item("recent_conversation", 20, {
        id: "kept",
        kind: "repair_prompt",
        provenance: { source: "repair", createdAt: 111 },
      }),
      item("recent_conversation", 90, {
        id: "cut",
        kind: "checkpoint_prompt",
        provenance: { source: "checkpoint", createdAt: 222 },
      }),
    ];
    const result = assembleContext(candidate, budget(50));
    const kept = result.admitted[0];
    expect(kept.id).toBe("kept");
    expect(kept.provenance).toEqual({
      category: "recent_conversation",
      kind: "repair_prompt",
      createdAt: 111,
      source: "repair",
    });
    expect(result.dropped[0].item.provenance.kind).toBe("checkpoint_prompt");
    expect(result.dropped[0].item.provenance.source).toBe("checkpoint");
  });

  // line ~288-305 — the admitted id now depends on recency position, not provenance;
  // the PROVENANCE-INDIFFERENT claim still holds (same position → same id regardless of values):
  it("does not let provenance influence the admission decision — recency position decides", () => {
    const mk = (kind: string, source: string, id: string) =>
      item("recent_conversation", 40, { id, kind, provenance: { source } });
    // available = 50: newest item (last in source order) fits, oldest does not.
    const resultA = assembleContext(
      [mk("repair_prompt", "repair", "first"), mk("checkpoint_prompt", "checkpoint", "second")],
      budget(50)
    );
    const resultB = assembleContext(
      [mk("checkpoint_prompt", "checkpoint", "second"), mk("repair_prompt", "repair", "first")],
      budget(50)
    );
    expect(resultA.admitted.map((i) => i.id)).toEqual(["second"]);
    expect(resultB.admitted.map((i) => i.id)).toEqual(["first"]);
    expect(resultA.dropped.map((d) => d.item.id)).toEqual(["first"]);
    expect(resultB.dropped.map((d) => d.item.id)).toEqual(["second"]);
  });
});

// ─── Determinism + preflight final gate ──────────────────────────────────

describe("assembleContext — one deterministic pass; preflight stays the final gate", () => {
  const candidate = [
    item("mandatory_system_governance", 10, { id: "sys" }),
    item("current_task", 10, { id: "task" }),
    item("current_execution_state", 60, { id: "state" }),
    item("recent_conversation", 40, { id: "a" }),
    item("recent_conversation", 40, { id: "b" }),
    item("recent_tool_results", 90, { id: "tool" }),
    item("older_context", 500, { id: "old" }),
  ];

  it("is deterministic — identical inputs yield an identical result", () => {
    const budgetObj = budget(200);
    expect(assembleContext(candidate, budgetObj)).toEqual(assembleContext(candidate, budgetObj));
  });

  it("never mutates the candidate or the budget", () => {
    const candidateSnapshot = JSON.stringify(candidate);
    const budgetObj = budget(200);
    const budgetSnapshot = JSON.stringify(budgetObj);
    assembleContext(candidate, budgetObj);
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
    expect(JSON.stringify(budgetObj)).toBe(budgetSnapshot);
    expect(Object.isFrozen(budgetObj)).toBe(true);
  });

  it("its admitted output always passes preflight (the final safety gate)", () => {
    const cases: Array<{ candidate: CandidateContextItem[]; available: number }> = [
      { candidate, available: 200 },
      { candidate, available: 150 },
      { candidate, available: 40 }, // only mandatory fits
      { candidate, available: 1_000 }, // everything fits
    ];
    for (const c of cases) {
      const b = budget(c.available);
      const result = assembleContext(c.candidate, b);
      // admitted is structurally a BudgetedContextItem[] — the preflight gate.
      expect(preflight(b, result.admitted)).toEqual({ fits: true });
    }
  });

  it("never over-admits: admittedTokens ≤ availableInputTokens", () => {
    const b = budget(200);
    const result = assembleContext(candidate, b);
    expect(result.admittedTokens).toBeLessThanOrEqual(b.availableInputTokens);
    expect(result.remainingTokens).toBe(b.availableInputTokens - result.admittedTokens);
  });

  it("tracks admittedRawTokens separately from padded admittedTokens", () => {
    const candidate = [
      item("recent_conversation", 60, { id: "conv", rawTokens: 50 }),
      item("recent_tool_results", 30, { id: "tools", rawTokens: 25 }),
    ];
    const result = assembleContext(candidate, budget(100));
    expect(result.admittedTokens).toBe(90);
    expect(result.admittedRawTokens).toBe(75);
  });

  it("handles an empty candidate", () => {
    const result = assembleContext([], budget(1_000));
    expect(result.admitted).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.admittedTokens).toBe(0);
    expect(result.remainingTokens).toBe(1_000);
  });
});

// ─── Integration with the real budget factory ────────────────────────────

describe("assembleContext — integration with createContextBudget", () => {
  it("assembles against a real factory-derived budget (64k → 51,200 available)", () => {
    const realBudget = createContextBudget(descriptor(64_000));
    const candidate = [
      item("mandatory_system_governance", 10_000, { id: "sys" }),
      item("current_task", 5_000, { id: "task" }),
      item("current_execution_state", 8_000, { id: "state" }),
      item("recent_conversation", 20_000, { id: "conv" }),
      item("recent_tool_results", 15_000, { id: "tools" }),
      item("older_context", 10_000, { id: "old" }),
    ];
    const result = assembleContext(candidate, realBudget);
    // mandatory 15,000 + T3 8,000 + conv 20,000 = 43,000 fit; tools(15,000) then
    // exceeds the remaining 8,200 → skipped; older(10,000) also skipped.
    expect(result.admitted.map((i) => i.id)).toEqual(["sys", "task", "state", "conv"]);
    expect(result.dropped.map((d) => d.item.id)).toEqual(["tools", "old"]);
    expect(preflight(realBudget, result.admitted)).toEqual({ fits: true });
    expect(result.remainingTokens).toBe(51_200 - 43_000);
  });
});
