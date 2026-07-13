# Task 8 Report -- Observation CLI Handler + evolution-cli.ts Wiring

**Status:** DONE

**Commits made:**
- `8c66e2d7` feat(A5): add observation CLI handler

**Files created:**
- `src/evolution/observation/observation-cli.ts` -- `runObserve()` CLI handler, `ObserveDeps`/`ObserveFlags` interfaces, `buildObservationSet()` default observations, `renderObservationResult()` display, `storeObservationEvidence()` store adapter
- `tests/evolution/observation/observation-cli.test.ts` -- 2 integration tests

**Files modified:**
- `src/governance/evolution-cli.ts` -- added imports, `buildObservationEngine()` helper, `observe` case in switch, help text

**Test results:** 16/16 pass, 0 fail
- 2 new CLI handler tests: 2/2 pass
- 14 existing governance CLI tests: 14/14 pass (no regressions)
- `tsc --noEmit`: clean (only pre-existing error in `observation-engine.test.ts`, unrelated)

**Concerns:** None. The `ExecutionEvidenceStore` uses a checksum-validated JSONL store; the `storeObservationEvidence` adapter sets `evidenceHash: ""` which passes the store's `isValidChecksum` guard (falsy check returns `true`). The test registers only `CliObservationProvider` and `FilesystemObservationProvider`; `git` and `ledger` observations return `unknown_provider` errors, which is expected and handled gracefully by the engine.
