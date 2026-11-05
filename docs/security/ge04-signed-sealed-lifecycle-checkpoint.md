# GE-04 — Signed v2 release to sealed composed native fixture

**STATUS: EXPERIMENT ONLY / GE-04 SECURITY HOLD. DO NOT MERGE PR #1039 OR ENABLE PRODUCTION MUTATION.**

## Scope and implemented flow

The experimental `supervisor-signed-sealed-lifecycle-fixture.py` composes the pre-existing **trusted-supervisor-preparation** verifier with the **fixed native composed lifecycle**. The root-only harness supplies protected test config/release/floor/evidence directories. `prepare.prepare()` requires a signed v2 release whose Ed25519 public key matches the separately stored trust configuration, whose manifest declares the expected release and Linux platform, whose helper bytes match the signed digest, and whose signed sequence satisfies the fixture floor. It also requires a deny-only or empty ledger and rejects unresolved attempts.

Preparation copies the *verified bytes* into a Linux memfd, checks its hash, seals write/grow/shrink/further-seal changes, and returns an FD. The composed fixture verifies that same sealed FD, digest and ELF header **before consuming approval**, then uses the existing fixed `/proc/self/fd/<n>` path to execute that descriptor while the SUP-25 cooperative lock is held. All existing stages remain: PREPARED -> native -> observed -> settled -> signed -> separately anchored. Every returned positive marker continues to say **UNVERIFIED**, never production SUCCESS.

The new privileged regression compiles the disposable fixed `openat2` test helper, wraps its bytes in a signed version-2 manifest at sequence 12, sets a test-only protected floor at sequence 12, and exercises the complete composed lifecycle. It also requires rejection *without approval consumption* of a correctly signed sequence-11 downgrade, a signature by a different private key, modified helper bytes, and malformed trust configuration. Existing isolated tests establish that a sealed source snapshot cannot be altered by in-place modification of the source file after preparation. The CI job runs this new regression alongside the existing provenance and recovery tests.

## Explicit limitations

1. **Not an independent installed trust root.** A privileged fixture creates/selects the signer, config, release directory, floor and executable. The protected signed release is a *fixture* input, not an administrator-authorized immutable identity. An attacker controlling all these can provision a replacement key/manifest/config/floor. Full-tree rollback and malicious-root behavior remain blockers.
2. **No production authority path.** The fixed runner also retains an experimental direct FD/path API and a lower-level root-callable signer; neither is an authorized coordinator-facing admission endpoint. Caller-selected paths and fixture clocks are disallowed as production authority.
3. **No complete release-to-receipt binding.** The signed v2 release sequence and helper digest are checked on preparation but are not yet included in every durable per-attempt journal entry and Ed25519 terminal observation payload. That audit/provenance binding must be specified, implemented and security-reviewed.
4. **No verified live service process.** The wrapper does not provision systemd identities, authenticate the coordinator request, protect the interpreter/module imports or establish a service manager security boundary. It is still a root-owned test process. The native fixed ELF's dynamically loaded dependencies and /proc mount remain part of the unqualified runtime environment.
5. **No true rollback floor.** Sequence 12 is compared to a locally protected test floor. The test owner can replace it. A separately enforced atomic monotonic floor and recovery after power loss remain unresolved.
6. **No trusted real-effect attestation.** Filesystem effect, journal, anchor and signed receipt are sequential fsync-delimited operations, not a single atomic transaction. Root-controlled forgery remains reproducible; source snapshot and signed receipt cannot alone prove an authorized, durable real-world mutation.
7. **No syscall-adjacent trusted time.** The cooperative fixture uses two caller-controlled times, and the final Python check is not at the native `openat2` boundary.

## Next mandatory gates

- Extend immutable operation request + journal + receipt schemas to bind verified release key pin, signed release ID/sequence, helper digest, executable snapshot digest and service installation identity **without trusting coordinator-provided values**.
- Establish an independently installed, signed service executable and trusted root of administration, with no shared-write privileges available to the coordinator; enforce versioned upgrades and rollback protection.
- Treat signed package verification and verified memfd execution as *necessary but insufficient*. Bind live policy/revocation/lease authority to the actual native mutation boundary.
- Perform full root/same-UID, key rotation, manifest swap, interpreter and mount provenance, power-cut and storage-fault testing; require external security review.

**CI PASS here means the fixed test composition works. It is not security certification and does not lift GE-04 SECURITY HOLD.**
