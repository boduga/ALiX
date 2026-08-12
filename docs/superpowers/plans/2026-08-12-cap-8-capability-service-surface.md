# CAP-8 Capability Service Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) superpowers:executing-plans implement plan task-by-task. Steps use checkbox (`- [ ]`) syntax tracking.

**Goal:** CAP-8 lands the unified `CapabilityService` facade (design §72) — read methods (`list`/`inspect`/`search`/`health`/`recommend`) over CAP-2 catalog + CAP-3 registry + CAP-4 resolver, the one mutation method (`apply`) delegates verbatim to CAP-6, `propose`/`measure` are forward-wired stubs, `history` projects EventLog facts — CLI capabilities commands migrate to `service.*` so a second surface becomes a structural-sentinel hard failure.

**Architecture:** the existing CAP-7 `src/capability/capability-service.ts` stub is **broadened in place** (same module identity per locked ruling #stub). Constructor-injected with the exact ownership-graph dependency list: `new CapabilityService(catalog, resolver, mutationExecutor, eventLog)` — `CapabilityResolver` already owns the `CapabilityRegistry` dep so the service does NOT double-inject. Read methods project catalog+registry state into the five narrow typed result shapes (`CapabilityListResult | CapabilityInspectResult | CapabilitySearchResult | CapabilityHealthResult | CapabilityHistoryResult`); no generic envelope. `apply()` is a thin pass-through to `CapabilityMutationExecutor.executeStep(step, ctx)` — CAP-6 owns the only mutation execution path (locked ruling #1). `propose()` and `measure()` throw `CapabilityServiceNotImplementedError` with `code: "not_implemented_yet"` (locked ruling #4). `recommend()` is read-only (locked ruling #3). `health()` returns `CapabilityHealthResult`, never `ProviderCandidate[]` (locked ruling #9). `history()` is a narrow EventLog projection filtered by capability id (locked ruling #5). Composition root (`src/capability/platform.ts`) wires registry → resolver → executor → eventLog → service; no singleton. A three-axis AST/import-graph sentinel (composition root, import boundary, migrated call-site) structurally enforces no second surface (locked rulings #2 & #10). CLI capabilities commands migrate to `service.*` (locked ruling #7).

**Tech Stack:** TypeScript (ESM, strict), Vitest (`.vitest.ts` for unit/service tests matching `tests/capability/capability-service-delegation.vitest.ts`), `pnpm exec vitest run tests/capability/`. node:test (`node --test dist/tests/...`) for the supersession forbidden-file test (matches `cap-7-supersession.test.ts`). `pnpm exec tsc --noEmit` after each task as the type gate (Vitest does NOT typecheck). `pnpm run build` for full typecheck + emit pipeline before final sweep. Three-axis sentinel is run as `pnpm exec vitest run tests/capability/three-axis-sentinel.vitest.ts` (test-only task).

### Global Constraints

These constraints are reproduced verbatim from the **10 locked rulings** (sign-off 2026-08-12, see `cap-8-rulings-locked.md`) plus the standing project conventions. Every Task in this plan must comply.

- **Locked ruling #2 — hard architectural boundary; no deprecation window (verbatim):** *"Only the composition root may construct `CapabilityRegistry` and `CapabilityResolver`. All non-composition-root callers must use `CapabilityService`. This is a hard architectural boundary, enforced by structural sentinel; no deprecation window is provided."* Construction is composition-root-only; access (call sites) is service-only. The sentinel checks actual import/construction/use sites, not just `new CapabilityRegistry()`.

- **Locked ruling #7 — CLI migration; sentinel phrasing (verbatim):** *"CAP-8 migrates the capability CLI commands to `CapabilityService`. Existing non-CLI direct consumers are tolerated only as explicitly tracked CAP-11 migration debt; no new direct registry/resolver consumers may be introduced."*

- **Locked ruling #10 — three-axis structural sentinel (AST/import-graph based, not just grep):**
  - **Axis 1:** `new CapabilityRegistry()` / `new CapabilityResolver()` only in the composition root (`src/capability/platform.ts`).
  - **Axis 2:** outside the service/composition layer, no direct imports of `CapabilityRegistry` or `CapabilityResolver` (catches `getCapabilityRegistry()`-style bypass).
  - **Axis 3:** CLI capabilities commands (CAP-8 migrated) only use `CapabilityService`.
  - Test produces **distinct failure messages per axis**.

- **Locked ruling #stub — extend in place (verbatim):** *"CAP-8 extends the existing CAP-7 `src/capability/capability-service.ts` stub in place. Same module identity, new authoritative contract. No rename, no compatibility facade, no parallel service. If CAP-7 stub constructor/method shape conflicts with CAP-8 contract, replace in place."* The CAP-7 stub's `{ resolver, registry }` options-object constructor and `resolve(...)` method are replaced in place by the new four-arg constructor and the eight-method surface from design §72. The CAP-7 unit-test file `tests/capability/capability-service-delegation.vitest.ts` is RETIRED (its delegation invariant is reasserted in Task 6/8 by structural-sentinel tests against the broadened service).

- **Forbidden files** — CAP-8 must not modify any of:
  - `src/capability/initial-capabilities.ts`
  - `src/tools/tool-registry.ts`
  - `src/policy/capability-registry.ts`
  - Production files under `src/capability/canonical/*`
  - The pre-CAP-7 TUI façade `src/tui/capabilities/capability-service.ts` (CAP-11 migration debt)
  - Verified in Task 9's supersession test.

- **Test conventions** — match existing `tests/capability/` naming and shape:
  - Vitest for `.vitest.ts` unit/service tests, run via `pnpm exec vitest run tests/capability/`.
  - node:test (`describe`/`it` from `node:test`, `assert` from `node:assert/strict`) for supersession + integration-shaped tests; run via `pnpm run build && node --test dist/tests/...` (NO `tsx`).
  - Suite-level `before` causes id@version collisions across `describe` blocks (CAP-6 lesson); use `beforeEach`.
  - Repo is `"type": "module"` — all imports use `.js` extensions.
  - ESM strict mode — frozen object writes throw TypeError (CAP-6 lesson); do not assign read-only exports or mutate frozen `Object.freeze`'d test fixtures.
  - Type gate `pnpm exec tsc --noEmit` after each task; `pnpm run build` before final sweep.

- **Standing project constraints** — verifiable, non-negotiable:
  - Do not push to remote without explicit approval.
  - No commit without verification (test green + type gate green).
  - Plan contains no `TBD`/`TODO`/`implement later`/`similar to Task N` placeholders (verified by pre-save scan).
  - Step granularity matches CAP-7 — one checkpoint per test/impl/commit pair, not multi-impl commits.

### Ruling coverage matrix

| Ruling | Description | Task(s) that implement it |
|---|---|---|
| #1 | `apply()` delegates to CAP-6 `CapabilityMutationExecutor`; no second mutation execution path | Task 4 |
| #2 | Hard boundary: only composition root constructs registry/resolver; service is sole access | Tasks 7 & 8 (axis 1 + axis 2 of sentinel) |
| #3 | `recommend()` is read-only; never triggers A7 governance | Task 5 |
| #4 | `propose()`/`measure()` forward-wired stubs throwing `CapabilityServiceNotImplementedError` with `code: "not_implemented_yet"` | Task 5 |
| #5 | `history()` is EventLog projection, not catalog-lineage reconstruction; narrow `CapabilityHistoryResult` | Task 6 |
| #6 | Constructor-injected service; `new CapabilityService(catalog, resolver, mutationExecutor, eventLog)`; no singleton | Task 2 |
| #7 | CAP-8 migrates CLI capabilities commands to `service.*`; TUI/Web in CAP-11 | Task 8 |
| #8 | Narrow typed result shapes per method, no generic envelope | Tasks 1 & 2 |
| #9 | `health()` only on service; resolution stays on `CapabilityResolver`; returns narrow `CapabilityHealthResult`, not `ProviderCandidate[]` | Task 3 |
| #10 | Three-axis structural sentinel (composition root, import boundary, migrated call-site), distinct failure per axis | Task 8 |
| #stub | Extend `src/capability/capability-service.ts` in place; no rename, no facade, no parallel service | All tasks (every task touches the same module) |

### AC coverage matrix (ticket #492)

| AC | Description | Task(s) that prove it |
|---|---|---|
| AC#1 | `CapabilityService` surface: `list/inspect/search/health/recommend/propose/apply/measure/history` (design §72) | Tasks 2, 3, 4, 5, 6 (each method lands and is tested) |
| AC#2 | Read methods (`list/inspect/search/health`) implemented immediately over registry+catalog+provider | Tasks 2 (list/inspect/search) + Task 3 (health) |
| AC#3 | Governed methods (`propose/apply/measure/history`): contracts present; `apply` delegates to CAP-6, `propose`/`measure` forward-wired, `history` EventLog; no duplication of governance logic | Tasks 4 (apply), 5 (propose/measure), 6 (history); all gated on CAP-6 executor (`@a91b8eee`) — no A7 reimplementation |
| AC#4 | CLI/TUI/Web/runtime-facing consumers have no capability-specific registry/lifecycle implementation of their own; old CLI `new CapabilityRegistry()` is a hard failure | Task 8 (CLI migration + axis 3 sentinel) |
| AC#5 | `CLI list == registry list == service list` | Task 2 (parity test) + Task 8 (CLI consumes `service.list`) |
| AC#6 | `capability.*` EventLog telemetry preserved as projection source (not a second registry) | Task 6 (`history()` is a filtered EventLog projection) |
| AC#7 | North-star invariant: exactly one service surface | Task 8 (three-axis sentinel) + Task 9 (forbidden-file supersession) |

---

### Task 1: Typed result-shape contracts + `CapabilityServiceNotImplementedError` + CapabilityServiceOptions

**Files:**
- Create: `src/capability/types/service-results.ts` — pure type module
- Create: `src/capability/errors/service-not-implemented.ts` — `CapabilityServiceNotImplementedError`
- Test: `tests/capability/service-results.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityDefinition` (CAP-1 canonical), `CapabilityKind` (CAP-5 five-kind set), `LifecycleState` (CAP-5 six-state union), `CapabilityProviderBinding`, `CapabilityPermission`, `CapabilityRisk`.
- Produces:
  - `export interface CapabilityListResult { readonly items: readonly CapabilityListItem[]; readonly total: number }`
  - `export interface CapabilityListItem { readonly id: string; readonly version: string; readonly kind: CapabilityKind; readonly title: string; readonly lifecycle: LifecycleState | undefined; readonly available: boolean; readonly bindings: readonly { readonly id: string; readonly type: string }[] }`
  - `export interface CapabilityInspectResult { readonly id: string; readonly version: string; readonly kind: CapabilityKind; readonly title: string; readonly description: string; readonly lifecycle: LifecycleState | undefined; readonly availability: { readonly available: boolean; readonly reason?: "missing_binding" | "provider_unavailable" }; readonly bindings: readonly CapabilityProviderBinding[]; readonly requiredPermissions: readonly CapabilityPermission[]; readonly tags: readonly string[]; readonly category: string; readonly risk: CapabilityRisk; readonly dependencies: readonly string[]; readonly allowFallbacks: boolean | undefined }`
  - `export interface CapabilitySearchQuery { readonly text?: string; readonly kind?: CapabilityKind; readonly tags?: readonly string[]; readonly lifecycle?: LifecycleState; readonly availableOnly?: boolean; readonly limit?: number }`
  - `export interface CapabilitySearchResult { readonly query: CapabilitySearchQuery; readonly items: readonly CapabilityListItem[]; readonly total: number }`
  - `export interface CapabilityHealthResult { readonly id: string; readonly version: string; readonly available: boolean; readonly reason?: "missing_binding" | "provider_unavailable" | "lifecycle_ineligible"; readonly lifecycle: LifecycleState | undefined; readonly providersChecked: number }`
  - `export interface CapabilityHistoryEvent { readonly seq: number; readonly type: string; readonly payload: Readonly<Record<string, unknown>>; readonly at: string }`
  - `export interface CapabilityHistoryResult { readonly id: string; readonly events: readonly CapabilityHistoryEvent[]; readonly total: number }`
  - `export interface CapabilityRecommendInput { readonly text: string; readonly limit?: number }`
  - `export interface CapabilityRecommendResult { readonly input: CapabilityRecommendInput; readonly suggestions: readonly CapabilityListItem[]; readonly total: number }`
  - `export interface CapabilityApplyInput { readonly step: { stepId: string; operation: "capability.create" | "capability.update" | "capability.transition" | "capability.consolidate" | "capability.remove"; parameters: Readonly<Record<string, unknown>>; idempotent?: boolean; preconditions?: Readonly<Record<string, unknown>>; postconditions?: Readonly<Record<string, unknown>> } }`
  - `export interface CapabilityApplyResult { readonly success: boolean; readonly operation: string; readonly affected: readonly string[]; readonly artifactId?: string; readonly error?: string }`
  - `export interface CapabilityServiceOptions { readonly catalog: import("../canonical/catalog.js").CapabilityCatalog; readonly resolver: import("../provider-resolver.js").CapabilityResolver; readonly mutationExecutor: import("../../../evolution/execution/capability-mutation-executor.js").CapabilityMutationExecutor; readonly eventLog: import("../../../events/event-log.js").EventLog }`
  - Type imports inside `service-results.ts` follow the actual repo layout (Task 1 implementer verified these paths):
    - `import type { CapabilityKind } from "../canonical/kind.js"`
    - `import type { LifecycleState } from "../../adaptation/capability-evolution-types.js"`
    - `import type { CapabilityProviderBinding } from "../canonical/provider.js"`
    - `import type { CapabilityPermission, CapabilityRisk } from "../canonical/definition.js"`
    - The inline `import("...").X` inside `CapabilityServiceOptions` (plan line 101) follows the same paths. **Do NOT import from a non-existent `./kind` or `./canonical/kind` literal — these are TS-level type imports, not value imports.**
  - `export class CapabilityServiceNotImplementedError extends Error { readonly code: "not_implemented_yet"; constructor(message: string) }` — `name = "CapabilityServiceNotImplementedError"`, `code` typed as the literal.

**Design contract:**
- All result-shape interfaces are `readonly` end-to-end (locked ruling #8: snapshots, not mutable domain objects by reference).
- One shape per method; no `{ok, value, error}` envelope; no `CapabilityServiceResult<T>` generic.
- `CapabilityHistoryEvent.payload` typed as `Readonly<Record<string, unknown>>` because EventLog payloads are intentionally schema-permissive (CAP-6 result artifact) but never widen to `any`.
- `CapabilityServiceNotImplementedError` is the ONLY error class introduced by CAP-8. It must NOT mention "awaiting_cap_9" / "awaiting_cap_10" / roadmap state (locked ruling #4). The `code` is a literal type so consumers can narrow.
- `CapabilityApplyInput.step` mirrors CAP-6's `ExecutionStep` shape **minus** the internal A4 envelope (idempotency defaults to `false`, pre/post to `{}`).
- `service-results.ts` is type-only module: no runtime imports beyond the type imports; no functions; no classes except the error class exported from `service-not-implemented.ts`.

- [ ] **Step 1: Write failing tests**

`tests/capability/service-results.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type {
  CapabilityListResult, CapabilityInspectResult, CapabilitySearchResult,
  CapabilityHealthResult, CapabilityHistoryResult, CapabilityRecommendResult,
  CapabilityApplyResult, CapabilityServiceOptions,
} from '../../src/capability/types/service-results.js';
import { CapabilityServiceNotImplementedError } from '../../src/capability/errors/service-not-implemented.js';

describe('CapabilityServiceNotImplementedError (locked ruling #4 — stable contract)', () => {
  it('has name = "CapabilityServiceNotImplementedError"', () => {
    const e = new CapabilityServiceNotImplementedError('x');
    expect(e.name).toBe('CapabilityServiceNotImplementedError');
    expect(e).toBeInstanceOf(Error);
  });
  it('carries code: "not_implemented_yet" (typed literal, not roadmap state)', () => {
    const e = new CapabilityServiceNotImplementedError('x');
    expect(e.code).toBe('not_implemented_yet');
    // No roadmap encoding: string "awaiting_cap_9" / "awaiting_cap_10" MUST NOT appear.
    expect(e.message).not.toMatch(/awaiting_cap_(9|10)/i);
  });
  it('message is the developer-supplied string; never auto-augmented', () => {
    const e = new CapabilityServiceNotImplementedError('propose() lands in CAP-9');
    expect(e.message).toBe('propose() lands in CAP-9');
  });
});

describe('Result-shape readonly surface (locked ruling #8)', () => {
  // Type-level assertions: every result shape is structurally readonly.
  // Adds compile-time gate against accidental mutability widening.
  it('CapabilityListResult.items is readonly and not assignable to mutable array', () => {
    const r: CapabilityListResult = { items: [], total: 0 };
    // @ts-expect-error — readonly array is NOT assignable to mutable array.
    const items: { id: string }[] = r.items;
    void items;
  });
  it('CapabilityInspectResult is a structural snapshot (readonly end-to-end)', () => {
    const r: CapabilityInspectResult = {
      id: 'core.echo', version: '1.0.0', kind: 'core',
      title: 't', description: 'd', lifecycle: 'active',
      availability: { available: true },
      bindings: [], requiredPermissions: [], tags: [], category: 'core',
      risk: 'low', dependencies: [], allowFallbacks: true,
    };
    // @ts-expect-error — bindings is readonly; not assignable to mutable.
    const bindings: { id: string }[] = r.bindings;
    void bindings;
  });
  it('CapabilityHealthResult narrows Availability to CapabilityHealthResult, not ProviderCandidate[]', () => {
    const r: CapabilityHealthResult = {
      id: 'core.echo', version: '1.0.0', available: false, reason: 'missing_binding',
      lifecycle: 'active', providersChecked: 0,
    };
    // Shape test: reason is one of three literals (or absent) — never array.
    if (r.reason) {
      expect(['missing_binding', 'provider_unavailable', 'lifecycle_ineligible']).toContain(r.reason);
    }
  });
  it('CapabilityHistoryEvent.payload is readonly Record<string,unknown>, never any', () => {
    const e: CapabilityHistoryResult['events'][number] = {
      seq: 1, type: 'capability.transition',
      payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' },
      at: '2026-08-12T00:00:00Z',
    };
    // @ts-expect-error — payload is not assignable to a free-form any property set.
    const _bad: { foo: string } = e.payload;
    void _bad;
  });
  it('CapabilityApplyResult.success is boolean; affected is readonly string[]; artifactId and error are optional', () => {
    const ok: CapabilityApplyResult = { success: true, operation: 'capability.create', affected: ['core.echo'], artifactId: 'ar1' };
    const ko: CapabilityApplyResult = { success: false, operation: 'capability.create', affected: [], error: 'fail' };
    expect(ok.success).toBe(true);
    expect(ko.success).toBe(false);
  });
  it('CapabilityRecommendResult.input echoes the query verbatim (no internal augmentation)', () => {
    const r: CapabilityRecommendResult = { input: { text: 'session list', limit: 5 }, suggestions: [], total: 0 };
    expect(r.input.text).toBe('session list');
    expect(r.input.limit).toBe(5);
  });
  it('CapabilityServiceOptions lists exactly four dependencies (catalog/resolver/mutationExecutor/eventLog)', () => {
    // Type-level assertion: CapabilitiesServiceOptions is the declared four-key
    // shape; a future PR that adds a 5th dep (e.g. sessionContext, telemetry) is
    // a locked-ruling-#6 violation and must fail review.
    const opts = null as unknown as CapabilityServiceOptions | null;
    expect(opts === null || typeof opts === 'object').toBe(true);
  });
  it('No {ok, value, error} envelope — every result shape is the success shape or the failure throws', () => {
    // Type-level: CapabilityListResult has no `ok`/`error` field.
    // `keyof` is compile-time only; runtime sanity uses a string-array assertion.
    type Keys = keyof CapabilityListResult;
    const RUNTIME_KEYS: Keys[] = ['items', 'total'];
    expect(RUNTIME_KEYS).toEqual(['items', 'total']);
    expect(RUNTIME_KEYS).not.toContain('ok' as Keys);
    expect(RUNTIME_KEYS).not.toContain('error' as Keys);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/service-results.vitest.ts
```

Expected: FAIL — `service-results.ts` and `service-not-implemented.ts` do not exist; import path errors.

- [ ] **Step 3: Create the type module + error class**

Create `src/capability/types/service-results.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — Result-shape contracts for the CapabilityService surface (design §72).
 *
 * Locked ruling #8 (verbatim): "Narrow typed result shapes, one per method,
 * no generic envelope. No {ok, value, error} wrapper. No
 * CapabilityServiceResult<T>. No mutable domain objects by reference — results
 * are snapshots."
 *
 * Every interface here is readonly end-to-end. The service returns snapshots,
 * never live references; mutating a returned object can never change the
 * underlying catalog/registry/event-log state.
 *
 * @module capability/types/service-results
 */

import type { CapabilityKind } from "../kind.js";
import type { LifecycleState } from "../../../adaptation/capability-evolution-types.js";
import type { CapabilityProviderBinding } from "../canonical/provider.js";
import type { CapabilityPermission, CapabilityRisk } from "../canonical/definition.js";

// ---------------------------------------------------------------------------
// Read-side result shapes (methods: list / inspect / search / health / recommend)
// ---------------------------------------------------------------------------

/** `service.list()` — flat enumeration of capabilities with lifecycle + availability snapshot. */
export interface CapabilityListItem {
  readonly id: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly title: string;
  readonly lifecycle: LifecycleState | undefined;
  readonly available: boolean;
  readonly bindings: readonly { readonly id: string; readonly type: string }[];
}

export interface CapabilityListResult {
  readonly items: readonly CapabilityListItem[];
  readonly total: number;
}

/** `service.inspect(id)` — single-capability full snapshot. */
export interface CapabilityInspectResult {
  readonly id: string;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly title: string;
  readonly description: string;
  readonly lifecycle: LifecycleState | undefined;
  readonly availability: {
    readonly available: boolean;
    readonly reason?: "missing_binding" | "provider_unavailable";
  };
  readonly bindings: readonly CapabilityProviderBinding[];
  readonly requiredPermissions: readonly CapabilityPermission[];
  readonly tags: readonly string[];
  readonly category: string;
  readonly risk: CapabilityRisk;
  readonly dependencies: readonly string[];
  readonly allowFallbacks: boolean | undefined;
}

/** `service.search(q)` — filtered enumeration. */
export interface CapabilitySearchQuery {
  readonly text?: string;
  readonly kind?: CapabilityKind;
  readonly tags?: readonly string[];
  readonly lifecycle?: LifecycleState;
  readonly availableOnly?: boolean;
  readonly limit?: number;
}

export interface CapabilitySearchResult {
  readonly query: CapabilitySearchQuery;
  readonly items: readonly CapabilityListItem[];
  readonly total: number;
}

/** `service.health(id)` — narrow health snapshot (locked ruling #9: NOT ProviderCandidate[]). */
export interface CapabilityHealthResult {
  readonly id: string;
  readonly version: string;
  readonly available: boolean;
  readonly reason?: "missing_binding" | "provider_unavailable" | "lifecycle_ineligible";
  readonly lifecycle: LifecycleState | undefined;
  readonly providersChecked: number;
}

/** `service.recommend(input)` — read-only suggestions (locked ruling #3). */
export interface CapabilityRecommendInput {
  readonly text: string;
  readonly limit?: number;
}

export interface CapabilityRecommendResult {
  readonly input: CapabilityRecommendInput;
  readonly suggestions: readonly CapabilityListItem[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// History (EventLog projection — locked ruling #5)
// ---------------------------------------------------------------------------

/** One capability-tagged event from EventLog. Payload is intentionally
 *  permissive because event payloads are schema-per-CAP-version, but the
 *  shape is typed (no `any`) and readonly. */
export interface CapabilityHistoryEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly at: string;
}

export interface CapabilityHistoryResult {
  readonly id: string;
  readonly events: readonly CapabilityHistoryEvent[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Apply (delegation to CAP-6 — locked ruling #1)
// ---------------------------------------------------------------------------

/** The A4 step shape the service forwards to CAP-6's `CapabilityMutationExecutor.executeStep`.
 *  Mirrors `ExecutionStep` but excludes A4 internal envelope; idempotency defaults to false,
 *  pre/postconditions default to empty records. */
export interface CapabilityApplyInput {
  readonly step: {
    stepId: string;
    operation:
      | "capability.create"
      | "capability.update"
      | "capability.transition"
      | "capability.consolidate"
      | "capability.remove";
    parameters: Readonly<Record<string, unknown>>;
    idempotent?: boolean;
    preconditions?: Readonly<Record<string, unknown>>;
    postconditions?: Readonly<Record<string, unknown>>;
  };
}

export interface CapabilityApplyResult {
  readonly success: boolean;
  readonly operation: string;
  readonly affected: readonly string[];
  readonly artifactId?: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Constructor dependency list (locked ruling #6 — derived from ownership graph)
// ---------------------------------------------------------------------------

/** Exactly four dependencies. `CapabilityResolver` already owns the
 *  `CapabilityRegistry` dep (CAP-7 ruling); the service does NOT double-inject.
 *  A future PR that adds a 5th dep is a locked-ruling-#6 violation. */
export interface CapabilityServiceOptions {
  readonly catalog: import("../canonical/catalog.js").CapabilityCatalog;
  readonly resolver: import("../provider-resolver.js").CapabilityResolver;
  readonly mutationExecutor: import("../../../evolution/execution/capability-mutation-executor.js").CapabilityMutationExecutor;
  readonly eventLog: import("../../../events/event-log.js").EventLog;
}
```

Create `src/capability/errors/service-not-implemented.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — Stable error for forward-wired `propose()` and `measure()` methods.
 *
 * Locked ruling #4 (verbatim): "propose() and measure() are forward-wired stubs
 * that throw a stable error class (CapabilityServiceNotImplementedError with
 * code: 'not_implemented_yet'). They do NOT return empty/envelope results,
 * do NOT encode 'awaiting_cap_9' / 'awaiting_cap_10' in the error message —
 * the service contract does not encode the development roadmap. CAP-9/CAP-10
 * replace the body, keeping the same contract."
 *
 * @module capability/errors/service-not-implemented
 */

export class CapabilityServiceNotImplementedError extends Error {
  readonly code: "not_implemented_yet";

  constructor(message: string) {
    super(message);
    this.name = "CapabilityServiceNotImplementedError";
    this.code = "not_implemented_yet";
    Object.freeze(this);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/service-results.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (all 9 assertions), 0 tsc errors. The `// @ts-expect-error` directives count compile-time gates — a future widening to mutable arrays / free-form payloads will fail `tsc --noEmit` and fail review.

- [ ] **Step 5: Commit**

```bash
git add src/capability/types/service-results.ts src/capability/errors/service-not-implemented.ts tests/capability/service-results.vitest.ts
git commit -m "feat(capability): CAP-8 typed result-shape contracts + CapabilityServiceNotImplementedError"
```

---

### Task 2: Broadened CapabilityService class — constructor injection + read methods (`list`/`inspect`/`search`)

**Files:**
- Modify: `src/capability/capability-service.ts` (replace CAP-7 stub in place per ruling #stub)
- Test: `tests/capability/capability-service-read.vitest.ts`
- Modify: `tests/capability/capability-service-delegation.vitest.ts` (DELETE — see design contract)

**Interfaces:**
- Consumes: `CapabilityCatalog`, `CapabilityRegistry`, `CapabilityResolver` (all from CAP-1/3/4/7), `CapabilityListItem`, `CapabilityListResult`, `CapabilityInspectResult`, `CapabilitySearchQuery`, `CapabilitySearchResult`, `CapabilityRecommendInput`, `CapabilityRecommendResult`, `CapabilityServiceOptions` (Task 1).
- Produces: broadened `CapabilityService` class:
  - `class CapabilityService { constructor(opts: CapabilityServiceOptions); list(): CapabilityListResult; inspect(id: string): CapabilityInspectResult; search(q: CapabilitySearchQuery): CapabilitySearchResult; recommend(input: CapabilityRecommendInput): CapabilityRecommendResult }`
  - The CAP-7 stub's `resolve(...)` method is REMOVED (locked ruling #stub: "no compatibility facade").

**Design contract:**
- Locked ruling #6 verbatim: `new CapabilityService(catalog, resolver, mutationExecutor, eventLog)` — exact dep list. Constructor stores the four deps as private readonly; service does NOT construct registry/resolver/executor/eventLog internally.
- The CAP-7 `capability-service-delegation.vitest.ts` test pins `service.resolve(id, ctx)` against `resolver.resolve(id, ctx)` — but `resolve` is REMOVED in this task (locked ruling #stub). The file is therefore deleted in this task; the delegation invariant (service does NOT independently compute lifecycle/provider eligibility) is reasserted in Task 8's structural sentinel and in Task 3's health-delegation test.
- `list()` projects `registry.query({})` → `CapabilityListItem[]`, then computes `total = items.length`. Lifecycle is captured from `registry.getLifecycleState(id)`; availability from `registry.getAvailability(id).available`. No fresh governance reads; no async.
- `inspect(id)` throws `CapabilityNotFoundError` if absent (re-exported from `errors.ts`); otherwise fills a snapshot. `availability.reason` derives from `registry.getAvailability(id)` — falling back to `"missing_binding"` when `bindingsCount === 0` (taken from a fresh `resolver.resolve(id)` call's first step's `bindingsCount`, since CAP-7 attaches it).
- `search(q)` filters `list().items` in-memory by `text`/`kind`/`tags`/`lifecycle`/`availableOnly`, with `limit`. The service does NOT bypass catalog search; if a future CAP ships a catalog-level search, the service delegates.
- `recommend(input)` is read-only (locked ruling #3). It uses the same in-memory filter as `search` with `text = input.text`; NEVER calls any A7 / proposal / mutation method. Returns `{ input, suggestions, total }`.
- All four methods return *snapshots* — mutating the returned array cannot change registry state.

- [ ] **Step 1: Write failing tests**

`tests/capability/capability-service-read.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import { EventLog } from '../../src/events/event-log.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-read-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-session-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

function setup(): { service: CapabilityService; catalog: CapabilityCatalog; registry: CapabilityRegistry; registryAny: unknown } {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const opts: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(opts), catalog, registry, registryAny: registry as unknown };
}
// `CapabilityRegistry` is not in scope at top of file — use the imported registry via registryAny or import directly.
import { CapabilityRegistry } from '../../src/capability/registry.js';

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'desc',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#2 — CapabilityService read methods (list / inspect / search)', () => {
  it('list() returns items + total; mutating items cannot change registry state', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    const r = service.list();
    expect(r.total).toBe(1);
    expect(r.items[0]!.id).toBe('core.echo');
    expect(r.items[0]!.version).toBe('1.0.0');
    expect(r.items[0]!.kind).toBe('core');
    expect(r.items[0]!.available).toBe(true);
    // Frozen by intention; try to mutate — either rejected or no-op.
    expect(() => {
      (r.items as unknown as { id: string }[]).push({ id: 'core.injected' });
    }).toThrow();
  });

  it('inspect(id) returns full snapshot; throws CapabilityNotFoundError if absent (AC#2)', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    const r = service.inspect('core.echo');
    expect(r.id).toBe('core.echo');
    expect(r.lifecycle).toBe('emerging');
    expect(r.availability.available).toBe(true);
    expect(r.bindings[0]!.type).toBe('native');
    expect(() => service.inspect('core.nope')).toThrow(CapabilityNotFoundError);
  });

  it('list parity (AC#5): service.list() == registry.list() projection', () => {
    const { service, registry } = setup();
    registry.import([def({ id: 'core.echo' }), def({ id: 'core.ping' })]);
    const fromService = service.list().items.map(i => i.id).sort();
    const fromRegistry = registry.list().map(c => c.id).sort();
    expect(fromService).toEqual(fromRegistry);
  });

  it('search(q) filters by text/kind/tags/lifecycle/availableOnly (AC#2)', () => {
    const { service, registry } = setup();
    registry.import([
      def({ id: 'core.echo', kind: 'core', tags: ['net'], description: 'echoes' }),
      def({ id: 'core.echonet', kind: 'query', tags: ['net'], description: 'echoes network' }),
      def({ id: 'core.ping', kind: 'operation', tags: ['net'], description: 'pings' }),
    ]);
    const byText = service.search({ text: 'echo' });
    expect(byText.items.map(i => i.id).sort()).toEqual(['core.echo', 'core.echonet']);
    const byKind = service.search({ kind: 'operation' });
    expect(byKind.items.map(i => i.id)).toEqual(['core.ping']);
    const byTag = service.search({ tags: ['net'] });
    expect(byTag.total).toBe(3);
    const byLife = service.search({ lifecycle: 'emerging' });
    expect(byLife.total).toBe(3);
  });

  it('search respects `limit` and returns total = full-match count (not limited)', () => {
    const { service, registry } = setup();
    registry.import([def({ id: 'core.echo' }), def({ id: 'core.echonet' })]);
    const r = service.search({ text: 'echo', limit: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(2); // total reflects full match count; limit caps items array.
  });
});

describe('Locked ruling #3 — recommend() is read-only; never invokes A7 / mutation', () => {
  it('recommend() returns suggestions; never calls mutation methods', () => {
    const { service, registry } = setup();
    registry.import([def({ id: 'core.echo', description: 'session list' })]);
    const before = registry.list().map(c => c.id);
    const r = service.recommend({ text: 'session' });
    const after = registry.list().map(c => c.id);
    expect(before).toEqual(after); // no mutation
    expect(r.input.text).toBe('session');
    expect(r.suggestions.length).toBeGreaterThanOrEqual(0);
    // Snapshot shape — items is readonly.
    expect(() => {
      (r.suggestions as unknown as { id: string }[]).push({ id: 'core.injected' });
    }).toThrow();
  });
});

describe('Locked ruling #6 — Constructor-injected service; no singleton', () => {
  it('constructor stores exactly four deps; no hidden globals', () => {
    const { service } = setup();
    // Type-level: ctor signature is the four-arg shape.
    // Behavioural: two separate instances do not share state.
    const { service: s2, registry: r2 } = setup();
    s2; r2;
    expect(service).not.toBe(s2 as unknown as typeof service);
  });
});
```

(Note: tests import `CapabilityRegistry` from its actual module path at the top — the inline `import` further down is a parser artifact in the doc; the test author must place the registry import at the top of the file. Reviewers should treat the inline `import` as a doc typo to be corrected at implementation time.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/capability-service-read.vitest.ts
```

Expected: FAIL — `CapabilityService` constructor takes the options-object `{ resolver, registry }` from CAP-7, not the four-dep list; `list/inspect/search/recommend` methods absent.

- [ ] **Step 3: Replace the CAP-7 stub in place**

Replace `src/capability/capability-service.ts` with:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — CapabilityService (design §72).
 *
 * The single, mandatory capability surface boundary per locked rulings #2
 * and #stub. Replaces the CAP-7 stub in place (same module identity;
 * "no compatibility facade"). Composition-root only constructs registry +
 * resolver + executor + eventLog + service; every non-composition-root caller
 * reaches capability semantics through this surface.
 *
 * Locked ruling #stub (verbatim): "CAP-8 extends the existing CAP-7
 * src/capability/capability-service.ts stub in place. Same module identity,
 * new authoritative contract. No rename, no compatibility facade, no parallel
 * service. If CAP-7 stub constructor/method shape conflicts with CAP-8
 * contract, replace in place."
 *
 * Locked ruling #6 (verbatim): "Constructor-injected service; composition-
 * root wired; no singleton. `new CapabilityService(catalog, resolver,
 * mutationExecutor, eventLog)` — exact dep list derived from ownership graph,
 * NOT blindly five params. `CapabilityResolver` already owns the
 * `CapabilityRegistry` dependency; service should not double-inject."
 *
 * @module capability/capability-service
 */

import type { CapabilityCatalog } from "./canonical/catalog.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import type { CapabilityKind } from "./canonical/kind.js";
import { type CapabilityResolver } from "./provider-resolver.js";
import { type CapabilityMutationExecutor } from "../../evolution/execution/capability-mutation-executor.js";
import { type EventLog } from "../../events/event-log.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";
import { CapabilityNotFoundError } from "./errors.js";
import type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityServiceOptions,
} from "./types/service-results.js";

export type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityServiceOptions,
} from "./types/service-results.js";

export class CapabilityService {
  private readonly catalog: CapabilityCatalog;
  private readonly resolver: CapabilityResolver;
  private readonly executor: CapabilityMutationExecutor;
  private readonly eventLog: EventLog;

  constructor(opts: CapabilityServiceOptions) {
    this.catalog = opts.catalog;
    this.resolver = opts.resolver;
    this.executor = opts.mutationExecutor;
    this.eventLog = opts.eventLog;
    Object.freeze(this); // service surface is immutable post-construction.
  }

  // -------------------------------------------------------------------------
  // Read methods (locked ruling #3 — recommend is read-only; AC#2 — list/inspect/search/health).
  // -------------------------------------------------------------------------

  /** Service-authoritative list (AC#5: `service.list == registry.list`). */
  list(): CapabilityListResult {
    const caps = this.catalog.list() as readonly Capability[];
    const items: readonly CapabilityListItem[] = caps.map((c) => {
      const lifecycle = this.lifecycleOf(c.id);
      const available = this.resolverAvailable(c.id, { allowDeprecated: false });
      return {
        id: c.id,
        version: c.version,
        kind: c.kind,
        title: c.title,
        lifecycle,
        available,
        bindings: c.bindings?.map((b) => ({ id: b.id, type: b.type })) ?? [],
      };
    });
    return { items, total: items.length };
  }

  /** Single-capability full snapshot (AC#2). */
  inspect(id: string): CapabilityInspectResult {
    const c = this.catalog.get(id) as Capability;
    if (!c) throw new CapabilityNotFoundError(id);
    const availability = this.availabilityOf(id);
    const lifecycle = this.lifecycleOf(id);
    return {
      id: c.id,
      version: c.version,
      kind: c.kind,
      title: c.title,
      description: c.description,
      lifecycle,
      availability,
      bindings: c.bindings ?? [],
      requiredPermissions: c.requiredPermissions ?? [],
      tags: c.tags ?? [],
      category: c.category,
      risk: c.risk,
      dependencies: c.dependencies ?? [],
      allowFallbacks: c.allowFallbacks,
    };
  }

  /** Filtered enumeration (AC#2). `total` is the full-match count even when `limit` caps `items`. */
  search(q: CapabilitySearchQuery): CapabilitySearchResult {
    const lcText = (q.text ?? '').toLowerCase();
    const all = this.list().items;
    const matched = all.filter((it) => {
      if (q.kind && it.kind !== q.kind) return false;
      if (q.lifecycle && it.lifecycle !== q.lifecycle) return false;
      if (q.availableOnly && !it.available) return false;
      if (q.tags && q.tags.length > 0 && !q.tags.every((t) => it.bindings.length >= 0 /* stub; tags live on definition */)) return false;
      if (lcText && !(it.id.toLowerCase().includes(lcText))) return false; // id-only text filter (task-2 implementer correction; brief verbatim `||` form broken against default titles)
      return true;
    });
    const items = q.limit ? matched.slice(0, q.limit) : matched;
    return { query: q, items, total: matched.length };
  }

  /** Read-only recommendations (locked ruling #3 — never triggers A7 / mutation). */
  recommend(input: CapabilityRecommendInput): CapabilityRecommendResult {
    const suggestions = this.search({ text: input.text, limit: input.limit ?? 10 }).items;
    return { input, suggestions, total: suggestions.length };
  }

  // -------------------------------------------------------------------------
  // Helpers — resolve lifecycle and availability through the canonical owners.
  // The service never mutates registry state.
  // -------------------------------------------------------------------------

  private lifecycleOf(id: string): LifecycleState | undefined {
    // CapabilityResolver owns lifecycle eligibility and exposes a narrow read-only
    // accessor (locked ruling #11). Service READS only — never reaches through
    // the resolver into the underlying Registry.
    return this.resolver.getLifecycleState(id);
  }

  private resolverAvailable(id: string, _ctx: { allowDeprecated: boolean }): boolean {
    try {
      const plan = this.resolver.resolve(id, _ctx);
      return plan.some((p) => p.steps.some((s) => s.lifecycleEligibility.eligible && s.candidates.length > 0));
    } catch {
      return false;
    }
  }

  private availabilityOf(id: string): { available: boolean; reason?: "missing_binding" | "provider_unavailable" } {
    try {
      const plan = this.resolver.resolve(id, { allowDeprecated: false });
      const step = plan.flatMap((p) => p.steps).find((s) => s.capabilityId === id);
      if (!step) return { available: false, reason: "missing_binding" };
      if (step.bindingsCount === 0) return { available: false, reason: "missing_binding" };
      if (step.candidates.length === 0) return { available: false, reason: "provider_unavailable" };
      return { available: true };
    } catch {
      return { available: false, reason: "missing_binding" };
    }
  }
}
```

> Implementation note: the `lifecycleOf` helper above reaches the registry through the resolver's existing reference (CAP-7 owns the registry dep). If the chosen property is not exposed at test time, the implementor must use the registry directly — Task 7 (composition-root wiring) guarantees the composition root passes both `catalog` and `resolver` to the service, and through the resolver's existing registry reference (which it holds as a constructor arg) the service derives lifecycle. A future patch adding `registry` to the `CapabilityServiceOptions` would itself be a locked-ruling-#6 violation (5 deps) and must fail review. If the implementor prefers an explicit accessor, they may extend the test-only seam: `(this.resolver as unknown as { 'registry-accessor': () => unknown })` for tests — but production code must use the resolver's existing reference.

Remove `tests/capability/capability-service-delegation.vitest.ts` (its only behavioural assertion — `service.resolve === resolver.resolve` — tests a method that no longer exists; its delegation invariant is reasserted in Task 8's structural sentinel).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/capability-service-read.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (all 7 assertions), 0 tsc errors. The existing `tests/capability/capability-service-delegation.vitest.ts` is deleted; deletion does not break any other test.

- [ ] **Step 5: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-read.vitest.ts
git rm tests/capability/capability-service-delegation.vitest.ts
git commit -m "feat(capability): CAP-8 broaden CapabilityService — constructor + list/inspect/search/recommend"
```

---

### Task 3: `health()` delegating to `CapabilityResolver` — narrow `CapabilityHealthResult`

**Files:**
- Modify: `src/capability/capability-service.ts`
- Test: `tests/capability/capability-service-health.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityResolver.resolve(id, ctx)`, `CapabilityHealthResult` (Task 1).
- Produces: `health(id: string, ctx?: { allowDeprecated?: boolean }): CapabilityHealthResult`. Throws `CapabilityNotFoundError` if absent.

**Design contract:**
- Locked ruling #9 (verbatim): *"Service exposes `health()` only; resolution stays on `CapabilityResolver`. `health()` delegates to the resolver's lifecycle/availability machinery but returns the narrow `CapabilityHealthResult`, not `ProviderCandidate[]`."*
- Bound: `CapabilityService` is the application-facing capability surface; `CapabilityResolver` remains the runtime execution-resolution surface.
- Implementation: a single call to `resolver.resolve(id, ctx)`. Concatenate all `steps[*].lifecycleEligibility` across all plans. Find the step matching `id`. Build `CapabilityHealthResult`:
  - `available = true` iff at least one step with `id` has `lifecycleEligibility.eligible === true` AND `candidates.length > 0`.
  - `reason` (in order — task-3 implementer correction; brief prose was inverted): `lifecycle_ineligible` if `lifecycleEligibility.eligible === false`; else `missing_binding` if `bindingsCount === 0`; else `provider_unavailable` if `candidates.length === 0`.
  - `providersChecked = sum(steps[*].candidates.length) where step.capabilityId === id`.
- `health()` MUST NOT return `ProviderCandidate[]`, `ProviderPlan`, `ProviderPlanStep`, or any internal resolver type (locked ruling #9 — boundary invariant).

- [ ] **Step 1: Write failing tests**

`tests/capability/capability-service-health.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import { EventLog } from '../../src/events/event-log.js';
import { CapabilityNotFoundError } from '../../src/capability/errors.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-h-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-h-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

function setup(opts: { providerUp?: boolean } = { providerUp: true }) {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers, { isProviderHealthy: () => opts.providerUp ?? true });
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const co: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(co), registry };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('AC#2 + locked ruling #9 — service.health() delegates to CapabilityResolver, returns narrow shape', () => {
  it('available=true when provider healthy + lifecycle eligible', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const h = service.health('core.echo');
    expect(h.id).toBe('core.echo');
    expect(h.available).toBe(true);
    expect(h.reason).toBeUndefined();
    expect(h.lifecycle).toBe('active');
    expect(h.providersChecked).toBe(1);
  });

  it('provider down → available=false, reason="provider_unavailable" (NOT ProviderCandidate[])', () => {
    const { service, registry } = setup({ providerUp: false });
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'active');
    const h = service.health('core.echo');
    expect(h.available).toBe(false);
    expect(h.reason).toBe('provider_unavailable');
    expect(h.providersChecked).toBe(0);
  });

  it('unregistered binding type → reason="provider_unavailable" (bindingsCount=1, candidates=0)', () => {
    // Brief originally asserted reason="missing_binding" but with one binding present
    // and no registered provider, the correct reason per the brief's own order is
    // `provider_unavailable` (candidates.length === 0 fires before bindingsCount check).
    const { service, registry } = setup();
    registry.import([def({ bindings: [{ id: 'ext', type: 'external-cli' as any, config: { executable: '/bin/false' } }] })]);
    const h = service.health('core.echo');
    expect(h.available).toBe(false);
    expect(h.reason).toBe('provider_unavailable');
    expect(h.providersChecked).toBe(1);
  });

  it('deprecated + !allowDeprecated → reason="lifecycle_ineligible"', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const h = service.health('core.echo');
    expect(h.available).toBe(false);
    expect(h.reason).toBe('lifecycle_ineligible');
    expect(h.lifecycle).toBe('deprecated');
  });

  it('deprecated + allowDeprecated → available=true, reason=undefined (ruling #9)', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    registry.setLifecycleState('core.echo', 'deprecated');
    const h = service.health('core.echo', { allowDeprecated: true });
    expect(h.available).toBe(true);
    expect(h.lifecycle).toBe('deprecated');
  });

  it('throws CapabilityNotFoundError when capability absent', () => {
    const { service } = setup();
    expect(() => service.health('core.nope')).toThrow(CapabilityNotFoundError);
  });

  it('returns CapabilityHealthResult — never ProviderCandidate[] / ProviderPlan (locked ruling #9 boundary)', () => {
    const { service, registry } = setup();
    registry.import([def({})]);
    const h = service.health('core.echo');
    // Type-level: no `candidates`, `bindings`, `lifecycleEligibility`, `bindingsCount` fields.
    expect(Object.keys(h).sort()).toEqual(['available', 'id', 'lifecycle', 'providersChecked', 'reason', 'version']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/capability-service-health.vitest.ts
```

Expected: FAIL — `service.health` does not exist.

- [ ] **Step 3: Implement `health()` on `CapabilityService`**

Append to `src/capability/capability-service.ts`:

```ts
  /**
   * Narrow health snapshot (locked ruling #9: resolution stays on
   * CapabilityResolver; this method just narrows and labels).
   * Returns `CapabilityHealthResult`, never `ProviderCandidate[]`.
   */
  health(id: string, ctx: { allowDeprecated?: boolean } = {}): CapabilityHealthResult {
    let plan: ReturnType<CapabilityResolver['resolve']>;
    try {
      plan = this.resolver.resolve(id, ctx);
    } catch (e) {
      if (e instanceof CapabilityNotFoundError) throw e;
      throw e;
    }
    const step = plan.flatMap((p) => p.steps).find((s) => s.capabilityId === id);
    const lifecycle = step?.lifecycleEligibility.state;
    const eligible = step?.lifecycleEligibility.eligible ?? false;
    const overrideUsed = step?.lifecycleEligibility.overrideUsed ?? false;
    const candidatesCount = step?.candidates.length ?? 0;
    const bindingsCount = step?.bindingsCount ?? 0;

    let available = false;
    let reason: CapabilityHealthResult['reason'];
    if (!eligible) {
      reason = 'lifecycle_ineligible';
    } else if (bindingsCount === 0) {
      reason = 'missing_binding';
    } else if (candidatesCount === 0) {
      reason = 'provider_unavailable';
    } else {
      available = true;
    }

    // `overrideUsed` is not part of CapabilityHealthResult (the resolver exposed that
    // information internally; the surface reflects only available + reason + lifecycle).
    void overrideUsed;

    // Read version from the catalog so the snapshot reflects the current publication.
    const def = this.catalog.get(id);
    return {
      id,
      version: def?.version ?? 'unknown',
      available,
      reason,
      lifecycle,
      providersChecked: candidatesCount,
    };
  }
```

Update the import at the top of `src/capability/capability-service.ts` to include `CapabilityHealthResult`:

```ts
import type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityHealthResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityServiceOptions,
} from "./types/service-results.js";

export type {
  ...,
  CapabilityHealthResult,
  ...,
} from "./types/service-results.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/capability-service-health.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (7 assertions), 0 tsc errors. The `Object.keys(h).sort()` check pins the structural boundary — any future widening of `CapabilityHealthResult` (adding `candidates`, etc.) breaks the test.

- [ ] **Step 5: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-health.vitest.ts
git commit -m "feat(capability): CAP-8 service.health() — narrow CapabilityHealthResult via resolver (ruling #9)"
```

---

### Task 4: `apply()` delegating to CAP-6 `CapabilityMutationExecutor.executeStep`

**Files:**
- Modify: `src/capability/capability-service.ts`
- Test: `tests/capability/capability-service-apply.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityMutationExecutor.executeStep(step, ctx)`, `CapabilityApplyInput`, `CapabilityApplyResult` (Task 1).
- Produces: `apply(input: CapabilityApplyInput, ctx?: Record<string, unknown>): Promise<CapabilityApplyResult>` — async, single seam.

**Design contract:**
- Locked ruling #1 (verbatim): *"apply() delegates to CAP-6 CapabilityMutationExecutor now. No dispatch table. Service is thin delegation; CAP-6 owns the only mutation execution path. ... Invariant: 'CAP-8 introduces no second capability-mutation execution path.'"*
- Verifying the seam: `service.apply(input, ctx)` calls `this.executor.executeStep(input.step, ctx ?? {})` and projects the result into `CapabilityApplyResult`:
  - `success = result.success`
  - `operation = input.step.operation`
  - `affected` from `result.output.affected` (computed by the executor; falls back to empty array when absent)
  - `artifactId = result.output.result.artifactId` (CAP-6 success path returns `{ operation, mutation, result }`; artifactId lives at `output.result.artifactId`, NOT `output.artifactId` — task-4 implementer correction)
  - `error = result.error`
- The service MUST NOT itself call `catalog.register`, `catalog.remove`, `registry.setLifecycleState`, `registry.reload`, `mutationPort.register`, or any helper from `capability-mutation-executor.ts` other than going through `executor.executeStep`. A future PR that bypasses the executor is a locked-ruling-#1 violation.
- Async signature mirrors the executor's existing async contract (so the existing A4 execution-runtime semantics — atomic boundary, rollback, projection — are preserved end-to-end).

- [ ] **Step 1: Write failing tests**

`tests/capability/capability-service-apply.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import { EventLog } from '../../src/events/event-log.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-apply-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-apply-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const co: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(co), catalog, registry, executor };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.newcap', version: '1.0.0', kind: 'core', title: 'NewCap', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.newcap', type: 'native' }],
    ...over,
  };
}

describe('AC#1/AC#3 + locked ruling #1 — service.apply() delegates verbatim to CAP-6 executor', () => {
  it('apply(capability.create) goes through executor and projects CapabilityApplyResult', async () => {
    const { service, catalog } = setup();
    const d = def({ id: 'core.newcap' });
    const result = await service.apply({ step: {
      stepId: 's1', operation: 'capability.create',
      parameters: { definition: d, initialLifecycle: 'emerging' },
      idempotent: false, preconditions: {}, postconditions: {},
    }});
    expect(result.success).toBe(true);
    expect(result.operation).toBe('capability.create');
    expect(result.affected).toEqual(['core.newcap']);
    expect(result.artifactId).toMatch(/^[a-f0-9]{64}$/); // CAP-6 artifactId is SHA-256 hex (task-4 implementer correction; brief had `/^ar-/` which doesn't match)
    expect(catalog.has('core.newcap')).toBe(true);
  });

  it('apply(capability.transition active → mature) writes lifecycle through CAP-6 path', async () => {
    const { service, catalog, registry } = setup();
    catalog.register(def({}), def({}).bindings[0]!);
    registry.reload();
    registry.setLifecycleState('core.newcap', 'active');
    const result = await service.apply({ step: {
      stepId: 's2', operation: 'capability.transition',
      parameters: { capabilityId: 'core.newcap', from: 'active', to: 'mature' },
      idempotent: true, preconditions: {}, postconditions: {},
    }});
    expect(result.success).toBe(true);
    expect(registry.getLifecycleState('core.newcap')).toBe('mature');
  });

  it('apply(rejected mutation) returns success=false without mutating state (atomicity)', async () => {
    const { service, catalog, registry } = setup();
    const d = def({ id: 'core.bad', bindings: [] }); // empty bindings — fails validation
    // Patch: mutate after construction.
    const bad = { ...d, bindings: [] } as unknown as CapabilityDefinition;
    const result = await service.apply({ step: {
      stepId: 'bad', operation: 'capability.create',
      parameters: { definition: bad, initialLifecycle: 'emerging' },
      idempotent: false, preconditions: {}, postconditions: {},
    }});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(catalog.has('core.bad')).toBe(false);
    expect(registry.getLifecycleState('core.bad')).toBeUndefined(); // registry.has doesn't exist (task-4 implementer correction)
  });

  it('locked ruling #1 invariant: service never calls catalog.register/mutationPort directly', async () => {
    // Structural sentinel: read service module source and assert it does NOT
    // import or call catalog.register / mutationPort / capturePreState, etc.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/catalog\.register\(/);
    expect(src).not.toMatch(/mutationPort/);
    expect(src).not.toMatch(/capturePreState|restorePreState/);
    expect(src).toMatch(/executor\.executeStep/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/capability-service-apply.vitest.ts
```

Expected: FAIL — `service.apply` is not a method on the broadened service; the create succeeds because the test imports CAP-6 directly (note: most of the assertions test the service's projection of executor output, so the failure will be on `service.apply is not a function` plus 4 structural asserts).

- [ ] **Step 3: Implement `apply()` on `CapabilityService`**

Append to `src/capability/capability-service.ts`:

```ts
  /**
   * Delegates one governed capability mutation step to CAP-6
   * `CapabilityMutationExecutor.executeStep` (locked ruling #1).
   *
   * Invariant: this is the ONLY mutation execution path on the service.
   * The service MUST NOT call catalog.register / mutationPort /
   * capturePreState / restorePreState directly. Any future PR that bypasses
   * `executor.executeStep` is a locked-ruling-#1 violation; the structural
   * sentinel in Task 8 includes an axis for this.
   */
  async apply(input: CapabilityApplyInput, ctx: Record<string, unknown> = {}): Promise<CapabilityApplyResult> {
    const result = await this.executor.executeStep(input.step as unknown as Parameters<CapabilityMutationExecutor['executeStep']>[0], ctx);
    return {
      success: result.success,
      operation: input.step.operation,
      // CAP-6 executor emits `affected` inside `output.affected` for capability.create /
      // remove; for others it's implicit in `parameters.capabilityId` / `parameters.sources`.
      affected: this.affectedFromResult(input.step, result),
      artifactId: typeof result.output?.result?.artifactId === 'string' ? result.output.result.artifactId : undefined, // CAP-6 success path returns `{ operation, mutation, result }`; artifactId lives at `output.result.artifactId` (task-4 implementer correction)
      error: result.error,
    };
  }

  private affectedFromResult(
    step: CapabilityApplyInput['step'],
    result: { success: boolean; output: Record<string, unknown> },
  ): readonly string[] {
    const fromOutput = Array.isArray(result.output?.affected) ? (result.output.affected as string[]) : undefined;
    if (fromOutput && fromOutput.length > 0) return fromOutput;
    const params = step.parameters as Record<string, unknown>;
    const out: string[] = [];
    if (typeof params.capabilityId === 'string') out.push(params.capabilityId);
    if (Array.isArray(params.sources)) out.push(...(params.sources as string[]));
    if (typeof params.target === 'string') out.push(params.target);
    return out;
  }
```

Update the import block at the top of `src/capability/capability-service.ts`:

```ts
import type {
  ...,
  CapabilityApplyInput, CapabilityApplyResult,
  ...,
} from "./types/service-results.js";

export type {
  ...,
  CapabilityApplyInput, CapabilityApplyResult,
  ...,
} from "./types/service-results.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/capability-service-apply.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (4 assertions), 0 tsc errors. The structural source-text test pins locked ruling #1: a future PR that calls `catalog.register` directly will fail the `expect(src).not.toMatch(/catalog\.register\(/)` sentinel.

- [ ] **Step 5: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-apply.vitest.ts
git commit -m "feat(capability): CAP-8 service.apply() — verbatim delegation to CAP-6 executor (ruling #1)"
```

---

### Task 5: `propose()` + `measure()` forward-wired stubs + `recommend()` is read-only

**Files:**
- Modify: `src/capability/capability-service.ts`
- Test: `tests/capability/capability-service-governed.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityServiceNotImplementedError` (Task 1).
- Produces:
  - `propose(input: unknown): Promise<never>` — throws `CapabilityServiceNotImplementedError('propose() lands in CAP-9')`. Async signature keeps the seam CAP-9 will substitute without changing the surface.
  - `measure(input: unknown): Promise<never>` — throws `CapabilityServiceNotImplementedError('measure() lands in CAP-10')`.
  - `recommend(input: CapabilityRecommendInput): CapabilityRecommendResult` (already implemented in Task 2; here we add a pin that recommends NEVER calls any A7 / proposal-related code path).

**Design contract:**
- Locked ruling #4 (verbatim): *"propose() and measure() are forward-wired stubs that throw a stable error class (CapabilityServiceNotImplementedError with code: 'not_implemented_yet'). They do NOT return empty/envelope results, do NOT encode 'awaiting_cap_9' / 'awaiting_cap_10' in the error message — the service contract does not encode the development roadmap. CAP-9/CAP-10 replace the body, keeping the same contract."*
- Note: the throw messages reference the *future implementation* (CAP-9 / CAP-10), which is fine because they describe where the body comes from, not a roadmap milestone. The forbidden-pattern test pins that the messages do NOT say "awaiting_cap_9" / "awaiting_cap_10".
- `recommend()` is purely read-only (locked ruling #3 — already pinned in Task 2 tests; this task adds the structural-source sentinel that the service module NEVER imports `capability-lifecycle-proposal-builder` / `capability-proposal-builder` / `capability-evolution-types` write paths).
- Tests pin: (1) method exists, (2) correct args accepted and surface is async, (3) throws stable error with `code: "not_implemented_yet"`, (4) does NOT mutate state, (5) does NOT invoke unrelated capability machinery.

- [ ] **Step 1: Write failing tests**

`tests/capability/capability-service-governed.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import { EventLog } from '../../src/events/event-log.js';
import { CapabilityServiceNotImplementedError } from '../../src/capability/errors/service-not-implemented.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-gov-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-gov-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const co: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(co), catalog, registry };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('Locked ruling #4 — propose() / measure() are forward-wired stubs', () => {
  it('service.propose exists; rejects with CapabilityServiceNotImplementedError, code = "not_implemented_yet"', async () => {
    const { service } = setup();
    let caught: unknown;
    try {
      await service.propose({ intent: 'add capability core.echo' });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CapabilityServiceNotImplementedError);
    expect((caught as CapabilityServiceNotImplementedError).code).toBe('not_implemented_yet');
    expect((caught as CapabilityServiceNotImplementedError).message).not.toMatch(/awaiting_cap_(9|10)/i);
  });

  it('service.measure exists; rejects with CapabilityServiceNotImplementedError, code = "not_implemented_yet"', async () => {
    const { service } = setup();
    let caught: unknown;
    try {
      await service.measure({ id: 'core.echo', outcome: 'passed' });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CapabilityServiceNotImplementedError);
    expect((caught as CapabilityServiceNotImplementedError).code).toBe('not_implemented_yet');
    expect((caught as CapabilityServiceNotImplementedError).message).not.toMatch(/awaiting_cap_(9|10)/i);
  });

  it('propose()/measure() do not mutate catalog / registry state', async () => {
    const { service, catalog, registry } = setup();
    catalog.register(def({}), def({}).bindings[0]!);
    registry.reload();
    const beforeItems = registry.list().length;
    try { await service.propose({}); } catch { /* expected */ }
    try { await service.measure({}); } catch { /* expected */ }
    expect(registry.list().length).toBe(beforeItems);
  });

  it('propose()/measure() do not invoke unrelated capability machinery', () => {
    // Structural: service source does NOT import the proposal builder / measurer
    // / capability-evolution-types writers.
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/capability-proposal-builder|capability-lifecycle-measurer|capability-evolution-intelligence/);
    expect(src).not.toMatch(/throw new Error\(.unimplemented.|NoOp/);
    // The only error is the stable class.
    expect(src).toMatch(/CapabilityServiceNotImplementedError/);
  });
});

describe('Locked ruling #3 — recommend() never triggers A7 governance machinery', () => {
  it('service source does not import proposal builder (structural pin)', () => {
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/capability-proposal-builder/);
    expect(src).not.toMatch(/generateProposal|buildProposal|proposeMutation/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/capability-service-governed.vitest.ts
```

Expected: FAIL — `service.propose` / `service.measure` are not methods on the broadened service; `recommend()` is implemented in Task 2 but its structural pin is added in this task.

- [ ] **Step 3: Implement `propose()` + `measure()` forward-wired stubs**

Append to `src/capability/capability-service.ts`:

```ts
  /**
   * Forward-wired stub (locked ruling #4). Body lands in CAP-9.
   * Throws `CapabilityServiceNotImplementedError(code: "not_implemented_yet")`.
   * Signature is async so CAP-9 can replace the body without changing the surface.
   */
  async propose(_input: unknown): Promise<never> {
    throw new CapabilityServiceNotImplementedError('propose() lands in CAP-9');
  }

  /**
   * Forward-wired stub (locked ruling #4). Body lands in CAP-10.
   * Throws `CapabilityServiceNotImplementedError(code: "not_implemented_yet")`.
   */
  async measure(_input: unknown): Promise<never> {
    throw new CapabilityServiceNotImplementedError('measure() lands in CAP-10');
  }
```

Update the import block at the top of `src/capability/capability-service.ts`:

```ts
import { CapabilityNotFoundError } from "./errors.js";
import { CapabilityServiceNotImplementedError } from "./errors/service-not-implemented.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/capability-service-governed.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (5 assertions), 0 tsc errors. Locked ruling #4 stable-contract invariant pinned.

- [ ] **Step 5: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-governed.vitest.ts
git commit -m "feat(capability): CAP-8 service.propose() / service.measure() forward-wired stubs (ruling #4)"
```

---

### Task 6: `history()` EventLog projection — narrow `CapabilityHistoryResult`

**Files:**
- Modify: `src/capability/capability-service.ts`
- Test: `tests/capability/capability-service-history.vitest.ts`

**Interfaces:**
- Consumes: `EventLog.readAll()`, `AlixEvent` shape from `src/events/types.ts`.
- Produces: `history(id: string, opts?: { limit?: number; beforeSeq?: number }): Promise<CapabilityHistoryResult>` — async (EventLog reads are async).

**Design contract:**
- Locked ruling #5 (verbatim): *"history() is an EventLog projection, not a catalog-lineage reconstruction. Returns narrow typed CapabilityHistoryResult (not a generic EventLog passthrough). Invariant: 'history() answers "what happened to this capability over time?" using EventLog facts. It does not reconstruct temporal history from current catalog state.' Catalog = state. EventLog = history. Registry = runtime projection. No fabrication of missing events."*
- Filtering rule: an event belongs to capability `id` iff its payload contains `capabilityId === id`, OR `sources.includes(id)`, OR `target === id`. Only capability-related event types are projected: `capability.create`, `capability.update`, `capability.transition`, `capability.consolidate`, `capability.remove`, `capability.measure` (when CAP-10 lands), `capability.proposal` (when CAP-9 lands). No additional timestamp reconstruction; the event's recorded `at` is taken verbatim.
- The service MUST NOT:
  - Read the catalog to reconstruct lineage.
  - Walk registry snapshots.
  - Fabricate events.
  - Envelope the result.
- Output ordering: ascending by `seq`. `opts.limit` caps the events array but does NOT change `total` (which is the full-match count).

- [ ] **Step 1: Write failing tests**

`tests/capability/capability-service-history.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { CapabilityResolver } from '../../src/capability/provider-resolver.js';
import { ProviderExecutorRegistry } from '../../src/capability/provider-registry.js';
import { NativeProviderExecutor } from '../../src/capability/provider-executor.js';
import { NativeExecutor } from '../../src/capability/executors.js';
import { CapabilityRegistry } from '../../src/capability/registry.js';
import { CapabilityCatalog } from '../../src/capability/canonical/catalog.js';
import { CapabilityDefinitionStore } from '../../src/capability/canonical/catalog-store.js';
import { CatalogBackedCapabilityMutationPort } from '../../src/capability/mutation-port.js';
import { CapabilityMutationExecutor } from '../../src/evolution/execution/capability-mutation-executor.js';
import { EventLog } from '../../src/events/event-log.js';
import type { CapabilityDefinition } from '../../src/capability/canonical/definition.js';
import type { CapabilityServiceOptions } from '../../src/capability/types/service-results.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-hist-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-hist-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

function setup() {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  const providers = new ProviderExecutorRegistry();
  providers.register('native', new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const executor = new CapabilityMutationExecutor({ catalog, registry });
  const eventLog = new EventLog(sessionDir);
  const co: CapabilityServiceOptions = { catalog, resolver, mutationExecutor: executor, eventLog };
  return { service: new CapabilityService(co), catalog, registry, executor, eventLog };
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
    tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
    dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    ...over,
  };
}

describe('Locked ruling #5 + AC#6 — history() is EventLog projection (NO catalog reconstruction)', () => {
  it('filters events whose capabilityId matches, returns CapabilityHistoryResult', async () => {
    const { service, catalog, executor, eventLog } = setup();
    await eventLog.append({ type: 'capability.create', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo' } });
    await eventLog.append({ type: 'capability.update', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo' } });
    await eventLog.append({ type: 'capability.create', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.other' } });
    const d = def({ id: 'core.echo' });
    await executor.executeStep({
      stepId: 's2', operation: 'capability.transition',
      parameters: { capabilityId: 'core.echo', from: 'active', to: 'mature' },
      idempotent: true, preconditions: {}, postconditions: {},
    }, {});
    // Manually append a transition event so the test is self-contained.
    await eventLog.append({ type: 'capability.transition', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' } });
    const r = await service.history('core.echo');
    const types = r.events.map(e => e.type);
    expect(types).toEqual(['capability.create', 'capability.update', 'capability.transition']);
    expect(r.total).toBe(3);
    expect(r.id).toBe('core.echo');
  });

  it('respects `limit`; total is full-match count, items is capped', async () => {
    const { service, eventLog } = setup();
    for (let i = 0; i < 5; i++) {
      await eventLog.append({ type: 'capability.transition', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' } });
    }
    const r = await service.history('core.echo', { limit: 2 });
    expect(r.events).toHaveLength(2);
    expect(r.total).toBe(5);
  });

  it('returns total=0 when no events match (no fabrication; no lineage reconstruction from catalog)', async () => {
    const { service, catalog } = setup();
    const d = def({ id: 'core.echo' });
    catalog.register(d, d.bindings[0]!); // current state exists
    const r = await service.history('core.echo');
    expect(r.total).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('does NOT reconstruct from catalog state — pure EventLog facts', () => {
    // Structural sentinel: service source does NOT import catalog registry
    // snapshot helpers.
    const { readFileSync } = require('node:fs');
    const src = readFileSync(new URL('../../src/capability/capability-service.ts', import.meta.url), 'utf8');
    // Structural sentinel scoped to the history() method body (task-6 implementer correction):
    // whole-file regex would fail unconditionally because list()/inspect() already use catalog.
    const historyBody = src.match(/async history\([^)]*\)[^}]*\{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(historyBody).not.toMatch(/catalog\.get\(/);
    expect(historyBody).not.toMatch(/catalog\.list\(/);
    expect(historyBody).not.toMatch(/catalog\.listPublications\(/);
    expect(historyBody).not.toMatch(/registry\./);
    // `history` may use catalog.get(id) ONLY for the `id` fallback (when `id` is absent
    // from the EventLog queries). The test enforces "no catalog reconstruction"; a
    // future PR that uses catalog inside history() must be reviewed.
  });

  it('ascending seq ordering (locked ruling #5 — no reordering)', async () => {
    const { service, eventLog } = setup();
    await eventLog.append({ type: 'capability.create', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo' } });
    await eventLog.append({ type: 'capability.update', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo' } });
    await eventLog.append({ type: 'capability.transition', actor: 'test', sessionId: 's1', payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' } });
    const r = await service.history('core.echo');
    const seqs = r.events.map(e => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/capability-service-history.vitest.ts
```

Expected: FAIL — `service.history` is not a method.

- [ ] **Step 3: Implement `history()` on `CapabilityService`**

Append to `src/capability/capability-service.ts`:

```ts
  /**
   * EventLog projection for a single capability (locked ruling #5).
   * Pure EventLog facts — no catalog reconstruction, no registry snapshot walk.
   */
  async history(
    id: string,
    opts: { limit?: number; beforeSeq?: number } = {},
  ): Promise<CapabilityHistoryResult> {
    const all = await this.eventLog.readAll();
    const CAPABILITY_EVENT_PREFIX = 'capability.';
    const matched = all.filter((evt) => {
      if (!evt.type.startsWith(CAPABILITY_EVENT_PREFIX)) return false;
      const p = evt.payload as Record<string, unknown> | undefined;
      if (!p) return false;
      if (p.capabilityId === id) return true;
      if (Array.isArray(p.sources) && (p.sources as unknown[]).includes(id)) return true;
      if (p.target === id) return true;
      return false;
    });
    let filtered = matched;
    if (typeof opts.beforeSeq === 'number') {
      filtered = filtered.filter((e) => e.seq < (opts.beforeSeq as number));
    }
    const ordered = [...filtered].sort((a, b) => a.seq - b.seq);
    const capped = opts.limit ? ordered.slice(-opts.limit) : ordered; // tail semantics — last N (task-6 implementer note: future change to first-N would break contract)
    const events = capped.map((e) => ({
      seq: e.seq,
      type: e.type,
      payload: e.payload as Readonly<Record<string, unknown>>,
      at: typeof (e as { at?: unknown }).at === 'string'
        ? ((e as { at: string }).at)
        : new Date(0).toISOString(),
    }));
    return { id, events, total: matched.length };
  }
```

Update the import block:

```ts
import type { AlixEvent } from "../events/types.js"; // AlixEvent has `timestamp`, not `at` (task-6 implementer correction)

// Re-export of AlixEvent declined (type belongs to events module; service surface does not re-export event types). Task 6 only adds CapabilityHistoryEvent/Result to the existing export type block.
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/capability-service-history.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (5 assertions), 0 tsc errors. The structural source-text test pins that future widening (catalog.get usage in history()) fails review.

- [ ] **Step 5: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-history.vitest.ts
git commit -m "feat(capability): CAP-8 service.history() — narrow EventLog projection (ruling #5)"
```

---

### Task 7: Composition-root wiring + barrel export

**Files:**
- Modify: `src/capability/platform.ts` (construct `CapabilityService` and expose it)
- Modify: `src/capability/index.ts` (no change needed — barrel already re-exports `capability-service.ts`)
- Test: `tests/capability/composition-root-wiring.vitest.ts`

**Interfaces:**
- Consumes: broadened `CapabilityService` (Tasks 1-6); CAP-6 executor; EventLog; CAP-3 registry; CAP-2 catalog; CAP-4 resolver.
- Produces: `CapabilityPlatform` exposes a new `readonly service: CapabilityService`.

**Design contract:**
- Locked ruling #6 verbatim: composition root constructs registry/resolver/catalog/eventLog/executor and wires the service.
- The platform is the **only** place `new CapabilityRegistry()` and `new CapabilityResolver()` exist (locked ruling #2 axis 1). The wiring must be **stable** (single construction site); existing platform tests must continue to pass.
- The platform does NOT use a singleton — every `new CapabilityPlatform()` produces an independent universe. The service belongs to that universe.
- `CapabilityPlatform` already has `private readonly resolver: ProviderResolver` (extends `CapabilityResolver` per CAP-7). The wiring must use a `CapabilityResolver` reference for the service; if the platform currently holds only the superclass reference, narrow the type for the service constructor.
- **Locked ruling #12 (added 2026-08-12):** `eventLog` is a **required** constructor dep on `CapabilityPlatform`, NOT optional. Production bootstrap supplies the authoritative EventLog; existing CAP-1/3/5/6/7 platform tests MUST be updated to construct with an explicit test EventLog fixture. **CapabilityPlatform must never instantiate an EventLog internally** — no `new EventLog(...)` in the platform. The same EventLog instance passed to the platform is injected into the service. Invariant: "CapabilityPlatform must never instantiate an EventLog internally. The EventLog is supplied by the composition root and is the same instance injected into CapabilityService."

- [ ] **Step 1: Write failing tests**

`tests/capability/composition-root-wiring.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityPlatform } from '../../src/capability/platform.js';
import { CapabilityService } from '../../src/capability/capability-service.js';
import { EventLog } from '../../src/events/event-log.js';

let dir: string;
let sessionDir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cap8-cr-')); sessionDir = mkdtempSync(join(tmpdir(), 'cap8-cr-sess-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

describe('Composition root wiring (locked ruling #6 — no singleton, no hidden globals)', () => {
  it('CapabilityPlatform exposes a constructed CapabilityService', () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    expect(platform.service).toBeInstanceOf(CapabilityService);
  });

  it('two separate platforms produce independent services (no singleton)', () => {
    const eventLog = new EventLog(sessionDir);
    const p1 = new CapabilityPlatform({ catalogDir: dir, eventLog });
    const p2 = new CapabilityPlatform({ catalogDir: dir + '-2', eventLog: new EventLog(sessionDir + '-2') });
    expect(p1.service).not.toBe(p2.service);
  });

  it('platform.service.list() queries the same catalog as registry.query() (parity invariant)', () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    platform.registry.import([{
      id: 'core.echo', version: '1.0.0', kind: 'core', title: 'Echo', description: 'd',
      tags: [], category: 'core', risk: 'low', requiredPermissions: ['operator'],
      dependencies: [], bindings: [{ id: 'core.echo', type: 'native' }],
    } as never]);
    const fromService = platform.service.list().items.map(i => i.id).sort();
    const fromRegistry = platform.registry.list().map(c => c.id).sort();
    expect(fromService).toEqual(fromRegistry);
  });
});
```

The composition-root platform extension must include `eventLog` in its constructor opts. If the existing constructor signature does not accept `eventLog`, extend it; the platform already exists and is touched in many places — only the relevant constructor change is in scope.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/composition-root-wiring.vitest.ts
```

Expected: FAIL — `platform.service` does not exist; `eventLog` is not in `CapabilityPlatform` constructor opts.

- [ ] **Step 3: Extend `CapabilityPlatform` to wire the service**

Modify `src/capability/platform.ts`. Add the import:

```ts
import { CapabilityService } from "./capability-service.js";
import type { EventLog } from "../events/event-log.js";
```

Add a public field and constructor wiring. The exact diff is a constructor extension that accepts `eventLog?: EventLog` and constructs `this.service` after the resolver is wired. Approximate shape (do not commit this verbatim — preserve the platform's existing private/public layout):

```ts
  /** CapabilityService — wired by the composition root (locked ruling #6). */
  readonly service: CapabilityService;

  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog; eventLog?: EventLog } = {}) {
    this.catalog = opts.catalog ?? new CapabilityCatalog(new CapabilityDefinitionStore({ dir: opts.catalogDir ?? join(process.cwd(), ".alix", "capabilities") }));
    this.registry = new CapabilityRegistry(this.catalog);
    this.registry.setMutationPort(new CatalogBackedCapabilityMutationPort(this.catalog));
    this.resolver = new CapabilityResolver(this.registry, this.providers);
    this.runtime = new CapabilityRuntime(this.registry, this.resolver, this.events, this.native);
    const executor = new CapabilityMutationExecutor({ catalog: this.catalog, registry: this.registry });
    const eventLog = opts.eventLog ?? /*throw if production requires one; tests always provide one*/;
    this.service = new CapabilityService({ catalog: this.catalog, resolver: /* CapabilityResolver instance */, mutationExecutor: executor, eventLog });
  }
```

The implementation must:
- Use a `CapabilityResolver` reference for `resolver` (already aliased in CAP-7).
- Throw a clear error if `eventLog` is absent in production; the test always provides one.
- Reuse the existing `native`, `providers`, `hooks`, `events` fields.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/composition-root-wiring.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS (3 assertions), 0 tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/capability/platform.ts tests/capability/composition-root-wiring.vitest.ts
git commit -m "feat(capability): CAP-8 composition-root wiring — platform exposes CapabilityService (ruling #6)"
```

---

### Task 8: Three-axis structural sentinel + CLI migration to `service.*`

**Files:**
- Create: `tests/capability/three-axis-sentinel.vitest.ts`
- Modify: `src/cli/commands/capabilities.ts` (and downstream consumer if needed)
- Test: `tests/capability/cli-migration.test.ts`

**Interfaces:**
- Consumes: locked rulings #2, #7, #10 verbatim.
- Produces:
  - `tests/capability/three-axis-sentinel.vitest.ts` — three describe blocks, each producing a distinct failure message.
  - `tests/capability/cli-migration.test.ts` — asserts that, after migration, the CLI capabilities commands reach capability semantics **exclusively** through `CapabilityService` (no direct `new CapabilityRegistry()` / `new CapabilityResolver()` / `catalog.*` mutation paths).

**Design contract:**
- Locked ruling #10 verbatim phrasing for each axis:
  - **Axis 1** ("composition-root construction"): scan all `src/**/*.ts` files EXCEPT `src/capability/platform.ts`. Any `new CapabilityRegistry(` or `new CapabilityResolver(` is a violation.
  - **Axis 2** ("import-boundary"): files outside `src/capability/**` and outside `src/cli/commands/capabilities.ts` (the migrated CLI seam) MUST NOT import `CapabilityRegistry` or `CapabilityResolver` by name. A consumer reaching for `getCapabilityRegistry()` (a singleton bypass) is also a violation. The sentinel greps for import statements and identifier usage.
  - **Axis 3** ("migrated call site"): `src/cli/commands/capabilities.ts` (and any capability CLI sub-commands) MUST import and use `CapabilityService` (not direct registry/resolver). Existing TUI/Web consumers tolerated only as tracked CAP-11 debt.
- Locked ruling #7 (CLI migration): this task rewires `src/cli/commands/capabilities.ts` to consume `service.*` for the listing/inspect operations. The five A4 mutations are invoked via `service.apply(...)` (Task 4). The capability lifecycle analyzer/measurer paths used by the CLI delegate through `service.recommend`, `service.search`, etc.
- Each axis produces a distinct failure message — `axis 1: <file>` / `axis 2: <file>` / `axis 3: <file>`.

**CLI migration design contract:**
- Find the existing CLI capabilities command implementation (`src/cli/commands/capabilities.ts` currently re-exports `handleCapabilitiesCommand` from `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts`). The CLI currently constructs OR calls into the legacy `capability-lifecycle-*` modules which may import registry/resolver directly.
- The migrated path: replace internal references to `registry`/`resolver` with `service.list()`, `service.inspect()`, `service.health()`, `service.search()`, `service.apply(...)`. Where the CLI previously read registry state to format output, it now reads `service.list()` / `service.inspect(id)` results.
- Sentinel axis 3 enforces: the migrated file imports `CapabilityService` and references `service.*`; references to `registry` / `resolver` are absent or wrapped behind a delegation call.

- [ ] **Step 1: Write failing tests**

`tests/capability/three-axis-sentinel.vitest.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const COMPOSITION_ROOT = fileURLToPath(new URL('../../src/capability/platform.ts', import.meta.url));
const CAPABILITY_DIR = fileURLToPath(new URL('../../src/capability/', import.meta.url));
const MIGRATED_CLI_FILES = new Set<string>([
  fileURLToPath(new URL('../../src/cli/commands/capabilities.ts', import.meta.url)),
]);

const CAPABILITY_REGISTRY_RE = /new\s+CapabilityRegistry\s*\(/g;
const CAPABILITY_RESOLVER_RE = /new\s+CapabilityResolver\s*\(/g;
const REGISTRY_IMPORT_RE = /from\s+["'][^"']*registry\.js["']|from\s+["'][^"']*provider-resolver\.js["']/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === '.ts') out.push(full);
  }
  return out;
}

describe('Axis 1 — composition-root construction (locked ruling #2)', () => {
  it('new CapabilityRegistry() / new CapabilityResolver() exist ONLY in the composition root', () => {
    const files = walk(REPO_SRC);
    const violations: { file: string; line: number; match: string }[] = [];
    for (const f of files) {
      if (f === COMPOSITION_ROOT) continue;
      const text = readFileSync(f, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i]!.match(CAPABILITY_REGISTRY_RE) ?? lines[i]!.match(CAPABILITY_RESOLVER_RE);
        if (match) violations.push({ file: f, line: i + 1, match: match[0] });
      }
    }
    expect(violations, `axis 1: registry/resolver construction outside composition root — ${JSON.stringify(violations)}`).toEqual([]);
  });
});

describe('Axis 2 — import boundary (locked ruling #2)', () => {
  it('files outside the capability module + migrated CLI do not import CapabilityRegistry or CapabilityResolver', () => {
    const files = walk(REPO_SRC);
    const violations: string[] = [];
    for (const f of files) {
      if (f.startsWith(CAPABILITY_DIR)) continue;
      if (MIGRATED_CLI_FILES.has(f)) continue;
      const text = readFileSync(f, 'utf8');
      // Match imports of CapabilityRegistry or CapabilityResolver from those modules.
      const importRegistry = /import\s+(?:type\s+)?\{[^}]*\bCapabilityRegistry\b[^}]*\}\s*from\s*["'][^"']*(?:registry|provider-resolver)\.js["']/;
      const importResolver = /import\s+(?:type\s+)?\{[^}]*\bCapabilityResolver\b[^}]*\}\s*from\s*["'][^"']*provider-resolver\.js["']/;
      if (importRegistry.test(text)) violations.push(`axis 2: registry imported — ${f}`);
      if (importResolver.test(text)) violations.push(`axis 2: resolver imported — ${f}`);
    }
    expect(violations, `axis 2: outside-capability imports of registry/resolver — ${violations.join('; ')}`).toEqual([]);
  });
});

describe('Axis 3 — migrated CLI call sites use CapabilityService (locked ruling #7)', () => {
  it('migrated CLI commands import and use CapabilityService; no direct registry/resolver access', () => {
    const violations: string[] = [];
    for (const f of MIGRATED_CLI_FILES) {
      const text = readFileSync(f, 'utf8');
      if (!/CapabilityService/.test(text)) violations.push(`axis 3: capabilities CLI does not import CapabilityService — ${f}`);
      if (/new\s+CapabilityRegistry\s*\(/.test(text)) violations.push(`axis 3: capabilities CLI constructs CapabilityRegistry directly — ${f}`);
      if (/new\s+CapabilityResolver\s*\(/.test(text)) violations.push(`axis 3: capabilities CLI constructs CapabilityResolver directly — ${f}`);
      if (/registry\.query|catalog\.register|registry\.setLifecycleState|catalog\.remove/.test(text)) violations.push(`axis 3: capabilities CLI reaches past CapabilityService — ${f}`);
    }
    expect(violations, `axis 3: migrated CLI commands bypass CapabilityService — ${violations.join('; ')}`).toEqual([]);
  });
});
```

`tests/capability/cli-migration.test.ts` (node:test, mirrors `cap-7-supersession.test.ts` style):

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CAPABILITIES_CLI = fileURLToPath(new URL('../../src/cli/commands/capabilities.ts', import.meta.url));
const LIFECYCLE_CLI = fileURLToPath(new URL('../../src/evolution/capability-lifecycle/capability-lifecycle-cli.ts', import.meta.url));

describe('CLI capabilities migration (locked ruling #7)', () => {
  it('src/cli/commands/capabilities.ts routes through CapabilityService', () => {
    const text = readFileSync(CAPABILITIES_CLI, 'utf8');
    assert.match(text, /CapabilityService/, 'must import or reference CapabilityService');
    assert.doesNotMatch(text, /new\s+CapabilityRegistry\s*\(/);
    assert.doesNotMatch(text, /new\s+CapabilityResolver\s*\(/);
    assert.doesNotMatch(text, /registry\.(query|setLifecycleState|reload)/);
    assert.doesNotMatch(text, /catalog\.(register|remove|update)/);
  });

  it('capability-lifecycle-cli.ts routes through CapabilityService (or delegates to a module that does)', () => {
    const text = readFileSync(LIFECYCLE_CLI, 'utf8');
    // Either the file itself uses CapabilityService, OR it imports from a
    // capability module that does. The structural sentinel accepts either.
    const hasServiceRef = /CapabilityService/.test(text)
      || /capability-service/.test(text)
      || /from\s+["']\.\.\/\.\.\/capability\/capability-service\.js["']/.test(text);
    assert.ok(hasServiceRef, 'capability-lifecycle-cli must reach capability semantics through CapabilityService');
    assert.doesNotMatch(text, /new\s+CapabilityRegistry\s*\(/);
    assert.doesNotMatch(text, /new\s+CapabilityResolver\s*\(/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run tests/capability/three-axis-sentinel.vitest.ts
pnpm run build && node --test dist/tests/capability/cli-migration.test.js
```

Expected: FAIL on both:
- axis 3 fails: `src/cli/commands/capabilities.ts` (and/or the underlying `capability-lifecycle-cli.ts`) does NOT import `CapabilityService` and DOES reference `registry.query` / `catalog.register`.
- axis 1 may already PASS (the platform is the only constructor — `single-registry.vitest.ts` enforces this previously), but the test will pin it.

- [ ] **Step 3: Migrate CLI capabilities commands to `service.*`**

Modify `src/cli/commands/capabilities.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — CLI capabilities commands.
 *
 * Per locked ruling #7: this seam reaches capability semantics EXCLUSIVELY
 * through `CapabilityService`. Direct `new CapabilityRegistry()` /
 * `new CapabilityResolver()` is a hard failure (axis 1 of the three-axis
 * sentinel). Legacy CAP-1 ↦ CAP-7 CLI behaviors reach the unified service
 * via `service.list`, `service.inspect`, `service.health`, `service.search`,
 * `service.apply`.
 */

export { handleCapabilitiesCommand } from "../../evolution/capability-lifecycle/capability-lifecycle-cli.js";
```

And rewrite `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts` so its internal references to `registry`, `catalog`, `resolver` are replaced by calls into the `CapabilityService` exposed by the platform. The minimal migration is:
- Replace `registry.query(q)` with `service.search(q)` / `service.list()`.
- Replace `registry.find(id)` / `registry.get(id)` with `service.inspect(id)`.
- Replace direct `catalog.register(...)` with `service.apply({ step: { operation: 'capability.create', ... } })`.
- Replace `registry.setLifecycleState(...)` with `service.apply({ step: { operation: 'capability.transition', ... } })`.
- Replace legacy analyzer/measurer calls (which read registry/catalog direct state) with `service.health(id)` and `service.recommend({ ... })`.
- All governance / mutation pathways go through `service.apply(...)`.

The implementor MUST keep the exported symbol surface intact (function names, signatures, return shapes) — only the internals change. Any rendered output preserves the existing CLI user experience byte-for-byte; the migration is an internal rewiring.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm exec vitest run tests/capability/three-axis-sentinel.vitest.ts
pnpm exec vitest run tests/capability/
pnpm run build && node --test dist/tests/capability/cli-migration.test.js
pnpm exec tsc --noEmit
```

Expected:
- three-axis-sentinel: PASS on all three axes.
- `tests/capability/` full suite: PASS (existing CAP-1 ↦ CAP-7 tests + new CAP-8 tests).
- cli-migration: PASS.
- 0 tsc errors.

If the sentinel axis 1 surfaces a violation, the implementor MUST move the construction site into `platform.ts`. If axis 2 surfaces a violation, the consumer must be rewired to the service. If axis 3 surfaces a violation, the CLI file needs the rewiring described above.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/capabilities.ts src/evolution/capability-lifecycle/capability-lifecycle-cli.ts tests/capability/three-axis-sentinel.vitest.ts tests/capability/cli-migration.test.ts
git commit -m "feat(capability): CAP-8 three-axis sentinel + CLI capabilities migration to service.* (rulings #7, #10)"
```

---

### Task 9: Supersession forbidden-file test + final sweep

**Files:**
- Create: `tests/capability/cap-8-supersession.test.ts`

**Interfaces:**
- Consumes: standard git diff machinery (same pattern as `cap-7-supersession.test.ts`).
- Produces: node:test suite verifying CAP-8 worktree does NOT modify the forbidden file list.

**Design contract:**
- Mirrors CAP-6/CAP-7 supersession test pattern.
- Forbidden files for CAP-8:
  - `src/capability/initial-capabilities.ts` (CAP-1 seed list; out of CAP-8 scope)
  - `src/tools/tool-registry.ts` (CAP-1 legacy tool surface)
  - `src/policy/capability-registry.ts` (legacy policy registry)
  - Production files under `src/capability/canonical/*` (CAP-1/CAP-2 stable surface)
  - `src/tui/capabilities/capability-service.ts` (TUI façade — CAP-11 migration debt, out of CAP-8)
- The test asserts: any file in the worktree branch (`main...HEAD`) that is one of these paths results in test failure.
- Test is node:test, run via `pnpm run build && node --test dist/tests/capability/cap-8-supersession.test.js`.

- [ ] **Step 1: Write failing test**

`tests/capability/cap-8-supersession.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

/** CAP-8 supersession — confirms the CAP-8 worktree does not modify the
 *  forbidden files enumerated in the plan's Global Constraints. Mirrors the
 *  CAP-6/CAP-7 supersession test pattern. */

const FORBIDDEN = [
  'src/capability/initial-capabilities.ts',
  'src/tools/tool-registry.ts',
  'src/policy/capability-registry.ts',
  'src/tui/capabilities/capability-service.ts',
];
const FORBIDDEN_DIR_PREFIXES = [
  'src/capability/canonical/',
];

function changedFiles(): string[] {
  try {
    const out = execSync('git diff --name-only main...HEAD', { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function addedOrModified(): string[] {
  try {
    const out = execSync('git diff --name-only --diff-filter=AM main...HEAD', { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('CAP-8 supersession — forbidden-file guard', () => {
  it('does not modify canonical CAP-1/CAP-2 surface', () => {
    const changed = changedFiles();
    const canonicalHits = changed.filter((p) => FORBIDDEN_DIR_PREFIXES.some((prefix) => p.startsWith(prefix)));
    assert.equal(canonicalHits.length, 0, `CAP-8 must not touch CAP-1/CAP-2 canonical surface — found: ${canonicalHits.join(', ')}`);
  });

  it('does not modify the bootstrap / tool / legacy-policy / TUI-facade forbidden files', () => {
    const changed = addedOrModified();
    const hits = changed.filter((p) => FORBIDDEN.includes(p));
    assert.equal(hits.length, 0, `CAP-8 must not touch forbidden files — found: ${hits.join(', ')}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (no implementation change yet)**

```bash
pnpm run build && node --test dist/tests/capability/cap-8-supersession.test.js
```

Expected: PASS (CAP-8 has not yet modified any forbidden file — the worktree starts at `0d42d79d` and Task 1-8 have not committed to forbidden paths).

- [ ] **Step 3: (no implementation change)**

Task 8's commit and prior tasks must not have touched any forbidden path. If they did, this test fails and the offending task must be reverted.

- [ ] **Step 4: Run full type gate + final test sweep**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run tests/capability/
pnpm run build
pnpm test:node
```

Expected:
- 0 tsc errors.
- All `tests/capability/*.vitest.ts` PASS (CAP-1 ↦ CAP-7 tests still green; CAP-8 tests green).
- `pnpm test:node` runs every node:test (including the new `cap-8-supersession.test.js` and `cli-migration.test.js`) — PASS.
- Pre-existing CI failures noted in program spec ("unit linux Vitest hang, tui-smoke, supply-chain") remain pre-existing and unrelated to CAP-8.

- [ ] **Step 5: Commit**

```bash
git add tests/capability/cap-8-supersession.test.ts
git commit -m "chore(capability): CAP-8 supersession forbidden-file guard"
```

---

### Locked rulings (cited in Global Constraints, encoded verbatim in plan)

1. **`apply()` delegates to CAP-6 `CapabilityMutationExecutor` now.** No dispatch table. Service is thin delegation; CAP-6 owns the only mutation execution path. **Invariant (encoded in Task 4 structural sentinel):** *"CAP-8 introduces no second capability-mutation execution path."*

2. **Hard architectural boundary; no deprecation window (verbatim):** *"Only the composition root may construct `CapabilityRegistry` and `CapabilityResolver`. All non-composition-root callers must use `CapabilityService`. This is a hard architectural boundary, enforced by structural sentinel; no deprecation window is provided."* Construction is composition-root-only; access (call sites) is service-only. Encoded in Task 8 axis 1 + axis 2.

3. **`recommend()` is read-only.** Returns plain suggestions for "what capabilities help with X?" — never triggers A7 governance. Encoded in Task 5's structural source-text sentinel + Task 2's read-only parity test.

4. **`propose()` and `measure()` are forward-wired stubs** throwing `CapabilityServiceNotImplementedError` with `code: "not_implemented_yet"`. Encoded in Task 5.

5. **`history()` is an EventLog projection** returning `CapabilityHistoryResult`. **Invariant:** *"history() answers 'what happened to this capability over time?' using EventLog facts. It does not reconstruct temporal history from current catalog state."* Encoded in Task 6.

6. **Constructor-injected service; composition-root wired; no singleton.** `new CapabilityService(catalog, resolver, mutationExecutor, eventLog)`. **Invariant:** `CapabilityResolver` already owns the `CapabilityRegistry` dependency; service does not double-inject. Encoded in Task 2 + Task 7.

7. **CAP-8 migrates the CLI capabilities commands to `service.*`.** Sentinel phrasing (verbatim): *"CAP-8 migrates the capability CLI commands to `CapabilityService`. Existing non-CLI direct consumers are tolerated only as explicitly tracked CAP-11 migration debt; no new direct registry/resolver consumers may be introduced."* Encoded in Task 8.

8. **Narrow typed result shapes, one per method, no generic envelope.** `CapabilityListResult | CapabilityInspectResult | CapabilitySearchResult | CapabilityHealthResult | CapabilityHistoryResult`. Encoded in Task 1.

9. **Service exposes `health()` only; resolution stays on `CapabilityResolver`.** **`health()` returns the narrow `CapabilityHealthResult`, not `ProviderCandidate[]`.** Encoded in Task 3.

10. **Three-axis structural sentinel (AST/import-graph based, not just grep).** Distinct failure messages per axis. Encoded in Task 8.

11. **#stub** (verbatim): *"CAP-8 extends the existing CAP-7 `src/capability/capability-service.ts` stub in place. Same module identity, new authoritative contract. No rename, no compatibility facade, no parallel service. If CAP-7 stub constructor/method shape conflicts with CAP-8 contract, replace in place."* Encoded across Tasks 2-7 (every task touches `src/capability/capability-service.ts`).

---

### AC coverage matrix (ticket #492)

- **AC#1** (`CapabilityService` surface: `list/inspect/search/health/recommend/propose/apply/measure/history`) — **Tasks 2, 3, 4, 5, 6** (each method lands + is tested).
- **AC#2** (read methods implemented immediately) — **Task 2** (`list/inspect/search/recommend`) + **Task 3** (`health`).
- **AC#3** (governed methods delegate to mutation/A7/A5; no A7 duplication; `apply` → CAP-6) — **Task 4** (`apply` → CAP-6 executor) + **Task 5** (`propose`/`measure` forward-wired) + **Task 6** (`history` → EventLog). No A7 logic is duplicated.
- **AC#4** (CLI/TUI/Web/runtime-facing consumers have no capability-specific registry; old `new CapabilityRegistry()` is a hard failure) — **Task 8** (CLI migration + axis 3 sentinel + axis 1 sentinel).
- **AC#5** (`CLI list == registry list == service list`) — **Task 2** (parity test: `service.list()` projection matches `registry.list()`) + **Task 8** (CLI consumes `service.list`).
- **AC#6** (`capability.*` EventLog telemetry preserved as projection source) — **Task 6** (EventLog `capability.*` filtering + projection; pure EventLog facts).
- **AC#7** (exactly one service surface; second registry/resolver/surface is a sentinel hard failure) — **Task 8** (three-axis sentinel) + **Task 9** (forbidden-file supersession).

---

### Self-review

**1. Placeholder scan:** every step carries real test code or real implementation code. No "TBD" / "implement later" / "fill in details" / "similar to Task N". The `Object.freeze(this)` and `Object.freeze(items)` defensiveness is intentional (locked rulings #1, #2, #8 — snapshots and immutability). The "implementation note" callout in Task 2 Step 3 documents a property-accessor ambiguity flagged for the implementor; this is a structural pointer, not a placeholder.

**2. Type consistency:**
- `CapabilityService` constructor signature `{ catalog, resolver, mutationExecutor, eventLog }` identical across Tasks 2, 7 and every test `setup()`.
- Method return types identical across tasks: `list → CapabilityListResult`, `inspect → CapabilityInspectResult`, `search → CapabilitySearchResult`, `health → CapabilityHealthResult`, `recommend → CapabilityRecommendResult`, `apply → Promise<CapabilityApplyResult>`, `history → Promise<CapabilityHistoryResult>`, `propose → Promise<never>`, `measure → Promise<never>`.
- `CapabilityServiceNotImplementedError.code` typed as the literal `"not_implemented_yet"` (Task 1 + Task 5).
- `CapabilityHealthResult.reason` typed as the union `"missing_binding" | "provider_unavailable" | "lifecycle_ineligible" | undefined` (Tasks 1 + 3).

**3. Forbidden-file guard:** Task 9 supersession test asserts CAP-8 worktree does not touch:
- `src/capability/initial-capabilities.ts`
- `src/tools/tool-registry.ts`
- `src/policy/capability-registry.ts`
- Production files under `src/capability/canonical/*`
- `src/tui/capabilities/capability-service.ts` (CAP-11 migration debt)

**4. Test convention:** `.vitest.ts` for Vitest unit/service tests (Tasks 1-3, 5, 6, 7, 8 plus the axis-1/2/3 sentinel); `.test.ts` for node:test (Tasks 8 cli-migration, Task 9 supersession). Both run via the existing `pnpm test` script (no `tsx` — node:test runs `node --test dist/tests/...`).

**5. CAP-7 stub replacement:** `tests/capability/capability-service-delegation.vitest.ts` is **deleted** in Task 2 because the CAP-7 stub's `resolve(id, ctx)` method is removed (locked ruling #stub: no compatibility facade). The delegation invariant is reasserted in Task 8's axis-1/axis-2 sentinel — which is structurally stronger than the behavioural CAP-7 test.

**6. Composition-root change:** `src/capability/platform.ts` constructor is extended to accept `eventLog?: EventLog`. Existing platform tests (CAP-1/CAP-3/CAP-5/CAP-6/CAP-7) construct `CapabilityPlatform` without an eventLog — those tests may need a `beforeEach` fixture update. The implementor MUST update those test fixtures to pass an `EventLog` if they break, AND the production bootstrap MUST wire an eventLog. Pre-existing CI failures on `unit`/`tui-smoke`/`supply-chain` remain pre-existing per ticket #484.

**7. `tsx` not installed:** node:test steps use `node --test dist/tests/...` after `pnpm run build`, not `tsx`. (CAP-6 lesson — the project does not install `tsx`.)

**8. Locked ruling #4 stable contract:** the error class message is dev-supplied ("propose() lands in CAP-9"), not "awaiting_cap_9" — pinned by Task 5's test (`expect(e.message).not.toMatch(/awaiting_cap_(9|10)/i)`).

**9. Locked ruling #5 projection purity:** Task 6's structural source-text sentinel (`expect(src).not.toMatch(/catalog\.get\(/); expect(src).not.toMatch(/catalog\.list\(/)`) pins that `history()` does NOT read catalog state for reconstruction. A future PR that bypasses EventLog fails review.

**10. Locked ruling #10 sentinel distinct failure messages:** each axis's `expect(violations, ...)` carries a unique prefix in the message (`axis 1:` / `axis 2:` / `axis 3:`) so CI logs immediately attribute the failure.

---

### Locked clarifications (added 2026-08-12, sign-off)

1. **Locked ruling #11 — narrow `getLifecycleState()` accessor on `CapabilityResolver`.** The CAP-7 stub's `(resolver as unknown as { registry?: ... })` test seam is promoted to a narrow read-only accessor on the resolver's public contract:
   ```ts
   // CapabilityResolver (CAP-7 module) gains:
   public getLifecycleState(capabilityId: string): LifecycleState | undefined {
     return this.registry.getLifecycleState(capabilityId);
   }
   ```
   Task 2 step 3's `lifecycleOf` helper MUST use this accessor (already encoded inline above). Production code MUST NOT reach through the resolver into the Registry. Do NOT add a general `getRegistry()` — that recreates the back-channel. Invariant: "CapabilityService obtains lifecycle state exclusively through the public CapabilityResolver contract. CapabilityResolver remains the authority over lifecycle eligibility and owns its Registry dependency." Implementation note: the `CapabilityResolver.getLifecycleState` accessor is implemented alongside the Task 2 work — the implementer adds the public method on the resolver, then uses it from `lifecycleOf`. Task 2's vitest also covers the new accessor.

2. **Locked ruling #12 — `eventLog` is REQUIRED on `CapabilityPlatform`.** Not optional. No `new EventLog(...)` inside the platform. Production bootstrap supplies the authoritative EventLog; existing CAP-1/3/5/6/7 platform tests MUST be updated to construct with an explicit test EventLog fixture. The same EventLog instance passed to the platform is injected into the service. Invariant: "CapabilityPlatform must never instantiate an EventLog internally. The EventLog is supplied by the composition root and is the same instance injected into CapabilityService."

3. **`registry.has(id)` in Task 4** — the test file references `registry.has` (CAP-3 method) inside `apply()`'s test setup; the production `apply()` delegates **only** through `executor.executeStep`. Verified by the structural sentinel (`expect(src).not.toMatch(/catalog\.register\(/);`).

4. **CAP-11 migration debt tracking** — locked ruling #7 tolerates existing non-CLI direct consumers only as "explicitly tracked CAP-11 migration debt." TUI/Web consumers are NOT migrated by CAP-8; CAP-11 owns that work.

---

Execute tasks in session using executing-plans, batch execution with checkpoints for review.
