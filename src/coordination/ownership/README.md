# Ownership Registry & Scope Arithmetic

## Overview

This package answers one question — *who may write where, and for how long* — and keeps that answer identical at every enforcement point. It holds the lock-protected, lease-based registry of active write claims (`.alix/ownership/ownership.json`), the path-scope arithmetic shared by planning serialization, lease conflict detection, and runtime authorization, the pre-dispatch gate that runs after `PolicyGate`, and the extractor that derives the paths a tool call will actually write.

Scope is deliberately limited to deterministic path-based ownership; graph-node and capability scopes are reserved, not implemented `[ownership-types.ts:OwnershipScope]`.

## Interface

- `OwnershipRegistry` — the only live claim store: `acquire`, `acquireMany`, `release`, `renew`, `revoke`, `prune`, `refresh`, `list`, `get`, `listActive`, `listHistory`, `findConflictsByPattern`, `hasCoverageForPath`, `authorizeMutation` `[ownership-registry.ts:OwnershipRegistry]`.
- `OwnershipRegistryOptions`, `AcquireRequest`, `MutationTarget`, `MutationAuthorization` — registry construction and call contracts `[ownership-registry.ts:AcquireRequest]`.
- `OwnershipMode` (`exclusive-write | shared-read | review-only`) and `OwnershipStatus` (`active | released | expired | revoked`) `[ownership-types.ts:OwnershipMode]`.
- `PathScope` (`kind: "path"`, `root`, `recursive`), `OwnershipScope`, `OwnershipRecord`, `OwnershipStore`, `AcquireResult`, `OwnershipEventSink` `[ownership-types.ts:OwnershipRecord]`.
- `modesConflict` — the asymmetric conflict matrix `[ownership-types.ts:modesConflict]`.
- `OWNERSHIP_EVENT_TYPES` — `acquired`, `released`, `renewed`, `expired`, `conflict`, `revoked`, `denied`, `lock_failed`, `state_invalid` `[ownership-types.ts:OWNERSHIP_EVENT_TYPES]`.
- `normalizePathScope` — planning-side pattern normalization that rejects `..` and uninterpretable wildcards `[path-scope.ts:normalizePathScope]`.
- `pathScopesOverlap` (symmetric), `scopeContains`/`pathInScope` (directional), `formatScope` `[path-scope.ts:pathScopesOverlap]`.
- `resolveOwnedScopePrefix`, `isWorkspaceWideGrant`, `isWithinOwnedScope` — the single enforcement-side matcher `[path-scope.ts:isWithinOwnedScope]`.
- `claimScopesOverlap`, `RawOwnershipClaim` — planning-side overlap question over workspace-relative claims `[path-scope.ts:claimScopesOverlap]`.
- `SCOPABLE_WRITE_TOOLS`, `unscopableChannelDenial` — the allowlist of channels whose targets are enumerable, and the denial verdict for all others `[owned-scope-channels.ts:SCOPABLE_WRITE_TOOLS]`.
- `OwnershipLock`, `DEFAULT_LOCK_TIMEOUT_MS` (5 000 ms) — cross-process lock delegating to `ApprovalStoreLock` `[ownership-lock.ts:OwnershipLock]`.
- `OwnershipGateConfig`, `checkOwnershipGate` — pre-dispatch authorization, returning `null` on pass or a non-retryable `ToolResult` error `[ownership-gate.ts:checkOwnershipGate]`.
- `MutationClassification` (`known-write | unknown-write | no-write`), `MutationTarget`, `MutationExtraction`, `extractMutationTargets` `[mutation-targets.ts:extractMutationTargets]`.

## Invariants

- Owned-scope matching is ONE contract enforced at TWO points: `PolicyGate` and `FileToolRouter` must both call `isWithinOwnedScope`; neither may grow a second matcher or re-normalize independently `[path-scope.ts:isWithinOwnedScope]`.
- A broader capability permission never widens a declared grant; for a write that declares owned paths, the owned-path rule decides inside versus outside `[owned-scope-channels.ts:unscopableChannelDenial]`.
- Fail closed: `..` traversal, uninterpretable wildcards, Windows drive spellings on any platform, and owned entries resolving outside the workspace all reduce to `undefined`, which authorizes nothing `[path-scope.ts:resolveOwnedScopePrefix]`.
- An owned root cannot acquire authority by aliasing: any symbolic link on the owned prefix, and any target whose canonical path escapes either the workspace or the owned prefix, is denied `[path-scope.ts:hasSymlinkInOwnedRoot]`.
- Workspace-wide grants are a rule, not an enumeration: `.`, `./`, `/`, and any pattern of only `*`/`**` segments resolve to the workspace root `[path-scope.ts:isWorkspaceWideGrant]`.
- Conflict matrix is intentionally asymmetric: exclusive-write blocks exclusive-write, shared-read blocks exclusive-write, exclusive-write does not block shared-read, and review-only blocks nothing `[ownership-types.ts:modesConflict]`.
- Same agent with the same scope and mode is a renewal, not a second record `[ownership-registry.ts:acquireUnlocked]`.
- `acquireMany` is all-or-nothing: any pre-existing conflict or intra-batch overlap between different agents with conflicting modes rejects the whole batch `[ownership-registry.ts:acquireMany]`.
- `autoAcquire: false` requires existing exclusive-write coverage for every target; unconfident targets can never be auto-acquired `[ownership-registry.ts:authorizeMutationUnlocked]`.
- `unknown-write` classification is denied at the gate; only `known-write` reaches the registry, and `no-write` passes through `[ownership-gate.ts:checkOwnershipGate]`.
- Only `file.create`, `file.delete`, and `patch.apply` are scopable write channels; unknown tools with unproven read-only registry rows are denied for scoped workers `[owned-scope-channels.ts:SCOPABLE_WRITE_TOOLS]`.
- Shell commands are treated as `no-write` only for the explicit read-only command allowlist (`ls`, `cat`, `head`, `tail`, `grep`, `find`, `echo`, `pwd`, `which`); every other shell command is `unknown-write` `[mutation-targets.ts:READ_ONLY_COMMANDS]`.
- A malformed or unreadable persisted registry is never silently trusted: reads reset to empty and the mutation path returns `null` after emitting `ownership.state_invalid` `[ownership-registry.ts:reloadFromDisk]`.
- A failed lock acquisition never mutates state; it emits `ownership.lock_failed` with reason `timeout` and returns `null` `[ownership-registry.ts:withLock]`.
- Default lease TTL is 30 minutes, auto-acquired gate leases use 5 minutes, and history retention is 30 days `[ownership-registry.ts:DEFAULT_TTL_MS]`.
- Terminal records are preserved with distinct timestamps — `expiredAt`, `releasedAt`, `revokedAt` — and `prune` only removes records older than the retention window `[ownership-registry.ts:pruneUnlocked]`.
- `hasCoverageForPath` recognizes only active, unexpired, same-agent `exclusive-write` scopes containing the target `[ownership-registry.ts:hasCoverageForPath]`.
- Planning overlap lives in the same matcher module so planning serialization, lease conflicts, and runtime authorization cannot drift into three answers `[path-scope.ts:claimScopesOverlap]`.

## Side Effects

- Every mutation acquires `.alix/ownership/ownership.lock` before reading state; on Linux this is kernel-owned `flock`, released on process death, and where flock is unavailable the shared fail-closed `mkdir` backend reclaims only provably dead owners — there is no age-based reclaim `[ownership-lock.ts:OwnershipLock]`.
- Under the lock the registry reloads state, expires stale active leases, applies the mutation, and persists only when something changed, using write-temp-then-rename for atomicity `[ownership-registry.ts:persistIfChanged]`.
- Each durable mutation increments `revision`; event payloads carry that revision, a timestamp, and the session id `[ownership-registry.ts:emitEvent]`.
- Lifecycle events are emitted only after the lock is released, and an event-sink failure is logged but never undoes a committed lease `[ownership-registry.ts:emitEvents]`.
- Event emission is a no-op when no `OwnershipEventSink` is configured `[ownership-registry.ts:emitEvent]`.
- A throwing mutation body clears pending events, reloads from disk, and rethrows so in-memory state cannot diverge from the durable store `[ownership-registry.ts:withLock]`.
- `refresh` performs its own 2 000 ms lock acquisition and throws instead of returning stale data when the lock or the persisted state is unavailable `[ownership-registry.ts:refresh]`.
- The gate reads mutation targets through `WorkspacePathResolver.check()`, which resolves absolute paths and classifies workspace, sensitive, and protected status `[mutation-targets.ts:extractMutationTargets]`.

## Verification

- Run: `pnpm test`
