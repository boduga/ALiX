# GE-04 R1-B1 privileged launcher qualification (not production admission)

Run only inside a disposable Linux VM under a trusted root session. Do not use
`setuid`, file capabilities, a public privileged wrapper, or a production host.
The launcher accepts arbitrary UID and executable arguments and is **not** a
safe general-purpose root service. The test compiles it into a temporary
root-owned directory under `/run` and removes the directory afterward.

## Preconditions

- A disposable Linux VM with root, compiler, Node.js, pnpm and the repository.
- `/run` is root-owned and not group/world writable.
- A reserved, nonzero test UID (example `20002`) distinct from root; no existing
  service or user should use it. No user account is created by this test.
- Linux kernel support for `openat2`, `execveat` and `close_range`.

From the repository checkout in the VM, using a root shell:

```sh
ALIX_GE04_PRIVILEGED_QUALIFICATION=1 \
ALIX_GE04_TEST_WORKER_UID=20002 \
pnpm exec vitest run tests/agents/ge04-r1b1-privileged-qualification.vitest.ts --config vitest.config.mts
```

The test must report **one passed test and zero skipped**. A skip is not a
qualification result. Capture the kernel version, distro, test output, git SHA
and test UID in the security evidence record.

## Evidence covered

- Root launcher rejects an executable path in an untrusted writable directory.
- The child executes with the selected non-root UID.
- Supplementary groups are removed and the only group is the target GID.
- Inherited environment (including a fake provider key and DBus address) is
  replaced with exactly the three allowlisted variables.
- A protected root-owned file is unreadable to the child.

## Evidence NOT covered

- Native supervisor authorization, executable allowlisting, or launch admission.
- Authenticated AF_UNIX peer credentials and process-generation binding.
- Inherited high-numbered descriptor canaries, process-tree termination,
  restart/recovery, namespace/mount/network confinement or hostile workers.
- Broker-only model credentials, final-effect authorization and replay safety.

**SECURITY HOLD remains active** even if this test passes. Never enable
credential-bearing workers on the basis of this qualification alone.

## Disposable container smoke probe (supplemental only)

On a Docker host with the existing `alix-alix-app:latest` image, run:

```sh
scripts/ge04/container-launcher-smoke.sh
```

Set `ALIX_GE04_SMOKE_IMAGE` to another prebuilt Linux image containing `cc`,
`/usr/bin/id`, `/usr/bin/env`, `/usr/bin/cat` and a POSIX shell if needed.
The probe runs without network access, with a read-only container rootfs,
read-only source mount and ephemeral `/run` and `/tmp`. It checks UID, groups,
exact environment, root-file denial and unsafe executable rejection.

**This is a container-root smoke test, not independent VM/root-host security
qualification.** It does not qualify privileged host launch authority, kernel
peer authentication, filesystem confinement or production credential access.

## Native launch backend prototype

`src/agents/worker-supervisor-native-backend.ts` provides an explicitly
qualification-only root launch backend with supervisor-owned configuration
selection, detached process-group launch, procfs UID/start-time observation,
and kill/reap on qualification failure. It is **not wired into production**.
The backend still needs race-free pinned launcher invocation, a durable
root-owned registration journal, a verified process-group/tree containment
mechanism (process-group signalling alone is not sufficient), crash recovery,
and a kernel-authenticated broker channel. Never enable it for credentialed
workers or interpret the prototype as a qualified trusted supervisor.

### Pinned backend launch qualification

The same root-only environment variables also enable the gated
`tests/agents/ge04-r1b1-native-backend.vitest.ts` live test. It compiles a
root-owned launcher under `/run`, invokes it through an inherited pinned
executable FD (`/proc/self/fd/4`), observes the selected nonroot UID, and
terminates/reaps a sleeping worker. **Do not treat a skipped test as passing.**
The parent-path check still assumes a trusted immutable deployment, and this
test does not prove containment of hostile descendants or restart recovery.
