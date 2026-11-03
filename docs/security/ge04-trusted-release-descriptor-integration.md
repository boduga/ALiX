# GE-04 — descriptor-only ancestry and signed-release verification

**SECURITY HOLD — experimental, no authorization, execution or production integration.**

`experiments/ge04/trusted-release-verification.py` combines the existing `trusted-path.py` directory walk with descriptor-relative reads of `trust.json`, `trusted.pub`, `manifest.json`, `manifest.sig`, and `helper`. Both root-to-leaf directory walks use `O_NOFOLLOW` and reject non-owner directories and group/other-writable ancestors. The config and release directory descriptors remain open through verification, so the prototype does not validate a pathname and then reopen that pathname for file reads. It rejects config/release inode aliasing, mismatched signing-key pins and invalid Ed25519 signatures.

`test-trusted-release-root.py` is a root-gated CI test with an isolated root-owned `/run` fixture, verifying a valid signed release and denying writable release ancestry and symlinked config. The privileged CI job requires its PASS marker; CI confirmation for this revision is pending. Running this root test without root exits nonzero, not a skip/pass.

**Remaining risks:** paths and owner UID are still test-selected; no fixed supervisor authority, mount provenance, atomic generation snapshot, rollback floor, or verified executable handoff. Files within the directory are read separately and can be modified by a same-UID privileged attacker. This test does not grant admission or authorize mutation. Do not merge or enable GE-04 in production.
