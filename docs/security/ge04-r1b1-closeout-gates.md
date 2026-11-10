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

## Real read-only systemd manager observation — not original authority

`native/ge04/systemd_unit_observer.py` adds a fixed-unit **system D-Bus**
GetUnit/GetAll observation pinned to a root-owned unique bus name, exact
object path, exact loaded/active/running state, zero service restarts, fixed
control group and stable repeated Unit/Service properties. On the current
unprivileged host it reports NoSuchUnit, as expected: the qualification unit
was not created or adopted. Four local tests verify property refusals and
actual absent-unit behavior. The returned status remains
`UNQUALIFIED_SYSTEMD_MANAGER_OBSERVATION` and cannot authorize a phase ACK.
Current manager properties are not an independently published prebirth intent,
unit-creation witness, keeper pidfd, cgroup custody or crash-recovery proof.
B1-B and subsequent security gates are not cleared. SECURITY HOLD ACTIVE.

## Fixed manager + live kernel read-only correlation (qualification only)

Added `native/ge04/unit_kernel_observer.py` to correlate current read-only
systemd bus properties with a separately supplied original unit/keeper/mount
claim and real process pidfd/procfs/cgroup observations. It requires exact
unit scope, keeper start generation, single cgroup2 keeper mount and held
root/system.slice/unit dir identities with keeper PID membership, and repeats
manager/kernel observations after the read. Positive tests use fake procfs
and a synthetic directory tree because the real fixed qualification unit is
absent. There is no protected source for original identity, no privileged
controller, no unit birth, no phase ACK or cleanup/recovery acceptance. Any
successful observation remains UNQUALIFIED. GE-04 SECURITY HOLD ACTIVE.

## Native default-build entry refusal and source preaudit

The closed `cgroup-runtime-view-qualification.c` helper is **default disabled
at compile time**, returning 77 for every valid mode before root setup unless
`GE04_REVIEWED_DISPOSABLE_VM_QUALIFICATION` is explicitly defined. That macro
must never be enabled by routine builds and is NOT approval for a privileged
run. Local `test_ge04_native_default_hold.py` compiles a regular default
binary and confirms denial on eight fixed modes plus invalid mode 64. The
post-change native source hash is
`cb9a26c76e9e35199dac8326a0110739c401fb6733c0324202ecdae507a9a98d`.
See `docs/security/ge04-native-controller-source-preaudit.md` for the exact
high-risk ACK, prebirth custody, destructive cleanup and orphan windows
requiring independent review. The native source hash changed and **must be
reviewed afresh** before any approved VM execution. A separate Codex model
review of the default-deny diff found a macOS test-discovery defect, now
fixed with a Linux-only skip. No independent C security signoff or Q13.

## Recovery sweep original-intent no-adoption guard

The closed C helper's `sweep_empty` now **refuses an existing `worker-*` outer
cgroup without a matching canonical `intent.tmp`**, rather than adopting the
only directory discovered by a scan. The required intent must match the
original invocation/parent plus the outer name, device and inode before
`open_outer` or destructive cleanup. The default-build native hold still
returns exit 77 for every valid mode. A Linux-only source-level guard test
passes, but privileged recovery, crash windows and independent source
review remain OPEN. No release or cleanup authority follows.

## Final destructive-boundary custody recheck (engineering only)

The native `cleanup_until` now refuses missing pinned original ownership
(`!c->owned`) instead of reporting success. In its published path it repeats
protected binding/lock/intent/held kill-FD checks, enumerates the expected
immediate child groups and rechecks their directory identities immediately
before `cgroup.kill`. Three focused native hold/source tests pass, with the
default native build still returning 77 before any privileged setup. The
rechecks are not atomic with the mutation and cannot substitute for protected
exclusive custody, external review or approved root VM qualification. B1-F
remains OPEN, GE-04 SECURITY HOLD ACTIVE.

## Native phase-specific ACK framing (protocol contract only)

The native fixture now refuses the old single-byte `c` and instead consumes
an exact bounded `GE04ACK1` line binding the helper's fixed invocation,
current phase, and locally monotonic sequence. It rejects duplicate,
replayed, wrong-phase, wrong-invocation, malformed or extraneous queued
frames. `test_ge04_native_ack_frame.py` tests the actual compiled C reader
using an inert unprivileged probe, not the root entry or a systemd unit.
**This is not an authenticated ACK**: a process controlling stdin can forge
all public fields. There remains no protected phase observer, original birth
receipt, unit-owner exclusivity, or root admission authority. The C source
hash changes and must undergo independent review again. B1-E OPEN,
SECURITY HOLD ACTIVE. See `ge04-native-phase-ack-contract.md`.

## Read-only controller-side phase state (unqualified)

`native/ge04/phase_controller.py` adds a closed six-phase ordering and
read-only manager/kernel-correlation prototype. It canonicalizes a *supplied*
original binding, refuses malformed/reordered/stale diagnostics, checks
original keeper against the read-only witness, and poisons on missing or
expired evidence. DENIED and EMPTY both remain quarantined; no cleanup or
recovery is presumed. Its `issue_ack()` unconditionally raises and the
module has no socket/FD writer, root caller or worker admission. Six synthetic
controller tests pass. Neither the supplied original nor observer callback
has externally protected provenance; callback execution lacks a hard timeout.
This is **not** B1-E ACK authorization, root-controller integration or source
security approval. GE-04 SECURITY HOLD ACTIVE.

## Bounded isolated read-only phase observation (non-authorizing)

The default phase-controller observation now runs in an **unprivileged**
`python -I` child under an absolute monotonic deadline of at most 3 seconds.
The parent sends only a canonical capped original-record request, reads
stdout incrementally with a hard 1,024-byte ceiling, kills/reaps a hung
observer, and refuses any nonzero exit, missing/late/noncanonical output or
keeper-generation mismatch. No native ACK, root publisher or production
admission is implemented. The worktree Python source is still user-writable,
original prebirth intent is caller-provided, and injected test callbacks are
unbounded; no authenticated authority emerges. This mitigates local hanging
observation, not bootstrap trust, privileged recovery or root-source review.
See `ge04-bounded-isolated-phase-observer.md`. B1-B/E/F OPEN;
SECURITY HOLD ACTIVE.

## Existing root approval-file custody precondition (read-only)

Added `native/ge04/protected_approval_observer.py` to refuse absent,
inaccessible, malformed, substituted or changing fixed original
`/run/ge04-view-qualification/approval.v1` and `.lock` against a supplied
invocation and original parent cgroup dev/inode, traversing root-owned
no-follow directory chains and checking exact file modes, links and identity
before/after reading. The isolated read-only observer now corroborates this
existing approval **before and after** systemd/kernel observation. Local
positive tests mock root ownership explicitly; this host has no fixed
qualification unit or approval, and no privileged read is attempted.
This current-file check does not prove approval existed before unit birth,
that an authorized bootstrap wrote it, or that the full sealed receipt has
protected provenance. It may remain inaccessible to unprivileged observers;
loosening permissions or running this worktree as root is prohibited. No ACK,
source-root review, VM qualification or Q13. B1-B/D/E OPEN; GE-04 HOLD ACTIVE.

## Distinct original pre-birth issuance vs post-birth cgroup approval

The native `approval.v1` includes the unit cgroup inode, which can only be
obtained after a genuinely new systemd service creates that cgroup. A
post-birth approval record cannot itself prove authorization existed *before*
unit creation. Added `native/ge04/prebirth_issuance_contract.py`, a pure
in-memory two-stage contract requiring PREBIRTH (fixed unit absent, durable
original attempt/boot ID/nonce and reviewed digests) before BIRTH_OBSERVED
(authenticated-manager/kernel facts would have to match the original), with
quarantine on ambiguous birth, replay, restart, failed or crashed transition.
All claims in this prototype are caller-supplied assertions, including the
absence/durability booleans: it proves **no protected root authority**.
`issue_approval`, `issue_ack`, and `recover` unconditionally refuse.
The full separate root-owned journal and exact new-unit birth implementation
remain B1-B/D blockers; this module has no privileges, file write, D-Bus
mutation, cleanup or production caller. See
`docs/security/ge04-original-prebirth-issuance.md`. SECURITY HOLD ACTIVE.

## Exclusive prebirth fixture journal and crash-window refusals

Added `native/ge04/prebirth_fixture_journal.py`: a **test-only unprivileged**
private-directory contract that atomically claims one fixed prebirth journal
name with `O_EXCL|O_NOFOLLOW`, writes strict canonical attempt claims,
`fsync`s file and directory, and rejects any subsequent open as
`UNQUALIFIED_QUARANTINE_ON_REOPEN`. Failure after write/file fsync/directory
fsync preserves uncertainty rather than deleting or retrying the record.
Seven fixture tests exercise interruption windows, wrong modes/symlink,
missing absence claims, malformed and already-existing journals. Unit
absence and durable publication are not independently authenticated:
the directory is user-owned and the callback is test-controlled. This
neither creates a systemd unit nor enables root issuance/ACK/recovery.
The protected root-owned journal, manager creation and Q13 remain B1-B/D
blockers. See `ge04-unprivileged-prebirth-journal-fixture.md`.
GE-04 SECURITY HOLD ACTIVE.

## Real read-only systemd absence probe — not exclusive unit birth

Added `native/ge04/systemd_absence_observer.py`: pins the root-owned unique
systemd system-bus owner and requires exact negative GetUnit and
GetUnitFileState responses for the fixed unit twice, rejecting any installed,
loaded, restarted/changed-owner, ambiguous or unavailable state. The optional
`publish_observed_fixture_once` runs this actual read-only manager check
before and after an unprivileged original fixture journal fsync. There is
still NO atomic absence-to-exclusive-create transaction or authenticated
prebirth issuer; any concurrent systemd unit creation after an observation
remains possible. No privileged service action or ACK. The positive result
is UNQUALIFIED only. B1-B and human Q13 still OPEN, SECURITY HOLD ACTIVE.

## Exclusive birth handoff ordering contract — NOT systemd authority

Added `native/ge04/exclusive_birth_handoff.py`, a pure nonprivileged
sequence requiring original byte-exact prebirth journal and manager-owner
absence, a single caller-claimed `StartTransientUnit` request with `fail`
mode, an exactly bound claimed systemd job `done` completion, then a
consistent observed fixed unit invocation, keeper PID and zero restarts.
Wrong job path/manager owner, nonce/attempt/digest, failed/missing/replayed
completion, manager changes or repeated birth always quarantine. The output
remains `UNQUALIFIED_BIRTH_HANDOFF_CORRELATION`; `create_unit`, `issue_ack`
and `recover` always refuse. **Neither job issuance nor job completion is
obtained from an authenticated systemd transaction**; this code does not
perform exclusive creation or prove origin. It is a review contract only.
See `ge04-exclusive-birth-handoff.md`. B1-B/E/H and Q13 remain OPEN;
GE-04 SECURITY HOLD ACTIVE.
