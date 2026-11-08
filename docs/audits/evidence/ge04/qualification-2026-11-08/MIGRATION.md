# GE-04 qualification evidence migration — ALiX authoritative archive

**Migration:** 2026-11-08 (UTC). **Security disposition:** GE-04 SECURITY HOLD remains active.

## Canonical ownership

- **ALiX repository:** authoritative source, tests, qualification records and reviewable change history.
- **Proxmox Ubuntu VM (10.1.1.13):** deployed qualification-only witness service with its own private key and SQLite revision head. Runtime state/keys must NEVER be placed in Git.
- **microcloud3 (10.1.1.22):** disposable test host for KVM/kernel/cgroup/IPC experiments only. No authoritative GE-04 reports, policy decisions, witness heads or durable project knowledge reside there.
- Existing ALiX governance, supervisor, scheduler, approvals and recovery ledger remain the sole respective runtime authorities. No duplicate subsystem or bypass introduced.

## Exact archive

The files in this directory were transferred without editing from the historical test rig:
- `evidence/`: 14 Markdown reports covering initial KVM discovery/kernel probes and R2E, R2G–R2Q qualification.
- `manifests/`: three Markdown host/guest/provisioning manifests, plus the source-lock environment *provenance* text (no credential values).
- `rig-readme-original.md`: unchanged historical README, explicitly NOT current infrastructure policy. Its description of microcloud3 as a “permanent home” is superseded by this document.
- `vm-provenance/`: two publicly distributed cloud-image checksum manifests, not VM disks or secrets.
- `imported-source-sha256.txt`: hashes calculated from the test rig for the 19 evidence/manifests/README records and verified against the ALiX copies.

The nine R2G–R2O standalone Python scripts on microcloud3 were compared by SHA-256 against their existing canonical ALiX paths under `scripts/`: **all nine identical**. No duplicate copies were imported. R2P–R2Q source, unit tests, service unit, and architecture docs already belong to the ALiX checkout.

## Intentional exclusions

Do NOT move into Git: private SSH key, VM QCOW2, libvirt overlay, guest seed ISO, runtime sockets, key material, active SQLite stores, downloaded source checkouts, .git object databases, local machine-specific `known_hosts` or volatile logs. The pinned Git revision is recorded in provenance; the checkout is reproducible from Git.

The original source lock and VM metadata can remain on the rig **only as operational input for disposable test runs**, not as canonical project records. After successful checksum verification the archival report copies may be removed from the rig. Never delete the running guest's SSH key or disk as part of evidence cleanup.

## No false qualification

These records document narrow tests and failed-closed probes; they do NOT establish production GE-04 security clearance, independently administered monotonic authority, authenticated rollback-resistant floor, or permission to launch credential-bearing workers. The R2Q witness's signing key and database remain solely on 10.1.1.13. They can still be rolled back together by a Proxmox administrator.

## Future workflow

Write new qualification evidence directly into `docs/audits/evidence/ge04/` in the ALiX repository, along with dated run inputs and hashes; use test rigs only to execute probes. Do not leave the only copy of a report or decision on a test VM. Review and commit according to the project's normal change-control process; this migration alone does not authorize a merge or security-hold release.
