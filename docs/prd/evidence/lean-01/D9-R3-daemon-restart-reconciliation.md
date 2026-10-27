# D9-R3 — End-to-end daemon restart reconciliation

2026-10-26. **D9-R3 PASS for the tested terminal-run recovery boundary. D9 and LEAN-G01 remain BLOCKED; independently unreviewed.**

## Implemented contract

The existing daemon startup service invokes `CoordinationScheduler.reconcileTerminalCompletion` for terminal daemon-hosted runs. The new end-to-end test found that this called ordinary `finalize`, which could regenerate stale or missing aggregates. Recovery now passes the optional second argument `{ reconcileOnly: true }` to `CoordinationCompletionService.finalize`.

Under the existing finalization lock, reconciliation validates terminal execution, canonical attached aggregate reference, current/attached/persisted source fingerprints, generation time and outcome. It requires a conditional event sink and restores the missing completion event through `appendIfAbsent`. Invalid evidence throws a diagnostic caught by the existing startup service; it does not regenerate aggregates, rewrite worker/run metadata, dispatch workers, or call tools/models. Ordinary callers omitting the new optional argument retain aggregate generation behavior. Authorization, approval binding and single-use consumption rules are unchanged.

## Actual daemon process evidence

`tests/events/d9-daemon-restart-e2e.test.ts` creates a disposable project, isolated child HOME/config and private socket. The parent HOME is unchanged; the child receives a minimal environment. No daemon manager or live socket is contacted. The offline model configuration uses no credentials and no model invocation is needed.

Fixture creation uses the production run/worker constructors, CoordinationStore, CoordinationResultStore and completion service without an event sink. This produces a durable attached aggregate without its completion event. An explicit seeded receipt and `file.created` event represent prior execution effects; this test does not claim that a real model/tool performed the original seed execution. The missing-aggregate negative deletes only its disposable fixture aggregate.

The test spawns the actual compiled `daemon-server.js` twice. Readiness requires both the listener announcement and a socket `ping`/`pong`. Bounded polling waits for an older healthy sentinel's completion event; because startup scans newest-first, the sentinel establishes that all target negative fixtures were passed. A second older sentinel does the same after restart. There are no fixed startup sleeps. Both child generations receive SIGTERM and exit 0; cleanup awaits termination, has a SIGKILL fallback for a stuck owned child, closes the parent ledger and removes the disposable directory.

- Actual daemon PIDs: **183265 → 183282**.
- Valid run: `coord_c45738c2-2873-49ce-a4d1-6f34566a8eeb`.
- Session: `d9-valid-e0643b6e-42e6-4cbf-b024-8c24111fa404`.
- Completion event: **`d5fd1920-a78e-4bb1-b395-f4419e040ba4`, sequence 2**.
- Aggregate reference: `.alix/coordination/results/runs/coord_c45738c2-2873-49ce-a4d1-6f34566a8eeb.json`.
- Fingerprint: `74263cc3278b84fd2c1baa70af1a06884ecdd392b560d7b67d16be3848533516`.

The event is unique after each startup, with identical ID, sequence, timestamp, reference and fingerprint. The normal shared `deriveRunCompletion` reports `verified` after both generations. The aggregate itself remains unchanged.

Full run records (including worker statuses, attempts and result references), persisted worker results, receipt content/mtime and all non-completion execution/effect events compare equal before startup, after startup and after restart. This demonstrates worker non-replay for these seeded completed runs. Stale fingerprint, wrong host and missing aggregate all retain zero completion events and `unverified` readings across both generations. Stale/missing evidence produces a recovery diagnostic in each daemon log; wrong-host runs are skipped. Their aggregates are neither regenerated nor rewritten.

[Process evidence and source hashes](D9-R3-process-evidence.json) retain both event copies, daemon PIDs and daemon logs. [Final Node output](D9-R3-node-green.log) retains all executed assertions.

## Executed commands and results

```sh
pnpm build
pnpm typecheck
pnpm typecheck:unused
node --test --test-isolation=none --test-concurrency=1 dist/tests/events/d9-daemon-restart-e2e.test.js dist/tests/events/d9-daemon-startup-reconciliation.test.js dist/tests/events/d9-process-kill-recovery.test.js dist/tests/events/d9-cross-process-conditional.test.js dist/tests/events/event-log-completion-idempotency.test.js dist/tests/events/event-log.test.js dist/tests/kernel/coordination-finalization.test.js dist/tests/architecture/r1-boundary-freeze.test.js dist/tests/architecture/layer-boundaries.test.js
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 tests/events/event-log-cursor.vitest.ts
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/d9-scripted-review-routing.vitest.ts tests/security/daemon-tool-continuation-wiring.vitest.ts tests/security/daemon-tool-continuation-acceptance.vitest.ts
pnpm check:dox
git diff --check
```

| Final check | Actual result |
|---|---|
| Build / TypeScript compilation | PASS, exit 0 |
| Typecheck / unused-code check | PASS, exit 0 each |
| Compiled Node suite | **52 passed, 0 failed/cancelled/skipped**, 8 suites, 117.601 s, exit 0 |
| New actual-daemon end-to-end cases (included above) | **5/5 PASS**, two distinct daemon OS processes |
| EventLog cursor Vitest | **13/13 PASS**, 1 file, 14.12 s, exit 0 |
| D9 routing/continuation Vitest | **24/24 PASS**, 3 files, 197.31 s, exit 0 |
| DOX automation | BLOCKED, exit 2: `ERROR: cannot resolve --head 'HEAD'` |
| Diff whitespace / evidence JSON | PASS |

**89 distinct final tests passed.** The new 5 cases and the existing 14 finalization cases are included in this total, not added again. Architecture allowlists are unchanged. [Vitest D9 output](D9-R3-vitest.log), [cursor output](D9-R3-cursor.log) and [build/TypeScript/DOX output](D9-R3-validation.log) are retained. The socket-requiring process commands were submitted directly for the tool's permission review and allowed; no rejected socket operation was retried through another route.

## Earlier failures retained

1. Initial compilation failed (exit 2): the test's disabled-subagent config did not supply a required roles array. Fixed in the fixture. [Output](D9-R3-initial-compile-failure.log).
2. Initial process run failed (exit 1): a 500 ms readiness probe closed its socket while the busy daemon was replying, producing EPIPE. All 5 cases were cancelled by setup; none qualified. Fixed listener/protocol readiness and increased the per-probe response budget. [Output](D9-R3-readiness-failure.log).
3. With readiness fixed, the actual daemon contract regression ran: **2 passed, 3 failed, 0 cancelled**, exit 1. It demonstrated that ordinary startup finalization regenerated stale/missing evidence and changed persisted run/aggregate state. The reconciliation-only implementation resolves these assertions without relaxing their expected outcomes. [RED output](D9-R3-contract-red.log).

These earlier runs are not counted as final passing tests. The final GREEN run has no failures or cancelled cases.

## Files changed in this step

- `src/coordination/kernel/coordination-completion-service.ts`: optional reconciliation-only contract and locked validation; ordinary finalization preserved.
- `src/coordination/kernel/coordination-scheduler.ts`: selects reconciliation-only mode at the existing startup seam.
- `tests/events/d9-daemon-restart-e2e.test.ts`: disposable actual-daemon lifecycle, five acceptance cases and execution-evidence comparisons.
- `src/coordination/kernel/AGENTS.md`, `src/operations/daemon/AGENTS.md`: recovery/sink contracts and test instructions. Root and other owning docs intentionally remain unchanged; no repository-wide structure or child indexes changed.
- This evidence record, its JSON/log companions, `route-parity-matrix.md` and the historical reconciliation-design pointer.

GitNexus context/query checks were used first. Impact for the new startup method was target-not-found/UNKNOWN; `finalize` was found but had no resolved callers and UNKNOWN risk. The graph is 45 commits behind HEAD. Source confirmation located the startup-service caller and scheduler/tool finalization callers; UNKNOWN remains a graph-coverage limitation, not a low-risk verdict. No graph-based independent clearance is claimed. Existing unrelated worktree changes were preserved; no reset, clean, commit, push or merge occurred.

## Disposition and remaining limits

**D9-R3 PASS:** actual compiled daemon OS-process restart, one durable matching event with stable identity, and no worker/result/effect replay for the tested seeded terminal runs. Stale fingerprint, wrong host and missing aggregate cannot be promoted by startup recovery.

This is clean SIGTERM/restart recovery, not abrupt daemon termination during startup, machine power loss, or storage durability qualification. Existing EventLog process-kill and cross-process tests passed separately; they do not prove every daemon interleaving. Active/paused worker recovery, interrupted tool-receipt-to-worker updates, tool-specific ask/approve/resume, multiworker cancellation/lease races and independent security review remain outside this evidence. DOX automation is still blocked. **Do not mark D9 or LEAN-G01 complete from this result.**
