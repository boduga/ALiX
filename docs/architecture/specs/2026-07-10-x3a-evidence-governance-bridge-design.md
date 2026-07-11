# X3a — Evidence → Governance Bridge Design Spec

**Date:** 2026-07-10
**Status:** Design
**Phase:** X3a — Evidence Capture → Governance Bridge
**Depends on:** X1–X2 Controlled Execution (ExecutionIntent, ExecutionGovernor, ExecutionEvidence), P14–P30 Governance Pipeline
**Checkpoint target:** `alix-x3a-evidence-governance-bridge-complete`

---

## 1. Primary Invariant

**ExecutionEvidence is observational. X3a records what execution produced; it never authorizes, modifies, or replays execution.**

The bridge is a one-way data flow: execution produces evidence, governance observes it. No governance path feeds back into execution authorisation.

---

## 2. Purpose

X1–X2 created the controlled execution foundation — `ExecutionIntent` (immutable contract), `ExecutionGovernor` (lifecycle gate), and `ExecutionEvidence` (execution result). But currently, `ExecutionEvidence` is orphaned: the governor produces it, but no governance pipeline consumes it.

The gap is visible in the architecture:

```text
P14–P30 Governance Layer
    ↑
(empty — no execution data visible)

X2 ExecutionGovernor → ExecutionEvidence
    ↑
X1 ExecutionIntent
```

X3a closes this gap by bridging `ExecutionEvidence` into the existing P14–P30 governance pipeline — lineage (P30), explainability (P28), and compliance reporting (P29). After X3a:

```text
Proposal (P11.9)
    ↓
Human Approval
    ↓
ExecutionIntent (X1)
    ↓
ExecutionGovernor (X2)
    ↓
ExecutionEvidence
    ↓
P14–P30 Governance Pipeline
  ├── P28 Explainability (explain includes execution evidence)
  ├── P29 Compliance (packages include execution summaries)
  └── P30 Lineage (traversal includes execution refs)
```

This completes the governance loop: signal → candidate → review → approval → execution → evidence → explainability → lineage → reporting.

---

## 3. Position in the Architecture

```text
M0  Existing Runtime
M1  Runtime Contracts
    ↓
P5–P10   Intelligence Layer ✅
P11.9    Issue-to-PR Proposal Loop ✅
P14–P29  Governance Evidence Layer ✅
P30      Lineage & Navigation ✅
    ↓
X1–X2    Controlled Execution (Intent + Governor) ✅
X3a      Evidence → Governance Bridge ← DESIGNING
    ↓
X3b+     Execution Runtime (future)
A-Series Autonomous Evolution (future)
```

---

## 4. Core Boundary

X3a is explicitly prohibited from:

- Authorising, modifying, or replaying execution through governance
- Writing back to execution stores from governance adapters
- Creating new execution lifecycle paths
- Mutating ExecutionEvidence records (append-only invariant)
- Using evidence to auto-authorise new execution
- Collapsing the observation/execution boundary

---

## 5. Data Flow

```text
ExecutionGovernor.complete() / .fail()
    │
    ▼
ExecutionEvidence  ──►  ExecutionEvidenceStore (append-only JSONL)
    │
    ▼
Governance Adapter (pure)
    │
    ├──► ExecutionRefs → LineageIndex (P30)
    ├──► ExecutionSummaries → CompliancePackage (P29)
    └──► ExecutionLayer → ProposalExplanation (P28)
```

The adapter is pure — no I/O, no side effects, no mutation of inputs.

---

## 6. Milestone Breakdown

### X3a.3 — ExecutionEvidenceStore

Append-only JSONL store for `ExecutionEvidence`, following the established P14 store pattern.

**File:** `src/governance/governance-execution-store.ts`

**Interface:**

```typescript
export class ExecutionEvidenceStore {
  constructor(baseDir: string);
  
  /** Append a single evidence record (caller ensures validation). */
  append(evidence: ExecutionEvidence): Promise<void>;
  
  /** List all evidence, newest-first. */
  list(limit?: number): Promise<ExecutionEvidence[]>;
  
  /** Stream all evidence for large-volume export. */
  stream(): AsyncIterable<ExecutionEvidence>;
  
  /** Find evidence by intentId (may be multiple per intent). */
  getByIntentId(intentId: string): Promise<ExecutionEvidence[]>;
  
  /** Find single evidence by evidenceId. */
  getByEvidenceId(evidenceId: string): Promise<ExecutionEvidence | null>;
}
```

Store location: `.alix/governance/execution/execution-evidence.jsonl`

**Schema validation:** Each persisted record wraps the evidence payload in a versioned envelope:

```json
{
  "schemaVersion": "x3a.v1",
  "recordType": "ExecutionEvidence",
  "payload": { ... }
}
```

On read, the store validates `schemaVersion` and `recordType`, then runs `isExecutionEvidence()` on the payload to reject malformed records (corrupt `evidenceId`, missing `intentId`, invalid `outcome`).

**Schema evolution:** On read, the store validates `parsed.schemaVersion.startsWith("x3a.")` for forward compatibility — future `x3a.v2` records are valid for read (but may have different payload shape). This ensures P14 historical stores are not broken by evidence schema evolution.

**Append-only semantics:** Once written, evidence records are never modified, deleted, or reordered. Identical records may be appended multiple times (the store does not deduplicate). Callers that need idempotent writes should check `getByEvidenceId` before appending. This matches the existing governance store convention.

### X3a.1–X3a.2 — Bridge Types + Adapter Functions

Pure types and mapping functions that translate `ExecutionEvidence` into governance-consumable types.

**Files:**
- `src/governance/governance-execution-types.ts` — types
- `src/governance/governance-execution-adapter.ts` — adapter functions

**Types:**

The single canonical mapping for each governance output:

```typescript
/** Shallow ref for lineage navigation (immutable). */
export interface ExecutionRef {
  readonly evidenceId: string;
  readonly intentId: string;
  readonly outcome: "SUCCESS" | "FAILED" | "PARTIAL";
  readonly completedAt: string;
  readonly evidenceHash: string;
}

/** Deterministic link between governance candidate and execution evidence. */
export interface ExecutionLineageRef {
  readonly candidateId: string;
  readonly intentId: string;
  readonly evidenceId: string;
}

/**
 * P29 execution summary for compliance packages (immutable).
 * Condensed view of an execution result within a compliance window.
 */
export interface ComplianceExecutionSummary {
  readonly evidenceId: string;
  readonly intentId: string;
  readonly outcome: "SUCCESS" | "FAILED" | "PARTIAL";
  readonly completedAt: string;
  readonly verificationPassed: boolean;
  readonly summary: string;
}
```

No separate "adapter" module needed — the mapping `ExecutionEvidence → ExecutionRef` and `ExecutionEvidence → ComplianceExecutionSummary` is a pure one-liner per field. The adapter logic lives inside the builder functions themselves (same pattern as `buildSignalSummary` in the reporting builder).

Builder functions accept `readonly ExecutionEvidence[]` (never optional arrays). Callers pass `[]` when no evidence exists, eliminating branching inside builders.

**Adapter functions** (`governance-execution-adapter.ts`):

```typescript
/** Map a single ExecutionEvidence to an ExecutionRef. */
export function toExecutionRef(evidence: ExecutionEvidence): ExecutionRef {
  return {
    evidenceId: evidence.evidenceId,
    intentId: evidence.intentId,
    outcome: evidence.outcome,
    completedAt: evidence.completedAt,
    evidenceHash: evidence.evidenceHash,
  };
}

/** Map a single ExecutionEvidence to a ComplianceExecutionSummary. */
export function toComplianceExecutionSummary(
  evidence: ExecutionEvidence
): ComplianceExecutionSummary {
  return {
    evidenceId: evidence.evidenceId,
    intentId: evidence.intentId,
    outcome: evidence.outcome,
    completedAt: evidence.completedAt,
    verificationPassed: evidence.verificationPassed,
    summary: evidence.summary,
  };
}
```

These are the single canonical mapping — every governance consumer calls these same functions, preventing reporting/lineage divergence.

### X3a.5 — Lineage Extension

Extend `LineageRecord`, `LineageIndex`, and `buildLineageIndex` to include execution evidence as P30.

**Modified files:**
- `src/governance/governance-lineage-types.ts`
- `src/governance/governance-lineage-builder.ts`
- `src/cli/commands/governance-lineage.ts`

**Name scoping:** Execution evidence is a separate concept from P30 lineage. The `phasePresence` field uses an `execution` property rather than overloading `p30`:

```typescript
phasePresence: {
  // ... existing p24-p29 (unchanged)
  execution: boolean;  // execution evidence — not p30 (P30 is the lineage index, execution is a separate artifact source)
};
executionRef?: ExecutionRef;
```

**Lineage matching:** Execution evidence links to governance candidates through a deterministic relationship resolver. A `ExecutionLineageRef` carries the explicit three-way link (`candidateId`, `intentId`, `evidenceId`). No inferred joins — if no deterministic link exists, `phasePresence.execution` remains `false`.

**Changes to `LineageRecord`:**

- `executionRef`: use `readonly executionRef: ExecutionRef | null` (not `?`) — explicit absence, deterministic JSON serialization, aligns with P14 style.

**Changes to `LineageIndex`:**

```typescript
byIntentId: Map<string, readonly string[]>;      // immutable index values
byEvidenceId: Map<string, readonly string[]>;    // O(1) navigation
```

**Changes to Lineage CLI:**

- `alix governance lineage show <candidateId>` — shows execution ref when present
- `alix governance lineage list --intent <intentId>` — filter by intent
- `alix governance lineage list --evidence <evidenceId>` — filter by evidence
- Renderer shows execution section when execution evidence exists, with explicit wording when evidence exists but no lineage binding

### X3a.6 — Explainability Extension

Extend the proposal explanation system to include execution evidence when available.

**Modified files:**
- `src/explain/proposal-explanation-types.ts`
- `src/explain/proposal-explanation-assembler.ts`

**New layer type:**

```typescript
export interface ExecutionLayer {
  readonly status: "available";
  readonly evidenceId: string;
  readonly intentId: string;
  readonly evidenceHash: string;        // cryptographic identity of the evidence
  readonly outcome: "SUCCESS" | "FAILED" | "PARTIAL";
  readonly completedAt: string;
  readonly verificationPassed: boolean;
  readonly summary: string;
}
```

Added as an optional layer to `ProposalExplanation`. When no execution evidence exists for a proposal, the layer is `UnavailableLayer`.

**Pure assembler:** The assembler receives `executionEvidence` and `executionLineageRefs` as parameters — it does not instantiate filesystem stores or infer identity relationships. The caller (CLI handler) loads the store and passes data in.

**No inferred joins:** The explainability layer uses `ExecutionLineageRef` to find matching evidence — never `proposalId === intentId` or similar identity assumptions:

```typescript
// Correct: explicit lineage ref traversal
const link = executionLineageRefs.find((ref) => ref.candidateId === proposalId);
const matched = link
  ? executionEvidence.find((e) => e.evidenceId === link.evidenceId)
  : undefined;
```

### X3a.4 — Reporting Extension

Extend `CompliancePackage` and `buildCompliancePackage` to include execution evidence summaries.

**Modified files:**
- `src/governance/governance-reporting-types.ts`
- `src/governance/governance-reporting-builder.ts`
- `src/governance/governance-reporting-export.ts`
- `src/cli/commands/governance-report.ts`

**Changes to `CompliancePackage`:**

```typescript
executionEvidenceCount: number;
readonly executionOutcomes: {
  readonly success: number;
  readonly failed: number;
  readonly partial: number;
};
executionSummary: readonly ComplianceExecutionSummary[];
```

**Changes to `BuildCompliancePackageInput`:**

```typescript
executionEvidence: readonly ExecutionEvidence[];
```
(Callers pass `[]` when no evidence exists — never optional, eliminates branching inside the builder.)

**`deriveIncludedPhases` updated:** when execution evidence present, includes `"Execution"` (not `"P30"` — execution evidence is not a governance phase label).

**CLI:** `alix governance report compliance` renders execution evidence in both text and JSON output.

---

## 7. Module Boundaries

### Created Files

| File | Purpose |
|------|---------|
| `src/governance/governance-execution-types.ts` | ExecutionRef, ExecutionLineageRef, ComplianceExecutionSummary types |
| `src/governance/governance-execution-adapter.ts` | Pure adapter functions (toExecutionRef, toComplianceExecutionSummary) |
| `src/governance/governance-execution-store.ts` | ExecutionEvidenceStore (append-only JSONL) |

### Modified Files

| File | Change |
|------|--------|
| `src/governance/governance-lineage-types.ts` | Add ExecutionRef, p30 to phasePresence, byIntentId |
| `src/governance/governance-lineage-builder.ts` | Accept execution evidence, build execution refs |
| `src/governance/governance-reporting-types.ts` | Add ComplianceExecutionSummary, totalExecutions |
| `src/governance/governance-reporting-builder.ts` | Accept execution evidence, build execution summaries |
| `src/governance/governance-reporting-export.ts` | Render execution evidence |
| `src/explain/proposal-explanation-types.ts` | Add ExecutionLayer |
| `src/explain/proposal-explanation-assembler.ts` | Load and attach execution evidence |
| `src/cli/commands/governance-lineage.ts` | Load and pass execution evidence |
| `src/cli/commands/governance-report.ts` | Load and pass execution evidence |

### Untouched Files

- `src/runtime/execution-governor.ts` — governor unchanged
- `src/runtime/contracts/execution-intent-contract.ts` — contracts unchanged
- All `src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`, `src/events/`
- All M0, M1, P5–P10, P11, P14–P27 modules

---

## 8. New Invariant

```
ExecutionEvidence is observational.
  - X3a records what execution produced.
  - It never authorises, modifies, or replays execution.
  - The bridge is one-way: execution → governance.
  - No governance path feeds back into execution authorisation.
```

This invariant is structurally enforced by:
1. **Readonly types** — `ExecutionEvidence`, `ExecutionRef`, and `ComplianceExecutionSummary` use `Readonly<>`
2. **Pure adapter** — mapping functions are pure (no I/O, no mutation)
3. **Append-only store** — no delete, no update, no conditional writes
4. **No import paths** from bridge modules into governor or runtime contracts
5. **Boundary flags** on lineage records prevent mutation through governance

---

## 9. Testing Plan

### Store Tests (X3a.3)

1. `append()` persists evidence to disk; `list()` reads it back
2. `getByIntentId()` returns all evidence for a given intent
3. `getByEvidenceId()` returns single evidence record
4. Empty store returns empty arrays / null
5. Multiple appends preserve order (newest-first)
6. Duplicate evidence is allowed (store does not deduplicate); both copies present
7. Identical timestamps produce deterministic ordering (stable sort on evidenceId)

### Adapter Tests (X3a.2)

1. `ExecutionRef` fields match source `ExecutionEvidence` fields
2. `ComplianceExecutionSummary` fields match source evidence
3. Empty array produces empty refs and summaries
4. Deterministic mapping — same evidence always produces same refs
5. No mutable reference leak — modifying ref does not mutate source evidence

### Lineage Extension Tests (X3a.5)

1. `buildLineageIndex` accepts execution evidence, produces `executionRef`
2. Execution ref appears in `phasePresence.execution` when present
3. `byIntentId` and `byEvidenceId` index maps correctly
4. Lineage CLI shows execution evidence section in renderer
5. Missing execution evidence produces `phasePresence.execution: false`
6. No inferred relationships — `ExecutionLineageRef` requires explicit `candidateId` / `intentId` / `evidenceId`

### Explainability Extension Tests (X3a.6)

1. Proposal with execution evidence produces `ExecutionLayer`
2. Proposal without execution evidence produces `UnavailableLayer`
3. `sourceArtifactIds` includes evidence IDs
4. `explanationIntegrity` updates correctly

### Reporting Extension Tests (X3a.4)

1. `buildCompliancePackage` accepts execution evidence
2. `totalExecutions` counts correctly
3. `deriveIncludedPhases` includes `"P30"` when evidence present
4. Text renderer shows execution section
5. JSON renderer includes execution fields

---

## 10. X-Seal Criteria

X3a may be sealed when:

- ExecutionEvidenceStore persists and retrieves evidence
- LineageIndex includes execution refs with phase presence
- CompliancePackage includes execution summaries with aggregate outcome counts
- Proposal explanation includes execution layer with evidenceHash
- All integration tests pass
- `tsc --noEmit` clean
- No existing runtime code modified
- No execution authorisation paths created through governance
- No inferred execution lineage relationships (every execution reference has deterministic provenance)
- Explanation builders remain pure (no filesystem I/O)
- Operational metrics remain separate from governance evidence
- No agent autonomy introduced
- No policy mutation paths created
- `grep -R "execution-governor" src/governance/` produces no matches (governance does not import governor)
- `grep -R "governance" src/runtime/` produces no matches (runtime does not import governance — reverse dependency guard)

### Dependency direction criterion

> **No imports from `src/runtime/*` back into governance consumers except immutable contract types.**

The dependency direction is enforced as:

```text
Runtime
    ↓
Contracts (immutable types only)
    ↓
Bridge (store + adapter)
    ↓
Governance (lineage, reporting, explainability)
```

This prevents accidental coupling where governance logic could influence execution behaviour through shared types or stores.
