# P9.3 — Governance Proposal Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing P5 `ApprovalGate` with governance-specific approval criteria for `governance_change` proposals. A `pending` governance-change proposal goes through 6 structural checks before approval is granted or denied. The gate may approve or reject — it may NOT execute governance mutation.

**Architecture:** A new pure read-only module `src/governance/governance-approval-criteria.ts` validates a governance_change proposal against 6 criteria (orphan check, EvidenceChain presence, source recommendation validity + confidence + status, explanation integrity). The existing `ApprovalGate.approve()` calls this module when `proposal.action === "governance_change"` and records evidence events (`governance_approval_denied` or `governance_approval_decision`) before the status transition. A CLI facade (`alix governance approve/reject/list/cleanup`) delegates all mutations to the same `ApprovalGate`. Sentinel enforces the criteria module is read-only.

**Tech Stack:** TypeScript, vitest, node:fs (JSONL append-only evidence via existing EvidenceEventWriter).

## Global Constraints

- **Hard boundary (non-negotiable):** `ApprovalGate` may approve or reject. `ApprovalGate` may NOT execute governance mutation. No applier, no `GovernanceChangeApplier` in P9.3.
- **Governance criteria are pure validation:** The criteria module (`governance-approval-criteria.ts`) must NOT import `ProposalStore`, `ApprovalGate`, any applier class. It must NOT call `approve(`, `apply(`, `reject(`, `save(`, `appendChain(`. Sentinel-enforced.
- **Evidence events are recorded BEFORE status transition:** `governance_approval_decision` is recorded before the proposal transitions to `approved`. If recording fails, the approval fails closed — the proposal stays `pending`.
- **One gate, one extension point:** All proposals pass through the same `ApprovalGate.approve()`. Governance proposals get additional checks; non-governance proposals are unchanged.
- **CLI is UX facade only:** `alix governance approve/reject` delegate to the same `ApprovalGate` as `alix adaptation approve/reject`. No second approval path.
- **Tombstone, not delete:** Orphaned cleanup marks `systemState.cleaned = true` on the proposal file. The file stays on disk for audit.
- **No auto-approve, no auto-apply:** governance approval still requires explicit human command. Constitutional invariant.
- **Two distinct thresholds (different scales):**
  - `CONFIDENCE_THRESHOLD = 0.6` — for `recommendation.confidence` (range 0–1)
  - `EXPLANATION_INTEGRITY_THRESHOLD = 60` — for `explanationIntegrity.completenessPercent` (range 0–100, computed as `(layersAvailable / totalLayers) * 100`)
- **Immutable proposal-time evaluation (best-effort):** The criteria module loads the source recommendation and checks `status === "open"` and `confidence >= threshold`. It reads these from the current recommendation state (P9.3 does not extend the proposal payload to capture recommendation status at creation time). Future P9.4+ can harden this.
- **Evidence events (3 new types, each with matching EvidenceEventWriter method):**
  - `governance_approval_denied` — `{ proposalId, criterion: string, integrityScore?: number, threshold?: number }` — criteria fail, proposal stays pending
  - `governance_approval_decision` — `{ proposalId, integrityScore: number, threshold: number, passed: true }` — criteria pass, recorded BEFORE status transition
  - `governance_orphan_cleaned` — `{ proposalId, reason: string }` — orphaned proposal tombstoned
- **Sentinel `ALLOWED_IN_FILE`:** `src/governance/governance-approval-criteria.ts` is allowlisted for `["EvidenceChainStore"]` (read-only). The file is also added to `ALL_FILES` under the write-call check.

---
## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/governance/governance-types.ts` | Modify | Add `GovernanceCriteriaResult` + 3 evidence event payload types |
| `src/workflow/evidence-writer.ts` | Modify | Add 3 record methods: `recordGovernanceApprovalDenied`, `recordGovernanceApprovalDecision`, `recordGovernanceOrphanCleaned` |
| `src/governance/governance-approval-criteria.ts` | **Create** | Pure read-only criteria module — 6 checks, returns `GovernanceCriteriaResult` |
| `tests/governance/governance-approval-criteria.vitest.ts` | **Create** | Tests: 7+ cases covering all criteria pass/fail scenarios |
| `src/adaptation/approval-gate.ts` | Modify | Add governance criteria injection point + gating in `approve()` |
| `tests/adaptation/approval-gate-governance.vitest.ts` | **Create** | Tests: governance flow through ApprovalGate, pass/fail/evidence recording |
| `src/cli/commands/governance.ts` | Modify | Add `approve`, `reject`, `list`, `cleanup` subcommands + ANSI renderers |
| `tests/cli/commands/governance-cli.vitest.ts` | Modify | Add 5+ tests for new subcommands |
| `tests/governance/governance-sentinels.vitest.ts` | Modify | Add criteria file to `ALL_FILES` + `ALLOWED_IN_FILE` |

---
## Task 1: Evidence event types + EvidenceWriter methods

**Files:**
- Modify: `src/governance/governance-types.ts` (add 3 payload types + `GovernanceCriteriaResult`)
- Modify: `src/workflow/evidence-writer.ts` (add 3 record methods)
- Test: `tests/governance/governance-approval-criteria.vitest.ts` (partially — type-level test for GovernanceCriteriaResult)

**Interfaces:**
- Consumes: existing `EvidenceEventWriter` pattern (append-only, best-effort, returns `Promise<EvidenceRecord | null>`)
- Produces: `GovernanceCriteriaResult`, 3 event payload types, 3 writer methods

- [ ] **Step 1: Add the 3 evidence event payload types + GovernanceCriteriaResult to governance-types.ts**

```ts
// ---- P9.3 — Governance approval criteria result --------------------------

/**
 * Result of running governance approval criteria against a governance_change
 * proposal. Returned by the pure read-only criteria module. `details` is
 * reserved for richer governance diagnostics in P9.4+.
 */
export type GovernanceCriteriaResult = {
  passed: boolean;
  failedCriterion?: string;
  integrityScore?: number;
  details?: Record<string, unknown>;
};

// ---- P9.3 — Evidence event payload types for governance lifecycle ---------

export type GovernanceApprovalDeniedPayload = {
  proposalId: string;
  criterion: string;
  integrityScore?: number;
  threshold?: number;
};

export type GovernanceApprovalDecisionPayload = {
  proposalId: string;
  integrityScore: number;
  threshold: number;
  passed: true;
};

export type GovernanceOrphanCleanedPayload = {
  proposalId: string;
  reason: string;
};
```

- [ ] **Step 2: Add 3 record methods to EvidenceEventWriter**

In `src/workflow/evidence-writer.ts`, add after the `recordRevertFailed` block:

```ts
// -----------------------------------------------------------------------
// Governance approval lifecycle (P9.3)
// -----------------------------------------------------------------------

/**
 * Record that a governance_change proposal was denied by the approval
 * criteria. Writer: ApprovalGate.
 */
async recordGovernanceApprovalDenied(
  proposalId: string,
  payload: { criterion: string; integrityScore?: number; threshold?: number },
): Promise<EvidenceRecord | null> {
  return this.appendEvent("governance_approval_denied", { proposalId, ...payload });
}

/**
 * Record that a governance_change proposal passed approval criteria.
 * Recorded BEFORE the proposal transitions to "approved".
 * Writer: ApprovalGate.
 */
async recordGovernanceApprovalDecision(
  proposalId: string,
  payload: { integrityScore: number; threshold: number; passed: true },
): Promise<EvidenceRecord | null> {
  return this.appendEvent("governance_approval_decision", { proposalId, ...payload });
}

/**
 * Record that an orphaned governance_change proposal has been cleaned
 * (tombstoned, not deleted). Writer: governance CLI.
 */
async recordGovernanceOrphanCleaned(
  proposalId: string,
  payload: { reason: string },
): Promise<EvidenceRecord | null> {
  return this.appendEvent("governance_orphan_cleaned", { proposalId, ...payload });
}
```

- [ ] **Step 3: Run focused tests + tsc compile**

Run: `npx tsc --noEmit` to verify no type errors.

Run: `npx vitest run tests/governance/ tests/workflow/ --reporter verbose 2>&1 | head -40`
Expected: existing tests still pass, no failures.

- [ ] **Step 4: Commit**

```bash
git add src/governance/governance-types.ts src/workflow/evidence-writer.ts
git commit -m "feat(p9.3): governance evidence event types + writer methods

- GovernanceCriteriaResult type
- 3 governance lifecycle evidence payload types
- 3 record methods on EvidenceEventWriter

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
## Task 2: GovernanceApprovalCriteria module

**Files:**
- Create: `src/governance/governance-approval-criteria.ts`
- Create: `tests/governance/governance-approval-criteria.vitest.ts`

**Interfaces:**
- Consumes: `EvidenceChainStore` (read-only), `GovernanceStore` (read-only), `assembleProposalExplanation` (read-only explain assembler), `AdaptationProposal` (from P5 types)
- Produces: `runGovernanceCriteria({ proposal, cwd, windowDays?, threshold? }) => Promise<GovernanceCriteriaResult>`

**6 criteria (ApprovalGate has already verified `status === "pending"`):**

1. `proposal.systemState?.orphaned !== true` — not an orphaned proposal
2. EvidenceChain has a `proposal_from_recommendation` edge whose `targetArtifactId` matches the proposal's `target.recommendationId` (load chain via `EvidenceChainStore.getChainForRoot(proposal.id)`, check `links.some(l => l.relationship === "proposal_from_recommendation" && l.targetArtifactId === recommendationId)`)
3. Source recommendation exists: load via `GovernanceStore.findRecommendationById(recommendationId)` where `recommendationId` comes from `(proposal.target as ProposalTarget & { recommendationId?: string }).recommendationId`
4. Source recommendation confidence >= `CONFIDENCE_THRESHOLD` (`0.6`, 0–1 scale)
5. Source recommendation status === "open"
6. Explanation assembles read-only + `explanationIntegrity.completenessPercent >= EXPLANATION_INTEGRITY_THRESHOLD` (`60`, 0–100 scale)

**All must pass.** If any fails: return `{ passed: false, failedCriterion: "<description>", integrityScore?: number }`.
**All pass:** return `{ passed: true, integrityScore: <integrity.completenessPercent>, details?: { explanationLayersAvailable: <n> } }`.

- [ ] **Step 1: Write the failing tests**

In `tests/governance/governance-approval-criteria.vitest.ts`:

```ts
/**
 * P9.3 — Tests for GovernanceApprovalCriteria pure read-only validation module.
 *
 * Tests cover all 7 criteria individually in isolation, plus integration
 * scenarios. Each test seeds the necessary stores (EvidenceChainStore,
 * GovernanceStore), calls runGovernanceCriteria, and asserts the result.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import type { AdaptationProposal, ProposalTarget } from "../../src/adaptation/adaptation-types.js";
```

Test cases:

1. `rejects orphaned governance proposal`
2. `rejects proposal with no proposal_from_recommendation edge for its recommendation`
3. `rejects proposal whose source recommendation does not exist`
4. `rejects proposal whose source recommendation has confidence below threshold`
5. `rejects proposal whose source recommendation status is not open`
6. `rejects proposal whose explanation integrity is below threshold`
7. `passes for a fully valid governance proposal`
8. `returns integrityScore and details on pass`

```ts
// Fixture helpers
function makeGovernanceProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "prop-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "pending",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-001" } as ProposalTarget,
    payload: { kind: "confidence_calibration", target: "red_team", currentCalibration: 0.7, suggestedCalibration: 0.75 },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test governance proposal",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/governance/governance-approval-criteria.vitest.ts --reporter verbose 2>&1`
Expected: 8 tests FAIL with "function not defined" or module import errors.

- [ ] **Step 3: Write minimal implementation**

In `src/governance/governance-approval-criteria.ts`:

```ts
/**
 * P9.3 — GovernanceApprovalCriteria.
 *
 * Pure read-only validation module for governance_change proposals.
 * Checks 6 criteria before allowing a governance proposal to proceed
 * to approval. The status-pending check is owned by ApprovalGate
 * via requirePending() — the criteria module does not duplicate it.
 *
 * CORE INVARIANT: This module NEVER writes to any store. It returns a
 * GovernanceCriteriaResult. The caller (ApprovalGate) records evidence
 * and transitions status.
 *
 * Sentinel-enforced: this file may import EvidenceChainStore (read-only)
 * and the explain assembler (read-only). It must NOT import ProposalStore,
 * ApprovalGate, any applier, or call any write/mutation method.
 *
 * @module
 */

import { join } from "node:path";
import { EvidenceChainStore } from "../learning/evidence-chain-store.js";
import { GovernanceStore } from "./governance-store.js";
import { assembleProposalExplanation } from "../explain/proposal-explanation-assembler.js";
import type { AdaptationProposal, ProposalTarget } from "../adaptation/adaptation-types.js";
import type { GovernanceCriteriaResult } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Core invariant: status-pending is checked by ApprovalGate.
 * This module checks the remaining 6 criteria.
 */

/**
 * Confidence threshold for the source recommendation (0–1 scale).
 * Aligned with P9.2 confidence gate default.
 */
const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Integrity threshold for explanation completeness (0–100 scale).
 * Aligned with the completenessPercent formula: (layersAvailable / 6) * 100.
 * Maps to >= 4 of 6 layers available.
 */
const EXPLANATION_INTEGRITY_THRESHOLD = 60;

const DEFAULT_WINDOW_DAYS = 90;

const EVIDENCE_CHAINS_DIR = join(".alix", "learning");

// ---------------------------------------------------------------------------
// runGovernanceCriteria
// ---------------------------------------------------------------------------

/**
 * Run all governance approval criteria against a governance_change proposal.
 *
 * Returns a GovernanceCriteriaResult. `passed === true` means all 6 criteria
 * passed. `passed === false` means at least one criterion failed; the
 * `failedCriterion` field identifies which one.
 *
 * Read-only. Never writes to any store.
 */
export async function runGovernanceCriteria(opts: {
  proposal: AdaptationProposal;
  cwd: string;
  windowDays?: number;
}): Promise<GovernanceCriteriaResult> {
  const { proposal, cwd } = opts;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Resolve the source recommendation ID from the proposal target first
  // (needed by both EvidenceChain check and recommendation lookup).
  const target = proposal.target as ProposalTarget & { recommendationId?: string };
  const recommendationId = target.recommendationId;

  // Criterion 1: must not be orphaned
  if (proposal.systemState?.orphaned === true) {
    return { passed: false, failedCriterion: "proposal is orphaned" };
  }

  // Criterion 2: EvidenceChain must have a proposal_from_recommendation edge
  // matching the current proposal's source recommendation.
  const chainStore = new EvidenceChainStore(join(cwd, EVIDENCE_CHAINS_DIR));
  const chains = await chainStore.getChainForRoot(proposal.id).catch(() => []);
  const hasMatchingEdge = chains.some((chain) =>
    chain.links.some(
      (link) =>
        link.relationship === "proposal_from_recommendation" &&
        link.targetArtifactId === recommendationId,
    ),
  );
  if (!hasMatchingEdge) {
    return {
      passed: false,
      failedCriterion: `no proposal_from_recommendation edge for recommendation ${recommendationId ?? "missing"}`,
    };
  }

  // Criterion 3: source recommendation must exist
  const govStore = new GovernanceStore(join(cwd, ".alix", "governance"));
  const recommendation = recommendationId
    ? await govStore.findRecommendationById(recommendationId).catch(() => null)
    : null;
  if (!recommendation) {
    return {
      passed: false,
      failedCriterion: `source recommendation not found: ${recommendationId ?? "missing"}`,
    };
  }

  // Criterion 4: source recommendation confidence must be >= threshold (0–1 scale)
  if (recommendation.confidence < CONFIDENCE_THRESHOLD) {
    return {
      passed: false,
      failedCriterion: `source recommendation confidence ${recommendation.confidence} is below threshold ${CONFIDENCE_THRESHOLD}`,
    };
  }

  // Criterion 5: source recommendation status must be "open"
  if (recommendation.status !== "open") {
    return {
      passed: false,
      failedCriterion: `source recommendation status is "${recommendation.status}", expected "open"`,
    };
  }

  // Criterion 6: explanation must assemble with integrity >= threshold (0–100 scale)
  let integrityScore = 0;
  try {
    const explanation = await assembleProposalExplanation({
      proposalId: proposal.id,
      cwd,
      windowDays,
    });
    integrityScore = explanation.explanationIntegrity.completenessPercent;
    if (integrityScore < EXPLANATION_INTEGRITY_THRESHOLD) {
      return {
        passed: false,
        failedCriterion: `explanation integrity score ${integrityScore} is below threshold ${EXPLANATION_INTEGRITY_THRESHOLD}`,
        integrityScore,
      };
    }
  } catch {
    return {
      passed: false,
      failedCriterion: "explanation assembly failed",
      integrityScore: 0,
    };
  }

  // All 6 criteria passed
  return {
    passed: true,
    integrityScore,
    details: {
      recommendationId,
      recommendationConfidence: recommendation.confidence,
      recommendationStatus: recommendation.status,
      proposalAction: proposal.action,
    },
  };
}
```

- [ ] **Step 4: Complete the test file with all 8 test cases**

Each test seeds the required stores with known state, calls `runGovernanceCriteria`, and asserts the result shape. All use `mkdtempSync` + `cwdSpy` pattern.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/governance/governance-approval-criteria.vitest.ts --reporter verbose 2>&1`
Expected: 8 tests PASS.

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/governance/governance-approval-criteria.ts tests/governance/governance-approval-criteria.vitest.ts
git commit -m "feat(p9.3): governance approval criteria module

- Pure read-only validation with 6 governance criteria
- GovernanceCriteriaResult return type
- 8 tests covering all pass/fail scenarios
- Never writes to any store

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
## Task 3: ApprovalGate extension

**Files:**
- Modify: `src/adaptation/approval-gate.ts`
- Create: `tests/adaptation/approval-gate-governance.vitest.ts`

**Interfaces:**
- Consumes: `GovernanceCriteriaResult` from Task 1, `runGovernanceCriteria` from Task 2, 3 new EvidenceEventWriter methods from Task 1
- Produces: Extended `ApprovalGate` with governance gating

**Design:** Constructor gets 1 new optional parameter (`governanceCriteria` callback — thresholds are module-internal constants in the criteria module). When a `governance_change` proposal is being approved, the gate calls the criteria function after `requirePending()` and before the status transition.

- [ ] **Step 1: Write the failing tests**

In `tests/adaptation/approval-gate-governance.vitest.ts`:

Tests:
1. `approves non-governance proposal without calling governance criteria` — verifies existing proposals are unaffected
2. `rejects governance proposal that fails criteria`
3. `records governance_approval_denied on criteria failure`
4. `approves governance proposal that passes criteria`
5. `records governance_approval_decision before status transition`
6. `proposal stays pending when governance_approval_decision recording fails` (fail-closed)
7. `throws descriptive error on governance criteria failure with integrity score`

The gate test pattern mocks `ProposalStore` + `EvidenceEventWriter` and asserts method call order. Use `vi.fn()` for the criteria callback:

```ts
const mockCriteria = vi.fn().mockResolvedValue({ passed: true, integrityScore: 85 });
const gate = new ApprovalGate(mockStore, mockWriter, mockCriteria);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/adaptation/approval-gate-governance.vitest.ts --reporter verbose 2>&1`
Expected: 7 tests FAIL.

- [ ] **Step 3: Extend ApprovalGate**

Modify constructor to accept optional governance parameters:

```ts
export type GovernanceCriteriaFn = (
  proposal: AdaptationProposal,
) => Promise<GovernanceCriteriaResult>;

export class ApprovalGate {
  constructor(
    private readonly store: ProposalStore,
    private readonly writer: EvidenceEventWriter,
    private readonly governanceCriteria?: GovernanceCriteriaFn,
  ) {}
```

Modify `approve()` method — add governance gating after `requirePending()`:

```ts
async approve(id: string, by: Actor): Promise<AdaptationProposal> {
  const existing = await this.requirePending(id);

  // P9.3: governance criteria check for governance_change proposals
  if (existing.action === "governance_change" && this.governanceCriteria) {
    const result = await this.governanceCriteria(existing);

    if (!result.passed) {
      // Record denial evidence — proposal status does NOT change
      // Includes integrityScore (0–100) and threshold (60) for self-contained audit.
      await this.writer.recordGovernanceApprovalDenied(id, {
        criterion: result.failedCriterion ?? "unknown",
        integrityScore: result.integrityScore,
        threshold: 60,
      });
      throw new Error(
        `Governance approval denied: ${result.failedCriterion}` +
        (result.integrityScore !== undefined
          ? ` (integrityScore: ${result.integrityScore})`
          : ""),
      );
    }

    // Record decision evidence BEFORE status transition.
    // Fail-closed: if recording fails, do NOT transition to approved.
    const decisionRecorded = await this.writer.recordGovernanceApprovalDecision(id, {
      integrityScore: result.integrityScore ?? 0,
      threshold: 60,
      passed: true,
    });
    if (!decisionRecorded) {
      throw new Error(
        `Governance approval failed: unable to record governance_approval_decision for ${id}`,
      );
    }
  }

  // ... existing approve logic unchanged
  const approvedAt = new Date().toISOString();
  const updated = await this.store.update(id, {
    status: "approved",
    approvedBy: by,
    approvedAt,
  });

  await this.writer.recordAdaptationApproved(id, {
    approvedBy: by,
    approvedAt,
    action: updated.action,
    target: updated.target as unknown as Record<string, unknown>,
  });

  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adaptation/approval-gate-governance.vitest.ts --reporter verbose 2>&1`
Expected: 7 tests PASS.

Run: `npx vitest run tests/adaptation/approval-gate.vitest.ts --reporter verbose 2>&1`
Expected: existing approval-gate tests still PASS (backwards compatible).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/approval-gate.ts tests/adaptation/approval-gate-governance.vitest.ts
git commit -m "feat(p9.3): extend ApprovalGate with governance criteria gating

- Add optional governance criteria callback + threshold to constructor
- Governance_change proposals get 6-criteria check before approval
- governance_approval_denied recorded on criteria failure (no state change)
- governance_approval_decision recorded BEFORE status transition (fail-closed)
- 7 new tests; all existing approval tests unchanged

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
## Task 4: CLI facade

**Files:**
- Modify: `src/cli/commands/governance.ts`
- Modify: `tests/cli/commands/governance-cli.vitest.ts`

**Interfaces:**
- Consumes: `ApprovalGate`, `ProposalStore`, `EvidenceEventWriter` (all via dynamic import per sentinel rules), `GovernanceStore`
- Produces: 4 new subcommands + ANSI renderers

**New subcommands:**

```text
alix governance approve <proposal-id> [--json]
alix governance reject <proposal-id> <reason> [--json]
alix governance list [--orphaned] [--json]
alix governance cleanup <proposal-id> [--json]
```

**Facade invariant:** All mutations flow through the existing `ApprovalGate`. The governance CLI is a UX wrapper only.

- [ ] **Step 1: Modify the CLI dispatcher case statement**

In the `handleGovernanceCommand` switch, add 4 new cases before `default:`:

```ts
case "approve":
  return runGovernanceApprove(rest);
case "reject":
  return runGovernanceReject(rest);
case "list":
  return runGovernanceList(rest);
case "cleanup":
  return runGovernanceCleanup(rest);
```

Update the usage string in `default:` to include the new subcommands.

- [ ] **Step 2: Implement `runGovernanceApprove`**

```ts
async function runGovernanceApprove(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance approve <proposal-id>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ApprovalGate } = await import("../../adaptation/approval-gate.js");
  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const { EvidenceEventWriter } = await import("../../workflow/evidence-writer.js");
  const { runGovernanceCriteria } = await import("../../governance/governance-approval-criteria.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const eventStore = new (await import("../../security/evidence/evidence-store.js")).EvidenceStore(
    join(cwd, ".alix", "evidence"),
  );

  const proposalStore = new ProposalStore(proposalsDir);
  const writer = new EvidenceEventWriter(
    (type, payload) => eventStore.append(type, payload),
  );

  // Wire governance criteria (thresholds are module-internal constants)
  const criteria = (p: AdaptationProposal) =>
    runGovernanceCriteria({ proposal: p, cwd });

  const gate = new ApprovalGate(proposalStore, writer, criteria);

  try {
    const updated = await gate.approve(proposalId, "operator");
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, proposalId, status: updated.status }, null, 2));
    } else {
      console.log(`Governance proposal approved.`);
      console.log(`  Proposal:  ${proposalId}`);
      console.log(`  Status:    ${updated.status}`);
      console.log(`  Approved:  ${updated.approvedAt}`);
      console.log(``);
      console.log(`Next step: apply via`);
      console.log(`  alix adaptation apply ${proposalId}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}
```

- [ ] **Step 3: Implement `runGovernanceReject`**

```ts
async function runGovernanceReject(args: string[]): Promise<void> {
  const proposalId = args[0];
  const reason = args.slice(1).filter(a => !a.startsWith("--")).join(" ");
  if (!proposalId || !reason) {
    console.error("Usage: alix governance reject <proposal-id> <reason>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ApprovalGate } = await import("../../adaptation/approval-gate.js");
  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const { EvidenceEventWriter } = await import("../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const eventStore = new EvidenceStore(join(cwd, ".alix", "evidence"));

  const gate = new ApprovalGate(
    new ProposalStore(proposalsDir),
    new EvidenceEventWriter((type, payload) => eventStore.append(type, payload)),
  );

  try {
    const updated = await gate.reject(proposalId, "operator", reason);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, proposalId, status: updated.status }, null, 2));
    } else {
      console.log(`Governance proposal rejected.`);
      console.log(`  Proposal:  ${proposalId}`);
      console.log(`  Status:    ${updated.status}`);
      console.log(`  Reason:    ${reason}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}
```

- [ ] **Step 4: Implement `runGovernanceList`**

Lists `governance_change` proposals from `ProposalStore`. Without `--orphaned`, filters to `pending` (excludes `systemState.orphaned === true`). With `--orphaned`, shows only orphaned proposals.

```ts
async function runGovernanceList(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const showOrphaned = args.includes("--orphaned");

  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const store = new ProposalStore(proposalsDir);
  const allProposals = await store.list().catch(() => []);

  const governanceProposals = allProposals.filter(
    (p: AdaptationProposal) => p.action === "governance_change",
  );

  const filtered = governanceProposals.filter((p: AdaptationProposal) => {
    if (showOrphaned) return p.systemState?.orphaned === true && p.systemState?.cleaned !== true;
    return p.status === "pending" && !p.systemState?.orphaned;
  });

  if (jsonMode) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(showOrphaned
      ? "No orphaned governance proposals."
      : "No pending governance proposals."
    );
    return;
  }

  console.log(BOLD + (showOrphaned ? "Orphaned Governance Proposals" : "Pending Governance Proposals") + RESET);
  console.log(BAR);
  for (const p of filtered) {
    const target = p.target as { kind?: string; recommendationId?: string };
    console.log(`  ${p.id}`);
    console.log(`    Action:        ${p.action}`);
    console.log(`    Recommendation: ${target.recommendationId ?? "—"}`);
    console.log(`    Confidence:    ${p.sourceConfidence}`);
    if (p.systemState?.orphaned) {
      console.log(`    Orphaned:      ${p.systemState.reason}`);
    }
    console.log("");
  }
}
```

- [ ] **Step 5: Implement `runGovernanceCleanup`**

Tombstones orphaned proposals (does NOT delete the file):

```ts
async function runGovernanceCleanup(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance cleanup <proposal-id>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const { EvidenceEventWriter } = await import("../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const store = new ProposalStore(proposalsDir);
  const existing = await store.load(proposalId);

  if (!existing) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Proposal not found: ${proposalId}` }));
    } else {
      console.error(`Proposal not found: ${proposalId}`);
    }
    process.exit(1);
  }

  if (existing.action !== "governance_change") {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Not a governance proposal: ${proposalId}` }));
    } else {
      console.error(`Not a governance proposal: ${proposalId} (action="${existing.action}")`);
    }
    process.exit(1);
  }

  if (!existing.systemState?.orphaned) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Proposal ${proposalId} is not orphaned` }));
    } else {
      console.error(`Proposal ${proposalId} is not orphaned. Only orphaned proposals may be cleaned up.`);
    }
    process.exit(1);
  }

  // Prevent repeated cleanup — already-cleaned proposals must not emit new events
  if (existing.systemState?.cleaned === true) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Proposal ${proposalId} was already cleaned` }));
    } else {
      console.error(`Proposal ${proposalId} was already cleaned. No action taken.`);
    }
    process.exit(1);
  }

  // Tombstone: mark systemState.cleaned = true (file stays on disk)
  await store.update(proposalId, {
    systemState: { ...existing.systemState, cleaned: true } as { orphaned: true; reason: string; cleaned: true },
  });

  const eventStore = new EvidenceStore(join(cwd, ".alix", "evidence"));
  const writer = new EvidenceEventWriter((type, payload) => eventStore.append(type, payload));
  await writer.recordGovernanceOrphanCleaned(proposalId, {
    reason: "Operator cleanup",
  });

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, proposalId, cleaned: true }));
  } else {
    console.log(`Orphaned governance proposal cleaned up.`);
    console.log(`  Proposal:  ${proposalId}`);
    console.log(`  File retained for audit.`);
  }
}
```

- [ ] **Step 6: Implement `runGovernanceExplain` (approval attempt history)**

Add an `explain` case to the dispatcher switch. The explain subcommand:
1. Loads the proposal by ID
2. Assembles the standard proposal explanation (reuses P8.5c `assembleProposalExplanation`)
3. Queries evidence events for `governance_approval_denied` and `governance_approval_decision` records
4. Renders the standard explain output PLUS the approval attempt summary

```ts
async function runGovernanceExplain(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance explain <proposal-id>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const cwd = process.cwd();

  // Standard explanation (P8.5c)
  const { assembleProposalExplanation } = await import(
    "../../explain/proposal-explanation-assembler.js"
  );
  const { EvidenceStore } = await import(
    "../../security/evidence/evidence-store.js"
  );
  const { EvidenceEventWriter } = await import(
    "../../workflow/evidence-writer.js"
  );

  const explanation = await assembleProposalExplanation({
    proposalId,
    cwd,
    windowDays: 90,
  });

  // Query evidence events for governance approval history
  const evidenceStore = new EvidenceStore(join(cwd, ".alix", "evidence"));
  const allRecords = await evidenceStore.queryByType("governance_approval_denied")
    .catch(() => []);
  const denialRecords = allRecords
    .filter((r: { payload?: Record<string, unknown> }) =>
      r.payload?.proposalId === proposalId,
    )
    .sort(
      (a: { generatedAt: string }, b: { generatedAt: string }) =>
        new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );

  const decisionRecords = (await evidenceStore.queryByType("governance_approval_decision")
    .catch(() => []))
    .filter((r: { payload?: Record<string, unknown> }) =>
      r.payload?.proposalId === proposalId,
    );

  if (jsonMode) {
    console.log(JSON.stringify({
      explanation,
      approvalHistory: {
        denied: denialRecords.length,
        decisions: decisionRecords.length,
        lastDenial: denialRecords[0] ?? null,
      },
    }, null, 2));
    return;
  }

  // Render standard explanation summary
  const integ = explanation.explanationIntegrity;
  console.log(BOLD + "Governance Proposal Explanation" + RESET);
  console.log(`Proposal: ${proposalId}`);
  console.log(`Generated: ${explanation.generatedAt}`);
  console.log(BAR);
  console.log(`Layers Available: ${integ.layersAvailable}/${integ.totalLayers}`);
  console.log(`Evidence Chain:  ${integ.evidenceChainUsed ? "✅ yes" : "❌ no"}`);
  console.log(`Completeness:    ${integ.completenessPercent}%`);
  if (integ.incompleteChainLayers > 0) {
    console.log(`Incomplete:      ${integ.incompleteChainLayers} chain layer(s)`);
  }
  console.log("");

  // Render approval attempt history
  console.log(BOLD + "Approval History" + RESET);
  console.log(`Attempts:   ${denialRecords.length + decisionRecords.length}`);
  console.log(`Denied:     ${denialRecords.length}`);
  console.log(`Approved:   ${decisionRecords.length}`);
  if (denialRecords.length > 0) {
    const last = denialRecords[0];
    console.log("");
    console.log(BOLD + "Last Denial" + RESET);
    console.log(`  At:         ${last.generatedAt}`);
    console.log(`  Criterion:  ${last.payload?.criterion ?? "unknown"}`);
    if (last.payload?.integrityScore !== undefined) {
      console.log(`  Integrity:  ${last.payload.integrityScore}`);
    }
  }
}
```

- [ ] **Step 7: Add CLI tests**

In `tests/cli/commands/governance-cli.vitest.ts`, add a new `describe("P9.3 governance lifecycle CLI")` block with tests:

1. `approve subcommand rejects without proposal-id` (exit code 2)
2. `approve subcommand delegates to ApprovalGate and renders success` (verify output contains "Governance proposal approved")
3. `reject subcommand renders rejection output`
4. `list subcommand shows pending governance proposals`
5. `list --orphaned shows orphaned proposals (but hides cleaned ones)`
6. `cleanup subcommand tombstones orphaned proposal`
7. `cleanup rejects non-orphaned proposal`
8. `cleanup rejects already-cleaned proposal`
9. `explain subcommand renders governance proposal explanation`
10. `explain subcommand shows approval attempt history when evidence exists`
11. `unknown subcommand errors with usage` (existing test, should still pass)

- [ ] **Step 8: Run all tests**

Run: `npx vitest run tests/cli/commands/governance-cli.vitest.ts --reporter verbose 2>&1`
Expected: all tests PASS (old + new).

Run: `npx vitest run tests/adaptation/ tests/governance/ --reporter verbose 2>&1 | tail -20`
Expected: all governance + adaptation tests PASS.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/governance.ts tests/cli/commands/governance-cli.vitest.ts
git commit -m "feat(p9.3): governance CLI facade (approve/reject/list/cleanup/explain)

- 5 new subcommands: approve, reject, list, cleanup, explain
- Dynamic imports for ApprovalGate/ProposalStore (sentinel-compliant)
- UX wrapper only — all mutations flow through existing ApprovalGate
- Explain enhancement shows approval attempt history from evidence events
- Orphaned proposal tombstone (systemState.cleaned) on cleanup
- 11 new CLI tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
## Task 5: Sentinel updates + full suite verification

**Files:**
- Modify: `tests/governance/governance-sentinels.vitest.ts`
- No changes to `src/` — only test/sentinel files

**Interfaces:**
- Consumes: the sentinel test file (P9.0f/P9.1 pattern)
- Produces: updated allowlist, new snapshot-equal assertion

- [ ] **Step 1: Add criteria file to ALL_FILES**

In `tests/governance/governance-sentinels.vitest.ts`:

```ts
const ALL_FILES = [
  ...GOVERNANCE_BUILDERS,
  "src/governance/governance-store.ts",
  "src/governance/governance-recommendation-generator.ts",
  "src/governance/governance-proposal-generator.ts",
  "src/governance/governance-approval-criteria.ts",    // NEW: P9.3
  "src/cli/commands/governance.ts",
];
```

- [ ] **Step 2: Add criteria file to ALLOWED_IN_FILE**

```ts
const ALLOWED_IN_FILE: Record<string, string[]> = {
  "src/governance/governance-proposal-generator.ts": ["ProposalStore", "EvidenceChainStore"],
  "src/governance/governance-approval-criteria.ts": ["EvidenceChainStore"],   // NEW: P9.3 read-only store
};
```

- [ ] **Step 3: Add snapshot-equal assertion for adaptation-types.ts ProposalAction**

Following the P9.2 pattern, add a test that verifies `ProposalAction` still contains all P9.2 actions (no P9.3 additions — P9.3 does NOT extend `ProposalAction`):

```ts
it("adaptation-types.ts ProposalAction preserves all P9.2 actions (P9.3 does NOT extend it)", () => {
  const source = readSource("src/adaptation/adaptation-types.ts");
  const match = source.match(/export type ProposalAction\s*=\s*([\s\S]+?);/);
  expect(match).not.toBeNull();
  if (!match) return;
  const members = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // P9.3 adds no new ProposalAction values
  expect(members).toContain("governance_change");
  expect(members).toContain("create_agent_card");
  expect(members).toContain("update_agent_card");
  // ... all existing baseline actions still present
  expect(members.length).toBeGreaterThanOrEqual(10);
});
```

- [ ] **Step 4: Run sentinel tests + full suite**

Run: `npx vitest run tests/governance/governance-sentinels.vitest.ts --reporter verbose 2>&1`
Expected: all sentinel tests PASS.

Run: `npx vitest run --reporter verbose 2>&1 | tail -30`
Expected: full suite green (all existing + P9.3 new tests).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify protected files are unchanged**

Run: `git diff --stat main -- 'src/adaptation/adaptation-types.ts' 'src/adaptation/risk-score-types.ts' 'src/adaptation/governance-review-types.ts' 'src/adaptation/decision-types.ts' 'src/learning/learning-types.ts' 'src/adaptation/outcome-types.ts'`
Expected: no output (all 6 protected type files are unchanged — P9.3 does not touch them).

- [ ] **Step 6: Commit**

```bash
git add tests/governance/governance-sentinels.vitest.ts
git commit -m "chore(p9.3): sentinel updates + protected-file verification

- Add governance-approval-criteria.ts to ALL_FILES
- Allowlist EvidenceChainStore import for criteria module
- Verify adaptation-types.ts has no P9.3 additions (unchanged)
- 6 protected type files byte-identical to main

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
## Task 6: Final whole-branch review + PR

**Files:**
- No code changes — review + PR creation

**Review scope:** All 5 tasks above, 9+ files changed.

- [ ] **Step 1: Run final full test suite**

```bash
npm test 2>&1 | tail -40
```

Expected: all tests PASS, tsc clean.

- [ ] **Step 2: Run `gitnexus detect_changes`**

Run: `gitnexus_detect_changes()`
Verify: only expected P9.3 files are affected. No unexpected side effects.

- [ ] **Step 3: Dispatch whole-branch code review**

Use `superpowers:requesting-code-review` with the full branch diff against `main`. Review dimensions:
- Governance criteria correctness (all 6 checks, edge cases)
- ApprovalGate backwards compatibility (existing approve path unchanged)
- Evidence event ordering (denied before status check, decision before transition)
- Sentinel structural enforcement (criteria file is read-only)
- CLI facade correctly delegates to ApprovalGate (no second approval path)
- Test coverage (criteria tests + gate tests + CLI tests + sentinel tests)

- [ ] **Step 4: Fix any review findings**

One fix subagent per batch of findings. Re-run full suite after each fix wave.

- [ ] **Step 5: Create PR**

```bash
git push -u origin feature/p9.3-governance-proposal-lifecycle
gh pr create --title "P9.3 Governance Proposal Lifecycle" \
  --body "## P9.3 — Governance Proposal Lifecycle

Extends ApprovalGate with governance-specific approval criteria for governance_change proposals.

### Deliverables
- GovernanceApprovalCriteria module (read-only, 6 checks)
- ApprovalGate extension (governance gating in approve())
- 3 new evidence events (denied, decision, cleaned)
- CLI facade (approve/reject/list/cleanup)
- Sentinel enforcement (criteria file is read-only)
- 25+ new tests

### Invariants
- ApprovalGate may approve/reject, NOT execute governance mutation
- governance_approval_decision recorded BEFORE status transition (fail-closed)
- CLI is UX facade — all mutations through same ApprovalGate
- Tombstone, not delete (orphaned cleanup preserves file)
- 6 protected type files unchanged

Closes P9.3" \
  --base main
```

- [ ] **Step 6: Mark task complete**

```bash
git tag alix-p9-3-complete
git push origin alix-p9-3-complete
```
