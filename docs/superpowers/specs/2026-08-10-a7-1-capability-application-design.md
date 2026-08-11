# A7.1 — Capability Lifecycle Application (Apply → Measure) Design

**Status:** Approved
**Date:** 2026-08-10
**Supersedes boundary in:** `docs/superpowers/specs/2026-08-10-a7-capability-marketplace-design.md` §11
**Depends on:** A7.0 (governed DECISION boundary — Propose → Decide → Record) complete on `main`

## 1. Purpose

A7.1 closes the A7.0 loop: it makes an approved lifecycle transition **true**.
A7.0 is the governed DECISION boundary (Propose → Decide → Record). A7.1 is the
governed **APPLICATION** boundary (Apply → Measure): A4 binding + registry
lifecycle mutation + A5 post-application measurement.

Core invariant (from A7.0, unchanged):

> A7.0 creates/proposes governed capability lifecycle transitions, but nothing
> in A7.0 makes a transition true. Only A7.1/A4 execution can.

## 2. Scope

### In scope (A7.1)

- **M-series registry lifecycle overlay** — `CapabilityRegistry` gains a
  co-located `lifecycle: Map<string, LifecycleState>` (parallel to `status`),
  with `applyLifecycleTransition(id, to)` and `getLifecycleState(id)`.
- **A4 governed execution binding** — the applier is an A4 *binding*: it loads
  the authoritative proposal + decision, runs the A4 pre-flight gate, builds an
  A4 execution plan, and drives it through the A4 `GovernedExecutionRuntime`
  with an injected capability-lifecycle step executor. **Not** a
  gate-then-mutate bespoke executor.
- **`applied` / `measured` lifecycle events** — activated from A7.0's reserved
  seams; `executionId` / `measurementId` become first-class record fields.
- **Full `GovernanceDecision` persisted on `decided` records** — append-only
  history holds the A3 artifact, enabling rehydration (and satisfying A4's
  integrity-hash check) across CLI invocations.
- **CLI:** `alix capabilities apply <id>` and `alix capabilities measure <id>`.
- **A5 post-application measurement** vs the pre-application baseline.
- **Projection states** `APPLIED` / `MEASURED`.

### Out of scope (deferred — explicit)

| Intent | A7.1 | A7.1 behavior |
|--------|------|---------------|
| `promote` | ✅ executable | `capability.transition` {capabilityId, to} |
| `deprecate` | ✅ executable | `capability.transition` {capabilityId, to} |
| `consolidate` | ✅ executable | **deprecatory consolidation** — plan = N `capability.transition` steps deprecating each `relatedCapabilityId`; **preserves the primary capability**; no definition merge in A7.1 |
| `register` | ❌ deferred | not executable — requires a governed capability-definition artifact; A7.0 may generate/approve it, but it stays `APPROVED_PENDING_APPLICATION` until a future increment defines governed registration |
| `modify` | ❌ deferred | not executable — no coherent overlay-only meaning; deferred until a governed metadata-mutation contract exists |

> **A7.1 consolidation is deprecatory consolidation, not definition merging.**
> Anyone later interpreting the current implementation as a true capability
> merge is misreading the contract.

There is exactly **one physical executor operation**: `capability.transition`
(`capabilityId` → `LifecycleState`). This is intentional — inventing four
artificial executor operations for the four intents would be needless surface.

### Non-goals

- A second capability registry (the M-series registry remains the only
  current-state source).
- A second authorization mechanism (A4's gate is used; A3 remains the
  decision authority).
- Bypassing A3/A4 — A7.1 adds an A4 binding where the roadmap requires one,
  nothing more.
- Definition/metadata payloads in proposals (register/modify deferred for this
  reason).
- A5 effectiveness *determination* — A7.1 produces the inputs; A5's existing
  contract judges effectiveness.

## 3. Architecture

```
A3 APPROVE
   │
   ▼
A7.1 apply <id>  ── rehydrate authoritative proposal + full decision from ledger
   │
   ▼
authorizeExecution(request, proposal, decision, completedExecutionIds)   [7 checks]
   │                                     │
   │ denied                              │ allowed
   ▼                                     ▼
error, exit 1                   createExecutionPlan(proposal, decision, env, resolver)
(no mutation, no record)                       │
                                        GovernedExecutionRuntime.execute(plan, executor)
                                                │
                                    CapabilityLifecycleStepExecutor
                                                │
                                    registry.applyLifecycleTransition  (pre-state snapshot)
                                                │
                                          plan completed
                                                │
                                    append applied record (+executionId)   ← COMMIT POINT
                                                │ failure → executor.rollbackApplied() → report failure
                                                ▼
A7.1 measure <id> ── latest applied ──► A5 observation (post) vs baseline (pre)
                                                │
                                    append measured record (+measurementId, baseline+post refs)
```

## 4. Executable intent boundary

| A7.0 intent | A7.1 executable? | Behavior |
|-------------|------------------|----------|
| `promote` | ✅ | single `capability.transition` to `proposedLifecycleState` |
| `deprecate` | ✅ | single `capability.transition` to `proposedLifecycleState` |
| `consolidate` | ✅ as deprecatory consolidation | plan = one `capability.transition` per `relatedCapabilityId` to `deprecated`; primary untouched |
| `register` | ❌ | not executable — requires governed definition artifact |
| `modify` | ❌ | not executable — requires governed metadata-mutation contract |

Applying a deferred intent → error `capability:<intent> is not executable in A7.1
(<reason>)` + exit 1, **no mutation, no ledger write**; projection stays
`APPROVED_PENDING_APPLICATION`.

## 5. Contract extension

### 5.1 Lifecycle event types

`CapabilityLifecycleEventType` extends:
```ts
type CapabilityLifecycleEventType = "intent" | "proposed" | "decided" | "applied" | "measured";
```

### 5.2 Ledger record

`CapabilityLifecycleRecord` gains:
```ts
interface CapabilityLifecycleRecord {
  // ...existing fields...
  /** A7.1 — present on `applied` records. */
  executionId?: string;
  /** A7.1 — present on `measured` records. */
  measurementId?: string;
  /** A7.1 — full GovernanceDecision on `decided` records (enables rehydration). */
  decision?: GovernanceDecision;
  /** A7.1 — measured records reference both pre-application baseline and post-application observation. */
  baselineEvidenceRefs?: string[];
  postObservationRefs?: string[];
}
```

### 5.3 Validation rules

- `decided` still requires decisionId + proposalId + decisionKind, and still
  **forbids** executionId/measurementId (a decision is not an application).
- `applied` requires `executionId` + `decisionId`; forbids `measurementId`.
- `measured` requires `measurementId`; references `baselineEvidenceRefs` and
  `postObservationRefs`.
- `register`/`modify` records may be `decided` but never `applied` (executor
  has no step for them).

### 5.4 Projection states

`CapabilityProjectionState` extends:
```ts
type CapabilityProjectionState =
  | "PROPOSED"
  | "REJECTED"
  | "APPROVED_PENDING_APPLICATION"
  | "APPLIED"        // latest event is `applied`
  | "MEASURED";      // latest event is `measured`
```

`deriveCapabilityProjectionState` extends accordingly. `APPLIED`/`MEASURED`
remain governance-overlay projection states — **never** values in `LifecycleState`.

### 5.5 M-series registry overlay

```ts
class CapabilityRegistry {
  // New — co-located lifecycle overlay, parallel to `status`.
  applyLifecycleTransition(id: string, to: LifecycleState): void;  // throws on unknown id
  getLifecycleState(id: string): LifecycleState | undefined;
  // `register`/`unregister` maintain the overlay map.
}
```

## 6. A4 binding

### 6.1 Rehydration (authoritative, not "minimal reconstruction")

The applier rehydrates both A4 inputs from the ledger — no reduced synthesis for
authorization:

- **`decision`** — the full `GovernanceDecision` persisted on the `decided`
  record. This satisfies `authorizeExecution` check 3, which recomputes
  `computeDecisionIntegrityHash(decision)`.
- **`proposal`** — `toExecutionProposal(record)`, an explicit A7.1 projection:
  a full `EvolutionProposal` (proposalId, evolutionId, title, description,
  change, beforeHash=null, afterHash=null, createdAt — all from the ledger's
  authoritative intent/decided records) **plus** a `changes` array.

`EvolutionProposal` is a **closed interface** (verified in
`src/evolution/contracts/evolution-contract.ts`) with **no `changes` field**.
A4's planner duck-types `"changes" in proposal`; absent, it emits a generic
`apply_proposal` fallback step. A7.1 therefore introduces an explicit superset
projection — it does **not** modify the A0 governance contract:

```ts
interface CapabilityChangeStep {
  operation: "capability.transition";          // exactly one physical op
  parameters: { capabilityId: string; to: LifecycleState };
  idempotent: true;
  preconditions: Record<string, unknown>;
  postconditions: Record<string, unknown>;
}
type CapabilityExecutionProposal = EvolutionProposal & { changes: CapabilityChangeStep[] };
```

`createExecutionPlan`'s `resolveSteps` maps these `changes` to plan steps; the
plan is deterministic and reproducible (deterministic rehydration + deterministic
planner hashing of `canonicalStringify(proposal)`).

### 6.2 The applier flow

```
1. ledger.listByCapability(id) → latest decided
   - none / not APPROVE / intent is register|modify → error, exit 1, no side effects
2. ExecutionRequest:
   { requestId, evolutionId: proposal.evolutionId, requestedBy: "alix", requestedAt }
3. authorizeExecution({request, proposal, decision, completedExecutionIds})
   - completedExecutionIds = decisionIds already applied for this capability
     (dedup — gate check 7)
   - denied → print gate reason, exit 1, no mutation, no write
4. createExecutionPlan(proposal, decision, environment, resolver)
   - environment: { environmentId, environmentHash: "a7-capability", runtimeVersion,
     agentConfiguration: {}, baselineMetrics: {}, capabilityFingerprint }
5. executor = new CapabilityLifecycleStepExecutor(registry, preStateSnapshot)
   - preState captured IMMEDIATELY before execution (see §7)
6. report = await runtime.execute(plan, executor)
   - report.status !== "completed" → executor.rollbackApplied(); exit 1, no write
7. append applied record (+executionId from runtime context)   ← COMMIT POINT
   - append throws → executor.rollbackApplied(); rethrow → exit 1
8. success
```

### 6.3 CapabilityLifecycleStepExecutor

```ts
class CapabilityLifecycleStepExecutor implements StepExecutor {
  // preState: Map<string, LifecycleState | undefined> — snapshot at construction.
  // rollbackApplied(): idempotent compensation — restores every touched id to
  //   its pre-execution value (or clears it if it had none). Does NOT recompute
  //   pre-state during rollback (see §7).
}
```

The executor dispatches on `step.operation === "capability.transition"` and
applies `registry.applyLifecycleTransition(capabilityId, to)` for each step
(a consolidation plan = multiple steps).

### 6.4 Rollback resolver

The default rollback resolver (`createDefaultRollbackResolver`) gains a
registered `capability.transition` operation → an **automatic, safe** rollback
step (`rollbackType: "automatic"`, `safe: true`) that restores the pre-apply
overlay state. This covers mid-plan step failure inside the runtime.

## 7. Atomicity and compensating rollback

Two mechanisms, two distinct failure windows — they never fight:

1. **A4 runtime in-plan rollback** (`execution-runtime.ts`) handles failure
   *during* execution (step failure, precondition/postcondition failure) via the
   `capability.*` resolver.
2. **`executor.rollbackApplied()`** handles the failure that happens *after* the
   runtime has returned `completed` but *before* the durable A7 commit — the
   ledger append. A4's runtime provides no post-completion rollback handle
   (verified: `execute()` returns an `ExecutionReport`; rollback only triggers
   in-plan), so A7.1 owns a bounded compensating rollback on the executor.

Sequence:
```
authorize
   ↓
execute plan
   ↓
runtime COMPLETED
   ↓
append applied record
   ├── success → committed
   └── failure → executor.rollbackApplied() → restore pre-state → report failure
```

**Implementation requirement (preserved from review):** capture the pre-state
snapshot **immediately before execution**; **do not recalculate it during
rollback**. Otherwise a rollback could restore a later state rather than the
state this execution actually displaced. `rollbackApplied()` is idempotent, so
if both mechanisms ran, the overlay ends at pre-state exactly once.

**Durability note:** the registry overlay is in-memory (parallel to
`CapabilityStatus`, which is in-memory in Phase 1). Rollback is in-process
(restore the pre-state map value). Persistence of the overlay is out of scope.
On restart, the overlay is **rehydrated from the ledger** (see §8).

## 8. Authority model

> **The A7 lifecycle ledger is authoritative for lifecycle history and governed
> transition state. The M-series `CapabilityRegistry` remains authoritative for
> current runtime capability state.**

```
A7 lifecycle ledger ──► governed history / transition state
        │
        └──► rehydration ──► registry lifecycle overlay ──► current runtime view
```

The registry's lifecycle overlay (in-memory, Phase-1) is a runtime projection
rehydrated from the ledger after restart — **ledger → rehydrate overlay →
registry runtime view** — and never replaces the registry as current-state
authority. This preserves A7.0's ownership model; the ledger is not a second
registry.

## 9. Measurement (A5 post-application observation)

`measure <id>`:
1. Ledger → latest `applied` record; absent → error, exit 1.
2. **Baseline (pre-application):** the `applied` record references the
   `decided`/`intent` record's `observedLifecycleState` + P5.5 health at propose
   time. These are the pre-application evidence/baseline.
3. **Post-application observation:** latest P5.5 health for the capability from
   `CapabilityEvolutionStore` (reads only; never re-analyzes — P5.5 owns
   analysis).
4. Build A5 outcome `VerificationEvidence` (evidenceClass `"observed"`,
   reproducibilityLevel 2) via the existing A5 observation evidence path,
   `measurementId = a7-meas-<hash16>`.
5. Append `measured` record referencing **both** the baseline
   (`baselineEvidenceRefs`) and the post-application observation
   (`postObservationRefs`) + a recorded state-transition assertion
   (e.g. `declining → deprecated`).

Effectiveness (did the governed change produce the intended outcome) is A5's
determination per its existing contract — A7.1 produces the inputs, not the
verdict.

## 10. CLI

`alix capabilities` gains:
- `apply <id>` — rehydrate → authorize → plan → execute → append `applied`.
- `measure <id>` — observe post-application vs baseline → append `measured`.

`list` / `inspect` / `history` render the overlay lifecycle state and the
extended projections (`APPLIED`/`MEASURED`).

## 11. Error handling

| Condition | Behavior |
|-----------|----------|
| `apply` latest record not APPROVE / missing | error + exit 1, no side effects |
| `apply` intent is `register` / `modify` | `not executable in A7.1` error + exit 1, no side effects |
| `authorizeExecution` denied | gate reason + exit 1, no mutation, no write |
| plan fails mid-execution | A4 in-plan rollback + exit 1, no write |
| ledger `applied` append fails | `executor.rollbackApplied()` → restore pre-state → exit 1 |
| `measure` with no `applied` record | error + exit 1 |

Every failure leaves the registry byte-identical unless the gate passed AND the
plan completed AND the ledger append committed.

## 12. Testing

### Unit suites
- **registry-overlay** — apply/get, register/unregister maintenance, unknown-id throw.
- **contract** — `applied`/`measured` validation rules; `decided` carries
  `decision`; projection transitions
  (PROPOSED → REJECTED → APPROVED_PENDING_APPLICATION → APPLIED → MEASURED).
- **rehydration** — `toExecutionProposal` produces a full valid `EvolutionProposal`
  + `changes`; deterministic; closed interface unchanged.
- **applier (A4 binding)** — gate-allowed apply mutates overlay + writes
  `applied`; gate-deny → no mutation, no write; duplicate decision blocked;
  `register`/`modify` → not-executable, no write.
- **executor + rollback** — **consolidation all-or-nothing**: A=active, B=active,
  C=active; B step succeeds, C step fails → A=active, B=active (restored),
  C=active (restored), **no `applied` ledger record**.
- **measurer** — `measured` links measurementId + baseline/post refs; no applied → error.

### Integration (full lifecycle)
- End-to-end `deprecate`: analyze → govern → decide → apply → measure, projection
  walking through every state.
- **Atomicity (byte-identical registry):** inject a failing ledger append;
  assert registry canonical state (`canonicalStringify`) is byte-identical after
  the failed apply.
- approval-mutates-only-on-apply: registry overlay unchanged until the gate
  passes and the plan completes.
- rehydration: overlay rebuilt from ledger after simulated restart.

## 13. Implementation guidance (contract-first order)

1. **Registry overlay** (`src/capability/registry.ts` + test) — the mutation surface.
2. **Contract extension** (`contracts/lifecycle-contract.ts` + test) — event
   types, record fields, projection states, validator.
3. **Rehydration projection** (`toExecutionProposal` + `CapabilityExecutionProposal`
   + `CapabilityChangeStep` + test).
4. **CapabilityLifecycleStepExecutor** + **rollback resolver** `capability.*`
   + tests (incl. consolidation all-or-nothing).
5. **Applier** (A4 binding: authorize → plan → execute → compensating rollback)
   + tests.
6. **Measurer** + tests.
7. **CLI** `apply`/`measure` + wiring + tests.
8. **Integration + invariant tests** (full walk, atomicity, rehydration).
9. **Closure** — checkpoint doc + roadmap + tag `alix-a7-1-capability-application-complete`.

## 14. References

- A7.0 spec: `docs/superpowers/specs/2026-08-10-a7-capability-marketplace-design.md`
- A7.0 checkpoint: `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`
- A4 runtime: `src/evolution/execution/execution-runtime.ts`
- A4 planner: `src/evolution/execution/execution-planner.ts`
- A4 gate: `src/evolution/execution/execution-authorization.ts`
- Registry: `src/capability/registry.ts` / `src/capability/types.ts`
- A5 observation: `src/evolution/observation/*`
- A7 lifecycle ledger: `src/evolution/capability-lifecycle/*`
