# M0.77b — Coordination Planner: Task Decomposition + Dependency DAG

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge the existing `GraphPlanner` (LLM-based task decomposition) into the `CoordinationRun`/`WorkerAssignment` model from M0.77a, producing a validated dependency DAG with ownership scopes and a persistent reference from the run to its planning evidence.

**Architecture:** A `CoordinationPlanner` class backed by an injectable `TaskGraphPlanner` interface. The pipeline: call injected planner → validate DAG (identity safety + structural checks) → classify mutation via shared `ToolRegistry` metadata → map nodes to `WorkerAssignment` using canonical constructors → persist both `TaskGraph` and `CoordinationRun` (linked). Invalid results produce `blocked` diagnostic runs. Pure validators and mock-based tests need no real LLM endpoint.

**Tech Stack:** TypeScript, existing `GraphPlanner`, `TaskGraph`/`TaskNode`, `CoordinationRun`/`CoordinationStore` (M0.77a), `ToolRegistry` (M0.69).

---

## File Structure

### Modify
- `src/kernel/coordination-types.ts` — add `taskGraphId?`/`taskGraphRef?` to `CoordinationRun`; extend `createWorkerAssignment` with optional `id`, `status`, `error`

### Create
- `src/kernel/graph-validator.ts` — runtime-safe DAG validation (identity, structure, cycle detection)
- `src/kernel/mutation-classifier.ts` — `ToolRegistry`-based mutation classification
- `src/kernel/coordination-planner.ts` — `CoordinationPlanner` with injectable planner/store/registry

### Tests (all mock-based, no real LLM calls)
- `tests/kernel/graph-validator.test.ts`
- `tests/kernel/mutation-classifier.test.ts`
- `tests/kernel/coordination-planner.test.ts`

---

## Tasks

### Task 1: Extend coordination-types.ts

**Files:** Modify `src/kernel/coordination-types.ts`

Add `taskGraphId?: string` and `taskGraphRef?: string` to `CoordinationRun` interface (after `workers`). Update `createCoordinationRun()` to accept and pass through both. Extend `createWorkerAssignment()` to accept optional `id`, `status`, `error`:

```typescript
export function createWorkerAssignment(opts: {
  id?: string;
  coordinationRunId: string;
  agentId: string;
  taskLabel: string;
  goalPrompt: string;
  dependencies?: string[];
  ownershipScopes?: string[];
  status?: WorkerStatus;
  error?: string;
}): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? `worker_${randomUUID()}`,
    coordinationRunId: opts.coordinationRunId,
    agentId: opts.agentId,
    taskLabel: opts.taskLabel,
    goalPrompt: opts.goalPrompt,
    dependencies: opts.dependencies ?? [],
    ownershipScopes: opts.ownershipScopes ?? [],
    status: opts.status ?? "pending",
    error: opts.error,
    createdAt: now,
    updatedAt: now,
  };
}
```

**Commit:** `feat(coordination): add taskGraphId/taskGraphRef to CoordinationRun; extend createWorkerAssignment with id/status/error`

---

### Task 2: GraphValidator

**Files:** Create `src/kernel/graph-validator.ts`, `tests/kernel/graph-validator.test.ts`

Runtime-safe DAG validator. Accepts `unknown` because injected planners are a runtime boundary. Returns `DagValidationResult` with distinct `valid` and `safeToPersist` fields:

| Condition | Valid | Safe to persist |
|-----------|-------|----------------|
| Valid graph | true | true |
| Empty graph | false | true |
| Duplicate IDs | false | true |
| Unknown dependency | false | true |
| Cycle | false | true |
| Unsafe graph ID | false | false |
| Unsafe node ID | false | false |
| Nodes not array | false | false |
| Null/non-object node | false | false |

Validation order: graph is object → IDs are filesystem-safe (regex `^[A-Za-z0-9_-]+$`) → nodes is array of objects → non-empty → unique IDs → dependencies are arrays → no self-deps → all refs exist → acyclic (Kahn's algorithm).

**Tests (15):** unsafe graph ID, unsafe node ID, null graph, undefined nodes, null node entry, empty graph, single node, duplicate IDs, self-dependency, unknown dependency, cycle, linear chain, diamond, independent nodes, non-array dependencies.

**Commit:** `feat(coordination): add runtime-safe DAG validation`

---

### Task 3: MutationClassifier

**Files:** Create `src/kernel/mutation-classifier.ts`, `tests/kernel/mutation-classifier.test.ts`

```typescript
export type MutationClass = "known-write" | "unknown-write" | "no-write";

export function classifyCapabilities(
  capabilities: string[],
  registry: ToolRegistry,
): MutationClass {
  if (capabilities.length === 0) return "unknown-write";
  const tools = registry.getAll();
  let foundKnownWrite = false;
  let foundUnknown = false;
  for (const capability of capabilities) {
    const record = tools.find(
      tool => tool.name === capability || tool.capabilityId === capability,
    );
    if (!record) { foundUnknown = true; continue; }
    if (record.mutates) { foundKnownWrite = true; }
  }
  if (foundKnownWrite) return "known-write";
  if (foundUnknown) return "unknown-write";
  return "no-write";
}
```

**Tests (10):** empty→unknown-write, file.create→known-write, file.delete→known-write, file.read→no-write, dir.search→no-write, custom.tool→unknown-write, mixed read-write precedence, capabilityId matching, known-write beats unknown, unknown makes read-only set unknown-write.

**Commit:** `feat(coordination): add ToolRegistry mutation classifier`

---

### Task 4: CoordinationPlanner

**Files:** Create `src/kernel/coordination-planner.ts`

Key design decisions:

- **Injectable `TaskGraphPlanner` interface** — unit tests never use real `GraphPlanner`
- **`isPlannerResult()` type guard** — validates runtime shape of planner return
- **DAG validation always runs first** — even for `valid: false` results, catches unsafe IDs before persistence
- **`safeToPersist` flag** — only graphs with safe ID identity are persisted for diagnosis; cyclic valid-ID graphs are persisted, malformed/unsafe-ID graphs are not
- **Valid runs stay in `planning` status** — M0.77c transitions to `running`
- **Blocked diagnostic runs** — persisted with a single `blocked` worker and diagnostic error message

`CoordinationPlanValidationError` defends against graph mutation between DAG validation and worker mapping (should be unreachable).

**Ownership scope inference:**
- `"no-write"` → `[]`
- `"unknown-write"` → `["**"]`
- Known domain with write → domain-specific scopes
- Unknown domain with write → `["**"]`

**Domain scope map:**
- `coding`: `src/**`, `tests/**`, `package.json`, `package-lock.json`
- `docs`: `docs/**`, `README.md`, `CHANGELOG.md`
- `infra`: `.github/**`, `Dockerfile*`, `docker-compose*.yml`, `docker-compose*.yaml`, `compose*.yml`, `compose*.yaml`, `infra/**`, `terraform/**`, `helm/**`
- `research`: `docs/research/**`
- `business`: `docs/**`, `README.md`

**Commit:** `feat(coordination): add safe coordination planner`

---

### Task 5: CoordinationPlanner tests

**Files:** Create `tests/kernel/coordination-planner.test.ts`

**Tests (20):**

| Scenario | Valid |
|----------|-------|
| Workers from valid graph | ✅ |
| Round-robin agent pool | ✅ |
| Empty pool → coordinator fallback | ✅ |
| Invalid planner result → blocked | ✅ |
| Cycle → blocked | ✅ |
| Planner exception → blocked | ✅ |
| Domain-specific ownership scopes | ✅ |
| Read-only → no scopes | ✅ |
| Relative graph ref + file exists | ✅ |
| Run persists for reload | ✅ |
| Valid run stays in `planning` | ✅ |
| Dependency chain remap to worker IDs | ✅ |
| Unknown-write → `["**"]` | ✅ |
| Unknown-write overrides known domain | ✅ |
| Unsafe graph ID not persisted | ✅ |
| Safe invalid planner graph persisted | ✅ |
| Cyclic safe-ID graph persisted | ✅ |
| Malformed graph blocked | ✅ |
| Planner returning null blocked | ✅ |
| Planner result missing graph blocked | ✅ |

No test instantiates real `GraphPlanner`. No test performs network calls. Every test injects a mock `TaskGraphPlanner`.

**Commit:** `test(coordination): cover safe planning and diagnostic fallbacks`

---

## Verification

```bash
npm run build
node --test dist/tests/kernel/graph-validator.test.js       # 15 pass
node --test dist/tests/kernel/mutation-classifier.test.js     # 10 pass
node --test dist/tests/kernel/coordination-planner.test.js    # 20 pass
node --test dist/tests/kernel/coordination-store.test.js      # 12 pass (existing)
node --test dist/tests/runtime/execution-authorization.test.js # 10 pass (existing)
npm run test:node:ci                                           # all existing green
```

**Total new tests: 45. All passing, 0 HTTP calls.**

---

## Branch

```
git switch -c feat/m077b-coordination-planner
```

## Commits (in order)

```
feat(coordination): add taskGraphId/taskGraphRef to CoordinationRun; extend createWorkerAssignment with id/status/error
feat(coordination): add runtime-safe DAG validation
feat(coordination): add ToolRegistry mutation classifier
feat(coordination): add safe coordination planner
test(coordination): cover safe planning and diagnostic fallbacks
```

## PR title

`feat(coordination): M0.77b — Coordination Planner: Task Decomposition + Dependency DAG`
