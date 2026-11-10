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
- `bootstrap_binding.py`: read-only receipt of a strictly canonical, fully
  sealed Linux memfd passed as a descriptor. It checks immutable bytes,
  mode/owner/inode and fixed claims but has **no authenticated publisher**;
  unprivileged process handoff in tests is transport plumbing, not root
  bootstrap or unit custody. Output is UNQUALIFIED only. No production caller.
- `protected-mount-namespace.[ch]`: Phase 4A3 candidate native
  root-gated keeper/controller mount namespace descriptors and bounded
  mountinfo provenance compared against original cgroup2 mount ID.
  Refuses namespace substitution and remains UNQUALIFIED; no birth-time
  custody, immutable privileged source, setns/mount or ACK. See
  `docs/security/ge04-protected-root-controller-phase4a3.md`.
- `protected-cgroup-custody.[ch]`: Phase 4A2 native root-only source
  for retaining three no-follow cgroup2 directory descriptors, comparing
  stable inode/device/statx mount IDs and original keeper generation.
  Always UNQUALIFIED: post-observed directories do not prove birth-time
  mount namespace, original cgroup provenance, or worker authority.
  No enabled root entrypoint or ACK. See
  `docs/security/ge04-protected-root-controller-phase4a2.md`.
- `protected-keeper-custody.[ch]`: Phase 4A1 production-intended C
  source for retaining a pidfd, bounded procfs keeper startticks and exact
  fixed-unit cgroup, bracketed by original transaction rechecks. Always
  UNQUALIFIED: cannot prove new birth or original cgroup/mount ancestry.
  Root entrypoint and ACK disabled. See
  `docs/security/ge04-protected-root-controller-phase4a1.md`.
- `protected-systemd-birth-observer.[ch]`: Phase 3B3A native read-only
  systemd post-job observation with original transaction rechecks and two
  stable fixed-unit/keeper PID/invocation snapshots. Always UNQUALIFIED;
  observations cannot prove new unit birth, pidfd/mount/cgroup custody,
  trusted request dispatch or ACK. No privileged entrypoint enabled.
  See `docs/security/ge04-protected-root-controller-phase3b3a.md`.
- `protected-systemd-request.[ch]`: Phase 3B2 native fixed
  StartTransientUnit payload serializer with literal fixed unit, fail mode,
  Type=exec, NoNewPrivileges/Delegate, one UNINSTALLED keeper path and no
  auxiliary units. Caller-supplied message only; no bus connection, request
  dispatch, trusted cookie, keeper launch, ACK or enabled controller.
  See `docs/security/ge04-protected-root-controller-phase3b2.md`.
- `protected-systemd-transaction.[ch]`: Phase 3A/3B1 production-intended
  libsystemd C source for pinned root-owned systemd manager, original
  fence/journal custody, pre-request JobRemoved subscription and bounded
  queued dispatch; now holds one method reply cookie and exact job path
  and correlates early/late matching JobRemoved, poisoning substitutions
  and replay. No trusted request sender sets the cookie; StartTransientUnit
  creation still ALWAYS returns EPERM, no worker admission or ACK.
  Controller entrypoint remains disabled. See
  `docs/security/ge04-protected-root-controller-phase3a.md` and
  `docs/security/ge04-protected-root-controller-phase3b1.md`.
- `protected-attempt-fence.[ch]`: Phase 2 production-intended C source
  for kernel-derived boot ID, getrandom nonce, first-attempt-only root 0600
  O_EXCL journal and fsynced held descriptor custody. No retry, rollover,
  recovery, independent source hashes, root execution or unit creation.
  Existing prebirth stage now REQUIRES the matching held fence before and
  after staging. Controller entrypoint still always exits 77. See
  `docs/security/ge04-protected-root-controller-phase2.md`.
- `protected-root-controller.c` plus `protected-prebirth-journal.[ch]`:
  first production-intended native root-controller SOURCE CANDIDATE.
  Default controller entrypoint unconditionally returns 77. The separate
  C library encodes canonical prebirth claims and has a fixed root-only
  exclusive journal create/fsync/recheck primitive, NEVER linked to an
  activated privileged entrypoint. No root run, service creation, issuer
  provenance, cleanup, ACK or staging clearance. Independently review
  exact source before root use. See
  `docs/security/ge04-protected-root-controller-phase1.md`.
- `protected_owner_review_boundary.py`: fail-closed review-only gate map
  for protected issuer, exclusive birth, trusted job/kernel custody, ACK,
  approved VM and independent signoff. Caller-asserted passes are NEVER
  authority; all publish/create/ACK/recover/admit methods refuse. No root
  controller implementation. See
  `docs/security/ge04-protected-transaction-owner-contract.md`.
- `transaction_consumption_fixture.py`: unprivileged user-owned
  O_EXCL consumption marker written and fsynced BEFORE cross-source
  packet checking; failed/crashed/reopened attempts quarantine and cannot
  retry in the same directory. Same UID can remove marker: not protected
  durable replay authority. Root execution and ACK denied. See
  `docs/security/ge04-transaction-consumption-fixture.md`.
- `cross_source_birth_reconciliation.py`: pure, one-use reconciliation
  of canonical original/journal, manager/job, bounded live signal summary,
  postbirth and kernel keeper/mount claims. All sources are caller-supplied
  and possibly forged; no independent custody, durable replay lock or ACK.
  See `docs/security/ge04-cross-source-birth-reconciliation.md`.
- `bounded_job_signal_observer.py` / `isolated_job_signal_worker.py`:
  isolate read-only systemd JobRemoved observation in a non-root subprocess
  with an absolute <=3s parent deadline, capped canonical pipes and kill/reap
  on stalls including synchronous D-Bus setup/cleanup. The expected job and
  worktree source are untrusted; output stays UNQUALIFIED with no ACK.
  See `docs/security/ge04-bounded-job-signal-observer.md`.
- `systemd_job_signal_observer.py`: short, unprivileged GLib/D-Bus
  subscription to the actual root-owned systemd JobRemoved signal for an
  expected caller-supplied job, with fixed sender/path/job validation and
  best-effort unsubscribe. No original trusted creation, hard process-wide
  timeout, authority or ACK. See
  `docs/security/ge04-systemd-live-job-signal-observation.md`.
- `systemd_job_event_contract.py`: pure one-use JobRemoved shape check for
  exact job ID/path, expected manager unique sender, fixed unit, and done
  outcome; all caller-supplied events remain forgeable and UNQUALIFIED.
  No actual bus subscription, unit creation, or phase authority. See
  `docs/security/ge04-systemd-job-event-correlation.md`.
- `exclusive_birth_handoff.py`: pure non-authorizing PREBIRTH_OBSERVED →
  CREATION_CLAIMED → JOB_COMPLETION_CLAIMED → BIRTH_CORRELATED contract. A fixed `fail`-mode
  StartTransientUnit job path is caller-supplied, not authenticated and
  cannot prove exclusive creation. Replay/ambiguity quarantines and all
  create/ACK/recover methods refuse. See
  `docs/security/ge04-exclusive-birth-handoff.md`.
- `systemd_absence_observer.py`: read-only pinned root-owned systemd bus
  negative checks for both fixed GetUnit and GetUnitFileState twice. Output
  remains UNQUALIFIED and cannot lock or reserve the missing unit. The
  unprivileged fixture can use this observer before/after journaling; no
  privileged source or ACK is enabled. See
  `docs/security/ge04-systemd-absence-observation.md`.
- `systemd_unit_observer.py`: read-only fixed-unit system D-Bus query pinned to
  root-owned unique bus owner, exact object path and stable Unit/Service
  property snapshots. Does not create/adopt units or prove original birth;
  output UNQUALIFIED only. No production consumer.
- `protected_approval_observer.py`: read-only exact original C fixture
  `approval.v1` and `.lock` root-owned path/file custody corroboration against
  supplied original invocation and parent cgroup inode, checked before/after
  isolated manager/kernel observation. No original pre-birth provenance,
  privileged reader, root publisher or ACK authority. See
  `docs/security/ge04-existing-root-approval-custody.md`.
- `bounded_phase_observer.py` and `isolated_phase_observer_worker.py`:
  separate unprivileged `python -I` read-only manager/kernel observation with
  a bounded hard deadline, incrementally limited stdout, kill/reap on timeout,
  and strict canonical witness refusal. Worktree source custody remains
  untrusted; no production ACK, privileges or protected publisher.
  See `docs/security/ge04-bounded-isolated-phase-observer.md`.
- `phase_controller.py`: read-only, non-authorizing six-phase diagnostic
  ordering and manager/kernel corroboration prototype. The canonical original
  is caller-supplied, callbacks are not trusted, and EMPTY/DENIED quarantine;
  `issue_ack` unconditionally refuses. Never wire into privileged native IPC.
  See `docs/security/ge04-readonly-phase-controller.md`.
- `unit_kernel_observer.py`: non-authorizing read-only manager + kernel
  correlation of the fixed existing unit. It compares supplied original
  keeper/mount/cgroup identities against pidfd/procfs and directory-bound
  cgroup observations, then resamples manager. Positive tests use fixtures;
  no unit is created, no protected original custody or ACK is established.
- `prebirth_fixture_journal.py`: unprivileged disposable-directory-only
  exclusive prebirth write/fsync/dir-fsync and non-adopting reopen contract.
  Root execution is denied; unit-absence callback is not authenticated.
  Failure preserves partial state as quarantine, without cleanup or retry.
  See `docs/security/ge04-unprivileged-prebirth-journal-fixture.md`.
- `prebirth_issuance_contract.py`: pure two-stage PREBIRTH-before-unit,
  BIRTH_OBSERVED-after-new-unit diagnostic contract with explicit
  boot/attempt/nonce fencing and irreversible ambiguity quarantine. All
  original absence/durability claims are caller-supplied; it never writes
  a journal, creates a unit, grants approval or issues ACK. See
  `docs/security/ge04-original-prebirth-issuance.md`.
- `bootstrap_publisher.py`: qualification-only, unprivileged three-record
  prebirth/manager/kernel reconciliation and test-only sealed memfd. Neither
  source callback is authenticated; the root publisher is an unconditional
  refusal. No stage or production consumer. See
  `docs/security/ge04-bootstrap-publisher-contract.md`.
- `bootstrap_receiver.py`: single-use read-only UNIX seqpacket SCM_RIGHTS
  receiver with kernel SO_PEERCRED comparison and callback process-generation
  fence. The expected publisher/FD identity must originate outside the
  receiver from separately protected controller custody; tests do not prove
  that source. Output is UNQUALIFIED and all received FDs are closed.
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
  exclusive outer cgroup. Ordinary C builds now return 77 before root setup
  for every valid mode; only an explicitly reviewed disposable-VM-specific
  compile macro can include its privileged path. That macro is NOT approval.
  `tests/agents/test_ge04_native_default_hold.py` checks default refusal.
  Native ACK input is now an exact invocation/phase/sequence frame, not a
  bare `c`; this is protocol integrity, NOT sender authentication. The
  unprivileged inert C probe in `tests/fixtures/ge04-ack-frame-probe.c` and
  `tests/agents/test_ge04_native_ack_frame.py` exercise only the frame reader.
  See `docs/security/ge04-native-phase-ack-contract.md`.
  `tests/agents/test_ge04_runtime_view.py` currently
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
