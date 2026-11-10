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
- The local read-only runtime-view Python suite has **27/27 passing tests**
  for stage validation, bounded diagnostics, pidfd/procfs sampling, namespace
  links, supplied unit/mount/keeper/cgroup records, bounded dirfd cgroup
  observations, exact six-phase cgroup membership grammar, and terminal/crash
  transcript consistency for all eight closed modes. A further read-only
  composite check observes the actual unprivileged keeper PID/starttime via
  pidfd, its namespace links, its /proc/<pid>/mountinfo and supplied cgroup
  directory bytes, comparing before/after. Result is explicitly
  UNQUALIFIED_OBSERVATION; the cgroup files are local fixtures and no protected
  bootstrap/systemd identity is established. No privileged run.
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
