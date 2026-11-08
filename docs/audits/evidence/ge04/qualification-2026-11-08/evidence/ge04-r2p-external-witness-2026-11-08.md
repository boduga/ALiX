# GE-04-R2P signed external-witness receipt — qualification evidence (2026-11-08)

## Security disposition
GE-04 SECURITY HOLD ACTIVE. No external monotonic witness deployed; no signing key provisioned; no production issuer activation, credential-bearing worker launch, custody release, recovery clearance, code commit, push or merge.

## Implementation (local ALiX worktree, uncommitted)
- scripts/ge04-r2p-external-witness-receipt.py
- tests/agents/test_ge04_r2p_external_witness_receipt.py
- docs/ge04-r2p-external-monotonic-witness.md

## Decision and host observations
Target is a separately administered, independently operated append-only monotonic revision witness signing canonical challenged receipts with Ed25519. Signed claims bind witnessId, verifier nonce, revision, publisher checkpoint digest, policy digest, and boot ID. Public key, minimum revision and nonce ownership must be independently trusted in production.
Host microcloud3 has no /dev/tpm devices, and libvirt XML of guest alix-ge04-qual-01 has no TPM device. Development workstation exposes /dev/tpm0 and /dev/tpmrm0 but these do not establish independent authority for the qualification VM. Dev workstation Python cryptography package 41.0.7 is available. No witness service, nonce store, TPM monotonic counter, external key manager or rollback-resistant revision state has been created.

## Verified local checks
- R2P focused Python 15/15 PASS, using synthetic ephemeral Ed25519 signing keys.
- R2G-R2P Python 112/112 PASS.
- R2A-R2F and R1B1 Vitest 35/35 PASS.
- pnpm typecheck PASS.
- The test verifies wrong key, tampered signature/content, replayed challenge, wrong witness, mismatched digests/boot, lower/future revision and malformed versions fail closed.
- Even with valid synthetic signature, status=blocked, witnessAuthorityQualified=false, rollbackResistant=false.
- No live external witness or guest receipt qualification was performed.

## Remaining gates
Actual separate administration/failure domain, protected witness private key and pinned public key provisioning, authenticated transport, server-side append-only revision enforcement, persistent one-time nonce tracking, independent minimum-revision authority, multi-host crash and snapshot rollback tests, split-brain conflict handling, live issuer/cgroup custody and hostile-worker containment. A signature from a synthetic key or a local witness file is not evidence of rollback resistance.

Next R2Q: independently operated witness service and challenge lifecycle qualification, without admitting workers.
