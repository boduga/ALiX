# GE-04-R2S — Offline Enrollment Evidence Qualification (2026-11-08)

**Status:** Qualification-only public enrollment verifier; **NO OPERATOR CEREMONY EXECUTED**.
**Disposition:** GE-04 SECURITY HOLD ACTIVE.

Related: [ADR-0018](../../../architecture/adrs/ADR-0018-independent-trust-service.md), [trust-service contract](../../../security/ge04-trust-service-contract.md), [durable anchor negative qualification](ge04-r2s-durable-anchor-qualification-2026-11-08.md).

## Implemented verification boundary

`scripts/ge04-r2s-offline-enrollment.py` verifies a strict, public-only `ge04-r2s-enrollment-v1` claim containing:

- Exact service ID, anchor ID and epoch.
- Anchor Ed25519 signing public key and witness signing-key SHA-256 identifier.
- Exact independently referenced floor `(revision, headSha256)`, including protected checkpoint identity rather than a naked counter.
- Three distinct *claimed* operator IDs (anchor administrator, witness administrator, security reviewer).
- Two detached Ed25519 attestations, one each for `anchor-operator` and `security-reviewer`, signed over `ALIX-GE04-R2S-ENROLLMENT-V1\0 || canonical(claim)`.
- Reviewer public keys supplied via `pinned_reviewer_keys`, which **must be pinned independently of the enrollment envelope**; key presence in a repository or a service reply is not an authenticated root.
- Strict JSON parser rejects duplicate field names, non-finite values, oversized input and invalid schema.

The verifier rejects identity/epoch/floor disagreement, missing or duplicate signatures, substitution of a reviewer key, reused public keys, malformed claims, changed public-key/checkpoint fields, colliding operator names and unsigned mutations. **All outcomes remain `status:blocked`, `authorizationGranted:false`, `rollbackResistant:false` and `independentAdministrationQualified:false`.**

## Operator ceremony still required — NOT performed

1. An independently authorized owner defines separate anchor, witness and security-reviewer administrators and records actual access credentials/snapshot administrators. Merely naming three different operators does not prove separation.
2. Establish an out-of-band source of truth for **both reviewer public keys** (with fingerprints, expiry, revocation and key rotation procedures); do not bootstrap from the same envelope or from ALiX's repo.
3. Provision the anchor signing key outside the witness guest and worker/ALiX administrative domains, preferably non-exportable in a supported security boundary. Publish its public key and provide operator-signed provenance.
4. Provision the monotonic revision/checkpoint floor in a separately controlled, rollback-resistant service or device. Prove that a guest or Proxmox administrator cannot roll back its storage, signer or trust pins.
5. Only after independent approval and physical/administrative checks, sign the exact public enrollment claim with two distinct reviewer keys. Retain separately controlled audit evidence of signing ceremony, hardware key provenance, key IDs, and protected floor.
6. Fail closed on revoked/expired keys, missing operator approval, epoch migration without continuity, signer compromise, unavailable counter, conflicting floor or snapshot rollback.
7. Perform destructive cross-host snapshot, compromise, partition and restart tests. Record independent security review and governance release approval **separately**.

## Tests

`tests/agents/test_ge04_r2s_offline_enrollment.py` uses ephemeral in-memory test keys; **no production private key generated, stored, transmitted, or committed**. Tests cover accepted *cryptographic consistency only*, key/floor/epoch tampering, missing/duplicate/unknown reviewer signatures, key reuse, operator-name collisions, malformed and duplicate-key JSON and non-finite values.

This code does not write files, activate a server, grant worker privileges, establish rollback resistance or validate the identities/authorizations of real humans. **The existence of signatures cannot itself establish separate administrative domains.**

**Next gate:** independent operator enrollment and a protected floor must be demonstrably deployed and verified. GE-04 SECURITY HOLD remains active.
