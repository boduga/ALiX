# GE-04 R3-TPM2A/2B — Local TPM Checkpoint Protocol Qualification

**Date:** 2026-11-08
**Status:** qualification-only; **GE-04 SECURITY HOLD ACTIVE**. No real TPM mutation or production authority granted.

## Physical development host observations (user-supplied)

- Linux host reports a physical TPM 2.0, Intel manufacturer `INTC`, TPM revision 1.38; `systemd-detect-virt` reported `none`.
- Device paths `/dev/tpm0`, `/dev/tpmrm0` exist. Normal-user access was initially denied; elevated read-only capability inspection succeeded.
- SHA-256, ECDSA and RSA-PSS reported; NIST P-256 and BN-P256 curves; **Ed25519 not advertised**, so existing R2S Ed25519 receipts cannot be assumed compatible with TPM signing.
- Variable capabilities: `ownerAuthSet=0`, `endorsementAuthSet=0`, `lockoutAuthSet=1`, `disableClear=0`; NV indices 5, counters 2, `NV_COUNTERS_AVAIL=4`. No evidence of independent hierarchy administration or protection against TPM clear.
- Five existing NV indices: `0x01410001`, `0x01410002`, `0x01800100`, `0x01880001`, `0x01880011`. Their provided public attributes show three counters and two ordinary indices, including a policy-written counter. **All are reserved/unknown ownership for ALiX and MUST NOT be modified.**
- None of these observations is an attestation, an actual ALiX-provisioned trust root, secure boot proof, or confirmation of protected NV Extend allocation. Actual NV capacity/authorization for a new index remains unproven.

## TPM2A: simulated NV Extend + durable SQLite intent model

`scripts/ge04-r3-tpm-checkpoint-simulator.py` has a SQLite-independent **simulated** NV object supplied by tests and a SQLite journal tracking `prepared`, `extended`, and `committed` intents. Its journal records exact canonical R2S checkpoint head digest, predecessor, request ID, revision, old NV digest, new NV digest and epoch/NV identity. Actual NV updates, TPM handle selection, and hardware provisioning are **not** implemented.

For a hypothetical SHA-256 NV Extend, the model computes:

```text
headHash = SHA256(R2S_DOMAIN || canonical(head))
extendInput = SHA256("ALIX-GE04-R3-TPM-EXTEND-V1\\0" || headHashBytes)
newNvDigest = SHA256(oldNvDigest || extendInput)
```

The domain string includes one NUL byte, not literal backslash characters. Both digest values are tracked to detect replay and conflicting history. This is a **model of** the TPM NV Extend transition; the exact command byte encoding and algorithm selections must be proved against physical hardware in a later destructive *explicitly authorized* qualification.

The intentionally split state machine:

1. **Prepare:** validate strict head/revision/predecessor, compare persisted journal with external simulated NV, atomically persist an intent in SQLite.
2. **Hardware step:** simulator changes only the independent simulated NV value. If an acknowledgment is lost after the extend, the intent can remain `prepared`.
3. **Reconcile:** read journal and NV, finalizing only when NV matches the intent's exact next digest. If NV equals the *old* digest, do **not** automatically extend again; the operation is unresolved and needs an explicit recovery protocol. If different, fail closed.
4. **Read:** check entire journal link chain and NV progression. An old local DB snapshot cannot be accepted against a later simulated NV commitment.

All API results have `status:blocked`, `authorizationGranted:false`, `rollbackResistant:false` and `securityHoldActive:true`. `reconciled:true` means **only simulator-state agreement**, not hardware custody or authorization. `provision_fixture()` is test-only and never writes to hardware.

Tested: normal/restart path, lost acknowledgments, crash before hardware write, simulated database snapshot restoration, NV-name substitution, NV reset, journal tampering, stale/forked head, duplicate request, second checkpoint chain, 24 concurrent preparation attempts, missing/symlinked state and no-fail-open return contract.

### Known deficiencies before hardware usage

- The simulated NV lives in a Python object, **not actual TPM NV**. Tests cannot establish secure authorization, hardware durability, operator independence, or nonrollbackability against a root/physical attacker.
- No atomic transaction exists across SQLite and TPM hardware. Crash-state reconciliation is essential; simulated transition exercises *some*, not all, power-loss, durability and bus-error conditions.
- TPM NV Extend state does not expose a numeric revision on its own. Revision must be verified by replaying authenticated journal history from a separately trusted enrollment checkpoint.
- A malicious administrator may destroy or replace both journal and TPM NV. A TPM clear, firmware change, or NV delete/recreate can defeat single-device proof absent externally retained and authenticated enrollment evidence and prevention/visibility of reset.
- In-process simulation serialization is not a production multi-process TPM access controller. The SQLite transaction serializes journal prepare, but hardware updates are not authenticated by real OS peer credentials or TPM policy sessions.
- No durable external nonce registry, canonical production ALiX policy publication, independent security operator approval, rootless kernel-isolated supervisor certification, or recovery grant.
- The simulator is **not wired into any ALiX authorization, scheduler, supervisor, witness or recovery path**.

## TPM2B: strictly read-only hardware inspector

`scripts/ge04-r3-tpm-readonly-inspector.py` supports only `tpm2_getcap` fixed/variable/curve/handle inventory and `tpm2_nvreadpublic` for a validated index. It explicitly targets `/dev/tpmrm0` and never falls back to a simulator, prompts for `sudo`, allocates NV, clears TPM, signs or extends state. Unexpected device and injected handle text are rejected; malformed output or access denial blocks. Tests mock **every** TPM call; no physical hardware calls ran in this implementation task.

The inspector returns `hardwareQualified:false`, `authorizationGranted:false` even with a successful capability inventory. Its read-only output is **observed metadata**, not trusted provisioning. Operational use of the inspector is optional and must be explicitly approved for the deployment environment.

## Next gates, before any production authorization

1. Review independent local administrator threat model and decide how ALiX protects against system root, physical TPM clear, disk rollback and recovery enrollment. Update ADR-0018 without claiming a single-device TPM is the equivalent of a separately administered external anchor.
2. Independently approve a new ALiX-only NV handle and attributes/policy, with recorded public index Name and protected enrollment digest. Preserve the five pre-existing handles.
3. Build hardware adapter under a dedicated local Unix-socket service identity; require peercred identity, TPM authorization policy and key custody. No standard user's direct TPM access in production.
4. Explicitly authorize **new-index-only** physical hardware qualification and execute restricted power-loss/reboot/reset *simulations or controlled tests*—never alter firmware/TPM-wide state on the development laptop.
5. Integrate native ALiX governance publication, independent signoff and protected policy-to-checkpoint authorization; then certify native supervisor and recovery paths separately.

The SECURITY HOLD remains active until real evidence and independent release authority support lifting it.
