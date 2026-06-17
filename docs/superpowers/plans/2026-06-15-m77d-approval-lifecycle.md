# M0.77d — Approval Lifecycle Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute tasks in order and track every checkbox.
>
> **Status:** Implementation-ready specification  
> **Target branch:** `feat/m077d-approval-lifecycle-depth`  
> **Builds on:** M0.76.2, M0.77a, M0.77b, M0.77c, and M0.77c.1

**Goal:** Upgrade ALiX approvals from a simple pending queue into a complete, concurrency-safe, auditable lifecycle.

**Architecture:** Lock-safe `ApprovalStore` with deterministic binding keys (`sha256` of canonical binding tuple), 7-state lifecycle (`pending → approved → consumed/expired/revoked/invalidated`), policy revision fingerprinting, and exact-match-only approval reuse. `ApprovalWatcher` daemon service polls for changes. Scheduler reconciliation performs full binding validation before allowing worker dispatch.

**Tech Stack:** TypeScript, existing `ApprovalStore`, `PolicyGate`, `ExecutionAuthorization`, `CoordinationScheduler`, `CoordinationRunLock` pattern.

---

## Files

### Modify
```
src/approvals/approval-store.ts
src/policy/policy-gate.ts
src/runtime/execution-decision.ts
src/runtime/execution-authorization.ts
src/kernel/coordination-authorization.ts
src/kernel/coordination-reconciliation.ts
src/kernel/coordination-scheduler.ts
src/events/types.ts
src/cli.ts
daemon composition/startup
docs/user-manual.md
README.md
```

### Create
```
src/approvals/approval-types.ts
src/approvals/approval-binding.ts
src/approvals/approval-store-lock.ts
src/policy/policy-revision.ts
src/daemon/approval-watcher.ts
src/cli/commands/approval.ts
```

### Tests
```
tests/approvals/approval-binding.test.ts
tests/approvals/approval-store-lock.test.ts
tests/approvals/approval-store.test.ts
tests/policy/policy-revision.test.ts
tests/policy/policy-gate-approval-binding.test.ts
tests/kernel/coordination-approval-lifecycle.test.ts
tests/daemon/approval-watcher.test.ts
tests/cli/approval.test.ts
tests/integration/approval-lifecycle.integration.test.ts
```

---

## M0.77d.1 — Types and binding

**Files:** Create `src/approvals/approval-types.ts`, `src/approvals/approval-binding.ts`
**Tests:** `tests/approvals/approval-binding.test.ts`

### Step 1: Create `src/approvals/approval-types.ts`

```typescript
import type { WorkerOwnershipClaim } from "../kernel/coordination-types.js";

export type ApprovalStatus =
  | "pending" | "approved" | "denied"
  | "consumed" | "expired" | "revoked" | "invalidated";

export type ApprovalUsePolicy =
  | "single_use" | "worker_attempt" | "coordination_run" | "session";

export interface ApprovalRecord {
  id: string;
  schemaVersion: "2.0";
  status: ApprovalStatus;
  usePolicy: ApprovalUsePolicy;

  bindingKey: string;
  requestFingerprint: string;
  policyRevision: string;

  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;

  capabilities: string[];
  toolId?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";

  ownershipClaims: WorkerOwnershipClaim[];
  ownershipClaimsHash?: string;

  groupId?: string;

  reason: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decisionReason?: string;
  decidedBy?: string;
  consumedAt?: string;
  consumedByWorkerId?: string;
  consumedAttempt?: number;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  metadata?: Record<string, unknown>;
}

export type ApprovalGroup = {
  id: string;
  schemaVersion: "1.0";
  approvalIds: string[];
  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  ownershipClaimsHash?: string;
  policyRevision: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "denied" | "partial" | "expired" | "revoked" | "consumed";
  createdAt: string;
  decidedAt?: string;
  decisionReason?: string;
};
```

### Step 2: Create `src/approvals/approval-binding.ts`

```typescript
import { createHash } from "node:crypto";
import type { WorkerOwnershipClaim } from "../kernel/coordination-types.js";

export type ApprovalBinding = {
  coordinationRunId?: string;
  workerId?: string;
  workerAttempt?: number;
  graphId?: string;
  nodeId?: string;
  sessionId?: string;
  capabilities: string[];
  ownershipClaims: WorkerOwnershipClaim[];
  ownershipClaimsHash?: string;
  requestFingerprint: string;
  policyRevision: string;
};

export function computeOwnershipClaimsHash(claims: WorkerOwnershipClaim[]): string {
  const canonical = [...claims]
    .sort((a, b) => a.path.localeCompare(b.path) || Number(a.recursive) - Number(b.recursive))
    .map(c => ({ path: c.path, recursive: c.recursive }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function computeBindingKey(binding: ApprovalBinding): string {
  const canonical = JSON.stringify(binding, Object.keys(binding).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function normalizeApprovalRecord(raw: unknown, context: { defaultPolicyRevision: string; now: Date }): ApprovalRecord {
  const r = raw as any;
  return {
    id: r.id ?? `approval_${Date.now()}`,
    schemaVersion: "2.0",
    status: r.status ?? "pending",
    usePolicy: r.usePolicy ?? "single_use",
    bindingKey: r.bindingKey ?? "",
    requestFingerprint: r.requestFingerprint ?? "",
    policyRevision: r.policyRevision ?? context.defaultPolicyRevision,
    capabilities: r.capability ? [r.capability] : (r.capabilities ?? []),
    ownershipClaims: r.ownershipClaims ?? [],
    reason: r.reason ?? "",
    createdAt: r.createdAt ?? context.now.toISOString(),
    expiresAt: r.expiresAt ?? new Date(context.now.getTime() + 30 * 60_000).toISOString(),
    ...r,
  };
}
```

### Step 3: Tests

```typescript
// tests/approvals/approval-binding.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeBindingKey, computeOwnershipClaimsHash } from "../../src/approvals/approval-binding.js";

describe("computeBindingKey", () => {
  it("produces stable key for same inputs", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1" });
    assert.equal(a, b);
  });

  it("changes when worker changes", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", workerId: "w1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", workerId: "w2" });
    assert.notEqual(a, b);
  });

  it("changes when run changes", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", coordinationRunId: "r1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", coordinationRunId: "r2" });
    assert.notEqual(a, b);
  });

  it("changes when policy revision changes", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev2" });
    assert.notEqual(a, b);
  });

  it("claim order does not change key", () => {
    const a = computeOwnershipClaimsHash([{ path: "src", recursive: true }, { path: "docs", recursive: false }]);
    const b = computeOwnershipClaimsHash([{ path: "docs", recursive: false }, { path: "src", recursive: true }]);
    assert.equal(a, b);
  });
});
```

### Step 4: Build and commit

```bash
npm run build && node --test dist/tests/approvals/approval-binding.test.js
git add src/approvals/approval-types.ts src/approvals/approval-binding.ts tests/approvals/approval-binding.test.ts
git commit -m "feat(approvals): add lifecycle types and exact binding fingerprints"
```

---

## M0.77d.2 — Lock-safe store

**Files:** Create `src/approvals/approval-store-lock.ts`, Modify `src/approvals/approval-store.ts`
**Tests:** `tests/approvals/approval-store-lock.test.ts`, `tests/approvals/approval-store.test.ts`

### Step 1: Create `src/approvals/approval-store-lock.ts`

Mirror the `CoordinationRunLock` pattern. Lock path: `.alix/approvals/approvals.lock`. Token-safe release, stale PID recovery.

```typescript
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const STALE_LOCK_MS = 60_000;
const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ApprovalLockMetadata = { pid: number; token: string; acquiredAt: string; };

export class ApprovalStoreLock {
  private readonly lockPath: string;
  private readonly token: string;
  private acquired = false;

  constructor(cwd: string) {
    this.lockPath = join(cwd, ".alix", "approvals", "approvals.lock");
    this.token = randomUUID();
  }

  async acquire(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    if (this.acquired) return true;
    const deadline = Date.now() + timeoutMs;
    mkdirSync(join(this.lockPath, ".."), { recursive: true });
    while (Date.now() < deadline) {
      try {
        mkdirSync(this.lockPath);
        writeFileSync(join(this.lockPath, "meta.json"), JSON.stringify({ pid: process.pid, token: this.token, acquiredAt: new Date().toISOString() }), "utf-8");
        this.acquired = true;
        return true;
      } catch {
        if (isStaleLock(this.lockPath)) { rmSync(this.lockPath, { recursive: true, force: true }); continue; }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    return false;
  }

  release(): void {
    if (!this.acquired) return;
    try {
      if (existsSync(this.lockPath)) {
        const meta = readFileSync(join(this.lockPath, "meta.json"), "utf-8");
        const saved = JSON.parse(meta);
        if (saved.token === this.token) rmSync(this.lockPath, { recursive: true, force: true });
      }
    } catch { /* best-effort */ }
    this.acquired = false;
  }
}

function isStaleLock(lockPath: string): boolean {
  try {
    const meta = JSON.parse(readFileSync(join(lockPath, "meta.json"), "utf-8"));
    if (Date.now() - new Date(meta.acquiredAt).getTime() < STALE_LOCK_MS) return false;
    process.kill(meta.pid, 0);
    return false;
  } catch { return true; }
}
```

### Step 2: Update ApprovalStore

Add `cwd` to constructor. Add `mutate<T>()`:

```typescript
async mutate<T>(fn: (state: { approvals: ApprovalRecord[]; groups: ApprovalGroup[] }) => T | Promise<T>): Promise<T> {
  const lock = new ApprovalStoreLock(this.cwd);
  if (!(await lock.acquire())) throw new Error("Could not acquire approval lock");
  try {
    await this.load();
    const state = { approvals: this.approvals, groups: this.groups };
    const result = await fn(state);
    this.approvals = state.approvals;
    this.groups = state.groups;
    this.dirty = true;
    await this.save();
    return result;
  } finally { lock.release(); }
}
```

Update `save()` to write atomically: `approvals.json.tmp.<token>` → rename.

In `load()`, call `normalizeApprovalRecord()` on every record.

### Step 3: Tests

```typescript
// tests/approvals/approval-store-lock.test.ts — acquire/release, contention, stale recovery, token mismatch
// tests/approvals/approval-store.test.ts — mutate concurrency, atomic save, record normalization
```

### Step 4: Build and commit

```bash
npm run build && node --test dist/tests/approvals/approval-store-lock.test.js dist/tests/approvals/approval-store.test.js
git add src/approvals/approval-store-lock.ts src/approvals/approval-store.ts tests/approvals/approval-store-lock.test.ts tests/approvals/approval-store.test.ts
git commit -m "feat(approvals): add lock-safe atomic approval storage"
```

---

## M0.77d.3 — Lifecycle operations

**Files:** Modify `src/approvals/approval-store.ts`

Add methods to the store. All use `mutate()`:

```typescript
// request() — exact dedup by bindingKey
async request(input): Promise<ApprovalRecord> {
  return this.mutate(state => {
    const existing = state.approvals.find(a => a.bindingKey === input.bindingKey && a.status === "pending");
    if (existing) return existing;
    const record = createApprovalRecord(input);
    state.approvals.push(record);
    return record;
  });
}

// resolve() — approve or deny
async resolve(id, status, context): Promise<ApprovalRecord | null> {
  return this.mutate(state => {
    const r = state.approvals.find(a => a.id === id);
    if (!r || r.status !== "pending") return null;
    r.status = status; r.decidedAt = context.now ?? new Date().toISOString();
    r.decisionReason = context.reason; r.decidedBy = context.actor;
    return { ...r };
  });
}

// consumeApproved() — atomic single-use consumption
async consumeApproved(id, expectedBindingKey, consumer): Promise<ConsumeResult> {
  return this.mutate(state => {
    const r = state.approvals.find(a => a.id === id);
    if (!r) return { consumed: false, reason: "not found" };
    if (r.status !== "approved") return { consumed: false, reason: `status: ${r.status}` };
    if (new Date(r.expiresAt) <= new Date()) return { consumed: false, reason: "expired" };
    if (r.bindingKey !== expectedBindingKey) return { consumed: false, reason: "binding mismatch" };
    r.status = "consumed"; r.consumedAt = new Date().toISOString();
    r.consumedByWorkerId = consumer.workerId; r.consumedAttempt = consumer.workerAttempt;
    return { consumed: true, record: { ...r } };
  });
}

// expireDue()
async expireDue(now?: Date): Promise<ApprovalRecord[]> {
  const cutoff = now ?? new Date();
  const expired: ApprovalRecord[] = [];
  await this.mutate(state => {
    for (const r of state.approvals) {
      if ((r.status === "pending" || r.status === "approved") && new Date(r.expiresAt) <= cutoff) {
        r.status = "expired"; expired.push({ ...r });
      }
    }
  });
  return expired;
}

// revoke()
async revoke(id, context): Promise<ApprovalRecord | null> {
  return this.mutate(state => {
    const r = state.approvals.find(a => a.id === id);
    if (!r || r.status === "consumed" || r.status === "expired") return null;
    r.status = "revoked"; r.revokedAt = new Date().toISOString();
    r.revokedBy = context.actor; r.revocationReason = context.reason;
    return { ...r };
  });
}

// invalidateByPolicyRevision()
async invalidateByPolicyRevision(currentRevision, now?: Date): Promise<ApprovalRecord[]> {
  const invalidated: ApprovalRecord[] = [];
  await this.mutate(state => {
    for (const r of state.approvals) {
      if (r.status === "approved" && r.policyRevision !== currentRevision) {
        r.status = "invalidated"; r.invalidationReason = `Policy revision changed`;
        invalidated.push({ ...r });
      }
    }
  });
  return invalidated;
}
```

### Step 2: Build and commit

```bash
npm run build && node --test dist/tests/approvals/approval-store.test.js
git add src/approvals/approval-store.ts
git commit -m "feat(approvals): add expiry revocation invalidation and consumption"
```

---

## M0.77d.4 — Policy revision

**Files:** Create `src/policy/policy-revision.ts`
**Tests:** `tests/policy/policy-revision.test.ts`

```typescript
/**
 * policy-revision.ts — Deterministic policy revision fingerprint.
 */
import { createHash } from "node:crypto";
import type { AlixConfig } from "../config/schema.js";

export function computePolicyRevision(config: AlixConfig): string {
  const relevant = {
    default: config.permissions?.default,
    tools: config.permissions?.tools,
    protectedPaths: config.permissions?.protectedPaths,
    denyCommands: config.permissions?.denyCommands,
    shellWhitelist: config.permissions?.shellWhitelist,
    sessionMode: config.permissions?.sessionMode,
  };
  const canonical = JSON.stringify(relevant, Object.keys(relevant).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
```

Tests: revision changes when tools change, revision stable for same config, revision deterministic.

### Commit

```bash
npm run build && node --test dist/tests/policy/policy-revision.test.js
git add src/policy/policy-revision.ts tests/policy/policy-revision.test.ts
git commit -m "feat(policy): add deterministic policy revision fingerprint"
```

---

## M0.77d.5 — PolicyGate exact binding

**Files:** Modify `src/policy/policy-gate.ts`, `src/runtime/execution-decision.ts`
**Tests:** `tests/policy/policy-gate-approval-binding.test.ts`

### Step 1: Extend ExecutionDecision

Add `policyRevision?: string` to all three variants in `execution-decision.ts`.

### Step 2: Extend PolicyGate

Extend `ToolPolicyRequest` and `CapabilityPolicyRequest` with optional coordination context:
```typescript
coordinationRunId?: string;
workerId?: string;
workerAttempt?: number;
ownershipClaims?: WorkerOwnershipClaim[];
requestFingerprint?: string;
```

Replace capability-only approval reuse with exact binding. `handleAskDecision()` now computes a binding key and uses `findPendingByBindingKey()` instead of `findPending()`.

Include `policyRevision` in `PolicyGateDecision`.

### Step 3: Build and commit

```bash
npm run build && node --test dist/tests/policy/policy-gate-approval-binding.test.js
git add src/runtime/execution-decision.ts src/policy/policy-gate.ts
git commit -m "feat(policy): bind approvals to exact policy requests"
```

---

## M0.77d.6 — Approval groups

**Files:** Modify `src/approvals/approval-store.ts`

Add `ApprovalGroup` support:

```typescript
async createGroup(input: { approvalIds: string[]; metadata: ... }): Promise<ApprovalGroup>;
async resolveGroup(groupId: string, status: "approved" | "denied", context): Promise<ApprovalGroup | null>;
```

Grouping requires all members share: run, worker, attempt, scope hash, policy revision, risk, expiry, use policy.

### Commit

```bash
npm run build
git add src/approvals/approval-store.ts
git commit -m "feat(approvals): add atomic multi-capability groups"
```

---

## M0.77d.7 — Scheduler consumption integration

**Files:** Modify `src/kernel/coordination-reconciliation.ts`, `src/kernel/coordination-scheduler.ts`, `src/kernel/coordination-authorization.ts`
**Tests:** `tests/kernel/coordination-approval-lifecycle.test.ts`

### Step 1: Update reconciliation

The `isApproved` callback now receives worker and run context. It:

1. Computes the binding key from worker authorization evidence + run
2. Calls `findExact(bindingKey)` on the ApprovalStore
3. Rejects non-approved/expired/mismatched records
4. If single-use, calls `consumeApproved()` atomically
5. Returns the result

### Step 2: Persist binding evidence

`WorkerAuthorizationEvidence` gains `policyRevision?: string`. Authorize step persists the revision.

### Step 3: Tests

```typescript
// tests/kernel/coordination-approval-lifecycle.test.ts
// Test: approval required blocks worker
// Test: exact approval consumed
// Test: worker resumes after consume
// Test: denied worker fails
// Test: expired worker stays blocked
// Test: duplicate ticks consume once
```

### Step 4: Commit

```bash
npm run build && node --test dist/tests/kernel/coordination-approval-lifecycle.test.js
git add src/kernel/coordination-reconciliation.ts src/kernel/coordination-scheduler.ts src/kernel/coordination-authorization.ts
git commit -m "feat(coordination): consume and revalidate approvals before resume"
```

---

## M0.77d.8 — ApprovalWatcher

**Files:** Create `src/daemon/approval-watcher.ts`
**Tests:** `tests/daemon/approval-watcher.test.ts`

```typescript
export class ApprovalWatcher {
  private store: ApprovalStore;
  private schedulerService?: CoordinationSchedulerService;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private resolvedCursor = 0;

  start(): void { /* poll every 30s */ }
  stop(): void { /* clear timer */ }
  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await this.store.expireDue(new Date());
      const all = this.store.list();
      const resolutions = all.filter(a => a.status !== "pending");
      const sinceCursor = resolutions.slice(this.resolvedCursor);
      this.resolvedCursor = resolutions.length;
      for (const r of sinceCursor) {
        // emit event
        // request tick if coordinationRunId
      }
    } finally { this.scanning = false; }
  }
}
```

### Commit

```bash
npm run build && node --test dist/tests/daemon/approval-watcher.test.js
git add src/daemon/approval-watcher.ts tests/daemon/approval-watcher.test.ts
git commit -m "feat(daemon): add approval watcher and scheduler wake-up"
```

---

## M0.77d.9 — CLI

**Files:** Create `src/cli/commands/approval.ts`, Modify `src/cli.ts`
**Tests:** `tests/cli/approval.test.ts`

Commands: `list`, `show`, `approve`, `deny`, `revoke`, `expire`. Support `--json`, `--run`, `--worker`, `--pending`, `--all` filters.

### Commit

```bash
npm run build && node --test dist/tests/cli/approval.test.js
git add src/cli/commands/approval.ts src/cli.ts tests/cli/approval.test.ts
git commit -m "feat(cli): add approval lifecycle commands"
```

---

## M0.77d.10 — Observability and integration

**Files:** Modify `src/events/types.ts`

Add `APPROVAL_EVENT_TYPES` constant. Emit events from `ApprovalStore` on request/resolve/consume/expire/revoke/invalidate/group.

Payload: `approvalId, groupId?, coordinationRunId?, workerId?, capabilities, bindingKey, policyRevision, status, actor?, reason?, timestamp`.

### Integration tests

Create `tests/integration/approval-lifecycle.integration.test.ts` covering: full create→approve→consume flow, concurrent consumption safety, binding mismatch rejection, policy revision invalidation, expired rejection, group resolution.

### Commit

```bash
npm run build
node --test dist/tests/approvals/approval-binding.test.js dist/tests/approvals/approval-store-lock.test.js dist/tests/approvals/approval-store.test.js dist/tests/policy/policy-revision.test.js dist/tests/policy/policy-gate-approval-binding.test.js dist/tests/kernel/coordination-approval-lifecycle.test.js dist/tests/daemon/approval-watcher.test.js dist/tests/cli/approval.test.js dist/tests/integration/approval-lifecycle.integration.test.js
git add src/events/types.ts tests/integration/approval-lifecycle.integration.test.ts
git commit -m "feat(observability): add approval audit events and metrics"
```

---

## Verification

```bash
npm run build
node --test dist/tests/approvals/approval-binding.test.js
node --test dist/tests/approvals/approval-store-lock.test.js
node --test dist/tests/approvals/approval-store.test.js
node --test dist/tests/policy/policy-revision.test.js
node --test dist/tests/policy/policy-gate-approval-binding.test.js
node --test dist/tests/kernel/coordination-approval-lifecycle.test.js
node --test dist/tests/daemon/approval-watcher.test.js
node --test dist/tests/cli/approval.test.js
node --test dist/tests/integration/approval-lifecycle.integration.test.js
npm run test:node:ci
```

---

## Suggested commits (in order)

```
feat(approvals): add lifecycle types and exact binding fingerprints
feat(approvals): add lock-safe atomic approval storage
feat(approvals): add expiry revocation invalidation and consumption
feat(policy): add deterministic policy revision fingerprint
feat(policy): bind approvals to exact policy requests
feat(approvals): add atomic multi-capability groups
feat(coordination): consume and revalidate approvals before resume
feat(daemon): add approval watcher and scheduler wake-up
feat(cli): add approval lifecycle commands
feat(observability): add approval audit events and metrics
test(approvals): add lifecycle concurrency and integration coverage
docs(approvals): document approval workflows and safety rules
```

---

## Branch, PR, and tag

```bash
git switch -c feat/m077d-approval-lifecycle-depth
```

PR title: `feat(approvals): add M0.77d approval lifecycle depth`

Tag: `m0.77d-approval-lifecycle-baseline`
