# GE-04 — Supervisor-derived fixture evidence and read-only restart inspection

**SECURITY HOLD / EXPERIMENTAL FIXED OPERATION ONLY.** PR #1039 remains open and unmerged. The production `UnavailableScopedMutationService` is unchanged.

## Narrow improvement over the prior signed observation

Earlier `signed-native-observation-fixture.py` allowed a root fixture controller to pass arbitrary `observation_bytes` and `effect_digest` for signing. SUP-27 and the deliberate root-forgery regression show why a valid Ed25519 signature over caller-supplied claims is not real-effect attestation.

The new `supervisor-derived-effect-fixture.py` exposes a higher-level **root-only experimental entrypoint**: `publish(private, pinned_dir, public, pinned_key_digest)` accepts no caller-provided effect bytes, observation bytes, or success marker. It reloads the root-owned SUP-25 state under its fixture lock, requires approval consumed and `inFlight=null`, verifies the existing HMAC observation under that same lock, and inspects the fixed leaf relative to the pinned directory FD. It derives the signed input from the actual protected observation record and the pinned file's content digest. It then uses the prior root-held Ed25519 fixture key to publish one create-once signed observation. `recover_read_only` independently reloads all these sources, verifies the public-key signature and all digests, and never changes state or retries the kernel effect. Every positive outcome remains explicitly **UNVERIFIED**.

The root-only test builds the existing fixed `openat2` native helper into a disposable directory; exercises the complete native create → durable observation → settlement → supervisor-derived signature sequence; verifies no signature may issue before settlement; checks wrong/missing observation, changed file, forged signature, attempted duplicate receipt, and missing signature after settled state. It also reproduces an actual subprocess exit after durable observation but before settlement: the fixed effect exists, the consumed approval remains inFlight, and read-only recovery returns `UNCERTAIN_NO_REPLAY`. All privileged test artifacts are temporary.

## Exact limits and release blockers

- The signer, legacy `sign_observation` function, signing key and authority files remain root test-provisioner-controlled. A root-equivalent adversary may directly invoke the lower-level signer, replace the state/keys or fabricate records. This is **not** a capability-isolated signer API or an independent attestation authority. SUP-27 root/same-UID forgery remains a known release blocker.
- The new gate is a **separately callable Python fixture**, not currently the root systemd supervisor's single trusted final mutation/receipt state machine. The test itself invokes the native operation and the gate sequentially. There remains no enforceable atomic guarantee against all independent actors or against a compromised privileged launcher.
- The on-disk native file and observation are inspected snapshots, not a kernel-authenticated helper-origin record, immutable filesystem event, signed monotonic sequence or power-loss-proof commit. The write and terminal receipt are not atomically coupled.
- Even complete evidence returns `GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED`, **not** application success. Recovery does not automatically repair or retry an inFlight approval.
- Policy publication, real approval/ownership stores, authenticated transport, trusted key rotation, expiration at the syscall, signed release custody, storage faults and hardware power-loss testing still need independent qualification.

**Next gate:** move signer custody and real operation admission into one independently installed supervisor service, remove the unrestricted lower-level signing seam from any authority path, and use durable journal/receipt transitions with fault injection and external review. Do not merge or enable production execution based on this regression.
