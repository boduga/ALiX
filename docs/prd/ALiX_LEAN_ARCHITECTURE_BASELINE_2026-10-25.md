# ALiX LEAN — Read-only architecture baseline

**Date:** 2026-10-25  
**Branch:** `feat/phase0-master-prd`  
**Method:** Static filesystem inventory and targeted source search on a dirty worktree. **Not** a completed architecture audit or runtime benchmark. No build, tests, process launches, profiling or source edits performed.

## Observed source footprint

- `src/`: **1462 TypeScript files** (extension-specific; differs from counts of all file types).
- 12 top-level source domains, counts below.

| Source domain | TypeScript files |
|---|---:|
| `src/agents/` | 39 |
| `src/capabilities/` | 125 |
| `src/cli.ts/` | 1 |
| `src/context/` | 26 |
| `src/coordination/` | 95 |
| `src/execution/` | 96 |
| `src/governance/` | 182 |
| `src/index.ts/` | 1 |
| `src/interfaces/` | 300 |
| `src/models/` | 69 |
| `src/operations/` | 116 |
| `src/planning/` | 315 |
| `src/run.ts/` | 1 |
| `src/runtime-state/` | 91 |
| `src/session/` | 4 |
| `src/task-classifier.ts/` | 1 |

## Observed evidence and limits

- The source tree is already grouped into twelve top-level domains. Directory count and file count **do not prove** duplication or inefficiency.
- `src/coordination/kernel/coordination-scheduler.ts` contains `coordination.tick.completed` references at lines 197, 625, 1078, 1086. Static occurrence alone does not establish that no-op events remain unfiltered; inspect call conditions and measure emitted events before proposing removal.
- Current working tree contains staged and modified code, tests, governance and audit evidence. All subsequent profiling must pin a commit and identify dirty-tree influence; no source rewrites on this worktree during audit.
- No idle RAM/CPU, cold start, model tokens, disk write, tick rates, agent throughput, crash recovery or benchmark measurements have yet been taken. All numerical performance thresholds remain **TBD** pending controlled baselines.

## Required next evidence

1. Build an entrypoint-to-lifecycle call graph across CLI, TUI, API, daemon and automation.
2. Inventory mutable state owners and read projections; distinguish persistence authorities from caches.
3. Locate all timers, polling loops, event subscriptions, queues, model calls, and tool dispatch paths; measure live rates.
4. Identify unused or overlapping implementations through import/reference evidence and runtime traces, not names.
5. Benchmark a pinned baseline on the reference laptop with controlled workload, warm/cold starts and reproducible resource capture.
6. Produce a keep/merge/remove/defer decision register, with rollback and invariant preservation for each candidate.

**Status:** INITIAL INVENTORY ONLY; no optimization, architectural defect, or performance claim is verified.

## Reference hardware and live environment snapshot (2026-10-25)

- Revision: `d412ea15` on `feat/phase0-master-prd`; working tree was dirty (25 porcelain entries at inspection). Results are **not** a clean-commit baseline.
- CPU: Intel Core i3-8145U @ 2.10 GHz, 4 logical CPUs; x86_64.
- Memory: 11 GiB usable, 6.6 GiB available at inspection; 15 GiB swap, unused at inspection.
- Node: v26.11.0. Root filesystem: 916 GiB, 736 GiB used (85%); 134 GiB available.
- Static search: 55 TypeScript files contain `setInterval(` or `setTimeout(`. This does **not** mean 55 live timers or prove polling overhead.
- Scheduler: `src/coordination/kernel/coordination-scheduler.ts` lines ~590–630 computes `meaningful` and gates tick event emission; the earlier unconditional no-op event issue appears **addressed in source**. Actual runtime rates remain unmeasured.
- Process snapshot: browser and OpenCode processes consumed substantial memory; **concurrent ALiX Node test runs were active** (`node --test dist/tests/...`). Therefore the sampled host RAM/CPU cannot be attributed to idle ALiX and must not be used as an idle benchmark.
- Existing `benchmark/` scenarios and soak tests can be reused after a controlled, isolated run. No benchmark was launched by this audit to avoid interfering with active tests or the v1.2 closeout.

**Next measurement prerequisite:** capture a quiet-system or explicitly labeled shared-load baseline; isolate ALiX daemon/CLI process RSS/CPU and model activity, and repeat controlled workloads at a pinned revision. Never kill or alter the user's active test processes merely to improve measurements.

## Execution-path investigation — targeted source findings

1. `bin/alix.js` launches a **separate Node child process** for the CLI with a **default 4096 MiB V8 max-old-space-size**. This is a *heap ceiling*, not measured RAM consumption. It is a strong candidate for a measured resource-budget experiment, **not** a justification to lower the limit blindly; wrapper overhead and process lifecycle need measurement.
2. `src/operations/daemon/daemon-runtime-executor.ts` implements `RuntimeExecutor` for direct, chat, grounded-chat and tool routes, but `executeAgent()` **throws** with a comment that agent routes use `handleRun`'s `runTask` path instead. This is an **explicit route split** requiring ownership/authorization/lifecycle parity verification, not proof of an unsafe bypass.
3. Coordination has **multiple invocation surfaces**: daemon `coordination-scheduler-service.ts` invokes `scheduler.tick`; CLI `commands/coordination.ts`, server `coordination-routes.ts` and `coordination-tools.ts` call `runUntilIdle` or `tick`. Confirm that all paths share the same state, locks, policy and completion semantics.
4. `src/runtime-state/runtime/route-executor.ts` declares `RuntimeExecutor`; `src/runtime-state/runtime/governed-route-executor.ts` provides a governed wrapper. Determine exactly which entrypoints use this wrapper and which handle agent work separately.
5. Scheduler event emission is already gated by `meaningful`; preserve this behavior and measure remaining event/write overhead before altering it.

### Priority investigation register (hypotheses, not defects)

| ID | Hypothesis | Evidence required | Status |
|---|---|---|---|
| LEAN-H01 | Agent routes diverge from the canonical `RuntimeExecutor` path | Trace `handleRun` → `runTask` and compare policy, persistence, cancellation, streaming, error and recovery contracts with `executeChat`/`executeTool` | OPEN |
| LEAN-H02 | CLI wrapper's extra process and 4 GiB default heap ceiling impose avoidable cost on low-end hardware | Compare cold startup, RSS, child lifetime and OOM behavior with direct CLI process under equivalent workload | OPEN |
| LEAN-H03 | Coordination invocation modes differ in completion/reconciliation semantics | Contract tests across daemon, CLI, server and tool entrypoints; event/ledger parity | OPEN |
| LEAN-H04 | Timer-heavy components cause idle wakeups | Runtime timer/wakeup profile and attribution; source count alone is insufficient | OPEN |

**Audit discipline:** Do not implement changes from these hypotheses until call graphs and baseline measurements substantiate the impact. No source or running-process modifications were made during this inspection.

## LEAN-H01 deeper trace — confirmed dispatch divergence (2026-10-25)

**Source observations:**

- `src/operations/daemon/daemon-server.ts:447–555` `handleRun` branches on `route.kind`. For `direct`, `chat`, `grounded_chat`, `tool`, it calls `executeRoute(route, runtimeCtx, daemonExecutor)` at line ~508; for `agent`, it invokes `runTask` directly at ~527, with streaming, abort signal and shared session.
- Both daemon branches load the same project `ApprovalStore`, and the agent path explicitly passes `sessionMode: "ask"`. Therefore **do not characterize the agent split as a demonstrated approval bypass**. The comment describes a prior bypass and a fix.
- `src/runtime-state/runtime/route-executor.ts` defines `RuntimeExecutor` and a local adapter; `src/operations/daemon/daemon-runtime-executor.ts:119–125` deliberately throws on `executeAgent`, documenting that `handleRun` owns that path.
- `src/runtime-state/runtime/governed-route-executor.ts` implements `executeRouteGoverned` with execution intent and evidence state machine; static call-site search found a production call in `src/agents/agent/session/turn.ts` (~385), whereas daemon non-agent dispatch directly invokes `executeRoute` at ~508. **This is evidence of different outer lifecycle composition, not proof of unauthorized tool execution:** lower-level `executeToolBehavior` and policy gates must be traced before any safety conclusion.
- Local direct/chat behavior historically passes a 512-token output cap; daemon route adapter omits that cap (`route-executor.ts` and `daemon-runtime-executor.ts`). This is a **confirmed behavior difference** whose necessity and output/latency impact need contract tests.

**Disposition:** LEAN-H01 = **CONFIRMED ROUTE COMPOSITION SPLIT / SECURITY IMPACT UNDETERMINED**. Do not merge the paths without proving existing approval, streaming, abort, persistence, and output contracts; first write a route-by-host parity matrix and independent tests. This is a higher-priority architectural investigation than arbitrary source-file reduction.

**Audit state:** still no controlled baseline or full state-ownership map. Existing dirty working tree was not modified outside this audit document.

## LEAN-R017/R018 existing-owner inventory (2026-10-25)

- **Prompt classification owner:** `src/runtime-state/runtime/task-router.ts` currently defines `TaskRouteKind = direct | tool | chat | grounded_chat | agent`. It calls `src/task-classifier.ts` and `action-classifier.ts`; ambiguous classifications may use `modelClassifyAction` with confidence thresholds. These are execution routes, **not** a complete multimodal goal/capability plan.
- **Canonical capability owner:** `src/capabilities/capability/registry.ts` `CapabilityRegistry` projects the canonical catalog and provider bindings, maintains lifecycle and availability; `src/capabilities/capability/platform.ts` states one registry per runtime universe. `src/capabilities/tools/tool-registry.ts` implements the canonical tool capability port. These must be reconciled as catalog/projection/tool adapter, **not replaced with a second registry**.
- **Approval owner:** `src/governance/approvals/approval-store.ts` `ApprovalStore` includes durable bound requests, resolve, expiry, revocation, policy-revision invalidation and atomic consume. `src/governance/policy/policy-gate.ts` owns policy evaluation. New capability activation must reuse these owners; verify approval binding supports artifact digest, permissions, provenance and version before adding any schema.
- **Design implication:** Introduce a *typed intent/capability plan* **upstream** of the existing `TaskRoute` dispatch, or evolve its contract compatibly; do not confuse output modality (`image`, `video`, `code`, `project`) with an execution transport (`agent`, `tool`, `direct`). A composite request may contain several modality steps but still use one governed coordination graph.
- **Missing evidence:** call-site and state-owner parity for capability mutations, installation/activation boundaries, provider authorization, lifecycle durability, and current multimodal backends. No assertion that capability expansion is already secure or complete.

**LEAN-01 disposition:** existing-owner inventory advanced; canonical integration design belongs to LEAN-02 only after controlled baseline and full authority map. No implementation, approval or activation was performed.

## LEAN-01 evidence checkpoint — measured and remaining (2026-10-25)

**Pinned environment and dirty manifest:** `evidence/lean-01/environment.txt`; revision `d412ea15`, 26 changed/untracked paths at capture. Source tree is not clean, so measurements are **not** release-comparable. Shared-load host: browser and unrelated `gitnexus mcp` processes consume substantial RSS; no user processes were stopped.

**Six cold-process `--help` runs:** `evidence/lean-01/startup-benchmark.txt`. `node bin/alix.js --help` elapsed 0.70/0.73/0.68 s (mean 0.703 s), timed process peak RSS 153300/153848/154284 KiB. `node dist/src/cli.js --help` elapsed 0.65/0.65/0.66 s (mean 0.653 s), peak RSS 154968/153544/161088 KiB. Wrapper elapsed overhead ~0.05 s on this tiny sample; GNU time measures the timed process, **not aggregate child-tree RSS**. Not a warmed in-process measurement, not an agent/model task, not evidence of an OOM condition or a justified wrapper removal.

**Authority and load snapshot:** `evidence/lean-01/authority-and-load.txt`. `CapabilityRegistry` uses catalog-backed projection and a mutation port, `ApprovalStore` handles durable approval binding and consumption, `PolicyGate` is policy authority. Multiple coordination entrypoints call `tick` and `runUntilIdle` on the same scheduler type; behavioral parity remains untested. Existing benchmark harnesses found under `benchmark/`, but no live daemon/agent controlled run was executed.

### LEAN-G01 evidence matrix

| Required evidence | Status | Qualification note |
|---|---|---|
| Revision, dirty manifest, laptop CPU/RAM/disk/Node | PARTIAL | Captured, but dirty checkout and shared-load host |
| Source entrypoint and execution path map | PARTIAL | Key routes traced, not all restart/error paths |
| Mutable state authority inventory | PARTIAL | Router, capability, approval, scheduler identified; full writer/ledger map outstanding |
| Cold/warm startup and idle CPU/RSS | PARTIAL | Six CLI `--help` cold processes; no daemon idle or warmed steady state |
| No-op ticks, event rates, disk writes | NOT MEASURED | Source gate observed only |
| Model calls, tokens, latency, throughput | NOT MEASURED | No representative provider or agent workload |
| Recovery, cancellation and restart parity | NOT VERIFIED | Source differences identified, contract tests outstanding |
| Runtime timer/wakeup attribution | NOT MEASURED | Source timer count is not runtime wakeup rate |
| Repeatability and controlled isolation | NOT SATISFIED | Three samples per variant on shared-load machine |

**LEAN-01 decision: BLOCKED / INCOMPLETE. LEAN-G01: BLOCKED.** Do not assert completion or proceed to LEAN-02 implementation. Finish controlled workload and runtime telemetry on an isolated/pinned checkout without disrupting active work. No source implementation, commit or push was performed.

## Follow-on inspection — focused test and mutation boundary (2026-10-25)

- `evidence/lean-01/focused-tests.txt`: `node --test --test-concurrency=1 dist/tests/runtime/task-router.test.js dist/tests/daemon/coordination-scheduler-service.test.js` reports **68/68 PASS**, 5.17 s wall time, timed-process maximum RSS 70,980 KiB. Existing compiled tests, not rebuilt from current dirty sources; does not qualify full system or runtime resource behavior.
- `src/operations/daemon/coordination-scheduler-service.ts` runs three intervals: scheduler polling at `DEFAULT_RUN_POLL_INTERVAL_MS` (1,000 ms), lease renewal at `DEFAULT_OWNERSHIP_RENEW_INTERVAL_MS` (300,000 ms), heartbeat at 15,000 ms. Scheduler polls list of active runs even when none are active; actual idle wakeup, CPU and I/O cost still **unmeasured**. This is a concrete timer architecture candidate, not proven material overhead.
- **Capability mutation seam finding:** `src/capabilities/capability/platform.ts:107` wires `CatalogBackedCapabilityMutationPort`; `src/capabilities/capability/mutation-port.ts` explicitly describes this as CAP-3 **bootstrap/compatibility ONLY**, without A4 authorization or mutation-ledger semantics. `CapabilityRegistry.register/unregister` forwards to this port. Before allowing runtime self-expansion, verify where the governed CAP-6/A4 executor is wired and ensure no production activation path uses the bootstrap port to bypass authorization. **Do not assume existing registry mutation is governed.**
- `ApprovalRequestInput` supports binding key, fingerprint, policy revision, invocation identity and generic metadata. A dedicated tested binding for **capability artifact digest, version, provenance and permission manifest** was not established in this pass; it remains a LEAN-R018 design and negative-test obligation.

**Qualification:** LEAN-01 remains **BLOCKED** until isolated daemon/agent baseline, no-op/event/write rates, token/provider workloads, recovery parity and full state-authority map exist. Tests passing do not substitute for these measurements.

## Follow-on authority trace — important approval question

- `src/capabilities/capability/platform.ts` constructs both a bootstrap `CatalogBackedCapabilityMutationPort` for `CapabilityRegistry.register/unregister` **and** a `CapabilityMutationExecutor` used by `CapabilityService.apply`. These are distinct surfaces with different stated semantics. Need production call-site inventory and security tests before concluding they are equivalent or exploitable.
- `src/capabilities/capability/capability-service.ts` `applyProposal` calls `proposalStore.recordApproved(proposalId, "operator")` inside the method after stale-source checking, before `executor.executeStep`. **High-priority authorization question:** what external authentication, role check and operator intent are guaranteed at the caller boundary? The literal actor label alone is not proof of human authorization. Trace all callers and verify negative tests for unprivileged/agent-triggered invocation; do not call it a confirmed bypass without that trace.
- The daemon owns global `~/.alix` state even when given a custom socket/cwd (`daemon-server.ts`). A disposable socket alone does **not** isolate daemon tests. Avoid running a second daemon against the real HOME; use a fully isolated HOME/workspace and verify startup effects before any benchmark.

**Next required evidence:** isolated daemon idle/active CPU/RSS/writes, model/token workload and cancellation/restart, full call-site authority review. **Gate remains BLOCKED.**

## Authorization trace continued — 2026-10-25

**Observed chain:** `src/interfaces/cli/commands/capability.ts` dispatches `approve` to `capabilityApproveCommand` (`src/interfaces/cli/commands/capability-approve.ts`), which passes only `{ proposalId }` into `CapabilityService.apply`. `src/capabilities/capability/capability-service.ts` calls `proposalStore.recordApproved(proposalId, "operator")` and then `CapabilityMutationExecutor.executeStep`. Neither inspected CLI handler nor service `applyProposal` takes authenticated operator identity or an explicit approval proof as an argument. This is **confirmed absence of an authorization check at these two boundaries**, not proof that every higher-level invocation path is unauthorized. Need trace the CLI entrypoint, host/agent tool exposure, execution sandbox and operator session assumptions. **Do not enable autonomous capability activation on the strength of the actor string.**

**Bootstrap distinction:** `src/interfaces/tui/capabilities/capability-service.ts` calls `platform.register` to seed initial, registry-tool and session capabilities; the platform forwards registry mutation through `CatalogBackedCapabilityMutationPort`. This is evidence of intended bootstrap usage. Whether runtime agent-controlled input can reach this path is unverified; inspect call-site trust boundaries and enforce a clear bootstrap-only guard.

**Tests:** `tests/cli/capability-approve-reject-dispatch.vitest.ts` exists; test coverage of actual operator identity binding and untrusted invocation rejection not yet established. LEAN-G01 **BLOCKED**.

## CLI authorization entrypoint evidence — 2026-10-25

- `src/interfaces/cli/commands/approvals-doctor-capability.ts` `handleCapabilityRoot` constructs a `CapabilityPlatform` using project-local catalog/event log and passes `platform.service` into `handleCapabilityCommand` without an explicit authenticated principal or authorization proof. `src/interfaces/cli/commands/capability.ts` forwards `approve` to `capabilityApproveCommand`; the latter calls `service.apply({ proposalId })`. `CapabilityService.applyProposal` writes `recordApproved(proposalId, "operator")` itself.
- `tests/cli/capability-approve-reject-dispatch.vitest.ts` verifies the dispatch arguments (`[{ proposalId: "p1" }]`), but does not test actor identity, authorization evidence, or agent-origin rejection. CLI execution by the human operator may be the intended trust assumption; its enforceability across CLI, agent tools and future remote interfaces remains unproven.
- **LEAN-01 risk register:** RISK-AUTH-01 — implicit operator identity at capability approval/mutation boundary. Severity/likelihood cannot be assigned without exposed-surface and caller-permission trace. Proposed LEAN-02 contract: explicit authenticated operator decision bound to exact candidate digest/version, requested permissions, provenance, policy revision and expiry; negative tests for agent invocation and changed artifact. This is a *recommendation*, not existing implementation.

**No change to gate:** LEAN-G01 BLOCKED. Runtime profiling and recovery qualification remain outstanding.

## Isolated daemon idle probes — 2026-10-25

Two separate disposable HOME/project/socket daemon processes were spawned from compiled `dist` at revision `d412ea15`, sampled via Linux `/proc` at 0.5-second intervals, and terminated gracefully. The active user's global `~/.alix`, project data, running daemon and processes were not modified.

- `evidence/lean-01/isolated-daemon-idle.json`: 9.06 s / 18 samples; 59,140 → 75,716 KiB RSS; 6 → 14 CPU ticks; 49,152 → 139,264 process `write_bytes`. **Coordination failed to start** because no model was configured, so this run does *not* represent a fully initialized daemon.
- `evidence/lean-01/isolated-daemon-configured-idle.json`: 12.07 s / 24 samples; 59,104 → 76,624 KiB RSS; 5 → 19 CPU ticks; 49,152 → 278,528 process `write_bytes`. Project config supplied `models.default` pointing to a **nonexistent placeholder** local model, strictly for initialization; no provider requests or task runs. Daemon logged only a local-development authentication warning. This tests initialized idle runtime, **not model readiness**. Assuming standard 100 Hz Linux USER_HZ, CPU tick delta corresponds to ~140 ms of CPU time during the sampling window; confirm clock tick rate on host for exact conversion.
- Both runs exited 0. Process-level I/O is not attributed to coordination polling, and samples include warmup/initialization. Shared-load desktop and dirty checkout remain confounders. The test was single-run per configuration, not a statistically repeatable qualification.

**LEAN-G01 remains BLOCKED:** missing multiple repeated steady-state samples, process-tree RSS and wakeup attribution, event/write decomposition, active representative model/agent workload, restart/cancellation parity, and completed owner map.

## Idle wakeup source attribution — 2026-10-25

Read-only scheduler timer inventory from `src/operations/daemon/coordination-scheduler-service.ts`: 1-second coordination polling, 5-minute lease renewal, 15-second worker heartbeat. `tickAll()` lists all runs before filtering by active state and host, so even no-active-run cycles may incur storage reads. `src/operations/daemon/approval-watcher.ts` separately polls approvals every 30 seconds and expires due approvals; `src/operations/daemon/daemon-server.ts` schedules due-task checks every 60 seconds. These are **configured timer periods, not measured wakeup or disk-write rates**. The watcher comment says periodic scheduler polling remains authoritative; its `emitEvent` is a placeholder. `requestTick()` bypasses `tickInProgress` serialization (calls scheduler.tick directly); concurrency safety needs a dedicated negative test before event-driven consolidation.

A longer steady-state isolation probe was attempted but the remote command was blocked by a safety check; **no new steady-state data** resulted. Do not claim completed wakeup attribution. Continue with safe read-only source and test inspection or a reviewed benchmark script.

LEAN-G01: BLOCKED.

## Scheduler reentrancy review — 2026-10-25

- `CoordinationSchedulerService.tickAll` has a `tickInProgress` guard **only for periodic `tickAll` calls**. `requestTick(runId)` invokes `scheduler.tick(runId)` directly and does not acquire that guard.
- `CoordinationScheduler.tick` (`src/coordination/kernel/coordination-scheduler.ts:397+`) has no visible per-run entry mutex. It awaits `store.load`, reconciliation, authorization, ownership acquisition and `store.patchWorker` before marking the worker running and adding it to `activeExecutions` (around lines 550–583). Two simultaneous calls can therefore both read a pending worker before either persists the transition. Whether durable store/ownership semantics prevent duplicate dispatch requires a forced-interleaving test; this is **a race hypothesis, not a demonstrated duplicate execution**.
- `tests/daemon/coordination-scheduler-service.test.ts` case `does not overlap ticks` merely starts a timer, waits 50ms, and asserts `true`; it does not test concurrent ticks. `requestTick dispatches a run immediately` verifies positive dispatch only.
- **Required regression test:** barrier-controlled simultaneous `scheduler.tick(runId)` and `service.requestTick(runId)` while the periodic tick is active; assert one authorization/ownership/worker execution, one attempt increment, and consistent terminal state. Include distinct-run concurrency to ensure unrelated work is not unnecessarily serialized.

LEAN-G01 remains BLOCKED. No runtime change recommended until the race is reproduced or falsified with a deterministic test.

## CONFIRMED: same-run concurrent scheduler ticks duplicate execution — 2026-10-25

A disposable, in-memory-barrier test against compiled `dist` at `d412ea15` created one coordination run and one pending worker in a temporary project. Two simultaneous `scheduler.tick(runId)` calls were paused at `configProvider` until both had entered the dispatch pipeline; then released together. A fake executor counted calls; no model or real tools were invoked. **Observed:** `configCalls=4`, `executeCalls=2`; **both** fulfilled ticks reported the **same worker ID** in `dispatched`; persisted worker showed `status=completed, attempt=1`. This is a deterministic reproduced duplicate-execution defect for the forced interleaving, not merely a theoretical risk. The test was run once; repeat and preserve as an automated regression test before claiming complete characterization.

**Severity:** high correctness and potentially high side-effect risk when a worker invokes non-idempotent tools. The test used a read-only fake executor, so no real external side effect occurred. Root cause likely missing per-run tick serialization between the service request path and periodic tick path; durable worker status does not provide atomic claim-and-dispatch. A correct fix should serialize all same-run tick entrypoints (including CLI/Inspector and approval wakeups), preserve parallelism across different runs, and include restart/multi-process considerations. Do not implement an in-process-only lock as a complete cross-process guarantee without analyzing ownership/ledger CAS.

**Required gate regression:** concurrent same-run ticks → exactly one execution/dispatch/attempt; different runs → independent progress; cancellation/approval wakeups; multi-process claim behavior; side-effect idempotency. LEAN-G01 **BLOCKED** until resolved or formally isolated with safety controls.

## Regression test checked in working tree — 2026-10-25

Added **untracked** `tests/kernel/coordination-scheduler-concurrent-ticks.test.ts` to reproduce the confirmed same-run duplicate dispatch using two barrier-synchronized ticks and an isolated fake executor. Executed against current TypeScript source via `./node_modules/.bin/tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`: **1 test failed as expected** (`executions` actual 2 vs expected 1; ~2.76s test runner). The test is a red regression and should remain failing until a fix is implemented. Existing unrelated staged/dirty work untouched. The scheduler's `CoordinationStore.patchWorker` uses per-run lock for writes but does **not** require a pending→running compare-and-swap; serialized writes alone do not prevent two stale scheduler snapshots dispatching the same worker.

Next: implement atomic conditional claim of worker state at the durable store boundary, then add a same-run tick serialization guarantee and cross-process tests. Verify no duplicate external side effects and preserve independent-run parallelism. Do not mark G01 passed from an in-process-only fix.

## Atomic worker claim implementation (uncommitted) — 2026-10-25

Production edits in `src/coordination/kernel/coordination-store.ts` and `src/coordination/kernel/coordination-scheduler.ts` replace unconditional pending→running `patchWorker` with `claimPendingWorker(runId,workerId,expectedAttempt,patch)`. The store checks current pending state, no block reason, and expected attempt inside existing durable per-run `updateRun` lock; only a successful claim permits dispatch. The barrier-synchronized same-run regression changed from **FAIL 2 executions** to **PASS 1/1** (`tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`). `tsc -p tsconfig.json --noEmit` exit 0. Existing larger scheduler suites were started and remain in progress at time of entry; do not assert suite pass before completion.

Caveat: `updateRun` still writes a full run snapshot even on a rejected claim; this can cause unnecessary ledger writes. Follow-up should use a conditional update primitive that does not commit on no-op and test cancellation, cross-process races, worker attempt, and multiple independent runs. In-process scheduler serialization remains unimplemented. LEAN-G01 BLOCKED.

## Conditional claim no-op write elimination — 2026-10-25

Refined `CoordinationStore.claimPendingWorker` to acquire the existing durable per-run lock itself, load latest state, and **return false before ledger append and JSON projection** when worker is absent, non-pending, blocked, or has an unexpected attempt. A successful claim writes one authoritative snapshot before dispatch. Re-ran the deterministic same-run concurrency test: **1/1 PASS**. Broader scheduler/daemon suites from the previous implementation: **61/61 PASS**; rerun against this refinement remains pending. The additional negative test asserts a stale claim returns false and leaves the attempt unchanged; it does not yet directly assert unchanged ledger version or disk writes. Typecheck was launched and pending at time of note. All edits remain local and uncommitted; LEAN-G01 BLOCKED.

## Independent-run concurrency and rejected-claim ledger check — 2026-10-25

Added second regression in `tests/kernel/coordination-scheduler-concurrent-ticks.test.ts` that starts two independent runs with deferred fake executors, waits until **both are executing simultaneously**, and asserts both dispatches occur. Also strengthened same-run test: after the successful claim, a stale retry must return false and `getSharedLedger(cwd).entityVersion(runId)` must remain unchanged (direct evidence that rejected claim does not append a ledger fact). Ran `./node_modules/.bin/tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`: **2/2 PASS**. These are same-process tests, not cross-process isolation or cancellation tests. LEAN-G01 BLOCKED.

## Cross-process and cancellation-ordered claim validation — 2026-10-25

Added `tests/kernel/coordination-claim-child.ts`, an actual OS child process calling the current TypeScript `CoordinationStore.claimPendingWorker` against a shared temporary project. Two separate child processes raced to claim one pending worker; exactly one succeeded, persisted worker `running`, attempt 1. Added a cancellation-ordered negative test: commit worker `cancelled` first, then attempt a claim; rejected, status remains cancelled, attempt 0, authoritative ledger version unchanged. Full focused regression: `./node_modules/.bin/tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts` **4/4 PASS**. Caveat: this establishes two-process *claim* behavior and cancellation-before-claim ordering, **not** simultaneous cancellation/claim interleaving, dual-daemon execution, crash recovery or side-effect exactly-once. Prior broad 61/61 PASS predates latest refinements; rerun still required. LEAN-G01 BLOCKED.

## Cancellation during an active tick — 2026-10-25

Added a deterministic barrier test pausing `scheduler.tick(runId)` at `configProvider`, committing `scheduler.cancelRun(runId)` while the tick is in flight, then releasing the tick. Asserted zero executor calls, zero dispatches, persisted worker cancelled. `./node_modules/.bin/tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`: **5/5 PASS**. This establishes cancellation-commits-before-claim behavior during a live tick, not cancellation after claim or an external tool side effect. A fresh run of the existing scheduler/daemon suites was launched against the refined implementation and is pending. LEAN-G01 BLOCKED pending suite result, crash recovery, dual-daemon behavior and representative workload evidence.

## Cancellation after durable claim — 2026-10-25

Added sixth deterministic test: wait until the fake executor starts after a persisted `running` claim; call `scheduler.cancelRun`; release executor returning success; assert worker remains cancelled, attempt 1, and executor called exactly once. `./node_modules/.bin/tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`: **6/6 PASS**. This tests cooperative scheduler abort handling and durable terminal status, not actual interruption of an external side effect. Broader scheduler/daemon suite still in progress at time of entry; no final result claimed. LEAN-G01 BLOCKED.

## Restart recovery retry accounting defect and fix — 2026-10-25

Fresh existing scheduler/daemon suite against atomic-claim refinement: **61/61 PASS** (115.5s). Added seventh focused test simulating a worker persisted `running` with dead `cli-99999999` owner, attempt 1. Reconciliation reclaims it and scheduler redispatches. First corrected test failed: worker completed but attempt became **3** instead of **2**, because reconciliation increments on reset to pending and atomic claim increments again. Corrected both `coordination-reconciliation.ts` and `coordination-resume.ts` to defer increment until successful pending→running claim. Updated existing reconciliation expectation. `tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts tests/kernel/coordination-reconciliation.test.ts`: **13/13 PASS** (7 concurrency + 6 reconciliation). The earlier 61/61 PASS predates this additional recovery fix, so it must be rerun; typecheck and resume-specific tests also remain. No actual process was killed; this is a simulated dead PID and persisted state, not an end-to-end crash test. LEAN-G01 BLOCKED.

## Resume-specific tests and post-recovery broad validation — 2026-10-25

Updated `tests/kernel/coordination-resume.test.ts` expectation: reclaiming dead owner leaves attempt unchanged; only successful atomic claim increments it. Ran `tsx --test tests/kernel/coordination-resume.test.ts tests/kernel/coordination-reconciliation.test.ts tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`: **31/31 PASS**. Launched fresh scheduler/daemon broad suite (`tests/kernel/coordination-scheduler.test.ts`, `tests/daemon/coordination-scheduler-service.test.ts`) against both recovery-path fixes, output `/tmp/alix-lean-scheduler-post-recovery.txt`, final outcome pending. No commits/pushes. LEAN-G01 BLOCKED pending full qualification and real crash/side-effect behavior.

## Post-recovery validation closeout — 2026-10-25

Fresh broad scheduler/daemon suite **61/61 PASS** after both reconciliation and explicit resume retry-accounting fixes (`/tmp/alix-lean-scheduler-post-recovery.txt`, 64.8s). Focused resume/reconciliation/concurrency suite **31/31 PASS** after same fixes (`/tmp/alix-lean-recovery-all.txt`, 19.5s). Combined **92/92** test cases across these two disjoint suites. `tsc -p tsconfig.json --noEmit` **PASS**. Corrected outdated recovery comments to explain that reset-to-pending does not charge an attempt; successful atomic pending-to-running claim does. No changes committed or pushed. LEAN-G01 remains BLOCKED: these tests do not establish full real-process crash recovery, exact-once external side effects, representative workload resource budgets, or the remaining architecture audit gates.

## Real child-process exit recovery — 2026-10-25

Aligned `tests/kernel/coordination-claim-child.ts` execution owner identifier with recognized `cli-<pid>` liveness format. Added test that spawns an actual child process to atomically claim a pending worker, waits for the child to exit, verifies durable `running` status with owner PID, then invokes a separate scheduler to reclaim and complete it. Asserted one replacement execution, persisted `completed`, and attempt count 2. `tsx --test tests/kernel/coordination-scheduler-concurrent-ticks.test.ts`: **8/8 PASS** (`/tmp/alix-lean-real-child-recovery.txt`). The child exited normally after the claim; this verifies dead-owner recovery but NOT forced crash, crash-after-side-effect, or exactly-once tool semantics. Earlier broad suite **61/61 PASS** and resume/reconciliation/concurrency **31/31 PASS** predate this test-only addition. LEAN-G01 BLOCKED.

## External side-effect replay risk — 2026-10-25

A focused source search for `idempotencyKey`, `idempotent`, `operationId`, and `side.effect` in `src/capabilities/tools/executor.ts` and `src/coordination/kernel/coordination-scheduler.ts` found no explicit idempotency-key contract in those two files. This is NOT proof that no downstream tool or other subsystem supports idempotency. The atomic pending-worker claim prevents concurrent duplicate dispatch, but it cannot alone prevent a recovered worker from repeating an external operation completed before its prior execution owner exited without recording success. **RISK-REPLAY-01 (P0, unverified coverage):** map tool-level idempotency/reconciliation across file, shell, network, and plugin executors; specify stable operation identity and outcome recovery, with fail-closed approval for non-idempotent ambiguous outcomes. Test a disposable side-effect sentinel with an owner that exits after the effect but before completion is persisted. Do not claim exactly-once semantics from scheduler tests. Forced termination remains untested. LEAN-G01 BLOCKED.

## Replay-risk source trace refinement — 2026-10-25

Broader source inspection found existing protections omitted by the earlier narrow search. `src/capabilities/tools/tool-router.ts` `file.create` uses exclusive `wx` creation; on `EEXIST` it verifies a regular non-symlink file and returns `already_exists_identical` with `changed:false` if content matches. Differing content is rejected unless the caller owns the target, in which case the owned file may be rewritten. This is **content idempotency**, not general transactional exactly-once execution. `src/capabilities/tools/executor.ts` has `toolCallId`, `executionId`, `invocationId`, argument hashes, and approval claim/outcome handling: if a claimed approval produces `result.kind === 'error' && result.outcomeUnknown === true`, it leaves the claim pending for fail-closed unverified replay rather than recording a terminal receipt. These are real partial defenses; correlation IDs alone are not deduplication. `src/coordination/kernel/graph-ledger.ts` also implements idempotent graph-attempt mirroring, which is not equivalent to idempotent external tool effects. **RISK-REPLAY-01 remains OPEN but scoped** to cross-tool operation identity, side-effect receipt/reconciliation, and non-idempotent shell/API/plugin operations. Test coverage for the ambiguous-outcome tool path and forced process termination still needs confirmation. LEAN-G01 BLOCKED.

## Approved-tool crash-after-effect regression — 2026-10-25

Discovered existing `tests/security/approval-crash-recovery.test.ts` with six tests for durable consumption, unverified replay denial, success/failure receipts, uncertainty listing, first-terminal-wins, and continuation recovery. Added a seventh test: consume a real approval, apply a non-idempotent file-append sentinel exactly once, omit the success receipt, reload ApprovalStore and reconstruct ToolExecutor, then verify two replays are denied, approval becomes `unverified`, and effect count remains exactly one. `tsx --test tests/security/approval-crash-recovery.test.ts`: **7/7 PASS** (`/tmp/alix-lean-effect-before-receipt.txt`). This test simulates an effect and lost receipt without abruptly terminating the executor process. The guarantee is specifically for an **approved invocation bound to its consumed approval record**; unapproved/bypass operations, fresh new tool-call identities, arbitrary plugin/provider side effects, and forced termination are not covered. RISK-REPLAY-01 remains open for those boundaries. LEAN-G01 BLOCKED.

## Operation-receipt authority selection — 2026-10-25

Inspected `src/runtime-state/runtime/execution-persistence.ts`: `PersistenceEvidenceEmitter.emit` chains **non-blocking** appends and catches storage failures; recovery is best-effort, in-flight work is not automatically resumed, and the evidence schema lacks a stable execution ID (uses evidenceId proxy). **Do not** use this emitter as the commit barrier for external side effects. Inspected `src/coordination/kernel/coordination-store.ts`: durable authoritative runtime-ledger append with expected-version checks under `CoordinationRunLock`; JSON is explicitly a disposable projection. This is a credible reusable storage primitive for a dedicated tool-operation authority, but **do not embed tool operation receipts inside coordination-run snapshots**: tool execution also occurs outside coordination. Focused search under runtime-state/governance/capabilities found no existing `toolOperation`, `toolReceipt`, `operation.claim`, `operation.receipt`, or `idempotencyKey` vocabulary. Proposed contract: stable logical operation identity and canonical args hash, atomic claim before non-idempotent dispatch, durable terminal receipt, recovery returns completed receipt or blocks unknown claim pending reconciliation; approvals remain a separate authorization prerequisite. Define the owner module, scope and lifecycle before wiring to executor; ensure standalone CLI/TUI/API and workers share the same authority. No production implementation yet. LEAN-G01 BLOCKED.

## LEAN-G01 gate reconciliation and timer/authority inventory — 2026-10-25

Re-read `ALiX_PRE_2_0_MASTER_PRD_v1.1.md` §§LEAN-01 and LEAN-G01: the gate requires a pinned reproducible laptop baseline and full source-of-truth inventory; LEAN-01 is explicitly read-only. Earlier experimental scheduler fixes and Tool Operation Authority are **uncommitted pre-gate implementation**, not evidence of LEAN-G01 completion or authorization to proceed to LEAN-02. Treat their behavior as candidate fixes requiring later governed promotion.

Focused static inventory found durable runtime-ledger writers/readers under coordination (`coordination-store`, `collaboration-store`, `graph-executor`, `graph-ledger`), governance (`approval-store`, remote-decision projection), daemon (`task-registry`), and runtime-state (`continuation-store`, `execution-evidence-store`, `execution-state-store`, `replay-status-index`). This is a **call-site list, not yet a full owner/write authority matrix**.

Daemon timer inventory from source: coordination service has poll, renewal and heartbeat intervals; `approval-watcher` scans periodically; `daemon-server` schedules tasks every 60s and rewrites global daemon heartbeat status every 30s. The latter reads `daemon.json`, updates heartbeat/currentSessionId, and atomically renames a temporary JSON file. This is a potential **known periodic disk write**, not a measured rate or proof of excessive overhead. Lock contention uses bounded sleeps, not continuous timers. Capture actual idle event/write/CPU attribution in an isolated daemon to qualify.

**LEAN-G01: BLOCKED.** Outstanding: full state-authority table, reproducible controlled idle and active resource benchmarks, event/tick/write counts, model token/latency workload, cancellation/restart parity, and signed gate decision.

## Source-of-truth matrix evidence — 2026-10-25

Created `docs/prd/evidence/lean-01/source-of-truth-matrix.md` with 13 inspected owner/read surfaces and source-level periodic work. This is a bounded ledger-owner inventory, not a full source-of-truth inventory: non-ledger authorities, host route parity, and controlled workload measurements remain incomplete. LEAN-G01 BLOCKED.
