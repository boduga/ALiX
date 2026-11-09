# GE-04 Native Boundaries

## Purpose

Linux native qualification components. GE-04 SECURITY HOLD remains active.
These files do not provide production worker or broker admission.

## Ownership

- `worker-stream.h` and `worker-stream.c`: bounded AF_UNIX byte-stream framing,
  native acceptance, pidfd/process-generation and per-fragment sender checks.
  Trusted callers must supply independently protected registration authority;
  numeric PID arguments alone do not supply it. No production caller exists.
- Other C files: separate pinned-executable, launcher, pidfd, peercred and
  cgroup qualification probes. Their outputs are diagnostic evidence for
  documented tests, not interchangeable authorization or release grants.
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

## Work Guidance

Read `docs/security/ge04-native-stream-transport.md` before changing stream
semantics. Run GitNexus impact before edits and detect_changes before commits;
cross-language/missing-symbol results require exact source review, not a claim
of no callers. Obtain independent native source review before any privileged
probe. Preserve unrelated VM processes, witness identity and existing worktrees.

## Verification

Run `python3 -m unittest discover -s tests/agents -p test_ge04_native_stream.py -v`.
Local skips are not cross-UID qualification. Root cases require explicit flags,
the reviewed synthetic scope on the designated disposable VM, exact source
hashes and saved before/after witness and cleanup observations. Never run them
on a production or personal credential host. Preserve failures and raw logs.

## Child DOX Index

None.
