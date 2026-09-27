# Known Flaky Tests

Intermittent gate failures, recorded with the evidence needed to decide whether
they are test defects or product defects. Append entries; do not rewrite
history. An entry with one occurrence is a *watch* item, not a licence to ignore
a red gate — re-run and confirm before concluding anything.

## Triage checklist

"Passes standalone" is evidence, not exoneration: a leftover *global* resource
can make an unrelated suite fail. Before filing an entry as a flake, walk this
list:

1. Re-run the failing file standalone, then the full suite again.
2. Inspect shared counters / module-level mutable state (call counters, caches).
3. Inspect temp directories and files — global namespaces like
   `os.tmpdir()` plus a shared prefix are a classic cross-suite collision.
4. Inspect stray processes, ports, and sockets left by earlier runs.
5. Inspect environment mutation (env vars set by a test and not restored).

Record which of these were checked and what they showed.

## Governance report — "store isolation — no .alix/ files created in cwd"

- **Test:** `tests/governance/governance-report.test.ts` → `store isolation — no .alix/ files created in cwd` (spawns the CLI; 10 000 ms per-test timeout)
- **Symptom:** `AssertionError: Expected exit 0, got 1` after ~10 014 ms — a timeout, not a wrong result
- **Frequency:** 1 of ~6 full parallel runs; one standalone run failed the same subtest, the next standalone run passed
- **Recurrence (2026-09-27, T2-f gates):** `pnpm test:node` → 8200 pass / 2 fail, both from this file (`--json mode returns parseable JSON`, `--output writes file to requested path`), each `Expected exit 0, got 1` at ~10 012–10 014 ms — the same spawn-budget timeout, different subtests
- **Parallel-only:** No — seen in a parallel full run *and* standalone, so treat it as load/timing sensitive rather than concurrency-specific
- **First observed:** 2026-09-27, during the tool-selection T2-d cleanup change set (tree at `38390f67`)
- **Standalone result:** `node --test --test-concurrency=1 dist/tests/governance/governance-report.test.js` → suite passes (~15 s and ~44 s for the two top-level cases)
- **Suspected cause:** a fixed 10 s child-process timeout on a spawned CLI under heavy load; child startup plus work exceeds the budget before a result is written
- **Measured cost of a spawn:** ~5.4 s standalone (`node --test --test-concurrency=1`, 18/18 pass), ~5.7–8.5 s inside `pnpm test:node`; the 10 s budget sits inside the load-induced spread
- **Fix applied:** the spawn budgets in `tests/governance/governance-report.test.ts` are now named constants — 20 s for the compiled `bin/alix.js` spawns, 30 s for the `npx tsx` spawns, with the two `describe` budgets raised to 300 s so the per-case budgets cannot outlive their suite. No assertion changed; a wrong result still fails, only the false-failure window moved.
- **Status:** resolved — a fixed short timeout on a spawned process is a false-failure generator; if this test times out again, treat it as a real hang and investigate the spawned CLI, not the budget

## Observability telemetry + skills factory trace

- **Tests:** `tests/observability/security-telemetry.test.ts` (`redactPayload` called on each emission) and `tests/skills/factory-trace.test.ts`
- **Symptom:** strict-equality assertion failures (`expected 0`) in a shared `redactPayload` call counter and a factory-trace assertion
- **Frequency:** 1 of ~8 full parallel runs; no recurrence in the four full runs since
- **Parallel-only:** Unknown — observed in a parallel full run; both files pass standalone, and the following full runs were clean
- **First observed:** 2026-09-27, during the tool-selection T2-a change set (tree at `0a9d12e6`)
- **Standalone result:** both pass
- **Suspected cause:** shared module state (the `redactPayload` counter) interacting with parallel file execution order; unconfirmed
- **Status:** watch — do not treat as a product defect without a second occurrence
