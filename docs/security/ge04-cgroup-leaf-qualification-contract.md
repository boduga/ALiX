# GE-04 real cgroup leaf qualification contract (proposal; SECURITY HOLD)

## Host evidence (microcloud3, read-only)

Kernel `6.8.0-147-generic`; unified cgroup v2 mounted `rw,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot`. Root `/sys/fs/cgroup` is root-owned mode 0555. `user.slice` is root-owned mode 0755 with `cpu memory pids` enabled. SSH shell resides in `/user.slice/user-1000.slice/session-750.scope`. This is a shared laptop, **not a disposable VM**. No cgroup mutation is authorized by this document.

## Containment boundary

1. Administrator provisions a dedicated, systemd-managed, uniquely named qualification unit/slice outside ordinary login session scopes. Do not modify `user.slice`, the root cgroup, controller delegation, or an existing service's cgroup. Verify the systemd unit, cgroup path, ownership, and service lifecycle before any child spawn.
2. A distinct reviewed native helper is installed root-owned under a trusted non-writable directory. The existing `alix-ge04-fixed-preflight` remains read-only; its sudoers rule must never be expanded. Do not grant sudo to repository paths, arbitrary shell commands, scripts or `mkdir`/`tee`/`kill`.
3. Helper opens the approved parent with symlink-safe descriptor-relative operations and verifies cgroup2 mount identity, expected systemd unit, root ownership, stable inode/device, and exclusive parent authorization. Reject untrusted writable ancestors, unknown delegated ownership, existing leaf names, and unexpected populated state.
4. Create exactly one unique child leaf with `mkdirat` and `O_EXCL`-equivalent exclusive semantics (`EEXIST` is failure). Pin leaf descriptor, compare `fstatat` inode/device, and validate kernel-created control files. Never adopt an existing leaf. Do not assume requested POSIX mode maps exactly to cgroupfs directory mode; explicitly inspect kernel behavior.
5. Spawn a fixed, non-credential-bearing test executable suspended **before any untrusted instruction executes**; pin child identity with pidfd and `/proc` start-time checks. No user-supplied executable, UID, PID, path, or shell arguments in the privileged interface.
6. Attach stopped child using a descriptor-relative `cgroup.procs` control. Verify kernel-reported membership before `SIGCONT`. Treat attach failure or ambiguous identity as fail-closed; terminate/reap only the verified owned test child and preserve evidence of any unknown descendant.
7. Verify `cgroup.events` and child membership; run a bounded benign descendant test followed by a separately authorized hostile-descendant test in a disposable VM. Cleanup must use pinned leaf `cgroup.kill` only after exclusive leaf ownership and successful attach are proven; verify `populated 0` before `rmdir`. A shared ancestor must never be killed.
8. Persist pre-spawn intent and leaf identity before launch; simulate supervisor crash and reconcile by pinned leaf and process identity. An empty process-leader PID is not proof of containment. Record journal, child/descendant outcomes, mount identity and cleanup results.

## Stop conditions

Stop without mutation if the dedicated systemd subtree cannot be verified, if another process already occupies the leaf, if permissions are broader than intended, if an inode changes, if a cgroup control is absent, or if any path or PID is supplied by an untrusted caller. On this shared laptop, limit activity to read-only checks and code review until an explicit isolated qualification environment and rollback plan are approved.

## Required evidence before removing SECURITY HOLD

Root-owned helper and sudoers independent review; dedicated leaf creation; stopped-child attach and kernel membership; descendant containment; cgroup kill and empty verification; failure injection; supervisor crash recovery; authenticated IPC; credential isolation; hostile-worker tests; independent security sign-off. Passing the earlier read-only preflight satisfies none of these dynamic tests.
