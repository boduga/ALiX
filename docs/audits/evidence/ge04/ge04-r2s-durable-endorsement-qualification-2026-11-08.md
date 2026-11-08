# GE-04-R2S — Durable mTLS Endorsement Custody Qualification (2026-11-08)

**Status:** Qualification-only evidence, **GE-04 SECURITY HOLD ACTIVE**. No privilege grants, protected anchor writes, externally administered trust, or live witness changes.

**Parents:** [R2S mTLS role binding](ge04-r2s-mtls-dual-role-qualification-2026-11-08.md), [durable anchor CAS negative qualification](ge04-r2s-durable-anchor-qualification-2026-11-08.md), [trust service contract](../../../security/ge04-trust-service-contract.md).

## Added and tested

- `scripts/ge04-r2s-durable-endorsement-custody.py` persists exactly one publisher observation and one committer attempt per request ID, using a SQLite transaction with `BEGIN IMMEDIATE`, `synchronous=FULL`, and rollback journaling. State and identity are bound to exact `anchorId` and `epoch` at initialization.
- Publisher/committer principal and role are derived from the **server-side TLS-verified SSLSocket leaf certificate**, resolved through the supplied pinned fingerprint map. Request-body role assertions cannot replace certificates. The SQL record captures the publisher certificate fingerprint, principal, exact raw proposal bytes, and SHA-256.
- An eligible committer must have a **distinct principal and certificate fingerprint** and endorse identical raw request bytes. Endorsement attempts transition `pending -> spent` atomically, including mismatched bytes or identity. A second attempt, replay, and reused publisher ID are blocked.
- A simulated lost acknowledgment occurs *after* committed spent-state persistence. On restart, `inspect` observes the spent record without granting permission; repeated endorsement remains blocked.
- Missing SQLite state never silently reinitializes during a normal restart. First-time provisioning must be requested explicitly, and existing storage cannot be re-provisioned. Epoch mismatch, database symlink and corrupted metadata block.
- `tests/agents/test_ge04_r2s_durable_endorsement_custody.py` exercises real TLS 1.3 on **test fixture endpoints only**, missing/unknown-role cases inherited from existing mTLS role tests, restart, replay, 16 simultaneous committer requests, tampered request bytes, simulated lost ack, missing/corrupted DB, explicit provisioning, and negative snapshot-rollback behavior.

## Known residual risks and security non-achievements

1. **Storage rollback remains possible.** A qualification test restores an earlier SQLite snapshot, demonstrating that the request ID can be reused after rollback. SQLite durability and `FULL` sync cannot provide an independent monotonic trust anchor.
2. Cert fingerprint/role mapping remains a caller-provided qualification input, **not** independently enrolled and revoked identities. Names and separate certificates alone do not prove separate operators.
3. The proposal digest is not tied to a separately verified ALiX policy revision or authorized checkpoint. A role-consistent proposal is **not** a sanctioned change.
4. The SQLite DB and certificate mapping are not protected against a compromised host administrator, mounted filesystem substitution, destructive power loss, or cross-host partition. Multi-process and network-adversarial qualification are future gates.
5. The module **does not import or call** the anchor mutator, does not open a network listener, and provides no policy/approval/worker grant API. The TLS listener in the tests is ephemeral, local, and fixture-only.
6. The implementation returns `status:"blocked"`, `authorizationGranted:false`, `rollbackResistant:false`, `independentAuthorityQualified:false` for all outcomes. `publisherObserved:true` or `rolesBound:true` only describe recorded qualification evidence.

**Next acceptance gate:** Independently managed external protected floor (counter + checkpoint digest), signed ALiX policy-publication approval, independently enrolled publisher and committer certificates, durable monotonic replay registry, and genuine cross-host crash/restore/partition/security-owner qualification. Until then **GE-04 SECURITY HOLD remains active**.
