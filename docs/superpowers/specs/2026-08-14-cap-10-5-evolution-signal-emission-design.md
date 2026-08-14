# CAP-10.5 — M1 Evolution-Signal Emission Seam Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the M1 evolution-signal emission seam that CAP-10 deliberately deferred: A5 must actually publish its produced signals through an explicit write-side contract, with best-effort delivery semantics and durable observability of delivery failures.

**Architecture:** The outcome remains authoritative. A5 publishes `outcome.signals` through a new `ProposalSignalSink` interface after the measured event has been persisted; the sink publishes into a composition-root-owned `ProposalSignalChannel` that A7 reads from via the existing `ProposalSignalSource` interface. Channel is delivery, not source of truth. Failures record `signals_unpublished` events with deterministic SHA-256 signal IDs sufficient for CAP-12 replay.

**Tech Stack:** TypeScript · Node `crypto.createHash` · existing `canonicalStringify` from `src/security/audit/canonical-json.ts` · append-only EventLog.

---

## 1. Document hierarchy

This design supersedes the M1-deferral note in `docs/superpowers/specs/2026-08-13-cap-10-a5-measurement-integration-design.md` and the relevant "MUST emit evolution signals" obligation in `docs/superpowers/plans/2026-08-13-cap-10-a5-measurement-integration.md`. It does **not** change CAP-10's settled surface (service boundary, event recording, governance projection integration).

**Authoritative artifacts (new):**

| Path | Role |
|---|---|
| `src/capability/evolution/proposal-signal-channel.ts` | `ProposalSignalChannel` concrete class — sink + source in one object. |
| `src/capability/evolution/signal-identity.ts` | `computeSignalId(signal)` helper. |
| `src/capability/evolution/a7-proposals.ts` (modified) | Add `ProposalSignalSink` interface (next to existing `ProposalSignalSource`). |
| `src/evolution/observation/a5-capability-measurement.ts` (modified) | Inject `signalSink` (not `signalSource`); implement locked 4-step pipeline; default decider emits `underperformer` for `ineffective`. |
| `src/capability/measurement/measurement-event-types.ts` (modified) | Add `MeasurementSignalsUnpublishedEvent` discriminated-union variant. |
| `src/capability/measurement/capability-measurement-engine.ts` (modified) | Pass `eventLog` to A5 so it can append `signals_unpublished`. |
| `src/capability/platform.ts` (modified) | Construct one `ProposalSignalChannel`; inject as sink to A5 and source to A7. |

**Authoritative artifacts (test):**

| Path | Role |
|---|---|
| `tests/capability/proposal-signal-channel.vitest.ts` (new) | Behavior tests for the channel. |
| `tests/capability/a5-capability-measurement.vitest.ts` (modified) | Replace "consults signalSource" stub assertion with publish + failure paths. |
| `tests/capability/measurement-event-types.vitest.ts` (new or extended) | Round-trip serialization of `MeasurementSignalsUnpublishedEvent`. |
| `tests/capability/signal-identity.vitest.ts` (new) | Determinism + format + collision tests. |
| `tests/capability/cap-10-5-emission-sentinel.vitest.ts` (new) | 6-axis deletion-purity/architecture-purity guard. |

---

## 2. Core invariants

1. **Outcome is canonical.** `CapabilityMeasurementOutcome.signals` is the authoritative representation of what signals the measurement produced. A5 MUST NOT derive or modify signals after the decider returns.
2. **Commit point is step 3.** The `capability.governance.measurement.measured` event is the persistence commit. Once appended, the measurement succeeded — even if step 4 (publish) fails.
3. **Channel is delivery, not source of truth.** The persistent `measured` event holds the signals authoritatively. The in-memory channel buffer is a delivery cache for downstream consumers (P5.5/P5.6 via A7). Loss of channel state is recoverable from the event log.
4. **Sink failure ≠ measurement failure.** If `signalSink.publish()` throws, A5 records `signals_unpublished` with the failed signal IDs and returns the successful outcome.
5. **Idempotent reads.** `channel.signals()` is non-destructive — repeated calls return the same snapshot. No drain / acknowledgment semantics in CAP-10.5.
6. **Stable signal identity.** `signalId = sha256("alix-capability-signal-id-v1:" + canonicalStringify(signal))`. Same signal body → same ID. NO `crypto.randomUUID()` for these.
7. **CAP-10 surface unchanged.** The CLI, the service boundary, the projection shape, and the measured event payload stay byte-equivalent for non-failure paths.

---

## 3. Locked decisions index

| # | Decision | Source |
|---|---|---|
| **R1** | Outcome canonical; explicit sink provides delivery. `ProposalSignalSink` is a new interface alongside `ProposalSignalSource`. | Grilling Q1 (Option B'). |
| **R2** | Best-effort publish; failure records `signals_unpublished` event and returns successful outcome. | Grilling Q2 (Option A). |
| **R3** | Decider-driven signal population. Default: `effective → []`, `ineffective → [underperformer]`, `inconclusive → []`. A5 never modifies signals after decider returns. | Grilling Q3 (Option A). |
| **R4** | `ProposalSignalChannel` is a single concrete class in **`src/capability/evolution/proposal-signal-channel.ts`** (separate module, not in `a7-proposals.ts`). Implements both interfaces. Buffer is private. | Grilling Q4 (Option A, separate module). |
| **R5** | `MeasurementSignalsUnpublishedEvent` lives in `measurement-event-types.ts`. Schema: `measurementEventId`, `signalCount`, `signalIds`, `failure.{classification, cause}`, `occurredAt`, `actor.{kind, component}`. `signalIds` are SHA-256 hex of canonical-JSON signal. `signalCount === signalIds.length`. `classification` is `"sink_threw"` only in CAP-10.5. | Grilling Q5 (Option A + hashed IDs). |

Detailed memory entry: `memory/cap-10-5-rulings-locked.md`.

---

## 4. Architecture

### 4.1 Module placement

```
src/capability/evolution/
├── a7-proposals.ts                (CAP-9 contract; gains ProposalSignalSink interface)
├── proposal-signal-channel.ts     (NEW; ProposalSignalChannel concrete class)
└── signal-identity.ts             (NEW; computeSignalId helper)

src/evolution/observation/
└── a5-capability-measurement.ts   (modified; injects signalSink + EventLog)

src/capability/measurement/
├── measurement-event-types.ts     (modified; adds signals_unpublished variant)
└── capability-measurement-engine.ts (modified; passes EventLog to A5)
```

### 4.2 Type surface (delta from CAP-10)

```ts
// src/capability/evolution/a7-proposals.ts — added next to ProposalSignalSource
export interface ProposalSignalSink {
  publish(signal: CapabilityEvolutionSignal): Promise<void>;
}

// src/capability/evolution/signal-identity.ts — new file
import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityEvolutionSignal } from "./a7-proposals.js";

const SIGNAL_ID_DOMAIN_PREFIX = "alix-capability-signal-id-v1:";

export function computeSignalId(signal: CapabilityEvolutionSignal): string {
  const canonical = canonicalStringify(signal);
  return createHash("sha256").update(SIGNAL_ID_DOMAIN_PREFIX).update(canonical).digest("hex");
}

export function isValidSignalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
```

```ts
// src/capability/evolution/proposal-signal-channel.ts — new file
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSink,
  ProposalSignalSource,
} from "./a7-proposals.js";

export class ProposalSignalChannel implements ProposalSignalSink, ProposalSignalSource {
  private readonly signalsBuffer: CapabilityEvolutionSignal[] = [];

  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    this.signalsBuffer.push(signal);
  }

  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [...this.signalsBuffer];
  }
}
```

```ts
// src/capability/measurement/measurement-event-types.ts — appended
export type MeasurementSignalsUnpublishedFailure =
  | { readonly classification: "sink_threw"; readonly cause: string }
  | { readonly classification: "sink_timeout"; readonly cause: string };

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
    readonly actor: { readonly kind: "system"; readonly component: "A5CapabilityMeasurement" };
  };
}

// Existing CapabilityMeasurementEvent union extended:
export type CapabilityMeasurementEvent =
  | CapabilityMeasurementMeasuredEvent
  | MeasurementSignalsUnpublishedEvent;
```

The discriminator constant:

```ts
export const CAPABILITY_MEASUREMENT_EVENT_TYPES: readonly CapabilityMeasurementEventType[] = [
  "capability.governance.measurement.measured",
  "capability.governance.measurement.signals_unpublished",
] as const;
```

### 4.3 A5 measurement pipeline (locked sequence)

```
OutcomeDecider
     │
     ▼
final CapabilityMeasurementOutcome (+ signals[])
     │
     ├──► measured event (append to EventLog) ← COMMIT
     │
     └──► for each signal in outcome.signals:
             try {
               await signalSink.publish(signal);
             } catch (cause) {
               record signals_unpublished event
                  measurementEventId = measured.seq
                  signalIds        = SHA-256 hex of each unpublished signal
                  signalCount      = signalIds.length
                  failure          = { classification: "sink_threw", cause: <sanitized> }
                  occurredAt       = ISO-8601
                  actor            = { kind: "system", component: "A5CapabilityMeasurement" }
             }
             │
             ▼
        return outcome (success)
```

### 4.4 Default decider policy

```ts
function defaultSignalsFor(
  outcome: { kind: "effective" | "ineffective" | "inconclusive" },
  target: A5MeasurementTarget,
  evidenceRefs: readonly string[],
  confidence: number,
): readonly CapabilityEvolutionSignal[] {
  if (outcome.kind !== "ineffective") return [];
  return [{
    kind: "underperformer",
    capabilityId: `${target.capabilityId}@${target.version}`,
    score: confidence,
    evidenceIds: evidenceRefs,
  }];
}
```

Custom deciders retain the full `signals: readonly CapabilityEvolutionSignal[]` slot and may emit any of the four kinds (`gap`, `underperformer`, `consolidation_opportunity`, `deprecation_signal`).

---

## 5. Data flow

### 5.1 Successful publish (no failure)

```
A5.measureCapability(target)
   │
   ├─ observationEngine.observe(post) → postResult
   ├─ (optional) observationEngine.observe(baseline) → baselineResult
   ├─ outcomeDecider(post, baseline) → outcome (with populated signals)
   ├─ measurementEngine.recordMeasured(target, baseline, post, outcome)
   │     └─ eventLog.append({ type: "measured", payload: {...} }) → measuredEventId
   │
   ├─ for each signal in outcome.signals:
   │     await signalSink.publish(signal)   // ProposalSignalChannel.push(signal)
   │
   └─ return outcome
                                  │
                                  ▼
                  ProposalSignalChannel.signalsBuffer accumulates
                                  │
                                  ▼
                  A7ProposalGenerator reads via ProposalSignalSource.signals()
```

### 5.2 Publish failure (best-effort)

```
A5.measureCapability(target)
   │
   ├─ ... (same as 5.1 up to outcome) ...
   ├─ measurementEngine.recordMeasured(...) → measuredEventId  ← COMMIT
   │
   ├─ for each signal in outcome.signals:
   │     try {
   │       await signalSink.publish(signal);
   │     } catch (cause) {
   │       unpublishedSignals.push({ signal, signalId, sanitizedCause });
   │     }
   │
   ├─ if unpublishedSignals.length > 0:
   │     eventLog.append({
   │       type: "signals_unpublished",
   │       payload: {
   │         measurementEventId,
   │         signalCount: unpublishedSignals.length,
   │         signalIds:    unpublishedSignals.map(s => s.signalId),
   │         failure:      { classification: "sink_threw", cause: <sanitized> },
   │         occurredAt:   new Date().toISOString(),
   │         actor:        { kind: "system", component: "A5CapabilityMeasurement" },
   │       },
   │     });
   │
   └─ return outcome   // ← measurement succeeded; failure is observable but not propagated
```

The returned outcome is identical to the no-failure path. The caller (`CapabilityMeasurementEngine` orchestrator) cannot distinguish publish-success from publish-failure by return value — it only knows via `eventLog` reads or projection queries.

---

## 6. Composition root

`CapabilityPlatform` (the only composition root for capability-platform internals) constructs **one** `ProposalSignalChannel`:

```ts
// src/capability/platform.ts — modified construction
const channel = new ProposalSignalChannel();

const a5Measurement = new A5CapabilityMeasurement({
  observationEngine,
  signalSink: channel,            // ← NEW: sink view
  catalog,
  // (no more signalSource)
  outcomeDecider: optionalCustomDecider,
});

const a7Generator = new A7ProposalGenerator({
  signalSource: channel,          // existing: source view, same instance
});
```

The channel is constructed once and shared. After construction, A5 sees only the `ProposalSignalSink` view; A7 sees only the `ProposalSignalSource` view. There is no way for A5 to read what A7 would read, or vice versa.

The CLI dispatcher does not change shape. `CapabilityPlatform` is the sole owner of the channel; the CLI receives only the platform instance.

---

## 7. Migration boundary

CAP-10.5 is **purely additive**:

- The measured event schema is unchanged.
- The CLI `alix capability measure` command is unchanged.
- The service surface (`CapabilityService.measure`) is unchanged.
- The governance projection shape is unchanged.
- A7 proposal generation is unchanged in behavior (reads from the same channel, which now has actual content instead of an empty buffer).
- Tests that injected `NoopSignalSource` / `FakeSignalSource` keep working — those classes still satisfy `ProposalSignalSource` for A7's read-side; for A5's write-side they must be replaced or extended to also implement `ProposalSignalSink`. The plan tasks handle this in-place.

The forbidden file list for CAP-10.5 is identical to CAP-10's plus the new `src/evolution/capability-lifecycle/*` (already gone per CAP-11 R5):

- `src/capability/initial-capabilities.ts` — never touch
- `src/tools/tool-registry.ts` — never touch
- `src/policy/capability-registry.ts` — never touch
- `src/capability/canonical/*` (production) — never touch
- `src/capability/evolution/a7-proposals.ts` (production) — only add `ProposalSignalSink` interface, do not modify `A7ProposalGenerator` body or `ProposalSignalSource`

---

## 8. Error handling

### 8.1 Sink throw → `signals_unpublished`

- **Trigger:** `await signalSink.publish(signal)` throws.
- **Action:** catch, append `MeasurementSignalsUnpublishedEvent`, continue publishing remaining signals.
- **What is observed:** the event log has both a `measured` event and a `signals_unpublished` event for the same `measurementEventId`.
- **What is NOT observed:** no exception propagates from `measureCapability`. The caller sees a successful measurement.

### 8.2 `measured` event append failure → rethrow

The append is **not** best-effort — the orchestrator already handles this path (CAP-10 ruling #16: `CapabilityMeasureFailedError`). CAP-10.5 does not modify this path.

### 8.3 `signals_unpublished` event append failure → swallow + log

This is a recursive observability problem. If we cannot record the failure of a signal delivery, the most we can do is log to stderr. The measurement outcome is already returned successfully. CAP-12 (or future operational tooling) can detect this by observing that the measured event has signals but no `signals_unpublished` event after some horizon — and inspect the channel buffer state.

### 8.4 Cause sanitization

`failure.cause` is a sanitized diagnostic string — the `Error.message` of the caught exception, possibly truncated to 500 chars. It MUST NOT include:

- Stack traces (which could leak internal paths)
- Object references that are not safe to serialize
- User-supplied content

A future enhancement may introduce a `safeErrorString()` utility; for CAP-10.5, use `String(cause?.message ?? cause).slice(0, 500)` or equivalent.

---

## 9. Testing strategy

### 9.1 Unit — `proposal-signal-channel.vitest.ts`

Behavior tests:
- `publish` then `signals` returns the published signal
- multiple `publish` calls accumulate
- `signals` is non-destructive: two consecutive reads return equivalent arrays
- `signals` returns a copy (mutating the returned array does not affect internal state)
- The class implements both interfaces (compile-time check via `satisfies`)

### 9.2 Unit — `signal-identity.vitest.ts`

Behavior tests:
- Same signal body → same signal ID (determinism)
- Different key ordering in the signal → same signal ID (canonicalization)
- Different signal kinds → different signal IDs (collision avoidance)
- `isValidSignalId` accepts SHA-256 hex, rejects other shapes
- Domain prefix isolates from CAP-9 proposal IDs (computeSignalId(underperformer) ≠ computeProposalId(candidate))

### 9.3 Unit — `measurement-event-types.vitest.ts` (new or extended)

- Round-trip serialization: `serializeEvent(unpublishedEvent)` → parse → equivalent object
- Type guard `isMeasurementEventType` accepts both `"measured"` and `"signals_unpublished"`
- The `signals_unpublished` event passes the type guard
- `signalCount === signalIds.length` invariant — enforced by a runtime validator function

### 9.4 Modified — `a5-capability-measurement.vitest.ts`

Replace the "consults signalSource via signals() (ruling #12)" stub assertion with:
- Test: effective outcome → channel.signals() is empty
- Test: ineffective outcome with default decider → channel.signals() contains exactly one `underperformer` with the expected capabilityId, version, evidenceRefs, confidence
- Test: inconclusive outcome → channel.signals() is empty
- Test: failing sink → measured event appended; signals_unpublished event appended; outcome still returned successfully
- Test: failing sink + partial publish (first signal succeeds, second throws) → signals_unpublished event contains only the second signal's ID
- Test: custom decider returning a `gap` signal → that signal is published
- Test: outcome.signals is NEVER modified by A5 — verified by passing a decider that returns a frozen array

### 9.5 Modified — `platform-cap-10.vitest.ts`, `capability-service-governance.vitest.ts`, `capability-measure-cli.test.ts`, `governance-cli.test.ts`

The `FakeSignalSource` / `NoopSignalSource` test fakes need to also implement `ProposalSignalSink` so that A5 can publish through them. The simplest change: rename to `FakeSignalChannel` that implements both interfaces. If the test was only using the source side, the sink side can be a no-op `throw new Error("unexpected publish")` to detect accidental writes.

### 9.6 Sentinel — `cap-10-5-emission-sentinel.vitest.ts` (NEW)

Six axes guarding deletion-purity and architecture-purity:

1. **No read-side write in A5.** `a5-capability-measurement.ts` does NOT import `ProposalSignalSource` (only `ProposalSignalSink`).
2. **No source-side write in channel API.** `ProposalSignalChannel.publish` is the sole write method; no other method mutates buffer state.
3. **No mutation of outcome.signals in A5.** Static check: `measureCapability` body does not call any mutation API on the signals array. (Compile-time — checked via grep + AST scan.)
4. **Single channel construction site.** `new ProposalSignalChannel(` appears exactly once in `src/` — at the composition root (`src/capability/platform.ts`).
5. **`signals_unpublished` event type present.** Static check: the event-type discriminator string and the `MeasurementSignalsUnpublishedEvent` interface are both present.
6. **Default decider emits underperformer for ineffective.** Behavior test: default decider called with `ineffective` returns `[underperformer(...)]` with correct fields; with `effective`/`inconclusive` returns `[]`.

### 9.7 End-to-end (node:test)

A focused integration test that wires the real `CapabilityPlatform` and exercises:
- `alix capability measure` (or the equivalent service call) for an ineffective capability
- Event log contains both `measured` and (optionally, if sink wired to throw) `signals_unpublished`
- A7 reads from the channel and produces the expected `CapabilityEvolutionCandidate`

---

## 10. Forward compatibility

### 10.1 CAP-12 replay mechanism

The locked invariant — "the durable measured event remains sufficient to identify and replay the undelivered signals later" — depends on:

- Each `signals_unpublished` event carrying the `measurementEventId` reference and the exact `signalIds` of the failed signals.
- Each signal ID being deterministic (`computeSignalId(signal)`).
- The signal body being reconstructible: either stored in the measured event's `outcome.signals[]` (which it is) or derivable from `measurementEventId` + signal ID (also derivable since `computeSignalId` is pure).

A CAP-12 operational tool can therefore:
1. Find all `signals_unpublished` events.
2. For each, read the corresponding `measured` event by `measurementEventId`.
3. Reconstruct each failed signal (filter `outcome.signals` by `signalIds` membership).
4. Re-publish through a fresh channel.

### 10.2 `sink_timeout` classification

The schema reserves `"sink_timeout"` for forward compatibility. CAP-10.5 emits only `"sink_threw"`. When a timeout contract is introduced (CAP-12+), the implementation can switch on the cause type and emit `"sink_timeout"` without breaking consumers.

### 10.3 Custom deciders

The `OutcomeDecider` injection point is unchanged. Custom deciders (e.g., a future consolidation-aware decider) can synthesize any of the four signal kinds. A5's contract is "whatever the decider returns is final."

### 10.4 Future channel replacement

`ProposalSignalChannel` is a concrete implementation behind two pure interfaces. Replacing it (e.g., with a Redis-backed pub/sub for multi-process A5/A7) requires only:

1. A new class implementing both interfaces with the same semantics.
2. A one-line change in `CapabilityPlatform`'s construction.

No interface change. No consumer change.

---

## 11. Out of scope

- **CAP-12 replay mechanism.** The replay tooling that consumes `signals_unpublished` events is a separate ticket.
- **Timeout contract.** The sink interface has no timeout in CAP-10.5. Adding one is a contract change.
- **Persistent signal store.** The channel buffer is in-memory and lost on restart. The replay invariant (R2) makes this acceptable.
- **Channel durability across process boundaries.** Out of scope; the channel is process-local.
- **Sink backpressure / queueing.** Best-effort only. No in-process retry queue (rejected in Q2 ruling).
- **Cross-process signal delivery.** Same as above.
- **Modifications to P5.5/P5.6 analyzers.** The CAP-10.5 plumbing is upstream of those analyzers; their contract (`ProposalSignalSource.signals()`) is unchanged.
- **Renaming `CapabilityMeasurementOutcome.signals` or restructuring the outcome discriminated union.** Out of scope.
- **CLI `alix capability measure --replay-failed` or similar operational commands.** Out of scope for CAP-10.5; CAP-12+.
- **Decommissioning `ProposalSignalSource` in favor of event-log reads.** Explicitly rejected in Q1 ruling; CAP-10.5 keeps the source interface.

---

## 12. References

- `memory/cap-10-5-rulings-locked.md` — full rulings record.
- `memory/cap-10-a5-measurement-integration-complete.md` — CAP-10 closure; M1 deferral rationale.
- `docs/superpowers/specs/2026-08-13-cap-10-a5-measurement-integration-design.md` — CAP-10 design (ruling #12, #16).
- `docs/superpowers/plans/2026-08-13-cap-10-a5-measurement-integration.md` — CAP-10 plan (line 817, 1207, 1266).
- `src/capability/governance/proposal-identity.ts` — CAP-9 SHA-256 + canonical-JSON pattern; CAP-10.5 mirrors it for `computeSignalId`.
- `src/security/audit/canonical-json.ts` — `canonicalStringify` utility.
- `docs/superpowers/specs/2026-08-14-cap-11-remove-legacy-capability-surfaces-design.md` — precedent for sentinel-as-architecture-guard.
- `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md` — §10/§11 governance event prefix pattern.
