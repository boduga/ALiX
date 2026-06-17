# M0.77d — Approval Lifecycle Depth

> **Status:** Design document  
> **Builds on:** M0.76.2 ExecutionAuthorization, M0.77c CoordinationScheduler, ApprovalStore, ContinuationManager  
> **Primary goal:** Transform the approval system from a simple queue into a lifecycle-managed, binding-aware, lock-safe subsystem with CLI, daemon watcher, and scheduler integration.

---

## 1. Core rule

An approval is valid only for the exact **capability + worker + run + scope + policy revision + request fingerprint** for which it was issued.

---

## 2. Approval status lifecycle

```text
                  ┌──────────┐
                  │ pending  │
                  └────┬─────┘
           ┌───────────┼───────────┐
           │           │           │
           ▼           ▼           ▼
      ┌────────┐ ┌──────────┐ ┌────────┐
      │approved│ │ expired  │ │revoked │
      └───┬────┘ └──────────┘ └────────┘
          │
     ┌────┼────┐
     │    │    │
     ▼    ▼    ▼
  ┌─────┐ ┌────────┐ ┌─────────────┐
  │used │ │expired │ │ invalidated │
  └─────┘ └────────┘ └─────────────┘
```

Terminal states: `denied`, `consumed`, `expired`, `revoked`, `invalidated`.

Transitions:
- `pending` → `approved` | `denied` | `expired` | `revoked`
- `approved` → `consumed` | `expired` | `revoked` | `invalidated`

---

## 3. Use policy

```typescript
export type ApprovalUsePolicy =
  | "single_use"        // consumed once on scheduler dispatch
  | "worker_attempt"    // valid for the current worker attempt
  | "coordination_run"  // valid for the entire coordination run
  | "session";          // valid for the session
```

Default: `"single_use"`. No cross-run reuse in M0.77d.

---

## 4. Approval binding

```typescript
type ApprovalBinding = {
  coordinationRunId: string;
  workerId: string;
  workerAttempt: number;
  capability: string;
  ownershipClaimsHash: string;
  requestFingerprint: string;
  policyRevision: string;
};

bindingKey = sha256(canonicalJson(binding));
```

`requestFingerprint` is derived from: capability, canonical arguments, worker goal hash, ownership claims, risk level, run ID, worker ID, attempt, policy revision.

---

## 5. Policy revision fingerprint

Computed deterministically from all policy-relevant configuration:

```text
permissions.default
permissions.tools
protectedPaths
denyCommands
shell whitelist
session mode policy
policy rules
risk configuration
```

Algorithm: `sha256(canonicalJson(policyRelevantConfig))`. Passed through `PolicyGateDecision` and `ExecutionDecision`.

---

## 6. ApprovalRecord

```typescript
export type ApprovalStatus =
  | "pending" | "approved" | "denied"
  | "consumed" | "expired" | "revoked" | "invalidated";

export interface ApprovalRecord {
  id: string;
  status: ApprovalStatus;

  bindingKey: string;
  requestFingerprint: string;

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

  policyRevision: string;
  usePolicy: ApprovalUsePolicy;

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
}
```

---

## 7. ApprovalStore — lock-safe API

### Locking

Before any lifecycle features, add a per-file lock at `.alix/approvals/locks/approvals.lock`. Use the same atomic-mkdir pattern as `CoordinationRunLock`. All write operations use `mutate<T>(fn)`:

```typescript
async mutate<T>(fn: (approvals: ApprovalRecord[]) => T | Promise<T>): Promise<T>;
```

Atomic write: `approvals.json.tmp.<token>` → rename → `approvals.json`.

### API

```typescript
request(input): Promise<ApprovalRecord>;

resolve(id, "approved" | "denied", context): Promise<ApprovalRecord | null>;

consumeApproved(id, expectedBindingKey, consumer): Promise<ConsumeResult>;
// Atomically: reload → verify approved + expiry + binding + policy revision → mark consumed

expireDue(now): Promise<ApprovalRecord[]>;
// Marks all expired approvals, returns them

revoke(id, reason, actor): Promise<ApprovalRecord | null>;

invalidateByPolicyRevision(currentRevision): Promise<ApprovalRecord[]>;
// Marks all approved records with stale revision as invalidated

findExact(bindingKey): ApprovalRecord | undefined;

findPendingByBindingKey(bindingKey): ApprovalRecord | undefined;

listByRun(runId): ApprovalRecord[];
listByWorker(workerId): ApprovalRecord[];
listByGroup(groupId): ApprovalRecord[];
list(): ApprovalRecord[];
```

---

## 8. PolicyGate integration

- `evaluateToolCall()` and `evaluateCapability()` accept optional policy revision
- `PolicyGateDecision` gains `policyRevision?: string`
- `ExecutionDecision` gains `policyRevision?: string`
- On mismatch, existing approvals for the stale revision are invalidated

---

## 9. Scheduler integration

The `isApproved` callback in `reconcileCoordinationRun` is upgraded to:

1. Call `findExact(bindingKey)` — exact match only
2. Check `status === "approved"`
3. Check `expiresAt < now` (reject if expired)
4. Check policy revision match
5. If `usePolicy === "single_use"`, atomically call `consumeApproved()`
6. Return result

On denial/revocation: mark worker as `blocked` / `failed` with `blockReason: "authorization_denied"`.

---

## 10. ApprovalWatcher daemon service

```typescript
class ApprovalWatcher {
  start(): void;
  stop(): void;
  shutdown(): Promise<void>;
  scan(): Promise<void>;
}
```

- Polls `ApprovalStore.list()` every 30 seconds
- Calls `expireDue()` for TTL management
- Detects newly resolved approvals
- On `approved`: calls `schedulerService.requestTick(runId)`
- On `denied`/`revoked`: marks blocked worker, requests tick
- Separate service alongside `CoordinationSchedulerService`

Default intervals:
- `approvalTtlMs`: 30 minutes
- `approvedConsumptionTtlMs`: 5 minutes
- `watcherIntervalMs`: 30 seconds

---

## 11. CLI

```
alix approval list                          # list all pending
alix approval list --all                    # list all
alix approval list --run <run-id>           # list by run
alix approval approve <id> [--reason "..."] [--by "user"]
alix approval deny <id> [--reason "..."]
alix approval revoke <id> [--reason "..."]
```

These go through the lock-safe `ApprovalStore` directly and (in daemon mode) notify the watcher.

---

## 12. Event/audit additions

Events:
```
approval.created
approval.resolved
approval.consumed
approval.expired
approval.revoked
approval.invalidated
```

Each includes: `approvalId, coordinationRunId?, workerId?, capability, bindingKey, policyRevision`.

---

## 13. File structure

### Modify
- `src/approvals/approval-store.ts` — lock-safe mutation, binding key, expiry, revocation, consumption
- `src/approvals/approval-types.ts` — extract types (or keep inline)
- `src/policy/policy-gate.ts` — policy revision propagation
- `src/runtime/execution-decision.ts` — `policyRevision` field
- `src/kernel/coordination-scheduler.ts` — enriched approval check
- `src/kernel/coordination-reconciliation.ts` — pass policy revision
- `src/events/types.ts` — new event types, `EventActor` additions
- `src/cli.ts` — dispatch `alix approval`

### Create
- `src/cli/commands/approval.ts` — CLI handler
- `src/approvals/approval-lock.ts` — per-file approval lock
- `src/daemon/approval-watcher.ts` — daemon polling service
- `tests/approvals/approval-store.test.ts` — expanded tests
- `tests/cli/approval.test.ts` — CLI tests
- `tests/daemon/approval-watcher.test.ts` — watcher tests

---

## 14. M0.77d sub-milestones

| # | Scope |
|---|-------|
| .1 | Approval types, binding key fingerprint, migration of old records |
| .2 | Lock-safe ApprovalStore mutation (`mutate<T>`, atomic save, lock) |
| .3 | Expiry, revocation, invalidation, consumption |
| .4 | Policy fingerprint propagation through PolicyGate/ExecutionAuthorization |
| .5 | Exact deduplication (`findExact`, `findPendingByBindingKey`), capability grouping |
| .6 | Scheduler consume/revalidate integration |
| .7 | ApprovalWatcher daemon service |
| .8 | CLI approve/deny/revoke/list workflows |
| .9 | Audit/events/metrics for full lifecycle |
| .10 | Integration and concurrency tests |
