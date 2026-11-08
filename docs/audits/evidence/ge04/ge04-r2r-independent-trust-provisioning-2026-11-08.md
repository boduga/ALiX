# GE-04 R2R — Independent witness trust provisioning

**Status (2026-11-08): BLOCKED — not provisioned. GE-04 SECURITY HOLD stays ACTIVE.**

This note is authoritative ALiX qualification evidence. microcloud3 is disposable and MUST NOT hold the only copy of any evidence.

## Verified deployment facts

- Proxmox Ubuntu witness VM: `ubuntu@10.1.1.13`, `ge04-r2q-witness.service`, signed revision 1, public key Ed25519 hexadecimal `608e93bbbca2e8905daab4e5ae2d87d489a8f888a86fcbce87ab6ff42db77834`.
- Key SHA-256: `c1d3eb1f1ca58b5d70b69eceeefb61809b0375ca2e2355287f8f322c16c9d0a6`.
- ALiX ideapad: separate physical machine with `/dev/tpm0`, `/dev/tpmrm0`, TPM major version 2. Required tpm2-tools binaries absent at inspection.
- Existing `docs/audits/evidence/ge04/r2r-qualification-witness-pin.json` is an **operator-unverified fixture**, not an independently qualified authority.
- Current ALiX verifier-side SQLite challenge and hypothetical floor tests have no production authority. VM snapshot rollback remains possible.

## One authority, not fragments

- ALiX owns governance policy fingerprint, approvals, supervisor, recovery ledger and evidence semantics.
- Ubuntu VM signs witness receipts and owns its service revision journal.
- An **ideapad physical TPM 2.0 NV counter**, if safely provisioned, is one possible separate, hardware-monotonic floor primitive. This is not another approval or policy subsystem.
- A single ALiX governance/recovery witness-evidence adapter may consume *verified evidence* in future. It must never use the test preflight script or unreviewed fixture as an authorization source.

## Key provenance ceremony — requires an operator

1. Using the **Proxmox hypervisor console** (NOT merely SSH back into the witness guest), verify the guest identity, its signing public key, boot volume, and custody of the private key. A guest-admin-reported key alone is insufficient against a compromised guest or hypervisor.
2. Independently authenticate the expected witness identity and SHA-256 fingerprint above against deployment records held outside the guest. Have an authorized administrator explicitly record **who checked, what they saw, when, by what channel, and which trust boundary they control**.
3. Pin the resulting *operator-authorized* key in a separately controlled location; protect against unauthorized key rotation. A Git file or automatic output from the VM is not an attestation.
4. On mismatch, stop qualification and rotate/redeploy under independent review. Never silently re-pin from the network response.

**No operator ceremony has been performed by this assistant. No 'verified=true' attestation is claimed.**

## TPM-backed monotonic floor — provisioning requires review

The TPM on ideapad is physically separate from the witness Proxmox guest. A TPM 2.0 NV counter, when properly owned and authenticated, cannot be decreased by restoring a *guest* disk snapshot. A full TPM clear/reprovision is a separate denial/recovery and identity-continuity threat; the verifier must pin TPM identity/provisioning and **fail closed** on clear or lost identity.

Provisioning conditions, all currently **NOT MET**:

- Obtain operator authorization for modifications to the ideapad TPM. Its TPM may already protect disk encryption or other credentials. Do **not** clear or reset the TPM.
- Install/verify trusted `tpm2-tools` and read existing NV handles/ownership policy in read-only mode first.
- Select an unused, approved NV counter handle and determine owner/auth policy, access permissions, rollback/clear response, wear limits, and failure recovery. Do not assign a guessed handle or overwrite an existing NV index.
- Bind the TPM counter identity and a cryptographic commitment to the exact witness key + policy/checkpoint epoch; do not conflate the counter with ALiX's SHA-256 policy revision.
- Define an atomic, fail-closed witness advancement protocol: a signed head is never accepted as authoritative until a counter advance and protected commitment are reconciled. Power loss/partial update must block, not auto-accept.
- Test actual witness VM snapshot restoration against a previously advanced hardware floor, plus verifier restart/TPM clear/backup and concurrent updates.
- Ensure read/advance operations are restricted to the appropriate ALiX-controlled identity. Do not expose TPM owner authentication to workers or the witness VM.

## Immediate qualification command (safe read-only)

From the ALiX repo:

`python3 scripts/ge04-r2r-trust-preflight.py`

An exit code of **78** is expected while prerequisites are missing, with `status: blocked`. The script **never issues approval**, even when all named inputs are hypothetical true values.

## Explicit decision point

Physical TPM provisioning and authorized out-of-band signing-key attestation require access and approvals not present in this session. Do **not** claim these security requirements were fixed by the hypothetical-floor tests. The next production change requires these two independent operations, then integration in one existing ALiX governance/recovery boundary.
