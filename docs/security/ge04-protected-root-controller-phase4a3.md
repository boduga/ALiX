# GE-04 protected root controller — Phase 4A3 mount namespace provenance

**Production-intended native source candidate only. GE-04 SECURITY HOLD ACTIVE;
R1-B1 security gates OPEN. No authorized privileged execution.**

## Implemented boundary

`native/ge04/protected-mount-namespace.[ch]` adds root-gated, read-only
mount-namespace identity retention to the existing keeper pidfd and
cgroup2 descriptor chain. The source requires prior keeper/cgroup2
rechecks, then opens the fixed keeper `/proc/PID/ns/mnt` namespace
descriptor and the current controller `/proc/self/ns/mnt` descriptor.
These `nsfs` entries are kernel magic links: they must be followed
to obtain a namespace handle; arbitrary user-supplied path resolution
is not permitted.

Both held namespace descriptors must have identical device/inode
identity, and the fresh keeper namespace identity must continue to
match on recheck. The source rejects **different** mount namespaces,
rather than trying to equate separate mount trees. It reads each
process's bounded `/proc/PID/mountinfo` and requires an exact
`/sys/fs/cgroup` mountpoint, root `/`, filesystem and source
`cgroup2 cgroup2`, and the same nonzero mount ID as the existing
pinned `/sys/fs/cgroup` statx descriptor. Duplicate mountpoint
entries, malformed/overflowed IDs, missing records and inconsistent
namespace generations refuse. Keeper pidfd/startticks and cgroup2
root/slice/leaf descriptor identities are rechecked on both sides
of those observations.

All results remain **UNQUALIFIED**. No `setns`, `mount`, `umount`,
cgroup control writes, process signal, systemd unit creation, keeper
adoption, worker admission or ACK is invoked. The controller main
remains an unconditional exit 77.

## Important limitations

This observes the *current* controller and keeper mount namespaces
and their visible cgroup2 mount; it does not prove that the controller
created the unit or retained the descriptors at original birth.
The current root filesystem and cgroup mount have not been approved
as immutable, independently installed privileged infrastructure.
Mount IDs/inodes are comparison values, not signed authority.
A hostile privileged mount manager could alter visibility between
samples. The implementation deliberately fails if the keeper uses
a distinct mount namespace, even if a future design might safely
support one with separately authenticated mount/root custody.

The mountinfo grammar is intentionally narrow and must be reviewed
against real kernel versions and mount setup differences in an
approved disposable Linux VM. Only current no-follow ancestry,
namespace identity and a single fixed cgroup2 mount are compared.
Durable crash fencing, source/toolchain/binary attestation, genuine
exclusive systemd creation, protected request sender, authenticated
birth witness and phase ACK remain **unimplemented**.

## Verification

The new unprivileged native test compiles the actual C code and
checks mountinfo decimal ID parsing, exact cgroup2 mount identity,
wrong mount ID, duplicate mount, wrong mount root/filesystem, missing
newline, overflow and noncanonical IDs; it opens its own namespace
descriptors read-only and confirms root-only pin/recheck refusal and
non-owned descriptor cleanup. No root or systemd operations occur.

A model review is not independent human security acceptance; the
B1-A through B1-H gates, disposable-VM qualification and Q13 remain
open. This source is not deployed and creates no authorization.

## Provisional Phase 4A3 source fingerprints (NOT approval)

| File | Source SHA-256 |
| --- | --- |
| `native/ge04/protected-mount-namespace.c` | `3ea5c5a1bb21c35d3a6936891d4bc90c0c75a1c556d596f16ee395243dd80506` |
| `native/ge04/protected-mount-namespace.h` | `bb3640655cbf4fc4f01af6882e728e4f748f170fa3b015a6a93b7913913a2533` |

These are editable source hashes only, not frozen privileged binaries,
independent original-birth evidence, human security approval, or Q13.
