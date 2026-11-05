# GE-04 — Fixed-request journal integration checkpoint

**SECURITY HOLD — EXPERIMENTAL ONLY. PR #1039 must remain open and unmerged. Production mutation execution remains disabled.**

The fixed-operation composite fixture now records four create-once, file-and-directory-fsynced stages under the existing SUP-25 cooperative lock:

1. `PREPARED`: after authority state durably consumes the single approval, before invoking the native fixture.
2. `OBSERVED`: after the fixed test native operation and persisted MAC-bound observation.
3. `SETTLED`: after authority state clears `inFlight`.
4. `SIGNED`: after the existing Ed25519 fixture signature is persisted.

`supervisor-lifecycle-journal.py` binds all four entries to a deterministic digest over the **fixed test** attempt, approval/lease/policy, exact leaf, content hash, pinned directory device/inode and create operation. It requires a contiguous stage sequence and a SHA-256 link to the exact preceding record bytes. Each record is create-once (`O_EXCL|O_NOFOLLOW`) and ownership/permissions/length/schema are validated on reads. The composed recovery entrypoint checks the full journal and state while holding the same cooperative lock, then re-inspects the pinned effect and verifies the old signed fixture observation. Incomplete or contradictory evidence gives `UNCERTAIN_NO_REPLAY`, never an automatic retry.

A failed journal write after consumption is deliberately ambiguous: recovery cannot replay the approval. Likewise, signed evidence without its final durable journal stage is not an accepted composite fixture outcome. The standalone pure recovery classifier introduced earlier is **not** yet the canonical persisted schema for this composite fixture; no production-facing receipt contract is established.

## Negative tests

- Out-of-order and duplicate stages, wrong request fingerprint, malformed/duplicate fields, unexpected types, symlinks and unsafe permissions are rejected or uncertain.
- Missing intermediate stages, stage alteration and partial rollback of journal tail do not produce accepted evidence.
- The privileged composed test checks that a **still-valid** Ed25519 signed fixture is rejected after journal tampering or removal.
- Existing crash stages remain: after prepare, native operation, observation, settlement and signature. A replay is forbidden at each.

## What is NOT proved

- **A hash chain is not a rollback-proof monotonic floor.** An actor who can replace the entire set of protected journal/state/key files can reconstruct a self-consistent older generation. An independent durable high-water mark, signed generation/sequence with separately enforced custody, restoration policy and destructive-fault tests remain necessary.
- The journal does not bind a trusted executable/release hash, trusted syscall-adjacent time, coordinator transport/session identity or a real approval/ownership authority. The test clock, binary and root fixture signer are all still under fixture control.
- The four fsync-delimited stages are not a single atomic filesystem transaction, and SIGKILL test checkpoints do not prove hardware power-cut durability.
- Neither signed snapshots nor a complete journal prove that the independently observed kernel effect is irrevocably durable or untamperable.
- Root-equivalent/same-UID state and signer fabrication remains a known security blocker. Existing adversarial reproductions must remain enabled.
- A completed outcome remains `GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED`; no `VERIFIED_TERMINAL` or production success is authorized.

**Next gate:** define and implement an independently protected generation floor and trusted installation identity; then test concurrent revocation/expiry at final admission, whole-tree rollback and restart/power-loss fault cases before independent security review.
