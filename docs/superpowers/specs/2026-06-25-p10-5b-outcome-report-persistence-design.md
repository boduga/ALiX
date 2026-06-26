# P10.5b — Outcome Report Persistence (Design)

> **Status:** Design spec — ready for implementation plan.
> **Builds on:** P10.5a `ExecutiveOutcomeEvaluationReport` (unchanged).
> **Risk level:** LOW — additive store, no behavioral change to evaluation, no execution hooks.

## Hard governance boundary

```
P10.5b may persist an evaluation report when --save is explicitly passed.
P10.5b may list and load persisted reports.
P10.5b must not modify evaluatePlanOutcome() — the evaluator stays pure.
P10.5b must not add evidence types.
P10.5b must not hook into ExecutionEngine.
```

## 1. Storage format

One JSON file per persisted report:

```
.alix/executive/outcomes/outcome-<planId>-<sanitizedTimestamp>.json
```

Example:

```
.alix/executive/outcomes/outcome-plan-abc-20260625T180000000Z.json
```

The timestamp is the report's `generatedAt` field, sanitized for filesystem safety:

```ts
const sanitized = generatedAt.replace(/[-:]/g, "").replace(".", "");
// "2026-06-25T18:00:00.000Z" → "20260625T180000000Z"
```

## 2. Wrapper schema

Each file wraps the `ExecutiveOutcomeEvaluationReport` with metadata for integrity and identity:

```ts
interface PersistedOutcomeReport {
  schemaVersion: "p10.5b.0";
  id: string;              // "outcome-<planId>-<sanitizedTimestamp>"
  contentHash: string;     // SHA-256 hex of canonical JSON of `report`
  report: ExecutiveOutcomeEvaluationReport;
}
```

The `contentHash` is computed over the `report` body alone (before wrapping), so the stored report's integrity is independently verifiable — same approach as PlanStore.

### Save scope

`--save` persists every evaluation outcome regardless of status. All statuses are stored:

- `completed`
- `insufficient_data`
- `plan_not_executed`
- `plan_not_found`

This gives a complete audit trail — failed/blocked evaluations are as meaningful as successful ones.

## 3. OutcomeReportStore

A new class at `src/executive/outcome-store.ts`. Constructor takes the directory path.

### `save(report: ExecutiveOutcomeEvaluationReport): string`

1. Build the `id` from `report.planId` + sanitized `report.generatedAt`.
2. Compute `contentHash = sha256(JSON.stringify(report))`.
3. Assemble the `PersistedOutcomeReport` wrapper.
4. Atomic write: serialize → write to `.tmp` → `fsync` → `renameSync` to target path.
5. Return the `id`.

If the directory doesn't exist, `mkdirSync({ recursive: true })` before writing.

### `load(reportId: string): ExecutiveOutcomeEvaluationReport | null`

1. Construct path from `reportId` (which is the filename stem).
2. If file does not exist → return `null`.
3. Read and parse the `PersistedOutcomeReport`.
4. **Fail-closed:**
   - Hash mismatch (re-compute SHA-256 of stored `report` and compare to `contentHash`) → throw.
   - Invalid schema / parse failure → throw.
   - `report.evaluationStatus` not a valid `EvaluationStatus` → throw.
5. Return the unwrapped `report`.

Missing file and corrupt file are distinct errors — `null` means "not found", a thrown `Error` means "audit artifact integrity violation."

### `list(): OutcomeReportMeta[]`

1. `readdirSync` → filter filenames matching `outcome-*.json`.
2. `load()` each file — load verifies contentHash, so every entry in the list is integrity-checked.
3. Extract metadata into `OutcomeReportMeta`:

```ts
interface OutcomeReportMeta {
  reportId: string;
  planId: string;
  evaluationStatus: EvaluationStatus;
  overallDelta: number;
  generatedAt: string;
}
```

4. Sort by `generatedAt` descending (newest first).
5. Empty list on missing/unreadable directory (no throw).

**Corruption resilience:** if an individual file fails to load (hash mismatch, parse error), `list()` skips it and continues with the remaining files. A warning is printed to stderr for each skipped file. This prevents a single corrupt audit artifact from making the entire list unavailable.

There is no separate index. List reads and verifies every file. For the expected post-P10.5a volume (tens to hundreds of reports), this is cheap. An index can be added later if the fan-out ever becomes a bottleneck.

## 4. CLI interface

### `alix executive evaluate <planId> [--json] [--save]`

When `--save` is present:

1. Run the existing evaluation pipeline (unchanged).
2. After rendering, call `store.save(report)`.
3. Print `"Report saved: outcome-<planId>-<sanitizedTs>"` to stdout.
4. Non‑zero exit or earlier errors bypass the save — the handler exits before reaching the save step.

The evaluation output and behavior are **identical** with or without `--save`. The save is additive.

### `alix executive outcomes list [--json]`

1. Calls `store.list()`.
2. Terminal mode: renders a table:

```
Report ID                                      | Plan ID  | Eval Status      | Δ    | Generated At
outcome-plan-abc-20260625T180000000Z           | plan-abc | completed        | +40  | 2026-06-25T18:00:00.000Z
outcome-plan-def-20260626T090000000Z           | plan-def | plan_not_executed | 0   | 2026-06-26T09:00:00.000Z
```

3. `--json` mode: prints `OutcomeReportMeta[]` as JSON.

### `alix executive outcomes show <reportId> [--json]`

1. Calls `store.load(reportId)`.
2. If `null` → `console.error("Report not found: <reportId>")` + `process.exit(1)`.
3. Terminal mode: renders the same table format as `evaluate` output.
4. `--json` mode: prints the full `ExecutiveOutcomeEvaluationReport` as JSON.

## 5. Purity sentinel

`outcome-store.ts` uses `writeFileSync`, `renameSync`, `fsyncSync`, `mkdirSync` — the same atomic-write surface already scoped as exceptions for `plan-store.ts` and `execution-state-store.ts`.

The sentinel test at `tests/executive/executive-sentinels.vitest.ts` will be extended to add `outcome-store.ts` to the same scoped exception group:

```ts
// Scoped exception: plan-store.ts and execution-state-store.ts are
// approved write paths for P10.4a plan persistence (atomic save pattern)
if ((file === "src/executive/plan-store.ts" ||
     file === "src/executive/execution-state-store.ts" ||
     file === "src/executive/outcome-store.ts") &&
    (forbidden === "writeFileSync" || forbidden === "mkdirSync" ||
     forbidden === "renameSync" || forbidden === "openSync" ||
     forbidden === "fsyncSync" || forbidden === "closeSync")) {
  continue;
}
```

The file is also added to the `EXECUTIVE_FILES` allowlist in the same test.

## 6. Files changed

| Action | Path | Notes |
|--------|------|-------|
| **Create** | `src/executive/outcome-store.ts` | OutcomeReportStore class |
| **Modify** | `src/cli/commands/executive-evaluate-handler.ts` | Add `--save` flag handling |
| **Modify** | `src/cli/commands/executive.ts` | Add `outcomes list`, `outcomes show` cases |
| **Modify** | `tests/executive/executive-sentinels.vitest.ts` | Add outcome-store.ts to EXECUTIVE_FILES + write-exception group |
| **Create** | `tests/executive/outcome-store.vitest.ts` | Unit tests (save/load/hash/listing) |
| **Modify** | `tests/cli/commands/executive-evaluate-cli.vitest.ts` | Add --save integration tests |
| **Create** | `tests/cli/commands/executive-outcomes-cli.vitest.ts` | CLI tests for list/show |

## 7. Files NOT modified

- `src/executive/outcome-evaluator.ts` — unchanged. Pure function stays pure.
- `src/executive/execution-engine.ts` — no hooks.
- `src/security/evidence/evidence-types.ts` — no new evidence types.
- No protected type files (ADR-0004).

## 8. Architectural invariants

- Store is **disposable** — deleting the outcomes directory loses nothing from the execution layer. Plans, states, and evidence continue to function.
- **No derived state** — the store is a cache of evaluated reports. No other module depends on its existence.
- **No index** — directory scan + load/verify each file is the source of truth. An index can be added in a future iteration if the fan-out becomes a bottleneck.
- **Fail-closed on load** — a tampered report throws rather than silently returning null or stale data.
- **`--save` is opt-in** — the `evaluate` subcommand works identically without it.
- The store follows the same atomic-write pattern as PlanStore and ExecutionStateStore.
