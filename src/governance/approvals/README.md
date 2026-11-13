# Approvals

## Overview

File-backed approval queue for the ALiX policy gate: it mints `pending` requests, records operator decisions, and atomically claims approved grants for single execution. The transactional ledger is authoritative; `approvals.json` plus its `journal.jsonl` delta is a best-effort projection that can be rebuilt, and reconciliation reports drift without mutating anything.

## Interface

- `ApprovalStore` — the queue: `requestBound`, `requestFresh`, `requestOrReusePending`/`request` to create, `resolve`/`resolveWithEvidence` to decide, `consumeApproved` to claim, `recordExecutionOutcome`/`markExecutionUnverified` for the post-claim report, and `list`/`listPending`/`get`/`findExact`/`findByRequestId`/`findPending`/`findResolved` for reads `[approval-store.ts:ApprovalStore]`.
- `loadApprovalStore(cwd)` — the one project-store bootstrap; returns `undefined` when the store cannot load so a broken store never kills a run `[approval-store.ts:loadApprovalStore]`.
- `openGlobalApprovalStore()` — opens the cross-project store at `~/.alix/approvals` via `new ApprovalStore(homedir())` for schedule proposals `[global-store.ts:openGlobalApprovalStore]`.
- `ApprovalStatus` (`pending` | `approved` | `denied` | `consumed` | `expired` | `revoked` | `invalidated`) and `ApprovalExecutionOutcome` (`pending` | `succeeded` | `failed` | `cancelled` | `unverified`) `[approval-types.ts:ApprovalStatus]`, `[approval-types.ts:ApprovalExecutionOutcome]`.
- `ApprovalRecord`/`ApprovalGroup`/`ConsumeResult`/`RemoteDecisionEvidence` and `remoteDecisionRetryKey` `[approval-types.ts:ApprovalRecord]`, `[approval-types.ts:ApprovalGroup]`, `[approval-types.ts:ConsumeResult]`, `[approval-types.ts:remoteDecisionRetryKey]`.
- Binding helpers: `computeBindingKey`, `computeOwnershipClaimsHash`, `computeInvocationFingerprint`, `invocationMatches`, `approvalExpiryState`, `normalizeApprovalRecord` `[approval-binding.ts:computeBindingKey]`, `[approval-binding.ts:computeOwnershipClaimsHash]`, `[approval-binding.ts:computeInvocationFingerprint]`, `[approval-binding.ts:invocationMatches]`, `[approval-binding.ts:approvalExpiryState]`, `[approval-binding.ts:normalizeApprovalRecord]`.
- `invocationMatches` compares a persisted `InvocationIdentity` fingerprint; `approvalExpiryState` returns `valid`/`expired`/`invalid` `[approval-binding.ts:invocationMatches]`, `[approval-binding.ts:approvalExpiryState]`.
- `WorkerApprovalPort` + `createWorkerApprovalPort`/`openWorkerApprovalPort`/`assertNoForbiddenDecisionMethods` — restricted observe/request/claim/report facade with no decision methods `[worker-approval-port.ts:WorkerApprovalPort]`, `[worker-approval-port.ts:createWorkerApprovalPort]`, `[worker-approval-port.ts:openWorkerApprovalPort]`, `[worker-approval-port.ts:assertNoForbiddenDecisionMethods]`.
- `claimLiveStep`/`liveStepInvocation`/`emitBlockedStepApprovalCreated` — replay/rollback step claims that hash actual step data `[live-step-approval.ts:claimLiveStep]`, `[live-step-approval.ts:liveStepInvocation]`, `[live-step-approval.ts:emitBlockedStepApprovalCreated]`.
- `reconcileApprovalLedger(cwd)` — read-only projection-vs-ledger report `[approval-ledger-reconcile.ts:reconcileApprovalLedger]`.
- `ApprovalStoreLock` + `detectLockBackend` — cross-process lock with `flock` and `mkdir` backends `[approval-store-lock.ts:ApprovalStoreLock]`, `[approval-store-lock.ts:detectLockBackend]`.
- `extractTarget(reason)` — pulls the `": "` suffix from an approval reason for display `[extract-target.ts:extractTarget]`.
- `APPROVAL_LEDGER_EVENT_TYPES` (`approval.created`/`approval.updated`/`approval.removed`) `[approval-types.ts:APPROVAL_LEDGER_EVENT_TYPES]`.

## Invariants

- The ledger is the commit: `mutate` appends ledger facts before touching the projection and throws on append failure, so no JSON-only state can exist `[approval-store.ts:mutate]`.
- `load()` reads the ledger first and rethrows ledger errors; the JSON projection is consulted only for legacy records with zero ledger facts `[approval-store.ts:load]`.
- Every mutation reloads the ledger under a per-file cross-process lock plus a shared mutation queue; an unacquired lock throws `Could not acquire approval lock` `[approval-store.ts:mutate]`, `[approval-store-lock.ts:ApprovalStoreLock]`.
- Lock backend is `flock` where available and fail-closed `mkdir` otherwise; a stolen/replaced lock inode is never reported as acquired `[approval-store-lock.ts:detectLockBackend]`, `[approval-store-lock.ts:ApprovalStoreLock]`.
- `consumeApproved` denies on non-`approved` status, invalid/expired expiry, binding-key mismatch, unusable timestamps, a competing newer exact decision, and worker/attempt or invocation mismatch `[approval-store.ts:consumeApproved]`.
- A newer exact decision supersedes an older grant; timestamp ties are ambiguous and cannot authorize consumption `[approval-store.ts:consumeApproved]`.
- A record with no `invocationFingerprint` fails `invocationMatches`, so a legacy request-id match alone never authorizes reuse `[approval-binding.ts:invocationMatches]`.
- Missing, empty, or unparsable `expiresAt` is `invalid` (never "no expiry"); `expireDue` expires such records terminally `[approval-binding.ts:approvalExpiryState]`, `[approval-store.ts:expireDue]`.
- `requestOrReusePending` reuses only the latest same-binding `pending` record and throws `pending approval identity mismatch` on worker/attempt/run/session collision `[approval-store.ts:requestOrReusePending]`.
- `recordExecutionOutcome` transitions only a `consumed` record whose outcome is still `pending`, so the first terminal report wins `[approval-store.ts:recordExecutionOutcome]`; `markExecutionUnverified` converts a dead `pending` claim to terminal `unverified` `[approval-store.ts:markExecutionUnverified]`.
- `unverified` is terminal and fail-closed: the approval is never reissued and the invocation is never retried automatically `[approval-types.ts:ApprovalExecutionOutcome]`.
- The restricted worker port exposes no decision methods and returns `undefined` for records outside the bound worker; `assertNoForbiddenDecisionMethods` throws if one is present `[worker-approval-port.ts:createWorkerApprovalPort]`, `[worker-approval-port.ts:assertNoForbiddenDecisionMethods]`.
- Replay/rollback authority binds the canonical workspace, session, step position, tool, and hashed actual step data; grants are claimed exactly once before the effect `[live-step-approval.ts:liveStepInvocation]`, `[live-step-approval.ts:claimLiveStep]`.
- Reconciliation is read-only and `ok` requires zero issues and an untruncated read; issue kinds are `missing_in_ledger`, `record_mismatch`, `projection_stale`, `projection_missing`, `version_behind`, `ledger_payload_invalid` `[approval-ledger-reconcile.ts:reconcileApprovalLedger]`.
- Bindings are canonical: recursive key-sorted JSON hashed with SHA-256, so key order cannot fork a fingerprint `[approval-binding.ts:computeBindingKey]`, `[approval-binding.ts:computeInvocationFingerprint]`.
- Latest-decision precedence applies per binding key even when the newer record is pending/denied/consumed/revoked; IDs break timestamp ties `[approval-store.ts:rebuildIndexes]`.

## Side Effects

- Durable ledger appends (`approval.created`/`approval.updated`/`approval.removed`) on every committed mutation `[approval-store.ts:mutate]`.
- Writes the `approvals.json` snapshot atomically via temp-file `writeFile` + `rename`, mode `0o600`, directory `0o700`, and clears the journal; pure additions append to `approvals.json.journal.jsonl` `[approval-store.ts:saveAtomic]`, `[approval-store.ts:appendJournal]`.
- Creates the `.alix/approvals` directory with mode `0o700` on first write `[approval-store.ts:saveAtomic]`, `[approval-store.ts:appendJournal]`.
- Acquires a cross-process lock file/dir under `.alix/approvals` for each mutation and releases it in `finally` `[approval-store.ts:mutate]`, `[approval-store-lock.ts:ApprovalStoreLock]`.
- Emits lifecycle events (`approval.created`/`resolved`/`consumed`/`expired`/`revoked`/`invalidated`/`execution.*`) to the EventLog fire-and-forget `[approval-store.ts:emit]`, `[approval-store.ts:resolve]`.
- Appends `approval.approved`/`approval.denied` to the `AuditStore` on resolve, fire-and-forget `[approval-store.ts:resolve]`.
- Prunes terminal records beyond `maxTerminalRecords` (default 1000); pending/approved are never pruned `[approval-store.ts:mutate]`, `[approval-store.ts:ApprovalStore]`.
- `openGlobalApprovalStore` reads/writes the home-directory store at `~/.alix/approvals` `[global-store.ts:openGlobalApprovalStore]`.
- `claimLiveStep` performs a store `load` and, when no exact decision exists, a `requestOrReusePending` write `[live-step-approval.ts:claimLiveStep]`.

## Verification

- Run: `pnpm test`
