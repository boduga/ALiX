# LEAN-01 — Route lifecycle and authorization parity (static audit)

Source snapshot: revision `d412ea15` with dirty worktree. This matrix is source inspection, not runtime verification.

| Host / route | Dispatch | Governed intent wrapper | Tool policy / approvals | Durable evidence | Qualification |
|---|---|---|---|---|---|
| Daemon `direct` | `daemon-server.ts` → `executeRoute` → `DaemonRuntimeExecutor.executeDirect` | No | No tool invocation | Session EventLog / task registry; no governed intent wrapper | Source confirmed |
| Daemon `chat` | `executeRoute` → `executeChat` | No | No tool invocation | Session EventLog / task registry | Source confirmed |
| Daemon `tool` | `executeRoute` → `DaemonRuntimeExecutor.executeTool` → `executeToolBehavior` | No | ToolExecutor PolicyGate; **adapter omits ctx.approvalStore** | Tool events and task registry; pending approvals cannot be minted when ask and store absent | Source confirmed; runtime test missing |
| Daemon `grounded_chat` | `executeRoute` → `DaemonRuntimeExecutor.executeGroundedChat` | No | Bounded retrieval allowlist; **adapter omits ctx.approvalStore** | Session/tool events and task registry | Source confirmed; runtime test missing |
| Daemon `agent` | `daemon-server.ts` → `runTask` | AgentSession internal lifecycle | Project ApprovalStore loaded and forwarded | Agent session events, approval and coordination records as applicable | Source confirmed; restart parity untested |
| AgentSession routed `grounded_chat` | `turn.ts` → `executeRouteGoverned` → `executeRoute` | Yes: in-memory ExecutionGovernor | Runtime executor shares tool behavior | Fire-and-forget `PersistenceEvidenceEmitter` → ExecutionEvidenceStore | Source confirmed; durability on failure not guaranteed |
| Local direct/tool/chat | `LocalRuntimeExecutor` → shared route behaviors | Depends on caller wrapper | Local adapter forwards `ctx.approvalStore` for tool and grounded chat | Depends on caller | Source confirmed; entrypoint coverage pending |
| Inspector/API/TUI | Entry and lifecycle composition not exhaustively traced | Unknown | Unknown | Unknown | **Open** |

## Decision boundaries

- `TaskRouteKind` is `direct | tool | chat | grounded_chat | agent`, a dispatch choice, not a unified intent/capability authorization plan.
- `ToolExecutor.policyGate()` receives the optional store; `PolicyGate` fails closed for approval-required mutations with no store, except documented headless-safe `web.search`, `web.fetch`, and `task.complete`. Missing propagation therefore harms actionable approval flow, not proven mutation authorization.
- A governed intent auto-approval is not an operator's permission for side effects.
- A fire-and-forget evidence emitter is not a pre-effect durable claim barrier.

## Test and gate obligations

1. Adapter-level negative `ask` mutation test: no side effect, pending approval created only when the store is correctly forwarded.
2. Explicit `deny` test, plus allowed read-only web-search test, for daemon and local adapters.
3. Cancellation and restart tests across each host/route, including receipt/event ordering.
4. Trace Inspector/API/TUI and background/scheduled entrypoints to the same tool authority.
5. LEAN-01 read-only: production fix is deferred until the approved implementation phase.

**LEAN-G01 BLOCKED.**

## Additional entrypoint inventory — 2026-10-25 continuation

- **Scheduled daemon jobs:** `daemon-server.ts:115-136` loads `ScheduledTaskStore` and a global approval store, then `ScheduledTaskService.enqueue` creates a daemon task registry record and pushes `{task,taskId,cwd,client:DETACHED_CLIENT,scheduled:true}` to the same `taskQueue` consumed by `processQueue()`. This is **queue reuse**, not an independent scheduler execution engine. Since queued scheduled tasks omit a preselected route, route classification occurs in the daemon dispatch path; confirm any `scheduled`-specific branching in tests.
- **TUI:** `src/interfaces/cli/commands/tui.ts:97-127,403-405` constructs and loads an `ApprovalStore`, constructs a `PolicyGate` with that store, and constructs a `ToolExecutor` with the same store. This proves wiring at the TUI bootstrap; actual TUI tool invocation and daemon delegation remain to be traced.
- **Coordination workers:** `src/coordination/kernel/worker-executor.ts:99,125,151` injects an optional `ApprovalStore` into `runTask` from `DefaultWorkerExecutor`; verify daemon scheduler's concrete construction and restart refresh behavior.
- **Other direct `runTask` callers:** CLI research, demo, issue-run, graph executor, evaluation runner and benchmark fixtures. Each may have a different approval-store composition root; no parity claim without checking their options.
- **Inspector/API:** No proven end-to-end route trace in this pass. Remains open.

This is a read-only source audit, not a runtime authorization test.

## Inspector HTTP coordination path — additional concrete discrepancy

`src/interfaces/server/coordination-routes.ts:395-435` constructs an `ApprovalStore(cwd)`, loads it, and passes it into `new PolicyGate(config,{approvalStore})` for scheduler-level `ExecutionAuthorization`. When subagents are disabled, it constructs **`new DefaultWorkerExecutor()` without the store**. `DefaultWorkerExecutor` accepts an optional store and forwards it to `runTask` only when present (`src/coordination/kernel/worker-executor.ts:99,125-151`). Thus the scheduler and worker have different approval-store dependencies. In subagent mode, `SubagentWorkerExecutor` is used instead; its approval semantics require separate tracing.

The stateless cancellation construction in the same file (`:595-627`) also creates a `PolicyGate` with store but `new DefaultWorkerExecutor()` without store. Cancellation may not dispatch a worker, so this is a consistency finding, **not** evidence of a cancellation failure.

**Impact status:** verified construction mismatch, downstream behavior untested. Scheduler authorization can mint approvals; worker-side tool asks without a store are expected to fail closed for non-headless-safe capabilities, unless `runTask` obtains its own store. Verify `runTask` composition and create an Inspector integration test for ask→approve→resume→effect, including restart. No production changes in LEAN-01.

## Follow-up: missing worker store is shared by daemon and Inspector

`src/agents/agent/agent-loop.ts:117` forwards `opts?.approvalStore` into `initAgent`; `src/agents/agent/agent.ts:190-207` passes that optional value into both coordination handlers and `createToolExecutor`. There is no fallback store construction in this path. `DefaultWorkerExecutor.execute()` (`worker-executor.ts:99,125-151`) supplies the store to `runTask` **only if its constructor received one**; worker mode comes from `context.config.permissions.sessionMode ?? "ask"`.

Both the **daemon coordination scheduler** (`daemon-server.ts:83-95`) and the **Inspector HTTP coordination scheduler** (`coordination-routes.ts:409-425`) instantiate `new DefaultWorkerExecutor()` without the store while independently constructing a `PolicyGate(config,{approvalStore})` for scheduler authorization. The stateless Inspector cancel path does likewise. This is a **confirmed two-host constructor mismatch**, not Inspector-only.

Consequence scoped to `ask` operations: worker tool authorization has no store, so `PolicyGate` returns `approval-store-missing` deny for gated capabilities; hard allows, owned-path policy exceptions, and bypass/auto session mode must be separately assessed before predicting a specific task outcome. Do **not** equate a scheduler approval with tool-level authorization.

**Remediation candidate after LEAN-01:** inject the same project ApprovalStore into `DefaultWorkerExecutor(approvalStore)` at daemon and Inspector construction roots, and add two-host ask→approve→resume→effect integration tests. No production changes during this phase.

## Isolated subagent mode: separate approval transport

`src/coordination/kernel/subagent-worker-executor.ts:90-113` delegates to `SubagentManager.spawn` rather than passing a parent `ApprovalStore` through `runTask`. `src/agents/subagent-cli.ts:700-745` opens `openWorkerApprovalPort(projectRoot,{eventLog,workerId:taskId})` in the child process and supplies this restricted port to `createToolExecutor`. The child is intentionally not allowed to call the approval decision method. Port-open failure logs `subagent.approval_store_unavailable` and leaves gated tool calls fail-closed.

Therefore the default-worker constructor omission must **not** be generalized to isolated subagent mode. Remaining verification: child/parent identity binding, approval consumption across restarts, policy revision checks, and scheduler resumption parity. These are test obligations, not verified outcomes.

## Security review: worker approval consumption identity (static finding)

`worker-approval-port.ts` constructs a bound facade using `workerId` for `recordExecutionOutcome`, but delegates `consumeApproved: store.consumeApproved.bind(store)` directly. `approval-store.ts:943-963` rejects mismatched workers only if **both** `r.workerId` and `consumer.workerId` are truthy. A caller that omits `consumer.workerId` bypasses that specific comparison. This is a **verified identity-binding contract gap**, not a demonstrated successful unauthorized side effect. The store separately requires approved status, nonexpiry, and exact binding key; expected invocation is checked when supplied.

`worker-approval-port.ts` also forwards `request` and `requestOrReusePending` directly without forcibly inserting the bound workerId; the facade's `get`/`findExact` methods are not worker-scoped. Treat these as explicit trust-boundary questions, not automatic vulnerabilities: worker requests and lookup data may intentionally span legacy records, but their intended authority should be specified and negatively tested.

**Post-gate hardening candidates:** (1) bound worker port rejects conflicting/missing worker identities on request and consume, (2) store requires matching consumer identity whenever record is worker-bound, (3) enforce expected invocation for records requiring exact binding while preserving documented legacy semantics, (4) negative tests for wrong worker and omitted worker ID, including cross-process and restart. No production edits under LEAN-01.

## CLI/TUI/Inspector/daemon composition roots — follow-up static trace

| Entrypoint | Config and session | Approval authority wiring | Evidence / recovery | Open question |
|---|---|---|---|---|
| CLI `run` (`src/interfaces/cli/commands/run.ts:65-119`) | `loadConfig(cwd)` attempted with warning fallback; `createAgentSession` in chat and one-shot modes; chat constructs `JsonlSessionStore`. | Creates and loads project `ApprovalStore`; if unavailable, omits store and tool asks deny. | Direct generation route explicitly ephemeral/no resumable session. | Verify `processTurn` and session-store restart parity, especially failed config load. |
| TUI (`src/interfaces/cli/commands/tui.ts:80-145,399-405`) | Loads config with defaults fallback; creates `.alix/sessions/<id>` and initializes `EventLog`. | Constructs loaded project `ApprovalStore`, `PolicyGate`, and `createToolExecutor` with same store; approval UI resolves through store. | Runtime/chat/agent projections maintain separate cursors and checkpoint stores. | Trace actual invocation/delegation and approval dialog to effect and replay; config fallback defaults to `sessionMode:auto` and requires policy evaluation. |
| Inspector HTTP coordination (`src/interfaces/server/coordination-routes.ts:391-445`) | `loadConfig` in handlers; creates project `CoordinationStore`, `OwnershipRegistry`, `MetricsStore`. | Scheduler `ExecutionAuthorization` uses `PolicyGate` with loaded store; default worker constructed without store; isolated subagent uses separate port. | Scheduler persists coordination state; background handle for detached runs. | Verify ask→approve→resume, cancellation/restart, and missing worker-store liveness. |
| Daemon agent (`src/operations/daemon/daemon-server.ts:510-540`) | Reloads project config; `runTask` uses shared session `EventLog`. | `sessionMode:ask`, project approval store forwarded when available; no store means gated deny. | Session EventLog and daemon task registry. | Verify reloading store, replay and terminal event ordering. |

**Qualification:** these are constructor and call-site facts, not full end-to-end parity tests. Inspector and daemon default-worker missing-store wiring remains a source-confirmed mismatch; avoid calling it a bypass. No production changes under LEAN-01.

## Existing focused test qualification — 2026-10-25

- `pnpm exec vitest run tests/kernel/worker-tool-approval-wiring.vitest.ts --reporter=dot`: **7/7 PASS**, one file, 2.89s, exit 0, current dirty source checkout.
- Tests verify `DefaultWorkerExecutor` forwards an injected approval store to `runTask`, omits it when absent, shares a store across workers, and exercises related approval wait behavior. `runTask` is mocked for wiring tests, so these are **not** live approval-to-side-effect integration tests.
- Source confirmation: `src/operations/daemon/daemon-runtime-executor.ts:106-115` drops `_ctx.approvalStore` for tool behavior; `src/coordination/kernel/worker-executor.ts:125-151` forwards only constructor-injected store; daemon and Inspector construct default executor with no store.
- Existing `tests/runtime/route-executor-parity.test.ts` exercises shared routing behavior; `tests/server/coordination-post.test.ts` covers HTTP route input validation/cancellation idempotency. Neither is demonstrated to assert daemon/Inspector ask→approve→resume tool-level store propagation.
- **Remaining acceptance:** isolated host-level negative ask/deny tests with observable no-side-effect assertions; host construction tests that fail on missing store; successful operator approval resumption, restart, cancellation, and receipt ordering. No production fix authorized in LEAN-01.

## Host construction characterization — 2026-10-25

- Added `tests/security/host-approval-wiring-characterization.vitest.ts` (source-only, no tool effects). `pnpm exec vitest run tests/security/host-approval-wiring-characterization.vitest.ts --reporter=dot`: **4/4 PASS**, 161 ms, exit 0.
- Assertions capture current **missing-store** construction at daemon and Inspector default-worker roots, daemon `executeTool` omission of context store, and `DefaultWorkerExecutor`'s existing constructor-store forwarding. These are **defect characterization**, NOT desired acceptance: passing means the mismatches are still present.
- Limitations: text-based source assertions can be brittle and do not prove an end-to-end approval flow, a side effect, or fail-closed policy at runtime. Host-level integration tests and independent review remain required before any production remediation or LEAN-G01 promotion.

## Daemon adapter executable characterization — 2026-10-25

- Added `tests/security/daemon-adapter-approval-characterization.vitest.ts`; `pnpm exec vitest run tests/security/daemon-adapter-approval-characterization.vitest.ts --reporter=dot`: **2/2 PASS**, 204 ms, exit 0.
- Instantiates actual `DaemonRuntimeExecutor`, supplies runtime context with a sentinel `approvalStore`, and mocks downstream `executeToolBehavior`, `executeGroundedChatBehavior` and config loading. Both methods pass dependency objects **without** the sentinel store. Tool adapter emits marker + mocked result; no real tool, network or provider invocation.
- **Defect-characterization only:** green documents missing forwarding, not correct security behavior. Remaining: real PolicyGate ask/deny behavior in an isolated fixture; host-specific worker construction/resume and restart parity; negative no-side-effect assertions; independent gate review.

## Isolated real PolicyGate storeless denial — 2026-10-25

- Added `tests/security/policy-gate-storeless-denial.vitest.ts`: real `PolicyGate` with `sessionMode:ask`, explicit `file.create:ask`, no approval store, disposable temp directory. `pnpm exec vitest run tests/security/policy-gate-storeless-denial.vitest.ts --reporter=dot`: **1/1 PASS**, 333 ms, exit 0.
- Observed `decision=deny`, `matchedRuleId=approval-store-missing`; verified proposed target file absent. **Scope:** gate evaluation only, not an actual ToolExecutor call or daemon/Inspector end-to-end request; absence of side effect is expected because test does not execute the tool.
- Together with host characterization, this supports a **fail-closed liveness gap hypothesis**, not a demonstrated authorization bypass. Still need real host ask→approval→resume and restart/cancel tests, then independent review.

## Inspector approval-wait, restart and cancel source trace — 2026-10-25

| Mechanism | Source | Observed contract | Remaining validation |
|---|---|---|---|
| Approval-wait polling | `src/interfaces/server/coordination-routes.ts:442-461` | Detached scheduler `runUntilIdle` loops every 3 seconds only while `stopReason=awaiting_approval` and run remains in process-local `backgroundSchedulers`; finally deletes handle. | Actual approval resolution, progress, shutdown race and cancellation. |
| Inspector restart | `src/interfaces/server/coordination-routes.ts:528-584` | `findResumableRuns` restricted to inspector/cli, reclaims dead owners, requires pending/running worker and no live worker, restores persisted `run.sessionMode`, reconstructs scheduler. | Cross-process restart tests, approved pending worker consumption, no duplicate effect. |
| Live/stateless cancel | `src/interfaces/server/coordination-routes.ts:586-638` | Live handle calls `cancelRun`; otherwise loads persisted run and creates scheduler to cancel; unknown run returns idempotent success without config. | Real in-flight cancel and effect race; note stateless branch constructs default worker without approval store (cancellation path). |
| Daemon approval wakeup | `src/operations/daemon/approval-watcher.ts:22-86` | Separate 30s polling watcher scans store and requests ticks for newly resolved run approvals; scheduler periodic polling remains authority. | Watcher restart cursor and external process writes; prove timely resumption and no lost resolutions. |

**Status:** static trace only, not an executed Inspector restart/resumption scenario. Existing `tests/server/coordination-post.test.ts` checks unknown-run cancel and `cancelAllBackgroundRuns` idempotency, not real resumed side effects. LEAN-G01 remains BLOCKED.

## Persisted Inspector restart candidate selection — 2026-10-25

- Added `tests/security/inspector-restart-selection.vitest.ts`: real `CoordinationStore` writes and a fresh store instance for reads, isolated temporary workspace. `pnpm exec vitest run tests/security/inspector-restart-selection.vitest.ts --reporter=dot`: **2/2 PASS**, 2.08s, exit 0.
- `findResumableRuns(store, ['inspector','cli'])` selected active inspector/cli runs (`planning`, `running`, `blocked`), excluding daemon, terminal and unspecified host. A blocked run with a pending worker was discoverable; read-only selection did not mutate worker/run status.
- **Boundary:** this test calls the read-only `findResumableRuns` seam, **not** `resumeInspectorRuns` or `runDetached`; it does not prove reclaim, approval consumption, execution, cancellation, or cross-process crash recovery. Those remain open LEAN-G01 acceptance questions.

## Persisted Inspector dead-owner reclaim — 2026-10-25

- Added `tests/security/inspector-dead-owner-reclaim.vitest.ts` using a disposable `CoordinationStore`, fresh store instance and real `OwnershipRegistry`, no scheduler or worker tool. Initial run **1/1 FAIL** with fixture `executionOwnerId=inspector-99999999`: owner parser deliberately accepts only `web|tool|cli|daemon` PID prefixes and treats unknown owners as alive. Inspector source constructs `web-${process.pid}`.
- Corrected fixture to `web-99999999` (provably absent PID): rerun **1/1 PASS**, 1.10s, exit 0. Reclaim transitioned `running`→`pending`, cleared owner, preserved `attempt=1`; repeat reclaim returned no workers, preserving attempt. This confirms the read/reclaim persistence seam, not a full `resumeInspectorRuns()` dispatch.
- **Boundary:** attempt increment on actual re-dispatch, lease release with real held leases, approval resumption and exactly-once external effects remain unverified. No production changes; LEAN-G01 BLOCKED.

## Inspector scheduler redispatch after reclaim — 2026-10-25

- Added `tests/security/inspector-reclaim-redispatch.vitest.ts`: real `CoordinationScheduler`/`CoordinationStore` in disposable workspace, simulated authorization/ownership and fake executor; host identity `web-${process.pid}` and persisted dead `web-99999999` owner. `pnpm exec vitest run tests/security/inspector-reclaim-redispatch.vitest.ts --reporter=dot`: **1/1 PASS**, 1.43s, exit 0.
- Scheduler tick recovered orphan, executed fake worker once, completed it, charged attempt **1→2** (not 3). Repeated tick left execution count and attempt unchanged. No external tools or effects invoked.
- **Scope:** isolated scheduler recovery, not Inspector HTTP startup, actual `DefaultWorkerExecutor`, operator approval consumption, crash after external effect, or end-to-end exactly-once guarantees. LEAN-G01 remains BLOCKED.

## Inspector retry ceiling and cancel-before-recovery — 2026-10-25

- Added `tests/security/inspector-exhausted-retry.vitest.ts`: real scheduler/store, fake worker and authorization, dead `web-99999999` owner, attempt=maxAttempts=3. `pnpm exec vitest run tests/security/inspector-exhausted-retry.vitest.ts --reporter=dot`: **1/1 PASS**, 1.35s. Recovery ends `failed`, attempt stays 3, zero fake worker executions, repeat tick does not dispatch.
- Added `tests/security/inspector-cancel-recovery.vitest.ts`: persisted running worker with dead web owner, real scheduler `cancelRun` before recovery tick. `pnpm exec vitest run tests/security/inspector-cancel-recovery.vitest.ts --reporter=dot`: **1/1 PASS**, 1.63s. Persisted run/worker both `cancelled`, zero fake worker executions.
- **Boundary:** cancel-before-tick is not a concurrent cancellation race or external-effect rollback; both tests use simulated executors and do not prove real Inspector HTTP approval-to-effect parity. LEAN-G01 BLOCKED.

## Inspector recovery cancellation race — 2026-10-25

- Added `tests/security/inspector-recovery-cancel-race.vitest.ts`: persisted dead-web-owner running worker; real scheduler tick suspended at config provider, `cancelRun` commits before dispatch, tick released. `pnpm exec vitest run tests/security/inspector-recovery-cancel-race.vitest.ts --reporter=dot`: **1/1 PASS**, 1.42s, exit 0. Zero fake executions, no dispatched worker, run and worker cancelled, attempt remains 1.
- **Boundary:** deterministic pre-dispatch race, not cancellation after a tool effect, real Inspector HTTP restart, approval consumption, or exactly-once effect guarantee.

## Inspector recovery gate-readiness snapshot — 2026-10-25

| Evidence seam | Result | Qualification |
|---|---|---|
| Persisted Inspector/CLI restart candidate discovery | 2/2 PASS | `findResumableRuns` only; no `resumeInspectorRuns` execution |
| Dead owner reclaim/idempotency | 1/1 PASS | Real store and registry; dead `web-<pid>` fixture |
| Reclaim and bounded fake redispatch | 1/1 PASS | Real scheduler; fake authorization, ownership and executor |
| Exhausted retry budget | 1/1 PASS | Zero fake worker invocations at attempt 3/3 |
| Cancel before recovery tick | 1/1 PASS | Real scheduler; no external effects |
| Cancel racing with recovery before dispatch | 1/1 PASS | Deterministic suspended config provider; zero fake invocations |
| Real gate storeless ask denial | 1/1 PASS | PolicyGate decision only; no ToolExecutor |
| Daemon/Inspector approval dependency forwarding | 2/2 + 4/4 characterization PASS | Tests reproduce missing forwarding/wiring; passing does NOT mean correct security behavior |

**Gate verdict: LEAN-G01 BLOCKED.** These focused tests establish useful recovery invariants but do not satisfy host end-to-end approval→consume→effect→restart parity. Open: Inspector `resumeInspectorRuns` with actual DefaultWorkerExecutor, daemon approval store injection, isolated subagent approval identity, crash/side-effect receipt handling, local/cloud runtime benchmarks, and independent review. No production code changed, committed or pushed in this sequence.

## Consolidated focused suite and host approval readiness — 2026-10-25

- Reran ten focused files together: `tests/security/{host-approval-wiring-characterization,daemon-adapter-approval-characterization,policy-gate-storeless-denial,inspector-restart-selection,inspector-dead-owner-reclaim,inspector-reclaim-redispatch,inspector-exhausted-retry,inspector-cancel-recovery,inspector-recovery-cancel-race}.vitest.ts` plus `tests/kernel/worker-tool-approval-wiring.vitest.ts`. **10/10 files, 21/21 tests PASS**, 7.83s, exit 0.
- Host composition trace rechecked: Inspector `buildCoordinationRuntime` loads `ApprovalStore(cwd)` and injects it into scheduler `PolicyGate`, but in-process branch constructs `new DefaultWorkerExecutor()` without the store. Daemon scheduler follows the same pattern. Worker constructor forwards the store to `runTask` when injected; existing F8 tests verify that seam.
- **Decision:** do not call Inspector host-level ask→approve→resume accepted. A host composition/integration negative fixture must first demonstrate no unauthorized effect with the real executor path, and a separately reviewed remediation must inject the authoritative store without weakening per-tool authorization. Isolated subagent child path needs its own identity-bound approval review. LEAN-G01 BLOCKED; no production code edits authorized by this evidence.

## Prospective host approval-store injection acceptance (RED baseline) — 2026-10-25

- Added `tests/security/host-approval-injection-acceptance.vitest.ts`, a **prospective source-level** contract for Inspector and daemon coordination hosts to pass their scheduler's `approvalStore` to `DefaultWorkerExecutor`.
- `pnpm exec vitest run tests/security/host-approval-injection-acceptance.vitest.ts --reporter=dot`: **0/2 PASS, 2/2 FAIL as expected**, 196ms. Both production hosts still construct `new DefaultWorkerExecutor()` without the store. This is an intentionally RED test file and must not be counted as a passing suite.
- **Qualification:** source regex is a design signal, not proof of runtime authority identity, approval binding, tool denial, or side-effect safety. Independent review and behavior-level negative tests remain prerequisites. No production changes authorized; LEAN-G01 BLOCKED.

## Approval identity characterization rerun — 2026-10-25

- `pnpm exec vitest run tests/security/worker-approval-identity-characterization.vitest.ts --reporter=dot`: **4/4 PASS**, 3.51s, exit 0. This is deliberately defect-characterization coverage, NOT security acceptance: tests reproduce missing consumer worker identity enforcement, wrong-worker restricted-port consumption and request attribution issues.
- Prospective acceptance must invert these outcomes: bound approval requires matching nonempty consumer worker ID and attempt, restricted worker port must not consume or request on behalf of another worker, and invocation fingerprint must be checked against the approved request. Authorized single-use happy path must remain valid. These negative acceptance behaviors have not yet been implemented or verified.
- Host injection prospective test remains **0/2 (expected RED)**; neither source-level RED test nor passing characterization is a gate sign-off. LEAN-G01 BLOCKED.

## Worker approval identity prospective acceptance (RED baseline) — 2026-10-25

- Added `tests/security/worker-approval-identity-acceptance.vitest.ts` against real disposable `ApprovalStore` and `createWorkerApprovalPort`. Test run: **3 expected FAIL, 1 PASS** (4 total, 4.21s). The failed requirements are reject missing consumer worker ID, reject worker-B port consuming worker-A approval, and prevent worker-B port from attributing its request to worker A. The passing control rejects an explicitly mismatched consumer worker ID.
- **Qualification:** test process output was piped to `tail`, so shell exit status reflects `tail`, not Vitest; Vitest itself reported 1 failed file. This is intentional RED and cannot be counted as a green security suite. Invocation/attempt mismatch and authorized happy path still need prospective acceptance coverage.
- No production edits; independent review pending. LEAN-G01 BLOCKED.

## Worker approval attempt/invocation prospective acceptance (RED baseline) — 2026-10-25

- Added `tests/security/worker-approval-invocation-acceptance.vitest.ts` with disposable real `ApprovalStore`, no external tool effects. Vitest reported **2 FAIL / 2 PASS** (4 tests, 3.81s). Wrong worker attempt was incorrectly consumed; an invocation-bound approval was consumed when the caller omitted expected invocation identity. Both are expected RED security acceptance gaps.
- Passing controls: explicit changed `argsHash` invocation identity denied; matching worker/attempt/invocation consumed once and replay denied. These are isolated store-level controls, not end-to-end authorization guarantees.
- Run used `2>&1 | tail -42`, so shell status is not Vitest status; Vitest reported failed file. Identity prospective suite separately remains 3 FAIL / 1 PASS, host injection prospective suite 2 FAIL. Independent review remains pending; LEAN-G01 BLOCKED.

## Consolidated approval remediation reviewer contract — 2026-10-25

- Created `docs/prd/evidence/lean-01/approval-remediation-review-contract.md` (50 lines), **PROPOSED**, independent review pending. Consolidates 7 prospective RED acceptance requirements / 3 passing controls across host injection, store identity/attempt/invocation, and restricted worker-port attribution.
- Records eight authority invariants, six independent reviewer decisions (R1–R6), explicit legacy/child-process/crash-recovery concerns, and promotion conditions requiring behavior-level host proof. This is a review packet, not implementation authorization or gate acceptance. LEAN-G01 BLOCKED.

## Reviewer decision alignment — 2026-10-25

- Added R1–R6 → D1–D9 crosswalk to `approval-remediation-review-contract.md`. The existing `worker-approval-independent-review-packet.md` is the sole independent decision record; no duplicate sign-off authority. Reviewer identity, revision, decisions and verdict remain PENDING. LEAN-G01 BLOCKED.

## Authorized D1–D9 remediation implementation checkpoint — 2026-10-26

- User explicitly authorized implementation. Local uncommitted production edits to `src/governance/approvals/approval-store.ts` enforce matching worker ID and attempt on worker-bound consumption and mandatory invocation fingerprint verification for invocation-bound approvals. `src/governance/approvals/worker-approval-port.ts` rejects conflicting bound-worker request attribution and supplies bound worker identity to consumption. These are partial implementation, NOT independent sign-off.
- Reconciled existing legitimate worker-port test fixtures to supply attempt 0; prospective cross-worker attribution test now asserts a synchronous throw. `pnpm exec vitest run tests/security/worker-approval-identity-acceptance.vitest.ts tests/security/worker-approval-invocation-acceptance.vitest.ts tests/security/worker-approval-port.vitest.ts --reporter=dot`: **24/24 PASS**, 3 files, 74.75s, exit 0.
- Initial `pnpm exec tsc --noEmit --pretty false` found four test typing errors (two unsupported `capability` properties in requestOrReusePending fixtures and two mock call tuple indexes). Corrected test-only typing. Rerun **PASS**, exit 0, 19.60s.
- **Outstanding:** worker read scoping D7, request() attribution, D6/D8 migration compatibility proof, host wiring (prospective 0/2 RED), PolicyGate consumption context, isolated child/restart/cancellation/E2E D9, independent D1–D9 reviewer. LEAN-G01 BLOCKED. No commit/push.

## Authorized D7 worker visibility implementation — 2026-10-26

- `src/governance/approvals/worker-approval-port.ts` now scopes `get`, `loadFresh`, `findExact`, `findPendingByBindingKey`, `findPending`, `findResolved`, and `findByRequestId` to records whose workerId matches the port's bound identity, or explicit unbound legacy records. Unbound ports cannot see worker-owned records. `markExecutionUnverified` rejects records outside this visibility boundary.
- Added `tests/security/worker-approval-visibility-acceptance.vitest.ts` verifying worker B and unbound ports cannot read worker A's pending approval or mark it unverified; authoritative store remains pending. Updated older worker-port fixtures to reflect legitimate bound reads rather than permitting cross-worker visibility.
- Focused Vitest 4 files **25/25 PASS**, exit 0, 43.37s; `pnpm exec tsc --noEmit --pretty false` **PASS**, exit 0, 19.43s.
- Remaining: `request()` legacy attribution policy; lookup ambiguity if first store result is another worker; atomic authorization for status mutations (TOCTOU); D6/D8 migration and compatibility; host-level PolicyGate/Inspector/daemon and child E2E D9. Independent reviewer pending, LEAN-G01 BLOCKED. No commit/push.

## D6/D8 persisted approval compatibility — 2026-10-26

- Added `tests/security/worker-approval-legacy-migration-acceptance.vitest.ts` (3 tests) with real disposable ledger/store reload: legacy non-worker approval consumes once after reload; persisted worker-bound approval rejects absent worker/attempt; persisted invocation-bound approval rejects omitted/changed invocation while accepting exact match. **3/3 PASS**, 6.11s, exit 0.
- `pnpm exec tsc --noEmit --pretty false`: **PASS**, exit 0, 19.23s.
- This is targeted D6/D8 compatibility evidence, **not** exhaustive schema migration validation. Existing legacy authorization paths and historic record variants need independent review; host integration and mutation TOCTOU remain. LEAN-G01 BLOCKED. No commit/push.


## Authorized D7 atomic outcome implementation — 2026-10-26

- Atomic ownership enforcement now lives inside the store mutation lock for outcome reporting and unverified classification. Restricted ports supply captured trusted worker context; unbound ports cannot mutate worker-bound records. Explicit legacy non-worker and privileged host paths remain documented.
- [D7 implementation and executed evidence](D7-atomic-outcome-authorization.md): focused acceptance 86/86, Vitest regression 49/49, rebuilt Node regression 58/59 (including both fresh-process D7 cases passing). Typecheck, unused-code check, build and diff whitespace check passed. Automated DOX check blocked by sandbox child-process EPERM; no bypass.
- This evidence supersedes the earlier pending D7 mutation-TOCTOU item only. At this initial D7 snapshot, the coordination consumption propagation test failed because PolicyGate supplied no consumer context or expected invocation; the follow-up below supersedes that result. Other D1–D9 integration, migration, attribution and independent-review gaps remain. D7 is available for independent review with those limits; LEAN-G01 remains BLOCKED and independently unreviewed. No commit/push/merge.


## Coordination consumption regression verified — 2026-10-26

- The operator-supplied PolicyGate change was verified without additional production authorization edits. The prior Vitest session finished successfully. The rebuilt coordination propagation suite passed **4/4**, including ledger reload assertions for worker `w1`, attempt `0`, exact binding/invocation, and replay denial with the same persisted consumed claim and no replacement approval.
- Re-run evidence: combined D7/Vitest regressions **135/135 PASS**; other rebuilt Node approval/security regressions **55/55 PASS**; **194 distinct tests passed / 0 failed** in total. Build, typecheck, unused-code check and diff whitespace validation passed. See [the D7 evidence follow-up](D7-atomic-outcome-authorization.md#follow-up-coordination-regression-verification--2026-10-26) for commands, durations and limits.
- The coordination consumption regression is verified passing. D9 host/isolated-worker end-to-end integration and independent security review remain pending. LEAN-G01 remains **BLOCKED**, incomplete and independently unreviewed. No blocked operation was bypassed; no commit/push/merge.


## D9 daemon tool-continuation implementation — 2026-10-26

- Authorized local source reads succeeded; no blocked inspection was bypassed. Reproduced the original daemon wiring regression RED, then wired the daemon watcher to a context-validating continuation host. The default in-process worker attributes its paused tool from captured events; the scheduler keeps the approval pause blocked. Exact approved execution preserves canonical agent/worker/attempt/invocation and owned scope, releases its own leases, and updates the worker to pending only after a durable successful receipt. It does not mark the whole worker complete.
- [D9 implementation, changed files and actual verification](D9-daemon-tool-continuation-integration.md): final D9 **21/21 PASS**, broader Vitest **157/157 PASS**, compiled Node regressions **311/311 PASS** (including architecture gates). Latest unique inventory **469 passing tests**; repeated executions are not counted twice. Build, TypeScript and unused-code checks passed. DOX automation remains blocked; no allowlist change or safety bypass.
- The specific daemon-continuation regression is GREEN. Full D9 qualification remains incomplete: actual daemon/isolated-worker process restart, multiple/unattributed continuations, interrupted receipt-to-worker-state recovery, full in-flight cancellation/lease-renewal interleavings and independent security review remain open. LEAN-G01 remains **BLOCKED**, incomplete and independently unreviewed. No commit/push/merge.


## D9 isolated tool/result boundary investigation — 2026-10-26

- [Retained investigation and CLI evidence](D9-isolated-boundary-investigation.md) identifies run `coord_36518aec-0ae3-4099-b21b-b886a8f19849`: the receipt mutation completed, but the outer worker result failed with `Objective review: Reviewer requested tools instead of returning a verdict`. The subsequent pending approval is a new dispatch binding, not proof that the original file tool lacked authorization.
- The scripted trace's global tool step after the worker invocation suggests review-scenario routing as the next investigation target. This does not prove the reviewer misclassified a valid verdict; a missing verdict must remain fail-closed.
- Full tool-level authorization decisions/matched rule IDs are unavailable through the queried CLI projections and audit reads. Neither authorization bypass nor an alternate owned-scope grant is established. An authorized decision export is still needed. No blocked source/protected-state read was bypassed; no production/test change or new execution was performed.
- The earlier 469 passing tests do not qualify this isolated run. **D9 remains BLOCKED; LEAN-G01 remains BLOCKED and independently unreviewed.**


## D9 reviewer fixture and tool authorization verified — 2026-10-26

- [Paired actual-daemon evidence](D9-review-routing-daemon-verification.md): the frozen baseline records the real file-tool allow via `owned-path-rule`, then reproduces the reviewer tool-call rejection and another pending dispatch. Changing only the global review scenario to a structured verdict yields worker success on attempt 1, exactly one receipt mutation and one consumed dispatch approval, with no second grant across the follow-up polling window. No production authorization or reviewer rule changed.
- Both actual daemon probes passed their stated assertions and exited cleanly. Routing/reviewer regressions **40/40 PASS**; build and final TypeScript validation passed. Observer exports include request/argument hash, canonical agent/scope, matched rule, policy revision, ExecutionAuthorization result and lifecycle events. The private Unix socket ran only after the exact test command passed the tool's approval review; no denied socket operation was bypassed.
- This fixture follows owned-scope authorization and does not exercise a tool-specific ask/approve/resume cycle. The corrected run still reports **verification=unverified** and lacks observed aggregate-completion event evidence. Actual isolated-worker recovery and independent security review remain pending. **D9 is incomplete; LEAN-G01 remains BLOCKED and independently unreviewed.**


## D9 daemon completion evidence verified — 2026-10-26

- [Actual daemon RED/GREEN and regression evidence](D9-daemon-completion-event-verification.md): a required-verification assertion reproduced the missing event. The daemon now routes lifecycle/finalization appends into each persisted run's own session through an append-only sink. A new run reports **verification=verified** using the unchanged derivation and exactly one matching run/ref/fingerprint event. Historical aggregates without that event remain unverified; no synthetic backfill or verified flag is introduced.
- Worker attempt 1, exactly one receipt mutation, consumed dispatch grant, `owned-path-rule` tool allowance and no extra approval remain unchanged. Current regressions: **61/61 Vitest + 173/173 Node PASS** (234 distinct cases, including architecture and finalization guards). Build, typecheck, unused-code and whitespace/JSON checks passed. DOX automation remains blocked, not bypassed.
- The missing completion-event wiring is resolved for the newly finalized daemon case. Actual tool-specific ask/approve/resume, isolated-worker and recovery qualification and independent security review remain open. **D9 is incomplete; LEAN-G01 remains BLOCKED and independently unreviewed.** No commit/push/merge.

## D9 completion-event concurrency qualification — 2026-10-26

- [Executed conditional-append evidence](D9-completion-concurrency-verification.md): eight independent instances concurrently return one durable completion event; a fresh instance retries a persisted event after simulated acknowledgement loss without adding another. Exact-identity separation also passes.
- **35/35 Node tests PASS**: 3 new cases, 18 EventLog regressions, and the existing 14 finalization cases. Build, typecheck, unused-code and whitespace checks pass. DOX automation remains blocked on HEAD resolution.
- Conditional deduplication across OS processes and actual process-kill/power-loss recovery are not established by these new tests. This is no independent review or full host qualification. **D9 and LEAN-G01 remain BLOCKED.** No production authorization change, commit, push or merge.

## D9-R3 actual daemon restart reconciliation — 2026-10-26

- [Executed RED/GREEN and process evidence](D9-R3-daemon-restart-reconciliation.md): two distinct compiled daemon OS processes, disposable project/HOME/socket, one matching completion event with unchanged ID/sequence/ref/fingerprint after clean restart. Worker statuses/attempts/result references, results and execution-effect evidence remain unchanged.
- Startup now selects locked reconciliation-only validation and never regenerates stale or missing aggregate evidence. Stale fingerprint, wrong host and missing aggregate remain unverified across both startups. No approval or authorization rule changed.
- **89 final tests PASS**: 52 compiled Node (including 5 actual-daemon cases, D9 process/concurrency, EventLog, finalization and architecture) plus 37 Vitest (cursor and D9 routing/continuation). Build, typecheck and unused-code checks pass. Earlier compile/readiness failures and the 2-pass/3-fail contract RED are retained separately. DOX automation remains blocked on HEAD resolution.
- **D9-R3 PASS within the stated scope; D9 and LEAN-G01 remain BLOCKED and independently unreviewed.** Abrupt daemon startup interruption, active-worker/tool-receipt recovery, remaining approval/lease/cancellation qualification and independent review are not established by this clean-restart case. No commit/push/merge.
