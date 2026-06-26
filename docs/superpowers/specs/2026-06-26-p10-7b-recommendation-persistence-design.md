# P10.7b — Recommendation Persistence Design

> **Status:** Design spec — approved, ready for implementation planning.
> **Builds on:** P10.7a (`computeRecommendations`, `RecommendationDraft`, `RecommendationResult`).
> **Risk:** MEDIUM. First P10.7 slice that writes (a new store). Touches 4 shipped P10.7a files via the rename.
> **Branch:** `feature/p10-7b-recommendation-persistence` (off `main` at `alix-p10-7a-complete`).

## Architecture

```
alix executive recommend [--save] [--window N] [--json]
        │
        ├─ OutcomeReportStore.list() → load() (windowed)        ── P10.6, unchanged
        ├─ computeLearningTrends(reports) → TrendResult          ── P10.6, unchanged
        ├─ computeRecommendations(trends) → RecommendationResult ── P10.7a (signalConfidence rename)
        │
        ├─ without --save: render/JSON  (identical to today)
        └─ with --save:    RecommendationReportStore.save(payload) → id
                            prints "Recommendation report saved: <id>" to stderr
```

`--save` is additive. Without it, behavior is byte-identical to P10.7a.

## Hard governance boundary (non-negotiable)

```
P10.7b must not create proposals.
P10.7b must not update governance state.
P10.7b must not evaluate outcomes.
P10.7b only reserves fields for P10.7c / P10.8.
```

The store writes a `RecommendationReport` artifact whose reserved fields (`proposalId`, `governanceStatus`, `disposition`, `outcomeConfidence`, `outcomeSummary`, per-recommendation `evidenceReportIds`) exist in the schema but are **never populated in P10.7b**. Population belongs to P10.7c (proposal bridge) and P10.8 (effectiveness intelligence). This invariant prevents P10.7b from leaking into the next two slices.

## Domain separation

`RecommendationReport` is an **executive** artifact — derived from accumulated learning trends. It must not collide with the existing `ApprovalRecommendation` (P6.1, `adaptation` domain, the decision-confidence recommendation). Both share the word "recommendation" but represent different concepts at different layers.

| | `ApprovalRecommendation` | `RecommendationReport` (P10.7b) |
|---|---|---|
| Domain | adaptation (P6/P7) | executive (P10.7) |
| Purpose | "Should I approve this proposal?" | "This subsystem needs investigation" |
| Storage | `.alix/recommendations/recommendations.jsonl` (append-only JSONL) | `.alix/executive/recommendations/recommendation-*.json` (one file per report) |
| Store | `ApprovalRecommendationStore` | `RecommendationReportStore` (NEW) |

## Types

```ts
import type {
  RecommendationSignal,
  RecommendationSeverity,
  RecommendationDraft,
} from "./recommendation-engine.js";

/** A persisted executive recommendation — extends the P10.7a draft with reserved fields. */
export interface ExecutiveRecommendation extends RecommendationDraft {
  // P10.7c bridge (reserved, never populated in P10.7b)
  proposalId?: string;
  governanceStatus?:
    | "not_proposed"
    | "proposed"
    | "approved"
    | "rejected"
    | "applied";

  // P10.8 forward-compat (reserved, never populated in P10.7b)
  disposition?:
    | "unreviewed"
    | "ignored"
    | "accepted"
    | "informally_acted_on"
    | "converted_to_proposal";
  outcomeConfidence?: number;
  outcomeSummary?: string;
}

/** Input shape for RecommendationReportStore.save — store fills id/contentHash/schemaVersion. */
export interface NewRecommendationReport {
  generatedAt: string;
  requestedWindow: number;
  recommendationStatus: "ok" | "insufficient_data";
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  evidenceReportIds: string[];
  recommendations: ExecutiveRecommendation[];
  warnings: string[];
  loadWarnings: string[];
}

/** The persisted artifact (store wrapper around NewRecommendationReport). */
export interface RecommendationReport extends NewRecommendationReport {
  schemaVersion: "p10.7b.0";
  id: string;
  contentHash: string;
}

export interface RecommendationReportMeta {
  reportId: string;
  generatedAt: string;
  recommendationStatus: string;
  recommendationCount: number;
}

export class RecommendationReportIntegrityError extends Error { /* typed like OutcomeReportIntegrityError */ }
```

### Rename: `confidence` → `signalConfidence`

P10.7a `RecommendationDraft.confidence` renamed to `signalConfidence` everywhere:
- `recommendation-engine.ts` (type + `classifySubsystem` body)
- `recommendation-engine.vitest.ts` (assertions)
- `executive-recommend-handler.ts` (renderer `r.confidence`)
- `executive-recommend-cli.vitest.ts` (`toHaveProperty("confidence")`)

Semantics unchanged; the rename makes the signal/outcome split self-documenting. No external consumers (P10.7a just shipped), so it's a safe mechanical rename done as the first implementation task. `ExecutiveRecommendation` inherits the renamed field via `extends RecommendationDraft`.

## RecommendationReportStore

Mirrors `OutcomeReportStore` (the executive-domain precedent — *not* the JSONL `ApprovalRecommendationStore`). One file per report, atomic write, contentHash-verified on load.

Storage: `.alix/executive/recommendations/recommendation-<safe-generatedAt>.json`

```ts
export class RecommendationReportStore {
  constructor(private readonly dir: string) {}

  save(payload: NewRecommendationReport): string;
  //  - derives id from generatedAt (deterministic, like buildOutcomeReportId)
  //  - computes contentHash = sha256(JSON.stringify(payload))
  //  - writes wrapper { schemaVersion: "p10.7b.0", id, contentHash, ...payload }
  //  - atomic: .tmp → fsync → renameSync
  //  - returns the id

  load(reportId: string): RecommendationReport | null;
  //  - verifies schemaVersion + contentHash
  //  - throws RecommendationReportIntegrityError on mismatch / bad JSON / unknown schema
  //  - returns null if file does not exist

  list(): RecommendationReportMeta[];
  //  - reads .alix/executive/recommendations/ for recommendation-*.json
  //  - skips corrupt files with console.warn (mirrors OutcomeReportStore.list)
  //  - sorts newest-first by generatedAt
}
```

ID derived from `generatedAt` (deterministic, same shape as `buildOutcomeReportId`). File name: `recommendation-<iso-safe>.json`.

## CLI

`alix executive recommend --save [--window N] [--json]`

- Without `--save`: identical to today (P10.7a behavior).
- With `--save`: persists the report; prints `Recommendation report saved: <id>` to **stderr** so JSON stdout stays clean.
- With `--save --json`: emits the full persisted `RecommendationReport` as JSON (includes `id`, `contentHash`, `evidenceReportIds`).

The handler builds a `NewRecommendationReport` from the `RecommendationResult` + the windowed outcome report IDs (the evidence), then calls `store.save(payload)`.

## Mutation boundary & sentinel

- `recommendation-engine.ts` (P10.7a): pure. The rename changes a field name, not purity. **No sentinel exception.**
- `recommendation-report-store.ts` (NEW): approved write path. **One scoped sentinel exception** added, mirroring the `outcome-store.ts` block — whitelists the 6 fs functions (`writeFileSync`, `mkdirSync`, `renameSync`, `openSync`, `fsyncSync`, `closeSync`).
- `executive-recommend-handler.ts` (P10.7a): gains a `--save` branch that calls `store.save(payload)`. No fs writes. **No exception.**
- `EXECUTIVE_FILES` gains one entry: `recommendation-report-store.ts`.

## File structure

| File | Action |
|---|---|
| `src/executive/recommendation-engine.ts` | modify: rename `confidence` → `signalConfidence` (type + classifier body) |
| `src/executive/recommendation-report-store.ts` | create: store + integrity error + meta type |
| `src/cli/commands/executive-recommend-handler.ts` | modify: add `--save` branch |
| `tests/executive/recommendation-engine.vitest.ts` | modify: rename assertions |
| `tests/executive/recommendation-report-store.vitest.ts` | create: store unit tests |
| `tests/cli/commands/executive-recommend-cli.vitest.ts` | modify: rename `confidence` references + add `--save` tests |
| `tests/executive/executive-sentinels.vitest.ts` | modify: add new file to `EXECUTIVE_FILES` + one scoped fs-exception |

## Test plan

**Store unit tests** (`recommendation-report-store.vitest.ts`):
- `save` round-trip preserves all fields + contentHash
- `load` rejects tampered contentHash → `RecommendationReportIntegrityError`
- `load` rejects unknown `schemaVersion`
- `load` returns `null` for missing id
- `list()` skips corrupt file, sorts newest-first
- Reserved fields round-trip as `undefined` (never populated in P10.7b)

**Rename regression**: existing P10.7a engine + CLI tests pass with `signalConfidence`.

**`--save` CLI tests** (additions to `executive-recommend-cli.vitest.ts`):
- `--save` persists + prints `Recommendation report saved: <id>` to stderr
- `--json --save` emits the full `RecommendationReport` (with `evidenceReportIds`)
- Report carries the right `evidenceReportIds` (the windowed outcome report IDs)
- No-`--save` path is byte-identical to today (no regression)

**Sentinel**: new store passes with its scoped exception; engine + handler remain clean (no regression in the 32 existing tests).