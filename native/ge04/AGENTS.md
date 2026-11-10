# GE-04 Native Boundaries

## Purpose

Linux native qualification components. GE-04 SECURITY HOLD remains active.
These files do not provide production worker or broker admission.
Proposed `docs/architecture/adrs/ADR-0019-cross-platform-worker-execution.md`
keeps Linux kernel calls and future OCI/runc execution behind the mandatory
portable supervisor seam. Do not import these fixtures into the cross-platform
control plane or treat a VM/remote host as already qualified.

## Ownership

- `oci_qualification_image.py`: pure bounded construction/verification of one
  canonical OCI qualification image byte format. Opaque payload digest matching
  is integrity only, never code safety, root custody or runtime admission. No CLI,
  extraction, filesystem/process/network operations or production consumer.
- `worker-stream.h` and `worker-stream.c`: bounded AF_UNIX byte-stream framing,
  native acceptance, pidfd/process-generation and per-fragment sender checks.
  Trusted callers must supply independently protected registration authority;
  numeric PID arguments alone do not supply it. No production caller exists.
- Other C files: separate pinned-executable, launcher, pidfd, peercred and
  cgroup qualification probes. Their outputs are diagnostic evidence for
  documented tests, not interchangeable authorization or release grants.
- `cgroup-worker-qualification.c`: closed fixed-worker fixture for exclusive
  cgroup birth/stop/attach/descendant cleanup and same-boot helper-crash recovery.
  It has no arbitrary path/PID/UID/executable interface or production consumer.
  `tests/agents/test_ge04_cgroup_worker.py` owns only its newly created exact
  transient qualification unit; it must validate trusted root staging first.
- `cgroup-runtime-view-qualification.c`: separate, not-yet-reviewed closed
  namespace-view/bootstrap fixture for two trusted children under the original
  exclusive outer cgroup. `tests/agents/test_ge04_runtime_view.py` currently
  covers local parsing, immutable-stage, real unprivileged read-only kernel
  observations (including a genuine read-only self-cgroup v2 snapshot),
  synthetic binding checks and refusal contracts; its root admission
  intentionally fails closed. No privileged run or worker acceptance
  is authorized. See `docs/security/ge04-runtime-view-qualification.md`.
- `tests/fixtures/ge04-native-stream-probe.c` and
  `tests/agents/test_ge04_native_stream.py`: secret-free transport harness and
  synthetic cross-UID regressions. The harness is never installed as a service.

## Local Contracts

- Never add root execution, service installation, sudoers, file capabilities,
  credential admission or broker effects merely because a test passes.
- Keep native socket acceptance/recvmsg inside this boundary. Node socket
  internals, stdout reports and worker-claimed PID/UID are not attestation.
- Stream sessions require a trusted listener, private cancellation pipe and
  live restricted peer. Reject absent/mismatched credentials and descriptor
  transfer; close received descriptors even when ancillary data is truncated.
- Session failure closes owned descriptors and permanently poisons the session.
  Listener/control descriptors remain caller-owned. No direct PID signalling
  or worker launch belongs in the stream transport.
- IPC deadlines bound individual transport operations, never agent lifetime.
- Sender checks do not prove which process reads an intentionally delegated
  response socket. No reusable credentials or authority may be returned.
- No change here qualifies hostile containment, durable registration/recovery,
  model-provider authority, final effects or independent production release.
- Exclusive journal-bound cgroup ownership is the operator-selected recovery
  authority for the fixed fixture, including stopped root launchers. Lost unit,
  parent or leaf binding means quarantine, not another kill target. A unit timer
  must never bypass quarantine; no automatic whole-subtree teardown fallback.
- Fixed-qualifier child setup closes inherited lock/control descriptors and
  redirects standard streams before stopping. Stopped children must not retain
  the parent writer lock or stdout lifetime. Recheck leaf/control custody before
  destructive operations; phase diagnostics alone do not prove identity.
- Cgroup root tests require separately reviewed root-owned non-writable staging,
  fixed source/binary hashes and the documented disposable-VM scope. Never adopt
  a preexisting unit/work directory, change the witness, or grant sudo to repo
  scripts. No cgroup mutation follows merely from passing unprivileged tests.

## Work Guidance

Read `docs/security/ge04-native-stream-transport.md` before changing stream
semantics. Run GitNexus impact before edits and detect_changes before commits;
cross-language/missing-symbol results require exact source review, not a claim
of no callers. Obtain independent native source review before any privileged
probe. Preserve unrelated VM processes, witness identity and existing worktrees.

## Verification

For image bytes, run `python3 -B -m unittest discover -s tests/agents -p test_ge04_oci_image.py -v`.
Read `docs/security/ge04-oci-qualification-image.md`; keep image construction
separate from effective runtime policy, unpacked-root custody and native launch.
The verifier accepts only exact built-in dictionaries, never arbitrary mapping
proxies/subclasses; a trusted caller may copy the builder's known private proxy.

Run `python3 -m unittest discover -s tests/agents -p test_ge04_native_stream.py -v`.
For the incomplete runtime-view fixture, read
`docs/security/ge04-runtime-view-qualification.md`; run only the unprivileged
`python3 -B -m unittest discover -s tests/agents -p test_ge04_runtime_view.py -v`.
Its live controller is unimplemented and root admission refuses, even with
staging and flags. Local parser/refusal success does not qualify namespace views.
For the closed cgroup fixture, read
`docs/security/ge04-cgroup-worker-qualification.md` and run its local command
first. Its privileged staged command requires both explicit qualification flags
and independent native source/root-scope review. Unknown/changed ownership leaves
the exact unit/journal quarantined; report it rather than claiming cleanup.
Local skips are not cross-UID qualification. Root cases require explicit flags,
the reviewed synthetic scope on the designated disposable VM, exact source
hashes and saved before/after witness and cleanup observations. Never run them
on a production or personal credential host. Preserve failures and raw logs.

## Child DOX Index

None.
