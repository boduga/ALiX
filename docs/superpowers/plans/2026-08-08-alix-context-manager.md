# ALiX Context Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six-design ALiX Context Manager addendum: per-provider tokenizer calibration, tool-schema scoping (T1a/T1b), drop→failure `contextPressure` feedback, within-tier recency ordering (fix + config), output-knob decoupling, and the deferred context-rot threshold mechanism.

**Architecture:** All work threads through the C0/C1 budget pipeline — `context-limits.ts` (descriptor + calibration factor), `context-budget.ts` (budget + knobs), `context-assembly.ts` (selector + ordering), `task-loop.ts` (admission + emission + tool loop). Changes are additive/observability-first except §4A (a correctness fix) and §2 (tool admission), which are deliberate behavior changes. Rollout order: recency fix → instrumentation → knob split + config → tool scoping → rot-rot mechanism.

**Tech Stack:** TypeScript, tiktoken (`cl100k_base`/`o200k_base`), EventLog (append-only, `src/events/`), vitest. JSON state precedent: `src/adaptation/*-store.ts` + `~/.alix` home-dir convention.

## Global Constraints

- **GitNexus gates (ALiX repo):** `impact({target, direction:"upstream"})` BEFORE editing any symbol; `detect_changes()` before committing; surface HIGH/CRITICAL. Repo name is **ALiX**.
- **Branch:** work on `feat/context-manager-addendum` (already created; spec committed as e3ef8de8). No other branches open.
- **Suite before any push:** `pnpm build` FIRST, then `pnpm test:vitest` + `pnpm test:node` + `npx tsc --noEmit`. Node-lane has 11 pre-existing leaf failures (9× streamSSE + 2× agent-view) — never attribute them to this branch.
- **Spec constants (verbatim from `docs/superpowers/specs/2026-08-08-alix-context-manager-design.md`):**
  - `SAFETY_FACTOR = 1.2`; calibration factor clamped to `[0.8, 2.0]`; burn-in `200 req/provider` or `7 days`, whichever first.
  - `policyReservation = clamp(floor(window × 0.20), 4096, 32768)`; `availableInputTokens = window − budgetReservation`.
  - §5 invariant: `requestedMaxOutputTokens ≤ budgetReservation` asserted at construction.
  - §2 guardrails: shed-tool retries **once, not per-call**; re-scope is **additive-only within a turn** (one tool schema, not a re-classification).
- **§6 is mechanism-only this cycle:** `contextRotThreshold` lives in `~/.alix/calibration.json`, **unset by default** — no hardcoded number; advisory `context.rot_risk` emission fires only when a threshold is configured (burn-in data does not exist during this cycle).

---

### Task 1: §4 Part A — Recency fix (flip T4/T5 admission order)

**Files:**
- Modify: `src/config/context-assembly.ts` (best-effort loop, ~lines 192-201)
- Modify: `tests/context/context-assembly.vitest.ts` (4 tests inverted by the fix)

**Interfaces:**
- Consumes: `assembleContext(candidate, budget)` — unchanged signature.
- Produces: `assembleContext` admits T4 (`recent_conversation`) and T5 (`recent_tool_results`) **newest-first** (reverse bucket iteration); T6 (`older_context`) stays chronological. Wire order unchanged (`reconstructRequest` re-sorts by source index).

**Context.** The tier selector preserves bucket source order, which is chronological (index 0 = oldest, from `classifyCandidateContext`). So under pressure the *oldest* T4/T5 items survive — in tiers literally named "recent". §4A reverses admission for T4/T5 so the *newest* items survive pressure. `reconstructRequest` (task-loop.ts:1445) re-sorts by `msg-<i>`, so conversation chronology on the wire is unaffected — only admission priority changes.

- [ ] **Step 1: Write failing tests** (update the inverted tests + add a recency-specific one)

In `tests/context/context-assembly.vitest.ts`, update the tests that asserted source-order preservation — they now assert newest-first:

```ts
it("preserves source order within a tier", () => {
  const candidate = [
    item("recent_conversation", 10, { id: "b" }),
    item("recent_conversation", 10, { id: "a" }),
    item("recent_conversation", 10, { id: "c" }),
  ];
  const result = assembleContext(candidate, budget(1_000));
  expect(result.admitted.map((i) => i.id)).toEqual(["c", "a", "b"]);
});
```

```ts
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
```

Update the remaining two inverted tests:

```ts
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
```

```ts
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
```

**Also update the comment on the T6 test** (line ~143) — it must now explicitly say T6 stays chronological because it is `older_context`, not because "source order is preserved" generically.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/context/context-assembly.vitest.ts`
Expected: FAIL — the updated assertions (`["c","a","b"]`, `["sys","c","b"]`, `["medium"]`, recency-position) fail against current source-order behavior. The T6 test (`["large","small"]`) still PASSES.

- [ ] **Step 3: Implement the minimal fix**

In `src/config/context-assembly.ts`, replace the best-effort loop (currently iterating `items` in source order):

```ts
// Tiers 4–6 best-effort: skip-and-continue within the tier.
// §4 Part A: T4 (recent_conversation) and T5 (recent_tool_results) admit
// NEWEST-first — reverse the bucket so the most recent items survive budget
// pressure. T6 (older_context) stays chronological. Wire order is preserved
// by reconstructRequest's source-index re-sort, so only admission priority
// changes (never conversation chronology).
const itemsInAdmissionOrder =
  category === "recent_conversation" || category === "recent_tool_results"
    ? [...items].reverse()
    : items;
for (const item of itemsInAdmissionOrder) {
  if (item.tokens <= remaining) {
    admitted.push(item);
    remaining -= item.tokens;
  } else {
    dropped.push({ item, reason: "budget_exhausted" });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/context/context-assembly.vitest.ts`
Expected: PASS (all updated + T6 unchanged).

- [ ] **Step 5: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`
Expected: build + tsc clean; vitest green (node-lane baseline ignored here).

```bash
git add src/config/context-assembly.ts tests/context/context-assembly.vitest.ts
git commit -m "fix(context): admit T4/T5 newest-first under budget pressure

Reverse recent_conversation/recent_tool_results bucket iteration in
assembleContext so the most recent items survive pressure instead of the
oldest. reconstructRequest re-sorts by source index, so wire chronology is
unchanged. T6 older_context stays chronological. (spec §4 Part A)"
```

---

### Task 2: §3 — `contextPressure` on `RunResult` + EventLog join

**Files:**
- Modify: `src/run.ts` (`RunResult` + `ContextPressure` types)
- Create: `src/run/context-pressure.ts` (pure tracker)
- Modify: `src/run/task-loop.ts` (tracker wiring + return sites)
- Test: `tests/run/context-pressure.vitest.ts` (new)
- Modify: `tests/run/task-loop-context-budget.vitest.ts` (integration assertion)

**Interfaces:**
- Consumes: `AssembledContext` (`dropped`, `remainingTokens`) from `context-assembly.ts`; `RunResult` from `run.ts`.
- Produces: `ContextPressure` type (below); `createContextPressureTracker()` returning `{ record(iteration, assembled), snapshot() }`.

**Context.** Assembly runs once per iteration inside `runTaskLoop`'s loop; `RunResult` is returned from 8 sites (helpers + inline). The spec chose **aggregate + peak**: aggregate = summed T4/T5/T6 drops + min `remainingTokens` across the run; peak = the single highest-pressure iteration with its `iteration` index. `iterationsSincePeak = totalIterations − peak.iteration` is derived free. Chosen over "final iteration" because for a `stuck_repeating_tools` run the final iteration is often cleanest.

**Design.** `ContextPressure` schema (spec §3, peak-variant):

```ts
// src/run.ts
export type ContextPressure = {
  aggregate: {
    tier4Dropped: number;
    tier5Dropped: number;
    tier6Dropped: number;
    minRemainingTokens: number;
  };
  peak: {
    iteration: number;
    tier4Dropped: number;
    tier5Dropped: number;
    tier6Dropped: number;
    remainingTokens: number;
  };
  totalIterations: number; // enables iterationsSincePeak = totalIterations − peak.iteration
};
```

Add `contextPressure?: ContextPressure` to `RunResult` (optional — non-terminal returns and legacy callers still typecheck).

- [ ] **Step 1: Write failing tests** for the pure tracker

Create `tests/run/context-pressure.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createContextPressureTracker } from "../../src/run/context-pressure.js";
import type { AssembledContext } from "../../src/config/context-assembly.js";

function assembled(overrides: Partial<AssembledContext> = {}): AssembledContext {
  return {
    admitted: [],
    dropped: [],
    admittedTokens: 0,
    droppedTokens: 0,
    mandatoryTokens: 0,
    protectedTokens: 0,
    remainingTokens: 100,
    ...overrides,
  } as AssembledContext;
}
function dropItem(category: "recent_conversation" | "recent_tool_results" | "older_context") {
  return { item: { category, tokens: 10 } as never, reason: "budget_exhausted" as const };
}

describe("contextPressure tracker — aggregate + peak", () => {
  it("aggregates tier drops across iterations and tracks min remainingTokens", () => {
    const t = createContextPressureTracker();
    t.record(0, assembled({ dropped: [dropItem("recent_conversation"), dropItem("recent_conversation")], remainingTokens: 40 }));
    t.record(1, assembled({ dropped: [dropItem("recent_tool_results")], remainingTokens: 80 }));
    const s = t.snapshot();
    expect(s.aggregate.tier4Dropped).toBe(2);
    expect(s.aggregate.tier5Dropped).toBe(1);
    expect(s.aggregate.tier6Dropped).toBe(0);
    expect(s.aggregate.minRemainingTokens).toBe(40);
  });

  it("records the peak as the highest-drop iteration, with its iteration index", () => {
    const t = createContextPressureTracker();
    t.record(0, assembled({ dropped: [dropItem("recent_conversation")], remainingTokens: 90 }));
    t.record(1, assembled({ dropped: [dropItem("recent_tool_results"), dropItem("older_context")], remainingTokens: 30 }));
    const s = t.snapshot();
    expect(s.peak.iteration).toBe(1);
    expect(s.peak.tier4Dropped).toBe(0);
    expect(s.peak.tier5Dropped).toBe(1);
    expect(s.peak.tier6Dropped).toBe(1);
    expect(s.peak.remainingTokens).toBe(30);
  });

  it("exposes totalIterations so iterationsSincePeak is derivable", () => {
    const t = createContextPressureTracker();
    t.record(0, assembled({}));
    t.record(1, assembled({ dropped: [dropItem("older_context")], remainingTokens: 10 }));
    const s = t.snapshot();
    expect(s.totalIterations).toBe(2);
    expect(s.totalIterations - s.peak.iteration).toBe(1); // iterationsSincePeak
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/run/context-pressure.vitest.ts`
Expected: FAIL — module `context-pressure.js` does not exist.

- [ ] **Step 3: Implement the tracker**

Create `src/run/context-pressure.ts`:

```ts
import type { AssembledContext } from "../config/context-assembly.js";
import type { ContextPressure } from "../run.js";

export function createContextPressureTracker() {
  let tier4Dropped = 0;
  let tier5Dropped = 0;
  let tier6Dropped = 0;
  let minRemainingTokens = Infinity;
  let totalIterations = 0;
  let peak: ContextPressure["peak"] | undefined;
  let peakScore = -1;

  function record(iteration: number, assembled: AssembledContext): void {
    totalIterations = Math.max(totalIterations, iteration + 1);
    const t4 = assembled.dropped.filter((d) => d.item.category === "recent_conversation").length;
    const t5 = assembled.dropped.filter((d) => d.item.category === "recent_tool_results").length;
    const t6 = assembled.dropped.filter((d) => d.item.category === "older_context").length;
    tier4Dropped += t4;
    tier5Dropped += t5;
    tier6Dropped += t6;
    if (assembled.remainingTokens < minRemainingTokens) minRemainingTokens = assembled.remainingTokens;
    const score = t4 + t5 + t6;
    if (score > peakScore) {
      peakScore = score;
      peak = { iteration, tier4Dropped: t4, tier5Dropped: t5, tier6Dropped: t6, remainingTokens: assembled.remainingTokens };
    }
  }

  function snapshot(): ContextPressure {
    return {
      aggregate: {
        tier4Dropped,
        tier5Dropped,
        tier6Dropped,
        minRemainingTokens: minRemainingTokens === Infinity ? 0 : minRemainingTokens,
      },
      peak: peak ?? { iteration: 0, tier4Dropped: 0, tier5Dropped: 0, tier6Dropped: 0, remainingTokens: 0 },
      totalIterations,
    };
  }

  return { record, snapshot };
}
```

**Note on peak tie-breaking:** highest drop total wins; on a tie the **first** reaching it wins (stable, deterministic — `score > peakScore`, not `>=`). Document this in a comment.

- [ ] **Step 4: Run tracker tests to verify they pass**

Run: `pnpm vitest run tests/run/context-pressure.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tracker into runTaskLoop**

In `src/run/task-loop.ts`:
1. Import `createContextPressureTracker` from `./context-pressure.js`.
2. Near the top of `runTaskLoop` (after the `deps` destructure, ~line 312): `const contextPressure = createContextPressureTracker();`.
3. After each successful assembly — inside the try at line 482, right after `assembled = assembleContext(...)` — add `contextPressure.record(i, assembled);`.
4. Attach `contextPressure: contextPressure.snapshot()` to **every terminal `RunResult` return**. The sites (by line, may drift): the `completeSession` helper return (line 78), research returns (736, 741), verified return (814), plain return (849), rejected-scope return (951), repair-limit return (1240), overflow return (1311). Also pass the snapshot into `completeSession`'s return.

**Cleanest wiring:** give `completeSession` an optional `contextPressure` param (defaulting to `undefined`) and include it in its returned object:

```ts
async function completeSession(/* ... */, contextPressure?: ContextPressure): Promise<RunResult> {
  // ...
  return {
    sessionId, summary, streamed,
    ...(reason ? { reason: reason as RunResult["reason"] } : {}),
    ...(contextPressure ? { contextPressure } : {}),
  };
}
```

Pass `contextPressure.snapshot()` at each `completeSession` call (869, 1134, 1176, 1297) and add `contextPressure: contextPressure.snapshot()` inline at the non-completeSession returns (736, 741, 814, 849, 951, 1240, 1311).

5. **EventLog persistence (spec: "persist it in the EventLog record alongside the reason"):** add `contextPressure` to the `session.ended` payload in `completeSession`:

```ts
await log.append({
  ...session, actor: "system", type: eventType,
  payload: { reason, summary, ...(contextPressure ? { contextPressure } : {}) },
});
```

- [ ] **Step 6: Add an integration assertion** to `tests/run/task-loop-context-budget.vitest.ts`

Reuse its existing mock-provider harness. Add a test that a reducible-overflow run (tight budget forces T5/T6 drops) returns a `RunResult` whose `contextPressure.aggregate.tier5Dropped > 0` (or `tier4Dropped`/`tier6Dropped` as appropriate for the fixture), and whose `totalIterations ≥ 1`.

```ts
it("returns contextPressure on the RunResult when the run drops context items", async () => {
  const result = await runTaskLoop(makeTightBudgetDeps()); // tight budget → drops
  expect(result.contextPressure).toBeDefined();
  expect(result.contextPressure!.totalIterations).toBeGreaterThanOrEqual(1);
  // At least one drop across T4/T5/T6 for a tight-budget run:
  const agg = result.contextPressure!.aggregate;
  expect(agg.tier4Dropped + agg.tier5Dropped + agg.tier6Dropped).toBeGreaterThan(0);
});
```

- [ ] **Step 7: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/run.ts src/run/context-pressure.ts src/run/task-loop.ts tests/run/context-pressure.vitest.ts tests/run/task-loop-context-budget.vitest.ts
git commit -m "feat(context): contextPressure aggregate+peak on RunResult + EventLog

Tag every terminal RunResult with aggregate+peak context pressure (tier4/5/6
drops, min remaining, peak iteration) and persist it alongside reason in the
session.ended payload. iterationsSincePeak derivable from totalIterations.
Pure instrumentation — no admission behavior change. (spec §3)"
```

---

### Task 3: §1 — `token.calibration` event logging (+ raw token tracking)

**Files:**
- Modify: `src/events/types.ts` (`CONTEXT_EVENT_TYPES` + payload type)
- Modify: `src/config/context-assembly.ts` (`CandidateContextItem.rawTokens`, `AssembledContext.admittedRawTokens`)
- Modify: `src/run/task-loop.ts` (populate rawTokens; emit `token.calibration`)
- Modify: `tests/context/context-assembly.vitest.ts` (fixture gains rawTokens)
- Test: `tests/events/token-calibration.vitest.ts` (new)

**Interfaces:**
- Consumes: `estimateBudgetTokens`/`estimateMessageBudgetTokens` already return `{ rawEstimate, budgetEstimate, ... }` (utils/tokens.ts). `CandidateContextItem` currently carries only padded `tokens`.
- Produces: `CandidateContextItem.rawTokens` (unpadded base estimate); `AssembledContext.admittedRawTokens`; EventLog event `token.calibration` with `{ invocationId, provider, model, estimated_raw, estimated_padded, actual }`.

**Context.** Every provider response already returns actual usage (`TokenUsage.inputTokens`, providers/types.ts:123), and `model.usage` is already emitted at task-loop.ts:657-659. The calibration event compares our **estimated** raw+padded against **actual** — keyed by the same `invocationId` as `context.snapshot.created`. To log `estimated_raw`, the assembly must carry the unpadded estimate (currently discarded after `budgetEstimate` is stored).

- [ ] **Step 1: Write failing tests** for raw-token tracking + event emission

**Test A — rawTokens threaded through assembly** (update fixture, then assert):

In `tests/context/context-assembly.vitest.ts`, update the `item()` fixture to set `rawTokens`:

```ts
function item(
  category: CandidateContextItem["category"],
  tokens: number,
  overrides: { id?: string; kind?: string; rawTokens?: number; provenance?: Partial<ContextItemProvenance> } = {}
): CandidateContextItem {
  // ... existing body, plus:
  rawTokens: overrides.rawTokens ?? tokens,
}
```

Add a test:

```ts
it("tracks admittedRawTokens separately from padded admittedTokens", () => {
  const candidate = [
    item("recent_conversation", 60, { id: "conv", rawTokens: 50 }),
    item("recent_tool_results", 30, { id: "tools", rawTokens: 25 }),
  ];
  const result = assembleContext(candidate, budget(100));
  expect(result.admittedTokens).toBe(90);
  expect(result.admittedRawTokens).toBe(75);
});
```

**Test B — `token.calibration` event emitted** (new file `tests/events/token-calibration.vitest.ts`, modeled on the mock-provider harness in `task-loop-context-budget.vitest.ts`):

```ts
it("emits token.calibration with estimated vs actual per request", async () => {
  const { log, sessionId } = await runOnceWithProvider(); // mock provider returns usage.inputTokens = 42
  const events = await log.readAll();
  const cal = events.find((e) => e.type === "token.calibration");
  expect(cal).toBeDefined();
  const p = cal!.payload as Record<string, unknown>;
  expect(typeof p.estimated_raw).toBe("number");
  expect(typeof p.estimated_padded).toBe("number");
  expect(p.actual).toBe(42);
  expect(typeof p.invocationId).toBe("string");
  expect(p.provider).toBe("mock");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/context/context-assembly.vitest.ts tests/events/token-calibration.vitest.ts`
Expected: FAIL — `rawTokens` not on type, `admittedRawTokens` missing, no `token.calibration` event.

- [ ] **Step 3: Implement raw-token tracking**

In `src/config/context-assembly.ts`:
1. Add to `CandidateContextItem`: `readonly rawTokens: number;` (with a comment: unpadded base tokenizer estimate; admission reads only `tokens`, `rawTokens` is calibration telemetry).
2. Add to `AssembledContext`: `readonly admittedRawTokens: number;`.
3. In `assembleContext`, track `let admittedRawTokens = 0;` and add `item.rawTokens` when admitting (both mandatory and best-effort paths). Return it in the frozen result.

- [ ] **Step 4: Implement calibration event emission**

In `src/run/task-loop.ts`:
1. Populate `rawTokens` on the system-prompt + message candidate items (from `meta.rawEstimate` / `sysMeta.rawEstimate` in `classifyCandidateContext`, ~lines 1377-1419). Populate it on the tool-schema reservation items (lines 429-448) from `estimateBudgetTokens(...).rawEstimate`.
2. In `src/events/types.ts`, add to `CONTEXT_EVENT_TYPES`:

```ts
TOKEN_CALIBRATION: "token.calibration",
```

And a payload type:

```ts
export type TokenCalibrationPayload = {
  invocationId: string;
  provider: string;
  model: string;
  /** Unpadded base tokenizer estimate of the admitted request. */
  estimated_raw: number;
  /** Padded budget-admission estimate of the admitted request. */
  estimated_padded: number;
  /** Actual provider-reported input tokens (usage.inputTokens). */
  actual: number;
};
```

3. In `task-loop.ts`, inside the same scope as the `model.usage` emission (after line 659), emit:

```ts
if (usage) {
  await log.append({
    ...session, actor: "system", type: CONTEXT_EVENT_TYPES.TOKEN_CALIBRATION,
    payload: {
      invocationId,
      provider: config.model.provider,
      model: config.model.name,
      estimated_raw: assembled.admittedRawTokens,
      estimated_padded: assembled.admittedTokens,
      actual: usage.inputTokens,
    } satisfies TokenCalibrationPayload,
  });
}
```

Import `CONTEXT_EVENT_TYPES` and `TokenCalibrationPayload` in task-loop.ts.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/context/context-assembly.vitest.ts tests/events/token-calibration.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Update event-contract doc count**

In `src/runtime/contracts/event-contract.ts` (~line 107), bump the Context table row: `| Context | CONTEXT_EVENT_TYPES | 6 |`.

- [ ] **Step 7: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/events/types.ts src/config/context-assembly.ts src/run/task-loop.ts src/runtime/contracts/event-contract.ts tests/context/context-assembly.vitest.ts tests/events/token-calibration.vitest.ts
git commit -m "feat(context): token.calibration event logging + raw token tracking

Emit token.calibration per model-facing request keyed by invocationId, logging
estimated_raw (unpadded base), estimated_padded, and actual usage. Thread
rawTokens through CandidateContextItem and admittedRawTokens through
AssembledContext. Pure observation — no admission change. (spec §1)"
```

---

### Task 4: §1 — Calibration store + per-provider factor (default 1.2 until burn-in)

**Files:**
- Create: `src/config/calibration-store.ts`
- Modify: `src/config/context-limits.ts` (`providerCalibration` map, `getCalibrationFactor`)
- Modify: `src/config/context-budget.ts` (accept `safetyFactor` in options, use in reserved math if needed — see note)
- Modify: `src/utils/tokens.ts` (accept `safetyFactor` param, default `SAFETY_FACTOR`)
- Test: `tests/config/calibration-store.vitest.ts` (new)

**Interfaces:**
- Consumes: `SAFETY_FACTOR` (context-limits.ts); `homedir()` + `.alix` convention (skill-install-history.ts:42 precedent).
- Produces: `calibrationStorePath(storeDir?)`, `loadCalibration(storeDir?)`, `saveCalibration(data, storeDir?)`, `deriveCalibrationFactor(samples)`, `getCalibrationFactor(provider, calibration?)`, `CalibrationData` type.

**Context.** Per-provider calibration replaces the global 1.2 **after** a burn-in window (200 req/provider or 7 days). During this cycle no burn-in data exists, so the factor defaults to 1.2 and behavior is unchanged — the *mechanism* ships. Persist to `~/.alix/calibration.json` with a `storeDir` override for test HOME-isolation (same pattern as `skill-install-history.ts`).

- [ ] **Step 1: Write failing tests** (new `tests/config/calibration-store.vitest.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCalibration, saveCalibration, deriveCalibrationFactor, getCalibrationFactor } from "../../src/config/calibration-store.js";

describe("calibration store", () => {
  it("defaults to a 1.2 factor when no calibration exists", () => {
    expect(getCalibrationFactor("anthropic", undefined)).toBe(1.2);
  });

  it("round-trips a calibration file through a temp store dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cal-store-"));
    await saveCalibration({ providerCalibration: { anthropic: 1.3 } }, dir);
    const loaded = await loadCalibration(dir);
    expect(loaded.providerCalibration?.anthropic).toBe(1.3);
  });

  it("derives p95 of actual/raw ratios and clamps to [0.8, 2.0]", () => {
    // ratios: 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 5.0
    const samples = [1.0,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0,5.0].map((r) => ({ actual: r * 100, raw: 100 }));
    expect(deriveCalibrationFactor(samples)).toBeLessThanOrEqual(2.0);
    expect(deriveCalibrationFactor(samples)).toBeGreaterThanOrEqual(0.8);
    expect(deriveCalibrationFactor([{ actual: 50, raw: 100 }])).toBe(0.5); // clamped up to 0.8? see note
  });
});
```

**Note on the last assertion:** the clamp floor is 0.8 — so a ratio of 0.5 clamps **up** to 0.8. Adjust the assertion to `0.8`. (Clamping protects against pathological burn-in samples in both directions.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config/calibration-store.vitest.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the store**

Create `src/config/calibration-store.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SAFETY_FACTOR } from "./context-limits.js";

export const CALIBRATION_CLAMP = { min: 0.8, max: 2.0 } as const;

export type CalibrationData = {
  /** provider → calibration factor (p95(actual/raw), clamped). */
  providerCalibration?: Record<string, number>;
  /** §6: learned context-rot threshold — UNSET this cycle. */
  contextRotThreshold?: unknown;
  lastRecalibrated?: string;
  sampleCounts?: Record<string, number>;
};

export function calibrationStorePath(storeDir?: string): string {
  return join(storeDir ?? join(homedir(), ".alix"), "calibration.json");
}

export async function loadCalibration(storeDir?: string): Promise<CalibrationData> {
  try {
    const raw = readFileSync(calibrationStorePath(storeDir), "utf8");
    return JSON.parse(raw) as CalibrationData;
  } catch {
    return {};
  }
}

export async function saveCalibration(data: CalibrationData, storeDir?: string): Promise<void> {
  const path = calibrationStorePath(storeDir);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** p95 of actual/raw ratios, clamped to [0.8, 2.0]. Deterministic. */
export function deriveCalibrationFactor(samples: ReadonlyArray<{ actual: number; raw: number }>): number {
  if (samples.length === 0) return SAFETY_FACTOR;
  const ratios = samples.map((s) => (s.raw > 0 ? s.actual / s.raw : SAFETY_FACTOR)).sort((a, b) => a - b);
  const idx = Math.min(ratios.length - 1, Math.floor(0.95 * ratios.length));
  const p95 = ratios[Math.max(0, idx)]!;
  return Math.min(CALIBRATION_CLAMP.max, Math.max(CALIBRATION_CLAMP.min, p95));
}

/** Resolve a provider's calibration factor, defaulting to 1.2 until burn-in
 *  data exists. */
export function getCalibrationFactor(provider: string, calibration?: CalibrationData): number {
  return calibration?.providerCalibration?.[provider] ?? SAFETY_FACTOR;
}
```

**Note on the `Math.floor(0.95 * ratios.length)` index:** with 12 samples, idx = floor(11.4) = 11 → the max. p95 by this definition = the 95th-percentile position. Verify against the spec's intent ("p95(actual / estimated_raw)") and adjust the index formula to `Math.ceil(0.95 * n) - 1` if your reading differs — document the chosen convention in a comment.

- [ ] **Step 4: Thread the factor into the estimators**

In `src/utils/tokens.ts`, change `estimateBudgetTokens` and `estimateMessageBudgetTokens` to accept an optional factor (default `SAFETY_FACTOR`), so `budgetEstimate = ceil(raw × factor)` uses the per-provider factor when the caller provides it:

```ts
export async function estimateBudgetTokens(
  text: string | unknown[],
  tokenizer: TokenizerName,
  safetyFactor: number = SAFETY_FACTOR
): Promise<EstimationMetadata> {
  await ensureEncoder(tokenizer);
  const rawEstimate = estimateTokens(text, tokenizer);
  return { tokenizer, rawEstimate, safetyFactor, budgetEstimate: Math.ceil(rawEstimate * safetyFactor) };
}
```

(and analogously for `estimateMessageBudgetTokens`).

**Wiring scope note:** the spec says "Replace the single SAFETY_FACTOR constant with a providerCalibration map". Full wiring — resolving `getCalibrationFactor(provider)` at `runTaskCore`/`agent-loop.ts` and passing it into `classifyCandidateContext` + the tool-schema reservations — is **deferred to the burn-in cycle** because no calibration data exists yet; this task delivers the mechanism (store + derivation + optional factor param) with default 1.2 preserving current behavior. Document this explicitly in the commit.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/config/calibration-store.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/config/calibration-store.ts src/config/context-limits.ts src/utils/tokens.ts tests/config/calibration-store.vitest.ts
git commit -m "feat(context): calibration store + per-provider factor (defaults to 1.2)

Add ~/.alix/calibration.json persistence, p95(actual/raw) derivation clamped to
[0.8, 2.0], and getCalibrationFactor(provider) defaulting to SAFETY_FACTOR until
burn-in data exists. Estimators accept an optional per-provider factor. No
behavior change until calibration data lands. (spec §1)"
```

---

### Task 5: §5 — Split `reservedOutputTokens` into `budgetReservation` + `requestedMaxOutputTokens`

**Files:**
- Modify: `src/config/context-budget.ts` (interface + factory + invariant + `maxOutputTokens` config)
- Modify: `src/config/schema.ts` + `src/config/validator.ts` (config key)
- Modify: `src/run/task-loop.ts` (consumers: event payload + `maxOutputTokens`)
- Modify: `src/tui/runtime/metrics-projection.ts` (payload reader)
- Modify: `src/events/types.ts` (`ContextBudgetComputedPayload`)
- Modify: `tests/context/context-assembly.vitest.ts` (fixture `budget()`)
- Modify: `tests/run/task-loop-context-budget.vitest.ts` (fixtures/assertions)

**Interfaces:**
- Consumes: `ContextBudget` consumers (`reservedOutputTokens`) — enumerated in Context section.
- Produces: `ContextBudget` with `budgetReservation` + `requestedMaxOutputTokens` (replaces `reservedOutputTokens`); `ContextBudgetConfig.maxOutputTokens?: number`; invariant `requestedMaxOutputTokens ≤ budgetReservation` asserted at construction.

**Context.** `reservedOutputTokens` is currently both (a) the input-budget reservation and (b) the `maxOutputTokens` sent to the provider. Consumers: `context-budget.ts:75-115`, `task-loop.ts:471` (BUDGET_COMPUTED payload) + `:594,605` (`maxOutputTokens`), `metrics-projection.ts:29,103-106,137`, `events/types.ts:412`, and the `budget()` fixture in `context-assembly.vitest.ts:19-26`. This task decouples them: `budgetReservation` keeps the clamp formula and feeds `availableInputTokens`; `requestedMaxOutputTokens` is what the provider receives, defaulting to `budgetReservation` (behavior preserved), independently configurable via `context.budget.maxOutputTokens`, clamped `≤ budgetReservation`.

- [ ] **Step 1: Write failing tests**

**In `tests/run/task-loop-context-budget.vitest.ts`** add:

```ts
it("sends requestedMaxOutputTokens (defaults to budgetReservation) as maxOutputTokens", async () => {
  const deps = makeDeps(); // records the request it receives
  await runTaskLoop(deps);
  const req = deps.lastRequest!;
  expect(req.maxOutputTokens).toBeDefined();
  expect(req.maxOutputTokens).toBeGreaterThan(0);
});
```

**In `tests/context/context-assembly.vitest.ts`** — update the `budget()` fixture to the new shape:

```ts
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
```

Add a §5-specific test in a new `tests/config/context-budget-knobs.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createContextBudget } from "../../src/config/context-budget.js";

const descriptor = { provider: "test", model: "m", contextWindowTokens: 64_000, tokenizer: "cl100k_base" as const, safetyFactor: 1.2 };

describe("createContextBudget — output-knob decoupling (§5)", () => {
  it("defaults requestedMaxOutputTokens to budgetReservation (behavior preserved)", () => {
    const b = createContextBudget(descriptor);
    expect(b.budgetReservation).toBe(12_800); // floor(64k×0.2)=12800
    expect(b.requestedMaxOutputTokens).toBe(12_800);
    expect(b.availableInputTokens).toBe(64_000 - 12_800);
  });

  it("clamps a configured maxOutputTokens to ≤ budgetReservation", () => {
    const b = createContextBudget(descriptor, { maxOutputTokens: 99_999 });
    expect(b.requestedMaxOutputTokens).toBeLessThanOrEqual(b.budgetReservation);
  });

  it("honors a smaller requestedMaxOutputTokens without changing input budget", () => {
    const b = createContextBudget(descriptor, { maxOutputTokens: 4_000 });
    expect(b.requestedMaxOutputTokens).toBe(4_000);
    expect(b.budgetReservation).toBe(12_800); // input reservation unchanged
    expect(b.availableInputTokens).toBe(64_000 - 12_800); // unchanged
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config/context-budget-knobs.vitest.ts`
Expected: FAIL — `budgetReservation`/`requestedMaxOutputTokens` don't exist on `ContextBudget`.

- [ ] **Step 3: Implement the split**

In `src/config/context-budget.ts`:

```ts
export interface ContextBudgetConfig {
  outputRatio?: number;
  outputFloor?: number;
  outputCap?: number;
  /** §5: requested max output tokens sent to the provider (clamped ≤
   *  budgetReservation). Defaults to budgetReservation (behavior preserved). */
  maxOutputTokens?: number;
}

export interface ContextBudget {
  readonly contextWindowTokens: number;
  /** Safety-margin reservation: availableInputTokens = window − budgetReservation. */
  readonly budgetReservation: number;
  /** maxOutputTokens sent to the provider (≤ budgetReservation invariant). */
  readonly requestedMaxOutputTokens: number;
  readonly availableInputTokens: number;
  readonly policyReservation: number;
}
```

Rewrite `createContextBudget`:

```ts
export function createContextBudget(descriptor, options = {}): ContextBudget {
  const ratio = options.outputRatio ?? DEFAULT_OUTPUT_RATIO;
  const floor = options.outputFloor ?? DEFAULT_OUTPUT_FLOOR;
  const cap = options.outputCap ?? DEFAULT_OUTPUT_CAP;
  const contextWindowTokens = descriptor.contextWindowTokens;
  const policyReservation = Math.min(Math.max(Math.floor(contextWindowTokens * ratio), floor), cap);
  const budgetReservation = Math.min(
    options.outputTokenLimit === undefined ? policyReservation : Math.min(policyReservation, options.outputTokenLimit),
    contextWindowTokens,
  );
  const requestedMaxOutputTokens = Math.min(
    options.maxOutputTokens ?? budgetReservation,
    budgetReservation, // invariant: never exceeds the reservation (can't cause overflow)
  );
  return Object.freeze({
    contextWindowTokens,
    budgetReservation,
    requestedMaxOutputTokens,
    availableInputTokens: contextWindowTokens - budgetReservation,
    policyReservation,
  });
}
```

- [ ] **Step 4: Update all consumers**

1. `src/config/schema.ts`: `ContextConfig.budget` already types as `ContextBudgetConfig` — no change needed (the new key rides along). 
2. `src/config/validator.ts`: add validation for `budget.maxOutputTokens` (positive integer, `≤` cap context if both set), mirroring the existing outputRatio/Floor/Cap block (~lines 66-83).
3. `src/run/task-loop.ts`:
   - Line 471 BUDGET_COMPUTED payload: `reservedOutputTokens: contextBudget.reservedOutputTokens` → `budgetReservation: contextBudget.budgetReservation, requestedMaxOutputTokens: contextBudget.requestedMaxOutputTokens`.
   - Lines 594/605: `maxOutputTokens: contextBudget.reservedOutputTokens` → `maxOutputTokens: contextBudget.requestedMaxOutputTokens`.
4. `src/events/types.ts` `ContextBudgetComputedPayload` (~line 412): replace `reservedOutputTokens: number` with `budgetReservation: number; requestedMaxOutputTokens: number;`.
5. `src/tui/runtime/metrics-projection.ts` (lines 29, 103-106, 137): read `budgetReservation` from the payload instead of `reservedOutputTokens` (rename field `ctxReservedOutput` → `ctxBudgetReservation`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/config/context-budget-knobs.vitest.ts tests/context/context-assembly.vitest.ts tests/run/task-loop-context-budget.vitest.ts`
Expected: PASS (fixtures updated, no legacy `reservedOutputTokens` references remain).

**Verify no `reservedOutputTokens` references remain:** `grep -rn "reservedOutputTokens" src/ tests/` should return only the historical doc comment in the factory header (update or remove it).

- [ ] **Step 6: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/config/context-budget.ts src/config/schema.ts src/config/validator.ts src/run/task-loop.ts src/events/types.ts src/tui/runtime/metrics-projection.ts tests/context/context-assembly.vitest.ts tests/config/context-budget-knobs.vitest.ts tests/run/task-loop-context-budget.vitest.ts
git commit -m "feat(context): decouple output reservation from requested max output

Split ContextBudget.reservedOutputTokens into budgetReservation (safety-margin,
feeds availableInputTokens) and requestedMaxOutputTokens (sent to provider,
defaults to budgetReservation, configurable via context.budget.maxOutputTokens).
Invariant requestedMax ≤ budgetReservation asserted at construction. Tuning
output length no longer changes the input budget. (spec §5)"
```

---

### Task 6: §4 Part B — `tierOrderingStrategy` explicit config

**Files:**
- Modify: `src/config/context-budget.ts` (config type + default)
- Modify: `src/config/context-assembly.ts` (consume strategy)
- Modify: `src/config/schema.ts` (optional — rides on `ContextBudgetConfig`)
- Test: `tests/context/context-assembly.vitest.ts`

**Interfaces:**
- Consumes: `ContextBudgetConfig` (context-budget.ts).
- Produces: `TierOrderingStrategy = 'recency' | 'recency-dedup' | 'relevance'`; `DEFAULT_TIER_ORDERING`; `assembleContext` accepts an optional `ordering` param.

**Context.** §4 Part B makes the ordering policy explicit/config-driven, preserving the Part A behavior by default. Only `recency` is implemented this cycle — `recency-dedup` (T5 superseded-result dedup) and `relevance` (T6 keyword overlap) are declared but **fall back to recency** until §3 evidence justifies them. This is "documentation + explicit-config first, algorithm change second (gated on §3 evidence)."

- [ ] **Step 1: Write failing tests**

In `tests/context/context-assembly.vitest.ts`:

```ts
it("applies recency ordering to T4/T5 when the strategy is explicit recency (default)", () => {
  const candidate = [
    item("recent_conversation", 10, { id: "oldest" }),
    item("recent_conversation", 10, { id: "newest" }),
  ];
  const result = assembleContext(candidate, budget(15));
  expect(result.admitted.map((i) => i.id)).toEqual(["newest"]);
});

it("reverts to chronological order when ordering is explicitly 'relevance' for T4 (declared, unimplemented → recency fallback documented)", () => {
  // With only 'recency' implemented, any other strategy preserves source order
  // (chronological) until a gated algorithm ships. This test pins the fallback.
  const candidate = [
    item("recent_conversation", 10, { id: "oldest" }),
    item("recent_conversation", 10, { id: "newest" }),
  ];
  const result = assembleContext(candidate, budget(15), { recent_conversation: "relevance" });
  expect(result.admitted.map((i) => i.id)).toEqual(["oldest"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/context/context-assembly.vitest.ts`
Expected: FAIL — `assembleContext` takes only 2 args; no ordering config exists.

- [ ] **Step 3: Implement**

In `src/config/context-budget.ts`:

```ts
export type TierOrderingStrategy = "recency" | "recency-dedup" | "relevance";

/** Explicit per-tier ordering policy (§4 Part B). Only 'recency' is
 *  implemented this cycle; 'recency-dedup' and 'relevance' are declared and
 *  fall back to chronological order until gated on §3 evidence. */
export type TierOrderingConfig = Partial<Record<ContextCategory, TierOrderingStrategy>>;

export const DEFAULT_TIER_ORDERING: TierOrderingConfig = {
  recent_conversation: "recency",
  recent_tool_results: "recency-dedup",
  older_context: "recency",
};
```

Add `tierOrdering?: TierOrderingConfig` to `ContextBudgetConfig`.

In `src/config/context-assembly.ts`, change `assembleContext` signature to `(candidate, budget, ordering: TierOrderingConfig = {})` and apply:

```ts
const strategyFor = (category: ContextCategory): TierOrderingStrategy =>
  ordering[category] ?? DEFAULT_TIER_ORDERING[category] ?? "recency";

// T4/T5: 'recency' (or the declared-but-unimplemented 'recency-dedup'/'relevance'
// fallback) admits newest-first. T6 'recency' is chronological (older_context).
const recencyFirst = strategyFor(category) !== undefined && category !== "older_context";
const itemsInAdmissionOrder = recencyFirst ? [...items].reverse() : items;
```

Keep the wire invariant unchanged (`reconstructRequest` re-sorts by source index).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/context/context-assembly.vitest.ts`
Expected: PASS (Task 1 tests still green — default ordering preserves the recency fix; new strategy test pins the fallback).

- [ ] **Step 5: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/config/context-budget.ts src/config/context-assembly.ts tests/context/context-assembly.vitest.ts
git commit -m "feat(context): explicit tierOrderingStrategy config

Expose per-tier ordering policy (recency/recency-dedup/relevance) with recency
defaults preserving the §4A fix. Only recency is implemented this cycle;
recency-dedup and relevance are declared and fall back to chronological until
gated on §3 contextPressure evidence. (spec §4 Part B)"
```

---

### Task 7: §2 — Tool scoping: T1a/T1b split + relevance filter + `fallback_full`

**Files:**
- Create: `src/config/tool-scoping.ts` (relevance filter)
- Modify: `src/run/task-loop.ts` (T1a/T1b split + filtered tool reservation + `tools` payload)
- Modify: `src/events/types.ts` (`tooling.scope.fallback_full` + `context.irreducible.tooling/content`)
- Modify: `src/run/event-handlers.ts` (`handleScopeExpansion` gains shed-tool awareness — Task 8)
- Test: `tests/config/tool-scoping.vitest.ts` (new)

**Interfaces:**
- Consumes: `ToolDef[]` (providers/types.ts), `DeferredToolEntry[]` (mcp/tool-deferral.ts), `classifyTask(task)` (task-classifier.ts).
- Produces: `CORE_TOOL_NAMES`, `scopeToolsByTask(tools, mcpTools, task, taskType) → { core, extended }`, `TOOLING_SCOPE_EVENTS`.

**Context.** All tool schemas (provider + MCP) are currently unshifted into Tier-1 mandatory (task-loop.ts:429-448) — all-or-nothing. §2 splits Tier 1 into T1a (core, always mandatory) + T1b (extended/MCP, scoped per task via a cheap deterministic relevance filter), and emits `tooling.scope.fallback_full` when the heuristic can't decide (fresh task, no signal → admit all + log it). If T1a+T1b+T2 still overflows, the irreducible overflow is a **distinct** signal: `context.irreducible.tooling` (tool bloat → re-scope) vs `context.irreducible.content` (task bloat → shrink task).

- [ ] **Step 1: Write failing tests** (new `tests/config/tool-scoping.vitest.ts`)

```ts
import { describe, it, expect } from "vitest";
import { CORE_TOOL_NAMES, scopeToolsByTask, type ScopedTools } from "../../src/config/tool-scoping.js";

const tool = (name: string, description = "generic") => ({ name, description, input_schema: { type: "object" as const, properties: {} } });
const mcp = (name: string, description = "generic", serverName = "server") => ({ name, execName: `mcp.${serverName}.${name}`, serverName, toolName: name, description });

describe("tool scoping — T1a/T1b split + relevance filter", () => {
  it("keeps core tools always-mandatory regardless of task", () => {
    const { core, extended } = scopeToolsByTask([tool("alix_shell_run"), tool("langfuse_query")], [], "unrelated task");
    expect(core.map((t) => t.name)).toContain("alix_shell_run");
    expect(extended.map((t) => t.name)).toContain("langfuse_query");
  });

  it("scopes extended tools by keyword overlap with the task", () => {
    const { extended } = scopeToolsByTask(
      [tool("alix_search_web", "search the web"), tool("langfuse_trace_export", "export langfuse traces")],
      [],
      "export the langfuse trace for this run"
    );
    expect(extended.map((t) => t.name)).toContain("langfuse_trace_export");
    expect(extended.map((t) => t.name)).not.toContain("alix_search_web");
  });

  it("includes MCP tools whose server/tool name or description matches the task", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcp("github_repos_list", "list repos on github", "github")],
      "list my github repos"
    );
    expect(extended.map((t) => t.name)).toContain("github_repos_list");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config/tool-scoping.vitest.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the filter**

Create `src/config/tool-scoping.ts`:

```ts
import type { ToolDef } from "../providers/types.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";

/** T1a — core, always-mandatory tools (task-invariant, small schemas). */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "alix_shell_run",
  "alix_file_read",
  "alix_file_write",
  "alix_patch_apply",
  "alix_patch_create",
  "alix_done",
]);

export type ScopedTools = {
  core: ToolDef[];
  extended: ToolDef[];
  fallbackFull: boolean; // true when the heuristic could not decide → admitted all + logged
};

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function toolSignals(desc: string, name: string): Set<string> {
  return new Set([...tokens(desc), ...tokens(name)]);
}

/** Deterministic, no-LLM relevance filter: keyword overlap between tool
 *  description/name/namespace and the task text. Cheap and reproducible. */
export function scopeToolsByTask(
  tools: ToolDef[],
  mcpTools: DeferredToolEntry[],
  task: string,
  _taskType?: string
): ScopedTools {
  const taskTokens = new Set(tokens(task));
  const all = [...tools, ...mcpTools.map((m) => ({ name: m.name, description: m.description, input_schema: m.input_schema ?? { type: "object", properties: {} } }))];

  const core: ToolDef[] = [];
  const extended: ToolDef[] = [];
  let matchedAny = false;

  for (const t of all) {
    if (CORE_TOOL_NAMES.has(t.name)) {
      core.push(t);
      continue;
    }
    const signals = toolSignals(t.description, t.name);
    const hit = [...signals].some((s) => s.length > 2 && taskTokens.has(s));
    if (hit) {
      matchedAny = true;
      extended.push(t);
    }
  }

  // Fallback: no match signal at all (fresh task / heuristic can't decide) →
  // admit everything, but log it so the miss is visible.
  if (extended.length === 0 && all.some((t) => !CORE_TOOL_NAMES.has(t.name))) {
    return { core, extended: all.filter((t) => !CORE_TOOL_NAMES.has(t.name)) as ToolDef[], fallbackFull: true };
  }

  return { core, extended, fallbackFull: false };
}
```

**Design note — recency fallback:** the spec's default policy is "admit tools used in the last N turns of the current run" then fall to full admission. This task implements the **keyword filter + full-admission fallback**; the recency-of-recent-turns refinement is deferred (needs message-history threading into the filter, and the `fallback_full` event makes the miss visible when it's wrong). Document this in the commit.

- [ ] **Step 4: Wire scoping into task-loop.ts**

In `runTaskLoop`, after `providerTools`/`mcpToolIndex` are available but **before** the tool-schema reservation (before line 429):

```ts
const { scopeToolsByTask } = await import("../config/tool-scoping.js");
const { core: coreTools, extended: extendedTools, fallbackFull } = scopeToolsByTask(providerTools, mcpToolIndex, task, taskType);
if (fallbackFull) {
  await log.append({
    ...session, actor: "system", type: CONTEXT_EVENT_TYPES.TOOLING_SCOPE_FALLBACK_FULL,
    payload: { provider: config.model.provider, model: config.model.name, reason: "no relevance signal; admitted all extended tools" },
  });
}
```

Replace the two tool-schema reservation `unshift` blocks (lines 429-448) so they reserve **core + extended only** (the scoped set), not all tools. The `tools` array sent to the provider (lines 593, 604) becomes `[...coreTools, ...extendedTools, ...mcpToolIndex]` — but see the shed-tool note in Task 8: shed tools are excluded from the wire, and a model call to one triggers re-scope.

- [ ] **Step 5: Add the event types**

In `src/events/types.ts`, add to `CONTEXT_EVENT_TYPES`:

```ts
TOOLING_SCOPE_FALLBACK_FULL: "tooling.scope.fallback_full",
TOOLING_SCOPE_REINTRODUCED: "tooling.scope.reintroduced",
```

Payload types:

```ts
export type ToolingScopeFallbackFullPayload = { provider: string; model: string; reason: string };
export type ToolingScopeReintroducedPayload = { invocationId: string; toolName: string; reason: "shed_tool_called" };
```

Update the event-contract doc Context row count (5 → 8) at the end of this task.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/config/tool-scoping.vitest.ts tests/run/task-loop-context-budget.vitest.ts`
Expected: PASS.

- [ ] **Step 7: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/config/tool-scoping.ts src/run/task-loop.ts src/events/types.ts src/runtime/contracts/event-contract.ts tests/config/tool-scoping.vitest.ts
git commit -m "feat(context): T1a/T1b tool scoping + relevance filter + fallback_full

Split mandatory tool schemas into core (always-admitted) and extended/MCP
(scoped per task by a deterministic keyword-overlap filter). Emit
tooling.scope.fallback_full when no relevance signal exists. Shed tools are
excluded from the wire; re-scope on call is Task 8. (spec §2)"
```

---

### Task 8: §2 — Shed-tool contract (reintroduce on call, retry once, additive-only)

**Files:**
- Modify: `src/run/task-loop.ts` (tool-execution loop ~919: shed-tool detection + re-scope)
- Modify: `src/run/event-handlers.ts` (`handleScopeExpansion` or a sibling shed-tool handler)
- Modify: `src/run.ts` (`RunOpts.boundTools` unchanged; new local state)
- Test: `tests/run/task-loop-shed-tool.vitest.ts` (new)

**Interfaces:**
- Consumes: `handleScopeExpansion` pattern (event-handlers.ts:81); `pendingScopeExpansion` retry state (event-handlers.ts:120-158); scoped tool set from Task 7.
- Produces: shed-tool re-scope handler; `tooling.scope.reintroduced` event; retry-once + additive-only enforcement.

**Context.** A shed tool is excluded from the request. If the model calls it anyway, the existing scope-expansion machinery (blocked-and-retriable) is the reuse target: detect the shed call → re-admit that **one** tool's schema (additive-only, not a re-classification) → retry the call **once** → log `tooling.scope.reintroduced`. Guardrails from the spec: retry once, not per-call; re-scope is additive-only within a turn. The `context.irreducible.tooling` vs `.content` distinction (Task 7) is what makes a post-scope overflow actionable.

- [ ] **Step 1: Write failing test** (new `tests/run/task-loop-shed-tool.vitest.ts`)

```ts
it("reintroduces a shed tool when the model calls it, retries once, and logs it", async () => {
  const deps = makeDeps(); // scopes out 'langfuse_trace_export'; model calls it in iteration 0
  const result = await runTaskLoop(deps);
  const events = await deps.log.readAll();
  const reintro = events.find((e) => e.type === "tooling.scope.reintroduced");
  expect(reintro).toBeDefined();
  expect((reintro!.payload as { toolName: string }).toolName).toBe("langfuse_trace_export");
  // the tool's schema was re-added to the request's tools for the retry:
  expect(deps.lastRequest!.tools!.some((t) => t.name === "langfuse_trace_export")).toBe(true);
  // retry-once guardrail: no unbounded loop (run terminates normally)
  expect(["completed", "completed_unverified", "max_iterations"].includes(result.reason ?? "completed")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/run/task-loop-shed-tool.vitest.ts`
Expected: FAIL — no shed-tool handling; the shed call falls into the invalid-tool path.

- [ ] **Step 3: Implement the shed-tool handler**

In `src/run/event-handlers.ts`, add a sibling to `handleScopeExpansion`:

```ts
/** §2 shed-tool contract: a tool scoped OUT of T1b is called by the model.
 *  Re-admit that ONE tool's schema (additive-only) so the call can be retried.
 *  Returns { handled, reintroduce, tool } — the caller re-adds the schema to
 *  the wire tools and retries the call once. */
export function handleShedToolCall(
  toolCall: ToolCall,
  scopedOutNames: Set<string>,
  fullRegistry: Array<ToolDef | DeferredToolEntry>
): { handled: boolean; reintroduce?: ToolDef | DeferredToolEntry } {
  if (!scopedOutNames.has(toolCall.name)) return { handled: false };
  const tool = fullRegistry.find((t) => t.name === toolCall.name);
  if (!tool) return { handled: false };
  return { handled: true, reintroduce: tool };
}
```

In `task-loop.ts`, inside the tool-execution loop (before/around `handleScopeExpansion` at line 928):

```ts
// §2 shed-tool contract: a scoped-out tool was called. Re-introduce its
// schema (additive-only), retry once, and log — mirroring scope-expansion
// retry semantics. Guardrail: retried ONCE per shed tool per run.
const shedResult = handleShedToolCall(toolCall, scopedOutNames, fullToolRegistry);
if (shedResult.handled && shedResult.reintroduce && !shedToolsRetried.has(toolCall.name)) {
  shedToolsRetried.add(toolCall.name);
  reintroducedTools.add(shedResult.reintroduce); // appended to the wire tools for the retry
  await log.append({
    ...session, actor: "system", type: CONTEXT_EVENT_TYPES.TOOLING_SCOPE_REINTRODUCED,
    payload: { invocationId, toolName: toolCall.name, reason: "shed_tool_called" },
  });
  messages.push({ role: "user", content: buildShedToolRetryMessage(toolCall) }); // tell the model the tool is now available
  continue; // retry the call with the tool admitted
}
```

Maintain `const shedToolsRetried = new Set<string>()` and `let reintroducedTools: Array<ToolDef|DeferredToolEntry> = []` in `runTaskLoop`, and append `reintroducedTools` to the `tools` array at lines 593/604 **for the retry iteration** (additive-only: never a full re-classification, never drops previously-admitted tools).

**If the shed tool is retried a second time** (the model calls it again), it falls through to the normal invalid-tool/error path — that's a normal tool-use failure, not a scoping failure (guardrail: retry once, not per-call).

- [ ] **Step 4: Wire the `context.irreducible.tooling` vs `.content` distinction**

In `task-loop.ts`, the preflight backstop (lines 535-569) and the `assembleContext` catch already emit `context.irreducible`. After Task 7, if the run is post-scoping (Task 7 wired) and the irreducible overflow's `byCategory` shows `mandatory_system_governance` dominated by tool-schema tokens, emit `context.irreducible.tooling`; otherwise `context.irreducible.content`. Add `kind: "tooling" | "content"` to the irreducible payload.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/run/task-loop-shed-tool.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/run/event-handlers.ts src/run/task-loop.ts src/events/types.ts tests/run/task-loop-shed-tool.vitest.ts
git commit -m "feat(context): shed-tool reintroduce-on-call, retry once, additive-only

When the model calls a tool scoped out by §2, re-admit its schema (one tool,
additive-only), retry the call once, and emit tooling.scope.reintroduced.
Second attempt falls through to the normal tool-error path (retry-once
guardrail). Distinguish context.irreducible.tooling vs .content. (spec §2)"
```

---

### Task 9: §6 — Context-rot threshold mechanism (advisory, unset by default)

**Files:**
- Modify: `src/config/calibration-store.ts` (`contextRotThreshold` field — already typed as `unknown`; tighten)
- Modify: `src/run/task-loop.ts` (advisory `context.rot_risk` emission)
- Modify: `src/events/types.ts` (`context.rot_risk` + payload)
- Modify: `src/runtime/contracts/event-contract.ts` (Context count)
- Test: `tests/config/calibration-store.vitest.ts` + a task-loop assertion

**Interfaces:**
- Consumes: `ContextPressure` (Task 2); `CalibrationData.contextRotThreshold` (Task 4).
- Produces: `context.rot_risk` advisory event (warning only — never a hard failure, never another overflow gate).

**Context.** The threshold is **learned from §3 burn-in data** — which does not exist this cycle. This task ships the *mechanism* only: a `contextRotThreshold` field (unset → no emission), and an advisory emission path that fires `context.rot_risk` when a run's realized `contextPressure` crosses a *configured* threshold. No number is hardcoded (spec explicitly rejects fixed-percentage and zero-drop-tolerance).

- [ ] **Step 1: Write failing tests**

In `tests/config/calibration-store.vitest.ts`:

```ts
it("stores an unset contextRotThreshold and does not emit rot_risk without one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cal-rot-"));
  await saveCalibration({}, dir); // no threshold configured
  const loaded = await loadCalibration(dir);
  expect(loaded.contextRotThreshold).toBeUndefined();
});
```

In `tests/run/task-loop-shed-tool.vitest.ts` or the context-pressure test:

```ts
it("does not emit context.rot_risk when no threshold is configured", async () => {
  const deps = makeDeps();
  await runTaskLoop(deps);
  const events = await deps.log.readAll();
  expect(events.some((e) => e.type === "context.rot_risk")).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/config/calibration-store.vitest.ts`
Expected: FAIL — `contextRotThreshold` not yet a named field / rot_risk emission path missing.

- [ ] **Step 3: Implement**

In `src/config/calibration-store.ts`, tighten the type:

```ts
export type ContextRotThreshold = {
  /** §3-derived inflection: threshold on contextPressure.aggregate.tier5Dropped
   *  (or remainingTokens as % of availableInputTokens) at which failure rate
   *  rises. UNSET until burn-in data exists. */
  metric: "tier5Dropped" | "remainingTokensPct";
  value: number;
  sampleSize: number;
  confidenceInterval?: [number, number];
  lastRecalibrated: string;
};
// CalibrationData.contextRotThreshold?: ContextRotThreshold;
```

In `task-loop.ts`, after the pressure tracker records the final iteration and before the terminal return, evaluate the advisory:

```ts
const threshold = calibration?.contextRotThreshold;
if (threshold) {
  const p = contextPressure.snapshot();
  const measured = threshold.metric === "tier5Dropped"
    ? p.aggregate.tier5Dropped
    : (p.aggregate.minRemainingTokens / contextBudget.availableInputTokens) * 100;
  if (measured >= threshold.value) {
    await log.append({
      ...session, actor: "system", type: CONTEXT_EVENT_TYPES.ROT_RISK,
      payload: {
        invocationId,
        metric: threshold.metric,
        measured,
        threshold: threshold.value,
        contextPressure: p,
      },
    });
  }
}
```

Add `ROT_RISK: "context.rot_risk"` to `CONTEXT_EVENT_TYPES` + a `ContextRotRiskPayload`, and bump the event-contract Context row to 9.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/config/calibration-store.vitest.ts tests/run/task-loop-shed-tool.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite + commit**

Run: `pnpm build && pnpm test:vitest && npx tsc --noEmit`

```bash
git add src/config/calibration-store.ts src/run/task-loop.ts src/events/types.ts src/runtime/contracts/event-contract.ts tests/config/calibration-store.vitest.ts tests/run/task-loop-shed-tool.vitest.ts
git commit -m "feat(context): context.rot_risk advisory emission (threshold unset)

Ship the §6 mechanism only: a ContextRotThreshold in calibration.json and an
advisory context.rot_risk event fired when a configured threshold is crossed.
Threshold is UNSET this cycle — burn-in data (spec §3) must derive it before
any number is hardcoded. Advisory only, never a hard gate. (spec §6)"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- §1 (calibration): Task 3 (event logging + raw tokens), Task 4 (store + factor). ✅
- §2 (tool scoping): Task 7 (T1a/T1b + filter + fallback_full), Task 8 (shed-tool contract + irreducible.tooling/content). ✅
- §3 (contextPressure): Task 2 (aggregate + peak + EventLog join). ✅
- §4 (ordering): Task 1 (Part A fix), Task 6 (Part B config). ✅ — split deliberately: Part A urgent+self-contained, Part B mechanical+no-urgency; their decoupled ship dates are intentional.
- §5 (knob split): Task 5. ✅
- §6 (threshold): Task 9 (mechanism, unset default, advisory only). ✅
- Rollout order preserved: fix (1) → instrumentation (2-3) → config (4-5-6) → scoping (7-8) → threshold mechanism (9). ✅

**2. Placeholder scan:** no TBD/TODO; every step has concrete code + a runnable test command. The §4B unimplemented strategies and §1 wiring-scope deferral are **explicit, documented scope decisions** (gated on §3 evidence / burn-in data), not placeholders.

**3. Type consistency:**
- `ContextPressure` (Task 2) shape matches Task 9's consumer (`aggregate.tier5Dropped`, `minRemainingTokens`, `availableInputTokens`). ✅
- `CandidateContextItem.rawTokens` + `AssembledContext.admittedRawTokens` (Task 3) consumed by `token.calibration` emission in the same task. ✅
- `budgetReservation`/`requestedMaxOutputTokens` (Task 5) replace `reservedOutputTokens` everywhere (fixtures, metrics-projection, payload type). ✅
- `scopedTools` (`core`/`extended`/`fallbackFull`) produced by Task 7, consumed by Task 8 (`scopedOutNames` from extended-exclusion). ✅
- `contextRotThreshold` typed in Task 4's `CalibrationData`, tightened in Task 9 — same field name. ✅

**4. Cross-task test hazards flagged:**
- Task 1 inverts 4 existing tests in `context-assembly.vitest.ts` — the fixture is centralized (`item()`), so Task 3's `rawTokens` addition is one edit + one new assertion.
- Task 5 updates the shared `budget()` fixture — Task 1/3 tests depend on it; do Task 5 last in its commit group, or run the assembly suite after.
- The `context.irreducible` event gains a `kind` field in Task 8 — Task 2's `contextPressure` emission and Task 9's `rot_risk` don't conflict, but the TUI `scroll-math.ts` renders `context.irreducible` (lines 169) — verify it tolerates the new field (it reads `e.kind`, unaffected).
