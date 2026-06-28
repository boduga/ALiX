# P7.5p.3 — GovernanceReviewStore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-proposal `GovernanceReview` records so the P8.3 governance calibration adapter can derive `LensObservation[]` from `review.lensScores × OutcomeRecord`.

**Architecture:** Mirror the P7.5p.1/.2 pattern with one justified deviation: a 5th store method `queryByProposal` to enable auto-lookup. The write hook lives in `runReview` (LLM-gated, operator-initiated) rather than the deterministic `runRecommend`. **Zero type-file changes** — `OutcomeRecord.governanceReviewId?` already exists.

**Tech Stack:** TypeScript, vitest, node:fs, node:path.

## Global Constraints

- **Append-only.** The new `GovernanceReviewStore` MUST NOT have `delete` / `update` / `clear` / `truncate` / `set` / `replace` / `modifySource` / `writeBack` on its prototype (sentinel test enforces this).
- **Best-effort writes.** The CLI write hook in `runReview` MUST log-and-continue on store failure; never block the review render.
- **Pure aggregators stay pure.** `GovernanceReviewCouncil` and `LensCalibrationBuilder` MUST NOT import any store or call any side effect. Side effects live in the CLI orchestration layer.
- **No fake values.** `outcome.governanceReviewId` is `undefined` when no override and no review found in the store; never faked.
- **Override wins.** When both auto-looked-up and operator-supplied `--governance-review-id` are present, the operator override wins.
- **Most-recent wins on auto-lookup.** When multiple reviews exist for a proposal, auto-lookup returns the **last-appended** (most recent) review id for **that proposal**. Test locks this.
- **Proposal-scoped isolation (governance-boundary invariant).** Auto-lookup MUST use `queryByProposal(subjectId).at(-1)`, NEVER the naive `list().at(-1)`. A review belonging to a *different* proposal — even one with a newer timestamp — MUST NEVER leak into an outcome's `governanceReviewId`. This protects against a regression where the lookup is "optimized" to the global last line. Test locks this explicitly.
- **5 strict-protected files remain byte-identical to P8.5a.0 baseline.** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`.
- **`outcome-types.ts` is NOT modified.** `governanceReviewId?` already exists (P6.5a). P7.5p.3 modifies zero type files. The invariance test's `ALLOWED_DELTA_CONTENT` (P7.5p.2c state) still matches unchanged.
- **No forbidden imports** in the store file: `ProposalStore`, `ApprovalGate`, `AutomaticProposalGenerator`, `ApproveCommand`, `ApplyCommand`.

---

## Task 1: P7.5p.3a — GovernanceReviewStore

**Files:**
- Create: `src/adaptation/governance-review-store.ts`
- Create: `tests/adaptation/governance-review-store.vitest.ts`

**Interfaces:**
- Consumes: `GovernanceReview` type (from `governance-review-types.ts`)
- Produces: `GovernanceReviewStore` class with **5 public methods** (`append`, `get`, `list`, `queryByWindow`, `queryByProposal`)

- [ ] **Step 1.1: Write the store**

Create `src/adaptation/governance-review-store.ts`:

```ts
/**
 * P7.5p.3a — GovernanceReviewStore.
 *
 * Append-only JSONL persistence for GovernanceReview artifacts.
 * Mirrors the pattern of RiskScoreStore (P7.5p.2a) and
 * ApprovalRecommendationStore (P7.5p.1a). Read-only relative to the
 * governance lifecycle — never creates proposals, never invokes the
 * approval gate, never re-aggregates.
 *
 * Storage: .alix/governance-reviews/governance-reviews.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { GovernanceReview } from "./governance-review-types.js";

const STORE_DIR = join(".alix", "governance-reviews");
const STORE_FILE = join(STORE_DIR, "governance-reviews.jsonl");

export class GovernanceReviewStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), STORE_DIR),
  ) {}

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private filePath(): string {
    return join(this.storeDir, STORE_FILE.split("/").pop()!);
  }

  /**
   * Append one governance review to the store. The review is stored verbatim.
   */
  async append(review: GovernanceReview): Promise<void> {
    this.ensureStoreDir();
    const line = JSON.stringify(review) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Look up a governance review by id. Returns the FIRST match.
   */
  async get(id: string): Promise<GovernanceReview | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  }

  /**
   * Read all governance reviews in the store, skipping corrupt lines.
   */
  async list(): Promise<GovernanceReview[]> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: GovernanceReview[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as GovernanceReview);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  /**
   * Read all governance reviews whose generatedAt is within the last
   * `windowDays` days.
   */
  async queryByWindow(windowDays: number): Promise<GovernanceReview[]> {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const all = await this.list();
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }

  /**
   * Read all governance reviews for a given proposalId, in append order
   * (oldest first; the LAST element is the most recent). Used by the
   * outcome CLI's auto-lookup to link an outcome to the most recent review.
   */
  async queryByProposal(proposalId: string): Promise<GovernanceReview[]> {
    const all = await this.list();
    return all.filter((r) => r.proposalId === proposalId);
  }
}
```

- [ ] **Step 1.2: Write the store tests**

Create `tests/adaptation/governance-review-store.vitest.ts`. **Read `src/adaptation/governance-review-types.ts` first** to confirm the `GovernanceReview` / `LensScore` / `CouncilVote` / `GovernanceVerdict` shapes before writing the fixture. The fixture below is authoritative against the current types; verify each field exists.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";
import type { GovernanceReview, LensScore, CouncilVote } from "../../src/adaptation/governance-review-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "review-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

const councilVote: CouncilVote = {
  agree: 2,
  agreeWithConcerns: 1,
  challenge: 1,
  insufficientInformation: 0,
};

const lensScores: LensScore[] = [
  { lens: "red_team", recommendedVerdict: "challenge", confidence: 0.8, rationale: "high risk" },
  { lens: "historian", recommendedVerdict: "agree", confidence: 0.7, rationale: "no analogs" },
  { lens: "policy_auditor", recommendedVerdict: "agree_with_concerns", confidence: 0.6, rationale: "minor policy gap" },
  { lens: "confidence_critic", recommendedVerdict: "agree", confidence: 0.65, rationale: "evidence sufficient" },
];

function makeReview(overrides: Partial<GovernanceReview> = {}): GovernanceReview {
  return {
    id: "review-prop-1-1700000000000",
    subject: "Governance review for prop-1",
    outcome: "reviewed",
    confidence: 0.7,
    reasons: ["council reached quorum"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    recommendationId: "rec-prop-1-1700000000000",
    proposalId: "prop-1",
    verdict: "agree_with_concerns",
    concerns: ["minor policy gap"],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores,
    councilVote,
    sourceArtifacts: [],
    ...overrides,
  };
}

describe("GovernanceReviewStore: append + query", () => {
  it("appends a review and persists as one JSONL line", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-1" }));
    const path = join(tempRoot, ".alix", "governance-reviews", "governance-reviews.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("review-1");
    expect(parsed.proposalId).toBe("prop-1");
    expect(parsed.lensScores).toHaveLength(4);
  });

  it("get(id) returns the stored review", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-42", verdict: "challenge" }));
    const got = await store.get("review-42");
    expect(got).not.toBeNull();
    expect(got!.verdict).toBe("challenge");
  });

  it("get(id) returns null for an unknown id", async () => {
    const store = new GovernanceReviewStore();
    const got = await store.get("nonexistent");
    expect(got).toBeNull();
  });

  it("list() returns all stored reviews", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-1" }));
    await store.append(makeReview({ id: "review-2" }));
    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(["review-1", "review-2"]);
  });

  it("queryByWindow(days) returns only reviews within the window", async () => {
    const store = new GovernanceReviewStore();
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    await store.append(makeReview({ id: "recent", generatedAt: tenDaysAgo.toISOString() }));
    await store.append(makeReview({ id: "old", generatedAt: fortyDaysAgo.toISOString() }));
    const inWindow = await store.queryByWindow(30);
    expect(inWindow.map((r) => r.id)).toEqual(["recent"]);
  });

  it("queryByProposal(proposalId) returns only reviews for that proposal", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-1", proposalId: "prop-1" }));
    await store.append(makeReview({ id: "review-2", proposalId: "prop-2" }));
    await store.append(makeReview({ id: "review-3", proposalId: "prop-1" }));
    const forProp1 = await store.queryByProposal("prop-1");
    expect(forProp1.map((r) => r.id)).toEqual(["review-1", "review-3"]);
  });

  it("queryByProposal returns reviews in append order (last = most recent)", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-first", proposalId: "prop-1", generatedAt: "2026-06-20T00:00:00.000Z" }));
    await store.append(makeReview({ id: "review-latest", proposalId: "prop-1", generatedAt: "2026-06-22T00:00:00.000Z" }));
    const forProp1 = await store.queryByProposal("prop-1");
    // The caller picks the last element as "most recent".
    expect(forProp1[forProp1.length - 1].id).toBe("review-latest");
  });
});

describe("GovernanceReviewStore: append-only + no source mutation", () => {
  it("prototype has no delete/update/clear/truncate/set/replace/modifySource/writeBack methods", () => {
    const store = new GovernanceReviewStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "set", "replace", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("appending the same id twice does NOT overwrite — both lines are kept", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-dup", verdict: "agree" }));
    await store.append(makeReview({ id: "review-dup", verdict: "challenge" }));
    const path = join(tempRoot, ".alix", "governance-reviews", "governance-reviews.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("GovernanceReviewStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = join(tempRoot, ".alix", "governance-reviews");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "governance-reviews.jsonl"),
      JSON.stringify(makeReview({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new GovernanceReviewStore();
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
  });
});
```

- [ ] **Step 1.3: Run tests to verify they pass**

Run: `npx vitest run tests/adaptation/governance-review-store.vitest.ts`
Expected: 10 passing.

- [ ] **Step 1.4: Commit**

```bash
git add src/adaptation/governance-review-store.ts tests/adaptation/governance-review-store.vitest.ts
git commit -m "feat(p7.5p.3a): GovernanceReviewStore — append-only JSONL"
```

---

## Task 2: P7.5p.3b — runReview write hook

**Files:**
- Modify: `src/cli/commands/decision.ts` (add import + hook in `runReview`)
- Create: `tests/cli/commands/decision-review-persistence.vitest.ts`

**Interfaces:**
- Consumes: existing `runReview` flow (`council.aggregate()` at line 712 returns the full `GovernanceReview`)
- Produces: `GovernanceReviewStore.append(review)` call immediately after `council.aggregate()`, best-effort (`.catch(log)`)

- [ ] **Step 2.1: Add the import**

In `src/cli/commands/decision.ts`, add adjacent to the existing `RiskScoreStore` import (added in P7.5p.2b) and `ApprovalRecommendationStore` import:

```ts
import { GovernanceReviewStore } from "../../adaptation/governance-review-store.js";
```

- [ ] **Step 2.2: Add the write hook in `runReview`**

In `runReview`, find the existing block (around line 710-712):

```ts
  const council = new GovernanceReviewCouncil();
  const reviewId = `review-${id}-${Date.now()}`;
  const review = council.aggregate(reviewId, id, recommendation.id, scores, input);
```

Immediately AFTER `const review = council.aggregate(...)` and BEFORE the render block (`if (jsonMode) { ... }`), insert:

```ts
  // P7.5p.3b — persist the review so P8.3 governance calibration can
  // derive LensObservation[] from review.lensScores × OutcomeRecord.
  // Best-effort: log-and-continue on failure; never block the review render.
  await new GovernanceReviewStore().append(review).catch((err) =>
    console.warn(
      `[alix] warning: failed to persist governance review ${review.id}:`,
      err instanceof Error ? err.message : String(err),
    ),
  );
```

The hook MUST be post-aggregation (the full review object exists) and pre-render. Do NOT change the order: lens-run → aggregate → append → render.

**Note for the implementer:** `runReview` is LLM-gated (requires a provider + API key). The integration test MUST mock the LLM provider path OR test the hook in isolation by invoking the council directly. Read `tests/cli/commands/decision-recommend-risk-persistence.vitest.ts` (P7.5p.2b) for the established mocking pattern. If mocking the full `runReview` LLM path is impractical, test the hook behaviorally: instantiate `GovernanceReviewStore`, append a fixture review, and assert persistence + best-effort failure. The goal is to prove the append happens and failure does not throw.

- [ ] **Step 2.3: Write the integration test**

Create `tests/cli/commands/decision-review-persistence.vitest.ts`. Use the `vi.spyOn(process, "cwd").mockReturnValue(tempRoot)` pattern. Two tests:

1. **Persistence:** append a fixture `GovernanceReview` via the store (simulating the post-aggregate hook), then assert `.alix/governance-reviews/governance-reviews.jsonl` contains one valid line with the review's `id` and `lensScores.length === 4`.
2. **Best-effort failure:** mock `GovernanceReviewStore.prototype.append` to throw; assert the calling code path (the `.catch` handler) emits a warning and does NOT re-throw.

If the LLM-gated `runReview` is too costly to invoke in a unit test, document this in the test file header and test the store + hook contract directly (the append call + the `.catch` wrapper). The behavioral guarantee — "persist on success, warn-and-continue on failure" — is what matters.

- [ ] **Step 2.4: Run the focused test suite**

Run: `npx vitest run tests/adaptation/governance-review-store.vitest.ts tests/cli/commands/decision-review-persistence.vitest.ts`
Expected: all passing.

- [ ] **Step 2.5: Commit**

```bash
git add src/cli/commands/decision.ts tests/cli/commands/decision-review-persistence.vitest.ts
git commit -m "feat(p7.5p.3b): persist GovernanceReview in runReview"
```

---

## Task 3: P7.5p.3c — outcome auto-lookup + --governance-review-id override

**Files:**
- Modify: `src/cli/commands/decision.ts` (`runOutcomeRecord` governance-review resolution + add to OutcomeRecord literal)

**Interfaces:**
- Consumes: existing `runOutcomeRecord` flow, `subjectId` (proposal id), existing `--recommendation` lookup block
- Produces: `OutcomeRecord.governanceReviewId` populated via override OR auto-lookup of most-recent review by `subjectId`

- [ ] **Step 3.1: Add the governance-review resolution in `runOutcomeRecord`**

In `src/cli/commands/decision.ts`, find `runOutcomeRecord`. The function already resolves `recommendationId`, `confidence`, and (P7.5p.2c) `resolvedRiskScoreId`. Add the `governanceReviewId` resolution adjacent to the `resolvedRiskScoreId` block.

The logic (override wins, else auto-lookup most-recent by subjectId, else undefined):

```ts
  // P7.5p.3c — resolve governanceReviewId from --governance-review-id override
  // OR auto-lookup (most recent review for this proposal). Never fake:
  // missing stays undefined and serializes as absent in JSON.
  let resolvedGovernanceReviewId: string | undefined;
  const grIdx = args.indexOf("--governance-review-id");
  if (grIdx !== -1 && grIdx + 1 < args.length) {
    resolvedGovernanceReviewId = args[grIdx + 1];
  } else {
    try {
      const reviewStore = new GovernanceReviewStore();
      const reviews = await reviewStore.queryByProposal(subjectId);
      if (reviews.length > 0) {
        // Most recent = last-appended for THIS proposal (append order preserved).
        // MUST be queryByProposal(subjectId), never list().at(-1) — see
        // governance-boundary invariant test #7 (cross-proposal isolation).
        resolvedGovernanceReviewId = reviews[reviews.length - 1].id;
      }
    } catch (err) {
      console.error(
        `Warning: failed to look up governance review for ${subjectId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
```

Place this block near the existing `resolvedRiskScoreId` resolution (mirror its style and comment density).

- [ ] **Step 3.2: Add `governanceReviewId` to the OutcomeRecord literal**

In `runOutcomeRecord`, find the `OutcomeRecord` literal (around line 926-940). Add the field adjacent to `riskScoreId`:

```ts
  const record: OutcomeRecord = {
    id: `outcome:${subjectId}:${Date.now()}`,
    subjectId,
    subjectType: "proposal",
    outcome: outcomeValue,
    generatedAt: new Date().toISOString(),
    recommendationId,
    actionTaken,
    observationWindowDays: 30,
    confidence,
    riskScoreId: resolvedRiskScoreId,
    governanceReviewId: resolvedGovernanceReviewId,
    reasons: [],
    evidenceRefs: [],
    subject: `Outcome: ${subjectId}`,
  };
```

If `resolvedGovernanceReviewId` is `undefined`, `JSON.stringify` omits the field — honest serialization.

- [ ] **Step 3.3: Write the outcome-CLI tests**

Create `tests/cli/commands/decision-outcome-governance-review-id.vitest.ts`. Mirror the structure of `tests/cli/commands/decision-outcome-risk-score-id.vitest.ts` (P7.5p.2c). **Seven** tests (test #5 locks most-recent; test #7 is the proposal-scoped governance-boundary invariant):

1. Seed store with one review for `prop-1` (`id: "review-1"`). Run outcome CLI with no override. Assert `outcome.governanceReviewId === "review-1"` (auto-lookup).
2. Run outcome CLI with `--governance-review-id review-override` AND a review in the store. Assert `outcome.governanceReviewId === "review-override"` (override wins).
3. Run outcome CLI with no review in store, no override. Assert `outcome.governanceReviewId === undefined` (never faked).
4. Run outcome CLI with `--governance-review-id review-explicit`, no review in store. Assert `outcome.governanceReviewId === "review-explicit"`.
5. **Multiple reviews, no override → auto-lookup picks the latest appended.** Seed store with `review-first` (generatedAt older) then `review-latest` (generatedAt newer) for the same `prop-1`. Run outcome CLI with no override. Assert `outcome.governanceReviewId === "review-latest"`.
6. Run outcome CLI for `prop-2` (a different proposal) with reviews only for `prop-1` in the store. Assert `outcome.governanceReviewId === undefined` (auto-lookup is proposal-scoped).
7. **Cross-proposal isolation (governance-boundary invariant).** Seed store with a review for `prop-A` (`review-a`, older `generatedAt`) AND a review for `prop-B` (`review-b`, NEWER `generatedAt`). Run outcome CLI for `prop-A` with no override. Assert `outcome.governanceReviewId === "review-a"` — NOT `review-b`. This proves the auto-lookup is proposal-scoped (`queryByProposal(subjectId).at(-1)`) and that a newer review for a *different* proposal never leaks into the link. A regression to the naive `list().at(-1)` would fail this test by returning `review-b`.

- [ ] **Step 3.4: Run the full focused test suite**

Run:
```bash
npx vitest run tests/adaptation/governance-review-store.vitest.ts \
  tests/cli/commands/decision-review-persistence.vitest.ts \
  tests/cli/commands/decision-outcome-governance-review-id.vitest.ts \
  tests/cli/commands/decision-outcome-risk-score-id.vitest.ts \
  tests/cli/commands/decision-outcome-confidence.vitest.ts \
  tests/cli/commands/decision-recommend-persistence.vitest.ts \
  tests/cli/commands/decision-recommend-risk-persistence.vitest.ts \
  tests/adaptation/risk-score-store.vitest.ts \
  tests/adaptation/approval-recommendation-store.vitest.ts \
  tests/learning/unchanged-types-invariance.vitest.ts
```
Expected: all passing.

- [ ] **Step 3.5: Verify zero type-file changes**

Run:
```bash
git diff main --stat -- 'src/adaptation/outcome-types.ts' 'src/adaptation/risk-score-types.ts' 'src/adaptation/governance-review-types.ts' 'src/adaptation/adaptation-types.ts' 'src/adaptation/decision-types.ts' 'src/learning/learning-types.ts'
```

Expected: **empty output** (zero diff against main for all 6 type files — P7.5p.3 modifies none of them).

- [ ] **Step 3.6: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3.7: Commit**

```bash
git add src/cli/commands/decision.ts tests/cli/commands/decision-outcome-governance-review-id.vitest.ts
git commit -m "feat(p7.5p.3c): outcome CLI auto-links governanceReviewId + override"
```

---

## Task 4: Final whole-branch review + PR

- [ ] **Step 4.1: Run the full test suite**

Run: `npm test`
Expected: all focused tests pass (the 3 pre-existing CI failures on main remain pre-existing — unrelated to P7.5p.3).

- [ ] **Step 4.2: Verify scope via gitnexus**

Run `gitnexus_detect_changes()` to confirm the diff is scoped to P7.5p.3 (no spillover into other modules, no type-file changes).

- [ ] **Step 4.3: Confirm zero type-file changes one more time**

Run: `git diff main --stat -- 'src/adaptation/*.ts' 'src/learning/*.ts'`
Expected: only `src/cli/commands/decision.ts` + the new store file appear in the diff; NO type files.

- [ ] **Step 4.4: Open PR**

```bash
git push -u origin feature/p7.5p.3-governance-review-store
gh pr create --base main --head feature/p7.5p.3-governance-review-store \
  --title "P7.5p.3: GovernanceReviewStore + Lens-Review Persistence" \
  --body "..."
```

The PR body should describe:
- 3 atomic commits (P7.5p.3a store, .3b hook, .3c auto-lookup + override)
- New store path: `.alix/governance-reviews/governance-reviews.jsonl`, 5 methods (the 5th `queryByProposal` enables auto-lookup)
- Write hook in `runReview` (LLM-gated, post-aggregation, best-effort)
- **Zero type-file changes** — `OutcomeRecord.governanceReviewId?` already exists (P6.5a)
- Auto-lookup: most-recent review by proposalId; `--governance-review-id` override wins; missing → undefined (never faked)
- Most-recent behavior locked by test (test #5)
- 5 strict-protected files byte-identical; `outcome-types.ts` unchanged
- What this unlocks: P8.3 governance adapter can retire the `lens_scores_not_persisted` sentinel

- [ ] **Step 4.5: Await review and merge**

After review approval, merge with `gh pr merge <N> --squash --delete-branch` and tag `alix-p7-5p-3-complete`.

---

## Notes

- **`GovernanceReview` required fixture fields** (verified against `src/adaptation/governance-review-types.ts` + `decision-types.ts` `DecisionArtifact`): base = `id, subject, outcome, confidence, reasons, generatedAt` (`warnings?`, `evidenceRefs?` optional); review-specific = `recommendationId, proposalId, verdict, concerns[], blindSpots[], historicalAnalogies[], lensScores[], councilVote, sourceArtifacts[]`. `CouncilVote` = `{ agree, agreeWithConcerns, challenge, insufficientInformation }`. `LensScore` = `{ lens, recommendedVerdict, confidence, rationale, provider?, model? }`. The implementer MUST read these type files to confirm before writing the fixture.
- **`runReview` is LLM-gated.** Unlike P7.5p.1/.2 hooks (deterministic `runRecommend`), this hook lives behind a provider/API-key check. The integration test should mock the LLM path OR test the hook contract directly. The behavioral guarantee (persist-on-success, warn-on-failure) is what's tested.
- **Most-recent = last-appended.** Append order is preserved in JSONL; `queryByProposal` returns oldest-first; the caller takes the last element. This is locked by store test (Step 1.2) and outcome test (Step 3.3 #5).
- **`concernsRaised` is NOT P7.5p.3's concern.** `LensScore` has no per-lens count; the P8.3 adapter owns the derivation heuristic. P7.5p.3 persists the raw review faithfully.
- **No new CLI command.** `--governance-review-id` is added to the existing `decision outcome` subcommand.
- **CI failures on main are pre-existing** (`chat-modes.test.js`, `manifest.test.js`, `registry.test.js`, `card-loader.test.js`, `context-events.test.js`, `Capabilities` scope-tracker). P7.5p.3 touches none of those code paths.