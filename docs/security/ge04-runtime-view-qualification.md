# GE-04 runtime-view qualification — partial local contract

Status: **NOT ROOT READY**. GE-04 SECURITY HOLD remains active.
This is exclusively a Linux kernel namespace/cgroup/pidfd fixture; proposed
[ADR-0019](../architecture/adrs/ADR-0019-cross-platform-worker-execution.md)
places it behind a future Linux-only execution backend. Windows/macOS clients
must never run it directly or infer guest/remote isolation from local tests.
No platform adapter or portable worker authorization is implemented.
This document records the bounded November 9 runtime-view increment; it is
neither security qualification nor authority to execute a root probe or
production worker.

## Ownership and scope

- `native/ge04/cgroup-runtime-view-qualification.c` is the closed
  root-only trusted native helper for two child namespace transitions and
  exact exclusive-cgroup cleanup. It is uncommitted and still requires
  independent final source/root-scope review.
- `tests/agents/test_ge04_runtime_view.py` presently implements only
  local admission-contract helpers, canonical diagnostic decoding, binary
  deadline-bounded reading, phase order and stable diagnostic generation,
  strict parsing/cross-checking of supplied proc stat/status/cgroup.procs data,
  staging receipt/manifest checks, and nonprivileged native refusal checks.
  It also includes an observer-owned pidfd-open/double-proc-sampling primitive
  and read-only mount/cgroup namespace-link versus opened-namespace-inode
  snapshots, exercised against its own unprivileged test process. Strict
  supplied-data parsers now cover cgroup.events populated/frozen counters,
  cgroup.subtree_control membership and exact numeric FD inventories. These
  are complemented by a supplied-data exact cgroup membership/populated/
  controller-state matrix for INTENT through READY; EMPTY, DENIED and recovery
  are intentionally not verified by this helper. None establish protected
  unit/cgroup custody, actual private mount-root identity, live FD target
  identities, independent kernel phase verification or ACK authority.
  A bounded cgroup v2 mountinfo parser now rejects absent, ambiguous and
  non-root mount scopes. The directory-bound read-only cgroup snapshot uses
  O_DIRECTORY/O_NOFOLLOW, an externally supplied expected (dev,ino), bounded
  O_NOFOLLOW openat reads of cgroup.procs/events/subtree_control, and checks
  for directory/path replacement. Its unprivileged fixture tests are not
  evidence of protected mount ancestry, independent expected-identity custody,
  unit ownership or race-free kernel phase observation. A further read-only
  `observe_bound_cgroup_ancestry` opens an expected root/outer/leaf directory
  chain using O_DIRECTORY/O_NOFOLLOW and dirfd-relative opens; it compares
  independently supplied (dev,ino) pairs and rechecks directory entries.
  Synthetic tests reject traversal, substituted symlinks, changed identities
  and replaced leaf directories. This is not a systemd-unit or mount-ID pin,
  and TOCTOU between samples is not excluded. A pure
  `validate_external_cgroup_binding` now rejects mismatched canonical unit,
  invocation, mount ID/device/root, keeper PID/starttick and three-level
  ancestry records, but **neither supplied record has authenticated custody**.
  See the [independent binding review](ge04-runtime-view-independent-binding-review.md)
  for the missing trust sources, mandatory refusals and security-review gate.
- The Python file deliberately has **no live observer/controller** and
  unconditionally refuses root qualification after any preliminary checks.
  Do not stage or execute it as a qualifying root suite.
- No OCI runtime, pinned image, Node worker, broker, credential, model or
  arbitrary executable is launched. The native helper has no production caller.

## Canonical staging contract

Fixed staging root: `/run/ge04-view-code`. Its ten entries comprise the
root, `native`, `native/ge04`, `tests`, `tests/agents`, `bin`,
`native/ge04/cgroup-runtime-view-qualification.c`,
`tests/agents/test_ge04_runtime_view.py`, `bin/probe` and
`manifest.json`. Every entry must have original device/inode identity,
root UID/GID, exact type and mode. Root and directories are `0700`;
sources/controller/manifest are `0400`; binary is `0500`; files have
one hardlink. The separate original JSON receipt has exact keys
`schemaVersion` and `entries` and six scalar fields per entry.
The four-field manifest hashes source/controller/binary bytes.
Freshly reconstructing a receipt from a later inventory is not evidence of
the original pre-execution ownership.

The local functions reject malformed JSON, duplicate properties, booleans
in place of integers, unknown paths, changed identity and noncanonical
diagnostic values. No diagnostic line is process authority. A future observer
must independently bind generation-pinned pidfds, exact cgroup/namespace FDs,
stopped states, mounts, controllers and limits before ACK.

## Pending mandatory live work

Before ANY separately reviewed root execution, add a fail-closed Python
observer that independently checks the kernel-derived matrix for
`INTENT`, `PRE_NAMESPACE`, `PINNED`, `ENABLED`, `PRE_JOIN`,
`READY`, `EMPTY` and `DENIED`. It must use bounded binary pipe reads,
absolute three-second transition deadlines, single combined cleanup budget,
and exact-byte ACK. Cover the three named injected crashes, two prerequisite-
verified failures, lost binding, exclusive-cgroup dead-only reconstruction,
stop/witness custody and exact reviewed staging/cleanup scripts.

The eventual staged root controller must independently verify unit invocation,
keeper generation and witness identity; refuse existing unit/work/staging
adoption; leave ambiguous state quarantined; never kill outside the original
bound outer; and preserve raw before/after evidence. The root controller is
not presently implemented and must not be represented as a passing test.

## Local verification (2026-11-09)

From the existing worktree, without root:

```sh
python3 -B -m unittest discover -s tests/agents -p test_ge04_runtime_view.py -v
```

Latest local result: 29 tests passed, zero failures (including unprivileged
pidfd/namespace snapshots, supplied cgroup/FD parsing and exact six-phase
cgroup membership matrix, synthetic directory-bound/mountinfo checks and
read-only root-to-leaf cgroup ancestry substitution negatives, and all eight
closed fixture-mode terminal/crash transcript cases, plus one composite
read-only live self-process/mount namespace check against synthetic cgroup
files). The composite result is UNQUALIFIED_OBSERVATION only; expected
systemd unit and directory identity are not independently authenticated.
The composite observer requires **two distinct supplied records**, rejecting
self-comparison and mismatched expected/observed fields before inspection.
It also checks that neither record changed during inspection and rejects
namespace changes sampled across the read. Separate Python object identities
are not independent provenance; no observer-root or ACK authority is gained.
Added a separate `observe_unprivileged_self_cgroup` diagnostic which reads
**actual** Linux cgroup v2 files under the process's `/proc/self/cgroup` scope,
checks the cgroup2 mount's major/minor device, verifies held root-to-leaf
inodes and the calling PID in `cgroup.procs`, and resamples process/scope
identities. It neither creates a protected expected binding nor observes the
qualification worker; it returns `UNQUALIFIED_LIVE_KERNEL_VIEW` only.
Canonical scope-path refusal cases accompany this local read-only test.
The C source also compiled
with `cc -std=c11 -O2 -Wall -Wextra -Werror -fanalyzer`.
These observations concern local grammar/refusal plus read-only pidfd and
procfs sampling of the unprivileged test process, not namespace-view, root,
VM or end-to-end kernel qualification.
Independent source, evidence and stage/root-scope reviews remain pending.
No release gate is cleared, and R1-B1/B2/C–F remain open.
