# P8.5c — Explain Command Design Spec (SDS)

> **Status:** SDS only — awaiting review before the implementation plan is written.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-23-p8-5c-explain-command-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-23-p8-5c-explain-command.md`
> **Governs:** `feature/p8.5c-explain-command` branch, off `main` at HEAD (squash of PR #112, `fbe0f82a`).
> **Risk level:** LOW — read-only query engine over already-persisted artifacts. No new authority, no mutation, no new store.

## Goal

Provide operators with a single command that walks the **entire persisted decision lifecycle** for a given proposal, producing a 6-layer human-readable explanation:

```text
Proposal
│
├─ Outcome              ─→ Success / Failure / Mixed
│
├─ Recommendation       ─→ Decision, Confidence, Reasons
│
├─ Risk Assessment      ─→ Overall Risk, Dimensions, Drivers
│
├─ Governance Review    ─→ Lens Scores, Concerns, Verdict
│
├─ Learning Signals     ─→ Recommendation Calibration, Risk Calibration, Governance Calibration
│
└─ Calibration Impact   ─→ Profiles Created, Future Decision Implications
```

This validates the entire P7.5p → P8.5a chain end-to-end. If this command produces a coherent 6-layer explanation for a real seeded proposal, the substrate is proven coherent.

## Hard governance boundary (non-negotiable)

```text
Explain reads.
Explain never writes.
```

Explain is a **query engine**, not an intelligence engine. It assembles an explanation from already-persisted artifacts; it does not generate, modify, or propose anything.

**Forbidden actions inside Explain:**
- Proposal generation
- Proposal mutation
- Approval / rejection / apply
- Learning refresh
- Store updates
- Evidence chain writes
- Calibration recalculation

**Allowed actions inside Explain:**
- Store reads (OutcomeStore, ApprovalRecommendationStore, RiskScoreStore, GovernanceReviewStore, LearningStore, EvidenceChainStore)
- Evidence chain traversal (read-only)
- Adapter result inspection (re-compute on the fly OR pull most recent signals from LearningStore — see Decision 3)
- Explanation assembly in memory
- Rendering (terminal or JSON)

---

## The 8 design questions

### 1. What command surface?

**Single command:**

```bash
alix explain proposal <proposal-id> [--window <days>] [--json]
```

- `<proposal-id>` — required, the proposal to explain
- `--window <days>` — optional, default 90. Limits how far back the explanation looks for related learning signals / profiles. Older signals are not displayed even if present.
- `--json` — optional, machine-readable output

**Future explain targets (deferred to P8.5d/P8.5e, NOT in P8.5c):**
- `alix explain signal <signal-id>`
- `alix explain governance-review <review-id>`
- `alix explain adapter <adapter-name>`

P8.5c proves the architecture. Other explain targets follow once the join graph is proven coherent.

### 2. What is the explanation data model?

A new in-memory type, **never persisted**:

```ts
/**
 * In-memory explanation assembled by runExplainProposal().
 * NOT persisted. NOT a DecisionArtifact. NOT an adapter output.
 * Pure aggregation of already-persisted artifacts.
 */
export interface ProposalExplanation {
  /** The proposal being explained. */
  proposalId: string;

  /** When the explanation was assembled. */
  generatedAt: string;

  /** Window (in days) the explanation covers for learning signals. */
  windowDays: number;

  /** Layer 1: Outcome (or "not available" marker). */
  outcome: OutcomeLayer | UnavailableLayer;

  /** Layer 2: Recommendation (or "not available"). */
  recommendation: RecommendationLayer | UnavailableLayer;

  /** Layer 3: Risk Assessment (or "not available"). */
  risk: RiskLayer | UnavailableLayer;

  /** Layer 4: Governance Review (or "not available"). */
  governance: GovernanceLayer | UnavailableLayer;

  /** Layer 5: Learning Signals (always present, may be empty). */
  learning: LearningLayer;

  /** Layer 6: Calibration Impact (always present, may be empty). */
  calibration: CalibrationLayer;

  /**
   * Top-level integrity summary. Lets P8.5b Dashboard / P9 Meta-Governance
   * consume "5/6 layers available, chain 50% complete" without reparsing
   * the explanation. Forward-compatible with health monitoring and
   * regression testing.
   */
  explanationIntegrity: ExplanationIntegrity;
}

/**
 * Per-layer and aggregate observability metadata for the explanation.
 * Computed by the assembler; always populated (never absent).
 */
export interface ExplanationIntegrity {
  /** Whether each layer was sourced successfully. */
  outcomeFound: boolean;
  recommendationFound: boolean;
  riskFound: boolean;
  governanceFound: boolean;
  learningFound: boolean;
  calibrationFound: boolean;
  /** Evidence chain was used as the primary path for at least one layer. */
  evidenceChainUsed: boolean;
  /** At least one layer fell back to a proposalId join. */
  fallbackJoinsUsed: boolean;
  /** Number of layers where evidence-chain traversal failed. */
  incompleteChainLayers: number;
  /** Total number of layers considered (always 6 for P8.5c). */
  totalLayers: number;
  /** Convenience: count of layers where *Found is true. */
  layersAvailable: number;
  /**
   * Pre-computed completeness percentage: (layersAvailable / totalLayers) * 100,
   * rounded to 1 decimal place. Lets Dashboard cards, P9 health scoring,
   * regression tests, and CLI summaries read this directly without
   * recalculating.
   *
   * Example: 5 of 6 layers available → 83.3.
   */
  completenessPercent: number;
}

interface UnavailableLayer {
  status: "not_available";
  reason: string;
}

interface OutcomeLayer {
  status: "available";
  outcome: OutcomeValue;
  observedAt: string;
  /**
   * Artifact IDs that contributed to this layer (e.g. the OutcomeRecord id).
   * Per-layer source list — NOT the Evidence Chain graph. Distinct from
   * `EvidenceChainStore`'s `ProvenanceLink` relationships.
   */
  evidenceRefs: string[];
}

interface RecommendationLayer {
  status: "available";
  recommendationId: string;
  decision: string;
  confidence: number | undefined;          // undefined = P7.5p.1 missing
  reasons: string[];
  /**
   * See OutcomeLayer.evidenceRefs — per-layer source list, not the graph.
   */
  evidenceRefs: string[];
}

interface RiskLayer {
  status: "available";
  riskScoreId: string;
  overallRisk: number;
  outcome: RiskOutcome;                    // low/medium/high/critical
  dimensions: { dimension: RiskDimension; score: number; confidence: number; reasons: string[] }[];
  /**
   * See OutcomeLayer.evidenceRefs — per-layer source list, not the graph.
   */
  evidenceRefs: string[];
}

interface GovernanceLayer {
  status: "available";
  reviewId: string;
  verdict: GovernanceVerdict;
  concerns: string[];
  lensScores: { lens: LensName; verdict: GovernanceVerdict; confidence: number }[];
  /**
   * See OutcomeLayer.evidenceRefs — per-layer source list, not the graph.
   */
  evidenceRefs: string[];
}

interface LearningLayer {
  /**
   * Signals grouped by adapter name, mirroring the P8.5a.2 AdapterRegistry
   * shape. Future adapters (P7.5p.4 TelemetryCapture, etc.) drop in as a
   * new key without schema, renderer, or JSON-contract changes.
   *
   * For P8.5c the keys are: "recommendation", "risk", "governance".
   */
  signalsByAdapter: Record<string, LearningSignal[]>;
  /** Flat list of adapter names that contributed at least one signal. */
  adaptersWithSignals: string[];
  /** Sum of all signals across all adapters. */
  totalSignals: number;
}

interface CalibrationLayer {
  profilesByTarget: Record<string, CalibrationProfile[]>;
  /** One-line summary per profile: target → previousValue → suggestedValue. */
  adjustments: { target: string; previousValue: number; suggestedValue: number; reason: string }[];
}
```

The explanation is a value object — no behavior, no methods. Renderers consume it.

### 3. How are learning signals sourced?

Two options:

**(a) Pull most-recent from LearningStore:**
- For each adapter name (`recommendation`, `risk`, `governance`), query `LearningStore.querySignals({ signalTypes, windowDays })` filtered to signals whose `sourceReportId` references this proposalId OR whose `subject` mentions the proposalId.
- Returns the persisted signal set the refresh orchestrator has written.

**(b) Re-run the adapters on the fly:**
- Construct the 3 adapters (read-only, no LearningStore writes) and call `adapter.calibrate()` with this proposal's window.
- Returns signals derived from current store state.

**Decision: Option (a).** Reasons:
- Explain is a query engine, not an intelligence engine (governance boundary).
- Re-running adapters could mutate LearningStore if the implementation slips — option (a) is structurally read-only.
- Option (a) reflects what ALiX has actually learned, not what it would learn if refreshed.
- Operators can refresh separately (`alix learning refresh`) and then explain to see the update.

**Heuristic for matching signals to proposal:**
- Filter LearningSignals by `sourceReportId` containing the proposalId (the recommendation-adapter sets `sourceReportId = recommendation-accuracy-window-${windowDays}` — so this won't directly match).
- Fall back to filtering by signal `subject` containing the proposalId, OR by `sourceReportId` containing the proposalId. (Per Q7 correction: `evidenceRefs` is not a backlink on artifacts; it lives in EvidenceChainStore.)

**More precise heuristic (locked):** Match LearningSignals whose `sourceReportId` ends with `-${proposalId}` OR whose `subject` contains `${proposalId}`. (See Q7 correction — `evidenceRefs` is not a backlink on artifacts; it lives in EvidenceChainStore as `ProvenanceLink`.)

In practice, signals carry the proposalId in their `subject` because they were derived from a specific proposal's risk score or governance review.

**Migration path (forward-looking):** The string-matching heuristic is acceptable for P8.5c but is **not** governance-grade. A future iteration (post-P9) will extend `LearningSignal` with an explicit `sourceProposalIds: string[]` (or `proposalId?: string`) field. When that lands, the assembler switches to:

```text
Priority 1: explicit sourceProposalIds metadata
Priority 2: EvidenceChainStore ProvenanceLink traversal
Priority 3: subject/sourceReportId heuristic (deprecated)
```

P8.5c locks in this priority order today, so the migration is structural rather than a behavioral surprise.

**Why this matters:** Otherwise P9 ends up governing string-matching rules instead of artifact relationships.

### 4. How are calibration profiles sourced?

Same approach: **pull from LearningStore**, filter profiles whose `subject` contains the proposalId OR whose `evidenceRefs` (the existing array on `DecisionArtifact`/`CalibrationProfile` for *direct* source references, distinct from the EvidenceChain graph) references the proposalId. Profiles describe **future adjustments** — they are inherently cross-proposal (one profile may affect many future proposals). Display them grouped by `target` field.

Profiles with no proposalId reference are filtered out unless `--window` is so wide that ALL profiles in the window are returned (rare; explicit operator request).

### 5. How is missing data handled?

**Missing-data resilience is a first-class acceptance criterion.** Every layer can be absent. The explanation must render with `UnavailableLayer` markers:

```text
Outcome:               not available  (no OutcomeRecord for proposal prop-123)
Recommendation:        not available  (no ApprovalRecommendation linked to proposal)
Risk Assessment:       available      (risk-R-001, overall 0.42 → medium)
Governance Review:     not available  (no GovernanceReview for proposal)
Learning Signals:      available      (3 signals, 1 from recommendation adapter, 2 from risk adapter)
Calibration Impact:    available      (2 profiles affecting recommendation_confidence_multiplier)
```

The explanation ALWAYS renders. It never crashes on missing layers. Each layer explicitly states `available` or `not available` with a one-line reason.

### 6. How does Explain fit into the CLI topology?

**New CLI dispatcher: `alix explain`.** Lives in `src/cli/commands/explain.ts` (new file). Switch on subcommand (`proposal` for now; future targets slot in as new cases).

**CLI integration:** Wire into the existing top-level CLI dispatcher (`src/cli.ts` or wherever `alix decision`, `alix learning` are routed). Add `case "explain"` that calls `handleExplainCommand(args)`.

**No new global flag.** The `--window` flag is local to `explain proposal`.

### 7. What about the Evidence Chain?

**Core model (corrected):**

```text
Artifacts do not carry backlinks.
EvidenceChainStore carries relationships.
Explain queries the graph.
```

The P8.5a.0 Evidence Chain is a **separate append-only graph** (`EvidenceChainStore`) that records `ProvenanceLink` relationships between artifacts. Source artifacts (OutcomeRecord, ApprovalRecommendation, RiskScore, GovernanceReview, LearningSignal, CalibrationProfile) carry **no `evidenceRefs` backlinks** — they remain facts. The Evidence Chain is the relationship layer.

Explain queries the graph directly via `EvidenceChainStore`:

1. **Attempt EvidenceChainStore traversal first.** For each layer (Outcome, Recommendation, Risk, Governance, Learning Signals, Calibration), call `chainStore.getChainForRoot(rootArtifactId)` and traverse `links: ProvenanceLink[]` (depth capped at `EXPLAIN_MAX_DEPTH = 12`, default `EXPLAIN_DEFAULT_DEPTH = 5`).
2. **Follow ProvenanceLink.sourceArtifactId / targetArtifactId** to resolve: outcome → recommendation, outcome → riskScore, outcome → governanceReview, learningSignal → source artifacts, calibrationProfile → source signals.
3. **If traversal yields no resolvable link** for a layer, mark `chainStatus = "incomplete"` for that layer.
4. **Then perform fallback joins** to populate the layer from direct fields or proposalId, and mark `joinStatus = "fallback_used"`.

**Per-layer preferred order (locked):**

For Outcome, Recommendation, Risk, Governance layers:

```text
1. EvidenceChainStore link traversal
2. Existing direct fields on the artifact (e.g., OutcomeRecord.subjectId,
   ApprovalRecommendation.proposalId, RiskScore.id === risk-<proposalId>,
   GovernanceReview.proposalId)
3. ProposalId joins via list/store filters
```

For Learning Signals / Calibration Profiles layers:

```text
1. EvidenceChainStore links from signals/profiles to proposal-related artifacts
2. Explicit source IDs already present on the artifact:
   - sourceSignalIds (on CalibrationProfile)
   - sourceReportId (on LearningSignal)
3. Temporary string heuristic (deprecated post-P9):
   - subject contains proposalId
   - sourceReportId contains proposalId
```

The string heuristic remains as **Priority 3** in P8.5c and is replaced by explicit `sourceProposalIds: string[]` metadata in a future migration (see Decision 1 above).

**For P8.5c:** Implement all paths in priority order. Always attempt evidence-chain first; on failure, mark incomplete and fall through to direct fields / proposalId. Surface both states in the operator-facing output AND in the JSON `explanationIntegrity` field. This makes Explain an **observability tool for chain quality**, not just a content renderer.

**Operator-visible behavior:**

```text
Outcome               ── Evidence Chain ── available (chainStatus: complete)
Recommendation        ── Evidence Chain ── available (chainStatus: complete)
Risk Assessment       ── Evidence Chain ── not available (chainStatus: incomplete; fallback join used)
Governance Review     ── Fallback Join  ── available (chainStatus: not_attempted)
Learning Signals      ── LearningStore  ── available (3 signals)
Calibration Impact    ── LearningStore  ── available (2 profiles)

Explanation Integrity: 5/6 layers available
Evidence Chain: 50% complete
Fallback Joins Used: Yes (1 layer)
```

This gives P9 a high-leverage observability hook for chain quality without introducing a new persistence substrate.

### 8. What testing strategy?

Three layers of tests:

**(a) Unit tests for the explanation assembly:**
- Empty stores → explanation with all layers `not_available`
- Single layer present → explanation with that layer `available`, others `not_available`
- All layers present → complete 6-layer explanation
- Each layer's data fields correctly populated (round-trip from store through assembler)

**(b) Integration tests with seeded data:**
- Seed an OutcomeRecord, ApprovalRecommendation, RiskScore, GovernanceReview, and matching LearningSignals/Profiles for `prop-1`
- Run `runExplainProposal({ proposalId: "prop-1", cwd, windowDays: 30 })`
- Assert the explanation has all 6 layers populated and they reference the seeded artifacts

**(c) CLI tests:**
- `alix explain proposal prop-1` prints the human-readable walk
- `alix explain proposal prop-1 --json` prints valid JSON matching `ProposalExplanation` shape
- Missing data renders `not available` lines, not crashes

**(d) Purity sentinel:**
- `src/cli/commands/explain.ts` and the explanation assembler MUST NOT import any mutation surface (LearningStore write paths, ProposalStore, ApprovalGate, appliers, AutomaticProposalGenerator).
- Sentinel test: grep these files for forbidden imports.

---

## Open design notes (for discussion)

1. **Adapter signals vs. persisted signals.** Option (a) of Q3 pulls from LearningStore. But signals are written only when `alix learning refresh` has run. If the operator runs `alix explain proposal prop-1` BEFORE any refresh, the Learning Layer will be empty even though the calibration data exists in the source stores. **Two mitigations:**
   - (i) **Conditional refresh hint:** Show the hint only when the Learning Layer is empty (no signals found in the window). The hint surfaces in the terminal renderer AND in the JSON output as `learningRefreshHint: string | null`. No `--verbose` flag required — the hint is operator-friendly because it appears exactly when useful.
   - (ii) Document that Explain reflects what ALiX has actually learned, not what it could learn.

   **Terminal renderer behavior (locked):**

   ```text
   Learning Signals
     No signals found.

   Hint:
     Run "alix learning refresh"
     to generate calibration signals.
   ```

   **JSON output behavior (locked):**

   ```json
   {
     "learning": { "signalsByAdapter": {...}, "totalSignals": 0 },
     "learningRefreshHint": "Run 'alix learning refresh' to generate calibration signals for this proposal."
   }
   ```

   Recommendation: do BOTH (i) and (ii). The hint is friendly; the documentation sets the right mental model.

2. **Window filter edge case.** If `--window 7` and the proposal is older than 7 days, signals emitted within 7 days are still shown if they reference the proposal. This is correct — recency of learning matters, not recency of proposal. Document this.

3. **Calibration Impact forward-looking language.** Profiles describe adjustments. Should Explain phrase these as "the next 3 decisions on similar proposals will be calibrated by X"? Or stay factual: "Profile P-001 suggests confidence multiplier 0.85 for bucket 0.8-1.0"? **Recommendation:** stay factual. Forward-looking language risks implying automatic application; profiles are advisory only (P8 invariant).

4. **JSON output shape.** Mirror the `ProposalExplanation` TypeScript interface exactly (camelCase field names, nested objects, no extra wrapping). Future P8.5b Dashboard will consume this JSON verbatim.

5. **Performance.** Explain reads from up to 6 stores + filters. For typical sizes (hundreds of records per store), this is sub-100ms. Document this as a non-goal — Explain is interactive, not high-throughput. If performance becomes an issue, future indexing is a separate concern.

---

## Explicitly out of scope

| Feature | Belongs to |
|---|---|
| `alix explain signal <id>` | P8.5d (deferred) |
| `alix explain governance-review <id>` | P8.5e (deferred) |
| `alix explain adapter <name>` | Future |
| Explain output persistence (ExplanationStore) | Future if needed; for P8.5c, ephemeral only |
| Interactive explanation (chat-style) | Out of scope — Explain is a CLI query |
| Multi-proposal batch explain | Future — P8.5b Dashboard territory |
| Explanation caching | Future — for P8.5c, fresh read every time |

---

## Acceptance criteria

### Functional

```text
Given a proposal with:
  - 1 OutcomeRecord (success/failure)
  - 1 ApprovalRecommendation
  - 1 RiskScore
  - 1 GovernanceReview
  - 3+ LearningSignals across the 3 adapters
  - 1+ CalibrationProfiles

alix explain proposal <id>

returns a 6-layer explanation with all layers "available".
```

### Missing-data resilience

```text
Given a proposal with NO related artifacts:

alix explain proposal <id>

returns an explanation with all layers "not available" and explicit reasons.
Does not crash. Does not require any flag to bypass.
```

### Read-only invariant

```text
alix explain proposal <id>

performs zero writes to any store.
Verified by:
  - Sentinel grep test on explain.ts and the assembler module
  - File-system diff before/after running explain
```

### Output modes

```text
alix explain proposal <id>             → human-readable terminal walk
alix explain proposal <id> --json      → JSON matching ProposalExplanation interface
```

### Cross-validation with Evidence Chain

```text
For a proposal whose EvidenceChainStore contains a ProvenanceLink connecting
the outcome/proposal to a GovernanceReview, the explanation's Governance
Layer should be sourced from that linked review, not from a fallback
proposalId query.
```

---

## What this proves for P9

If P8.5c works as specified, the following are proven end-to-end:

| P9 dependency | Status proven by P8.5c |
|---|---|
| OutcomeStore aggregation | Layer 1 reads + missing-data handling |
| ApprovalRecommendationStore | Layer 2 reads + EvidenceChain traversal |
| RiskScoreStore | Layer 3 reads + windowed filtering |
| GovernanceReviewStore | Layer 4 reads + lens score extraction |
| LearningStore | Layer 5/6 reads + signal/profile matching |
| EvidenceChainStore | ProvenanceLink traversal + fallback observability (Q7) |
| Read-only invariant | Sentinel-enforced |

P9 (meta-governance) can then consume either:
- The `ProposalExplanation` JSON shape directly (Dashboard-friendly)
- The same store-level joins (governance-friendly)

P9 becomes a much stronger layer because it can reason over human-readable explanations.

---

## File structure (new files for P8.5c)

```text
src/cli/commands/explain.ts                        # CLI dispatcher + renderers
src/explain/proposal-explanation-types.ts          # ProposalExplanation + layer interfaces
src/explain/proposal-explanation-assembler.ts      # pure assembler (store reads → ProposalExplanation)
src/explain/explain-purity-sentinels.vitest.ts     # sentinel test
tests/explain/proposal-explanation-assembler.vitest.ts  # unit + integration tests
tests/cli/commands/explain-cli.vitest.ts           # CLI tests
```

No modifications to existing stores, types, or adapter code. No new persistence substrate.

---

## Resolved design decisions (post-review)

These three decisions were open in the initial draft and are now **locked**:

### Decision 1 — Signal matching heuristic (Q3)

**Approved as temporary fallback with explicit migration path.** The current heuristic (subject / evidenceRefs / sourceReportId matching) is acceptable for P8.5c but is **not governance-grade**. A future iteration (post-P9) will extend `LearningSignal` with an explicit `sourceProposalIds: string[]` field. When that lands, the assembler switches to a priority order:

```text
Priority 1: explicit sourceProposalIds metadata
Priority 2: evidenceRefs chain
Priority 3: subject/sourceReportId heuristic (deprecated)
```

P8.5c locks in this priority order today, so the migration is structural rather than a behavioral surprise.

### Decision 2 — Evidence Chain fallback policy (Q7)

**Tightened to expose incomplete chains rather than silently fallback.** Evidence-chain traversal is attempted first. On failure, the layer is marked `chainStatus: "incomplete"` and a proposalId fallback join is performed (marked `joinStatus: "fallback_used"`). Both states are surfaced in the operator-facing output AND in the JSON `explanationIntegrity` field. This makes Explain an **observability tool for chain quality**, not just a content renderer.

### Decision 3 — Refresh hint (open note 1)

**Conditional rendering, no `--verbose` flag required.** The hint appears only when the Learning Layer is empty (no signals found in the window). Renders in both terminal mode (multi-line block under the empty Learning Signals layer) and JSON mode (`learningRefreshHint: string | null`).

---

## Added forward-looking field: `explanationIntegrity`

A new top-level field on `ProposalExplanation`:

```ts
explanationIntegrity: ExplanationIntegrity;
```

This gives P8.5b Dashboard, P9 Meta-Governance, and any future health/regression tooling a single read that summarizes "5/6 layers available, chain 50% complete, fallback joins used: yes" without reparsing the explanation. The field is always populated; never absent.

This is exactly the kind of artifact that turns Explain from a content renderer into a substrate validator.

### `completenessPercent` — pre-computed for downstream consumers

`ExplanationIntegrity.completenessPercent` is computed once by the assembler as `(layersAvailable / totalLayers) * 100`, rounded to 1 decimal place. Consumers (Dashboard cards, P9 health scoring, regression tests, CLI summaries) read it directly without recalculating. Example: `5` of `6` layers available → `83.3`.

### `LearningLayer.signalsByAdapter` mirrors the AdapterRegistry

The Learning Layer uses `Record<string, LearningSignal[]>` (keyed by adapter name) rather than fixed fields per adapter. For P8.5c the keys are `"recommendation"`, `"risk"`, `"governance"`. When P7.5p.4 TelemetryCapture arrives as a fourth adapter, no schema, renderer, JSON-contract, or Dashboard change is needed — the new key just appears. The renderer iterates `Object.entries(learning.signalsByAdapter)` rather than hard-coding each adapter.

This mirrors the AdapterRegistry pattern from P8.5a.2 and keeps P8.5c future-proof.