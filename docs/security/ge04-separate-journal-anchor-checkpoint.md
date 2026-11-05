# GE-04 — Separate journal anchor checkpoint (experimental, security hold)

**HOLD. PR #1039 MUST REMAIN OPEN / UNMERGED. Production `UnavailableScopedMutationService` is unchanged.**

This checkpoint introduces `supervisor-lifecycle-anchor.py`, a **root-owned create-once external fixture checkpoint**, not an independently managed monotonic rollback floor. The composed fixed-operation fixture now writes its four fsynced lifecycle stages, verifies its contiguous request-bound SHA-256 chain, and publishes a separate create-once anchor containing `{version:1, sequence:4, requestDigest, chainDigest}`. The anchor is held in a distinct test directory (`0700`) and stored in a root-owned `0600` regular file via `O_EXCL|O_NOFOLLOW`, file fsync and directory fsync. Reads reject unsafe owner/mode/link count, malformed/duplicate keys, invalid sequence and hash mismatches.

Read-only composition recovery now requires **both** (a) the complete journal and (b) the anchored final chain digest, in addition to the previously required settled authority state, pinned effect observation and Ed25519 signature. If the anchor is missing, changed, or inconsistent, recovery is `UNCERTAIN_NO_REPLAY`; the fixture never automatically replays the consumed approval.

The privileged composition test includes a **self-consistent entire journal rewrite**: reserialize each record, recompute all previous-record links, verify the rewritten chain locally, then require recovery to reject it because the separately stored anchor no longer matches. The test also covers missing anchor, tampered journal, and a sixth crash checkpoint **after anchor persistence**. Crashes after signing but before anchoring remain uncertain. `test-supervisor-lifecycle-anchor-root.py` exercises create-once behavior, missing/mismatched anchors, duplicate JSON fields, file permissions, and symlink substitution.

## Exact limits

- This is **separate storage only**, not independent security custody. Root-equivalent fixture controllers can rewrite **both** journal and anchor, reset the entire fixture, or replace the executable/signing keys. Directory separation is not a trust root.
- Sequence `4` denotes the number of stages within **one fixed attempt**, not a durable monotonic generation across processes, installations, backups or host restarts. Never present it as global rollback protection.
- The anchor is published only after signing; a crash at any earlier stage yields uncertainty rather than proof of an absent kernel effect. Separate fsyncs do not provide a transaction or hardware power-cut guarantees.
- Paths, binary and test clock remain harness-controlled. The lower-level signer remains privileged-callable. Real approval and ownership stores, syscall-adjacent expiry/revocation, authenticated transport and trusted native executable provenance remain unresolved.
- A malicious coordinator cannot be declared excluded merely because these fixtures require root. SUP-27 same-owner and root-equivalent forgery reproductions remain active and **must not be reinterpreted as release success**.

## Next required architecture gate

Establish an **administrator-owned, independently installed supervisor service** with a trusted execution identity and independently provisioned nonrollback anchor (e.g. hardware-backed monotonic NV counter or an equivalent authenticated external store with atomic compare-and-advance). Define key rotation, backup/restore semantics, freshness checking and crash-coupled floor advancement; explicitly test a rollback of the **entire** journal, state, key and anchor set. Test concurrent revocation/policy updates and expiry at the final native effect boundary. Independent security signoff is still required.

**CI may validate only the experimental claim. No current test asserts a trusted terminal effect receipt.**
