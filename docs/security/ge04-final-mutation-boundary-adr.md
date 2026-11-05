# GE-04 — Final OS mutation boundary: security design and fail-closed protocol contract

**Status: DESIGN + INERT MODEL ONLY / GE-04 SECURITY HOLD.** This document does not authorize a real filesystem mutation, a backend registration, or merging PR #1039. Independent review is required.

## Decision

**Use a supervisor-owned authorization and mutation linearization domain; do not rely on the coordinator's pre-spawn verification.** The production `createScopedMutationService()` must continue returning `UnavailableScopedMutationService` on every platform. The trusted path, if implemented in a future branch, must be a *single privileged owner of decision, held directory FDs, mutation operation and durable outcome journal*. All policy publication and explicit lease revocation must go through the same serialization domain or the guarantee is invalid.

Existing evidence: `src/execution/filesystem/scoped-mutation-authorization.ts` rechecks approval, policy and ownership but cannot exclude a change between helper dispatch and the kernel effect. `experiments/ge04/scoped-owned-create.c` proves some `openat2` containment properties but does not make the helper independently authorized. SUP-25's fixture-only cooperative lock and SUP-26's coordinator-provisioned HMAC marker do not establish a production boundary; SUP-27 reproduces same-UID state and receipt forgery. The real systemd inert experiment passed in CI; it still does not perform an authorized filesystem effect.

## Required trust and data contract

The unprivileged coordinator is an untrusted **requester**, not an authority issuer. A request must identify immutable `attemptId`, `approvalId`, `workerId`, `leaseId`, `policyRevision`, `scopeId`, an operation enum `create|replace|delete`, canonical relative path, exact operation/preimage digest and byte length, and a fresh session/transport binding. **None of those caller-supplied fields is evidence of authority.**

The independent supervisor must derive/reload under its protected lock: approval record and exact invocation binding, approval single-use state, ownership lease and scope, policy revision and effective change order, expiration according to a documented trusted-clock model, protected-path rules, immutable file operation bytes, and the authenticated caller's permitted role. It must reject any mismatch **before** durable prepare; approvals cannot be spent without a verifiable exact request. No raw GO command, argv token, inherited fd or user-provided absolute path may elevate authority.

The root/workspace and owned-scope directories must be pinned with verified FD-relative traversal, rejecting symlinks, magic links, mount escapes (where the defined scope requires it), and untrusted ancestors. Resolve a leaf beneath the pinned parent with `openat2` and required resolution flags or equivalent audited fd-relative operations. The actual kernel operation must use the same pinned directory handles and validated leaf identity; no re-resolution of a pathname between authorization and effect.

## Required linearization and crash semantics

1. **Enroll:** OS-managed trusted service proves installation identity and protected config/state custody; a per-message pidfd kernel credential observation is necessary but not sufficient as a role trust anchor. Reject stale, transferred, or malformed sessions.
2. **Pin and compare:** supervisor pins directory handles and validates target, preimage and operation digest. Parent swaps/renames must not redirect the operation out of authorized FDs. Reject cross-device and mount cases outside the declared policy.
3. **Serialize final admission:** acquire a supervisor-owned, crash-aware exclusion mechanism shared with *every* policy publication and lease revocation. Reload live authority, check lease expiry at this final boundary, check exact request, durably consume one approval and persist PREPARED/attempt identity **before** any effect.
4. **Perform kernel effect while excluded:** use `openat2`/fd-relative `openat`, `renameat`, `unlinkat`, `mkdirat` as appropriate, and fsync the file, containing directory and relevant rename parents under a defined durability model. A crash after PREPARED can mean that the effect occurred. Never assume the absence of a receipt is failure.
5. **Settle and release:** persist a supervisor-authenticated terminal **effect receipt** bound to operation digest, immutable resource identity and journal sequence, or mark UNCERTAIN if any proof is missing. Release exclusion in documented order. A valid *inert* observation from SUP-26 cannot certify a real effect. After supervisor death, reconcile under the same protected authority without replaying the consumed approval.
6. **Expiry/revocation rule:** an explicit revocation that linearizes first prohibits admission; an already prepared/in-flight effect owns the exclusion until terminal or crash-uncertain classification. If expiry occurs **after** final admissibility but **before** actual syscall, the design must explicitly choose either a recheck at the syscall-adjacent boundary or a defensible in-flight lease rule; **the current model does not prove wall-clock expiry until effect**. Policy changes cannot bypass the supervisor's publication lock.

**No guarantee of atomic multi-file patch transactions** is implied by this single-operation contract. Shell command execution and all unqualified platforms continue to deny governed writes. A direct ungoverned tool route must not be hidden behind this API and called safe.

## Test-only executable model

`experiments/ge04/final-boundary-protocol-model.py` and `test-final-boundary-protocol-model.py` model event ordering without any OS operation or authorization token. The tests require:
- revoked/policy-stale/expired or wrong approval, lease, worker, digest and scope to deny at final admission;
- a prepared operation to exclude explicit revocation until inert settlement;
- wrong pinned-scope or operation digest to deny simulated effect;
- durable PREPARED before inert observation, and an observation before terminal marker;
- crash at either prepare or observation to be UNCERTAIN with no replay;
- an approval to remain single-use even if the attempted request ID changes.

Passing this model is **not** evidence of cross-process synchronization, kernel write confinement, trusted time, authentic receipts or power-failure safety. It codifies required *ordering* only.

## Release blocker and independent verification checklist

- No independently proven production supervisor-managed approval/policy/lease authority store.
- No kernel operation and mutation authorization under the same enforceable exclusion domain.
- No atomic binding of actual effect, pinned file identity and authenticated terminal receipt.
- No fail-closed reconciliation after SIGKILL, storage interruption, rollback or host power cut.
- No red-team coverage for ancestor/scope/parent swaps, hard links, bind mounts, open descriptors, policy race, lease expiry at syscall, simultaneous revokers, failed fsync, and old delegated stream descriptors.
- No independent reviewer signoff of release binary, packaging, privileged install/update/recovery, sandbox and service identity.
- Production backend remains unavailable for `linux`, `darwin` and `win32`; no mutation call site is re-routed.

**Exit condition:** separately prove and review the above controls against the exact implementation/commit, obtain explicit security signoff, and only then reconsider GE-04. No passing CI job automatically lifts this hold.
