# GE-04 — Supervisor-owned operation lifecycle gate (implementation contract)

**Status: DESIGN CHECKPOINT ONLY — GE-04 SECURITY HOLD REMAINS ACTIVE.** This document does not implement a trusted receipt, authorize a real mutation, approve PR #1039 for merge, or change `UnavailableScopedMutationService`. No production path may call any experimental entrypoint.

## Source baseline and exact gap

- `sup25-atomic-authority-fixture.py` provides cooperative, fixture-owned serialization of approval consumption and inert transitions.
- `sup26-inert-terminal-evidence.py` produces fixture MAC markers, not real-effect attestation.
- `signed-native-observation-fixture.py` demonstrates root-held Ed25519 custody but accepts caller-provided observation bytes and effect digest; the deliberate privileged forgery test must remain.
- `supervisor-derived-effect-fixture.py` eliminates caller effect-byte input at its high-level publish method and independently reopens protected state and pinned-directory content, but its lower-level signer remains callable and the test invokes effect, observation, settlement and signing as separate operations.
- SUP-27 reproduces same-owner state rewrite and receipt fabrication. Neither a signature nor a CI PASS removes the hold.

## Decision

Introduce **one supervisor-owned, test-only operation orchestration entrypoint** with protected state, exact immutable request binding, kernel effect observation and receipt generation under a documented serialization and crash-recovery protocol. The coordinator may request an operation and verify a returned receipt; it cannot supply authoritative effect bytes, terminal status, or signing inputs.

The next checkpoint is deliberately **inert or isolated disposable fixture only**. Do not replace the production service factory, expose this path via tools/CLI, reuse root fixture credentials as production credentials, or weaken existing denial defaults.

## Threat boundary

1. Trusted in this experiment: an independently installed supervisor's own executable, explicitly pinned configuration, its protected journal and signer, and its OS identity. **Not yet proven:** independent installation/provisioning, root compromise resistance, actual power-cut durability, and production key lifecycle.
2. Untrusted: coordinator processes, worker processes, model output, request payload fields, filenames and paths, caller-supplied observations, session identifiers and old delegated streams.
3. Root-equivalent actors can replace the existing experimental state and invoke the old signer. Until a real trust-root decision constrains these actors, a 'root-controlled forgery' remains a **known reproduced vulnerability**, not a test failure or attestation.
4. Old authenticated-stream FD delegation and same-UID credential/state substitution must remain explicitly disallowed in any future authority path.

## Single-attempt protocol

Every transition must be bound to a fixed tuple: `attemptId`, `approvalId`, `workerId`, `leaseId`, `policyRevision`, `scopeId`, `operation`, exact canonical relative path, content/preimage digest and length, pinned resource identity, release identity, and supervisor journal generation/sequence. These are *claims*, not independent authority.

| Stage | Supervisor responsibility | Required durable state | Reply |
|---|---|---|---|
| REQUESTED | Authenticate transport and role; structurally validate exact request | None required | No success |
| ADMITTED | Pin scoped descriptors; independently reload approval, lease, policy, release and revocation; compare all bindings and expiry under shared exclusion | No consumption if denied | DENIED on mismatch |
| PREPARED | Atomically reserve and single-use consume approval before effect, with non-reusable attempt ID, journal generation and request hash | Durable PREPARED + consumed approval before syscall | No success |
| EFFECT_ATTEMPTED | Execute through same pinned descriptors and authorized operation bytes; gather supervisor-owned observation | Record durable evidence when available; NEVER infer effect absence solely from missing evidence | No success |
| SETTLED | Reconcile exact observed effect and persistence barriers under same authority ordering; create once a signed terminal receipt from supervisor-held material | Durable terminal record, sequence and signature; no caller-controlled status | VERIFIED only after all defined gates |
| RECOVERY | Reopen protected journal, validate integrity/generation, compare pinned effect without replay | Preserve ambiguity and consumed approval | UNCERTAIN_NO_REPLAY unless independently provable |

**Linearization:** final admission and revocation/policy publication must use a single supervisor-owned serialization domain. The point at which expiry becomes binding must be explicitly specified and tested relative to the syscall; the presence of a held lock alone is not proof of valid lease time. **A filesystem effect and a journal write are not one atomic transaction.** Define write ordering, file+directory fsync and failure rules; never label uncertain results as success.

## Minimum outcome vocabulary

- `DENIED`: admission failed before approval consumption and before the effect boundary; supported by trusted state.
- `PREPARED`: consumed approval, durable journal, kernel effect not proven.
- `EFFECT_OBSERVED_UNVERIFIED`: effect snapshot found, provenance and/or durable terminal settlement not independently established.
- `VERIFIED_TERMINAL`: reserved for a future implementation meeting all defined authority, effect, durability, and receipt gates; **must not be emitted by the current fixtures**.
- `UNCERTAIN_NO_REPLAY`: prepared or disputed effect, missing/torn/mismatched evidence, changed generation, lost signing key or crash ambiguity. Must not resubmit the consumed approval or synthesize success.

## Mandatory crash and adversary test matrix

| Interruption / adversary | Required behavior |
|---|---|
| Before durable PREPARED | No effect; denial / no consumption verifiable |
| After PREPARED, before syscall | On restart, consumed approval; UNCERTAIN_NO_REPLAY absent independent proof |
| After syscall, before file or directory fsync | UNCERTAIN_NO_REPLAY; no automatic retry |
| After effect durability, before observation | UNCERTAIN_NO_REPLAY unless independent recovery proof exists |
| After observation, before terminal journal | UNCERTAIN_NO_REPLAY; no signed terminal success |
| After durable terminal record, before reply | Read-only recovery can verify exactly the original receipt; no second effect |
| After reply, replay of request/attempt or new attempt reusing approval | Reject; at most return already-proven original terminal result without effect |
| Revocation or policy revision racing final admission | Single documented order; no unauthorized late syscall |
| Expiry crossing final admission and syscall | Explicit invariant, deterministic test at syscall-adjacent boundary |
| Same-UID state/key replacement, root-forged input, old stream FD delegation | Reproduction retained until a proven isolated trust boundary denies each path |
| Symlink/parent swap, bind mount, descriptor substitution | Pinned scope invariant holds or fail closed |
| Torn journal, rollback to older generation, backup restore, signature/key replacement, concurrent requests | UNCERTAIN_NO_REPLAY or denial; no duplicate effect |
| SIGKILL, host reboot, forced fsync failure and simulated power loss | Crash classification tested separately from actual power-loss claims |

## Implementation sequence (small, reviewable checkpoints)

1. **Lifecycle schema + pure classifier:** introduce versioned test-only records and recovery classification with duplicate-field rejection, exact request hashing, immutable monotonic journal sequence and explicit uncertainty; negative tests first. This is not an effect oracle.
2. **Supervisor composition fixture:** move admission, native operation, observation, settlement and signing behind one non-exported high-level test-only entrypoint; reject any externally supplied result/effect digest; eliminate any lower-level signing path reachable by the untrusted coordinator.
3. **Crash harness:** inject abrupt death at every listed boundary and assert no replay or false terminal status after process restart; test concurrency and policy/lease races.
4. **Protected deployment trust root:** isolate keys, journals and executable from coordinator authority; verify package and replacement/rollback provenance; document supported kernels/UIDs/namespaces.
5. **Independent security review:** qualify the exact native implementation, threat assumptions, installation/recovery mechanisms and remaining negative cases before reconsidering production enabling.

## Acceptance / stop conditions

A checkpoint passes only if assertions and the complete fault matrix demonstrate its *narrow* claim. Preserve the deliberately successful root-forgery reproduction until a different, independently proven boundary prevents it. Any test that calls a lower-level signer with fabricated effect input must never be interpreted as an authorized effect receipt. No implementation stage may route actual production mutations to the experiment.

**Security decision remains HOLD. PR #1039 remains open/unmerged. No bypass or production authorization is implied by this contract.**
