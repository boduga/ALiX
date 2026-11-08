# GE-04-R2R — External floor consistency and key provenance boundary

**Security disposition: GE-04 SECURITY HOLD ACTIVE.**

## Scope (2026-11-08 UTC)

- Added scripts/ge04-r2r-external-floor-check.py and tests/agents/test_ge04_r2r_external_floor.py to assess separately supplied verifier-side expected witness revision and signing-key SHA-256 against a signed R2P receipt.
- Reused the existing R2P Ed25519 verifier rather than duplicating signature-verification or governance logic.
- Updated the existing scripts/ge04-r2q-cross-host-probe.py to compare a real signed witness revision 1 against a **hypothetical, in-memory** higher floor 2 and assert failure. The live witness on Proxmox Ubuntu VM 10.1.1.13 remains unchanged at revision 1.
- Qualification only; no policy engine, approval store, recovery ledger, or production agent launch path was created or modified.
- All evidence resides in the ALiX repo, not on microcloud3.

## Trust properties and limitations

- Exact pinned head: revision + policy digest + checkpoint digest + signing public-key hash. A matching synthetic signed receipt can demonstrate consistency but always returns status=blocked, witnessAuthorityQualified=false, rollbackResistant=false.
- A signed lower head cannot satisfy a higher verifier-side expected floor. An unsigned, wrong-key, wrong-policy, wrong-checkpoint, replayed or wrong-identity receipt fails closed.
- The current verifier-held floor is a **test fixture**, not durable, not administrator-independent, not protected from an ALiX-side snapshot rollback, and not authenticated by a separate owner. It is NOT a monotonic anti-rollback authority.
- This qualification checker requires an **exact** revision/digest pair; advancing the service requires a separate reviewed checkpoint update. It intentionally does not implement automated rollback-safe floor advancement.
- The existing qualification key pin originated from an SSH read of the witness VM. It has not been authenticated out of band.
- A Proxmox administrator can still restore the witness key and DB together; a compromised verifier could also replace the locally stored floor. This gap is not solved by a second local SQLite store.

## Operator-controlled next prerequisite

1. Independently verify signing public key provenance against the witness console and independently recorded deployment receipt. Obtain explicit approval of the witness identity and key rotation process. Merely SSH-reading the key from the same VM does not qualify independence.
2. Select a distinct rollback-resistant authority for the ALiX-side minimum revision, with clearly separate administrative control from the Proxmox VM. Candidates include an append-only externally operated service, hardware-backed monotonic counter, or externally audited write-once register. ALiX repo Git history alone is not an automatically live monotonic trusted counter.
3. Exercise real snapshot-restoration against a trusted revision floor once such authority is deployed; no unsafe snapshot or production host changes before approval.
4. Integrate only one witness-evidence adapter behind existing governance/recovery contracts after security reviews. Do not promote experimental Python scripts into competing ALiX subsystem ownership.

GE-04 SECURITY HOLD stays active regardless of local passes.
