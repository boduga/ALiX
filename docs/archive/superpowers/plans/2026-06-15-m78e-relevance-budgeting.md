# M0.78e — Relevance Ranking and Context Budgeting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute tasks in order.
>
> **Target branch:** `feat/m078e-relevance-budgeting`
> **Tag baseline:** `m0.78d-shared-context-baseline`
> **Builds on:** M0.78a–d

**Goal:** Upgrade the collaboration context builder from flat budget slashing to scored relevance ranking, validated typed budgets, attempt-aware freshness, evidence quality scoring, optional semantic reranking, safe compression, and explainable manifest entries.

**Architecture:** A `RelevanceScorer` computes per-item scores from dependency, tag, capability, confidence, recency, and evidence components (clamped 0–100). A `BudgetAllocator` validates budget invariants, reserves system/task budget, explicitly selects dependency results (compressing if oversized), ranks findings, allocates artifacts, and records omissions. The existing `CollaborationContextBuilder` delegates to these components through dependency injection. The system remains a selector, not a reasoning authority.

**Tech Stack:** TypeScript, existing `CollaborationContextBuilder`, `CollaborationStore`, `SharedFinding`, `WorkerContextManifest`.

---

## File structure

### Create
- `src/kernel/collaboration-relevance-types.ts` — `RelevanceScore`, `ContextBudget` (validated), `FindingStatus`, `CompressionMetadata`, `OmittedByReason`, `BudgetAllocationResult`
- `src/kernel/collaboration-evidence-quality.ts` — `EvidentQualityReport`, evidence source scoring, broken-reference penalty
- `src/kernel/collaboration-freshness.ts` — `computeFindingStatus()` with clock injection, stale-attempt/dependency/artifact detection
- `src/kernel/collaboration-relevance-scorer.ts` — `RelevanceScorer` with component scoring, stable tie-breaks, clamped 0–100
- `src/kernel/collaboration-budget-allocator.ts` — `BudgetAllocator` with invariant validation, explicit result selection, bucket enforcement, dedup
- `src/kernel/collaboration-semantic-reranker.ts` — async `SemanticReranker` interface + identity fallback + bounded scoring blend
- `src/kernel/collaboration-compression.ts` — `ContextCompressor` with Unicode-safe truncation, extractive mode, accurate metadata

### Modify
- `src/kernel/collaboration-types.ts` — add `workerAttempt` to `SharedFinding`/`SharedArtifact`; add `ScoredManifestFinding`; bump manifest `schemaVersion` to `"1.1"`; add `omittedByReason`; correct snapshot `dependencyResults` type
- `src/kernel/collaboration-validation.ts` — add `validateContextBudget()`, add `normalizeManifestV1_0()`
- `src/kernel/collaboration-store.ts` — derive `workerAttempt` from `CollaborationActor` on publish
- `src/kernel/collaboration-context-builder.ts` — inject deps, delegate to scorer/allocator/reranker/compressor, expand fingerprint, build explainable manifest
- `src/kernel/collaboration-context-renderer.ts` — include explainability in rendered output
- `src/events/types.ts` — relevance/budget event types

### Tests
- `tests/kernel/collaboration-relevance-types.test.ts`
- `tests/kernel/collaboration-evidence-quality.test.ts`
- `tests/kernel/collaboration-freshness.test.ts`
- `tests/kernel/collaboration-relevance-scorer.test.ts`
- `tests/kernel/collaboration-budget-allocator.test.ts`
- `tests/kernel/collaboration-semantic-reranker.test.ts`
- `tests/kernel/collaboration-compression.test.ts`
- `tests/kernel/collaboration-context-builder.test.ts`
- `tests/kernel/collaboration-context-explainability.test.ts`
- `tests/integration/collaboration-relevance.integration.test.ts`

---

## M0.78e.1 — Schema and attempt provenance

**Files:** Modify `src/kernel/collaboration-types.ts`, `src/kernel/collaboration-store.ts`, `src/kernel/collaboration-validation.ts`

Add `workerAttempt: number` to `SharedFinding` and `SharedArtifact`. The store derives it from `CollaborationActor.workerAttempt` on publish.

Add `ScoredManifestFinding` type with `score`, `scoreComponents`, `selectionReasons`, `compression?`. Bump manifest to `schemaVersion: "1.1"`.

Fix snapshot type: `dependencyResults: CoordinationWorkerResultRecord[]` (not `any[]`).

Add `normalizeManifestV1_0()` that fills `score: 0`, `selectionReasons: [], compression: undefined` for legacy entries.

**Commit:** `feat(collaboration): add finding attempt provenance and manifest v1.1`

---

## M0.78e.2 — Relevance and budget types

**Files:** Create `src/kernel/collaboration-relevance-types.ts`

```typescript
export type CompressionMode = "none" | "truncated" | "extractive";
export type CompressionMetadata = { mode: CompressionMode; originalTokens: number; includedTokens: number; };

export type RelevanceScore = {
  total: number; // clamped 0–100
  components: { dependency: number; tagOverlap: number; capabilityMatch: number; confidence: number; recency: number; evidenceQuality: number; explicitSubscription: number; };
  reasons: string[];
};

export type ContextBudget = {
  totalTokens: number;
  dependencyResults: { maxTokens: number; minReservedTokens: number; maxItems: number; };
  findings: { maxTokens: number; maxItems: number; minimumScore: number; };
  artifacts: { maxTokens: number; maxItems: number; };
  systemReserveTokens: number;
  taskReserveTokens: number;
};

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  totalTokens: 8_000,
  dependencyResults: { maxTokens: 3_000, minReservedTokens: 1_000, maxItems: 8 },
  findings: { maxTokens: 3_000, maxItems: 20, minimumScore: 20 },
  artifacts: { maxTokens: 1_000, maxItems: 20 },
  systemReserveTokens: 500,
  taskReserveTokens: 500,
};

export type OmittedByReason = {
  budget: number; lowRelevance: number; invalidated: number;
  superseded: number; staleAttempt: number; staleDependency: number;
  staleArtifact: number; unauthorized: number; duplicate: number;
  semanticRerankLimit: number;
};

export type BudgetAllocationResult = {
  selectedResults: SelectedResult[]; selectedFindings: SelectedFinding[];
  selectedArtifacts: SelectedArtifact[]; tokenEstimate: number;
  bucketUsage: { dependencyResults: number; findings: number; artifacts: number; reserves: number; total: number; };
  omittedByReason: OmittedByReason;
};
```

Add `validateContextBudget()` in `collaboration-validation.ts` — rejects negatives, non-finite, reserve > total, dependency min > max, bucket sum > total.

**Commit:** `feat(relevance): add validated relevance and budget types`

---

## M0.78e.3 — Freshness

**Files:** Create `src/kernel/collaboration-freshness.ts`

```typescript
export interface Clock { now(): Date; }

export function computeFindingStatus(
  finding: SharedFinding,
  currentAttempt: number,
  clock: Clock,
): FindingStatus {
  if (finding.invalidatedAt) return "invalidated";
  if (finding.supersededBy) return "superseded";
  if (finding.workerAttempt !== undefined && finding.workerAttempt < currentAttempt) return "stale_attempt";
  return "active";
}

export function computeRecencyScore(createdAt: string, clock: Clock): number {
  const ageMs = clock.now().getTime() - new Date(createdAt).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin < 5) return 8; if (ageMin < 30) return 6;
  if (ageMin < 120) return 4; if (ageMin < 1440) return 2;
  return 1;
}
```

**Commit:** `feat(relevance): add attempt-aware finding freshness`

---

## M0.78e.4 — Evidence quality

**Files:** Create `src/kernel/collaboration-evidence-quality.ts`

```typescript
export type EvidenceQualityReport = { score: number; reasons: string[]; verifiedCount: number; unresolvedCount: number; };

export function assessEvidenceQuality(evidenceRefs: EvidenceRef[], artifacts: SharedArtifact[]): EvidenceQualityReport {
  let score = 0; const reasons: string[] = []; let verified = 0; let broken = 0;
  for (const ref of evidenceRefs) {
    if (ref.kind === "artifact" && artifacts.some(a => a.id === ref.artifactId && a.digest)) { score += 6; verified++; reasons.push("artifact with digest"); }
    else if (ref.kind === "file" && ref.digest) { score += 7; verified++; reasons.push("file with digest"); }
    else if (ref.kind === "worker_result") { score += 8; verified++; reasons.push("durable worker result"); }
    else if (ref.kind === "event") { score += 3; verified++; reasons.push("event reference"); }
    else if (ref.kind === "finding") { score += 2; verified++; reasons.push("finding reference"); }
    else { score -= 3; broken++; reasons.push("broken evidence reference"); }
  }
  return { score: Math.max(0, Math.min(15, score)), reasons, verifiedCount: verified, unresolvedCount: broken };
}
```

**Commit:** `feat(relevance): add evidence quality resolution`

---

## M0.78e.5 — Deterministic scoring

**Files:** Create `src/kernel/collaboration-relevance-scorer.ts`

```typescript
export class RelevanceScorer {
  constructor(private clock: Clock) {}

  scoreFinding(finding: SharedFinding, worker: WorkerAssignment, depWorkerIds: string[]): RelevanceScore {
    const dependency = depWorkerIds.includes(finding.workerId) ? 35 : 0;
    const tagOverlap = worker.ownershipClaims?.some(c => finding.tags.includes(c.path)) ? 15 : worker.requiredCapabilities?.some(c => finding.tags.includes(c)) ? 10 : 0;
    const confidence = finding.confidence ? Math.round(finding.confidence * 10) : 0;
    const recency = computeRecencyScore(finding.createdAt, this.clock);
    const eq = assessEvidenceQuality(finding.evidenceRefs ?? [], []);
    const total = Math.max(0, Math.min(100, dependency + tagOverlap + confidence + recency + eq.score));
    const reasons: string[] = [];
    if (dependency) reasons.push("direct dependency");
    if (tagOverlap > 0) reasons.push("tag overlap");
    if (confidence > 5) reasons.push("high confidence");
    if (recency > 4) reasons.push("recent");
    return { total, components: { dependency, tagOverlap, capabilityMatch: 0, confidence, recency, evidenceQuality: eq.score, explicitSubscription: 0 }, reasons };
  }
}
```

Tie-break: score desc → direct dep first → evidence quality desc → createdAt desc → id asc.

**Commit:** `feat(relevance): add deterministic relevance scoring`

---

## M0.78e.6 — Budget allocation

**Files:** Create `src/kernel/collaboration-budget-allocator.ts`

- `allocate()` returns `BudgetAllocationResult`
- Reserve system + task budget
- Select dependency results (compress oversized), enforce bucket and global caps
- Filter findings by minimumScore, rank, allocate up to budget
- Deduplicate by ID
- Never let available go negative
- Record accurate omission counts

**Commit:** `feat(relevance): add hard-limit budget allocator`

---

## M0.78e.7 — Semantic reranking

**Files:** Create `src/kernel/collaboration-semantic-reranker.ts`

```typescript
export interface SemanticReranker {
  rerank(query: { goal: string }, candidates: ScoredFindingCandidate[], options: { limit: number; timeoutMs: number; signal?: AbortSignal }): Promise<SemanticRerankResult>;
}
```

Identity fallback returns candidates as-is. Embedding implementation: compute similarity, sort, blend with deterministic score (80/20). Never reintroduce excluded items. Mandatory results not reranked.

**Commit:** `feat(relevance): add optional semantic reranking`

---

## M0.78e.8 — Compression

**Files:** Create `src/kernel/collaboration-compression.ts`

```typescript
export interface ContextCompressor {
  compress(content: string, options: { maxTokens: number; mode: "truncated" | "extractive" }): Promise<CompressedContent>;
}
```

Unicode-safe truncation, prefer sentence boundaries, accurate token metadata, stable digest. Never reports `model_summary`.

**Commit:** `feat(relevance): add safe context compression`

---

## M0.78e.9 — Builder integration

**Files:** Modify `src/kernel/collaboration-context-builder.ts`

Inject deps via `CollaborationContextBuilderDeps`. Flow: load results → load findings → compute status → score → (optional rerank) → compress → allocate → build manifest + snapshot. Expand fingerprint to include relevance config, compression metadata, scores.

**Commit:** `feat(collaboration): integrate explainable relevance selection`

---

## M0.78e.10 — Configuration and observability

- Add relevance config defaults to schema
- Add `COLLABORATION_RELEVANCE_EVENT_TYPES` to events
- Add budget/compression/rerank metrics
- Add benchmark fixtures

**Commit:** `feat(observability): add relevance budget and compression metrics`

---

## Suggested commits

```
feat(collaboration): add finding attempt provenance and manifest v1.1
feat(relevance): add validated relevance and budget types
feat(relevance): add attempt-aware finding freshness
feat(relevance): add evidence quality resolution
feat(relevance): add deterministic relevance scoring
feat(relevance): add hard-limit budget allocator
feat(relevance): add safe context compression
feat(relevance): add optional semantic reranking
feat(collaboration): integrate explainable relevance selection
feat(config): add collaboration relevance settings
feat(observability): add relevance budget and compression metrics
test(relevance): add deterministic ranking and budget coverage
docs(collaboration): document relevance selection and explainability
```
