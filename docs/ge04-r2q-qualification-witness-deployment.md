# GE-04-R2Q — Qualification witness deployment

**Status:** qualification witness deployed on Ubuntu VM at 10.1.1.13. **GE-04 SECURITY HOLD ACTIVE**.

## No-fragmentation boundary

This is one **external witness service** and one experimental verifier, not a new ALiX policy, worker, scheduler, approval, issuer, or recovery authority. No production ALiX service or governance contract was changed. Keep R2Q scripts in qualification/testing until the existing governance/recovery integration seam is verified.

## Service layout

- Systemd: ge04-r2q-witness.service
- Unix identity: alixwitness, no login shell
- Interpreter: Ubuntu system Python + cryptography
- Installation: /opt/alix-ge04-witness/witness.py
- Revision store: /var/lib/alix-ge04-witness/head.sqlite, root:alixwitness, 0640
- Signing private key: /var/lib/alix-ge04-witness/signing.key, root:alixwitness, 0640
- Published key: /etc/alix-ge04-witness/public-key.hex
- Service listener: **127.0.0.1:18841 ONLY** (not open to the LAN)
- Cross-host qualification: short-lived SSH local port forward
- Only HTTP API: GET /health and POST /challenge; **no HTTP update or admission route**
- Revision advance: local root-only offline CLI, exact next integer revision required
- SQLite transaction: BEGIN IMMEDIATE + synchronous=FULL; service read-only
- Initial revision: synthetic qualification head 1, not ALiX production policy

## Security constraints

Systemd runs as a dedicated user with NoNewPrivileges, ProtectSystem=strict and additional hardening. The key and database are root-owned so the service cannot update them directly. The service can sign nonce-bound receipts but has no approval, recovery or worker admission privileges. The public key fetched from the service host has not been independently pinned, so no trust in administrator provenance is established.

**Not rollback resistant:** Proxmox host administrator can restore an entire VM snapshot of the private key and database. An independent authoritative minimum revision, immutable log or remotely administered witness is still required. Local restart persistence is not snapshot rollback protection. The witness does not itself enforce nonce uniqueness; the ALiX verifier must generate and durably track single-use challenges. Unauthenticated network transport must not be enabled.

## Qualification path

1. Validate correct service UID, file ownership and loopback-only binding.
2. Validate root-only initial state, duplicate/gap/rollback-denial and restart persistence.
3. Obtain a real signed receipt over SSH tunnel; verify it with the existing R2P verifier.
4. Reject signed receipt on nonce replay mismatch.
5. Test concurrent writers, service outage, disk corruption, key change, and full VM restore with an **external** authoritative revision floor before reconsidering deployment classification.
6. Consolidate any production implementation behind the existing ALiX governance/recovery witness port. No direct CLI/TUI or worker access.

Never interpret signed head consistency as authorization. Explicit independent security review required before SECURITY HOLD release.

---

## R2S hardening and production boundary (proposed; 2026-11-08)

The current deployed API is **127.0.0.1:18841** with SSH forwarding for qualification. It is **not** a network-facing production trust service. The running signing process can read its own key; a root-controlled local SQLite head and ordinary VM snapshots cannot independently protect signing or revision integrity. Do not expose existing `/challenge` on a LAN or treat a health response as authentication.

Before exposure or admission integration: separately authenticate workloads (mTLS or independently reviewed equivalent), split verifier/publisher/committer/operator roles, restrict sign operations to committed protected heads, establish a protected out-of-VM floor and independently authenticated key provenance, implement audit and key rotation, and test authenticated outage, snapshot rollback, forks, concurrent commits, restart and compromise scenarios. The existing service's no-network-write behavior stays in place.

Authoritative target: [ADR-0018](architecture/adrs/ADR-0018-independent-trust-service.md), [threat model](security/ge04-trust-service-threat-model.md), [contract](security/ge04-trust-service-contract.md). ALiX governance/recovery remains the only authorization authority. Security hold remains active.
