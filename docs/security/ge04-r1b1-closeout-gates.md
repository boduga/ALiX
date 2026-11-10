# GE-04 R1-B1 closeout gates and final qualification packet

**State:** ENGINEERING IN PROGRESS — SECURITY HOLD ACTIVE.
**Branch:** `fix/ge04-r1b1-mandatory-supervisor`.
**Proposed architecture:** ADR-0019 remains PROPOSED.
**Approval:** No independent security approval has been granted.
**Scope:** This packet is an executable-review checklist, not authority to run
privileged commands, register workers, remove quarantine or deploy anything.

## Implemented and verified (non-authorizing)

- The production-facing `TaskWorkerSupervisor` seam is mandatory and
  unavailable by default, not a native production implementation.
- `native/ge04/cgroup-runtime-view-qualification.c` is a fixed, closed,
  synthetic qualification helper, **not** production source or a service.
- The local read-only runtime-view Python suite has **32/32 passing tests**
  for stage validation, bounded diagnostics, pidfd/procfs sampling, namespace
  links, supplied unit/mount/keeper/cgroup records, bounded dirfd cgroup
  observations, exact six-phase cgroup membership grammar, and terminal/crash
  transcript consistency for all eight closed modes. A further read-only
  composite check observes the actual unprivileged keeper PID/starttime via
  pidfd, its namespace links, its /proc/<pid>/mountinfo and supplied cgroup
  directory bytes, comparing before/after. Result is explicitly
  UNQUALIFIED_OBSERVATION; the cgroup files are local fixtures and no protected
  bootstrap/systemd identity is established. The composite now requires distinct
  expected and observed records and refuses changes during inspection. A
  separate unprivileged test samples the **real current cgroup v2 subtree**
  (mount device, process scope, inodes, membership and counters), returning
  `UNQUALIFIED_LIVE_KERNEL_VIEW`, not exclusive worker custody. No privileged run.
- `evaluate_closed_qualification_transcript` is deliberately limited to
  `LOCAL_CONTRACT_ONLY` and `QUARANTINE_PENDING_RECOVERY`. Its input is
  caller-supplied; it never grants an ACK, registers a worker, proves cleanup
  or releases authority.

## Blocking implementation gates (all must be satisfied)

| Gate | Evidence that must exist | Explicit denial condition |
| --- | --- | --- |
| B1-A: source identity | Reviewer freezes native helper and root-controller source/binary SHA-256 and approved compiler/runtime | Any changes after review, unsupported toolchain, unknown binary |
| B1-B: unit identity | Trusted external root bootstrap creates **new** fixed qualification unit, captures invocation ID and keeper generation from authenticated systemd manager, verifies absence before creation | Existing/adopted/restarted unit, changed invocation or unavailable keeper |
| B1-C: mount identity | Independent controller binds cgroup2 mount namespace, mount ID, superblock and mount root to trusted boot/unit evidence using held kernel resources | Text-only or self-supplied identity, mount substitution or unknown mount ID |
| B1-D: original cgroup custody | Protected original unit/outer/launcher/payload cgroup descriptors, exclusive owner and immutable pre-birth intent match kernel state at every decision boundary | Extra members, changed directory or parent, weak delegation, adopted subtree |
| B1-E: full phase observer | Independently checks kernel proc status/pidfd, namespace, root mount, FD targets, cgroup procs/controllers/limits at INTENT, PRE_NAMESPACE, PINNED, ENABLED, PRE_JOIN, READY | Missing/ambiguous observation, phase diagnostic treated as proof |
| B1-F: terminal and recovery | EMPTY, DENIED, recover and sweep independently corroborated, subtree/descendants empty after cleanup, immutable journal and exact attempt-generation fencing | Loss of custody, timeout, partition, ambiguous kill, unsupported recovery |
| B1-G: privilege controls | Separately reviewed root staging, single purpose disposable Linux x86-64 VM, reviewed source hashes, approved scripts, captured before/after witness and stop conditions | Running unreviewed repo checkout as root, shared-unit cleanup, missing original receipt |
| B1-H: independent acceptance | Independent security reviewer inspects raw logs, negative cases, surviving witness, original hashes and explicit release-gate outcomes | Agent/CI-only signoff, synthetic tests or draft PR substituted for approval |

Gate dependencies: **A → B/C/D → E/F → G → H**.
No gate is cleared by a passing local Python test, a kernel-capability discovery
result, an OCI digest, a successful build or GitHub CI.

## Required adversarial matrix (must collect raw evidence)

- Three fault modes: crash before namespace, after PINNED, after READY; no
  falsely successful restart or orphan adoption.
- Fail mount and fail controller-enable, each with prerequisite kernel
  observation and exact postcleanup evidence.
- Lost private journal, changed invocation, lost keeper, changed unit/outer
  cgroup inode, changed cgroup mount, unexpected extra PID, unknown child,
  missing/extra inherited FD and namespace/root replacement.
- Refuse on cgroup cleanup ambiguity, PID reuse, partial pipe read, phase
  reorder, read timeout, failed witness validation, and lack of original
  stage receipt.
- For each case preserve the precondition, command, stdout/stderr, exit status,
  process/cgroup before/after snapshots, expected vs observed, witness identity,
  reviewer disposition and whether quarantine remains.

## Immediate engineering work queue (one reviewed change set)

1. Implement a *separate read-only protected observer* receiving an original
   independently held bootstrap binding, **not** generating its own expected
   identities from self-inspection. The current local observer functions may
   be reused only after source review, without crossing into production.
2. Implement explicit handling for EMPTY/DENIED, protected cleanup and
   crash/recovery uncertainty; make no numeric PID or shared-cgroup fallback.
3. Review both programs together, including single-budget syscall/IPC failure,
   fd closure, namespace/mount race and proof of no restricted execution before
   admission. Do not remove the unconditional root refusal until this review
   authorizes a specific staged VM procedure.
4. Run the approved disposable-VM protocol and obtain independent raw-evidence
   security acceptance before calling R1-B1 complete.

**Final decision at this checkpoint:** R1-B1 OPEN, GE-04 SECURITY HOLD ACTIVE.

## Read-only phase/terminal correlation checkpoint (2026-11-09)

The local contract now independently **reads** three held directory-file
snapshots for the six preterminal phase schemas and refuses changing ancestry,
missing/extra cgroup members, wrong populated/controller values and unstopped
root-child process observations. Tests use synthetic directory files and
mocked stopped-child generation; they do not qualify a real delegated unit.
`EMPTY` samples three empty membership/event states twice; `DENIED` stays
quarantined. Both are **diagnostics only** and cannot prove exclusive cleanup,
original prebirth intent, witness custody, removed descendants or permission
for retry. No ACK writer or root controller is enabled.

Engineering checks: runtime-view Python **32/32 PASS**, OCI-image **18/18
PASS**, three focused supervisor Vitest files **36/36 PASS**, TypeScript and
DOX **PASS**. A separate read-only Codex review of the uncommitted slice found
no actionable regressions in the added changes but reproduced a pre-existing,
environment-dependent live self-cgroup fixture rejection on the baseline
(`parse_cgroup_procs: Invalid member`). This is a *test-stability review item*,
not an approved security exception. Reviewer was a model, not an independent
human security authority. Original bootstrap provenance, privileged controlled
phase ACK, crash/cleanup qualification and Gate H remain OPEN.

## Sealed original-binding descriptor contract (engineering only)

New `native/ge04/bootstrap_binding.py` accepts a bounded canonical bootstrap
record over a fully sealed read-only Linux memfd, with expected UID/GID,
optional inode and stable descriptor checks. A separate unprivileged process
transfers the sealed descriptor in tests over UNIX `SCM_RIGHTS` without granting
root, systemd or kernel authority. Its only status is
`UNQUALIFIED_SEALED_BOOTSTRAP`. Four local tests cover transport, mutation,
wrong owner, malformed fields, and strict canonical bytes. A read-only Codex
engineering review found two portability/identity issues (unsupported
platform imports; UID/GID equality assumption); both were corrected. The
review is not independent human security acceptance.

**Gates still open:** Protected root bootstrap publisher and original intent
publication, authenticated systemd unit/invocation/keeper generation, trusted
mount/superblock pinning, independent live root phase ACK, real cleanup and
crash recovery, external source review, disposable-VM qualification and Q13.
Sealed bytes and a nonce do not authenticate origin or prevent replay without
separate protected custody/fencing. SECURITY HOLD remains active.

## Local kernel peercred bootstrap handoff — non-authorizing

`native/ge04/bootstrap_receiver.py` adds a bounded, one-shot, read-only UNIX
SOCK_SEQPACKET receiver for the sealed bootstrap memfd. It rejects a mismatch
against *separately supplied* expected peer PID/UID/GID/startticks, kernel
SO_PEERCRED, exact one-FD SCM_RIGHTS framing, original FD inode, nonce and
attempt. It closes the owned socket and every received FD even on early
invalid input, timeout, truncated/extra ancillary or bad records; the
separate model review found and led to fixes for a Windows test import and
socket-ownership failure path. Tests use same-user same-process peer creds,
not a real root publisher. A caller-provided generation inspector and expected
PID/inode do not provide independent trust. The returned status is
`UNQUALIFIED_KERNEL_PEER_HANDOFF`, not an ACK. Protected root publication,
pre-birth original record, independently pinned mount/systemd unit and
human-reviewed VM qualification are still missing. SECURITY HOLD ACTIVE.

## Prebirth / manager / kernel publisher reconciliation (contract only)

Added `native/ge04/bootstrap_publisher.py` with pure canonical reconciliation
of distinct supplied prebirth, fixed systemd-manager snapshot, and Linux
kernel records. Rejects unexpected unit/scope, inactive or restarted unit,
keeper generation, unexpected mount/cgroup ancestry, missing unit, malformed
nonce/source hashes, and changes across samples. An unprivileged-only fixture
can serialize the record as a sealed memfd; root publication *unconditionally
refuses*. Six local tests exercise positive synthetic, each changed manager/
kernel field, invalid original fencing, source changes and root refusal.

This is not a secure publisher: all three records and observation callbacks
remain caller-supplied. No authenticated manager connection, protected original
journal or root-controlled unit birth, independently held cgroup/mount
identity, privileged controller/phase ACK, crash recovery or cleanup exists.
See `docs/security/ge04-bootstrap-publisher-contract.md`. R1-B1 OPEN;
SECURITY HOLD ACTIVE.
