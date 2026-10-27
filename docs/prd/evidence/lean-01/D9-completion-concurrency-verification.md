# D9 — Completion-event concurrency and restart retry

2026-10-26. Author-executed regression evidence. **D9 and LEAN-G01 remain BLOCKED; no independent security review is claimed.**

## Scope and contract

Added `tests/events/event-log-completion-idempotency.test.ts` against the existing `EventLog.appendIfAbsent` implementation. No production source or authorization behavior changed in this step. A matching durable event returns its original identity rather than appending a second event. Completion identity includes event type, session ID, run ID, aggregate reference and source fingerprint.

The normal workspace patch operation succeeded. No operation was rejected during this write, and no alternative route was used to evade the previously reported remote restriction.

## Executed cases

| Case | Assertion | Result |
|---|---|---|
| Concurrent independent writers | Eight instances initialize before concurrent conditional appends. A fresh reader sees exactly one durable event; all eight returns equal it, including ID/seq/timestamp. The next ordinary append advances the sequence by exactly one. | PASS |
| Persistence before lost acknowledgement | The real append completes, then the fixture throws before acknowledgement reaches its caller. A fresh instance retries three times, returning the original event and leaving durable history unchanged. | PASS |
| Exact identity separation | Different session, event type, run, aggregate reference and fingerprint do not suppress the exact event; its retry adds no duplicate. | PASS |

The lost-acknowledgement test models the crash-after-append boundary and recreates the EventLog instance. It is not an OS-process termination or power-loss/fsync test. The new conditional-writer race runs in one process; the existing ordinary-append cross-process sequence test also passed, but that does not qualify cross-process conditional deduplication.

## Commands and actual results

```sh
pnpm build
node --test --test-isolation=none --test-concurrency=1 dist/tests/events/event-log-completion-idempotency.test.js dist/tests/events/event-log.test.js dist/tests/kernel/coordination-finalization.test.js
pnpm typecheck
pnpm typecheck:unused
pnpm check:dox
git diff --check
```

- Build: PASS, exit 0.
- Combined Node tests: **35 passed, 0 failed, 0 skipped/cancelled**, 5 suites, 21.393 s, exit 0. This comprises the 3 new cases, 18 EventLog regressions, and all 14 existing finalization cases. The prior 14/14 is included, not added again.
- TypeScript and unused-code validation: PASS, exit 0 each.
- DOX automation: BLOCKED, exit 2, `ERROR: cannot resolve --head 'HEAD'`. No automated DOX pass or bypass is claimed.
- Diff whitespace: PASS.

[Retained Node test output](D9-completion-concurrency-test-output.log) contains the individual results and totals. Build/typecheck/unused/DOX command output is retained in [validation output](D9-completion-concurrency-validation-output.log).

## Changed files and checks

- `tests/events/event-log-completion-idempotency.test.ts`: three focused acceptance cases.
- `src/runtime-state/events/AGENTS.md`: documents the existing conditional append contract and the new verification coverage. Root and other owning contracts are unchanged because no production interface, ownership or child index changed.
- This record, its two output logs, and `route-parity-matrix.md`: executed results and remaining limits.

GitNexus context and query checks were available, but the index reports 45 commits behind HEAD. Impact lookup for `appendIfAbsent` returned target-not-found / UNKNOWN. Source confirmation found the existing method and its completion-service/daemon callers; graph coverage remains unresolved. No existing function or production method was edited on the strength of that lookup.

## Remaining limits

This establishes independent-instance concurrency and fresh-instance retry at the conditional append seam. It does not independently qualify concurrent daemon processes, an actual killed-process acknowledgement-loss scenario, stale/replaced aggregate reconciliation across every interleaving, tool-specific ask/approve/resume, isolated-worker recovery, or independent security review. Authorization and approval-consumption tests were not rerun in this test-only step; earlier results are not counted as new evidence. No commit, push or merge was performed; unrelated worktree changes were preserved.
