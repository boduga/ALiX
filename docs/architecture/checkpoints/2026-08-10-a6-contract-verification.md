# A6 — Contract Verification Against A0/A3/A5

**Date:** 2026-08-10
**Phase:** A6 — Knowledge Evolution (Task 1, pre-implementation)
**Purpose:** Record the exact existing A0/A3/A5 interfaces the A6 plan builds against, before any new code. Read-only verification — no source files modified.

Source of truth for the A6 design: `docs/superpowers/specs/2026-08-10-a6-knowledge-evolution-design.md` §4.1 (mapping table) and `docs/superpowers/plans/2026-08-10-a6-knowledge-evolution.md` Task 1.

---

## 1. `DecisionArtifact` — verified

File: `src/adaptation/decision-types.ts:36-45`

```ts
export interface DecisionArtifact {
  id: string;
  subject: string;
  outcome: string;
  confidence: number;
  reasons: string[];
  warnings?: EnrichedWarning[];   // OPTIONAL
  evidenceRefs?: string[];        // OPTIONAL
  generatedAt: string;
}
```

**Required:** `id, subject, outcome, confidence, reasons, generatedAt`.
**Optional:** `warnings` (`EnrichedWarning[]`), `evidenceRefs` (`string[]`).

Confirmed: `CurationProposal` MUST NOT extend `DecisionArtifact` (spec §4.3) — it has none of the required fields (`outcome`, `confidence`, `reasons`, `generatedAt`).

## 2. `GovernanceRecommendation` and `Recommendation` — verified (with a critical caveat)

File: `src/governance/governance-types.ts`

```ts
// line 172 — P9.x GovernanceRecommendation (extends DecisionArtifact)
export interface GovernanceRecommendation extends DecisionArtifact {
  reportType: "governance_recommendation";
  recommendations: Recommendation[];
}

// line 103 — Recommendation
export interface Recommendation {
  id: string;
  source: "health" | "drift" | "lens-review" | "integrity";
  sourceArtifactId: string;
  priority: "low" | "medium" | "high" | "critical";
  confidence: number;
  status: "open" | "acknowledged" | "dismissed";
  category:
    | "lens_adjustment"
    | "chain_restoration"
    | "policy_coverage"
    | "confidence_calibration"
    | "governance_integrity";
  title: string;          // ADDITIONAL required field beyond the plan's list
  description: string;    // ADDITIONAL required field
  evidenceRefs: string[]; // ADDITIONAL required field
  operatorGuidance: string;   // ADDITIONAL required field
  expectedBenefit: string;    // ADDITIONAL required field
  risks: string[];        // ADDITIONAL required field
  metadata: RecommendationMetadata; // discriminated union keyed on category
}
```

**IMPORTANT — two distinct `GovernanceRecommendation` types exist in the codebase:**

| Location | Type | Fields | Consumed by |
|----------|------|--------|-------------|
| `src/governance/governance-types.ts:172` | extends `DecisionArtifact`, `reportType`, `recommendations[]` | P9.x governance reports | `governance-recommendation-generator.ts`, `governance-store.ts` |
| `src/evolution/verification/contracts/recommendation-contract.ts:58` | A2.5 recommendation | `recommendationId, evidenceId, proposalId, kind, confidence, reasoning, supportingEvidence, risks, createdAt` | **A3 `generateDecision`** (`decision-engine.ts:21`) |

A3's `generateDecision` imports the **A2.5** `GovernanceRecommendation` (`../verification/contracts/recommendation-contract.js`), NOT the P9.x one. The two are structurally incompatible. **The plan's Task 6 `buildGovernanceRecommendation` produces the P9.x shape (`DecisionArtifact` + `reportType` + `recommendations`), which does NOT type-check against `generateDecision`'s parameter.** Task 6/7 must reconcile this (see Concerns §8).

Also note the plan's Step 2 listed only `id, source, sourceArtifactId, priority, confidence, status, category` for `Recommendation`, but the real type has **7 additional required fields** (`title, description, evidenceRefs, operatorGuidance, expectedBenefit, risks, metadata`), and `source`/`category` are fixed governance-specific unions.

## 3. A3 `generateDecision` input contract — verified

File: `src/evolution/governance/decision-engine.ts:123-127`

```ts
export function generateDecision(
  evidence: VerificationEvidence,
  recommendation?: GovernanceRecommendation, // ← A2.5 type (recommendation-contract.ts)
  options?: DecisionConfig,                  // { policyConfig?, evolutionId? }
): GovernanceDecision
```

Evidence reads (grep `evidence\.`):
- `evidence.confidenceProfile.overallConfidence` (line 137) — the decision confidence
- `inferRegressions(evidence)` (line 138) — counts `behavioralChanges` strings containing `" regression: "` (see `src/evolution/verification/shared.ts:42`)
- `evidence.reproducibilityLevel` (line 188) — compared against `policyConfig.minReproducibilityLevel`
- `evidence.expiresAt` via `isEvidenceExpired(evidence)` (line 141) — fail-closed: expired → REJECT (default policy)
- `evidence.evidenceId`, `evidence.proposalId` (used to build `decisionId`, `proposalId`, `evolutionId`, `evidenceId`)

Recommendation reads (optional param; only when present):
- `recommendation.kind` (line 293) — mapped via `RECOMMENDATION_KIND_MAP` for `followedRecommendation`
- `recommendation.recommendationId` (line 298) — tracked on the decision
- `recommendation.risks` (lines 235, 245) — carried into decision risks on ESCALATE

Policy config (`options?.policyConfig ?? DEFAULT_GOVERNANCE_POLICY`), file `src/evolution/governance/contracts/decision-contract.ts:91`:

```ts
export const DEFAULT_GOVERNANCE_POLICY = {
  policyName: "default",
  minApproveConfidence: 0.8,
  minMonitorConfidence: 0.5,
  rejectConfidenceThreshold: 0.3,
  maxAllowedRegressions: 0,
  escalateBehavior: "request_evidence",
  failClosedOnExpiredEvidence: true,
  minReproducibilityLevel: 2,   // ← A3 reproducibility gate
};
```

Decision flow (pure, deterministic): expired→REJECT; `confidence < 0.3`→REJECT; `regressions > 0`→REJECT; **`reproducibilityLevel < 2`→REQUEST_MORE_EVIDENCE**; `confidence >= 0.8`→APPROVE; `confidence >= 0.5`→MONITOR; ESCALATE→per policy; else REQUEST_MORE_EVIDENCE.

## 4. `VerificationEvidenceLedger` read API — verified

File: `src/evolution/verification/evidence/evidence-ledger.ts:70-98`

```ts
export interface VerificationEvidenceLedger {
  store(evidence: VerificationEvidence): Promise<VerificationEvidence>;
  get(evidenceId: string): Promise<VerificationEvidence>;          // rejects expired/corrupt (fail-closed: EvidenceNotFoundError | ExpiredEvidenceError | IntegrityMismatchError)
  listByProposal(proposalId: string, options?: { includeExpired?: boolean }): Promise<VerificationEvidence[]>;
  countExpired(currentTimeMs?: number): Promise<number>;
  listExpired(currentTimeMs?: number): Promise<string[]>;          // ← returns evidence IDs, NOT full evidence
}
```

**Read-only inputs for the evidence adapter (Task 3):** `listByProposal()` returns full `VerificationEvidence[]` (excludes expired by default; pass `{ includeExpired: true }` to include them). `listExpired()` returns **IDs only** — a follow-up `get()` on an expired ID throws `ExpiredEvidenceError`, so to project expired evidence use `listByProposal(..., { includeExpired: true })`.

## 5. `createVerificationEvidence`, `EvidenceClass`, `ReproducibilityLevel` — verified

File: `src/evolution/verification/evidence/verification-evidence.ts:37-66` (input) and `:78` (factory); contracts in `src/evolution/verification/contracts/verification-contract.ts`.

`createVerificationEvidence(input: VerificationEvidenceInput): VerificationEvidence` — required input fields:

```ts
verificationId: string;
proposalId: string;
replayDatasetId: string;
proposalSnapshotHash: string;
environmentHash: string;
baselineMetrics: Record<string, number>;
candidateMetrics: Record<string, number>;
metricDeltas: Record<string, number>;
behavioralChanges: string[];
confidenceProfile: ConfidenceProfile;       // { replayFidelity, coverage, determinism, historicalSimilarity, overallConfidence } all 0-1
reproducibilityLevel: ReproducibilityLevel; // 0 | 1 | 2 | 3
lineage: LineageRecord[];
verifiedAt: string;                          // ISO 8601
// expiresAt?: string  (optional — defaults to verifiedAt + 90 days)
```

Factory behavior: hard-codes `evidenceClass: "projected"` (cannot be overridden), generates `evidenceId: "ev-ver-" + randomUUID()`, computes `integrityHash` (canonicalStringify + SHA-256, prefix `alix-evolution-v2:`), sets `reverificationRequired: false`, `expiresAt` default = `verifiedAt + 90 days`.

```ts
export type EvidenceClass = "observed" | "derived" | "projected" | "executed";   // verification-contract.ts:38
export const VALID_EVIDENCE_CLASSES = ["observed", "derived", "projected", "executed"];

export type ReproducibilityLevel = 0 | 1 | 2 | 3;   // verification-contract.ts:130
// 0 metric, 1 report, 2 artifact (byte-identical), 3 cryptographic
```

**A3 reproducibility gate (for Task 6):** `DEFAULT_GOVERNANCE_POLICY.minReproducibilityLevel = 2` and the check is `evidence.reproducibilityLevel < 2 → REQUEST_MORE_EVIDENCE`. Therefore **`reproducibilityLevel: 2` is the lowest value that clears the A3 gate** (to reach APPROVE/MONITOR); `3` also passes. With `behavioralChanges` that do not contain `" regression: "`, `inferRegressions` returns 0, so `maxAllowedRegressions` (0) is also satisfied.

## 6. Store → `KnowledgeArtifact` mapping table (spec §4.1) — verified against source

| Store | artifactKind | subject | claim source (verified) |
|-------|--------------|---------|-------------------------|
| `learning` | `LearningSignal` | signalType | native `delta { expected, observed, unit }` (`learning-types.ts:61`) |
| `learning` | `CalibrationProfile` | target+targetName | native `previousValue` / `suggestedValue` (`learning-types.ts:88-89`) |
| `learning` | `LearningReport` | — | — (no claim) |
| `chronicle` | `ChronicleEntry` | — | native `outcome` ("success"\|"failure"\|"partial"\|"unknown") |
| `failure_memory` | `FailureRecord` | failureType | native `failureType`/`detail` (`failure-memory.ts:44-54`) |
| `pattern_registry` | `Pattern` | TaskType | native `PatternOutcome` (`pattern-registry.ts:15-19`) |

## 7. Store read APIs (Step 6) — verified

### LearningStore — `src/learning/learning-store.ts`
```ts
async querySignals(opts?: { signalTypes?: string[]; windowDays?: number; limit?: number; now?: string }): Promise<LearningSignal[]>
async queryProfiles(opts?: { targets?: string[]; windowDays?: number; now?: string }): Promise<CalibrationProfile[]>
```
- JSONL files: `signals.jsonl`, `profiles.jsonl`, `reports.jsonl`. Corrupt lines skipped by the private `parseLines()` helper (the pattern A6 reuses).
- **No public report read method** — `appendReport` writes only; `readFile` is private. `LearningStoreAdapter` must read `reports.jsonl` directly (constructor takes the dir) to project `LearningReport`.
- `querySignals`/`queryProfiles` return `[]` when the file is missing.

### ChronicleStore — `src/chronicle/chronicle-store.ts`
```ts
async get(entryId: string): Promise<ChronicleEntry | undefined>
async search(query: { signalCode?: string; domain?: SignalDomain; polarity?: SignalPolarity; outcome?: ChronicleOutcome }): Promise<ChronicleEntry[]>
```
- `loadIndex()` is **private**. No public `list`/`entries`. To enumerate all entries, call `search({})` (returns all index entries, loading full entry files; skips missing files).

### FailureMemoryStore — `src/governance/failure-memory.ts`
```ts
async list(limit?: number): Promise<FailureRecord[]>
async getByRun(runId: string): Promise<FailureRecord[]>
async getByIssue(issueId: string): Promise<FailureRecord[]>
async findSimilar(query: FailureRecallQuery, limit?: number): Promise<FailureRecord[]>
```
- `FileFailureMemoryStore` implements it. `list()` is the read-all path (skips corrupt/invalid JSONL lines, returns most-recent-first).
- `FailureRecord`: `runId, issueId, failureType, detail, timestamp, filePaths?, command?, policyIds?, verificationCommand?`.

### PatternRegistry — `src/context/pattern-registry.ts` (in-memory)
```ts
getStats(taskType: TaskType): TaskTypeStats;                 // { count, successCount, successRate, avgIterations, totalIterations, avgTokens, totalTokens }
recordOutcome(taskType: TaskType, outcome: PatternOutcome): Promise<void>;
getThresholdBias(taskType: TaskType): number;
clear(): Promise<void>;
init(): Promise<void>;
save(): Promise<void>;
// public field: stats: Map<TaskType, TaskTypeStats>
```
- Adapter projects via the in-memory registry, not files. To enumerate all task types, iterate the **public** `registry.stats` Map; `getStats(taskType)` returns a single cluster's stats. `TaskType` imported from `src/task-classifier.ts`.

## 8. Concerns / decisions for later tasks

1. **[HIGH] Two `GovernanceRecommendation` types.** `generateDecision` accepts the A2.5 `GovernanceRecommendation` (`recommendation-contract.ts`: `recommendationId, evidenceId, proposalId, kind, confidence, reasoning, supportingEvidence, risks, createdAt`), while the plan/spec §6 describe the P9.x `GovernanceRecommendation` (`governance-types.ts`: extends `DecisionArtifact` with `reportType` + `recommendations[]`). Task 6's `buildGovernanceRecommendation` output as specified will NOT type-check as `generateDecision`'s second argument. Options: (a) build the A2.5-shaped recommendation for A3, (b) call `generateDecision` with evidence only (recommendation is optional), or (c) build both. This must be resolved in Task 6/7.
2. **[MEDIUM] `Recommendation` is heavier than the plan assumes.** 7 required fields beyond the plan's list (`title, description, evidenceRefs, operatorGuidance, expectedBenefit, risks, metadata`); `source` and `category` are fixed governance-specific unions (`"health" | "drift" | "lens-review" | "integrity"` and `"lens_adjustment" | ... | "governance_integrity"`). A curation dimension (`stale|duplicate|contradiction|compressible`) must be coerced into one of these — none is curation-specific.
3. **[LOW] `listExpired()` returns `string[]` IDs, and `get()` on an expired ID throws.** For the evidence adapter to project expired evidence, use `listByProposal(..., { includeExpired: true })`.
4. **[LOW] LearningStore has no public `queryReports`.** The `LearningReport` mapping requires the adapter to read `reports.jsonl` directly.
5. **[LOW] ChronicleStore `loadIndex()` is private** — enumerate via `search({})`.
6. **[INFO] `reproducibilityLevel: 2`** is the value to use in Task 6's `buildEvidenceFromFindings` to pass A3's `minReproducibilityLevel` gate.

## Files read (verified, not modified)

- `src/adaptation/decision-types.ts`
- `src/governance/governance-types.ts`
- `src/evolution/governance/decision-engine.ts`
- `src/evolution/governance/contracts/decision-contract.ts`
- `src/evolution/verification/contracts/recommendation-contract.ts`
- `src/evolution/verification/contracts/verification-contract.ts`
- `src/evolution/verification/contracts/confidence-contract.ts`
- `src/evolution/verification/evidence/evidence-ledger.ts`
- `src/evolution/verification/evidence/verification-evidence.ts`
- `src/evolution/verification/shared.ts`
- `src/evolution/verification/recommendation/recommendation-engine.ts`
- `src/learning/learning-store.ts`
- `src/learning/learning-types.ts`
- `src/chronicle/chronicle-store.ts`
- `src/governance/failure-memory.ts`
- `src/context/pattern-registry.ts`
