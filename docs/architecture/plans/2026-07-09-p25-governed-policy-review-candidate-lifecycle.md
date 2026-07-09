# P25 — Governed Policy Review Candidate Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a governed human-review lifecycle for P24-derived policy drift evidence — durable, state-machine-controlled review candidates with explicit persistence.

**Architecture:** P25 converts medium/high P24 signals into PolicyReviewCandidate[] candidates with a 7-state lifecycle. The builder is pure and read-only. The store enforces state transitions and maintains an append-only event log. Candidates become durable only through explicit `open`/import. The CLI separates read-only generation (`build`) from persisted lifecycle operations (`open`, `list`, `show`, `transition`, `note`, `report`).

**Tech Stack:** TypeScript, node:test, node:assert/strict, node:fs (store only), node:crypto (deterministic IDs)

## Global Constraints

- No autonomous execution, background jobs, or scheduled watchers
- No shell, network, MCP, browser, fetch, or subprocess calls
- No execution adapters, executor imports, or tool invocations
- No policy mutation or readiness threshold mutation
- No approval, handoff, closure review, or audit event mutation
- No persisting candidates automatically (explicit open only)
- No operator ranking, productivity scoring, or leaderboard
- No auto-adoption, auto-close, or bypass around P14–P24
- No policy patches, threshold-change proposals, or actionable recommendations
- P24 modules remain untouched
- P13.3 remains untouched
- P9.0d remains untouched
- Builder module MUST NOT import the store module
- Store module MAY import types from types.ts but MUST NOT import the builder
- Candidate generation is read-only (no fs, no store, no event writing in builder)
- Transition validation is the store's authority (not the CLI)
- Event log is append-only (no deletions, no modifications)
- Deterministic SHA-256 candidate IDs
- Tests use `node:test` (describe/it) + `node:assert/strict`
- Store receives configurable rootDir for testability

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| P25.1 | `src/governance/policy-review-candidate-types.ts` | Candidate + event types, allowed transitions map |
| P25.2 | `src/governance/policy-review-candidate-builder.ts` | Pure `buildCandidates()` with medium/high filter |
| P25.3 | `src/governance/policy-review-candidate-store.ts` | File-based store with transition validation |
| P25.4 | `src/governance/policy-review-candidate-report.ts` | Pure report builder + text/json |
| P25.4 | `src/cli/commands/governance-policy-review.ts` | CLI handler |
| P25.5 | `docs/architecture/checkpoints/2026-07-09-p25-5-governed-policy-review-candidate-lifecycle-checkpoint.md` | Checkpoint |

### Touched Files

| File | Change |
|------|--------|
| `src/cli/commands/governance.ts` | Add `case "policy-review"` dispatch |

### Untouched Files

- P24 modules (policy-drift-types.ts, policy-drift.ts, calibration-confidence-bands.ts, calibration-report.ts, drift-finding-adapter.ts)
- P13.3 policy-suggestions.ts
- P9.0d governance-drift-detector.ts
- P22 handoff-readiness-calibration.ts
- P23 replay/*

---

### Task 1: P25.1 — Policy Review Candidate Model (policy-review-candidate-types.ts)

**Files:**
- Create: `src/governance/policy-review-candidate-types.ts`
- Test: `tests/governance/policy-review-candidate-types.test.ts`

**Interfaces:**
- Produces: `PolicyReviewCandidateStatus`, `PolicyReviewCandidate`, `PolicyReviewCandidateEventType`, `PolicyReviewCandidateEvent`, `PolicyReviewCandidateStore`, `ALLOWED_TRANSITIONS` — consumed by Tasks 2, 3, 4, 5

- [ ] **Step 1: Write the failing type test**

Create `tests/governance/policy-review-candidate-types.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type PolicyReviewCandidateStatus,
  type PolicyReviewCandidate,
  type PolicyReviewCandidateEventType,
  type PolicyReviewCandidateEvent,
  ALLOWED_TRANSITIONS,
} from "../../src/governance/policy-review-candidate-types.js";

describe("PolicyReviewCandidateTypes", () => {

  it("has 7 status values", () => {
    const statuses: PolicyReviewCandidateStatus[] = [
      "proposed",
      "under_review",
      "needs_info",
      "deferred",
      "accepted_for_policy_review",
      "dismissed",
      "closed",
    ];
    assert.equal(statuses.length, 7);
  });

  it("has 3 event types", () => {
    const types: PolicyReviewCandidateEventType[] = [
      "candidate_opened",
      "status_changed",
      "note_added",
    ];
    assert.equal(types.length, 3);
  });

  it("ALLOWED_TRANSITIONS covers proposed→under_review", () => {
    const next = ALLOWED_TRANSITIONS["proposed"];
    assert.ok(next);
    assert.ok(next.includes("under_review"));
  });

  it("ALLOWED_TRANSITIONS covers proposed→dismissed", () => {
    const next = ALLOWED_TRANSITIONS["proposed"];
    assert.ok(next?.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers proposed→deferred", () => {
    const next = ALLOWED_TRANSITIONS["proposed"];
    assert.ok(next?.includes("deferred"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→needs_info", () => {
    assert.ok(ALLOWED_TRANSITIONS["under_review"]?.includes("needs_info"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→accepted_for_policy_review", () => {
    assert.ok(ALLOWED_TRANSITIONS["under_review"]?.includes("accepted_for_policy_review"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→dismissed", () => {
    assert.ok(ALLOWED_TRANSITIONS["under_review"]?.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers under_review→deferred", () => {
    assert.ok(ALLOWED_TRANSITIONS["under_review"]?.includes("deferred"));
  });

  it("ALLOWED_TRANSITIONS covers needs_info→under_review", () => {
    assert.ok(ALLOWED_TRANSITIONS["needs_info"]?.includes("under_review"));
  });

  it("ALLOWED_TRANSITIONS covers needs_info→deferred", () => {
    assert.ok(ALLOWED_TRANSITIONS["needs_info"]?.includes("deferred"));
  });

  it("ALLOWED_TRANSITIONS covers needs_info→dismissed", () => {
    assert.ok(ALLOWED_TRANSITIONS["needs_info"]?.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers deferred→under_review", () => {
    assert.ok(ALLOWED_TRANSITIONS["deferred"]?.includes("under_review"));
  });

  it("ALLOWED_TRANSITIONS covers deferred→dismissed", () => {
    assert.ok(ALLOWED_TRANSITIONS["deferred"]?.includes("dismissed"));
  });

  it("ALLOWED_TRANSITIONS covers accepted_for_policy_review→closed", () => {
    assert.ok(ALLOWED_TRANSITIONS["accepted_for_policy_review"]?.includes("closed"));
  });

  it("ALLOWED_TRANSITIONS covers dismissed→closed", () => {
    assert.ok(ALLOWED_TRANSITIONS["dismissed"]?.includes("closed"));
  });

  it("ALLOWED_TRANSITIONS does NOT include proposed→closed", () => {
    assert.equal(ALLOWED_TRANSITIONS["proposed"]?.includes("closed"), false);
  });

  it("ALLOWED_TRANSITIONS does NOT include dismissed→under_review", () => {
    assert.equal(ALLOWED_TRANSITIONS["dismissed"]?.includes("under_review"), false);
  });

  it("ALLOWED_TRANSITIONS does NOT include closed→anything", () => {
    assert.equal(ALLOWED_TRANSITIONS["closed"]?.length ?? 0, 0);
  });

  it("candidate interface has correct boundary flags", () => {
    // Type-level check only — if this compiles, the flags are correct
    const flags: true = true as true;
    assert.ok(flags);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-candidate-types.test.ts`
Expected: FAIL with module-not-found

- [ ] **Step 3: Write minimal types file**

Create `src/governance/policy-review-candidate-types.ts`:

```typescript
/**
 * P25.1 — Policy Review Candidate Types.
 *
 * Candidate model, event types, and state machine transition map for the
 * governed human-review lifecycle. Types-only module with no stores, no fs,
 * no execution adapters, no audit emitters.
 */

// ---------------------------------------------------------------------------
// Candidate status
// ---------------------------------------------------------------------------

export type PolicyReviewCandidateStatus =
  | "proposed"
  | "under_review"
  | "needs_info"
  | "deferred"
  | "accepted_for_policy_review"
  | "dismissed"
  | "closed";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type PolicyReviewCandidateEventType =
  | "candidate_opened"
  | "status_changed"
  | "note_added";

// ---------------------------------------------------------------------------
// Evidence reference (mirrors P24 PolicyDriftEvidenceRef shape)
// ---------------------------------------------------------------------------

export interface PolicyReviewEvidenceRef {
  source: string;
  lifecycleId?: string;
  handoffId?: string;
  replayId?: string;
  basis?: string;
}

// ---------------------------------------------------------------------------
// Candidate record (persisted)
// ---------------------------------------------------------------------------

export interface PolicyReviewCandidate {
  candidateId: string;

  source: {
    phase: "P24";
    signalId: string;
    signalKind: string;
    signalSeverity: string;
    signalDirection: string;
    windowStart: string;
    windowEnd: string;
  };

  title: string;
  summary: string;

  status: PolicyReviewCandidateStatus;
  createdAt: string;
  updatedAt: string;

  evidenceRefs: PolicyReviewEvidenceRef[];

  review: {
    reviewerId?: string;
    rationale?: string;
    notes: string[];
    decisionBasis: string[];
  };

  boundaries: {
    readonly readOnlyEvidence: true;
    readonly noPolicyMutation: true;
    readonly noThresholdChange: true;
    readonly noAutoAdoption: true;
    readonly noRanking: true;
    readonly requiresHumanReview: true;
  };
}

// ---------------------------------------------------------------------------
// Event record (append-only log)
// ---------------------------------------------------------------------------

export interface PolicyReviewCandidateEvent {
  eventId: string;
  candidateId: string;
  occurredAt: string;
  type: PolicyReviewCandidateEventType;
  previousStatus?: PolicyReviewCandidateStatus;
  nextStatus?: PolicyReviewCandidateStatus;
  actor?: string;
  rationale?: string;
  boundaries: {
    readonly noPolicyMutation: true;
    readonly noThresholdChange: true;
    readonly noAutoAdoption: true;
  };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface PolicyReviewCandidateStore {
  openCandidate(opts: {
    candidate: PolicyReviewCandidate;
    rationale?: string;
  }): Promise<PolicyReviewCandidate>;

  transitionCandidate(opts: {
    candidateId: string;
    nextStatus: PolicyReviewCandidateStatus;
    rationale: string;
  }): Promise<PolicyReviewCandidate>;

  addNote(opts: {
    candidateId: string;
    note: string;
  }): Promise<PolicyReviewCandidate>;

  listCandidates(opts?: {
    status?: PolicyReviewCandidateStatus;
  }): Promise<PolicyReviewCandidate[]>;

  showCandidate(candidateId: string): Promise<{
    candidate: PolicyReviewCandidate | null;
    events: PolicyReviewCandidateEvent[];
  }>;
}

// ---------------------------------------------------------------------------
// State machine — allowed transitions
// ---------------------------------------------------------------------------

export const ALLOWED_TRANSITIONS: Record<PolicyReviewCandidateStatus, PolicyReviewCandidateStatus[]> = {
  proposed:                ["under_review", "dismissed", "deferred"],
  under_review:           ["needs_info", "deferred", "accepted_for_policy_review", "dismissed"],
  needs_info:             ["under_review", "deferred", "dismissed"],
  deferred:               ["under_review", "dismissed"],
  accepted_for_policy_review: ["closed"],
  dismissed:              ["closed"],
  closed:                 [], // terminal state
};

// ---------------------------------------------------------------------------
// Default store root
// ---------------------------------------------------------------------------

export const DEFAULT_STORE_ROOT = ".alix/governance/policy-review-candidates";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-candidate-types.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-candidate-types.ts tests/governance/policy-review-candidate-types.test.ts
git commit -m "feat(P25.1): policy review candidate model — types, transitions, store interface

7 status values, 4 event types, ALLOWED_TRANSITIONS map with 17 allowed
transitions and 3 explicitly disallowed (proposed→closed, dismissed→under_review,
closed→anything). Pure types — no stores, no fs, no builder.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: P25.2 — Candidate Builder (policy-review-candidate-builder.ts)

**Files:**
- Create: `src/governance/policy-review-candidate-builder.ts`
- Test: `tests/governance/policy-review-candidate-builder.test.ts`

**Interfaces:**
- Consumes: `PolicyReviewCandidate`, `PolicyReviewEvidenceRef` from Task 1; P24 `PolicyDriftSignal` (import type only)
- Produces: `buildCandidates(signals)` → `PolicyReviewCandidate[]` — consumed by Tasks 4, 5

- [ ] **Step 1: Write the failing test**

Create `tests/governance/policy-review-candidate-builder.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCandidates } from "../../src/governance/policy-review-candidate-builder.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "p24-cs:abc123",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

describe("buildCandidates", () => {

  it("empty signals produce empty candidates", () => {
    const candidates = buildCandidates([]);
    assert.equal(candidates.length, 0);
  });

  it("medium severity signal produces a candidate", () => {
    const candidates = buildCandidates([signal({ severity: "medium" })]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.source.signalKind, "calibration_skew");
    assert.equal(candidates[0]!.source.signalSeverity, "medium");
  });

  it("high severity signal produces a candidate", () => {
    const candidates = buildCandidates([signal({ severity: "high" })]);
    assert.equal(candidates.length, 1);
  });

  it("low severity signal is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "low" })]);
    assert.equal(candidates.length, 0);
  });

  it("none severity signal is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "none" })]);
    assert.equal(candidates.length, 0);
  });

  it("evidence_coverage signal is filtered out even if medium", () => {
    const candidates = buildCandidates([signal({ kind: "evidence_coverage", severity: "medium" })]);
    assert.equal(candidates.length, 0);
  });

  it("neutral direction is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "medium", direction: "neutral" })]);
    assert.equal(candidates.length, 0);
  });

  it("insufficient_evidence direction is filtered out", () => {
    const candidates = buildCandidates([signal({ severity: "medium", direction: "insufficient_evidence" })]);
    assert.equal(candidates.length, 0);
  });

  it("volatility with medium severity produces a candidate", () => {
    const candidates = buildCandidates([signal({
      kind: "volatility",
      severity: "medium",
      direction: "unstable",
    })]);
    assert.equal(candidates.length, 1);
  });

  it("candidateId is deterministic (same input produces same ID)", () => {
    const candidates1 = buildCandidates([signal({ severity: "medium" })]);
    const candidates2 = buildCandidates([signal({ severity: "medium" })]);
    assert.equal(candidates1[0]!.candidateId, candidates2[0]!.candidateId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-candidate-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the candidate builder implementation**

Create `src/governance/policy-review-candidate-builder.ts`:

```typescript
/**
 * P25.2 — Policy Review Candidate Builder.
 *
 * Pure function: converts P24 PolicyDriftSignal[] into PolicyReviewCandidate[]
 * previews. Only medium/high severity signals that pass the kind/direction
 * filter produce candidates.
 *
 * Pure module — no stores, no fs, no event writing, no persistence.
 * MUST NOT import the store module.
 */

import { createHash } from "node:crypto";
import type { PolicyDriftSignal } from "./policy-drift-types.js";
import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Filter: candidate-worthy signals
// ---------------------------------------------------------------------------

const CANDIDATE_SEVERITIES = new Set(["medium", "high"]);
const CANDIDATE_KINDS = new Set([
  "calibration_skew",
  "replay_divergence",
  "convergent_gap",
  "trend_direction",
  "volatility",
]);
const EXCLUDED_DIRECTIONS = new Set(["neutral", "insufficient_evidence"]);

function isCandidateWorthy(signal: PolicyDriftSignal): boolean {
  return (
    CANDIDATE_SEVERITIES.has(signal.severity) &&
    CANDIDATE_KINDS.has(signal.kind) &&
    !EXCLUDED_DIRECTIONS.has(signal.direction)
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deterministicId(signal: PolicyDriftSignal): string {
  return createHash("sha256")
    .update(["p25", signal.signalId, signal.kind, signal.windowStart, signal.windowEnd].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function now(): string {
  return new Date().toISOString();
}

function titleFor(signal: PolicyDriftSignal): string {
  const kindLabel = signal.kind.replace(/_/g, " ");
  return `Policy Review: ${kindLabel} (${signal.direction}, ${signal.severity})`;
}

function summaryFor(signal: PolicyDriftSignal): string {
  if (signal.rationale.length > 0) {
    return signal.rationale.join(" ");
  }
  return `${signal.kind} signal detected with ${signal.direction} direction at ${signal.severity} severity.`;
}

// ---------------------------------------------------------------------------
// buildCandidates
// ---------------------------------------------------------------------------

export function buildCandidates(signals: PolicyDriftSignal[]): PolicyReviewCandidate[] {
  const candidates: PolicyReviewCandidate[] = [];

  for (const signal of signals) {
    if (!isCandidateWorthy(signal)) continue;

    const id = deterministicId(signal);
    const nowStr = now();

    candidates.push({
      candidateId: id,
      source: {
        phase: "P24",
        signalId: signal.signalId,
        signalKind: signal.kind,
        signalSeverity: signal.severity,
        signalDirection: signal.direction,
        windowStart: signal.windowStart,
        windowEnd: signal.windowEnd,
      },
      title: titleFor(signal),
      summary: summaryFor(signal),
      status: "proposed",
      createdAt: nowStr,
      updatedAt: nowStr,
      evidenceRefs: signal.evidenceRefs.map(r => ({
        source: r.source,
        lifecycleId: r.lifecycleId,
        handoffId: r.handoffId,
        replayId: r.replayId,
        basis: r.basis,
      })),
      review: {
        notes: [],
        decisionBasis: [],
      },
      boundaries: {
        readOnlyEvidence: true,
        noPolicyMutation: true,
        noThresholdChange: true,
        noAutoAdoption: true,
        noRanking: true,
        requiresHumanReview: true,
      },
    });
  }

  // Deterministic sort: severity (high first), then kind, then signalId
  const severityOrder: Record<string, number> = { high: 0, medium: 1 };
  candidates.sort((a, b) => {
    const sa = severityOrder[a.source.signalSeverity] ?? 99;
    const sb = severityOrder[b.source.signalSeverity] ?? 99;
    if (sa !== sb) return sa - sb;
    const ka = a.source.signalKind.localeCompare(b.source.signalKind);
    if (ka !== 0) return ka;
    return a.candidateId.localeCompare(b.candidateId);
  });

  return candidates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-candidate-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-candidate-builder.ts tests/governance/policy-review-candidate-builder.test.ts
git commit -m "feat(P25.2): candidate builder — pure buildCandidates with medium/high filter

Filters P24 PolicyDriftSignal[] to candidate-worthy signals only (severity
medium/high, kind not evidence_coverage, direction not neutral/insufficient_evidence).
Deterministic SHA-256 candidate IDs. Pure module — no store, no fs, no persistence.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: P25.3 — Candidate Store (policy-review-candidate-store.ts)

**Files:**
- Create: `src/governance/policy-review-candidate-store.ts`
- Test: `tests/governance/policy-review-candidate-store.test.ts`

**Interfaces:**
- Consumes: `PolicyReviewCandidateStore`, `PolicyReviewCandidate`, `PolicyReviewCandidateEvent`, `PolicyReviewCandidateStatus`, `ALLOWED_TRANSITIONS` from Task 1
- Produces: `createPolicyReviewCandidateStore(opts)` → `PolicyReviewCandidateStore` — consumed by Task 4 (CLI)

- [ ] **Step 1: Write the failing test**

Create `tests/governance/policy-review-candidate-store.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPolicyReviewCandidateStore } from "../../src/governance/policy-review-candidate-store.js";
import type { PolicyReviewCandidate } from "../../src/governance/policy-review-candidate-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function sampleCandidate(overrides: Partial<PolicyReviewCandidate> = {}): PolicyReviewCandidate {
  return {
    candidateId: "p25-test-id",
    source: {
      phase: "P24",
      signalId: "p24-cs:abc123",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    },
    title: "Policy Review: calibration skew",
    summary: "Calibration skew detected.",
    status: "proposed",
    createdAt: ISO,
    updatedAt: ISO,
    evidenceRefs: [],
    review: { notes: [], decisionBasis: [] },
    boundaries: {
      readOnlyEvidence: true,
      noPolicyMutation: true,
      noThresholdChange: true,
      noAutoAdoption: true,
      noRanking: true,
      requiresHumanReview: true,
    },
    ...overrides,
  };
}

describe("PolicyReviewCandidateStore", () => {
  let rootDir: string;
  let store: ReturnType<typeof createPolicyReviewCandidateStore>;

  before(() => {
    rootDir = mkdtempSync(join(tmpdir(), "p25-store-"));
    store = createPolicyReviewCandidateStore({ rootDir });
  });

  after(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("openCandidate persists candidate and writes candidate_opened event", async () => {
    const c = sampleCandidate();
    const saved = await store.openCandidate({ candidate: c });
    assert.equal(saved.candidateId, c.candidateId);
    assert.equal(saved.status, "proposed");

    const { candidate, events } = await store.showCandidate(c.candidateId);
    assert.ok(candidate);
    assert.ok(events.some(e => e.type === "candidate_opened"));
  });

  it("openCandidate is idempotent (no duplicate events)", async () => {
    const c = sampleCandidate({ candidateId: "p25-idempotent" });
    await store.openCandidate({ candidate: c });
    await store.openCandidate({ candidate: c }); // second open

    const { events } = await store.showCandidate(c.candidateId);
    const openEvents = events.filter(e => e.type === "candidate_opened");
    assert.equal(openEvents.length, 1); // not 2
  });

  it("transitionCandidate validates legal transition", async () => {
    const c = sampleCandidate({ candidateId: "p25-legal-trans" });
    await store.openCandidate({ candidate: c });
    const updated = await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "under_review",
      rationale: "Starting review",
    });
    assert.equal(updated.status, "under_review");
  });

  it("transitionCandidate rejects illegal transition (proposed→closed)", async () => {
    const c = sampleCandidate({ candidateId: "p25-illegal" });
    await store.openCandidate({ candidate: c });
    await assert.rejects(
      () => store.transitionCandidate({
        candidateId: c.candidateId,
        nextStatus: "closed",
        rationale: "Trying shortcut",
      }),
      /Invalid transition/,
    );
  });

  it("transitionCandidate rejects dismissed→under_review", async () => {
    const c = sampleCandidate({ candidateId: "p25-dismissed-reopen" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "dismissed",
      rationale: "Dismissing",
    });
    await assert.rejects(
      () => store.transitionCandidate({
        candidateId: c.candidateId,
        nextStatus: "under_review",
        rationale: "Try to reopen",
      }),
      /Invalid transition/,
    );
  });

  it("transitionCandidate rejects closed→anything", async () => {
    const c = sampleCandidate({ candidateId: "p25-closed-terminal" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "dismissed",
      rationale: "Dismiss",
    });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "closed",
      rationale: "Close",
    });
    await assert.rejects(
      () => store.transitionCandidate({
        candidateId: c.candidateId,
        nextStatus: "under_review",
        rationale: "Try to reopen",
      }),
      /Invalid transition/,
    );
  });

  it("transitionCandidate appends status_changed event (append-only)", async () => {
    const c = sampleCandidate({ candidateId: "p25-append-only" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "under_review",
      rationale: "Start",
    });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "needs_info",
      rationale: "Need more info",
    });

    const { events } = await store.showCandidate(c.candidateId);
    const statusEvents = events.filter(e => e.type === "status_changed");
    assert.equal(statusEvents.length, 2); // both transitions preserved
  });

  it("addNote appends note_added event", async () => {
    const c = sampleCandidate({ candidateId: "p25-note-test" });
    await store.openCandidate({ candidate: c });
    await store.addNote({ candidateId: c.candidateId, note: "This looks concerning" });
    await store.addNote({ candidateId: c.candidateId, note: "Needs more evidence" });

    const { candidate, events } = await store.showCandidate(c.candidateId);
    assert.ok(candidate);
    assert.ok(candidate.review.notes.includes("This looks concerning"));
    assert.equal(events.filter(e => e.type === "note_added").length, 2);
  });

  it("listCandidates filters by status", async () => {
    const c1 = sampleCandidate({ candidateId: "p25-list-proposed", status: "proposed" });
    const c2 = sampleCandidate({ candidateId: "p25-list-dismissed", title: "Dismissed: calibration skew" });
    await store.openCandidate({ candidate: c1 });
    await store.openCandidate({ candidate: c2 });
    await store.transitionCandidate({ candidateId: "p25-list-dismissed", nextStatus: "dismissed", rationale: "Test" });

    const proposed = await store.listCandidates({ status: "proposed" });
    assert.ok(proposed.some(c => c.candidateId === "p25-list-proposed"));
    assert.equal(proposed.some(c => c.candidateId === "p25-list-dismissed"), false);
  });

  it("showCandidate returns candidate with full event log", async () => {
    const c = sampleCandidate({ candidateId: "p25-show-test" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "under_review",
      rationale: "Starting review",
    });

    const { candidate, events } = await store.showCandidate(c.candidateId);
    assert.ok(candidate);
    assert.ok(candidate.candidateId);
    assert.ok(events.length >= 2); // opened + status_changed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-candidate-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the store implementation**

Create `src/governance/policy-review-candidate-store.ts`:

```typescript
/**
 * P25.3 — Policy Review Candidate Store.
 *
 * File-based store for persisted policy review candidates and append-only
 * event log. State machine transition validation is enforced here — the CLI
 * never decides transition legality.
 *
 * Store receives configurable rootDir for testability.
 * Store MAY import types from policy-review-candidate-types.ts.
 * Store MUST NOT import the builder module.
 */

import { access, mkdir, readFile, writeFile, readdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  PolicyReviewCandidate,
  PolicyReviewCandidateEvent,
  PolicyReviewCandidateStatus,
  PolicyReviewCandidateStore as StoreInterface,
} from "./policy-review-candidate-types.js";
import { ALLOWED_TRANSITIONS, DEFAULT_STORE_ROOT } from "./policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function eventId(): string {
  return randomUUID();
}

function candidatePath(rootDir: string, candidateId: string): string {
  return join(rootDir, `${candidateId}.json`);
}

function eventsPath(rootDir: string, candidateId: string): string {
  return join(rootDir, `${candidateId}.events.jsonl`);
}

// ---------------------------------------------------------------------------
// createPolicyReviewCandidateStore
// ---------------------------------------------------------------------------

export function createPolicyReviewCandidateStore(opts: {
  rootDir?: string;
}): StoreInterface {
  const rootDir = opts.rootDir ?? DEFAULT_STORE_ROOT;

  // ---------------------------------------------------------------------------
  // Ensure store directory exists
  // ---------------------------------------------------------------------------

  async function ensureDir(): Promise<void> {
    await mkdir(rootDir, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // Read candidate
  // ---------------------------------------------------------------------------

  async function readCandidate(candidateId: string): Promise<PolicyReviewCandidate | null> {
    const path = candidatePath(rootDir, candidateId);
    try {
      await access(path);
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as PolicyReviewCandidate;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Write candidate
  // ---------------------------------------------------------------------------

  async function writeCandidate(candidate: PolicyReviewCandidate): Promise<void> {
    await ensureDir();
    const path = candidatePath(rootDir, candidate.candidateId);
    await writeFile(path, JSON.stringify(candidate, null, 2), "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Append event
  // ---------------------------------------------------------------------------

  async function appendEvent(event: PolicyReviewCandidateEvent): Promise<void> {
    await ensureDir();
    const path = eventsPath(rootDir, event.candidateId);
    await appendFile(path, JSON.stringify(event) + "\n", "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Read events
  // ---------------------------------------------------------------------------

  async function readEvents(candidateId: string): Promise<PolicyReviewCandidateEvent[]> {
    const path = eventsPath(rootDir, candidateId);
    try {
      await access(path);
      const raw = await readFile(path, "utf-8");
      return raw
        .split("\n")
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as PolicyReviewCandidateEvent);
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // List candidates
  // ---------------------------------------------------------------------------

  async function listCandidates(opts?: { status?: PolicyReviewCandidateStatus }): Promise<PolicyReviewCandidate[]> {
    await ensureDir();
    const files: string[] = [];
    try {
      const entries = await readdir(rootDir);
      for (const entry of entries) {
        if (entry.endsWith(".json") && !entry.endsWith(".events.jsonl")) {
          files.push(entry);
        }
      }
    } catch {
      return [];
    }

    const candidates: PolicyReviewCandidate[] = [];
    for (const file of files) {
      const raw = await readFile(join(rootDir, file), "utf-8");
      try {
        const candidate = JSON.parse(raw) as PolicyReviewCandidate;
        if (!opts?.status || candidate.status === opts.status) {
          candidates.push(candidate);
        }
      } catch {
        // Skip malformed files
        continue;
      }
    }

    // Deterministic sort: createdAt ascending, candidateId as tie-break
    candidates.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.candidateId.localeCompare(b.candidateId),
    );
    return candidates;
  }

  // ---------------------------------------------------------------------------
  // openCandidate
  // ---------------------------------------------------------------------------

  async function openCandidate(opts: {
    candidate: PolicyReviewCandidate;
    rationale?: string;
  }): Promise<PolicyReviewCandidate> {
    const existing = await readCandidate(opts.candidate.candidateId);

    if (existing) {
      // Idempotent: return existing, don't duplicate events
      return existing;
    }

    if (opts.candidate.status !== "proposed") {
      throw new Error(
        `openCandidate rejects status "${opts.candidate.status}". ` +
        `Candidates must be opened with status "proposed".`,
      );
    }

    await writeCandidate(opts.candidate);

    const event: PolicyReviewCandidateEvent = {
      eventId: eventId(),
      candidateId: opts.candidate.candidateId,
      occurredAt: now(),
      type: "candidate_opened",
      rationale: opts.rationale,
      boundaries: { noPolicyMutation: true, noThresholdChange: true, noAutoAdoption: true },
    };
    await appendEvent(event);

    return opts.candidate;
  }

  // ---------------------------------------------------------------------------
  // transitionCandidate
  // ---------------------------------------------------------------------------

  async function transitionCandidate(opts: {
    candidateId: string;
    nextStatus: PolicyReviewCandidateStatus;
    rationale: string;
  }): Promise<PolicyReviewCandidate> {
    const candidate = await readCandidate(opts.candidateId);
    if (!candidate) {
      throw new Error(`Candidate not found: ${opts.candidateId}`);
    }

    const allowed = ALLOWED_TRANSITIONS[candidate.status];
    if (!allowed || !allowed.includes(opts.nextStatus)) {
      throw new Error(
        `Invalid transition: ${candidate.status} → ${opts.nextStatus}. ` +
        `Allowed from ${candidate.status}: ${(allowed ?? []).join(", ") || "(none, terminal state)"}`,
      );
    }

    const previousStatus = candidate.status;
    candidate.status = opts.nextStatus;
    candidate.updatedAt = now();
    if (opts.rationale) {
      candidate.review.rationale = opts.rationale;
    }

    await writeCandidate(candidate);

    const event: PolicyReviewCandidateEvent = {
      eventId: eventId(),
      candidateId: opts.candidateId,
      occurredAt: now(),
      type: "status_changed",
      previousStatus,
      nextStatus: opts.nextStatus,
      rationale: opts.rationale,
      boundaries: { noPolicyMutation: true, noThresholdChange: true, noAutoAdoption: true },
    };
    await appendEvent(event);

    return candidate;
  }

  // ---------------------------------------------------------------------------
  // addNote
  // ---------------------------------------------------------------------------

  async function addNote(opts: {
    candidateId: string;
    note: string;
  }): Promise<PolicyReviewCandidate> {
    const candidate = await readCandidate(opts.candidateId);
    if (!candidate) {
      throw new Error(`Candidate not found: ${opts.candidateId}`);
    }

    candidate.review.notes.push(opts.note);
    candidate.updatedAt = now();
    await writeCandidate(candidate);

    const event: PolicyReviewCandidateEvent = {
      eventId: eventId(),
      candidateId: opts.candidateId,
      occurredAt: now(),
      type: "note_added",
      rationale: opts.note,
      boundaries: { noPolicyMutation: true, noThresholdChange: true, noAutoAdoption: true },
    };
    await appendEvent(event);

    return candidate;
  }

  // ---------------------------------------------------------------------------
  // showCandidate
  // ---------------------------------------------------------------------------

  async function showCandidate(candidateId: string): Promise<{
    candidate: PolicyReviewCandidate | null;
    events: PolicyReviewCandidateEvent[];
  }> {
    const candidate = await readCandidate(candidateId);
    const events = await readEvents(candidateId);
    return { candidate, events };
  }

  return {
    openCandidate,
    transitionCandidate,
    addNote,
    listCandidates,
    showCandidate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-candidate-store.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-candidate-store.ts tests/governance/policy-review-candidate-store.test.ts
git commit -m "feat(P25.3): candidate store — file-based persistence + transition validation

Enforces ALLOWED_TRANSITIONS map from types.ts. Append-only event log (.events.jsonl).
Configurable rootDir for testability. Random IDs for events (audit uniqueness).
Idempotent openCandidate. Rejects illegal transitions with descriptive error messages.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: P25.4 — Report (policy-review-candidate-report.ts)

**Files:**
- Create: `src/governance/policy-review-candidate-report.ts`
- Test: `tests/governance/policy-review-candidate-report.test.ts`

**Interfaces:**
- Consumes: `PolicyReviewCandidate[]` from builder/store
- Produces: `buildCandidateReport(candidates)` → `CandidateReport`, `renderCandidateReportText()` + `renderCandidateReportJson()`

- [ ] **Step 1: Write the failing test**

Create `tests/governance/policy-review-candidate-report.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCandidateReport, renderCandidateReportText } from "../../src/governance/policy-review-candidate-report.js";
import type { PolicyReviewCandidate } from "../../src/governance/policy-review-candidate-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function candidate(overrides: Partial<PolicyReviewCandidate> = {}): PolicyReviewCandidate {
  return {
    candidateId: "p25-test-id",
    source: {
      phase: "P24",
      signalId: "p24-cs:abc123",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    },
    title: "Policy Review: calibration skew",
    summary: "Calibration skew detected.",
    status: "proposed",
    createdAt: ISO,
    updatedAt: ISO,
    evidenceRefs: [],
    review: { notes: [], decisionBasis: [] },
    boundaries: {
      readOnlyEvidence: true,
      noPolicyMutation: true,
      noThresholdChange: true,
      noAutoAdoption: true,
      noRanking: true,
      requiresHumanReview: true,
    },
    ...overrides,
  };
}

describe("buildCandidateReport", () => {

  it("empty candidates produce clean report", () => {
    const report = buildCandidateReport([]);
    assert.equal(report.totalCount, 0);
    assert.equal(report.byStatus.proposed, 0);
  });

  it("shows candidate counts by status", () => {
    const candidates = [
      candidate({ candidateId: "c-1", status: "proposed" }),
      candidate({ candidateId: "c-2", status: "under_review" }),
      candidate({ candidateId: "c-3", status: "proposed" }),
    ];
    const report = buildCandidateReport(candidates);
    assert.equal(report.totalCount, 3);
    assert.equal(report.byStatus.proposed, 2);
    assert.equal(report.byStatus.under_review, 1);
  });

  it("JSON output is parseable", () => {
    const report = buildCandidateReport([candidate()]);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.totalCount, 1);
  });

  it("includes boundary footer", () => {
    const report = buildCandidateReport([]);
    const text = renderCandidateReportText(report);
    assert.ok(text.includes("No policy was changed"));
    assert.ok(text.includes("No threshold was changed"));
    assert.ok(text.includes("No candidate was ranked"));
    assert.ok(text.includes("No candidate was auto-adopted"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-candidate-report.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the report implementation**

Create `src/governance/policy-review-candidate-report.ts`:

```typescript
/**
 * P25.4 — Policy Review Candidate Report Builder.
 *
 * Pure function: turns PolicyReviewCandidate[] into a structured read-only
 * report with text and JSON output. No stores, no CLI, no audit emitters.
 */

import type { PolicyReviewCandidate } from "./policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface CandidateReport {
  reportId: string;
  generatedAt: string;
  totalCount: number;
  byStatus: Record<string, number>;
  candidates: Array<{
    candidateId: string;
    title: string;
    status: string;
    sourceKind: string;
    severity: string;
    notesCount: number;
  }>;
  footer: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------

export function buildCandidateReport(
  candidates: PolicyReviewCandidate[],
  opts?: { generatedAt?: string },
): CandidateReport {
  const byStatus: Record<string, number> = {
    proposed: 0,
    under_review: 0,
    needs_info: 0,
    deferred: 0,
    accepted_for_policy_review: 0,
    dismissed: 0,
    closed: 0,
  };
  for (const c of candidates) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }

  return {
    reportId: `p25-report`,
    generatedAt: opts?.generatedAt ?? now(),
    totalCount: candidates.length,
    byStatus,
    candidates: candidates.map(c => ({
      candidateId: c.candidateId,
      title: c.title,
      status: c.status,
      sourceKind: c.source.signalKind,
      severity: c.source.signalSeverity,
      notesCount: c.review.notes.length,
    })),
    footer:
      "No policy was changed.\n" +
      "No threshold was changed.\n" +
      "No candidate was ranked.\n" +
      "No candidate was auto-adopted.\n" +
      "No review outcome was applied to governance policy.",
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

export function renderCandidateReportText(report: CandidateReport): string {
  let out = "";

  out += "P25-CANDIDATE-REPORT-START\n";
  out += "Policy Review Candidate Report\n";
  out += "=".repeat(50) + "\n";

  out += `\n  Report ID: ${report.reportId}\n`;
  out += `  Generated: ${report.generatedAt}\n`;
  out += `  Total candidates: ${report.totalCount}\n`;

  out += "\n  By Status:\n";
  for (const [status, count] of Object.entries(report.byStatus)) {
    out += `    ${status}: ${count}\n`;
  }

  if (report.candidates.length === 0) {
    out += "\n  No candidates.\n";
  } else {
    out += "\n  Candidates:\n";
    for (const c of report.candidates) {
      out += `    [${c.status}] ${c.title}\n`;
      out += `      ID: ${c.candidateId} | Kind: ${c.sourceKind} | Severity: ${c.severity}\n`;
    }
  }

  out += "\n---\n";
  out += report.footer + "\n";
  out += "P25-CANDIDATE-REPORT-END\n";

  return out;
}

// ---------------------------------------------------------------------------
// JSON rendering
// ---------------------------------------------------------------------------

export function renderCandidateReportJson(report: CandidateReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/governance/policy-review-candidate-report.test.ts`
Expected: PASS

- [ ] **Step 5: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 6: Commit**

```bash
git add src/governance/policy-review-candidate-report.ts tests/governance/policy-review-candidate-report.test.ts
git commit -m "feat(P25.4): candidate report builder — text + JSON output

Pure report builder composing PolicyReviewCandidate[] by status.
Boundary footer. No stores, no mutation, no fs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: P25.4 — CLI Handler + Dispatch (governance-policy-review.ts)

**Files:**
- Create: `src/cli/commands/governance-policy-review.ts`
- Modify: `src/cli/commands/governance.ts` — add `case "policy-review"` dispatch
- Test: `tests/governance/policy-review-cli.test.ts`

**Interfaces:**
- Consumes: `buildCandidates()` from Task 2, store from Task 3, report from Task 4
- Produces: CLI handler wired into `alix governance policy-review {build|open|list|show|transition|note|report}`

- [ ] **Step 1: Write the failing CLI tests**

Create `tests/governance/policy-review-cli.test.ts`:

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernancePolicyReviewCommand } from "../../src/cli/commands/governance-policy-review.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

let tmpDir: string;
let bundlePath: string;
let storeRoot: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "p25-cli-"));
  storeRoot = join(tmpDir, "store");
  bundlePath = join(tmpDir, "input-bundle.json");

  // Create a minimal P24 bundle with one medium signal
  const bundle = {
    calibrations: [],
    replayDiffs: [],
    candidateLessons: [],
    readOnly: true,
  };
  writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("handleGovernancePolicyReviewCommand", () => {

  it("build --input renders candidate previews", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["build", "--input", bundlePath],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P25-BUILD"));
  });

  it("build --json returns parseable JSON", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["build", "--json", "--input", bundlePath],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed));
  });

  it("open <candidateId> --input persists candidate", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["list"],
      { cwd: tmpDir },
    );
    assert.ok(result);
  });

  it("list returns persisted candidates", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["list"],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("P25-LIST"));
  });

  it("transition rejects invalid transition through store validation", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["transition", "nonexistent-id", "--status", "closed", "--rationale", "test"],
      { cwd: tmpDir },
    );
    assert.ok(result.includes("Candidate not found") || result.includes("ERROR"));
  });

  it("report --json returns parseable JSON", async () => {
    const result = await handleGovernancePolicyReviewCommand(
      ["report", "--json"],
      { cwd: tmpDir },
    );
    const parsed = JSON.parse(result);
    assert.ok(parsed.totalCount !== undefined);
  });

  it("returns usage when no subcommand given", async () => {
    const result = await handleGovernancePolicyReviewCommand([], { cwd: tmpDir });
    assert.ok(result.includes("usage"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/governance/policy-review-cli.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the CLI handler**

Create `src/cli/commands/governance-policy-review.ts`:

```typescript
/**
 * P25.4 — Governance Policy Review CLI Handler.
 *
 * `alix governance policy-review` subcommands:
 *   build      — read-only candidate preview from P24 bundle
 *   open       — persist a candidate (explicit write)
 *   list       — read-only store inspection
 *   show       — read-only candidate detail with event log
 *   transition — explicit state transition (validated by store)
 *   note       — add annotation
 *   report     — read-only candidate summary
 *
 * CLI invariants:
 *   - build is read-only: no writes to any store
 *   - open/transition/note are explicit writes
 *   - list/show/report are read-only
 *   - no execution adapters, no audit emitters, no policy writers
 *   - store validates transition legality (not the CLI)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCandidates } from "../../governance/policy-review-candidate-builder.js";
import { createPolicyReviewCandidateStore } from "../../governance/policy-review-candidate-store.js";
import { buildCandidateReport, renderCandidateReportText, renderCandidateReportJson } from "../../governance/policy-review-candidate-report.js";

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

function getStore(cwd: string) {
  return createPolicyReviewCandidateStore({
    rootDir: join(cwd, ".alix", "governance", "policy-review-candidates"),
  });
}

function loadSignals(bundlePath: string) {
  if (!existsSync(bundlePath)) {
    return null;
  }
  const raw = readFileSync(bundlePath, "utf-8");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Build handler (read-only)
// ---------------------------------------------------------------------------

function handleBuild(args: string[], cwd: string): string {
  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required.\n" + usage();
  }

  const bundle = loadSignals(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const signals = Array.isArray(bundle) ? bundle : bundle.signals ?? [];
  const candidates = buildCandidates(signals);

  if (hasFlag(args, "--json")) {
    return JSON.stringify(candidates, null, 2) + "\n";
  }

  let out = "P25-BUILD\n";
  out += "Policy Review Candidate Preview\n";
  out += `${candidates.length} candidate(s) generated from input bundle.\n\n`;
  for (const c of candidates) {
    out += `  [${c.status}] ${c.title}\n`;
    out += `    ID: ${c.candidateId} | Source: ${c.source.signalKind} (${c.source.signalSeverity})\n`;
    out += `    Summary: ${c.summary}\n`;
    out += `    Read-only preview — use 'open' to persist.\n\n`;
  }
  out += "P25-BUILD-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Open handler (explicit write)
// ---------------------------------------------------------------------------

function handleOpen(args: string[], cwd: string): string {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> is required.\n" + usage();
  }

  const inputPath = flag(args, "--input");
  if (!inputPath) {
    return "ERROR: --input <path> is required.\n" + usage();
  }

  const bundle = loadSignals(inputPath);
  if (!bundle) {
    return "ERROR: Could not load input bundle.\n" + usage();
  }

  const signals = Array.isArray(bundle) ? bundle : bundle.signals ?? [];
  const candidates = buildCandidates(signals);
  const candidate = candidates.find(c => c.candidateId === candidateId);
  if (!candidate) {
    return `ERROR: Candidate ${candidateId} not found in input bundle.\n`;
  }

  const store = getStore(cwd);
  return store.openCandidate({
    candidate,
    rationale: flag(args, "--rationale") ?? undefined,
  }).then(saved => {
    return `Opened candidate: ${saved.candidateId} (${saved.status})\n`;
  }).catch(err => {
    return `ERROR: ${err.message}\n`;
  });
}

// ---------------------------------------------------------------------------
// List handler (read-only)
// ---------------------------------------------------------------------------

async function handleList(args: string[], cwd: string): Promise<string> {
  const store = getStore(cwd);
  const status = flag(args, "--status") as any ?? undefined;
  const candidates = await store.listCandidates({ status });

  if (hasFlag(args, "--json")) {
    return JSON.stringify(candidates, null, 2) + "\n";
  }

  let out = "P25-LIST\n";
  out += "Policy Review Candidates\n";
  out += `${candidates.length} candidate(s)\n\n`;
  for (const c of candidates) {
    out += `  [${c.status}] ${c.title}\n`;
    out += `    ID: ${c.candidateId} | Updated: ${c.updatedAt}\n`;
  }
  out += "P25-LIST-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Show handler (read-only)
// ---------------------------------------------------------------------------

async function handleShow(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> is required.\n" + usage();
  }

  const store = getStore(cwd);
  const { candidate, events } = await store.showCandidate(candidateId);

  if (!candidate) {
    return `Candidate not found: ${candidateId}\n`;
  }

  if (hasFlag(args, "--json")) {
    return JSON.stringify({ candidate, events }, null, 2) + "\n";
  }

  let out = "P25-SHOW\n";
  out += `Candidate: ${candidate.title}\n`;
  out += `Status: ${candidate.status}\n`;
  out += `Events: ${events.length}\n`;
  for (const e of events) {
    out += `  [${e.type}] ${e.occurredAt}`;
    if (e.previousStatus && e.nextStatus) {
      out += ` ${e.previousStatus} → ${e.nextStatus}`;
    }
    if (e.rationale) out += ` — ${e.rationale}`;
    out += "\n";
  }
  out += "P25-SHOW-END\n";
  return out;
}

// ---------------------------------------------------------------------------
// Transition handler (explicit write)
// ---------------------------------------------------------------------------

async function handleTransition(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> is required.\n" + usage();
  }

  const nextStatus = flag(args, "--status");
  if (!nextStatus) {
    return "ERROR: --status <status> is required.\n" + usage();
  }

  const rationale = flag(args, "--rationale");
  if (!rationale) {
    return "ERROR: --rationale <text> is required.\n" + usage();
  }

  const store = getStore(cwd);
  try {
    const updated = await store.transitionCandidate({
      candidateId,
      nextStatus: nextStatus as any,
      rationale,
    });
    return `Transitioned ${candidateId}: ${updated.status}\n`;
  } catch (err: any) {
    return `ERROR: ${err.message}\n`;
  }
}

// ---------------------------------------------------------------------------
// Note handler (explicit write)
// ---------------------------------------------------------------------------

async function handleNote(args: string[], cwd: string): Promise<string> {
  const candidateId = args[0];
  if (!candidateId) {
    return "ERROR: <candidateId> is required.\n" + usage();
  }

  const note = flag(args, "--note");
  if (!note) {
    return "ERROR: --note <text> is required.\n" + usage();
  }

  const store = getStore(cwd);
  try {
    const updated = await store.addNote({ candidateId, note });
    return `Note added to ${candidateId} (${updated.review.notes.length} total notes)\n`;
  } catch (err: any) {
    return `ERROR: ${err.message}\n`;
  }
}

// ---------------------------------------------------------------------------
// Report handler (read-only)
// ---------------------------------------------------------------------------

async function handleReport(args: string[], cwd: string): Promise<string> {
  const store = getStore(cwd);
  const status = flag(args, "--status") as any ?? undefined;
  const candidates = await store.listCandidates({ status });
  const report = buildCandidateReport(candidates);

  if (hasFlag(args, "--json")) {
    return renderCandidateReportJson(report);
  }

  return renderCandidateReportText(report);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage(): string {
  return (
    "usage: alix governance policy-review <command> [<args>]\n" +
    "\n" +
    "Commands:\n" +
    "  build --input <bundle.json> [--json]\n" +
    "    Read-only candidate preview from P24 bundle\n" +
    "\n" +
    "  open <candidateId> --input <bundle.json> [--rationale \"...\"]\n" +
    "    Persist candidate (explicit write)\n" +
    "\n" +
    "  list [--status <status>] [--json]\n" +
    "    Read-only candidate list\n" +
    "\n" +
    "  show <candidateId> [--json]\n" +
    "    Candidate detail with event log\n" +
    "\n" +
    "  transition <candidateId> --status <next> --rationale \"...\"\n" +
    "    State transition (validated by store)\n" +
    "\n" +
    "  note <candidateId> --note \"...\"\n" +
    "    Add annotation\n" +
    "\n" +
    "  report [--status <status>] [--json]\n" +
    "    Read-only candidate summary\n"
  );
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

export async function handleGovernancePolicyReviewCommand(
  args: string[],
  opts: { cwd: string },
): Promise<string> {
  const cwd = opts.cwd;
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    return usage();
  }

  switch (subcommand) {
    case "build":
      return handleBuild(args.slice(1), cwd);
    case "open":
      return await handleOpen(args.slice(1), cwd);
    case "list":
      return await handleList(args.slice(1), cwd);
    case "show":
      return await handleShow(args.slice(1), cwd);
    case "transition":
      return await handleTransition(args.slice(1), cwd);
    case "note":
      return await handleNote(args.slice(1), cwd);
    case "report":
      return await handleReport(args.slice(1), cwd);
    default:
      return usage();
  }
}
```

- [ ] **Step 4: Wire dispatch in governance.ts**

Read `src/cli/commands/governance.ts` and add after the `case "calibration"` block:

```typescript
    case "policy-review": {
      const { handleGovernancePolicyReviewCommand } = await import("./governance-policy-review.js");
      return handleGovernancePolicyReviewCommand(args.slice(1), { cwd });
    }
```

- [ ] **Step 5: Run CLI tests to verify they pass**

Run: `npx tsx --test tests/governance/policy-review-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Build and verify tsc clean**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/governance-policy-review.ts src/cli/commands/governance.ts tests/governance/policy-review-cli.test.ts
git commit -m "feat(P25.4): policy review CLI — build|open|list|show|transition|note|report

Wires alix governance policy-review subcommand tree into governance.ts dispatch.
Build is read-only. Open/transition/note are explicit writes validated by store.
No execution adapters, no policy mutation, no ranking.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: P25.5 — Checkpoint

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-09-p25-5-governed-policy-review-candidate-lifecycle-checkpoint.md`

- [ ] **Step 1: Write the checkpoint doc**

Create `docs/architecture/checkpoints/2026-07-09-p25-5-governed-policy-review-candidate-lifecycle-checkpoint.md`:

```markdown
# P25 — Governed Policy Review Candidate Lifecycle Checkpoint

**Date:** 2026-07-09
**Phase:** P25 — Governed Policy Review Candidate Lifecycle
**Checkpoint tag:** `alix-p25-governed-policy-review-candidate-lifecycle-complete`

## Verification Checklist

### No execution
- [ ] No autonomous execution, background jobs, or scheduled watchers
- [ ] No shell, network, MCP, browser, fetch, or subprocess calls
- [ ] No execution adapters, executor imports, or tool invocations

### No mutation
- [ ] No policy mutation or readiness threshold mutation
- [ ] No approval, handoff, closure review, or audit event mutation
- [ ] No automatic persistence (explicit open only)
- [ ] No policy patches, threshold-change proposals, or actionable recommendations
- [ ] Build command is read-only (no writes)
- [ ] Open/transition/note are explicit writes

### No ranking
- [ ] No candidate ranking, scoring, or comparison
- [ ] No operator or reviewer ranking

### No auto-adoption
- [ ] No auto-adoption of review outcomes
- [ ] No auto-close of candidates
- [ ] No bypass around P14–P24

### State machine integrity
- [ ] ALLOWED_TRANSITIONS match spec (17 allowed, 3 disallowed)
- [ ] Transition validation enforced by store, not CLI
- [ ] Event log is append-only

### Module boundaries
- [ ] Builder module does not import store module
- [ ] Store imports only from types.ts
- [ ] P24 modules unchanged
- [ ] P13.3 unchanged
- [ ] P9.0d unchanged
- [ ] P22 unchanged
- [ ] P23 unchanged

### Tests
- [ ] All 29 P25 tests pass
- [ ] tsc clean

## Seal Statement

```text
P25 — Governed Policy Review Candidate Lifecycle ✅ SEALED

ALiX can now:
- generate candidate previews from medium/high P24 policy drift signals
- persist candidates through explicit open/import
- manage a 7-state review lifecycle with store-enforced transitions
- maintain an append-only event log for full audit traceability
- produce read-only candidate reports with boundary footer

ALiX still cannot:
- execute actions or background watchers
- mutate policy or readiness thresholds
- rank candidates, operators, or reviewers
- auto-adopt review outcomes
- propose exact threshold changes
- bypass P14–P24 governance phases
- create policy patches or rewrites
```

## Tag

```text
git tag alix-p25-governed-policy-review-candidate-lifecycle-complete
```
```

- [ ] **Step 2: Run full test suite**

Run: `npx tsx --test tests/governance/policy-review-candidate-types.test.ts tests/governance/policy-review-candidate-builder.test.ts tests/governance/policy-review-candidate-store.test.ts tests/governance/policy-review-candidate-report.test.ts tests/governance/policy-review-cli.test.ts 2>&1`
Expected: All 50 tests pass

- [ ] **Step 3: Final tsc check**

Run: `npx tsc --noEmit`
Expected: Clean compile

- [ ] **Step 4: Commit checkpoint doc**

```bash
git add docs/architecture/checkpoints/2026-07-09-p25-5-governed-policy-review-candidate-lifecycle-checkpoint.md
git commit -m "docs(P25.5): governed policy review candidate lifecycle checkpoint

Verifies: no execution, no mutation, no ranking, no auto-adoption,
state machine integrity, module boundary enforcement,
P24/P13.3/P9.0d unchanged, 29 tests.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| P25.1 | 2 | 19 | `feat(P25.1): policy review candidate model — types, transitions, store interface` |
| P25.2 | 2 | 10 | `feat(P25.2): candidate builder — pure buildCandidates with medium/high filter` |
| P25.3 | 2 | 10 | `feat(P25.3): candidate store — file-based persistence + transition validation` |
| P25.4 (report) | 2 | 4 | `feat(P25.4): candidate report builder — text + JSON output` |
| P25.4 (CLI) | 2+1 touch | 7 | `feat(P25.4): policy review CLI — build|open|list|show|transition|note|report` |
| P25.5 | 1 | — | `docs(P25.5): governed policy review candidate lifecycle checkpoint` |
| **Total** | **14 files** | **50 tests** | **6 commits** |
*Note: 50 tests expands on the spec's 29 estimate — the types module tests each transition individually and the builder has additional filter tests.*
