# Known Flaky Tests

Intermittent gate failures, recorded with the evidence needed to decide whether
they are test defects or product defects. Append entries; do not rewrite
history. An entry with one occurrence is a *watch* item, not a licence to ignore
a red gate — re-run and confirm before concluding anything.

## Governance report — "store isolation — no .alix/ files created in cwd"

- **Test:** `tests/governance/governance-report.test.ts` → `store isolation — no .alix/ files created in cwd` (spawns the CLI; 10 000 ms per-test timeout)
- **Symptom:** `AssertionError: Expected exit 0, got 1` after ~10 014 ms — a timeout, not a wrong result
- **Frequency:** 1 of ~6 full parallel runs; one standalone run failed the same subtest, the next standalone run passed
- **Parallel-only:** No — seen in a parallel full run *and* standalone, so treat it as load/timing sensitive rather than concurrency-specific
- **First observed:** 2026-09-27, during the tool-selection T2-d cleanup change set (tree at `38390f67`)
- **Standalone result:** `node --test --test-concurrency=1 dist/tests/governance/governance-report.test.js` → suite passes (~15 s and ~44 s for the two top-level cases)
- **Suspected cause:** a fixed 10 s child-process timeout on a spawned CLI under heavy load; child startup plus work exceeds the budget before a result is written
- **Proposed fix (not applied):** raise that spawn timeout or make it load-aware, and/or mark the case parallel-unsafe. A fixed short timeout on a spawned process is a false-failure generator.
- **Status:** open — watch for recurrence in `pnpm test:node`

## Observability telemetry + skills factory trace

- **Tests:** `tests/observability/security-telemetry.test.ts` (`redactPayload` called on each emission) and `tests/skills/factory-trace.test.ts`
- **Symptom:** strict-equality assertion failures (`expected 0`) in a shared `redactPayload` call counter and a factory-trace assertion
- **Frequency:** 1 of ~8 full parallel runs; no recurrence in the four full runs since
- **Parallel-only:** Unknown — observed in a parallel full run; both files pass standalone, and the following full runs were clean
- **First observed:** 2026-09-27, during the tool-selection T2-a change set (tree at `0a9d12e6`)
- **Standalone result:** both pass
- **Suspected cause:** shared module state (the `redactPayload` counter) interacting with parallel file execution order; unconfirmed
- **Status:** watch — do not treat as a product defect without a second occurrence
