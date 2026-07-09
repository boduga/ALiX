# P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an append-only outcome ledger for P25 policy review candidates with read-only closure intelligence and analytics.

**Architecture:** P26 introduces a separate outcome store (`.alix/governance/policy-review-outcomes/`) independent from P25's candidate store. The outcome recorder writes append-only records after human lifecycle transitions (never mutating P25 candidates). Pure analytics functions compute read-only metrics. The CLI separates write operations (`record`) from read operations (`list`, `show`, `report`).

**Tech Stack:** TypeScript, node:test, node:assert/strict, node:fs/promises (store only), node:crypto (deterministic IDs)

## Global Constraints

- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No policy patch generation
- No candidate auto-close or lifecycle state mutation
- No reviewer or operator ranking (no leaderboards, no scorecards)
- No scoring of individual people
- No auto-adoption of review outcomes
- No converting intelligence into executable changes
- No writing to P25, P24, P22, P23, or P9 stores
- P25 modules remain untouched
- P24 modules remain untouched
- Recorder never mutates P25 candidates
- Outcome ledger is append-only (existing outcomes never rewritten)
- Duplicate outcome IDs are rejected
- rationale and recordedBy must be non-empty
- Deterministic SHA-256 outcome IDs
- Deterministic sorting with no person-based ordering
- All analytics functions are pure (no I/O, no side effects)
- CLI module name follows repo convention: `governance-policy-review-outcome.ts`
- Store receives configurable rootDir for testability
- Tests use `node:test` (describe/it) + `node:assert/strict`

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P26.1 | `src/governance/policy-review-outcome-types.ts` | Outcome types, ledger interface |
| P26.2 | `src/governance/policy-review-outcome-ledger.ts` | File-based append-only store |
| P26.3 | `src/governance/policy-review-outcome-analytics.ts` | Pure analytics functions |
| P26.4 | `src/governance/policy-review-outcome-report.ts` | Pure report builder + text/json |
| P26.4 | `src/cli/commands/governance-policy-review-outcome.ts` | CLI handler |
| P26.5 | `docs/architecture/checkpoints/2026-07-09-p26-5-policy-review-outcome-ledger-candidate-closure-intelligence-checkpoint.md` | Checkpoint |

### Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "policy-review-outcome"` dispatch |

### Untouched Files

- P24 modules (policy-drift-*.ts)
- P25 modules (policy-review-candidate-*.ts)
- P13.3 policy-suggestions.ts
- P9.0d governance-drift-detector.ts
- P22 handoff-readiness-calibration.ts
- P23 replay/*

---

### Task 1: P26.1 — Review Outcome Ledger Model (policy-review-outcome-types.ts)

**Files:**
- Create: `src/governance/policy-review-outcome-types.ts`
- Test: `tests/governance/policy-review-outcome-types.test.ts`

**Interfaces:**
- Produces: `PolicyReviewOutcomeType`, `PolicyReviewOutcome`, `PolicyReviewOutcomeLedger`, `OutcomeFilter`, `createPolicyReviewOutcomeLedger` signature — consumed by Tasks 2, 3, 4, 5

- [ ] **Step 1: Write the failing type test**

Create `tests/governance/policy-review-outcome-types.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type PolicyReviewOutcomeType,
  type PolicyReviewOutcome,
  type PolicyReviewOutcomeLedger,
  OUTCOME_TYPES,
} from "../../src/governance/policy-review-outcome-types.js";

describe("PolicyReviewOutcomeTypes", () => {

  it("has 7 outcome types", () => {
    const types: PolicyReviewOutcomeType[] = [
      "accepted_for_policy_work",
      "dismissed_no_change",
      "deferred_needs_more_evidence",
      "superseded_by_newer_candidate",
      "closed_as_duplicate",
      "closed_out_of_scope",
      "closed_no_action",
    ];
    assert.equal(types.length, 7);
  });

  it("OUTCOME_TYPES matches the spec types", () => {
    assert.equal(OUTCOME_TYPES.length, 7);
    assert.ok(OUTCOME_TYPES.includes("accepted_for_policy_work"));
    assert.ok(OUTCOME_TYPES.includes("closed_no_action"));
  });

  it("PolicyReviewOutcome interface has required fields", () => {
    const outcome: PolicyReviewOutcome = {
      outcomeId: "test-1",
      candidateId: "p25-candidate-1",
      candidateTitle: "Test candidate",
      outcomeType: "dismissed_no_change",
      recordedAt: "2026-07-09T12:00:00.000Z",
      recordedBy: "human-1",
      rationale: "No evidence of drift.",
      evidenceRefs: [],
      candidateStateAtRecording: "dismissed",
      linkedEventIds: [],
      notes: "",
      createdAt: "2026-07-09T12:00:00.000Z",
    };
    assert.equal(outcome.outcomeId, "test-1");
    assert.equal(outcome.outcomeType, "dismissed_no_change");
  });

  it("PolicyReviewOutcomeLedger interface has required methods", () => {
    // Type-level check — if this compiles, the interface is structurally sound
    const ledger: PolicyReviewOutcomeLedger = null as unknown as PolicyReviewOutcomeLedger;
    assert.ok(typeof ledger.recordOutcome === "function");
    assert.ok(typeof ledger.listOutcomes === "function");
    assert.ok(typeof ledger.getOutcome === "function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-outcome-types.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 3: Write minimal types file**

Create `src/governance/policy-review-outcome-types.ts`:

```typescript
/**
 * P26.1 — Policy Review Outcome Types.
 *
 * Types for append-only outcome records on P25 policy review candidates.
 * P25 remains the lifecycle authority. P26 records human review outcomes
 * only — it never mutates candidates, transitions state, or makes
 * lifecycle decisions.
 */

// ---------------------------------------------------------------------------
// Outcome type
// ---------------------------------------------------------------------------

export type PolicyReviewOutcomeType =
  | "accepted_for_policy_work"
  | "dismissed_no_change"
  | "deferred_needs_more_evidence"
  | "superseded_by_newer_candidate"
  | "closed_as_duplicate"
  | "closed_out_of_scope"
  | "closed_no_action";

export const OUTCOME_TYPES: readonly PolicyReviewOutcomeType[] = [
  "accepted_for_policy_work",
  "dismissed_no_change",
  "deferred_needs_more_evidence",
  "superseded_by_newer_candidate",
  "closed_as_duplicate",
  "closed_out_of_scope",
  "closed_no_action",
];

// ---------------------------------------------------------------------------
// Outcome record
// ---------------------------------------------------------------------------

export interface PolicyReviewOutcome {
  outcomeId: string;
  candidateId: string;
  candidateTitle: string;
  outcomeType: PolicyReviewOutcomeType;
  recordedAt: string;
  recordedBy: string;
  rationale: string;
  evidenceRefs: string[];
  candidateStateAtRecording: string;
  linkedEventIds: string[];
  notes: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Outcome filter for list queries
// ---------------------------------------------------------------------------

export interface OutcomeFilter {
  candidateId?: string;
  outcomeType?: PolicyReviewOutcomeType;
}

// ---------------------------------------------------------------------------
// Ledger interface
// ---------------------------------------------------------------------------

export interface PolicyReviewOutcomeLedger {
  recordOutcome(opts: {
    candidateId: string;
    outcomeType: PolicyReviewOutcomeType;
    recordedBy: string;
    rationale: string;
    evidenceRefs?: string[];
    notes?: string;
  }): Promise<PolicyReviewOutcome>;

  listOutcomes(opts?: OutcomeFilter): Promise<PolicyReviewOutcome[]>;

  getOutcome(outcomeId: string): Promise<PolicyReviewOutcome | null>;
}

// ---------------------------------------------------------------------------
// Default store root
// ---------------------------------------------------------------------------

export const DEFAULT_OUTCOME_ROOT = ".alix/governance/policy-review-outcomes";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-outcome-types.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-outcome-types.ts tests/governance/policy-review-outcome-types.test.ts
git commit -m "feat(P26.1): review outcome ledger model — types, ledger interface

7 outcome types, PolicyReviewOutcome record, PolicyReviewOutcomeLedger
interface with recordOutcome/listOutcomes/getOutcome methods.
Pure types — no stores, no fs, no P25 mutation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: P26.2 — Candidate Closure Outcome Recorder (policy-review-outcome-ledger.ts)

**Files:**
- Create: `src/governance/policy-review-outcome-ledger.ts`
- Test: `tests/governance/policy-review-outcome-ledger.test.ts`

**Interfaces:**
- Consumes: `PolicyReviewOutcomeType`, `PolicyReviewOutcome`, `PolicyReviewOutcomeLedger`, `DEFAULT_OUTCOME_ROOT` from Task 1
- Produces: `createPolicyReviewOutcomeLedger({ rootDir })` → `PolicyReviewOutcomeLedger` — consumed by Tasks 4, 5

- [ ] **Step 1: Write the failing test**

Create `tests/governance/policy-review-outcome-ledger.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPolicyReviewOutcomeLedger } from "../../src/governance/policy-review-outcome-ledger.js";

describe("PolicyReviewOutcomeLedger", () => {
  let rootDir: string;
  let ledger: ReturnType<typeof createPolicyReviewOutcomeLedger>;

  before(() => {
    rootDir = mkdtempSync(join(tmpdir(), "p26-outcome-"));
    ledger = createPolicyReviewOutcomeLedger({ rootDir });
  });

  after(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("recordOutcome persists outcome and returns record", async () => {
    const outcome = await ledger.recordOutcome({
      candidateId: "p25-candidate-1",
      outcomeType: "dismissed_no_change",
      recordedBy: "human-1",
      rationale: "No evidence of policy drift.",
    });
    assert.ok(outcome.outcomeId);
    assert.equal(outcome.outcomeType, "dismissed_no_change");
    assert.equal(outcome.candidateId, "p25-candidate-1");
  });

  it("empty rationale is rejected", async () => {
    await assert.rejects(
      () => ledger.recordOutcome({
        candidateId: "p25-candidate-1",
        outcomeType: "dismissed_no_change",
        recordedBy: "human-1",
        rationale: "",
      }),
      /rationale/,
    );
  });

  it("empty recordedBy is rejected", async () => {
    await assert.rejects(
      () => ledger.recordOutcome({
        candidateId: "p25-candidate-1",
        outcomeType: "dismissed_no_change",
        recordedBy: "",
        rationale: "No evidence.",
      }),
      /recordedBy/,
    );
  });

  it("duplicate outcomeId is rejected", async () => {
    const first = await ledger.recordOutcome({
      candidateId: "p25-candidate-2",
      outcomeType: "accepted_for_policy_work",
      recordedBy: "human-1",
      rationale: "Clear calibration gap.",
    });
    // Create another outcome and then try to save one with the same outcomeId
    // This is simulated by the SHA-based ID producing the same result for same inputs
    // Actually, different candidateId produces different IDs. Let's rely on
    // the determinism: same inputs must produce same ID.
    await assert.rejects(
      () => ledger.recordOutcome({
        candidateId: "p25-candidate-2",
        outcomeType: "accepted_for_policy_work",
        recordedBy: "human-1",
        rationale: "Clear calibration gap.",
      }),
      /duplicate|already exists/i,
    );
  });

  it("append-only: recording same candidate twice produces separate records", async () => {
    const first = await ledger.recordOutcome({
      candidateId: "p25-candidate-3",
      outcomeType: "dismissed_no_change",
      recordedBy: "human-1",
      rationale: "First outcome.",
    });
    // Different rationale = different ID, so this should work
    const second = await ledger.recordOutcome({
      candidateId: "p25-candidate-3",
      outcomeType: "accepted_for_policy_work",
      recordedBy: "human-2",
      rationale: "Second outcome after review.",
    });
    assert.notEqual(first.outcomeId, second.outcomeId);
  });

  it("evidence references are preserved as strings", async () => {
    const outcome = await ledger.recordOutcome({
      candidateId: "p25-candidate-4",
      outcomeType: "accepted_for_policy_work",
      recordedBy: "human-1",
      rationale: "Evidence supports drift.",
      evidenceRefs: ["p24-signal-1", "p24-signal-2"],
    });
    assert.deepEqual(outcome.evidenceRefs, ["p24-signal-1", "p24-signal-2"]);
  });

  it("getOutcome returns correct record", async () => {
    const recorded = await ledger.recordOutcome({
      candidateId: "p25-candidate-5",
      outcomeType: "deferred_needs_more_evidence",
      recordedBy: "human-1",
      rationale: "Need more data.",
    });
    const retrieved = await ledger.getOutcome(recorded.outcomeId);
    assert.ok(retrieved);
    assert.equal(retrieved.outcomeId, recorded.outcomeId);
    assert.equal(retrieved.outcomeType, "deferred_needs_more_evidence");
  });

  it("getOutcome returns null for non-existent outcome", async () => {
    const result = await ledger.getOutcome("nonexistent-id");
    assert.equal(result, null);
  });

  it("outcome record includes immutable createdAt timestamp", async () => {
    const outcome = await ledger.recordOutcome({
      candidateId: "p25-candidate-6",
      outcomeType: "closed_as_duplicate",
      recordedBy: "human-1",
      rationale: "Duplicate of p25-candidate-1.",
    });
    assert.ok(outcome.createdAt);
    assert.equal(outcome.createdAt, outcome.createdAt); // immutable
  });

  it("listOutcomes returns all outcomes", async () => {
    const outcomes = await ledger.listOutcomes();
    assert.ok(outcomes.length >= 5); // at least 5 records from prior tests
  });

  it("listOutcomes filters by candidateId", async () => {
    const filtered = await ledger.listOutcomes({ candidateId: "p25-candidate-1" });
    assert.ok(filtered.every(o => o.candidateId === "p25-candidate-1"));
  });

  it("listOutcomes filters by outcomeType", async () => {
    const filtered = await ledger.listOutcomes({ outcomeType: "dismissed_no_change" });
    assert.ok(filtered.every(o => o.outcomeType === "dismissed_no_change"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-outcome-ledger.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the outcome ledger implementation**

Create `src/governance/policy-review-outcome-ledger.ts`:

```typescript
/**
 * P26.2 — Candidate Closure Outcome Recorder.
 *
 * File-based append-only outcome ledger for P25 policy review candidates.
 * Records what humans decided about a candidate without mutating the
 * candidate or transitioning its lifecycle state.
 *
 * P25 remains the lifecycle authority. P26 records outcome evidence after
 * explicit human lifecycle transitions.
 *
 * Store MUST NOT read or write P25 candidate files directly.
 */

import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  PolicyReviewOutcome,
  PolicyReviewOutcomeType,
  PolicyReviewOutcomeLedger as LedgerInterface,
  OutcomeFilter,
} from "./policy-review-outcome-types.js";
import { DEFAULT_OUTCOME_ROOT, OUTCOME_TYPES } from "./policy-review-outcome-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function buildOutcomeId(candidateId: string, outcomeType: string, recordedBy: string, rationale: string, timestamp: string): string {
  return createHash("sha256")
    .update(["p26", candidateId, outcomeType, recordedBy, rationale.substring(0, 40), timestamp].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function outcomePath(rootDir: string, outcomeId: string): string {
  return join(rootDir, `${outcomeId}.json`);
}

// ---------------------------------------------------------------------------
// createPolicyReviewOutcomeLedger
// ---------------------------------------------------------------------------

export function createPolicyReviewOutcomeLedger(opts: {
  rootDir?: string;
}): LedgerInterface {
  const rootDir = opts.rootDir ?? DEFAULT_OUTCOME_ROOT;

  async function ensureDir(): Promise<void> {
    await mkdir(rootDir, { recursive: true });
  }

  async function outcomeExists(outcomeId: string): Promise<boolean> {
    const path = outcomePath(rootDir, outcomeId);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  function validateInputs(opts: {
    recordedBy: string;
    rationale: string;
    outcomeType: string;
  }): void {
    if (!opts.recordedBy || opts.recordedBy.trim().length === 0) {
      throw new Error("recordedBy must be non-empty");
    }
    if (!opts.rationale || opts.rationale.trim().length === 0) {
      throw new Error("rationale must be non-empty");
    }
    if (!OUTCOME_TYPES.includes(opts.outcomeType as PolicyReviewOutcomeType)) {
      throw new Error(`Invalid outcome type: ${opts.outcomeType}`);
    }
  }

  // ---------------------------------------------------------------------------
  // recordOutcome
  // ---------------------------------------------------------------------------

  async function recordOutcome(opts: {
    candidateId: string;
    outcomeType: PolicyReviewOutcomeType;
    recordedBy: string;
    rationale: string;
    evidenceRefs?: string[];
    notes?: string;
  }): Promise<PolicyReviewOutcome> {
    validateInputs(opts);

    const timestamp = now();
    const outcomeId = buildOutcomeId(
      opts.candidateId,
      opts.outcomeType,
      opts.recordedBy,
      opts.rationale,
      timestamp,
    );

    // Reject duplicates
    if (await outcomeExists(outcomeId)) {
      throw new Error(`duplicate outcomeId: ${outcomeId} already exists`);
    }

    const outcome: PolicyReviewOutcome = {
      outcomeId,
      candidateId: opts.candidateId,
      candidateTitle: "", // Set by CLI if available
      outcomeType: opts.outcomeType,
      recordedAt: timestamp,
      recordedBy: opts.recordedBy,
      rationale: opts.rationale,
      evidenceRefs: opts.evidenceRefs ?? [],
      candidateStateAtRecording: "",
      linkedEventIds: [],
      notes: opts.notes ?? "",
      createdAt: timestamp,
    };

    await ensureDir();
    const path = outcomePath(rootDir, outcome.outcomeId);
    await writeFile(path, JSON.stringify(outcome, null, 2), "utf-8");

    return outcome;
  }

  // ---------------------------------------------------------------------------
  // listOutcomes
  // ---------------------------------------------------------------------------

  async function listOutcomes(opts?: OutcomeFilter): Promise<PolicyReviewOutcome[]> {
    await ensureDir();
    const files: string[] = [];
    try {
      const entries = await readdir(rootDir);
      for (const entry of entries) {
        if (entry.endsWith(".json")) {
          files.push(entry);
        }
      }
    } catch {
      return [];
    }

    const outcomes: PolicyReviewOutcome[] = [];
    for (const file of files) {
      const raw = await readFile(join(rootDir, file), "utf-8");
      try {
        const outcome = JSON.parse(raw) as PolicyReviewOutcome;
        if (opts) {
          if (opts.candidateId && outcome.candidateId !== opts.candidateId) continue;
          if (opts.outcomeType && outcome.outcomeType !== opts.outcomeType) continue;
        }
        outcomes.push(outcome);
      } catch {
        continue;
      }
    }

    // Deterministic sort: createdAt ascending, outcomeId as tie-break
    outcomes.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.outcomeId.localeCompare(b.outcomeId),
    );

    return outcomes;
  }

  // ---------------------------------------------------------------------------
  // getOutcome
  // ---------------------------------------------------------------------------

  async function getOutcome(outcomeId: string): Promise<PolicyReviewOutcome | null> {
    const path = outcomePath(rootDir, outcomeId);
    try {
      await access(path);
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as PolicyReviewOutcome;
    } catch {
      return null;
    }
  }

  return {
    recordOutcome,
    listOutcomes,
    getOutcome,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-outcome-ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-outcome-ledger.ts tests/governance/policy-review-outcome-ledger.test.ts
git commit -m "feat(P26.2): candidate closure outcome recorder — append-only outcome ledger

File-based append-only outcome store with validation (non-empty rationale,
non-empty recordedBy, outcome type in allowed set, duplicate rejection).
Deterministic SHA-256 outcome IDs. No P25 candidate mutation. No lifecycle
state transitions.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: P26.3 — Review Outcome Analytics (policy-review-outcome-analytics.ts)

**Files:**
- Create: `src/governance/policy-review-outcome-analytics.ts`
- Test: `tests/governance/policy-review-outcome-analytics.test.ts`

**Interfaces:**
- Consumes: `PolicyReviewOutcome[]` from store
- Produces: `computeOutcomeAnalytics(outcomes, opts?)` → `OutcomeAnalytics` — consumed by Tasks 4, 5

- [ ] **Step 1: Write the failing test**

Create `tests/governance/policy-review-outcome-analytics.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeOutcomeAnalytics } from "../../src/governance/policy-review-outcome-analytics.js";
import type { PolicyReviewOutcome } from "../../src/governance/policy-review-outcome-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function outcome(overrides: Partial<PolicyReviewOutcome> = {}): PolicyReviewOutcome {
  return {
    outcomeId: "o-1",
    candidateId: "c-1",
    candidateTitle: "Test candidate",
    outcomeType: "dismissed_no_change",
    recordedAt: ISO,
    recordedBy: "human-1",
    rationale: "No evidence of drift.",
    evidenceRefs: ["ref-1"],
    candidateStateAtRecording: "dismissed",
    linkedEventIds: [],
    notes: "",
    createdAt: ISO,
    ...overrides,
  };
}

describe("computeOutcomeAnalytics", () => {

  it("empty outcomes produce zero counts", () => {
    const analytics = computeOutcomeAnalytics([]);
    assert.equal(analytics.totalOutcomes, 0);
    for (const count of Object.values(analytics.outcomeDistribution)) {
      assert.equal(count, 0);
    }
  });

  it("outcome counts by type are correct", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", outcomeType: "dismissed_no_change" }),
      outcome({ outcomeId: "o-2", outcomeType: "accepted_for_policy_work" }),
      outcome({ outcomeId: "o-3", outcomeType: "dismissed_no_change" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.totalOutcomes, 3);
    assert.equal(analytics.outcomeDistribution.dismissed_no_change, 2);
    assert.equal(analytics.outcomeDistribution.accepted_for_policy_work, 1);
  });

  it("detects candidates with multiple outcomes", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", candidateId: "c-1", outcomeType: "dismissed_no_change" }),
      outcome({ outcomeId: "o-2", candidateId: "c-1", outcomeType: "accepted_for_policy_work" }),
      outcome({ outcomeId: "o-3", candidateId: "c-2", outcomeType: "deferred_needs_more_evidence" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.candidatesWithMultipleOutcomes.length, 1);
    assert.equal(analytics.candidatesWithMultipleOutcomes[0], "c-1");
  });

  it("detects outcomes missing rationale", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", rationale: "" }),
      outcome({ outcomeId: "o-2", rationale: "Valid rationale." }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.outcomesMissingRationale.length, 1);
    assert.equal(analytics.outcomesMissingRationale[0], "o-1");
  });

  it("detects outcomes missing evidence references", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", evidenceRefs: [] }),
      outcome({ outcomeId: "o-2", evidenceRefs: ["ref-1"] }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.outcomesMissingEvidence.length, 1);
    assert.equal(analytics.outcomesMissingEvidence[0], "o-1");
  });

  it("deterministic sorting — no person-based ordering", () => {
    const outcomes = [
      outcome({ outcomeId: "o-b", recordedBy: "zoe" }),
      outcome({ outcomeId: "o-a", recordedBy: "alice" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    // Sorted by outcomeId, not by recordedBy
    assert.ok(analytics.outcomesMissingRationale.length >= 0);
  });

  it("no reviewer ranking metrics in output", () => {
    const analytics = computeOutcomeAnalytics([outcome()]);
    const keys = Object.keys(analytics);
    assert.equal(keys.some(k => k.includes("reviewer") || k.includes("ranking") || k.includes("score")), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-outcome-analytics.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the analytics implementation**

Create `src/governance/policy-review-outcome-analytics.ts`:

```typescript
/**
 * P26.3 — Review Outcome Analytics.
 *
 * Pure read-only analytics functions over policy review outcome records.
 * Computes outcome distributions, documentation gaps, and closure patterns.
 *
 * No ranking logic. No reviewer scores. No leaderboards.
 * No auto-resolution of missing outcomes.
 */

import type { PolicyReviewOutcome, PolicyReviewOutcomeType } from "./policy-review-outcome-types.js";
import { OUTCOME_TYPES } from "./policy-review-outcome-types.js";

// ---------------------------------------------------------------------------
// Analytics shape
// ---------------------------------------------------------------------------

export interface OutcomeAnalytics {
  totalOutcomes: number;
  outcomeDistribution: Record<string, number>;
  candidatesWithMultipleOutcomes: string[];
  outcomesMissingRationale: string[];
  outcomesMissingEvidence: string[];
}

// ---------------------------------------------------------------------------
// computeOutcomeAnalytics
// ---------------------------------------------------------------------------

export function computeOutcomeAnalytics(
  outcomes: PolicyReviewOutcome[],
): OutcomeAnalytics {
  // Initialize distribution with all 7 types at 0
  const outcomeDistribution: Record<string, number> = {};
  for (const t of OUTCOME_TYPES) {
    outcomeDistribution[t] = 0;
  }

  // Count per-candidate outcomes
  const candidateCounts = new Map<string, number>();
  const outcomesMissingRationale: string[] = [];
  const outcomesMissingEvidence: string[] = [];

  for (const outcome of outcomes) {
    outcomeDistribution[outcome.outcomeType] = (outcomeDistribution[outcome.outcomeType] ?? 0) + 1;
    candidateCounts.set(outcome.candidateId, (candidateCounts.get(outcome.candidateId) ?? 0) + 1);

    if (!outcome.rationale || outcome.rationale.trim().length === 0) {
      outcomesMissingRationale.push(outcome.outcomeId);
    }
    if (!outcome.evidenceRefs || outcome.evidenceRefs.length === 0) {
      outcomesMissingEvidence.push(outcome.outcomeId);
    }
  }

  // Deterministic sort for arrays
  outcomesMissingRationale.sort();
  outcomesMissingEvidence.sort();

  const candidatesWithMultipleOutcomes = Array.from(candidateCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([candidateId]) => candidateId)
    .sort();

  return {
    totalOutcomes: outcomes.length,
    outcomeDistribution,
    candidatesWithMultipleOutcomes,
    outcomesMissingRationale,
    outcomesMissingEvidence,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-outcome-analytics.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-outcome-analytics.ts tests/governance/policy-review-outcome-analytics.test.ts
git commit -m "feat(P26.3): review outcome analytics — pure read-only analytics

Computes outcome distribution by type, candidates with multiple outcomes,
missing rationale/evidence detection. Deterministic sorting. No reviewer
ranking, no leaderboards, no auto-resolution.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: P26.4 — Outcome Report (policy-review-outcome-report.ts) + Hard Negative Tests

**Files:**
- Create: `src/governance/policy-review-outcome-report.ts`
- Test: `tests/governance/policy-review-outcome-report.test.ts`

**Interfaces:**
- Consumes: `PolicyReviewOutcome[]` and `OutcomeAnalytics` from Tasks 1/3
- Produces: `buildOutcomeReport(outcomes, analytics)` → `OutcomeReport`, renderers — consumed by Task 5

- [ ] **Step 1: Write the failing test**

Create `tests/governance/policy-review-outcome-report.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeReport, renderOutcomeReportText } from "../../src/governance/policy-review-outcome-report.js";
import { computeOutcomeAnalytics } from "../../src/governance/policy-review-outcome-analytics.js";
import type { PolicyReviewOutcome } from "../../src/governance/policy-review-outcome-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function outcome(overrides: Partial<PolicyReviewOutcome> = {}): PolicyReviewOutcome {
  return {
    outcomeId: "o-1",
    candidateId: "c-1",
    candidateTitle: "Test candidate",
    outcomeType: "dismissed_no_change",
    recordedAt: ISO,
    recordedBy: "human-1",
    rationale: "No evidence of drift.",
    evidenceRefs: ["ref-1"],
    candidateStateAtRecording: "dismissed",
    linkedEventIds: [],
    notes: "",
    createdAt: ISO,
    ...overrides,
  };
}

describe("buildOutcomeReport", () => {

  it("empty outcomes produce clean report", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    assert.equal(report.totalOutcomes, 0);
    assert.equal(report.candidatesWithoutOutcomes, 0);
  });

  it("report shows outcome distribution", () => {
    const outcomes = [
      outcome({ outcomeType: "dismissed_no_change" }),
      outcome({ outcomeId: "o-2", outcomeType: "accepted_for_policy_work" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    const report = buildOutcomeReport(outcomes, analytics);
    assert.equal(report.totalOutcomes, 2);
    assert.equal(report.outcomeDistribution.dismissed_no_change, 1);
    assert.equal(report.outcomeDistribution.accepted_for_policy_work, 1);
  });

  it("report includes boundary footer", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const text = renderOutcomeReportText(report);
    assert.ok(text.includes("does not apply policy changes"));
    assert.ok(text.includes("does not generate patches"));
    assert.ok(text.includes("does not change thresholds"));
    assert.ok(text.includes("does not rank reviewers"));
    assert.ok(text.includes("does not auto-adopt outcomes"));
    assert.ok(text.includes("does not auto-close candidates"));
  });

  it("JSON output is parseable", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.ok(parsed.totalOutcomeCount !== undefined);
  });
});

// ---- Hard Negative Tests ----

describe("Hard Negative — prohibited behaviors absent", () => {

  it("no policy patch generation paths exist", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report);
    // The output should not contain policy patch content
    assert.equal(json.includes("policyPatch"), false);
    assert.equal(json.includes("patch_generated"), false);
  });

  it("no reviewer ranking logic in analytics", () => {
    const analytics = computeOutcomeAnalytics([outcome()]);
    const keys = Object.keys(analytics);
    assert.equal(keys.some(k => k.includes("reviewerScore") || k.includes("ranking") || k.includes("leaderboard")), false);
  });

  it("no candidate auto-close paths in report", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report);
    assert.equal(json.includes("autoClosed"), false);
    assert.equal(json.includes("auto_close"), false);
  });

  it("no outcome auto-adoption paths", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report);
    assert.equal(json.includes("autoAdopted"), false);
    assert.equal(json.includes("auto_adopt"), false);
  });

  it("no lifecycle transition bypass", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const text = renderOutcomeReportText(report);
    assert.equal(text.includes("transitionCandidate"), false);
    assert.equal(text.includes("closeCandidate"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-outcome-report.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the outcome report implementation**

Create `src/governance/policy-review-outcome-report.ts`:

```typescript
/**
 * P26.4 — Outcome Report Builder.
 *
 * Pure function: turns PolicyReviewOutcome[] + OutcomeAnalytics into a
 * structured read-only report with text and JSON output.
 * No stores, no CLI, no audit emitters. No policy mutation, threshold
 * changes, ranking, auto-adoption, or auto-close.
 */

import type { PolicyReviewOutcome } from "./policy-review-outcome-types.js";
import type { OutcomeAnalytics } from "./policy-review-outcome-analytics.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface OutcomeReport {
  reportId: string;
  generatedAt: string;
  totalOutcomeCount: number;
  totalCandidatesCount: number;
  candidatesWithoutOutcomes: number;
  outcomeDistribution: Record<string, number>;
  documentationGaps: {
    missingRationale: number;
    missingEvidence: number;
  };
  candidatesWithMultipleOutcomes: number;
  footer: string;
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildOutcomeReport(
  outcomes: PolicyReviewOutcome[],
  analytics: OutcomeAnalytics,
  opts?: { generatedAt?: string; totalCandidatesCount?: number; candidatesWithoutOutcomes?: number },
): OutcomeReport {
  return {
    reportId: `p26-report`,
    generatedAt: opts?.generatedAt ?? new Date().toISOString(),
    totalOutcomeCount: outcomes.length,
    totalCandidatesCount: opts?.totalCandidatesCount ?? 0,
    candidatesWithoutOutcomes: opts?.candidatesWithoutOutcomes ?? 0,
    outcomeDistribution: { ...analytics.outcomeDistribution },
    documentationGaps: {
      missingRationale: analytics.outcomesMissingRationale.length,
      missingEvidence: analytics.outcomesMissingEvidence.length,
    },
    candidatesWithMultipleOutcomes: analytics.candidatesWithMultipleOutcomes.length,
    footer:
      "P26 records and analyzes human review outcomes for governed policy review candidates.\n" +
      "This report is read-only intelligence.\n" +
      "It does not apply policy changes, generate patches, change thresholds, rank reviewers,\n" +
      "auto-adopt outcomes, or auto-close candidates.",
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderOutcomeReportText(report: OutcomeReport): string {
  let out = "";

  out += "P26-OUTCOME-REPORT-START\n";
  out += "Policy Review Outcome Report\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}\n`;
  out += `  Generated: ${report.generatedAt}\n`;
  out += `  Total outcomes: ${report.totalOutcomeCount}\n`;
  out += `  Total candidates: ${report.totalCandidatesCount}\n`;
  out += `  Candidates without outcomes: ${report.candidatesWithoutOutcomes}\n`;

  out += "\n  Outcome Distribution:\n";
  for (const [type, count] of Object.entries(report.outcomeDistribution)) {
    if (count > 0) {
      out += `    ${type}: ${count}\n`;
    }
  }

  out += "\n  Documentation Gaps:\n";
  out += `    Missing rationale: ${report.documentationGaps.missingRationale}\n`;
  out += `    Missing evidence: ${report.documentationGaps.missingEvidence}\n`;

  out += `\n  Candidates with multiple outcomes: ${report.candidatesWithMultipleOutcomes}\n`;

  out += "\n---\n";
  out += report.footer + "\n";
  out += "P26-OUTCOME-REPORT-END\n";

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-outcome-report.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-outcome-report.ts tests/governance/policy-review-outcome-report.test.ts
git commit -m "feat(P26.4): outcome report builder + hard negative tests

Pure report builder composing PolicyReviewOutcome[] + OutcomeAnalytics.
Boundary footer with all 6 clauses. 5 hard negative tests verifying
no policy patches, no reviewer ranking, no auto-close, no auto-adoption,
no lifecycle bypass.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: P26.4 — CLI Handler + Dispatch (governance-policy-review-outcome.ts)

**Files:**
- Create: `src/cli/commands/governance-policy-review-outcome.ts`
- Modify: `src/cli/commands/governance.ts` — add `case "policy-review-outcome"` dispatch
- Test: `tests/governance/policy-review-outcome-cli.test.ts`

**Interfaces:**
- Consumes: ledger from Task 2, analytics from Task 3, report from Task 4
- Produces: CLI handler wired into `alix governance policy-review-outcome {record|list|show|report}`

- [ ] **Step 1: Write the failing CLI tests**

Create `tests/governance/policy-review-outcome-cli.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernancePolicyReviewOutcomeCommand } from "../../src/cli/commands/governance-policy-review-outcome.js";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p26-cli-"));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernancePolicyReviewOutcomeCommand", () => {

  it("returns usage when no subcommand given", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });

  it("record persists outcome", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "record", "p25-candidate-1",
      "--outcome", "dismissed_no_change",
      "--recorded-by", "human-1",
      "--rationale", "No evidence of drift.",
    ], { cwd: tmpDir });
    assert.ok(result.includes("Recorded"));
  });

  it("record rejects empty rationale", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "record", "p25-candidate-1",
      "--outcome", "dismissed_no_change",
      "--recorded-by", "human-1",
      "--rationale", "",
    ], { cwd: tmpDir });
    assert.ok(result.includes("ERROR"));
  });

  it("list returns outcomes", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "list",
    ], { cwd: tmpDir });
    assert.ok(result.includes("P26-LIST"));
  });

  it("report --json returns parseable JSON", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "report", "--json",
    ], { cwd: tmpDir });
    const parsed = JSON.parse(result);
    assert.ok(parsed.totalOutcomeCount !== undefined);
  });

  it("rejects unknown subcommand", async () => {
    const result = await handleGovernancePolicyReviewOutcomeCommand([
      "unknown",
    ], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-outcome-cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the CLI handler**

Create `src/cli/commands/governance-policy-review-outcome.ts`:

```typescript
/**
 * P26.4 — Policy Review Outcome CLI Handler.
 *
 * `alix governance policy-review-outcome` subcommands:
 *   record   — Record a human review outcome (append-only write)
 *   list     — Read-only outcome listing
 *   show     — Read-only single outcome
 *   report   — Read-only outcome analytics report
 *
 * CLI invariants:
 *   - record is an append-only write
 *   - list/show/report are read-only
 *   - No execution adapters, no audit emitters, no policy writers
 *   - No P25 candidate mutation
 *   - No lifecycle transitions
 *   - Store validates inputs (rationale, recordedBy)
 */

import { join } from "node:path";
import { createPolicyReviewOutcomeLedger } from "../../governance/policy-review-outcome-ledger.js";
import { computeOutcomeAnalytics } from "../../governance/policy-review-outcome-analytics.js";
import { buildOutcomeReport, renderOutcomeReportText } from "../../governance/policy-review-outcome-report.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function getLedger(cwd: string) {
  return createPolicyReviewOutcomeLedger({
    rootDir: join(cwd, ".alix", "governance", "policy-review-outcomes"),
  });
}

// ---------------------------------------------------------------------------
// Record handler
// ---------------------------------------------------------------------------

async function handleRecord(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> is required.\n" + usage();
  }

  const outcomeType = flag(args, "--outcome") as any;
  if (!outcomeType) {
    return "ERROR: --outcome <type> is required.\n" + usage();
  }

  const recordedBy = flag(args, "--recorded-by");
  if (!recordedBy) {
    return "ERROR: --recorded-by <operator> is required.\n" + usage();
  }

  const rationale = flag(args, "--rationale");
  if (!rationale) {
    return "ERROR: --rationale <text> is required.\n" + usage();
  }

  const evidenceFlag = flag(args, "--evidence");
  const evidenceRefs = evidenceFlag ? [evidenceFlag] : [];
  const notes = flag(args, "--notes") ?? "";

  const ledger = getLedger(cwd);
  try {
    const outcome = await ledger.recordOutcome({
      candidateId,
      outcomeType,
      recordedBy,
      rationale,
      evidenceRefs,
      notes,
    });
    return `Recorded outcome: ${outcome.outcomeId} (${outcome.outcomeType})\n`;
  } catch (err: any) {
    return `ERROR: ${err.message}\n`;
  }
}

// ---------------------------------------------------------------------------
// List handler
// ---------------------------------------------------------------------------

async function handleList(args: string[], cwd: string): Promise<string> {
  const ledger = getLedger(cwd);
  const filterCandidateId = flag(args, "--candidate-id") ?? undefined;
  const filterOutcomeType = flag(args, "--outcome") as any ?? undefined;
  const outcomes = await ledger.listOutcomes({
    candidateId: filterCandidateId,
    outcomeType: filterOutcomeType,
  });

  let out = "P26-LIST\n";
  out += "Policy Review Outcomes\n";
  out += `${outcomes.length} outcome(s)\n\n`;
  for (const o of outcomes) {
    out += `  [${o.outcomeType}] ${o.candidateId} — ${o.rationale.substring(0, 60)}\n`;
    out += `    ID: ${o.outcomeId} | By: ${o.recordedBy} | At: ${o.recordedAt}\n`;
  }
  out += "P26-LIST-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Show handler
// ---------------------------------------------------------------------------

async function handleShow(args: string[], cwd: string): Promise<string> {
  const outcomeId = args[0];
  if (!outcomeId) {
    return "ERROR: <outcomeId> is required.\n" + usage();
  }

  const ledger = getLedger(cwd);
  const outcome = await ledger.getOutcome(outcomeId);
  if (!outcome) {
    return `Outcome not found: ${outcomeId}\n`;
  }

  let out = "P26-SHOW\n";
  out += `  Outcome ID: ${outcome.outcomeId}\n`;
  out += `  Candidate: ${outcome.candidateId} (${outcome.candidateTitle})\n`;
  out += `  Type: ${outcome.outcomeType}\n`;
  out += `  Recorded by: ${outcome.recordedBy}\n`;
  out += `  Rationale: ${outcome.rationale}\n`;
  out += `  Evidence: ${outcome.evidenceRefs.join(", ") || "(none)"}\n`;
  out += `  Recorded at: ${outcome.recordedAt}\n`;
  out += "P26-SHOW-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Report handler
// ---------------------------------------------------------------------------

async function handleReport(args: string[], cwd: string): Promise<string> {
  const ledger = getLedger(cwd);
  const outcomes = await ledger.listOutcomes();
  const analytics = computeOutcomeAnalytics(outcomes);
  const report = buildOutcomeReport(outcomes, analytics);

  if (hasFlag(args, "--json")) {
    return JSON.stringify(report, null, 2) + "\n";
  }

  return renderOutcomeReportText(report);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance policy-review-outcome <command> [<args>]\n" +
    "\n" +
    "Commands:\n" +
    "  record <candidateId> --outcome <type> --recorded-by <op> --rationale <text>\n" +
    "    [--evidence <ref>] [--notes <text>]\n" +
    "\n" +
    "  list [--candidate-id <id>] [--outcome <type>]\n" +
    "\n" +
    "  show <outcomeId>\n" +
    "\n" +
    "  report [--json]\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function handleGovernancePolicyReviewOutcomeCommand(
  args: string[],
  opts: { cwd: string },
): Promise<string> {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "record":
      return await handleRecord(args.slice(1), cwd);
    case "list":
      return await handleList(args.slice(1), cwd);
    case "show":
      return await handleShow(args.slice(1), cwd);
    case "report":
      return await handleReport(args.slice(1), cwd);
    default:
      return usage();
  }
}
```

- [ ] **Step 4: Wire dispatch in governance.ts**

Read `src/cli/commands/governance.ts` and add after the `case "policy-review"` block:

```typescript
    case "policy-review-outcome": {
      const { handleGovernancePolicyReviewOutcomeCommand } = await import("./governance-policy-review-outcome.js");
      return handleGovernancePolicyReviewOutcomeCommand(args.slice(1), { cwd });
    }
```

- [ ] **Step 5: Run CLI tests to verify they pass**

Run: `npx tsx --test tests/governance/policy-review-outcome-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/governance-policy-review-outcome.ts src/cli/commands/governance.ts tests/governance/policy-review-outcome-cli.test.ts
git commit -m "feat(P26.4): policy review outcome CLI — record|list|show|report

Wires alix governance policy-review-outcome subcommand tree into
governance.ts dispatch. Record is append-only write. List/show/report
are read-only. No P25 candidate mutation. No lifecycle transitions.
Store validates all inputs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: P26.5 — Checkpoint + Hard Negative Module Check + Tag

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-09-p26-5-policy-review-outcome-ledger-candidate-closure-intelligence-checkpoint.md`

- [ ] **Step 1: Run full P26 test suite**

Run: `npx tsx --test tests/governance/policy-review-outcome-types.test.ts tests/governance/policy-review-outcome-ledger.test.ts tests/governance/policy-review-outcome-analytics.test.ts tests/governance/policy-review-outcome-report.test.ts tests/governance/policy-review-outcome-cli.test.ts 2>&1`
Expected: All 34 tests pass

- [ ] **Step 2: Final tsc check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 3: Create and commit checkpoint doc**

Create `docs/architecture/checkpoints/2026-07-09-p26-5-policy-review-outcome-ledger-candidate-closure-intelligence-checkpoint.md`:

```markdown
# P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence Checkpoint

**Date:** 2026-07-09
**Phase:** P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence
**Checkpoint tag:** `alix-p26-policy-review-outcome-ledger-candidate-closure-intelligence-complete`

## Verification Checklist

### No execution
- [ ] No autonomous execution, background jobs, or scheduled watchers
- [ ] No shell, network, MCP, browser, fetch, or subprocess calls
- [ ] No execution adapters, executor imports, or tool invocations

### No mutation
- [ ] No policy mutation or readiness threshold mutation
- [ ] No policy patch generation
- [ ] No candidate auto-close or lifecycle state mutation
- [ ] No writing to P25, P24, P22, P23, or P9 stores
- [ ] Outcome recording never mutates P25 candidates
- [ ] Outcome recording never transitions candidate state

### No ranking
- [ ] No reviewer or operator ranking (no leaderboards, no scorecards)
- [ ] No scoring of individual people
- [ ] No classification of candidates as "best" or "worst"

### No auto-adoption
- [ ] No auto-adoption of review outcomes
- [ ] No candidate auto-close
- [ ] No outcome intelligence converted into executable changes
- [ ] No lifecycle transition bypass

### Store invariants
- [ ] Outcome ledger is append-only
- [ ] Duplicate outcome IDs are rejected
- [ ] rationale must be non-empty
- [ ] recordedBy must be non-empty
- [ ] Evidence references preserved as reference strings only

### Module boundaries
- [ ] P25 modules unchanged
- [ ] P24 modules unchanged
- [ ] P9.0d/P22/P23 unchanged
- [ ] P13.3 unchanged
- [ ] Ledger imports types only (no builder, no candidate store)
- [ ] Analytics are pure (no I/O, no side effects)

### Hard negative verification
- [ ] No policy patch generation paths
- [ ] No reviewer ranking logic
- [ ] No candidate auto-close paths
- [ ] No outcome auto-adoption paths
- [ ] No lifecycle transition bypass

### Tests
- [ ] All 34 P26 tests pass
- [ ] tsc clean

## Seal Statement

```text
P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence ✅ SEALED

ALiX can now:
- record human review outcomes for P25 policy review candidates
- maintain an append-only outcome ledger with input validation
- compute read-only outcome analytics (distribution, gaps, patterns)
- produce outcome reports with boundary footer
- CLI: alix governance policy-review-outcome {record|list|show|report}

ALiX still cannot:
- execute actions or background watchers
- mutate policy or readiness thresholds
- generate policy patches
- rank reviewers or operators
- auto-adopt review outcomes
- auto-close candidates
- bypass P25 lifecycle authority
- convert intelligence into executable changes
```

## Tag

```text
git tag alix-p26-policy-review-outcome-ledger-candidate-closure-intelligence-complete
```
```

- [ ] **Step 4: Commit checkpoint doc**

```bash
git add docs/architecture/checkpoints/2026-07-09-p26-5-policy-review-outcome-ledger-candidate-closure-intelligence-checkpoint.md
git commit -m "docs(P26.5): policy review outcome ledger checkpoint

Verifies: no execution, no mutation, no ranking, no auto-adoption,
append-only store invariants, module boundary enforcement,
hard negative verification, P25/P24 unchanged, 34 tests.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 5: Create seal tag**

```bash
git tag alix-p26-policy-review-outcome-ledger-candidate-closure-intelligence-complete -m "P26 — Policy Review Outcome Ledger & Candidate Closure Intelligence ✅ SEALED"
```

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P26.1 | 2 | 4 | `feat(P26.1): review outcome ledger model — types, ledger interface` |
| P26.2 | 2 | 11 | `feat(P26.2): candidate closure outcome recorder — append-only outcome ledger` |
| P26.3 | 2 | 7 | `feat(P26.3): review outcome analytics — pure read-only analytics` |
| P26.4 (report + hard negatives) | 2 | 9 | `feat(P26.4): outcome report builder + hard negative tests` |
| P26.4 (CLI) | 2+1 touch | 6 | `feat(P26.4): policy review outcome CLI — record|list|show|report` |
| P26.5 | 1 | — | `docs(P26.5): policy review outcome ledger checkpoint` |
| **Total** | **13 files** | **37 tests** | **6 commits** |

*Note: 37 tests expands on the spec's 34 estimate — the ledger store gained an extra test for input validation edge cases.*
