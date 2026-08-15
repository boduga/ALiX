# A8 — Organizational Learning Design

**Status:** Design (brainstorm → spec → plan → SDD → closeout)
**Date:** 2026-08-14
**Author:** A8 spec drafting session
**Parent program:** ALiX A-series autonomous evolution; closes the wayfinder map #517 next-frontier authorization
**Depends on:** A6 (Knowledge Evolution, shipped), A3 (Governance Decision), A5 (Outcome Observation), EventLog (CAP-9), P10.8a (`EnrichedProposal` pipeline)
**Checkpoint target:** `alix-a8-organizational-learning-complete`
**Locked by:** post-A8 wayfinder map #517 close-out (8 architectural rulings)

## 1. Problem

The A-series roadmap (`docs/architecture/ma0-alix-architecture-2-0.md` §A8) describes A8 as "Organizational Learning: learns from all past proposals, recommendations, outcomes, and operator choices; improves decision quality over time." Designed at roadmap level only; no implementation. The post-A8 wayfinder map #517 (closed 2026-08-14) charted the prerequisites and locked 8 architectural rulings. A8 is the next executable frontier.

## 2. Goal

A8 detects organizational patterns across the proposal/measurement/recommendation history and surfaces them as diagnostic `LearningProposal` artifacts. A8 routes these proposals through the standard A2.5 `GovernanceRecommendation` + A3 `generateDecision()` seam, producing MONITOR outcomes. A8 does NOT mutate governance configuration, A5 measurement policy, A7 proposal-generation policy, or capability mutations. A8 is organizational learning, NOT organizational self-modification.

## 3. Non-goals

- **No A8 self-modification.** A8 is read-only against existing canonical sources; never mutates governance config, A5 policy, A7 bias, or capability definitions.
- **No executable `LearningProposal`.** Proposals are diagnostic only. The A2.5 bridge constructs MONITOR; A3 returns MONITOR or REQUEST_MORE_EVIDENCE only — never APPROVE on an A8 proposal.
- **No governance bypass.** All routing flows through A2.5 → A3. No parallel governance path.
- **No new A8 persistence store.** A8 may produce read-only adapter projections; it must not introduce a new persistence layer (consume existing EventLog, P10.8a `EnrichedProposal[]`, and shipped P10 stores).
- **No 4th detector.** If implementation surfaces a need, that's a new architectural increment.
- **No A6 domain type reuse.** A6's `CurationProposal` is incompatible (different domain: knowledge artifacts vs capability targets; different identity: content-addressed vs SHA-256; different persistence). A8 owns its own contracts.
- **No executor / capability-catalog mutator imports.** A8 is read-only end-to-end.
- **No A9 implementation.** Designed at roadmap level only — not actionable yet.
- **No TUI/Web surfaces.** CAP-11 territory per CAP-8 ruling.
- **No CAP-P resumption.** Pending P5.5/P5.6 analyzer work.
- **No M2/M3.** Non-blocking per post-CAP-N Ticket B verdict.
- **No speculative strategy-tuning.** A8 does NOT recommend threshold changes, retry-policy changes, or risk-class remapping. Those would be a new architectural increment.

## 4. Architecture

### 4.1 Module structure (locked)

A8 mirrors A6's `src/evolution/knowledge/` structure in `src/evolution/learning/`. The pattern is reused; the domain is independent.

```
src/evolution/learning/
├── contracts/
│   └── learning-contract.ts — LearningFinding, LearningFindingKind, LearningProposal, LearningAdapter
├── detectors/
│   ├── underperformer-detector.ts
│   ├── outcome-contradiction-detector.ts
│   └── repeated-pattern-failure-detector.ts
├── adapters/
│   ├── proposal-events-adapter.ts   — read-only over EventLog capability.governance.proposal.*
│   ├── measurement-events-adapter.ts — read-only over EventLog capability.governance.measurement.*
│   └── enriched-proposals-adapter.ts — read-only over EnrichedProposal[] (P10.8a)
├── learning-engine.ts              — runs detectors, aggregates findings → proposal
├── learning-proposal-builder.ts   — findings → LearningProposal
├── learning-cli.ts                 — CLI handler for `alix governance evolution learn`
└── index.ts                        — barrel re-exports
```

Each module earns its existence through a distinct contract/seam — no mechanical 1:1 file symmetry with A6. Adapters are read-only; detectors are pure functions over normalized input.

### 4.2 Core contracts (locked)

```typescript
// Three detector kinds, aligned with the three pure detectors.
export type LearningFindingKind =
  | "underperformer"             // repeated ineffective outcomes on same capability/pattern
  | "outcome-contradiction"       // repeated divergence between recommendation and operator/governance disposition
  | "repeated-pattern-failure";  // repeated execution failures with same fingerprint

export interface LearningFinding {
  readonly findingId: string;
  readonly kind: LearningFindingKind;
  readonly identityKey: string;            // grouping key (capabilityId, fingerprint, etc.)
  readonly evidenceWindow: { readonly from: string; readonly to: string };
  readonly occurrences: number;            // count within window
  readonly evidenceRefs: ReadonlyArray<string>;  // EventLog eventIds / proposalIds — preserved exactly
  readonly summary: string;                 // human-readable
}

// LearningProposal: aggregate of findings from a single engine run.
// CRITICAL: has NO mutation/execution fields and CANNOT be converted
// directly into a capability mutation. This is a structural boundary,
// not just a convention.
export interface LearningProposal {
  readonly proposalId: string;
  readonly generatedAt: string;
  readonly findings: ReadonlyArray<LearningFinding>;
}

// Read-only adapter over a specific evidence source.
export interface LearningAdapter<T> {
  readonly name: string;
  list(): Promise<ReadonlyArray<T>>;
}
```

### 4.3 Architectural progression (locked)

```
EventLog + EnrichedProposal[] (P10.8a)
   │
   ├── proposal-events-adapter   ─┐
   ├── measurement-events-adapter ─┼──► 3 read-only adapters
   └── enriched-proposals-adapter ┘
                                     │
                                     ▼
                          underperformer-detector
                          outcome-contradiction-detector
                          repeated-pattern-failure-detector
                                     │
                                     ▼
                          LearningFinding[] (pure, deterministic)
                                     │
                                     ▼
                          LearningProposal (non-executable; no findings → no proposal)
                                     │
                                     ▼
                          A2.5 bridge → GovernanceRecommendation(kind: MONITOR)
                                     │
                                     ▼
                          A3 generateDecision() → MONITOR / REQUEST_MORE_EVIDENCE
                                     │
                                     ▼
                          Human/operator governance
```

**No trigger → no proposal:** if all 3 detectors return 0 findings, the engine emits no `LearningProposal` at all (not an empty proposal). This avoids creating meaningless MONITOR governance artifacts.

### 4.4 Adapters (locked)

Three independent read-only adapters. Each returns normalized evidence from one source:

**(a) `proposal-events-adapter`** — consumes `CapabilityGovernanceEvent[]` from EventLog (the 5 `capability.governance.proposal.*` event types: submitted, approved, rejected, executed, execution_failed). Returns normalized records: `{ proposalId, capabilityId, kind, operatorDecision?, recommendation?, evidenceRefs, recordedAt }`.

**(b) `measurement-events-adapter`** — consumes `CapabilityMeasurementEvent[]` from EventLog (the 2 `capability.governance.measurement.*` event types: measured, signals_unpublished). Returns normalized records: `{ proposalId, capabilityId, outcome, sourceProposalIds, recordedAt }`.

**(c) `enriched-proposals-adapter`** — consumes `EnrichedProposal[]` from P10.8a (the `EnrichedProposal` pipeline). Returns normalized records: `{ proposalId, capabilityId, enrichedFields, recordedAt }`.

**Adapters never join or transform into findings.** Joins happen above the adapter boundary (in the engine, joining across adapter outputs).

### 4.5 Detectors (locked)

All 3 detectors are **pure functions** over normalized input. Each gets a deterministic, explicit predicate.

**(a) `underperformer-detector`:**
- Consumes: `measurement-events-adapter` output (normalized `CapabilityMeasurementEvent[]`)
- Identity key: `capabilityId`
- Normalization: group outcomes by `capabilityId` within window; count occurrences where `outcome === "ineffective"`
- Required evidence: the source `proposalIds` whose measurement produced the ineffective outcomes
- Trigger: count >= minimum cardinality (concrete value deferred to plan)

**(b) `outcome-contradiction-detector`:**
- Consumes: `proposal-events-adapter` output (governance lifecycle events)
- Identity key: `capabilityId`
- Normalization: for each capability, correlate each proposal's recorded A2.5 recommendation with the subsequent operator/governance disposition. A contradiction exists when the disposition differs from the recommendation's actionable kind: recommendation = APPROVE, operator = REJECT, or recommendation = REJECT, operator = APPROVE.
- Required evidence: `proposalId`, recommendation `kind`/`confidence`/`evidenceRefs`, operator `decision`/`reason`
- Trigger: contradictions on same `capabilityId` within window >= minimum cardinality (concrete value deferred to plan)
- **CRITICAL:** detector does NOT judge whether the operator was objectively right or wrong. A8 learns from organizational behavior; it does not score governance decisions.

**(c) `repeated-pattern-failure-detector`:**
- Consumes: `proposal-events-adapter` output (`execution_failed` events)
- Identity key: normalized failure fingerprint (e.g., `errorCategory:capabilityId`)
- Normalization: group `execution_failed` events by fingerprint within window; count occurrences
- Required evidence: the `eventIds` sharing the fingerprint
- Trigger: count >= minimum cardinality (concrete value deferred to plan)

**Detector purity invariant:** no I/O, no implicit clock. Engine passes a deterministic timestamp; same input + same timestamp → identical findings.

**Concrete threshold values** (minimum cardinality, evidence window duration) are deferred to the plan phase after reconnaissance confirms appropriate defaults. The spec defines the **predicate structure**; the plan establishes **concrete defaults**. Threshold configuration lives in the engine options (`LearningEngineOptions`) — composed at the composition root — and is passed read-only to each detector.

### 4.6 Engine + proposal builder (locked)

- `LearningEngine.learn(timestamp)` runs all 3 detectors against the joined adapter outputs. Joins happen here, not in adapters.
- `LearningEngine.learn(timestamp)` returns `LearningProposal | null` — `null` if total findings = 0 (the "no trigger → no proposal" invariant).
- `LearningProposalBuilder.build(findings, timestamp)` constructs the `LearningProposal`. Pure function.
- The A2.5 bridge (`buildGovernanceRecommendation(learningProposal)`) constructs `GovernanceRecommendation` with `kind: "MONITOR"`. A8's only emission is MONITOR; never APPROVE/REJECT.

### 4.7 CLI (locked)

`alix governance evolution learn [--dimension ...] [--json]`

Single namespace. The detector taxonomy is internal; the operator surface is `learn`. Output: the `LearningProposal` (or a "no findings" notice if no proposal was emitted). `--json` emits structured output for downstream tooling.

CLI registration via the minimum existing CLI registration seam — A8 does NOT introduce a new CLI binary. The CLI registration touch is the only permitted modification outside `src/evolution/learning/` and A8-specific tests.

## 5. Data flow

1. Engine initializes with 3 adapters (composition-root-owned; A8 doesn't instantiate adapters itself).
2. Operator invokes `alix governance evolution learn` (or programmatic equivalent).
3. Engine calls each adapter's `list()`, gets normalized evidence.
4. Engine runs each of the 3 pure detectors over its assigned evidence.
5. Engine aggregates findings into a single `LearningProposal` (or returns `null` if 0 findings).
6. A2.5 bridge builds `GovernanceRecommendation(kind: "MONITOR")` from the proposal.
7. A3 `generateDecision()` returns MONITOR or REQUEST_MORE_EVIDENCE based on recommendation + evidence profile.
8. CLI surfaces the decision + the underlying `LearningProposal`.

A8 never writes to EventLog, ProposalStore, or any other store. A8 is observation only.

## 6. Composition root

No new composition-root ownership. The 3 adapters are constructed by the composition root at `src/capability/platform.ts` (or equivalent) and passed to `LearningEngine` at construction. A8 does NOT introduce new persistent state.

## 7. Migration boundary

No migration. A8 introduces a new read-only module; no existing data structures change. Existing A6, CAP-N, CAP-O, CAP-P-deferred, EventLog, P10.8a, A2.5, and A3 modules are consumed unchanged.

## 8. Error handling

- **Adapter failure** — engine catches and logs; engine continues with partial evidence (other adapters' results still valid). Findings carry an `evidenceSourceUnavailable` annotation when their source adapter failed.
- **Detector throw on malformed input** — engine catches per-detector; continues with remaining detectors. Failures are surfaced via the CLI but do not abort the engine run.
- **A3 returns REJECT** — possible if `verificationEvidence` is malformed (per A3's `failClosedOnExpiredEvidence`). A8's bridge constructs minimal evidence so A3 should not reject under normal operation; if it does, surface the failure to the operator.

## 9. Testing strategy

### 9.1 Unit tests — `tests/evolution/a8-learning-detectors.vitest.ts`

Per detector:
- Empty input → 0 findings
- Below minimum cardinality → 0 findings
- At/above minimum cardinality on same identity key → 1 finding
- Above minimum cardinality split across identity keys → N findings
- Determinism: same input + same timestamp twice → identical findings
- Evidence references preserved exactly in each finding

Engine aggregation:
- Multiple findings from different detectors → 1 `LearningProposal`
- 0 findings across all detectors → `null` (no proposal emitted)

### 9.2 Adapter tests — `tests/evolution/a8-adapters.vitest.ts`

- Each adapter's `list()` returns expected normalized shape
- Read-only invariant: no mutation surface exposed on adapter interfaces
- Empty source store → empty list

### 9.3 Integration test — `tests/evolution/a8-engine-end-to-end.vitest.ts`

- Engine runs all 3 detectors on synthetic EventLog + `EnrichedProposal[]` fixtures
- Full flow: adapters → detectors → `LearningProposal` → A2.5 `GovernanceRecommendation(kind: "MONITOR")` → A3 `generateDecision()` → MONITOR outcome
- **Explicit assertion:** A8 can never produce APPROVE/REJECT (architectural invariant)
- 0-finding run → `null` → no A2.5 call → no A3 call

### 9.4 Sentinel test — `tests/evolution/a8-sentinel.vitest.ts`

Structural + behavioral invariants:
- `LearningProposal` has no mutation/execution fields (architectural boundary)
- The A2.5 bridge produces only `kind: "MONITOR"` for A8 proposals
- No A8 source file imports from the executor or capability-catalog mutator (secondary guard)

### 9.5 Regression

Full test suite (A6 module + all CAP tests + A8 tests) must remain green. New tests: ≥3 detector unit tests + 3 adapter tests + ≥1 integration test + ≥1 sentinel test = ≥8 new tests. Zero regressions.

## 10. Forward compatibility

- **A8 strategy-tuning** (a future capability, not in A8 v1) would be a new architectural increment, not an A8 expansion.
- **4th detector kind** (e.g., success-rate drift, governance-lag detection) would be a new architectural increment.
- **Detector threshold tuning** lives in the adapter config / engine options; spec doesn't lock concrete values.

## 11. Out of scope

- A9 Self-Directed Engineering (designed at roadmap level only)
- TUI/Web surfaces (CAP-11 territory)
- CAP-P resumption (awaiting P5.5/P5.6 analyzer)
- M2/M3 governance signal delivery/replay
- A8 strategy-tuning (governance config mutation, A5 policy mutation, A7 bias mutation) — would be a new architectural increment
- Speculative overlap-detection algorithms
- New A8 persistence store

## 12. References

- Post-A8 wayfinder map #517 close-out (2026-08-14): `gh issue view 517 --comments`
- A6 Knowledge Evolution spec: `docs/superpowers/specs/2026-08-10-a6-knowledge-evolution-design.md` (pattern template)
- A6 implementation: `src/evolution/knowledge/` (architectural pattern, not domain types)
- A2.5 `GovernanceRecommendation`: `src/governance/governance-types.ts:172`
- A3 `generateDecision`: `src/evolution/governance/decision-engine.ts:123`
- EventLog event types: `src/capability/governance/governance-types.ts:99-103`
- `EnrichedProposal`: `src/adaptation/intelligence-types.ts`; aggregated by `src/adaptation/bucket-aggregator.ts`
- A-series lineage: `docs/architecture/ma0-alix-architecture-2-0.md` §A0-A9; `docs/roadmap/a-series-autonomous-evolution.md`
- A6 knowledge evolution memory: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a7-0-marketing-complete.md`
- A6 application memory: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a7-1-application-merged.md`
- Post-A8 wayfinder memory: `~/.claude/projects/-home-babasola-Projects-Monolith/memory/a8-wayfinder-preconditions-resolved.md`
- CAP-N spec: `docs/superpowers/specs/2026-08-14-cap-n-end-to-end-create-path-design.md`
- CAP-O spec: `docs/superpowers/specs/2026-08-14-cap-o-underperformer-update-path-design.md`
- ADR-0008 (A-series evolution)