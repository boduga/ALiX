# GE-04-R2P — Independent monotonic witness qualification design

**Disposition:** SECURITY HOLD ACTIVE. Proposed target design and offline verification prototype only; no external witness deployed.

## Architecture decision

Select an independently administered append-only revision witness with an Ed25519 signing key whose private half never enters ALiX, its issuer, coordinator, worker, or their writable storage. Put the witness in a separate failure and administrative domain, not another process in the KVM guest.

The signed witness receipt binds schema, witness identity, a fresh 256-bit nonce, strictly increasing revision, publisher-checkpoint SHA-256, policy SHA-256 and target boot ID. The verifier must pin a public key from independently protected configuration and check a single-use verifier-owned challenge, exact head, current boot, and trusted minimum revision.

## Limitations and trust assumptions

- A valid digital signature proves the signer possessed the matching key, not that the witness is online, honest, independently administered, or monotonic.
- A caller-provided key, nonce, digest, UID or minimum revision is not proof of trusted origin.
- A local hash chain and checkpoint under one administrator remain vulnerable to coordinated rollback.
- The offline R2P verifier neither generates network challenges, persists single-use nonces, maintains a trusted revision floor, provisions keys, updates policy nor authorizes admission.
- All outcomes are blocked. Even matching signatures report witnessAuthorityQualified=false and rollbackResistant=false.
- Qualification host microcloud3 exposes no TPM devices and guest libvirt configuration exposes no TPM. A workstation TPM cannot by itself confer independent authority on the KVM environment.
- The external witness must reject lower revisions, refuse same-revision forks, preserve state across crash and snapshot restoration, and provide authenticated durable history.

## Next qualification gates

1. Establish witness ownership in a separate administrator and failure domain; document public-key pinning and rotations.
2. Deploy a durable witness with crash-safe monotonic state. Prove it rejects snapshot rollback, same-revision conflicts, replays and concurrent writers.
3. Add client-side securely generated, persisted single-use challenge tracking, authenticated transport, and a trusted minimum revision independent of worker/issuer state.
4. Exercise real cross-host tests for outage, key swap, revoked witness, restored snapshots, stale signatures, revision fork and concurrency.
5. Integrate only after independent issuer/policy custody, pidfd and cgroup containment, hostile-descendant proof and an explicit approval gate are qualified.

No security hold release, production credential delivery, worker admission, recovery clearance, merge or commit is authorized by this design.

---

## R2S architectural supersession (2026-11-08; proposed)

The statement above that no external witness was deployed describes **R2P at the time**. R2Q subsequently deployed a **qualification-only** signing service on the Ubuntu VM at 10.1.1.13. That service is not independently rollback-resistant or approved for production. See [R2Q deployment](ge04-r2q-qualification-witness-deployment.md).

The accepted *direction*, pending formal ADR/security approval, is a provider-independent authenticated **network trust service** with a separately protected revision/head anchor and an ALiX-governance-owned evidence verification seam. This amends the earlier R2P target design; it does not turn its offline verifier into a production protocol. See [ADR-0018](architecture/adrs/ADR-0018-independent-trust-service.md), [threat model](security/ge04-trust-service-threat-model.md), and [contract](security/ge04-trust-service-contract.md). No local client TPM is mandatory; no trust service response authorizes execution. **GE-04 SECURITY HOLD ACTIVE.**
