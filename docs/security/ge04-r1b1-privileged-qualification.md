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

## Recovery ledger prototype (not wired into dispatch)

`src/agents/worker-supervisor-recovery-ledger.ts` persists unresolved worker
identity, process generation, and registration IDs in SQLite with synchronous
writes. A restart test confirms unresolved records survive reopening, and a
mismatched registration ID cannot clear an entry. This is deliberately a
**recovery building block**, not a complete supervisor: it does not record
pending spawn before execution, own the process tree, independently prove exit,
or reconcile records at startup. The trusted supervisor must verify root-owned
immutable directory ancestry, SQLite sidecar permissions, exclusive writer
ownership, process identity, and containment before this ledger is usable.
A stored row must never be treated as proof that a worker is alive or dead.

## Fail-closed recovery admission gate (prototype)

`src/agents/worker-supervisor-recovery-gate.ts` wraps a supervisor with a
startup gate: no launch before explicit `reconcile()`, and any unresolved ledger
row, ledger read failure, or reconciliation failure prevents admission. It
rechecks the ledger before every launch and requires a fresh successful
reconciliation after a detected unresolved record. It **does not** automatically
clear records when a PID disappears; a missing process leader cannot establish
that all descendants were contained. Tests cover initial hold, unresolved
records, concurrent reconciliation and failure. This is **not wired into
production**: because native launch and ledger insertion are not yet one
crash-safe transaction, an empty ledger cannot currently prove that no worker
survived a crash. Neither this gate nor the ledger constitutes GE-04 approval.

### Durable pre-spawn intent (prototype)

The ledger now supports `beginLaunch` (durably record an unresolved launch
intent before native spawn), `promoteLaunch` (atomically replace matching intent
with observed worker registration), `unresolvedIntents`, and `clearIntent`
(requires independent proof that no worker or escaped descendants remain).
The recovery gate rejects either unresolved registrations **or** unresolved
pre-spawn intents. Tests exercise restart persistence, duplicate rejection,
registration mismatch, atomic promotion, and fail-closed startup. **This is not
yet wired to native spawn**; production still needs an exclusive trusted writer,
secure pinned storage, cgroup-backed containment and recovery, and a single
supervisor transaction protocol spanning intent, spawn and observed identity.

### Durable launch composition (qualification-only)

`worker-supervisor-durable-launch.ts` now sequences a ledger intent write
**before** delegating to `WorkerSupervisor.launch`, then promotes that intent
atomically to a process record after the supervisor returns qualified kernel
identity. A failed intent write prevents spawn; failed spawn or promotion leaves
an unresolved intent, and failed promotion requests cancellation without
assuming process-tree containment. The wrapper intentionally does not clear
records on `wait()` or `revoke()`: the present backend cannot prove hostile
process descendants are gone. This is **not production-wired** and does not
replace a native cgroup-owned, crash-recoverable supervisor. Tests verify
ordering, failed persistence, unknown spawn outcomes and promotion failures.

### Cgroup v2 process-tree containment primitive (qualification-only)

`worker-supervisor-cgroup-v2.ts` adds a precreated root-owned cgroup v2 leaf
adapter: validates path and control-file provenance, supports attaching a
**stopped** child through `cgroup.procs`, terminating the entire cgroup through
`cgroup.kill`, and checking `populated 0` in `cgroup.events`. Unit tests cover
control operations, unsafe paths and ambiguous events. This is NOT an actual
containment guarantee until a privileged native supervisor creates/owns a
unique leaf, starts children suspended and atomically attaches them **before
untrusted code can execute**, pins kernel directory descriptors, prevents
cgroup escape/migration, and independently qualifies crash/restart behavior.
The local unprivileged host has a read-only cgroup filesystem, so no privileged
cgroup enforcement was exercised here. SECURITY HOLD remains active.

### Registration-scoped cancellation fencing

The Linux supervisor now binds each returned handle's `cancel()` to the
specific `registrationId` that created it. A stale handle cannot revoke a
replacement worker with the same coordination run, worker ID, and attempt.
The registration check happens before asynchronous termination begins. Two
regression tests cover replacement after cancellation and after successful
wait/reap. Identity-level `revoke()` remains the trusted supervisor operation
for revoking the current attempt. This fixes a lifecycle authority bug, but
does not establish native process-tree containment or production admission.

### Kernel membership confirmation after cgroup attachment

`WorkerCgroupV2.attachStoppedChild()` now checks `cgroup.procs` immediately
after writing the stopped child's PID and fails closed if the kernel-reported
membership does not contain the expected PID or contains malformed entries.
Regression coverage includes absent membership, malformed membership, and
multiple valid members. **Important:** this check is not an atomic kernel
attestation of a stopped child; a trusted native stop/attach/verify/resume
protocol and descriptor-pinned cgroup ownership are still missing. No live
privileged cgroup integration was performed in this change.

### Native pre-exec stop gate (child-side prototype)

The native launcher now accepts an explicit fifth argument,
`--ge04-stop-before-exec`, only when selected by the trusted parent. After
pinning the executable and changing into the workspace, it raises `SIGSTOP`
while still root, before dropping UID or executing worker code. It does **not**
automatically resume; a future trusted parent must independently verify the
stopped child identity, attach it to its exclusive cgroup, confirm membership,
and then send `SIGCONT`. Invalid gate flags are rejected. Existing four-argument
launch behavior is unchanged and remains **uncontained**. The Node native
backend does not yet select this mode. Unprivileged tests only confirm that
neither invocation bypasses the root-only requirement; they do not prove
stop/attach/resume security. Parent-side integration must address PID reuse,
concurrent cancellation, unexpected resume, timeout cleanup, and crash windows
before any production admission. SECURITY HOLD remains active.
