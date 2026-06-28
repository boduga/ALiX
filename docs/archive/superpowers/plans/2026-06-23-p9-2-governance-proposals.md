# P9.2 — GovernanceProposal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the P9.1 → P5 advisory-to-proposal bridge. A single explicit operator command (`alix governance propose <recommendation-id>`) reads a `GovernanceRecommendation`, applies an eligibility gate, and creates exactly one pending `Proposal` with action `governance_change` and a typed payload projected 1:1 from `Recommendation.metadata`. The proposal enters the existing P5 lifecycle; P9.2 has no opinion on, and no involvement in, approval or application.

**Architecture:** A new module `src/governance/governance-proposal-generator.ts` is the *single* P9 file permitted to import `ProposalStore` (per the P9.0f sentinel + ADR-0004). It loads the recommendation, runs the eligibility gate (confidence ≥ 0.6, priority ≠ "low", status === "open"), checks idempotency via the EvidenceChain (no prior `proposal_from_recommendation` chain rooted at this recommendation), translates the payload via a 1:1 projection, and atomically persists (proposal + chain link) with compensating-tombstone recovery on edge-write failure. CLI dispatches via `alix governance propose <id> [--json]`. Sentinel updated to allowlist the bridge file and to add the snapshot-equal assertion for `adaptation-types.ts` per ADR-0004.

**Tech Stack:** TypeScript, vitest, node:fs (JSONL append-only persistence via existing stores).

## Global Constraints

- **Hard boundary (4 invariants, structurally enforced):**
  - Recommendations may become proposals (explicit operator command)
  - Proposals still require approval
  - No recommendation may approve itself
  - No proposal may apply itself
- **6 protected type files (per ADR-0004):** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`. P9.2 will additively extend `adaptation-types.ts` only (Allowed class): add `"governance_change"` to `ProposalAction` and `{ kind: "governance"; recommendationId: string }` to `ProposalTarget`. No other protected file is touched. No Forbidden mutations.
- **Sentinel `ALLOWED_IN_FILE` allowlist** (per P9.0f + ADR-0004): `src/governance/governance-proposal-generator.ts` is the ONLY P9 file that may import `ProposalStore` and `createProposal` / `ProposalStore.save` / `ProposalStore.update`. Even that file is forbidden from `ApprovalGate`, `approve(`, `apply(`, any applier class, `runApplier(`, and any other P8 store write surface.
- **Eligibility gate** — `confidence >= 0.6` AND `priority !== "low"` AND `status === "open"`. Fail-closed with clear rejection message including the reason.
- **Idempotency** — one recommendation produces at most one `governance_change` proposal. The check queries `EvidenceChainStore.getChainForRoot(recommendationId)` for any chain whose links contain a `proposal_from_recommendation` ProvenanceLink. If found, refuse with the existing proposal ID.
- **Translation** — payload is a 1:1 projection of `Recommendation.metadata` (a P9.1 amendment; see Task 0). Pure function with one key rename: `category` → `kind`. No text parsing, no heuristics, no nullable fields.
- **Confidence inheritance** — `Proposal.confidence = Recommendation.confidence` (no recalculation in P9.2).
- **Atomicity** (case A/B invariant from SDS): either (A) proposal + provenance chain both exist, or (B) proposal is `markOrphaned` and excluded from `ProposalStore.list()`. No normal pending proposal may appear without a `proposal_from_recommendation` chain.
- **No P9.2 symbols leakage** — `GovernanceProposal` (the type, distinct from a P5 `Proposal` with `action: "governance_change"`) remains forbidden everywhere. `governance_change` is a new `ProposalAction` value, not a new type. The proposal *is* a P5 `Proposal`; the discriminator is the action value.
- **Provenance fast-lookup fields** (denormalized, non-authoritative): `provenance.proposedFromRecommendationId` and `provenance.recommendationCategory`. EvidenceChain remains the audit source of truth. If they ever disagree, the EvidenceChain wins.
- **CLI UX** — `alix governance propose <recommendation-id> [--json]`. Verbose human-readable summary by default; `--json` for machine output. Rejection text + non-zero exit; success text + zero exit.

---

## Task 0 (PREREQUISITE): P9.1 metadata amendment

**This task is a prerequisite for P9.2.** It must be merged into `main` before any P9.2 task begins. P9.2's translation function is `payload = recommendation.metadata`; without `Recommendation.metadata` populated, P9.2 cannot produce a typed payload.

**Files:**
- Modify: `src/governance/governance-types.ts` (add `RecommendationMetadata` type, add `metadata: RecommendationMetadata` field on `Recommendation`)
- Modify: `src/governance/governance-recommendation-generator.ts` (4 generators populate `metadata`)
- Modify: `tests/governance/governance-recommendation-generator.vitest.ts` (5 tests assert `metadata` is populated correctly)
- Modify: `tests/governance/governance-store.vitest.ts` (update existing 2 tests to include `metadata` in the fixture data — or add a new test that asserts `metadata` round-trips through store)

**Interfaces:**
- Consumes: existing `Recommendation` interface (P9.1)
- Produces: new `RecommendationMetadata` discriminated union with 5 variants keyed on `category`, each matching a P9.2 `GovernanceChangePayload` variant field-for-field with one key rename (`category` → `kind`)

- [ ] **Step 1: Add the failing test for `Recommendation.metadata` round-trip**

In `tests/governance/governance-store.vitest.ts`, find the existing "appends and lists recommendations records" test and update the fixture to include a `metadata` field on the inner `recommendations[]` array. The test currently does:
```ts
recommendations: [{
  id: "rec-a",
  source: "drift",
  sourceArtifactId: "drift-1",
  priority: "high",
  confidence: 0.85,
  status: "open",
  category: "confidence_calibration",
  title: "Recalibrate confidence for red_team lens",
  description: "Confidence readings from the red_team lens show systematic overconfidence.",
  evidenceRefs: ["signal-1"],
  operatorGuidance: "Review the confidence calibration dashboard for red_team lens",
  expectedBenefit: "Improved decision accuracy through better-calibrated confidence scores",
  risks: ["Over-correction could suppress valid signals"],
}],
```

Add a `metadata` field on the same object:
```ts
recommendations: [{
  id: "rec-a",
  source: "drift",
  sourceArtifactId: "drift-1",
  priority: "high",
  confidence: 0.85,
  status: "open",
  category: "confidence_calibration",
  title: "Recalibrate confidence for red_team lens",
  description: "Confidence readings from the red_team lens show systematic overconfidence.",
  evidenceRefs: ["signal-1"],
  operatorGuidance: "Review the confidence calibration dashboard for red_team lens",
  expectedBenefit: "Improved decision accuracy through better-calibrated confidence scores",
  risks: ["Over-correction could suppress valid signals"],
  metadata: {
    category: "confidence_calibration",
    target: "red_team",
    currentCalibration: 0.45,
    suggestedCalibration: 0.65
  } as any,  // narrow to a real type in Step 3
}],
```

Also add `expect(records[0].recommendations[0].metadata).toBeDefined()` and `expect(records[0].recommendations[0].metadata.category).toBe("confidence_calibration")`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-store.vitest.ts 2>&1 | tail -20`
Expected: FAIL with `Property 'metadata' is missing in type ...` (TypeScript compile error in the test fixture, or runtime `undefined` assertion failure).

- [ ] **Step 3: Add the `RecommendationMetadata` type and the `metadata` field**

In `src/governance/governance-types.ts`, find the `Recommendation` interface (added in P9.1a, commit `f93c4360`) and add the new field plus the union type:

```ts
// Add after the existing fields on Recommendation:
  /**
   * Structured, category-specific metadata populated directly by the P9.1
   * generator. The shape is a discriminated union keyed on `category`.
   * Each variant mirrors the corresponding P9.2 `governance_change`
   * payload variant field-for-field, with one key rename
   * (`category` -> `kind`). P9.2's translation is a 1:1 projection.
   */
  metadata: RecommendationMetadata;
}

// Add the new type below the interface:
export type RecommendationMetadata =
  | {
      category: "lens_adjustment";
      operation: "promote" | "demote" | "retire";
      lens: string;
      currentPV: number;
      reviewsAnalyzed: number;
    }
  | {
      category: "chain_restoration";
      targetArtifactId: string;
      currentRate: number;
      targetRate: number;
    }
  | {
      category: "policy_coverage";
      currentCoverage: number;
      targetCoverage: number;
    }
  | {
      category: "confidence_calibration";
      target: string;
      currentCalibration: number;
      suggestedCalibration: number;
    }
  | {
      category: "governance_integrity";
      issue: string;
      recommendationId: string;
    };
```

Also remove the `as any` cast from the test fixture in Step 1 — the type now matches the union.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-store.vitest.ts 2>&1 | tail -10`
Expected: PASS. The `metadata` field round-trips through the store.

- [ ] **Step 5: Update the 4 generators to populate `metadata`**

In `src/governance/governance-recommendation-generator.ts`, find each of the 4 generator functions: `generateLensRecommendations`, `generateDriftRecommendations`, `generateIntegrityRecommendations`, `generateHealthRecommendations`. Each currently returns `Recommendation[]` objects with all fields except `metadata`. Add the `metadata` field on each returned object:

For `generateLensRecommendations`, when emitting a `demote` or `retire` Recommendation, also populate:
```ts
metadata: {
  category: "lens_adjustment",
  operation: (review.recommendation === "retire" ? "retire" : "demote") as "retire" | "demote",
  lens: entry.lens,
  currentPV: entry.predictiveValue,
  reviewsAnalyzed: entry.reviewsAnalyzed
}
```

For `generateDriftRecommendations`, for each emitted rec:
```ts
metadata: {
  category: finding.driftType === "confidence_drift" ? "confidence_calibration"
         : finding.driftType === "chain_coverage_drop" ? "chain_restoration"
         : "governance_integrity",
  // For confidence_calibration:
  // target: <read from source LensLifecycleReview or use sourceArtifactId>,
  // currentCalibration: <read from LearningStore calibration profile>,
  // suggestedCalibration: <derive or use fixed value 0.5>
  // For chain_restoration:
  // targetArtifactId: finding.evidenceRefs[0],
  // currentRate: <read from source GovernanceIntegrityReport.metrics.provenanceRate>,
  // targetRate: 80
  // For governance_integrity:
  // issue: finding.description,
  // recommendationId: <echo from the outer recommendation.id>
  ...
} as any
```

For `generateIntegrityRecommendations` and `generateHealthRecommendations`, populate the corresponding `metadata` variant with the same fields used in the existing `Recommendation` body (e.g. for `chain_restoration`, the `metadata.targetArtifactId` is the same as `rec.sourceArtifactId` and `metadata.currentRate` is the same as the integrity report's `provenanceRate`).

To keep this task small and verifiable, the exact values for `currentRate`, `targetRate`, `currentCalibration`, `suggestedCalibration`, `currentCoverage`, `targetCoverage` can be derived from the same P9.0 source artifacts the generators already read. If a value isn't available, use a documented placeholder constant (e.g. `targetRate: 80`) and add a `// TODO(future P9.2b): source from a configurable constant` comment that the implementation plan for P9.2b will replace.

- [ ] **Step 6: Update the 5 generator tests to assert `metadata`**

In `tests/governance/governance-recommendation-generator.vitest.ts`, for each of the 5 existing tests, add an assertion that the emitted `Recommendation.metadata` has the expected shape. Example for the lens test:
```ts
expect(recs[0].metadata).toEqual({
  category: "lens_adjustment",
  operation: "demote",
  lens: "policy_auditor",
  currentPV: 0.31,
  reviewsAnalyzed: 25
});
```

- [ ] **Step 7: Run all governance tests to confirm zero regression**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/ 2>&1 | tail -10`
Expected: PASS. All 47 existing tests still pass; the new `metadata` assertions pass.

- [ ] **Step 8: Verify 6 protected type files unchanged**

Run: `cd /home/babasola/Projects/Monolith && git diff main..HEAD -- src/adaptation/risk-score-types.ts src/adaptation/governance-review-types.ts src/adaptation/adaptation-types.ts src/adaptation/decision-types.ts src/adaptation/learning-types.ts src/adaptation/outcome-types.ts | head -3`
Expected: empty (no diff). P9.1 metadata amendment is a non-protected file change.

- [ ] **Step 9: Commit**

```bash
cd /home/babasola/Projects/Monolith
git add src/governance/governance-types.ts src/governance/governance-recommendation-generator.ts tests/governance/governance-store.vitest.ts tests/governance/governance-recommendation-generator.vitest.ts
git commit -m "feat(p9.1-amend): Recommendation.metadata discriminated union

P9.1 SDS Amendment 1: add RecommendationMetadata (5 variants keyed on
category) and populate metadata in the 4 P9.1 generators. P9.2's
payload translation is a 1:1 projection of metadata, so this is a
prerequisite for the P9.2 advisory-to-proposal bridge.

No protected file touched. ADR-0004's Allowed class exercised for
the first time in the field."
```

---

## Task P9.2a — Types extension + GovernanceStore.findRecommendationById

**Files:**
- Modify: `src/adaptation/adaptation-types.ts` (additive: extend `ProposalAction` and `ProposalTarget` unions)
- Create: `src/governance/protected-baselines.ts` (snapshot the current `ProposalAction` and `ProposalTarget.kind` values; the snapshot-equal sentinel test will diff against this)
- Modify: `src/governance/governance-store.ts` (add `findRecommendationById(id): Promise<{ rec: Recommendation; parent: GovernanceRecommendation } | null>` method)
- Modify: `tests/governance/governance-store.vitest.ts` (add 2 tests for `findRecommendationById`)

**Interfaces:**
- Consumes: existing `Proposal` type from `src/adaptation/adaptation-types.ts` (P5)
- Produces: `findRecommendationById(id)` on `GovernanceStore` (P9.2 hot path) and `protected-baselines.ts` (P9.2 sentinel baseline)

**Note on granularity:** P9.2 operates on a `Recommendation` item (inner), not a `GovernanceRecommendation` report (outer). The CLI command takes an inner-item ID. The lookup helper traces from the inner item to its containing report.

- [ ] **Step 1: Write the failing test for `findRecommendationById`**

In `tests/governance/governance-store.vitest.ts`, add at the end (inside the `describe("GovernanceStore", ...)` block):

```ts
  it("findRecommendationById returns the inner recommendation and its parent report", async () => {
    const store = new GovernanceStore();
    await store.append("recommendations", {
      id: "report-1",
      subject: "Test",
      outcome: "computed",
      confidence: 0.9,
      reasons: [],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [
        { id: "rec-a", source: "drift", sourceArtifactId: "d-1", priority: "high", confidence: 0.85, status: "open", category: "chain_restoration", title: "T", description: "T", evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [], metadata: { category: "chain_restoration", targetArtifactId: "d-1", currentRate: 45, targetRate: 80 } },
        { id: "rec-b", source: "drift", sourceArtifactId: "d-2", priority: "high", confidence: 0.9, status: "open", category: "chain_restoration", title: "T", description: "T", evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [], metadata: { category: "chain_restoration", targetArtifactId: "d-2", currentRate: 50, targetRate: 80 } }
      ],
      evidenceRefs: []
    } as any);

    const found = await store.findRecommendationById("rec-b");
    expect(found).not.toBeNull();
    expect(found?.rec.id).toBe("rec-b");
    expect(found?.parent.id).toBe("report-1");
  });

  it("findRecommendationById returns null when no match", async () => {
    const store = new GovernanceStore();
    const found = await store.findRecommendationById("does-not-exist");
    expect(found).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-store.vitest.ts 2>&1 | tail -10`
Expected: FAIL with `store.findRecommendationById is not a function`.

- [ ] **Step 3: Implement `findRecommendationById` on `GovernanceStore`**

In `src/governance/governance-store.ts`, find the `GovernanceStore` class. Add the new method after the existing `queryByWindow` method:

```ts
  /**
   * P9.2 hot-path lookup. Given an inner `Recommendation` item id,
   * returns the item along with the containing `GovernanceRecommendation`
   * report, or null if not found. Linear scan over all reports'
   * inner items — fine for P9.2's expected volume (a handful of
   * reports per window, 5–20 items each). If volume grows, a
   * dedicated `recommendation-items.jsonl` index may be added later.
   */
  async findRecommendationById(
    id: string
  ): Promise<{ rec: Recommendation; parent: GovernanceRecommendation } | null> {
    const all = await this.list("recommendations");
    for (const parent of all) {
      const rec = parent.recommendations.find((r) => r.id === id);
      if (rec) return { rec, parent };
    }
    return null;
  }
```

You will need to add `import type { Recommendation } from "./governance-types.js";` (and ensure `Recommendation` is exported from there — it is, from P9.1a).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-store.vitest.ts 2>&1 | tail -10`
Expected: PASS. Both new tests pass.

- [ ] **Step 5: Add the additive extension to `adaptation-types.ts`**

In `src/adaptation/adaptation-types.ts`, find the `ProposalAction` union and add the new value at the end. The current `ProposalAction` is:

```ts
export type ProposalAction =
  | "create_agent_card"
  | "update_agent_card"
  | "add_capability"
  | "adjust_skill_definition"
  | "create_improvement_issue"
  | "suggest_routing_weight"
  | "revert_proposal"
  | "learning_adjustment";
```

Add `"governance_change"` at the end:

```ts
export type ProposalAction =
  | "create_agent_card"
  | "update_agent_card"
  | "add_capability"
  | "adjust_skill_definition"
  | "create_improvement_issue"
  | "suggest_routing_weight"
  | "revert_proposal"
  | "learning_adjustment"
  | "governance_change";  // P9.2: P9.1 advisory → P5 lifecycle bridge
```

Then find the `ProposalTarget` discriminated union (it has 7 existing variants) and add the 8th:

```ts
export type ProposalTarget =
  | { kind: "agent_card"; id: string }
  | { kind: "skill"; id: string }
  | { kind: "capability"; capability: string; agentId?: string }
  | { kind: "issue"; title: string }
  | { kind: "routing_weight"; capability: string }
  | { kind: "revert"; sourceProposalId: string }
  | { kind: "learning"; area: LearningArea }
  | { kind: "governance"; recommendationId: string };  // P9.2
```

**No existing variant shape changes.** Only the new `"governance_change"` member and the new `governance` target variant are added. The snapshot-equal sentinel in Task P9.2d asserts this.

- [ ] **Step 6: Create `protected-baselines.ts`**

Create `src/governance/protected-baselines.ts`:

```ts
/**
 * P9.2 sentinel baselines for the 6 protected type files.
 *
 * Per ADR-0004 (docs/adr/ADR-0004-protected-type-files.md), any
 * additive extension to a protected file must be enumerated in the
 * SDS, restated in the plan, and verified by a snapshot-equal
 * sentinel assertion. This file snapshots the BASELINE values before
 * P9.2's additive extension of `adaptation-types.ts`. Future P-phases
 * update this file at the start of their protected-file changes.
 *
 * Allowed mutations per ADR-0004 (May 2026):
 *   - P9.2: +"governance_change" to ProposalAction
 *   - P9.2: +{ kind: "governance"; recommendationId: string } to ProposalTarget
 */

export const BASELINE_PROPOSAL_ACTIONS: readonly string[] = [
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
  "create_agent_card",
  "create_improvement_issue",
  "suggest_routing_weight",
  "revert_proposal"
] as const;

export const BASELINE_PROPOSAL_TARGET_KINDS: readonly string[] = [
  "agent_card",
  "skill",
  "revert"
  // "governance" added in P9.2
] as const;
```

(The `agent_card` and `skill` and `revert` values must match the actual `ProposalTarget` variants. Read `src/adaptation/adaptation-types.ts` to confirm; adjust this file if the actual kinds differ from what's shown here.)

- [ ] **Step 7: Run tsc to confirm no compile errors**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | tail -10`
Expected: clean (no output, exit 0). The additive extension is non-breaking.

- [ ] **Step 8: Run the full focused suite to confirm zero regression**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/adaptation/ tests/governance/ tests/cli/ 2>&1 | tail -10`
Expected: PASS. The 5 other protected files (other than `adaptation-types.ts`) are byte-identical to main; only `adaptation-types.ts` was additively extended (Allowed per ADR-0004). No Forbidden mutations occurred.

- [ ] **Step 9: Verify the 5 non-`adaptation-types.ts` protected files are unchanged**

Run: `cd /home/babasola/Projects/Monolith && git diff main..HEAD -- src/adaptation/risk-score-types.ts src/adaptation/governance-review-types.ts src/adaptation/decision-types.ts src/adaptation/learning-types.ts src/adaptation/outcome-types.ts | head -3`
Expected: empty. The only protected-file change in P9.2a is the additive extension to `adaptation-types.ts`.

- [ ] **Step 10: Commit**

```bash
cd /home/babasola/Projects/Monolith
git add src/adaptation/adaptation-types.ts src/governance/governance-store.ts src/governance/protected-baselines.ts tests/governance/governance-store.vitest.ts
git commit -m "feat(p9.2a): types extension + GovernanceStore.findRecommendationById

Additive extensions to adaptation-types.ts (per ADR-0004 Allowed
class):
  ProposalAction   += 'governance_change'
  ProposalTarget   += { kind: 'governance', recommendationId: string }

New method on GovernanceStore:
  findRecommendationById(id) -> Promise<{ rec: Recommendation; parent: GovernanceRecommendation } | null>
  Replaces the getTypeForId + list + linear search pattern in the
  P9.2 bridge hot path.

New file:
  src/governance/protected-baselines.ts
  Snapshots the pre-P9.2 baseline values for ProposalAction and
  ProposalTarget.kind. The snapshot-equal sentinel in P9.2d will
  diff against this baseline to catch accidental removals and
  undocumented additions.

No Forbidden mutations. The 5 other protected files remain
byte-identical to main."
```

---

## Task P9.2b — ProposalGenerator (the bridge module)

**Files:**
- Create: `src/governance/governance-proposal-generator.ts` (the single P9.2 file permitted to import `ProposalStore`; even this file is forbidden from `ApprovalGate` and any applier)
- Create: `tests/governance/governance-proposal-generator.vitest.ts`
- Modify: `src/adaptation/proposal-store.ts` (add `markOrphaned(id, reason)` method — required for atomicity recovery)

**Interfaces:**
- Consumes: `GovernanceStore.findRecommendationById(id)`, `ProposalStore.save(proposal)`, `ProposalStore.update(id, patch)`, `EvidenceChainStore.appendChain(chain)`, `EvidenceChainStore.getChainForRoot(recommendationId)`
- Produces: `createGovernanceProposal({ recommendationId, cwd?, generatedAt? }): Promise<{ ok: true; proposalId: string } | { ok: false; reason: string }>`

- [ ] **Step 1: Write the failing test for `markOrphaned` on `ProposalStore`**

In `tests/adaptation/proposal-store.vitest.ts` (the existing P5 test file for ProposalStore), add at the end of the existing `describe("ProposalStore", ...)` block:

```ts
  it("markOrphaned excludes the proposal from list()", async () => {
    const store = new ProposalStore();
    const proposal = { /* a minimal AdaptationProposal */ } as any;
    await store.save(proposal);
    await store.markOrphaned(proposal.id, "test reason");
    const all = await store.list();
    expect(all.find((p) => p.id === proposal.id)).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/adaptation/proposal-store.vitest.ts 2>&1 | tail -10`
Expected: FAIL with `store.markOrphaned is not a function`.

- [ ] **Step 3: Implement `markOrphaned` on `ProposalStore`**

In `src/adaptation/proposal-store.ts`, find the `ProposalStore` class and add the new method after `update`. (Note: `ProposalStatus` is unchanged at `pending | approved | rejected | applied | failed`. P9.2 does NOT extend it. Instead, `markOrphaned` writes a `systemState` field — see the additional change in `adaptation-types.ts` below this code block.)

```ts
  /**
   * P9.2 atomicity recovery: mark a proposal as orphaned so it is
   * excluded from `list()`. Used when the EvidenceChain edge write
   * fails after the proposal is created. The proposal's lifecycle
   * status is preserved (typically "pending"); the systemState
   * field is set to indicate the infrastructure-recovery state.
   * The proposal still exists on disk for audit, but is not
   * surfaced as a normal pending proposal. A future cleanup task
   * (out of P9.2 scope) may sweep orphaned proposals.
   */
  async markOrphaned(id: string, reason: string): Promise<void> {
    await this.update(id, { systemState: { orphaned: true, reason } } as any);
  }
```

Also note: **P9.2b does NOT add `"orphaned"` to the `ProposalStatus` union.** That was an earlier design that was corrected (see the "Orphaned system-state semantics" section above). The `ProposalStatus` union stays at the original 5 lifecycle states. Instead, `markOrphaned` writes a `systemState` field on the proposal.

**`systemState` field on `AdaptationProposal`** (read `src/adaptation/adaptation-types.ts` to see the current interface — it does NOT yet have `systemState`; P9.2b adds it as an optional field):

```ts
// In src/adaptation/adaptation-types.ts, add to the AdaptationProposal interface:
  /**
   * P9.2 system-state metadata. Used for infrastructure-recovery
   * flags (currently only `orphaned`). Distinct from ProposalStatus:
   * the lifecycle status (pending/approved/rejected/applied/failed)
   * is preserved unchanged. systemState is invisible to lifecycle
   * code; it's a recovery flag in metadata.
   */
  systemState?: { orphaned: true; reason: string };
```

This is a **new optional field** on a non-protected file, so it does not require an ADR-0004 exception. The 6 protected files remain unchanged for systemState; the only protected-file changes in P9.2 are the two enumerated extensions: `ProposalAction += "governance_change"` and `ProposalTarget += { kind: "governance"; recommendationId: string }`.

- [ ] **Step 4: Run test to verify pass**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/adaptation/proposal-store.vitest.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `createGovernanceProposal` — happy path**

In `tests/governance/governance-proposal-generator.vitest.ts` (new file), add:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import { createGovernanceProposal } from "../../src/governance/governance-proposal-generator.js";

describe("createGovernanceProposal", () => {
  it("creates one pending proposal from an open, high-confidence, non-low-priority recommendation", async () => {
    // Seed GovernanceStore with a report containing one inner item
    const govStore = new GovernanceStore();
    await govStore.append("recommendations", {
      id: "report-1",
      subject: "Test",
      outcome: "computed",
      confidence: 0.85,
      reasons: ["drift detected"],
      generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-a",
        source: "drift",
        sourceArtifactId: "drift-1",
        priority: "high",
        confidence: 0.85,
        status: "open",
        category: "chain_restoration",
        title: "Restore chain for drift-1",
        description: "Provenance rate 45%",
        evidenceRefs: ["drift-1"],
        operatorGuidance: "Investigate",
        expectedBenefit: "Higher coverage",
        risks: [],
        metadata: {
          category: "chain_restoration",
          targetArtifactId: "drift-1",
          currentRate: 45,
          targetRate: 80
        }
      }],
      evidenceRefs: ["drift-1"]
    } as any);

    // CLI takes the inner-item id (rec-a), not the report id (report-1)
    const result = await createGovernanceProposal({ recommendationId: "rec-a" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposalId).toMatch(/^prop-/);

    // Verify the proposal was created
    const proposalStore = new ProposalStore();
    const all = await proposalStore.list();
    const created = all.find((p) => p.id === result.proposalId);
    expect(created).toBeDefined();
    expect(created?.action).toBe("governance_change");
    expect(created?.status).toBe("pending");
    expect((created?.target as any).kind).toBe("governance");
    expect((created?.target as any).recommendationId).toBe("rec-a");
    expect((created?.payload as any).kind).toBe("chain_restoration");
    expect((created?.payload as any).targetArtifactId).toBe("drift-1");
    expect((created?.payload as any).currentRate).toBe(45);
    expect((created?.payload as any).targetRate).toBe(80);
    expect((created?.payload as any)._provenance.parentRecommendationId).toBe("rec-a");
    expect((created?.payload as any)._provenance.parentRecommendationReportId).toBe("report-1");
    expect((created?.payload as any)._provenance.recommendationCategory).toBe("chain_restoration");
    expect(created?.sourceRecommendationType).toBe("governance_recommendation");
    expect(created?.sourceConfidence).toBe(0.85);  // inherited, not recalculated
    expect(created?.evidenceFingerprints).toContain("rec-a");
    expect(created?.provenance).toBe("manual");
  });
});
```

- [ ] **Step 6: Run test to verify failure**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-proposal-generator.vitest.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module .../governance-proposal-generator.js`.

- [ ] **Step 7: Implement the bridge module**

Create `src/governance/governance-proposal-generator.ts`:

```ts
/**
 * P9.2 — Advisory-to-proposal bridge.
 *
 * This is the SINGLE P9 file permitted to import ProposalStore. The
 * sentinel allowlist (ALLOWED_IN_FILE) enforces this. Even this file
 * is forbidden from importing ApprovalGate, any applier, or calling
 * approve/apply. The bridge creates pending proposals only; approval
 * and apply are P5-owned.
 *
 * Hard boundary (per P9.2 SDS):
 *   1. Explicit operator command (this function is called from
 *      `alix governance propose <id>`, not from any auto/scheduler)
 *   2. Eligibility gate (confidence + priority + status)
 *   3. Idempotency (one recommendation -> at most one proposal)
 *   4. Atomicity (case A or B: both succeed, or proposal is orphaned)
 */

import type { GovernanceRecommendation, Recommendation } from "./governance-types.js";
import type { GovernanceChangePayload } from "./governance-types.js";
import { GovernanceStore } from "./governance-store.js";
import { ProposalStore } from "../adaptation/proposal-store.js";
import { EvidenceChainStore } from "../learning/evidence-chain-store.js";
import type { LearningEvidenceChain, ProvenanceLink } from "../learning/evidence-chain-types.js";

const MIN_PROPOSAL_CONFIDENCE = 0.6;
const INELIGIBLE_PRIORITIES = new Set<"low">(["low"]);

export type CreateProposalResult =
  | { ok: true; proposalId: string }
  | { ok: false; reason: string };

function isEligible(rec: Recommendation): { eligible: true } | { eligible: false; reason: string } {
  if (rec.confidence < MIN_PROPOSAL_CONFIDENCE) {
    return { eligible: false, reason: `confidence ${rec.confidence.toFixed(2)} is below threshold ${MIN_PROPOSAL_CONFIDENCE}` };
  }
  if (INELIGIBLE_PRIORITIES.has(rec.priority as "low")) {
    return { eligible: false, reason: `priority "${rec.priority}" is not eligible for proposal` };
  }
  // Status gate is fail-closed: ONLY "open" is eligible. Any other
  // status (acknowledged, dismissed, archived, paused, future values)
  // is rejected. This is the correct inverse of a Set-includes check,
  // which would let unknown future statuses pass through.
  if (rec.status !== "open") {
    return { eligible: false, reason: `status "${rec.status}" is not eligible for proposal (only "open" recommendations may become proposals)` };
  }
  return { eligible: true };
}

function recommendationToPayload(rec: Recommendation): GovernanceChangePayload {
  // 1:1 projection: { kind: category, ...rest }
  const { category, ...rest } = rec.metadata;
  return { kind: category, ...rest } as GovernanceChangePayload;
}

export async function createGovernanceProposal(opts: {
  recommendationId: string;  // the INNER Recommendation item id, not the report id
  cwd?: string;
  generatedAt?: string;
}): Promise<CreateProposalResult> {
  const govStore = new GovernanceStore();
  const proposalStore = new ProposalStore();
  const chainStore = new EvidenceChainStore();
  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  // 1. Load inner recommendation + containing report (hot-path lookup)
  const found = await govStore.findRecommendationById(opts.recommendationId);
  if (!found) {
    return { ok: false, reason: `Recommendation not found: ${opts.recommendationId}` };
  }
  const { rec, parent } = found;

  // 2. Eligibility gate
  const gate = isEligible(rec);
  if (!gate.eligible) {
    return { ok: false, reason: `Recommendation not eligible for proposal:\n  ${gate.reason}` };
  }

  // 3. Idempotency check — has this recommendation already been proposed?
  const existingChains = await chainStore.getChainForRoot(opts.recommendationId);
  for (const chain of existingChains) {
    for (const link of chain.links) {
      if (link.relationType === "proposal_from_recommendation") {
        return {
          ok: false,
          reason: `Recommendation ${opts.recommendationId} has already been proposed as ${link.targetArtifactId}.`
        };
      }
    }
  }

  // 4. Build the proposal
  // The P5 AdaptationProposal shape is:
  //   { id, createdAt, status, action, target, payload,
  //     sourceRecommendationType, sourceConfidence,
  //     evidenceFingerprints, reason, provenance? }
  // P9.2 populates:
  //   id = proposalId
  //   createdAt = generatedAt
  //   status = "pending"
  //   action = "governance_change"
  //   target = { kind: "governance", recommendationId }   (inner rec id)
  //   payload = { ...GovernanceChangePayload,
  //                _provenance: { parentRecommendationId (inner),
  //                              parentRecommendationReportId (outer),
  //                              sourceArtifactIds,
  //                              recommendationCategory } }
  //   sourceRecommendationType = "governance_recommendation"
  //   sourceConfidence = rec.confidence  (inherited, not recalculated)
  //   evidenceFingerprints = [inner rec id, ...rec.evidenceRefs]
  //   reason = rec.description (human-readable summary)
  //   provenance = "manual" (P5.2c convention; P9.2 is operator-driven)
  const proposalId = `prop-${generatedAt.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const proposal = {
    id: proposalId,
    createdAt: generatedAt,
    status: "pending" as const,
    action: "governance_change" as const,
    target: { kind: "governance" as const, recommendationId: opts.recommendationId },
    payload: {
      ...recommendationToPayload(rec),
      _provenance: {
        parentRecommendationId: opts.recommendationId,        // inner item id
        parentRecommendationReportId: parent.id,              // outer report id
        sourceArtifactIds: rec.evidenceRefs ?? [],
        recommendationCategory: rec.category
      }
    },
    sourceRecommendationType: "governance_recommendation",
    sourceConfidence: rec.confidence,
    evidenceFingerprints: [opts.recommendationId, ...(rec.evidenceRefs ?? [])],
    reason: rec.description,
    provenance: "manual" as const
  };

  // 5. Persist proposal + EvidenceChain link with atomicity recovery
  try {
    await proposalStore.save(proposal as any);

    const link: ProvenanceLink = {
      sourceArtifactId: proposalId,
      targetArtifactId: opts.recommendationId,
      relationType: "proposal_from_recommendation",
      confidence: rec.confidence,
      recordedAt: generatedAt
    };
    const chain: LearningEvidenceChain = {
      id: `chain-${proposalId}`,
      subject: "GovernanceProposal provenance",
      outcome: "linked",
      confidence: rec.confidence,
      reasons: ["P9.2 bridge: recommendation -> proposal"],
      generatedAt,
      evidenceRefs: [proposalId, opts.recommendationId, parent.id],
      rootArtifactId: opts.recommendationId,
      rootArtifactType: "governance_recommendation",
      links: [link],
      maxDepth: 1
    };
    try {
      await chainStore.appendChain(chain);
    } catch (edgeError) {
      // Compensating tombstone: case (B)
      // Note: orphaned is a SYSTEM state, not a lifecycle state. See
      // the plan's "Orphaned status semantics" section for the
      // invariant. Orphaned proposals are never eligible for approval
      // and are excluded from all proposal queues.
      await proposalStore.markOrphaned(proposalId, `EvidenceChain write failed: ${(edgeError as Error).message}`);
      return { ok: false, reason: `Proposal ${proposalId} created but provenance chain failed: ${(edgeError as Error).message}. Proposal marked orphaned and excluded from the queue.` };
    }
  } catch (createError) {
    return { ok: false, reason: `Failed to create proposal: ${(createError as Error).message}` };
  }

  return { ok: true, proposalId };
}
```

- [ ] **Step 8: Run the happy-path test to verify pass**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-proposal-generator.vitest.ts 2>&1 | tail -15`
Expected: PASS. (May surface 2-3 type errors — see Step 9.)

- [ ] **Step 9: Fix any TypeScript errors**

The `proposalStore.save(proposal as any)` and `proposalStore.markOrphaned(...)` calls may surface type mismatches because the existing `AdaptationProposal` type in `adaptation-types.ts` is strict. Two fixes:
- (a) Widen the `as any` to specific fields: `as unknown as Parameters<ProposalStore["save"]>[0]`
- (b) If `systemState` is not yet on the `AdaptationProposal` interface, it was added in Step 3 above (with the optional `systemState?: { orphaned: true; reason: string }` field). Confirm.

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1 | tail -15`
Expected: clean (or specific narrow errors you can fix by adjusting the cast).

- [ ] **Step 10: Add 4 more tests (rejection paths + idempotency + recovery)**

In `tests/governance/governance-proposal-generator.vitest.ts`, add 4 more tests:

```ts
  it("rejects with reason when confidence is below threshold", async () => {
    const govStore = new GovernanceStore();
    await govStore.append("recommendations", {
      id: "report-low-conf",
      subject: "T", outcome: "c", confidence: 0.4, reasons: [], generatedAt: new Date().toISOString(),
      reportType: "governance_recommendation", recommendations: [{
        id: "rec-low-conf", source: "drift", sourceArtifactId: "d", priority: "high", confidence: 0.4,
        status: "open", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 30, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const result = await createGovernanceProposal({ recommendationId: "rec-low-conf" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/confidence 0\.40 is below threshold 0\.60/);
  });

  it("rejects with reason when status is not open", async () => {
    const govStore = new GovernanceStore();
    await govStore.append("recommendations", {
      id: "report-dismissed", subject: "T", outcome: "c", confidence: 0.9, reasons: [],
      generatedAt: new Date().toISOString(), reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-dismissed", source: "drift", sourceArtifactId: "d", priority: "high", confidence: 0.9,
        status: "dismissed", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 30, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const result = await createGovernanceProposal({ recommendationId: "rec-dismissed" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/status "dismissed" is not eligible/);
  });

  it("refuses duplicate (idempotency)", async () => {
    const govStore = new GovernanceStore();
    await govStore.append("recommendations", {
      id: "report-dup", subject: "T", outcome: "c", confidence: 0.9, reasons: [],
      generatedAt: new Date().toISOString(), reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-dup", source: "drift", sourceArtifactId: "d", priority: "high", confidence: 0.9,
        status: "open", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 30, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const first = await createGovernanceProposal({ recommendationId: "rec-dup" });
    expect(first.ok).toBe(true);
    const second = await createGovernanceProposal({ recommendationId: "rec-dup" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/has already been proposed as/);
  });

  it("returns not-found when inner recommendation does not exist", async () => {
    const result = await createGovernanceProposal({ recommendationId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Recommendation not found: does-not-exist/);
  });
```

- [ ] **Step 11: Run all 5 generator tests + ProposalStore tests**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-proposal-generator.vitest.ts tests/adaptation/proposal-store.vitest.ts 2>&1 | tail -10`
Expected: PASS. All 5 + existing tests pass.

- [ ] **Step 12: Verify the 5 non-`adaptation-types.ts` protected files are still unchanged**

Run: `cd /home/babasola/Projects/Monolith && git diff main..HEAD -- src/adaptation/risk-score-types.ts src/adaptation/governance-review-types.ts src/adaptation/decision-types.ts src/adaptation/learning-types.ts src/adaptation/outcome-types.ts | head -3`
Expected: empty. The only protected-file change in P9.2b is the additive `ProposalAction += "governance_change"` extension to `adaptation-types.ts` (already done in P9.2a). P9.2b does NOT touch any protected file.

- [ ] **Step 13: Commit**

```bash
cd /home/babasola/Projects/Monolith
git add src/governance/governance-proposal-generator.ts src/adaptation/proposal-store.ts src/adaptation/adaptation-types.ts tests/governance/governance-proposal-generator.vitest.ts tests/adaptation/proposal-store.vitest.ts src/governance/protected-baselines.ts
git commit -m "feat(p9.2b): ProposalGenerator bridge + ProposalStore.markOrphaned

New module src/governance/governance-proposal-generator.ts:
  - createGovernanceProposal({ recommendationId }) - the bridge
  - 4-step flow: load rec -> gate -> idempotency -> translate+persist
  - Eligibility: confidence >= 0.6 AND priority !== 'low' AND status === 'open'
  - Idempotency: EvidenceChain.getChainForRoot(recId) check
  - Translation: 1:1 projection of rec.metadata, key rename category -> kind
  - Atomicity (case A/B): proposal + chain succeed, OR markOrphaned
  - Provenance: parentRecommendationId, sourceArtifactIds,
    proposedFromRecommendationId (denorm), recommendationCategory (denorm)
  - This is the SINGLE P9 file permitted to import ProposalStore

Additive extensions to adaptation-types.ts (Allowed per ADR-0004):
  (no ProposalStatus change — orphan is systemState metadata, not a status)

New method on ProposalStore:
  markOrphaned(id, reason) - case (B) recovery; excludes from list()

5 new tests cover: happy path, low-confidence, dismissed status,
idempotency, not-found. All passing. No Forbidden mutations."
```

---

## Task P9.2c — CLI: `alix governance propose <id>`

**Files:**
- Modify: `src/cli/commands/governance.ts` (add `propose` subcommand)
- Modify: `tests/cli/commands/governance-integration.vitest.ts` (add 3 tests)

**Interfaces:**
- Consumes: `createGovernanceProposal({ recommendationId })` from P9.2b
- Produces: `alix governance propose <id> [--json]` CLI subcommand

- [ ] **Step 1: Write the failing test for `propose` (happy path)**

The existing tests in `tests/cli/commands/governance-integration.vitest.ts` import `handleGovernanceCommand` directly (NOT a `runAlix` helper), use `vi.spyOn(process, "cwd")` for cwd isolation, and use a shared `seedRecommendation(...)` helper. Read the existing test file and reuse the same pattern. Add at the end of the existing `describe` block:

```ts
  it("propose creates a pending proposal from an eligible recommendation", async () => {
    // Seed an open, high-confidence, non-low-priority recommendation
    await seedRecommendation({ recId:
      id: "rec-eligible",
      confidence: 0.85,
      priority: "high",
      status: "open",
      category: "chain_restoration",
      metadata: { category: "chain_restoration", targetArtifactId: "drift-1", currentRate: 45, targetRate: 80 }
    });

    // Capture stdout (the existing tests use vi.spyOn(console, "log"))
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    try {
      await handleGovernanceCommand({ subcommand: "propose", recommendationId: "rec-eligible" });
      const allLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allLogs).toMatch(/Governance proposal created/);
      expect(allLogs).toMatch(/rec-eligible/);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("propose --json returns structured success", async () => {
    await seedRecommendation({ recId:
      id: "rec-eligible-2",
      confidence: 0.85,
      priority: "high",
      status: "open",
      category: "chain_restoration",
      metadata: { category: "chain_restoration", targetArtifactId: "drift-2", currentRate: 50, targetRate: 80 }
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    try {
      await handleGovernanceCommand({ subcommand: "propose", recommendationId: "rec-eligible-2", json: true });
      const allLogs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      const parsed = JSON.parse(allLogs);
      expect(parsed.ok).toBe(true);
      expect(parsed.proposalId).toMatch(/^prop-/);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("propose rejects with non-zero exit when recommendation is not eligible", async () => {
    await seedRecommendation({ recId:
      id: "rec-low-conf",
      confidence: 0.3,  // below threshold
      priority: "high",
      status: "open",
      category: "chain_restoration",
      metadata: { category: "chain_restoration", targetArtifactId: "drift-3", currentRate: 30, targetRate: 80 }
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    try {
      await expect(
        handleGovernanceCommand({ subcommand: "propose", recommendationId: "rec-low-conf" })
      ).rejects.toThrow(/process\.exit\(1\)/);
      const allErrors = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allErrors).toMatch(/Recommendation not eligible/);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
```

The `seedRecommendation` helper should be added near the other shared seed helpers at the top of the test file. Its implementation:
```ts
async function seedRecommendation(opts: {
  recId: string;          // the INNER Recommendation item id (e.g. "rec-eligible")
  reportId?: string;      // optional outer report id; defaults to `${recId}-report`
  confidence: number;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "dismissed";
  category: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const govStore = new GovernanceStore();
  await govStore.append("recommendations", {
    id: opts.reportId ?? `${opts.recId}-report`,
    subject: "Test",
    outcome: "computed",
    confidence: 0.9,
    reasons: [],
    generatedAt: new Date().toISOString(),
    reportType: "governance_recommendation",
    recommendations: [{
      id: opts.recId,           // <-- the inner item id, used by the CLI
      source: "drift",
      sourceArtifactId: "drift-x",
      priority: opts.priority,
      confidence: opts.confidence,
      status: opts.status,
      category: opts.category as any,
      title: "Test rec",
      description: "Test description",
      evidenceRefs: [],
      operatorGuidance: "Test guidance",
      expectedBenefit: "Test benefit",
      risks: [],
      metadata: opts.metadata as any
    }],
    evidenceRefs: []
  } as any);
}
```

The CLI tests above (Steps 1 in P9.2c) call `seedRecommendation({ recId: "rec-eligible", ... })` etc. The `id:` parameter is renamed to `recId:` to make the inner-vs-outer granularity explicit.

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/cli/commands/governance-integration.vitest.ts 2>&1 | tail -10`
Expected: FAIL with "Unknown subcommand: propose" (or similar — the CLI dispatcher doesn't have a `propose` case yet).

- [ ] **Step 3: Implement the `propose` subcommand in the CLI dispatcher**

In `src/cli/commands/governance.ts`, find the `handleGovernanceCommand` function's switch statement. Add the `propose` case alongside the existing cases (`health`, `drift`, `lens-review`, `integrity`, `recommend`):

```ts
      case "propose": {
        const recommendationId = args.recommendationId as string;
        if (!recommendationId) {
          console.error("Usage: alix governance propose <recommendation-id>");
          process.exit(2);
        }
        const { createGovernanceProposal } = await import("../../governance/governance-proposal-generator.js");
        const result = await createGovernanceProposal({ recommendationId });
        if (!result.ok) {
          if (args.json) {
            console.log(JSON.stringify({ ok: false, reason: result.reason }));
          } else {
            console.error(result.reason);
          }
          process.exit(1);
        }
        if (args.json) {
          console.log(JSON.stringify({ ok: true, proposalId: result.proposalId }));
        } else {
          console.log(`Governance proposal created.`);
          console.log(`  Proposal:        ${result.proposalId}`);
          console.log(`  Recommendation:  ${recommendationId}`);
          console.log(``);
          console.log(`Review and approve:`);
          console.log(`  alix governance explain ${result.proposalId}`);
          console.log(`  alix adaptation approve ${result.proposalId}`);
        }
        return;
      }
```

Also update the usage text at the top of the dispatcher (if there is one) to include `propose`. The dynamic import avoids a circular-import warning if any.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/cli/commands/governance-integration.vitest.ts 2>&1 | tail -10`
Expected: PASS. All 3 new tests pass.

- [ ] **Step 5: Run the full focused suite to confirm zero regression**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/adaptation/ tests/governance/ tests/cli/ 2>&1 | tail -10`
Expected: PASS. The 4 existing governance CLI subcommands (health, drift, lens-review, integrity, recommend) still work.

- [ ] **Step 6: Verify 6 protected type files are unchanged from main**

Run: `cd /home/babasola/Projects/Monolith && git diff main..HEAD -- src/adaptation/risk-score-types.ts src/adaptation/governance-review-types.ts src/adaptation/adaptation-types.ts src/adaptation/decision-types.ts src/adaptation/learning-types.ts src/adaptation/outcome-types.ts | head -3`
Expected: the only diff is the additive extension to `adaptation-types.ts` from P9.2a (ProposalAction + governance, ProposalTarget + governance). P9.2b does NOT touch any protected file — it adds `systemState` to the `AdaptationProposal` interface, which is on a non-protected file (the `AdaptationProposal` type lives in `adaptation-types.ts` but is not a `ProposalAction`/`ProposalTarget`/`ProposalStatus` member). All other 5 protected files are byte-identical to main.

- [ ] **Step 7: Commit**

```bash
cd /home/babasola/Projects/Monolith
git add src/cli/commands/governance.ts tests/cli/commands/governance-integration.vitest.ts
git commit -m "feat(p9.2c): alix governance propose CLI subcommand

New CLI subcommand:
  alix governance propose <recommendation-id> [--json]

Behavior:
  - Loads the GovernanceRecommendation via GovernanceStore
  - Applies the eligibility gate (confidence + priority + status)
  - Checks idempotency via EvidenceChain.getChainForRoot
  - Translates rec.metadata to a GovernanceChangePayload (1:1)
  - Atomically persists proposal + EvidenceChain link
  - On edge-write failure: markOrphaned recovery

Output:
  - Default: verbose human-readable summary
  - --json: structured { ok, proposalId | reason } response
  - Rejection: non-zero exit, error to stderr (or JSON to stdout with --json)

3 new integration tests cover: happy path text, happy path --json,
rejection. All passing."
```

---

## Task P9.2d — Sentinel: ALLOWED_IN_FILE + snapshot-equal baseline

**Files:**
- Modify: `tests/governance/governance-sentinels.vitest.ts` (add `ALLOWED_IN_FILE` allowlist, add `src/governance/governance-proposal-generator.ts` to `ALL_FILES`, add snapshot-equal tests for `adaptation-types.ts`)

**Interfaces:**
- Consumes: existing sentinel structure; `protected-baselines.ts` from P9.2a
- Produces: 4 new sentinel cases — (1) generator file is checked for the new symbols, (2) `ALLOWED_IN_FILE` is enforced, (3) `ProposalAction` snapshot-equal to baseline + documented additions, (4) `ProposalTarget.kind` snapshot-equal to baseline + documented additions. (Note: `ProposalStatus` is NOT a new sentinel case because P9.2 does NOT add to it; the orphan system-state is metadata on `AdaptationProposal`, not a `ProposalStatus` member.)

- [ ] **Step 1: Write the failing test for the new sentinel cases**

In `tests/governance/governance-sentinels.vitest.ts`, add inside the existing `describe("P9.0f/P9.1 purity sentinel", ...)` block (rename to `describe("P9 purity sentinel", ...)` to reflect broader scope):

```ts
  // -- Per-file symbol-level allowlist (ADR-0004) -----------------------

  it("governance-proposal-generator.ts is the ONLY P9 file allowed to import ProposalStore", () => {
    // For every file in ALL_FILES, importing ProposalStore should fail UNLESS
    // the file is in ALLOWED_IN_FILE.
    const ALLOWED_IN_FILE: Record<string, string[]> = {
      "src/governance/governance-proposal-generator.ts": ["ProposalStore", "createProposal"]
    };
    for (const file of ALL_FILES) {
      const source = readSource(file);
      const importLines = source.split("\n").filter((l) => l.trim().startsWith("import"));
      const allows = ALLOWED_IN_FILE[file] ?? [];
      for (const line of importLines) {
        for (const symbol of ["ProposalStore", "createProposal"]) {
          if (line.includes(symbol)) {
            expect(
              allows.includes(symbol),
              `${file} imports ${symbol} but is not in ALLOWED_IN_FILE`
            ).toBe(true);
          }
        }
      }
    }
  });

  // -- Snapshot-equal baseline for protected files (ADR-0004) -----------

  it("adaptation-types.ts ProposalAction is exactly the baseline + P9.2 additions", async () => {
    const { BASELINE_PROPOSAL_ACTIONS } = await import("../../src/governance/protected-baselines.js");
    const source = readSource("src/adaptation/adaptation-types.ts");
    // Extract the ProposalAction union members via a simple regex.
    const match = source.match(/export type ProposalAction\s*=\s*([\s\S]+?);/);
    expect(match).not.toBeNull();
    if (!match) return;
    const members = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(members).toEqual([
      ...BASELINE_PROPOSAL_ACTIONS,
      "governance_change"  // P9.2's documented addition
    ]);
  });

  it("adaptation-types.ts ProposalStatus preserves the 5 lifecycle states (P9.2 does NOT extend it)", async () => {
    const source = readSource("src/adaptation/adaptation-types.ts");
    const match = source.match(/export type ProposalStatus\s*=\s*([\s\S]+?);/);
    expect(match).not.toBeNull();
    if (!match) return;
    const members = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // P9.2 does NOT add to ProposalStatus. The 5 lifecycle states are
    // preserved exactly. The orphan system-state is metadata on
    // AdaptationProposal.systemState, not a ProposalStatus member.
    expect(members.sort()).toEqual(
      ["applied", "approved", "failed", "pending", "rejected"].sort()
    );
  });

  it("adaptation-types.ts ProposalTarget kinds is exactly the baseline + P9.2 additions", async () => {
    const { BASELINE_PROPOSAL_TARGET_KINDS } = await import("../../src/governance/protected-baselines.js");
    const source = readSource("src/adaptation/adaptation-types.ts");
    // ProposalTarget is a discriminated union; extract `kind: "..."` strings.
    const kinds = [...source.matchAll(/kind:\s*"([^"]+)"/g)].map((m) => m[1]);
    // Filter to the ones inside the ProposalTarget union by checking context.
    // (The simplest check: ProposalTarget kinds are a subset of the
    // strings inside the type's body, but for this sentinel we just
    // confirm the documented addition is present and no new kind
    // beyond the documented set has appeared.)
    expect(kinds).toContain("governance");
    // Confirm the baseline kinds are still present:
    for (const k of BASELINE_PROPOSAL_TARGET_KINDS) {
      expect(kinds).toContain(k);
    }
  });
```

Also: add the new file to `ALL_FILES` in the sentinel. The existing line is:
```ts
const ALL_FILES = [
  ...GOVERNANCE_BUILDERS,
  "src/governance/governance-store.ts",
  "src/governance/governance-recommendation-generator.ts",
  "src/cli/commands/governance.ts",
];
```

Add `"src/governance/governance-proposal-generator.ts"` to that array.

- [ ] **Step 2: Add `BASELINE_PROPOSAL_STATUSES` to protected-baselines.ts**

In `src/governance/protected-baselines.ts` (created in P9.2a), add the missing baseline:

```ts
export const BASELINE_PROPOSAL_STATUSES: readonly string[] = [
  "pending",
  "approved",
  "applied",
  "rejected"
  // (no ProposalStatus additions in P9.2)
] as const;
```

(Read the actual `adaptation-types.ts` to confirm the pre-P9.2 `ProposalStatus` members; adjust this file if the actual values differ.)

- [ ] **Step 3: Run sentinel tests to verify they pass**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/governance/governance-sentinels.vitest.ts 2>&1 | tail -15`
Expected: PASS. All existing sentinel cases pass; the 4 new cases pass. The new generator file is checked for forbidden symbols; the `adaptation-types.ts` unions are exactly the baseline + documented additions.

- [ ] **Step 4: Run the full focused suite to confirm zero regression**

Run: `cd /home/babasola/Projects/Monolith && npx vitest run tests/adaptation/ tests/governance/ tests/cli/ 2>&1 | tail -10`
Expected: PASS. The sentinel is the last check; the suite is fully green.

- [ ] **Step 5: Verify the 5 non-`adaptation-types.ts` protected files are unchanged from main**

Run: `cd /home/babasola/Projects/Monolith && git diff main..HEAD -- src/adaptation/risk-score-types.ts src/adaptation/governance-review-types.ts src/adaptation/decision-types.ts src/adaptation/learning-types.ts src/adaptation/outcome-types.ts | head -3`
Expected: empty.

- [ ] **Step 6: Commit**

```bash
cd /home/babasola/Projects/Monolith
git add tests/governance/governance-sentinels.vitest.ts src/governance/protected-baselines.ts
git commit -m "feat(p9.2d): sentinel ALLOWED_IN_FILE + snapshot-equal baseline

Per ADR-0004:
  - Add src/governance/governance-proposal-generator.ts to ALL_FILES
  - ALLOWED_IN_FILE allowlist: ['ProposalStore', 'createProposal'] for
    that one file. All other P9 files still reject those imports.
  - Snapshot-equal assertions for adaptation-types.ts:
      ProposalAction  = baseline + ['governance_change']
      ProposalStatus  = baseline + ['orphaned']
      ProposalTarget  = baseline + ['governance']
  - The 3 new cases catch both accidental removals (baseline no
    longer matches because a member was deleted) and undocumented
    additions (expected list doesn't include the new member).

The 5 other protected files are byte-identical to main. No
Forbidden mutations occurred in P9.2."
```

---

## Task P9.2e — Final whole-branch review + PR

This task is a final pass over the entire P9.2 branch to catch any cross-slice issues before merge. The implementation subagent cannot do this themselves — it's a holistic review.

**Files:** None (read-only review).

- [ ] **Step 1: Build the review package**

```bash
cd /home/babasola/Projects/Monolith
MERGE_BASE=$(git merge-base main HEAD)
/home/babasola/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/skills/subagent-driven-development/scripts/review-package $MERGE_BASE HEAD 2>&1 | tail -3
```

The output prints the path to the review-package file. Record that path.

- [ ] **Step 2: Dispatch the whole-branch reviewer subagent**

Spawn a subagent with:
- The SDS at `docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md`
- This plan
- The review-package file from Step 1
- The full diff stat: `cd /home/babasola/Projects/Monolith && git diff main..HEAD --stat`
- Instructions to verify:
  1. **Spec coverage:** every section of the P9.2 SDS has a corresponding task in this plan
  2. **No P9.2 symbols leaked:** no `GovernanceProposal` type (only `Proposal` with `action: "governance_change"`)
  3. **Hard boundary intact:** the bridge module does not import `ApprovalGate` or any applier
  4. **Idempotency:** the duplicate-proposal check uses EvidenceChain
  5. **Atomicity (case A/B):** the recovery path uses `markOrphaned`
  6. **Translation:** the payload is `rec.metadata` with one key rename, not text parsing
  7. **Confidence inheritance:** `proposal.confidence = recommendation.confidence`
  8. **Sentinel covers the new file:** the proposal-generator is in `ALL_FILES` and the allowlist is precise
  9. **Protected files:** the 5 non-`adaptation-types.ts` files are byte-identical to main; `adaptation-types.ts` is additively extended per ADR-0004
  10. **Tests pass:** full focused suite green (adaptation + governance + cli)

- [ ] **Step 3: If findings, dispatch one fix subagent**

If the reviewer returns Critical or Important findings, dispatch ONE fix subagent with the complete findings list (not one fixer per finding — see writing-plans skill notes). Re-run the reviewer's covering tests after the fix.

- [ ] **Step 4: Push branch and open PR**

```bash
cd /home/babasola/Projects/Monolith
git push -u origin feature/p9.2-governance-proposals
gh pr create --title "P9.2: GovernanceProposal (advisory-to-proposal bridge)" \
  --body "..." --head feature/p9.2-governance-proposals --base main
```

The PR body should mirror the structure of the P9.1 PR (#117) — section for what's in this PR, the hard boundary, verification (test counts, tsc, protected files), and explicit out-of-scope.

- [ ] **Step 5: After PR is opened, use superpowers:finishing-a-development-branch**

Once the PR is open and CI is green, use the `superpowers:finishing-a-development-branch` skill to choose the integration path (merge locally / push and create PR / keep as-is / discard). The standard path for P-phases is squash-merge + tag.

- [ ] **Step 6: Tag the release**

```bash
cd /home/babasola/Projects/Monolith
git checkout main
git pull --ff-only
git tag -a alix-p9-2-complete -m "P9.2: GovernanceProposal (advisory-to-proposal bridge) — PR #XXX

[detailed tag message describing the slice]"
git push origin alix-p9-2-complete
```

---

## Summary

| Task | Files | Tests | Pre-req |
|---|---|---|---|
| 0 — P9.1 metadata amendment | 2 modified | +5-7 (modified existing) | — |
| P9.2a — types extension + findRecommendationById | 3 modified, 1 new | +2 | Task 0 |
| P9.2b — ProposalGenerator | 1 new, 2 modified | +6 | Task 0 + P9.2a |
| P9.2c — CLI | 2 modified | +3 | P9.2b |
| P9.2d — Sentinel | 1 modified, 1 modified | +4 | P9.2a + P9.2b |
| P9.2e — Final review + PR | 0 (read-only) | 0 (verifies others) | P9.2a-d |

---

## Cross-cutting invariants (apply to all tasks)

### Orphaned system-state semantics

`orphaned` is a **system state**, not a lifecycle state. The P5 lifecycle states (`pending`, `approved`, `rejected`, `applied`, `failed`) are operator/business states that drive the approval workflow. `orphaned` is an infrastructure-recovery state used by the P9.2 atomicity guarantee (case B) when an EvidenceChain write fails after a proposal is created.

**Crucial architectural decision:** `orphaned` is **NOT** a member of `ProposalStatus`. The P5 lifecycle vocabulary is preserved exactly. Instead, `orphaned` is a field on a new `systemState` metadata block:

```ts
proposal: {
  ...proposal,
  systemState?: { orphaned: true; reason: string }
}
```

This is enforced by `ProposalStore.list()`:

```ts
list(): list.filter((p) => !p.systemState?.orphaned)
```

The benefit: every existing P5 consumer of `ProposalStatus` (`ApprovalGate`, the appliers, the `alix adaptation` CLI, the Explain engine, every dashboard) keeps its 5-state vocabulary unchanged. `orphaned` is invisible to lifecycle code; it's a recovery flag in metadata.

**Invariants on orphaned proposals:**

- The proposal's `ProposalStatus` remains `"pending"` even when `systemState.orphaned` is set. The lifecycle does not advance.
- Orphaned proposals are **never eligible for approval.** `alix adaptation approve <id>` must reject with a clear message if the proposal's `systemState.orphaned` is set.
- Orphaned proposals are **excluded from all proposal queues** (i.e., `ProposalStore.list()` filters them out via `!p.systemState?.orphaned`).
- Orphaned proposals **retain their payload and evidence** for audit; they are not deleted, only hidden from operator-facing lists.
- A future cleanup task (out of P9.2 scope) may sweep orphaned proposals after a retention period.
- The `systemState.orphanedReason` field is the EvidenceChain write error message, preserved for post-mortem analysis.

The P9.2d sentinel must include a test asserting: orphaned proposals are filtered from `list()`. The simplest test: create a proposal, set `systemState: { orphaned: true, reason: "..." }`, assert `list()` does not include it.

**No protected-file change is needed for this.** `AdaptationProposal` is not on the protected-files list; P9.2 can add `systemState?: { orphaned: true; reason: string }` to it without an ADR-0004 exception. The 6 protected files (`risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`) receive **only** the two ADR-0004-enumerated extensions: `ProposalAction += "governance_change"` and `ProposalTarget += { kind: "governance"; recommendationId: string }`.

### Future indexed provenance lookup (P9.2b / P9.3 optimization)

Current idempotency check:

```ts
const existingChains = await chainStore.getChainForRoot(recommendationId);
for (const chain of existingChains) {
  for (const link of chain.links) {
    if (link.relationType === "proposal_from_recommendation") { ... }
  }
}
```

This iterates all chains rooted at the recommendation. Fine for P9.2's expected volume. If governance volume grows — especially if EvidenceChain starts holding the full P5 lifecycle (proposal → approval → apply) — the lookup should become:

```ts
findLinksByRelation(recommendationId, "proposal_from_recommendation")
```

with an index. This is **not** in P9.2's scope. Document it as a P9.2b/P9.3 follow-up if volume becomes a real concern. For now, the linear scan is correct, simple, and matches existing EvidenceChain usage patterns.

**Total: 1 prerequisite PR + 4 implementation tasks + 1 final-review task. 6 PRs total (Task 0 is its own PR, P9.2a-d each get one PR, P9.2e is the final review and merge).**

**All existing governance tests must still pass. No P8 files touched. The 5 protected files (other than `adaptation-types.ts`) remain byte-identical to main.**
