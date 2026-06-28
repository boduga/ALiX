# M0.78f — Conflict Detection and Evidence Comparison

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Execute tasks in order and track every checkbox.
>
> **Status:** Implementation-ready after repository alignment  
> **Target branch:** `feat/m078f-conflict-detection`  
> **Baseline tag:** `m0.78e-relevance-budgeting-baseline`  
> **Builds on:** M0.78a–e

**Goal:** Detect durable, explainable disagreements between active worker findings using deterministic candidate grouping, explicit claim comparison, M0.78e evidence/freshness signals, and optional model-assisted analysis — without blocking runs by default.

**Architecture:** A `ConflictDetector` loads active findings, normalizes claims, generates bounded candidate pairs, classifies incompatibility via a `ClaimComparator`, compares evidence via a conflict-specific `EvidenceComparator` (reusing M0.78e signals without misusing `RelevanceScorer`), and persists `FindingConflict` records in the existing collaboration `state.json` through a `ConflictRepository`. Workers can report conflicts through the bound API but cannot resolve them. Model-assisted comparison is optional, bounded, and never authoritative. Unresolved conflicts are injected into worker context as untrusted data within hard budgets.

**Tech Stack:** TypeScript, existing `CollaborationStore`, `CollaborationContextBuilder`, `SharedFinding`, `FindingClaim`.

---

## 1. File structure

### Create
- `src/kernel/collaboration-conflict-types.ts` — `FindingConflict`, `ConflictStatus`, `ConflictType`, `ClaimComparison`, `EvidenceComparison`, `ConflictResolution`, `ConflictResolverAuthority`
- `src/kernel/collaboration-claim-normalizer.ts` — deterministic claim extraction + normalization + topic key
- `src/kernel/collaboration-conflict-candidates.ts` — `ConflictCandidateGenerator` with bounded pair generation
- `src/kernel/collaboration-claim-comparator.ts` — `ClaimComparator` with type-specific rules
- `src/kernel/collaboration-evidence-comparator.ts` — conflict-specific `ConflictEvidenceComparator`
- `src/kernel/collaboration-conflict-detector.ts` — `ConflictDetector` orchestrating the pipeline
- `src/kernel/collaboration-conflict-repository.ts` — thin domain wrapper over `CollaborationStore` for conflict CRUD
- `src/kernel/collaboration-model-conflict-comparator.ts` — optional bounded model-assisted comparator

### Modify
- `src/kernel/collaboration-types.ts` — add `claim?` to `SharedFinding`, add `conflicts` to `CollaborationState`, add manifest `conflicts` field (schema v1.2)
- `src/kernel/collaboration-validation.ts` — add `normalizeStateV1_0()`, conflict validation
- `src/kernel/collaboration-store.ts` — add `conflicts` to state, add dedup fingerprint upsert
- `src/kernel/worker-collaboration-api.ts` — add `reportConflict()`, `listConflicts()`
- `src/kernel/collaboration-context-builder.ts` — inject unresolved conflicts, add conflict budget
- `src/kernel/collaboration-context-renderer.ts` — render conflicts as untrusted
- `src/kernel/coordination-view.ts` — add conflict summary to shared view
- `src/tools/collaboration-tools.ts` — add conflict tools
- `src/cli/commands/coordination.ts` — add conflict commands
- `src/tui/coordination-panel.ts` — add conflict views
- `src/server/coordination-routes.ts` — add conflict routes
- `src/events/types.ts` — add conflict event types

### Tests
- `tests/kernel/collaboration-claim-normalizer.test.ts`
- `tests/kernel/collaboration-conflict-candidates.test.ts`
- `tests/kernel/collaboration-claim-comparator.test.ts`
- `tests/kernel/collaboration-evidence-comparator.test.ts`
- `tests/kernel/collaboration-conflict-detector.test.ts`
- `tests/kernel/collaboration-conflict-store.test.ts`
- `tests/kernel/worker-collaboration-conflict-api.test.ts`
- `tests/tools/collaboration-conflict-tools.test.ts`
- `tests/kernel/collaboration-context-conflicts.test.ts`
- `tests/cli/coordination-conflicts.test.ts`
- `tests/tui/coordination-conflicts.test.ts`
- `tests/server/coordination-conflict-routes.test.ts`
- `tests/integration/collaboration-conflicts.integration.test.ts`

---

## 2. Schema

### 2.1 FindingClaim (added to SharedFinding)

```typescript
export type ClaimValueType = "string" | "number" | "boolean" | "enum" | "version" | "digest" | "path" | "unknown";

export type FindingClaim = {
  subject: string; predicate: string; value: string; valueType: ClaimValueType;
  unit?: string; scope?: string;
  normalizedSubject: string; normalizedPredicate: string; normalizedValue: string;
  extractionMethod: "structured" | "deterministic" | "model_assisted";
  extractionVersion: string;
};
```

### 2.2 Conflict lifecycle

```typescript
export type ConflictStatus = "detected" | "under_review" | "resolved" | "accepted_divergence" | "dismissed" | "superseded";
export type ConflictType = "contradiction" | "competing_decision" | "stale_evidence" | "artifact_mismatch" | "confidence_disagreement" | "scope_overlap" | "worker_reported";
export type DetectionMethod = "deterministic" | "worker_report" | "model_assisted";

export type ClaimCompatibility = "compatible" | "incompatible" | "different_scope" | "insufficient_structure" | "uncertain";

export type ConflictResolverAuthority =
  | { kind: "worker"; workerId: string; allowedConflictIds?: string[] }
  | { kind: "operator"; actorId: string }
  | { kind: "planner"; plannerId: string };
```

### 2.3 FindingConflict

```typescript
export interface FindingConflict {
  id: string; schemaVersion: "1.0";
  runId: string; conflictFingerprint: string; topicKey: string;
  type: ConflictType; status: ConflictStatus;
  findingIds: string[];
  claimComparisons: ClaimComparison[];
  evidenceComparison: EvidenceComparison;
  detectedBy: DetectionMethod[];
  criticality: "info" | "warning" | "critical";
  blocksDownstreamByPolicy: boolean;
  resolution?: ConflictResolution;
  history: ConflictHistoryEntry[];
  createdAt: string; updatedAt: string;
}
```

---

## Implementation order

```
claim/conflict schemas → state migration → claim normalization → candidate generation
→ claim comparison → evidence comparison → conflict fingerprint/upsert
→ lifecycle authorization → worker API/tools → optional model comparator
→ context/budget integration → shared visibility → observability
→ integration tests
```

## Suggested commits

```
feat(conflict): add structured claim and conflict schemas
feat(conflict): add deterministic claim normalization
feat(conflict): add bounded conflict candidate generation
feat(conflict): add claim incompatibility classifier
feat(conflict): add evidence comparison engine
feat(collaboration): persist conflict lifecycle in shared state
feat(collaboration): add worker conflict reporting API
feat(tools): add bounded conflict reporting tools
feat(conflict): add optional model-assisted comparison
feat(context): inject relevant unresolved conflicts
feat(visibility): add conflict views across CLI TUI and Inspector
feat(observability): add conflict events audit and metrics
test(conflict): add lifecycle and end-to-end coverage
docs(conflict): document detection resolution and safety boundaries
```
