# GE-04-R2Q external qualification witness deployment — evidence (2026-11-08 UTC)

## Disposition
**REAL QUALIFICATION SERVICE DEPLOYED; GE-04 SECURITY HOLD ACTIVE.** Not a fully independent monotonic authority. No ALiX worker admission, privileged issuer activation, credential delivery, recovery clearance, external production access or commit/merge.

## Separate Proxmox Ubuntu VM
- IP: 10.1.1.13, hostname alix-ge04-qual-01, Ubuntu 26.04.1 LTS, kernel 7.0.0-43, machine-id 533c3234779b9b222ff089ebae0fae7b
- Distinct from microcloud3 KVM guest 192.168.122.21 (machine-id 5f5629a5123e4edd98d26033ea129bed)
- systemd unit: ge04-r2q-witness.service, enabled, running as nonlogin identity alixwitness
- server: /opt/alix-ge04-witness/witness.py, system Python 3.14.4 / cryptography 46.0.5
- port: 127.0.0.1:18841 ONLY, no LAN listener
- signing key: /var/lib/alix-ge04-witness/signing.key root:alixwitness 0640
- revision SQLite: /var/lib/alix-ge04-witness/head.sqlite root:alixwitness 0640, PRAGMA synchronous=FULL, BEGIN IMMEDIATE on local privileged revisions
- public key: /etc/alix-ge04-witness/public-key.hex, qualification public key SHA-256 provenance *not independently anchored*
- network API: GET /health and POST /challenge (read-only). No network mutation API. No tokens/credentials delivered.
- synthetic qualification head: revision 1; policy digest 711c4212e79e2c4c102dae3481845adf974ee65cfaca5fe9465e60bf5462f359; checkpoint digest 2f705f5bd3dd5c73539cd22bf833ef8ee6aa5eb3a86fd3a4fe68cf74b6e98bc2.

## Tests actually executed
- Python R2Q focused 12/12 PASS, GE-04 R2G-R2Q 124/124 PASS
- Vitest R2A-R2F/R1B1 35/35 PASS
- pnpm typecheck PASS
- SSH port-forward cross-host challenge from ideapad to Ubuntu witness: Ed25519 signature verified with existing R2P verifier, fresh nonce matched, revision/head matched, repeat checked against a different nonce rejected. Result remained status=blocked, witnessAuthorityQualified=false, rollbackResistant=false.
- Root CLI initialized revision 1; duplicate revision 1 and skipped revision 3 denied.
- Service UID could not invoke root-only mutation; files owned by root and group-readable by alixwitness.
- service restart retained revision 1 and allowed health response.
- deliberate systemd stop caused HTTP connection rejection; service restart restored active state and revision 1.
- no Proxmox snapshot rollback was tested; no external monotonic floor is active.

## Anti-fragmentation
Existing ALiX governance, supervisor, scheduler, approval and recovery ledger modules were not modified or bypassed. New scripts are qualification tools only. Systemd witness is an external service, not a competing ALiX control plane. Repository changes remain local and uncommitted.

Local files:
- scripts/ge04-r2q-witness-service.py
- scripts/ge04-r2q-witness.service
- scripts/ge04-r2q-cross-host-probe.py
- tests/agents/test_ge04_r2q_witness_service.py
- docs/ge04-r2q-qualification-witness-deployment.md

## Remaining security blockers
- Proxmox administrator can rollback full VM snapshot of both private signing key and SQLite head. Not rollback resistant.
- Witness public key retrieved via SSH from witness host, not pinned by independent issuer. Operator and service management not administratively independent yet.
- Online service signs arbitrary valid nonce and claimed boot ID; verifier must own and persist challenges, not rely on server for anti-replay.
- NTP reports unsynchronized, so no time freshness proof.
- The current test head is synthetic and not tied to a real governance policy, issuer custody, cgroup, or pidfd.
- Must test crash/recovery, concurrent writers, key rotation, storage corruption, snapshot restoration against separately trusted floor, auth transport before LAN exposure, and independent administrator/failure domain.
- Security hold must remain active until independent review and explicit operator approval.
