# GE-04 — trusted directory ancestry gate (isolated)

**SECURITY HOLD. Not wired into supervisor trust configuration, release installation, admission, or execution.**

`experiments/ge04/trusted-path.py` provides `open_trusted_directory(path, owner_uid=0)`, a Linux descriptor walk from `/` using `O_DIRECTORY|O_NOFOLLOW` at each component, checking directory owner UID and rejecting group/other write permissions. It rejects relative paths, dot components and empty path components. A returned descriptor is pinned to the final directory inode and must be closed by its caller. This deliberately rejects paths beneath world-writable `/tmp`, even if their leaf is private. A trusted supervisor must use a fixed, administrator-provisioned absolute path; a caller-supplied UID or path is not production authority.

`python3 -B experiments/ge04/test-trusted-path.py` tests noncanonical paths, `/tmp` ancestry and symlink denial without privilege. `test-trusted-path-root.py` requires real root (no escalation, unprivileged exit 1) and tests an actual root-owned directory chain under `/run`, rejecting a writable child and symlink substitution. The privileged GE-04 CI job runs both and requires the root PASS marker; **CI is pending for this revision**.

**Limitations:** The walk is not yet integrated with `supervisor-trust-config.py` or `signed-installation.py`; calling the old path-based APIs still lacks ancestor protection. The prototype does not prove mount provenance, resist a privileged ancestor rename, enforce atomic release generations or rollback policy, or bind a trusted root configuration to an authenticated supervisor process. It must not be presented as production-ready.
