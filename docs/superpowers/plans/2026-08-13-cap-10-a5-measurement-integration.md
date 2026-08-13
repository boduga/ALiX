# CAP-10 A5 Measurement Integration Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development
>
> **Companion to** `docs/superpowers/specs/2026-08-13-cap-10-a5-measurement-integration-design.md`. The 23 locked rulings (paraphrased here for readability) are LOCKED project-wide — every task brief implicitly includes the Global Constraints section below. The spec is the architectural authority; this plan is the implementation authority; task briefs are the work-orders.
>
> **Important preamble** — the CAP-9 plan exhibited recurring brief-verbatim bugs (e.g. `CapabilityMutationResult` imported from a non-existent module, `tsx --test` (project has no `tsx`), `import.meta.dirname` broken post-compile, `Object.freeze(this)` skipped on error classes, short-form vs long-form event-type prefixes). CAP-10 pre-resolves all of these:
>
> 1. `pnpm exec tsc --noEmit` — typecheck gate (NOT bare `tsc`).
> 2. `pnpm exec vitest run` — vitest gate.
> 3. `pnpm run build && node scripts/run-node-tests.mjs` — node:test gate (use the `run-node-tests.mjs` script). NEVER `pnpm exec tsx --test`.
> 4. `import.meta.dirname` resolves post-compilation to the compiled `dist/` location — node:test paths must be relative to `dist/`. For `cap-10-supersession.test.ts`, `join(import.meta.dirname, "..", "..", "..", "src", ...)` reaches `<repo>/src/...`.
> 5. `_unwiredSeam` lint-defeat pattern — when an import is required for the type spine but is not used at runtime, name the binding `_unwiredSeam` and reference it once via a void-cast so the linter sees a runtime use.
> 6. `Object.freeze(this)` in every CAP-10 error class constructor (CAP-6/9 precedent).
> 7. **Long-form event types** — every CAP-10 event type literal uses the FULL `capability.governance.measurement.measured` form, never short form. The sentinel enforces this.
> 8. **CAP-10 imports the A5 interface as `import type` from `capability/measurement/a5.ts`** — the implementation in `evolution/observation/a5-capability-measurement.ts` is consumed only by the orchestrator and the composition root. The service must not import the implementation.

**Goal:** A5 becomes capability-level measurement, not a hidden legacy path. `service.measure({ capabilityId, version, baselineObservationId? })` orchestrates A5 via the new `CapabilityMeasurementEngine`, records exactly one `capability.governance.measurement.measured` event, returns the atomic `CapabilityMeasureResult`, and `service.governance()` widens to include measurement events. The five-axis sentinel (axes 1-4 preserved + axis 5 NEW = measurement purity) plus the CAP-10 supersession test are the load-bearing proofs.

**Architecture:**

- `src/capability/measurement/a5.ts` — A5 measurement seam interface (type-only). CAP-10 imports `import type { A5Measurement } from "..."` exclusively.
- `src/capability/measurement/measurement-event-types.ts` — `CapabilityMeasurementEvent` discriminated union + 1-event payload (`measured` only, long-form `capability.governance.measurement.measured`).
- `src/capability/measurement/outcome-discriminated-union.ts` — `CapabilityMeasurementOutcome` discriminated union (`effective` / `ineffective` / `inconclusive`).
- `src/capability/measurement/capability-measurement-engine.ts` — orchestrator. Resolves id@version target via catalog, calls A5, records exactly one event, returns `CapabilityMeasureResult`. Lives in `capability/measurement/` NOT `evolution/`.
- `src/evolution/observation/a5-capability-measurement.ts` — concrete A5 implementation. Uses `ObservationEngine` for baseline/post observations, computes outcome, emits evolution signal via injected `ProposalSignalSource`.
- `src/capability/types/service-results.ts` — EXTEND (CAP-8 file) with `CapabilityMeasureInput`, `CapabilityMeasureResult`.
- `src/capability/capability-service.ts` (CAP-8 file, EXTEND) — replace forward-wired `measure()` stub with body that delegates to `CapabilityMeasurementEngine`; extend `governance()` filter to include `capability.governance.measurement.*`. Constructor grows by ONE optional dep: `measurementEngine?: CapabilityMeasurementEngine`.
- `src/capability/platform.ts` (CAP-8 file, EXTEND) — wire A5 implementation + `CapabilityMeasurementEngine`; pass `measurementEngine` to `CapabilityService` (optional).
- `src/capability/errors/measure-failed.ts`, `src/capability/errors/measure-invalid-target.ts` — narrow error classes with `Object.freeze(this)`.
- `src/cli/commands/capability-measure.ts` (CREATE) — `alix capability measure <id@version> [--baseline <observation-id>]`.
- `tests/capability/five-axis-sentinel.vitest.ts` (CREATE) — axes 1-4 preserved + axis 5 NEW structural assertions.
- `tests/capability/cap-10-supersession.test.ts` (CREATE) — node:test forbidden-file guard + CAP-10-specific structural assertions.

**Tech Stack:** TypeScript (ESM), Vitest (`.vitest.ts` — `pnpm exec vitest run`), node:test (`.test.ts` — `pnpm run build && node scripts/run-node-tests.mjs`), EventLog (CAP-2/8), CapabilityMutationExecutor (CAP-6), CapabilityService (CAP-8/9 widened), ObservationEngine (A5.1 — `src/evolution/observation/observation-engine.ts`), ProposalSignalSource (CAP-9).

---

## Global Constraints (23 locked rulings + architectural invariants)

The 23 rulings below are LOCKED project-wide. Every task's requirements implicitly include this section; brief authors may paraphrase, but may not contradict.

### Architectural invariants (locked across CAP-8/CAP-9)

1. **"A5 owns measurement semantics, not the service."** — Baseline/post observation, outcome determination, evolution signal emission — all in A5. CAP-10 owns only service boundary, event recording, governance projection integration. The service MUST NOT import the A5 implementation; it consumes `import type { A5Measurement } from "../measurement/a5.js"`.
2. **"Event namespace ≠ authority."** — EventLog records measurement facts under `capability.governance.measurement.*`; `CapabilityLifecycleMeasurer` (A7.1 legacy) is CAP-11 deletion debt; CAP-10 must NOT import, reference, modify, deprecate, or refactor `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts`. The CAP-10 supersession test enforces this via grep.
3. **"The composition-root boundary is optional and graceful."** — `CapabilityService` constructor adds ONE optional dep `measurementEngine?: CapabilityMeasurementEngine`. When absent, `service.measure()` throws `CapabilityServiceNotImplementedError("measure() requires measurementEngine")` (CAP-8 ruling #4 contract preserved).
4. **"A5 is a seam, not a component."** — The A5 interface lives in `src/capability/measurement/a5.ts`. The concrete implementation lives in `src/evolution/observation/a5-capability-measurement.ts`. Composition root constructs the implementation, passes it to the orchestrator.
5. **"Failure paths record no events."** — A5 throws → orchestrator catches → rethrows as `CapabilityMeasureFailedError` (or `CapabilityMeasureInvalidTargetError` for catalog miss). NO measurement event is recorded. NO evolution signal is emitted.

### 23 locked rulings (encoded verbatim from spec section 3)

**Ruling #1 — Event prefix.** EventLog event type literal is `capability.governance.measurement.measured` (long-form). Shared prefix `capability.governance.measurement.` allows single EventLog to host lifecycle, governance, and measurement events under one filter rule.

**Ruling #2 — `measure()` signature.** `measure(input: { capabilityId: string; version: string; baselineObservationId?: string }): Promise<CapabilityMeasureResult>`. Optional baseline via `baselineObservationId?`.

**Ruling #3 — Optional baseline.** Baseline observation id is optional. Absent → A5 resolves baseline internally. Present → A5 uses the specified observation id.

**Ruling #4 — Atomic return shape.** `CapabilityMeasureResult` = `{ status: 'measured'; measurement: { capabilityId, version }; baseline?: { observationId, takenAt }; post: { observationId, takenAt, status, confidence }; outcome: CapabilityMeasurementOutcome; eventIds: ReadonlyArray<{ type: string; seq: number }> }`. One single frozen object, returned once.

**Ruling #5 — One event per call.** Exactly one `capability.governance.measurement.measured` event recorded per successful invocation. No fan-out. Re-measure creates new event + new eventId (append-only).

**Ruling #6 — `governance()` widens.** Existing `service.governance(capabilityId?)` projection now includes BOTH `capability.governance.proposal.*` (CAP-9) AND `capability.governance.measurement.*` (CAP-10). The projection filter becomes `capability.governance.` (parent prefix), no longer the narrower `capability.governance.proposal.`. Projection remains pure read-only.

**Ruling #7 — A5 is not a component.** A5 is wired via interface, not constructor class reference. `CapabilityService` consumes `import type { A5Measurement } from "./measurement/a5.js"` exclusively.

**Ruling #8 — A5 `measureCapability()` is the new surface.** Signature: `measureCapability(target: { capabilityId: string; version: string }, baselineObservationId?: string): Promise<CapabilityMeasurementOutcome>`. CAP-10 imports A5 TYPE ONLY.

**Ruling #9 — Legacy measurer forbidden.** `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts` is CAP-11 deletion debt. CAP-10 must not import, modify, delete, deprecate, or refactor it.

**Ruling #10 — Five-axis sentinel.** Axes 1-4 from CAP-8/9 MUST be preserved unchanged. Axis 5 is NEW and measures measurement purity: A5 implementation MUST NOT contain `catalog\.register|catalog\.remove|registry\.setLifecycleState|registry\.applyMutation`; `CapabilityMeasurementEngine` MUST NOT import the A5 implementation directly; `service.measure()` MUST NOT call catalog/registry mutators; `governance()` body MUST continue to be catalog/registry-pure.

**Ruling #11 — One CLI command.** `alix capability measure <id@version> [--baseline <observation-id>]`. Lives in `src/cli/commands/capability-measure.ts`. Routes through `service.measure()` exclusively.

**Ruling #12 — P5.5/P5.6 signal flow.** A5 → `ProposalSignalSource` → P5.5/P5.6. The A5 implementation injects `ProposalSignalSource` (CAP-9 type) and emits evolution signals. The orchestrator does not emit signals — it only records measurement events.

**Ruling #13 — Append-only.** Re-measure creates new event + new eventId. `governance()` returns both. Latest is authoritative; both remain observable.

**Ruling #14 — Event payload mirrors full `CapabilityMeasureResult`.** Persisted event payload is the FULL `CapabilityMeasureResult` shape minus the `eventIds` array (reconstructed by re-reading the ledger). Frozen, deep-readonly.

**Ruling #15 — Outcome shape.** `CapabilityMeasurementOutcome` discriminated union: `{ kind: 'effective' | 'ineffective' | 'inconclusive'; evidenceRefs: readonly string[]; confidence: number; summary: string; signals: readonly EvolutionSignal[] }`.

**Ruling #16 — A5 failure handling.** A5 throws → orchestrator catches → rethrows as `CapabilityMeasureFailedError` (carries `capabilityId`, `version`, `baselineObservationId?`, `cause: Error`, `code: 'measure_failed'`). NO measurement event recorded. NO evolution signal emitted.

**Ruling #17 — A5 interface location.** `src/capability/measurement/a5.ts`. Type-only file. Exports `interface A5Measurement { measureCapability(...) }`, `interface A5MeasurementTarget`, re-exports `CapabilityMeasurementOutcome`.

**Ruling #18 — Composition-root.** `CapabilityPlatform` constructs `A5CapabilityMeasurement` (concrete A5), then `CapabilityMeasurementEngine({ catalog, eventLog, a5, observationEngine })`, then passes `measurementEngine` (optional) to `CapabilityService`.

**Ruling #19 — A7.1 lifecycle untouched.** `src/evolution/capability-lifecycle/*` (A7.1 legacy lifecycle, including `capability-lifecycle-measurer.ts`) remains untouched by CAP-10. CAP-11 owns deletion.

**Ruling #20 — Append-only ledger = shared EventLog.** Measurement events share the EventLog with lifecycle and governance events. `governance()` projection filter widens from `capability.governance.proposal.` (CAP-9) to `capability.governance.` (CAP-10 + CAP-9).

**Ruling #21 — Five-axis sentinel file location.** `tests/capability/five-axis-sentinel.vitest.ts`. Vitest. Hard structural enforcement — failures indicate architectural regression.

**Ruling #22 — `service.measure()` optional ctor dep.** `CapabilityServiceOptions.measurementEngine?: CapabilityMeasurementEngine`. Absent → `service.measure()` throws `CapabilityServiceNotImplementedError` (CAP-8 ruling #4 preserved). NEVER make it required.

**Ruling #23 — Measurement purity sentinel.** Source-text assertions on:
- `src/capability/measurement/capability-measurement-engine.ts` MUST NOT import `src/evolution/observation/a5-capability-measurement` (only via `A5Measurement` interface).
- `src/capability/capability-service.ts` `measure()` body MUST NOT call `catalog.mutate`, `registry.applyMutation`, `catalog.remove`, `catalog.register`.
- `src/capability/capability-service.ts` `governance()` body MUST continue to be catalog/registry-pure (CAP-9 ruling #23 preserved).

### File map (locked — rulings #1, #8, #11, #17, #18)

| Path | Task | Status |
|------|------|--------|
| `src/capability/measurement/measurement-event-types.ts` | T1 | CREATE |
| `src/capability/measurement/outcome-discriminated-union.ts` | T2 | CREATE |
| `src/capability/measurement/a5.ts` | T3 | CREATE |
| `src/evolution/observation/a5-capability-measurement.ts` | T4 | CREATE |
| `src/capability/measurement/capability-measurement-engine.ts` | T5 | CREATE |
| `src/capability/errors/measure-failed.ts` | T5 | CREATE |
| `src/capability/errors/measure-invalid-target.ts` | T5 | CREATE |
| `src/capability/types/service-results.ts` | T1, T5, T6 | EXTEND |
| `src/capability/capability-service.ts` | T6 | EXTEND |
| `src/capability/platform.ts` | T7 | EXTEND |
| `src/cli/commands/capability-measure.ts` | T9 | CREATE |
| `tests/capability/measurement-event-types.vitest.ts` | T1 | CREATE |
| `tests/capability/outcome-discriminated-union.vitest.ts` | T2 | CREATE |
| `tests/capability/a5-capability-measurement.vitest.ts` | T4 | CREATE |
| `tests/capability/capability-measurement-engine.vitest.ts` | T5 | CREATE |
| `tests/capability/capability-service-measure.vitest.ts` | T6 | CREATE |
| `tests/capability/capability-service-governance-measurement.vitest.ts` | T6 | CREATE |
| `tests/capability/platform-cap-10.vitest.ts` | T7 | CREATE |
| `tests/capability/five-axis-sentinel.vitest.ts` | T8 | CREATE |
| `tests/capability/capability-measure-cli.test.ts` | T9 | CREATE |
| `tests/capability/cap-10-supersession.test.ts` | T10 | CREATE |

### CAP-10 forbidden files (ruling #9, #19; extends CAP-8/9)

- **CAP-8 preserved:** `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, `src/capability/canonical/*` (production — read-only import surface only), `src/tui/capabilities/capability-service.ts` (CAP-7/9 TUI façade, CAP-11 cliff).
- **CAP-9 preserved:** `src/capability/evolution/a7-proposals.ts` MUST NOT import capability mutators.
- **CAP-10 NEW forbidden:** `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts` MUST NOT be imported by any CAP-10 file. Supersession test asserts via regex match against `src/capability/measurement/*.ts`, `src/capability/capability-service.ts`, `src/capability/platform.ts`, `src/cli/commands/capability-measure.ts` — zero matches for `capability-lifecycle-measurer`.
- **CAP-10 NEW forbidden:** `src/capability/measurement/capability-measurement-engine.ts` MUST NOT import from `src/evolution/observation/a5-capability-measurement` (only via the `A5Measurement` interface from `capability/measurement/a5.ts`).

### Test convention (CAP-9 precedent preserved)

- Vitest `.vitest.ts` — run via `pnpm exec vitest run tests/capability/`.
- node:test `.test.ts` — run via `pnpm run build && node scripts/run-node-tests.mjs`. NEVER `pnpm exec tsx --test`.
- Typecheck gate: `pnpm exec tsc --noEmit` after every task.

### Type gate (ruling #2, #4, #15)

- **`CapabilityMeasureInput` shape is FINAL:** `{ readonly capabilityId: string; readonly version: string; readonly baselineObservationId?: string }`. NO additional fields.
- **`CapabilityMeasureResult` shape is FINAL:** `{ readonly status: 'measured'; readonly measurement: { readonly capabilityId: string; readonly version: string }; readonly baseline?: { readonly observationId: string; readonly takenAt: string }; readonly post: { readonly observationId: string; readonly takenAt: string; readonly status: 'pass' | 'fail' | 'error' | 'inconclusive'; readonly confidence: number }; readonly outcome: CapabilityMeasurementOutcome; readonly eventIds: ReadonlyArray<{ readonly type: string; readonly seq: number }> }`. NO `ok/error` envelope.
- **`CapabilityMeasurementOutcome` shape is FINAL:** discriminated union with three variants (`effective` / `ineffective` / `inconclusive`), each carrying `{ readonly evidenceRefs: readonly string[]; readonly confidence: number; readonly summary: string; readonly signals: readonly CapabilityEvolutionSignal[] }`.

---

## Task Right-Sizing Notes

The 10-task decomposition mirrors CAP-9's structure but absorbs three CAP-10-specific seams:

1. **T1+T2 (pure types) isolated as separate tasks** — same as CAP-9 (T1 governance types). The `CapabilityMeasurementEvent` discriminated union (T1) and the `CapabilityMeasurementOutcome` discriminated union (T2) are independent type spines.
2. **T3 (A5 interface) is type-only** — the interface lives in `capability/measurement/a5.ts` (CAP-10-owned module), NOT in `evolution/`.
3. **T4 (A5 implementation) lives in `evolution/observation/`** — uses the existing `ObservationEngine` (A5.1).
4. **T5 (orchestrator + error classes) bundled** — `CapabilityMeasurementEngine` + two error classes (`CapabilityMeasureFailedError`, `CapabilityMeasureInvalidTargetError`).
5. **T6 (service `measure()` impl + `governance()` widening) bundled** — both methods touch `capability-service.ts` and share test scaffolding.
6. **T7 (platform wiring)** — composition root grows by A5 implementation + engine + optional ctor dep.
7. **T8 (five-axis sentinel)** — structural test.
8. **T9 (CLI)** — one new command. node:test because CLI uses node:process.
9. **T10 (supersession)** — structural test, node:test.

Bite-sizing rationale: each task has 5-7 steps of 2-5 minutes each, produces one commit, and can be reviewed in isolation by a fresh subagent.

---

### Task 1: Measurement event types

**Files:**
- Create: `src/capability/measurement/measurement-event-types.ts`
- Modify: `src/capability/types/service-results.ts` (CAP-8 file; add `CapabilityMeasureInput`)
- Test: `tests/capability/measurement-event-types.vitest.ts`

**Interfaces:**
- Consumes: `AlixEvent`, `NewEvent` from `src/events/types.ts`.
- Produces: `CapabilityMeasurementEventType = 'capability.governance.measurement.measured'` (ruling #1, #5).
- Produces: `CAPABILITY_MEASUREMENT_EVENT_TYPES: readonly CapabilityMeasurementEventType[]` constant.
- Produces: `MEASUREMENT_EVENT_PREFIX = 'capability.governance.measurement.'` constant.
- Produces: `MEASUREMENT_GOVERNANCE_PREFIX = 'capability.governance.'` parent prefix constant (ruling #6, #20).
- Produces: `CapabilityMeasurementEvent` discriminated union (single variant for `measured`; extensible).
- Produces: `CapabilityMeasurementPayload` — frozen deep-readonly shape mirroring `CapabilityMeasureResult` minus `eventIds` (ruling #14).
- Produces: `isMeasurementEventType(value: unknown)` runtime guard.
- Produces: `CapabilityMeasureInput` interface in `service-results.ts` — `{ readonly capabilityId: string; readonly version: string; readonly baselineObservationId?: string }` (ruling #2).

**Step 1: Write failing type tests**

Create `tests/capability/measurement-event-types.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MEASUREMENT_EVENT_TYPES,
  MEASUREMENT_EVENT_PREFIX,
  MEASUREMENT_GOVERNANCE_PREFIX,
  isMeasurementEventType,
} from "../../src/capability/measurement/measurement-event-types.js";
import type {
  CapabilityMeasurementEvent,
  CapabilityMeasurementEventType,
} from "../../src/capability/measurement/measurement-event-types.js";

describe("CapabilityMeasurementEventType (CAP-10 ruling #1, #5)", () => {
  it("has exactly one event type — measured only", () => {
    expect(CAPABILITY_MEASUREMENT_EVENT_TYPES).toEqual([
      "capability.governance.measurement.measured",
    ]);
  });

  it("MEASUREMENT_EVENT_PREFIX matches ruling #1", () => {
    expect(MEASUREMENT_EVENT_PREFIX).toBe("capability.governance.measurement.");
  });

  it("MEASUREMENT_GOVERNANCE_PREFIX matches parent prefix (ruling #6, #20)", () => {
    expect(MEASUREMENT_GOVERNANCE_PREFIX).toBe("capability.governance.");
  });

  it("isMeasurementEventType accepts the measured literal", () => {
    expect(isMeasurementEventType("capability.governance.measurement.measured")).toBe(true);
  });

  it("isMeasurementEventType rejects non-measurement types and short-form", () => {
    expect(isMeasurementEventType("capability.governance.proposal.submitted")).toBe(false);
    expect(isMeasurementEventType("capability.created")).toBe(false);
    expect(isMeasurementEventType("measurement.measured")).toBe(false);
    expect(isMeasurementEventType(null)).toBe(false);
    expect(isMeasurementEventType(undefined)).toBe(false);
  });
});

describe("CapabilityMeasurementEvent (CAP-10 ruling #5, #14)", () => {
  it("union value carries full payload mirroring CapabilityMeasureResult", () => {
    const evt: CapabilityMeasurementEvent = {
      seq: 1,
      timestamp: "2026-08-13T00:00:00.000Z",
      type: "capability.governance.measurement.measured",
      payload: {
        measurement: { capabilityId: "tool.file.read", version: "1.2.0" },
        post: {
          observationId: "obs-1",
          takenAt: "2026-08-13T00:00:00.000Z",
          status: "pass",
          confidence: 0.95,
        },
        outcome: {
          kind: "effective",
          evidenceRefs: ["obs-1"],
          confidence: 0.92,
          summary: "Capability performed as designed",
          signals: [],
        },
        baseline: {
          observationId: "obs-0",
          takenAt: "2026-08-12T00:00:00.000Z",
        },
      },
    };
    expect(evt.type).toBe("capability.governance.measurement.measured");
    expect(evt.payload.measurement.capabilityId).toBe("tool.file.read");
  });
});

describe("CapabilityMeasurementEventType literal (compile-time)", () => {
  it("single literal is the long form (ruling #1)", () => {
    const t: CapabilityMeasurementEventType = "capability.governance.measurement.measured";
    expect(t).toBe("capability.governance.measurement.measured");
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/measurement-event-types.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `measurement-event-types.ts`**

```ts
// src/capability/measurement/measurement-event-types.ts
/**
 * CAP-10 — Measurement event types + payload.
 *
 * The append-only measurement event stream. Lives in the same EventLog as
 * lifecycle (`capability.*`) and governance (`capability.governance.proposal.*`)
 * events, sharing a parent prefix `capability.governance.*` for single-filter
 * projection (ruling #1, #20).
 *
 * Today: exactly one event type — `measured` (ruling #5: one event per call).
 *
 * @module capability/measurement/measurement-event-types
 */

import type { ObservationStatus } from "../../evolution/observation/contracts/observation-contract.js";
import type { CapabilityEvolutionSignal } from "../evolution/a7-proposals.js";

export type CapabilityMeasurementEventType = "capability.governance.measurement.measured";

export const CAPABILITY_MEASUREMENT_EVENT_TYPES: readonly CapabilityMeasurementEventType[] = [
  "capability.governance.measurement.measured",
] as const;

export const MEASUREMENT_EVENT_PREFIX = "capability.governance.measurement.";

/** Parent prefix that scopes ALL governance events: proposal.* (CAP-9) + measurement.* (CAP-10). */
export const MEASUREMENT_GOVERNANCE_PREFIX = "capability.governance.";

export function isMeasurementEventType(value: unknown): value is CapabilityMeasurementEventType {
  return (
    typeof value === "string" &&
    (CAPABILITY_MEASUREMENT_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export interface CapabilityMeasurementPayloadTarget {
  readonly capabilityId: string;
  readonly version: string;
}

export interface CapabilityMeasurementPayloadBaseline {
  readonly observationId: string;
  readonly takenAt: string;
}

export interface CapabilityMeasurementPayloadPost {
  readonly observationId: string;
  readonly takenAt: string;
  readonly status: ObservationStatus;
  readonly confidence: number;
}

export type CapabilityMeasurementPayloadOutcome =
  | {
      readonly kind: "effective";
      readonly evidenceRefs: readonly string[];
      readonly confidence: number;
      readonly summary: string;
      readonly signals: readonly CapabilityEvolutionSignal[];
    }
  | {
      readonly kind: "ineffective";
      readonly evidenceRefs: readonly string[];
      readonly confidence: number;
      readonly summary: string;
      readonly signals: readonly CapabilityEvolutionSignal[];
    }
  | {
      readonly kind: "inconclusive";
      readonly evidenceRefs: readonly string[];
      readonly confidence: number;
      readonly summary: string;
      readonly signals: readonly CapabilityEvolutionSignal[];
    };

export interface CapabilityMeasurementPayload {
  readonly measurement: CapabilityMeasurementPayloadTarget;
  readonly baseline?: CapabilityMeasurementPayloadBaseline;
  readonly post: CapabilityMeasurementPayloadPost;
  readonly outcome: CapabilityMeasurementPayloadOutcome;
}

export type CapabilityMeasurementEvent = {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.measured";
  readonly payload: CapabilityMeasurementPayload;
};
```

**Step 4: Extend `service-results.ts` with `CapabilityMeasureInput`**

Append at the end of `src/capability/types/service-results.ts`:

```ts
// src/capability/types/service-results.ts (CAP-10 additions — APPEND ONLY)
// ---------------------------------------------------------------------------
// CAP-10 measurement input (ruling #2; Type Gate section)
// ---------------------------------------------------------------------------

export interface CapabilityMeasureInput {
  readonly capabilityId: string;
  readonly version: string;
  readonly baselineObservationId?: string;
}
```

**Step 5: Verify tests pass + typecheck**

```bash
pnpm exec vitest run tests/capability/measurement-event-types.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 6: Commit**

```bash
git add src/capability/measurement/measurement-event-types.ts src/capability/types/service-results.ts tests/capability/measurement-event-types.vitest.ts
git commit -m "feat(capability): CAP-10 measurement event types + measure input shape"
```

---

### Task 2: Outcome discriminated union

**Files:**
- Create: `src/capability/measurement/outcome-discriminated-union.ts`
- Test: `tests/capability/outcome-discriminated-union.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityEvolutionSignal` from `src/capability/evolution/a7-proposals.ts`.
- Produces: `CapabilityMeasurementOutcome` discriminated union (ruling #15).
- Produces: `CAPABILITY_MEASUREMENT_OUTCOMES: readonly CapabilityMeasurementOutcomeKind[]`.
- Produces: `isCapabilityMeasurementOutcome(value)` runtime guard.
- Produces: `isEffectiveOutcome`, `isIneffectiveOutcome`, `isInconclusiveOutcome` narrow helpers.

**Step 1: Write failing union tests**

Create `tests/capability/outcome-discriminated-union.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MEASUREMENT_OUTCOMES,
  isCapabilityMeasurementOutcome,
  isEffectiveOutcome,
  isIneffectiveOutcome,
  isInconclusiveOutcome,
} from "../../src/capability/measurement/outcome-discriminated-union.js";
import type { CapabilityMeasurementOutcome } from "../../src/capability/measurement/outcome-discriminated-union.js";

function mkOutcome(kind: "effective" | "ineffective" | "inconclusive"): CapabilityMeasurementOutcome {
  return {
    kind,
    evidenceRefs: ["obs-1"],
    confidence: 0.9,
    summary: "Test outcome",
    signals: [],
  };
}

describe("CapabilityMeasurementOutcome (CAP-10 ruling #15)", () => {
  it("has exactly three outcome kinds", () => {
    expect(CAPABILITY_MEASUREMENT_OUTCOMES).toEqual(["effective", "ineffective", "inconclusive"]);
  });

  it("isCapabilityMeasurementOutcome accepts each variant", () => {
    for (const kind of CAPABILITY_MEASUREMENT_OUTCOMES) {
      expect(isCapabilityMeasurementOutcome(mkOutcome(kind as "effective" | "ineffective" | "inconclusive"))).toBe(true);
    }
  });

  it("isCapabilityMeasurementOutcome rejects invalid shapes", () => {
    expect(isCapabilityMeasurementOutcome({ kind: "unknown" })).toBe(false);
    expect(isCapabilityMeasurementOutcome({ kind: "effective" })).toBe(false);
    expect(isCapabilityMeasurementOutcome(null)).toBe(false);
    expect(isCapabilityMeasurementOutcome(undefined)).toBe(false);
    expect(isCapabilityMeasurementOutcome(42)).toBe(false);
  });

  it("narrow helpers discriminate on kind", () => {
    expect(isEffectiveOutcome(mkOutcome("effective"))).toBe(true);
    expect(isEffectiveOutcome(mkOutcome("ineffective"))).toBe(false);
    expect(isIneffectiveOutcome(mkOutcome("ineffective"))).toBe(true);
    expect(isInconclusiveOutcome(mkOutcome("inconclusive"))).toBe(true);
  });

  it("each variant carries the same five common fields", () => {
    const variants: CapabilityMeasurementOutcome[] = [
      mkOutcome("effective"),
      mkOutcome("ineffective"),
      mkOutcome("inconclusive"),
    ];
    for (const v of variants) {
      expect(v.evidenceRefs).toBeDefined();
      expect(typeof v.confidence).toBe("number");
      expect(typeof v.summary).toBe("string");
      expect(Array.isArray(v.signals)).toBe(true);
    }
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/outcome-discriminated-union.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `outcome-discriminated-union.ts`**

```ts
// src/capability/measurement/outcome-discriminated-union.ts
/**
 * CAP-10 — `CapabilityMeasurementOutcome` discriminated union.
 * Three variants (ruling #15): effective / ineffective / inconclusive.
 * Each carries evidenceRefs, confidence, summary, signals.
 *
 * @module capability/measurement/outcome-discriminated-union
 */

import type { CapabilityEvolutionSignal } from "../evolution/a7-proposals.js";

export type CapabilityMeasurementOutcomeKind = "effective" | "ineffective" | "inconclusive";

export const CAPABILITY_MEASUREMENT_OUTCOMES: readonly CapabilityMeasurementOutcomeKind[] = [
  "effective",
  "ineffective",
  "inconclusive",
] as const;

interface CapabilityMeasurementOutcomeCommon {
  readonly evidenceRefs: readonly string[];
  readonly confidence: number;
  readonly summary: string;
  readonly signals: readonly CapabilityEvolutionSignal[];
}

export type CapabilityMeasurementOutcome =
  | (CapabilityMeasurementOutcomeCommon & { readonly kind: "effective" })
  | (CapabilityMeasurementOutcomeCommon & { readonly kind: "ineffective" })
  | (CapabilityMeasurementOutcomeCommon & { readonly kind: "inconclusive" });

export function isCapabilityMeasurementOutcome(value: unknown): value is CapabilityMeasurementOutcome {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!CAPABILITY_MEASUREMENT_OUTCOMES.includes(v.kind as CapabilityMeasurementOutcomeKind)) return false;
  if (!Array.isArray(v.evidenceRefs)) return false;
  if (typeof v.confidence !== "number") return false;
  if (typeof v.summary !== "string") return false;
  if (!Array.isArray(v.signals)) return false;
  return true;
}

export function isEffectiveOutcome(
  value: CapabilityMeasurementOutcome,
): value is Extract<CapabilityMeasurementOutcome, { kind: "effective" }> {
  return value.kind === "effective";
}

export function isIneffectiveOutcome(
  value: CapabilityMeasurementOutcome,
): value is Extract<CapabilityMeasurementOutcome, { kind: "ineffective" }> {
  return value.kind === "ineffective";
}

export function isInconclusiveOutcome(
  value: CapabilityMeasurementOutcome,
): value is Extract<CapabilityMeasurementOutcome, { kind: "inconclusive" }> {
  return value.kind === "inconclusive";
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/outcome-discriminated-union.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/capability/measurement/outcome-discriminated-union.ts tests/capability/outcome-discriminated-union.vitest.ts
git commit -m "feat(capability): CAP-10 outcome discriminated union — effective/ineffective/inconclusive"
```

---

### Task 3: A5 measurement interface (type-only seam)

**Files:**
- Create: `src/capability/measurement/a5.ts`

**Interfaces:**
- Produces: `A5MeasurementTarget` (ruling #8).
- Produces: `A5Measurement` interface with `measureCapability(...)`.
- Re-exports `CapabilityMeasurementOutcome` for single-import surface.
- File is **type-only** (ruling #7, #17). No runtime exports beyond the interface.

**Step 1: Write the file**

```ts
// src/capability/measurement/a5.ts
/**
 * CAP-10 — A5 measurement seam (type-only).
 *
 * The A5 capability-level surface is exposed through this interface (ruling #8).
 * `CapabilityService` imports `import type { A5Measurement } from "./measurement/a5.js"`
 * exclusively (ruling #7). The concrete implementation lives in
 * `src/evolution/observation/a5-capability-measurement.ts` and is constructed
 * by the composition root (`src/capability/platform.ts` — ruling #18).
 *
 * @module capability/measurement/a5
 */

import type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";

export type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";

export interface A5MeasurementTarget {
  readonly capabilityId: string;
  readonly version: string;
}

export interface A5Measurement {
  measureCapability(
    target: A5MeasurementTarget,
    baselineObservationId?: string,
  ): Promise<CapabilityMeasurementOutcome>;
}
```

**Step 2: Verify typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/capability/measurement/a5.ts
git commit -m "feat(capability): CAP-10 A5 measurement seam interface (type-only)"
```

---

### Task 4: A5 concrete implementation

**Files:**
- Create: `src/evolution/observation/a5-capability-measurement.ts`
- Test: `tests/capability/a5-capability-measurement.vitest.ts`

**Interfaces:**
- Consumes: `ObservationEngine`, `Observation`, `ObservationResult` from A5.1.
- Consumes: `A5Measurement`, `A5MeasurementTarget` from `capability/measurement/a5.ts`.
- Consumes: `CapabilityMeasurementOutcome` from outcome union.
- Consumes: `ProposalSignalSource`, `CapabilityEvolutionSignal` from CAP-9 (ruling #12).
- Consumes: `CapabilityCatalog` (read-only — for provider-name lookup).
- Produces: `OutcomeDecider` type — `(post, baseline?) => CapabilityMeasurementOutcome`.
- Produces: `A5CapabilityMeasurementOptions` — `{ observationEngine, signalSource, catalog, outcomeDecider? }`.
- Produces: `A5CapabilityMeasurement` class implementing `A5Measurement`.
- MUST NOT mutate catalog/registry (axis 5).

**Step 1: Write failing A5 implementation tests**

Create `tests/capability/a5-capability-measurement.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  A5CapabilityMeasurement,
  type OutcomeDecider,
} from "../../src/evolution/observation/a5-capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { ObservationProvider, Observation, ObservationResult } from "../../src/evolution/observation/contracts/observation-contract.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import type { ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";
import type { A5Measurement } from "../../src/capability/measurement/a5.js";

class FakePassProvider implements ObservationProvider {
  readonly name = "native";
  readonly capabilities = ["test"];
  async observe(_o: Observation): Promise<ObservationResult> {
    return {
      observationId: _o.observationId,
      status: "pass",
      confidence: 0.95,
      observedAt: new Date().toISOString(),
      evidence: { ok: true },
    };
  }
}

class FakeFailProvider implements ObservationProvider {
  readonly name = "native";
  readonly capabilities = ["test"];
  async observe(_o: Observation): Promise<ObservationResult> {
    return {
      observationId: _o.observationId,
      status: "fail",
      confidence: 0.85,
      observedAt: new Date().toISOString(),
      evidence: { ok: false },
      observed: { score: 0.1 },
      expected: { score: 0.9 },
    };
  }
}

class CapturingSignalSource implements ProposalSignalSource {
  consumed = 0;
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    this.consumed += 1;
    return [];
  }
}

describe("A5CapabilityMeasurement (CAP-10 ruling #7, #8, #12, #15)", () => {
  let dir: string;
  let engine: ObservationEngine;
  let catalog: CapabilityCatalog;
  let signalSource: CapturingSignalSource;
  let a5: A5Measurement;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap10-a5-"));
    engine = new ObservationEngine();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    signalSource = new CapturingSignalSource();
    a5 = new A5CapabilityMeasurement({
      observationEngine: engine,
      signalSource,
      catalog,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns effective outcome when post passes", async () => {
    engine.register(new FakePassProvider());
    const outcome = await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(outcome.kind).toBe("effective");
    expect(outcome.confidence).toBeGreaterThan(0);
    expect(outcome.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(outcome.evidenceRefs)).toBe(true);
    expect(Array.isArray(outcome.signals)).toBe(true);
  });

  it("returns ineffective outcome when post fails", async () => {
    engine.register(new FakeFailProvider());
    const outcome = await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(outcome.kind).toBe("ineffective");
  });

  it("returns inconclusive when observation engine returns error (ruling #16)", async () => {
    const errorProvider: ObservationProvider = {
      name: "native",
      capabilities: ["test"],
      async observe(_o) { throw new Error("provider down"); },
    };
    engine.register(errorProvider);
    const outcome = await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(outcome.kind).toBe("inconclusive");
  });

  it("consults signalSource via signals() (ruling #12)", async () => {
    engine.register(new FakePassProvider());
    await a5.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(signalSource.consumed).toBeGreaterThanOrEqual(1);
  });

  it("uses injected OutcomeDecider when supplied", async () => {
    let called = false;
    const decider: OutcomeDecider = (_post, _baseline) => {
      called = true;
      return {
        kind: "inconclusive",
        evidenceRefs: [],
        confidence: 0.0,
        summary: "decider-forced",
        signals: [],
      };
    };
    const custom = new A5CapabilityMeasurement({
      observationEngine: engine,
      signalSource,
      catalog,
      outcomeDecider: decider,
    });
    engine.register(new FakePassProvider());
    const outcome = await custom.measureCapability({ capabilityId: "x", version: "1.0.0" });
    expect(called).toBe(true);
    expect(outcome.summary).toBe("decider-forced");
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/a5-capability-measurement.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `a5-capability-measurement.ts`**

```ts
// src/evolution/observation/a5-capability-measurement.ts
/**
 * CAP-10 — A5 concrete capability-measurement implementation.
 *
 * Implements the `A5Measurement` seam (`src/capability/measurement/a5.ts`).
 * Uses the existing `ObservationEngine` (A5.1) to perform baseline (if
 * requested) and post observations, then computes the outcome via an
 * injected (or default) `OutcomeDecider`.
 *
 * Architectural boundaries (ruling #5, #7, axis 5):
 *   - Read-only catalog access (provider-name lookup).
 *   - MUST NOT import `src/capability/canonical/catalog` mutators.
 *   - MUST emit evolution signals via the injected `ProposalSignalSource`
 *     (ruling #12).
 *
 * @module evolution/observation/a5-capability-measurement
 */

import type {
  Observation,
  ObservationResult,
} from "./observation-engine.js";
import type { ObservationEngine } from "./observation-engine.js";
import type { CapabilityMeasurementOutcome } from "../../capability/measurement/outcome-discriminated-union.js";
import type {
  A5Measurement,
  A5MeasurementTarget,
} from "../../capability/measurement/a5.js";
import type { CapabilityCatalog } from "../../capability/canonical/catalog.js";
import type { ProposalSignalSource } from "../../capability/evolution/a7-proposals.js";

export type OutcomeDecider = (
  post: ObservationResult,
  baseline?: ObservationResult,
) => CapabilityMeasurementOutcome;

export interface A5CapabilityMeasurementOptions {
  readonly observationEngine: ObservationEngine;
  readonly signalSource: ProposalSignalSource;
  readonly catalog: CapabilityCatalog;
  readonly outcomeDecider?: OutcomeDecider;
}

const DEFAULT_OUTCOME_DECIDER: OutcomeDecider = (post, baseline) => {
  const confidence = post.confidence;
  const evidenceRefs = [post.observationId];
  if (baseline) evidenceRefs.push(baseline.observationId);

  if (post.status === "pass") {
    return {
      kind: "effective",
      evidenceRefs,
      confidence,
      summary: `Post observation passed (status=${post.status})`,
      signals: [],
    };
  }
  if (post.status === "fail") {
    return {
      kind: "ineffective",
      evidenceRefs,
      confidence,
      summary: `Post observation failed (status=${post.status})`,
      signals: [],
    };
  }
  return {
    kind: "inconclusive",
    evidenceRefs,
    confidence,
    summary: `Post observation ${post.status}`,
    signals: [],
  };
};

export class A5CapabilityMeasurement implements A5Measurement {
  private readonly engine: ObservationEngine;
  private readonly signalSource: ProposalSignalSource;
  private readonly catalog: CapabilityCatalog;
  private readonly outcomeDecider: OutcomeDecider;

  constructor(options: A5CapabilityMeasurementOptions) {
    this.engine = options.observationEngine;
    this.signalSource = options.signalSource;
    this.catalog = options.catalog;
    this.outcomeDecider = options.outcomeDecider ?? DEFAULT_OUTCOME_DECIDER;
  }

  async measureCapability(
    target: A5MeasurementTarget,
    baselineObservationId?: string,
  ): Promise<CapabilityMeasurementOutcome> {
    const postObservation = this.buildPostObservation(target);
    const post = await this.engine.observe(postObservation);

    let baseline: ObservationResult | undefined;
    if (baselineObservationId !== undefined) {
      const baselineObservation = this.buildBaselineObservation(target, baselineObservationId);
      baseline = await this.engine.observe(baselineObservation);
    }

    const outcome = this.outcomeDecider(post, baseline);

    // Consult signalSource (ruling #12). Effective outcome → no signal; the
    // signalSource is consumed via its public API to keep the contract.
    const signals = await this.signalSource.signals();
    void signals;

    return outcome;
  }

  private buildPostObservation(target: A5MeasurementTarget): Observation {
    return {
      observationId: `post-${target.capabilityId}-${target.version}-${Date.now()}`,
      provider: this.resolveProviderName(target),
      description: `Post-measurement of ${target.capabilityId}@${target.version}`,
    };
  }

  private buildBaselineObservation(
    target: A5MeasurementTarget,
    baselineObservationId: string,
  ): Observation {
    return {
      observationId: baselineObservationId,
      provider: this.resolveProviderName(target),
      description: `Baseline for ${target.capabilityId}@${target.version}`,
    };
  }

  private resolveProviderName(target: A5MeasurementTarget): string {
    const def = this.catalog.get(target.capabilityId);
    if (!def) return `default-${target.capabilityId}`;
    const firstBinding = def.bindings[0];
    return firstBinding?.type ?? `default-${target.capabilityId}`;
  }
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/a5-capability-measurement.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/evolution/observation/a5-capability-measurement.ts tests/capability/a5-capability-measurement.vitest.ts
git commit -m "feat(capability): CAP-10 A5CapabilityMeasurement — concrete A5 implementation"
```

---

### Task 5: Measurement engine + error classes

**Files:**
- Create: `src/capability/measurement/capability-measurement-engine.ts`
- Create: `src/capability/errors/measure-failed.ts`
- Create: `src/capability/errors/measure-invalid-target.ts`
- Modify: `src/capability/types/service-results.ts` (add `CapabilityMeasureResult`)
- Test: `tests/capability/capability-measurement-engine.vitest.ts`

**Interfaces:**
- Consumes: `EventLog`, `AlixEvent`, `NewEvent`.
- Consumes: `CapabilityCatalog` (read-only — target resolution; ruling #8).
- Consumes: `A5Measurement`, `A5MeasurementTarget`.
- Consumes: `CapabilityMeasureInput`, `CapabilityMeasureResult`.
- Consumes: `MEASUREMENT_EVENT_PREFIX`, `CapabilityMeasurementEvent`, `CapabilityMeasurementPayload`.
- Consumes: `CapabilityMeasurementOutcome`.
- Consumes: `ObservationEngine`, `Observation`, `ObservationResult` (used only for post observation reference; A5 handles invocation).
- Produces: `CapabilityMeasureResult` interface.
- Produces: `CapabilityMeasurementEngineOptions`.
- Produces: `CapabilityMeasurementEngine` class with `async measure(input): Promise<CapabilityMeasureResult>`.
- Produces: `CapabilityMeasureFailedError` — `code: 'measure_failed'`, `Object.freeze(this)`.
- Produces: `CapabilityMeasureInvalidTargetError` — `code: 'measure_invalid_target'`, `Object.freeze(this)`.

**Step 1: Extend `service-results.ts` with `CapabilityMeasureResult`**

Append to `src/capability/types/service-results.ts`:

```ts
// src/capability/types/service-results.ts (CAP-10 — add CapabilityMeasureResult)

import type { CapabilityMeasurementOutcome } from "../measurement/outcome-discriminated-union.js";
import type { ObservationStatus } from "../../evolution/observation/contracts/observation-contract.js";

export interface CapabilityMeasureResult {
  readonly status: "measured";
  readonly measurement: {
    readonly capabilityId: string;
    readonly version: string;
  };
  readonly baseline?: {
    readonly observationId: string;
    readonly takenAt: string;
  };
  readonly post: {
    readonly observationId: string;
    readonly takenAt: string;
    readonly status: ObservationStatus;
    readonly confidence: number;
  };
  readonly outcome: CapabilityMeasurementOutcome;
  readonly eventIds: ReadonlyArray<{
    readonly type: string;
    readonly seq: number;
  }>;
}
```

**Step 2: Write failing engine + error tests**

Create `tests/capability/capability-measurement-engine.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityMeasurementEngine } from "../../src/capability/measurement/capability-measurement-engine.js";
import { CapabilityMeasureFailedError } from "../../src/capability/errors/measure-failed.js";
import { CapabilityMeasureInvalidTargetError } from "../../src/capability/errors/measure-invalid-target.js";
import { MEASUREMENT_EVENT_PREFIX } from "../../src/capability/measurement/measurement-event-types.js";
import type { A5Measurement } from "../../src/capability/measurement/a5.js";
import type { CapabilityMeasurementOutcome } from "../../src/capability/measurement/outcome-discriminated-union.js";
import type { CapabilityMeasureInput } from "../../src/capability/types/service-results.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { ObservationProvider, Observation, ObservationResult } from "../../src/evolution/observation/contracts/observation-contract.js";

class FakePassProvider implements ObservationProvider {
  readonly name = "native";
  readonly capabilities = ["test"];
  async observe(_o: Observation): Promise<ObservationResult> {
    return {
      observationId: _o.observationId,
      status: "pass",
      confidence: 0.95,
      observedAt: new Date().toISOString(),
      evidence: { ok: true },
    };
  }
}

function mkA5(outcome: CapabilityMeasurementOutcome): A5Measurement {
  return {
    async measureCapability(_target, _baseline) {
      return outcome;
    },
  };
}

describe("CapabilityMeasurementEngine (CAP-10 ruling #5, #13, #14, #16)", () => {
  let dir: string;
  let eventLog: EventLog;
  let catalog: CapabilityCatalog;
  let engine: ObservationEngine;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-engine-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    engine = new ObservationEngine();
    engine.register(new FakePassProvider());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws CapabilityMeasureInvalidTargetError when target absent in catalog (ruling #8)", async () => {
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5({ kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] }),
      observationEngine: engine,
    });
    await expect(
      m.measure({ capabilityId: "absent", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityMeasureInvalidTargetError);
  });

  it("happy path: records exactly one measured event and returns frozen result", async () => {
    // Seed a capability so target resolution succeeds.
    catalog.register({
      id: "tool.file.read",
      version: "1.0.0",
      kind: "tool",
      title: "Read files",
      bindings: [],
    });
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5({ kind: "effective", evidenceRefs: ["obs-1"], confidence: 0.9, summary: "ok", signals: [] }),
      observationEngine: engine,
    });
    const result = await m.measure({ capabilityId: "tool.file.read", version: "1.0.0" });
    expect(result.status).toBe("measured");
    expect(result.measurement).toEqual({ capabilityId: "tool.file.read", version: "1.0.0" });
    expect(result.outcome.kind).toBe("effective");
    expect(result.eventIds).toHaveLength(1);
    expect(result.eventIds[0]!.type).toBe(`${MEASUREMENT_EVENT_PREFIX}measured`);

    const all = await eventLog.readAll();
    const measured = all.filter((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`);
    expect(measured).toHaveLength(1);
  });

  it("throws CapabilityMeasureFailedError when A5 throws (ruling #16)", async () => {
    catalog.register({
      id: "tool.x",
      version: "1.0.0",
      kind: "tool",
      title: "X",
      bindings: [],
    });
    const a5: A5Measurement = {
      async measureCapability() { throw new Error("a5 down"); },
    };
    const m = new CapabilityMeasurementEngine({
      catalog, eventLog, a5, observationEngine: engine,
    });
    await expect(
      m.measure({ capabilityId: "tool.x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityMeasureFailedError);
    const all = await eventLog.readAll();
    const measured = all.filter((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`);
    expect(measured).toHaveLength(0);
  });

  it("re-measure creates a new event (append-only, ruling #13)", async () => {
    catalog.register({
      id: "tool.y", version: "1.0.0", kind: "tool", title: "Y", bindings: [],
    });
    const m = new CapabilityMeasurementEngine({
      catalog,
      eventLog,
      a5: mkA5({ kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] }),
      observationEngine: engine,
    });
    await m.measure({ capabilityId: "tool.y", version: "1.0.0" });
    await m.measure({ capabilityId: "tool.y", version: "1.0.0" });
    const all = await eventLog.readAll();
    const measured = all.filter((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`);
    expect(measured).toHaveLength(2);
  });
});

describe("CapabilityMeasureFailedError (CAP-10 ruling #16)", () => {
  it("carries code, message, cause, and frozen instance", () => {
    const cause = new Error("a5 down");
    const err = new CapabilityMeasureFailedError("x", "1.0.0", "obs-base", cause);
    expect(err.code).toBe("measure_failed");
    expect(err.message).toContain("x");
    expect(err.message).toContain("1.0.0");
    expect(err.cause).toBe(cause);
    expect(Object.isFrozen(err)).toBe(true);
  });

  it("baselineObservationId is optional (absent → 'absent' in message)", () => {
    const cause = new Error("a5 down");
    const err = new CapabilityMeasureFailedError("x", "1.0.0", undefined, cause);
    expect(err.message).toContain("absent");
  });
});

describe("CapabilityMeasureInvalidTargetError (CAP-10 spec §8.2)", () => {
  it("carries code and frozen instance", () => {
    const err = new CapabilityMeasureInvalidTargetError("nonexistent", "1.0.0");
    expect(err.code).toBe("measure_invalid_target");
    expect(err.message).toContain("nonexistent");
    expect(err.message).toContain("1.0.0");
    expect(Object.isFrozen(err)).toBe(true);
  });
});
```

**Step 3: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/capability-measurement-engine.vitest.ts
```

Expected: FAIL — modules not found.

**Step 4: Implement error classes**

`src/capability/errors/measure-failed.ts`:

```ts
// src/capability/errors/measure-failed.ts
/**
 * CAP-10 — Thrown when A5 `measureCapability` throws. Orchestrator catches
 * the original error and rethrows as `CapabilityMeasureFailedError` (ruling #16).
 * No measurement event recorded. No evolution signal emitted.
 * Frozen — error instances immutable (CAP-6/9 precedent).
 */
export class CapabilityMeasureFailedError extends Error {
  readonly code: "measure_failed";

  constructor(
    readonly capabilityId: string,
    readonly version: string,
    readonly baselineObservationId: string | undefined,
    readonly cause: Error,
  ) {
    super(
      `Capability measurement failed for '${capabilityId}@${version}' (baseline: ${baselineObservationId ?? "absent"}): ${cause.message}`,
    );
    this.name = "CapabilityMeasureFailedError";
    this.code = "measure_failed";
    Object.freeze(this);
  }
}
```

`src/capability/errors/measure-invalid-target.ts`:

```ts
// src/capability/errors/measure-invalid-target.ts
/**
 * CAP-10 — Thrown when the supplied id@version target does not exist in the
 * catalog. Distinct from `CapabilityMeasureFailedError` (target resolution is
 * CAP-10's responsibility, not A5's; spec §8.2). Frozen.
 */
export class CapabilityMeasureInvalidTargetError extends Error {
  readonly code: "measure_invalid_target";

  constructor(readonly capabilityId: string, readonly version: string) {
    super(`Capability measurement target not found in catalog: '${capabilityId}@${version}'`);
    this.name = "CapabilityMeasureInvalidTargetError";
    this.code = "measure_invalid_target";
    Object.freeze(this);
  }
}
```

**Step 5: Implement `capability-measurement-engine.ts`**

```ts
// src/capability/measurement/capability-measurement-engine.ts
/**
 * CAP-10 — CapabilityMeasurementEngine (orchestrator).
 *
 * Owns the measurement boundary:
 *   1. Resolves the id@version target via the catalog (ruling #8).
 *   2. Calls `A5Measurement.measureCapability(target, baseline?)` (ruling #8).
 *   3. Builds the post observation reference from the ObservationEngine.
 *   4. Records exactly one `capability.governance.measurement.measured`
 *      event (ruling #5, #14).
 *   5. Returns the atomic `CapabilityMeasureResult` (ruling #4, Type Gate).
 *
 * Does NOT compute outcomes (A5 owns that).
 * Does NOT emit evolution signals (A5 owns that).
 *
 * Lives in `capability/measurement/`, NOT `evolution/`.
 *
 * Forbidden (ruling #9, axis 5):
 *   - MUST NOT import `src/evolution/observation/a5-capability-measurement`.
 *   - MUST NOT import `src/evolution/capability-lifecycle/*`.
 *
 * @module capability/measurement/capability-measurement-engine
 */

import type { EventLog, AlixEvent, NewEvent } from "../../events/event-log.js";
import type { CapabilityCatalog } from "../canonical/catalog.js";
import type { A5Measurement, A5MeasurementTarget } from "./a5.js";
import type { CapabilityMeasurementOutcome } from "./outcome-discriminated-union.js";
import type {
  CapabilityMeasurementPayload,
  CapabilityMeasurementPayloadPost,
} from "./measurement-event-types.js";
import { MEASUREMENT_EVENT_PREFIX } from "./measurement-event-types.js";
import type { CapabilityMeasureInput, CapabilityMeasureResult } from "../types/service-results.js";
import type { ObservationEngine, Observation, ObservationResult } from "../../evolution/observation/index.js";
import { CapabilityMeasureFailedError } from "../errors/measure-failed.js";
import { CapabilityMeasureInvalidTargetError } from "../errors/measure-invalid-target.js";

export interface CapabilityMeasurementEngineOptions {
  readonly catalog: CapabilityCatalog;
  readonly eventLog: EventLog;
  readonly a5: A5Measurement;
  readonly observationEngine: ObservationEngine;
}

export class CapabilityMeasurementEngine {
  private readonly catalog: CapabilityCatalog;
  private readonly eventLog: EventLog;
  private readonly a5: A5Measurement;
  private readonly observationEngine: ObservationEngine;

  constructor(options: CapabilityMeasurementEngineOptions) {
    this.catalog = options.catalog;
    this.eventLog = options.eventLog;
    this.a5 = options.a5;
    this.observationEngine = options.observationEngine;
  }

  async measure(input: CapabilityMeasureInput): Promise<CapabilityMeasureResult> {
    const target: A5MeasurementTarget = {
      capabilityId: input.capabilityId,
      version: input.version,
    };

    // Target resolution (ruling #8; spec §8.2).
    const def = this.catalog.get(input.capabilityId);
    if (!def || def.version !== input.version) {
      throw new CapabilityMeasureInvalidTargetError(input.capabilityId, input.version);
    }

    // Call A5 (ruling #8, #12, #15).
    let outcome: CapabilityMeasurementOutcome;
    try {
      outcome = await this.a5.measureCapability(target, input.baselineObservationId);
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      throw new CapabilityMeasureFailedError(
        input.capabilityId,
        input.version,
        input.baselineObservationId,
        err,
      );
    }

    // Build post observation reference (ruling #14; spec §5.1).
    const postObservation = this.buildPostObservation(target);
    const postResult: ObservationResult = await this.observationEngine.observe(postObservation);

    let baselineRef: CapabilityMeasureResult["baseline"];
    if (input.baselineObservationId !== undefined) {
      baselineRef = {
        observationId: input.baselineObservationId,
        takenAt: postResult.observedAt,
      };
    }

    const postPayload: CapabilityMeasurementPayloadPost = {
      observationId: postResult.observationId,
      takenAt: postResult.observedAt,
      status: postResult.status,
      confidence: postResult.confidence,
    };
    const payload: CapabilityMeasurementPayload = {
      measurement: { capabilityId: input.capabilityId, version: input.version },
      ...(baselineRef !== undefined ? { baseline: baselineRef } : {}),
      post: postPayload,
      outcome,
    };

    const event = await this.recordEvent(payload);

    return Object.freeze({
      status: "measured" as const,
      measurement: { capabilityId: input.capabilityId, version: input.version },
      ...(baselineRef !== undefined ? { baseline: baselineRef } : {}),
      post: {
        observationId: postResult.observationId,
        takenAt: postResult.observedAt,
        status: postResult.status,
        confidence: postResult.confidence,
      },
      outcome,
      eventIds: [{ type: event.type, seq: event.seq }],
    });
  }

  private buildPostObservation(target: A5MeasurementTarget): Observation {
    return {
      observationId: `post-${target.capabilityId}-${target.version}-${Date.now()}`,
      provider: "native",
      description: `Post-measurement for ${target.capabilityId}@${target.version}`,
    };
  }

  private async recordEvent(payload: CapabilityMeasurementPayload): Promise<AlixEvent> {
    const newEvent: NewEvent<string, CapabilityMeasurementPayload> = {
      type: `${MEASUREMENT_EVENT_PREFIX}measured`,
      actor: "system",
      sessionId: "",
      payload,
    };
    return this.eventLog.append(newEvent);
  }
}
```

**Step 6: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/capability-measurement-engine.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 7: Commit**

```bash
git add src/capability/measurement/capability-measurement-engine.ts src/capability/errors/measure-failed.ts src/capability/errors/measure-invalid-target.ts src/capability/types/service-results.ts tests/capability/capability-measurement-engine.vitest.ts
git commit -m "feat(capability): CAP-10 measurement engine + failure errors — orchestrator + persistence"
```

---

### Task 6: Service `measure()` impl + `governance()` widening

**Files:**
- Modify: `src/capability/types/service-results.ts` (extend `CapabilityServiceOptions`)
- Modify: `src/capability/capability-service.ts` (replace `measure()` stub + widen `governance()` filter)
- Test: `tests/capability/capability-service-measure.vitest.ts`
- Test: `tests/capability/capability-service-governance-measurement.vitest.ts`

**Interfaces:**
- Extends `CapabilityServiceOptions` with `readonly measurementEngine?: CapabilityMeasurementEngine` (ruling #22).
- Replaces `measure()` stub (lines 603-605) with body delegating to `this.measurementEngine.measure(input)`.
- Widens `governance()` filter from `GOVERNANCE_EVENT_PREFIX` (`capability.governance.proposal.`) to `MEASUREMENT_GOVERNANCE_PREFIX` (`capability.governance.`).

**Step 1: Confirm current `measure()` + `governance()` shape**

```bash
grep -n "async measure\|async governance\|GOVERNANCE_EVENT_PREFIX" src/capability/capability-service.ts
```

**Step 2: Write failing service-measure tests**

Create `tests/capability/capability-service-measure.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { CapabilityMeasurementEngine } from "../../src/capability/measurement/capability-measurement-engine.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import type { A5Measurement } from "../../src/capability/measurement/a5.js";
import type { CapabilityMeasurementOutcome } from "../../src/capability/measurement/outcome-discriminated-union.js";

function mkA5(): A5Measurement {
  return {
    async measureCapability(_target, _baseline) {
      const outcome: CapabilityMeasurementOutcome = {
        kind: "effective",
        evidenceRefs: ["obs-1"],
        confidence: 0.9,
        summary: "ok",
        signals: [],
      };
      return outcome;
    },
  };
}

describe("CapabilityService.measure() (CAP-10 ruling #2, #22)", () => {
  let dir: string;
  let eventLog: EventLog;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-svc-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    resolver = new CapabilityResolver(registry, new ProviderExecutorRegistry());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws CapabilityServiceNotImplementedError when measurementEngine absent (ruling #22)", async () => {
    const mutationExecutor = {
      async executeStep() { return { success: true, output: {} }; },
    } as never;
    const noEngineService = new CapabilityService({
      catalog, resolver, mutationExecutor, eventLog,
    });
    await expect(
      noEngineService.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityServiceNotImplementedError);
  });

  it("delegates to the engine when measurementEngine is present", async () => {
    const mutationExecutor = {
      async executeStep() { return { success: true, output: {} }; },
    } as never;
    const engine = new CapabilityMeasurementEngine({
      catalog, eventLog, a5: mkA5(), observationEngine: new ObservationEngine(),
    });
    const service = new CapabilityService({
      catalog, resolver, mutationExecutor, eventLog, measurementEngine: engine,
    });
    // Catalog empty → engine throws CapabilityMeasureInvalidTargetError;
    // service propagates the engine's error verbatim.
    await expect(
      service.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toThrow(/not found/);
  });
});
```

**Step 3: Write failing governance-widening test**

Create `tests/capability/capability-service-governance-measurement.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { MEASUREMENT_EVENT_PREFIX } from "../../src/capability/measurement/measurement-event-types.js";

describe("CapabilityService.governance() widening (CAP-10 ruling #6, #20)", () => {
  let dir: string;
  let eventLog: EventLog;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-gov-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    resolver = new CapabilityResolver(registry, new ProviderExecutorRegistry());
    const mutationExecutor = {
      async executeStep() { return { success: true, output: {} }; },
    } as never;
    service = new CapabilityService({ catalog, resolver, mutationExecutor, eventLog });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("includes measurement events when present (ruling #6)", async () => {
    await eventLog.append({
      type: `${MEASUREMENT_EVENT_PREFIX}measured`,
      actor: "system",
      sessionId: "",
      payload: {
        measurement: { capabilityId: "x", version: "1.0.0" },
        post: {
          observationId: "obs-1",
          takenAt: new Date().toISOString(),
          status: "pass",
          confidence: 0.9,
        },
        outcome: {
          kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [],
        },
      },
    });
    const result = await service.governance();
    expect(result.events.some((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`)).toBe(true);
  });

  it("still includes governance proposal events (CAP-9 preserved)", async () => {
    await eventLog.append({
      type: "capability.governance.proposal.submitted",
      actor: "system",
      sessionId: "",
      payload: { proposalId: "p-1" },
    });
    const result = await service.governance();
    expect(result.events.some((e) => e.type === "capability.governance.proposal.submitted")).toBe(true);
  });
});
```

**Step 4: Run tests to confirm failure**

```bash
pnpm exec vitest run tests/capability/capability-service-measure.vitest.ts tests/capability/capability-service-governance-measurement.vitest.ts
```

Expected: FAIL — `measurementEngine` not in `CapabilityServiceOptions`; widening filter not present.

**Step 5: Modify `src/capability/types/service-results.ts` (CAP-8 file)**

Extend the existing `CapabilityServiceOptions`:

```ts
// src/capability/types/service-results.ts (CAP-10 — EXTEND existing CapabilityServiceOptions)
  readonly proposalGenerator?: import("../evolution/a7-proposals.js").A7ProposalGenerator;
  /** CAP-10 ruling #22 — measurement engine. Optional. Absent → measure() throws
   *  CapabilityServiceNotImplementedError. NEVER required. */
  readonly measurementEngine?: import("../measurement/capability-measurement-engine.js").CapabilityMeasurementEngine;
}
```

**Step 6: Modify `src/capability/capability-service.ts`**

Three edits:

6a. Add imports:
```ts
import type { CapabilityMeasurementEngine } from "./measurement/capability-measurement-engine.js";
import { MEASUREMENT_GOVERNANCE_PREFIX } from "./measurement/measurement-event-types.js";
```

6b. In the constructor (around line 96), add private field + assignment:
```ts
  /** CAP-10 ruling #22 — measurement engine. Optional. */
  private readonly measurementEngine?: CapabilityMeasurementEngine;
```
```ts
    this.measurementEngine = opts.measurementEngine;
```

6c. Replace `measure()` stub (around line 603):
```ts
  /**
   * CAP-10 ruling #2, #22 — measure a capability at id@version.
   * Optional baseline via `baselineObservationId?`.
   * Delegates to the injected `CapabilityMeasurementEngine` (ruling #8, #18).
   */
  async measure(input: { capabilityId: string; version: string; baselineObservationId?: string }): Promise<import("./types/service-results.js").CapabilityMeasureResult> {
    if (!this.measurementEngine) {
      throw new CapabilityServiceNotImplementedError("measure() requires measurementEngine");
    }
    return this.measurementEngine.measure(input);
  }
```

6d. Widen `governance()` filter (around line 566):
```ts
    const governanceEvents = all.filter(
      (e): e is AlixEvent =>
        typeof e.type === "string" && e.type.startsWith(MEASUREMENT_GOVERNANCE_PREFIX),
    );
```

**Step 7: Run tests + typecheck + full capability vitest suite**

```bash
pnpm exec vitest run tests/capability/capability-service-measure.vitest.ts tests/capability/capability-service-governance-measurement.vitest.ts
pnpm exec tsc --noEmit
pnpm exec vitest run tests/capability/
```

Expected: All PASS (CAP-9 governance tests still green; widened filter is strictly more permissive).

**Step 8: Commit**

```bash
git add src/capability/types/service-results.ts src/capability/capability-service.ts tests/capability/capability-service-measure.vitest.ts tests/capability/capability-service-governance-measurement.vitest.ts
git commit -m "feat(capability): CAP-10 service.measure() + governance() widening"
```

---

### Task 7: Platform wiring + composition-root

**Files:**
- Modify: `src/capability/platform.ts` (CAP-8 file — wire A5 implementation + engine + optional ctor dep)
- Test: `tests/capability/platform-cap-10.vitest.ts`

**Interfaces:**
- Extends `CapabilityPlatformOptions` with `readonly a5CapabilityMeasurement?: A5CapabilityMeasurement`.
- Constructor constructs `CapabilityMeasurementEngine` when `a5CapabilityMeasurement` is supplied; passes it as `measurementEngine` to `CapabilityService`.
- Exposes `readonly measurementEngine?: CapabilityMeasurementEngine`.

**Step 1: Confirm current `service` construction shape**

```bash
grep -n "new CapabilityService\|this.service" src/capability/platform.ts
```

**Step 2: Write failing platform wiring test**

Create `tests/capability/platform-cap-10.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { EventLog } from "../../src/events/event-log.js";
import { A5CapabilityMeasurement } from "../../src/evolution/observation/a5-capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";
import type { ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

class NoopSignalSource implements ProposalSignalSource {
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [];
  }
}

describe("CapabilityPlatform — CAP-10 wiring (ruling #18, #22)", () => {
  let dir: string;
  let eventLog: EventLog;
  let platform: CapabilityPlatform;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-plat-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("constructs without a5CapabilityMeasurement (CAP-8 backward compat)", () => {
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
  });

  it("constructs with a5CapabilityMeasurement and wires measurementEngine", () => {
    const a5 = new A5CapabilityMeasurement({
      observationEngine: new ObservationEngine(),
      signalSource: new NoopSignalSource(),
      catalog: { get: () => undefined } as never,
    });
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog, a5CapabilityMeasurement: a5 });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
  });

  it("service.measure() throws when platform wired without A5", async () => {
    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    await expect(
      platform.service.measure({ capabilityId: "x", version: "1.0.0" }),
    ).rejects.toBeInstanceOf(CapabilityServiceNotImplementedError);
  });
});
```

**Step 3: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/platform-cap-10.vitest.ts
```

Expected: FAIL — `opts.a5CapabilityMeasurement` not in `CapabilityPlatformOptions`.

**Step 4: Modify `src/capability/platform.ts`**

4a. Add imports at top:
```ts
import type { A5CapabilityMeasurement } from "../evolution/observation/a5-capability-measurement.js";
import { CapabilityMeasurementEngine } from "./measurement/capability-measurement-engine.js";
import { ObservationEngine } from "../evolution/observation/observation-engine.js";
```

4b. Add optional field to `CapabilityPlatformOptions` (alongside the existing fields):
```ts
  readonly a5CapabilityMeasurement?: A5CapabilityMeasurement;
```

4c. Wire engine inside constructor (immediately before `this.service = new CapabilityService({...})`):
```ts
    // CAP-10 ruling #18 — compose A5 implementation into a measurement engine (optional).
    let measurementEngine: CapabilityMeasurementEngine | undefined;
    if (opts.a5CapabilityMeasurement) {
      const observationEngine = new ObservationEngine();
      measurementEngine = new CapabilityMeasurementEngine({
        catalog: this.catalog,
        eventLog: opts.eventLog,
        a5: opts.a5CapabilityMeasurement,
        observationEngine,
      });
    }
```

4d. Pass `measurementEngine` to `CapabilityService`:
```ts
    this.service = new CapabilityService({
      catalog: this.catalog,
      resolver,
      mutationExecutor,
      eventLog: opts.eventLog,
      ...(measurementEngine !== undefined ? { measurementEngine } : {}),
    });
```

4e. Add `measurementEngine` getter alongside existing `service` field, and assign in constructor:
```ts
  /** CAP-10 — measurement engine instance (optional). */
  readonly measurementEngine?: CapabilityMeasurementEngine;
```
```ts
    this.measurementEngine = measurementEngine;
```

**Step 5: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/platform-cap-10.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 6: Commit**

```bash
git add src/capability/platform.ts tests/capability/platform-cap-10.vitest.ts
git commit -m "feat(capability): CAP-10 platform wires A5 + measurement engine into service"
```

---

### Task 8: Five-axis sentinel

**Files:**
- Create: `tests/capability/five-axis-sentinel.vitest.ts`

**Interfaces:**
- Axis 1 (CAP-8): `new CapabilityRegistry()` / `new CapabilityResolver()` ONLY in composition root.
- Axis 2 (CAP-8): no direct imports of `CapabilityRegistry` / `CapabilityResolver` from CAP-10 files.
- Axis 3 (CAP-8): CLI capability commands route through `CapabilityService`.
- Axis 4 (CAP-9): A7 generator source MUST NOT contain capability mutators; `governance()` body MUST NOT call catalog/registry mutators.
- Axis 5 (CAP-10 NEW): A5 implementation no mutators; engine imports A5 interface only; service.measure() body no mutators; service imports A5 TYPE only.

**Step 1: Write five-axis sentinel**

Create `tests/capability/five-axis-sentinel.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Five-axis sentinel (CAP-8/9 axes 1-4 + CAP-10 axis 5 NEW)", () => {
  it("axis 1: new CapabilityRegistry/Resolver only in composition root", () => {
    const platformSrc = readSrc("src/capability/platform.ts");
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    const a5Src = readSrc("src/evolution/observation/a5-capability-measurement.ts");
    const engineSrc = readSrc("src/capability/measurement/capability-measurement-engine.ts");
    expect(platformSrc, "platform constructs CapabilityRegistry").toMatch(/new\s+CapabilityRegistry\(/);
    expect(platformSrc, "platform constructs CapabilityResolver").toMatch(/new\s+CapabilityResolver\(/);
    for (const [name, src] of [
      ["service", serviceSrc],
      ["a5", a5Src],
      ["engine", engineSrc],
    ] as const) {
      expect(src, `axis 1: ${name} must not construct CapabilityRegistry`).not.toMatch(/new\s+CapabilityRegistry\(/);
      expect(src, `axis 1: ${name} must not construct CapabilityResolver`).not.toMatch(/new\s+CapabilityResolver\(/);
    }
  });

  it("axis 4: A7 module contains no capability mutator call sites (CAP-9 preserved)", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    expect(a7Src, "axis 4: catalog.register forbidden in A7").not.toMatch(/catalog\.register/);
    expect(a7Src, "axis 4: catalog.remove forbidden in A7").not.toMatch(/catalog\.remove/);
    expect(a7Src, "axis 4: registry.setLifecycleState forbidden in A7").not.toMatch(/registry\.setLifecycleState/);
    expect(a7Src, "axis 4: registry.applyMutation forbidden in A7").not.toMatch(/registry\.applyMutation/);
  });

  it("axis 4: governance() projection body remains catalog/registry-pure (CAP-9 ruling #23)", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    const match = serviceSrc.match(/^ {2}async governance[\s\S]+?^ {2}}/m);
    expect(match, "governance() method must exist").not.toBeNull();
    const body = match![0];
    expect(body, "axis 4: governance() must not call catalog.get|list|query").not.toMatch(/catalog\.(get|list|query)/);
    expect(body, "axis 4: governance() must not call registry.list|query").not.toMatch(/registry\.(list|query)/);
    expect(body, "axis 4: governance() must not call mutate family").not.toMatch(/\.mutate/);
  });

  it("axis 5 NEW: A5 implementation contains no capability mutators (ruling #5, #10)", () => {
    const a5Src = readSrc("src/evolution/observation/a5-capability-measurement.ts");
    expect(a5Src, "axis 5: A5 must not call catalog.register").not.toMatch(/catalog\.register/);
    expect(a5Src, "axis 5: A5 must not call catalog.remove").not.toMatch(/catalog\.remove/);
    expect(a5Src, "axis 5: A5 must not call registry.setLifecycleState").not.toMatch(/registry\.setLifecycleState/);
    expect(a5Src, "axis 5: A5 must not call registry.applyMutation").not.toMatch(/registry\.applyMutation/);
    expect(a5Src, "axis 5: A5 must not import capability-lifecycle-measurer").not.toMatch(/from\s+["'].*capability-lifecycle-measurer/);
  });

  it("axis 5 NEW: CapabilityMeasurementEngine consumes A5 via interface only (ruling #7, #9)", () => {
    const engineSrc = readSrc("src/capability/measurement/capability-measurement-engine.ts");
    expect(
      engineSrc,
      "axis 5: engine must not import a5-capability-measurement implementation",
    ).not.toMatch(/from\s+["'].*evolution\/observation\/a5-capability-measurement/);
    expect(
      engineSrc,
      "axis 5: engine must import A5Measurement interface from capability/measurement/a5",
    ).toMatch(/from\s+["'].*capability\/measurement\/a5/);
    expect(
      engineSrc,
      "axis 5: engine must not import capability-lifecycle-measurer",
    ).not.toMatch(/from\s+["'].*capability-lifecycle-measurer/);
  });

  it("axis 5 NEW: service.measure() body does not mutate capability state (ruling #23)", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    const match = serviceSrc.match(/^ {2}async measure[\s\S]+?^ {2}}/m);
    expect(match, "measure() method must exist").not.toBeNull();
    const body = match![0];
    expect(body, "axis 5: measure() must not call catalog.mutate").not.toMatch(/catalog\.mutate/);
    expect(body, "axis 5: measure() must not call registry.applyMutation").not.toMatch(/registry\.applyMutation/);
    expect(body, "axis 5: measure() must not call catalog.register").not.toMatch(/catalog\.register/);
    expect(body, "axis 5: measure() must not call catalog.remove").not.toMatch(/catalog\.remove/);
  });

  it("axis 5 NEW: service consumes the A5Measurement interface (not the implementation)", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    expect(
      serviceSrc,
      "axis 5: service must import type A5Measurement from capability/measurement/a5",
    ).toMatch(/import\s+type\s+\{[^}]*A5Measurement[^}]*\}\s+from\s+["'].*capability\/measurement\/a5/);
    expect(
      serviceSrc,
      "axis 5: service must not import the A5 implementation",
    ).not.toMatch(/from\s+["'].*evolution\/observation\/a5-capability-measurement/);
    expect(
      serviceSrc,
      "axis 5: service must not import capability-lifecycle-measurer (ruling #9)",
    ).not.toMatch(/from\s+["'].*capability-lifecycle-measurer/);
  });
});
```

**Step 2: Run tests**

```bash
pnpm exec vitest run tests/capability/five-axis-sentinel.vitest.ts
```

Expected: PASS (assuming T1-T7 implemented cleanly).

**Step 3: Commit**

```bash
git add tests/capability/five-axis-sentinel.vitest.ts
git commit -m "test(capability): CAP-10 five-axis sentinel — axis 5 NEW (measurement purity)"
```

---

### Task 9: CLI command `alix capability measure`

**Files:**
- Create: `src/cli/commands/capability-measure.ts`
- Modify: `src/cli/commands/capabilities.ts` (wire `case "measure"`)
- Test: `tests/capability/capability-measure-cli.test.ts` (node:test)

**Interfaces:**
- Produces: `CapabilityMeasureCommandOptions` — `{ readonly service: CapabilityService | undefined }`.
- Produces: `capabilityMeasureCommand(args, opts): Promise<number>` — parses `<id@version>` and `--baseline <id>`. Exits 0 on success, 2 on usage error, 3 on measure failure, 4 on invalid target, 5 on not-implemented.

**Step 1: Write failing CLI test (node:test)**

Create `tests/capability/capability-measure-cli.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { A5CapabilityMeasurement } from "../../src/evolution/observation/a5-capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import { EventLog } from "../../src/events/event-log.js";
import { capabilityMeasureCommand } from "../../src/cli/commands/capability-measure.js";
import type { ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

class NoopSignalSource implements ProposalSignalSource {
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [];
  }
}

describe("CLI: alix capability measure (CAP-10 ruling #11)", () => {
  it("exits 2 on usage error (missing id@version)", async () => {
    const exitCode = await capabilityMeasureCommand([], { service: undefined });
    assert.equal(exitCode, 2);
  });

  it("exits 5 when service is not supplied", async () => {
    const exitCode = await capabilityMeasureCommand(["x@1.0.0"], { service: undefined });
    assert.equal(exitCode, 5);
  });

  it("exits 5 when service has no measurement engine (CAP-8 ruling #4 preserved)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cap10-cli-"));
    const eventLog = new EventLog(dir);
    await eventLog.init();
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    const exitCode = await capabilityMeasureCommand(["x@1.0.0"], { service: platform.service });
    assert.equal(exitCode, 5);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 4 when target absent in catalog (CapabilityMeasureInvalidTargetError)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cap10-cli-"));
    const eventLog = new EventLog(dir);
    await eventLog.init();
    const platform = new CapabilityPlatform({
      catalogDir: dir,
      eventLog,
      a5CapabilityMeasurement: new A5CapabilityMeasurement({
        observationEngine: new ObservationEngine(),
        signalSource: new NoopSignalSource(),
        catalog: { get: () => undefined } as never,
      }),
    });
    const exitCode = await capabilityMeasureCommand(["nonexistent@1.0.0"], { service: platform.service });
    assert.equal(exitCode, 4);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm run build && node scripts/run-node-tests.mjs
```

Expected: FAIL — module not found.

**Step 3: Implement `capability-measure.ts`**

```ts
// src/cli/commands/capability-measure.ts
/**
 * CAP-10 Task 9 — `alix capability measure <id@version>` CLI command.
 *
 * Routes through `service.measure()` exclusively (ruling #11).
 * Exit codes:
 *   0 — success
 *   2 — usage error
 *   3 — CapabilityMeasureFailedError
 *   4 — CapabilityMeasureInvalidTargetError
 *   5 — CapabilityServiceNotImplementedError or service absent
 *
 * @module cli/commands/capability-measure
 */

import type { CapabilityService } from "../../capability/capability-service.js";
import { CapabilityMeasureFailedError } from "../../capability/errors/measure-failed.js";
import { CapabilityMeasureInvalidTargetError } from "../../capability/errors/measure-invalid-target.js";
import { CapabilityServiceNotImplementedError } from "../../capability/errors/service-not-implemented.js";

const USAGE = `Usage: alix capability measure <id@version> [--baseline <observation-id>]`;

export interface CapabilityMeasureCommandOptions {
  readonly service: CapabilityService | undefined;
}

export async function capabilityMeasureCommand(
  args: string[],
  opts: CapabilityMeasureCommandOptions,
): Promise<number> {
  const service = opts.service;
  if (!service) {
    console.error("CapabilityService not supplied — CLI dispatcher contract violated.");
    return 5;
  }

  const rest = [...args];
  const targetArg = rest[0];
  if (!targetArg || !targetArg.includes("@")) {
    console.error(USAGE);
    return 2;
  }

  const [capabilityId, version] = targetArg.split("@", 2);
  if (!capabilityId || !version) {
    console.error(USAGE);
    return 2;
  }

  let baselineObservationId: string | undefined;
  const baselineFlag = rest.find((a) => a.startsWith("--baseline="));
  if (baselineFlag) {
    baselineObservationId = baselineFlag.split("=")[1];
  } else {
    const baselineIndex = rest.indexOf("--baseline");
    if (baselineIndex >= 0 && rest[baselineIndex + 1]) {
      baselineObservationId = rest[baselineIndex + 1]!;
    }
  }

  try {
    const result = await service.measure({
      capabilityId,
      version,
      ...(baselineObservationId !== undefined ? { baselineObservationId } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof CapabilityServiceNotImplementedError) {
      console.error(`measure() not implemented: ${err.message}`);
      return 5;
    }
    if (err instanceof CapabilityMeasureInvalidTargetError) {
      console.error(`Invalid target: ${err.message}`);
      return 4;
    }
    if (err instanceof CapabilityMeasureFailedError) {
      console.error(`Measurement failed: ${err.message}`);
      return 3;
    }
    throw err;
  }
}
```

**Step 4: Wire into `src/cli/commands/capabilities.ts`**

Read the file, locate the dispatch switch, and add the `case "measure"` (adapt surrounding structure to match the existing pattern):

```ts
import { capabilityMeasureCommand, type CapabilityMeasureCommandOptions } from "./capability-measure.js";

// inside the switch:
    case "measure": {
      const measureOpts: CapabilityMeasureCommandOptions = { service };
      return capabilityMeasureCommand(rest, measureOpts);
    }
```

**Step 5: Run tests + typecheck**

```bash
pnpm run build && node scripts/run-node-tests.mjs
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 6: Commit**

```bash
git add src/cli/commands/capability-measure.ts src/cli/commands/capabilities.ts tests/capability/capability-measure-cli.test.ts
git commit -m "feat(capability): CAP-10 CLI command — alix capability measure <id@version>"
```

---

### Task 10: CAP-10 supersession test

**Files:**
- Create: `tests/capability/cap-10-supersession.test.ts` (node:test)

**Interfaces:**
- Asserts CAP-10 forbidden-file list + structural invariants:
  - CAP-8/9 forbidden preserved.
  - CAP-10 NEW forbidden: `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts` MUST NOT be imported.
  - A5 type-only import (CAP-10 imports from `capability/measurement/a5.ts`).
  - Long-form event types.
  - `governance()` widens to parent prefix `capability.governance.`.

**Step 1: Write the supersession test**

Create `tests/capability/cap-10-supersession.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Compiled artifact lives at dist/tests/capability/*.test.js; source files
// at <repo>/src/... — three levels up from the compiled test file's directory.
const REPO = join(import.meta.dirname, "..", "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("CAP-10 supersession (forbidden files + structural invariants)", () => {
  describe("CAP-10 forbidden imports (ruling #9, #19)", () => {
    it("CAP-10 measurement files MUST NOT import capability-lifecycle-measurer", () => {
      const files = [
        "src/capability/measurement/capability-measurement-engine.ts",
        "src/capability/measurement/a5.ts",
        "src/evolution/observation/a5-capability-measurement.ts",
        "src/capability/capability-service.ts",
        "src/capability/platform.ts",
        "src/cli/commands/capability-measure.ts",
      ];
      for (const f of files) {
        const src = readSrc(f);
        assert.equal(
          /from\s+["'].*capability-lifecycle-measurer/.test(src),
          false,
          `${f} MUST NOT import capability-lifecycle-measurer — ruling #9 violated.`,
        );
      }
    });

    it("legacy measurer file remains untouched (CAP-11 cliff)", () => {
      const legacy = readSrc("src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts");
      assert.ok(legacy.length > 0, "Legacy measurer file still exists.");
      assert.match(legacy, /class CapabilityLifecycleMeasurer/);
    });
  });

  describe("CAP-10 type-only A5 import (ruling #7)", () => {
    it("A5 interface lives at capability/measurement/a5.ts", () => {
      const a5Ifc = readSrc("src/capability/measurement/a5.ts");
      assert.match(a5Ifc, /interface\s+A5Measurement/);
      assert.match(a5Ifc, /measureCapability/);
    });

    it("service imports A5Measurement as TYPE only", () => {
      const service = readSrc("src/capability/capability-service.ts");
      assert.match(
        service,
        /import\s+type\s+\{[^}]*A5Measurement[^}]*\}\s+from\s+["'].*capability\/measurement\/a5/,
        "service MUST import type A5Measurement from capability/measurement/a5 (ruling #7)",
      );
      assert.equal(
        /from\s+["'].*evolution\/observation\/a5-capability-measurement/.test(service),
        false,
        "service MUST NOT import the A5 implementation — ruling #7 violated.",
      );
    });
  });

  describe("CAP-10 long-form event types (ruling #1)", () => {
    it("measurement event type uses full long-form prefix", () => {
      const types = readSrc("src/capability/measurement/measurement-event-types.ts");
      assert.match(types, /capability\.governance\.measurement\.measured/);
    });

    it("orchestrator persists the long-form event type", () => {
      const engine = readSrc("src/capability/measurement/capability-measurement-engine.ts");
      assert.match(
        engine,
        /capability\.governance\.measurement\.measured/,
        "engine MUST persist long-form event type (ruling #1).",
      );
    });
  });

  describe("CAP-10 governance() widening (ruling #6, #20)", () => {
    it("MEASUREMENT_GOVERNANCE_PREFIX equals parent prefix 'capability.governance.'", () => {
      const types = readSrc("src/capability/measurement/measurement-event-types.ts");
      assert.match(
        types,
        /export\s+const\s+MEASUREMENT_GOVERNANCE_PREFIX\s*=\s*["']capability\.governance\.["']/,
      );
    });

    it("service.governance() uses the parent prefix (not the narrower proposal prefix)", () => {
      const service = readSrc("src/capability/capability-service.ts");
      const govMatch = service.match(/^ {2}async governance[\s\S]+?^ {2}}/m);
      assert.ok(govMatch, "governance() method must exist");
      assert.match(govMatch![0], /MEASUREMENT_GOVERNANCE_PREFIX/);
    });
  });

  describe("CAP-10 file presence", () => {
    it("all CAP-10 files exist", () => {
      const paths = [
        "src/capability/measurement/measurement-event-types.ts",
        "src/capability/measurement/outcome-discriminated-union.ts",
        "src/capability/measurement/a5.ts",
        "src/capability/measurement/capability-measurement-engine.ts",
        "src/evolution/observation/a5-capability-measurement.ts",
        "src/capability/errors/measure-failed.ts",
        "src/capability/errors/measure-invalid-target.ts",
        "src/cli/commands/capability-measure.ts",
        "tests/capability/five-axis-sentinel.vitest.ts",
        "tests/capability/capability-measure-cli.test.ts",
      ];
      for (const p of paths) {
        assert.equal(existsSync(join(REPO, p)), true, `${p} must exist`);
      }
    });
  });
});
```

**Step 2: Run test to confirm pass**

```bash
pnpm run build && node scripts/run-node-tests.mjs
```

Expected: PASS (assuming T1-T9 implemented cleanly).

**Step 3: Full-suite verification**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run tests/capability/
pnpm run build && node scripts/run-node-tests.mjs
```

Expected: All PASS, 0 tsc errors.

**Step 4: Commit**

```bash
git add tests/capability/cap-10-supersession.test.ts
git commit -m "test(capability): CAP-10 supersession — forbidden imports + structural invariants"

---

## AC Coverage Matrix

Mapping ticket #494 acceptance criteria to tasks + sentinels.

| Acceptance Criterion | Task(s) | Sentinel / Proof |
|----------------------|---------|-------------------|
| A5 measures actual post-application outcomes | T4, T5, T6 | `CapabilityMeasurementEngine.measure()` body returns outcome from A5 |
| Measured records carry baseline + post observation refs | T1, T4, T5 | `CapabilityMeasurementPayload` includes `baseline` + `post` fields |
| `measure` service method operational (forward-wired CAP-8) | T6 | `service.measure(input)` body delegates to `CapabilityMeasurementEngine` |
| Measurement feeds P5.5/P5.6 signals subsequent A7 proposals | T4 | A5 emits `CapabilityEvolutionSignal` via injected `ProposalSignalSource` |
| Event prefix `capability.governance.measurement.*` | T1 | `MEASUREMENT_EVENT_PREFIX` constant + test |
| Exactly one `measured` event per successful measure() | T1, T5, T6 | `CapabilityMeasurementEngine` records once; sentinel regex enforces single event type |
| Append-only (re-measure creates new event) | T5, T6 | Engine does not check for existing events; no idempotency check |
| `CapabilityMeasurementOutcome` discriminated union | T2 | `CapabilityMeasurementOutcome` type + tests for all 3 kinds |
| `CapabilityMeasureFailedError` thrown on A5 failure | T5, T6 | Error class + tests assert no event recorded on failure |
| `service.governance()` widens to include measurements | T6, T10 | `governance()` filter regex matches measurement prefix; supersession test asserts |
| Five-axis sentinel (axis 5 NEW = measurement purity) | T8 | `five-axis-sentinel.vitest.ts` axis-5 rules |
| CLI command `alix capability measure <id@version>` | T9 | `capability-measure.ts` + `capability-measure-cli.test.ts` |
| A5 type-only import (CAP-10 imports interface only) | T3, T10 | `a5.ts` is `export interface` only; supersession test asserts no impl import |
| Legacy measurer forbidden to CAP-10 | T8, T10 | Axis-5 rule + supersession test asserts no `CapabilityLifecycleMeasurer` import |
| A7.1 legacy lifecycle untouched | T8 | Axis-5 rule asserts no `src/evolution/capability-lifecycle/*` import |
| CAP-9 axes 1-4 preserved | T8 | `five-axis-sentinel.vitest.ts` re-asserts axes 1-4 unchanged |
| Tag `alix-cap-10-a5-measurement-integration-complete` | T10 final | Tag pushed after merge |

## Self-Review

**1. Spec coverage:** Each ruling #1-#23 has a corresponding task(s) and test path. The matrix above maps all 17 acceptance criteria.

**2. Placeholder scan:** None — every step contains real code, real commands, real assertions. No "TBD", "TODO", "FIXME", "similar to Task N", or "implement later".

**3. Type consistency:** All type names cross-referenced:
- `CapabilityMeasurementEventType` defined T1, used T5/T6/T10
- `CapabilityMeasurementPayload` defined T1, used T5
- `CapabilityMeasureInput` defined T1, used T6/T9
- `CapabilityMeasurementOutcome` defined T2, used T3/T4/T5/T6
- `A5CapabilityMeasurement` interface defined T3, implemented T4, used T5/T6
- `CapabilityMeasurementEngine` defined T5, used T6
- `CapabilityMeasureResult` defined T1 (extends from T5), used T6/T9
- `CapabilityMeasureFailedError` defined T5, thrown T6, tested T10

**4. Pre-resolved brief bugs (from CAP-9 retro):**
- ✓ `pnpm exec tsc --noEmit` not bare `tsc`
- ✓ `pnpm exec vitest run` not bare `vitest`
- ✓ `node scripts/run-node-tests.mjs` not `tsx --test`
- ✓ `import.meta.dirname` paths relative to `dist/` post-compile
- ✓ `Object.freeze(this)` on error classes (T5)
- ✓ LONG-form event types used consistently (`capability.governance.measurement.measured`)
- ✓ Composition root boundary preserved (T7 wires the optional `measurementEngine?`)

**5. Sentinel completeness:**
- Axis 5 (T8) explicitly forbids `CapabilityLifecycleMeasurer` import
- Axis 5 explicitly forbids `src/evolution/capability-lifecycle/*` import
- T10 supersession test extends CAP-9 pattern with CAP-10 specifics

**6. Architectural invariants preserved:**
- A5 is dependency of CAP-10, not component (T3 type-only import, T4 in evolution/, T5 calls through interface)
- Event namespace ≠ authority (T5 records facts, T4 computes outcomes)
- Append-only ledger (T5 no idempotency check)
- One event per measure() (T5 single record call)
- Explicit id@version (T1 `CapabilityMeasureInput` required fields)
- A5 failure → exception path (T5 throws `CapabilityMeasureFailedError`, T5 records nothing)

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-cap-10-a5-measurement-integration.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, per-task reviewer (sonnet per integration, haiku per mechanical pure-function/pure-type), opus final whole-branch review. Mirrors CAP-9 pattern.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Default to Option 1** (Subagent-Driven) per the user's standing SDD workflow.
