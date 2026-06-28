# P7.5p.2 — RiskScoreStore + Per-Proposal Risk Persistence

> **Status:** SDS awaiting review.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-22-p7-5p-2-risk-score-store-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-22-p7-5p-2-risk-score-store.md`
> **Governs:** `feature/p7.5p.2-risk-score-store` branch, off `main` at HEAD.
> **Risk level:** LOW — additive persistence layer, no architectural change. `RiskScore.id` already exists (`risk-${ctx.proposalId}`) so the store key is stable and matches existing builders.

## Why P7.5p.2 exists

The P8.5a.1 Source Recon established that `RiskScore` is **never persisted**:

> `RiskScore` per-proposal → never persisted, lost after `recommendation-engine.recommend(ctx, riskScore)` returns. `OutcomeRecord` per-proposal → persisted, keyed by `subjectId` (which is the proposal id) and `subjectType: "proposal"`. `OutcomeRecord` does not carry `risks: RiskItem[]` either.

P8.2's `RiskCalibrationBuilder.calibrate()` consumes `RiskOutcomeObservation[]`:

```ts
interface RiskOutcomeObservation {
  proposalId: string;
  dimensions: DimensionScore[];   // [{ dimension, score }]
  outcome: string;
}
```

Without per-proposal `RiskScore` history, the join `RiskScore × OutcomeRecord → observation` is **impossible**. P7.5p.2 fixes the upstream substrate so P8.5a.2 can wire the risk adapter.

## Hard governance boundary (non-negotiable)

```
Persistence only. No new authority.
The new store is append-only. It records; it does not decide.
The CLI's write hook is best-effort — log-and-continue on failure.
No proposal. No approval. No apply. No mutation of source artifacts.
No recalculation. The recorded RiskScore is the one that was actually consumed
by recommendation-engine at decision time.
```

This is the **same** persistence-only posture as P7.5p.1. The Evidence Chain boundary continues to hold; this phase adds data so the chain has something to point at.

## Scope (the three atomic commits in one PR)

| Commit | Sub-phase | What |
|---|---|---|
| 1 | P7.5p.2a | `RiskScoreStore` — append-only JSONL at `.alix/risk-scores/risk-scores.jsonl` |
| 2 | P7.5p.2b | Hook in the runRecommend path that records `RiskScore` after `risk-score-builder.build(ctx)` and before `recommendation-engine.recommend(ctx, riskScore)` |
| 3 | P7.5p.2c | `OutcomeRecord.riskScoreId` made optional (forward-ref column already exists); invariance test updated for the allowed delta; CLI option `--risk-score-id <id>` to attach explicitly |

---

## The 7 design questions

### 1. What does the store persist?

The full `RiskScore` object exactly as built by `RiskScoreBuilder.build(ctx)`. It already extends `DecisionArtifact` (id, subject, outcome, confidence, reasons, generatedAt) and carries `overallRisk`, `risks: RiskItem[]`, `dimensions`, `sourceArtifacts`. Persisting the whole object means:

- P8.2 adapter can join `RiskScore` × `OutcomeRecord` (by `proposalId` = `RiskScore.id` = `risk-<proposalId>`)
- P8.5c `alix explain` can traverse `proposal → risk → outcome → learning_signal` (the forward refs are already there)
- The Evidence Chain extractor for `outcome_record` already carries the link via `decisionId`; future extractors can pull `riskScoreId` from `OutcomeRecord`

**Why not just persist `id → overallRisk`?** Same reasoning as P7.5p.1 Q1: the per-dimension breakdown is the P8.2 calibration signal. A thin store means another migration later.

### 2. Where is the store?

`.alix/risk-scores/risk-scores.jsonl` — matches the layout of the other 9 stores (`.alix/outcomes/`, `.alix/proposals/`, `.alix/intents/`, `.alix/recommendations/`, etc.). Append-only, one JSON object per line, no index file.

**Why a new directory instead of merging into `recommendations/`?** `RiskScore` is consumed by the recommendation engine but is **logically distinct**: a risk is a measurement, a recommendation is a decision. They have different forward refs, different sources, and different refresh cadences (risk depends on `DecisionContext`; recommendation depends on `DecisionContext + RiskScore`). Co-locating them in one JSONL would entangle their lifecycles.

### 3. What is the store's API?

Mirror the existing stores exactly:

```ts
class RiskScoreStore {
  constructor(storeDir?: string)  // default: process.cwd() + .alix/risk-scores

  async append(score: RiskScore): Promise<void>
  async get(id: string): Promise<RiskScore | null>
  async list(): Promise<RiskScore[]>
  async queryByWindow(windowDays: number): Promise<RiskScore[]>
}
```

**Four public methods on the prototype** (`append`, `get`, `list`, `queryByWindow`); constructor is separate in JS/TS prototype terms. Append is the only write. `get(id)` returns by the stable `RiskScore.id` (`risk-<proposalId>`). The optional `storeDir` argument exists for test isolation; all CLI call sites use the no-arg form.

### 4. Where does the write hook live?

In the CLI's `runRecommend` function (`src/cli/commands/decision.ts`), **between** the existing `riskScoreBuilder.build(ctx)` call and the existing `recommendationEngine.recommend(ctx, riskScore)` call. Sequence:

1. (existing) `const riskScore = riskScoreBuilder.build(ctx);`
2. **NEW:** `await riskScoreStore.append(riskScore).catch(log)` — best-effort
3. (existing) `const rec = recommendationEngine.recommend(ctx, riskScore);`
4. (existing from P7.5p.1b) `await approvalRecommendationStore.append(rec).catch(log)` — best-effort
5. (existing) Print response

**Why in the CLI, not in `RiskScoreBuilder`?** The builder is documented as *"Pure, deterministic, read-only"* (`src/adaptation/risk-score-builder.ts:4-9`). Same posture as the P7.5p.1b hook: the builder remains pure; the CLI orchestrates side effects.

**What if the store write fails?** Log the error and continue. The recommendation is still shown to the operator. Best-effort persistence, never gating.

### 5. What does `OutcomeRecord.riskScoreId` become?

`OutcomeRecord` (`src/adaptation/outcome-types.ts`) already has `recommendationId?: string`, `decisionId?: string`, `governanceReviewId?: string`. **No** `riskScoreId` field currently exists. There are two options:

**(a) Add a new optional `riskScoreId?: string` field to `OutcomeRecord`.** This is the same Omit-pattern question as P7.5p.1c — except here, no required-field re-declaration is needed. `riskScoreId` would simply be **new** and **optional**. No type footgun.

**(b) Derive `riskScoreId` from `recommendationId` at lookup time.** Since `RiskScore.id = "risk-<proposalId>"` and `ApprovalRecommendation.id = "rec-<proposalId>-<generatedAt>"`, the two are not directly derivable from each other. The timestamp in the rec id is unique per `generatedAt`. This derivation would require parsing.

**Decision: (a).** Add `riskScoreId?: string` to `OutcomeRecord` as a new optional field. The CLI sets it from the same `riskScore.id` value that was just appended (so the operator doesn't need to provide it). The field joins the existing forward-ref cluster and the Evidence Chain can traverse it.

**Behavior at outcome-record time:**

| `--risk-score-id` | `--recommendation` | `outcome.riskScoreId` |
|---|---|---|
| not given | not given | `undefined` |
| not given | given, rec has `riskScoreId` | `rec.riskScoreId` |
| given | not given | override value |
| given | given | override wins |

Override always wins, same posture as P7.5p.1c. Missing record + no override = `riskScoreId` undefined. Never faked.

### 6. How does this interact with the unchanged-types invariance test?

The P8.5a.0 invariance test (`tests/learning/unchanged-types-invariance.vitest.ts`) byte-locks 5 files (the 6th, `outcome-types.ts`, has an allowed delta for P7.5p.1). For P7.5p.2:

- `risk-score-types.ts` is one of the 5 strict-protected files. P7.5p.2 does **not** modify it. ✅
- `outcome-types.ts` will gain **one** new field: `riskScoreId?: string`. This is a second allowed delta.

**Resolution:** the invariance test is updated in P7.5p.2c to encode an explicit allowed delta for `outcome-types.ts`:

- **5 strict files** (same as before) MUST remain byte-identical to the P8.5a.0 baseline.
- **`outcome-types.ts`** MAY differ from baseline by exactly:
  - The P7.5p.1c addition (`Omit<> pattern` + `confidence?: number`)
  - The P7.5p.2c addition (one new optional field `riskScoreId?: string`)

The test captures the new "approved delta content" by reading the file at module-load time after P7.5p.2c has been committed. Any other change to that file fails the test loudly.

**Important:** the existing tests for the P7.5p.1 allowed-delta still pass — the new approved-delta content **includes** the P7.5p.1 changes plus the new field. The test is self-validating.

### 7. What is the allowed-delta content for P7.5p.2c?

At P7.5p.2c commit time, `outcome-types.ts` should contain exactly:

```ts
// OutcomeArtifact stays focused on confidence optionality only.
type OutcomeArtifact = Omit<DecisionArtifact, "confidence"> & {
  /**
   * The confidence of the recommendation that produced this outcome.
   * Undefined when the recommendation is unknown and no override was given.
   * P7.5p.1 — never faked to 1.
   */
  confidence?: number;
};

export interface OutcomeRecord extends OutcomeArtifact {
  // ... existing fields (subjectId, subjectType, decisionId, etc.) ...

  /**
   * The id of the RiskScore that informed the recommendation linked to
   * this outcome. Undefined when no RiskScore was associated with the
   * recommendation and no override was given. Outcome-specific provenance,
   * not a generic artifact concern.
   * P7.5p.2 — never faked to a placeholder.
   */
  riskScoreId?: string;
}
```

`riskScoreId` lives on `OutcomeRecord` (outcome-specific forward ref), NOT on `OutcomeArtifact` (which exists solely to make `confidence` optional). This keeps `OutcomeArtifact`'s single responsibility clean: it is the Omit wrapper for the inherited-required `confidence` field, full stop.

The invariance test captures this content at module-load time and allows it as one of two valid forms (baseline-or-P7.5p.1-only-or-P7.5p.2-final).

---

## Files created

- `src/adaptation/risk-score-store.ts` — the new store
- `tests/adaptation/risk-score-store.vitest.ts` — store tests

## Files modified

- `src/adaptation/outcome-types.ts` — add `riskScoreId?: string` field
- `src/cli/commands/decision.ts` — `runRecommend` write hook, `runOutcomeRecord` lookup + override
- `tests/learning/unchanged-types-invariance.vitest.ts` — encode P7.5p.2c allowed delta

## Files NOT modified

- `src/adaptation/risk-score-types.ts` (strict-protected, byte-locked)
- `src/adaptation/governance-review-types.ts` (strict-protected)
- `src/adaptation/adaptation-types.ts` (strict-protected)
- `src/adaptation/decision-types.ts` (strict-protected)
- `src/learning/learning-types.ts` (strict-protected)
- `src/learning/evidence-chain-types.ts`
- `src/learning/forward-ref-extractors.ts`
- `src/learning/evidence-chain-store.ts`
- The 9 existing stores (incl. `ApprovalRecommendationStore` from P7.5p.1)
- The P8.5a.0 / P7.5p.1 sentinels
- The 4 P8 calibration builders
- The recommendation engine, risk score builder (both pure)

---

## Acceptance criteria

- [ ] `RiskScoreStore` is append-only JSONL (sentinel test: no delete/update/clear/truncate methods)
- [ ] `runRecommend` appends the `RiskScore` to the store (integration test)
- [ ] `OutcomeRecord.riskScoreId` is a new optional field (type test)
- [ ] Outcome CLI reads `riskScoreId` from the recommendation (which carries `riskScoreId` from `recommendation-engine.recommend`)
- [ ] Missing `riskScoreId` does NOT fake a value (test asserts `riskScoreId === undefined`)
- [ ] `--risk-score-id` override works (test)
- [ ] Override wins when both recommendation-carried and override are present (test)
- [ ] The store write in `runRecommend` is best-effort: log-and-continue on failure, never block the operator
- [ ] All P8 + P8.5a.0 + P7.5p.1 tests still pass (no regression)
- [ ] 5 strict-protected files byte-identical to baseline (the invariance test enforces this)
- [ ] `outcome-types.ts` matches either the P8.5a.0 baseline OR the P7.5p.1c delta OR the P7.5p.2c delta (exactly one of three approved states)
- [ ] `tsc --noEmit` clean
- [ ] `gitnexus_detect_changes` shows the changes are scoped to P7.5p.2

## Out of scope

- `GovernanceReviewStore` (P7.5p.3)
- `TelemetryCapture` (P7.5p.4, deferred)
- The P8.2 adapter itself (P8.5a.2)
- `alix explain` traversal of `outcome → risk` (P8.5c)
- RiskScore rebuild/recompute (the recorded score is the one consumed at decision time, full stop)
- Multi-write per proposal (each `runRecommend` produces exactly one RiskScore, keyed by `proposalId`; dedup is the consumer's concern)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| RiskScore stored but never read (dead data) | The P7.5p.2 PR body documents the join path for P8.2; the existing P8.5a.1 recon already names RiskScoreStore as the P8.2 prerequisite. |
| `riskScoreId` becomes a structural mismatch (different runs of `recommendation-engine` produce different rec ids) | The RiskScore.id is deterministic per proposal (`risk-<proposalId>`); `ApprovalRecommendation` carries `riskScoreId` as a forward ref directly from `recommendation-engine.recommend()` output. The join is well-defined. |
| Operator never provides `--risk-score-id`, so `OutcomeRecord.riskScoreId` stays undefined | This is honest. The Evidence Chain can still traverse via `OutcomeRecord.recommendationId → ApprovalRecommendation.riskScoreId → RiskScore`. |
| The store write in `runRecommend` fails and the risk assessment is gone | The recommendation is still returned to the operator. Best-effort log-and-continue. The RiskScore can be regenerated next time the proposal is reviewed. |
| Invariance test re-baselines accidentally | Same posture as P7.5p.1: encoded approved-delta content read at module-load time. Future changes fail loudly. |
| Other tests break because `OutcomeRecord` gained a new field | Adding a new **optional** field is type-additive; existing constructors and `extends` chains are unaffected. No test should fail. |

## What this unlocks for P8.5a.2

- **P8.2 risk adapter** now has a real input path: `RiskScoreStore.list()` produces per-proposal `RiskScore` records, each carrying `dimensions: Record<RiskDimension, number>`. The join with `OutcomeRecord.subjectId === proposalId` produces `RiskOutcomeObservation[]` with full per-dimension breakdown.
- **P8.5c `alix explain prop-x`** can traverse `proposal → risk → recommendation → outcome` (4-hop chain) once the Evidence Chain extractor for `outcome_record` reads `riskScoreId`.
- **P9 audit** can ask "what risks correlated with what outcomes, broken down per dimension?" — a real question with real data.