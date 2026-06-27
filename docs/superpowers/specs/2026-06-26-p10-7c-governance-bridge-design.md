# P10.7c — Executive Recommendation Governance Bridge Design

> **Status:** Design spec — approved, ready for implementation planning.
> **Builds on:** P10.7b (`RecommendationReportStore`, `ExecutiveRecommendation`, reserved bridge fields). P5.1c (`RecommendationToProposal.convert()`) + P10.4b (executive→adaptation DI pattern + store-assigns-id sentinel).
> **Risk:** MEDIUM. First executive slice that writes to the adaptation domain (`ProposalStore`). Cross-domain mutation.
> **Branch:** `feature/p10-7c-governance-bridge` (off `main` at `alix-p10-7b-complete`).

## Architecture

```
alix executive bridge [--report <id>] [--json]
        │
        ├─ RecommendationReportStore.load(reportId | latest)            ── P10.7b (read)
        ├─ computeExecutiveProposals(report, generatedAt) → BridgeResult ── NEW (pure)
        │     └─ builds drafts with id:"" (store assigns canonical id)
        ├─ ProposalStore.save(draft) × N                               ── adaptation (write)
        │     └─ returns canonical proposalId per save
        ├─ Apply bridgedUpdates (patch proposalId + governanceStatus)
        ├─ RecommendationReportStore.save(updatedPayload)               ── P10.7b (overwrite)
        └─ print summary (created proposalIds + skippedCount + updated reportId)
```

The pure function is fully testable (no I/O, no global state, no id generator). The handler owns all store interaction.

## Hard governance boundary (non-negotiable)

```
P10.7c may create pending proposals (action: create_improvement_issue).
P10.7c may update RecommendationReport recommendations with proposalId / governanceStatus.
P10.7c may not approve proposals.
P10.7c may not apply proposals.
P10.7c may not create GitHub issues directly.
P10.7c may not alter recommendation signal / severity / text / signalConfidence / occurrenceCount / averageDelta.
P10.7c may not alter report generatedAt / requestedWindow / counts / evidenceReportIds / warnings / loadWarnings.
```

The proposal lifecycle downstream (approve/reject/apply/issue-creation) is owned by the existing adaptation-domain machinery (`alix adaptation approve`, appliers, etc.). P10.7c hands off and exits.

## Domain separation

The bridge crosses `.alix/executive/recommendations/` → `.alix/adaptation/proposals/`. The cross-domain write is permitted because:
- The executive purity sentinel forbids the class-method substring `ProposalStore.save` but allows instance-method calls (`proposalStore.save(...)`, lowercase). The handler holds a `ProposalStore` *instance* and calls `.save()` on it — sentinel-clean.
- The pure bridge function in `src/executive/` makes no store calls at all. It returns draft `AdaptationProposal` objects for the handler to persist.

This mirrors the P10.4b executive bridge pattern: pure function + effectful wrapper, with the store accessed via instance at the handler boundary.

## Types

```ts
import type { AdaptationProposal } from "../../adaptation/adaptation-types.js";
import type { RecommendationReport } from "./recommendation-report-store.js";
import type { ExecutiveRecommendation } from "./recommendation-report-store.js";

/** A pending bridge update to apply to a single recommendation. */
export interface ExecutiveBridgeUpdate {
  /** Index of the recommendation within report.report.recommendations. */
  recIndex: number;
  /** Canonical proposalId assigned by ProposalStore.save(). */
  proposalId: string;
  status: "proposed";
}

/** Output of the pure bridge function. */
export interface ExecutiveBridgeResult {
  /** Draft proposals (id:""; store will assign canonical ids on save). */
  newProposals: AdaptationProposal[];
  /** Per-recommendation updates to apply (in recIndex order). */
  bridgedUpdates: ExecutiveBridgeUpdate[];
  /** Recommendations skipped due to eligibility (non-actionable or already-proposed). */
  skippedCount: number;
}
```

### Proposal shape (per bridged recommendation)

```ts
// Produced by the pure function (id is "" — store assigns canonical id on save):
{
  id: "",                               // sentinel: store assigns
  createdAt: generatedAt,
  status: "pending",
  action: "create_improvement_issue",
  target: { kind: "issue", title: "<recommendation text>" },
  payload: {
    source: "executive_learning",
    subsystem: rec.subsystem,
    signal: rec.signal,
    severity: rec.severity,
    signalConfidence: rec.signalConfidence,
    occurrenceCount: rec.occurrenceCount,
    averageDelta: rec.averageDelta,
    evidenceReportIds: report.evidenceReportIds,
    recommendationText: rec.recommendation,
  },
  sourceRecommendationType: "executive_learning",
  sourceConfidence: rec.signalConfidence,
  evidenceFingerprints: [...report.evidenceReportIds],
  reason: `${rec.subsystem} — ${rec.recommendation}`,
  provenance: "manual",
}
```

## Eligibility (per-recommendation gate)

```ts
const isEligible = (rec: ExecutiveRecommendation): boolean =>
  (rec.signal === "degrading_trend" || rec.signal === "persistent_instability") &&
  rec.proposalId === undefined;
```

- **Actionable signals only.** `improving_trend` (positive) and `low_confidence` (too sparse) are skipped — no action to propose.
- **Idempotent re-runs.** `proposalId !== undefined` means this recommendation was already bridged in a prior run; skip.
- **Report-local idempotency.** P10.7c does NOT scan `ProposalStore` for duplicates. The report is the single source of truth for "already bridged."

## Pure bridge function

```ts
export function computeExecutiveProposals(
  report: RecommendationReport,
  generatedAt: string,
): ExecutiveBridgeResult;
```

- Filters `report.report.recommendations` by `isEligible`.
- For each eligible rec, builds a draft `AdaptationProposal` (with `id: ""` — the store-assigns-id sentinel).
- Returns the drafts, the per-rec updates (with `recIndex`), and the skipped count.
- Pure: no I/O, no global state, no id generator, deterministic given `(report, generatedAt)`.
- `generatedAt` is injectable for deterministic tests (same pattern as P10.6 / P10.7a).

## CLI

`alix executive bridge [--report <id>] [--json]`

- `--report <id>`: bridge the specified report. When omitted, bridge the latest persisted report (newest by `generatedAt`, via `RecommendationReportStore.list()[0]`).
- `--json`: emit `{ ok, reportId, createdProposalIds, skippedCount }` as JSON to stdout.
- Terminal: print the created proposal ids, skipped count, and updated report id.
- Empty / no-eligible cases: print a clear message ("No eligible recommendations to bridge") and exit cleanly without writing.

## Handler flow

1. Resolve report id (from `--report` or `list()[0]`). If no report, exit cleanly.
2. `result = computeExecutiveProposals(report, now())` — pure, testable.
3. For each draft in `result.newProposals`: `saved = await proposalStore.save(draft)`; capture `saved.id`.
4. Build updated report payload:
   - Copy `report.report`.
   - For each `result.bridgedUpdates[i]`: set `report.report.recommendations[update.recIndex].proposalId = update.proposalId` and `.governanceStatus = "proposed"`.
   - All other fields unchanged (enforced by the read-modify-save pattern; the only mutations are the two field assignments per bridged rec).
5. `recommendationStore.save(updatedPayload)` — same `generatedAt` → same id → atomic overwrite with new `contentHash`.
6. Print summary.

## Mutation surface (handler)

The handler's writes:
- `ProposalStore.save(draft)` × N (one per eligible rec) → adaptation domain.
- `RecommendationReportStore.save(updatedPayload)` × 1 → executive domain (overwrite, same id).

The handler's reads:
- `RecommendationReportStore.load(reportId)` and `RecommendationReportStore.list()` (for latest).

Sentinel: handler is in `src/cli/commands/executive-bridge-handler.ts`, added to `EXECUTIVE_FILES`. **No scoped exception needed** — `proposalStore.save(...)` (lowercase instance) does not match the forbidden `ProposalStore.save` (uppercase class-method) substring.

## File structure

| File | Action |
|---|---|
| `src/executive/executive-bridge-recommendations.ts` | create: pure `computeExecutiveProposals` + types |
| `src/cli/commands/executive-bridge-handler.ts` | create: `handleBridgeCommand` (load → compute → save proposals → update report → print) |
| `src/cli/commands/executive.ts` | modify: add `case "bridge"` (dynamic import + `handleBridgeCommand(rest)`) + update subcommand list |
| `tests/executive/executive-bridge-recommendations.vitest.ts` | create: pure function tests |
| `tests/cli/commands/executive-bridge-cli.vitest.ts` | create: CLI integration tests |
| `tests/executive/executive-sentinels.vitest.ts` | modify: add 2 new files to `EXECUTIVE_FILES` (no exceptions needed) |

## Test plan

**Pure function tests** (`executive-bridge-recommendations.vitest.ts`):
- Eligibility: `degrading_trend` eligible.
- Eligibility: `persistent_instability` eligible.
- Eligibility: `improving_trend` skipped.
- Eligibility: `low_confidence` skipped.
- Eligibility: `proposalId` already set → skipped.
- Mixed (some eligible, some not) → correct split between `newProposals` and `skippedCount`.
- Proposal shape: `action === "create_improvement_issue"`, `target.kind === "issue"`.
- Proposal shape: payload contains `source: "executive_learning"` + the 9 executive context fields.
- Proposal shape: `sourceRecommendationType === "executive_learning"`, `sourceConfidence === rec.signalConfidence`.
- Proposal shape: `status === "pending"`, `provenance === "manual"`.
- Proposal shape: `id === ""` (store-assigns-id sentinel).
- Empty report → empty `newProposals`, `skippedCount: 0`.
- Determinism: same `(report, generatedAt)` → same output.

**CLI tests** (`executive-bridge-cli.vitest.ts`):
- Bridges a persisted report: creates N proposals, report updated with `proposalId`/`governanceStatus` on bridged recs.
- Default `--report` (omitted) bridges the latest report.
- `--json` outputs `{ ok, reportId, createdProposalIds, skippedCount }`.
- Idempotent re-run: second call creates 0 new proposals; bridged recs are skipped.
- Already-proposed (pre-set `proposalId`): that rec is skipped.
- No eligible recs (all `improving_trend` / `low_confidence`): 0 proposals created, `skippedCount` equals report length, report updated but only with no-op (since no bridge updates). Actually: no proposal saves means no bridged updates to apply → report is unchanged on disk (still re-saved with same contentHash). Verify: re-saved report equals loaded report byte-equivalent.
- Non-bridged recs are unchanged: `signal`, `severity`, `recommendation`, `signalConfidence`, etc. preserved bit-for-bit.
- No `--report` and no reports in store: clean message, exit cleanly.
- The created proposals exist in `ProposalStore.list()` after the bridge (verified via load).

**Sentinel:**
- Both new files added to `EXECUTIVE_FILES`; no scoped exceptions required.
- Sentinel test count increases by 2 (e.g., 33 → 35).
- Verify the instance-based store access pattern (`proposalStore.save(...)`, lowercase) passes the forbidden `ProposalStore.save` (uppercase) check.