# GE-04 — Composed fixed native fixture checkpoint

**SECURITY HOLD. EXPERIMENTAL ONLY. NOT AN AUTHORIZED EFFECT RECEIPT. PR #1039 MUST REMAIN OPEN/UNMERGED.**

`experiments/ge04/supervisor-composed-lifecycle-fixture.py` adds a single **root-only test entrypoint** that sequences the existing fixed native `openat2` experiment under one SUP-25 cooperative lock: read authority → reject invalid/revoked/expired fixture state → pin directory → durably consume approval/prepare → invoke fixed test binary → persist HMAC-bound observation → settle fixture state → re-inspect protected observation and pinned file → publish an Ed25519-signed fixture observation. It accepts **no caller-provided observation bytes, effect digest or success result**, and returns only `GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED`.

The accompanying privileged test `test-supervisor-composed-lifecycle-root.py` checks normal flow, single-use rejection, expired admission without consumption, tamper detection, and process termination at **after_prepare, after_native, after_observation, after_settlement, after_signature**. Before signed publication, recovery remains `UNCERTAIN_NO_REPLAY` even when the file exists; after signature, read-only recovery returns **only** `GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED`. A crashed or completed attempt cannot be automatically replayed.

The pure `test-supervisor-lifecycle-classifier.py` also runs in the privileged CI job. Its outcomes remain unverified and non-authoritative; its journal record schema is not yet integrated into the native composition, and journal sequence rollback protection is not established by this composition.

## Known limitations and release blockers

1. **Test binary trust remains external.** The harness passes an executable path and a fixture clock. They are test inputs, not independently validated executable provenance or trusted time. The signer can still be called separately by root, and root controls both evidence and fixture authority state. SUP-27 privileged/same-owner forgery findings remain reproducible. Neither one lock nor one function implies an OS-isolated trust root.
2. **No real deployment authorization.** This entrypoint is not wired to a live systemd supervisor, authenticated coordinator transport, real approval/ownership stores, production mutation API, or packaged immutable binary.
3. **No atomic filesystem transaction.** Approval consumption, native effect, observation, state settlement and signature use sequential fsyncs. Crashes can leave ambiguous state. Neither crash injection nor matching signed snapshots proves power-loss durability, kernel-authenticated provenance, or prevention of externally concurrent tampering.
4. **Test-only crash knob.** `crash_checkpoint` deliberately terminates a disposable child with `os._exit(88)`. It is not a remotely accessible control and must never become part of a production operation request.
5. **Expiry/revocation gap.** Fixture expiry is checked before prepare using a caller-provided test time, not at syscall-adjacent trusted time; all revocation actors must voluntarily honor the SUP-25 lock. The complete final-boundary lease rule remains unproven.

## Required next gates

- Pin and authenticate supervisor executable/release and credentials under an independently controlled service manager. Eliminate lower-level signer access from the coordinator's reachable authority surface.
- Integrate durable versioned journal generation and exact immutable request identity into the same operation lifecycle, including explicit terminal evidence and rollback classification.
- Recheck expiry and revocation at a defensible final kernel mutation boundary; exercise simultaneous revocation, symlink/parent swap and unauthorized executable replacement.
- Expand fault injection to failed fsync, torn/rolled-back state, reboot and hardware power-loss qualification; obtain independent security review.

**CI PASS asserts only that the named fixture regression executes as intended. It cannot lift GE-04 SECURITY HOLD. Production `UnavailableScopedMutationService` must remain unchanged.**
