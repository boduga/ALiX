# DOX — Governance CLI commands

**Purpose:** `alix governance <subcommand>` handlers + terminal renderers.
`../governance.ts` is the compatibility re-export barrel.

**Ownership:**
- `shared.ts` — ANSI colors (`RESET`…`MAGENTA`, `BAR`), severity/priority/rate/state
  color helpers (`colorForSeverity`/`colorForRecommendation`/`colorForRate`/`colorForState`),
  event-type color (`eventTypeColor`/`EVENT_TYPE_COLORS`), flag parsers
  (`parseFlags`, `parseRecommendFlags`, `parseSectionFlag`, `parseInlineFlag`) +
  their option interfaces. Shared here so the command modules do not cross-import
  each other (breaks the audit↔audit-insights and execution↔workbench cycles).
- `evolution.ts` — `runEvolutionLearn/Discover/Forecast`.
- `status.ts` — `runStatus/Health/Drift/LensReview/Integrity/Recommend` + their
  renderers.
- `lifecycle.ts` — proposal lifecycle (`runGovernanceApprove/Reject/List/
  Cleanup/Explain`).
- `investigation.ts` — `runInvestigate*` + `renderInvestigationDetail`.
- `analytics.ts` — `runAnalytics/FailureAnalysis/PolicySuggestions/
  FrictionAnalysis/Report` + renderers.
- `inbox.ts` — `runInbox*`, `runReview*`, `runDecide*` + renderers.
- `actions.ts` — `runActions*` + `transitionId`.
- `execution.ts` — `runExecution*` + `loadExecutionStores`.
- `workbench.ts` — `runWorkbench*`, `loadWorkbenchSnapshot`.
- `readiness.ts` — `runReadiness` + readiness compute/render helpers.
- `handoff.ts` — `runHandoff`, `runHandoffClosureAction` + renderers.
- `intelligence.ts` — `runIntelligence`.
- `audit.ts` — `runAudit*` (list/show/trace/timeline/verify/export) +
  `formatMetadata`, `formatTimelineLine`, `computeRelatedEvents` (public).
- `audit-insights.ts` — `runAuditStats/Anomalies/Effectiveness/Report/Actor/
  Policy` + `deltaSign`.
- `main.ts` — `handleGovernanceCommand` dispatcher.

**Local Contracts:**
- Each module stays ≤ 1,000 lines.
- `../governance.ts` re-exports `handleGovernanceCommand` and the three public
  `format*`/`computeRelatedEvents` helpers; do not add logic there.
- **Purity invariant (sentinel-enforced):** governance code writes only
  `GovernanceStore`; never imports audit emitters directly (emission flows
  through audited store decorators from `src/governance/audit-decorators.ts`).
- Relative imports: `../../../` → `src/`, `../` → `src/interfaces/cli/commands/`.
- Dynamic imports use the same depth (`../../../governance/...`).

**Work Guidance:**
- Source-scan sentinels read the barrel + all modules via
  `tests/helpers/governance-source.ts` `readGovernanceSource()`; use it for any
  new text sentinel instead of reading `governance.ts` directly.

**Verification:**
- `tests/governance/governance-sentinels.vitest.ts` — P9 purity.
- `tests/governance/audit-migration.test.ts` — no direct emitter usage.
- `tests/cli/commands/governance-*.vitest.ts` + `tests/governance/*.test.ts`.

**Child DOX Index:** none.
