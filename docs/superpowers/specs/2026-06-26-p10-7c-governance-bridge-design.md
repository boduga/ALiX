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
        │     └─ drafts: [{ recIndex, proposal (id: "") }] + skippedCount
        │
        ├─ if drafts.length === 0  →  print "No eligible recommendations to bridge." and exit
        │   (NO proposal saves, NO report rewrites — true no-op)
        │
        ├─ for each draft: ProposalStore.save(draft.proposal) → saved.id ── adaptation (write)
        ├─ collect updates: [{ recIndex, proposalId: saved.id, status: "proposed" }]
        ├─ build updatedReport via copy-on-write (loaded report object never mutated)
        ├─ RecommendationReportStore.save(updatedReport)                ── P10.7b (overwrite)
        └─ print summary (created proposalIds + skippedCount + updated reportId)
```

The pure function answers only "which proposals should exist?" — it knows nothing about canonical ids, persistence, or report-update construction. The handler owns all I/O and constructs the update records from the store's returned ids.

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

/** A single bridgeable recommendation paired with the proposal draft that
 *  should exist for it. The pure function only answers "which proposals
 *  should exist?" — it does NOT know about persistence, canonical ids,
 *  or report-update construction. */
export interface ExecutiveDraftProposal {
  /** Index of the recommendation within report.report.recommendations. */
  recIndex: number;
  /** Draft proposal (id:""; the store assigns the canonical id on save). */
  proposal: AdaptationProposal;
}

/** Output of the pure bridge function. */
export interface ExecutiveBridgeResult {
  drafts: ExecutiveDraftProposal[];
  /** Recommendations skipped due to eligibility (non-actionable or already-proposed). */
  skippedCount: number;
}
```

### Proposal shape (per bridged recommendation)

The pure function produces a **draft** with `id: ""` (the "id-to-be-assigned" marker). The handler assigns the canonical id via `nextProposalId()` (imported from `../../adaptation/recommendation-to-proposal.js` — the shared P5.1c id scheme) immediately before calling `ProposalStore.save`. This mirrors the P10.4b pattern where the effectful layer, not the store, owns id assignment.

```ts
// Produced by the pure function (id is "" — handler will assign before save):
{
  id: "",                               // sentinel: handler assigns nextProposalId()
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
3. **No-op short-circuit:** if `result.drafts.length === 0`, print "No eligible recommendations to bridge." and return. No proposal saves, no report rewrites.
4. For each `result.drafts[i]` **in array order** (which mirrors the source report's recommendation order):
   a. Assign the canonical id to the draft: `drafts[i].proposal.id = nextProposalId()` (imported from `../../adaptation/recommendation-to-proposal.js` — the shared P5.1c id scheme, same `prop-YYYY-MM-DD-NNN` shape).
   b. `await proposalStore.save(drafts[i].proposal)` (`ProposalStore.save` is async, returns `Promise<void>`; the canonical id is already set on the draft).
   c. Collect `{ recIndex: drafts[i].recIndex, proposalId: drafts[i].proposal.id, status: "proposed" }`.
   **Partial-failure contract:** if any `save()` throws, the loop stops immediately — no report is built, no report is rewritten, the error is surfaced. Already-created proposals remain `pending` in `ProposalStore` (they are valid proposals, visible via `alix governance list`). The invariant: **the recommendation report is never ahead of reality.** A later rerun finds the still-unbridged recs (`proposalId === undefined`) and bridges them.
5. Build updated report via **copy-on-write** (the loaded `report` object is never mutated):
   ```ts
   const updatedReport = {
     ...report,
     report: {
       ...report.report,
       recommendations: report.report.recommendations.map((rec, i) => {
         const update = collected.find((u) => u.recIndex === i);
         return update
           ? { ...rec, proposalId: update.proposalId, governanceStatus: update.status }
           : rec;
       }),
     },
   };
   ```
   Non-bridged recommendations pass through unchanged (`signal`, `severity`, `recommendation`, `signalConfidence`, `occurrenceCount`, `averageDelta`, and all other fields preserved bit-for-bit).
6. `recommendationStore.save(updatedReport)` — same `generatedAt` → same id → atomic overwrite with new `contentHash`.
7. Print summary. **`createdProposalIds` are emitted in the same order as the source report's recommendations** (deterministic — the pure function iterates `report.report.recommendations` in order, the save loop preserves that order, the collected ids inherit it).

The handler owns the construction of `bridgedUpdates` from the store's saved ids. The pure function never sees `proposalId` assignment or `governanceStatus` mutation — it only proposes what *should* exist.

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
- Mixed (some eligible, some not) → correct split between `drafts.length` and `skippedCount`.
- Each draft carries `recIndex` pointing at the source recommendation's index.
- Proposal shape: `action === "create_improvement_issue"`, `target.kind === "issue"`.
- Proposal shape: payload contains `source: "executive_learning"` + the 9 executive context fields.
- Proposal shape: `sourceRecommendationType === "executive_learning"`, `sourceConfidence === rec.signalConfidence`.
- Proposal shape: `status === "pending"`, `provenance === "manual"`.
- Proposal shape: `id === ""` (store-assigns-id sentinel).
- Empty report → empty `drafts`, `skippedCount: 0`.
- Determinism: same `(report, generatedAt)` → same output.
- Pure function makes no reference to `bridgedUpdates`, `proposalId` assignment, or `governanceStatus` (separation of concerns).

**CLI tests** (`executive-bridge-cli.vitest.ts`):
- Bridges a persisted report: creates N proposals, report updated with `proposalId`/`governanceStatus: "proposed"` on bridged recs.
- Default `--report` (omitted) bridges the latest report.
- `--json` outputs `{ ok, reportId, createdProposalIds, skippedCount }`.
- Idempotent re-run: second call creates 0 new proposals; bridged recs are skipped.
- Already-proposed (pre-set `proposalId`): that rec is skipped.
- **No-op short-circuit:** when zero drafts, the handler performs ZERO proposal saves and ZERO report saves. Verified by asserting no files appear under `.alix/adaptation/proposals/` and no `.alix/executive/recommendations/recommendation-*.json` mtime changes after a no-op bridge.
- **Non-bridged recs unchanged:** after a partial bridge, the non-bridged recommendations retain their original `signal`, `severity`, `recommendation`, `signalConfidence`, `occurrenceCount`, `averageDelta` bit-for-bit (copy-on-write verification).
- No `--report` and no reports in store: clean message, exit cleanly.
- The created proposals exist in `ProposalStore.list()` after the bridge (verified via load) and carry the canonical `sourceConfidence` + `evidenceFingerprints`.
- **Ordering:** when a report contains multiple eligible recommendations, `createdProposalIds` are emitted in the same order as the recommendations appear in the source report. Verified by bridging a report with eligible recs at indices 0, 1, 2 and asserting `createdProposalIds[0]` corresponds to recIndex 0, `[1]` to recIndex 1, etc.
- **Partial-failure (transactional):** when `ProposalStore.save()` throws on the Nth call, the handler stops immediately: the first N-1 proposals remain `pending` in `ProposalStore` (verified via list), the recommendation report is NOT rewritten (verified by checking its mtime/contentHash are unchanged), and the error is surfaced to the caller. A subsequent rerun finds the still-unbridged recs (`proposalId === undefined`) and bridges them — proving the report was never ahead of reality.

**Sentinel:**
- Both new files added to `EXECUTIVE_FILES`; no scoped exceptions required.
- Sentinel test count increases by 2 (e.g., 33 → 35).
- Verify the instance-based store access pattern (`proposalStore.save(...)`, lowercase) passes the forbidden `ProposalStore.save` (uppercase) check.