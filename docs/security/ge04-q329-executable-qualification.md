# GE-04 Q3.29 — Native executable qualification (partial)

`qualifyNativeProbeExecutable` reuses the Q3.23 root-owned, non-writable, symlink-free path/ancestor checks and compares a `O_NOFOLLOW`-opened executable descriptor against the current pathname inode and device. The descriptor is closed without execution. Negative tests reject relative paths, missing files, temporary-directory ancestry, symlinks and writable candidates.

**This does not establish executable provenance at execution time.** Q3.28 still launches by pathname, and an attacker capable of replacing a privileged mount or pathname between qualification and spawn may substitute the executable. The descriptor is intentionally not passed to the Q3.28 child. No production native-to-governance channel, trusted PID/UID handoff, or credential transport is enabled. To complete Q3.29, a trusted launcher must execute the qualified native binary by pinned descriptor, and the privileged root-controlled deployment plus distinct-UID tests must pass independently.

**GE-04 SECURITY HOLD remains active.**
