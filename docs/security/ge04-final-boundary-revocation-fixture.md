# GE-04 — Final-boundary timing and concurrent revocation checkpoint

**GE-04 SECURITY HOLD. EXPERIMENTAL FIXED NATIVE OPERATION ONLY. PR #1039 remains unmerged.**

This checkpoint extends `supervisor-composed-lifecycle-fixture.py` with a **separate, explicit test-clock sample** (`effect_now_ms`) after the durable PREPARED record and immediately before the fixed subprocess invocation. The sample is provided by the root test harness, **not by a trusted supervisor clock** and **not adjacent to the native syscall**. The harness also exposes test-only synchronization events for deliberately pausing the composed operation while the existing SUP-25 cooperative `flock` is held. These test hooks are not authorized runtime request fields.

## Required ordering demonstrated by the tests

1. **Expired before admission:** no effect, approval remains unconsumed.
2. **Expires after durable prepare but before subprocess:** no native effect is dispatched. The approval stays consumed and `inFlight` stays set. Recovery yields `UNCERTAIN_NO_REPLAY`, not a reusable approval.
3. **Explicit revocation linearizes before admission:** the request is denied without consumption or effect.
4. **Revocation attempts after durable prepare:** a separate revoker process waits on the same SUP-25 `flock` while the operator is paused at the test boundary. Once resumed, the fixed operation, durable observation, settlement, signature and anchor finish before the revocation transition can complete. After revocation, recovery does not treat the previous signed fixture as current success; it returns `UNCERTAIN_NO_REPLAY`.
5. **Crash checkpoints:** all existing stages continue to prohibit automatic replay.

The code checks expiry *after* preparing, with rejection that does **not** undo single-use consumption. A production trusted supervisor would need to sample a documented trusted clock at a closer native mutation boundary, and choose a precise lease rule for expiry after final admission. This checkpoint does not prove that wall-clock expiration cannot occur between Python's check, helper dispatch and `openat2`.

## Known weaknesses and next release blockers

- Root controls the test clock and can invoke the old lower-level signer. Same-UID/root forgery, cloned protected state and anchor replacement remain blocking.
- `flock` only serializes cooperative writers using the same lock. No independent systemd authority proves the coordinator cannot modify policy, approval, executable or evidence outside that lock.
- The test does not authenticate helper identity at the actual syscall, bind policy to the native code, enforce a syscall-adjacent expiry check, or integrate actual ownership/policy stores.
- The standalone test has scheduling-dependent assertions in addition to deterministic final-state checks; an observed PASS is a fixture serialization regression, not adversarial concurrency qualification.
- Production `UnavailableScopedMutationService` remains unchanged, and no experimental outcome is a trusted terminal receipt.

**Next gate:** independently installed, pinned supervisor binary and protected authority state; a native admission token or in-process syscall boundary that cannot be bypassed by child replacement; trusted clock semantics; policy publication and lease revocation in one enforceable authority domain; process/host-crash and same-UID/root adversarial review.
