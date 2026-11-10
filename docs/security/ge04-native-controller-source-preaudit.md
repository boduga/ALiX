# GE-04 R1-B1 native controller security preaudit and release blocker

**State:** ENGINEERING PREAUDIT — NOT AN INDEPENDENT SECURITY SIGNOFF.
**Current decision:** R1-B1 OPEN · GE-04 SECURITY HOLD ACTIVE.
**Reviewed source baseline:** `native/ge04/cgroup-runtime-view-qualification.c`
SHA-256 `1a414741fd3087ea0aa432601fc693056b758c484b462b663bd1a2c08b655639`,
740 lines, from branch `fix/ge04-r1b1-mandatory-supervisor` commit `08f38db6`.
This is a source reference only, **not** a privileged staging receipt or a
signature. Any subsequent modification invalidates this preaudit baseline.

## Highest-priority design blockers

**G0 — No independent trusted ACK source.** `event_until` accepts one
literal `c` on stdin after an emitted phase diagnostic, within a budget
(lines ~238–263). There is no authenticated controller/publisher handshake
at this boundary. A local caller able to drive stdin could supply every
required byte without doing the separately protected unit/keeper/mount/cgroup
checks. Therefore successful fixture phase progression is **not** admission
evidence. **Fix requirement:** an independently reviewed, root-owned observer
holds original pre-birth publication and a tightly scoped one-use phase
channel, reconciles all live kernel facts, then provides an ACK only for the
observed attempt/phase. Until implemented, the root entry remains disabled.

**G1 — Original authorization/provenance not independently established.**
`approval` and `intent` validate canonical root-owned local records
(~142–166), and `bindings` validates their contents/inodes (~214–237).
They do not prove that the expected records were minted by a separately
authorized authority before the first child, that a *new* service was
created by that authority, or that same-process writers cannot replace
the expected record. Existing sealed-memfd, D-Bus and pidfd components
remain unqualified diagnostics. **Fix requirement:** independent source
of a pre-birth attempt/generation, trusted system bus Unit/Service
invocation, protected unit absence-and-birth receipt, sealed publisher
identity and observer-owned custody across the entire run.

**G2 — Destructive subtree operations must prove exclusive custody at
the last mutation boundary.** `cleanup_until` uses `cgroup.kill`
(~522–563) after inspecting known child directories and persisted intent.
Before any privileged attempt, independently verify that every target
directory FD, unit invocation, parent mount namespace, restart generation,
controller limits, original attempt and non-owned witness retain their
trusted identities **right at kill/unlink**. Failure, unknown occupant,
unit restart or missing durable journal => quarantine, never fallback
ancestor kill or numeric-PID kill. Synthetic fixture tests do not prove
this against real descendants or injected crash recovery.

**G3 — Failure between birth and custody must be addressed.** In `main`
(~659–740), the fixed outer directory is created with `mkdirat`;
the immediate `open_outer` failure jumps to the terminal result without
a definitely owned `c->outer` / published intent. This refuses further
execution, but may strand a newly created directory for later sweep.
**Review requirement:** prove the pre-birth original journal, idempotent
recovery and orphan handling for *every* syscall boundary, including
mkdir/open/publish/fsync failures. No blind cleanup of names inferred from
a directory scan. Whether the current fallback can safely recover all
such windows needs independently reviewed proof.

**G4 — Full kernel namespace and mount witness pending.** Closed helper
pins some namespace descriptors and checks procfs/cgroup2, but a
separately trusted controller must establish the current unit's mount
namespace, mount ID, actual cgroup2 superblock, root, keeper generation,
held original cgroup descriptors and verified child inherited FDs.
Diagnostic stdout and user-supplied inode values are never that authority.

## Static checks performed without privileges

- `gcc -std=gnu11 -Wall -Wextra -Wpedantic -Wconversion -Wshadow -Wformat=2 -fsyntax-only native/ge04/cgroup-runtime-view-qualification.c`
  completes without syntax errors; one `-Wshadow` warning at ~538
  (inner `now` shadows earlier local `now` at ~532). This is not an
  exploitable finding by itself.
- No root helper execution, systemd unit creation, cgroup mutation,
  disposable VM run or production activation was performed.
- This document is **not** the independent external C/root-scope review
  required by gate B1-A. The named concerns are review targets, not
  assertions of demonstrated exploitability.

## Exact remaining acceptance sequence

1. Freeze and independently review the native C helper, root bootstrap,
   protected observer, source and binary hashes. Reviewers must own a
   separate security review decision; model review alone is insufficient.
2. Implement independent root-owned pre-birth intent and exact unit birth,
   with authenticated manager invocation, keeper pidfd/startticks and
   namespace/cgroup mount descriptor custody.
3. Require phase-specific single-use observer ACK after verified kernel
   facts; refuse duplicate, stale, reordered, missing or forged evidence.
4. Independently verify all terminal, cleanup, quarantine and crash recovery
   states on the exact owned tree. Preserve a non-owned witness.
5. Only after the approved source/root-scope review, use the specifically
   authorized disposable VM protocol and capture raw negative tests,
   before/after witness and source hashes; seek Q13 release decision.

**Stop rule:** any missing original receipt, unknown descendant, changed
unit/keeper/mount/inode, or incomplete evidence => HOLD/QUARANTINE. Do
not infer authorization from a passing local unit test or a `RESULT clean=1`
diagnostic.

## Post-preaudit default-deny source change

The original 740-line source hash above is a **pre-change** review reference.
A subsequent defensive edit adds a compile-time default denial in `main`:
valid fixture modes return **77 before setup**, regardless of UID, unless
`GE04_REVIEWED_DISPOSABLE_VM_QUALIFICATION` is explicitly defined at compile
time. This macro **is not authorization** and must not be set in a routine
build or CI. This source change invalidates the earlier hash and must be
independently reviewed with the final exact source/binary hashes before any
privileged VM qualification. `test_ge04_native_default_hold.py` compiles the
ordinary default binary and runs all eight fixed modes to confirm 77, with
unknown mode returning 64; it does not compile/run the macro-enabled variant.
No privileged run or systemd/cgroup mutation occurred.
