# P8.5a.2 — Operational Learning Adapters

> **Status:** SDS awaiting review.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-23-p8-5a-2-operational-adapters-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-23-p8-5a-2-operational-adapters.md`
> **Governs:** `feature/p8.5a.2-operational-adapters` branch, off `main` at HEAD (`36d8df92`).
> **Risk level:** MEDIUM — wires the dormant P8 stack to live P7.5p data for the first time. Does NOT change mutation authority (Learning ≠ Mutation holds). The first phase where `LearningStore` is populated by real adapters rather than test fixtures.

## Why P8.5a.2 exists

P8 ships 9 sub-phases and builders for all 4 calibration domains, but its loop is dormant:

```text
P7 Outcomes (real) ──?──> P8 Builders (test fixtures only) ──> LearningStore (empty) ──> "No learning signals found."
```

The P8.5a.1 Source Recon confirmed all four adapters were blocked by missing source persistence. **P7.5p.1/.2/.3 removed all three blockers:**

```text
P7.5p.1 ✅ ApprovalRecommendationStore  →  OutcomeRecord.confidence is now REAL
P7.5p.2 ✅ RiskScoreStore               →  per-proposal RiskScore history exists
P7.5p.3 ✅ GovernanceReviewStore        →  per-proposal GovernanceReview history exists
```

P8.5a.2 builds the adapters that read those substrates and feed the P8.1/P8.2/P8.3 builders. After this, the LearningStore is populated by real calibration signals, and P9 (Meta-Governance) has something to govern. (P8.4 routing remains deferred — its `RoutingObservation` telemetry substrate doesn't exist; that's P7.5p.4, separately.)

## Hard governance boundary (non-negotiable)

```
Adapters READ sources and CALL pure builders. They RETURN CalibrationResult.
Adapters do NOT write to LearningStore directly — the orchestrator does.
Adapters do NOT create AdaptationProposals.
Adapters do NOT approve or apply anything.
Adapters do NOT mutate ProposalStore, OutcomeStore, or any source store.
Learning ≠ Mutation (P8 invariant). Signals and profiles in; no proposals out.
Operators always run `alix learning propose` explicitly to convert profiles to proposals.
```

This is the same LearningStore boundary from P8.0b. The adapters are pure wiring; the orchestrator is the single controlled write point.

## The 4 decisions needing sign-off

### Decision 1 — Adapters are pure; the orchestrator is the only writer

Each adapter is a **pure function** over stores: `(sources, opts) → AdapterResult`. It reads source stores, calls the pure builder, returns `{ signals, profiles, diagnostics }`. It does **not** touch `LearningStore`.

The `alix learning refresh` orchestrator is the **single mutation point**: it runs each adapter and appends the returned signals/profiles to `LearningStore`.

**Why:** Maximally testable. Adapters can be unit-tested against in-memory fixtures with zero store I/O. The orchestrator's only job is "run adapter, append results" — a trivial, auditable loop. A pure adapter that writes to a store would not be pure; the separation keeps the Learning ≠ Mutation invariant structurally obvious.

**Recommendation: pure adapters + single-writer orchestrator.**

#### Adapter Purity Invariant (sentinel-enforced)

Adapters MUST NOT import any mutation surface. A sentinel test greps the adapter files and fails the build on any forbidden import:

```text
Adapters may not import:
- LearningStore          (the orchestrator is the sole writer)
- ProposalStore
- ApprovalGate
- AdaptationProposalStore
- Any applier (AgentCardApplier, SkillApplier, RevertApplier, ...)
- AutomaticProposalGenerator
```

This is the structural enforcement of the Learning ≠ Mutation boundary at the adapter layer. It mirrors the P8.5a.0 Evidence Chain import sentinel.

### Decision 2 — `concernsRaised` heuristic for the P8.3 adapter

`LensCalibrationBuilder` consumes `LensObservation.concernsRaised: number`. `LensScore` has `rationale` (free text) but **no per-lens count** (flagged in the P7.5p.3 SDS). The adapter must derive the count.

**Heuristic:** `concernsRaised = 1` if `lensScore.recommendedVerdict` is a warning verdict (`agree_with_concerns` or `challenge`), else `0`. This makes `LensCalibrationBuilder`'s `predictiveValue = (warning-verdicts-with-failure) / (total warning-verdicts)` — exactly the right semantic (what fraction of a lens's warnings actually predicted failure).

**Recommendation: 1/0 heuristic.** It's the honest derivation from the available data (`recommendedVerdict` is the only per-lens signal that encodes "warned"). Documented in the adapter; not faked, just coarse.

**Fidelity note:** because `concernsRaised` is **inferred** from `recommendedVerdict` rather than explicitly recorded, P8.3 governance calibration is marked **`fidelity: "low"`** in the adapter's diagnostics. The orchestrator surfaces this. A future P9+ governance-telemetry phase can replace the heuristic with real per-lens concern counts, at which point the fidelity marker flips to `"high"`.

### Decision 3 — One PR, 4 atomic commits

| Commit | Sub-phase | What |
|---|---|---|
| 1 | P8.5a.2a | Recommendation adapter (pure fn) + tests |
| 2 | P8.5a.2b | Risk adapter (pure fn) + tests |
| 3 | P8.5a.2c | Governance adapter (pure fn) + tests + **retire `lens_scores_not_persisted` sentinel** |
| 4 | P8.5a.2d | `alix learning refresh` orchestrator (the single writer) + integration tests |

**Why not split into multiple PRs:** the adapters are only useful once the orchestrator wires them (commit 4). Splitting delays the "it works" moment and creates a window where dead code ships. Four atomic commits in one PR keeps each adapter independently reviewable while delivering a working `alix learning refresh` at the end. This matches the recon's "wiring scaffold" framing but with real (not stub) adapters.

**Recommendation: one PR, 4 commits.** (If the reviewer prefers a smaller blast radius, the natural split point is after commit 3: PR-A = 3 pure adapters, PR-B = orchestrator. I recommend against this — the orchestrator is what proves the adapters work end-to-end.)

### Decision 4 — Adapter file location: flat in `src/learning/`, with `-calibration-adapter` naming

The existing builders live flat in `src/learning/` (`recommendation-calibration-builder.ts`, etc.). Three adapters + a refresh orchestrator is small enough to keep flat. To make a future migration to `src/learning/adapters/` trivial (expected growth: routing, telemetry, explain, evidence adapters), the files use a consistent `-calibration-adapter.ts` suffix:

```text
src/learning/recommendation-calibration-adapter.ts
src/learning/risk-calibration-adapter.ts
src/learning/governance-calibration-adapter.ts
```

**Recommendation: flat, `-calibration-adapter.ts` suffix.** Matches the existing flat convention; the suffix pairs each adapter with its builder (`*-calibration-builder.ts`) and makes a later `git mv` into a subdir mechanical.

---

## The 3 adapters (contracts)

### Shared return type — `AdapterResult`

Every adapter returns the same shape so the orchestrator can summarize uniformly:

```ts
// src/learning/adapter-diagnostics.ts
export interface AdapterDiagnostics {
  /** Which adapter produced this (e.g. "recommendation"). */
  adapter: "recommendation" | "risk" | "governance";
  /** Source records read in the window. */
  sourceRecordsRead: number;
  /** Records that contributed to an observation. */
  processed: number;
  /** Records excluded, keyed by reason (e.g. { missingConfidence: 12, noOutcome: 3 }). */
  excludedReasons: Record<string, number>;
  /** Data fidelity: "high" for recorded observations, "low" for inferred (P8.3 concernsRaised). */
  fidelity: "high" | "low";
  notes?: string[];
}

export interface AdapterResult {
  signals: LearningSignal[];
  profiles: CalibrationProfile[];
  diagnostics: AdapterDiagnostics;
}
```

This gives the orchestrator operational visibility (per the design-change request): it can print "Outcomes processed: 47 / Excluded (no confidence): 12 / Signals: 3 / Profiles: 1" per adapter, and flag `fidelity: low` for governance.

### P8.1 — Recommendation adapter

```ts
// src/learning/recommendation-calibration-adapter.ts
export interface RecommendationAdapterOptions {
  windowDays?: number;       // default 30
  generatedAt?: string;      // injected for determinism in tests
}

export class RecommendationCalibrationAdapter {
  constructor(
    private readonly outcomeStore: OutcomeStore,
    private readonly builder = new RecommendationCalibrationBuilder(),
  ) {}

  /**
   * Read outcomes in the window, bucket by OutcomeRecord.confidence (the REAL
   * recommendation confidence, populated by P7.5p.1), and produce calibration
   * signals/profiles. Outcomes with confidence === undefined are excluded
   * (they predate P7.5p.1 or had no recommendation) — bucketing undefined
   * is meaningless. The exclusion count is reported in diagnostics, NOT
   * silently dropped.
   */
  async calibrate(opts?: RecommendationAdapterOptions): Promise<AdapterResult>;
}
```

**Buckets:** 5 fixed ranges — `0.0-0.2`, `0.2-0.4`, `0.4-0.6`, `0.6-0.8`, `0.8-1.0` — midpoints `0.1, 0.3, 0.5, 0.7, 0.9`. For each bucket: `totalCount` = outcomes in range, `successCount` = those with `outcome === "success"`. Feed `builder.calibrate(buckets, sourceReportId, generatedAt)`. Wrap the builder's `{signals, profiles}` with diagnostics `{ adapter: "recommendation", sourceRecordsRead, processed, excludedReasons: { missingConfidence: <n> }, fidelity: "high" }`.

**Diagnostics example:** `{ processed: 47, excludedReasons: { missingConfidence: 12 }, fidelity: "high" }`.

### P8.2 — Risk adapter

```ts
// src/learning/risk-calibration-adapter.ts
export class RiskCalibrationAdapter {
  constructor(
    private readonly riskStore: RiskScoreStore,
    private readonly outcomeStore: OutcomeStore,
    private readonly builder = new RiskCalibrationBuilder(),
  ) {}

  async calibrate(opts?: { windowDays?: number; generatedAt?: string }): Promise<AdapterResult>;
}
```

**Join:** `RiskScoreStore.queryByWindow(days)` → risk scores. For each, find the matching `OutcomeRecord` by `subjectId === proposalId`. Risk scores with no outcome are excluded (`excludedReasons: { noOutcome: <n> }`, not silently dropped). `dimensions` converted from `Record<RiskDimension, number>` to `DimensionScore[]`. Feed `builder.calibrate(observations, sourceReportId, generatedAt)`. `fidelity: "high"` (risk dimensions are recorded, not inferred).

### P8.3 — Governance adapter

```ts
// src/learning/governance-calibration-adapter.ts
export class GovernanceCalibrationAdapter {
  constructor(
    private readonly reviewStore: GovernanceReviewStore,
    private readonly outcomeStore: OutcomeStore,
    private readonly lensBuilder = new LensCalibrationBuilder(),
    private readonly govBuilder = new GovernanceCalibrationBuilder(),
  ) {}

  async calibrate(opts?: { windowDays?: number; generatedAt?: string }): Promise<AdapterResult>;
}
```

**Join:** `GovernanceReviewStore.queryByWindow(days)` × `OutcomeStore` by `proposalId`. Reviews with no outcome excluded (`excludedReasons: { noOutcome: <n> }`). From each matched review, derive `LensObservation[]` from `review.lensScores × outcome`: `concernsRaised = 1` if warning verdict, else `0` (Decision 2). Feed `LensCalibrationBuilder.build(observations)` → `LensCalibrationReport` → `GovernanceCalibrationBuilder.build(report)` → signals/profiles. **`fidelity: "low"`** (concernsRaised is inferred). A `notes` entry documents the inference for P9 visibility.

**Sentinel retirement:** this adapter's existence retires the `lens_scores_not_persisted` sentinel at `decision.ts:~1158`. The lens-calibration CLI path now runs `GovernanceCalibrationAdapter.calibrate()` against the store and returns a live `LensCalibrationReport` instead of the sentinel object.

---

## The orchestrator — `alix learning refresh`

```bash
alix learning refresh [--window 30] [--adapter <recommendation|risk|governance>] [--dry-run] [--json]
```

```ts
// Runs in src/cli/commands/ (the single LearningStore writer in this phase)
async function runLearningRefresh(args: string[]): Promise<void> {
  // 1. Parse --window (default 30), --adapter (default: all 3), --dry-run, --json
  // 2. For each selected adapter: adapter.calibrate({ windowDays }) → CalibrationResult
  // 3. If --dry-run: print what WOULD be appended, exit without writing
  // 4. Else: for each result, appendSignal/appendProfile to LearningStore (best-effort, log on failure)
  // 5. Print summary: signals written, profiles written, per-adapter
}
```

**Boundary:** the orchestrator writes ONLY to `LearningStore`. It does not create proposals, does not call `ApprovalGate`, does not mutate `ProposalStore`. `--dry-run` is a read-only preview. This is the gate the operator runs explicitly to refresh learning; converting profiles to proposals is a separate explicit `alix learning propose` step.

### Idempotency position — `refresh` is append-only, NOT idempotent

This is the first production writer into `LearningStore`, so the position must be explicit:

```text
refresh = append-only
```

Running `alix learning refresh` twice against identical source data **doubles** the signals/profiles in the store. This is intentional and matches the append-only store invariant — `LearningStore` has no update/delete. **Dedup is the consumer's concern (P9 calibration), not the writer's.**

To make consumer dedup possible **without a type change**, the orchestrator stamps every signal/profile from one run with a single shared `generatedAt` timestamp (it passes one `generatedAt` to all adapters in the run). P9 calibration can then scope to "the latest run within the window" by grouping on `generatedAt`. This uses an existing field — no change to `learning-types.ts` (strict-protected).

**Documented and tested:** the test suite asserts that two refreshes produce 2× the records (append-only), and that both runs' records share their respective `generatedAt`.

### Run Identity abstraction (P9-friendly, no schema change)

For human readability and P9 traceability, the orchestrator derives a **run identity** from the shared timestamp — `refreshRunId = \`refresh:${generatedAt}\``. It is NOT a field on `LearningSignal`/`CalibrationProfile` (no schema change); it is an orchestrator-level concept surfaced in:

- the refresh summary output (the first line of the report),
- the orchestrator's diagnostics/log (best-effort).

P9 can reconstruct the run id from any signal via `refresh:${signal.generatedAt}` — derivable from existing data, so the run-identity concept is fully queryable without modifying `learning-types.ts`. Example summary:

```text
Refresh Run: refresh:2026-06-23T12:00:00.000Z

Recommendation:
  processed: 47   excluded (no confidence): 12   fidelity: high
  signals: 3   profiles: 1

Risk:
  processed: 30   excluded (no outcome): 4   fidelity: high
  signals: 2   profiles: 1

Governance:
  processed: 18   excluded (no outcome): 2   fidelity: low
  signals: 4   profiles: 1
```

### Partial source availability — adapters are independent

The three adapters MUST be independent: each reads its own source store(s), and an empty source produces an empty `AdapterResult` (zero signals/profiles, zero processed), NOT an error. This matters operationally because the P7.5p stores fill at different rates (recommendation fills on every `runRecommend`; risk fills on every `runRecommend`; governance fills only when an operator runs `alix decision review`). Refresh with only one populated store runs that adapter and no-ops the other two cleanly.

---

## Files created

- `src/learning/adapter-diagnostics.ts` — shared `AdapterResult` / `AdapterDiagnostics` types
- `src/learning/recommendation-calibration-adapter.ts` — P8.1 adapter
- `src/learning/risk-calibration-adapter.ts` — P8.2 adapter
- `src/learning/governance-calibration-adapter.ts` — P8.3 adapter
- `src/cli/commands/learning-refresh.ts` (or inline in an existing learning CLI file — see plan) — the orchestrator
- `tests/learning/recommendation-calibration-adapter.vitest.ts`
- `tests/learning/risk-calibration-adapter.vitest.ts`
- `tests/learning/governance-calibration-adapter.vitest.ts`
- `tests/learning/adapter-purity-sentinels.vitest.ts` — the purity-invariant grep sentinel (Decision 1)
- `tests/cli/commands/learning-refresh.vitest.ts`

## Files modified

- `src/cli/commands/decision.ts` — retire the `lens_scores_not_persisted` sentinel (replace with a live `GovernanceAdapter`-backed run) [P8.5a.2c]
- `src/cli.ts` (or the learning-command router) — register `alix learning refresh` [P8.5a.2d]

## Files NOT modified

- All 3 calibration builders (`recommendation-calibration-builder.ts`, `risk-calibration-builder.ts`, `governance-calibration-builder.ts`) — pure, untouched
- `LensCalibrationBuilder` — pure, untouched
- `learning-store.ts` — append-only store, untouched (the orchestrator only CALLS its existing `appendSignal`/`appendProfile`)
- `learning-types.ts` (strict-protected)
- The 6 protected type files (incl. `outcome-types.ts`)
- The P8.5a.0 Evidence Chain layer
- The 3 P7.5p stores (read-only from adapters)
- `routing-calibration-builder.ts` (P8.4 — deferred; no adapter)

---

## Acceptance criteria

- [ ] `RecommendationAdapter.calibrate()` buckets outcomes by real `confidence`, excludes undefined, feeds P8.1 builder, returns CalibrationResult (test)
- [ ] `RiskAdapter.calibrate()` joins RiskScore × Outcome by proposalId, produces DimensionScore[], feeds P8.2 builder (test)
- [ ] `GovernanceAdapter.calibrate()` joins GovernanceReview × Outcome, derives LensObservation[] with the 1/0 concernsRaised heuristic, feeds P8.3 builder (test)
- [ ] Each adapter is pure: takes stores in its constructor, `calibrate()` returns `AdapterResult`, never writes to LearningStore (sentinel: adapters do not import LearningStore / ProposalStore / ApprovalGate / AdaptationProposalStore / appliers / AutomaticProposalGenerator)
- [ ] The purity-invariant sentinel test greps the 3 adapter files for forbidden imports and fails on any
- [ ] Each adapter returns diagnostics (`processed`, `excludedReasons`, `fidelity`); P8.3 governance is `fidelity: "low"`
- [ ] `alix learning refresh` runs all 3 adapters, writes signals+profiles to LearningStore (integration test)
- [ ] `alix learning refresh` prints per-adapter diagnostics (processed / excluded / signals / profiles / fidelity)
- [ ] `alix learning refresh --dry-run` prints preview, writes nothing (test)
- [ ] `alix learning refresh --adapter risk` runs only the risk adapter (test)
- [ ] **Append-only idempotency:** running refresh twice against identical source data produces 2× the records; both runs' records share their respective `generatedAt` (test documents the position)
- [ ] The `lens_scores_not_persisted` sentinel is retired — the lens-calibration CLI path returns a live report (test)
- [ ] Empty source data → adapters return empty `AdapterResult`, refresh writes nothing, no crash (test)
- [ ] **Partial source availability:** with only the recommendation store populated (risk + governance empty), the recommendation adapter runs, the other two return empty, refresh succeeds, no adapter blocks another (test)
- [ ] Adapters + orchestrator do NOT import `ProposalStore` / `ApprovalGate` / appliers / `AutomaticProposalGenerator` (sentinel)
- [ ] All P8 + P8.5a.0 + P7.5p.1/.2/.3 tests still pass (no regression)
- [ ] 6 protected type files byte-identical to baseline
- [ ] `tsc --noEmit` clean
- [ ] `gitnexus_detect_changes` shows scope is P8.5a.2

## Out of scope

- P8.4 routing adapter (needs `TelemetryCapture` substrate — P7.5p.4, deferred)
- Converting CalibrationProfiles → AdaptationProposals (that's the existing `alix learning propose`, unchanged)
- NiceGUI dashboard (P8.5b)
- `alix explain` Evidence Chain traversal (P8.5c)
- Auto-refresh / scheduled refresh (operator runs `alix learning refresh` explicitly)
- Persisting CalibrationProfiles with a `proposed: boolean` flag (the Evidence Chain already tracks proposal-ready profiles via `generated` links)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Adapters accidentally write to LearningStore (breaking purity) | Sentinel test: adapter files do not import `LearningStore`. The orchestrator is the only writer. |
| The orchestrator becomes a hidden mutation path | Orchestrator writes ONLY to LearningStore; `--dry-run` is read-only; explicit operator command. Sentinel: orchestrator does not import `ApprovalGate`/appliers. |
| Empty/insufficient source data produces noise | Adapters return empty results when source data is thin; builders already gate on `minSamples` (P8.1's `DEFAULT_MIN_SAMPLES = 5`). Refresh writes nothing when results are empty. |
| The `concernsRaised` 1/0 heuristic skews lens calibration | Documented, defensible, and the only honest derivation from `recommendedVerdict`. P9 can refine if a richer per-lens concern count is added later. |
| Sentinel retirement changes the lens-calibration CLI output shape | The new output is a real `LensCalibrationReport` (which the sentinel was a placeholder for). Consumers reading the sentinel string will break — but the sentinel explicitly said "not persisted," so no consumer should depend on it. Document the shape change in the PR body. |
| First real write to LearningStore in production | This is the intended outcome. The store is append-only; signals/profiles are advisory. No mutation authority crosses the boundary. |

## What this unlocks

- **`LearningStore` is populated by real calibration signals** for the first time. `alix learning report` returns real data.
- **P9 (Meta-Governance)** has something to govern: real signals, real profiles, real joinable evidence.
- **P8.5b dashboard** has real data to display.
- **P8.5c `alix explain`** can traverse the Evidence Chain over real artifacts.
- The `lens_scores_not_persisted` sentinel — the symbol of the dormant P8 loop — is retired.

---

## Recommended slice order (within this PR)

```text
P8.5a.2a  Recommendation adapter  ← reads OutcomeStore (confidence now real)
P8.5a.2b  Risk adapter            ← joins RiskScoreStore × OutcomeStore
P8.5a.2c  Governance adapter      ← joins GovernanceReviewStore × OutcomeStore; retires sentinel
P8.5a.2d  alix learning refresh   ← single writer; proves all 3 work end-to-end
```

Each commit is independently testable (pure adapter + unit tests). The 4th commit is the integration proof.