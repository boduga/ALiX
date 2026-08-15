# A8 — Organizational Learning Checkpoint

**Date:** 2026-08-14
**Phase:** A8 — Organizational Learning
**Checkpoint tag:** `alix-a8-organizational-learning-complete`

## Summary

A8 detects recurring organizational patterns from the existing canonical
sources — EventLog (`capability.governance.*`), EnrichedProposal[] (P10.8a),
and `governance-store` JSONL (A2.5 recommendations) — and surfaces them as
diagnostic `LearningFinding`s aggregated into a structurally non-executable
`LearningProposal`. A8 is read-only: it never mutates the capability platform,
the EventLog, the governance-store, the A5 measurement policy, the A7
proposal-generation policy, or any capability mutation.

The bridge to governance is exactly one function: `buildGovernanceRecommendation`,
which always constructs `kind: "MONITOR"`. A8 cannot authorize, reject, or
escalate — the A3 `generateDecision` consumes the MONITOR recommendation and
returns the appropriate decision under the active policy. A6 CurationProposal
is intentionally NOT reused: A8 owns its own contract because the domain
(organizational patterns over governance history) is distinct from knowledge
curation over artifact stores.

Architectural progression: **CAP-N (closed) → CAP-O (closed) → CAP-P (deferred) → A8**.
This closes the post-CAP-N wayfinder map #517 next-frontier authorization.
Next executable frontier: **A9**.

Implemented as part of the A8 plan (`docs/superpowers/plans/2026-08-14-a8-organizational-learning.md`).
CLI: `alix governance evolution learn [--dimension ...] [--json]`.

## Implemented

| File | Responsibility |
|------|----------------|
| `src/evolution/learning/contracts/learning-contract.ts` | `LearningFinding`, `LearningProposal`, `LearningEngineOptions`, `ProposalGovernanceRecord`, `MeasurementOutcomeRecord`, `EnrichedProposalRecord`, `RecommendationRecord`, `LearningAdapter<T>`, `DEFAULT_LEARNING_ENGINE_OPTIONS` (with reconnaissance-derived `DEFAULT_MIN_CARDINALITY=3`, `DEFAULT_EVIDENCE_WINDOW_DAYS=30`) |
| `src/evolution/learning/adapters/proposal-events-adapter.ts` | `ProposalEventsAdapter` — EventLog `capability.governance.proposal.*` events → `ProposalGovernanceRecord[]` |
| `src/evolution/learning/adapters/measurement-events-adapter.ts` | `MeasurementEventsAdapter` — EventLog `capability.governance.measurement.measured` events → `MeasurementOutcomeRecord[]` |
| `src/evolution/learning/adapters/enriched-proposals-adapter.ts` | `EnrichedProposalsAdapter` — P10.8a `EnrichedProposal[]` → `EnrichedProposalRecord[]` |
| `src/evolution/learning/adapters/recommendations-adapter.ts` | `RecommendationsAdapter` — `governance-store.list("recommendations")` → `RecommendationRecord[]` (4th adapter per T4-fix ruling) |
| `src/evolution/learning/detectors/underperformer-detector.ts` | `detectUnderperformer` — groups `MeasurementOutcomeRecord[]` by capabilityId; emits finding when `ineffective` count ≥ `minCardinality` within window |
| `src/evolution/learning/detectors/outcome-contradiction-detector.ts` | `detectOutcomeContradictions` — correlates `ProposalGovernanceRecord[]` with `RecommendationRecord[]` by `proposalId`; emits finding when binary-contradiction count ≥ `minCardinality` per capability |
| `src/evolution/learning/detectors/repeated-pattern-failure-detector.ts` | `detectRepeatedPatternFailures` — groups `proposal.execution_failed` events by `${error}:${capabilityId}` fingerprint (identity-join via submitted events); emits finding when count ≥ `minCardinality` |
| `src/evolution/learning/learning-proposal-builder.ts` | `buildLearningProposal(findings, now)` — deterministic `proposalId` from sorted findingIds + timestamp |
| `src/evolution/learning/learning-engine.ts` | `LearningEngine.learn(now)` — runs 3 detectors over 4 adapters in parallel; returns `null` on 0 findings, else `LearningProposal` |
| `src/evolution/learning/a2-bridge.ts` | `buildGovernanceRecommendation(proposal)` — ALWAYS emits `kind: "MONITOR"`; adapts to actual A2.5 `GovernanceRecommendation` shape |
| `src/evolution/learning/learning-cli.ts` | `runLearnCli` — JSON + human output; accepts `--dimension` for forward compatibility (no effect in v1) |
| `src/evolution/learning/index.ts` | Barrel re-exports |
| `src/cli/commands/governance.ts` | `runEvolutionLearn` subcommand wiring (parallel to A6 `curate`; A6 handler signature untouched) |

**Tests:** `tests/evolution/` — `a8-adapters`, `a8-learning-detectors`,
`a8-cli`, `a8-engine-end-to-end`, `a8-sentinel`. 661/661 tests pass across
the capability + evolution suites.

## Verification Checklist

### Read-only invariant (A-series rule)
- [x] Adapters are read-only — `EventLog.readAll` + `governance-store.list` only, never write
- [x] Detectors are pure — no I/O, no store access, no mutation of input
- [x] Engine joins adapter outputs above the adapter boundary (mirrors A6 pattern)
- [x] `LearningProposal` is structurally non-executable (3 fields: `proposalId`, `generatedAt`, `findings`)
- [x] A2.5 bridge constructs `kind: "MONITOR"` only — verified by sentinel 2 (also asserts NOT APPROVE / NOT REJECT)

### Zero-findings invariant
- [x] `LearningEngine.learn(now)` returns `null` on 0 findings
- [x] `buildGovernanceRecommendation` is not invoked when proposal is null
- [x] CLI prints "No organizational patterns detected." / `{ noFindings: true }` and exits 0

### Determinism
- [x] `findingId` format is `<kind>:<identityKey>` — stable per fingerprint
- [x] Detector outputs are sorted by `identityKey` (T3/T4/T5)
- [x] `proposalId` derived from sorted findingIds + timestamp — stable per finding set
- [x] Same evidence + same options → identical findings, proposal, recommendation

### Three pure detectors
- [x] Underperformer: gates on `ineffective` outcome count within window
- [x] Outcome-contradiction: gates on binary-contradiction count (APPROVE+rejected OR REJECT+approved) per capability; non-binary rec kinds (MONITOR, REQUEST_ADDITIONAL_EVIDENCE, ESCALATE) intentionally NOT counted
- [x] Repeated-pattern-failure: gates on `${error}:${capabilityId}` fingerprint count

### Four read-only adapters
- [x] `ProposalEventsAdapter` — EventLog filter + normalize
- [x] `MeasurementEventsAdapter` — strict `=== "capability.governance.measurement.measured"` (defensible deviation from brief's `startsWith`)
- [x] `EnrichedProposalsAdapter` — nested-path reads (`proposal.id`, `proposal.target`, `proposal.createdAt`)
- [x] `RecommendationsAdapter` — governance-store JSONL; `supportingEvidence` → `evidenceRefs` mapping

### Architectural sentinels (HARD pins)
- [x] Sentinel 1: `Object.keys(LearningProposal).sort()` EXACTLY equals `["findings", "generatedAt", "proposalId"]` — any added field breaks
- [x] Sentinel 2: bridge emits `kind: "MONITOR"` for both empty-findings and populated proposals; explicit `not.toBe("APPROVE")` and `not.toBe("REJECT")`
- [x] Sentinel 3: zero forbidden imports across `src/evolution/learning/**` — patterns cover executor/mutation modules (`capability-mutation-executor`, `capability/executors`, `capability/mutation-port`, `capability/mutation-contract`, `capability/provider-executor`, `capability/platform`) and CAP-11 retired-lifecycle markers

### Composition root wiring
- [x] A8 `learn` subcommand added parallel to A6 `curate` in `src/cli/commands/governance.ts`
- [x] A6 handler signature UNTOUCHED
- [x] CAP-12 forbidden files (`governance/governance-types.ts`, `capability/capability-service.ts`) NOT modified
- [x] Composition: `EventLog(<session>)` + `GovernanceStore(join(cwd, ".alix", "governance"))`; `enrichedProposals: []` documented as future-extension seam (no v1 detector consumes EnrichedProposal[])

### Spec deviations caught at implementation (locked rulings preserved)
- [x] **T1-reconciliation** (`e72d7801`): contracts amended to match actual CAP-9/CAP-10/P10.8a schemas (event-level `proposalId`, `capabilityId` empty for 4/5 governance kinds, no `proposalId` on measurement events, nested-path reads for EnrichedProposal)
- [x] **T2/T4 STOP-and-surface pattern**: 13+1 critical brief-vs-actual mismatches surfaced by implementers; user ruled Option A / Path A semantics; contracts + adapters adapted, not silently substituted
- [x] **T4-fix 4-adapter evolution**: A2.5 recommendations do not live on governance event payloads; added dedicated read-only `recommendations-adapter` over `governance-store` JSONL; correlation by `proposalId` in detector layer (not adapter)
- [x] **T5 fingerprint substitution**: brief's `operatorReason` fingerprint doesn't apply to `proposal.execution_failed`; switched to `${error}:${capabilityId}` (always present on the payload)
- [x] **T6 brief-vs-actual (3 mechanical errors)**: import path, field names, engine adapter count — all adapted per locked prior rulings

## Locked rulings

### From A8 wayfinder map #517 (8 rulings, 2026-08-14)
1. **Read-only diagnostic layer** — A8 never mutates canonical sources
2. **`LearningProposal` structurally non-executable** — 3 fields only
3. **Owns its own contract** — does NOT reuse A6 CurationProposal (different domain)
4. **Mirrors A6 PATTERNS** — read-only adapters + pure detectors + A2.5 bridge + A3 seam
5. **Three pure detectors** — underperformer / outcome-contradiction / repeated-pattern-failure
6. **No new persistence** — consume existing canonical sources (EventLog + EnrichedProposal[] + governance-store JSONL)
7. **No governance bypass** — routes via standard A2.5 + A3 path
8. **A0 EvolutionProposalStore** — flagged as A8 precondition (resolved: not needed; A8 reads from existing sources)

### From A8 spec (4 additional rulings)
9. **Reconnaissance-derived defaults** — `DEFAULT_MIN_CARDINALITY=3` from `execution-failure-strategy.ts:41`; `DEFAULT_EVIDENCE_WINDOW_DAYS=30` from `cli/commands/decision.ts:972`
10. **MONITOR-only bridge** — `buildGovernanceRecommendation` always constructs `kind: "MONITOR"`
11. **4-adapter pattern** — recommendations-adapter is dedicated read-only adapter; correlation by proposalId in detector layer
12. **Hard sentinel pins** — exact-key equality + MONITOR-only assertions + forbidden-import scan

## Test totals

| Suite | Tests |
|-------|-------|
| Capability baseline (pre-A8) | 559 |
| A8 T2 adapters | 21 |
| A8 T3 detector (underperformer) | 15 |
| A8 T4 detector (outcome-contradiction) | 14 |
| A8 T4 adapter (recommendations) | 9 |
| A8 T5 detector (repeated-pattern-failure) | 11 |
| A8 T6 engine aggregation | 4 |
| A8 T7 CLI smoke | 6 |
| A8 T8 integration | 5 |
| A8 T8 sentinels | 3 |
| **Total at A8 closure** | **661** |

Net additions: **102 tests, 5 new test files**, **zero regressions**.

## Architectural progression

```
CAP-N (closed)  ── closes CAP-12 §20 #12 carve-out (gap→capability.create)
   ↓
CAP-O (closed)  ── underperformer update-path closure
   ↓
CAP-P (deferred) ── awaiting P5.5/P5.6 authoritative consolidation_opportunity producer
   ↓
A8 (THIS CHECKPOINT) ── organizational learning diagnostic layer
   ↓
A9 (NEXT)       ── next executable frontier per wayfinder map #517
   ↓
TUI/Web (deferred) ── CAP-11 owns TUI/Web surfaces
```

## Future work

### Immediate frontier (post-A8)
- **A9** — next executable frontier; new wayfinder map required before spec/plan

### Resumable deferred
- **CAP-P** — `consolidation_opportunity` signal producer; awaiting P5.5/P5.6 authoritative shape; 8 architectural decisions locked for resumption

### Out of scope (deferred to other phases)
- **TUI/Web surfaces** for A8 — CAP-11 owns these; A8 only ships the CLI seam
- **M2/M3 promotion gates** — non-blocking per Ticket B (wayfinder map #511); demoted until CAP-P resumes
- **A8 strategy-recommendation expansion** — if future program wants A8 to recommend strategy changes, that is a NEW architectural increment with its own bridge; not an A8 expansion (locked ruling)

## Module summary

A8 ships a single new module: `src/evolution/learning/`. It contains:
- 1 contract file
- 4 read-only adapters (proposal-events, measurement-events, enriched-proposals, recommendations)
- 3 pure detectors (underperformer, outcome-contradiction, repeated-pattern-failure)
- 1 engine + 1 proposal builder + 1 A2.5 bridge
- 1 CLI handler
- 1 barrel
- 5 test files (adapters, detectors, CLI, end-to-end, sentinel)

Total: **10 source files + 5 test files**, all additively integrated.
