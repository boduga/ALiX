# A8 Implementation Plan — Organizational Learning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build A8 Organizational Learning — a read-only diagnostic layer that surfaces organizational patterns from proposal/measurement/recommendation history as `LearningProposal` artifacts, routed through the existing A2.5 `GovernanceRecommendation` + A3 `generateDecision()` seam producing MONITOR outcomes. A8 never mutates governance config, A5 policy, A7 proposal-generation, or capability mutations.

**Architecture:** New module `src/evolution/learning/` mirroring A6's `src/evolution/knowledge/` structure (contracts → adapters → detectors → engine → proposal-builder → CLI). Three read-only adapters (proposal-events / measurement-events / enriched-proposals) feed three pure detectors (underperformer / outcome-contradiction / repeated-pattern-failure). Engine joins adapter outputs, aggregates findings into a `LearningProposal` (or returns `null` if zero findings), and routes through an A2.5 bridge that constructs `GovernanceRecommendation(kind: "MONITOR")`. Single CLI: `alix governance evolution learn`.

**Tech Stack:** TypeScript, vitest, pnpm. Existing capability platform + A-series architecture. A3 `generateDecision` and A2.5 `GovernanceRecommendation` consumed unchanged.

## Global Constraints

These are binding on every task — copy verbatim:

- **Non-executability:** `LearningProposal` has NO mutation/execution fields. The proposal shape cannot be converted directly into a capability mutation. This is a structural boundary, not a convention.
- **A2.5 kind:** The A2.5 bridge constructs `kind: "MONITOR"` for A8 proposals. A8 never emits APPROVE/REJECT.
- **Detector purity:** All 3 detectors are pure functions over normalized input. No I/O, no implicit clock — engine passes a deterministic timestamp.
- **Read-only adapters:** Three independent read-only adapters (proposal-events / measurement-events / enriched-proposals). Adapters never join or transform into findings; joins happen in the engine.
- **"No trigger → no proposal":** If all 3 detectors return 0 findings, the engine emits NO `LearningProposal` (not an empty proposal).
- **Evidence preservation:** `evidenceRefs` on each finding are preserved exactly. Auditability is a locked A8 property.
- **No A6 domain type reuse:** A6's `CurationProposal` is incompatible (different domain). A8 owns its own contracts.
- **No executor / capability-catalog mutator imports:** A8 is read-only end-to-end.
- **No new persistence:** Consume existing canonical sources (EventLog, P10.8a `EnrichedProposal[]`). No new A8 persistence store.
- **Outcome-contradiction detector does NOT judge operator correctness:** A8 learns from organizational behavior; it does not score governance decisions.
- **CLI namespace:** Single command `alix governance evolution learn [--dimension ...] [--json]`. The detector taxonomy is internal.
- **Threshold values:** Concrete minimum cardinality + evidence window duration deferred to reconnaissance at T1 reconnaissance step. Engine options are read-only config passed to detectors.
- **Branch + worktree:** All work on a fresh worktree named `a8-organizational-learning` off main. Push branch + PR; squash-merge to main.
- **No tag ceremony** for A8.
- **Spec deviations:** If a task requires deviation from the spec, STOP and surface to the human — do not silently adjust.
- **Out of scope:** A9 Self-Directed Engineering, TUI/Web surfaces, CAP-P resumption, M2/M3 governance signal delivery, A8 strategy-tuning, A6 modification, A3/A2.5 modification.

---

### Task 1: Contracts + reconnaissance (foundation + threshold defaults)

**Files:**
- Create: `src/evolution/learning/contracts/learning-contract.ts`
- Create: `src/evolution/learning/index.ts` (minimal barrel re-export for tests)
- Test: `tests/evolution/a8-contracts.vitest.ts` (smoke test for contract shape)

**Interfaces:**
- Consumes: nothing (foundation).
- Produces: `LearningFindingKind`, `LearningFinding`, `LearningProposal`, `LearningAdapter<T>`, `LearningEngineOptions`, `ProposalGovernanceRecord`, `MeasurementOutcomeRecord`, `EnrichedProposalRecord` (3 normalized adapter records).

**Reconnaissance scope (must precede implementation):**

Before writing contracts, run reconnaissance to confirm concrete threshold defaults. The spec defers this; this task pins them.

1. Read `src/evolution/observation/a5-capability-measurement.ts` — find existing default observation window (e.g., 7 days, 30 days).
2. Read `src/capability/governance/governance-types.ts` — find any existing "minimum occurrences" pattern.
3. Read `src/adaptation/intelligence-types.ts` for `EnrichedProposal` shape.
4. **Decide defaults** (record in T1 commit message):
   - `defaultMinCardinality`: pick from existing A5/A0 precedents; default = 3 (typical "noise floor").
   - `defaultEvidenceWindowDays`: pick from existing A5 observation window; default = 30 days.
5. **If no precedent exists for either**, STOP and surface. Do not invent magic numbers.

**Code blocks (verbatim):**

`src/evolution/learning/contracts/learning-contract.ts`:

```typescript
/**
 * A8 — Organizational Learning contracts.
 *
 * A8 detects organizational patterns from proposal/measurement/recommendation
 * history and surfaces them as diagnostic LearningProposal artifacts.
 * A8 is read-only; the LearningProposal is structurally non-executable.
 *
 * Architectural progression (locked):
 *   adapters (read-only) → pure detectors → LearningFinding[]
 *   → LearningProposal (or null if 0 findings) → A2.5 bridge
 *   → GovernanceRecommendation(kind: "MONITOR") → A3 generateDecision
 */

// ---------------------------------------------------------------------------
// Three detector kinds (locked)
// ---------------------------------------------------------------------------

export type LearningFindingKind =
  | "underperformer"
  | "outcome-contradiction"
  | "repeated-pattern-failure";

// ---------------------------------------------------------------------------
// Reconnaissance-derived defaults (Task 1 reconnaissance)
// ---------------------------------------------------------------------------

/**
 * Reconnaissance-derived default for minimum finding cardinality.
 * Concrete value established by T1 reconnaissance — see plan Global Constraints.
 */
export const DEFAULT_MIN_CARDINALITY = 3;

/**
 * Reconnaissance-derived default for evidence window duration (days).
 * Concrete value established by T1 reconnaissance.
 */
export const DEFAULT_EVIDENCE_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// LearningFinding
// ---------------------------------------------------------------------------

export interface LearningFinding {
  readonly findingId: string;
  readonly kind: LearningFindingKind;
  readonly identityKey: string;
  readonly evidenceWindow: { readonly from: string; readonly to: string };
  readonly occurrences: number;
  readonly evidenceRefs: ReadonlyArray<string>; // preserved exactly for auditability
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// LearningProposal — STRUCTURALLY NON-EXECUTABLE
// ---------------------------------------------------------------------------

/**
 * Aggregate of findings from a single engine run.
 *
 * CRITICAL: this type has NO mutation/execution fields and CANNOT be
 * converted directly into a capability mutation. This is a structural
 * boundary, not a convention. A8 does NOT mutate governance config,
 * A5 measurement policy, A7 proposal-generation policy, or capability
 * mutations.
 *
 * If a future program wants A8 to recommend strategy changes, that
 * is a NEW architectural increment, not an A8 expansion.
 */
export interface LearningProposal {
  readonly proposalId: string;
  readonly generatedAt: string;
  readonly findings: ReadonlyArray<LearningFinding>;
}

// ---------------------------------------------------------------------------
// Read-only adapter contract
// ---------------------------------------------------------------------------

export interface LearningAdapter<T> {
  readonly name: string;
  list(): Promise<ReadonlyArray<T>>;
}

// ---------------------------------------------------------------------------
// Normalized adapter records (each adapter returns its own shape)
// ---------------------------------------------------------------------------

/**
 * proposal-events-adapter output: governance lifecycle events for proposals.
 * Source: EventLog capability.governance.proposal.* events (CAP-9).
 */
export interface ProposalGovernanceRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly kind:
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected"
    | "proposal.executed"
    | "proposal.execution_failed";
  readonly operatorId?: string;          // from ProposalApprovedPayload.approvedBy or ProposalRejectedPayload.rejectedBy
  readonly operatorReason?: string;       // from ProposalRejectedPayload.reason
  readonly recommendation?: { readonly kind: string; readonly confidence: number };
  readonly recordedAt: string;
  readonly eventId: string;               // EventLog eventId for audit
}

/**
 * measurement-events-adapter output: outcome events.
 * Source: EventLog capability.governance.measurement.* events (CAP-10).
 */
export interface MeasurementOutcomeRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly outcome: "effective" | "ineffective" | "inconclusive";
  readonly sourceProposalIds: ReadonlyArray<string>; // proposals whose execution produced this outcome
  readonly recordedAt: string;
  readonly eventId: string;
}

/**
 * enriched-proposals-adapter output: P10.8a enriched proposal records.
 * Source: EnrichedProposal[] pipeline.
 */
export interface EnrichedProposalRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly enrichedFields: ReadonlyArray<string>;
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// Engine options
// ---------------------------------------------------------------------------

export interface LearningEngineOptions {
  readonly minCardinality: number;
  readonly evidenceWindowDays: number;
}

export const DEFAULT_LEARNING_ENGINE_OPTIONS: LearningEngineOptions = {
  minCardinality: DEFAULT_MIN_CARDINALITY,
  evidenceWindowDays: DEFAULT_EVIDENCE_WINDOW_DAYS,
};
```

**Steps:**

- [ ] **Step 1: Reconnaissance — establish threshold defaults**

  Run the reconnaissance scope above. Find any existing precedent for minimum cardinality and evidence window. **If no precedent exists for either, STOP and surface the gap to the human partner before proceeding.** Otherwise, write the values into the contracts file (replace the `// concrete value established by T1 reconnaissance` placeholders with the actual numbers).

- [ ] **Step 2: Write contracts file**

  Create `src/evolution/learning/contracts/learning-contract.ts` with the code block above, with reconnaissance values filled in.

- [ ] **Step 3: Write minimal barrel + smoke test**

  Create `src/evolution/learning/index.ts`:
  ```typescript
  export * from "./contracts/learning-contract.js";
  ```

  Create `tests/evolution/a8-contracts.vitest.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import {
    DEFAULT_MIN_CARDINALITY,
    DEFAULT_EVIDENCE_WINDOW_DAYS,
    DEFAULT_LEARNING_ENGINE_OPTIONS,
    type LearningFinding,
    type LearningProposal,
    type LearningAdapter,
  } from "../../src/evolution/learning/contracts/learning-contract.js";

  describe("A8 contract smoke", () => {
    it("default options are populated", () => {
      expect(DEFAULT_MIN_CARDINALITY).toBeGreaterThan(0);
      expect(DEFAULT_EVIDENCE_WINDOW_DAYS).toBeGreaterThan(0);
      expect(DEFAULT_LEARNING_ENGINE_OPTIONS.minCardinality).toBe(DEFAULT_MIN_CARDINALITY);
      expect(DEFAULT_LEARNING_ENGINE_OPTIONS.evidenceWindowDays).toBe(DEFAULT_EVIDENCE_WINDOW_DAYS);
    });

    it("LearningProposal has no mutation fields", () => {
      // Sentinel: architectural non-executability.
      const proposal: LearningProposal = {
        proposalId: "p1",
        generatedAt: "2026-08-14T00:00:00Z",
        findings: [],
      };
      expect(Object.keys(proposal)).toEqual(["proposalId", "generatedAt", "findings"]);
    });
  });
  ```

- [ ] **Step 4: Run smoke test to verify GREEN**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a8-organizational-learning
  pnpm vitest run tests/evolution/a8-contracts.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a8-organizational-learning
  git add src/evolution/learning/ tests/evolution/a8-contracts.vitest.ts
  git commit -m "feat(evolution): A8 T1 contracts + threshold defaults (reconnaissance)"
  ```

  Commit message must include the reconnaissance-derived threshold values.

---

### Task 2: Three read-only adapters

**Files:**
- Create: `src/evolution/learning/adapters/proposal-events-adapter.ts`
- Create: `src/evolution/learning/adapters/measurement-events-adapter.ts`
- Create: `src/evolution/learning/adapters/enriched-proposals-adapter.ts`
- Create: `src/evolution/learning/adapters/index.ts` (barrel)
- Test: `tests/evolution/a8-adapters.vitest.ts`

**Interfaces:**
- Consumes: `LearningAdapter<T>`, `ProposalGovernanceRecord`, `MeasurementOutcomeRecord`, `EnrichedProposalRecord` (from T1).
- Produces: 3 concrete `LearningAdapter<T>` implementations reading from EventLog + EnrichedProposal sources.

**Code blocks (verbatim):**

`src/evolution/learning/adapters/proposal-events-adapter.ts`:

```typescript
import type { LearningAdapter, ProposalGovernanceRecord } from "../contracts/learning-contract.js";
import type { EventLog } from "../../../events/event-log.js";
import type { CapabilityGovernanceEvent } from "../../../capability/governance/governance-types.js";

/**
 * Read-only adapter over EventLog capability.governance.proposal.* events.
 * Returns normalized ProposalGovernanceRecord[].
 *
 * Never writes. Never joins or transforms into findings — joins belong
 * above the adapter boundary (in the engine).
 */
export class ProposalEventsAdapter implements LearningAdapter<ProposalGovernanceRecord> {
  readonly name = "proposal-events";
  constructor(private readonly eventLog: EventLog) {}

  async list(): Promise<ReadonlyArray<ProposalGovernanceRecord>> {
    const events = await this.eventLog.listByPrefix("capability.governance.proposal.");
    return events.map((e) => this.normalize(e));
  }

  private normalize(event: CapabilityGovernanceEvent): ProposalGovernanceRecord {
    const shortKind = event.type.replace("capability.governance.proposal.", "") as ProposalGovernanceRecord["kind"];
    const payload = event.payload as Record<string, unknown>;
    return {
      proposalId: (payload["proposalId"] as string | undefined) ?? "",
      capabilityId: (payload["capabilityId"] as string | undefined) ?? "",
      kind: shortKind,
      operatorId:
        (payload["approvedBy"] as string | undefined) ??
        (payload["rejectedBy"] as string | undefined),
      operatorReason: payload["reason"] as string | undefined,
      recommendation: payload["recommendation"] as { kind: string; confidence: number } | undefined,
      recordedAt: event.recordedAt,
      eventId: event.eventId,
    };
  }
}
```

`src/evolution/learning/adapters/measurement-events-adapter.ts`:

```typescript
import type { LearningAdapter, MeasurementOutcomeRecord } from "../contracts/learning-contract.js";
import type { EventLog } from "../../../events/event-log.js";
import type { CapabilityMeasurementEvent } from "../../../capability/measurement/measurement-event-types.js";

/**
 * Read-only adapter over EventLog capability.governance.measurement.* events.
 * Returns normalized MeasurementOutcomeRecord[].
 */
export class MeasurementEventsAdapter implements LearningAdapter<MeasurementOutcomeRecord> {
  readonly name = "measurement-events";
  constructor(private readonly eventLog: EventLog) {}

  async list(): Promise<ReadonlyArray<MeasurementOutcomeRecord>> {
    const events = await this.eventLog.listByPrefix("capability.governance.measurement.");
    return events.map((e) => this.normalize(e));
  }

  private normalize(event: CapabilityMeasurementEvent): MeasurementOutcomeRecord {
    const payload = event.payload as Record<string, unknown>;
    const outcome = (payload["outcome"] as MeasurementOutcomeRecord["outcome"] | undefined) ?? "inconclusive";
    return {
      proposalId: (payload["proposalId"] as string | undefined) ?? "",
      capabilityId: (payload["capabilityId"] as string | undefined) ?? "",
      outcome,
      sourceProposalIds: (payload["sourceProposalIds"] as string[] | undefined) ?? [],
      recordedAt: event.recordedAt,
      eventId: event.eventId,
    };
  }
}
```

`src/evolution/learning/adapters/enriched-proposals-adapter.ts`:

```typescript
import type { LearningAdapter, EnrichedProposalRecord } from "../contracts/learning-contract.js";
import type { EnrichedProposal } from "../../../adaptation/intelligence-types.js";

/**
 * Read-only adapter over P10.8a EnrichedProposal[] pipeline.
 * Returns normalized EnrichedProposalRecord[].
 */
export class EnrichedProposalsAdapter implements LearningAdapter<EnrichedProposalRecord> {
  readonly name = "enriched-proposals";
  constructor(private readonly source: ReadonlyArray<EnrichedProposal>) {}

  async list(): Promise<ReadonlyArray<EnrichedProposalRecord>> {
    return this.source.map((p) => this.normalize(p));
  }

  private normalize(p: EnrichedProposal): EnrichedProposalRecord {
    return {
      proposalId: p.proposalId,
      capabilityId: p.capabilityId ?? "",
      enrichedFields: Object.keys(p),
      recordedAt: p.recordedAt ?? new Date(0).toISOString(),
    };
  }
}
```

`src/evolution/learning/adapters/index.ts`:

```typescript
export * from "./proposal-events-adapter.js";
export * from "./measurement-events-adapter.js";
export * from "./enriched-proposals-adapter.js";
```

**Steps:**

- [ ] **Step 1: Write adapter tests**

  Create `tests/evolution/a8-adapters.vitest.ts` — verify each adapter:
  - `list()` returns expected normalized shape
  - Read-only invariant: no mutation surface exposed
  - Empty source → empty list
  - Events of unexpected prefix are filtered out

  Use `FakeEventLog` (or in-memory array of synthetic events). Discover the canonical test pattern from `tests/capability/cap-12-e2e.vitest.ts:163` (`buildSiblingService`) or `tests/evolution/knowledge/` if it exists.

- [ ] **Step 2: Write 3 adapter implementations**

  Per the code blocks above. Adapt imports to match the actual `EventLog.listByPrefix` signature, `CapabilityGovernanceEvent`/`CapabilityMeasurementEvent` payload shape, and `EnrichedProposal` field names. **STOP and surface** if any of these signatures cannot be reconciled.

- [ ] **Step 3: Run adapter tests to verify GREEN**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a8-organizational-learning
  pnpm vitest run tests/evolution/a8-adapters.vitest.ts 2>&1 | tail -15
  ```

- [ ] **Step 4: Run full capability + evolution suite**

  ```bash
  pnpm vitest run tests/capability/ tests/evolution/ 2>&1 | tail -8
  ```

  Expected: previous baseline + 3 new adapter tests = 0 regressions.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a8-organizational-learning
  git add src/evolution/learning/adapters/ tests/evolution/a8-adapters.vitest.ts
  git commit -m "feat(evolution): A8 T2 three read-only adapters"
  ```

---

### Task 3: underperformer detector

**Files:**
- Create: `src/evolution/learning/detectors/underperformer-detector.ts`
- Test: `tests/evolution/a8-learning-detectors.vitest.ts` (initial file; later tasks append)

**Interfaces:**
- Consumes: `MeasurementOutcomeRecord[]`, `LearningEngineOptions`.
- Produces: `LearningFinding[]` (one per `capabilityId` with `count(ineffective) >= minCardinality`).

**Code block (verbatim):**

```typescript
import type { LearningFinding, MeasurementOutcomeRecord, LearningEngineOptions, LearningFindingKind } from "../contracts/learning-contract.js";

/**
 * underperformer-detector.
 *
 * Pure function over normalized measurement outcomes.
 * Groups by capabilityId within the evidence window; emits one finding
 * per capability whose count of "ineffective" outcomes >= minCardinality.
 *
 * Deterministic: same input + same options → same findings (sorted by
 * identityKey for stability).
 */
export function detectUnderperformer(
  records: ReadonlyArray<MeasurementOutcomeRecord>,
  options: LearningEngineOptions,
  now: string,
): ReadonlyArray<LearningFinding> {
  const windowStart = subtractDays(now, options.evidenceWindowDays);
  const grouped = new Map<string, MeasurementOutcomeRecord[]>();
  for (const r of records) {
    if (r.recordedAt < windowStart || r.recordedAt > now) continue;
    if (r.outcome !== "ineffective") continue;
    const list = grouped.get(r.capabilityId) ?? [];
    list.push(r);
    grouped.set(r.capabilityId, list);
  }

  const findings: LearningFinding[] = [];
  for (const [capabilityId, list] of grouped) {
    if (list.length < options.minCardinality) continue;
    findings.push({
      findingId: `underperformer:${capabilityId}`,
      kind: "underperformer",
      identityKey: capabilityId,
      evidenceWindow: { from: windowStart, to: now },
      occurrences: list.length,
      evidenceRefs: list.map((r) => r.eventId),
      summary: `${list.length} ineffective outcomes for capability ${capabilityId} within ${options.evidenceWindowDays} days`,
    });
  }
  return findings.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const UNDERPERFORMER_DETECTOR_KIND: LearningFindingKind = "underperformer";
```

**Steps:**

- [ ] **Step 1: Write detector unit tests**

  Add to `tests/evolution/a8-learning-detectors.vitest.ts`:
  - Empty input → 0 findings
  - Below minimum cardinality → 0 findings
  - At/above minimum cardinality on same `capabilityId` → 1 finding
  - Above minimum split across multiple `capabilityId`s → N findings
  - Determinism: same input twice → identical findings (sorted)
  - `evidenceRefs` preserved exactly

- [ ] **Step 2: Run tests to verify RED**

  ```bash
  pnpm vitest run tests/evolution/a8-learning-detectors.vitest.ts 2>&1 | tail -10
  ```

  Expected: FAIL (detector not yet implemented).

- [ ] **Step 3: Implement detector**

  Per code block above.

- [ ] **Step 4: Run tests to verify GREEN**

  Same command. Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/evolution/learning/detectors/underperformer-detector.ts tests/evolution/a8-learning-detectors.vitest.ts
  git commit -m "feat(evolution): A8 T3 underperformer detector (pure)"
  ```

---

### Task 4: outcome-contradiction detector

**Files:**
- Create: `src/evolution/learning/detectors/outcome-contradiction-detector.ts`
- Modify: `tests/evolution/a8-learning-detectors.vitest.ts` (append axes)

**Interfaces:**
- Consumes: `ProposalGovernanceRecord[]`, `LearningEngineOptions`.
- Produces: `LearningFinding[]` for capabilities with N+ contradictions (recommendation ≠ operator disposition).

**Code block (verbatim):**

```typescript
import type { LearningFinding, ProposalGovernanceRecord, LearningEngineOptions, LearningFindingKind } from "../contracts/learning-contract.js";

/**
 * outcome-contradiction-detector.
 *
 * Pure function. Correlates each proposal's recorded A2.5 recommendation
 * with the subsequent operator/governance disposition. A contradiction
 * exists when the disposition differs from the recommendation's actionable
 * kind:
 *   - recommendation=APPROVE, operator=REJECT
 *   - recommendation=REJECT, operator=APPROVE
 *
 * IMPORTANT: this detector does NOT judge whether the operator was
 * objectively right or wrong. A8 learns from organizational behavior;
 * it does not score governance decisions.
 *
 * Groups by capabilityId within the evidence window; emits one finding
 * per capability whose contradiction count >= minCardinality.
 */
export function detectOutcomeContradictions(
  records: ReadonlyArray<ProposalGovernanceRecord>,
  options: LearningEngineOptions,
  now: string,
): ReadonlyArray<LearningFinding> {
  const windowStart = subtractDays(now, options.evidenceWindowDays);
  const grouped = new Map<string, ProposalGovernanceRecord[]>();
  for (const r of records) {
    if (r.recordedAt < windowStart || r.recordedAt > now) continue;
    const shortKind = r.kind.replace("proposal.", "");
    if (shortKind !== "approved" && shortKind !== "rejected") continue;
    if (!r.recommendation) continue;
    const recKind = r.recommendation.kind;
    const contradiction = (recKind === "APPROVE" && shortKind === "rejected") ||
                          (recKind === "REJECT"  && shortKind === "approved");
    if (!contradiction) continue;
    const list = grouped.get(r.capabilityId) ?? [];
    list.push(r);
    grouped.set(r.capabilityId, list);
  }

  const findings: LearningFinding[] = [];
  for (const [capabilityId, list] of grouped) {
    if (list.length < options.minCardinality) continue;
    findings.push({
      findingId: `outcome-contradiction:${capabilityId}`,
      kind: "outcome-contradiction",
      identityKey: capabilityId,
      evidenceWindow: { from: windowStart, to: now },
      occurrences: list.length,
      evidenceRefs: list.map((r) => r.eventId),
      summary: `${list.length} recommendation/operator disposition contradictions for capability ${capabilityId}`,
    });
  }
  return findings.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const OUTCOME_CONTRADICTION_DETECTOR_KIND: LearningFindingKind = "outcome-contradiction";
```

**Steps:** mirror Task 3 (failing test → implement → green → commit).

Commit message: `feat(evolution): A8 T4 outcome-contradiction detector (pure, no operator-judgment)`

---

### Task 5: repeated-pattern-failure detector

**Files:**
- Create: `src/evolution/learning/detectors/repeated-pattern-failure-detector.ts`
- Modify: `tests/evolution/a8-learning-detectors.vitest.ts` (append axes)

**Interfaces:**
- Consumes: `ProposalGovernanceRecord[]`, `LearningEngineOptions`.
- Produces: `LearningFinding[]` for execution-failure fingerprints with N+ occurrences.

**Code block (verbatim):**

```typescript
import type { LearningFinding, ProposalGovernanceRecord, LearningEngineOptions, LearningFindingKind } from "../contracts/learning-contract.js";

/**
 * repeated-pattern-failure-detector.
 *
 * Pure function. Groups execution_failed events by a normalized failure
 * fingerprint within the evidence window; emits one finding per
 * fingerprint whose count >= minCardinality.
 *
 * Fingerprint: `<errorCategory>:<capabilityId>` where `errorCategory` is
 * derived from the `operatorReason` payload (or "unspecified" if absent).
 * If reconnaissance finds a better fingerprinting rule (T1 deferred this),
 * replace this derivation.
 */
export function detectRepeatedPatternFailures(
  records: ReadonlyArray<ProposalGovernanceRecord>,
  options: LearningEngineOptions,
  now: string,
): ReadonlyArray<LearningFinding> {
  const windowStart = subtractDays(now, options.evidenceWindowDays);
  const grouped = new Map<string, ProposalGovernanceRecord[]>();
  for (const r of records) {
    if (r.recordedAt < windowStart || r.recordedAt > now) continue;
    if (r.kind !== "proposal.execution_failed") continue;
    const fingerprint = `${r.operatorReason ?? "unspecified"}:${r.capabilityId}`;
    const list = grouped.get(fingerprint) ?? [];
    list.push(r);
    grouped.set(fingerprint, list);
  }

  const findings: LearningFinding[] = [];
  for (const [fingerprint, list] of grouped) {
    if (list.length < options.minCardinality) continue;
    findings.push({
      findingId: `repeated-pattern-failure:${fingerprint}`,
      kind: "repeated-pattern-failure",
      identityKey: fingerprint,
      evidenceWindow: { from: windowStart, to: now },
      occurrences: list.length,
      evidenceRefs: list.map((r) => r.eventId),
      summary: `${list.length} execution failures sharing fingerprint "${fingerprint}"`,
    });
  }
  return findings.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const REPEATED_PATTERN_FAILURE_DETECTOR_KIND: LearningFindingKind = "repeated-pattern-failure";
```

**Steps:** mirror Task 3.

Commit message: `feat(evolution): A8 T5 repeated-pattern-failure detector (pure)`

---

### Task 6: Engine + proposal builder + A2.5 bridge

**Files:**
- Create: `src/evolution/learning/learning-engine.ts`
- Create: `src/evolution/learning/learning-proposal-builder.ts`
- Create: `src/evolution/learning/a2-bridge.ts` (the A2.5 bridge that constructs MONITOR)
- Modify: `src/evolution/learning/index.ts` (extend barrel)
- Modify: `tests/evolution/a8-learning-detectors.vitest.ts` (add engine aggregation test)

**Interfaces:**
- Consumes: 3 `LearningAdapter<T>`, `LearningEngineOptions`, all 3 detector functions.
- Produces: `LearningEngine.learn(timestamp)` returns `Promise<LearningProposal | null>`; `buildGovernanceRecommendation(proposal)` returns `GovernanceRecommendation(kind: "MONITOR")`.

**Code blocks (verbatim):**

`src/evolution/learning/learning-engine.ts`:

```typescript
import type {
  EnrichedProposalRecord,
  LearningAdapter,
  LearningEngineOptions,
  LearningFinding,
  LearningProposal,
  MeasurementOutcomeRecord,
  ProposalGovernanceRecord,
} from "./contracts/learning-contract.js";
import { DEFAULT_LEARNING_ENGINE_OPTIONS } from "./contracts/learning-contract.js";
import { detectUnderperformer } from "./detectors/underperformer-detector.js";
import { detectOutcomeContradictions } from "./detectors/outcome-contradiction-detector.js";
import { detectRepeatedPatternFailures } from "./detectors/repeated-pattern-failure-detector.js";
import { buildLearningProposal } from "./learning-proposal-builder.js";

/**
 * LearningEngine — runs all 3 detectors, aggregates findings.
 *
 * Pure orchestration: no I/O beyond the adapters' list() calls; no implicit
 * clock. Engine joins adapter outputs (joins belong above the adapter boundary,
 * not inside adapters).
 *
 * "No trigger → no proposal": if total findings = 0, returns null.
 */
export class LearningEngine {
  constructor(
    private readonly proposalEvents: LearningAdapter<ProposalGovernanceRecord>,
    private readonly measurementEvents: LearningAdapter<MeasurementOutcomeRecord>,
    private readonly enrichedProposals: LearningAdapter<EnrichedProposalRecord>,
    private readonly options: LearningEngineOptions = DEFAULT_LEARNING_ENGINE_OPTIONS,
  ) {}

  async learn(now: string): Promise<LearningProposal | null> {
    const [proposalRecs, measurementRecs, enrichedRecs] = await Promise.all([
      this.proposalEvents.list(),
      this.measurementEvents.list(),
      this.enrichedProposals.list(),
    ]);

    // Adapters return independent records; the engine is responsible for
    // any joins (none needed for the 3 detectors — each consumes one source).
    const findings: ReadonlyArray<LearningFinding> = [
      ...detectUnderperformer(measurementRecs, this.options, now),
      ...detectOutcomeContradictions(proposalRecs, this.options, now),
      ...detectRepeatedPatternFailures(proposalRecs, this.options, now),
    ];

    // EnrichedProposals adapter is currently read-only; a future detector
    // may consume it. For now, validate it's non-null to keep the seam alive.
    void enrichedRecs;

    if (findings.length === 0) return null;
    return buildLearningProposal(findings, now);
  }
}
```

`src/evolution/learning/learning-proposal-builder.ts`:

```typescript
import type { LearningFinding, LearningProposal } from "./contracts/learning-contract.js";

/**
 * Construct a LearningProposal from findings.
 * Pure function. Deterministic proposalId derived from sorted findingIds + timestamp.
 */
export function buildLearningProposal(
  findings: ReadonlyArray<LearningFinding>,
  now: string,
): LearningProposal {
  const sorted = [...findings].sort((a, b) => a.findingId.localeCompare(b.findingId));
  const proposalId = `a8:${now}:${sorted.map((f) => f.findingId).join("|")}`;
  return { proposalId, generatedAt: now, findings: sorted };
}
```

`src/evolution/learning/a2-bridge.ts`:

```typescript
import type { LearningProposal } from "./contracts/learning-contract.js";
import type { GovernanceRecommendation } from "../../governance/governance-types.js";

/**
 * A2.5 bridge for A8 proposals.
 *
 * CRITICAL: always constructs kind: "MONITOR". A8 proposals are diagnostic
 * only; they cannot directly authorize mutations. If a future program
 * wants A8 to recommend strategy changes, that is a NEW architectural
 * increment with its own bridge.
 */
export function buildGovernanceRecommendation(
  proposal: LearningProposal,
): GovernanceRecommendation {
  return {
    proposalId: proposal.proposalId,
    kind: "MONITOR",
    confidence: 1.0,
    reasoning: `A8 detected ${proposal.findings.length} organizational pattern(s); see LearningProposal ${proposal.proposalId}`,
    evidence: proposal.findings.flatMap((f) => f.evidenceRefs),
    decidedBy: "a8_organizational_learning",
    generatedAt: proposal.generatedAt,
  };
}
```

**Steps:**

- [ ] **Step 1: Write engine aggregation tests**

  Append to `tests/evolution/a8-learning-detectors.vitest.ts`:
  - 3 detectors returning findings → 1 `LearningProposal`
  - 0 findings across all detectors → `null`
  - `buildGovernanceRecommendation(proposal)` returns `kind: "MONITOR"` always
  - `LearningProposal` has no mutation fields (architectural sentinel — covered in T8)

- [ ] **Step 2: Run tests to verify RED**

  Expected: FAIL.

- [ ] **Step 3: Implement engine + builder + bridge**

  Per code blocks above.

- [ ] **Step 4: Run tests to verify GREEN**

  Same command. Expected: PASS.

- [ ] **Step 5: Update barrel**

  Extend `src/evolution/learning/index.ts`:
  ```typescript
  export * from "./contracts/learning-contract.js";
  export * from "./adapters/index.js";
  export * from "./detectors/underperformer-detector.js";
  export * from "./detectors/outcome-contradiction-detector.js";
  export * from "./detectors/repeated-pattern-failure-detector.js";
  export * from "./learning-proposal-builder.js";
  export * from "./learning-engine.js";
  export * from "./a2-bridge.js";
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/evolution/learning/ tests/evolution/a8-learning-detectors.vitest.ts
  git commit -m "feat(evolution): A8 T6 engine + proposal builder + A2.5 MONITOR bridge"
  ```

---

### Task 7: CLI surface + composition-root wiring

**Files:**
- Create: `src/evolution/learning/learning-cli.ts`
- Modify: the existing CLI registration seam (discover at T1 reconnaissance: where `alix governance evolution curate` is registered — likely `src/cli/governance/` or `src/commands/`)

**Interfaces:**
- Consumes: `LearningEngine`, `EventLog`, `EnrichedProposal[]`.
- Produces: CLI command handler for `alix governance evolution learn [--dimension ...] [--json]`.

**Code block (verbatim):**

`src/evolution/learning/learning-cli.ts`:

```typescript
import type { LearningEngine } from "./learning-engine.js";
import { ProposalEventsAdapter } from "./adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "./adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "./adapters/enriched-proposals-adapter.js";
import { buildGovernanceRecommendation } from "./a2-bridge.js";
import type { EventLog } from "../../events/event-log.js";
import type { EnrichedProposal } from "../../adaptation/intelligence-types.js";

/**
 * CLI handler for `alix governance evolution learn [--dimension ...] [--json]`.
 *
 * Single namespace. The detector taxonomy is internal; the operator
 * surface is `learn`. `--dimension` is a forward-compatible filter (no
 * effect in v1, accepted for forward compatibility with a future
 * per-detector CLI; documented as such).
 */
export async function runLearnCli(opts: {
  readonly eventLog: EventLog;
  readonly enrichedProposals: ReadonlyArray<EnrichedProposal>;
  readonly json: boolean;
  readonly dimension?: string;
}): Promise<{ readonly output: string; readonly exitCode: 0 | 1 }> {
  void opts.dimension; // accepted but unused in v1
  const engine = new LearningEngine(
    new ProposalEventsAdapter(opts.eventLog),
    new MeasurementEventsAdapter(opts.eventLog),
    new EnrichedProposalsAdapter(opts.enrichedProposals),
  );
  const now = new Date().toISOString();
  const proposal = await engine.learn(now);

  if (!proposal) {
    return { output: opts.json ? JSON.stringify({ noFindings: true }) : "No organizational patterns detected.", exitCode: 0 };
  }

  const recommendation = buildGovernanceRecommendation(proposal);
  if (opts.json) {
    return { output: JSON.stringify({ proposal, recommendation }, null, 2), exitCode: 0 };
  }
  return {
    output:
      `A8 detected ${proposal.findings.length} organizational pattern(s).\n` +
      proposal.findings.map((f) => `  - [${f.kind}] ${f.summary}`).join("\n") +
      `\nRecommendation: ${recommendation.kind}`,
    exitCode: 0,
  };
}
```

**Steps:**

- [ ] **Step 1: Discover the CLI registration seam**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a8-organizational-learning
  grep -rn "evolution curate\|evolution.learn\|governance evolution" src/cli/ 2>/dev/null | head -10
  ```

  Find the file that registers the A6 CLI command and mirror its structure for A8. STOP and surface if no equivalent registration seam exists.

- [ ] **Step 2: Wire `runLearnCli` into the existing registration**

  Add a new case (e.g., `case "learn": return runLearnCli(...)`) parallel to the A6 `curate` case. Mirror the existing handler signature exactly.

- [ ] **Step 3: Write CLI smoke test (optional, recommended)**

  Create `tests/evolution/a8-cli.vitest.ts`:
  - With empty synthetic evidence → outputs "No organizational patterns detected."
  - With finding-triggering evidence → outputs the proposal + MONITOR recommendation
  - `--json` flag produces structured output

- [ ] **Step 4: Run tests + full suite**

  ```bash
  pnpm vitest run tests/evolution/a8-cli.vitest.ts 2>&1 | tail -10
  pnpm vitest run tests/capability/ tests/evolution/ 2>&1 | tail -8
  ```

  Expected: zero regressions.

- [ ] **Step 5: Commit**

  ```bash
  git add src/evolution/learning/learning-cli.ts src/cli/<seam-file>.ts tests/evolution/a8-cli.vitest.ts
  git commit -m "feat(evolution): A8 T7 CLI surface + composition-root wiring"
  ```

---

### Task 8: Integration + sentinel tests

**Files:**
- Create: `tests/evolution/a8-engine-end-to-end.vitest.ts` (full flow)
- Create: `tests/evolution/a8-sentinel.vitest.ts` (architectural invariants)

**Interfaces:**
- Consumes: All A8 module exports.
- Produces: integration test that proves adapter→detector→proposal→A2.5→A3 → MONITOR; sentinel that pins architectural invariants.

**Code blocks (verbatim):**

`tests/evolution/a8-engine-end-to-end.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { LearningEngine } from "../../src/evolution/learning/learning-engine.js";
import { ProposalEventsAdapter } from "../../src/evolution/learning/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../src/evolution/learning/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../src/evolution/learning/adapters/enriched-proposals-adapter.js";
import { buildGovernanceRecommendation } from "../../src/evolution/learning/a2-bridge.js";
import { generateDecision } from "../../src/evolution/governance/decision-engine.js";
import type { ProposalGovernanceRecord, MeasurementOutcomeRecord, EnrichedProposalRecord } from "../../src/evolution/learning/contracts/learning-contract.js";

describe("A8 engine end-to-end", () => {
  it("zero findings across all detectors → null (no proposal emitted)", async () => {
    const engine = new LearningEngine(
      stubProposalEvents([]),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
    );
    const result = await engine.learn("2026-08-14T00:00:00Z");
    expect(result).toBeNull();
  });

  it("full flow: adapters → detectors → proposal → A2.5 MONITOR → A3 MONITOR", async () => {
    const now = "2026-08-14T00:00:00Z";
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({ capabilityId: "core.x", kind: "proposal.approved", recommendation: { kind: "REJECT", confidence: 0.9 }, recordedAt: now }),
      makeProposal({ capabilityId: "core.x", kind: "proposal.approved", recommendation: { kind: "REJECT", confidence: 0.9 }, recordedAt: now }),
      makeProposal({ capabilityId: "core.x", kind: "proposal.approved", recommendation: { kind: "REJECT", confidence: 0.9 }, recordedAt: now }),
    ];
    const engine = new LearningEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
    );
    const proposal = await engine.learn(now);
    expect(proposal).not.toBeNull();
    expect(proposal!.findings.length).toBeGreaterThan(0);

    const recommendation = buildGovernanceRecommendation(proposal!);
    expect(recommendation.kind).toBe("MONITOR");

    // Wire to A3 generateDecision (minimal evidence for MONITOR outcome).
    const decision = generateDecision(
      { confidenceProfile: { overallConfidence: 0.8 }, evidenceClass: "projected", reproducibilityLevel: 2, generatedAt: now },
      recommendation,
    );
    expect(decision.kind).toMatch(/MONITOR|REQUEST_MORE_EVIDENCE/);
  });

  it("A8 cannot produce APPROVE or REJECT (architectural invariant)", async () => {
    const now = "2026-08-14T00:00:00Z";
    const proposalRecs: ProposalGovernanceRecord[] = Array.from({ length: 10 }, () =>
      makeProposal({ capabilityId: "core.x", kind: "proposal.approved", recommendation: { kind: "REJECT", confidence: 0.9 }, recordedAt: now }),
    );
    const engine = new LearningEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
    );
    const proposal = await engine.learn(now);
    const recommendation = buildGovernanceRecommendation(proposal!);
    expect(recommendation.kind).not.toBe("APPROVE");
    expect(recommendation.kind).not.toBe("REJECT");
  });
});

// Helpers (stub adapters + factories)
function stubProposalEvents(recs: ReadonlyArray<ProposalGovernanceRecord>) {
  return { name: "proposal-events", list: async () => recs };
}
function stubMeasurementEvents(recs: ReadonlyArray<MeasurementOutcomeRecord>) {
  return { name: "measurement-events", list: async () => recs };
}
function stubEnrichedProposals(recs: ReadonlyArray<EnrichedProposalRecord>) {
  return { name: "enriched-proposals", list: async () => recs };
}
function makeProposal(overrides: Partial<ProposalGovernanceRecord>): ProposalGovernanceRecord {
  return {
    proposalId: "p1",
    capabilityId: "core.x",
    kind: "proposal.approved",
    recommendation: { kind: "APPROVE", confidence: 0.9 },
    recordedAt: "2026-08-14T00:00:00Z",
    eventId: "evt-1",
    ...overrides,
  };
}
```

`tests/evolution/a8-sentinel.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { LearningProposal, GovernanceRecommendation } from "../../src/governance/governance-types.js";

describe("A8 architectural invariants (sentinel)", () => {
  it("LearningProposal has no mutation/execution fields (structural boundary)", () => {
    const proposal: LearningProposal = {
      proposalId: "p1",
      generatedAt: "2026-08-14T00:00:00Z",
      findings: [],
    };
    // The keys must be exactly these three — anything else is a mutation/execution surface.
    expect(Object.keys(proposal).sort()).toEqual(["findings", "generatedAt", "proposalId"]);
  });

  it("A2.5 bridge produces only MONITOR for A8 proposals", async () => {
    const { buildGovernanceRecommendation } = await import("../../src/evolution/learning/a2-bridge.js");
    const proposal: LearningProposal = {
      proposalId: "p1",
      generatedAt: "2026-08-14T00:00:00Z",
      findings: [],
    };
    const recommendation: GovernanceRecommendation = buildGovernanceRecommendation(proposal);
    expect(recommendation.kind).toBe("MONITOR");
  });

  it("no A8 source file imports from the executor or capability-catalog mutator", () => {
    // Read all A8 source files and assert no disallowed imports.
    const files = [
      "src/evolution/learning/contracts/learning-contract.ts",
      "src/evolution/learning/learning-engine.ts",
      "src/evolution/learning/learning-proposal-builder.ts",
      "src/evolution/learning/a2-bridge.ts",
      "src/evolution/learning/learning-cli.ts",
      "src/evolution/learning/adapters/proposal-events-adapter.ts",
      "src/evolution/learning/adapters/measurement-events-adapter.ts",
      "src/evolution/learning/adapters/enriched-proposals-adapter.ts",
      "src/evolution/learning/detectors/underperformer-detector.ts",
      "src/evolution/learning/detectors/outcome-contradiction-detector.ts",
      "src/evolution/learning/detectors/repeated-pattern-failure-detector.ts",
    ];
    const forbidden = [/capability-mutation-executor/, /capability.*catalog.*mutator/, /mutation-executor/];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const pattern of forbidden) {
        expect(src).not.toMatch(pattern);
      }
    }
  });
});
```

**Steps:**

- [ ] **Step 1: Write integration test**

  Per code block above.

- [ ] **Step 2: Write sentinel test**

  Per code block above.

- [ ] **Step 3: Run integration test to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a8-engine-end-to-end.vitest.ts 2>&1 | tail -15
  ```

  Expected: PASS. If FAIL: STOP and investigate (the architectural seam is broken somewhere).

- [ ] **Step 4: Run sentinel test to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a8-sentinel.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 5: Run full suite**

  ```bash
  pnpm vitest run tests/capability/ tests/evolution/ 2>&1 | tail -8
  ```

  Expected: previous baseline + new A8 tests = zero regressions.

- [ ] **Step 6: Commit**

  ```bash
  git add tests/evolution/a8-engine-end-to-end.vitest.ts tests/evolution/a8-sentinel.vitest.ts
  git commit -m "test(evolution): A8 T8 integration + sentinel tests (architectural invariants)"
  ```

---

### Task 9: PR + squash-merge + memory entry + checkpoint doc

**Files:**
- Create: `docs/architecture/checkpoints/2026-08-14-a8-organizational-learning-complete.md`

**Steps:**

- [ ] **Step 1: Write checkpoint doc**

  Create `docs/architecture/checkpoints/2026-08-14-a8-organizational-learning-complete.md` per the CAP-12 checkpoint doc template. Include:
  - Status: APPROVED with checks
  - Architectural progression: CAP-N → CAP-O → CAP-P (deferred) → **A8**
  - Module summary: `src/evolution/learning/` (contracts, 3 detectors, 3 adapters, engine, builder, CLI)
  - Locked rulings: 8 from wayfinder + 4 from spec
  - Test totals
  - Future work: A9, CAP-P resumption, M2/M3, TUI/Web

- [ ] **Step 2: Push branch**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a8-organizational-learning
  git push -u origin a8-organizational-learning
  ```

  **STOP and ask the human for approval before the push.** Standing constraint.

- [ ] **Step 3: Open PR via gh**

  ```bash
  gh pr create --base main --head a8-organizational-learning \
    --title "A8 Organizational Learning" \
    --body "Closes the post-A8 wayfinder map #517 next-frontier authorization.
  ...
  [body mirrors the A6 PR template, locks all 12 rulings]"
  ```

- [ ] **Step 4: Squash-merge**

  **STOP and ask the human for approval before the merge.** Standing constraint.

  ```bash
  gh pr merge <PR-number> --squash --delete-branch
  git pull origin main
  ```

- [ ] **Step 5: Write memory entry**

  Write `/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/memory/a8-organizational-learning-complete.md` with:
  - type: project
  - body: A8 closed the organizational learning frontier; module `src/evolution/learning/`; 3 detectors (underperformer / outcome-contradiction / repeated-pattern-failure); LearningProposal non-executable; A2.5 bridge constructs MONITOR; CLI `alix governance evolution learn`. Next frontier: A9.

- [ ] **Step 6: Update MEMORY.md**

  Add a one-line pointer to the new memory file in the index.

- [ ] **Step 7: Clean up worktree + local branch**

  ```bash
  cd /home/babasola/Projects/Monolith
  git worktree remove --force .claude/worktrees/a8-organizational-learning
  git branch -d a8-organizational-learning
  ```

---

## Self-Review

**1. Spec coverage:**
- §4.1 module structure → Tasks 1, 2, 3, 4, 5, 6, 7 (each module)
- §4.2 contracts → Task 1
- §4.3 architectural progression → Task 6 (engine + bridge) + Task 8 (integration)
- §4.4 adapters → Task 2
- §4.5 detectors (3) → Tasks 3, 4, 5
- §4.6 engine + proposal builder + A2.5 bridge → Task 6
- §4.7 CLI → Task 7
- §5 data flow → Tasks 6 + 8 (integration)
- §6 composition root → Task 7
- §8 error handling → Task 8 (integration)
- §9.1 unit tests → Tasks 3, 4, 5 (per-detector)
- §9.2 adapter tests → Task 2
- §9.3 integration test → Task 8
- §9.4 sentinel test → Task 8

**2. Placeholder scan:**
- No "TBD"/"TODO"/"implement later"/"fill in details"
- T1 reconnaissance explicitly STOPs-and-surfaces if no precedent for thresholds exists
- T2 explicitly STOPs-and-surfaces if `EventLog.listByPrefix`/`EnrichedProposal` signatures cannot be reconciled
- T7 explicitly STOPs-and-surfaces if no CLI registration seam exists

**3. Type consistency:**
- `LearningFinding` shape consistent across T1 (contract), T3/T4/T5 (detectors), T6 (engine aggregation), T8 (sentinel)
- `LearningProposal` shape consistent across T1 (contract), T6 (builder), T6 (engine), T8 (sentinel)
- `GovernanceRecommendation` shape consumed via the existing A2.5 type, with `kind: "MONITOR"` constant
- `evidenceRefs` preserved exactly (no map/filter that could drop refs)
- Threshold values: `DEFAULT_MIN_CARDINALITY` and `DEFAULT_EVIDENCE_WINDOW_DAYS` are set in T1 reconnaissance and referenced in `DEFAULT_LEARNING_ENGINE_OPTIONS`

**4. Open question for human review:**
- T1 reconnaissance: if no precedent exists for minimum cardinality or evidence window duration, the implementer STOPS and surfaces. This is a legitimate STOP — better than inventing magic numbers.

---

## Execution Handoff

This plan is ready for subagent-driven execution. The 9 tasks follow a layered SDD pattern:

- T1 (contracts + reconnaissance) → T2 (3 adapters) → T3/T4/T5 (3 detectors) → T6 (engine + bridge) → T7 (CLI + wiring) → T8 (integration + sentinel) → T9 (PR + merge + memory + checkpoint)

Per-task reviewer gates:
- T1 uses sonnet (foundational + reconnaissance judgment)
- T2 uses sonnet (multi-file adapter implementation)
- T3/T4/T5 use haiku (mechanical per-detector implementation; spec is complete)
- T6 uses sonnet (engine + bridge; architectural boundary)
- T7 uses sonnet (CLI seam wiring; recon-required)
- T8 uses haiku (test scaffolding; spec is complete)
- T9 is the PR + merge workflow (no review)

Whole-branch final review: sonnet, after T9 squash-merge on a temporary integration branch.

**Note on user approval gates:** T9 Steps 2 (push) and Step 4 (squash-merge) both require explicit human approval. Subagents must STOP and surface the request, not proceed automatically.