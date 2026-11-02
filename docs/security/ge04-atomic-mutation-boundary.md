# GE-04: Atomic filesystem mutation boundary — implementation contract

Status: DESIGN ONLY / SECURITY HOLD. This document does not qualify GE-04 or authorize a merge.

## Observed implementation gaps

- `src/capabilities/tools/tool-router.ts` `file.create` now pins existing leaf descriptors with `O_NOFOLLOW`, but `mkdir(dirname(...))` and the initial exclusive create still resolve parent directories by pathname. An attacker who can replace a parent directory between authorization and use can redirect a write.
- `src/execution/patch/patch-engine.ts` uses separate `resolvePatchPath` checks and pathname-based `writeFile` for search/replace, structured patches, and unified diffs. `rm` and directory creation are also pathname-based.
- Shell-mediated writes and external tools cannot be made safe merely by checking path strings before command execution.
- `O_NOFOLLOW` only protects the final component; canonical checks and lstat/realpath rechecks are not atomic authorization of a future mutation.

## Security invariant

For each mutating operation, the directory actually used by the kernel to perform the operation MUST be a descendant of the authorized, pinned workspace and owned-scope directory handles, and the leaf MUST satisfy the operation's preconditions. The authorization and mutation MUST refer to the same pinned objects, not separately resolved pathnames. A symlink swap MUST never cause a write, create, rename, or delete outside the authorized directory tree.

## Proposed capability boundary

Introduce an internal `ScopedMutationService` used by `file.create`, `file.delete`, patch application, and checkpoint restore. It receives an immutable authorization context (workspace, owned scopes, protected/sensitive paths, policy revision, worker identity), an operation, and relative target path. It returns a structured result and mutation evidence. No caller may supply a trusted absolute path as a substitute for authority.

On Linux, implement a reviewed native helper using directory file descriptors and `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS` (and appropriate `RESOLVE_NO_MAGICLINKS`) or an equivalent audited fd-relative walk; perform `openat`/`mkdirat`/`renameat`/`unlinkat` relative to pinned directory handles. Resolve owned scopes under the workspace root without following symlinks. Recheck policy revision/lease validity at the final boundary. Never fall back to pathname-based writes if the primitive is unavailable.

On macOS and Windows, provide equivalent native handle-relative guarantees or fail closed for governed writes until independently qualified. A platform-specific implementation must have its own adversarial tests; Linux behavior alone cannot qualify cross-platform safety. A Node-only `realpath`/`lstat`/`O_NOFOLLOW` implementation is NOT equivalent to the invariant.

## Operation contracts

- **Create:** exclusive create; identical existing content returns unchanged success; differing existing content requires an owned overwrite authorization. Parent creation must remain beneath pinned directories.
- **Overwrite:** open an authorized regular file without symlink following; verify pinned identity and preimage, write via pinned handle or safely replace via fd-relative rename. For failure atomicity, prefer same-directory temp file, fsync, and fd-relative rename after final authorization. Preserve metadata policy explicitly.
- **Patch:** plan and validate every file before mutations; preimage hashes refer to pinned content. Apply operations through the same service. Preserve checkpoint and rollback semantics; do not claim all-or-nothing multi-file transactions without a journal and crash recovery.
- **Delete:** operate on a validated leaf relative to pinned parent, without following symlinks; clarify symlink-unlink policy separately.
- **Shell:** shell commands with arbitrary filesystem mutation are not safely scope-enforceable through argument extraction alone. Deny in owned/governed mode unless executed inside an independently qualified OS sandbox with a restricted writable mount view. Explicit policy approval does not substitute for containment.

## Adversarial qualification matrix

1. Symlink at owned root, nested parent, and final leaf (inside/outside workspace).
2. Dangling links, symlink loops, non-existent nested parents, absolute and `..` traversal, path normalization, and platform separators.
3. Deterministic parent swap between authorization and create, overwrite, delete, and patch; assert external sentinel unchanged.
4. Concurrent workers writing different contents; prove no unowned inode mutation and document expected conflict behavior.
5. Symlink swap during patch preimage verification and checkpoint restore; prove no external mutation.
6. Shell-mediated `>`, `mv`, `cp`, script execution and command substitutions in governed mode; demonstrate denial or sandbox containment.
7. Crash and partial write, disk-full, permissions, and cleanup failures; verify journal/recovery and audit evidence.
8. Linux, macOS and Windows CI coverage of each supported backend; unsupported backend must fail closed.

## Final-boundary authorization protocol (required before production)

A parent/child READY/GO handshake alone is **insufficient**: authority can be revoked after GO and before `openat2`/`write`. The production design must provide one linearization point shared by **all** lease/policy revocations and governed mutations, including independent daemon processes.

1. **Single authority coordinator.** All ownership lease revocations, policy invalidations and governed mutation admissions must use one durable, cross-process synchronization domain. Any bypassing writer or revoker invalidates the guarantee. A module-private JavaScript verifier brand, `instanceof`, and an in-memory mutex do not provide this guarantee.
2. **Prepare and pin.** The native worker opens workspace and owned-scope directory handles with no symlink traversal. It reports a unique request identifier, operation digest and pinned identity over an authenticated, private IPC channel; it must not accept an untrusted GO token from argv, environment, or an arbitrary process.
3. **Authorize under exclusive coordination.** The trusted coordinator acquires the shared mutation/revocation exclusion lock, reloads authoritative policy and lease state, validates the exact invocation and the already-consumed approval claim, then authorizes only that specific worker/request. The lock must remain held until the kernel mutation has completed or definitively failed. A revocation waits for this operation to finish, or wins the lock first and prevents it.
4. **Mutate and acknowledge.** While the coordinator retains exclusion, the helper performs the fd-relative operation and returns a terminal receipt tied to the request identifier. A broken pipe, crash, timeout, or missing receipt yields an **unknown** outcome, not a fabricated failure or success; reconcile the on-disk state before settlement.
5. **Release and audit.** Persist the outcome and release exclusion in a documented order; ensure the lock cannot become permanently held after process crashes. Establish explicit ordering between lease expiry, monotonic clock checks, lock acquisition and the mutation linearization point. Do not claim expiry guarantees stronger than the protocol enforces.

### Experimental ownership-only fence (not a production boundary)

`OwnershipRegistry.withExclusiveLeaseFence` now holds the existing cross-process ownership lock across the experimental helper invocation. `ScopedMutationAuthorizationGrant.withLeaseFence` uses this API, so an explicit `OwnershipRegistry.revoke` or `release` cannot interleave with the helper's write after the fence is acquired. A revocation that wins first prevents dispatch. A regression test exercises competing registry instances and verifies that revocation waits for the fenced action.

**Limits:** This fence does not serialize policy configuration changes or approval-store revocation, and a lease may expire while the action is running. The lock is held for the entire helper lifetime, so lock waiters can fail closed on timeout. The current prototype also has no crash-reconciled mutation receipt. Do not call this the final atomic authorization boundary, and do not register the experimental backend in production.

**Unresolved design work:** the current `OwnershipRegistry`, policy revision checks, and native helper do not implement this shared coordination protocol. Cross-process lock ordering, crash recovery, helper authenticity, parent/child liveness, and filesystem commit semantics need an ADR and adversarial tests before implementation can be qualified. In particular, merely adding a READY/GO message to the current helper would **not** close the TOCTOU gap.

## Release gates

- Independent reviewer verifies the native primitive, authority binding, and all mutation call sites.
- Red-team tests run against the exact pinned commit, with reproducible swap harness and sentinel assertions.
- No regression to existing idempotency, ownership, protected-path, checkpoint, and audit semantics.
- Evidence identifies any remaining unsupported mutation channels. Until then, GE-04 and D9 Phase F remain HOLD.

## Experimental adapter authorization guard (2026-11-02)

The opt-in `ExperimentalLinuxScopedMutationService` requires an injected
authorization verifier that is **only** obtainable from
`createScopedMutationAuthorizationVerifier`
(`src/execution/filesystem/scoped-mutation-authorization.ts`). A caller-supplied
callback is rejected at construction by a module-private brand, closing the
previous fail-open where any `async () => true` satisfied the guard. Missing
identity/revision/lease/approval metadata, a `null` grant and verifier errors
all fail closed.

The verifier factory now rejects plain-object substitutes for the approval and ownership stores (`instanceof` checks), and the live lease predicate refuses existing symlinked parent components before consuming an approval. These are defense-in-depth checks, **not** proof of a trusted same-process caller or an atomic kernel authorization boundary: JavaScript prototypes can be manipulated, canonical prechecks can race, and the native helper still does not validate policy/lease/approval itself.

The composition reuses ALiX's existing authorities and adds no second one:

- **Policy:** `computePolicyRevision` — the same fingerprint the coordination
  scheduler uses to invalidate stale approvals. `PolicyGate` is deliberately NOT
  re-invoked at this boundary because its `evaluate*` methods mint and reuse
  approvals as a side effect.
- **Approval:** `ApprovalStore.consumeApproved`, the one atomic single-use
  claim. The record must be `approved`, unexpired per `approvalExpiryState`,
  bound to this worker and policy revision, and match the exact invocation
  (`computeScopedMutationInvocation` → the shared `computeInvocationFingerprint`).
  A forged, pending, expired, revoked, already-consumed or differently-bound
  record is refused without spending a valid one.
- **Ownership:** `OwnershipRegistry` via `createLiveScopedLeaseVerifier` and the
  shared `scopeContains` matcher.

The experimental adapter also revalidates the grant immediately before helper dispatch. If the lease or policy lapses after the approval claim but before dispatch, it settles the attempt as failed and does not spawn the helper. This does **not** close the interval between dispatch and the kernel mutation: the native helper still needs a trusted, enforceable final-boundary authorization protocol.

The grant also exposes `revalidate()` and `settle()`. `revalidate()` re-checks
the lease and policy revision **after** the helper runs: authority that lapses
mid-write cannot be reported as `created`/`changed: true` — the adapter returns
`{ kind: "unverified", changed: true }` instead. This narrows, but does not
eliminate, the residual verification-to-spawn TOCTOU window; Node cannot hold
the kernel's checks across a process boundary, so a production integration needs
the fd-relative primitive to re-check authority itself before the final write.

Still NOT qualified: the native helper, executable packaging, cross-platform
backends and independent review are outstanding, and production service
selection remains unregistered and fail-closed (`createScopedMutationService`).
Adversarial coverage lives in
`tests/execution/filesystem/linux-scoped-mutation.test.ts` (forged/expired/
revoked/mismatched lease, policy revision mismatch, forged/pending/expired/
revoked/mismatched approval, changed bytes or target, single-use replay, mid-flight
lapse, and the opt-in real native helper).
