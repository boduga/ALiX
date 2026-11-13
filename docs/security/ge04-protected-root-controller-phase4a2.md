# GE-04 protected root controller — Phase 4A2 cgroup2 descriptor custody

**Native source candidate only · GE-04 SECURITY HOLD ACTIVE · B1 gates OPEN.**

Adds `native/ge04/protected-cgroup-custody.[ch]` for read-only retention
of the fixed Linux cgroup2 directory chain. It is neither linked to
an operational root entrypoint nor a worker admission/phase ACK path.

## Native custody boundary

A future root-only caller supplies the same protected journal, attempt,
manager transaction and retained keeper pidfd/startticks required by
Phase 4A1. The source rechecks the keeper generation and original
manager/journal evidence, then traverses the **fixed**
`/sys/fs/cgroup/system.slice/ge04-r1b2-view-qualification.service`
using component-by-component `O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC`.
No caller-controlled path, cgroup creation, control-file writes or
process signaling is exposed.

The source retains three descriptor identities: cgroup2 root,
`system.slice` and the exact service leaf. It uses `fstat`,
`fstatfs(CGROUP2_SUPER_MAGIC)` and `statx(AT_EMPTY_PATH,
STATX_MNT_ID|STATX_INO|STATX_TYPE)` to require root-owned,
non-group/world-writable directories, consistent device and mount ID,
distinct inodes, and supported kernel mount-ID reporting. It compares
each name against its held child descriptor with no-follow `fstatat`,
and reopens the fixed root to detect root mount replacement.
Keeper PID/startticks and pidfd liveness are bracketed around the
ancestry check; a changed generation or path fails closed.

On success the held result is **unqualified**. Inode/mount metadata
and original descriptor handles are retained only within the current
process and closed without unlink, cleanup, termination or adoption.
No existing service path is treated as evidence that ALiX created it.

## Missing security evidence (non-negotiable)

This source currently opens directory descriptors **after** observing
a candidate unit. It cannot establish those descriptors originated
at the unit's exclusive birth. No authenticated StartTransientUnit
send or kernel first-birth witness exists. It does not yet retain or
independently authenticate the keeper's mount namespace descriptor,
verify its mountinfo superblock/mount root provenance, or prove that
the root controller sees the same mount namespace as the keeper.
A root-controlled bind mount or higher-privileged mount substitution
cannot be excluded by fstat/statx alone; `STATX_MNT_ID` is a comparison
mechanism, not a signed origin assertion.

The current source has no privileged integration test, no actual
fixed-unit birth, no durable root recovery process, no complete
end-to-end timeout or approved keeper deployment. An empty or
restarted cgroup cannot be adopted as an original. A failed/ambiguous
attempt remains denied, without cleanup or recovery authorization.

The existing controller `main` still exits **77** regardless of
arguments; the native creation API remains unconditional EPERM.
No root operations, cgroup mutations or ACKs were performed.

## Verification

`tests/agents/test_ge04_protected_cgroup_custody.py` compiles the
actual source and inspects the real cgroup2 root and system.slice
**read-only as a non-root user**. It checks retained and reopened root
mount IDs, same-device ancestry, substituted fd/name refusal,
incorrect mount-ID refusal, non-cgroup filesystem rejection,
root-gated pin/recheck and non-owned descriptor cleanup. Initialization,
root-gated denial and borrowed descriptor safety run regardless of host
cgroup layout; live-mount assertions are skipped if the unprivileged
container does not expose root-owned cgroup2 `system.slice`. This is a
test portability requirement, NOT an acceptance waiver or reason to trust
an unsupported mount. No positive root-only fixed service test is claimed.

Before any privileged use, independently review exact source/binary
custody and mount namespace identity, original keeper birth and
anti-adoption semantics, root-owned persistence, protected
subscription/request ordering, disposable-VM fault injection and
human Q13 security acceptance.

## Review finding and correction: container mount prerequisites

The first independent model review found that the live test assumed a
root-owned `system.slice` exists in every unprivileged Linux container.
Some container mounts expose remapped UID/GID or no `system.slice`.
The native implementation correctly refuses such mounts. The tests now
separate unconditional non-root refusal and FD ownership from optional
live-host cgroup2 inspection. An unsupported host skips only the latter;
root-side qualification remains OPEN.

## Provisional Phase 4A2 source fingerprints — NOT security approval

| Source | SHA-256 |
| --- | --- |
| `native/ge04/protected-cgroup-custody.c` | `a357818847033f37187c5eb8c89b85aad3c01f0830291a338d6f25d558aed6a3` |
| `native/ge04/protected-cgroup-custody.h` | `acb18d9dd182c6829a17ad553ca3733feee605106d2a58427d6c13926c515d18` |

These editable source fingerprints are provisional only. No reviewed,
installed root executable, immutable mount provenance or Q13 acceptance
is established by them. Model review found no actionable defect after
host-prerequisite test correction, but native graph coverage is unavailable
and the independently approved root/VM qualification remains outstanding.
