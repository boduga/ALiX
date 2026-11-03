# GE-04 — descriptor-pinned signing key plus signed sequence

**SECURITY HOLD — experimental verifier only, no production authority or execution.**

`trusted-release-verification.py` now accepts an optional protected floor path. With that path, the existing root-to-leaf descriptor-pinned config/release verification checks the independent SHA-256 signing-key pin before dispatching the read manifest, signature, key, and helper bytes to the version-2 Ed25519 signed-sequence verifier. The signed sequence is compared against a separate root-ancestry-validated `floor.json`. A version-2 release without a floor is rejected; existing version-1 tests remain supported in the no-floor experiment mode.

`test-pinned-sequence-root.py` exercises the combined root-owned fixture: valid signed sequence at the floor, signed downgrade denial, attacker-key substitution denial, and missing-floor denial. CI confirmation pending.

**Not yet secure for production:** paths, owner UID, and the choice to omit the floor are still caller-controlled; a production supervisor must hardcode protected locations and **require** version-2 verification. Floor reads are not part of one atomic snapshot of config/release/floor, floor advancement is not monotonic or crash-safe, and no executable bytes are handed to a sealed memfd for execution. This does not grant authorization or change the fail-closed production adapter.
