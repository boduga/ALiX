# ADR-0019 — Cross-platform task-worker execution boundary

**Status:** Proposed for architecture and independent security review (2026-11-09); NOT accepted, deployed or qualified.
**Deciders:** ALiX maintainer and designated independent security reviewer (pending).
**Scope:** Portable worker lifecycle contract, backend eligibility, Linux execution, VM/remote adapters and cross-platform failure semantics.
**Related:** [ADR-0007](ADR-0007-agent-subagent-execution-architecture.md), [ADR-0018](ADR-0018-independent-trust-service.md), [production lifecycle](../../security/ge04-production-worker-lifecycle.md), [capability discovery](../../security/ge04-capability-discovery.md), [supervisor verification](../../security/ge04-q32-supervisor-verification-boundary.md), [Linux runtime-view qualification](../../security/ge04-runtime-view-qualification.md).

## Context

ALiX runs coordination, governance, approval, routing and UI logic in a portable
Node/TypeScript core, but its GE-04 native qualification path uses Linux-only
syscalls and mechanisms: pidfds, namespaces, cgroups v2, procfs and an eventual
OCI/runc-backed worker. A host on Windows or macOS cannot execute that
Linux-specific fixture natively. Host portability and proven hostile-worker
containment are different requirements.

The current mandatory `TaskWorkerSupervisor` seam is credential-free and
fail-closed; there is no qualified production task backend. Earlier ADR-0007
described direct child-process isolation, which is historical design context,
not an acceptable GE-04 security boundary. GE-04 SECURITY HOLD remains active.
Existing initial certification scope remains Linux x86-64 unless explicitly
amended with separate evidence and approval.

## Proposed decision

1. **Portable control plane.** Keep ALiX coordination, task preparation,
   immutable attempt identity, governance, policy, approvals, cancellation
   intent, evidence evaluation, and TUI/CLI independent of the host-specific
   process-launch mechanics. The existing mandatory `TaskWorkerSupervisor`
   remains the sole application-facing launch/lifecycle authority; do not
   introduce a competing scheduler, approval authority or task execution path.
2. **Implementation-specific execution plane.** Host/runtime adapters
   implement the same security *requirements* but must not be assumed to
   supply identical kernel guarantees. The first execution target is a
   separately qualified Linux native supervisor with reviewed pinned OCI
   image/runtime and private cgroup/namespace custody. No Windows/macOS
   native untrusted-process backend is approved here.
3. **Non-Linux hosts.** A Windows or macOS ALiX client may eventually delegate
   to an independently qualified Linux VM or remote Linux execution service.
   The Linux guest uses the same independently qualified backend; the host
   adapter owns guest provisioning, lifecycle, custody and authenticated
   transport. WSL2, Docker Desktop, Apple virtualization and SSH are
   *candidate implementations only*, not security-qualified by their names.
4. **Explicit backend eligibility.** Route a task only when policy-approved
   requirements are matched by fresh, independently verified execution
   evidence bound to a backend instance, deployment, boot, artifact release
   and current policy revision. Availability, OS string, advertised features,
   OCI image digest or a successful local test is never proof of authority.
   Unknown, stale, revoked, weak or unavailable capability means refusal.
5. **No security downgrade.** Never fall back from a required isolated worker
   to `child_process.spawn()`, unsandboxed shell, an unreviewed local runtime,
   or a weaker guest/remote backend. A backend may explicitly support fewer
   tasks; unsupported tasks fail closed with a typed reason and audit record.
6. **Authority placement.** Governance and approvals remain in existing ALiX
   owners. A remote host, VM agent, transport peer or runtime-supplied PID
   cannot mint approval, change policy, select its own authorization context,
   or promote diagnostic metadata into independently witnessed evidence.
   Authority-bearing final effects require the original protected effect
   fence; remote executor availability does not bypass it.
7. **Failure and recovery.** Cross-host transport loss, controller restart,
   guest reboot, host reboot, ambiguous kill, lost observation and stale
   registration are uncertainty/quarantine, not a successful cancel or task
   completion. Do not retry a possibly running or already-effectful attempt
   without protected durable exclusion, exact generation reconciliation and
   independently established final-effect safety.
8. **Initial scope.** This ADR is a design boundary only. It does not alter
   the existing Linux qualification fixtures, enable a backend, provision a
   VM, grant credentials or release any GE-04/Q13 security hold.

## Portability and qualification matrix

| ALiX control host | Candidate execution placement | Present qualification |
| --- | --- | --- |
| Linux x86-64 | Linux native / pinned OCI runtime | GE-04 native fixtures partial; production backend **unavailable** |
| Windows | Separate hardened Linux VM or remote Linux service | **Not qualified**; WSL2 may be evaluated but is not presumed sufficient |
| macOS Intel | Linux VM or remote Linux service | **Not qualified** |
| macOS Apple Silicon | ARM64 Linux VM or qualified remote Linux x86-64/ARM64 service | **Not qualified**; architecture-specific image/runtime pins required |
| FreeBSD/other hosts | Remote/VM Linux backend if controller build is supported | **Not qualified** |

Portability is two-dimensional: the **controller OS** and the **execution
guest architecture/platform**. A Linux image pinned for amd64 does not become
arm64-compatible because the host is Apple Silicon or Windows ARM.

## Backend capability and evidence contract (design only)

A future backend descriptor must separate:

- **Identity:** backend instance/owner, implementation version, exact
  executable/image digests, guest OS/kernel/architecture, boot/invocation
  identity, trust domain and deployment topology.
- **Offered mechanisms:** local Linux cgroup/namespace/pidfd evidence,
  locked-down guest isolation, mutually authenticated transport, resource
  limits, immutable rootfs, network/secret containment and crash recovery.
  Mechanisms are observations, not security verdicts.
- **Security qualification:** independently reviewed scope, hostile-worker
  test provenance, signed or otherwise independently protected evidence,
  review expiry/revocation, authorized release and explicitly qualified
  attack/threat models.
- **Task eligibility:** required security level, workspace/effect policy,
  model/provider authority boundaries, isolation properties, allowed
  region/architecture, and backend availability. The owner of admission
  must compare requirements to qualified evidence at the last protected
  launch boundary, not just at discovery time.
- **Lifecycle evidence:** immutable run/worker/attempt/scope identity;
  durable single-owner claim, exact worker generation and native custody;
  bounded prepare/launch/observe/cancel/recover operations, retained
  findings and structured terminal outcome; ambiguous outcomes remain
  unresolved and fenced.

The concrete TypeScript shape must be designed against the existing
`src/agents/worker-task-supervisor.ts` interface, not copied blindly from
an illustrative generic `ExecutionBackend`. Its migration requires a
separate high-impact source review: the GitNexus pre-design impact for
`TaskWorkerSupervisor` reported CRITICAL/lower-bound, 699 impacted
references, 132 affected processes and 20 modules; interface/dynamic
dispatch visibility is incomplete. This ADR alone changes no interface.

## Existing supervisor API gap analysis (2026-11-09; reviewed for design only)

The current API is **not yet a platform-neutral execution-evidence schema**,
even though its manager-facing *intent* is portable. Its exact source contracts:

| Existing seam | Current actual shape | Cross-host gap and required disposition |
| --- | --- | --- |
| `TaskWorkerSupervisor.prepareTask()` | Returns `SupervisedWorkerRequest` with `identity`, opaque `configurationId`, `workspaceRoot` | No execution-placement/guest pin; local workspace string cannot be assumed to map to the same trusted target inside a guest |
| `TaskWorkerSupervisor.launch()` | Returns `TaskWorkerHandle` whose `evidence` is `SupervisedWorkerEvidence` | A guest PID/UID/starttick cannot be interpreted as host-process identity; bind the guest/boot/backend/release and protected registration first |
| `snapshotWorkerEvidence()` | Requires `pid`, `uid`, `startTimeTicks`, `registrationId`; compares UID against `process.getuid?.()` when available | Local Linux interpretation is implicit; Windows has no comparable native UID; numeric guest identity must be nested and scoped, never directly flattened into an unqualified host claim |
| `TaskWorkerHandle.wait()` | Returns `{exitCode,signal}` | Native process exit or remote transport reply does not prove descendant cleanup or effect outcome |
| `TaskWorkerHandle.cancel()` | Returns `Promise<void>` | Return/ACK does not prove worker-tree termination; keep task unresolved until independently corroborated cleanup |
| `WorkerSupervisor.revoke()` | Returns `Promise<void>` | Revocation is an intended action, not an independently protected final lifecycle outcome; remote fencing and cleanup need separate evidence |
| `WorkerSupervisor.reconcile()` | Returns `Promise<void>` | No typed durable recovery verdict in interface; pending/unknown attempts need explicit quarantine, not implicitly successful reconciliation |
| `TaskWorkerHandle.completion()` | Returns bounded `TaskCompletion` with `protocolVersion:1` and same worker evidence | Bounded serialization is not host/guest identity, transport authentication, cleanup, or protected final-effect proof |

**Migration constraint:** Preserve protocol version 1 and its current Linux
meaning until a separate versioned contract is reviewed. Do not reinterpret
its PID/UID/ticks as global identities, inject an untrusted `backendId`
into the existing record, or treat transport metadata as native attestation.
A future versioned guest-scoped evidence envelope must bind immutable
run/worker/attempt to backend instance, deployment release, guest boot,
CPU architecture, trust principal, independently verified guest-native
process generation, protection-domain scope, and cleanup/final-effect
outcome. It must distinguish `requested`, `acknowledged`, `observed`,
`qualified`, `quarantined` and `unknown` states without granting
authority from a boolean or a caller-supplied evidence blob.

**Code impact / source review gate:** `TaskWorkerSupervisor` has CRITICAL,
lower-bound graph impact (699 references, 132 processes); moreover,
`snapshotWorkerEvidence` has CRITICAL impact (276 references, 102 processes).
Both require separate source-impact review, negative tests, full call-site
migration and independent security review before implementation.
No source interface changes are part of this ADR.

## Remote/VM trust and recovery invariants

- Guest enrollment, host-to-guest mutual authentication, trust-root custody,
  channel peer-to-workload binding, key rotation/revocation, guest release
  pinning and replay protection require independent design and qualification.
  Plain SSH reachability, TLS connectivity or a VM ID are not worker identity.
- Do not transfer provider credentials, issuer secrets, unrestricted host
  paths or writable authority descriptors to a worker/guest merely because
  the backend is reachable. Use approved broker-owned authority boundaries.
- A lost control-plane connection must not cause a second backend to
  concurrently execute the same attempt. Durable claim/lease fencing must
  survive independent process, machine and guest restarts.
- A cancellation request is not proof of termination. A transport ACK,
  signal submission, VM shutdown command or runtime exit code alone is not
  independently proven descendant cleanup.
- The independently administered trust-service design in ADR-0018 remains
  separate from the task supervisor. Neither service may self-certify its
  own authorization or monotonic witness evidence.
- Host/guest filesystem sharing, hypervisor management API permissions,
  snapshot/rollback, bridged networking, DNS, shared memory, clock drift and
  administrative compromise are explicit separate threats.
- No global agent lifetime timeout is introduced; local syscall/IPC/cleanup
  phases may have bounded operation budgets consistent with existing policy.

## Alternatives considered

| Option | Disposition | Rationale |
| --- | --- | --- |
| Port `runc` directly to Windows/macOS | Reject | Depends on Linux kernel facilities |
| Three unqualified native OS process backends | Reject as initial path | Security semantics diverge and enlarge review burden |
| Silent local process fallback | Reject | Defeats mandatory supervisor and isolation contract |
| Linux-only ALiX control plane | Reject as long-term direction | Unnecessarily couples portable coordination to worker OS |
| Linux-first backend plus qualified Linux VM/remote adapters | **Propose** | Reuses one execution security qualification while preserving portable control plane |

## Sequence and acceptance gates

1. Review/approve this ADR as architecture direction; reconcile ADR-0007's
   historical direct-spawn rationale without rewriting its original record.
2. Freeze portable supervisor lifecycle/evidence requirements and fail-closed
   capability selection; test unsupported-platform behavior.
3. Complete current Linux GE-04 R1-B1/R1-B2 containment, immutable image
   handling, independent real-kernel hostile-worker and recovery qualification.
4. Propose/version a separately reviewable remote/VM transport, guest identity,
   fencing and deployment contract. Add Windows/macOS controller builds and
   negative tests before any positive adapter activation.
5. Independently qualify each guest architecture, host topology and supported
   deployment variant. Cross-platform compile/CI and synthetic tests are not
   security acceptance.
6. Complete R1-C/D/E and independent R1-F/Q13 release decision. No implicit
   waiver from a green CI run or a functioning VM.

**Review status:** No independent architecture/security sign-off is recorded
by this draft. No positive worker admission or production deployment is
authorized. GE-04 SECURITY HOLD ACTIVE.
