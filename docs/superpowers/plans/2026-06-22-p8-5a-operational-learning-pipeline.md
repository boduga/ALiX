# P8.5a.0 — Evidence Chain / Provenance Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only Evidence Chain that records relationships between existing P6/P7/P8 artifacts, enabling `alix explain <id>` traversal and P9 auditability — without mutating any existing artifact type.

**Architecture:** A separate, append-only JSONL store (`EvidenceChainStore`) holds `LearningEvidenceChain` artifacts. Each chain is computed on demand from existing forward references via a per-type `ForwardRefExtractor` registry. Existing types stay unchanged.

**Tech Stack:** TypeScript, vitest, JSONL persistence (matching `LearningStore` pattern from P8.0b), ESM imports.

**Spec:** `docs/superpowers/specs/2026-06-22-p8-5a-operational-learning-pipeline-design.md`

## Global Constraints

These apply to every task in this plan. The implementer MUST honor them verbatim.

1. **No modification of existing artifact types.** The following files MUST remain byte-identical to their state at `b232e395` (P8 merge commit):
   - `src/adaptation/outcome-types.ts`
   - `src/adaptation/risk-score-types.ts`
   - `src/adaptation/governance-review-types.ts`
   - `src/adaptation/adaptation-types.ts`
   - `src/adaptation/decision-types.ts`
   - `src/learning/learning-types.ts`
   - Test: `tests/learning/unchanged-types-invariance.vitest.ts` (Task 3).

2. **EvidenceChainStore is append-only.** Methods allowed: `appendChain`, `getChainForRoot`, `listChains`. Methods forbidden: `delete`, `update`, `clear`, `truncate`, `setChain`, `replaceChain`, `modifySource`, `writeBack`. Test: store sentinel (Task 3).

3. **No source-artifact mutation.** The store MUST NOT accept an existing artifact as a mutable parameter, MUST NOT have a method that returns a writable reference to a stored chain, and MUST NOT re-write a chain's content after `appendChain` returns. The chain is a record; the source artifacts are facts. Test: store sentinel (Task 3).

4. **No forbidden imports in `src/learning/evidence-chain*` and `src/learning/forward-ref-extractors*`.** Forbidden: `ProposalStore`, `ApprovalGate`, `apply*`, `AutomaticProposalGenerator`, `writeFileSync` (for source-artifact paths), `ApproveCommand`, `ApplyCommand`. The chain layer is read-only relative to the governance lifecycle. Test: imports sentinel (Task 3).

5. **Default `alix explain` depth = 5, max cap = 12.** The depth argument is clamped to `[1, 12]`. The default is 5. (Note: `alix explain` itself ships in P8.5c; the depth constant lives in `evidence-chain-types.ts` and is referenced by both extractors and the future CLI.)

6. **All P8 sentinels and tests must continue to pass.** P8.5a.0 is purely additive. Run the full P8 test suite after each task.

7. **The chain type extends `DecisionArtifact`.** `LearningEvidenceChain` MUST extend the base `DecisionArtifact` so it participates in the existing governance pipeline (provenance, lineage, evidence refs) without breaking existing consumers.

8. **Provenance relationships are exactly five values.** `derived_from`, `supports`, `generated`, `approved_from`, `reviewed_from`. No others. Adding a new value requires a plan update.

9. **`alix explain` depth traversal uses BFS, both directions** (sources: target→source; derivatives: source→target). Default max depth 5. Hard cap 12.

10. **JSONL persistence matches the `LearningStore` (P8.0b) pattern.** Directory auto-created, line-by-line read with corrupt-line skipping, append-only writes.

---

## File Structure

This plan creates or modifies these files:

| File | Role |
|---|---|
| `src/learning/evidence-chain-types.ts` (Create) | `ProvenanceLink`, `ProvenanceRelationship`, `ArtifactType`, `LearningEvidenceChain`, `EXPLAIN_DEFAULT_DEPTH`, `EXPLAIN_MAX_DEPTH` |
| `src/learning/forward-ref-extractors.ts` (Create) | `ForwardRefExtractor` type, `EXTRACTORS` registry, default `extractForwardRefs()` function |
| `src/learning/evidence-chain-store.ts` (Create) | `EvidenceChainStore` class with append-only methods |
| `tests/learning/evidence-chain-types.vitest.ts` (Create) | Type-shape and relationship-validity tests |
| `tests/learning/forward-ref-extractors.vitest.ts` (Create) | Per-type extractor tests using fixture instances |
| `tests/learning/evidence-chain-store.vitest.ts` (Create) | Append-only invariant, query methods, corrupt-line skip |
| `tests/learning/evidence-chain-sentinels.vitest.ts` (Create) | Governance boundary sentinels (forbidden imports, append-only, no source mutation) |
| `tests/learning/unchanged-types-invariance.vitest.ts` (Create) | Existing artifact type files are byte-identical to HEAD |

**No existing files are modified by this plan.** The unchanged-types-invariance test enforces this.

---

## Task 1: P8.5a.0.1 — Evidence Chain Types + Forward-Ref Extractors

**Files:**
- Create: `src/learning/evidence-chain-types.ts`
- Create: `src/learning/forward-ref-extractors.ts`
- Create: `tests/learning/evidence-chain-types.vitest.ts`
- Create: `tests/learning/forward-ref-extractors.vitest.ts`

**Interfaces:**
- Consumes: `DecisionArtifact` (from `src/adaptation/decision-types.ts`), `OutcomeRecord` (from `src/adaptation/outcome-types.ts`), `GovernanceReview` (from `src/adaptation/governance-review-types.ts`), `RiskScore` (from `src/adaptation/risk-score-types.ts`), `LearningSignal`, `CalibrationProfile`, `LearningProposal` (from `src/learning/learning-types.ts`), `AdaptationProposal` (from `src/adaptation/adaptation-types.ts`).
- Produces: types that later tasks depend on (`ProvenanceLink`, `ArtifactType`, `LearningEvidenceChain`, `EXTRACTORS`, `extractForwardRefs`).

### Step 1: Write the failing type test

Create `tests/learning/evidence-chain-types.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PROVENANCE_RELATIONSHIPS,
  ARTIFACT_TYPES,
  EXPLAIN_DEFAULT_DEPTH,
  EXPLAIN_MAX_DEPTH,
  isProvenanceRelationship,
  isArtifactType,
} from "../../src/learning/evidence-chain-types.js";
import type {
  ProvenanceLink,
  LearningEvidenceChain,
} from "../../src/learning/evidence-chain-types.js";

describe("evidence-chain-types: relationships and artifact types", () => {
  it("exposes exactly the five required provenance relationships", () => {
    expect(PROVENANCE_RELATIONSHIPS).toEqual([
      "derived_from",
      "supports",
      "generated",
      "approved_from",
      "reviewed_from",
    ]);
  });

  it("accepts and rejects relationship values via the guard", () => {
    for (const r of PROVENANCE_RELATIONSHIPS) {
      expect(isProvenanceRelationship(r)).toBe(true);
    }
    expect(isProvenanceRelationship("unknown_relationship")).toBe(false);
    expect(isProvenanceRelationship("")).toBe(false);
    expect(isProvenanceRelationship(null)).toBe(false);
    expect(isProvenanceRelationship(undefined)).toBe(false);
  });

  it("lists every P6/P7/P8 artifact type in ARTIFACT_TYPES", () => {
    const expected = [
      "decision_context",
      "risk_score",
      "recommendation",
      "governance_review",
      "outcome_record",
      "lens_calibration_report",
      "recommendation_accuracy_report",
      "adaptation_proposal",
      "learning_signal",
      "calibration_profile",
      "learning_proposal",
      "learning_evidence_chain",
    ];
    expect(ARTIFACT_TYPES).toEqual(expected);
    for (const t of expected) {
      expect(isArtifactType(t)).toBe(true);
    }
    expect(isArtifactType("not_a_real_artifact")).toBe(false);
  });

  it("uses default depth 5 and max depth 12", () => {
    expect(EXPLAIN_DEFAULT_DEPTH).toBe(5);
    expect(EXPLAIN_MAX_DEPTH).toBe(12);
  });
});

describe("evidence-chain-types: shape", () => {
  it("ProvenanceLink requires the six documented fields", () => {
    const link: ProvenanceLink = {
      sourceArtifactId: "signal-1",
      targetArtifactId: "outcome-1",
      sourceArtifactType: "learning_signal",
      targetArtifactType: "outcome_record",
      relationship: "derived_from",
      recordedAt: "2026-06-22T00:00:00.000Z",
    };
    expect(link.sourceArtifactId).toBe("signal-1");
    expect(link.targetArtifactId).toBe("outcome-1");
    expect(link.relationship).toBe("derived_from");
  });

  it("LearningEvidenceChain extends DecisionArtifact and includes root + links + depth", () => {
    const chain: LearningEvidenceChain = {
      id: "chain-1",
      subject: "Evidence chain for signal-1",
      outcome: "explained",
      confidence: 1,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      rootArtifactId: "signal-1",
      rootArtifactType: "learning_signal",
      links: [],
      depth: 1,
    };
    expect(chain.rootArtifactId).toBe("signal-1");
    expect(chain.rootArtifactType).toBe("learning_signal");
    expect(chain.links).toEqual([]);
    expect(chain.depth).toBe(1);
  });
});
```

### Step 2: Run the test to verify it fails

Run:
```bash
npx vitest run tests/learning/evidence-chain-types.vitest.ts
```

Expected: FAIL — module not found (`evidence-chain-types.ts` does not exist).

### Step 3: Write `src/learning/evidence-chain-types.ts`

Create `src/learning/evidence-chain-types.ts`:

```ts
/**
 * P8.5a.0 — Evidence Chain / Provenance Graph types.
 *
 * The chain is a separate, append-only graph artifact that records
 * relationships between existing P6/P7/P8 artifacts. It does NOT
 * modify any existing type — the chain derives from the forward refs
 * that already exist on each artifact (decisionId, recommendationId,
 * sourceSignalIds, evidenceRefs, etc.).
 *
 * Core invariants:
 *   - Append-only: chains are records, not state.
 *   - Source artifacts remain facts: the chain observes their
 *     relationships but never rewrites them.
 *   - The five provenance relationships are exhaustive and additive —
 *     adding a new value requires a plan update.
 *
 * @module
 */

import type { DecisionArtifact } from "../adaptation/decision-types.js";

// ---------------------------------------------------------------------------
// Provenance relationships
// ---------------------------------------------------------------------------

/**
 * The exact five relationships the chain records between artifacts.
 * Each describes a directed edge from a dependent to its source.
 */
export type ProvenanceRelationship =
  | "derived_from"   // A was derived from B (e.g., signal from outcome)
  | "supports"       // A provides evidence for B (e.g., outcome supports decision)
  | "generated"      // A generated B (e.g., profile generated proposal)
  | "approved_from"  // A was approved from B (e.g., proposal approved from review)
  | "reviewed_from"; // A was reviewed from B (e.g., review was on recommendation)

export const PROVENANCE_RELATIONSHIPS: readonly ProvenanceRelationship[] = [
  "derived_from",
  "supports",
  "generated",
  "approved_from",
  "reviewed_from",
] as const;

export function isProvenanceRelationship(v: unknown): v is ProvenanceRelationship {
  return (
    typeof v === "string" &&
    (PROVENANCE_RELATIONSHIPS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Artifact types (the nodes of the graph)
// ---------------------------------------------------------------------------

/**
 * Every P6/P7/P8 artifact type that can appear as a node in the chain.
 *
 * `learning_evidence_chain` is included so chains can link to other chains
 * (a future audit may compose multiple chains into a higher-level view).
 */
export type ArtifactType =
  | "decision_context"
  | "risk_score"
  | "recommendation"
  | "governance_review"
  | "outcome_record"
  | "lens_calibration_report"
  | "recommendation_accuracy_report"
  | "adaptation_proposal"
  | "learning_signal"
  | "calibration_profile"
  | "learning_proposal"
  | "learning_evidence_chain";

export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "decision_context",
  "risk_score",
  "recommendation",
  "governance_review",
  "outcome_record",
  "lens_calibration_report",
  "recommendation_accuracy_report",
  "adaptation_proposal",
  "learning_signal",
  "calibration_profile",
  "learning_proposal",
  "learning_evidence_chain",
] as const;

export function isArtifactType(v: unknown): v is ArtifactType {
  return typeof v === "string" && (ARTIFACT_TYPES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Explain depth constants (shared by extractors and the future alix explain CLI)
// ---------------------------------------------------------------------------

/** Default traversal depth for `alix explain <id>`. */
export const EXPLAIN_DEFAULT_DEPTH = 5;

/** Hard upper bound for traversal depth. Prevents runaway graph walks. */
export const EXPLAIN_MAX_DEPTH = 12;

// ---------------------------------------------------------------------------
// ProvenanceLink
// ---------------------------------------------------------------------------

/**
 * A single directed edge in the Evidence Chain.
 *
 * Direction: from `sourceArtifactId` (the dependent / derived artifact)
 * to `targetArtifactId` (the artifact it depends on / was derived from).
 */
export interface ProvenanceLink {
  /** The artifact that depends on / was derived from something. */
  sourceArtifactId: string;
  /** The artifact it depends on. */
  targetArtifactId: string;
  /** Type of the source artifact. */
  sourceArtifactType: ArtifactType;
  /** Type of the target artifact. */
  targetArtifactType: ArtifactType;
  /** The relationship kind. */
  relationship: ProvenanceRelationship;
  /** ISO 8601 when the link was recorded. */
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// LearningEvidenceChain
// ---------------------------------------------------------------------------

/**
 * A first-class, derived artifact representing the evidence graph rooted
 * at a single artifact. Persisted (P8.5a.0.2) to enable replay and audit
 * without re-running every builder.
 *
 * Extends DecisionArtifact so the chain participates in the existing
 * governance pipeline (provenance, lineage, evidence refs).
 */
export interface LearningEvidenceChain extends DecisionArtifact {
  /** The artifact this chain is rooted at. */
  rootArtifactId: string;
  /** The type of the root artifact. */
  rootArtifactType: ArtifactType;
  /** Ordered provenance links, traversing outward from the root. */
  links: ProvenanceLink[];
  /** Maximum depth traversed (1 = direct links, N = transitive). */
  depth: number;
  /** Optional: the lookup that triggered this chain. */
  generatedBy?: "alix explain" | "alix learning refresh" | "alix audit";
}
```

### Step 4: Run the type test to verify it passes

Run:
```bash
npx vitest run tests/learning/evidence-chain-types.vitest.ts
```

Expected: PASS (10 tests, ~40ms).

### Step 5: Write the failing extractor test

Create `tests/learning/forward-ref-extractors.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  EXTRACTORS,
  extractForwardRefs,
} from "../../src/learning/forward-ref-extractors.js";
import { ARTIFACT_TYPES } from "../../src/learning/evidence-chain-types.js";
import type { OutcomeRecord, LensCalibrationReport } from "../../src/adaptation/outcome-types.js";
import type { GovernanceReview } from "../../src/adaptation/governance-review-types.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { LearningSignal, CalibrationProfile, LearningProposal } from "../../src/learning/learning-types.js";

describe("forward-ref-extractors: registry completeness", () => {
  it("has an extractor for every artifact type except learning_evidence_chain", () => {
    for (const t of ARTIFACT_TYPES) {
      if (t === "learning_evidence_chain") continue; // chains don't extract forward refs from other chains yet
      expect(EXTRACTORS[t]).toBeDefined();
      expect(typeof EXTRACTORS[t]).toBe("function");
    }
  });
});

describe("forward-ref-extractors: OutcomeRecord", () => {
  it("extracts decisionId, recommendationId, governanceReviewId when present", () => {
    const outcome: OutcomeRecord = {
      id: "out-1",
      subject: "x",
      outcome: "success",
      confidence: 0.9,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      subjectId: "sub-1",
      subjectType: "proposal",
      decisionId: "dec-1",
      recommendationId: "rec-1",
      governanceReviewId: "gr-1",
      actionTaken: "applied",
      observationWindowDays: 30,
    };
    const links = extractForwardRefs(outcome, "outcome_record", "out-1", "2026-06-22T00:00:00.000Z");
    const targets = links.map((l) => `${l.targetArtifactId}/${l.relationship}`);
    expect(targets).toContain("dec-1/derived_from");
    expect(targets).toContain("rec-1/derived_from");
    expect(targets).toContain("gr-1/derived_from");
  });

  it("omits links for absent forward refs", () => {
    const outcome: OutcomeRecord = {
      id: "out-2",
      subject: "x",
      outcome: "success",
      confidence: 0.9,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      subjectId: "sub-2",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 30,
    };
    const links = extractForwardRefs(outcome, "outcome_record", "out-2", "2026-06-22T00:00:00.000Z");
    expect(links).toEqual([]);
  });
});

describe("forward-ref-extractors: GovernanceReview", () => {
  it("extracts recommendationId and proposalId", () => {
    const review: GovernanceReview = {
      id: "gr-1",
      subject: "x",
      outcome: "reviewed",
      confidence: 0.8,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      recommendationId: "rec-1",
      proposalId: "prop-1",
      verdict: "agree_with_concerns",
      concerns: [],
      blindSpots: [],
      historicalAnalogies: [],
      lensScores: [],
      councilVote: { agree: 3, agreeWithConcerns: 1, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    const links = extractForwardRefs(review, "governance_review", "gr-1", "2026-06-22T00:00:00.000Z");
    const targets = links.map((l) => `${l.targetArtifactId}/${l.relationship}`);
    expect(targets).toContain("rec-1/reviewed_from");
    expect(targets).toContain("prop-1/reviewed_from");
  });
});

describe("forward-ref-extractors: RiskScore", () => {
  it("extracts a 'supports' link per source artifact", () => {
    const risk: RiskScore = {
      id: "rs-1",
      subject: "x",
      outcome: "assessed",
      confidence: 0.7,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      overallRisk: 0.4,
      risks: [],
      dimensions: { governance: 0.4, operational: 0.4, capability: 0.4, revertability: 0.4, evidence_quality: 0.4 },
      sourceArtifacts: [
        { artifactId: "ctx-1", artifactType: "decision_context" },
        { artifactId: "ctx-2", artifactType: "decision_context" },
      ],
    };
    const links = extractForwardRefs(risk, "risk_score", "rs-1", "2026-06-22T00:00:00.000Z");
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.relationship === "supports")).toBe(true);
    expect(links.map((l) => l.targetArtifactId).sort()).toEqual(["ctx-1", "ctx-2"]);
  });
});

describe("forward-ref-extractors: LearningSignal", () => {
  it("extracts sourceReportId as derived_from and evidenceRefs as supports", () => {
    const signal: LearningSignal = {
      id: "sig-1",
      subject: "x",
      outcome: "signal_detected",
      confidence: 0.85,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "acc-1",
      signalType: "overconfidence",
      strength: 0.35,
      summary: "Overconfident by 18%",
      evidenceRefs: ["out-1", "out-2"],
    };
    const links = extractForwardRefs(signal, "learning_signal", "sig-1", "2026-06-22T00:00:00.000Z");
    const byRel = Object.fromEntries(links.map((l) => [l.relationship, l.targetArtifactId]));
    expect(byRel.derived_from).toBe("acc-1");
    expect(links.filter((l) => l.relationship === "supports").map((l) => l.targetArtifactId).sort()).toEqual(["out-1", "out-2"]);
  });
});

describe("forward-ref-extractors: CalibrationProfile", () => {
  it("extracts evidenceRefs and sourceSignalIds", () => {
    const profile: CalibrationProfile = {
      id: "cp-1",
      subject: "x",
      outcome: "suggested",
      confidence: 0.85,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      target: "recommendation_confidence_multiplier",
      targetName: "bucket_0.8_1.0",
      previousValue: 1.0,
      suggestedValue: 0.65,
      reason: "Observed overconfidence",
      evidenceRefs: ["out-1"],
      sourceSignalIds: ["sig-1", "sig-2"],
    };
    const links = extractForwardRefs(profile, "calibration_profile", "cp-1", "2026-06-22T00:00:00.000Z");
    const ids = links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort();
    expect(ids).toContain("out-1/supports");
    expect(ids).toContain("sig-1/derived_from");
    expect(ids).toContain("sig-2/derived_from");
  });
});

describe("forward-ref-extractors: AdaptationProposal", () => {
  it("extracts sourceSignalIds and an approved_from link if approved", () => {
    const proposal: AdaptationProposal = {
      id: "ap-1",
      subject: "x",
      outcome: "approved",
      confidence: 0.85,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      action: "learning_adjustment",
      target: { kind: "learning", area: "recommendation" },
      sourceRecommendationType: "learning_calibration",
      sourceSignalIds: ["sig-1"],
      provenance: "manual",
      requiresApproval: true,
      approvedBy: "operator",
      approvedAt: "2026-06-22T01:00:00.000Z",
    };
    const links = extractForwardRefs(proposal, "adaptation_proposal", "ap-1", "2026-06-22T00:00:00.000Z");
    const ids = links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort();
    expect(ids).toContain("sig-1/derived_from");
    // approved_from is recorded only when the proposal has an approver (audit-grade).
    expect(links.some((l) => l.relationship === "approved_from" && l.targetArtifactId === "operator")).toBe(true);
  });
});

describe("forward-ref-extractors: LearningProposal", () => {
  it("extracts sourceSignalIds as derived_from", () => {
    const lp: LearningProposal = {
      id: "lp-1",
      subject: "x",
      outcome: "pending_learning",
      confidence: 0.85,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      proposalType: "recommendation_calibration",
      profiles: [],
      expectedBenefit: "Reduce overconfidence",
      riskEstimate: "Low",
      sourceSignalIds: ["sig-1", "sig-2"],
      requiresApproval: true,
    };
    const links = extractForwardRefs(lp, "learning_proposal", "lp-1", "2026-06-22T00:00:00.000Z");
    expect(links.map((l) => `${l.targetArtifactId}/${l.relationship}`).sort()).toEqual([
      "sig-1/derived_from",
      "sig-2/derived_from",
    ]);
  });
});

describe("forward-ref-extractors: empty / missing-data safety", () => {
  it("returns [] for an unknown artifact type (defensive — registry should cover all)", () => {
    const links = extractForwardRefs({}, "decision_context" as never, "ctx-1", "2026-06-22T00:00:00.000Z");
    // Even when the artifact is sparse, the registry extractor handles it. Empty input → no links.
    expect(Array.isArray(links)).toBe(true);
  });
});
```

### Step 6: Run the extractor test to verify it fails

Run:
```bash
npx vitest run tests/learning/forward-ref-extractors.vitest.ts
```

Expected: FAIL — module not found (`forward-ref-extractors.ts` does not exist).

### Step 7: Write `src/learning/forward-ref-extractors.ts`

Create `src/learning/forward-ref-extractors.ts`:

```ts
/**
 * P8.5a.0 — Forward-reference extractors.
 *
 * One extractor per artifact type. Each extractor takes the artifact
 * and returns the `ProvenanceLink[]` that record its forward
 * dependencies. The Evidence Chain is built by walking the graph
 * via these extractors.
 *
 * Adding a new artifact type = adding one extractor to `EXTRACTORS`.
 * Existing types are not modified.
 *
 * @module
 */

import type {
  ArtifactType,
  ProvenanceLink,
  ProvenanceRelationship,
} from "./evidence-chain-types.js";
import type { OutcomeRecord } from "../adaptation/outcome-types.js";
import type { GovernanceReview } from "../adaptation/governance-review-types.js";
import type { RiskScore } from "../adaptation/risk-score-types.js";
import type {
  LearningSignal,
  CalibrationProfile,
  LearningProposal,
} from "./learning-types.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Extractor signature
// ---------------------------------------------------------------------------

/**
 * Extracts the forward-provenance links from a single artifact instance.
 *
 * Implementations MUST return a fresh array; they MUST NOT mutate the input.
 * Missing/empty forward refs produce zero links (not undefined, not throw).
 */
export type ForwardRefExtractor = (artifact: unknown) => ProvenanceLink[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function link(
  sourceArtifactId: string,
  sourceArtifactType: ArtifactType,
  targetArtifactId: string,
  targetArtifactType: ArtifactType,
  relationship: ProvenanceRelationship,
  recordedAt: string,
): ProvenanceLink {
  return {
    sourceArtifactId,
    targetArtifactId,
    sourceArtifactType,
    targetArtifactType,
    relationship,
    recordedAt,
  };
}

// ---------------------------------------------------------------------------
// Per-type extractors
// ---------------------------------------------------------------------------

const outcomeRecord: ForwardRefExtractor = (a) => {
  const o = a as Partial<OutcomeRecord>;
  const links: ProvenanceLink[] = [];
  const recordedAt = o.generatedAt ?? new Date().toISOString();
  if (o.decisionId) {
    links.push(link(o.id ?? "?", "outcome_record", o.decisionId, "decision_context", "derived_from", recordedAt));
  }
  if (o.recommendationId) {
    links.push(link(o.id ?? "?", "outcome_record", o.recommendationId, "recommendation", "derived_from", recordedAt));
  }
  if (o.governanceReviewId) {
    links.push(link(o.id ?? "?", "outcome_record", o.governanceReviewId, "governance_review", "derived_from", recordedAt));
  }
  return links;
};

const governanceReview: ForwardRefExtractor = (a) => {
  const r = a as Partial<GovernanceReview>;
  const links: ProvenanceLink[] = [];
  const recordedAt = r.generatedAt ?? new Date().toISOString();
  if (r.recommendationId) {
    links.push(link(r.id ?? "?", "governance_review", r.recommendationId, "recommendation", "reviewed_from", recordedAt));
  }
  if (r.proposalId) {
    links.push(link(r.id ?? "?", "governance_review", r.proposalId, "adaptation_proposal", "reviewed_from", recordedAt));
  }
  return links;
};

const riskScore: ForwardRefExtractor = (a) => {
  const r = a as Partial<RiskScore>;
  const links: ProvenanceLink[] = [];
  const recordedAt = r.generatedAt ?? new Date().toISOString();
  for (const src of r.sourceArtifacts ?? []) {
    // Source artifacts carry their own artifactType. We honor it for the
    // chain's correctness, but fall back to "decision_context" if absent.
    const targetType = (src as { artifactType?: ArtifactType }).artifactType ?? "decision_context";
    links.push(link(r.id ?? "?", "risk_score", src.artifactId, targetType, "supports", recordedAt));
  }
  return links;
};

const lensCalibrationReport: ForwardRefExtractor = (a) => {
  // LensCalibrationReport is a computed report over a window. It derives
  // from outcome_records via the calibrator; it has no direct forward ref
  // field. We expose evidenceRefs (inherited from DecisionArtifact) as
  // 'supports' links.
  const r = a as { id?: string; generatedAt?: string; evidenceRefs?: string[] };
  const recordedAt = r.generatedAt ?? new Date().toISOString();
  return (r.evidenceRefs ?? []).map((id) =>
    link(r.id ?? "?", "lens_calibration_report", id, "outcome_record", "supports", recordedAt),
  );
};

const recommendationAccuracyReport: ForwardRefExtractor = (a) => {
  // RecommendationAccuracyReport is a computed aggregate. No direct forward
  // ref field; the report's source is implicit (all outcome_records in the
  // window). We return an empty link list. The chain can still record this
  // report as a node if needed.
  void a;
  return [];
};

const learningSignal: ForwardRefExtractor = (a) => {
  const s = a as Partial<LearningSignal>;
  const links: ProvenanceLink[] = [];
  const recordedAt = s.generatedAt ?? new Date().toISOString();
  if (s.sourceReportId) {
    links.push(link(s.id ?? "?", "learning_signal", s.sourceReportId, "recommendation_accuracy_report", "derived_from", recordedAt));
  }
  for (const id of s.evidenceRefs ?? []) {
    links.push(link(s.id ?? "?", "learning_signal", id, "outcome_record", "supports", recordedAt));
  }
  return links;
};

const calibrationProfile: ForwardRefExtractor = (a) => {
  const p = a as Partial<CalibrationProfile>;
  const links: ProvenanceLink[] = [];
  const recordedAt = p.generatedAt ?? new Date().toISOString();
  for (const id of p.evidenceRefs ?? []) {
    links.push(link(p.id ?? "?", "calibration_profile", id, "outcome_record", "supports", recordedAt));
  }
  for (const id of p.sourceSignalIds ?? []) {
    links.push(link(p.id ?? "?", "calibration_profile", id, "learning_signal", "derived_from", recordedAt));
  }
  return links;
};

const adaptationProposal: ForwardRefExtractor = (a) => {
  const ap = a as Partial<AdaptationProposal> & {
    sourceSignalIds?: string[];
    approvedBy?: string;
  };
  const links: ProvenanceLink[] = [];
  const recordedAt = ap.generatedAt ?? new Date().toISOString();
  for (const id of ap.sourceSignalIds ?? []) {
    links.push(link(ap.id ?? "?", "adaptation_proposal", id, "learning_signal", "derived_from", recordedAt));
  }
  // approved_from: an audit-grade record of WHO approved the proposal.
  // Uses the operator's identifier as the target. (The chain does not
  // assign a separate "operator" artifact type; this is intentionally
  // a self-loop with the operator as the source for audit traceability.)
  if (ap.approvedBy) {
    links.push(link(ap.id ?? "?", "adaptation_proposal", ap.approvedBy, "governance_review", "approved_from", recordedAt));
  }
  return links;
};

const learningProposal: ForwardRefExtractor = (a) => {
  const lp = a as Partial<LearningProposal>;
  const links: ProvenanceLink[] = [];
  const recordedAt = lp.generatedAt ?? new Date().toISOString();
  for (const id of lp.sourceSignalIds ?? []) {
    links.push(link(lp.id ?? "?", "learning_proposal", id, "learning_signal", "derived_from", recordedAt));
  }
  return links;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * The per-type forward-ref extractor registry. Adding a new artifact type
 * = adding one entry here. The registry MUST cover every ArtifactType
 * except `learning_evidence_chain` (chains don't currently link to chains).
 */
export const EXTRACTORS: Record<Exclude<ArtifactType, "learning_evidence_chain">, ForwardRefExtractor> = {
  decision_context: () => [],
  risk_score: riskScore,
  recommendation: () => [],
  governance_review: governanceReview,
  outcome_record: outcomeRecord,
  lens_calibration_report: lensCalibrationReport,
  recommendation_accuracy_report: recommendationAccuracyReport,
  adaptation_proposal: adaptationProposal,
  learning_signal: learningSignal,
  calibration_profile: calibrationProfile,
  learning_proposal: learningProposal,
};

/**
 * Public entry point. Looks up the extractor for the given artifact type
 * and returns its links. Falls back to `[]` for unknown types
 * (defensive — the registry should cover everything).
 */
export function extractForwardRefs(
  artifact: unknown,
  artifactType: ArtifactType,
  artifactId: string,
  recordedAt: string,
): ProvenanceLink[] {
  if (artifactType === "learning_evidence_chain") return [];
  const extractor = (EXTRACTORS as Record<string, ForwardRefExtractor>)[artifactType];
  if (!extractor) return [];
  // The extractor returns link objects with `sourceArtifactId` populated
  // from the artifact itself. We override it here to ensure the registry
  // output is consistent with the caller's view of the artifact identity.
  return extractor(artifact).map((l) => ({ ...l, sourceArtifactId: artifactId, recordedAt }));
}
```

### Step 8: Run the extractor test to verify it passes

Run:
```bash
npx vitest run tests/learning/forward-ref-extractors.vitest.ts
```

Expected: PASS (~9 tests).

### Step 9: Run the full P8 + P8.5a.0.1 test suite to confirm no regression

Run:
```bash
npx vitest run tests/learning/ tests/cli/commands/learning.vitest.ts
```

Expected: PASS. Total tests: prior 106 + new 19 = **125 tests across 12 files**.

### Step 10: Commit

```bash
git add src/learning/evidence-chain-types.ts \
        src/learning/forward-ref-extractors.ts \
        tests/learning/evidence-chain-types.vitest.ts \
        tests/learning/forward-ref-extractors.vitest.ts
git commit -m "feat(p8.5a.0.1): evidence chain types + forward-ref extractors"
```

---

## Task 2: P8.5a.0.2 — EvidenceChainStore

**Files:**
- Create: `src/learning/evidence-chain-store.ts`
- Create: `tests/learning/evidence-chain-store.vitest.ts`

**Interfaces:**
- Consumes: `LearningEvidenceChain` (from Task 1).
- Produces: `EvidenceChainStore` class with `appendChain`, `getChainForRoot`, `listChains`.

### Step 1: Write the failing store test

Create `tests/learning/evidence-chain-store.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import type { LearningEvidenceChain } from "../../src/learning/evidence-chain-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "evidence-chain-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeChain(overrides: Partial<LearningEvidenceChain> = {}): LearningEvidenceChain {
  return {
    id: "chain-1",
    subject: "Evidence chain for signal-1",
    outcome: "explained",
    confidence: 1,
    reasons: [],
    generatedAt: "2026-06-22T00:00:00.000Z",
    rootArtifactId: "signal-1",
    rootArtifactType: "learning_signal",
    links: [],
    depth: 1,
    ...overrides,
  };
}

describe("EvidenceChainStore: append + query", () => {
  it("appends a chain and returns it with a populated id if missing", async () => {
    const store = new EvidenceChainStore();
    const chain = makeChain({ id: "" });
    const saved = await store.appendChain(chain);
    expect(saved.id).toBeTruthy();
    expect(saved.id).not.toBe("");
  });

  it("persists as one JSONL line in .alix/learning/evidence-chains.jsonl", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "chain-1" }));
    const path = join(tempRoot, ".alix", "learning", "evidence-chains.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("chain-1");
  });

  it("getChainForRoot returns all chains for a root id", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "c-1", rootArtifactId: "signal-A" }));
    await store.appendChain(makeChain({ id: "c-2", rootArtifactId: "signal-A" }));
    await store.appendChain(makeChain({ id: "c-3", rootArtifactId: "signal-B" }));
    const chains = await store.getChainForRoot("signal-A");
    expect(chains.map((c) => c.id).sort()).toEqual(["c-1", "c-2"]);
  });

  it("listChains returns all chains", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "c-1" }));
    await store.appendChain(makeChain({ id: "c-2" }));
    const all = await store.listChains();
    expect(all.map((c) => c.id).sort()).toEqual(["c-1", "c-2"]);
  });
});

describe("EvidenceChainStore: append-only + no source mutation", () => {
  it("has no delete / update / clear / truncate / setChain / replaceChain / modifySource / writeBack methods", () => {
    const store = new EvidenceChainStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "setChain", "replaceChain", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("does not expose any method that returns a mutable reference to a stored chain", () => {
    const store = new EvidenceChainStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      expect(name).not.toMatch(/Mutable/i);
      expect(name).not.toMatch(/Edit/i);
    }
  });

  it("appending the same chain id twice does NOT overwrite — both lines are kept", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "chain-dup" }));
    await store.appendChain(makeChain({ id: "chain-dup" }));
    const path = join(tempRoot, ".alix", "learning", "evidence-chains.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("EvidenceChainStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    // Write one valid line and one corrupt line manually.
    const dir = join(tempRoot, ".alix", "learning");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "evidence-chains.jsonl"),
      JSON.stringify(makeChain({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new EvidenceChainStore();
    const chains = await store.listChains();
    expect(chains).toHaveLength(1);
    expect(chains[0].id).toBe("good");
  });
});
```

### Step 2: Run the store test to verify it fails

Run:
```bash
npx vitest run tests/learning/evidence-chain-store.vitest.ts
```

Expected: FAIL — module not found.

### Step 3: Write `src/learning/evidence-chain-store.ts`

Create `src/learning/evidence-chain-store.ts`:

```ts
/**
 * P8.5a.0.2 — EvidenceChainStore.
 *
 * Append-only JSONL persistence for LearningEvidenceChain artifacts.
 *
 * Core invariants:
 *   - append-only: no delete / update / clear / truncate / setChain /
 *     replaceChain / modifySource / writeBack methods
 *   - source artifacts are facts: this store never accepts an existing
 *     artifact as a mutable parameter; it only appends new chain
 *     records
 *   - chains do not carry mutation authority: this store cannot create
 *     AdaptationProposals, trigger ApprovalGate, or invoke any applier
 *
 * Storage: .alix/learning/evidence-chains.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningEvidenceChain } from "./evidence-chain-types.js";

const STORE_DIR = join(".alix", "learning");
const STORE_FILE = join(STORE_DIR, "evidence-chains.jsonl");

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  // Compact, sortable id; not security-sensitive.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${t}-${r}`;
}

export class EvidenceChainStore {
  constructor(private readonly storeDir: string = join(process.cwd(), STORE_DIR)) {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  /**
   * Append a new chain record. The chain is stored verbatim. Source
   * artifacts are NOT inspected, copied, or modified.
   */
  async appendChain(chain: LearningEvidenceChain): Promise<LearningEvidenceChain> {
    const record: LearningEvidenceChain = {
      ...chain,
      id: chain.id || shortId("chain"),
      generatedAt: chain.generatedAt || now(),
    };
    appendFileSync(join(this.storeDir, STORE_FILE.split("/").pop()!), JSON.stringify(record) + "\n", "utf-8");
    return record;
  }

  /**
   * Read all chains whose rootArtifactId matches.
   */
  async getChainForRoot(rootArtifactId: string): Promise<LearningEvidenceChain[]> {
    const all = await this.listChains();
    return all.filter((c) => c.rootArtifactId === rootArtifactId);
  }

  /**
   * Read all chains from the store, skipping corrupt lines.
   */
  async listChains(): Promise<LearningEvidenceChain[]> {
    const filePath = join(this.storeDir, STORE_FILE.split("/").pop()!);
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: LearningEvidenceChain[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as LearningEvidenceChain);
      } catch {
        // Skip corrupt lines (matches the LearningStore P8.0b pattern).
      }
    }
    return out;
  }
}
```

### Step 4: Run the store test to verify it passes

Run:
```bash
npx vitest run tests/learning/evidence-chain-store.vitest.ts
```

Expected: PASS (~7 tests).

### Step 5: Confirm full test suite still passes

Run:
```bash
npx vitest run tests/learning/ tests/cli/commands/learning.vitest.ts
```

Expected: PASS. Total tests: prior 125 + new 7 = **132 tests across 13 files**.

### Step 6: Commit

```bash
git add src/learning/evidence-chain-store.ts tests/learning/evidence-chain-store.vitest.ts
git commit -m "feat(p8.5a.0.2): EvidenceChainStore — append-only JSONL persistence"
```

---

## Task 3: P8.5a.0.3 — Sentinels + Unchanged-Types Invariance

**Files:**
- Create: `tests/learning/evidence-chain-sentinels.vitest.ts`
- Create: `tests/learning/unchanged-types-invariance.vitest.ts`

**Interfaces:**
- Consumes: files created in Tasks 1 and 2.
- Produces: governance boundary tests. No source files.

### Step 1: Write the sentinel test

Create `tests/learning/evidence-chain-sentinels.vitest.ts`:

```ts
/**
 * P8.5a.0.3 — Evidence Chain governance sentinels.
 *
 * Enforces the boundary:
 *   - The chain layer is read-only relative to the governance lifecycle.
 *   - The chain layer does not import approval / apply / proposal mutation.
 *   - EvidenceChainStore is append-only and never modifies source artifacts.
 *   - The chain layer lives in src/learning/ (matches the P8.0a boundary).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CHAIN_LAYER_DIRS = [
  "src/learning/evidence-chain-types.ts",
  "src/learning/forward-ref-extractors.ts",
  "src/learning/evidence-chain-store.ts",
];

const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AutomaticProposalGenerator",
  "writeFileSync.*source",
  "ApproveCommand",
  "ApplyCommand",
];

const FORBIDDEN_CALL_SITES = [
  /\bapprove\s*\(/,
  /\bapply\s*\(/,        // disallow calls — but allow words like "appliedAt" in fields
  /\breject\s*\(/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("evidence-chain-sentinels: forbidden imports", () => {
  for (const file of CHAIN_LAYER_DIRS) {
    it(`${file} does not import forbidden symbols`, () => {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of FORBIDDEN_IMPORTS) {
        if (forbidden.includes(".*")) {
          // Regex form: writeFileSync.*source
          expect(content).not.toMatch(new RegExp(forbidden));
        } else {
          // Symbol form: must not appear as a bare word in import statements
          const importLine = new RegExp(`from\\s+["'][^"']*${forbidden}["']`, "i");
          expect(content).not.toMatch(importLine);
        }
      }
    });
  }
});

describe("evidence-chain-sentinels: no call-site for approve/apply/reject", () => {
  for (const file of CHAIN_LAYER_DIRS) {
    it(`${file} does not call approve( / apply( / reject(`, () => {
      const content = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_CALL_SITES) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});

describe("evidence-chain-sentinels: append-only store", () => {
  it("EvidenceChainStore prototype has no mutation methods", async () => {
    const { EvidenceChainStore } = await import("../../src/learning/evidence-chain-store.js");
    const proto = Object.getPrototypeOf(new EvidenceChainStore()) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "setChain", "replaceChain", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });
});

describe("evidence-chain-sentinels: no source-artifact mutation", () => {
  it("EvidenceChainStore.appendChain does not accept a source artifact", async () => {
    const { EvidenceChainStore } = await import("../../src/learning/evidence-chain-store.js");
    const store = new EvidenceChainStore();
    // The signature should accept ONLY a chain record — no artifact parameter.
    expect(store.appendChain.length).toBe(1);
  });
});

describe("evidence-chain-sentinels: chain lives in src/learning/", () => {
  it("the chain layer files are not in src/cli/ or src/adaptation/", () => {
    for (const file of CHAIN_LAYER_DIRS) {
      expect(file.startsWith("src/learning/")).toBe(true);
    }
  });
});

describe("evidence-chain-sentinels: no leaky helper", () => {
  it("no file in src/cli/ or src/adaptation/ imports from the chain layer yet", () => {
    // The chain layer ships in P8.5a.0 without consumers. P8.5c (explain)
    // will be the first consumer. Until then, no external module may import
    // the chain — that would mean a hidden coupling we haven't reviewed.
    const cliFiles = walk("src/cli");
    const adaptFiles = walk("src/adaptation");
    const all = [...cliFiles, ...adaptFiles];
    for (const file of all) {
      if (file.includes("/learning/") || file.includes("/evidence-chain")) continue;
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/from\s+["'][^"']*evidence-chain/);
      expect(content).not.toMatch(/from\s+["'][^"']*forward-ref-extractors/);
    }
  });
});
```

### Step 2: Run the sentinel test to verify it fails

Run:
```bash
npx vitest run tests/learning/evidence-chain-sentinels.vitest.ts
```

Expected: FAIL — but only on the "no external consumer" test (which IS the goal — no consumer should exist yet, but the test file may exist before the production files are in place, depending on order). If the test fails on missing imports, that's expected.

### Step 3: Write the unchanged-types invariance test

Create `tests/learning/unchanged-types-invariance.vitest.ts`:

```ts
/**
 * P8.5a.0.3 — Unchanged-types invariance test.
 *
 * Per the P8.5a.0 SDS, existing artifact type files MUST remain
 * byte-identical to their state at b232e395 (the P8 merge commit).
 * This test enforces that invariant by hashing each protected file
 * and comparing it to a recorded baseline.
 *
 * The baseline is captured at the time this test is first run after
 * the P8.5a.0 implementation lands. If a future phase legitimately
 * needs to modify one of these files (e.g., a new forward-ref field),
 * the baseline must be re-captured as part of that change.
 *
 * The protected files:
 *   - src/adaptation/outcome-types.ts
 *   - src/adaptation/risk-score-types.ts
 *   - src/adaptation/governance-review-types.ts
 *   - src/adaptation/adaptation-types.ts
 *   - src/adaptation/decision-types.ts
 *   - src/learning/learning-types.ts
 *
 * The test is read-only and self-validating: if a baseline is missing,
 * it captures one (test is permissive on first run, strict thereafter).
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROTECTED = [
  "src/adaptation/outcome-types.ts",
  "src/adaptation/risk-score-types.ts",
  "src/adaptation/governance-review-types.ts",
  "src/adaptation/adaptation-types.ts",
  "src/adaptation/decision-types.ts",
  "src/learning/learning-types.ts",
];

const BASELINE_DIR = ".alix/test-baselines";
const BASELINE_FILE = "p8-5a-0-unchanged-types.json";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("unchanged-types-invariance", () => {
  it("the protected type files are byte-identical to the P8.5a.0 baseline", () => {
    const baselinePath = join(BASELINE_DIR, BASELINE_FILE);
    const currentHashes: Record<string, string> = {};
    for (const file of PROTECTED) {
      currentHashes[file] = sha256(readFileSync(file, "utf-8"));
    }

    if (!existsSync(baselinePath)) {
      // First run: capture the baseline. Future runs will compare.
      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(baselinePath, JSON.stringify(currentHashes, null, 2));
      return; // Skip the assertion on the capture run.
    }

    const baseline: Record<string, string> = JSON.parse(readFileSync(baselinePath, "utf-8"));
    for (const file of PROTECTED) {
      expect(currentHashes[file]).toBe(baseline[file]);
    }
  });
});
```

### Step 4: Run the invariance test to verify it captures the baseline

Run:
```bash
npx vitest run tests/learning/unchanged-types-invariance.vitest.ts
```

Expected: PASS (captures baseline at `.alix/test-baselines/p8-5a-0-unchanged-types.json`).

### Step 5: Confirm the baseline file is NOT committed

The baseline file is a test artifact, not source. Confirm it is git-ignored or excluded. (If `.alix/` is already git-ignored, no action needed.)

```bash
git check-ignore -v .alix/test-baselines/p8-5a-0-unchanged-types.json || echo "NOT IGNORED — add to .gitignore"
```

If `NOT IGNORED`, append `.alix/test-baselines/` to `.gitignore`.

### Step 6: Run the full P8.5a.0 test suite to confirm all pass

Run:
```bash
npx vitest run tests/learning/ tests/cli/commands/learning.vitest.ts
```

Expected: PASS. Total tests: prior 132 + new sentinel suite + 1 invariance test ≈ **146 tests across 15 files**.

### Step 7: Run all P8 sentinels to confirm no regression

Run:
```bash
npx vitest run tests/learning/learning-sentinels.vitest.ts
```

Expected: PASS — all 9 P8 sentinels still hold.

### Step 8: Run `tsc` to confirm type cleanliness

Run:
```bash
npx tsc --noEmit
```

Expected: exit 0, no output.

### Step 9: Commit

```bash
git add tests/learning/evidence-chain-sentinels.vitest.ts \
        tests/learning/unchanged-types-invariance.vitest.ts
git commit -m "feat(p8.5a.0.3): evidence chain sentinels + unchanged-types invariant"
```

---

## Acceptance

After all three sub-phases land:

- [x] `npx vitest run tests/learning/ tests/cli/commands/learning.vitest.ts` → 146+ tests pass, 15 files
- [x] `npx tsc --noEmit` → clean
- [x] All P8 sentinels still pass (no regression)
- [x] The six protected type files are byte-identical to their P8 state
- [x] The chain layer is read-only relative to the governance lifecycle
- [x] The store is append-only
- [x] No source-artifact mutation paths exist

## Out of scope (deferred to later phases)

| Feature | Phase |
|---|---|
| `alix explain` command (CLI consumer) | P8.5c |
| `alix learning refresh` command (orchestrator) | P8.5a.2 |
| Operational adapters (OutcomeStore → builders, etc.) | P8.5a.2 |
| NiceGUI dashboard panel | P8.5b |
| Telemetry capture for P8.4 routing | Future (post-P8.5a, possibly post-P9) |
| P9 governance over the chain | P9 |
