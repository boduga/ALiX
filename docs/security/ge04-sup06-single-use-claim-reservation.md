# GE-04 SUP-06 — Single-use signed claim reservation experiment

**SECURITY HOLD. Test-only reservation, not authorization, admission, execution or a terminal receipt.**

`experiments/ge04/single-use-claim-reservation.py` composes the SUP-05 signed-envelope matcher with a protected-directory, nonce-derived `O_CREAT | O_EXCL` reservation. The record is attempt-bound through the SHA-256 digest of the exact signed bytes; file and parent directory are fsynced. Two processes trying the same signed nonce cannot both reserve it. A conflicting signed attempt with the same nonce cannot obtain an additional reservation. A durable record is classified only as `RESERVED_UNTRUSTED`; malformed, missing, torn or tampered records classify `UNCERTAIN`, never as an execution success.

`test-single-use-claim-reservation-root.py` tests eight competing processes, replay, nonce collision, expired and revoked claims, simulated supervisor exit immediately after exclusive creation, and tamper quarantine. It requires root to exercise an owner-only evidence directory under `/run` and is registered in the GE-04 Linux CI lane.

**Unresolved:** The record proves no coordinator authentication, secure signing-key bootstrap, protected signing service, clock authenticity, approval-store consumption, monotonic policy floor, authoritative revocation, cross-process mutation/revocation fence, helper identity, terminal receipt, or durable power-loss correctness. The signing key pin, expected binding, clock and revocation flag remain caller-provided test inputs. Abrupt exit after file creation but before fsync is deliberately treated as uncertain and blocks reuse; this is not power-loss qualification. Root-owned filesystem files cannot be considered protected against a same-UID privileged adversary. No helper is spawned; the production `UnavailableScopedMutationService` remains unchanged. Do not merge PR #1039.

**Next:** Authenticate coordinator state independently and synchronize policy publication, lease revocation and final fd-relative mutation under one cross-process linearization boundary. Do not promote `TEST_RESERVED_UNTRUSTED` to an authority grant.
