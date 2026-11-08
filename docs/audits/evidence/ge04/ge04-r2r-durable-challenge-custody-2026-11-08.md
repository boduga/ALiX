# GE-04-R2R — Durable verifier challenge custody (2026-11-08)

**Disposition: GE-04 SECURITY HOLD ACTIVE.** This is a qualification-only stage. No privilege-bearing worker, recovery clearance, or witness authority qualification.

## Change

- Added scripts/ge04-r2r-challenge-custody.py to issue cryptographically random 256-bit nonces and record them in a local SQLite store with full-sync commits **before** network transmission.
- Consumes each nonce with an atomic conditional UPDATE in a BEGIN IMMEDIATE transaction **before** validating the signed response. A bad signature still burns the nonce; interrupted operations fail closed.
- A nonce may be consumed only once and only on the originating boot, within a bounded monotonic-clock interval.
- Requires absolute DB path, exclusively owned mode 0700 parent and mode 0600 regular single-link file; denies symlinks and unsafe owners/modes. SQLite file remains explicitly qualification-owned.
- Updated scripts/ge04-r2q-cross-host-probe.py to exercise challenge issue, real cross-host witness request, atomic consume, existing R2P signature validation, second consume failure and local operator-unverified key/head pin. The probe uses a temporary local SQLite database and does not write to microcloud3.
- Added tests/agents/test_ge04_r2r_challenge_custody.py to cover replay across restart, concurrent consumes, unknown nonce, bad file permissions, boot mismatch, stale/future timing, and double-use.
- No runtime ALiX governance, approval store, worker supervisor or recovery ledger module was changed. No competing authority introduced.

## Limitations / security boundaries

- The probe's TemporaryDirectory is a deliberately ephemeral *qualification exercise*. It does NOT persist challenge history for a production ALiX daemon across separate invocations. For deployment, integrate with the existing canonical runtime-state/storage boundary, not another global policy or approval store.
- A malicious same-UID process or snapshot rollback of verifier-controlled challenge SQLite may still compromise or restore state. File-mode validation is not full protected descriptor-ancestry assurance.
- A locally pinned key fetched from the witness VM remains **operator-unverified**; must authenticate independently and rotate under reviewed policy.
- No external durable monotonic revision floor has been established. A Proxmox administrator can roll back the VM witness key and SQLite head together.
- The witness signs arbitrary well-formed challenge nonce and boot ID; client-side custody proves a single-use verifier challenge within the qualification session, not a qualified external independent witness.
- GE-04 stays blocked even when challenge and signature checks pass.

## Next hardening prerequisites

1. Independently authenticated witness signing-key provenance and operator review.
2. Production integration of nonce custody using ALiX's existing storage boundary, with a rollback-resistant verifier floor; no new policy engine/approval store.
3. Real adversarial restart/crash, disk rollback, concurrent issuer requests, key-rotation/outage, and Proxmox restored-snapshot qualification.
4. Cross-UID protected issuer/pidfd/cgroup recovery admission safety review.

Historical and new evidence live only in ALiX: docs/audits/evidence/ge04/. microcloud3 remains disposable testing infrastructure.
