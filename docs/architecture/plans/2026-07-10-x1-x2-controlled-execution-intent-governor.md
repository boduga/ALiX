# X1–X2 — Controlled Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Create the governed execution boundary for ALiX — ExecutionIntent contract (X1) + Execution Governor (X2) — where every action carries explicit intent, passes validation, produces evidence, and remains reviewable.

**Architecture:** X1 defines immutable `ExecutionIntent <Readonly<T>>` with append-only lifecycle events. X2 implements the Execution Governor — a gate that validates intent eligibility before execution, captures execution evidence on completion, and never knows agent/tool internals. X3–X5 deferred to future milestones.

**Tech Stack:** TypeScript, node:test, node:crypto (SHA-256 for intentId, intentHash)

## Global Constraints

- No execution occurs unless there is an approved execution intent with immutable provenance
- ExecutionIntent is `Readonly<T>` — compile-time immutability, no field mutation post-creation
- Lifecycle changes are append-only events — intent document never changes
- `intentId` (stable identifier) ≠ `intentHash` (integrity digest) — distinct roles
- Governor is a gate, not an executor — never contains shell/git/MCP/agent execution logic
- Governor must never treat CREATED as executable
- Execution eligibility: intent exists + status APPROVED + approval active + timestamp valid + expiration not exceeded
- X2 produces ExecutionEvidence; X3 integrates into governance pipeline (deferred)
- No existing runtime code modified (`src/agent/`, `src/providers/`, `src/tools/`, etc.)
- `import type` for type-only symbols
- Tests use `node:test` (describe/it) + `node:assert/strict`

---

## File Structure

### Created Files

| Slice | File | Purpose |
|-------|------|---------|
| X1 | `src/runtime/contracts/execution-intent-contract.ts` | ExecutionIntent, ExecutionConstraints, ExecutionEvidence, lifecycle types |
| X2 | `src/runtime/execution-governor.ts` | ExecutionGovernor implementation |
| X1 | `tests/runtime/execution-intent-contract.test.ts` | 6 contract tests |
| X2 | `tests/runtime/execution-governor.test.ts` | 7 governor tests |

### Untouched Files

- All files in `src/runtime/contracts/` (M1 contracts)
- All files in `src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`, `src/events/`
- All P5–P30 modules
- P11.9 issue run handler and guardrails

---

### Task 1: X1 — Execution Intent Contract

**Files:**
- Create: `src/runtime/contracts/execution-intent-contract.ts`
- Test: `tests/runtime/execution-intent-contract.test.ts`

**Contract types:**

```typescript
export type ExecutionIntentStatus = "CREATED" | "APPROVED" | "RUNNING" | "COMPLETED" | "FAILED" | "REVOKED";

export type ExecutionIntentEventType = "CREATED" | "APPROVED" | "RUNNING" | "COMPLETED" | "FAILED" | "REVOKED";

export type ExecutionConstraints = Readonly<{
  maxFilesChanged: number;
  allowedPaths: string[];
  blockedPaths: string[];
  verificationRequired: boolean;
  allowedTools: string[];
}>;

export type ExecutionIntent = Readonly<{
  intentId: string;
  proposalId: string;
  actor: string;
  action: string;
  target: string;
  justification: string;
  constraints: ExecutionConstraints;
  riskClass: "low" | "medium" | "high";
  expectedEffect: string;
  sourceEvidenceId: string;
  createdAt: string;
  expiration: string;
  approvalReference: string;
  approvedBy: string;
  approvedAt: string;
  status: ExecutionIntentStatus;
  intentHash: string;
}>;

export type ExecutionEvidence = Readonly<{
  evidenceId: string;
  intentId: string;
  startedAt: string;
  completedAt: string;
  outcome: "SUCCESS" | "FAILED" | "PARTIAL";
  summary: string;
  artifacts: string[];
  verificationPassed: boolean;
  evidenceHash: string;
}>;
```

**Helper functions:**

```typescript
export function createIntentId(proposalId: string, actor: string, action: string, target: string, createdAt: string): string;
export function createIntentHash(intent: Omit<ExecutionIntent, "intentId" | "intentHash">): string;
export function validateIntentStatusTransition(current: ExecutionIntentStatus, next: ExecutionIntentEventType): boolean;
```

**Tests (6):**
1. ExecutionIntent has all required fields (including sourceEvidenceId, createdAt, intentHash) with correct types
2. Intent lifecycle status transitions are valid (CREATED→APPROVED→RUNNING→COMPLETED is valid; CREATED→RUNNING is invalid)
3. Deterministic intentHash from proposalId + actor + action + target + createdAt
4. Deterministic hash stability — same inputs produce same intentHash
5. Mutation prevention — Readonly<T> prevents accidental field mutation (compile-time check)
6. validateIntentStatusTransition rejects invalid transitions (e.g., CREATED→RUNNING, COMPLETED→APPROVED)

Commit: `feat(X1): add execution intent contract — immutable ExecutionIntent, append-only lifecycle, ExecutionEvidence`

---

### Task 2: X2 — Execution Governor

**Files:**
- Create: `src/runtime/execution-governor.ts`
- Test: `tests/runtime/execution-governor.test.ts`

**Governor interface and implementation:**

```typescript
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  sessionId?: string;
  reason?: string;
}

export interface ExecutionSession {
  sessionId: string;
  intentId: string;
  startedAt: string;
}

export interface ExecutionGovernor {
  validate(intent: ExecutionIntent): Promise<ValidationResult>;
  authorize(intentId: string): Promise<AuthorizationResult>;
  start(intentId: string): Promise<ExecutionSession>;
  heartbeat(intentId: string, sessionId: string): Promise<void>;
  complete(intentId: string, outcome: ExecutionEvidence["outcome"], summary: string): Promise<ExecutionEvidence>;
  fail(intentId: string, reason: string): Promise<ExecutionEvidence>;
  revoke(intentId: string, reason: string): Promise<void>;
}
```

**Key implementation rules:**
- `validate()` checks: intent exists, status === APPROVED, approvalReference exists, approval timestamp valid, expiration not exceeded
- `validate()` must REJECT CREATED status
- `authorize()` checks if intent has already been authorized (no double-authorization)
- `start()` creates execution session with timestamp
- `complete()` produces ExecutionEvidence with SHA-256 evidenceHash
- `fail()` produces ExecutionEvidence with FAILED outcome
- `revoke()` transitions to REVOKED via event log
- Governor never imports from `src/agent/`, `src/providers/`, `src/tools/`, `src/mcp/`
- Governor never executes shell commands, git operations, or tool calls
- All transitions logged via event-like pattern (not directly in event-log.ts — that's X3 scope)

**Tests (7):**
1. `validate()` rejects null/empty intent
2. `validate()` accepts well-formed intent with APPROVED status and valid constraints
3. `validate()` rejects CREATED intent (not executable)
4. `authorize()` creates authorization session
5. `complete()` produces ExecutionEvidence with correct fields
6. `fail()` produces ExecutionEvidence with FAILED outcome
7. `revoke()` transitions intent to REVOKED status

Commit: `feat(X2): add execution governor — validate, authorize, complete, fail, revoke`

---

### Task 3: X-Seal Checkpoint

**Files:**
- Create: `docs/architecture/checkpoints/2026-07-10-x1-x2-controlled-execution-checkpoint.md`

**Checklist:**
- X1 ExecutionIntent contract created (immutable Readonly<T>, append-only lifecycle)
- X2 Execution Governor created (gate, not executor)
- All 13 tests pass (6 + 7)
- No existing runtime code modified
- Governor never imports agent/tool/provider/MCP modules
- Governor rejects CREATED intents
- tsc clean
- Tag: `alix-x1-x2-controlled-execution-complete`

Commit: `docs: X1-X2 controlled execution checkpoint`

---

## Summary

| Slice | Files Created | Tests | Commit |
|-------|--------------|-------|--------|
| X1 | 2 | 6 | `feat(X1): add execution intent contract` |
| X2 | 2 | 7 | `feat(X2): add execution governor` |
| X-Seal | 1 | — | `docs: X1-X2 controlled execution checkpoint` |
| **Total** | **5 files** | **13 tests** | **3 commits** |
