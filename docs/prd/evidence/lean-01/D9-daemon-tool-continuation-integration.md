# LEAN-G01 D9 — Daemon tool continuation integration

2026-10-26, author implementation and executed verification. **LEAN-G01 remains BLOCKED.** This is neither independent security review nor complete D9 host/child qualification.

## Source access and baseline

Local `exec_command` reads of the daemon, watcher, continuation manager/store, executor and applicable DOX contracts succeeded in this session. No sandbox escalation or bypass of the previously reported source-access restriction was used. The existing `daemon-tool-continuation-wiring.vitest.ts` regression was run first: **0 passed / 1 failed**, exit 1, because the daemon/watcher did not invoke `resumeApproved`.

The missing integration included both the resumption callback and preservation of worker context: a callback alone could resume an operation without its original scope, and an executor approval pause was previously classified as a terminal/retryable worker failure.

## Implementation contract

- `DefaultWorkerExecutor` attributes a single pending tool continuation using only approval diagnostics captured through that worker invocation's EventLog. It does not search a shared session and guess a worker or derive identity from model metadata. Still-pending/approved records receive optional `PendingContinuation.coordinationWorker` data: run, worker, attempt, claim hash and scope snapshot. Already consumed records cannot be rebound into a new approval pause.
- `CoordinationScheduler.executeWorker` stores a returned tool `approval_required` result with its durable ID as `blocked`, clears dispatch-only authorization evidence, and keeps the run nonterminal. Scheduler dispatch reconciliation does not consume this tool approval.
- `ApprovalWatcher` invokes the injected continuation host on each scan of durable approved/denied records, including after host reconstruction. Resolution-count ordering is not used as an execution cursor. Dispatch-approval notifications remain separate scheduler tick requests.
- `DaemonToolContinuationResumer` accepts only daemon-hosted blocked write workers with matching approval, run session, worker ID, attempt, ownership-claim hash and scope snapshot. It checks the original invocation, including canonical agent identity, tool/capability, argument hash, workspace and session. Pending, mismatched, cancelled, expired, consumed or unattributed approvals never launch the operation.
- The host acquires tracked ownership leases for the original canonical tool agent, renews them while execution runs, disables automatic lease acquisition in the resumed executor and releases only its own lease IDs before requeueing. A conflicting owner remains a denial. Canonical agent identity is never replaced by the worker ID; the worker ID/attempt are supplied separately to the atomic approval consumer through the restricted worker port.
- Resumption uses `ContinuationManager` and the existing `ToolExecutor` ownership/invocation/single-use claim path. The original approval binding and fingerprint remain authoritative. A durable successful outcome returns the worker to `pending` for normal scheduling and objective review; one successful tool call is never reported as whole-worker completion. A durable failed tool outcome marks the worker failed; explicit operator denial also fails the worker without executing. Unknown outcomes remain blocked, never replayed on inference.
- Run/context changes are observed while the tool is in flight and abort its signal. Daemon shutdown aborts and drains active resumes. Event logs created for each resume are closed. These mechanisms add no agent wall-clock deadline.
- Protected store, EventLog and ownership constructors remain at their existing authorized owners. The executor adds three host APIs (`pendingContinuations`, `bindContinuationWorker`, `resumeApprovedContinuation`) behind its existing continuation-store seam; none is a model-facing tool or an approval decision method. The daemon injects its existing authoritative stores, registry and log factory. No R1/layer allowlist was changed.

## Changed files in this task

| Path | Change |
|---|---|
| `src/capabilities/tools/executor.ts` | Host continuation operations using the existing storage/execution seams |
| `src/coordination/kernel/worker-executor.ts` | Capture the originating worker context and return durable approval pauses |
| `src/coordination/kernel/worker-tool-continuation.ts` | Bind only the worker invocation's single pending continuation |
| `src/coordination/kernel/coordination-scheduler.ts` | Persist a tool approval pause as blocked rather than terminal/retry failure |
| `src/runtime-state/runtime/continuation-store.ts` | Optional typed host worker attribution; old records remain readable |
| `src/operations/daemon/approval-watcher.ts` | Injected resumption callback, durable per-scan retries and scan-error reporting |
| `src/operations/daemon/tool-continuation-resumer.ts` | Context, invocation, lease, receipt and guarded worker-state integration |
| `src/operations/daemon/daemon-server.ts` | Wire the shared host dependencies and shutdown |
| `tests/security/daemon-tool-continuation-acceptance.vitest.ts` | Real store/router/executor acceptance and authorization parity |
| `src/capabilities/tools/AGENTS.md`, `src/coordination/kernel/AGENTS.md`, `src/runtime-state/runtime/AGENTS.md`, `src/operations/daemon/AGENTS.md` | Local ownership and contracts |
| `docs/prd/evidence/lean-01/D9-daemon-tool-continuation-integration.md`, `docs/prd/evidence/lean-01/route-parity-matrix.md` | Executed evidence and gate limits |

Existing unrelated staged, unstaged and untracked changes were preserved. Root and `docs/AGENTS.md` were intentionally left untouched: no repository-wide rule or child index changed. No commit, push or merge was performed.

## Executed verification

Node v26.11.0; real dirty working tree, no stash/isolation rewrite, no real-model calls.

| Check | Actual result |
|---|---|
| Original D9 wiring baseline | **0/1 pass**, exit 1 (expected RED reproduced) |
| Final D9 wiring + acceptance | **21/21 pass**, 2 files, exit 0; 54.63 s |
| Broader D7/approval/host-injection Vitest | **157/157 pass**, 11 files, exit 0; 140.32 s. Includes an earlier 20-case version of the D9 pair; superseded for D9 by the final 21-case run |
| Compiled Node regression set | **311/311 pass**, 21 suites, exit 0; 160.74 s |
| R1 and layer boundary tests | **8/8 pass**, also included in the Node total; no new/stale allowlist entries |
| Final `pnpm build` and `pnpm typecheck:unused` | PASS, exit 0 |
| Final `pnpm typecheck` | PASS, exit 0 |
| `git diff --check` | PASS |
| `pnpm check:dox` | BLOCKED, exit 2: its child-process lookup reports `cannot resolve --head 'HEAD'`; the existing sandbox spawn limitation is retained, not bypassed |

The latest unique test inventory is **469 passing tests**: 135 D7/approval Vitest cases + 2 host-injection cases + 21 final D9 cases + 311 Node cases. Repeated D9 and architecture executions are not counted twice. No final-run test failures, skips or cancellations were observed.

The D9 parity suite covers: approved exact single-use execution and durable consumer identity/attempt/fingerprint; worker requeueing; no leaked ownership leases; failed tool receipts; pending and denied approvals; cancelled runs; wrong host/worker/attempt/claims/scopes/agent/session/workspace; changed arguments; unattributed records; out-of-scope writes; conflicting leases; stopped host; concurrent hosts with exactly one `file.created` event; and scheduler nonterminal approval pauses.

The Node set covers architecture, approval watcher, scheduler, continuation manager/store, coordination consumption, crash recovery, legacy single-use, D7 fresh processes, policy gate, executor, router and ownership path parity.

Commands:

```sh
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/daemon-tool-continuation-wiring.vitest.ts tests/security/daemon-tool-continuation-acceptance.vitest.ts
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/daemon-tool-continuation-wiring.vitest.ts tests/security/daemon-tool-continuation-acceptance.vitest.ts tests/security/worker-approval-atomic-outcome-acceptance.vitest.ts tests/security/worker-approval-port.vitest.ts tests/security/worker-approval-identity-acceptance.vitest.ts tests/security/worker-approval-invocation-acceptance.vitest.ts tests/security/worker-approval-legacy-migration-acceptance.vitest.ts tests/security/worker-approval-visibility-acceptance.vitest.ts tests/security/approval-event-dedup.vitest.ts tests/approvals/approval-store-events.vitest.ts tests/security/host-approval-injection-acceptance.vitest.ts
node --test --test-isolation=none --test-concurrency=1 dist/tests/architecture/r1-boundary-freeze.test.js dist/tests/architecture/layer-boundaries.test.js dist/tests/daemon/approval-watcher.test.js dist/tests/kernel/coordination-scheduler.test.js dist/tests/runtime/continuation-manager.test.js dist/tests/runtime/continuation-store.test.js dist/tests/security/approval-consumed-propagation.test.js dist/tests/security/approval-crash-recovery.test.js dist/tests/security/legacy-approval-single-use.test.js dist/tests/security/worker-approval-atomic-restart.test.js dist/tests/policy/policy-gate.test.js dist/tests/tools/tool-router.test.js dist/tests/executor.test.js dist/tests/ownership/path-scope.test.js
pnpm build
pnpm typecheck
pnpm typecheck:unused
pnpm check:dox
git diff --check
```

Earlier implementation checks are retained as diagnostics: the first execution suite had 14 passes and one failure because its assertion expected `tool.completed`, which the existing continuation fast path does not emit. The final assertion checks the actual router `file.created` mutation evidence plus the durable single-use receipt. One test-only scheduler-stub TypeScript assertion failed and was corrected; no production enforcement was relaxed. Explicit lease ownership/cleanup and log closure were then added and the final D9 pair was rerun.

## Remaining qualification gaps

- This is deterministic in-process host integration. The D9 tests reconstruct the host objects over real persisted stores and run concurrent resumers; they do not spawn an actual daemon/socket client, kill/restart a daemon process, execute a real model worker, or qualify the isolated subagent branch. D7's existing independent-process tests remain separate evidence.
- Automatic daemon attribution/resumption currently covers one pending tool per in-process write worker. Multiple pending operations, unattributed historic records, read-only workers and isolated-worker continuation attribution remain fail-closed rather than guessed. Existing manually authorized legacy non-worker continuation paths are unchanged and their regression tests pass.
- A crash after a successful execution receipt but before the guarded worker-state update can leave the worker blocked. It cannot re-execute the consumed approval, but recovery of that interrupted state transition needs explicit qualification/work; the implementation does not infer that an uncertain operation succeeded.
- Cancellation/context monitoring and long-running lease renewal are implemented; the focused suite verifies pre-dispatch cancellation/shutdown and conflicting leases, not every in-flight cancellation or renewal failure interleaving. Release failures can leave a lease until expiry; no unrelated lease is revoked to force progress.
- GitNexus is 45 commits behind: `executeWorker` was HIGH (CLI and coordination-tool flows), `ToolExecutor` CRITICAL (58 indexed impacts across shared callers), daemon startup/watcher paths LOW. Default worker/interface walks were UNKNOWN/lower-bound and confirmed through source references. These warnings were reported before edits, not waived using shared axes. Executed architecture/runtime regressions are supporting evidence, not an independent security verdict.
- Independent D1–D9 security review remains pending. The reproduced daemon-continuation regression is GREEN, but **D9 qualification is incomplete and LEAN-G01 remains BLOCKED**. No gate completion or independent approval is claimed.
