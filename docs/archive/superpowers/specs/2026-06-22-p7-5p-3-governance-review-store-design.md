# P7.5p.3 — GovernanceReviewStore + Lens-Review Persistence

> **Status:** SDS awaiting review.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-22-p7-5p-3-governance-review-store-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-22-p7-5p-3-governance-review-store.md`
> **Governs:** `feature/p7.5p.3-governance-review-store` branch, off `main` at HEAD (`f0d4e9c6`).
> **Risk level:** LOW — additive persistence layer, no architectural change. `OutcomeRecord.governanceReviewId?` already exists (added in P6.5a, currently always null), so P7.5p.3 **modifies zero type files** — it only starts populating an existing field.

## Why P7.5p.3 exists

The P8.5a.1 Source Recon established that governance reviews are ephemeral:

> Report never exists at adapter time. Even though the data shape is a perfect match, the upstream source is missing entirely. The CLI's `lens_scores_not_persisted` sentinel is the operating reality.

`LensCalibrationBuilder.build()` consumes `LensObservation[]`:
```ts
interface LensObservation {
  lens: LensName;
  verdict: GovernanceVerdict;
  outcome: OutcomeValue;
  concernsRaised: number;
}
```

`GovernanceReview` (the review artifact) already carries `lensScores: LensScore[]` where each `LensScore = { lens, recommendedVerdict, confidence, rationale }`. The P8.3 adapter derives `LensObservation[]` from `review.lensScores` × the later `OutcomeRecord.outcome`. Without persisted reviews, this derivation is impossible. P7.5p.3 fixes the substrate.

## Where GovernanceReview is produced (the key recon finding)

**`runReview`** (`src/cli/commands/decision.ts:635-718`) — NOT the deterministic `runRecommend`. This changes the hook shape:

```text
alix decision review <proposal-id> [--json] [--lens <name>]
  → detectProvider (exits if no API key)        ← LLM-gated
  → ctx = contextBuilder.build(id)
  → risk = riskBuilder.build(ctx)
  → recommendation = recEngine.recommend(ctx, risk)
  → scores = Promise.all(lensAgents.map(l => l.run(input)))   ← LLM calls
  → review = council.aggregate(reviewId, id, recommendation.id, scores, input)
  → render (terminal or JSON)
```

Implications:
- The store is **only populated when an operator explicitly runs `alix decision review`**. Reviews are not automatic. This is correct — reviews are an LLM-gated, opt-in governance step.
- `reviewId` is `review-${proposalId}-${Date.now()}` (timestamp-suffixed, like `rec-<proposalId>-<genAt>`).
- The hook goes after `council.aggregate()` (line 712) and before the render block.

## Hard governance boundary (non-negotiable)

```
Persistence only. No new authority.
The new store is append-only. It records; it does not decide.
The CLI's write hook is best-effort — log-and-continue on failure.
No proposal. No approval. No apply. No mutation of source artifacts.
The store records the review as aggregated by the council — no re-aggregation.
Reviews are observations only; P7c observes lens quality, it does not change lens weights.
```

Same persistence-only posture as P7.5p.1/.2.

## The 3 design decisions needing sign-off

### Decision 1 — Persist the whole `GovernanceReview` (Option α)

**Options:**
- **(α) Persist the whole `GovernanceReview`** — mirror P7.5p.1/.2 exactly. The review is the natural artifact unit; it carries `lensScores` for adapter derivation.
- **(β) Persist individual `LensScore` records** — per-lens-per-review granularity. Matches `LensObservation` shape more directly but loses council context and breaks the "persist the whole artifact" convention.

**Recommendation: α.** Consistent with P7.5p.1/.2. The adapter derives `LensObservation[]` from `review.lensScores × outcome`. The whole-artifact convention is the codebase's established pattern.

### Decision 2 — Auto-lookup `governanceReviewId` by proposalId (adds a 5th store method)

`OutcomeRecord.governanceReviewId?` already exists but is "always null for now". How should `runOutcomeRecord` populate it?

- **(i) Auto-lookup + override.** `runOutcomeRecord` queries the review store by `subjectId` (= proposalId) and links the most recent review. `--governance-review-id` override wins. Requires a 5th store method `queryByProposal(proposalId)`.
- **(ii) Explicit-only.** Operator must pass `--governance-review-id`. 4 store methods (strict mirror of P7.5p.1/.2).

**Recommendation: (i) — auto-lookup.** Auto-linking is the entire value-add of P7.5p.3; without it, operators manually thread review ids, which is the friction this phase eliminates. `OutcomeStore` already has both `queryBySubject` AND `queryByWindow` (5 methods), so a proposal-scoped query has precedent. The deviation from the 4-method P7.5p.1/.2 pattern is justified and documented.

**`concernsRaised` caveat (flagged for the P8.3 adapter, NOT a P7.5p.3 blocker):** `LensScore` has `rationale` (free text) but **no per-lens concern count**. `GovernanceReview.concerns: string[]` is council-level, not per-lens. So when the P8.3 adapter derives `LensObservation.concernsRaised`, it must use a heuristic (e.g., count of concern strings, or 1/0 for warned-vs-not). This is the adapter's concern (P8.5a.2); P7.5p.3 persists the raw review faithfully and does not invent counts.

### Decision 3 — Invariance test: no change needed

`OutcomeRecord.governanceReviewId?` was added in P6.5a. P7.5p.3 does **not** modify `outcome-types.ts`. The invariance test's captured `ALLOWED_DELTA_CONTENT` (P7.5p.2c state) still matches. **Zero type-file changes** — the cleanest of the three P7.5p slices. The 5 strict-protected files remain byte-identical. (A one-line docstring note may be added to the invariance test clarifying P7.5p.3 does not touch types, but no behavioral change.)

---

## Scope (the three atomic commits in one PR)

| Commit | Sub-phase | What |
|---|---|---|
| 1 | P7.5p.3a | `GovernanceReviewStore` — append-only JSONL at `.alix/governance-reviews/governance-reviews.jsonl`, **5 methods** (`append`, `get`, `list`, `queryByWindow`, `queryByProposal`) |
| 2 | P7.5p.3b | Hook in `runReview` after `council.aggregate()` — best-effort write |
| 3 | P7.5p.3c | `runOutcomeRecord` populates `governanceReviewId` via auto-lookup (most recent review by proposalId) or `--governance-review-id` override |

---

## The 7 design questions

### 1. What does the store persist?

The full `GovernanceReview` object exactly as aggregated by `GovernanceReviewCouncil.aggregate()`. It already extends `DecisionArtifact` and carries `recommendationId`, `proposalId`, `verdict`, `concerns[]`, `blindSpots[]`, `historicalAnalogies[]`, `lensScores[]`, `councilVote`, `sourceArtifacts[]`. Persisting the whole object means the P8.3 adapter has the complete review to derive observations from.

### 2. Where is the store?

`.alix/governance-reviews/governance-reviews.jsonl` — matches the layout of the other stores. Append-only, one JSON object per line, no index.

### 3. What is the store's API?

```ts
class GovernanceReviewStore {
  constructor(storeDir?: string)  // default: process.cwd() + .alix/governance-reviews

  async append(review: GovernanceReview): Promise<void>
  async get(id: string): Promise<GovernanceReview | null>
  async list(): Promise<GovernanceReview[]>
  async queryByWindow(windowDays: number): Promise<GovernanceReview[]>
  async queryByProposal(proposalId: string): Promise<GovernanceReview[]>
}
```

**Five public methods** (Decision 2 adds `queryByProposal`). Append is the only write. `queryByProposal` returns all reviews for a proposal (most-recent-last in append order; the caller picks the last as "most recent").

### 4. Where does the write hook live?

In the CLI's `runReview` function (`src/cli/commands/decision.ts`), immediately after `council.aggregate()` returns the review (line 712), before the render block (line 714+):

```ts
const review = council.aggregate(reviewId, id, recommendation.id, scores, input);

// P7.5p.3b — persist the review so P8.3 can derive LensObservation[].
// Best-effort: log-and-continue on failure; never block the review render.
await new GovernanceReviewStore().append(review).catch((err) =>
  console.warn(`[alix] warning: failed to persist governance review ${review.id}:`,
    err instanceof Error ? err.message : String(err)),
);
```

**Why in the CLI, not in `GovernanceReviewCouncil`?** The council is a pure aggregator. Same posture as P7.5p.1/.2: side effects live in the orchestration layer.

### 5. How does `OutcomeRecord.governanceReviewId` get populated?

The field already exists (optional, currently always null). P7.5p.3c starts populating it in `runOutcomeRecord`:

| `--governance-review-id` | Review in store for `subjectId`? | `outcome.governanceReviewId` |
|---|---|---|
| given | (ignored) | override value |
| not given | yes (1+) | most recent review id (last append for that proposal) |
| not given | no | `undefined` |

**Override always wins.** Auto-lookup uses `governanceReviewStore.queryByProposal(subjectId)` and takes the last element (most recent in append order). When multiple reviews exist for a proposal, "most recent" is a best-effort choice — documented, not silently deterministic.

### 6. How does this interact with the unchanged-types invariance test?

**It doesn't — zero interaction.** P7.5p.3 does not modify `outcome-types.ts` (`governanceReviewId?` already exists from P6.5a). The invariance test's `ALLOWED_DELTA_CONTENT` (captured at the P7.5p.2c state) still matches. The 5 strict-protected files remain byte-identical.

A one-line docstring note in the invariance test may clarify "P7.5p.3 populates the pre-existing `governanceReviewId` field without modifying any type file," but this is optional and changes no behavior.

### 7. What about the `lens_scores_not_persisted` sentinel?

`src/cli/commands/decision.ts` has a `runLensCalibration` (or similar) that returns `status: "lens_scores_not_persisted"`. After P7.5p.3, reviews ARE persisted, so the sentinel can be retired OR updated to actually run the `LensCalibrationBuilder` against the new store.

**Scope decision: P7.5p.3 does NOT retire the sentinel.** Retiring it means wiring the builder + adapter, which is P8.5a.2's job. P7.5p.3 ships the store + write hook + outcome lookup; P8.5a.2 replaces the sentinel with a live adapter reading from `GovernanceReviewStore`. The sentinel's message may be updated to say "reviews are now persisted (P7.5p.3); adapter wiring is P8.5a.2" — a one-line message change, not a behavioral one. (This keeps the slice focused; the user can defer the sentinel message change if they prefer.)

---

## Files created

- `src/adaptation/governance-review-store.ts` — the new store
- `tests/adaptation/governance-review-store.vitest.ts` — store tests

## Files modified

- `src/cli/commands/decision.ts` — `runReview` write hook, `runOutcomeRecord` auto-lookup + override

## Files NOT modified

- `src/adaptation/outcome-types.ts` (`governanceReviewId?` already exists — **zero type changes**)
- `src/adaptation/governance-review-types.ts` (strict-protected, byte-locked)
- `src/adaptation/governance-review-council.ts` (pure aggregator, untouched)
- `src/adaptation/lens-calibration-builder.ts` (pure builder, untouched)
- The other 4 strict-protected files
- `tests/learning/unchanged-types-invariance.vitest.ts` (no change needed — optional docstring note only)
- The 10 existing stores
- The P8.5a.0 / P7.5p.1 / P7.5p.2 sentinels

---

## Acceptance criteria

- [ ] `GovernanceReviewStore` is append-only JSONL (sentinel: no delete/update/clear/truncate on prototype)
- [ ] `runReview` appends the `GovernanceReview` to the store (integration test)
- [ ] Store write in `runReview` is best-effort (test: mock failure, assert review still renders)
- [ ] `queryByProposal(proposalId)` returns reviews scoped to a proposal
- [ ] `runOutcomeRecord` auto-looks up the most recent review by `subjectId` when no override (test)
- [ ] `--governance-review-id` override wins (test)
- [ ] No review in store + no override → `governanceReviewId === undefined` (never faked) (test)
- [ ] **Cross-proposal isolation (governance-boundary invariant):** outcome for Proposal A never links a review belonging to Proposal B, even when B's review is newer (test). Protects against a regression to `list().at(-1)`.
- [ ] All P8 + P8.5a.0 + P7.5p.1 + P7.5p.2 tests still pass (no regression)
- [ ] 5 strict-protected files byte-identical to baseline
- [ ] `outcome-types.ts` unchanged (still matches P7.5p.2c approved state)
- [ ] `tsc --noEmit` clean
- [ ] `gitnexus_detect_changes` shows scope is P7.5p.3 only

## Out of scope

- Retiring the `lens_scores_not_persisted` sentinel (P8.5a.2 — needs the adapter)
- The P8.3 adapter itself (P8.5a.2)
- `concernsRaised` per-lens count derivation (adapter heuristic, P8.5a.2)
- `alix explain` traversal of `outcome → review` (P8.5c)
- Persisting `DecisionContext` snapshots (not needed — reviews carry `proposalId` for the join)
- Re-aggregation or review rewriting (the recorded review is the one aggregated, full stop)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reviews are LLM-gated; store stays empty in environments without a provider | Correct by design. The store populates only when `alix decision review` runs. P8.3 calibration simply reports `insufficient_data` until reviews accumulate. |
| Multiple reviews per proposal; auto-lookup "most recent" may link the wrong one | Best-effort, documented. Override (`--governance-review-id`) is the deterministic escape hatch. The Evidence Chain records the actual link. |
| `concernsRaised` has no per-lens source in `LensScore` | Flagged for the P8.3 adapter. The store persists the raw review; the adapter owns the derivation heuristic. |
| `runReview` is a more complex hook site than `runRecommend` | Hook placement is after `council.aggregate()` returns the full review object — a single line, same `.catch(log)` pattern as P7.5p.1/.2. The LLM work happens before; the hook is post-aggregation. |
| Invariance test breaks | No — `outcome-types.ts` is untouched. |

## What this unlocks for P8.5a.2

- **P8.3 governance adapter** now has a real input path: `GovernanceReviewStore.list()` produces per-proposal reviews with `lensScores`. The join with `OutcomeRecord.subjectId === proposalId` (or `governanceReviewId`) produces `LensObservation[]`.
- **The `lens_scores_not_persisted` sentinel can be retired** in P8.5a.2 and replaced with a live `LensCalibrationBuilder` run against the store.
- **P8.5c `alix explain`** can traverse `proposal → review → lenses → outcome` once the Evidence Chain extractor for `governance_review` reads its forward refs.
- **P9 audit** can ask "which lenses have predictive value, and which produce false alarms?" — a real question with real data.

---

## Recommended slice order (unchanged from roadmap)

```text
P7.5p.1 ✅  P7.5p.2 ✅  P7.5p.3 ← this PR
P7.5p.4 (TelemetryCapture, deferred)
P8.5a.2 (Operational Adapters — now feasible for all 3 of recommendation/risk/governance)
```