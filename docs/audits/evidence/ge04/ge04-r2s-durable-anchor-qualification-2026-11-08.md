# GE-04-R2S — Durable SQLite Anchor Qualification (2026-11-08)

**Disposition:** Qualification-only, not a protected independent monotonic anchor. **GE-04 SECURITY HOLD ACTIVE.**

**Design:** [ADR-0018](../../../architecture/adrs/ADR-0018-independent-trust-service.md), [trust contract](../../../security/ge04-trust-service-contract.md), [R2S anchor protocol](ge04-r2s-anchor-protocol-qualification-2026-11-08.md).

## Implementation

- `scripts/ge04-r2s-durable-anchor-store.py`: separate local SQLite qualification store using `BEGIN IMMEDIATE`, FULL synchronization and rollback journaling. Stores a fixed `(anchorId, epoch, signerKeySha256)` identity, exact digest-bound checkpoint heads and atomic idempotency request records.
- Compare-and-advance requires exact prior revision+head digest, next consecutive revision and matching epoch/signer identity. Request IDs are bound to the entire canonical proposal and publisher string; retries with the same ID+payload return **previously recorded, not a new grant**. Reusing an ID with a different proposal is denied.
- Lost-acknowledgment injection commits then returns blocked/ambiguous. Restart can read the committed revision and an identical request observes its prior record; a new request with stale expectation is rejected.
- Read returns `rollbackResistant:false` and `authorizationGranted:false`; commit never returns authorization.
- Strict denial of mismatched provisioned identity, schema mismatch, malformed heads, invalid request IDs, corrupted rows, stale/forked revisions and direct symlink DB paths.
- `tests/agents/test_ge04_r2s_durable_anchor_store.py` exercises 64 simultaneous thread proposals, 12 competing processes with the same idempotency token, restart/replay, lost response, corruption and snapshot restore.

## Deliberate negative result

A test copies the database before a revision advance, advances to revision 1, then restores the old SQLite file. The new store reads revision **0**. This deliberately proves **SQLite durability is not independent rollback resistance**. It is not a reason to relax the security hold.

## Unqualified / must not deploy

1. `asserted_role`, publisher and publisher allowlist are **caller-supplied fixture inputs**, not authenticated principals. The module exposes no network endpoint and may not be used as an ALiX authorization service.
2. No independently administered operator domain, hardware monotonic root, external checkpoint monitor, non-exportable signer or independently pinned trust bootstrap exists. Guest/host root can replace SQLite files and restore snapshots; direct-path symlink rejection is not descriptor-rooted DB custody.
3. SQLite's FULL synchronous commit is useful for ordinary filesystem crashes but does not guarantee power-loss durability on every storage/controller and cannot protect against arbitrary storage rollback or filesystem compromise. Multi-process locking here assumes one coherent local filesystem; no distributed consensus or cross-node isolation is qualified.
4. A root/admin can edit or roll back local SQLite rows, WAL/journal controls or identity metadata; this test does not prove independently protected key provenance, hardware-backed attestation or fork consistency.
5. No mTLS committer binding, publisher approval proof, key rotation/revocation, independent role provisioning, durable external audit, signed request authentication, or production recovery adapter is included.
6. Crash injection is limited to simulated lost acknowledgments and restart; destructive kill/power-loss, malformed SQLite pages, real Proxmox snapshot rollback and cross-host split-view remain open qualification gates.

**Next:** provision an independently governed, rollback-resistant counter *and checkpoint digest* under a separate administrative domain, authenticated publisher/committer service identities, then run real crash/restore/partition tests. A simple external SQLite server is not sufficient proof.

No production VM changes, supervisor authorization or GE-04 hold release.
