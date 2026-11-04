# GE-04 SUP-05: Signed claim matching experiment

**SECURITY HOLD — not admission, authorization, execution, or a terminal receipt.**

The standalone `signed-authority-claim.py` experiment verifies an Ed25519 claim and compares its signed attempt, approval, lease, worker, policy revision, invocation digest, and owned path to the provided expected values. It rejects malformed claims, duplicate keys, expired windows, substituted signatures, and revoked status. The only matching result is `TEST_MATCH_UNTRUSTED`.

The caller supplies the verification key pin, expected values, clock, and revocation status. These are fixture inputs, not authenticated coordinator state. A valid signed claim can be replayed and the matcher does not consume an approval. No shared revocation fence, protected nonce registry, coordinator-authenticated channel, or durable receipt is present. The test-only matcher cannot launch a child or authorize mutation.

The regression covers positive fixture matching and adversarial negative cases and runs in the GE-04 CI lane. Production `UnavailableScopedMutationService` stays unchanged. PR #1039 remains unmerged.
