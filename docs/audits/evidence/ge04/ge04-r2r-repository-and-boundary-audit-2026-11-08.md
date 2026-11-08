# GE-04-R2R — Repository consolidation and witness boundary audit

**Security disposition:** GE-04 SECURITY HOLD ACTIVE. **No production wiring, privilege grant, or recovery clearance.**

## Repository / evidence status

- Existing development branch: feat/ge04-r1b1-supervisor-contract.
- Pre-audit worktree contained 42 untracked entries, including R2A–R2Q qualification sources, tests, evidence, and generated Python caches. All remained uncommitted; unrelated untracked files were not removed.
- The 14 prior GE-04 qualification reports and provenance manifest copies are canonically archived in docs/audits/evidence/ge04/qualification-2026-11-08/ with original SHA-256 manifests. microcloud3 is now a disposable test rig, not an evidence repository.
- R2G–R2O copies from microcloud3 matched the ALiX scripts byte-for-byte. Do not import them again.
- Witness remains running on the dedicated Proxmox Ubuntu VM 10.1.1.13, isolated as a qualification-only root-controlled revision store plus nonprivileged signing daemon.

## Architecture boundary finding — two distinct revision meanings

1. Existing src/governance/policy/policy-revision.ts computes a canonical SHA-256 fingerprint of policy-relevant ALiX permissions configuration. That fingerprint is the established approval-policy revision identifier and MUST remain canonical for existing governance decisions.
2. R2N–R2Q use a strictly increasing positive integer for witness sequencing. That number is NOT ALiX's policy fingerprint and MUST NOT replace it.
3. The correct integration is a single witness evidence adapter behind the existing governance/recovery seam. It must bind (a) witnessed integer sequence, (b) exact established policy fingerprint, (c) independent checkpoint/custody digest, and (d) worker/run identity from existing authorities. It must not compute or approve policy by itself.
4. src/agents/worker-supervisor-recovery-ledger.ts is the existing single durable recovery record. Do not create a witness recovery ledger, duplicate supervisor, second approval store or second policy engine.
5. R2G–R2Q Python scripts remain **qualification implementations**, not production subsystem entrypoints. The witness is an external infra service. No change has been made to coordination, supervisor or policy-gate authorization.

## R2R local key pinning: limited progress

- docs/audits/evidence/ge04/r2r-qualification-witness-pin.json retains the witnessed public key and exact synthetic qualification head as an operator-unverified snapshot. The record is explicitly NOT an independently authenticated publisher key or trusted minimum revision.
- scripts/ge04-r2q-cross-host-probe.py now reads the expected key, policy digest, checkpoint digest, revision and witness ID from the local snapshot rather than from a server response. The SSH tunnel remains loopback-only.
- The response cannot substitute its own key, revision or digest as the expected value.
- The pin is unreviewed because its initial provenance was the witness VM accessed over SSH. Repository persistence by itself does not make its author independent.
- Do not install this JSON as a production security configuration or enable worker admission on its basis. An authorized operator must verify key provenance out of band, and an independent rollback-resistant revision floor must be provisioned.

## Blockers before R2R closeout

- Independently authenticated key-pinning ceremony and authorized key-rotation strategy.
- Actual protected minimum revision in a separate administrative domain: a VM-host snapshot of both SQLite state and key remains an undetectable rollback if the verifier trusts only the VM.
- Durable single-use verifier-owned challenge state and replay rejection across verifier restart.
- Fail-closed real cross-host concurrent writes, interruption during transaction, unsigned/mismatched responses, service outage, key rotation, snapshot restore, independent host administrative compromise.
- Supervisor pidfd/cgroup hostile descendant containment and privileged issuer provenance.
- Explicit architecture review and security hold release decision (not inferred from passing tests).

## Acceptance and source-of-truth rules

No additional state authority; no new import cycles; no unsigned trust downgrade; no key material in Git; no remote evidence repository; no network-facing update API; never treat a signed receipt as sufficient approval. ALiX is the source of truth for qualification records, while the witness VM owns only its isolated runtime data.
