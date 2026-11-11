# GE-04 B1-A.03 — Source and authority review (initial, author-side)

**Disposition: PARTIAL / HOLD.** This is a nonprivileged source inspection, **not** independent security acceptance or a complete review of the 69-file candidate inventory. Baseline: Git tree `7a15a906488996bd677a246d2d24787d4fbf5b4e` (B1-A.02); inspected current working-tree native files without modification. Exact source/build closure, dependency audit and human reviewer sign-off remain OPEN.

## Trust and authority boundaries

| Boundary | Source evidence | Assessment / remaining question |
| --- | --- | --- |
| Root controller entrypoint | `native/ge04/protected-root-controller.c`: `main()` unconditionally returns 77 | Entry is non-operational. No path to production authorization demonstrated. Must separately verify built binary and all possible entrypoints. |
| Original boot/attempt/journal custody | `protected-attempt-fence.c`, `protected-prebirth-journal.c`: root identity checks, original claim checks, root-owned directory and 0600 single-link file validation | Sensitive root-only primitives exist as library code, but disabled controller does not invoke them. Filesystem races, exact root provenance, and error-path coverage require independent review. |
| Pre-send dispatch intent | `protected-dispatch-intent.c`: fixed claim/manager serialization and retained descriptor recheck | Intent persistence is not evidence of a successful systemd request. Crash/recovery and replay authority are not qualified. |
| systemd manager authentication | `protected-systemd-transaction.c`: obtains unique owner and root EUID via sd-bus credentials, subscribes to `JobRemoved` before any create request | Manager observations are not birth/worker authority; systemd trust and original binding need full review. `Subscribe` is an actual D-Bus method call, but not `StartTransientUnit`. |
| Fixed request preparation | `protected-dispatch-preparation.c`: validates same bus/owner, path, interface, `StartTransientUnit` member and fixed signature | Builds an in-memory method object; it does **not** send. Caller-owned bus/message lifecycle and post-preparation mutation remain review targets. |
| Privileged dispatch | `ge04_systemd_create_exclusive()` in `protected-systemd-transaction.c` and `ge04_dispatch_prepared()` in `protected-dispatch-preparation.c` | Both explicitly return `EPERM`; the latter poisons transaction state. No authorized send path in these inspected functions. |
| Cgroup, keeper, mount and observer | `protected-keeper-custody.c`, `protected-cgroup-custody.c`, `protected-mount-namespace.c`, `protected-systemd-birth-observer.c` | Privileged-looking custody/observation functions are separate from root controller. Original birth-time provenance and exact mount/cgroup custody remain unqualified; detailed function-by-function audit outstanding. |

## Findings and non-claims

1. **Observed fail-closed entry:** root controller exits 77 unconditionally in inspected source. This does not prove every candidate helper is safe to execute or that a future binary matches source.
2. **Observed send interlocks:** `ge04_systemd_create_exclusive` and `ge04_dispatch_prepared` deny `EPERM`. Search found other sd-bus method calls, including manager `Subscribe`; therefore **do not claim zero D-Bus calls**.
3. **Authority separation:** request construction, original journal custody, manager subscription and observation are not equivalent to successful dispatch, unit birth, protected ACK, or production admission.
4. **Scope risk:** B1-A.01 inventories 69 native inputs but has not resolved linked dependencies, scripts outside `native/ge04`, alternate executable entrypoints, compiler flags, external library provenance, or runtime load paths. Consequently this review is a **targeted first pass**, not exhaustive source acceptance.
5. **Residual security risk:** privileged filesystem primitives, race windows, manager identity, fd lifecycle, signal correlation, replay and crash behavior require deeper independent review and bounded VM qualification at their designated gates.

## Review completion conditions

- Build a complete entrypoint/call graph and exact source/link closure from the candidate baseline.
- Audit all privileged and security-sensitive functions, including negative paths, with test/evidence links.
- Review source changes after the pinned baseline and reject any drift before identity acceptance.
- Obtain independent reviewer acceptance; do not substitute author-side inspection, CI, or model review.

**GE-04 SECURITY HOLD ACTIVE.** No root execution, worker dispatch, production admission, or B1-A gate clearance is authorized by this document.

## B1-A.03 follow-up — static C entrypoint and include census

This census enumerates the tracked C translation units, direct quoted headers and standalone `main()` declarations. It is **not** a complete function-level call graph, transitive include closure, executable runtime analysis or independent audit. C preprocessor branches, function pointers, build-specific linking, Python entrypoints and runtime library loads remain unverified.

### Standalone C entrypoints (15)

- `native/ge04/broker-peer-probe.c`
- `native/ge04/cgroup-control-fd-qualification.c`
- `native/ge04/cgroup-dirfd-qualification.c`
- `native/ge04/cgroup-leaf-ownership-qualification.c`
- `native/ge04/cgroup-runtime-view-qualification.c`
- `native/ge04/cgroup-worker-qualification.c`
- `native/ge04/cgroup2-fixed-preflight.c`
- `native/ge04/cgroup2-mount-preflight.c`
- `native/ge04/exec-pinned-probe.c`
- `native/ge04/exec-pinned.c`
- `native/ge04/isolated-worker-launcher.c`
- `native/ge04/peercred.c`
- `native/ge04/pidfd-lifecycle-qualification.c`
- `native/ge04/pidfd-qualification.c`
- `native/ge04/protected-root-controller.c`

### Direct local header relationships (30 C files)

- `broker-peer-probe.c`: (no quoted headers)
- `cgroup-control-fd-qualification.c`: (no quoted headers)
- `cgroup-dirfd-qualification.c`: (no quoted headers)
- `cgroup-leaf-ownership-qualification.c`: (no quoted headers)
- `cgroup-runtime-view-qualification.c`: (no quoted headers)
- `cgroup-worker-qualification.c`: (no quoted headers)
- `cgroup2-fixed-preflight.c`: (no quoted headers)
- `cgroup2-mount-preflight.c`: (no quoted headers)
- `diagnostic-deadline.c`: `diagnostic-deadline.h`
- `diagnostic-fd-wait.c`: `diagnostic-fd-wait.h`
- `exec-pinned-probe.c`: (no quoted headers)
- `exec-pinned.c`: (no quoted headers)
- `isolated-worker-launcher.c`: (no quoted headers)
- `nonexecuting-sender-contract.c`: `nonexecuting-sender-contract.h`
- `peercred.c`: (no quoted headers)
- `pidfd-lifecycle-qualification.c`: (no quoted headers)
- `pidfd-qualification.c`: (no quoted headers)
- `protected-attempt-fence.c`: `protected-attempt-fence.h`
- `protected-cgroup-custody.c`: `protected-cgroup-custody.h`, `protected-prebirth-journal.h`
- `protected-dispatch-intent.c`: `protected-dispatch-intent.h`, `protected-prebirth-journal.h`
- `protected-dispatch-preparation.c`: `protected-dispatch-preparation.h`, `protected-systemd-request.h`
- `protected-keeper-custody.c`: `protected-keeper-custody.h`, `protected-prebirth-journal.h`
- `protected-mount-namespace.c`: `protected-mount-namespace.h`
- `protected-prebirth-journal.c`: `protected-prebirth-journal.h`, `protected-attempt-fence.h`
- `protected-root-controller.c`: (no quoted headers)
- `protected-systemd-birth-observer.c`: `protected-systemd-birth-observer.h`, `protected-prebirth-journal.h`
- `protected-systemd-request.c`: `protected-systemd-request.h`, `protected-prebirth-journal.h`
- `protected-systemd-transaction.c`: `protected-systemd-transaction.h`
- `protected-transaction-state.c`: `protected-transaction-state.h`
- `worker-stream.c`: `worker-stream.h`

### External header names (36)

`arpa/inet.h`, `dirent.h`, `errno.h`, `fcntl.h`, `grp.h`, `limits.h`, `linux/magic.h`, `linux/nsfs.h`, `linux/openat2.h`, `linux/sched.h`, `linux/stat.h`, `poll.h`, `sched.h`, `signal.h`, `stdbool.h`, `stddef.h`, `stdint.h`, `stdio.h`, `stdlib.h`, `string.h`, `sys/file.h`, `sys/ioctl.h`, `sys/mount.h`, `sys/prctl.h`, `sys/random.h`, `sys/resource.h`, `sys/socket.h`, `sys/stat.h`, `sys/syscall.h`, `sys/sysmacros.h`, `sys/types.h`, `sys/un.h`, `sys/vfs.h`, `sys/wait.h`, `time.h`, `unistd.h`

**Review blocker:** the C entrypoint/include census is now captured, but all-function privileged call paths, Python entrypoints, runtime dependencies, negative tests and independent acceptance are not completed. B1-A.03 remains PARTIAL/HOLD.
