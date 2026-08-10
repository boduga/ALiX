# A7 — Capability Marketplace

**Design title:** A7.0 — Capability Lifecycle Governance (Propose → Decide → Record)
**Status:** Approved (2026-08-10)
**Depends on:** A0 (Evolution Contract), A3 (Governance Decision), A2.5 (Governance Recommendation), A4 (authorization gate), A5 (Outcome Observation), A6 (Knowledge Evolution), P5.5/P5.6 (Capability Evolution Intelligence), M-series Capability Registry
**Checkpoint target:** `alix-a7-capability-marketplace-complete`

---

## 1. Purpose

A7 is the governed lifecycle manager for capabilities. It consumes existing
capability intelligence (P5.5/P5.6 health, gap, overlap, drift), adoption
telemetry, and A-series evidence (A5 outcomes, A6 curated patterns), forms
**capability lifecycle proposals**, submits them through the existing A3
governance machinery, and persists the decision + intent in an append-only
**capability lifecycle ledger**.

A7.0 ships the **governed decision boundary**: Propose → Decide → Record.
A7.1 (future) owns the **governed application boundary**: Apply → Measure
(A4 binding + registry mutation + A5 post-application measurement).

**Core invariant:**
> A7.0 can create and govern a proposed capability lifecycle transition, but
> nothing in A7.0 can make that transition true. Only A7.1/A4 execution can.

---

## 2. Scope

### In scope (A7.0)
- Extend the A0 `EvolutionTargetKind` union with `"capability"` (additive contract change)
- Consume P5.5/P5.6 capability signals + telemetry + A5/A6 evidence (read-only)
- Form capability lifecycle proposals using the existing `EvolutionProposal` contract
- Submit through the existing A3 governance machinery
- Persist proposal/decision history in an append-only lifecycle ledger
- CLI: `alix capabilities {list,inspect,history,health,recommend,propose}`

### Out of scope (A7.0 — deferred to A7.1)
- Registry mutation (A7.0 never writes to the M-series CapabilityRegistry)
- New A4 execution primitive (capability mutation plan-step executor)
- A5 post-application outcome measurement
- "Applied"/"Measured" lifecycle events (reserved; must not exist in A7.0 records)

### Explicit non-goals
- A second capability registry (the M-series registry is the only source of current state)
- A second capability analysis engine (health/gap/overlap/drift remain P5.5/P5.6)
- A second proposal vocabulary parallel to `EvolutionProposal`
- An A7-specific governance recommendation shape

---

## 3. Architecture

A7 is an **evidence consumer and signal producer**, not a new evolution-pipeline
phase (per `docs/architecture/a-series-governed-evolution.md` §8). It sits
between the capability intelligence layer and the governance machinery.

```
Capability Platform / Registry (M-series)
        │  current state + telemetry
        ▼
P5.5 / P5.6 capability intelligence (health / gap / overlap / drift)
        │
        ▼
A5 observed evidence ──►  A7 lifecycle analyzer  ◄── A6 curated patterns
        │                        │
        │   EvolutionProposal    │ (targetKind = "capability")
        │                        ▼
        │                    A3 generateDecision
        │                        │
        │                 APPROVE / REJECT / MONITOR / REQUEST_MORE_EVIDENCE
        │                        │
        │                        ▼
        │              A7 capability lifecycle ledger (append-only)
        │                        │
        │                        ▼
        │            CLI: alix capabilities {list,inspect,history,health,recommend,propose}
        │
        └──────────► (A7.1) A4 governed execution → registry → A5 measurement
```

### Ownership model

| Concern | Owner |
|---------|-------|
| Current capability definition | M-series CapabilityRegistry |
| Runtime registration/unregistration | M-series CapabilityRegistry |
| Capability health/gap/overlap/drift | P5.5/P5.6 |
| Evolution proposal | A0 / A7 (existing contract) |
| Governance decision | A3 |
| Authorized mutation | A4 (A7.1 wiring) |
| Outcome measurement | A5 (A7.1 wiring) |
| Capability lifecycle history | A7 ledger |
| Historical evidence for future decisions | A7 ledger → A1 / A3 |

The marketplace/catalog view is a **projection** (registry current state +
ledger governance history), never another database.

---

## 4. Contract Extension

### 4.1 `EvolutionTargetKind += "capability"`

Add `"capability"` to the `EvolutionTargetKind` union and to
`VALID_EVOLUTION_TARGET_KINDS` in `src/evolution/contracts/evolution-contract.ts`.

**Why this is an additive, backward-compatible contract change:**
- Target kind is validated by membership in `VALID_EVOLUTION_TARGET_KINDS`
  (plain string array, `.includes()`). Adding one entry extends the validator.
- There are **zero exhaustive switches** over `EvolutionTargetKind` in the
  codebase. A3 switches on `GovernanceDecisionKind`; A4 checks
  `decision.kind === "APPROVE"`; the state machine passes `targetKind?: string`
  through opaquely. No exhaustive match breaks.
- The only typed consumer, `CATEGORY_TARGET_KIND_MAP`
  (`evolution-proposal-generator.ts`), is exhaustive over `PatternCategory`
  and maps to a *subset* of kinds; adding a kind changes nothing.
- **Precedent:** A6 extended `KnowledgeStore` with `"evidence"` in the
  review-fix pass (`78ff0e24`), a documented additive extension.

A7 lifecycle intents use:
```ts
target: { kind: "capability", id: capabilityId }
origin: "governance_signal" | "system_observation"
rationale: EvidenceReference[]
```

Treat the extension as a contract change: update the union, the validator, and
document it (spec §4.1 + commit message), the same discipline applied to the
A6 evidence-store extension.

---

## 5. Data Model

### 5.1 Lifecycle intent

```ts
type CapabilityLifecycleIntent =
  | "register"
  | "promote"
  | "modify"
  | "consolidate"
  | "deprecate";
```

The intent is **explicit in the ledger record** — never recovered indirectly
from the proposal.

### 5.2 Ledger record

Append-only JSONL under `.alix/capability-lifecycle/` (the A6-store pattern),
one record per event. The ledger is **history, never authority** — current
capability state always reads the M-series registry.

```ts
interface CapabilityLifecycleRecord {
  /** Unique immutable record identifier — see identity rule below. */
  recordId: string;
  /** Target capability reference. Multi-target for consolidation (A + B → C). */
  target: {
    /** Primary capability. For consolidation: the resulting/merged capability (C). */
    capabilityId: string;
    /** Related affected capabilities. For consolidation: the merged inputs (A, B). */
    relatedCapabilityIds?: string[];
  };
  /** Explicit lifecycle intent. */
  intent: CapabilityLifecycleIntent;
  eventType: "intent" | "proposed" | "decided";
  timestamp: string;
  /** References, never embedded authoritative state. */
  proposalId?: string;
  decisionId?: string;
  executionId?: string;      // A7.1 — absent in A7.0
  measurementId?: string;    // A7.1 — absent in A7.0
  evidenceRefs: string[];
  /**
   * The lifecycle state the registry reported when this record was created.
   * An observation, not a ledger-owned transition. "When I evaluated this
   * capability, the registry reported active."
   */
  observedLifecycleState: LifecycleState | null;
  /**
   * The lifecycle state REQUESTED by the proposal. Never asserts the registry
   * entered this state.
   */
  proposedLifecycleState: LifecycleState;
  decisionKind?: GovernanceDecisionKind;
}
```

**Identity rule:** `recordId` is generated once when the record is appended and
never changes. It is **not** the identity of the lifecycle proposal or decision
— those are carried by `proposalId` / `decisionId`, which are the authoritative
correlation identifiers. A timestamp is never part of the identity. Where a
deterministic ID is preferred, derive it from an existing immutable artifact:
- `intent` / `proposed` → `hash(proposalId + "<eventType>")`
- `decided` → `hash(decisionId + "decided")`

**Semantics (unambiguous):** An `APPROVE` + `deprecate` record with
`observedLifecycleState: active`, `proposedLifecycleState: deprecated` reads as
"governance approved the proposal to deprecate; the registry is still active."
No false `deprecated` history is written. A7.1 adds actual application evidence.

`LifecycleState` is the P5.5 lifecycle enum (`emerging | active | mature |
stagnant | declining | deprecated`) — imported, not redefined.

### 5.3 Derived per-capability state

A projection over (registry current state + latest A7 decision), **not stored**:

```
current registry state   ← authoritative
          +
latest A7 decision      ← governance history
          ↓
APPROVED_PENDING_APPLICATION   (when the latest decision is APPROVE and no
                                application has been recorded — i.e. always in A7.0)
```

A7.0 terminal states per capability:
- `REJECTED` — latest decision was a rejection
- `APPROVED_PENDING_APPLICATION` — latest decision was an approval; no A7.1 application

**`APPROVED_PENDING_APPLICATION` never enters `LifecycleState`.** It is a
governance-overlay projection state, not a capability lifecycle state. The
P5.5/M-series lifecycle enum remains `emerging | active | mature | stagnant |
declining | deprecated` — an A7 record's `observedLifecycleState` /
`proposedLifecycleState` only ever hold values from that enum.

There are **no** `APPLIED` or `MEASURED` events in A7.0. Those event types are
reserved for A7.1 and must not appear in A7.0 records.

---

## 6. Intelligence Layer

Pure `capability-lifecycle-analyzer`: consumes typed signal inputs, emits
lifecycle candidates, which the proposal builder converts to A0
`EvolutionProposal`s.

### 6.1 Signal inputs and ownership

```ts
interface CapabilitySignalInputs {
  health: CapabilityHealth[];      // P5.5 — ownership ONLY P5.5/P5.6
  gaps: CapabilityGap[];           // P5.5 — ownership ONLY P5.5/P5.6
  overlap: CapabilityOverlap[];    // P5.5 — ownership ONLY P5.5/P5.6
  drift: CapabilityDrift[];        // P5.5 — ownership ONLY P5.5/P5.6
  adoption: number;                // invocation count, success rate — telemetry
  outcome: VerificationEvidence[]; // A5 — outcome effectiveness
  patterns: PatternObservation[];  // A6 — corroborating evidence
}
```

**Anti-duplication invariant:**
> A7 does not independently infer capability health, drift, overlap, or gaps;
> those remain P5.5/P5.6 responsibilities. A7 consumes already-defined signals
> — it does not invent thresholds.

### 6.2 Intent triggers (consume, don't redefine)

| Intent | Consumed signal (already defined) |
|--------|-----------------------------------|
| `register` | P5.5 gap with `suggestedCapability` |
| `promote` | P5.5 health `lifecycleState` in `emerging`/`active` + adoption telemetry |
| `modify` | P5.5 drift `driftMagnitude > 0.5` (P5.5's split-candidate threshold) |
| `consolidate` | P5.5 overlap `consolidationCandidate` (score > 0.7, P5.5's threshold) |
| `deprecate` | P5.5 health `declining`/`stagnant` + adoption telemetry |

Where a threshold belongs to P5.5, A7 references it — it never redefines it.
The analyzer combines these signals deterministically (same inputs → same
candidates and proposal ordering).

---

## 7. Governance Bridge

A7 submits through the **existing** A-series governance chain — no parallel
recommendation protocol:

```
A7 intelligence
     ↓
A0 EvolutionProposal (targetKind = "capability")
     ↓
existing VerificationEvidence
     ↓
existing A2.5 GovernanceRecommendation (same evidenceId as the VerificationEvidence)
     ↓
A3 generateDecision(evidence, recommendation, { policyConfig })
     ↓
GovernanceDecision
     ↓
persist decision + append "decided" ledger record
```

Mirrors the A6 pattern in `curation-proposal-builder.ts` / `curation-cli.ts`.
A7 adds capability semantics at the **evolution-target** level only — never a
parallel governance vocabulary.

The `GovernanceDecision` records `decisionKind` (`APPROVE` / `REJECT` /
`MONITOR` / `REQUEST_MORE_EVIDENCE`) into the ledger. All are governance
outcomes, none imply application.

---

## 8. CLI

First-class namespace — the CLI expresses **what the operator is working with**
(capabilities), not which internal subsystem authorizes it.

```
alix capabilities
├── list                    # registry state + lifecycle overlay
├── inspect <id>            # one capability, full context
├── history <id>            # ledger events for one capability
├── health                  # read P5.5 capability-evolution report
├── recommend               # READ-ONLY: analyze + display candidate proposals
└── propose                 # GOVERNED: form EvolutionProposal → A3 → persist → record
```

**Safety invariant (explicit to the operator):**

> `alix capabilities recommend` is observational; `alix capabilities propose`
> is the first state-changing command.

| Command | Ledger write | A3 call | Registry mutation |
|---------|-------------|---------|-------------------|
| `recommend` | No | No | No |
| `propose` | Yes | Yes | No |

This matches the existing `alix governance recommend` convention (verified
read-only — generates + renders, no state writes), so `recommend` semantics
stay consistent across the CLI. `propose` is the explicit, separated governed
operation.

---

## 9. Error Handling

- **Ledger store never throws** on read: missing dir → empty list (A6 pattern); corrupt JSONL lines skipped (reuse `parseLines` pattern from `learning-store.ts`).
- **Analyzer is pure**: empty/missing signal inputs → empty candidates, never an exception.
- **CLI**: unknown subcommand → usage + exit 1; unknown capability id → error + exit 1; `propose` with no candidates → "No capability lifecycle proposals" + exit 0 (no A3 call — mirrors A6 zero-findings invariant).
- **Missing P5.5 report**: `health` / `recommend` degrade to a clear message ("no capability-evolution report — run `alix adaptation capability-evolution` first") rather than inventing data.

---

## 10. Testing

Mirror the A5/A6 test layout. Suites under `tests/evolution/capability-lifecycle/`
(matching the module's location `src/evolution/capability-lifecycle/`):

| Suite | Covers |
|-------|--------|
| `evolution-target-contract.test.ts` | `"capability"` accepted; all prior target kinds still valid |
| `capability-lifecycle-record.test.ts` | record validation, observed/proposed semantics, multi-target consolidate, no `applied`/`measured` event types |
| `capability-lifecycle-ledger.test.ts` | append-only, list-by-capability, list-by-intent, corrupt-line resilience, read-only guarantees |
| `capability-lifecycle-analyzer.test.ts` | intent triggers from P5.5 signals, determinism, anti-duplication (no threshold redefinition) |
| `capability-proposal-builder.test.ts` | candidates → A0 `EvolutionProposal` (targetKind `capability`, evidence refs, origin) |
| `capability-governance-bridge.test.ts` | A3 round-trip: `VerificationEvidence` + A2.5 `GovernanceRecommendation` → `GovernanceDecision` |
| `capability-cli.test.ts` | `list/inspect/history/health/recommend/propose`, JSON mode, exit codes, recommend-is-read-only, propose-is-governed |
| `integration/a7-capability-lifecycle-integration.test.ts` | end-to-end: signals → analyzer → proposal → A3 decision → ledger record |

**Critical invariant tests:**
- **Deterministic candidates + ordering**: same signal inputs twice → identical candidates, proposals, and ledger record ordering
- **No mutation**: analyzer never mutates its signal inputs (frozen-input assertion)
- **Approval never mutates registry** (the strongest guard for the core invariant): after an `APPROVE`, assert the M-series registry capability state is unchanged
- **No fake lifecycle state**: an approved record never reports `applied`/`measured`; `observedLifecycleState` reflects the registry, `proposedLifecycleState` the request
- **Missing signals**: absent P5.5 report → empty candidates + clear CLI message, no invented data
- **Zero candidates**: no proposal, no A3 call, no ledger write

**Success criteria:** all 8 suites pass; the "approval never mutates registry"
integration assertion is green; determinism tests green.

---

## 11. A7.1 Boundary (future increment)

A7.1 — **Capability Lifecycle Execution (Apply → Measure)**:
- A new A4 execution primitive (plan-step executor) for capability mutations
- Registry mutation on APPROVE (register/unregister/metadata update/merge/deprecate)
- A5 post-application measurement
- `applied` / `measured` ledger events
- CLI: `alix capabilities apply`, `status`, `measure`

A7.0 is designed so A7.1 is comparatively mechanical: the governance contract,
ledger, and lifecycle semantics already exist.

---

## 12. References

| Resource | Location |
|----------|----------|
| A-series governed evolution architecture | `docs/architecture/a-series-governed-evolution.md` |
| A6 Knowledge Evolution design | `docs/superpowers/specs/2026-08-10-a6-knowledge-evolution-design.md` |
| P5.5/P5.6 Capability Evolution types | `src/adaptation/capability-evolution-types.ts` |
| A0 Evolution Contract | `src/evolution/contracts/evolution-contract.ts` |
| A2.5 Governance Recommendation | `src/evolution/verification/contracts/recommendation-contract.ts` |
| A3 Governance Decision | `src/evolution/governance/decision-engine.ts` |
| A4 Authorization gate | `src/evolution/execution/execution-authorization.ts` |
| A6 A3 bridge pattern | `src/evolution/knowledge/curation-proposal-builder.ts`, `curation-cli.ts` |
| M-series Capability model | `src/capability/types.ts`, `registry.ts` |
| P5.5 report CLI | `src/cli/commands/adaptation.ts` (`capability-evolution` subcommand) |
