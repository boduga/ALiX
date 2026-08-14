# CAP-10.5 — M1 Evolution-Signal Emission Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the M1 evolution-signal emission seam that CAP-10 deferred: A5 publishes its produced signals through an explicit `ProposalSignalSink` after the measured event is committed; failures record `signals_unpublished` events with deterministic SHA-256 signal IDs.

**Architecture:** Outcome is canonical. Pipeline: `OutcomeDecider → final outcome.signals → measured event (commit) → ProposalSignalSink.publish (best-effort)`. Composition root owns one `ProposalSignalChannel` (sink + source in one object, private buffer, non-destructive reads). Failure events carry SHA-256 signal IDs sufficient for CAP-12 replay.

**Tech Stack:** TypeScript · Node `crypto.createHash` · `canonicalStringify` from `src/security/audit/canonical-json.ts` · append-only EventLog.

## Global Constraints

The spec's project-wide requirements — every task's requirements implicitly include this section.

- **Outcome is canonical.** A5 MUST NOT modify `outcome.signals` after the decider returns. The decider's returned `signals` are final.
- **Step 3 (measured event append) is the commit point.** Once appended, the measurement succeeded regardless of sink publish outcome.
- **Sink failure ≠ measurement failure.** A sink throw records `signals_unpublished` and returns the successful outcome.
- **No transient retry queue.** CAP-10.5 emits only `"sink_threw"` classification. `"sink_timeout"` is reserved in the schema for forward compat only.
- **Stable signal identity.** `signalId = sha256("alix-capability-signal-id-v1:" + canonicalStringify(signal))`. No `crypto.randomUUID()` for these IDs.
- **Idempotent reads.** `channel.signals()` is non-destructive — returns the same snapshot on repeated calls.
- **`ProposalSignalChannel` is in its own module** (`src/capability/evolution/proposal-signal-channel.ts`). NOT in `a7-proposals.ts`.
- **Buffer is private.** Tests verify via `channel.publish()` + `channel.signals()` — not buffer inspection.
- **Default decider policy:** `effective → []`, `ineffective → [underperformer(capabilityId@version, evidenceRefs, confidence)]`, `inconclusive → []`.
- **CAP-10 surface unchanged.** The CLI, service surface, projection shape, and measured event payload stay byte-equivalent for non-failure paths.
- **Forbidden files (NEVER touch):** `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, production `src/capability/canonical/*`, `src/capability/evolution/a7-proposals.ts` body beyond the additive `ProposalSignalSink` interface insertion (do NOT modify `A7ProposalGenerator` or `ProposalSignalSource`).
- **Pre-resolved bug conventions:** use `pnpm exec tsc --noEmit` (not bare `tsc`); use `.js` extensions on relative imports; `Object.freeze(this)` after all property assignments in constructors.

---

## Task 1: Add `ProposalSignalSink` interface to `a7-proposals.ts`

**Files:**
- Modify: `src/capability/evolution/a7-proposals.ts` — add `ProposalSignalSink` interface immediately after `ProposalSignalSource`
- Test: existing tests still pass (no new test file)

**Interfaces:**
- Consumes: nothing (pure addition)
- Produces: `ProposalSignalSink` exported alongside `ProposalSignalSource`. `A5CapabilityMeasurement` (Task 5) consumes it; `A7ProposalGenerator` continues consuming `ProposalSignalSource`.

- [ ] **Step 1: Read current `a7-proposals.ts` to confirm insertion point**

Open `src/capability/evolution/a7-proposals.ts`. Locate the existing `ProposalSignalSource` interface (around line 93). Note the line directly after its closing `}` — that's the insertion point.

- [ ] **Step 2: Add the `ProposalSignalSink` interface**

Insert immediately after `ProposalSignalSource`:

```typescript
/**
 * Write-side contract for evolution-signal delivery. A5 publishes
 * produced signals here; the composition-root-owned channel forwards
 * them to readers via `ProposalSignalSource`.
 *
 * CAP-10.5 (ruling #R1): sink is the sole write-side contract; the
 * outcome's signals array remains the authoritative representation.
 */
export interface ProposalSignalSink {
  publish(signal: CapabilityEvolutionSignal): Promise<void>;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0. The existing `CapabilityEvolutionSignal` type is in scope (same file); no imports needed.

- [ ] **Step 4: Run capability vitest to confirm zero regressions**

Run: `pnpm exec vitest run tests/capability/`
Expected: all green (no behavior change yet).

- [ ] **Step 5: Commit**

```bash
git add src/capability/evolution/a7-proposals.ts
git commit -m "feat(evolution): CAP-10.5 add ProposalSignalSink interface (write-side contract)"
```

---

## Task 2: Create `signal-identity.ts` helper

**Files:**
- Create: `src/capability/evolution/signal-identity.ts`
- Create: `tests/capability/signal-identity.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityEvolutionSignal` from `a7-proposals.js`; `canonicalStringify` from `../../security/audit/canonical-json.js`; `createHash` from `node:crypto`
- Produces: `computeSignalId(signal): string` (SHA-256 hex), `isValidSignalId(value): value is string` (64-hex-chars guard)

- [ ] **Step 1: Write the failing test**

Create `tests/capability/signal-identity.vitest.ts`:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  computeSignalId,
  isValidSignalId,
} from "../../src/capability/evolution/signal-identity.js";
import type { CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

describe("computeSignalId (CAP-10.5 ruling #R5)", () => {
  const underperformer: CapabilityEvolutionSignal = {
    kind: "underperformer",
    capabilityId: "cap-x@1.0.0",
    score: 0.4,
    evidenceIds: ["obs-1", "obs-2"],
  };

  it("is deterministic for the same signal body", () => {
    expect(computeSignalId(underperformer)).toBe(computeSignalId(underperformer));
  });

  it("is canonical-JSON order independent (key reordering → same id)", () => {
    const reordered: CapabilityEvolutionSignal = {
      score: 0.4,
      evidenceIds: ["obs-1", "obs-2"],
      capabilityId: "cap-x@1.0.0",
      kind: "underperformer",
    };
    expect(computeSignalId(reordered)).toBe(computeSignalId(underperformer));
  });

  it("produces a 64-char lowercase hex string", () => {
    expect(computeSignalId(underperformer)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across signal kinds", () => {
    const gap: CapabilityEvolutionSignal = { kind: "gap", score: 0.7, evidenceIds: [] };
    expect(computeSignalId(gap)).not.toBe(computeSignalId(underperformer));
  });

  it("differs across capabilityIds for the same kind", () => {
    const a: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "a@1", score: 0.4, evidenceIds: [] };
    const b: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "b@1", score: 0.4, evidenceIds: [] };
    expect(computeSignalId(a)).not.toBe(computeSignalId(b));
  });

  it("does not collide with proposal ids (different domain prefix)", () => {
    // computeSignalId must NOT match computeProposalId — domain-prefix isolation.
    // Indirect check: signal-id prefix is `alix-capability-signal-id-v1:`.
    // computeProposalId is out of scope to import here; the prefix check is enough.
    const id = computeSignalId(underperformer);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidSignalId (CAP-10.5 ruling #R5)", () => {
  it("accepts a 64-char lowercase hex string", () => {
    expect(isValidSignalId("a".repeat(64))).toBe(true);
  });

  it("rejects uppercase hex", () => {
    expect(isValidSignalId("A".repeat(64))).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidSignalId("a".repeat(63))).toBe(false);
    expect(isValidSignalId("a".repeat(65))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidSignalId(123)).toBe(false);
    expect(isValidSignalId(null)).toBe(false);
    expect(isValidSignalId(undefined)).toBe(false);
    expect(isValidSignalId({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/signal-identity.vitest.ts`
Expected: FAIL with module-not-found for `signal-identity.js`.

- [ ] **Step 3: Implement `signal-identity.ts`**

Create `src/capability/evolution/signal-identity.ts`:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 — Stable opaque signal identity (ruling #R5).
 *
 * Deterministic SHA-256 hex id derived from canonical-JSON of a
 * `CapabilityEvolutionSignal`. Same signal body → same id; replay
 * and undelivered-signal references stay stable across processes.
 *
 * Domain prefix isolates signal ids from CAP-9 proposal ids
 * (`alix-capability-proposal-v1:`) and CAP-6 artifact ids
 * (`alix-capability-mutation-v1:`).
 *
 * @module capability/evolution/signal-identity
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityEvolutionSignal } from "./a7-proposals.js";

const SIGNAL_ID_DOMAIN_PREFIX = "alix-capability-signal-id-v1:";

/**
 * Compute a deterministic SHA-256 hex signal id from a signal body.
 * Pure function — no I/O, no clock. Same body → same id (idempotency).
 * Canonical-JSON normalization means different key orderings yield the same id.
 */
export function computeSignalId(signal: CapabilityEvolutionSignal): string {
  const canonical = canonicalStringify(signal);
  return createHash("sha256")
    .update(SIGNAL_ID_DOMAIN_PREFIX)
    .update(canonical)
    .digest("hex");
}

/** Runtime guard: 64 lowercase hex chars. */
export function isValidSignalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/signal-identity.vitest.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/capability/evolution/signal-identity.ts tests/capability/signal-identity.vitest.ts
git commit -m "feat(evolution): CAP-10.5 signal-identity helper — deterministic SHA-256 signal IDs"
```

---

## Task 3: Create `ProposalSignalChannel` concrete class

**Files:**
- Create: `src/capability/evolution/proposal-signal-channel.ts`
- Create: `tests/capability/proposal-signal-channel.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityEvolutionSignal`, `ProposalSignalSink`, `ProposalSignalSource` from `./a7-proposals.js`
- Produces: `ProposalSignalChannel` class implementing both interfaces; private `signalsBuffer`; non-destructive `signals()`; single `publish()`.

- [ ] **Step 1: Write the failing test**

Create `tests/capability/proposal-signal-channel.vitest.ts`:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { ProposalSignalChannel } from "../../src/capability/evolution/proposal-signal-channel.js";
import type {
  ProposalSignalSink,
  ProposalSignalSource,
  CapabilityEvolutionSignal,
} from "../../src/capability/evolution/a7-proposals.js";

const sig = (kind: "gap" | "underperformer"): CapabilityEvolutionSignal =>
  kind === "gap"
    ? { kind: "gap", score: 0.6, evidenceIds: [] }
    : { kind: "underperformer", capabilityId: "cap@1", score: 0.4, evidenceIds: [] };

describe("ProposalSignalChannel (CAP-10.5 ruling #R4)", () => {
  it("publish then signals returns the published signal", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    const out = await channel.signals();
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("underperformer");
  });

  it("accumulate multiple publishes", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    await channel.publish(sig("gap"));
    const out = await channel.signals();
    expect(out.map((s) => s.kind).sort()).toEqual(["gap", "underperformer"]);
  });

  it("signals() is non-destructive (idempotent reads)", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    const first = await channel.signals();
    const second = await channel.signals();
    expect(second).toHaveLength(1);
    expect(first).toEqual(second);
  });

  it("signals() returns a defensive copy", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    const out = await channel.signals();
    // Mutating the returned array must not affect internal state.
    (out as CapabilityEvolutionSignal[]).length = 0;
    const out2 = await channel.signals();
    expect(out2).toHaveLength(1);
  });

  it("implements both ProposalSignalSink and ProposalSignalSource (compile-time)", () => {
    const channel = new ProposalSignalChannel();
    const asSink: ProposalSignalSink = channel;
    const asSource: ProposalSignalSource = channel;
    expect(asSink).toBeDefined();
    expect(asSource).toBeDefined();
  });

  it("fresh channel returns empty signals", async () => {
    const channel = new ProposalSignalChannel();
    const out = await channel.signals();
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/proposal-signal-channel.vitest.ts`
Expected: FAIL with module-not-found for `proposal-signal-channel.js`.

- [ ] **Step 3: Implement `proposal-signal-channel.ts`**

Create `src/capability/evolution/proposal-signal-channel.ts`:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 — `ProposalSignalChannel` (ruling #R4).
 *
 * Concrete composition-root implementation of both `ProposalSignalSink`
 * and `ProposalSignalSource`. Owns an in-memory buffer of signals
 * published by A5 and read by P5.5/P5.6 via A7.
 *
 * Buffer is private; consumers see only the two contracts. Reads are
 * non-destructive (idempotent snapshot) per ruling #R4.
 *
 * The channel is a **delivery mechanism**, not a source of truth. The
 * durable `measured` event in the EventLog is authoritative; loss of
 * in-memory state is recoverable by replay (CAP-12+).
 *
 * @module capability/evolution/proposal-signal-channel
 */

import type {
  CapabilityEvolutionSignal,
  ProposalSignalSink,
  ProposalSignalSource,
} from "./a7-proposals.js";

export class ProposalSignalChannel
  implements ProposalSignalSink, ProposalSignalSource
{
  private readonly signalsBuffer: CapabilityEvolutionSignal[] = [];

  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    this.signalsBuffer.push(signal);
  }

  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [...this.signalsBuffer];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/proposal-signal-channel.vitest.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 6: Commit**

```bash
git add src/capability/evolution/proposal-signal-channel.ts tests/capability/proposal-signal-channel.vitest.ts
git commit -m "feat(evolution): CAP-10.5 ProposalSignalChannel — sink+source composition-root impl"
```

---

## Task 4: Add `MeasurementSignalsUnpublishedEvent` to event types

**Files:**
- Modify: `src/capability/measurement/measurement-event-types.ts`
- Create: `tests/capability/measurement-event-types.vitest.ts`

**Interfaces:**
- Consumes: existing `CapabilityMeasurementEvent` discriminator; `ObservationStatus`
- Produces: new `MeasurementSignalsUnpublishedEvent` interface; `MeasurementSignalsUnpublishedFailure` union; extended `CAPABILITY_MEASUREMENT_EVENT_TYPES`; extended `CapabilityMeasurementEvent` union

- [ ] **Step 1: Write the failing test**

Create `tests/capability/measurement-event-types.vitest.ts`:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MEASUREMENT_EVENT_TYPES,
  isMeasurementEventType,
  type MeasurementSignalsUnpublishedEvent,
  type MeasurementSignalsUnpublishedFailure,
} from "../../src/capability/measurement/measurement-event-types.js";

const baseFailure: MeasurementSignalsUnpublishedFailure = {
  classification: "sink_threw",
  cause: "boom",
};

const unpublished: MeasurementSignalsUnpublishedEvent = {
  seq: 42,
  timestamp: "2026-08-14T00:00:00.000Z",
  type: "capability.governance.measurement.signals_unpublished",
  payload: {
    measurementEventId: "evt-1",
    signalCount: 2,
    signalIds: ["a".repeat(64), "b".repeat(64)],
    failure: baseFailure,
    occurredAt: "2026-08-14T00:00:00.000Z",
    actor: { kind: "system", component: "A5CapabilityMeasurement" },
  },
};

describe("MeasurementSignalsUnpublishedEvent (CAP-10.5 ruling #R5)", () => {
  it("has the locked event-type discriminator", () => {
    expect(CAPABILITY_MEASUREMENT_EVENT_TYPES).toContain(
      "capability.governance.measurement.signals_unpublished",
    );
  });

  it("isMeasurementEventType accepts both measured and signals_unpublished", () => {
    expect(isMeasurementEventType("capability.governance.measurement.measured")).toBe(true);
    expect(isMeasurementEventType("capability.governance.measurement.signals_unpublished")).toBe(true);
    expect(isMeasurementEventType("something.else")).toBe(false);
  });

  it("signalCount invariant equals signalIds.length", () => {
    expect(unpublished.payload.signalCount).toBe(unpublished.payload.signalIds.length);
  });

  it("failure classification is one of the locked values", () => {
    const c1: MeasurementSignalsUnpublishedFailure = { classification: "sink_threw", cause: "x" };
    const c2: MeasurementSignalsUnpublishedFailure = { classification: "sink_timeout", cause: "x" };
    expect([c1.classification, c2.classification].sort()).toEqual(["sink_threw", "sink_timeout"]);
  });

  it("actor shape is locked to system + A5CapabilityMeasurement", () => {
    expect(unpublished.payload.actor).toEqual({
      kind: "system",
      component: "A5CapabilityMeasurement",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/measurement-event-types.vitest.ts`
Expected: FAIL with module-not-found for `MeasurementSignalsUnpublishedEvent` export.

- [ ] **Step 3: Modify `measurement-event-types.ts`**

Replace the existing `CapabilityMeasurementEventType` and `CAPABILITY_MEASUREMENT_EVENT_TYPES` definitions with the extended versions, and append the new event interface.

Modify `src/capability/measurement/measurement-event-types.ts`:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — Measurement event types + payload.
 * CAP-10.5 — adds `signals_unpublished` event for sink-publish failures
 * (ruling #R5).
 *
 * Append-only measurement event stream. Lives in same EventLog as
 * lifecycle (`capability.*`) governance (`capability.governance.proposal.*`)
 * events, sharing parent prefix `capability.governance.*` single-filter
 * projection (ruling #1, #20).
 *
 * Event types:
 *   - `measured`            — successful measurement (one per call)
 *   - `signals_unpublished` — sink delivery failure (CAP-10.5)
 *
 * @module capability/measurement/measurement-event-types
 */

import type { ObservationStatus } from "../../evolution/observation/contracts/observation-contract.js";
import type { CapabilityEvolutionSignal } from "../evolution/a7-proposals.js";

export type CapabilityMeasurementEventType =
  | "capability.governance.measurement.measured"
  | "capability.governance.measurement.signals_unpublished";

export const CAPABILITY_MEASUREMENT_EVENT_TYPES: readonly CapabilityMeasurementEventType[] = [
  "capability.governance.measurement.measured",
  "capability.governance.measurement.signals_unpublished",
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

// ---------------------------------------------------------------------------
// CAP-10.5 — `signals_unpublished` event (ruling #R5)
// ---------------------------------------------------------------------------

/**
 * Classification of the failure that caused signals to be unpublished.
 * CAP-10.5 emits only `"sink_threw"` (no timeout contract yet); the
 * `"sink_timeout"` variant is reserved for forward compatibility.
 */
export type MeasurementSignalsUnpublishedFailure =
  | { readonly classification: "sink_threw"; readonly cause: string }
  | { readonly classification: "sink_timeout"; readonly cause: string };

/**
 * Emitted by A5 when a `ProposalSignalSink.publish()` throws. References
 * the `measured` event whose signals failed delivery so a CAP-12 replay
 * tool can re-publish them.
 *
 * Invariant: `payload.signalCount === payload.signalIds.length`.
 */
export interface MeasurementSignalsUnpublishedEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.signals_unpublished";
  readonly payload: {
    readonly measurementEventId: string;
    readonly signalCount: number;
    readonly signalIds: readonly string[];
    readonly failure: MeasurementSignalsUnpublishedFailure;
    readonly occurredAt: string;
    readonly actor: {
      readonly kind: "system";
      readonly component: "A5CapabilityMeasurement";
    };
  };
}

export interface CapabilityMeasurementMeasuredEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: "capability.governance.measurement.measured";
  readonly payload: CapabilityMeasurementPayload;
}

export type CapabilityMeasurementEvent =
  | CapabilityMeasurementMeasuredEvent
  | MeasurementSignalsUnpublishedEvent;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/measurement-event-types.vitest.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 6: Run full capability vitest to check downstream consumers**

Run: `pnpm exec vitest run tests/capability/`
Expected: any test that typed `CapabilityMeasurementEvent` against the OLD single-variant shape may now error. Fix by widening type annotations to accept the union. Likely candidates: governance event listeners, projection code. Use `.type === "..."` discriminators or `switch` over `event.type`.

- [ ] **Step 7: Commit**

```bash
git add src/capability/measurement/measurement-event-types.ts tests/capability/measurement-event-types.vitest.ts <any files widened for the union>
git commit -m "feat(measurement): CAP-10.5 MeasurementSignalsUnpublishedEvent + extended event union"
```

---

## Task 5: Modify `A5CapabilityMeasurement` — inject sink + eventLog, implement locked pipeline

**Files:**
- Modify: `src/evolution/observation/a5-capability-measurement.ts`
- Modify: `tests/capability/a5-capability-measurement.vitest.ts`

**Interfaces:**
- Consumes: `ProposalSignalSink` from `a7-proposals.js`; `EventLog` from where it's already imported elsewhere; `computeSignalId` from `signal-identity.js`; `MeasurementSignalsUnpublishedEvent` from event-types
- Produces: `A5CapabilityMeasurement` with new constructor signature: `{ observationEngine, signalSink, catalog, outcomeDecider?, eventLog }` — `signalSource` removed entirely

- [ ] **Step 1: Read current `a5-capability-measurement.ts` and its test**

Open both files. Note the current ctor signature and the existing "consults signalSource via signals() (ruling #12)" test.

- [ ] **Step 2: Update the test file**

In `tests/capability/a5-capability-measurement.vitest.ts`, replace the "consults signalSource" test and add the new ones. The full new test set:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach } from "vitest";
import { A5CapabilityMeasurement } from "../../src/evolution/observation/a5-capability-measurement.js";
import type { OutcomeDecider } from "../../src/evolution/observation/a5-capability-measurement.js";
import type { ProposalSignalSink } from "../../src/capability/evolution/a7-proposals.js";
import type {
  CapabilityEvolutionSignal,
} from "../../src/capability/evolution/a7-proposals.js";
import type { ObservationEngine, ObservationResult } from "../../src/evolution/observation/contracts/observation-contract.js";
import type { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import type { EventLog } from "../../src/events/event-log.js";

// --- minimal in-memory fakes ---

class FakeCatalog implements Pick<CapabilityCatalog, "get"> {
  get(id: string) {
    return { id, bindings: [{ type: "native" }] };
  }
}

class FakeEngine implements ObservationEngine {
  constructor(private readonly post: ObservationResult) {}
  async observe() {
    return this.post;
  }
}

class CollectingSink implements ProposalSignalSink {
  public readonly published: CapabilityEvolutionSignal[] = [];
  public shouldThrow = false;
  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    if (this.shouldThrow) throw new Error("boom");
    this.published.push(signal);
  }
}

class FakeEventLog implements Pick<EventLog, "append"> {
  public readonly events: unknown[] = [];
  async append(event: unknown): Promise<{ seq: number }> {
    const seq = this.events.length + 1;
    this.events.push({ ...event, seq });
    return { seq };
  }
}

// --- helpers ---

function buildMeasurement(opts: {
  sink?: CollectingSink;
  eventLog?: FakeEventLog;
  decider?: OutcomeDecider;
  postStatus?: "pass" | "fail" | "error";
}) {
  const post: ObservationResult = {
    observationId: "obs-post",
    provider: "native",
    status: opts.postStatus ?? "pass",
    confidence: 0.8,
  };
  const engine = new FakeEngine(post);
  const sink = opts.sink ?? new CollectingSink();
  const eventLog = opts.eventLog ?? new FakeEventLog();
  const m = new A5CapabilityMeasurement({
    observationEngine: engine as ObservationEngine,
    signalSink: sink,
    catalog: new FakeCatalog() as unknown as CapabilityCatalog,
    eventLog: eventLog as unknown as EventLog,
    ...(opts.decider ? { outcomeDecider: opts.decider } : {}),
  });
  return { m, sink, eventLog, engine };
}

// --- tests ---

describe("A5CapabilityMeasurement default decider (CAP-10.5 ruling #R3)", () => {
  it("effective → no signals published", async () => {
    const { m, sink } = buildMeasurement({ postStatus: "pass" });
    const out = await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(out.kind).toBe("effective");
    expect(sink.published).toEqual([]);
  });

  it("ineffective → exactly one underperformer published with locked fields", async () => {
    const { m, sink } = buildMeasurement({ postStatus: "fail" });
    const out = await m.measureCapability({ capabilityId: "cap-x", version: "1.0.0" });
    expect(out.kind).toBe("ineffective");
    expect(sink.published).toHaveLength(1);
    const s = sink.published[0]!;
    expect(s.kind).toBe("underperformer");
    if (s.kind === "underperformer") {
      expect(s.capabilityId).toBe("cap-x@1.0.0");
      expect(s.score).toBeCloseTo(0.8);
      expect(s.evidenceIds).toContain("obs-post");
    }
  });

  it("inconclusive → no signals published", async () => {
    const { m, sink } = buildMeasurement({ postStatus: "error" });
    const out = await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(out.kind).toBe("inconclusive");
    expect(sink.published).toEqual([]);
  });
});

describe("A5CapabilityMeasurement custom decider (CAP-10.5 ruling #R3)", () => {
  it("decider can emit a gap signal", async () => {
    const gap: CapabilityEvolutionSignal = { kind: "gap", score: 0.7, evidenceIds: [] };
    const { m, sink } = buildMeasurement({
      postStatus: "fail",
      decider: () => ({
        kind: "ineffective",
        evidenceRefs: ["obs-post"],
        confidence: 0.4,
        summary: "x",
        signals: [gap],
      }),
    });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(sink.published).toEqual([gap]);
  });

  it("A5 never modifies decider-produced signals (frozen array)", async () => {
    const sig: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "a@1", score: 0.4, evidenceIds: [] };
    const arr: CapabilityEvolutionSignal[] = [sig];
    Object.freeze(arr);
    const { m, sink } = buildMeasurement({
      postStatus: "fail",
      decider: () => ({
        kind: "ineffective",
        evidenceRefs: ["obs-post"],
        confidence: 0.4,
        summary: "x",
        signals: arr,
      }),
    });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    expect(sink.published).toHaveLength(1);
    expect(arr).toHaveLength(1); // unchanged
  });
});

describe("A5CapabilityMeasurement locked pipeline (CAP-10.5 ruling #R2)", () => {
  it("measured event appended before publish (commit point is step 3)", async () => {
    const order: string[] = [];
    const sink = new CollectingSink();
    sink.publish = async (s) => { order.push(`publish:${s.kind}`); (sink as CollectingSink).published.push(s); };
    const eventLog = new FakeEventLog();
    eventLog.append = async (e) => { order.push("append:measured"); (eventLog.events as unknown[]).push({ ...e, seq: eventLog.events.length + 1 }); return { seq: eventLog.events.length }; };
    const { m } = buildMeasurement({ sink, eventLog, postStatus: "fail" });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    const appendIdx = order.indexOf("append:measured");
    const publishIdx = order.findIndex((s) => s.startsWith("publish:"));
    expect(appendIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThan(appendIdx);
  });

  it("sink throws → records signals_unpublished + returns successful outcome", async () => {
    const sink = new CollectingSink();
    sink.shouldThrow = true;
    const eventLog = new FakeEventLog();
    const { m } = buildMeasurement({ sink, eventLog, postStatus: "fail" });
    const out = await m.measureCapability({ capabilityId: "cap-x", version: "1.0.0" });
    expect(out.kind).toBe("ineffective");
    const unpublished = eventLog.events.find(
      (e: any) => e.type === "capability.governance.measurement.signals_unpublished",
    );
    expect(unpublished).toBeDefined();
    const p = (unpublished as any).payload;
    expect(p.measurementEventId).toBeDefined();
    expect(p.signalCount).toBe(p.signalIds.length);
    expect(p.signalIds).toHaveLength(1);
    expect(p.failure.classification).toBe("sink_threw");
    expect(p.actor).toEqual({ kind: "system", component: "A5CapabilityMeasurement" });
  });

  it("partial publish failure → signals_unpublished lists only the failed signals", async () => {
    const sink = new CollectingSink();
    const gap: CapabilityEvolutionSignal = { kind: "gap", score: 0.6, evidenceIds: [] };
    const under: CapabilityEvolutionSignal = { kind: "underperformer", capabilityId: "a@1", score: 0.4, evidenceIds: [] };
    let first = true;
    sink.publish = async (s) => {
      if (first && s.kind === "underperformer") {
        first = false;
        throw new Error("boom");
      }
      sink.published.push(s);
    };
    const eventLog = new FakeEventLog();
    const { m } = buildMeasurement({
      sink,
      eventLog,
      postStatus: "fail",
      decider: () => ({
        kind: "ineffective",
        evidenceRefs: ["obs-post"],
        confidence: 0.4,
        summary: "x",
        signals: [gap, under],
      }),
    });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    const unpublished = eventLog.events.find(
      (e: any) => e.type === "capability.governance.measurement.signals_unpublished",
    );
    expect(unpublished).toBeDefined();
    const p = (unpublished as any).payload;
    expect(p.signalIds).toHaveLength(1); // only the underperformer failed
  });

  it("records measured event with outcome.signals on success path", async () => {
    const eventLog = new FakeEventLog();
    const { m } = buildMeasurement({ eventLog, postStatus: "fail" });
    await m.measureCapability({ capabilityId: "cap", version: "1" });
    const measured = eventLog.events.find(
      (e: any) => e.type === "capability.governance.measurement.measured",
    );
    expect(measured).toBeDefined();
    const p = (measured as any).payload;
    expect(p.outcome.signals).toHaveLength(1);
    expect(p.outcome.signals[0].kind).toBe("underperformer");
  });
});
```

- [ ] **Step 3: Run test to verify it fails (compile error expected)**

Run: `pnpm exec vitest run tests/capability/a5-capability-measurement.vitest.ts`
Expected: FAIL — `A5CapabilityMeasurement` constructor doesn't accept `signalSink`/`eventLog`, or `OutcomeDecider` import path differs.

- [ ] **Step 4: Rewrite `a5-capability-measurement.ts`**

Replace the file `src/evolution/observation/a5-capability-measurement.ts` with the new implementation:

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 — A5 concrete capability-measurement implementation.
 * CAP-10.5 — wiring for sink-based signal emission (ruling #R1, #R2).
 *
 * Implements the `A5Measurement` seam (`src/capability/measurement/a5.ts`).
 * Uses `ObservationEngine` (A5.1) for baseline/post observations, computes
 * the outcome via injected `OutcomeDecider`, then publishes the produced
 * signals through the injected `ProposalSignalSink`.
 *
 * Locked pipeline (ruling #R2):
 *   1. Compute observation
 *   2. Decider finalizes outcome (signals slot populated)
 *   3. Append `measured` event to EventLog (COMMIT POINT)
 *   4. Publish outcome.signals via ProposalSignalSink
 *      - on failure → record `signals_unpublished` event with signal IDs
 *      - on success → continue
 *   5. Return outcome (successful measurement, regardless of publish)
 *
 * Architectural boundaries (ruling #5, #7, axis 5):
 *   - Read-only catalog access (provider-name lookup).
 *   - MUST NOT import `src/capability/canonical/catalog` mutators.
 *   - MUST NOT modify outcome.signals after the decider returns.
 *
 * @module evolution/observation/a5-capability-measurement
 */

import type { ObservationEngine } from "./observation-engine.js";
import type {
  Observation,
  ObservationResult,
} from "./contracts/observation-contract.js";
import type { CapabilityMeasurementOutcome } from "../../capability/measurement/outcome-discriminated-union.js";
import type {
  A5Measurement,
  A5MeasurementTarget,
} from "../../capability/measurement/a5.js";
import type { CapabilityCatalog } from "../../capability/canonical/catalog.js";
import type { ProposalSignalSink, CapabilityEvolutionSignal } from "../../capability/evolution/a7-proposals.js";
import { computeSignalId } from "../../capability/evolution/signal-identity.js";
import type { EventLog } from "../../events/event-log.js";
import type { MeasurementSignalsUnpublishedEvent, MeasurementSignalsUnpublishedFailure } from "../../capability/measurement/measurement-event-types.js";

export type OutcomeDecider = (
  post: ObservationResult,
  baseline?: ObservationResult,
  target?: A5MeasurementTarget,
) => CapabilityMeasurementOutcome;

export interface A5CapabilityMeasurementOptions {
  readonly observationEngine: ObservationEngine;
  readonly signalSink: ProposalSignalSink;
  readonly catalog: CapabilityCatalog;
  readonly eventLog: EventLog;
  readonly outcomeDecider?: OutcomeDecider;
}

const DEFAULT_OUTCOME_DECIDER: OutcomeDecider = (post, baseline, target) => {
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
      signals: defaultSignalsFor(target, evidenceRefs, confidence),
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

/** Default signal population (ruling #R3). Ineffective → one underperformer. */
function defaultSignalsFor(
  target: A5MeasurementTarget | undefined,
  evidenceRefs: readonly string[],
  confidence: number,
): readonly CapabilityEvolutionSignal[] {
  if (!target) return [];
  return [
    {
      kind: "underperformer",
      capabilityId: `${target.capabilityId}@${target.version}`,
      score: confidence,
      evidenceIds: [...evidenceRefs],
    },
  ];
}

export class A5CapabilityMeasurement implements A5Measurement {
  private readonly engine: ObservationEngine;
  private readonly signalSink: ProposalSignalSink;
  private readonly catalog: CapabilityCatalog;
  private readonly outcomeDecider: OutcomeDecider;
  private readonly eventLog: EventLog;

  constructor(options: A5CapabilityMeasurementOptions) {
    this.engine = options.observationEngine;
    this.signalSink = options.signalSink;
    this.catalog = options.catalog;
    this.outcomeDecider = options.outcomeDecider ?? DEFAULT_OUTCOME_DECIDER;
    this.eventLog = options.eventLog;
    Object.freeze(this);
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

    const outcome = this.outcomeDecider(post, baseline, target);

    // Step 3 — COMMIT POINT: append measured event.
    const measured = await this.recordMeasured(target, baseline, post, outcome);

    // Step 4 — best-effort publish via sink.
    await this.publishSignals(outcome.signals, measured.seq);

    return outcome;
  }

  private async recordMeasured(
    target: A5MeasurementTarget,
    baseline: ObservationResult | undefined,
    post: ObservationResult,
    outcome: CapabilityMeasurementOutcome,
  ): Promise<{ seq: number }> {
    return this.eventLog.append({
      type: "capability.governance.measurement.measured",
      timestamp: new Date().toISOString(),
      payload: {
        measurement: { capabilityId: target.capabilityId, version: target.version },
        ...(baseline
          ? {
              baseline: {
                observationId: baseline.observationId,
                takenAt: baseline.observationId, // minimal — full timestamp flows from observation
              },
            }
          : {}),
        post: {
          observationId: post.observationId,
          takenAt: post.observationId,
          status: post.status,
          confidence: post.confidence,
        },
        outcome,
      },
    });
  }

  private async publishSignals(
    signals: readonly CapabilityEvolutionSignal[],
    measurementEventId: number,
  ): Promise<void> {
    const failed: Array<{ signal: CapabilityEvolutionSignal; signalId: string; cause: string }> = [];

    for (const signal of signals) {
      try {
        await this.signalSink.publish(signal);
      } catch (cause) {
        failed.push({
          signal,
          signalId: computeSignalId(signal),
          cause: safeErrorString(cause),
        });
      }
    }

    if (failed.length > 0) {
      const failure: MeasurementSignalsUnpublishedFailure = {
        classification: "sink_threw",
        cause: failed[0]!.cause,
      };
      const event: Omit<MeasurementSignalsUnpublishedEvent, "seq"> = {
        type: "capability.governance.measurement.signals_unpublished",
        timestamp: new Date().toISOString(),
        payload: {
          measurementEventId: String(measurementEventId),
          signalCount: failed.length,
          signalIds: failed.map((f) => f.signalId),
          failure,
          occurredAt: new Date().toISOString(),
          actor: { kind: "system", component: "A5CapabilityMeasurement" },
        },
      };
      await this.eventLog.append(event);
    }
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
    if (!def) return "native";
    const firstBinding = def.bindings[0];
    return firstBinding?.type ?? "native";
  }
}

function safeErrorString(cause: unknown): string {
  if (cause instanceof Error) return String(cause.message).slice(0, 500);
  return String(cause).slice(0, 500);
}
```

**Important adaptation notes:**
- `baseline.takenAt` and `post.takenAt` use `observationId` as a placeholder. The plan preserves the existing A5 measurement data shape — if the production code uses richer timestamps, the implementer may adapt these from the existing `recordMeasured` helper in `capability-measurement-engine.ts`. Read that file before committing; if it has the canonical recordMeasured, import and call it instead of inlining.
- `eventLog.append` returns `{ seq }` in this stub — match the real `EventLog.append` return type when wiring (see Task 6).

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0 — types and EventLog signature must match.

- [ ] **Step 6: Run a5 tests to verify they pass**

Run: `pnpm exec vitest run tests/capability/a5-capability-measurement.vitest.ts`
Expected: all new tests pass.

- [ ] **Step 7: Run full capability vitest to surface downstream impact**

Run: `pnpm exec vitest run tests/capability/`
Expected: callers that instantiated A5 with `signalSource` will fail to compile or fail at test setup. Fix by:
- Updating test fakes to implement both `ProposalSignalSink` + `ProposalSignalSource` (Task 7 handles this for the composition-root sites).
- For callers that don't publish through A5 (only A7 reads), keeping a `NoopSignalSink` is fine.

- [ ] **Step 8: Commit**

```bash
git add src/evolution/observation/a5-capability-measurement.ts tests/capability/a5-capability-measurement.vitest.ts
git commit -m "feat(observation): CAP-10.5 A5 wires sink + EventLog; locked 4-step pipeline"
```

---

## Task 6: Update `capability-measurement-engine.ts` to pass `EventLog` and adapt to new A5 ctor

**Files:**
- Modify: `src/capability/measurement/capability-measurement-engine.ts`

**Interfaces:**
- Consumes: existing `EventLog`, `A5Measurement`
- Produces: engine constructs A5 with `signalSink` (now mandatory) and `eventLog`; engine no longer drops the `void signals` stub

- [ ] **Step 1: Read current engine**

Open `src/capability/measurement/capability-measurement-engine.ts`. Find where A5 is instantiated (likely inside the engine's constructor or in a factory).

- [ ] **Step 2: Identify the A5 construction site**

Look for `new A5CapabilityMeasurement({ ... })`. Note the existing options object. If A5 was constructed with `signalSource`, swap to `signalSink`. Add `eventLog: this.eventLog` (or whatever the engine already holds).

- [ ] **Step 3: Pass `signalSink` and `eventLog` to A5**

Update the construction call:

```typescript
// Before
const a5 = new A5CapabilityMeasurement({
  observationEngine: this.engine,
  signalSource: this.signalSource, // ← old
  catalog: this.catalog,
});

// After
const a5 = new A5CapabilityMeasurement({
  observationEngine: this.engine,
  signalSink: this.signalSink, // ← new (mandatory)
  catalog: this.catalog,
  eventLog: this.eventLog,
});
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 5: Run engine-related vitest**

Run: `pnpm exec vitest run tests/capability/`
Expected: existing engine tests still pass. Any test that constructed the engine with `signalSource` will need to be updated to use `signalSink` (Task 7 handles the composition-root sites).

- [ ] **Step 6: Commit**

```bash
git add src/capability/measurement/capability-measurement-engine.ts
git commit -m "refactor(measurement): CAP-10.5 engine passes signalSink + eventLog to A5"
```

---

## Task 7: Composition root — construct `ProposalSignalChannel` once; update test fakes

**Files:**
- Modify: `src/capability/platform.ts`
- Modify: `tests/capability/platform-cap-10.vitest.ts`
- Modify: `tests/capability/capability-service-governance.vitest.ts`
- Modify: `tests/capability/capability-measure-cli.test.ts`
- Modify: `tests/capability/governance-cli.test.ts`

**Interfaces:**
- Consumes: `ProposalSignalChannel` from `proposal-signal-channel.js`
- Produces: `CapabilityPlatform` constructs one channel; passes it (typed as Sink) to A5 and (typed as Source) to A7; test fakes updated to implement both interfaces

- [ ] **Step 1: Modify `src/capability/platform.ts`**

Find the construction of `a5CapabilityMeasurement` and `proposalGenerator`. Add:

```typescript
import { ProposalSignalChannel } from "./evolution/proposal-signal-channel.js";
```

Then in the constructor body, before constructing A5 / A7:

```typescript
const channel = new ProposalSignalChannel();
```

Pass `signalSink: channel` (not source) to `a5CapabilityMeasurement`. Pass `signalSource: channel` to `proposalGenerator`.

**Important:** the channel is constructed ONCE. There must be no other `new ProposalSignalChannel(` in `src/`.

- [ ] **Step 2: Update test fakes to implement both interfaces**

For each test file in the file list, find the local `FakeSignalSource` / `NoopSignalSource` class. Either:

(a) Rename to `FakeSignalChannel` and have it implement both `ProposalSignalSink` and `ProposalSignalSource`:

```typescript
class FakeSignalChannel implements ProposalSignalSink, ProposalSignalSource {
  public readonly published: CapabilityEvolutionSignal[] = [];
  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    this.published.push(signal);
  }
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [...this.published];
  }
}
```

Or (b) keep `FakeSignalSource` for A7's read-side and add a sibling `FakeSignalSink` for A5's write-side.

Choose (a) for shared state across A5 + A7 in the same test, or (b) for tests where the source and sink should be different objects. Be consistent within each test file.

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: EXIT=0.

- [ ] **Step 4: Run full capability vitest**

Run: `pnpm exec vitest run tests/capability/`
Expected: all green.

- [ ] **Step 5: Run node tests**

Run: `node scripts/run-node-tests.mjs`
Expected: pre-existing failure count unchanged (this codebase has pre-existing node-test failures; CAP-10.5 must not introduce new ones).

- [ ] **Step 6: Commit**

```bash
git add src/capability/platform.ts tests/capability/platform-cap-10.vitest.ts tests/capability/capability-service-governance.vitest.ts tests/capability/capability-measure-cli.test.ts tests/capability/governance-cli.test.ts
git commit -m "refactor(platform): CAP-10.5 composition root owns ProposalSignalChannel; dual views"
```

---

## Task 8: Sentinel + doc cleanup

**Files:**
- Create: `tests/capability/cap-10-5-emission-sentinel.vitest.ts`
- Modify: `docs/architecture/checkpoints/2026-08-13-cap-10-a5-measurement-integration-checkpoint.md` (if exists — banner CAP-10.5 completion)
- Modify: `docs/superpowers/specs/2026-08-13-cap-10-a5-measurement-integration-design.md` — add CAP-10.5 status note
- Modify: `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md` — §10/§11 update

**Interfaces:**
- Sentinel: 6 axes covering architectural purity (no read-side write in A5; buffer privacy; single construction site; event type presence; default decider behavior)

- [ ] **Step 1: Create `cap-10-5-emission-sentinel.vitest.ts`**

```typescript
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../../src");
const read = (rel: string) => readFileSync(resolve(SRC, rel), "utf8");

describe("CAP-10.5 emission-sentinel (6-axis)", () => {
  it("axis 1: a5 does not import ProposalSignalSource (read-only)", () => {
    const src = read("evolution/observation/a5-capability-measurement.ts");
    expect(src).not.toMatch(/ProposalSignalSource\b/);
    expect(src).toMatch(/ProposalSignalSink\b/);
  });

  it("axis 2: channel API exposes only publish (write) and signals (read)", () => {
    const src = read("capability/evolution/proposal-signal-channel.ts");
    expect(src).toMatch(/async\s+publish\s*\(/);
    expect(src).toMatch(/async\s+signals\s*\(\s*\)/);
    // No other public mutator method
    expect(src).not.toMatch(/async\s+(reset|clear|drain|consume)\s*\(/);
  });

  it("axis 3: signalsBuffer is private", () => {
    const src = read("capability/evolution/proposal-signal-channel.ts");
    expect(src).toMatch(/private\s+readonly\s+signalsBuffer/);
  });

  it("axis 4: ProposalSignalChannel is constructed exactly once in src/", () => {
    // scan all .ts files under src/ for `new ProposalSignalChannel(`
    const matches: string[] = [];
    const walk = (rel: string) => {
      const full = resolve(SRC, rel);
      // simple non-recursive single-level scan; tests/ not scanned
      try {
        const content = readFileSync(full, "utf8");
        const found = content.match(/new\s+ProposalSignalChannel\s*\(/g) ?? [];
        matches.push(...found.map(() => rel));
      } catch {
        // directory or unreadable
      }
    };
    // scan candidate files
    for (const rel of [
      "capability/platform.ts",
      "capability/evolution/proposal-signal-channel.ts",
      "capability/measurement/capability-measurement-engine.ts",
      "evolution/observation/a5-capability-measurement.ts",
    ]) {
      walk(rel);
    }
    expect(matches).toEqual(["capability/platform.ts"]);
  });

  it("axis 5: signals_unpublished event type present in event-types", () => {
    const src = read("capability/measurement/measurement-event-types.ts");
    expect(src).toMatch(/capability\.governance\.measurement\.signals_unpublished/);
    expect(src).toMatch(/MeasurementSignalsUnpublishedEvent/);
  });

  it("axis 6: default decider emits underperformer for ineffective", () => {
    const src = read("evolution/observation/a5-capability-measurement.ts");
    expect(src).toMatch(/kind:\s*"ineffective"/);
    expect(src).toMatch(/kind:\s*"underperformer"/);
    expect(src).toMatch(/defaultSignalsFor/);
  });
});
```

- [ ] **Step 2: Run sentinel test**

Run: `pnpm exec vitest run tests/capability/cap-10-5-emission-sentinel.vitest.ts`
Expected: all 6 axes pass.

- [ ] **Step 3: Update CAP-10 architecture checkpoint doc (if exists)**

Check `docs/architecture/checkpoints/2026-08-13-cap-10-a5-measurement-integration-checkpoint.md`. If present, prepend:

```markdown
> **CAP-10.5 SUPERSESSION (2026-08-14):** M1 evolution-signal emission seam closed. A5 publishes signals via injected `ProposalSignalSink`; failures record `signals_unpublished` events with SHA-256 signal IDs. See `docs/superpowers/specs/2026-08-14-cap-10-5-evolution-signal-emission-design.md`.

```

- [ ] **Step 4: Update CAP-10 design doc**

In `docs/superpowers/specs/2026-08-13-cap-10-a5-measurement-integration-design.md`, replace the line:

> `measurement.failed` for observability of failures — currently deferred

with:

> CAP-10.5 (`signals_unpublished`) replaced the deferred `measurement.failed` observability item. Sink publish failures record `capability.governance.measurement.signals_unpublished` events with deterministic signal IDs.

- [ ] **Step 5: Update current-state architecture docs**

In `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md` (§10/§11), update any references to the M1 stub or the deferred `measurement.failed` to point at the CAP-10.5 spec.

- [ ] **Step 6: Run full test suite**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run tests/capability/`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/capability/cap-10-5-emission-sentinel.vitest.ts <modified docs>
git commit -m "test(sentinel): CAP-10.5 emission-sentinel 6-axis + doc cleanup"
```

---

## AC Coverage Matrix

Maps ticket ACs to plan tasks.

| Ticket AC (CAP-10.5 follow-up) | Tasks |
|---|---|
| A5 publishes `outcome.signals` via injected `ProposalSignalSink` | T1, T5, T7 |
| Sink failures record `signals_unpublished` events with deterministic IDs | T2, T4, T5 |
| Outcome is canonical; A5 never modifies `outcome.signals` | T5 (test "A5 never modifies"), T8 (sentinel axis 3) |
| `ProposalSignalChannel` is the sole composition-root impl, buffer private | T3, T7, T8 (sentinel axes 2, 3, 4) |
| CLI surface, service surface, projection shape unchanged | T6, T7, T8 (no doc references new commands) |
| Tests cover effective/ineffective/inconclusive + sink-throw + partial-fail | T5 |
| Default decider emits `underperformer` for `ineffective` | T5 (test), T8 (sentinel axis 6) |
| Replay-safe signal IDs (SHA-256) | T2, T8 |
| M1 stub replaced; no `void signals` placeholder remains | T5, T8 (sentinel axis 1) |
