# P9.5 — Governance Dashboard

> **Status:** SDS approved
> **Spec home:** `docs/superpowers/specs/2026-06-24-p9-5-governance-dashboard-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-24-p9-5-governance-dashboard.md`
> **Governs:** branch from `main` at HEAD.
> **Risk level:** Low — P8.5b is a proven template; hybrid data sources are well-bounded.

## Core framing

P9.5 is a **read-only terminal dashboard** that gives the operator a complete picture of the governance mutation system in one view. It mirrors P8.5b's proven three-layer pattern (aggregator + CLI dispatcher + renderer) but uses a **hybrid data source model**:

- **P9.0 builders** for current analytical state (what *is* the governance system doing right now)
- **Stores** for operational history (what *happened* and what is *pending*)

The dashboard is the operator's single 5-second answer to: **"Can ALiX safely apply governance changes right now?"**

## Architecture (3 layers)

### 1. Aggregator — `src/governance/governance-dashboard.ts`

Pure read-only function. The single boundary that touches the data layer. Returns a typed, JSON-serializable `GovernanceDashboardReport`.

```ts
export async function buildGovernanceDashboardReport(opts: GovernanceDashboardOptions): Promise<GovernanceDashboardReport>
```

### 2. Renderer — `src/cli/commands/governance-dashboard-renderer.ts`

Terminal formatter. Consumes the typed report. Renders 6 panels in fixed order. No data access.

```ts
export function renderGovernanceDashboard(report: GovernanceDashboardReport, opts?: { jsonMode?: boolean }): void
```

### 3. CLI dispatcher — `src/cli/commands/governance.ts` (modify)

New subcommand: `alix governance dashboard [--window <days>] [--json]`. The dispatcher parses args, calls the aggregator, hands the report to the renderer. The dispatcher never touches the data layer directly.

## Data flow

```
buildGovernanceDashboardReport(opts)
  │
  ├─ P9.0 builders (parallel)         ──→ primary panel + panel 5
  │     buildGovernanceHealth
  │     buildGovernanceAssessment
  │     buildGovernanceDrift
  │     buildGovernanceIntegrity
  │     buildLensLifecycleReview
  │
  ├─ GovernanceStore                  ──→ primary panel + panel 2
  │     .listRecommendations()        │    (open recs by kind)
  │     .findRecommendationById()     │
  │
  ├─ ProposalStore                    ──→ primary panel + panels 1, 3
  │     .list()                       │    (pending, applied governance_change)
  │     .load()                       │
  │
  ├─ EvidenceStore (read)             ──→ panels 3, 4
  │     governance_mutation_applied   │    (revert event history)
  │     adaptation_revert_applied     │
  │
  └─ SnapshotStore                    ──→ panel 4
        .existsForProposal()          │    (revert readiness per mutation)
        │
        ▼
  GovernanceDashboardReport (typed, JSON-serializable)
        │
        ▼
  renderGovernanceDashboard(report)   → terminal output (text or --json)
```

The aggregator is the only place that touches the data layer. Renderers, sentinels, and downstream consumers all see a typed `GovernanceDashboardReport`. This is the same boundary P8.5b established.

## The 6 panels

### Primary (panel 0) — Mutation Pipeline Health

The 5-second answer: "Can ALiX safely apply governance changes right now?"

```
Governance Pipeline Health
  Supported mutation kinds:   3/5     (confidence_calibration, lens_adjustment, policy_coverage)
  Pending mutation proposals: N
  Blocked unsupported kinds:  N       (chain_restoration, governance_integrity in queue)
  Investigation-only recs:    N
  Recent apply failures:      N       (last 7d)
  Revert readiness:           100%    (X of X applied mutations have snapshots)
```

### Panel 1 — Open Mutations

Table of pending + approved `governance_change` proposals grouped by kind. Each row: `proposalId`, `recommendationId`, `status` (pending/approved), `targetKind`, `createdAt`, `confidence`.

### Panel 2 — Investigation Queue

Table of `chain_restoration` and `governance_integrity` recommendations (and any future investigation kinds). Distinct visual treatment (`[INVESTIGATION]` tag) to make it clear these **cannot be applied**. Each row: `recommendationId`, `category`, `severity`, `createdAt`, `operatorGuidance` (truncated).

### Panel 3 — Mutation History

Table of applied `governance_change` proposals in the window. Each row: `proposalId`, `kind`, `appliedAt`, `appliedBy`, `snapshotId` (or `MISSING` if no snapshot — flagged).

### Panel 4 — Revert Readiness

For each applied mutation, the snapshot existence status:

- ✅ `snapshot present` (revertable)
- ⚠️ `no snapshot` (irreversible; the `create_*` or `create_improvement_issue` cases from the P5 era)
- ✗ `corrupted snapshot` (integrity hash mismatch)

Summary line: `X/Y applied mutations are revert-ready (Z%)`.

### Panel 5 — Drift & Integrity Gaps

Aggregated findings from P9.0 reports:

- HealthReport weakest layer
- DriftReport findings (high + critical only)
- IntegrityReport metrics under threshold
- LensLifecycleReview retirements pending

This is the "what to fix" panel. No mutation paths — read-only.

## Core invariants

1. **Read-only.** The dashboard NEVER writes to any store, file, or evidence chain. The aggregator is the boundary; if it ever calls a write API, that's a bug.
2. **JSON-serializable report.** The `GovernanceDashboardReport` is plain data. `--json` mode and the renderer both consume it. No functions, no class instances, no closures.
3. **Schema version.** `report.schemaVersion = "p9.5.0"`. Follows the P8.5b convention so future versions can coexist.
4. **No mutation paths reach the dashboard.** A purity sentinel test asserts that the dashboard module does NOT import mutation APIs (see "Sentinel" below).

## Sentinel

New test file: `tests/governance/governance-dashboard-sentinels.vitest.ts`.

The check is **scoped to the dashboard's three files only** (aggregator, renderer, CLI subcommand handler). It forbids the import or call of any **mutation write path** while still permitting read-only store queries.

```ts
const FORBIDDEN_IN_DASHBOARD = [
  // Mutation appliers
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  // Approval / apply / reject verbs
  "approve(",
  "apply(",
  "reject(",
  // Mutation-write stores
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
  // Evidence write methods
  "recordGovernanceMutationApplied",
  "recordAdaptationApproved",
  "recordAdaptationApplied",
  "recordAdaptationRejected",
  "recordAdaptationFailed",
  "recordRevertApplied",
  "recordRevertFailed",
];
```

The check enforces: the three dashboard files do not import any of these symbols. It does **NOT** forbid importing `ProposalStore`, `GovernanceStore`, `SnapshotStore`, or `EvidenceStore` for **read** operations (`.list`, `.load`, `.findRecommendationById`, `.queryByWindow`, `.existsForProposal`, etc.). This is structural enforcement of the read-only invariant while still allowing the data layer to function.

If a forbidden symbol is detected, the test fails with a file:line reference.

## Testing

### Unit tests (7-9) — `tests/governance/governance-dashboard.vitest.ts`

1. Empty state — no proposals, no recs, no reports (all panels render "n/a" or "0")
2. Supported kinds counter — 3 of 5 displayed correctly
3. Pending mutations — open proposal grouped by kind
4. Investigation queue — only the 2 deferred kinds, no mutation proposals
5. Mutation history — applied in window, with appliedBy
6. Revert readiness — mixed (some with snapshot, some without, some corrupted)
7. Drift findings — high+critical only
8. JSON output — schema stable, all 6 panels present in the report
9. Schema version — `report.schemaVersion === "p9.5.0"`

### CLI integration tests (2-3) — `tests/cli/commands/governance-dashboard-cli.vitest.ts`

1. `alix governance dashboard` — text mode renders 6 panel headers
2. `alix governance dashboard --json` — output parses as JSON with the expected keys
3. `alix governance dashboard --window 7` — windowDays respected by the aggregator

### Sentinel test (1) — `tests/governance/governance-dashboard-sentinels.vitest.ts`

For each of the 3 dashboard files, scan for any forbidden symbol from `FORBIDDEN_IN_DASHBOARD`. Fail with file:line if found.

## File layout (8 files)

| # | Path | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/governance/governance-dashboard.ts` | NEW | Aggregator: `buildGovernanceDashboardReport` |
| 2 | `src/cli/commands/governance-dashboard-renderer.ts` | NEW | Terminal formatter: `renderGovernanceDashboard` |
| 3 | `src/cli/commands/governance.ts` | MODIFY | Add `dashboard` subcommand handler |
| 4 | `tests/governance/governance-dashboard.vitest.ts` | NEW | 7-9 unit tests |
| 5 | `tests/cli/commands/governance-dashboard-cli.vitest.ts` | NEW | 2-3 CLI tests |
| 6 | `tests/governance/governance-dashboard-sentinels.vitest.ts` | NEW | Purity sentinel |
| 7 | `docs/superpowers/specs/2026-06-24-p9-5-governance-dashboard-design.md` | NEW | This spec |
| 8 | `docs/superpowers/plans/2026-06-24-p9-5-governance-dashboard.md` | NEW | Implementation plan (post-approval) |

## Explicitly out of scope (P9.5.0)

- Drill-down from panel to underlying report (deferred; per-report explainers already exist via `alix explain governance <id>`)
- Web/TUI rendering (P9.5 stays terminal-text like P8.5b)
- Cross-window comparison (single window only)
- Auto-refresh / live mode (single-shot)
- Per-investigation-kind proposal (deferred to P9.6 `InvestigationRecommendation` / `OperatorTask`)
- New P9.0 builders (P9.5 consumes what exists; if a new builder is needed later, that's a separate phase)

## Tag and PR conventions

- Branch: `feature/p9.5-governance-dashboard`
- PR title: `P9.5 — Governance Dashboard (read-only, 6 panels)`
- Tag on merge: `alix-p9-5-complete`
