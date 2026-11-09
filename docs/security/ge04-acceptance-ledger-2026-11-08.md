# GE-04 acceptance ledger — 2026-11-08

> **SECURITY HOLD ACTIVE.** Planning and evidence index only. No production credential admission, privileged launch, or scoped filesystem mutation is authorized.

Baseline: `main` at `f2b1b150` before this documentation branch. GitHub open-issue query: `GE-04 in:title`, 13 results.

## Acceptance inventory

| Issue | Current tracker state | Dependency | Evidence entry points |
|---|---|---|---|
| [#1040](https://github.com/boduga/ALiX/issues/1040) GE-04 production qualification: independent supervisor trust boundary and scoped-mutation release gates | **OPEN / not independently qualified** | R1-B2, R1-D, independent Q13 release | `src/execution/filesystem/scoped-mutation.ts`, `src/execution/filesystem/supervisor-effect-executor.ts`, `docs/security/ge04-production-worker-lifecycle.md` |
| [#1050](https://github.com/boduga/ALiX/issues/1050) GE-04 Q3.1 — distinct-UID supervisor identity isolation qualification | **OPEN / not independently qualified** | R1-B1, independent UID host | `docs/security/ge04-q31-distinct-uid-qualification.md` |
| [#1054](https://github.com/boduga/ALiX/issues/1054) GE-04 R1-B1 — Implement mandatory canonical WorkerSupervisor | **OPEN / not independently qualified** | None; first production dependency | `src/agents/worker-supervisor.ts`, `docs/security/ge04-production-worker-lifecycle.md` |
| [#1055](https://github.com/boduga/ALiX/issues/1055) GE-04 R1-B2 — Enforce Linux worker isolation and kernel-authenticated IPC | **OPEN / not independently qualified** | R1-B1 | `docs/security/ge04-q321-kernel-attestation-gate.md`, `docs/security/ge04-q325-native-boundary.md` |
| [#1056](https://github.com/boduga/ALiX/issues/1056) GE-04 R1-C — Broker-owned model inference and nonsecret worker configuration | **OPEN / not independently qualified** | R1-B2 authenticated IPC (design parallel) | `docs/security/ge04-q317-durable-executor-route-contract.md` |
| [#1057](https://github.com/boduga/ALiX/issues/1057) GE-04 R1-D — Durable broker authorization and final-effect safety | **OPEN / not independently qualified** | R1-B2 and R1-C | `docs/security/ge04-q32-supervisor-verification-boundary.md`, `scripts/ge04-q32-process-effect-probe.py`, `scripts/test-ge04-q32-process-effect-probe.py` |
| [#1058](https://github.com/boduga/ALiX/issues/1058) GE-04 R1-E — Migrate every worker consumer and delete legacy paths | **OPEN / not independently qualified** | R1-B1, R1-B2, R1-C, R1-D | `docs/security/ge04-production-worker-lifecycle.md` |
| [#1059](https://github.com/boduga/ALiX/issues/1059) GE-04 R1-F — Independent security qualification and release gate | **OPEN / not independently qualified** | R1-E; independent R1-B2/R1-D review | `docs/security/ge04-production-worker-lifecycle.md` |
| [#1063](https://github.com/boduga/ALiX/issues/1063) GE-04-CAP — Detect Linux containment capabilities and fail closed | **OPEN / not independently qualified** | Independent capability detection; never authorization | `docs/security/ge04-capability-discovery.md` |
| [#1064](https://github.com/boduga/ALiX/issues/1064) GE-04-NATIVE — Trusted native Linux cgroup v2 containment adapter | **OPEN / not independently qualified** | R1-B1; real Linux containment | `docs/security/ge04-r1b1-privileged-qualification.md` |
| [#1065](https://github.com/boduga/ALiX/issues/1065) GE-04-CONTAINER — Docker, Podman and Incus/LXC containment adapters | **OPEN / not independently qualified** | R1-B2; per-runtime isolation | `docs/security/ge04-capability-discovery.md` |
| [#1066](https://github.com/boduga/ALiX/issues/1066) GE-04-QUAL — Cross-distribution and container security qualification matrix | **OPEN / not independently qualified** | Native/container adapters and real hostile-worker hosts | `docs/security/ge04-capability-discovery.md` |
| [#1067](https://github.com/boduga/ALiX/issues/1067) GE-04-ADMIT — Enforce containment qualification at worker admission | **OPEN / not independently qualified** | Qualified containment and independent authorization | `docs/security/ge04-production-worker-lifecycle.md` |

## Requirement-by-requirement acceptance matrix

Every unchecked line below is an **unverified acceptance item**, not necessarily missing source code. Do not mark PASS without linked test output, platform details, independent reviewer, and exact commit.

### #1040 — GE-04 production qualification: independent supervisor trust boundary and scoped-mutation release gates
Issue: https://github.com/boduga/ALiX/issues/1040
Depends on: R1-B2, R1-D, independent Q13 release

- [ ] **1040.1** Implement a separate production substrate PR with zero mutation activation; factory remains `UnavailableScopedMutationService`. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1040.2** Independently provision a supervised process, signed release and immutable executable, key and rollback authority with an authenticated coordinator channel. Do not accept a caller-supplied trust key/path/digest/time as authority. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1040.3** Bind release identity, exact request, policy/approval/lease, journal, kernel effect, and receipt across the last native mutation boundary. Enforce actual revocation/expiry and confirm crash/power-fault recovery without replay. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1040.4** Address static and concurrent alias/symlink/parent race threats, same-UID/hard-link races, inode mutation, key custody, dynamic loader/mount provenance, and in-place partial writes. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1040.5** Review production-facing router and ownership changes in separate focused PR(s) before selectively porting them from the retained research branch. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1040.6** Obtain independent security assessment; explicitly document residual risks and acceptance before enabling scoped mutations. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1050 — GE-04 Q3.1 — distinct-UID supervisor identity isolation qualification
Issue: https://github.com/boduga/ALiX/issues/1050
Depends on: R1-B1, independent UID host

- [ ] **1050.7** `scripts/ge04-inert-supervisor.py` implements `AF_UNIX/SOCK_SEQPACKET`, `SO_PEERCRED`, bounded packets and deny-only replies. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.8** Current fixture uses a 0700 socket directory and 0600 socket. These permissions do not support normal cross-UID connections. Design a minimal, reviewed group/ACL or equivalent access path; do not make the socket public. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.9** `docs/security/ge04-inert-supervisor-boundary.md` and `docs/security/ge04-qualification-q1-preflight.md` describe security hold and independent custody gaps. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.10** Production entrypoint must continue exiting 78; `createScopedMutationService()` must remain unavailable. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.11** Tests demonstrate real separate Linux processes with distinct effective UIDs; skip/fail explicitly when privileged test host provisioning is unavailable. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.12** Negative cases fail closed; no unauthorized socket access or FD delegation bypass. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.13** No mutation authority, production service installation, signing-key generation, activation flag, or filesystem effect backend. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.14** Local tests and CI green; security hold remains active. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1050.15** No claim of independent security qualification until independently reviewed on provisioned host. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1054 — GE-04 R1-B1 — Implement mandatory canonical WorkerSupervisor
Issue: https://github.com/boduga/ALiX/issues/1054
Depends on: None; first production dependency

- [ ] **1054.16** Worker launch cannot occur outside canonical authority in supported runtime paths. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1054.17** Identity bound to process generation; restart and cancellation tests. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1054.18** Static guard prevents new direct worker launch paths. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1054.19** Existing supported worker semantics remain tested. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1055 — GE-04 R1-B2 — Enforce Linux worker isolation and kernel-authenticated IPC
Issue: https://github.com/boduga/ALiX/issues/1055
Depends on: R1-B1

- [ ] **1055.20** Real hostile-worker cross-UID tests prove secret store/keyring denial, forged identity rejection, stale/revoked process rejection and IPC provenance. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1055.21** Bounded framing, timeout, cancellation and disconnect tests. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1055.22** Independent review of native trust boundary; no credential delivery enabled. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1056 — GE-04 R1-C — Broker-owned model inference and nonsecret worker configuration
Issue: https://github.com/boduga/ALiX/issues/1056
Depends on: R1-B2 authenticated IPC (design parallel)

- [ ] **1056.23** Worker receives no reusable keys, secret FDs, keyring sockets or unrestricted credentialed proxy. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1056.24** End-to-end tests for paid/keyless models, routing, fallback, streaming, revocation and failure. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1056.25** Hostile-worker attempts to read secrets or override route fail closed. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1056.26** No positive production credential admission until R1-D and independent qualification. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1057 — GE-04 R1-D — Durable broker authorization and final-effect safety
Issue: https://github.com/boduga/ALiX/issues/1057
Depends on: R1-B2 and R1-C

- [ ] **1057.27** Concurrent duplicate nonce and stale/forged ticket rejected across processes/restarts. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1057.28** Revoked approval, policy revision, worker generation and route cannot execute. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1057.29** Crash/unknown-effect reconciliation tested; independent security review before any credential-backed admission. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1058 — GE-04 R1-E — Migrate every worker consumer and delete legacy paths
Issue: https://github.com/boduga/ALiX/issues/1058
Depends on: R1-B1, R1-B2, R1-C, R1-D

- [ ] **1058.30** Full consumer matrix green; no reachable old worker path or compatibility shim. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1058.31** Static reintroduction guards and migration/rollback tests pass. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1058.32** Release builds fail closed when supervisor/broker unavailable. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1059 — GE-04 R1-F — Independent security qualification and release gate
Issue: https://github.com/boduga/ALiX/issues/1059
Depends on: R1-E; independent R1-B2/R1-D review

- [ ] **1059.33** All security gates have reproducible evidence; no unreviewed positive secret admission. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1059.34** No production legacy execution path remains. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1059.35** GE-04 SECURITY HOLD lifted only by explicit independent sign-off after all prerequisites pass. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1063 — GE-04-CAP — Detect Linux containment capabilities and fail closed
Issue: https://github.com/boduga/ALiX/issues/1063
Depends on: Independent capability detection; never authorization

- [ ] **1063.36** Detect unified cgroup v2, mount identity, delegation, writable exclusive subtree, pidfd support, cgroup.kill, stopped-child attach prerequisites, user/PID/cgroup namespaces, and SELinux/AppArmor constraints without mutating host state. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1063.37** Report structured capability evidence and explicit denial reasons; never infer support from distro, filesystem (ext4/XFS/Btrfs/ZFS), or presence of /sys/fs/cgroup alone. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1063.38** Distinguish host-native, Docker/Podman, Incus/LXC and Kubernetes/pod contexts. No automatic privilege escalation. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1063.39** Keep microcloud3 read-only; qualify mutation only in disposable VM. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1063.40** Deterministic unit/fixture tests for supported, missing, ambiguous, and namespace-mapped states. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1063.41** All unsupported or ambiguous configurations fail closed. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1063.42** No credential-bearing worker admission or security-hold removal. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1064 — GE-04-NATIVE — Trusted native Linux cgroup v2 containment adapter
Issue: https://github.com/boduga/ALiX/issues/1064
Depends on: R1-B1; real Linux containment

- [ ] **1064.43** Provision an approved, dedicated systemd-managed subtree; verify exclusive leaf creation with pinned descriptors and stable inode/device identity. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.44** Spawn fixed noncredentialed worker stopped before untrusted code; pin pidfd/generation, attach through cgroup.procs, verify kernel membership before resume. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.45** Restrict cgroup.kill to exclusively owned attached leaf; verify populated 0 and cleanup; preserve durable pre-spawn intent and fail-closed crash recovery. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.46** No arbitrary privileged shell, executable, path, PID or sudoers broadening; do not reuse read-only helper as mutation authority. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.47** Qualify SELinux/AppArmor constraints and native host ownership; do not assume systemd is universally available. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.48** Simulated tests plus real kernel qualification in disposable VM; attach/kill/restart/failure-injection evidence. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.49** No untrusted code before successful attach; denied launch on ambiguity. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1064.50** Independent security review required before production wiring. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1065 — GE-04-CONTAINER — Docker, Podman and Incus/LXC containment adapters
Issue: https://github.com/boduga/ALiX/issues/1065
Depends on: R1-B2; per-runtime isolation

- [ ] **1065.51** Detect cgroup namespace/delegation and mapped UID privileges for Docker, Podman, **Incus-managed LXC, and standalone LXC separately**. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.52** Cover **privileged and unprivileged LXC**, rootful/rootless Docker/Podman, and **nested LXC/Incus** as an explicitly gated configuration (deny until qualified). — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.53** Support a verified exclusive delegated subtree where available, otherwise use a separately trusted host supervisor or deny admission. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.54** Prove inability to mutate sibling/host cgroups; prohibit broad privileged containers, host cgroup namespace, or writable host cgroup mounts as an automatic workaround. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.55** Record runtime-specific denial reasons and host/container identity mapping. Runtime identification is evidence only, not security authorization. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.56** Kubernetes integration is a follow-on after standalone container adapters. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.57** Separate reproducible test cases for **standalone LXC** vs **Incus**, each privileged/unprivileged and delegated/nondelegated; nested cases must fail closed until explicitly qualified. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.58** Validate user namespace mappings, cgroup namespace ownership, controller availability, exclusive leaf control, escape/migration denial, sibling isolation and safe cleanup. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.59** Negative tests for missing delegation, ambiguous runtime, namespace mismatch, overbroad privileges, and nested environments. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.60** No credentialed worker execution absent verified containment and authenticated IPC. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1065.61** Reuse native containment contract; no duplicated security policy. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1066 — GE-04-QUAL — Cross-distribution and container security qualification matrix
Issue: https://github.com/boduga/ALiX/issues/1066
Depends on: Native/container adapters and real hostile-worker hosts

- [ ] **1066.62** Native: Ubuntu/Debian; Fedora/RHEL/AlmaLinux/Rocky; Arch/NixOS as follow-on. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.63** Container: Docker/Podman rootful/rootless, Incus/LXC delegated/nondelegated; Kubernetes follow-on. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.64** Exercise exclusive leaf ownership, stopped-child attach, kernel membership, hostile descendants, cgroup.kill, crash/restart reconciliation, IPC identity, credentials and failure injection. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.65** Record kernel, init, cgroup mount, LSM, namespace mapping, filesystem, test UID, commit SHA, outcome and rollback evidence. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.66** Run destructive/hostile scenarios only in disposable VMs or explicitly isolated environments; shared microcloud3 read-only. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.67** Published pass/fail/unsupported matrix and repeatable test harness. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.68** Every claimed supported configuration has independent evidence; skipped tests never count as PASS. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1066.69** Security HOLD stays active pending GE-04-ADMIT. — Evidence: **NOT VERIFIED IN THIS LEDGER**

### #1067 — GE-04-ADMIT — Enforce containment qualification at worker admission
Issue: https://github.com/boduga/ALiX/issues/1067
Depends on: Qualified containment and independent authorization

- [ ] **1067.70** Require compatible approved adapter, verified exclusive cgroup ownership, kernel-authenticated IPC, credential isolation and durable recovery before worker dispatch. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1067.71** Fail closed for unsupported/ambiguous runtime, incomplete evidence, mismatched identity or failed reconciliation. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1067.72** Integrate with existing GE-04 R1-B1/B2, broker, authorization, migration and independent security release gates. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1067.73** Preserve explicit SECURITY HOLD until independently signed off; no automatic production enablement from a passing smoke test. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1067.74** End-to-end positive and negative tests across native/container paths; no legacy bypass. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1067.75** Independent review confirms all mandatory containment and broker invariants. — Evidence: **NOT VERIFIED IN THIS LEDGER**
- [ ] **1067.76** Release decision documented separately from code merge. — Evidence: **NOT VERIFIED IN THIS LEDGER**

## Known verified boundaries

- `createScopedMutationService()` returns `UnavailableScopedMutationService` unconditionally; this is a fail-closed production gate, not a qualification pass.
- `executeSupervisorEffect()` is a deny-only boundary; no positive production effect authorization is implemented there.
- `scripts/test-ge04-q32-process-effect-probe.py` passed 6/6 locally on 2026-11-08; disposable synthetic process evidence only, not independent supervisor custody.
- Issue #1040 has 6 unchecked release tasks as of ledger creation.

## Execution sequence / stop conditions

1. **B1** canonical mandatory worker supervisor, no bypass, with exact route/static guards.
2. **B2 / NATIVE / Q3.1** real distinct-UID kernel-authenticated IPC and native containment with hostile-worker tests; container adapter tests in parallel.
3. **C** broker-owned credentialed model operations and secret-free worker config.
4. **D / #1040** durable authorization, final-syscall revocation fence, unknown-effect crash reconciliation and protected release authority.
5. **E / ADMIT** migrate every worker consumer, delete FD3/FD4 and legacy paths, gate admission on independently qualified containment.
6. **QUAL / F** reproducible cross-runtime hostile tests, independently administered signing/rollback and independent security review/Q13 release decision.

**STOP:** Any absent kernel evidence, unsigned/unauthenticated authority, replay uncertainty, unqualified containment, skipped privileged test or incomplete migration keeps the GE-04 SECURITY HOLD active.

## Evidence record template

For each item: issue and criterion ID; exact commit SHA; host/kernel/UID/container; test command; exit code; artifact path/hash; positive and negative cases; reviewer identity; review date; explicit PASS/FAIL/HOLD; residual risks.

Inventory: 13 open issues and 76 extracted acceptance/checklist lines. These are tracking counts, **not** a completion percentage.
