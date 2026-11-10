# GE-04 R1-B1 — Phase 3B4C protected-dispatch qualification packet

**Decision: NO-GO · all B1-A–B1-H OPEN · SECURITY HOLD ACTIVE.**

This packet makes the pending **independent human review** actionable. It is
not human approval, an authorization to create a unit, or an instruction to
execute privileged commands. It governs draft PR #1100 and the immutable
root-controlled installation required *before* an approved disposable VM
qualification attempt. The executable `native/ge04/protected-root-controller.c`
must continue to exit 77 unconditionally until a separate explicit
authorization is granted.

## 1. Current trust boundary and source inventory

| Link | Native source | Current evidence | Verdict |
| --- | --- | --- | --- |
| Original one-shot boot/attempt | `protected-attempt-fence.[ch]` | Kernel boot ID, random nonce, O_EXCL first attempt; hashes are caller supplied | SOURCE ONLY |
| Pre-birth durability | `protected-prebirth-journal.[ch]` | Original file/directory FDs, fsync and exact content checks | SOURCE ONLY |
| Manager subscription | `protected-systemd-transaction.[ch]` | Pinned unique root-EUID manager, JobRemoved subscription and queued signal drain | SOURCE ONLY |
| Fixed method arguments | `protected-systemd-request.[ch]` | Fixed fail-mode unit/service properties; keeper path is NOT installed | SOURCE ONLY |
| Prepared request | `protected-dispatch-preparation.[ch]` | Local method message on held bus; send unconditionally EPERM | SOURCE ONLY |
| Irreversible pre-send intent | `protected-dispatch-intent.[ch]` | Root-only exclusive fsynced marker bound to claim/manager; no sent cookie | SOURCE ONLY |
| Reply/job correlation | `protected-systemd-transaction.[ch]` | Cookie/path/signal matching logic; request-in-flight never set in production | SOURCE ONLY |
| Post-job observations | `protected-systemd-birth-observer.[ch]` | Two consistent but explicitly UNQUALIFIED systemd snapshots | UNQUALIFIED |
| Keeper/cgroup/namespace | `protected-keeper-custody.[ch]`, `protected-cgroup-custody.[ch]`, `protected-mount-namespace.[ch]` | Post-observed pidfd, startticks and kernel directory/mount/namespace IDs | UNQUALIFIED |

All local source SHA-256 values in prior phase documents are **provisional**
and are invalidated by any edit, compiler change or changed linked library.
No approved binary hash, installation manifest, boot-chain measurement,
root-only filesystem provenance, or externally signed review is present.

## 2. Independently reviewable critical findings and decision questions

**F1 — Trusted binary and keeper provenance (BLOCKER).**
The candidate issuer is editable worktree source; the keeper path
`/usr/libexec/alix/ge04-qualification-keeper` is uninstalled. Reviewer must
approve a frozen source tree, toolchain/libsystemd versions, linker and
binary hashes, root-owned installation, symlink/mount protections, boot and
launch trust chain, and least-privilege service properties. Reject
worktree binaries and caller-supplied SHA values as proof.

**F2 — Atomic pre-request absence/exclusive birth (BLOCKER).**
The source has no authorized `StartTransientUnit` sender. A future issuer
must prove original manager generation, subscription, absent fixed unit and
non-adopting `fail` request within one protected lifetime. Negative
NoSuchUnit observation is not an atomic lock, and mode `fail` alone is
not proof of original creation. Require real manager reply and job
generation bound to that same creation request.

**F3 — Genuine outgoing request identity (BLOCKER).**
`request_in_flight` and `request_cookie` have no production sender.
The binder validates an incoming cookie only after those fields are set.
Reviewer must verify a *single* authorized send on the retained bus, the
kernel/system bus transport and peer credentials, the exact returned
request serial, and the handling of early JobRemoved, caller timeouts,
method errors, owner swaps and unexpected event floods. Do not allow
model/synthetic tests to set those fields in the privileged path.

**F4 — Crash/rollback and dispatch-intent ambiguity (BLOCKER).**
The original intent file says `PRE_SEND_INTENT`; after a crash it cannot
prove whether a send occurred. The one-shot design intentionally refuses
retry, but an unreviewed filesystem can lose or roll back the marker.
Approve protected anti-deletion/anti-rollback custody and a human-controlled
quarantine/recovery protocol, not marker deletion or in-place adoption.

**F5 — Original kernel custody (BLOCKER).**
The keeper pidfd, startticks, cgroup2 dirfds and mount namespace are
currently pinned *after* observing a unit. Reviewer must prove original
keeper process/launch and cgroup generation at creation time, including
original pidfd, cgroup2 mount/superblock/root and ancestor FD identity
under manager restarts, namespace substitution, PID reuse and service
restarts. Matching post-fact snapshots remain UNQUALIFIED.

**F6 — End-to-end bounded root lifetime (BLOCKER).**
A per-method D-Bus timeout is not a deadline for initial connection,
signals, journal fsync, cleanup or the entire transaction. Require an
independently supervising bounded root process, kill/reap semantics and
ambiguous terminal quarantine. No automatic retry after uncertainty.

**F7 — Release/ACK authority (BLOCKER).**
No authenticated six-phase ACK or final cleanup/recovery exists.
Before enabling worker admission, human review must confirm phase writer,
record owner, original keeper/cgroup ancestry per phase, root-controlled
signal provenance, and non-replayable receipt. Every error must refuse.

## 3. B1 gate-to-evidence handoff

| Gate | Evidence to produce, independently | Current verdict |
| --- | --- | --- |
| B1-A | Human-reviewed frozen source, toolchain and root-only staged binary/keeper, signed hashes and ownership verification | OPEN |
| B1-B: unit identity | Original boot/attempt, protected prebirth and dispatch intent, trusted **new** fixed-unit creation, original invocation/keeper identity, no adoption | OPEN |
| B1-C: mount identity | Independently pinned cgroup2 namespace, mount ID, superblock/root bound to original boot/unit evidence | OPEN |
| B1-D: original cgroup custody | Original protected cgroup unit/outer/launcher/payload FDs, ownership and durable intent rechecked at every boundary | OPEN |
| B1-E: full phase observer | Independent real proc/pidfd/namespace/mount/FD/cgroup checks for all six ordered phases | OPEN |
| B1-F: terminal/recovery | Independently corroborated EMPTY/DENIED/recovery/cleanup, no replay, immutable journal and exact attempt fencing | OPEN |
| B1-G: privilege controls | Separately approved immutable root staging, named single-use disposable VM, scripts, stop conditions and before/after witnesses | OPEN |
| B1-H: independent acceptance | Independent human security review of raw negative-case evidence, source hashes and explicit Q13 decision | OPEN |

These labels summarize the engineering evidence mapping; the authoritative
gate definitions remain in `ge04-r1b1-closeout-gates.md`. Neither a tool
nor this document can change a gate to PASS.

## 4. Required disposable-VM experiment design — NOT AUTHORIZED TO RUN

Create a **disposable, isolated Linux VM** only after a separate human
authorization names the exact VM, frozen source/binary digests and allowed
privileged actions. Do not use a workstation, home host, shared container,
production server or existing ALiX worker. Preserve machine state and
snapshots, the exact boot ID, systemd and kernel versions, secure time
reference, source signatures, raw journal bytes, bus trace, unit properties,
original pidfd/startticks, cgroup/mount FDs and phase witnesses.

Required cases: (a) absent-unit single birth; (b) pre-existing fixed unit;
(c) double issuer / concurrent create; (d) crash before intent fsync;
(e) crash after fsync before send; (f) crash between send and reply;
(g) JobRemoved before reply; (h) manager restart/owner swap; (i) PID reuse
or keeper exit; (j) cgroup mount/namespace replacement; (k) power loss or
marker rollback; (l) failed/duplicate phase ACK; (m) failed cleanup.
Each test must report original raw evidence, terminal state and an
independently checked **no adoption, no silent retry, no unintended ACK**
result. Ambiguity must quarantine. No single test may establish all gates.

No command in this packet grants permission to run such a VM test.

## 5. Human review and release workflow

1. Freeze reviewed source and exact dependency/toolchain lock.
2. Have a named independent human reviewer inspect F1–F7 and record
   per-finding PASS/FAIL with evidence hashes, objections and signatures.
3. Obtain separate human authorization for the named disposable VM and
   narrowly scoped privileged test plan; run only those approved actions.
4. Record raw witnesses and reproducible analysis for every negative case.
5. Require independent Q13 acceptance, then a distinct operational decision
   on whether to change the root-controller exit-77 hold.
6. Keep PR #1100 **draft**, do not merge or mark a security gate as PASS
   until the corresponding independent acceptance exists.

## 6. Local non-privileged guard

`tests/agents/test_ge04_protected_dispatch_hold.py` checks the current
source-level security hold and negative identity transitions. It is a
regression tripwire, **not** a proof of runtime trust. Re-run it after edits
and report any skipped/incomplete checks. GitNexus may not index C symbols;
an empty impact graph is an UNKNOWN, never proof of no effect.

## 7. Current engineering verification and review status

- Unprivileged protected GE-04 Python discovery: **37/37 passed**.
- Native default-hold test suite: **3/3 passed**; direct entrypoint
  continues to exit 77. Three new review-tripwire tests are included in
  the protected discovery total.
- Supervisor Vitest: **36/36 passed**.
- GitNexus impact/detect-changes queries timed out in this review session;
  blast radius is **UNKNOWN**, not low or safe. No C symbol coverage is
  established.
- Independent human reviewer, signed freeze, frozen keeper, approved root
  install, disposable-VM run, raw witnesses and Q13 acceptance: **NONE**.
- This is an author-prepared handoff, **not an independent security review**.

Do not turn a passed local check or a doc update into a security gate PASS.
