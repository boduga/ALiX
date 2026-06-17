# M0.78 — Multi-Agent Shared Context and Collaboration

> **Status:** Implementation-ready specification  
> **Target branch:** `feat/m078-shared-context`  
> **Tag baseline:** `m0.77-final-coordination-baseline`  
> **Builds on:** M0.77a–M0.77f full coordination stack

## 1. Goal

Enable workers to publish and consume structured findings and artifacts during execution, and have the scheduler inject relevant dependency context before dispatch — so workers are no longer isolated tasks that only return terminal results.

## 2. Architecture

A run-scoped `CollaborationStore` persists findings and artifacts at `.alix/coordination/shared/<runId>/`. Workers publish through a constrained `WorkerCollaborationAPI` injected via execution context. The scheduler builds a `WorkerContextManifest` for each worker before dispatch, loading direct dependency results and relevant findings. All records preserve worker, run, timestamp, and evidence provenance.

**Core data flow:**
```
WorkerA executes
  → publishes findings to CollaborationStore
WorkerB waits (dependency on WorkerA)
WorkerB dispatches
  → scheduler builds context from WorkerA's results + shared findings
  → WorkerB receives context via execute() parameters
  → WorkerB can query shared findings and publish its own
```

## 3. Phases (first milestone: M0.78a–M0.78d)

| Phase | Scope |
|-------|-------|
| M0.78a | `SharedFinding`, `SharedArtifact`, `WorkerContextManifest` types |
| M0.78b | Lock-safe `CollaborationStore` with CRUD operations |
| M0.78c | `WorkerCollaborationAPI` — constrained publish/query contract |
| M0.78d | Scheduler dependency-result injection + context manifest persistence |

Later phases (M0.78e–i) defer semantic ranking, conflict detection, and replanning.

## 4. Types (M0.78a)

```typescript
export type FindingKind =
  | "fact" | "decision" | "assumption" | "warning" | "question" | "recommendation";

export type ArtifactKind =
  | "file" | "patch" | "report" | "dataset" | "test_result" | "code_symbol";

export type FindingConflictStatus =
  | "detected" | "under_review" | "resolved" | "accepted_divergence";

export interface SharedFinding {
  id: string;
  runId: string;
  workerId: string;
  kind: FindingKind;
  title: string;
  content: string;
  confidence?: number;
  tags: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
  supersededBy?: string;
  invalidatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedArtifact {
  id: string;
  runId: string;
  workerId: string;
  kind: ArtifactKind;
  uri: string;
  mediaType?: string;
  digest?: string;
  ownershipScope?: string;
  createdAt: string;
}

export interface WorkerContextManifest {
  workerId: string;
  findingIds: string[];
  artifactIds: string[];
  resultRefs: string[];
  generatedAt: string;
  tokenEstimate: number;
}

export interface FindingConflict {
  id: string;
  runId: string;
  findingIds: string[];
  topic: string;
  status: FindingConflictStatus;
  resolution?: string;
  resolvedByWorkerId?: string;
  createdAt: string;
}
```

## 5. CollaborationStore (M0.78b)

Lock-safe store at `.alix/coordination/shared/<runId>/`. Uses the same atomic-mkdir lock pattern as `CoordinationRunLock`.

Files:
```
findings.json   — array of SharedFinding
artifacts.json  — array of SharedArtifact
```

API:
```typescript
export class CollaborationStore {
  constructor(cwd: string, runId: string) {}

  publishFinding(finding: SharedFinding): Promise<void>;
  publishArtifact(artifact: SharedArtifact): Promise<void>;
  queryFindings(filter: FindingFilter): Promise<SharedFinding[]>;
  getArtifacts(ids?: string[]): Promise<SharedArtifact[]>;
  getFindings(ids: string[]): Promise<SharedFinding[]>;
  supersedeFinding(id: string, newId: string): Promise<void>;
  markFindingInvalid(id: string): Promise<void>;
  getWorkerFindings(workerId: string): Promise<SharedFinding[]>;
}
```

All writes use `mutate<T>()` with lock, atomic temp+rename.

## 6. Worker collaboration API (M0.78c)

A constrained interface injected into the worker execution context:

```typescript
export interface WorkerCollaborationAPI {
  publishFinding(finding: Omit<SharedFinding, "id" | "runId" | "workerId" | "createdAt" | "updatedAt">): Promise<string>;
  publishArtifact(artifact: Omit<SharedArtifact, "id" | "runId" | "workerId" | "createdAt">): Promise<string>;
  queryFindings(filter: FindingFilter): Promise<SharedFinding[]>;
  getDependencyResults(): Promise<WorkerResultSummary[]>;
  reportConflict(findingIds: string[], topic: string): Promise<string>;
}
```

Workers cannot directly edit the store or other workers' records.

## 7. Scheduler integration (M0.78d)

Before dispatching a worker, the scheduler:

1. Loads results from direct dependency workers (via `CoordinationResultStore.loadByRef()`)
2. Queries the `CollaborationStore` for relevant findings (tag/source matching)
3. Loads shared artifacts referenced by those findings
4. Computes a `WorkerContextManifest` with estimated token count
5. Persists the manifest alongside the worker's running state
6. Injects the `WorkerCollaborationAPI` into the execution context

The `WorkerExecutionContext` gains:
```typescript
export type WorkerExecutionContext = {
  // existing fields
  collaboration?: {
    store: CollaborationStore;
    api: WorkerCollaborationAPI;
    manifest: WorkerContextManifest;
  };
};
```

The manifest is persisted to `.alix/coordination/shared/<runId>/manifests/<workerId>.json`.

## 8. File structure

### Create (M0.78a–d)
- `src/kernel/collaboration-types.ts` — `SharedFinding`, `SharedArtifact`, `WorkerContextManifest`, `FindingConflict`, filtering types
- `src/kernel/collaboration-store.ts` — `CollaborationStore` with lock-safe CRUD
- `src/kernel/worker-collaboration-api.ts` — `WorkerCollaborationAPI` interface
- `src/kernel/collaboration-context-builder.ts` — builds context for a worker from dependency results + shared findings
- `tests/kernel/collaboration-store.test.ts`
- `tests/kernel/collaboration-context-builder.test.ts`

### Modify
- `src/kernel/worker-executor.ts` — add `WorkerCollaborationAPI` to context
- `src/kernel/coordination-scheduler.ts` — build and inject context before dispatch

## 9. Implementation order (M0.78a–d only)

```text
types → store → worker API → context builder → scheduler injection → tests
```

## 10. Commits (suggested)

```text
feat(collaboration): add shared finding and artifact types
feat(collaboration): add lock-safe run-scoped collaboration store
feat(collaboration): add worker publish/query collaboration API
feat(collaboration): add dependency context builder and manifest persistence
feat(scheduler): inject collaboration context before worker dispatch
test(collaboration): add store, context builder, and integration tests
```
