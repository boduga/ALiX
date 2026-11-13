# GE-04 prebirth journal persistence — unprivileged fixture

**Status:** R1-B1 OPEN; GE-04 SECURITY HOLD ACTIVE. This is a test-only
filesystem persistence component, NOT a root-owned issuer or deployment plan.

`native/ge04/prebirth_fixture_journal.py` accepts a *caller-supplied* private
directory descriptor owned by the unprivileged test UID, mode 0700, and the
canonical original pre-birth format. It refuses root execution, any
pre-existing journal, symlinks, nonprivate directory modes, missing or
malformed source claims, and an absence probe not returning literal True.
It uses a single exclusive `O_CREAT|O_EXCL|O_NOFOLLOW` file creation for
`prebirth-intent.v1`, writes bounded canonical bytes, calls `fsync` on
the file descriptor, verifies file content and identity, and `fsync` on the
directory descriptor before returning an **UNQUALIFIED** result. A second
caller-supplied absence-probe result is required after publication.

No cleanup happens after a failed write, fsync, or subsequent check: a
possibly incomplete journal is *preserved* and blocks all reuse of the
same path. A new process may read it only as
`UNQUALIFIED_QUARANTINE_ON_REOPEN`, never as authorization to create a unit,
retry, complete a partially published record, ACK, or clean descendants.
A symlink or corrupt record fails closed. Tests inject failures after
write, file fsync and directory fsync; there are no filesystem operations
outside per-test temporary directories.

**Critical limitations:** The directory is user-owned and mutable. The
unit-absence callback is a caller assertion, not an authenticated systemd
manager. Returning after the directory fsync does not guarantee that
a future root-owned authority holds the original journal or that the unit
remained absent during the entire interval. It does not prove power-loss
durability on a given filesystem, crash-atomic transition with systemd, or
exclusive creation of a never-before-existing unit. There is no protected
boot ID, persistent attempt counter, root-owned source hash attestation,
approved root service, issuer identity, or independent recovery control.
The fixture has **no code path for unit creation or privilege escalation**.

The real implementation must be a separately reviewed root-owned issuer
whose immutable journal precedes any unit creation, whose systemd manager
and kernel facts are independently authenticated, and whose every partial
or ambiguous state remains quarantined. Its privileged staging, exact
source/binary hashes, one-purpose disposable VM fault injection, independent
human security review and Q13 decision remain open. Do not connect this
fixture to the privileged native helper or interpret passing tests as
security qualification.

## Separate model review correction

A code review found a P2 false-positive persistence claim: the fixture
ignored the originally created journal inode during read-back, so a callback
could replace it after file fsync with identical bytes, or delete it during
the final unit-absence callback, yet publication could report success.
The publisher now pins the original created file dev/inode, requires read-back
to match that original inode after file fsync, and checks again after final
absence observation, including the held directory identity. Tests reproduce
both replacement and deletion and verify refusal; 9/9 focused tests pass.
These added checks cannot eliminate malicious concurrent mutation in a
user-writable fixture or prove power-loss durability. A future root issuer
must independently protect the journal from concurrent editors and never
base privileged authorization on this untrusted path.
