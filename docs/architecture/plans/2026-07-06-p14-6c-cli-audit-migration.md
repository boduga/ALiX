# P14.6c — CLI Migration to Store-Level Audit Decorators

**Date:** 2026-07-06
**Status:** Plan
**Depends on:** P14.6b (Store-Level Audit Decorators), P14.6a (CLI Audit Emitters)
**Spec:** `docs/architecture/specs/2026-07-06-p14-6c-cli-audit-migration.md`

## Overview

Remove the direct P14.6a CLI-level audit append calls and replace raw store instances with the P14.6b audited store decorators. After this change, every governance CLI mutation emits exactly one audit event through the store layer — the dual architecture from P14.6a/P14.6b is eliminated.

**Transition:**

| Phase | Path 1 | Path 2 |
|-------|--------|--------|
| P14.6a (start) | CLI → raw store | CLI → `auditStore.append()` |
| P14.6b (interim) | CLI → raw store | CLI → `auditStore.append()` + store decorators exist but unwired |
| **P14.6c (target)** | CLI → **audited store** (single path) | — |

## Tasks

### Task 1 — Import decorators + audit store in governance.ts

**File:** `src/cli/commands/governance.ts`

Add dynamic import block for the 4 decorator factories and `FileAuditStore`. Place next to existing imports (near the top of functions that use them).

```typescript
// Dynamic import inside handler functions:
const { auditSignalStore, auditDecisionStore, auditActionQueueStore, auditReviewStore } =
  await import("../../governance/audit-decorators.js");
const { FileAuditStore } = await import("../../governance/audit-store.js");
```

**Locations to add imports:**
- `runInboxRefresh`: Add `auditSignalStore` + `FileAuditStore` (currently imports `FileSignalStore`)
- `runReview` (create mode): Add `auditReviewStore` + `FileAuditStore`
- `runDecide`: Add `auditDecisionStore` + `FileAuditStore`
- `runActionsRefresh`: Add `auditActionQueueStore` + `FileAuditStore`
- `runActionsMarkExecuted`: Add `auditActionQueueStore` + `FileAuditStore`
- `runActionsDismiss`: Add `auditActionQueueStore` + `FileAuditStore`

### Task 2 — Wrap stores + remove direct audit in runInboxRefresh

**Current pattern (lines 1823–1847):**
```typescript
const signalStore = new FileSignalStore(cwd);
const existingSignals = await signalStore.list(); // read — pass through
// ... normalise ...
for (const signal of newSignals) {
  await signalStore.append(signal);                  // ← write — needs audit
  try {
    const { FileAuditStore } = await import("...");
    const { signalEvaluatedEvent } = await import("...");
    await new FileAuditStore(cwd).append(signalEvaluatedEvent(signal)); // ← DUPLICATE, remove
  } catch { /* non-fatal */ }
  appended++;
}
```

**Target pattern:**
```typescript
const rawStore = new FileSignalStore(cwd);
const auditStore = new FileAuditStore(cwd);
const signalStore = auditSignalStore(rawStore, auditStore);
const existingSignals = await signalStore.list(); // read pass-through, no audit
// ... normalise ...
for (const signal of newSignals) {
  await signalStore.append(signal); // ← write emits exactly one audit via decorator
  appended++;
}
```

**Key change:** Remove the inner try/catch with explicit `signalEvaluatedEvent` append. The decorator handles it.

### Task 3 — Wrap store in runReview (create mode)

**Current pattern (lines 1921–1936):**
```typescript
const reviewStore = new FileReviewStore(cwd);
// ...
await reviewStore.append(review);
```

**Target pattern:**
```typescript
const rawStore = new FileReviewStore(cwd);
const auditStore = new FileAuditStore(cwd);
const reviewStore = auditReviewStore(rawStore, auditStore);
// ...
await reviewStore.append(review); // ← emits HUMAN_APPROVAL_REQUESTED via decorator
```

**Note:** The read-only mode (lines 1905–1916) uses a separate `FileReviewStore` — no change needed there since it only calls `getBySignalId()`.

### Task 4 — Wrap store + remove direct audit in runDecide

**Current pattern (lines 2042–2068):**
```typescript
const decisionStore = new FileDecisionStore(cwd);
// ...
await decisionStore.append(decision);
try {
  const { FileAuditStore } = await import("...");
  const { decisionRecordedEvent } = await import("...");
  await new FileAuditStore(cwd).append(decisionRecordedEvent(decision, signal)); // ← DUPLICATE, remove
} catch { /* non-fatal */ }
```

**Target pattern:**
```typescript
const auditStore = new FileAuditStore(cwd);
const decisionStore = auditDecisionStore(new FileDecisionStore(cwd), auditStore);
// ...
await decisionStore.append(decision); // ← emits exactly one audit via decorator
```

**Note:** `signalStore` (line 2034) and `reviewStore` (line 2045) are read-only — no wrapping needed.

### Task 5 — Wrap store in runActionsRefresh

**Current pattern (lines 2203–2214):**
```typescript
const actionQueueStore = new FileActionQueueStore(cwd);
// ...
const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, now);
```

**Target pattern:**
```typescript
const auditStore = new FileAuditStore(cwd);
const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(cwd), auditStore);
// ...
const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, now);
// refreshProposals calls actionQueueStore.append() internally → decorator emits actionProposedEvent
```

### Task 6 — Wrap store + remove direct audit in runActionsMarkExecuted

**Current pattern (lines 2248–2283):**
```typescript
const store = new FileActionQueueStore(cwd);
// ...
await store.appendStatusTransition(transition);
try {
  const { FileAuditStore } = await import("...");
  const { actionOverriddenEvent } = await import("...");
  await new FileAuditStore(cwd).append(actionOverriddenEvent(transition, proposal)); // ← DUPLICATE, remove
} catch { /* non-fatal */ }
```

**Target pattern:**
```typescript
const auditStore = new FileAuditStore(cwd);
const store = auditActionQueueStore(new FileActionQueueStore(cwd), auditStore);
// ...
await store.appendStatusTransition(transition); // ← emits exactly one audit via decorator
```

### Task 7 — Wrap store + remove direct audit in runActionsDismiss

**Same pattern as Task 6** — replace raw store with `auditActionQueueStore`, remove the direct `actionOverriddenEvent` append.

### Task 8 — Audit migration tests

**File:** `tests/governance/audit-migration.test.ts`

Test the invariant: each governance CLI mutation emits exactly one audit event through the store decorator, with no duplicates.

**Test design** (all use mocked audit store):

| # | Test | What it proves |
|---|------|---------------|
| 1 | `AuditedSignalStore` via `auditSignalStore(...)` emits exactly one event per append | Single emission |
| 2 | `AuditedDecisionStore` via `auditDecisionStore(...)` emits exactly one event per append | Single emission |
| 3 | `AuditedActionQueueStore` via `auditActionQueueStore(...)` emits exactly one event per append | Single emission |
| 4 | `AuditedActionQueueStore` via `auditActionQueueStore(...)` emits exactly one event per `appendStatusTransition` | Single emission |
| 5 | `AuditedReviewStore` via `auditReviewStore(...)` emits exactly one event per append | Single emission |
| 6 | No audit event emitted on read-only operations | No emission on reads |
| 7 | No audit event emitted when inner store write fails | Failure propagation |
| 8 | Audit append failure does not block governance write | Non-fatal invariant |

**Note:** These tests focus on the factory+decorator integration rather than the full CLI dispatch — the decorator unit tests in P14.6b already cover each class in isolation. These prove the factory wiring produces single emission.

## Estimated additions

| File | Lines | Change type |
|------|-------|-------------|
| `src/cli/commands/governance.ts` | ~30 changed + ~30 removed | Modify (add imports, replace stores, remove audit blocks) |
| `tests/governance/audit-migration.test.ts` | ~180 | New file |
| **Total new** | ~180 | |

## Dependencies

- `src/governance/audit-decorators.ts` — 4 factory functions
- `src/governance/audit-store.ts` — `FileAuditStore`
- `src/cli/commands/governance.ts` — CLI handler functions

## Acceptance gate

P14.6c is complete when:
1. All 4 direct P14.6a audit append blocks are removed from `governance.ts`
2. All 6 store write paths use audited decorators
3. Each governance CLI mutation emits exactly one audit event
4. No audit events emitted on read-only operations
5. Inner store write failures propagate (no audit on failure)
6. Audit append failures are non-fatal
7. All governance tests pass (558+)
8. TypeScript is clean (0 errors)
9. GitNexus detect_changes: LOW risk, 0 affected processes
