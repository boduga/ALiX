# GE-04 — complete worker-execution replacement contract

**Status:** Gap audit and implementation contract; NOT a security qualification or release approval. GE-04 SECURITY HOLD remains active. No positive credential admission.

## PRD authority

- `docs/prd/ALiX_MASTER_PRD_v2.9.md` PRD-R060/R061/R064 and Q04/Q05: migrate supported data and consumers, preserve immutable migration evidence, then delete obsolete executable runtime paths, flags and compatibility shims. Intentional ALiX 2.0 breaking changes are approved.
- Master PRD Stage 0A–0D and G-PROD-0: inventory, migration, verification and legacy elimination precede feature promotion; no unapproved legacy production path at exit.
- `docs/prd/ALiX_PRE_2_0_MASTER_PRD_v1.1.md` LEAN-R005, LEAN-G03: source/caller evidence, explicit keep/merge/remove decisions, rollback and independent security/correctness verification. This contract does not supersede other required Stage 0 evidence.

## Verified source-level gaps at baseline `4d9081d0`

| Gap | Evidence | Mandatory disposition |
| --- | --- | --- |
| Caller-selectable lifecycle | `src/agents/subagent-manager.ts` `ge04WorkerLifecycle?` | Replace with one supervisor-owned, mandatory worker-execution authority; migrate all callers; remove optional switch |
| Credential-bearing legacy FD3 | `subagent-manager.ts` `resolvedCredentialPayload` and `credentialPipe.end`; `subagent-cli.ts` `readWorkerCredentialSnapshot` | Eliminate credential snapshots and associated CLI flags/readers after migrating all consumers; no fallback |
| Cooperative gate | `worker-ge04-startup-gate.ts`, `subagent-cli.ts` `--ge04-startup-fd` | Replace as security mechanism with OS-enforced isolation and startup control; remove qualification-only gate when obsolete |
| Same-UID execution | `subagent-manager.ts` `process.getuid()` and direct `spawn` | Trusted launcher with separately isolated UID, verified process lifetime, and restricted inherited handles |
| Inherited keyring access | `subagent-manager.ts` forwards `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` | Remove direct worker keyring access; credential-backed operations must be broker mediated |
| Unauthenticated peer handoff | `worker-broker-native-handoff.ts` parses diagnostic stdout; `worker-broker-native-admission-gate.ts` rejects it | Native kernel-derived peer identity transferred across authenticated, bounded IPC into broker authorization; diagnostic text never authorizes |
| Registry not a security boundary | `worker-ge04-linux-lifecycle.ts` exposes diagnostic `resolveAttestedPeer` | Bind verified kernel peer to supervisor-owned process generation and governed run/worker/attempt; reject stale/reused identities |

This is a **targeted GE-04 inventory**, not an assertion that every legacy caller, deployment route, secret store or supported historical format has been enumerated. Expand via static and dynamic entry-point mapping before deleting production code.

## R0 inventory evidence

Initial source-backed inventory: [`ge04-r0-worker-execution-inventory.md`](./ge04-r0-worker-execution-inventory.md). This inventory is explicitly incomplete and does not close R0.

## Replacement invariants (no optional production bypass)

1. All worker creation routes (CLI, daemon, coordination, APIs, subagents, recovery) use one trusted supervisor and a canonical execution contract. Unsupported routes fail closed with actionable errors.
2. Worker cannot read parent credentials, keyring sockets, broker secret store, privileged FDs, or ambient tokens; validate with cross-UID, filesystem, process, environment and socket negative tests.
3. Kernel-authenticated IPC identifies the actual peer; never accept self-reported PID/UID or diagnostic stdout as authorization evidence. Bind peer to live process generation and durable worker attempt.
4. Authorization is scoped to operation, run, worker, attempt, policy revision, approval, budget, expiration and revocation. Replay and authorization consumption must be atomic at the final effect boundary.
5. Broker performs only specifically authorized credential-backed operations; worker never receives reusable raw secrets. On uncertainty, crash, process exit, stale identity or IPC failure: deny and durably reconcile, never silently fall back.
6. Before declaring replacement complete, migrate all supported consumers and historical records as applicable, verify integrity/restore/rollback, remove FD3 snapshot route, obsolete flags, readers, optional hooks and old adapters, and add negative reintroduction guards.

## Ordered execution and acceptance gates

**R0 — Complete inventory (read-only):** Enumerate spawn sites, callers, entry points, credential providers, inherited handles, OS platforms, daemon/restart flows, supported historical data and migration tooling. Record source references, ownership, tests, risks and disposition. Do not infer coverage from grep alone.

**R1 — Canonical authority:** Design supervisor-owned worker creation and immutable registration contract; identify durable authority and trusted launch boundary. Independent threat review required before implementation.

**R2 — Native isolation + authenticated IPC:** Implement kernel-authenticated peer transport and cross-UID launch with safe inherited-handle policy; demonstrate denial of forged peer, PID reuse, worker escape, direct keyring access, stale grants and unauthenticated IPC. Test on independently provisioned Linux x86-64 host.

**R3 — Governed broker operation:** Bind native peer to registered worker attempt, enforce atomic authorization/replay semantics, and allow only scoped broker-mediated operations. Keep positive credential admission disabled until independent review and explicit security hold clearance.

**R4 — Consumer and data migration:** Move every supported worker path and credential consumer to the canonical contract. Produce per-family migration and integrity evidence, immutable archives and restore/rollback rehearsal as required by Q04/Q05. No production compatibility shims.

**R5 — Legacy deletion:** Remove FD3 credential delivery and readers, direct worker keyring inheritance, optional GE-04 callback, obsolete startup gate and alternate production launch paths; update CLI/config/API contracts and migration instructions. Add static architecture guards and runtime bypass tests.

**R6 — Qualification and closure:** Run single/parallel/dependent worker, denial, restart/crash, PID reuse, authorization replay, compromised worker, CPU-only Linux x86-64, clean install and upgrade tests. Independently review security and migration evidence. Mark GE-04 complete only when no reachable legacy path remains. Security hold and release authorization are separate decisions and must not be inferred from a merge.

## Immediate rule

Do not merge another GE-04 *partial coexistence* change as a completed replacement. Intermediate branches/PRs must state their incomplete status, keep credential admission disabled, and be traceable to R0–R6. No production rollout until the replacement and its security evidence are complete.
