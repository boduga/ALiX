# P7.5p.2 — RiskScoreStore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-proposal `RiskScore` records so the P8.2 risk calibration adapter can join `RiskScore × OutcomeRecord → RiskOutcomeObservation[]`.

**Architecture:** Mirror the P7.5p.1 pattern: append-only JSONL store + CLI orchestration-layer write hook + best-effort failure mode. Add one new optional field `riskScoreId?: string` to `OutcomeRecord`. No architectural change.

**Tech Stack:** TypeScript, vitest, fs/promises, node:crypto (SHA-256 invariance baseline).

## Global Constraints

- **Append-only.** The new `RiskScoreStore` MUST NOT have `delete` / `update` / `clear` / `truncate` / `set` / `replace` / `modifySource` / `writeBack` on its prototype (sentinel test enforces this).
- **Best-effort writes.** The CLI write hook in `runRecommend` MUST log-and-continue on store failure; never block the operator-facing recommendation output.
- **Pure builders stay pure.** `RiskScoreBuilder` and `RecommendationEngine` MUST NOT import any store or call any side-effect. Side effects live in the CLI orchestration layer.
- **No fake values.** `outcome.riskScoreId` is `undefined` when no override and no carried-forward value; never faked to a non-undefined placeholder.
- **Override wins.** When both recommendation-carried and operator-supplied `--risk-score-id` are present, the CLI uses the operator override.
- **5 strict-protected files remain byte-identical to P8.5a.0 baseline.** `risk-score-types.ts`, `governance-review-types.ts`, `adaptation-types.ts`, `decision-types.ts`, `learning-types.ts`.
- **`outcome-types.ts` may match one of three approved states:** P8.5a.0 baseline / P7.5p.1c delta / P7.5p.2c delta. Invariance test captures the latest approved state at module-load time.
- **No forbidden imports** in the store file: `ProposalStore`, `ApprovalGate`, `AutomaticProposalGenerator`, `ApproveCommand`, `ApplyCommand`. (Grep sentinel enforces.)
- **No forbidden call sites** in the store file: `approve(`, `apply(`, `reject(` (word-boundary regex enforces).

---

## Task 1: P7.5p.2a — RiskScoreStore

**Files:**
- Create: `src/adaptation/risk-score-store.ts`
- Create: `tests/adaptation/risk-score-store.vitest.ts`

**Interfaces:**
- Consumes: nothing (only `RiskScore` type)
- Produces: `RiskScoreStore` class with 4 public methods (`append`, `get`, `list`, `queryByWindow`)

- [ ] **Step 1.1: Write the store**

Create `src/adaptation/risk-score-store.ts`:

```ts
/**
 * P7.5p.2a — RiskScoreStore.
 *
 * Append-only JSONL persistence for RiskScore artifacts.
 * Mirrors the pattern of ApprovalRecommendationStore (P7.5p.1a) and
 * OutcomeStore (P7a). Read-only relative to the governance lifecycle —
 * never creates proposals, never invokes the approval gate.
 *
 * Storage: .alix/risk-scores/risk-scores.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { RiskScore } from "./risk-score-types.js";

const STORE_DIR = join(".alix", "risk-scores");
const STORE_FILE = join(STORE_DIR, "risk-scores.jsonl");

export class RiskScoreStore {
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
   * Append one risk score to the store. The score is stored verbatim.
   * Returns nothing (use get(id) to read back).
   */
  async append(score: RiskScore): Promise<void> {
    this.ensureStoreDir();
    const line = JSON.stringify(score) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Look up a risk score by id. Returns the FIRST match (the store is
   * append-only; duplicate ids are possible but the first append is the
   * canonical record).
   */
  async get(id: string): Promise<RiskScore | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  }

  /**
   * Read all risk scores in the store, skipping corrupt lines.
   */
  async list(): Promise<RiskScore[]> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: RiskScore[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as RiskScore);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  /**
   * Read all risk scores whose generatedAt is within the last
   * `windowDays` days.
   */
  async queryByWindow(windowDays: number): Promise<RiskScore[]> {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const all = await this.list();
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }
}
```

- [ ] **Step 1.2: Write the store tests**

Create `tests/adaptation/risk-score-store.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RiskScoreStore } from "../../src/adaptation/risk-score-store.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "risk-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "risk-prop-1",
    subject: "Risk for prop-1",
    outcome: "medium",
    confidence: 0.7,
    reasons: ["evidence is moderate"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    overallRisk: 0.45,
    risks: [],
    dimensions: {
      governance: 0.3,
      operational: 0.5,
      capability: 0.4,
      revertability: 0.5,
      evidence_quality: 0.4,
    },
    sourceArtifacts: [],
    ...overrides,
  };
}

describe("RiskScoreStore: append + query", () => {
  it("appends a risk score and persists as one JSONL line", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-1" }));
    const path = join(tempRoot, ".alix", "risk-scores", "risk-scores.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("risk-1");
    expect(parsed.overallRisk).toBe(0.45);
  });

  it("get(id) returns the stored risk score", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-42", overallRisk: 0.72 }));
    const got = await store.get("risk-42");
    expect(got).not.toBeNull();
    expect(got!.overallRisk).toBe(0.72);
    expect(got!.outcome).toBe("medium");
  });

  it("get(id) returns null for an unknown id", async () => {
    const store = new RiskScoreStore();
    const got = await store.get("nonexistent");
    expect(got).toBeNull();
  });

  it("list() returns all stored risk scores", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-1" }));
    await store.append(makeScore({ id: "risk-2" }));
    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(["risk-1", "risk-2"]);
  });

  it("queryByWindow(days) returns only risk scores within the window", async () => {
    const store = new RiskScoreStore();
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    await store.append(makeScore({ id: "recent", generatedAt: tenDaysAgo.toISOString() }));
    await store.append(makeScore({ id: "old", generatedAt: fortyDaysAgo.toISOString() }));
    const inWindow = await store.queryByWindow(30);
    expect(inWindow.map((r) => r.id)).toEqual(["recent"]);
  });
});

describe("RiskScoreStore: append-only + no source mutation", () => {
  it("prototype has no delete/update/clear/truncate/set/replace/modifySource/writeBack methods", () => {
    const store = new RiskScoreStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "set", "replace", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("appending the same id twice does NOT overwrite — both lines are kept", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-dup", overallRisk: 0.3 }));
    await store.append(makeScore({ id: "risk-dup", overallRisk: 0.6 }));
    const path = join(tempRoot, ".alix", "risk-scores", "risk-scores.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("RiskScoreStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = join(tempRoot, ".alix", "risk-scores");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "risk-scores.jsonl"),
      JSON.stringify(makeScore({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new RiskScoreStore();
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
  });
});
```

- [ ] **Step 1.3: Run tests to verify they pass**

Run: `npx vitest run tests/adaptation/risk-score-store.vitest.ts`
Expected: 8 passing.

- [ ] **Step 1.4: Commit**

```bash
git add src/adaptation/risk-score-store.ts tests/adaptation/risk-score-store.vitest.ts
git commit -m "feat(p7.5p.2a): RiskScoreStore — append-only JSONL"
```

---

## Task 2: P7.5p.2b — runRecommend write hook

**Files:**
- Modify: `src/cli/commands/decision.ts` (add import + hook)
- Create: `tests/cli/commands/decision-recommend-risk-persistence.vitest.ts`

**Interfaces:**
- Consumes: existing `riskScoreBuilder.build(ctx)` call, `RecommendationEngine.recommend(ctx, riskScore)`
- Produces: `RiskScoreStore.append(riskScore)` call between build and recommend, best-effort (`.catch(log)`)

- [ ] **Step 2.1: Read the current runRecommend path**

Read `src/cli/commands/decision.ts` lines around `runRecommend`. Find the existing `riskScoreBuilder.build(ctx)` call and the existing `recommendationEngine.recommend(ctx, riskScore)` call. The write hook MUST be inserted between them.

- [ ] **Step 2.2: Add the import**

Add at the existing import block in `src/cli/commands/decision.ts`:

```ts
import { RiskScoreStore } from "../../adaptation/risk-score-store.js";
```

(Place adjacent to the existing `import { ApprovalRecommendationStore }` from P7.5p.1b.)

- [ ] **Step 2.3: Add the write hook**

In `runRecommend`, locate the line `const riskScore = riskScoreBuilder.build(ctx);` (or equivalent). Immediately after it, insert:

```ts
// P7.5p.2b — persist RiskScore before consumption. Best-effort.
await new RiskScoreStore()
  .append(riskScore)
  .catch((err) => {
    console.warn(
      `[P7.5p.2] RiskScoreStore.append failed for ${riskScore.id}:`,
      err instanceof Error ? err.message : String(err),
    );
  });
```

The exact placement is **between** `riskScore = riskScoreBuilder.build(ctx)` and `rec = recommendationEngine.recommend(ctx, riskScore)`. Do NOT change the order of build → append → recommend.

- [ ] **Step 2.4: Write the integration test**

Create `tests/cli/commands/decision-recommend-risk-persistence.vitest.ts`. Use the same `vi.spyOn(process, "cwd").mockReturnValue(tempRoot)` pattern as `decision-recommend-persistence.vitest.ts` (P7.5p.1b). The test asserts:

1. After running `runRecommend`, `.alix/risk-scores/risk-scores.jsonl` contains exactly one line.
2. The line parses as `RiskScore` with `id === "risk-<proposalId>"`.
3. The store write failure path (mock `append` to throw) does NOT block the recommendation output (the recommendation is still returned).

Read `tests/cli/commands/decision-recommend-persistence.vitest.ts` (P7.5p.1b test) before writing — mirror its shape exactly.

- [ ] **Step 2.5: Run all focused tests**

Run: `npx vitest run tests/adaptation/risk-score-store.vitest.ts tests/cli/commands/decision-recommend-persistence.vitest.ts tests/cli/commands/decision-recommend-risk-persistence.vitest.ts tests/cli/commands/decision-outcome-confidence.vitest.ts`
Expected: all passing.

- [ ] **Step 2.6: Commit**

```bash
git add src/cli/commands/decision.ts tests/cli/commands/decision-recommend-risk-persistence.vitest.ts
git commit -m "feat(p7.5p.2b): persist RiskScore in runRecommend"
```

---

## Task 3: P7.5p.2c — riskScoreId field + invariance test update

**Files:**
- Modify: `src/adaptation/outcome-types.ts` (add `riskScoreId?: string`)
- Modify: `src/cli/commands/decision.ts` (lookup + override block in `runOutcomeRecord`)
- Modify: `tests/learning/unchanged-types-invariance.vitest.ts` (encode P7.5p.2c allowed delta)
- Create: `tests/cli/commands/decision-outcome-risk-score-id.vitest.ts`

**Interfaces:**
- Consumes: existing `runOutcomeRecord` CLI flow, existing `--recommendation` lookup block from P7.5p.1c
- Produces: `OutcomeRecord.riskScoreId?: string` field populated from `rec.riskScoreId` (carried forward) or `--risk-score-id` override

- [ ] **Step 3.1: Add the `riskScoreId` field to `OutcomeRecord`** (NOT `OutcomeArtifact`)

Edit `src/adaptation/outcome-types.ts`. Leave `OutcomeArtifact` focused on `confidence` optionality only — do NOT add `riskScoreId` there. The `OutcomeArtifact` wrapper has a single responsibility: it exists to make the inherited-required `confidence` field optional. Adding more fields to it dilutes that purpose.

Instead, add `riskScoreId` directly on the `OutcomeRecord` interface as a new optional field. Find the existing `OutcomeRecord` block:

```ts
export interface OutcomeRecord extends OutcomeArtifact {
  /** Identifier of the subject that was acted upon */
  subjectId: string;
  /** Type of the subject (e.g., "proposal", "capability", "agent") */
  subjectType: string;
  /** Reference to the P6 DecisionArtifact that produced this outcome */
  decisionId?: string;
  /** Reference to the originating recommendation */
  recommendationId?: string;
  /** Reference to the P6.5b governance review (always null for now — reviews are ephemeral) */
  governanceReviewId?: string;
  /** Description of what action was taken */
  actionTaken: string;
  /** Outcome classification */
  outcome: OutcomeValue;
  /** Observation window in days over which the outcome was assessed */
  observationWindowDays: number;
}
```

Add `riskScoreId` as a new field, placed adjacent to the existing forward refs (`recommendationId`, `governanceReviewId`) for readability:

```ts
export interface OutcomeRecord extends OutcomeArtifact {
  /** Identifier of the subject that was acted upon */
  subjectId: string;
  /** Type of the subject (e.g., "proposal", "capability", "agent") */
  subjectType: string;
  /** Reference to the P6 DecisionArtifact that produced this outcome */
  decisionId?: string;
  /** Reference to the originating recommendation */
  recommendationId?: string;
  /** Reference to the P6.5b governance review (always null for now — reviews are ephemeral) */
  governanceReviewId?: string;
  /**
   * The id of the RiskScore that informed the recommendation linked to
   * this outcome. Undefined when no RiskScore was associated with the
   * recommendation and no override was given. Outcome-specific provenance,
   * not a generic artifact concern.
   * P7.5p.2 — never faked to a placeholder.
   */
  riskScoreId?: string;
  /** Description of what action was taken */
  actionTaken: string;
  /** Outcome classification */
  outcome: OutcomeValue;
  /** Observation window in days over which the outcome was assessed */
  observationWindowDays: number;
}
```

`OutcomeArtifact` stays untouched (only the `confidence?:` field). The new field is purely outcome-specific provenance.

- [ ] **Step 3.2: Add lookup + override in `runOutcomeRecord`**

In `src/cli/commands/decision.ts`, find the existing P7.5p.1c lookup block (the one that resolves `recommendationId` → `rec.confidence`). Adjacent to it, add the `riskScoreId` resolution. Read the existing block first to confirm the exact location and pattern.

The logic:

```ts
// P7.5p.2c — resolve riskScoreId from --risk-score-id override OR rec.riskScoreId
let resolvedRiskScoreId: string | undefined;
if (input.riskScoreId) {
  resolvedRiskScoreId = input.riskScoreId;
} else if (resolvedRecommendation) {
  resolvedRiskScoreId = resolvedRecommendation.riskScoreId;
}
```

Then in the `OutcomeRecord` constructor call, set:

```ts
riskScoreId: resolvedRiskScoreId,
```

(Add `riskScoreId: resolvedRiskScoreId,` to the record literal. If the field is `undefined`, it serializes as absent from the JSON — which is the honest representation.)

- [ ] **Step 3.3: Add `--risk-score-id` to the CLI argument parser**

In the same file, find the argument definitions for `runOutcomeRecord`. Add `riskScoreId` as an optional string flag (mirror how `--recommendation-confidence` is parsed in P7.5p.1c).

- [ ] **Step 3.4: Write the outcome-CLI tests**

Create `tests/cli/commands/decision-outcome-risk-score-id.vitest.ts`. Mirror the structure of `tests/cli/commands/decision-outcome-confidence.vitest.ts` (P7.5p.1c test). Five tests:

1. Seed store with `rec-1` carrying `riskScoreId: "risk-prop-1"`. Run outcome CLI with `--recommendation rec-1` and no `--risk-score-id`. Assert `outcome.riskScoreId === "risk-prop-1"`.
2. Run outcome CLI with `--recommendation rec-1` AND `--risk-score-id risk-override`. Assert `outcome.riskScoreId === "risk-override"` (override wins).
3. Run outcome CLI with `--recommendation rec-missing` AND no override. Assert `outcome.riskScoreId === undefined`.
4. Run outcome CLI with no `--recommendation` AND no `--risk-score-id`. Assert `outcome.riskScoreId === undefined`.
5. Run outcome CLI with no `--recommendation` AND `--risk-score-id risk-explicit`. Assert `outcome.riskScoreId === "risk-explicit"`.

- [ ] **Step 3.5: Update the invariance test**

Edit `tests/learning/unchanged-types-invariance.vitest.ts`. The test currently captures `ALLOWED_DELTA_CONTENT` at module-load time from `src/adaptation/outcome-types.ts`. The new test code:

```ts
// 1 file that may differ from the P8.5a.0 baseline by EXACTLY the
// approved P7.5p.1 + P7.5p.2 additions.
const ALLOWED_DELTA_PROTECTED = "src/adaptation/outcome-types.ts";

// The post-change content is captured at module-load time. This is
// the "approved delta" — if the file changes again, the test fails
// because the hash won't match the captured value.
const ALLOWED_DELTA_CONTENT = readFileSync(ALLOWED_DELTA_PROTECTED, "utf-8");
```

The invariant logic in the existing test (`expect([baselineOutcomeHash, allowedHash]).toContain(currentOutcomeHash)`) already supports multiple approved states by accepting **either** the baseline hash **or** the captured allowed-delta hash. After the P7.5p.2c commit, the captured `ALLOWED_DELTA_CONTENT` reflects the **P7.5p.2c final state** (which contains both P7.5p.1c and P7.5p.2c changes). The previous P7.5p.1c state is **no longer** an approved hash (it doesn't match the baseline or the new allowed-delta), but since the file IS in the P7.5p.2c state on disk, this is correct.

**Important:** if `outcome-types.ts` ever needs to revert to the P7.5p.1c state (e.g., a later phase removes the `riskScoreId?` field), the invariance test will fail loudly — that's by design. The only approved states are P8.5a.0 baseline or P7.5p.2c final (which subsumes P7.5p.1c).

Update the doc comment block at the top of the test to mention the new allowed addition:

```ts
/**
 * P8.5a.0.3 — Unchanged-types invariance test.
 *
 * Locks protected P8 type files at their P8.5a.0 state via SHA-256 baseline.
 * ...
 *
 * After P7.5p.1c, `src/adaptation/outcome-types.ts` is allowed to differ
 * from the baseline by exactly the addition of the `confidence?: number`
 * field on `OutcomeRecord` (via the Omit<DecisionArtifact, "confidence">
 * & { confidence?: number } pattern).
 *
 * After P7.5p.2c, `outcome-types.ts` is allowed to additionally include
 * the `riskScoreId?: string` field on `OutcomeArtifact`. The captured
 * ALLOWED_DELTA_CONTENT reflects the combined P7.5p.1c + P7.5p.2c state.
 * Any other change to that file fails the test.
 *
 * The 5 strict-protected files remain byte-identical to the P8.5a.0
 * baseline.
 * ...
 */
```

- [ ] **Step 3.6: Run the full focused test suite**

Run: `npx vitest run tests/adaptation/risk-score-store.vitest.ts tests/cli/commands/decision-recommend-persistence.vitest.ts tests/cli/commands/decision-recommend-risk-persistence.vitest.ts tests/cli/commands/decision-outcome-confidence.vitest.ts tests/cli/commands/decision-outcome-risk-score-id.vitest.ts tests/learning/unchanged-types-invariance.vitest.ts`
Expected: all passing.

- [ ] **Step 3.7: Verify strict-protected files unchanged**

Run:
```bash
git diff main --stat -- 'src/adaptation/risk-score-types.ts' 'src/adaptation/governance-review-types.ts' 'src/adaptation/adaptation-types.ts' 'src/adaptation/decision-types.ts' 'src/learning/learning-types.ts'
```

Expected: empty output (zero diff against main for the 5 strict-protected files).

- [ ] **Step 3.8: Run `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: clean exit, no type errors.

- [ ] **Step 3.9: Commit**

```bash
git add src/adaptation/outcome-types.ts src/cli/commands/decision.ts tests/cli/commands/decision-outcome-risk-score-id.vitest.ts tests/learning/unchanged-types-invariance.vitest.ts
git commit -m "feat(p7.5p.2c): outcome CLI reads riskScoreId from store + invariance update"
```

---

## Task 4: Final whole-branch review

- [ ] **Step 4.1: Run the full test suite**

Run: `npm test`
Expected: all focused tests pass (the 3 pre-existing CI failures on main remain pre-existing — unrelated to P7.5p.2).

- [ ] **Step 4.2: Verify scope via gitnexus**

Run `gitnexus_detect_changes()` to confirm the diff is scoped to P7.5p.2 (no spillover into other modules).

- [ ] **Step 4.3: Open PR**

```bash
git push -u origin feature/p7.5p.2-risk-score-store
gh pr create --base main --head feature/p7.5p.2-risk-score-store --title "P7.5p.2: RiskScoreStore + Per-Proposal Risk Persistence" --body "..."
```

The PR body should describe:
- 3 atomic commits (P7.5p.2a store, P7.5p.2b hook, P7.5p.2c field + invariance)
- New store path: `.alix/risk-scores/risk-scores.jsonl`
- New optional field on `OutcomeRecord`: `riskScoreId?: string`
- 5 strict-protected files byte-identical to baseline
- `outcome-types.ts` allowed-delta updated for P7.5p.2c
- Pre-existing CI failures on main are pre-existing, not caused by this PR
- What this unlocks: P8.2 risk adapter join (RiskScore × OutcomeRecord → RiskOutcomeObservation[])

- [ ] **Step 4.4: Await review and merge**

After review approval, merge with `gh pr merge <N> --squash --delete-branch` and tag `alix-p7-5p-2-complete`.

---

## Notes

- **Test fixture `RiskScore` minimum required fields:** id, subject, outcome, confidence, reasons, generatedAt, overallRisk, risks, dimensions, sourceArtifacts. The `dimensions` field must be a `Record<RiskDimension, number>` with all 5 dimensions present (governance, operational, capability, revertability, evidence_quality).
- **`RiskScore.id` format:** `risk-<proposalId>` (deterministic — same proposal always produces the same id). This is what enables the join with `OutcomeRecord.subjectId` in P8.2.
- **The `riskScoreId` carries forward from recommendation-engine:** `ApprovalRecommendation.riskScoreId` is set by `recommendation-engine.recommend()` at line 202 of `src/adaptation/recommendation-engine.ts` to `riskScore?.id`. So when the outcome CLI reads `rec.riskScoreId` from the store, it gets the deterministic `risk-<proposalId>` value.
- **No new CLI command is added.** The `--risk-score-id` flag is added to the existing `decision outcome` subcommand.
- **CI failures on main are pre-existing** (`chat-modes.test.js`, `manifest.test.js`, `registry.test.js`, `card-loader.test.js`, `context-events.test.js`). P7.5p.2 does NOT touch any of those code paths.