# GE-04-R2S — Protected Anchor Protocol Qualification (2026-11-08)

**Status:** Protocol-only qualification. **GE-04 SECURITY HOLD ACTIVE**. No independent anchor, HSM or network commit service has been provisioned.
**Architecture:** [ADR-0018](../../../architecture/adrs/ADR-0018-independent-trust-service.md).
**Contract:** [Independent trust service](../../../security/ge04-trust-service-contract.md).
**Threat model:** [Trust service](../../../security/ge04-trust-service-threat-model.md).

## Implemented

- `scripts/ge04-r2s-anchor-protocol.py`: strict `ge04-r2s-anchor-v1` checkpoint head with `anchorId`, `epoch`, positive sequence `revision`, policy/checkpoint SHA-256, signer-key SHA-256 and predecessor head digest.
- The canonical signed message is Ed25519 over `ALIX-GE04-R2S-ANCHOR-V1\0 || canonical(head)`, making signature payloads domain-separated from prior R2P witness receipts.
- `verify_envelope` checks the pinned Ed25519 key, exact schema, signature and expected anchor ID/epoch. A signed head is **cryptographic evidence**, not proof of independent custody.
- `assess_chain` requires consecutive signed heads and matching predecessor digests, beginning from a separately supplied expected revision+head digest. Empty history, stale/replayed records, revision gaps, invalid predecessor, changed epoch, invalid signatures and forked views all return `blocked`.
- `QualificationCompareStore` is a process-local thread-safe simulation of expected-revision CAS. It requires explicitly asserted `committer` role and a publisher allowlist, rejects unauthorized/stale/forked/gap/epoch/key transitions, and models a committed-but-unacknowledged operation by reporting **blocked / outcome unknown**. All outcomes contain `authorizationGranted:false`.
- Tests in `tests/agents/test_ge04_r2s_anchor_protocol.py` run 64 concurrent proposals and verify one simulator winner, lost-acknowledgment replay denial, predecessor integrity and negative cryptographic cases.

## Explicitly not achieved

1. No separately administered trusted monotonic counter or checkpoint register. The supplied `trusted_floor` is a **caller-provided test fixture**, just as the R2R source was. A compromised caller can replace or revert it.
2. The `asserted_role` and publisher allowlist are simulator inputs, **not authenticated network identities**, signed publisher endorsements or an operator-approved policy publication.
3. The process-local memory store is not durable, fault-tolerant, independently rollback-resistant, globally serialized, or safe against service-restart crashes. The test only verifies in-process thread exclusion.
4. A signed history is insufficient to prove global non-equivocation unless an independently monitored protected anchor commits head identity. Same-authority signature compromise or snapshot rollback can still forge a consistent alternative history.
5. This module does **not** open a socket, make a durable write, modify the Ubuntu witness VM, change ALiX governance, approve recovery or grant a credential-bearing worker.
6. No key rotation/revocation, persisted idempotency state, mTLS publisher/committer protocol, active signer authorization, independent administrator ceremony or real Proxmox snapshot recovery is qualified.

## Required next implementation gate

Introduce an independently administered monotonic backend with a **durable atomic compare-and-advance** covering both revision and checkpoint digest. Provision anchor signing and client authentication independently of the witness guest. Require authenticated publisher+committer separation, durable idempotency receipts, nonce custody, log consistency monitoring, and destructive restart/partition/snapshot/split-view qualification. Re-read the external protected head after unknown commit outcomes; never infer success or allow protected worker admission.

**Disposition:** Qualification tests may pass while witness authority remains unqualified and GE-04 SECURITY HOLD remains in force.
