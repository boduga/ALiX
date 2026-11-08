# GE-04 R3-TPM2C — Read-Only NV Candidate Contract Qualification

**Date:** 2026-11-08
**Status:** Qualification only; **GE-04 SECURITY HOLD ACTIVE**. No physical TPM modification, new NV index, signer, worker grant, or recovery grant.

## Scope

This stacked slice adds `scripts/ge04-r3-tpm-readonly-anchor-contract.py` and `tests/agents/test_ge04_r3_tpm_readonly_anchor_contract.py`.

The contract takes **read-only inspector observations** (the prior TPM2B output) and assesses one explicitly named candidate NV handle. It performs **no hardware commands** and deliberately cannot invoke NV Define, NV Extend, NV Undefine, signing, clearing, or TPM hierarchy changes.

A candidate is checked for:
- Strict TPM NV index handle format/range; the five pre-existing host handles (`0x01410001`, `0x01410002`, `0x01800100`, `0x01880001`, `0x01880011`) are always refused.
- Complete TPM 2.0 capability inventory shape and nonduplicated observed handle list.
- If absent, report only `candidateAbsent:true`; **never** infer free capacity, exclusive ownership, or permission to allocate.
- If already present, require separate read-only public metadata for that exact handle and explicit caller-provided enrollment reference, public NV `Name`, and NV policy digest.
- Exact 32-byte NV Extend type, SHA-256 Name hash, numeric `TPMA_NV.TPM_NT=0x4` and corresponding friendly type text; demand `policywrite`, `authread`, and a recorded authorization policy digest. Refuse ordinary/counter indices, unrestricted authorization/owner/platform writes and policy deletion.
- Compare caller-supplied expected Name and authorization policy hash with observed metadata. A match is **shape consistency only**, not an attestation that the index is ALiX-owned or that policy sessions are enforceable.

The result always returns `status:blocked`, `authorizationGranted:false`, `hardwareQualified:false`, `independentAuthorityQualified:false`, `rollbackResistant:false`, `securityHoldActive:true`, including `publicShapeMatches:true`.

## Host-specific facts already supplied

- Actual developer laptop: Intel TPM 2.0; NIST P-256; SHA-256; normal-user TPM access initially denied; capability inspection with sudo succeeded.
- Five existing NV indices contain three counters and two ordinary records, with varying owner, authorization and policy-based access; **none** is an ALiX-owned index.
- `ownerAuthSet=0`, `disableClear=0`: the local TPM does not, from this output, demonstrate independent protection against privileged reconfiguration or clear.
- A hypothetical new handle used in test fixtures is **not an allocation suggestion**, reserved production handle, enrolled index, or a real host observation.

## Tests

New suite exercises shape agreement without authorization, missing/unprovisioned candidate, all five pre-existing handles, wrong public Name/policy, wrong NV type/size/hash, unrestricted write rights, duplicate/forged capability inventory, wrong handle, command-text injection, unknown fields and missing pins/enrollment. All TPM metadata is mocked; the physical device is never accessed by this module or test.

## Boundary and next gate

This is **not** the production TPM adapter and contains no security-sensitive mutation code. The read-only inspector's YAML output can be forged by a compromised OS and must never be treated as an independently authenticated TPM public quote.

Before a real ALiX NV allocation, required: explicit hardware provisioning approval; chosen **new** NV handle and exact TPM public-policy bytes; separate host privilege model; protected enrollment record outside the TPM-clear/reimage domain; TPM policy session verification; conflict-safe register/commit protocol; crash/reboot qualification; and independent review of the one-device threat model. Especially, enabling local TPM without separate ownership does not protect against a full root+TPM-administrator compromise.

**Do not lift GE-04 SECURITY HOLD** or authorize checkpoint commits, credential-bearing execution, or recovery based on this qualification slice.
