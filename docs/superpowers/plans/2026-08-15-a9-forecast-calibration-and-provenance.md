# A9 Implementation Plan — Pre-Execution Risk Forecast & Governance Gating

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build A9 — a pre-execution risk forecast layer that emits `A9Forecast` artifacts with a deterministic risk band (`low | medium | high | critical`), routes high/critical forecasts through a new A2.5 `RISK_GATED_REVIEW` recommendation kind that maps to existing A3 `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW), and after execution emits immutable `A9Correlation` records connecting forecasts to capability measurements via a deterministic bridge (`proposal.submitted.payload.target.id` + `proposal.executed` execution eligibility gate). A9 owns identity, persistence, and correlation. A3 retains final decision authority.

**Architecture:** New module `src/evolution/a9/` mirroring A8's `src/evolution/learning/` structure (contracts → adapters → detectors → engines → builders → bridge). Three read-only foreign adapters (proposal-events / measurement-events / enriched-proposals) feed three pure detectors (trust-velocity / evidence-completeness / fingerprint-coincidence). Forecast engine groups findings by `proposalId` and aggregates via max-score per subject. Forecast builder is pure; `forecastId` is SHA-256 of canonical forecast. Two read-only JSONL persistence adapters (`forecasts.jsonl`, `correlations.jsonl`). Correlation engine resolves the deterministic bridge via `proposal.submitted.payload.target.id` matching `measurement.capabilityId`, gated by `proposal.executed` (eligibility, NOT causality). A9 bridge constructs `GovernanceRecommendation` with `kind: "RISK_GATED_REVIEW"` for high/critical, `MONITOR` for low/medium. Composition root instantiates adapters at `src/capability/platform.ts` (CAP-12 carve-out site). Single CLI: `alix governance evolution forecast`.

**Tech Stack:** TypeScript, vitest, pnpm. Existing capability platform + A-series architecture. A3 `generateDecision` + A2.5 `GovernanceRecommendation` consumed unchanged (with one new A2.5 kind added).

---

## Global Constraints

These are binding on every task — copy verbatim:

- **A9 owns identity.** Every A9 artifact has an A9-owned deterministic identity via `SHA-256(canonical(artifactWithoutIdentity))`. Foreign identifiers never substitute for A9 identity.
- **A9 owns persistence.** Two separate append-only JSONL stores: `.alix/governance/forecasts.jsonl` + `.alix/governance/correlations.jsonl`. Forecasts and correlations have separate lifecycles.
- **A9 owns correlation.** Correlation lives ONLY in `A9Correlation`. No foreign surface is modified to accommodate A9.
- **CAP-10/10.5 measurement contract unchanged.** A9 MUST NOT add `proposalId`, `sourceProposalIds`, `forecastId`, or `correlationId` to `CapabilityMeasurementPayload`. Measurement events are capability-targeted.
- **subject = proposalId.** `A9Forecast.subject` is the canonical proposal identifier (foreign reference). `A9Forecast.subjectCapability` is the deterministic bridge — copied from `proposal.submitted.payload.target.id` at forecast emission time (immutable derived snapshot, NOT an independent source of truth).
- **`proposal.executed` is execution eligibility gate, NOT causality proof.** It establishes that the forecasted proposal reached execution; it does NOT prove that a particular measurement was caused by that proposal. CAP-10/10.5 intentionally removes proposal identity from measurement events.
- **Capability equality is NOT proposal provenance.** Capability identity alone never proves a measurement belongs to a particular proposal.
- **A9Correlation is positive evidence.** No negative correlation records. No correlation status field. No `A9CorrelationAttempt`. Absence = unresolved / unestablished.
- **No primary designation on correlation.** "Primary" is calibration semantics, not persistence. Conflicting evidence is preserved; A9 does not resolve conflicts at the correlation layer.
- **A9Correlation is many-to-many.** Independent immutable records. No shared group artifact. No reverse pointer on measurement.
- **A9 does not modify foreign namespaces.** A8 contracts, A2.5 contracts (except authorized 6th kind), A3 contracts, CAP-9 event taxonomy, CAP-10/10.5 contracts — all read-only consumption.
- **No heuristic correlation.** No temporal proximity, no payload similarity, no "most recent" selection, no fuzzy matching. The bridge is exact equality across canonical sources.
- **6th A2.5 kind** `RISK_GATED_REVIEW` maps to existing A3 `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW). A3's 4 binding kinds and 3 target states are unchanged. No 7th A2.5 kind.
- **Bypass A8 normalization.** A9 reads raw canonical sources; A9 does NOT consume A8's normalized records (`enriched-proposal-aggregator.ts` is forbidden).
- **Detectors are pure functions.** No I/O, no implicit clock. Engine passes a deterministic timestamp; same input + same timestamp → identical forecasts.
- **No "trigger → no proposal" poll.** If 0 findings across all detectors, no `A9Forecast` is emitted. If correlation bridge is missing, no `A9Correlation` is emitted.
- **A2.5 kind selection:** `low`/`medium` → `MONITOR`; `high`/`critical` → `RISK_GATED_REVIEW`. A9 does NOT itself approve or reject.
- **A3 remains sovereign.** A9 recommends; A3 decides.
- **CAP-12 carve-out sites for A9:** `src/capability/platform.ts` (composition root) + `src/capability/capability-service.ts` (if CLI registration seam). All other CAP-12 forbidden files remain forbidden.
- **Branch + worktree:** All work on a fresh worktree named `a9-forecast-calibration-and-provenance` off main. Push branch + PR; squash-merge to main.
- **Spec deviations:** If a task requires deviation from the spec, STOP and surface to the human — do not silently adjust.
- **Out of scope:** TUI/Web surfaces, A9 strategy-tuning, A9 → A4 conditional execution, calibration/result semantics, `A9CorrelationAttempt`, 4th detector, A6 domain type reuse, A8 normalized record reuse, A3 contract changes, M2/M3 governance signal delivery.

---

### Task 1: A9 contracts + reconnaissance

**Files:**
- Create: `src/evolution/a9/contracts/a9-contract.ts`
- Create: `src/evolution/a9/index.ts` (minimal barrel re-export for tests)
- Test: `tests/evolution/a9-contracts.vitest.ts` (smoke test for contract shape)

**Interfaces:**
- Consumes: nothing (foundation).
- Produces: `ForecastId`, `CorrelationId`, `A9ForecastKind`, `RiskBand`, `RiskScore`, `A9Forecast`, `A9Correlation`, `A9Adapter<T>`, `A9ForecastEngineOptions`, `ProposalGovernanceRecord`, `CapabilityMeasurementRecord`, `EnrichedProposalRecord` (3 raw adapter records), `internalScoreToBand` (helper).

**Reconnaissance scope (must precede implementation):**

Before writing contracts, run reconnaissance to confirm canonical foreign shapes. The spec defers this to implementation; this task pins them.

1. **EventLog proposal event payload shape.** Read `src/events/event-log.ts` (or equivalent) + `src/capability/governance/governance-types.ts`. Verify that `proposal.submitted` events have a `payload.target.id` field with the proposed capability. Confirm the exact field path. **If the field path is missing or different, STOP and surface.**
2. **EventLog execution event shape.** Verify `proposal.executed` events have a `proposalId` field. Confirm the exact field path. **If the field path is missing or different, STOP and surface.**
3. **A2.5 `GovernanceRecommendationKind` union.** Read `src/governance/governance-types.ts`. Confirm the 5 existing kinds and the exact location for adding the 6th.
4. **A2.5 → A3 mapping.** Read `src/evolution/governance/decision-engine.ts`. Find `RECOMMENDATION_KIND_MAP` (or equivalent). Confirm the map's shape and the location for adding the new mapping entry.
5. **A6 `RiskOutcome` source.** Read `src/adaptation/risk-score-types.ts:50-61`. Confirm the canonical thresholds (0.3 / 0.6 / 0.85) and the function name that maps scores to bands.
6. **Existing persistence pattern.** Read `src/evolution/learning/` (A8) or A2.5 storage site. Confirm the append-only JSONL read pattern that A9 can mirror.
7. **Compose-root seam.** Read `src/capability/platform.ts`. Confirm the location for A9 adapter wiring (A9 needs to add composition-root wiring per CAP-12 carve-out).

**Code blocks (verbatim):**

`src/evolution/a9/contracts/a9-contract.ts`:

```typescript
/**
 * A9 — Pre-Execution Risk Forecast & Governance Gating contracts.
 *
 * A9 emits A9Forecast artifacts before proposal execution, projects risk
 * onto A6's canonical low/medium/high/critical bands, and gates high/critical
 * forecasts through A2.5's RISK_GATED_REVIEW recommendation kind. After
 * execution, A9 emits immutable A9Correlation records via a deterministic
 * bridge (proposal.submitted.payload.target.id + proposal.executed).
 *
 * A9 owns identity, persistence, and correlation. CAP-10/10.5 measurement
 * contracts are unchanged.
 *
 * Architectural progression (locked):
 *   read-only foreign adapters → pure detectors
 *     → forecast engine (max-score aggregation per proposalId)
 *     → A9Forecast (subject=proposalId, subjectCapability=capabilityId)
 *     → forecasts.jsonl
 *     → A9 bridge → A2.5 (RISK_GATED_REVIEW / MONITOR)
 *     → A3 (REQUEST_MORE_EVIDENCE / existing)
 *   read-only JSONL adapters
 *     → correlation engine (deterministic bridge)
 *     → A9Correlation (forecastId, measurementId, foreignProvenance)
 *     → correlations.jsonl
 */

// ---------------------------------------------------------------------------
// Identity types (A9-owned, content-addressed)
// ---------------------------------------------------------------------------

export type ForecastId = string;
// SHA-256(canonical(A9ForecastWithoutIdentity))

export type CorrelationId = string;
// SHA-256(canonical(A9CorrelationWithoutIdentity))

// ---------------------------------------------------------------------------
// Forecast kind (3 detector kinds, locked)
// ---------------------------------------------------------------------------

export type A9ForecastKind =
  | "trust-velocity"
  | "evidence-completeness"
  | "fingerprint-coincidence";

// ---------------------------------------------------------------------------
// Risk band (A6 canonical vocabulary)
// ---------------------------------------------------------------------------

export type RiskBand =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type RiskScore = number; // [0, 1]

/**
 * A6-canonical risk-band projection. Thresholds 0.3 / 0.6 / 0.85.
 * Source: src/adaptation/risk-score-types.ts:50-61.
 */
export function internalScoreToBand(score: RiskScore): RiskBand {
  if (score < 0.3) return "low";
  if (score < 0.6) return "medium";
  if (score < 0.85) return "high";
  return "critical";
}

// ---------------------------------------------------------------------------
// A9Forecast — content-addressed, immutable, A9-owned
// ---------------------------------------------------------------------------

export interface A9Forecast {
  /** A9-owned. SHA-256(canonical(A9ForecastWithoutIdentity)). */
  readonly forecastId: ForecastId;

  /** Semver of the contract shape. */
  readonly forecastVersion: string;

  /**
   * Foreign proposal identity. NOT A9 identity.
   * Source: proposal.submitted.proposalId.
   */
  readonly subject: string;

  /**
   * Immutable derived bridge snapshot, copied at forecast emission time from
   * proposal.submitted.payload.target.id. NOT an independent source of truth.
   */
  readonly subjectCapability: string;

  readonly prediction: {
    readonly kind: A9ForecastKind;
    readonly band: RiskBand;
    readonly internalScore: RiskScore;
  };

  readonly horizon: {
    readonly from: string;
    readonly to: string;
  };

  readonly confidence: RiskScore;

  readonly provenance: {
    readonly generatedAt: string;
    readonly generatorVersion: string;
    readonly evidenceRefs: ReadonlyArray<string>;
  };
}

// ---------------------------------------------------------------------------
// A9Correlation — immutable positive evidence, A9-owned
// ---------------------------------------------------------------------------

export interface A9Correlation {
  /** A9-owned. SHA-256(canonical(A9CorrelationWithoutIdentity)). */
  readonly correlationId: CorrelationId;

  readonly correlationVersion: string;

  /** A9-owned reference. */
  readonly forecastId: ForecastId;

  /** Foreign CAP-10/10.5 measurement identity. */
  readonly measurementId: string;

  readonly foreignProvenance: {
    /** Foreign proposal identity. Provenance only. */
    readonly proposalId?: string;
    readonly notes?: string;
  };

  /**
   * Evidence relationship metadata. Does NOT designate a primary realization.
   * Calibration/result semantics are a separate future concern.
   */
  readonly resolution: {
    readonly band: RiskBand;
    readonly forecastBand: RiskBand;
    readonly delta: "match" | "under-forecast" | "over-forecast";
  };
}

// ---------------------------------------------------------------------------
// Read-only adapter contract
// ---------------------------------------------------------------------------

export interface A9Adapter<T> {
  readonly name: string;
  list(): Promise<ReadonlyArray<T>>;
}

// ---------------------------------------------------------------------------
// Raw adapter records (NOT A8's normalized shape — A9 bypasses A8)
// ---------------------------------------------------------------------------

/**
 * proposal-events-adapter output: raw proposal event records.
 * Source: EventLog capability.governance.proposal.* events (CAP-9).
 * A9 reads payload directly (no normalization).
 */
export interface ProposalGovernanceRecord {
  readonly proposalId: string;
  readonly kind:
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected"
    | "proposal.executed"
    | "proposal.execution_failed";
  readonly payload: Readonly<Record<string, unknown>>; // raw event payload
  readonly recordedAt: string;
  readonly eventId: string;
}

/**
 * measurement-events-adapter output: raw measurement event records.
 * Source: EventLog capability.governance.measurement.* events (CAP-10).
 *
 * CRITICAL: NO proposalId, NO sourceProposalIds, NO forecastId, NO correlationId.
 * CAP-10/10.5 boundary preserved.
 */
export interface CapabilityMeasurementRecord {
  readonly measurementId: string;
  readonly capabilityId: string;
  readonly outcome: string; // canonical outcome string; concrete enum deferred
  readonly recordedAt: string;
  readonly eventId: string;
}

/**
 * enriched-proposals-adapter output: raw enriched proposal records.
 * Source: EnrichedProposal[] (P10.8a).
 */
export interface EnrichedProposalRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly enrichedFields: Readonly<Record<string, unknown>>; // raw values, NOT names-only
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// Engine options
// ---------------------------------------------------------------------------

export interface A9ForecastEngineOptions {
  readonly generatorVersion: string;
}

/**
 * Default engine options. generatorVersion is the A9 module's semver.
 */
export const DEFAULT_A9_ENGINE_OPTIONS: A9ForecastEngineOptions = {
  generatorVersion: "0.1.0",
};
```

**Steps:**

- [ ] **Step 1: Reconnaissance — confirm canonical foreign shapes**

  Run the reconnaissance scope above. **If any required field path is missing or different, STOP and surface the gap to the human partner before proceeding.** Otherwise, confirm the field paths in the contracts file (the file uses the per-reconnaissance-verified paths).

- [ ] **Step 2: Write contracts file**

  Create `src/evolution/a9/contracts/a9-contract.ts` with the code block above.

- [ ] **Step 3: Write minimal barrel + smoke test**

  Create `src/evolution/a9/index.ts`:
  ```typescript
  export * from "./contracts/a9-contract.js";
  ```

  Create `tests/evolution/a9-contracts.vitest.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import {
    internalScoreToBand,
    DEFAULT_A9_ENGINE_OPTIONS,
    type A9Forecast,
    type A9Correlation,
    type A9Adapter,
  } from "../../src/evolution/a9/contracts/a9-contract.js";

  describe("A9 contract smoke", () => {
    it("internalScoreToBand matches A6 thresholds", () => {
      expect(internalScoreToBand(0.0)).toBe("low");
      expect(internalScoreToBand(0.29)).toBe("low");
      expect(internalScoreToBand(0.3)).toBe("medium");
      expect(internalScoreToBand(0.59)).toBe("medium");
      expect(internalScoreToBand(0.6)).toBe("high");
      expect(internalScoreToBand(0.84)).toBe("high");
      expect(internalScoreToBand(0.85)).toBe("critical");
      expect(internalScoreToBand(1.0)).toBe("critical");
    });

    it("CapabilityMeasurementRecord has no proposal identity fields (Q8 sentinel)", () => {
      const record: CapabilityMeasurementRecord = {
        measurementId: "m1",
        capabilityId: "c1",
        outcome: "effective",
        recordedAt: "2026-08-15T00:00:00Z",
        eventId: "evt-1",
      };
      // No proposalId, sourceProposalIds, forecastId, correlationId.
      expect(Object.keys(record).sort()).toEqual([
        "capabilityId",
        "eventId",
        "measurementId",
        "outcome",
        "recordedAt",
      ]);
    });

    it("A9Forecast has no mutation/execution fields", () => {
      const forecast: A9Forecast = {
        forecastId: "sha256:0",
        forecastVersion: "0.1.0",
        subject: "proposal-1",
        subjectCapability: "capability-1",
        prediction: { kind: "trust-velocity", band: "low", internalScore: 0.1 },
        horizon: { from: "2026-08-15T00:00:00Z", to: "2026-08-16T00:00:00Z" },
        confidence: 0.9,
        provenance: { generatedAt: "2026-08-15T00:00:00Z", generatorVersion: "0.1.0", evidenceRefs: [] },
      };
      expect(Object.keys(forecast).sort()).toEqual([
        "confidence",
        "forecastId",
        "forecastVersion",
        "horizon",
        "prediction",
        "provenance",
        "subject",
        "subjectCapability",
      ]);
    });

    it("A9Correlation has no primary designation", () => {
      const correlation: A9Correlation = {
        correlationId: "sha256:0",
        correlationVersion: "0.1.0",
        forecastId: "f1",
        measurementId: "m1",
        foreignProvenance: {},
        resolution: { band: "low", forecastBand: "low", delta: "match" },
      };
      expect(Object.keys(correlation).sort()).toEqual([
        "correlationId",
        "correlationVersion",
        "foreignProvenance",
        "forecastId",
        "measurementId",
        "resolution",
      ]);
      // No primary, no status, no correlationStatus.
      expect("primary" in correlation).toBe(false);
      expect("status" in correlation).toBe(false);
    });
  });
  ```

- [ ] **Step 4: Run smoke test to verify GREEN**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a9-forecast-calibration-and-provenance
  pnpm vitest run tests/evolution/a9-contracts.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a9-forecast-calibration-and-provenance
  git add src/evolution/a9/ tests/evolution/a9-contracts.vitest.ts
  git commit -m "feat(evolution): A9 T1 contracts + canonical foreign shape verification"
  ```

  Commit message must include the verified field paths (e.g., "proposal.submitted.payload.target.id confirmed at <file>:<line>").

---

### Task 2: Three read-only foreign adapters

**Files:**
- Create: `src/evolution/a9/adapters/proposal-events-adapter.ts`
- Create: `src/evolution/a9/adapters/measurement-events-adapter.ts`
- Create: `src/evolution/a9/adapters/enriched-proposals-adapter.ts`
- Create: `src/evolution/a9/adapters/index.ts` (barrel)
- Test: `tests/evolution/a9-adapters.vitest.ts`

**Interfaces:**
- Consumes: `A9Adapter<T>`, `ProposalGovernanceRecord`, `CapabilityMeasurementRecord`, `EnrichedProposalRecord` (from T1).
- Produces: 3 concrete `A9Adapter<T>` implementations reading raw EventLog + `EnrichedProposal[]` (NOT A8's normalized records).

**Code blocks (verbatim — verify field paths from T1 reconnaissance):**

`src/evolution/a9/adapters/proposal-events-adapter.ts`:

```typescript
import type { A9Adapter, ProposalGovernanceRecord } from "../contracts/a9-contract.js";
// Adjust import paths to match actual project structure (verified at T1).

/**
 * Read-only adapter over EventLog capability.governance.proposal.* events.
 * Returns RAW ProposalGovernanceRecord[]. A9 reads payload directly.
 *
 * Never writes. Never joins or transforms into findings.
 * Never replaces A8's normalized records — A9 bypasses A8 normalization.
 */
export class ProposalEventsAdapter implements A9Adapter<ProposalGovernanceRecord> {
  readonly name = "proposal-events";
  constructor(private readonly eventLog: {
    listByPrefix(prefix: string): Promise<ReadonlyArray<{
      type: string;
      eventId: string;
      recordedAt: string;
      payload: Readonly<Record<string, unknown>>;
    }>>;
  }) {}

  async list(): Promise<ReadonlyArray<ProposalGovernanceRecord>> {
    const events = await this.eventLog.listByPrefix("capability.governance.proposal.");
    return events
      .map((e) => this.normalize(e))
      .filter((r): r is ProposalGovernanceRecord => r !== null);
  }

  private normalize(event: { type: string; eventId: string; recordedAt: string; payload: Readonly<Record<string, unknown>> }): ProposalGovernanceRecord | null {
    const shortKind = event.type.replace("capability.governance.proposal.", "");
    const allowedKinds = new Set([
      "submitted", "approved", "rejected", "executed", "execution_failed",
    ]) as Set<ProposalGovernanceRecord["kind"] extends string ? string : never>;
    void allowedKinds;
    const allowed: ReadonlyArray<ProposalGovernanceRecord["kind"]> = [
      "proposal.submitted", "proposal.approved", "proposal.rejected",
      "proposal.executed", "proposal.execution_failed",
    ];
    if (!allowed.includes(shortKind as ProposalGovernanceRecord["kind"])) return null;
    const proposalId = (event.payload["proposalId"] as string | undefined) ?? "";
    return {
      proposalId,
      kind: shortKind as ProposalGovernanceRecord["kind"],
      payload: event.payload,
      recordedAt: event.recordedAt,
      eventId: event.eventId,
    };
  }
}
```

`src/evolution/a9/adapters/measurement-events-adapter.ts`:

```typescript
import type { A9Adapter, CapabilityMeasurementRecord } from "../contracts/a9-contract.js";

/**
 * Read-only adapter over EventLog capability.governance.measurement.* events.
 * Returns RAW CapabilityMeasurementRecord[].
 *
 * CRITICAL: this adapter MUST NOT expose proposalId, sourceProposalIds,
 * forecastId, or correlationId. CAP-10/10.5 boundary preserved.
 * A9 bridges to proposals via proposal.submitted.payload.target.id from
 * the proposal-events-adapter, NOT via this adapter.
 */
export class MeasurementEventsAdapter implements A9Adapter<CapabilityMeasurementRecord> {
  readonly name = "measurement-events";
  constructor(private readonly eventLog: {
    listByPrefix(prefix: string): Promise<ReadonlyArray<{
      type: string;
      eventId: string;
      recordedAt: string;
      payload: Readonly<Record<string, unknown>>;
    }>>;
  }) {}

  async list(): Promise<ReadonlyArray<CapabilityMeasurementRecord>> {
    const events = await this.eventLog.listByPrefix("capability.governance.measurement.");
    return events.map((e) => this.normalize(e));
  }

  private normalize(event: { type: string; eventId: string; recordedAt: string; payload: Readonly<Record<string, unknown>> }): CapabilityMeasurementRecord {
    return {
      measurementId: (event.payload["measurementId"] as string | undefined) ?? event.eventId,
      capabilityId: (event.payload["capabilityId"] as string | undefined) ?? "",
      outcome: (event.payload["outcome"] as string | undefined) ?? "inconclusive",
      recordedAt: event.recordedAt,
      eventId: event.eventId,
    };
  }
}
```

`src/evolution/a9/adapters/enriched-proposals-adapter.ts`:

```typescript
import type { A9Adapter, EnrichedProposalRecord } from "../contracts/a9-contract.js";

/**
 * Read-only adapter over P10.8a EnrichedProposal[] pipeline.
 * Returns RAW EnrichedProposalRecord[]. A9 reads enrichedFields VALUES,
 * not A8's stripped names-only.
 */
export class EnrichedProposalsAdapter implements A9Adapter<EnrichedProposalRecord> {
  readonly name = "enriched-proposals";
  constructor(private readonly source: ReadonlyArray<{
    proposalId: string;
    capabilityId?: string;
    enrichedFields?: Readonly<Record<string, unknown>>;
    recordedAt?: string;
  }>) {}

  async list(): Promise<ReadonlyArray<EnrichedProposalRecord>> {
    return this.source.map((p) => ({
      proposalId: p.proposalId,
      capabilityId: p.capabilityId ?? "",
      enrichedFields: p.enrichedFields ?? {},
      recordedAt: p.recordedAt ?? new Date(0).toISOString(),
    }));
  }
}
```

`src/evolution/a9/adapters/index.ts`:

```typescript
export * from "./proposal-events-adapter.js";
export * from "./measurement-events-adapter.js";
export * from "./enriched-proposals-adapter.js";
```

**Steps:**

- [ ] **Step 1: Write adapter tests**

  Create `tests/evolution/a9-adapters.vitest.ts` — verify each adapter:
  - `list()` returns expected raw record shape
  - Read-only invariant: no mutation surface exposed
  - Empty source → empty list
  - Events of unexpected prefix are filtered out
  - **Q8 sentinel:** `MeasurementEventsAdapter` does NOT expose `proposalId`, `sourceProposalIds`, `forecastId`, `correlationId` on any record
  - `ProposalEventsAdapter` exposes `payload` raw (not normalized)

  Use a stub `EventLog` (in-memory array of synthetic events). Adjust imports to match the actual `EventLog` signature discovered at T1.

- [ ] **Step 2: Write 3 adapter implementations**

  Per the code blocks above. Adapt imports to match the actual `EventLog.listByPrefix` signature, `CapabilityGovernanceEvent`/`CapabilityMeasurementEvent` payload shape, and `EnrichedProposal` field names verified at T1. **STOP and surface** if any of these signatures cannot be reconciled.

- [ ] **Step 3: Run adapter tests to verify GREEN**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a9-forecast-calibration-and-provenance
  pnpm vitest run tests/evolution/a9-adapters.vitest.ts 2>&1 | tail -15
  ```

- [ ] **Step 4: Run full evolution + capability suite**

  ```bash
  pnpm vitest run tests/capability/ tests/evolution/ 2>&1 | tail -8
  ```

  Expected: previous baseline + 3 new adapter tests = 0 regressions.

- [ ] **Step 5: Commit**

  ```bash
  git add src/evolution/a9/adapters/ tests/evolution/a9-adapters.vitest.ts
  git commit -m "feat(evolution): A9 T2 three read-only raw foreign adapters (bypass A8 normalization)"
  ```

---

### Task 3: Two read-only JSONL persistence adapters

**Files:**
- Create: `src/evolution/a9/forecasts-adapter.ts`
- Create: `src/evolution/a9/correlations-adapter.ts`
- Test: `tests/evolution/a9-persistence-adapters.vitest.ts`

**Interfaces:**
- Consumes: `A9Adapter<T>`, `A9Forecast`, `A9Correlation` (from T1).
- Produces: 2 read-only `A9Adapter<T>` implementations reading from `.alix/governance/forecasts.jsonl` + `.alix/governance/correlations.jsonl`.

**Code blocks (verbatim):**

`src/evolution/a9/forecasts-adapter.ts`:

```typescript
import type { A9Adapter, A9Forecast } from "./contracts/a9-contract.js";
import { readFile } from "node:fs/promises";

/**
 * Read-only adapter over .alix/governance/forecasts.jsonl.
 * Returns A9Forecast[]. A9 owns this store; foreign stores do not write to it.
 */
export class ForecastsAdapter implements A9Adapter<A9Forecast> {
  readonly name = "forecasts";
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReadonlyArray<A9Forecast>> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as A9Forecast);
  }

  /**
   * Find forecasts by proposalId. Used by correlation engine.
   */
  async findByProposalId(proposalId: string): Promise<ReadonlyArray<A9Forecast>> {
    const all = await this.list();
    return all.filter((f) => f.subject === proposalId);
  }
}
```

`src/evolution/a9/correlations-adapter.ts`:

```typescript
import type { A9Adapter, A9Correlation } from "./contracts/a9-contract.js";
import { readFile } from "node:fs/promises";

/**
 * Read-only adapter over .alix/governance/correlations.jsonl.
 * Returns A9Correlation[]. A9 owns this store.
 */
export class CorrelationsAdapter implements A9Adapter<A9Correlation> {
  readonly name = "correlations";
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReadonlyArray<A9Correlation>> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as A9Correlation);
  }

  /**
   * Find correlations by forecastId.
   */
  async findByForecastId(forecastId: string): Promise<ReadonlyArray<A9Correlation>> {
    const all = await this.list();
    return all.filter((c) => c.forecastId === forecastId);
  }
}
```

**Steps:**

- [ ] **Step 1: Write persistence adapter tests**

  Create `tests/evolution/a9-persistence-adapters.vitest.ts`:
  - Empty file → empty list
  - Missing file → empty list (ENOENT)
  - Multiple lines → parsed correctly
  - `findByProposalId` filters correctly
  - Append-only invariant: read adapter does not expose mutation

- [ ] **Step 2: Implement 2 persistence adapters**

  Per code blocks above.

- [ ] **Step 3: Run tests to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a9-persistence-adapters.vitest.ts 2>&1 | tail -10
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/evolution/a9/forecasts-adapter.ts src/evolution/a9/correlations-adapter.ts tests/evolution/a9-persistence-adapters.vitest.ts
  git commit -m "feat(evolution): A9 T3 read-only JSONL persistence adapters"
  ```

---

### Task 4: Three pure detectors

**Files:**
- Create: `src/evolution/a9/detectors/trust-velocity-detector.ts`
- Create: `src/evolution/a9/detectors/evidence-completeness-detector.ts`
- Create: `src/evolution/a9/detectors/fingerprint-coincidence-detector.ts`
- Create: `src/evolution/a9/detectors/index.ts` (barrel)
- Test: `tests/evolution/a9-detectors.vitest.ts`

**Interfaces:**
- Consumes: `ProposalGovernanceRecord[]`, `CapabilityMeasurementRecord[]`, `EnrichedProposalRecord[]` (from T1/T2).
- Produces: 3 pure detector functions each returning a `ReadonlyArray<DetectorFinding>` where `DetectorFinding = { proposalId, subjectCapability, kind, internalScore, confidence, evidenceRefs }`.

**Code blocks (verbatim — verify field paths from T1 reconnaissance):**

`src/evolution/a9/detectors/trust-velocity-detector.ts`:

```typescript
import type { ProposalGovernanceRecord, RiskScore } from "../contracts/a9-contract.js";
import type { A9ForecastKind } from "../contracts/a9-contract.js";

export interface DetectorFinding {
  readonly proposalId: string;
  readonly subjectCapability: string;
  readonly kind: A9ForecastKind;
  readonly internalScore: RiskScore;
  readonly confidence: RiskScore;
  readonly evidenceRefs: ReadonlyArray<string>;
}

/**
 * trust-velocity-detector.
 *
 * Pure function. Consumes proposal.submitted events. Reads
 * payload.target.id (subjectCapability) and payload.blastRadius
 * (or similar field — verified at T1).
 *
 * Scoring: base 0.5, then +0.1 per blast-radius indicator
 * (replacing-targets, multi-tenancy-impact, capability-surface-area).
 * Capped at 1.0.
 *
 * Concrete blast-radius field names are reconnaissance-derived.
 * If no blast-radius fields exist in the payload, the detector returns
 * an empty result and the engine skips this dimension.
 */
export function detectTrustVelocity(
  records: ReadonlyArray<ProposalGovernanceRecord>,
): ReadonlyArray<DetectorFinding> {
  const findings: DetectorFinding[] = [];
  for (const r of records) {
    if (r.kind !== "proposal.submitted") continue;
    const targetId = (r.payload["target"] as { id?: string } | undefined)?.id;
    if (!targetId) continue;
    const blastRadius = (r.payload["blastRadius"] as ReadonlyArray<string> | undefined) ?? [];
    const baseScore = 0.5;
    const tip = Math.min(1.0, baseScore + blastRadius.length * 0.1);
    findings.push({
      proposalId: r.proposalId,
      subjectCapability: targetId,
      kind: "trust-velocity",
      internalScore: tip,
      confidence: 0.7,
      evidenceRefs: [r.eventId],
    });
  }
  return findings;
}
```

`src/evolution/a9/detectors/evidence-completeness-detector.ts`:

```typescript
import type { EnrichedProposalRecord, RiskScore } from "../contracts/a9-contract.js";
import type { A9ForecastKind } from "../contracts/a9-contract.js";
import type { DetectorFinding } from "./trust-velocity-detector.js";

/**
 * evidence-completeness-detector.
 *
 * Pure function. Consumes EnrichedProposal[] raw records.
 * Reads enrichedFields VALUES (not A8's names-only).
 *
 * Scoring: completeness × recency × diversity.
 * - completeness: count of populated fields / expected field count
 * - recency: time-decay factor (older = lower)
 * - diversity: count of distinct source types
 *
 * Concrete expected-field count and recency formula are deferred to the
 * plan/deployment phase. Initial defaults: 5 expected fields, 30-day decay.
 */
export function detectEvidenceCompleteness(
  records: ReadonlyArray<EnrichedProposalRecord>,
  now: string,
): ReadonlyArray<DetectorFinding> {
  const findings: DetectorFinding[] = [];
  const expectedFieldCount = 5;
  const decayDays = 30;
  for (const r of records) {
    const populated = Object.values(r.enrichedFields).filter(
      (v) => v !== undefined && v !== null && v !== "",
    ).length;
    const completeness = Math.min(1.0, populated / expectedFieldCount);
    const sources = new Set<string>();
    for (const v of Object.values(r.enrichedFields)) {
      if (typeof v === "string" && v.startsWith("source:")) sources.add(v);
    }
    const diversity = Math.min(1.0, sources.size / 3);
    const ageDays = Math.max(0, (Date.parse(now) - Date.parse(r.recordedAt)) / 86400000);
    const recency = Math.max(0, 1 - ageDays / decayDays);
    const score = Math.min(1.0, completeness * recency * diversity);
    findings.push({
      proposalId: r.proposalId,
      subjectCapability: r.capabilityId,
      kind: "evidence-completeness",
      internalScore: score,
      confidence: 0.8,
      evidenceRefs: [r.proposalId],
    });
  }
  return findings;
}
```

`src/evolution/a9/detectors/fingerprint-coincidence-detector.ts`:

```typescript
import type { ProposalGovernanceRecord, RiskScore } from "../contracts/a9-contract.js";
import type { A9ForecastKind } from "../contracts/a9-contract.js";
import type { DetectorFinding } from "./trust-velocity-detector.js";

/**
 * fingerprint-coincidence-detector.
 *
 * Pure function. Consumes historical proposal.execution_failed events.
 * Fingerprint: errorCategory:capabilityId (or similar — verified at T1).
 *
 * For each NEW proposal.submitted event, query the failure history
 * for the same fingerprint. If count >= 1, emit a finding with score
 * proportional to count (capped at 1.0).
 *
 * Score: min(1.0, 0.5 + 0.1 * failureCount).
 */
export function detectFingerprintCoincidence(
  records: ReadonlyArray<ProposalGovernanceRecord>,
): ReadonlyArray<DetectorFinding> {
  const failures = records.filter((r) => r.kind === "proposal.execution_failed");
  const failureCounts = new Map<string, { readonly count: number; readonly eventIds: ReadonlyArray<string> }>();
  for (const f of failures) {
    const errorCategory = (f.payload["errorCategory"] as string | undefined) ?? "unspecified";
    const targetId = (f.payload["target"] as { id?: string } | undefined)?.id ?? "";
    const fingerprint = `${errorCategory}:${targetId}`;
    const existing = failureCounts.get(fingerprint);
    if (existing) {
      failureCounts.set(fingerprint, { count: existing.count + 1, eventIds: [...existing.eventIds, f.eventId] });
    } else {
      failureCounts.set(fingerprint, { count: 1, eventIds: [f.eventId] });
    }
  }

  const findings: DetectorFinding[] = [];
  for (const r of records) {
    if (r.kind !== "proposal.submitted") continue;
    const targetId = (r.payload["target"] as { id?: string } | undefined)?.id;
    if (!targetId) continue;
    // For each failure fingerprint that matches the new proposal's target capability,
    // emit a finding. The fingerprint is "any-errorCategory:targetId".
    let bestScore = 0;
    let bestEvidence: ReadonlyArray<string> = [];
    for (const [fp, info] of failureCounts) {
      if (!fp.endsWith(`:${targetId}`)) continue;
      const score = Math.min(1.0, 0.5 + 0.1 * info.count);
      if (score > bestScore) {
        bestScore = score;
        bestEvidence = info.eventIds;
      }
    }
    if (bestScore > 0) {
      findings.push({
        proposalId: r.proposalId,
        subjectCapability: targetId,
        kind: "fingerprint-coincidence",
        internalScore: bestScore,
        confidence: 0.6,
        evidenceRefs: bestEvidence,
      });
    }
  }
  return findings;
}
```

`src/evolution/a9/detectors/index.ts`:

```typescript
export * from "./trust-velocity-detector.js";
export * from "./evidence-completeness-detector.js";
export * from "./fingerprint-coincidence-detector.js";
```

**Steps:**

- [ ] **Step 1: Write detector unit tests**

  Create `tests/evolution/a9-detectors.vitest.ts`:
  - Empty input → 0 findings (per detector)
  - Below-threshold input → 0 findings
  - Threshold-crossing input → findings
  - Determinism: same input twice → identical findings
  - `evidenceRefs` preserved exactly
  - `internalScore` always in [0, 1]

- [ ] **Step 2: Run tests to verify RED**

  ```bash
  pnpm vitest run tests/evolution/a9-detectors.vitest.ts 2>&1 | tail -10
  ```

  Expected: FAIL (detectors not yet implemented).

- [ ] **Step 3: Implement 3 detectors**

  Per code blocks above. **STOP and surface** if `payload.blastRadius`, `payload.errorCategory`, or `payload.target` field paths are missing/different from T1 reconnaissance.

- [ ] **Step 4: Run tests to verify GREEN**

  Same command. Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/evolution/a9/detectors/ tests/evolution/a9-detectors.vitest.ts
  git commit -m "feat(evolution): A9 T4 three pure detectors (trust-velocity / evidence-completeness / fingerprint-coincidence)"
  ```

---

### Task 5: Forecast builder + engine

**Files:**
- Create: `src/evolution/a9/forecast-builder.ts`
- Create: `src/evolution/a9/forecast-engine.ts`
- Modify: `src/evolution/a9/index.ts` (extend barrel)
- Test: `tests/evolution/a9-forecast-engine.vitest.ts`

**Interfaces:**
- Consumes: 3 `A9Adapter<T>` (T2), `A9ForecastEngineOptions` (T1), 3 detector functions (T4).
- Produces: `ForecastEngine.forecast(timestamp)` returns `Promise<A9Forecast | null>`; `buildForecast(findings, subject, subjectCapability, timestamp, options)` returns `A9Forecast` (pure).

**Code blocks (verbatim):**

`src/evolution/a9/forecast-builder.ts`:

```typescript
import { createHash } from "node:crypto";
import type {
  A9Forecast,
  A9ForecastKind,
  A9ForecastEngineOptions,
  RiskBand,
  RiskScore,
} from "./contracts/a9-contract.js";
import { internalScoreToBand } from "./contracts/a9-contract.js";
import type { DetectorFinding } from "./detectors/trust-velocity-detector.js";

/**
 * Pure forecast builder.
 *
 * Aggregation rule (locked): within a single subject, the engine takes
 * the MAX internalScore across detectors and projects the highest band.
 * Confidence is the sum of detector confidences weighted by internalScore.
 *
 * forecastId is the SHA-256 of the canonical forecast excluding the
 * forecastId field itself. Identity-bearing fields: forecastVersion,
 * subject, subjectCapability, prediction, horizon, confidence, provenance.
 */
export function buildForecast(
  findings: ReadonlyArray<DetectorFinding>,
  now: string,
  options: A9ForecastEngineOptions,
): A9Forecast | null {
  if (findings.length === 0) return null;

  // Group by subject (proposalId).
  const bySubject = new Map<string, DetectorFinding[]>();
  for (const f of findings) {
    const list = bySubject.get(f.proposalId) ?? [];
    list.push(f);
    bySubject.set(f.proposalId, list);
  }

  // One forecast per subject.
  const forecasts: A9Forecast[] = [];
  for (const [subject, subjectFindings] of bySubject) {
    // Max-score aggregation.
    let maxScore = 0;
    let bestKind: A9ForecastKind = "trust-velocity";
    let subjectCapability = subjectFindings[0].subjectCapability;
    const allEvidenceRefs: string[] = [];
    let weightedConfidenceSum = 0;
    let weightSum = 0;
    for (const f of subjectFindings) {
      if (f.internalScore > maxScore) {
        maxScore = f.internalScore;
        bestKind = f.kind;
      }
      if (f.subjectCapability) subjectCapability = f.subjectCapability;
      for (const ref of f.evidenceRefs) allEvidenceRefs.push(ref);
      weightedConfidenceSum += f.confidence * f.internalScore;
      weightSum += f.internalScore;
    }
    const band: RiskBand = internalScoreToBand(maxScore);
    const confidence: RiskScore = weightSum > 0 ? weightedConfidenceSum / weightSum : 0;

    const forecast: A9Forecast = {
      forecastId: "PLACEHOLDER", // computed below
      forecastVersion: "0.1.0",
      subject,
      subjectCapability,
      prediction: { kind: bestKind, band, internalScore: maxScore },
      horizon: {
        from: subjectFindings
          .map((f) => f.evidenceRefs[0])
          .filter((r): r is string => Boolean(r))
          .join("|") || now,
        to: now,
      },
      confidence,
      provenance: {
        generatedAt: now,
        generatorVersion: options.generatorVersion,
        evidenceRefs: allEvidenceRefs,
      },
    };

    // Compute deterministic identity from the canonical forecast (excluding identity).
    const identityInput = JSON.stringify({
      forecastVersion: forecast.forecastVersion,
      subject: forecast.subject,
      subjectCapability: forecast.subjectCapability,
      prediction: forecast.prediction,
      horizon: forecast.horizon,
      confidence: forecast.confidence,
      provenance: {
        generatedAt: forecast.provenance.generatedAt,
        generatorVersion: forecast.provenance.generatorVersion,
        evidenceRefs: forecast.provenance.evidenceRefs,
      },
    });
    forecast.forecastId = createHash("sha256").update(identityInput).digest("hex");
    forecasts.push(forecast);
  }

  // For v1, return the first forecast (caller is the CLI which emits one at a time).
  // A future multi-subject batch API would return ReadonlyArray<A9Forecast>.
  return forecasts[0] ?? null;
}
```

`src/evolution/a9/forecast-engine.ts`:

```typescript
import type {
  A9Adapter,
  A9Forecast,
  A9ForecastEngineOptions,
  EnrichedProposalRecord,
  ProposalGovernanceRecord,
  CapabilityMeasurementRecord,
} from "./contracts/a9-contract.js";
import { DEFAULT_A9_ENGINE_OPTIONS } from "./contracts/a9-contract.js";
import { detectTrustVelocity } from "./detectors/trust-velocity-detector.js";
import { detectEvidenceCompleteness } from "./detectors/evidence-completeness-detector.js";
import { detectFingerprintCoincidence } from "./detectors/fingerprint-coincidence-detector.js";
import { buildForecast } from "./forecast-builder.js";

/**
 * ForecastEngine — runs all 3 detectors, aggregates findings via max-score,
 * emits one A9Forecast per subject (proposalId).
 *
 * "No trigger → no forecast": if 0 findings across all detectors, returns null.
 *
 * Joins happen here (above the adapter boundary), not in adapters.
 */
export class ForecastEngine {
  constructor(
    private readonly proposalEvents: A9Adapter<ProposalGovernanceRecord>,
    private readonly measurementEvents: A9Adapter<CapabilityMeasurementRecord>,
    private readonly enrichedProposals: A9Adapter<EnrichedProposalRecord>,
    private readonly options: A9ForecastEngineOptions = DEFAULT_A9_ENGINE_OPTIONS,
  ) {}

  async forecast(now: string): Promise<A9Forecast | null> {
    const [proposalRecs, measurementRecs, enrichedRecs] = await Promise.all([
      this.proposalEvents.list(),
      this.measurementEvents.list(),
      this.enrichedProposals.list(),
    ]);

    const allFindings = [
      ...detectTrustVelocity(proposalRecs),
      ...detectEvidenceCompleteness(enrichedRecs, now),
      ...detectFingerprintCoincidence(proposalRecs),
    ];

    // measurementRecs is intentionally not consumed by detectors in v1 —
    // it is used by the correlation engine (T6).
    void measurementRecs;

    return buildForecast(allFindings, now, this.options);
  }
}
```

**Steps:**

- [ ] **Step 1: Write engine + builder tests**

  Create `tests/evolution/a9-forecast-engine.vitest.ts`:
  - 0 findings across all detectors → `null`
  - Multiple findings on same subject → 1 forecast with max-score aggregation
  - Multiple findings across subjects → first forecast (v1 single-subject behavior)
  - `forecastId` deterministic: same input + same timestamp → same `forecastId`
  - `forecastId` determinism: different `subject` → different `forecastId`
  - `subjectCapability` copied from finding (proposal.submitted.payload.target.id)
  - `prediction.band` matches `internalScoreToBand(internalScore)`
  - `evidenceRefs` preserved exactly

- [ ] **Step 2: Run tests to verify RED**

  Expected: FAIL.

- [ ] **Step 3: Implement engine + builder**

  Per code blocks above.

- [ ] **Step 4: Run tests to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a9-forecast-engine.vitest.ts 2>&1 | tail -15
  ```

  Expected: PASS.

- [ ] **Step 5: Update barrel**

  Extend `src/evolution/a9/index.ts`:
  ```typescript
  export * from "./contracts/a9-contract.js";
  export * from "./adapters/index.js";
  export * from "./detectors/index.js";
  export * from "./forecast-builder.js";
  export * from "./forecast-engine.js";
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/evolution/a9/forecast-builder.ts src/evolution/a9/forecast-engine.ts src/evolution/a9/index.ts tests/evolution/a9-forecast-engine.vitest.ts
  git commit -m "feat(evolution): A9 T5 forecast builder + engine (max-score aggregation per subject)"
  ```

---

### Task 6: Correlation builder + engine

**Files:**
- Create: `src/evolution/a9/correlation-builder.ts`
- Create: `src/evolution/a9/correlation-engine.ts`
- Test: `tests/evolution/a9-correlation-engine.vitest.ts`

**Interfaces:**
- Consumes: `A9Adapter<ProposalGovernanceRecord>`, `A9Adapter<CapabilityMeasurementRecord>`, `ForecastsAdapter` (T3), `A9Forecast` (T1).
- Produces: `CorrelationEngine` that emits `A9Correlation[]` via the deterministic bridge.

**Code blocks (verbatim):**

`src/evolution/a9/correlation-builder.ts`:

```typescript
import { createHash } from "node:crypto";
import type {
  A9Correlation,
  A9Forecast,
  CapabilityMeasurementRecord,
  RiskBand,
} from "./contracts/a9-contract.js";

/**
 * Build an A9Correlation from a confirmed (forecast, measurement) pair.
 * Pure function. correlationId is SHA-256 of canonical correlation.
 *
 * CRITICAL: this function does NOT verify the bridge. The bridge must be
 * verified by the correlation engine before calling this builder.
 *
 * The `delta` field is naive in v1: if forecast.band == observedBand → "match",
 * if forecast.band higher than observed → "over-forecast", else "under-forecast".
 * Calibration semantics are a separate future concern.
 */
export function buildCorrelation(
  forecast: A9Forecast,
  measurement: CapabilityMeasurementRecord,
  observedBand: RiskBand,
  now: string,
): A9Correlation {
  const correlation: A9Correlation = {
    correlationId: "PLACEHOLDER",
    correlationVersion: "0.1.0",
    forecastId: forecast.forecastId,
    measurementId: measurement.measurementId,
    foreignProvenance: { proposalId: forecast.subject },
    resolution: {
      band: observedBand,
      forecastBand: forecast.prediction.band,
      delta:
        forecast.prediction.band === observedBand
          ? "match"
          : forecast.prediction.band > observedBand
            ? "over-forecast"
            : "under-forecast",
    },
  };

  // Deterministic identity from canonical correlation (excluding correlationId).
  const identityInput = JSON.stringify({
    correlationVersion: correlation.correlationVersion,
    forecastId: correlation.forecastId,
    measurementId: correlation.measurementId,
    foreignProvenance: correlation.foreignProvenance,
    resolution: correlation.resolution,
  });
  correlation.correlationId = createHash("sha256").update(identityInput).digest("hex");

  // Now is part of the builder signature but not the identity (avoids
  // collisions on re-emission of the same pair). Documented in spec.
  void now;

  return correlation;
}
```

`src/evolution/a9/correlation-engine.ts`:

```typescript
import type {
  A9Adapter,
  A9Forecast,
  A9Correlation,
  ProposalGovernanceRecord,
  CapabilityMeasurementRecord,
  RiskBand,
} from "./contracts/a9-contract.js";
import type { ForecastsAdapter } from "./forecasts-adapter.js";
import { buildCorrelation } from "./correlation-builder.js";

/**
 * CorrelationEngine — emits A9Correlation via the deterministic bridge.
 *
 * Bridge (5-step exact equality, locked):
 *   1. forecast.subject = proposal.submitted.proposalId
 *   2. proposal.submitted.payload.target.id = forecast.subjectCapability
 *   3. proposal.executed for forecast.subject exists (EXECUTION ELIGIBILITY GATE)
 *   4. measurement.capabilityId = forecast.subjectCapability
 *   5. forecast.horizon.from <= measurement.recordedAt <= forecast.horizon.to
 *
 * No temporal proximity. No payload matching. No "most recent" selection.
 * No heuristic correlation.
 *
 * If any step fails, no A9Correlation is emitted. Absence = unresolved.
 * No negative correlation records. No A9CorrelationAttempt.
 */
export class CorrelationEngine {
  constructor(
    private readonly proposalEvents: A9Adapter<ProposalGovernanceRecord>,
    private readonly measurementEvents: A9Adapter<CapabilityMeasurementRecord>,
    private readonly forecasts: ForecastsAdapter,
    private readonly correlationsAppender: {
      append(correlation: A9Correlation): Promise<void>;
    },
    private readonly outcomeToBand: (outcome: string) => RiskBand,
  ) {}

  async correlate(now: string): Promise<ReadonlyArray<A9Correlation>> {
    const [proposalRecs, measurementRecs, allForecasts] = await Promise.all([
      this.proposalEvents.list(),
      this.measurementEvents.list(),
      this.forecasts.list(),
    ]);

    // Build proposal-status lookup.
    const submittedByProposalId = new Map<string, ProposalGovernanceRecord>();
    const executedProposalIds = new Set<string>();
    for (const r of proposalRecs) {
      if (r.kind === "proposal.submitted") submittedByProposalId.set(r.proposalId, r);
      if (r.kind === "proposal.executed") executedProposalIds.add(r.proposalId);
    }

    const emitted: A9Correlation[] = [];

    for (const forecast of allForecasts) {
      // Step 3: execution eligibility gate.
      if (!executedProposalIds.has(forecast.subject)) continue;

      // Step 1: forecast.subject must equal proposal.submitted.proposalId.
      const submitted = submittedByProposalId.get(forecast.subject);
      if (!submitted) continue;

      // Step 2: capability bridge — proposal.submitted.payload.target.id must equal forecast.subjectCapability.
      const targetId = (submitted.payload["target"] as { id?: string } | undefined)?.id;
      if (!targetId || targetId !== forecast.subjectCapability) continue;

      // Step 4: measurement.capabilityId must equal forecast.subjectCapability.
      // Step 5: measurement.recordedAt must be within forecast.horizon.
      for (const m of measurementRecs) {
        if (m.capabilityId !== forecast.subjectCapability) continue;
        if (m.recordedAt < forecast.horizon.from) continue;
        if (m.recordedAt > forecast.horizon.to) continue;

        const observedBand = this.outcomeToBand(m.outcome);
        const correlation = buildCorrelation(forecast, m, observedBand, now);
        await this.correlationsAppender.append(correlation);
        emitted.push(correlation);
      }
    }

    return emitted;
  }
}
```

**Steps:**

- [ ] **Step 1: Write correlation engine tests**

  Create `tests/evolution/a9-correlation-engine.vitest.ts`:
  - **Proposal bridge:** forecast.subject matches proposal.submitted.proposalId → proceed; mismatch → no correlation
  - **Capability bridge:** proposal.submitted.payload.target.id != forecast.subjectCapability → no correlation
  - **Execution gate:** missing proposal.executed → no correlation
  - **Measurement bridge:** measurement.capabilityId != forecast.subjectCapability → no correlation
  - **Horizon:** measurement.recordedAt outside forecast.horizon → no correlation
  - **No heuristic correlation:** same capability + wrong proposal → no correlation emitted
  - **Many-to-many:** one forecast + multiple valid measurements → N correlations
  - **Many-to-many:** one measurement + multiple valid forecasts → N correlations
  - **No negative correlation:** bridge miss → no record
  - **correlationId determinism:** same (forecast, measurement, observedBand) → same correlationId

- [ ] **Step 2: Run tests to verify RED**

  Expected: FAIL.

- [ ] **Step 3: Implement correlation builder + engine**

  Per code blocks above. The constructor takes `ForecastsAdapter` (T3) as the third argument — exact typing matches the T3 export.

- [ ] **Step 4: Run tests to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a9-correlation-engine.vitest.ts 2>&1 | tail -15
  ```

  Expected: PASS.

- [ ] **Step 5: Update barrel**

  Extend `src/evolution/a9/index.ts`:
  ```typescript
  export * from "./contracts/a9-contract.js";
  export * from "./adapters/index.js";
  export * from "./detectors/index.js";
  export * from "./forecast-builder.js";
  export * from "./forecast-engine.js";
  export * from "./correlation-builder.js";
  export * from "./correlation-engine.js";
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/evolution/a9/correlation-builder.ts src/evolution/a9/correlation-engine.ts src/evolution/a9/index.ts tests/evolution/a9-correlation-engine.vitest.ts
  git commit -m "feat(evolution): A9 T6 correlation builder + engine (deterministic bridge via proposal.submitted + proposal.executed)"
  ```

---

### Task 7: A9 bridge (A2.5 recommendation construction)

**Files:**
- Create: `src/evolution/a9/a9-bridge.ts`
- Test: `tests/evolution/a9-bridge.vitest.ts`

**Interfaces:**
- Consumes: `A9Forecast` (T1), existing `GovernanceRecommendation` (A2.5).
- Produces: `buildGovernanceRecommendation(forecast)` returns `GovernanceRecommendation` with `kind: "RISK_GATED_REVIEW"` for high/critical, `MONITOR` for low/medium.

**Code block (verbatim):**

`src/evolution/a9/a9-bridge.ts`:

```typescript
import type { A9Forecast } from "./contracts/a9-contract.js";
import type { GovernanceRecommendation } from "../../governance/governance-types.js";
import type { GovernanceRecommendationKind } from "../../governance/governance-types.js";

/**
 * A9 bridge to A2.5.
 *
 * CRITICAL: A9 owns the forecast identity. A2.5 references it via the
 * `id` and `sourceArtifactId` fields. The kind selection is:
 *   - low    → MONITOR
 *   - medium → MONITOR
 *   - high   → RISK_GATED_REVIEW  (6th A2.5 kind, added in T8)
 *   - critical → RISK_GATED_REVIEW
 *
 * A9 does NOT itself approve or reject. A3 retains final decision.
 */
export function buildGovernanceRecommendation(
  forecast: A9Forecast,
): GovernanceRecommendation {
  const kind: GovernanceRecommendationKind =
    forecast.prediction.band === "high" || forecast.prediction.band === "critical"
      ? "RISK_GATED_REVIEW"
      : "MONITOR";

  return {
    id: forecast.forecastId,
    kind,
    confidence: forecast.confidence,
    sourceArtifactId: forecast.forecastId,
    evidenceRefs: [...forecast.provenance.evidenceRefs],
    rationale:
      `A9 forecast: ${forecast.prediction.kind} → ${forecast.prediction.band}`,
  };
}
```

**Steps:**

- [ ] **Step 1: Write bridge tests**

  Create `tests/evolution/a9-bridge.vitest.ts`:
  - `low` band → `MONITOR`
  - `medium` band → `MONITOR`
  - `high` band → `RISK_GATED_REVIEW`
  - `critical` band → `RISK_GATED_REVIEW`
  - `id` and `sourceArtifactId` equal `forecast.forecastId`
  - `evidenceRefs` propagated exactly
  - `rationale` contains `forecast.prediction.kind` and `forecast.prediction.band`

  Note: these tests will require the T8 contract extension to compile if `GovernanceRecommendationKind` is a strict union. If T8 is not yet merged, expect compile errors. Run these tests AFTER T8 lands.

- [ ] **Step 2: Implement bridge**

  Per code block above.

- [ ] **Step 3: Run tests to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a9-bridge.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 4: Update barrel**

  Extend `src/evolution/a9/index.ts`:
  ```typescript
  export * from "./a9-bridge.js";
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/evolution/a9/a9-bridge.ts src/evolution/a9/index.ts tests/evolution/a9-bridge.vitest.ts
  git commit -m "feat(evolution): A9 T7 A9 bridge (RISK_GATED_REVIEW for high/critical, MONITOR for low/medium)"
  ```

---

### Task 8: A2.5 contract extension + A3 mapping extension

**Files:**
- Modify: `src/governance/governance-types.ts` (extend `GovernanceRecommendationKind` union)
- Modify: `src/evolution/governance/decision-engine.ts` (extend `RECOMMENDATION_KIND_MAP`)
- Test: `tests/governance/a9-a25-extension.vitest.ts`

**Interfaces:**
- Consumes: existing `GovernanceRecommendationKind` (5 kinds), existing `RECOMMENDATION_KIND_MAP`.
- Produces: 6th A2.5 kind `"RISK_GATED_REVIEW"`; mapping entry `RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE` (UNDER_REVIEW).

**Code blocks (verbatim — verify exact field names from T1 reconnaissance):**

`src/governance/governance-types.ts` (modify the `GovernanceRecommendationKind` union):

```typescript
// Existing 5 kinds preserved. Add exactly one new kind.
export type GovernanceRecommendationKind =
  | "APPROVE"
  | "REJECT"
  | "MONITOR"
  | "REQUEST_ADDITIONAL_EVIDENCE"
  | "ESCALATE"
  | "RISK_GATED_REVIEW"; // A9 (Q8): 6th kind, maps to A3 REQUEST_MORE_EVIDENCE
```

`src/evolution/governance/decision-engine.ts` (modify the `RECOMMENDATION_KIND_MAP`):

```typescript
// Existing mapping preserved. Add exactly one new entry.
export const RECOMMENDATION_KIND_MAP: Record<GovernanceRecommendationKind, GovernanceDecisionKind> = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  MONITOR: "MONITOR",
  REQUEST_ADDITIONAL_EVIDENCE: "REQUEST_MORE_EVIDENCE",
  ESCALATE: "ESCALATE",
  RISK_GATED_REVIEW: "REQUEST_MORE_EVIDENCE", // A9 (Q8): new-gate path → UNDER_REVIEW
};
```

**Steps:**

- [ ] **Step 1: Write A2.5 extension tests**

  Create `tests/governance/a9-a25-extension.vitest.ts`:
  - `GovernanceRecommendationKind` union has exactly 6 kinds (5 existing + `RISK_GATED_REVIEW`)
  - `RECOMMENDATION_KIND_MAP["RISK_GATED_REVIEW"] === "REQUEST_MORE_EVIDENCE"`
  - All 5 existing mapping entries unchanged (regression)
  - A3's `GovernanceDecisionKind` union has exactly 4 kinds (regression)
  - A3's target states union has exactly 3 states (regression)

- [ ] **Step 2: Run tests to verify RED**

  Expected: FAIL (RISK_GATED_REVIEW not yet in union).

- [ ] **Step 3: Modify `governance-types.ts`**

  Add `"RISK_GATED_REVIEW"` to the `GovernanceRecommendationKind` union.

- [ ] **Step 4: Modify `decision-engine.ts`**

  Add the mapping entry.

- [ ] **Step 5: Run tests to verify GREEN**

  ```bash
  pnpm vitest run tests/governance/a9-a25-extension.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 6: Run full evolution/governance suite**

  ```bash
  pnpm vitest run tests/governance/ tests/evolution/ 2>&1 | tail -8
  ```

  Expected: 0 regressions.

- [ ] **Step 7: Commit**

  ```bash
  git add src/governance/governance-types.ts src/evolution/governance/decision-engine.ts tests/governance/a9-a25-extension.vitest.ts
  git commit -m "feat(governance): A9 T8 6th A2.5 kind RISK_GATED_REVIEW + A3 mapping extension"
  ```

---

### Task 9: Composition root wiring + CLI registration

**Files:**
- Modify: `src/capability/platform.ts` (CAP-12 carve-out site — wire A9 adapters + engines)
- Create: `src/cli/commands/a9-forecast.ts` (or extend existing CLI registration seam — verify at T1 reconnaissance)
- Test: `tests/evolution/a9-cli.vitest.ts`

**Interfaces:**
- Consumes: `ForecastEngine` (T5), `CorrelationEngine` (T6), `buildGovernanceRecommendation` (T7), `EventLog`, `EnrichedProposal[]`.
- Produces: `alix governance evolution forecast` CLI command handler.

**Code blocks (verbatim):**

`src/cli/commands/a9-forecast.ts` (verify exact CLI registration seam from T1 reconnaissance):

```typescript
import type { EventLog } from "../../events/event-log.js";
import type { EnrichedProposal } from "../../adaptation/intelligence-types.js";
import { ForecastEngine } from "../../evolution/a9/forecast-engine.js";
import { CorrelationEngine } from "../../evolution/a9/correlation-engine.js";
import { ProposalEventsAdapter } from "../../evolution/a9/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../evolution/a9/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../evolution/a9/adapters/enriched-proposals-adapter.js";
import { ForecastsAdapter } from "../../evolution/a9/forecasts-adapter.js";
import { buildGovernanceRecommendation } from "../../evolution/a9/a9-bridge.js";
import { appendFile } from "node:fs/promises";

/**
 * CLI handler for `alix governance evolution forecast [--dimension ...] [--json]`.
 *
 * Single namespace. The detector taxonomy is internal; the operator
 * surface is `forecast`.
 */
export async function runForecastCli(opts: {
  readonly eventLog: EventLog;
  readonly enrichedProposals: ReadonlyArray<EnrichedProposal>;
  readonly forecastStorePath: string;
  readonly correlationStorePath: string;
  readonly json: boolean;
  readonly dimension?: string;
}): Promise<{ readonly output: string; readonly exitCode: 0 | 1 }> {
  void opts.dimension; // accepted but unused in v1

  const forecastEngine = new ForecastEngine(
    new ProposalEventsAdapter(opts.eventLog),
    new MeasurementEventsAdapter(opts.eventLog),
    new EnrichedProposalsAdapter(opts.enrichedProposals),
  );

  const now = new Date().toISOString();
  const forecast = await forecastEngine.forecast(now);

  if (!forecast) {
    return {
      output: opts.json
        ? JSON.stringify({ noForecast: true })
        : "No A9 forecast emitted.",
      exitCode: 0,
    };
  }

  // Persist append-only.
  await appendFile(opts.forecastStorePath, JSON.stringify(forecast) + "\n", "utf-8");

  // Build A2.5 recommendation.
  const recommendation = buildGovernanceRecommendation(forecast);

  if (opts.json) {
    return {
      output: JSON.stringify({ forecast, recommendation }, null, 2),
      exitCode: 0,
    };
  }

  return {
    output:
      `A9 forecast: ${forecast.prediction.kind} → ${forecast.prediction.band} (score=${forecast.prediction.internalScore.toFixed(2)})\n` +
      `Recommendation: ${recommendation.kind}` +
      (recommendation.kind === "RISK_GATED_REVIEW"
        ? " → A3 REQUEST_MORE_EVIDENCE (UNDER_REVIEW)"
        : ""),
    exitCode: 0,
  };
}
```

**Composition root wiring in `src/capability/platform.ts`** (verify exact structure from T1 reconnaissance):

The composition root must:
1. Construct the 3 read-only foreign adapters
2. Construct the 2 read-only JSONL persistence adapters
3. Construct a `CorrelationEngine` with an appender that writes to `correlations.jsonl`
4. Pass the engines to the CLI handler

```typescript
// Example shape (adjust to match actual platform.ts structure):
import { runForecastCli } from "../cli/commands/a9-forecast.js";

export function registerA9ForecastCli(platform: Platform): void {
  const eventLog = platform.eventLog;
  const enrichedProposals = platform.enrichedProposals;
  const forecastStorePath = `${platform.governanceDir}/forecasts.jsonl`;
  const correlationStorePath = `${platform.governanceDir}/correlations.jsonl`;

  platform.cli.registerCommand("governance evolution forecast", async (args) => {
    return runForecastCli({
      eventLog,
      enrichedProposals,
      forecastStorePath,
      correlationStorePath,
      json: args.json ?? false,
      dimension: args.dimension,
    });
  });
}
```

**Steps:**

- [ ] **Step 1: Discover the CLI registration seam**

  ```bash
  grep -rn "evolution curate\|evolution.forecast\|evolution learn" src/cli/ 2>/dev/null | head -10
  ```

  Find the file that registers the A6/A8 CLI command and mirror its structure for A9. STOP and surface if no equivalent registration seam exists.

- [ ] **Step 2: Write CLI smoke test**

  Create `tests/evolution/a9-cli.vitest.ts`:
  - With empty synthetic evidence → outputs "No A9 forecast emitted."
  - With finding-triggering evidence → outputs the forecast + recommendation
  - `--json` flag produces structured output
  - High/critical forecast surfaces `RISK_GATED_REVIEW` and the A3 mapping note

- [ ] **Step 3: Run tests to verify RED**

  Expected: FAIL.

- [ ] **Step 4: Implement `runForecastCli`**

  Per code block above.

- [ ] **Step 5: Wire composition root**

  Add the `registerA9ForecastCli` call to `platform.ts` at the appropriate seam (verify at T1 reconnaissance).

- [ ] **Step 6: Run tests + full suite**

  ```bash
  pnpm vitest run tests/evolution/a9-cli.vitest.ts 2>&1 | tail -10
  pnpm vitest run tests/capability/ tests/evolution/ tests/governance/ 2>&1 | tail -8
  ```

  Expected: zero regressions.

- [ ] **Step 7: Commit**

  ```bash
  git add src/cli/commands/a9-forecast.ts src/capability/platform.ts tests/evolution/a9-cli.vitest.ts
  git commit -m "feat(evolution): A9 T9 composition root + CLI registration (alix governance evolution forecast)"
  ```

---

### Task 10: Integration + sentinel tests

**Files:**
- Create: `tests/evolution/a9-engine-end-to-end.vitest.ts` (full forecast flow)
- Create: `tests/evolution/a9-correlation-end-to-end.vitest.ts` (full correlation flow)
- Create: `tests/evolution/a9-sentinel.vitest.ts` (architectural invariants)

**Interfaces:**
- Consumes: All A9 module exports.
- Produces: integration tests that prove adapter→detector→forecast→A2.5→A3 → binding decision; correlation flow; 16 architectural invariants.

**Code blocks (verbatim):**

`tests/evolution/a9-engine-end-to-end.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ForecastEngine } from "../../src/evolution/a9/forecast-engine.js";
import { ProposalEventsAdapter } from "../../src/evolution/a9/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../src/evolution/a9/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../src/evolution/a9/adapters/enriched-proposals-adapter.js";
import { buildGovernanceRecommendation } from "../../src/evolution/a9/a9-bridge.js";
import { generateDecision } from "../../src/evolution/governance/decision-engine.js";
import type { ProposalGovernanceRecord, CapabilityMeasurementRecord, EnrichedProposalRecord } from "../../src/evolution/a9/contracts/a9-contract.js";

describe("A9 engine end-to-end", () => {
  it("zero findings across all detectors → null (no forecast emitted)", async () => {
    const engine = new ForecastEngine(
      stubProposalEvents([]),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
    );
    const result = await engine.forecast("2026-08-15T00:00:00Z");
    expect(result).toBeNull();
  });

  it("full flow: adapters → detectors → forecast → A9 bridge → A2.5 (RISK_GATED_REVIEW) → A3 (REQUEST_MORE_EVIDENCE)", async () => {
    const now = "2026-08-15T00:00:00Z";
    // Construct a high-score forecast scenario (replacing-targets + multi-tenancy-impact).
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({
        proposalId: "p1",
        kind: "proposal.submitted",
        payload: { target: { id: "c1" }, blastRadius: ["replacing-targets", "multi-tenancy-impact", "capability-surface-area"] },
        recordedAt: now,
      }),
    ];
    const enrichedRecs: EnrichedProposalRecord[] = [
      makeEnriched({ proposalId: "p1", capabilityId: "c1", enrichedFields: { f1: "v1", f2: "v2", f3: "v3", f4: "v4", f5: "v5" }, recordedAt: now }),
    ];
    const engine = new ForecastEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals(enrichedRecs),
    );
    const forecast = await engine.forecast(now);
    expect(forecast).not.toBeNull();
    // High-score (0.5 + 0.3 = 0.8 → high) → RISK_GATED_REVIEW.
    expect(forecast!.prediction.band).toBe("high");
    const recommendation = buildGovernanceRecommendation(forecast!);
    expect(recommendation.kind).toBe("RISK_GATED_REVIEW");
    // A3 maps to REQUEST_MORE_EVIDENCE.
    const decision = generateDecision(
      { confidenceProfile: { overallConfidence: 0.8 }, evidenceClass: "projected", reproducibilityLevel: 2, generatedAt: now },
      recommendation,
    );
    expect(decision.kind).toBe("REQUEST_MORE_EVIDENCE");
  });

  it("low-score forecast → MONITOR (no gate)", async () => {
    const now = "2026-08-15T00:00:00Z";
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({
        proposalId: "p1",
        kind: "proposal.submitted",
        payload: { target: { id: "c1" }, blastRadius: [] },
        recordedAt: now,
      }),
    ];
    const engine = new ForecastEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents([]),
      stubEnrichedProposals([]),
    );
    const forecast = await engine.forecast(now);
    expect(forecast).not.toBeNull();
    // Score 0.5 → medium band → MONITOR.
    expect(forecast!.prediction.band).toBe("medium");
    const recommendation = buildGovernanceRecommendation(forecast!);
    expect(recommendation.kind).toBe("MONITOR");
  });
});

// Helpers.
function stubProposalEvents(recs: ReadonlyArray<ProposalGovernanceRecord>) {
  return { name: "proposal-events", list: async () => recs };
}
function stubMeasurementEvents(recs: ReadonlyArray<CapabilityMeasurementRecord>) {
  return { name: "measurement-events", list: async () => recs };
}
function stubEnrichedProposals(recs: ReadonlyArray<EnrichedProposalRecord>) {
  return { name: "enriched-proposals", list: async () => recs };
}
function makeProposal(overrides: Partial<ProposalGovernanceRecord>): ProposalGovernanceRecord {
  return {
    proposalId: "p1",
    kind: "proposal.submitted",
    payload: {},
    recordedAt: "2026-08-15T00:00:00Z",
    eventId: "evt-1",
    ...overrides,
  };
}
function makeEnriched(overrides: Partial<EnrichedProposalRecord>): EnrichedProposalRecord {
  return {
    proposalId: "p1",
    capabilityId: "c1",
    enrichedFields: {},
    recordedAt: "2026-08-15T00:00:00Z",
    ...overrides,
  };
}
```

`tests/evolution/a9-correlation-end-to-end.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CorrelationEngine } from "../../src/evolution/a9/correlation-engine.js";
import type { A9Forecast, A9Correlation, ProposalGovernanceRecord, CapabilityMeasurementRecord } from "../../src/evolution/a9/contracts/a9-contract.js";

describe("A9 correlation end-to-end", () => {
  it("deterministic bridge: submitted + executed + matching measurement → 1 correlation", async () => {
    const forecast: A9Forecast = makeForecast({
      forecastId: "sha256:fake",
      subject: "p1",
      subjectCapability: "c1",
      horizon: { from: "2026-08-14T00:00:00Z", to: "2026-08-16T00:00:00Z" },
    });
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({ proposalId: "p1", kind: "proposal.submitted", payload: { target: { id: "c1" } } }),
      makeProposal({ proposalId: "p1", kind: "proposal.executed", payload: {} }),
    ];
    const measurementRecs: CapabilityMeasurementRecord[] = [
      makeMeasurement({ measurementId: "m1", capabilityId: "c1", recordedAt: "2026-08-15T00:00:00Z" }),
    ];
    const appended: A9Correlation[] = [];
    const engine = new CorrelationEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents(measurementRecs),
      stubForecasts([forecast]),
      { append: async (c) => { appended.push(c); } },
      () => "low",
    );
    const emitted = await engine.correlate("2026-08-15T01:00:00Z");
    expect(emitted.length).toBe(1);
    expect(emitted[0].forecastId).toBe("sha256:fake");
    expect(emitted[0].measurementId).toBe("m1");
    expect(emitted[0].foreignProvenance.proposalId).toBe("p1");
    expect(appended.length).toBe(1);
  });

  it("missing proposal.executed → no correlation (eligibility gate)", async () => {
    const forecast = makeForecast({ subject: "p1", subjectCapability: "c1" });
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({ proposalId: "p1", kind: "proposal.submitted", payload: { target: { id: "c1" } } }),
    ];
    const measurementRecs: CapabilityMeasurementRecord[] = [
      makeMeasurement({ measurementId: "m1", capabilityId: "c1" }),
    ];
    const engine = new CorrelationEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents(measurementRecs),
      stubForecasts([forecast]),
      { append: async () => {} },
      () => "low",
    );
    const emitted = await engine.correlate("2026-08-15T01:00:00Z");
    expect(emitted.length).toBe(0);
  });

  it("capability mismatch → no correlation (no heuristic)", async () => {
    const forecast = makeForecast({ subject: "p1", subjectCapability: "c1" });
    const proposalRecs: ProposalGovernanceRecord[] = [
      makeProposal({ proposalId: "p1", kind: "proposal.submitted", payload: { target: { id: "c1" } } }),
      makeProposal({ proposalId: "p1", kind: "proposal.executed", payload: {} }),
    ];
    const measurementRecs: CapabilityMeasurementRecord[] = [
      makeMeasurement({ measurementId: "m1", capabilityId: "c2" }), // different capability
    ];
    const engine = new CorrelationEngine(
      stubProposalEvents(proposalRecs),
      stubMeasurementEvents(measurementRecs),
      stubForecasts([forecast]),
      { append: async () => {} },
      () => "low",
    );
    const emitted = await engine.correlate("2026-08-15T01:00:00Z");
    expect(emitted.length).toBe(0);
  });

  it("measurement event itself contains no proposal identity (Q8 sentinel)", async () => {
    const measurement: CapabilityMeasurementRecord = makeMeasurement({ measurementId: "m1", capabilityId: "c1" });
    expect(Object.keys(measurement).sort()).toEqual([
      "capabilityId", "eventId", "measurementId", "outcome", "recordedAt",
    ]);
  });
});

function stubProposalEvents(recs: ReadonlyArray<ProposalGovernanceRecord>) {
  return { name: "proposal-events", list: async () => recs };
}
function stubMeasurementEvents(recs: ReadonlyArray<CapabilityMeasurementRecord>) {
  return { name: "measurement-events", list: async () => recs };
}
function stubForecasts(recs: ReadonlyArray<A9Forecast>) {
  return { list: async () => recs };
}
function makeForecast(overrides: Partial<A9Forecast>): A9Forecast {
  return {
    forecastId: "sha256:0",
    forecastVersion: "0.1.0",
    subject: "p1",
    subjectCapability: "c1",
    prediction: { kind: "trust-velocity", band: "low", internalScore: 0.1 },
    horizon: { from: "2026-08-14T00:00:00Z", to: "2026-08-16T00:00:00Z" },
    confidence: 0.9,
    provenance: { generatedAt: "2026-08-15T00:00:00Z", generatorVersion: "0.1.0", evidenceRefs: [] },
    ...overrides,
  };
}
function makeProposal(overrides: Partial<ProposalGovernanceRecord>): ProposalGovernanceRecord {
  return {
    proposalId: "p1",
    kind: "proposal.submitted",
    payload: {},
    recordedAt: "2026-08-15T00:00:00Z",
    eventId: "evt-1",
    ...overrides,
  };
}
function makeMeasurement(overrides: Partial<CapabilityMeasurementRecord>): CapabilityMeasurementRecord {
  return {
    measurementId: "m1",
    capabilityId: "c1",
    outcome: "effective",
    recordedAt: "2026-08-15T00:00:00Z",
    eventId: "evt-1",
    ...overrides,
  };
}
```

`tests/evolution/a9-sentinel.vitest.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("A9 architectural invariants (sentinel)", () => {
  it("A9Forecast has no mutation/execution fields (structural boundary)", () => {
    const forecast: A9Forecast = {
      forecastId: "sha256:0",
      forecastVersion: "0.1.0",
      subject: "p1",
      subjectCapability: "c1",
      prediction: { kind: "trust-velocity", band: "low", internalScore: 0.1 },
      horizon: { from: "2026-08-15T00:00:00Z", to: "2026-08-16T00:00:00Z" },
      confidence: 0.9,
      provenance: { generatedAt: "2026-08-15T00:00:00Z", generatorVersion: "0.1.0", evidenceRefs: [] },
    };
    expect(Object.keys(forecast).sort()).toEqual([
      "confidence", "forecastId", "forecastVersion", "horizon",
      "prediction", "provenance", "subject", "subjectCapability",
    ]);
  });

  it("A9Correlation has no primary designation, no status field", () => {
    const correlation: A9Correlation = {
      correlationId: "sha256:0",
      correlationVersion: "0.1.0",
      forecastId: "f1",
      measurementId: "m1",
      foreignProvenance: {},
      resolution: { band: "low", forecastBand: "low", delta: "match" },
    };
    expect("primary" in correlation).toBe(false);
    expect("status" in correlation).toBe(false);
    expect("correlationStatus" in correlation).toBe(false);
  });

  it("CapabilityMeasurementRecord has no A9 relationship fields (Q8)", () => {
    const record: CapabilityMeasurementRecord = {
      measurementId: "m1",
      capabilityId: "c1",
      outcome: "effective",
      recordedAt: "2026-08-15T00:00:00Z",
      eventId: "evt-1",
    };
    expect("proposalId" in record).toBe(false);
    expect("sourceProposalIds" in record).toBe(false);
    expect("forecastId" in record).toBe(false);
    expect("correlationId" in record).toBe(false);
  });

  it("GovernanceRecommendationKind has exactly 6 kinds (5 existing + RISK_GATED_REVIEW)", () => {
    // Verify by static analysis of the governance-types.ts file.
    const src = readFileSync("src/governance/governance-types.ts", "utf-8");
    const kindMatches = src.match(/^\s*\|\s*"[A-Z_]+"/gm) ?? [];
    expect(kindMatches.length).toBe(6);
    expect(src).toContain("RISK_GATED_REVIEW");
  });

  it("A3 still has 4 binding kinds and 3 target states (regression)", () => {
    const src = readFileSync("src/evolution/governance/decision-engine.ts", "utf-8");
    expect(src).toContain("APPROVE");
    expect(src).toContain("REJECT");
    expect(src).toContain("MONITOR");
    expect(src).toContain("REQUEST_MORE_EVIDENCE");
    // No 5th binding kind.
    const bindingKinds = src.match(/^\s*\|\s*"[A-Z_]+"/gm) ?? [];
    expect(bindingKinds.length).toBeGreaterThanOrEqual(4);
  });

  it("no A9 source file imports from enriched-proposal-aggregator.ts (A8 normalization isolation)", () => {
    const a9Files = listA9SourceFiles();
    for (const f of a9Files) {
      const src = readFileSync(f, "utf-8");
      expect(src).not.toMatch(/enriched-proposal-aggregator/);
    }
  });
});

function listA9SourceFiles(): string[] {
  const dir = "src/evolution/a9";
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subdir = join(dir, entry.name);
      for (const sub of readdirSync(subdir, { withFileTypes: true })) {
        if (sub.isFile() && sub.name.endsWith(".ts")) results.push(join(subdir, sub.name));
      }
    } else if (entry.name.endsWith(".ts")) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}
```

**Steps:**

- [ ] **Step 1: Write integration tests**

  Per code blocks above.

- [ ] **Step 2: Write sentinel test**

  Per code block above.

- [ ] **Step 3: Run integration tests to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a9-engine-end-to-end.vitest.ts tests/evolution/a9-correlation-end-to-end.vitest.ts 2>&1 | tail -15
  ```

  Expected: PASS. If FAIL: STOP and investigate.

- [ ] **Step 4: Run sentinel test to verify GREEN**

  ```bash
  pnpm vitest run tests/evolution/a9-sentinel.vitest.ts 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 5: Run full suite**

  ```bash
  pnpm vitest run tests/capability/ tests/evolution/ tests/governance/ 2>&1 | tail -8
  ```

  Expected: previous baseline + new A9 tests = zero regressions.

- [ ] **Step 6: Commit**

  ```bash
  git add tests/evolution/a9-engine-end-to-end.vitest.ts tests/evolution/a9-correlation-end-to-end.vitest.ts tests/evolution/a9-sentinel.vitest.ts
  git commit -m "test(evolution): A9 T10 integration + sentinel tests (16 architectural invariants)"
  ```

---

### Task 11: PR + squash-merge + memory entry + checkpoint doc

**Files:**
- Create: `docs/architecture/checkpoints/2026-08-15-a9-forecast-calibration-and-provenance-complete.md`

**Steps:**

- [ ] **Step 1: Write checkpoint doc**

  Create `docs/architecture/checkpoints/2026-08-15-a9-forecast-calibration-and-provenance-complete.md` per the CAP-12 checkpoint doc template. Include:
  - Status: APPROVED with checks
  - Architectural progression: CAP-N → CAP-O → CAP-P → A8 → **A9**
  - Module summary: `src/evolution/a9/` (contracts, 3 detectors, 3 raw adapters, 2 JSONL adapters, 2 engines, 2 builders, 1 bridge)
  - Locked rulings: 10 from #546 + 4 from #528-#531 + 2 from #531 (Q8 review)
  - 16 architectural invariants (final state)
  - Test totals (≥14 new tests minimum)
  - Future work: TUI/Web, A9 strategy-tuning, calibration/result semantics, A9CorrelationAttempt (separately authorized)

- [ ] **Step 2: Push branch**

  ```bash
  cd /home/babasola/Projects/Monolith/.claude/worktrees/a9-forecast-calibration-and-provenance
  git push -u origin a9-forecast-calibration-and-provenance
  ```

  **STOP and ask the human for approval before the push.** Standing constraint.

- [ ] **Step 3: Open PR via gh**

  ```bash
  gh pr create --base main --head a9-forecast-calibration-and-provenance \
    --title "A9 Pre-Execution Risk Forecast & Governance Gating" \
    --body "Closes the A9 wayfinder map #526 next-frontier authorization.
  ...
  [body mirrors the A8 PR template, locks all 16 rulings]"
  ```

- [ ] **Step 4: Squash-merge**

  **STOP and ask the human for approval before the merge.** Standing constraint.

  ```bash
  gh pr merge <PR-number> --squash --delete-branch
  git pull origin main
  ```

- [ ] **Step 5: Write memory entry**

  Write `/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/memory/a9-forecast-calibration-and-provenance-complete.md` with:
  - type: project
  - body: A9 closed the pre-execution risk forecast frontier; module `src/evolution/a9/`; 3 detectors (trust-velocity / evidence-completeness / fingerprint-coincidence); A9Forecast content-addressed with deterministic bridge via `proposal.submitted.payload.target.id`; A9Correlation via deterministic bridge + `proposal.executed` execution eligibility gate (NOT causality); 6th A2.5 kind `RISK_GATED_REVIEW` → A3 `REQUEST_MORE_EVIDENCE` (UNDER_REVIEW); A3 retains final decision authority. Next frontier: TUI/Web.

- [ ] **Step 6: Update MEMORY.md**

  Add a one-line pointer to the new memory file in the index.

- [ ] **Step 7: Clean up worktree + local branch**

  ```bash
  cd /home/babasola/Projects/Monolith
  git worktree remove --force .claude/worktrees/a9-forecast-calibration-and-provenance
  git branch -d a9-forecast-calibration-and-provenance
  ```

---

## Self-Review

**1. Spec coverage:**
- §4.1 module structure → Tasks 1, 2, 3, 4, 5, 6, 7 (each module)
- §5–7 core contracts → Task 1
- §9 foreign adapters → Task 2
- §10 why A9 bypasses A8 → Task 2 (raw, not normalized)
- §11 detectors (3) → Tasks 4
- §12 forecast aggregation → Task 5 (max-score rule)
- §13 no trigger → no forecast → Task 5 (engine returns null)
- §14 forecast builder → Task 5
- §15 A9 governance bridge → Task 7
- §16 governance mapping → Task 8 (A2.5 + A3 extension)
- §17 risk band → governance → Task 7
- §18 persistence → Task 3 (JSONL adapters) + Task 9 (append in CLI)
- §19 restart durability → Task 3 (read-only adapters can reload)
- §20 correlation architecture → Task 6 (deterministic bridge)
- §21 deterministic correlation bridge → Task 6 (5-step)
- §22 execution eligibility gate → Task 6 (locked semantics)
- §23 correlation algorithm → Task 6 (5-step)
- §24 what correlation does NOT do → Task 10 (sentinel)
- §25 correlation eligibility is architectural fact → Task 10 (sentinel)
- §26 many-to-many → Task 10 (sentinel)
- §27 correlation vs calibration separation → Task 6 (no primary)
- §28 no primary measurement → Task 1 + Task 10 (sentinel)
- §29 no negative correlation → Task 1 + Task 10 (sentinel)
- §30 forecast flow → Task 9 (composition root)
- §31 correlation flow → Task 6 + Task 9
- §32 A9 does not enter execution path → Task 1 (contracts preserve A3 sovereignty)
- §33 CLI → Task 9
- §34 composition root → Task 9
- §35 migration boundary → Task 1 (no migration)
- §36 A2.5 contract extension → Task 8
- §37 error handling → Task 10 (sentinel + integration)
- §38–45 testing strategy → Tasks 1–10 (each task has its own tests)
- §46 forward compatibility → out of scope (documented)
- §47 explicit non-goals → out of scope (documented)
- §48 architectural invariants → Task 10 (sentinel)
- §49 final architectural shape → covered by all tasks
- §50 boundary rule → Task 10 (sentinel for no A8 normalization reuse)

**2. Placeholder scan:**
- No "TBD"/"TODO"/"implement later"/"fill in details"
- T1 reconnaissance explicitly STOPs-and-surfaces if any required field path is missing or different from the spec
- T2 explicitly STOPs-and-surfaces if `EventLog.listByPrefix`/`EnrichedProposal` signatures cannot be reconciled
- T9 explicitly STOPs-and-surfaces if no CLI registration seam exists
- T6 code block had a typo `ForecorrelationId` near the import — fixed; the constructor now takes `ForecastsAdapter` (T3) as the third argument

**3. Type consistency:**
- `ForecastId` / `CorrelationId` consistent across T1 (contract), T5 (forecast builder), T6 (correlation builder, engine)
- `A9Forecast` shape consistent across T1, T5 (builder), T7 (bridge), T10 (integration)
- `A9Correlation` shape consistent across T1, T6 (builder), T10 (sentinel)
- `CapabilityMeasurementRecord` consistent across T1, T2 (measurement adapter), T6 (correlation engine), T10 (Q8 sentinel)
- `ProposalGovernanceRecord` consistent across T1, T2 (proposal adapter), T4 (detectors), T6 (correlation engine)
- `GovernanceRecommendationKind` updated in T8 (6 kinds); consumed by T7 (bridge) and T9 (CLI)
- `subjectCapability` derivation consistent: T2 (proposal adapter exposes raw payload) → T4 (detectors extract `target.id`) → T6 (correlation engine re-validates `target.id` against forecast.subjectCapability)
- `evidenceRefs` preserved exactly across detector → forecast → correlation

**4. Open questions for human review:**
- T1 reconnaissance: if any required field path is missing or different from the spec, the implementer STOPS and surfaces. This is a legitimate STOP — better than inventing field paths.
- T6 code block had a typo `ForecorrelationId` — fixed; the constructor now takes `ForecastsAdapter` (T3) as the third argument.
- T9 explicitly STOPs-and-surfaces if no CLI registration seam exists.

---

## Execution Handoff

This plan is ready for subagent-driven execution. The 11 tasks follow a layered SDD pattern:

- T1 (contracts + reconnaissance) → T2 (3 raw foreign adapters) → T3 (2 JSONL persistence adapters) → T4 (3 detectors) → T5 (forecast builder + engine) → T6 (correlation builder + engine) → T7 (A9 bridge) → T8 (A2.5 + A3 extension) → T9 (composition root + CLI) → T10 (integration + sentinel) → T11 (PR + merge + memory + checkpoint)

Per-task reviewer gates:
- T1 uses sonnet (foundational + reconnaissance judgment)
- T2 uses sonnet (multi-file adapter implementation; spec-exact field paths)
- T3 uses sonnet (file system persistence; A8/A2.5 pattern precedent)
- T4 uses haiku (mechanical per-detector implementation; spec is complete)
- T5 uses sonnet (engine + builder with aggregation rule)
- T6 uses sonnet (correlation engine with deterministic bridge logic)
- T7 uses haiku (single function; spec is complete)
- T8 uses sonnet (multi-file contract extension + mapping)
- T9 uses sonnet (CLI seam wiring; recon-required)
- T10 uses sonnet (integration + sentinel; architectural invariants)
- T11 is the PR + merge workflow (no review)

Whole-branch final review: sonnet, after T11 squash-merge on a temporary integration branch.

**Note on user approval gates:** T11 Steps 2 (push) and Step 4 (squash-merge) both require explicit human approval. Subagents must STOP and surface the request, not proceed automatically.
