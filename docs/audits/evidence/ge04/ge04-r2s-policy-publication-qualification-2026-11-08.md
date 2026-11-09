# GE-04-R2S — Signed Policy-Publication Binding Qualification (2026-11-08)

**Status:** Qualification-only, **GE-04 SECURITY HOLD ACTIVE**. No live ALiX policy issuer, independent protected anchor, credential-bearing worker, or production service modified.

**Related contracts:** [GE-04 trust-service contract](../../../security/ge04-trust-service-contract.md), [dual-role mTLS evidence](ge04-r2s-mtls-dual-role-qualification-2026-11-08.md), [durable endorsement custody](ge04-r2s-durable-endorsement-qualification-2026-11-08.md), [anchor protocol](ge04-r2s-anchor-protocol-qualification-2026-11-08.md).

## What the new qualification seam verifies

`scripts/ge04-r2s-policy-publication-binding.py` accepts bounded public policy bytes, a signed publication envelope, a candidate anchor checkpoint head, and the two-role proposal request. It:

- Strictly parses both JSON inputs, rejecting duplicate keys, unknown envelope/claim fields, NaN/Infinity, and oversized documents; computes SHA-256 over canonical policy JSON.
- Checks that the policy's integer `policyRevision` equals the signed publication's revision, **without claiming** the revision has been validated against the native ALiX governance publication authority. Prior GE-04-R2N fixtures use string revisions; this qualification schema is intentionally distinct and **not** wire-compatible with R2N.
- Verifies a domain-separated Ed25519 signature over the publication claim using a **caller-supplied pinned policy-authority public key**. The claim identifies the expected authority and publisher principal, but their control and approval are **not** independently authenticated.
- Binds the signed claim to exact anchor ID/epoch, request ID, policy revision/digest, checkpoint digest, proposed head digest, and prior revision/head SHA-256.
- Checks the candidate head's exact canonical digest, next revision, predecessor, policy/checkpoint digest and service identity, then checks exact parsed two-role request fields against the signed claim and head digest.
- **Returns `status:blocked`, `authorizationGranted:false`, `policyAuthorityQualified:false`, and `rollbackResistant:false` for all inputs**, even when `publicationConsistent:true`.

`tests/agents/test_ge04_r2s_policy_publication_binding.py` generates ephemeral Ed25519 test keys. It covers valid cryptographic linkage, policy mutation, changed policy revision, authority/publisher substitution, invalid signatures, key substitution, changed checkpoint/head digest, epoch and predecessor mismatch, stale-floor replay, duplicate JSON fields, missing/invalid input, nonfinite numbers and malformed revision types.

## What is explicitly not proved

- **No real ALiX policy approval or governance-issued signature.** The test's key and claimed publisher identity are fixture inputs, not a production canonical governance publication record. A signed arbitrary policy document is not policy approval.
- **No independent trust-root provenance.** Caller-supplied key pins and floor can be rolled back together; neither external operator enrollment, HSM custody nor protected monotonic counter/checkpoint identity is established.
- **No replay consumption.** The verifier is read-only; it is not integrated with a durable single-use challenge/endorsement record. The existing SQLite custody is rollbackable.
- **No authorization path.** The verifier does not call the anchor commit routine, policy gate, approvals, scheduler, recovery, or worker supervisor. A matching digest is evidence consistency only.
- **No cross-host qualification.** Real fault tests, adversarial witness-VM snapshots, independently administered publisher and committer cert enrollment, revocation, and external audit remain outstanding.

**Next gate:** define a typed real ALiX governance publication contract, bind its authenticated issuer/policy revision to independently provisioned role and signer identities, and validate an external rollback-resistant anchor under distinct administrator control. No automatic GE-04 hold release.
