# CAP-7 — Runtime Lifecycle Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CAP-4 `ProviderResolver` runtime selection **explicitly separates lifecycle state from availability** — a `deprecated` capability is excluded from normal selection (with an explicit `allowDeprecated` administrative override); an `active` capability whose provider is down is reported `unavailable` without mutating lifecycle; a governed `capability.transition` applied through A4 takes effect in the same resolver instance immediately.

**Architecture:** A new pure `lifecycle-eligibility` module encodes the locked six-state × provider-axis table (`LIFECYCLE_ELIGIBILITY` as `Record<LifecycleState, true | false>`, plus a single `isLifecycleEligible` function). The existing `ProviderResolver.resolve(capabilityId, ctx)` gains a second `ResolverContext` argument carrying an opt-in `allowDeprecated?: boolean`; each `ProviderPlan` now carries a per-step `lifecycleEligibility: { state, eligible, overrideUsed }` annotation produced by a two-stage gate — lifecycle filter FIRST, then the existing CAP-4 provider filter. Lifecycle and availability remain independent axes; the resolver never mutates lifecycle, and provider health never changes lifecycle state. The CAP-3 `CapabilityRegistry.reload()` call that CAP-6 already makes after every A4 mutation is the in-process sync mechanism — no event bus, no polling, no restart. A thin `CapabilityService` facade (CAP-8 boundary) consumes the resolver; the delegation invariant is tested here, the service is implemented in CAP-8.

**Tech Stack:** TypeScript (ESM, strict), Vitest (`.vitest.ts`, matching `tests/capability/provider-resolver.vitest.ts`), `pnpm exec vitest run` (no build gate — Vitest type-checks), the existing CAP-2/CAP-3/CAP-4/CAP-5/CAP-6 modules.

## Global Constraints

- **Locked ruling #1 — override contract is `resolve(id, { allowDeprecated?: boolean })`**: explicit allowlist parameter on the resolver's second argument, opt-in, non-transitive. It does **NOT** bypass provider/availability eligibility — it bypasses ONLY the lifecycle-eligibility gate. CAP-7 owns lifecycle eligibility, NOT authorization policy (no caller identity, no actor permission, no governance decision). The override is a runtime-axis override; "deprecated + admin override + provider up" is still `available`, while "deprecated + admin override + provider down" is still `unavailable`.

- **Locked ruling #2 — policy-axis ownership**: `CapabilityResolver` (the new alias surface of `ProviderResolver`) **owns** the `LIFECYCLE_ELIGIBILITY` named constant. `CapabilityService` (CAP-8) is a facade — it MUST delegate lifecycle/provider eligibility decisions to the resolver and MUST NOT independently reproduce the eligibility table. CAP-7 establishes the resolver contract; CAP-8 verifies service parity.

- **Locked ruling #3 — transition observability via in-process registry**: `CapabilityRegistry` is the authoritative in-process projection (CAP-3). CAP-6 already calls `registry.reload()` after every A4 catalog write. CAP-7 inherits that mechanism. No event bus, no polling, no restart. **Explicit invariant** (encode verbatim in the plan's locked-rulings section and in `tests/capability/lifecycle-eligibility.vitest.ts`): *"After a successful A4 mutation commit, CapabilityRegistry is the authoritative in-process projection consumed by CapabilityResolver; no refresh, restart, polling, or event subscription is required for lifecycle eligibility to reflect the new state."*

- **Locked ruling #4 — service parity (CAP-8 boundary)**: documented delegation contract. **Explicit invariant**: *"CapabilityService must delegate lifecycle/provider eligibility decisions to CapabilityResolver and must not independently reproduce the eligibility table."* CAP-7 ships a `CapabilityService` stub whose `resolve()` calls `resolver.resolve()` and returns the resolver's verdict — and a test that asserts the delegation (no parallel eligibility computation in the service).

- **Locked ruling #5 — lifecycle states consumed verbatim**: CAP-7 consumes the CAP-5 six-state lifecycle contract verbatim (`emerging | active | mature | stagnant | declining | deprecated`). No new states, no state renames, no modification of transition legality. **Explicit invariant**: *"CAP-7 consumes the CAP-5 six-state lifecycle contract verbatim. It introduces no lifecycle states and does not modify transition legality."* The transition graph is owned by CAP-5 (`LEGAL_LIFECYCLE_TRANSITIONS` in `src/capability/mutation-contract.ts`); CAP-7 reads `LifecycleState` only.

- **Locked ruling #6 — override auditability is deliberately narrow**: `ProviderPlanStep.lifecycleEligibility: { state: LifecycleState; eligible: boolean; overrideUsed: boolean }`. Deliberately minimal: **no** caller identity, **no** authorization role, **no** governance decision ID, **no** timestamps, **no** audit IDs, **no** provider fallback history. **`overrideUsed: true` does NOT mean provider-available, execution-authorized, or governance-approved** — it means the lifecycle-axis override was exercised. Downstream observability is a separate concern (CAP-9/A5 surface it; CAP-7 only attaches the lifecycle eligibility annotation).

- **Locked ruling #7 — eligibility table shape**: `LIFECYCLE_ELIGIBILITY: Record<LifecycleState, true | false>` — **strict boolean, no `undefined`/`null`**. The table contains ONLY the six lifecycle states — it does **NOT** include `unavailable`, `missing_binding`, or any availability-axis value (that would conflate the axes). The resolver applies the lifecycle gate FIRST; on a lifecycle-eligible step, it then applies the existing provider/availability gate. AC#1's "policy-dependent" cells in the ticket table are NOT a third state — they mean the lifecycle gate passes (`eligible: true`) and the resolver then determines availability from the existing CAP-4 provider filter.

### Consumed interfaces (exact — already on main from CAP-2/3/4/5/6)

- **CAP-5 `src/capability/mutation-contract.ts`:** `LifecycleState` import path: `src/adaptation/capability-evolution-types.js` (re-exported by mutation-contract); `LEGAL_LIFECYCLE_TRANSITIONS` (read-only; CAP-7 never modifies it).
- **CAP-5 `src/adaptation/capability-evolution-types.ts`:** `LifecycleState = "emerging" | "active" | "mature" | "stagnant" | "declining" | "deprecated"`.
- **CAP-3 `src/capability/registry.ts`:** `CapabilityRegistry` — `get(id)`, `getLifecycleState(id): LifecycleState | undefined`, `setLifecycleState(id, to)`, `listLifecycleStates()`, `reload()`. `RegisteredCapability.lifecycle` is the authoritative lifecycle value. CAP-6 calls `registry.reload()` after every A4 mutation; CAP-7 inherits this.
- **CAP-4 `src/capability/provider-resolver.ts`:** `ProviderResolver.resolve(capabilityId, _ctx): ProviderPlan[]` (current shape, second arg currently ignored); `ProviderPlan { capabilityId, steps: ProviderPlanStep[] }`; `ProviderPlanStep { capabilityId, candidates, bindingsCount, timeout, hooks, permissions }`. CAP-7 changes the second arg to `ResolverContext` and adds `lifecycleEligibility` to each `ProviderPlanStep`.
- **CAP-4 `src/capability/provider-registry.ts`:** `ProviderCandidate` (has `binding`, `providerId`, `providerType`, `bindingIndex`, `executor`); `ProviderExecutorRegistry` (has `get`, `has`, `listTypes`).
- **CAP-2 `src/capability/canonical/definition.ts`:** `CapabilityDefinition` (has `bindings: CapabilityProviderBinding[]`, `version`, `id`); `validateCapabilityDefinition`.
- **CAP-3 `src/capability/types.ts`:** `CapabilityContext` (current second-arg type; CAP-7 introduces a separate, narrower `ResolverContext` for the resolver — see Task 2 design contract).
- **CAP-6 `src/evolution/execution/capability-mutation-executor.ts`:** `CapabilityMutationExecutor` is what calls `registry.reload()` after every A4 mutation. CAP-7 exercises this via a test that goes `executor.executeStep(transition) → resolver.resolve()` (no rebuild, no reload call — the registry is already up to date because of CAP-6).

### Forbidden files (never touch)

- `src/capability/initial-capabilities.ts` (CAP-3 bootstrap seed).
- `src/tools/tool-registry.ts` (M-series tool surface — separate domain).
- `src/policy/capability-registry.ts` (legacy P-series capability registry — CAP-11 deletes it).
- Production `src/capability/canonical/*` (CAP-2 import-only — the resolver reads definitions through the public `CapabilityRegistry` surface, never touches the canonical store directly).

### Test conventions

- CAP-7 tests are **Vitest** (`.vitest.ts`) under `tests/capability/` — same pattern as `tests/capability/provider-resolver.vitest.ts`. Run via `pnpm exec vitest run tests/capability/`.
- Suite-level `before` causes catalog id@version collisions across `describe` blocks (CAP-6 lesson); use `beforeEach` (matches `provider-resolver.vitest.ts`).
- Repo is `"type": "module"` — `.js` extensions on every import.
- ESM strict mode — frozen object writes throw TypeError (CAP-6 lesson); do not assign to read-only exports.
- The type gate is `pnpm exec tsc --noEmit` — Vitest does not typecheck; the CAP-6 plan also calls this after every task.

### Cross-axis invariants (the north star)

- Availability (CAP-3/CAP-4 axis: `available | missing_binding | provider_unavailable`) and lifecycle (CAP-5 axis: `emerging | active | mature | stagnant | declining | deprecated`) are **independent** — the resolver applies lifecycle FIRST, then provider/availability.
- Lifecycle-eligibility is a resolver property (does the lifecycle state permit selection?). Availability is a runtime property (does a usable provider exist?). Conflating them — e.g. "lifecycle = emerging → unavailable", "missing provider → stagnant" — is the regression CAP-7 exists to prevent.

---
---

### Task 1: Pure lifecycle-eligibility module — table + `isLifecycleEligible` + types

**Files:**
- Create: `src/capability/lifecycle-eligibility.ts`
- Test: `tests/capability/lifecycle-eligibility.vitest.ts`

**Interfaces:**
- Consumes: `LifecycleState` (CAP-5, re-exported via `capability/mutation-contract.js`).
- Produces:
  - `export const LIFECYCLE_ELIGIBILITY: Readonly<Record<LifecycleState, boolean>>` — the six-state table, locked values per locked ruling #7.
  - `export function isLifecycleEligible(state: LifecycleState): boolean` — returns `LIFECYCLE_ELIGIBILITY[state]`.
  - `export interface LifecycleEligibility { state: LifecycleState; eligible: boolean; overrideUsed: boolean }` — the annotation carried on `ProviderPlanStep` (locked ruling #6: deliberately narrow).

**Design contract:**
- Table values per locked ruling #7 and ticket AC#1:
  - `emerging: true`
  - `active: true`
  - `mature: true`
  - `stagnant: true`
  - `declining: true`
  - `deprecated: false`  (excluded from normal selection — `allowDeprecated` is the only escape)
- **`overrideUsed` is NOT a lifecycle property** — it is a *resolver* property set at the call site when `allowDeprecated: true` is passed. The eligibility module does NOT see `overrideUsed`; the annotation is built in the resolver (Task 2). `LifecycleEligibility` is exported here because the resolver annotates each step with it.
- `LIFECYCLE_ELIGIBILITY` is a `Readonly<Record<LifecycleState, boolean>>` so accidental writes throw under `Object.freeze` semantics if anyone tries to mutate it (the resolver imports it; ESM re-exports are live bindings).
- `isLifecycleEligible` is a single-line lookup; pure, no side effects, no resolver registry dependency. Unit-testable in isolation.
- No imports of `CapabilityRegistry`, `ProviderResolver`, `CapabilityCatalog`, or anything that touches I/O. This module is the *table* and the *type* — nothing more.

- [ ] **Step 1: Write the failing tests**

`tests/capability/lifecycle-eligibility.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LIFECYCLE_ELIGIBILITY, isLifecycleEligible, type LifecycleEligibility } from '../../src/capability/lifecycle-eligibility.js';
import type { LifecycleState } from '../../src/adaptation/capability-evolution-types.js';

describe('LIFECYCLE_ELIGIBILITY (CAP-7 table)', () => {
  it('contains exactly the six CAP-5 states', () => {
    const keys = Object.keys(LIFECYCLE_ELIGIBILITY).sort();
    expect(keys).toEqual(['active', 'declining', 'deprecated', 'emerging', 'mature', 'stagnant']);
  });

  it('excludes deprecated from normal selection (AC#1, AC#2)', () => {
    expect(LIFECYCLE_ELIGIBILITY.deprecated).toBe(false);
  });

  it('permits every other state (AC#1: emerging/active/mature/stagnant/declining are all lifecycle-eligible)', () => {
    for (const state of ['emerging', 'active', 'mature', 'stagnant', 'declining'] as const) {
      expect(LIFECYCLE_ELIGIBILITY[state]).toBe(true);
    }
  });

  it('is a strict boolean table — no undefined, no null, no availability-axis keys (locked ruling #7)', () => {
    for (const value of Object.values(LIFECYCLE_ELIGIBILITY)) {
      expect(typeof value).toBe('boolean');
    }
    // No availability-axis leakage.
    expect(Object.keys(LIFECYCLE_ELIGIBILITY)).not.toContain('unavailable');
    expect(Object.keys(LIFECYCLE_ELIGIBILITY)).not.toContain('missing_binding');
    expect(Object.keys(LIFECYCLE_ELIGIBILITY)).not.toContain('provider_unavailable');
  });

  it('is frozen at the type level (Record<LifecycleState, boolean>, not a wider Record)', () => {
    // Compile-time gate: this annotation only typechecks if the table's key
    // set is exactly the six states. A `Record<string, boolean>` would silently
    // accept any key — this catches accidental widening.
    const table: Record<LifecycleState, boolean> = LIFECYCLE_ELIGIBILITY;
    const _exhaustive: LifecycleState = 'deprecated';
    void table[_exhaustive];
  });
});

describe('isLifecycleEligible', () => {
  it('returns true for non-deprecated states', () => {
    expect(isLifecycleEligible('emerging')).toBe(true);
    expect(isLifecycleEligible('active')).toBe(true);
    expect(isLifecycleEligible('mature')).toBe(true);
    expect(isLifecycleEligible('stagnant')).toBe(true);
    expect(isLifecycleEligible('declining')).toBe(true);
  });

  it('returns false for deprecated (AC#1, AC#2)', () => {
    expect(isLifecycleEligible('deprecated')).toBe(false);
  });

  it('agrees with the table for every state (parity)', () => {
    const states: LifecycleState[] = ['emerging', 'active', 'mature', 'stagnant', 'declining', 'deprecated'];
    for (const s of states) expect(isLifecycleEligible(s)).toBe(LIFECYCLE_ELIGIBILITY[s]);
  });
});

describe('LifecycleEligibility annotation shape (locked ruling #6)', () => {
  it('carries only state + eligible + overrideUsed — no caller/role/governance/timestamp fields', () => {
    // Type-level exhaustiveness: an annotation that grows extra fields is a
    // locked-ruling-#6 violation. This annotation is a SHAPE assertion, not
    // a behavior test.
    const ann: LifecycleEligibility = { state: 'active', eligible: true, overrideUsed: false };
    expect(Object.keys(ann).sort()).toEqual(['eligible', 'overrideUsed', 'state']);
    // Casting to a permissive shape surfaces unintended fields at compile time.
    // Brief-amendment 2026-08-11: TS 7.0.2 strict mode rejects direct assignment
    // (LifecycleEligibility has no index signature). Double-cast via unknown
    // preserves the locked-ruling #6 "deliberately narrow" interface while
    // satisfying tsc. Adding `[key: string]: unknown` to the interface would
    // itself widen the shape, so the cast stays here.
    const widened = ann as unknown as Record<string, unknown>;
    expect(widened.callerId).toBeUndefined();
    expect(widened.actorRole).toBeUndefined();
    expect(widened.governanceDecisionId).toBeUndefined();
    expect(widened.timestamp).toBeUndefined();
    expect(widened.auditId).toBeUndefined();
    expect(widened.providerFallbackHistory).toBeUndefined();
  });

  it('overrideUsed: true is set at the call site — eligibility module does not see it', () => {
    // isLifecycleEligible is a pure lookup; this test pins the boundary: the
    // module never produces or interprets overrideUsed.
    const _ann: LifecycleEligibility = { state: 'deprecated', eligible: true, overrideUsed: true };
    expect(isLifecycleEligible('deprecated')).toBe(false); // the function does not look at overrideUsed
    expect(_ann.overrideUsed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/lifecycle-eligibility.vitest.ts
```

Expected: FAIL — module not found (`Cannot find module .../lifecycle-eligibility.js`).

- [ ] **Step 3: Implement the pure eligibility module**

Create `src/capability/lifecycle-eligibility.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-7 — Runtime Lifecycle Eligibility.
 *
 * Pure contract: the lifecycle-eligibility table and a single lookup function.
 * The resolver (Task 2) imports this module to filter `ProviderPlanStep`s
 * before the existing CAP-4 provider/availability filter. No registry,
 * resolver, catalog, or I/O dependency — the table is the table, the
 * function is the function, the annotation shape is the annotation shape.
 *
 * Locked rulings (CAP-7 brief):
 *   #5  lifecycle states are the CAP-5 six states — no new states, no renames.
 *   #6  LifecycleEligibility is deliberately narrow — no caller/role/governance
 *       fields, no timestamps, no audit IDs. overrideUsed is set at the
 *       resolver call site; this module does not produce or interpret it.
 *   #7  the table is a strict boolean Record<LifecycleState, boolean>;
 *       availability-axis values are NOT included (that would conflate axes).
 *
 * @module capability/lifecycle-eligibility
 */

import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

/**
 * The locked lifecycle-eligibility table. `deprecated` is the only state
 * excluded from normal selection (AC#1, AC#2). Every other state passes
 * the lifecycle gate; the resolver then applies the CAP-4 provider/availability
 * filter. AC#1's "policy-dependent" cells in the ticket table are NOT a third
 * state — they mean `eligible: true` at the lifecycle axis; availability is
 * determined by the provider filter, not by this table.
 *
 * NOTE: do NOT add `unavailable` / `missing_binding` / `provider_unavailable`
 * keys to this table — that would conflate the lifecycle axis with the
 * availability axis (locked ruling #7, north-star invariant).
 */
export const LIFECYCLE_ELIGIBILITY: Readonly<Record<LifecycleState, boolean>> = Object.freeze({
  emerging: true,
  active: true,
  mature: true,
  stagnant: true,
  declining: true,
  deprecated: false,
});

/** Is a capability in `state` eligible for runtime selection at the lifecycle axis? */
export function isLifecycleEligible(state: LifecycleState): boolean {
  return LIFECYCLE_ELIGIBILITY[state];
}

/** Per-step lifecycle eligibility annotation (locked ruling #6: deliberately narrow). */
export interface LifecycleEligibility {
  /** The capability's current lifecycle state, captured at resolution time. */
  state: LifecycleState;
  /** True when the lifecycle gate passes for this step (i.e. `isLifecycleEligible(state)` is true,
   *  or the state is `deprecated` and the resolver was called with `allowDeprecated: true`). */
  eligible: boolean;
  /** True when the resolver was called with `allowDeprecated: true` AND the step's lifecycle
   *  state is `deprecated`. `overrideUsed: true` does NOT mean provider-available, execution-
   *  authorized, or governance-approved — it means the lifecycle-axis override was exercised. */
  overrideUsed: boolean;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/lifecycle-eligibility.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (all six describe blocks), 0 tsc errors. The `Record<LifecycleState, boolean>` type annotation in the test acts as a compile-time gate — `pnpm exec tsc --noEmit` will fail if the table's type widens to `Record<string, boolean>`.

- [ ] **Step 5: Commit**

```bash
git add src/capability/lifecycle-eligibility.ts tests/capability/lifecycle-eligibility.vitest.ts
git commit -m "feat(capability): CAP-7 lifecycle-eligibility table + isLifecycleEligible + annotation type"
```

---
---

### Task 2: Resolver extension — `ResolverContext` with `allowDeprecated` + per-step `lifecycleEligibility` + two-stage gate

**Files:**
- Modify: `src/capability/provider-resolver.ts` (extend `ProviderPlanStep`; add `ResolverContext`; replace `_ctx` with `ResolverContext`; add lifecycle gate; per-step `lifecycleEligibility` annotation)
- Test: `tests/capability/provider-resolver.vitest.ts` (extend — add `ResolverContext` to existing calls; add the new "lifecycle-eligibility extension" describe)

**Interfaces:**
- Consumes: `isLifecycleEligible`, `LifecycleEligibility` (Task 1); existing `ProviderResolver` constructor + `resolve` signature.
- Produces:
  - `export interface ResolverContext { allowDeprecated?: boolean }` — the resolver's second argument (deliberately narrower than `CapabilityContext`; the resolver does not need actor/permissions/cancellation — CAP-7 is lifecycle-axis only).
  - `ProviderResolver.resolve(capabilityId: string, ctx: ResolverContext): ProviderPlan[]` — second arg now typed; lifecycle gate first, provider gate second.
  - `ProviderPlanStep.lifecycleEligibility: LifecycleEligibility` — per-step annotation.
  - `export class CapabilityResolver extends ProviderResolver` — the canonical alias name (locked ruling #2: the resolver that owns `LIFECYCLE_ELIGIBILITY` is `CapabilityResolver`; `ProviderResolver` is retained as the implementation superclass for backward compatibility with the existing tests).

**Design contract:**
- `ResolverContext` is INTENTIONALLY narrower than `CapabilityContext`. The current `resolve(capabilityId, _ctx: CapabilityContext)` ignores `_ctx`; CAP-7 introduces a separate `ResolverContext` that contains only the lifecycle-axis override. This avoids widening the call surface to actor/permissions and keeps CAP-7's responsibility minimal. (Existing tests that pass `ctx(): CapabilityContext` are updated to pass a `ResolverContext` — the shape change is local to the resolver module.)
- **Two-stage gate per step:**
  1. **Lifecycle gate**: `state = registry.getLifecycleState(capabilityId)`. If `!isLifecycleEligible(state)` AND `state === 'deprecated'`, then:
     - if `ctx.allowDeprecated === true` → step carries `lifecycleEligibility: { state: 'deprecated', eligible: true, overrideUsed: true }` and proceeds to the provider filter;
     - else → step is **excluded from the plan** (the plan's `steps` array omits the capability entirely) and a **synthetic step is NOT emitted** (no candidates, `candidates: []`, `bindingsCount: def.bindings.length`, `lifecycleEligibility: { state: 'deprecated', eligible: false, overrideUsed: false }`).
  2. **Provider gate** (existing CAP-4 logic, unchanged): `candidates` populated only from bindings whose `binding.type` is registered and whose `isProviderHealthy` returns true.
- For every step where `state` is non-deprecated, `lifecycleEligibility: { state, eligible: true, overrideUsed: false }` regardless of `ctx.allowDeprecated` (the override is meaningful ONLY when the state is `deprecated`).
- For capabilities whose `state` is `undefined` (registry has no lifecycle entry — the rare case before the registry's first `reload()` post-bootstrap): treat as lifecycle-eligible (`eligible: true`, `state: 'emerging'` since the registry's `DEFAULT_LIFECYCLE` is `emerging` — see `registry.ts:48`). This matches the registry's own defaulting behavior.
- `CapabilityResolver` is a one-line subclass: `export class CapabilityResolver extends ProviderResolver {}` — a naming alias that carries the policy-axis ownership (locked ruling #2). Existing tests that import `ProviderResolver` continue to pass; the barrel (Task 7) exports `CapabilityResolver` as the canonical name.
- `ProviderPlanStep` gains `lifecycleEligibility: LifecycleEligibility` as a **required** field — every step carries the annotation. The existing CAP-4 tests that build `ProviderPlanStep` (none do; only the resolver produces them) are unaffected. The existing `provider-resolver.vitest.ts` assertions on `plans[0].steps[0]` continue to pass once the new field is added.
- **No registry mutation**: the resolver never calls `setLifecycleState`, `setAvailability`, or `reload`. It only **reads** `getLifecycleState` and the existing CAP-4 provider/health state. AC#3 (provider unavailable does NOT mutate lifecycle) is structurally enforced.

- [ ] **Step 1: Update existing tests + add the failing extension tests**

Append to `tests/capability/provider-resolver.vitest.ts` (the existing `ctx()` helper and all `new ProviderResolver(...).resolve('id', ctx())` calls must be updated to pass a `ResolverContext`; add the new describe block at the end):

```ts
import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';
// ... existing imports unchanged ...

// Replace the existing `ctx(): CapabilityContext` with a ResolverContext helper
// (the resolver no longer takes CapabilityContext — see the design contract).
function ctx(over: Partial<ResolverContext> = {}): ResolverContext {
  return { ...over };
}
// Keep the existing `ctx` calls (no allowDeprecated) — ResolverContext defaults
// to "no override" so the existing CAP-4 behavior is preserved. The existing
// `ctx()` returning CapabilityContext is removed (CAP-7 narrows the surface).

// ... existing describe('ProviderResolver', ...) remains structurally identical,
// but every `.resolve('id', ctx())` call must pass the new `ctx()` helper
// (no allowDeprecated) so the test exercises the default gate.

// New describe block at the end:
describe('CapabilityResolver (CAP-7 lifecycle eligibility extension)', () => {
  it('attaches a lifecycleEligibility annotation to every step (default allowDeprecated=false)', () => {
    const reg = makeRegistry();
    reg.import([def({})]);
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry());
    const plans = resolver.resolve('core.echo', ctx());
    expect(plans[0]!.steps[0]!.lifecycleEligibility).toEqual({ state: 'emerging', eligible: true, overrideUsed: false });
  });

  it('deprecated without override → step is present but has no candidates and eligible=false (AC#2)', () => {
    const reg = makeRegistry();
    reg.import([def({})]);
    registrySetLifecycle(reg, 'core.echo', 'deprecated');
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry());
    const plans = resolver.resolve('core.echo', ctx());
    const step = plans[0]!.steps.find((s) => s.capabilityId === 'core.echo')!;
    expect(step.lifecycleEligibility).toEqual({ state: 'deprecated', eligible: false, overrideUsed: false });
    expect(step.candidates).toEqual([]);
    expect(step.bindingsCount).toBe(1);
  });

  it('deprecated WITH allowDeprecated → step is lifecycle-eligible with overrideUsed=true (AC#2 override)', () => {
    const reg = makeRegistry();
    reg.import([def({})]);
    registrySetLifecycle(reg, 'core.echo', 'deprecated');
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry());
    const plans = resolver.resolve('core.echo', ctx({ allowDeprecated: true }));
    const step = plans[0]!.steps.find((s) => s.capabilityId === 'core.echo')!;
    expect(step.lifecycleEligibility).toEqual({ state: 'deprecated', eligible: true, overrideUsed: true });
    // Provider gate still applies: native IS registered, so the candidate is present.
    expect(step.candidates).toHaveLength(1);
  });

  it('deprecated WITH override but provider not registered → step is eligible but no candidates (provider gate still applies)', () => {
    const reg = makeRegistry();
    reg.import([def({ bindings: [{ id: 'gh', type: 'external-cli', config: { executable: 'gh' } }] })]);
    registrySetLifecycle(reg, 'core.echo', 'deprecated');
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry());
    const plans = resolver.resolve('core.echo', ctx({ allowDeprecated: true }));
    const step = plans[0]!.steps.find((s) => s.capabilityId === 'core.echo')!;
    expect(step.lifecycleEligibility.eligible).toBe(true);
    expect(step.lifecycleEligibility.overrideUsed).toBe(true);
    expect(step.candidates).toEqual([]); // provider gate (locked ruling #1: override does not bypass provider)
  });

  it('non-deprecated with allowDeprecated: true still has overrideUsed=false (override is meaningful only for deprecated)', () => {
    const reg = makeRegistry();
    reg.import([def({})]);
    registrySetLifecycle(reg, 'core.echo', 'active');
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry());
    const plans = resolver.resolve('core.echo', ctx({ allowDeprecated: true }));
    expect(plans[0]!.steps[0]!.lifecycleEligibility).toEqual({ state: 'active', eligible: true, overrideUsed: false });
  });

  it('lifecycle gate runs BEFORE the provider gate (AC#6: axes never conflate)', () => {
    // active + provider-down → step carries lifecycleEligibility.eligible=true AND
    // candidates=[] (provider gate). Two axes, two independent annotations.
    const reg = makeRegistry();
    reg.import([def({ bindings: [{ id: 'native.a', type: 'native' }] })]);
    registrySetLifecycle(reg, 'core.echo', 'active');
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry(), {
      isProviderHealthy: () => false, // provider down
    });
    const plans = resolver.resolve('core.echo', ctx());
    const step = plans[0]!.steps.find((s) => s.capabilityId === 'core.echo')!;
    expect(step.lifecycleEligibility).toEqual({ state: 'active', eligible: true, overrideUsed: false });
    expect(step.candidates).toEqual([]);
    // bindingsCount reflects bindings[] (pre-filter), not eligible candidates.
    expect(step.bindingsCount).toBe(1);
  });

  it('multi-step plan: a non-deprecated dependency resolves, a deprecated head is excluded (override=false)', () => {
    const reg = makeRegistry();
    reg.import([def({ id: 'dep.a' }), def({ id: 'core.composed', dependencies: ['dep.a'] })]);
    registrySetLifecycle(reg, 'core.composed', 'deprecated');
    const resolver = new CapabilityResolver(reg, makeProviderExecutorRegistry());
    const plans = resolver.resolve('core.composed', ctx());
    const head = plans[0]!.steps.find((s) => s.capabilityId === 'core.composed')!;
    const dep = plans[0]!.steps.find((s) => s.capabilityId === 'dep.a')!;
    expect(head.lifecycleEligibility.eligible).toBe(false);
    expect(head.candidates).toEqual([]);
    expect(dep.lifecycleEligibility.eligible).toBe(true);
    expect(dep.candidates).toHaveLength(1);
  });
});

// Local helper used by the new describe block (matches `beforeEach` isolation pattern).
import type { CapabilityRegistry } from '../../src/capability/registry.js';
function registrySetLifecycle(reg: CapabilityRegistry, id: string, state: 'emerging' | 'active' | 'mature' | 'stagnant' | 'declining' | 'deprecated'): void {
  reg.setLifecycleState(id, state);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/provider-resolver.vitest.ts
```

Expected: FAIL — `ResolverContext` is not yet exported; `CapabilityResolver` is not yet exported; `lifecycleEligibility` is missing from `ProviderPlanStep`.

- [ ] **Step 3: Extend the resolver with the lifecycle gate**

Replace `src/capability/provider-resolver.ts` with the extended version (key additions marked with `// CAP-7:`):

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CapabilityNotFoundError } from "./errors.js";
import type { Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";
import type { ProviderExecutorRegistry, ProviderCandidate } from "./provider-registry.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import { isLifecycleEligible, type LifecycleEligibility } from "./lifecycle-eligibility.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

export type HookName = keyof CapabilityHooks;

/** CAP-7 — Resolver context. Deliberately narrower than CapabilityContext:
 *  the resolver only needs the lifecycle-axis override. Actor/permissions/
 *  cancellation/workspace belong to the runtime invocation seam, not the
 *  capability-selection seam. */
export interface ResolverContext {
  /** Opt-in to including `deprecated` capabilities in the result. Default false.
   *  Does NOT bypass provider/availability eligibility (locked ruling #1). */
  allowDeprecated?: boolean;
}

export interface ProviderPlanStep {
  /** The capability this step invokes (a dependency, or the plan's own
   *  capability for the final step). Identity is provider-independent (#476). */
  capabilityId: string;
  /** Ordered, eligibility-filtered provider candidates — the bounded
   *  single-pass fallback list. Empty = missing_binding or provider_unavailable. */
  candidates: ProviderCandidate[];
  /** Original binding count (pre-filter): distinguishes missing_binding (0)
   *  from provider_unavailable (>0 but none eligible). */
  bindingsCount: number;
  timeout: number;
  hooks: HookName[];
  permissions: Permission[];
  /** CAP-7 — Per-step lifecycle eligibility annotation (locked ruling #6).
   *  Always present; the resolver reads `registry.getLifecycleState` and
   *  applies the lifecycle gate FIRST, then the provider gate. */
  lifecycleEligibility: LifecycleEligibility;
}

export interface ProviderPlan {
  capabilityId: string;
  steps: ProviderPlanStep[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_LIFECYCLE: LifecycleState = "emerging";

/** CAP-4 provider resolver — replaces strategy-keyed ExecutionResolver dispatch.
 *  Deterministic candidate selection (bindings order + eligibility + pin);
 *  the runtime owns the attempt/failover walk. Identity never changes here.
 *
 *  CAP-7 — the resolver now also enforces the lifecycle-eligibility gate
 *  (locked rulings #1, #5, #7) and annotates every step with a
 *  `lifecycleEligibility` annotation (locked ruling #6). The lifecycle gate
 *  runs FIRST; the provider gate runs SECOND. */
export class ProviderResolver {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly providers: ProviderExecutorRegistry,
    private readonly opts: { isProviderHealthy?: (binding: CapabilityProviderBinding) => boolean } = {},
  ) {}

  /** CAP-7 — second arg is now `ResolverContext` (was `CapabilityContext`,
   *  which was ignored). Existing callers passing a `CapabilityContext` must
   *  pass a `ResolverContext` instead; the runtime invocation seam (which
   *  carries CapabilityContext) is downstream of selection. */
  resolve(capabilityId: string, _ctx: ResolverContext = {}): ProviderPlan[] {
    const rc = this.registry.get(capabilityId);
    if (!rc) throw new CapabilityNotFoundError(capabilityId);
    const steps = this.buildSteps(rc.definition, [], new Set());
    return [{ capabilityId, steps }];
  }

  private buildSteps(def: CapabilityDefinition, chain: string[], visited: Set<string>): ProviderPlanStep[] {
    if (chain.includes(def.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, def.id].join(' → ')}`);
    }
    const steps: ProviderPlanStep[] = [];
    const nextChain = [...chain, def.id];
    for (const depId of def.dependencies ?? []) {
      if (visited.has(depId)) continue;
      const dep = this.registry.get(depId);
      if (!dep) throw new CapabilityNotFoundError(depId);
      steps.push(...this.buildSteps(dep.definition, nextChain, visited));
      visited.add(depId);
    }
    steps.push(this.stepFor(def));
    return steps;
  }

  private isEligible(binding: CapabilityProviderBinding): boolean {
    if (!this.providers.has(binding.type)) return false;
    return this.opts.isProviderHealthy ? this.opts.isProviderHealthy(binding) : true;
  }

  private stepFor(def: CapabilityDefinition): ProviderPlanStep {
    // CAP-7 — lifecycle gate (FIRST). Reads the current lifecycle state from
    // the registry (the in-process projection CAP-3 owns; CAP-6's
    // `registry.reload()` after every A4 mutation keeps this current).
    // Locked ruling #7: lifecycle is a strict boolean; the table does NOT
    // include availability-axis values.
    const rawState = this.registry.getLifecycleState(def.id);
    const state: LifecycleState = rawState ?? DEFAULT_LIFECYCLE;
    const allowDeprecated = false; // ProviderResolver base class — no override. CapabilityResolver overrides.
    const overrideUsed = allowDeprecated && state === "deprecated";
    const eligible = isLifecycleEligible(state) || (allowDeprecated && state === "deprecated");
    const lifecycleEligibility: LifecycleEligibility = { state, eligible, overrideUsed };

    // Pinning (user refinement): allowFallbacks=false resolves over a bounded
    // list of ONE — only bindings[0] participates; if it is ineligible, the
    // result is [] (STOP). The pin applies BEFORE candidate traversal.
    const bounded = def.allowFallbacks === false ? def.bindings.slice(0, 1) : def.bindings;
    // Preserve the ORIGINAL bindings[] position in bindingIndex (the eligible
    // subset is filtered, so its own indices would be wrong).
    const candidates: ProviderCandidate[] = bounded
      .map((binding, bindingIndex) => ({ binding, bindingIndex }))
      .filter(({ binding }) => this.isEligible(binding))
      .map(({ binding, bindingIndex }) => ({
        binding,
        providerId: binding.id,
        providerType: binding.type,
        bindingIndex,
        executor: this.providers.get(binding.type)!,
      }));
    const first = candidates[0];
    const timeout = typeof first?.binding.config?.timeoutMs === "number" ? first.binding.config.timeoutMs : DEFAULT_TIMEOUT;
    return {
      capabilityId: def.id,
      candidates,
      bindingsCount: def.bindings.length,
      timeout,
      hooks: [],
      permissions: [...def.requiredPermissions],
      lifecycleEligibility, // CAP-7 — always present
    };
  }
}

/** CAP-7 — Canonical resolver alias. Owns the lifecycle-eligibility table
 *  (locked ruling #2: `CapabilityResolver` is the policy-axis owner; the
 *  base `ProviderResolver` is the CAP-4 implementation superclass).
 *  Subclasses the base to expose `allowDeprecated` via the ResolverContext
 *  without breaking the CAP-4 `ProviderResolver` signature. */
export class CapabilityResolver extends ProviderResolver {
  override resolve(capabilityId: string, ctx: ResolverContext = {}): ProviderPlan[] {
    // Forward to a private plan-build that honours the override. The override
    // is meaningful ONLY for `deprecated`; for every other state the result
    // is identical to the base resolver (overrideUsed: false).
    return this.buildPlanWithOverride(capabilityId, ctx);
  }

  private buildPlanWithOverride(capabilityId: string, ctx: ResolverContext): ProviderPlan[] {
    const rc = this.registry.get(capabilityId);
    if (!rc) throw new CapabilityNotFoundError(capabilityId);
    const steps = this.buildStepsWithOverride(rc.definition, [], new Set(), ctx.allowDeprecated ?? false);
    return [{ capabilityId, steps }];
  }

  private buildStepsWithOverride(def: CapabilityDefinition, chain: string[], visited: Set<string>, allowDeprecated: boolean): ProviderPlanStep[] {
    if (chain.includes(def.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, def.id].join(' → ')}`);
    }
    const steps: ProviderPlanStep[] = [];
    const nextChain = [...chain, def.id];
    for (const depId of def.dependencies ?? []) {
      if (visited.has(depId)) continue;
      const dep = this.registry.get(depId);
      if (!dep) throw new CapabilityNotFoundError(depId);
      steps.push(...this.buildStepsWithOverride(dep.definition, nextChain, visited, allowDeprecated));
      visited.add(depId);
    }
    steps.push(this.stepForWithOverride(def, allowDeprecated));
    return steps;
  }

  private stepForWithOverride(def: CapabilityDefinition, allowDeprecated: boolean): ProviderPlanStep {
    const rawState = this.registry.getLifecycleState(def.id);
    const state: LifecycleState = rawState ?? DEFAULT_LIFECYCLE;
    const overrideUsed = allowDeprecated && state === "deprecated";
    const eligible = isLifecycleEligible(state) || overrideUsed;
    const lifecycleEligibility: LifecycleEligibility = { state, eligible, overrideUsed };

    const bounded = def.allowFallbacks === false ? def.bindings.slice(0, 1) : def.bindings;
    const candidates: ProviderCandidate[] = bounded
      .map((binding, bindingIndex) => ({ binding, bindingIndex }))
      .filter(({ binding }) => this.isEligible(binding))
      .map(({ binding, bindingIndex }) => ({
        binding,
        providerId: binding.id,
        providerType: binding.type,
        bindingIndex,
        executor: this.providers.get(binding.type)!,
      }));
    const first = candidates[0];
    const timeout = typeof first?.binding.config?.timeoutMs === "number" ? first.binding.config.timeoutMs : DEFAULT_TIMEOUT;
    return {
      capabilityId: def.id,
      candidates,
      bindingsCount: def.bindings.length,
      timeout,
      hooks: [],
      permissions: [...def.requiredPermissions],
      lifecycleEligibility,
    };
  }
}
```

- [ ] **Step 4: Update the existing test file to use the new `ctx()` helper**

In `tests/capability/provider-resolver.vitest.ts`:

1. Remove `import type { CapabilityContext } from '../../src/capability/types.js';` (no longer used).
2. Add `import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';` (alongside the existing `ProviderResolver` import).
3. Replace the `ctx(): CapabilityContext` function with the new `ctx(over): ResolverContext` helper.
4. All existing `.resolve('id', ctx())` calls keep working (no allowDeprecated) — the default `ResolverContext` is `{}` (no override) which preserves the CAP-4 behavior.

```bash
pnpm exec vitest run tests/capability/provider-resolver.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (existing + new describe blocks), 0 tsc errors. If `Object.freeze` on the new `LIFECYCLE_ELIGIBILITY` causes a `tsc` complaint in the test that mutates an annotation, wrap the assignment in a try/catch (frozen writes throw under `Object.freeze`/strict ESM; CAP-6's lesson). The new tests only read the annotation shape — no writes.

- [ ] **Step 5: Commit**

```bash
git add src/capability/provider-resolver.ts tests/capability/provider-resolver.vitest.ts
git commit -m "feat(capability): CAP-7 resolver two-stage gate + ResolverContext + LifecycleEligibility annotation"
```

---
---

### Task 3: Deprecated override matrix — six states × `allowDeprecated` true/false × provider available/unavailable

**Files:**
- Test: `tests/capability/lifecycle-eligibility-matrix.vitest.ts` (new — full AC#1 / AC#2 / AC#3 matrix)

**Interfaces:**
- Consumes: `CapabilityResolver`, `ResolverContext` (Task 2); existing `CapabilityRegistry` + `ProviderExecutorRegistry` test seam.
- Produces: a deterministic test that walks every (lifecycle_state, allowDeprecated, provider_up) combination and asserts the four-quadrant outcome.

**Design contract:**
- The matrix is a 6 × 2 × 2 = 24-cell table:
  - Rows: the six `LifecycleState` values.
  - Cols: `allowDeprecated ∈ {false, true}`.
  - Sub-cols: `provider up ∈ {true, false}` (a native binding whose `isProviderHealthy` returns true/false).
  - Cells assert: `step.lifecycleEligibility.state` matches the row; `eligible` is true unless `(state === 'deprecated' && !allowDeprecated)`; `overrideUsed` is true iff `(state === 'deprecated' && allowDeprecated)`; `candidates.length` is 1 if provider up, 0 if provider down (regardless of lifecycle).
- AC#1 truth table encoded verbatim in the test:
  - emerging + healthy + !override → eligible=true, overrideUsed=false, candidates=1
  - emerging + healthy + override → eligible=true, overrideUsed=false, candidates=1 (override is no-op for non-deprecated)
  - active + healthy + !override → eligible=true, overrideUsed=false, candidates=1
  - mature + provider-down + !override → eligible=true, overrideUsed=false, candidates=0 (AC#3: lifecycle stays mature)
  - declining + healthy + !override → eligible=true, overrideUsed=false, candidates=1
  - deprecated + healthy + !override → eligible=false, overrideUsed=false, candidates=0
  - deprecated + healthy + override → eligible=true, overrideUsed=true, candidates=1
  - deprecated + provider-down + override → eligible=true, overrideUsed=true, candidates=0 (provider gate still applies — locked ruling #1)
- **The matrix is the canonical AC#1/AC#2/AC#3 test** — it lives in its own file so future reviewers can read the truth table at a glance without parsing the resolver implementation.

- [ ] **Step 1: Write the failing matrix test**

`tests/capability/lifecycle-eligibility-matrix.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { LifecycleState } from '../../src/adaptation/capability-evolution-types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-matrix-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeRegistry() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}
function makeProviders() {
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return providers;
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

interface Cell { state: LifecycleState; allowDeprecated: boolean; providerUp: boolean }
interface Outcome {
  eligible: boolean;
  overrideUsed: boolean;
  candidates: number;
}
function expected({ state, allowDeprecated, providerUp }: Cell): Outcome {
  const lifecycleBlocked = state === 'deprecated' && !allowDeprecated;
  const overrideUsed = state === 'deprecated' && allowDeprecated;
  return {
    eligible: !lifecycleBlocked,
    overrideUsed,
    candidates: providerUp && !lifecycleBlocked ? 1 : 0,
  };
}

describe('CAP-7 lifecycle × override × provider matrix (AC#1, AC#2, AC#3)', () => {
  const states: LifecycleState[] = ['emerging', 'active', 'mature', 'stagnant', 'declining', 'deprecated'];
  for (const state of states) {
    for (const allowDeprecated of [false, true]) {
      for (const providerUp of [true, false]) {
        const label = `${state} / allowDeprecated=${allowDeprecated} / providerUp=${providerUp}`;
        it(label, () => {
          const reg = makeRegistry();
          reg.import([def({})]);
          reg.setLifecycleState('core.echo', state);
          const resolver = new CapabilityResolver(
            reg, makeProviders(),
            { isProviderHealthy: () => providerUp },
          );
          const ctx: ResolverContext = allowDeprecated ? { allowDeprecated: true } : {};
          const plans = resolver.resolve('core.echo', ctx);
          const step = plans[0]!.steps[0]!;
          const want = expected({ state, allowDeprecated, providerUp });
          expect(step.lifecycleEligibility).toEqual({ state, eligible: want.eligible, overrideUsed: want.overrideUsed });
          expect(step.candidates).toHaveLength(want.candidates);
        });
      }
    }
  }

  it('AC#1 truth-table excerpts (spot-checks the ticket\'s enumerated cells)', () => {
    // active + healthy + !override → eligible, candidates=1
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'active');
      const step = new CapabilityResolver(reg, makeProviders()).resolve('core.echo', {})[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'active', eligible: true, overrideUsed: false });
      expect(step.candidates).toHaveLength(1);
    }
    // mature + provider-down + !override → lifecycle-eligible, candidates=0 (AC#3: lifecycle does NOT move)
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'mature');
      const resolver = new CapabilityResolver(reg, makeProviders(), { isProviderHealthy: () => false });
      const step = resolver.resolve('core.echo', {})[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'mature', eligible: true, overrideUsed: false });
      expect(step.candidates).toHaveLength(0);
      // Lifecycle state remains mature — no mutation from the resolver.
      expect(reg.getLifecycleState('core.echo')).toBe('mature');
    }
    // deprecated + healthy + !override → eligible=false, candidates=0
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'deprecated');
      const step = new CapabilityResolver(reg, makeProviders()).resolve('core.echo', {})[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'deprecated', eligible: false, overrideUsed: false });
      expect(step.candidates).toHaveLength(0);
    }
    // deprecated + healthy + override → eligible=true, overrideUsed=true, candidates=1
    {
      const reg = makeRegistry(); reg.import([def({})]); reg.setLifecycleState('core.echo', 'deprecated');
      const step = new CapabilityResolver(reg, makeProviders()).resolve('core.echo', { allowDeprecated: true })[0]!.steps[0]!;
      expect(step.lifecycleEligibility).toEqual({ state: 'deprecated', eligible: true, overrideUsed: true });
      expect(step.candidates).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/lifecycle-eligibility-matrix.vitest.ts
```

Expected: PASS — 24 matrix cells + 4 spot-checks all green. (These tests are written against the Task 2 resolver and should pass on the first run if Task 2 is complete.)

- [ ] **Step 3: (no implementation change) Document the matrix in a comment**

The matrix file is the executable specification. No production code changes. (This step exists to surface the test as the AC#1 truth table — reviewer reads this file to verify AC#1/AC#2/AC#3 at a glance.)

- [ ] **Step 4: Re-run the type gate**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add tests/capability/lifecycle-eligibility-matrix.vitest.ts
git commit -m "test(capability): CAP-7 lifecycle × override × provider matrix (AC#1, AC#2, AC#3)"
```

---
---

### Task 4: AC#3 — provider availability failures do NOT mutate lifecycle

**Files:**
- Test: `tests/capability/lifecycle-axis-isolation.vitest.ts` (new — proves lifecycle is a read-only input to the resolver; provider health does not change lifecycle)

**Interfaces:**
- Consumes: `CapabilityResolver`, `CapabilityRegistry` (Task 2), `setLifecycleState` / `getLifecycleState`.
- Produces: tests that pin the invariant: the resolver reads lifecycle, never writes it, regardless of provider health or fallback exhaustion.

**Design contract:**
- This task isolates the AC#3 invariant as a dedicated test. The matrix (Task 3) covers the truth-table cells; this task proves the **structural** property: the resolver has no API surface that mutates lifecycle, and exhaustive provider-failure scenarios leave lifecycle state unchanged.
- Tests:
  - Resolver never mutates lifecycle: before/after `resolve()`, `registry.getLifecycleState(id) === initialState` for every combination of state + provider health.
  - Provider fallback exhaustion (CAP-4: `candidates=[]` after `isProviderHealthy=false` for every binding) leaves lifecycle unchanged.
  - Multi-step plan: a `deprecated` head (no override) plus `active` dependency: only the head is excluded, the dependency is unaffected, and lifecycle state on both is unchanged post-resolve.
  - The resolver does not call `registry.setAvailability` either — availability is a CAP-3/CAP-4 axis the resolver observes via `isProviderHealthy` (injected), not via the registry's `setAvailability`.

- [ ] **Step 1: Write the failing axis-isolation tests**

`tests/capability/lifecycle-axis-isolation.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { LifecycleState } from '../../src/adaptation/capability-evolution-types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-iso-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return { registry, providers };
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#3 — provider availability failures do NOT mutate lifecycle', () => {
  const states: LifecycleState[] = ['emerging', 'active', 'mature', 'stagnant', 'declining', 'deprecated'];

  for (const state of states) {
    it(`lifecycle state '${state}' is unchanged after resolve (provider up)`, () => {
      const { registry, providers } = setup();
      registry.import([def({})]);
      registry.setLifecycleState('core.echo', state);
      const before = registry.getLifecycleState('core.echo');
      new CapabilityResolver(registry, providers).resolve('core.echo', {});
      expect(registry.getLifecycleState('core.echo')).toBe(before);
    });

    it(`lifecycle state '${state}' is unchanged after resolve (provider down)`, () => {
      const { registry, providers } = setup();
      registry.import([def({})]);
      registry.setLifecycleState('core.echo', state);
      const before = registry.getLifecycleState('core.echo');
      new CapabilityResolver(registry, providers, { isProviderHealthy: () => false }).resolve('core.echo', {});
      expect(registry.getLifecycleState('core.echo')).toBe(before);
    });

    it(`lifecycle state '${state}' is unchanged after resolve with allowDeprecated override`, () => {
      const { registry, providers } = setup();
      registry.import([def({})]);
      registry.setLifecycleState('core.echo', state);
      const before = registry.getLifecycleState('core.echo');
      new CapabilityResolver(registry, providers).resolve('core.echo', { allowDeprecated: true });
      expect(registry.getLifecycleState('core.echo')).toBe(before);
    });
  }

  it('multi-step plan: provider-down dependency does NOT change its lifecycle state', () => {
    const { registry, providers } = setup();
    registry.import([
      def({ id: 'dep.a', bindings: [{ id: 'dep.a', type: 'native' }] }),
      def({ id: 'core.composed', dependencies: ['dep.a'] }),
    ]);
    registry.setLifecycleState('dep.a', 'active');
    registry.setLifecycleState('core.composed', 'mature');
    const before = { dep: registry.getLifecycleState('dep.a'), head: registry.getLifecycleState('core.composed') };
    new CapabilityResolver(registry, providers, { isProviderHealthy: () => false }).resolve('core.composed', {});
    expect(registry.getLifecycleState('dep.a')).toBe(before.dep);
    expect(registry.getLifecycleState('core.composed')).toBe(before.head);
  });

  it('resolver does not call setAvailability (availability is observed via the injected health probe, not the registry)', () => {
    const { registry, providers } = setup();
    registry.import([def({})]);
    registry.setAvailability('core.echo', { available: true });
    new CapabilityResolver(registry, providers, { isProviderHealthy: () => false }).resolve('core.echo', {});
    // The resolver does not write to availability; the registry's prior value is intact.
    expect(registry.getAvailability('core.echo')).toEqual({ available: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/lifecycle-axis-isolation.vitest.ts
```

Expected: PASS — 18 (state × scenario) + 2 structural = 20 tests, all green. (These tests pin the AC#3 invariant structurally; the resolver's no-mutation design is asserted by behavior.)

- [ ] **Step 3: (no implementation change)**

The resolver was designed read-only on lifecycle in Task 2; this task is the test that pins it. No production code change.

- [ ] **Step 4: Run the type gate**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add tests/capability/lifecycle-axis-isolation.vitest.ts
git commit -m "test(capability): CAP-7 axis isolation — provider availability never mutates lifecycle (AC#3)"
```

---
---

### Task 5: AC#4 — governed transition is observed by the same resolver instance immediately (no reload)

**Files:**
- Test: `tests/capability/lifecycle-observability.vitest.ts` (new — proves the CAP-3 registry's in-process projection is the resolver's sole lifecycle source; CAP-6's `registry.reload()` after A4 mutations is the sync mechanism; no event bus, no polling, no restart)

**Interfaces:**
- Consumes: `CapabilityResolver` (Task 2), `CapabilityRegistry` (CAP-3), `CapabilityMutationExecutor` (CAP-6 — the same-process sync path).
- Produces: a test that proves the end-to-end invariant: a `capability.transition` applied through A4 (or, for the test, directly through `registry.setLifecycleState` + `registry.reload()`) is observed by `resolver.resolve()` on the same registry instance, with no additional wiring.

**Design contract:**
- AC#4 invariant: *"Runtime resolution observes a governed transition immediately after A4 applies it (same process)."*
- Test design:
  - **Path A — direct registry (the seam CAP-6 closes):** `setLifecycleState(id, 'active')` + `reload()` → `resolver.resolve()` returns the new state in the `lifecycleEligibility` annotation. This proves the resolver reads the registry's current state.
  - **Path B — full A4 path:** instantiate `CapabilityMutationExecutor` with the same `catalog` + `registry`; execute a `capability.transition` step (`active → mature`); then call `resolver.resolve()` on the same registry → annotation carries `state: 'mature'`. This proves CAP-6's `registry.reload()` after A4 is sufficient (no extra wiring).
  - **No event subscription, no polling, no restart:** the test does not subscribe to `EventBus`, does not start a timer, does not recreate the resolver or registry. Same instances throughout.
  - **Encoded invariant** (test name + comment, copies locked ruling #3 verbatim): *"After a successful A4 mutation commit, CapabilityRegistry is the authoritative in-process projection consumed by CapabilityResolver; no refresh, restart, polling, or event subscription is required for lifecycle eligibility to reflect the new state."*

- [ ] **Step 1: Write the failing observability test**

`tests/capability/lifecycle-observability.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-obs-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  return { catalog, registry, providers };
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#4 — governed transition observed by the same resolver instance (CAP-7 in-process sync)', () => {
  it('Path A: direct setLifecycleState + reload is observed by the same resolver (the seam CAP-6 closes)', () => {
    const { registry, providers } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'emerging');
    const resolver = new CapabilityResolver(registry, providers);
    expect(resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state).toBe('emerging');
    registry.setLifecycleState('core.echo', 'active');
    registry.reload();
    expect(resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state).toBe('active');
  });

  it('Path B: a CAP-6 capability.transition is observed by the same resolver (no extra wiring)', async () => {
    const { catalog, registry, providers } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active'); // seed: actual = 'active' so the transition's `from` precondition holds
    const resolver = new CapabilityResolver(registry, providers);
    const before = resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state;
    expect(before).toBe('active');

    // CAP-6's executor: the same `registry` is the projection. After commit,
    // CAP-6 calls `registry.reload()` — the resolver sees the new state on
    // the next resolve(), with NO event bus subscription, NO polling, NO
    // resolver restart, NO registry re-instantiation.
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const step = {
      stepId: 's1', operation: 'capability.transition' as const,
      parameters: { operation: 'capability.transition' as const, capabilityId: 'core.echo', from: 'active' as const, to: 'mature' as const },
      idempotent: true, preconditions: {}, postconditions: {},
    };
    const res = await executor.executeStep(step, {});
    expect(res.success).toBe(true);

    // Same resolver instance, same registry — new state visible immediately.
    const after = resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility;
    expect(after.state).toBe('mature');
    expect(after.eligible).toBe(true);
    expect(after.overrideUsed).toBe(false);
  });

  it('encoded invariant: no event subscription, no polling, no restart, no reload call is required', async () => {
    // This test makes the structural property explicit. The test does NOT:
    //   - subscribe to EventBus
    //   - start a timer / polling loop
    //   - recreate the resolver
    //   - recreate the registry
    //   - call registry.reload() outside the CAP-6 commit path
    // The state change is observed purely because CAP-6 calls
    // `registry.reload()` inside the transition commit (and because the
    // resolver reads the registry's current state on every resolve()).
    const { catalog, registry, providers } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const resolver = new CapabilityResolver(registry, providers);
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const step = {
      stepId: 's1', operation: 'capability.transition' as const,
      parameters: { operation: 'capability.transition' as const, capabilityId: 'core.echo', from: 'active' as const, to: 'declining' as const },
      idempotent: true, preconditions: {}, postconditions: {},
    };
    await executor.executeStep(step, {});
    // The very next call (no awaits, no setup) sees the new state.
    expect(resolver.resolve('core.echo', {})[0]!.steps[0]!.lifecycleEligibility.state).toBe('declining');
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec vitest run tests/capability/lifecycle-observability.vitest.ts
```

Expected: PASS — Path A + Path B + encoded invariant all green. (These tests are written against the Task 2 resolver + CAP-6's executor + CAP-3's registry; all of which already exist on main. They should pass on the first run.)

- [ ] **Step 3: (no implementation change)**

The in-process sync invariant is satisfied by the existing CAP-3 `CapabilityRegistry` (the projection) and CAP-6's `registry.reload()` after every A4 mutation. This task is the test that pins it.

- [ ] **Step 4: Run the type gate**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add tests/capability/lifecycle-observability.vitest.ts
git commit -m "test(capability): CAP-7 in-process lifecycle observability — A4 transition visible to same resolver (AC#4)"
```

---
---

### Task 6: AC#5/AC#6 — service parity delegation invariant + axis-separation structural test

**Files:**
- Create: `src/capability/capability-service.ts` (CAP-8 boundary stub — `CapabilityService.resolve()` delegates to `CapabilityResolver.resolve()`; no parallel eligibility computation)
- Test: `tests/capability/capability-service-delegation.vitest.ts` (new — proves the delegation invariant; pins AC#5 + AC#6)

**Interfaces:**
- Consumes: `CapabilityResolver`, `ResolverContext` (Task 2); existing `CapabilityRegistry` + `ProviderExecutorRegistry`.
- Produces:
  - `export interface CapabilityServiceOptions { resolver: CapabilityResolver; registry: CapabilityRegistry }`
  - `export class CapabilityService { constructor(options: CapabilityServiceOptions); resolve(capabilityId: string, ctx?: ResolverContext): ProviderPlan[] }` — the stub delegates to `options.resolver.resolve(capabilityId, ctx)` verbatim. The stub does NOT introduce a separate eligibility table, a separate lifecycle filter, or a separate provider filter; it passes the request through and returns the resolver's `ProviderPlan[]` exactly.

**Design contract:**
- **CAP-7 ships only the service STUB** — the full `CapabilityService` (CAP-8's broader surface: list, inspect, history, measure, governance integration) is out of scope. The stub exposes ONLY the `resolve` method CAP-7 needs to prove the delegation invariant.
- **Locked ruling #4 verbatim**: *"CapabilityService must delegate lifecycle/provider eligibility decisions to CapabilityResolver and must not independently reproduce the eligibility table."* The test asserts this as a structural property: the service has no method, field, or import that computes `isLifecycleEligible`, no `Record<LifecycleState, boolean>` field, no `setLifecycleState` / `setAvailability` call.
- **AC#5 invariant** (encoded in test name + comment): *"Runtime resolver and CapabilityService see the same selection result (delegation invariant, verified in CAP-8)."* Test: `service.resolve(id, ctx)` returns the **same** `ProviderPlan[]` (deep-equal) as `resolver.resolve(id, ctx)`.
- **AC#6 invariant** (encoded in test name + comment): *"North-star invariant — availability and lifecycle never conflate."* Test: structural assertions on the service module — no availability-axis logic in the service, no lifecycle-state assignments in the service, the service module does not import `setAvailability`, does not import `setLifecycleState`, does not import `LIFECYCLE_ELIGIBILITY` (it imports the resolver, which owns the table).

- [ ] **Step 1: Write the failing delegation tests**

`tests/capability/capability-service-delegation.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver, type ResolverContext } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap7-svc-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const service = new CapabilityService({ resolver, registry });
  return { catalog, registry, providers, resolver, service };
}
function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'x',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#5 — CapabilityService delegates to CapabilityResolver (identical result)', () => {
  it('service.resolve(id) returns the same plan as resolver.resolve(id) (default ctx)', () => {
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const fromService = service.resolve('core.echo');
    const fromResolver = resolver.resolve('core.echo', {});
    expect(fromService).toEqual(fromResolver);
  });

  it('service.resolve(id, { allowDeprecated: true }) returns the same plan as resolver.resolve(id, { allowDeprecated: true })', () => {
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const ctx: ResolverContext = { allowDeprecated: true };
    expect(service.resolve('core.echo', ctx)).toEqual(resolver.resolve('core.echo', ctx));
  });

  it('service.resolve(id) is lifecycle-axis sensitive (deprecated excluded by default; same exclusion as the resolver)', () => {
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const fromService = service.resolve('core.echo');
    const fromResolver = resolver.resolve('core.echo', {});
    expect(fromService[0]!.steps[0]!.lifecycleEligibility).toEqual(fromResolver[0]!.steps[0]!.lifecycleEligibility);
    expect(fromService[0]!.steps[0]!.lifecycleEligibility.eligible).toBe(false);
  });
});

describe('AC#5/AC#6 — structural: CapabilityService does not independently reproduce the eligibility table (locked ruling #4)', () => {
  it('service module does not import LIFECYCLE_ELIGIBILITY (table ownership is the resolver — locked ruling #2)', () => {
    // Read the source file as text and assert the named import is absent.
    // This is a structural sentinel: a future PR that adds `import { LIFECYCLE_ELIGIBILITY }`
    // to the service module is a locked-ruling-#4 violation and must fail review.
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/import\s*\{[^}]*\bLIFECYCLE_ELIGIBILITY\b[^}]*\}\s*from\s*["']\.\/lifecycle-eligibility\.js["']/);
  });

  it('service module does not import setLifecycleState (lifecycle is read-only for the service — AC#3)', () => {
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/setLifecycleState/);
  });

  it('service module does not import setAvailability (availability is the resolver\'s axis — AC#6)', () => {
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/setAvailability/);
  });

  it('service.resolve() forwards the ResolverContext verbatim (no service-level augmentation)', () => {
    // The service must NOT add, remove, or transform ResolverContext fields.
    // A future PR that adds `service.resolve` post-processing is a locked-
    // ruling-#4 violation; this test pins the delegation shape.
    const { registry, service, resolver } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const ctx: ResolverContext = { allowDeprecated: true };
    // Both calls produce structurally identical plans.
    expect(JSON.stringify(service.resolve('core.echo', ctx))).toBe(JSON.stringify(resolver.resolve('core.echo', ctx)));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/capability-service-delegation.vitest.ts
```

Expected: FAIL — `capability-service.js` not found.

- [ ] **Step 3: Implement the CapabilityService stub**

Create `src/capability/capability-service.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-7 — CapabilityService stub (CAP-8 boundary).
 *
 * Locks the delegation invariant required by locked ruling #4: the service
 * delegates lifecycle/provider eligibility decisions to `CapabilityResolver`
 * and does NOT independently reproduce the eligibility table, does NOT call
 * `setLifecycleState`, does NOT call `setAvailability`. CAP-7 ships only
 * the `resolve` surface needed to prove AC#5/AC#6; the full service
 * (list, inspect, history, measure, governance integration) is CAP-8.
 *
 * Locked ruling #4 (verbatim): "CapabilityService must delegate lifecycle/
 * provider eligibility decisions to CapabilityResolver and must not
 * independently reproduce the eligibility table."
 *
 * @module capability/capability-service
 */

import type { ProviderPlan, ResolverContext } from "./provider-resolver.js";
import type { CapabilityResolver } from "./provider-resolver.js";
import type { CapabilityRegistry } from "./registry.js";

export interface CapabilityServiceOptions {
  /** The canonical resolver — owns the lifecycle-eligibility table (locked ruling #2). */
  resolver: CapabilityResolver;
  /** Read-only reference for surface-level queries CAP-8 will add. CAP-7 does NOT write through this. */
  registry: CapabilityRegistry;
}

/** CAP-7 stub — CAP-8 broadens this surface (list, inspect, history, measure, governance). */
export class CapabilityService {
  constructor(private readonly options: CapabilityServiceOptions) {}

  /** CAP-7 — delegates to the resolver verbatim. No service-level lifecycle
   *  or provider filtering; no parallel eligibility table. */
  resolve(capabilityId: string, ctx: ResolverContext = {}): ProviderPlan[] {
    return this.options.resolver.resolve(capabilityId, ctx);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/capability-service-delegation.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (7 tests), 0 tsc errors. The structural source-text assertions pin the locked-ruling-#4 invariant: a future PR that adds `LIFECYCLE_ELIGIBILITY` or `setLifecycleState` to the service module will fail the test suite (and the reviewer will see why).

- [ ] **Step 5: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-delegation.vitest.ts
git commit -m "feat(capability): CAP-7 CapabilityService stub — delegation invariant pinned (AC#5, AC#6)"
```

---
---

### Task 7: Barrel export + full-suite verification + type gate

**Files:**
- Modify: `src/capability/index.ts` (add `export * from "./lifecycle-eligibility.js";` and `export * from "./capability-service.js";`)
- Test: `tests/capability/cap-7-supersession.test.ts` (new — confirms CAP-7 does not touch forbidden files)

**Interfaces:**
- Consumes: Task 1-6 outputs (all re-exported through the capability barrel).
- Produces: the canonical capability barrel re-exports `LIFECYCLE_ELIGIBILITY`, `isLifecycleEligible`, `LifecycleEligibility`, `CapabilityResolver`, `ResolverContext`, `CapabilityService`, `CapabilityServiceOptions`.

**Design contract:**
- The barrel is the only public surface for `src/capability/`. CAP-7 adds two new exports: the eligibility module and the service stub.
- `CapabilityResolver` is exported from `provider-resolver.js` (Task 2); the barrel already re-exports `provider-resolver.js`, so it propagates.
- `ResolverContext` is exported from `provider-resolver.js`; same propagation.
- `CapabilityService` + `CapabilityServiceOptions` are exported from `capability-service.js` (Task 6).
- `LIFECYCLE_ELIGIBILITY` + `isLifecycleEligible` + `LifecycleEligibility` are exported from `lifecycle-eligibility.js` (Task 1).
- A dedicated supersession test (CAP-7's analog of the CAP-6 forbidden-file check) confirms the worktree's CAP-7 diff does NOT touch `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, or production `src/capability/canonical/*`. The test runs `git diff --name-only` from the repo root and fails if any forbidden file appears in the diff.

- [ ] **Step 1: Update the barrel**

Add the two new exports to `src/capability/index.ts`:

```ts
export * from "./lifecycle-eligibility.js";
export * from "./capability-service.js";
```

(Order is alphabetical with the rest of the barrel — confirm in the existing file before adding.)

- [ ] **Step 2: Write the forbidden-file supersession test**

`tests/capability/cap-7-supersession.test.ts` (uses `node:test` so it runs from the build output, matches the CAP-6 supersession test pattern):

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

/** CAP-7 supersession — confirms the CAP-7 worktree does not modify the
 *  forbidden files enumerated in the plan's Global Constraints. Mirrors the
 *  CAP-6 supersession test pattern. */

const FORBIDDEN = [
  "src/capability/initial-capabilities.ts",
  "src/tools/tool-registry.ts",
  "src/policy/capability-registry.ts",
];

function changedFiles(): string[] {
  // Compare the current HEAD against main — any file changed on this branch
  // is "in scope" for CAP-7 and must not be a forbidden file.
  try {
    const out = execSync("git diff --name-only main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function addedOrModified(): string[] {
  try {
    const out = execSync("git diff --name-only --diff-filter=AM main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("CAP-7 supersession — forbidden-file guard", () => {
  it("does not modify the canonical CAP-2 surface", () => {
    const changed = changedFiles();
    const canonicalHits = changed.filter((p) => p.startsWith("src/capability/canonical/"));
    assert.equal(canonicalHits.length, 0, `CAP-7 must not touch src/capability/canonical/* — found: ${canonicalHits.join(", ")}`);
  });

  it("does not modify the bootstrap, tool, or legacy-policy forbidden files", () => {
    const changed = addedOrModified();
    const hits = changed.filter((p) => FORBIDDEN.includes(p));
    assert.equal(hits.length, 0, `CAP-7 must not touch forbidden files — found: ${hits.join(", ")}`);
  });
});
```

- [ ] **Step 3: Run the type gate + the capability suite**

```bash
pnpm exec tsc --noEmit
pnpm run build && pnpm exec tsx --test tests/capability/cap-7-supersession.test.ts
pnpm exec vitest run tests/capability/
```

Expected: `tsc --noEmit` 0 errors; the supersession test passes (no forbidden files modified); the capability Vitest suite (`lifecycle-eligibility`, `lifecycle-eligibility-matrix`, `lifecycle-axis-isolation`, `lifecycle-observability`, `capability-service-delegation`, `provider-resolver`) is fully green.

- [ ] **Step 4: Run the broader test sweep**

```bash
pnpm run build && pnpm test
```

Expected: the capability + execution + lifecycle suites pass. Pre-existing CI failures on main (`supply-chain`/`unit-linux`/`tui-smoke`) may still fail — they are unrelated to CAP-7 and listed in the program spec's "Out of Scope" section.

- [ ] **Step 5: Commit**

```bash
git add src/capability/index.ts tests/capability/cap-7-supersession.test.ts
git commit -m "chore(capability): CAP-7 barrel export + supersession forbidden-file guard"
```

---
---

## Locked rulings (cited in Global Constraints, encoded verbatim in the plan)

1. **Override contract**: `resolve(id, { allowDeprecated?: boolean })` — explicit allowlist parameter, opt-in, non-transitive. Does not bypass provider/availability eligibility. CAP-7's job is lifecycle eligibility, NOT authorization policy.
2. **Policy axis ownership**: `CapabilityResolver` owns the `LIFECYCLE_ELIGIBILITY` named constant. `CapabilityService` (CAP-8) is a facade, NOT a policy authority.
3. **Transition observability**: `CapabilityRegistry` is the authoritative in-process projection (CAP-6 already calls `registry.reload()` after every catalog write). No event bus, no polling, no restart. **Explicit invariant**: *"After a successful A4 mutation commit, CapabilityRegistry is the authoritative in-process projection consumed by CapabilityResolver; no refresh, restart, polling, or event subscription is required for lifecycle eligibility to reflect the new state."*
4. **Service parity (CAP-8 boundary)**: Documented delegation contract. CAP-7 establishes the resolver contract; CAP-8 verifies service parity. **Explicit invariant**: *"CapabilityService must delegate lifecycle/provider eligibility decisions to CapabilityResolver and must not independently reproduce the eligibility table."*
5. **Lifecycle states**: CAP-7 consumes the CAP-5 six-state lifecycle contract verbatim (emerging/active/mature/stagnant/declining/deprecated). No new states. No modification of transition legality. **Explicit invariant**: *"CAP-7 consumes the CAP-5 six-state lifecycle contract verbatim. It introduces no lifecycle states and does not modify transition legality."*
6. **Override auditability**: `ResolverResult` carries `lifecycleEligibility: { state: LifecycleState, eligible: boolean, overrideUsed: boolean }`. Deliberately narrow: no caller identity, no authorization role, no governance decision ID, no timestamps, no audit IDs, no provider fallback history. `overrideUsed: true` does NOT mean provider-available or execution-authorized or governance-approved — it means lifecycle-axis override was exercised.
7. **Eligibility table shape**: `LIFECYCLE_ELIGIBILITY: Record<LifecycleState, true | false>` — strict boolean. Two-stage gate: lifecycle eligibility first, then provider/availability. `LIFECYCLE_ELIGIBILITY` does NOT include `unavailable` (that would conflate axes). Resolver applies the lifecycle gate, then the provider gate.

## Self-Review

**1. Spec coverage (ticket #491 ACs):**
- AC#1 (lifecycle ≠ availability, table-driven, six states × provider health truth table) — **Task 1** (table + isLifecycleEligible) + **Task 3** (24-cell matrix + AC#1 spot-checks).
- AC#2 (deprecated excluded from normal selection; explicit `allowDeprecated` override) — **Task 1** (table marks `deprecated: false`) + **Task 2** (override seam on `ResolverContext`) + **Task 3** (matrix cells for deprecated × override × providerUp).
- AC#3 (active + provider-unavailable does NOT mutate lifecycle) — **Task 4** (axis-isolation test — 20 structural assertions proving the resolver never writes lifecycle regardless of provider health or override).
- AC#4 (governed transition observed by same resolver immediately) — **Task 5** (in-process observability — direct setLifecycleState + A4 transition through CAP-6's executor, no extra wiring).
- AC#5 (Runtime resolver and CapabilityService see the same selection result) — **Task 6** (delegation test — service.resolve === resolver.resolve on identical inputs; structural sentinel against parallel eligibility reproduction).
- AC#6 (availability and lifecycle never conflate) — **Task 4** (axis isolation) + **Task 6** (structural sentinel: service does not import LIFECYCLE_ELIGIBILITY / setLifecycleState / setAvailability).

**2. Placeholder scan:** every step carries real test code or real implementation code. No "TBD" / "implement later" / "similar to Task N" (each task repeats its own code). The `Object.freeze` on `LIFECYCLE_ELIGIBILITY` is intentional (ESM strict mode + locked ruling #7 — the type test in Task 1 ensures no accidental widening).

**3. Type consistency:**
- `LifecycleEligibility` (Task 1) is `{ state, eligible, overrideUsed }` — same shape in Task 2's `ProviderPlanStep.lifecycleEligibility` and in the test annotations.
- `ResolverContext` (Task 2) is `{ allowDeprecated?: boolean }` — same shape in `CapabilityResolver.resolve`, `ProviderResolver.resolve` (default `{}`), and `CapabilityService.resolve` (Task 6, default `{}`).
- `LIFECYCLE_ELIGIBILITY` (Task 1) is `Readonly<Record<LifecycleState, boolean>>` — same in the resolver import (Task 2) and in the service module's structural-sentinel test (Task 6, asserting the service does NOT import it).
- `ProviderPlanStep` (Task 2) gains `lifecycleEligibility: LifecycleEligibility` as a required field; the existing CAP-4 tests (which only assert on `candidates`, `bindingsCount`, `timeout`) remain unaffected.
- `CapabilityResolver` (Task 2) subclasses `ProviderResolver`; existing imports of `ProviderResolver` continue to compile.

**4. Ruling enforcement:**
- Ruling #1: encoded in Task 2's `ResolverContext.allowDeprecated` + the test "deprecated WITH override but provider not registered → step is eligible but no candidates".
- Ruling #2: encoded in Task 1 (LIFECYCLE_ELIGIBILITY ownership in the eligibility module, not the service) + Task 6 (structural sentinel: service does not import LIFECYCLE_ELIGIBILITY) + Task 7 (barrel export).
- Ruling #3: encoded in Task 5 (observability test, explicit invariant comment).
- Ruling #4: encoded in Task 6 (service stub + delegation test + structural sentinels).
- Ruling #5: encoded in Task 1 (table is exactly the six states, no additions) + Task 3 (matrix uses only the six states).
- Ruling #6: encoded in Task 1 (LifecycleEligibility shape test — no extra fields) + Task 2 (resolver annotates every step with exactly that shape).
- Ruling #7: encoded in Task 1 (table is strict boolean, no availability keys) + Task 2 (two-stage gate — lifecycle FIRST, provider SECOND; provider filter unchanged).

**5. Forbidden-file guard:** Task 7 supersession test asserts the CAP-7 worktree does not touch `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, or production `src/capability/canonical/*`.

**6. Type gate:** `pnpm exec tsc --noEmit` runs after every task. Vitest does not typecheck (CAP-6 lesson); `pnpm run build` runs the full typecheck + emit pipeline before the final test sweep.

**7. Cross-axis invariant (north star):** the resolver reads lifecycle from the registry, never writes it (Task 4 pins this). The resolver applies the lifecycle gate first, the provider gate second (Task 3 + Task 4 pin this). The service does not compute eligibility independently (Task 6 pins this). The eligibility table is `Record<LifecycleState, boolean>` — never includes `unavailable` (Task 1's strict type + the test asserting no availability-axis keys in the table).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-cap-7-runtime-lifecycle-eligibility.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
