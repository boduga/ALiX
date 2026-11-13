# GE-04 fixed original approval read-only custody check

**State:** R1-B1 OPEN · SECURITY HOLD ACTIVE. Non-authorizing engineering
qualification only; this is **not a root bootstrap publisher**.

The native C fixture already consumes a small canonical
`/run/ge04-view-qualification/approval.v1` record:

```text
GE04VA1 <32 lowercase-hex invocation> <parent device> <parent inode>
```

It also expects `.lock` to be a zero-byte root-owned file. Previously,
the newer isolated manager/kernel observer accepted an original binding
provided by its caller without corroborating this **separate original C
fixture approval**. This increment adds
`native/ge04/protected_approval_observer.py`: it walks the fixed `/run`
work directory and fixed `/sys/fs/cgroup/system.slice/...service` parent
via no-follow dirfd opens, requires root UID/GID and non-group/world-writable
directory ancestry, exact private work-directory mode 0700, zero-byte root
lock and canonical approval mode 0600 with a single link, and compares the
original invocation and (dev,ino) of the parent unit cgroup.

It reopens the fixed directory paths, compares pinned directory identities,
and rereads exact approval/lock inode and content. If any file/path is
missing, inaccessible, substituted, malformed, changed, or inconsistent,
the result is refusal. It **never creates or repairs any approval**. The
isolated observer worker checks this record before its manager/kernel
inspection and again afterward, rejecting a changed original approval.
The only matching result is
`UNQUALIFIED_ORIGINAL_APPROVAL_CORRELATION`, and its output is not
forwarded as an authorization token. Regular unprivileged Linux execution
will usually refuse to read a genuine root-only 0600 approval; this is a
deliberate fail-closed limitation, not permission to loosen modes or run
the entire worktree as root.

Tests exercise missing original, malformed/changed record and lock,
original invocation/parent mismatch, user-owned file refusal, no-follow
symlink rejection and an explicitly *synthetic* positive case that mocks
root-owner metadata on temporary files. The positive case does **not**
prove actual root custody or first creation. No root permissions, Linux
capabilities, sudo policies, systemd units or cgroups were changed.

**What this does not prove:** `approval.v1` is a C-format authorization
claim, not a pre-birth issuance receipt. It lacks the full sealed-binding
nonce, monotonic attempt, keeper generation, original mount namespace and
source identity. Even a root-owned current file and fixed cgroup match
cannot prove the expected new unit was absent before creation, that the
approval was written before birth, or that an authorized root controller
holds exclusive issuer authority. Races between read checks remain a
security review concern. Only a separately reviewed root bootstrap,
durable original journal, trusted systemd unit creation and kernel witness
can establish that. This code remains a non-authorizing prerequisite,
without ACK writer, privileged caller, cleanup, quarantine release, or
production admission. Independent human review and approved VM
qualification remain mandatory.
