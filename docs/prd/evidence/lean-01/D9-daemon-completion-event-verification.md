# D9 — Durable daemon aggregate-completion evidence

2026-10-26. Continuation of the [review-routing verification](D9-review-routing-daemon-verification.md). **The new daemon run verifies through the existing derivation. D9/LEAN-G01 qualification and independent security review remain pending.**

## Reproduced cause

The daemon's `startCoordinationService` constructed its production scheduler without an EventLog sink. The scheduler factory passed that absence to `createCompletionService`. Finalization attached an aggregate but the optional `coordination.aggregate.completed` append had no writer, so the normal CLI correctly derived `verification=unverified`.

The new `verified` probe mode requires both normal CLI verification and exactly one observed durable aggregate-completion event with the run ID, attached aggregate reference and source fingerprint. Before the wiring change it failed with exit 1: `normal CLI derivation must verify the run from durable evidence`. The worker had completed once and the aggregate existed; those facts did not satisfy verification.

## Change

- The daemon now injects an append-only event sink into its scheduler. Each append selects the persisted run's session under the workspace session root, rejects an empty/escaping session path using the shared containment predicate, initializes that session's existing EventLog, awaits the real append and closes the handle.
- Scheduler/completion dependencies now use `CoordinationEventSink = Pick<EventLog, "append">`. Existing single-session EventLog instances remain compatible; the daemon can route several run sessions without pretending that one global log belongs to every run.
- `createCompletionService`, finalization locking, attach-winner idempotency, matching fingerprints and the completion verifier are unchanged. No `verified` flag, success receipt or synthetic completion event is inserted into a run record. Metrics remain on their existing metrics-store path.
- Historical aggregates missing their completion event remain unverified. The change does not backfill old runs or replay consumed operations.
- PolicyGate, tool authorization/dispatch, worker execution/review and scripted provider sources remain unchanged in this step. Captured hashes of those five sources match across RED/GREEN, as do the fixture configuration, `owned-path-rule` decision, policy revision and argument hash.

## Actual daemon RED/GREEN

[Retained decisions, lifecycle events, status/results, and source manifests](D9-completion-event-daemon-evidence.json) record both fresh runs. The private Unix-socket process tests used the tool's authorized execution path, not a substitute transport or disabled check. Models are offline scripted fixtures, never real providers.

| Evidence | RED, before wiring | GREEN, after wiring |
|---|---|---|
| Run | `coord_0744c07f-3b62-4a1f-896b-60c3237365cc` | `coord_d27eb0b5-1efb-4586-86ad-95bba97039d2` |
| Probe exit | 1, expected missing-verification assertion reproduced | 0 |
| Worker | Completed, attempt 1 | Completed, attempt 1 |
| Receipt mutations | 1 | 1 |
| Approval records | One consumed dispatch grant, no second grant | One consumed dispatch grant, no second grant |
| Tool decision | Allow, `owned-path-rule` | Allow, `owned-path-rule` |
| Aggregate | Generated, outcome success | Generated, outcome success |
| Matching completion event | Not observed | Exactly 1, persisted in the run session |
| Normal CLI derivation | `verification=unverified` | **`verification=verified`** |
| Daemon shutdown | SIGTERM, exit 0 | SIGTERM, exit 0 |

The GREEN event is `coordination.aggregate.completed`, event ID `2cc03cd7-96eb-46d6-99d6-89c5e700595a`, seq `49`, at `2026-10-26T15:50:51.502Z`, with:

- Session: `coord_1793029833200`.
- Run: `coord_d27eb0b5-1efb-4586-86ad-95bba97039d2`.
- Aggregate: `.alix/coordination/results/runs/coord_d27eb0b5-1efb-4586-86ad-95bba97039d2.json`.
- Source fingerprint: `730a5fd8bde993e829ce54840f95186965ca23ffd2f66d7fb4771e31e201244a`.

The probe checks these three payload fields against the CLI-derived aggregate and checks that the regular status command—not a fixture-set boolean—reports verified completion. Raw observations come from the existing pass-through test observer; protected runtime state is queried only through the public CLI. Timing is instrumented, not a claim about all uninstrumented interleavings.

## Files changed in this step

| File | Change |
|---|---|
| `src/operations/daemon/daemon-server.ts` | Per-run-session event sink at the existing authorized EventLog composition root |
| `src/coordination/kernel/coordination-scheduler.ts` | Append-only event dependency type; scheduler behavior otherwise unchanged |
| `src/coordination/kernel/coordination-completion-service.ts` | Shared append-only sink type; finalizer/verifier behavior unchanged |
| `tests/fixtures/d9-daemon-review-probe.mjs` | `verified` mode requiring the matching durable event and CLI verdict |
| `src/operations/daemon/AGENTS.md`, `src/coordination/kernel/AGENTS.md` | Session routing, event-port and verification contracts |
| This record and `D9-completion-event-daemon-evidence.json` | Executed RED/GREEN and actual test results |
| `D9-review-routing-daemon-verification.md`, `route-parity-matrix.md` | Follow-up pointers, preserving historical observations |

Existing unrelated staged/unstaged/untracked changes were preserved. Root and other AGENTS.md files are intentionally untouched: this changes a local event-writing contract, not repository-wide ownership or child indexes. No commit, push or merge was performed.

## Checks executed after the wiring change

| Check | Result |
|---|---|
| Actual daemon `verified` probe | PASS, exit 0; one matching event, normal CLI verified, one execution, no extra approval |
| Vitest reviewer/routing/default-worker/D9 continuation regressions | **61 passed / 0 failed**, 7 files, exit 0; 109.74 s |
| Compiled Node finalization/scheduler/approval/tool/architecture regressions | **173 passed / 0 failed**, 22 suites, exit 0; 294.43 s |
| Build | PASS, exit 0 |
| Typecheck | PASS, exit 0 |
| Unused-code check | PASS, exit 0 |
| Fixture syntax, evidence JSON/read-back, diff whitespace | PASS |
| DOX automation | BLOCKED, exit 2: checker cannot resolve HEAD through the environment's child-process lookup; no bypass or automated pass claimed |

**234 distinct regression tests passed, no final failures/skips/cancellations**, plus the separately reported actual-daemon RED/GREEN probe. Earlier repeated runs are not added to this total. Existing finalization tests retain missing-event, stale-fingerprint and attach-only rejection; their guards were not weakened to obtain the GREEN result. Both architecture gates passed without allowlist changes.

```sh
pnpm build
node tests/fixtures/d9-daemon-review-probe.mjs verified
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/d9-scripted-review-routing.vitest.ts tests/scripted-mock-invocation-scope.vitest.ts tests/agents/objective-review-verdict.vitest.ts tests/agents/coordination-objective-review.vitest.ts tests/kernel/default-worker-review.vitest.ts tests/security/daemon-tool-continuation-wiring.vitest.ts tests/security/daemon-tool-continuation-acceptance.vitest.ts
node --test --test-isolation=none --test-concurrency=1 dist/tests/architecture/r1-boundary-freeze.test.js dist/tests/architecture/layer-boundaries.test.js dist/tests/kernel/coordination-finalization.test.js dist/tests/kernel/coordination-scheduler.test.js dist/tests/kernel/coordination-approval-binding.test.js dist/tests/kernel/coordination-tools.test.js dist/tests/daemon/approval-watcher.test.js dist/tests/security/approval-consumed-propagation.test.js dist/tests/security/approval-crash-recovery.test.js dist/tests/security/legacy-approval-single-use.test.js dist/tests/security/worker-approval-atomic-restart.test.js
pnpm typecheck
pnpm typecheck:unused
pnpm check:dox
node --check tests/fixtures/d9-daemon-review-probe.mjs
git diff --check
```

GitNexus impact for daemon startup was LOW: one indexed caller (daemon module), no indexed affected execution flows. The index remains 45 commits behind, so that is supporting blast-radius information, not an independent security clearance. Only dependency types changed in the shared scheduler/completion modules; no matching/authorization algorithm was edited.

## Remaining gate limits

This closes the observed **missing daemon completion-event wiring** for newly finalized runs. It does not establish isolated-subagent qualification, multiworker crash recovery, long-running lease/cancellation interleavings, or recovery of an execution receipt whose worker update was interrupted. The actual process probe still follows owned-scope tool allowance, not a tool-specific pending approval/resumption cycle. Existing historic unverified runs remain honest and unmodified.

The fixture reviewer verdict is scripted input, not independent review. **D9 qualification remains incomplete; LEAN-G01 remains BLOCKED and independently unreviewed.**
