# GE-04 sealed bootstrap-binding transport — qualification only

**State:** SECURITY HOLD ACTIVE; not root-ready, no privileged execution or production consumer.

`native/ge04/bootstrap_binding.py` is a read-only Linux memfd receipt reader.
It does not mint an expected identity or perform systemd manager queries. It
requires exactly all four Linux write/grow/shrink/further-seal protections,
checks fd owner, regular-file type, zero link count, bounded size, optional
original device/inode, and repeats descriptor identity/seal checks around
`pread` of a canonical single-line JSON record. It never changes the shared
FD offset. Its returned record is a read-only mapping and is **always**
labelled `UNQUALIFIED_SEALED_BOOTSTRAP`.

The record fixes schema version, exact intended test-only systemd unit,
invocation, keeper PID/start ticks, cgroup2 mount ID/device/root, three cgroup
ancestor identities, attempt number, nonce, and native/controller SHA-256
values. These are **claims**, not independently witnessed facts. A sealed
memfd protects against later content mutation, but **does not authenticate
its creator**: an unprivileged or compromised process can construct its own
valid sealed record. Expected UID and inode parameters are also merely
caller-supplied until the holder has separately protected custody. Transport
origin and kernel provenance MUST be independently authenticated before a
root observer can treat a receipt as evidence. JSON nonce/digests are not
signatures, freshness proof, or proof of a correctly staged binary.

The unprivileged tests exercise canonical acceptance, seal rejection,
writable/regular FD rejection, duplicate/malformed fields, noncanonical
serializations, wrong owner/inode, immutable result behavior and a real
UNIX SCM_RIGHTS descriptor transfer across a forked process. The test
publisher intentionally runs under the current user; its successful handoff
**does not** establish root privilege, a new service or protected original
pre-birth publication. No ACK, deployment, kill, cleanup or worker admission
is possible through this module.

**Blocked next:** an independently reviewed root bootstrap with authenticated
systemd manager invocation/keeper verification, root-controlled exclusive
original record publication, protected descriptor custody, and a separately
trusted observer that checks those claims against live kernel state. Source
and stage hashes must be frozen, independently reviewed, then qualified on a
specifically approved disposable VM with witness and cleanup evidence.

## Source-review findings and disposition

A separate read-only Codex engineering review found two P2 correctness items:
Linux-only constants/imports were accessed before unsupported-platform test
skips, and unprivileged memfd GID was incorrectly assumed equal to UID.
The implementation now guards unsupported imports/capabilities and accepts
**separately supplied** expected UID and expected GID (both default to zero
for an eventual root-only policy). Unprivileged tests explicitly use their
real UID/GID. The socket test uses a bounded receive timeout. This model
review is not independent human native security clearance; code and review
must be revalidated on the final exact source hash.
