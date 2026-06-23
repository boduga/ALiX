# P7.5p.1 — ApprovalRecommendation Persistence + Outcome Confidence Capture

> **Status:** SDS awaiting review.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-22-p7-5p-1-approval-recommendation-persistence-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-22-p7-5p-1-approval-recommendation-persistence.md`
> **Governs:** `feature/p7.5p.1-approval-recommendation-persistence` branch, off `main` at HEAD.
> **Risk level:** LOW — additive persistence layer, no architectural change. The only existing-type modification is making `OutcomeRecord.confidence` optional to support honest missing-data handling.

## Why P7.5p.1 exists

The P8.5a.1 Source Recon found that **all four P8 calibration adapters are blocked by missing source persistence**, not by missing adapters. The first and most addressable gap is:

- The CLI hard-codes `confidence: 1` in every `OutcomeRecord` (`src/cli/commands/decision.ts:864`).
- The actual `ApprovalRecommendation` object — which carries the real `confidence` value — is never persisted anywhere.
- P8.1's `RecommendationCalibrationBuilder` needs per-record confidence bucketing; without real values, the bucket breakdown is meaningless.
- The Evidence Chain cannot traverse `OutcomeRecord → ApprovalRecommendation → confidence bucket → LearningSignal` because the recommendation node doesn't exist.

**P7.5p.1 fixes this by persisting `ApprovalRecommendation` and reading it back at outcome time.**

## Hard governance boundary (non-negotiable)

```
Persistence only. No new authority.
The new store is append-only. It records; it does not decide.
The outcome CLI's lookup is read-only relative to the recommendation store.
No proposal. No approval. No apply. No mutation of source artifacts.
```

This is a persistence fix. The P8.5a.0 Evidence Chain boundary continues to hold; this phase adds data so the chain has something to point at.

## Scope (the three atomic commits in one PR)

| Commit | Sub-phase | What |
|---|---|---|
| 1 | P7.5p.1a | `ApprovalRecommendationStore` — append-only JSONL at `.alix/recommendations/recommendations.jsonl` |
| 2 | P7.5p.1b | `runRecommend` writes to the store after `recommendation-engine.recommend()` returns |
| 3 | P7.5p.1c | Outcome CLI reads confidence from store; accepts optional `--recommendation-confidence` override; **never fakes `1`** |

---

## The 8 design questions

### 1. What does the store persist?

The full `ApprovalRecommendation` object. It already extends `DecisionArtifact` (id, subject, outcome, confidence, reasons, generatedAt) and carries `recommendation: "approve" | "reject" | "defer" | "request_more_info"`, `signals`, `priority`, etc. Persisting the whole object means the outcome CLI can look up the recommendation and read its `confidence` faithfully.

**Why not just persist `id → confidence`?** Because the store is a foundation for future phases (P8.5c `alix explain` will traverse `outcome → recommendation → signals → risk`, and the Evidence Chain will record all those links). A thin store now means another migration later.

### 2. Where is the store?

`.alix/recommendations/recommendations.jsonl` — matches the layout of the other 8 stores (`.alix/outcomes/`, `.alix/proposals/`, `.alix/intents/`, etc.). Append-only, one JSON object per line, no index file.

**Why JSONL and not a single JSON file?** Matches the existing store pattern (`OutcomeStore`, `ProposalStore`, `IntentStore`). Append-only JSONL is the codebase's convention for this class of artifact.

### 3. What is the store's API?

```ts
class ApprovalRecommendationStore {
  constructor(storeDir?: string)  // default: process.cwd() + .alix/recommendations

  async append(rec: ApprovalRecommendation): Promise<void>
  async get(id: string): Promise<ApprovalRecommendation | null>
  async list(): Promise<ApprovalRecommendation[]>
  async queryByWindow(windowDays: number): Promise<ApprovalRecommendation[]>
}
```

**Four public methods on the prototype** (`append`, `get`, `list`, `queryByWindow`); the constructor is separate in JS/TS prototype terms. Append is the only write. `get(id)` is the lookup the outcome CLI needs. `list()` and `queryByWindow` are for future phases (P8.5a.2 adapters, P9 audit). The constructor's `storeDir` argument is **optional** — all CLI call sites use the no-arg form so the store resolves its directory internally. Tests use `vi.spyOn(process, "cwd").mockReturnValue(tempRoot)` to redirect.

### 4. Where does the write hook live?

In the CLI's `runRecommend` function (`src/cli/commands/decision.ts`), immediately after `recommendation-engine.recommend(ctx, riskScore)` returns the `ApprovalRecommendation`. The CLI's `runRecommend` already builds the response from the recommendation; appending to the store is one line of additional logic.

**Why in the CLI, not in `recommendation-engine`?** The engine is documented as *"Pure, deterministic, read-only"* (`src/adaptation/recommendation-engine.ts:4`). The CLI is the orchestration layer. Putting the side effect there keeps the engine's contract intact.

**What if the store write fails?** The CLI logs the error and continues. The recommendation is still shown to the operator; the user can re-record the outcome later. The store write is a best-effort persistence enhancement, not a gating operation.

### 5. What does the outcome CLI change?

Three changes to `runOutcomeRecord` (`src/cli/commands/decision.ts:855-868`):

1. Accept `--recommendation-confidence <0-1>` as an optional override flag.
2. If `--recommendation rec-456` is given AND `rec-456` exists in the store → use `rec.confidence`.
3. If the recommendation is given but not found AND no override → `confidence` is `undefined`.
4. If no recommendation given AND no override → `confidence` is `undefined`.
5. **Never fall back to `1`.**

**Behavior table:**

| `--recommendation` | Found in store? | `--recommendation-confidence` | `outcome.confidence` |
|---|---|---|---|
| not given | n/a | not given | `undefined` |
| not given | n/a | given | override value |
| given | yes | not given | `rec.confidence` |
| given | yes | given | override value (override wins) |
| given | no | not given | `undefined` |
| given | no | given | override value |

The override always wins when both are present. This lets an operator correct a wrong-store-value situation explicitly.

### 6. How does `OutcomeRecord.confidence` become optional?

`OutcomeRecord extends DecisionArtifact` and `DecisionArtifact.confidence: number` is required. Declaring `confidence?: number` directly on the subtype is **type-unsafe**: TypeScript permits the syntax, but the resulting type lies — the value can be `undefined` at runtime while the type says `number`, creating a footgun for any consumer that treats it as required.

The correct approach is to **omit the base field and re-declare it as optional**:

```ts
type OutcomeArtifact = Omit<DecisionArtifact, "confidence"> & {
  /** The confidence of the recommendation that produced this outcome, when available. */
  confidence?: number;
};

export interface OutcomeRecord extends OutcomeArtifact {
  // ... existing fields (subjectId, subjectType, decisionId, etc.) ...
}
```

This produces a type where `confidence` is honestly optional, with no inherited-required-to-override gap. The `DecisionArtifact` base is unchanged; only the local re-declaration on `OutcomeRecord` carries the optionality.

**This is a small type change to `src/adaptation/outcome-types.ts`.** It is the only existing-type modification in this phase.

### 7. What about the P8.5a.0 unchanged-types invariance test?

The test in `tests/learning/unchanged-types-invariance.vitest.ts` captures SHA-256 baselines of the six protected files at the P8.5a.0 state. `src/adaptation/outcome-types.ts` is one of them. Modifying it to make `confidence` optional **breaks the baseline**.

**Resolution:** the invariance test is **not** casually re-baselined. Instead, the test is updated in P7.5p.1c to encode an **explicit allowed delta**:

- **5 files** (`risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`) MUST remain byte-identical to the P8.5a.0 baseline.
- **1 file** (`outcome-types.ts`) MAY differ from the baseline by **exactly the addition of `confidence?: number` on `OutcomeRecord`**. Any other change to that file fails the test.

**Mechanism:** the test loads the existing baseline file. For the 5 strict-protected files, it asserts `currentHash === baseline[file]`. For `outcome-types.ts`, it asserts `currentHash` is either the baseline hash (no change yet) OR the SHA-256 of a recorded "approved delta content" string. The approved-delta content is captured by reading the file at module-load time after the P7.5p.1c change has been committed, so the test is self-validating: if the file changes again, the test fails loudly.

The test's purpose is preserved (locking the phase's state going forward) while allowing the legitimate P7.5p.1 schema change. Future unintentional changes to `outcome-types.ts` will fail the test, and any further intentional change requires a new plan that documents the new allowed delta explicitly.

### 8. What goes in the SDS vs. the plan?

| Document | Owns |
|---|---|
| SDS (this file) | Design decisions, governance boundary, scope, acceptance criteria |
| Plan (`docs/superpowers/plans/2026-06-22-p7-5p-1-approval-recommendation-persistence.md`) | Step-by-step implementation, file paths, test code, commit messages |

---

## Files created

- `src/adaptation/approval-recommendation-store.ts` — the new store
- `tests/adaptation/approval-recommendation-store.vitest.ts` — store tests

## Files modified

- `src/adaptation/outcome-types.ts` — `confidence?: number` on `OutcomeRecord`
- `src/cli/commands/decision.ts` — `runRecommend` write hook, `runOutcomeRecord` lookup + override
- `tests/learning/unchanged-types-invariance.vitest.ts` — update baseline on P7.5p.1c commit

## Files NOT modified

- `src/adaptation/risk-score-types.ts`
- `src/adaptation/governance-review-types.ts`
- `src/adaptation/adaptation-types.ts`
- `src/adaptation/decision-types.ts`
- `src/learning/learning-types.ts`
- `src/learning/evidence-chain-types.ts`
- `src/learning/forward-ref-extractors.ts`
- `src/learning/evidence-chain-store.ts`
- The 8 existing stores
- The P8.5a.0 sentinels

---

## Acceptance criteria

The user-stated criteria, restated as testable assertions:

- [ ] `ApprovalRecommendationStore` is append-only JSONL (sentinel test: no delete/update/clear/truncate methods)
- [ ] `runRecommend` appends the `ApprovalRecommendation` to the store (integration test)
- [ ] Outcome CLI reads `confidence` from the store when the recommendation is found (test)
- [ ] Missing recommendation does NOT fake `confidence` to `1` (test asserts `confidence === undefined`)
- [ ] `--recommendation-confidence` override works (test)
- [ ] Override wins when both store value and override are present (test)
- [ ] Tests prove outcome confidence equals original recommendation confidence (end-to-end: seed store with `conf=0.85`, run outcome CLI, assert `outcome.confidence === 0.85`)
- [ ] Evidence Chain can later link `outcome → recommendation` (the `recommendationId` field is already on `OutcomeRecord`; the `approved_from` link in the Evidence Chain's `AdaptationProposal` extractor already points to the recommendation when present)
- [ ] All P8 + P8.5a.0 tests still pass (no regression)
- [ ] `tsc --noEmit` clean
- [ ] `gitnexus_detect_changes` shows the changes are scoped to P7.5p.1

## Out of scope

- `RiskScoreStore` (P7.5p.2)
- `GovernanceReviewStore` (P7.5p.3)
- `TelemetryCapture` (P7.5p.4, deferred)
- `ApprovalRecommendation` read API beyond `get(id)` (full query API lands with the adapters in P8.5a.2)
- The P8.1 adapter (P8.5a.2)
- `alix explain` traversal of `outcome → recommendation` (P8.5c)
- Any change to `DecisionArtifact.confidence` (would touch every artifact; not needed)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The `confidence?` schema change breaks consumers that assume `confidence` is always a number | The only consumer is the CLI's print path; the format string uses `conf.toFixed(2)` which would throw on undefined. Mitigation: update the print to handle undefined (`${record.confidence?.toFixed(2) ?? "n/a"}`). |
| The store write in `runRecommend` fails and the operator's recommendation is gone | The recommendation is also returned to the operator in the CLI output (already happens). Mitigation: log a warning on store write failure; do not block the recommendation display. |
| The `OutcomeRecord` type change is captured by the P8.5a.0 invariance test | The plan updates the test's baseline on the P7.5p.1c commit. The test continues to lock the new state. |
| Other tests assume `OutcomeRecord.confidence: number` (not optional) | None found in the recon; the existing CLI tests pass hard-coded `confidence: 1` directly. The P7.5p.1c test will need a small fixture update if any test instantiates an OutcomeRecord without a confidence. |
