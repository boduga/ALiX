# DOX — Governance CLI commands

**Purpose:** `alix governance <subcommand>` handlers + terminal renderers.
Extracted from the former `../governance.ts` megafile (#717); `../governance.ts`
is now a re-export barrel so existing import paths are unchanged.

**Ownership:**
- `shared.ts` — ANSI colors (`RESET`…`MAGENTA`, `BAR`), severity/priority/rate
  color helpers, flag parsers (`parseFlags`, `parseRecommendFlags`,
  `parseSectionFlag`) + their option interfaces.
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
- `workbench.ts` — `runWorkbench*`, `loadWorkbenchSnapshot`, `colorForState`.
- `readiness.ts` — `runReadiness` + readiness compute/render helpers.
- `handoff.ts` — `runHandoff`, `runHandoffClosureAction` + renderers.
- `intelligence.ts` — `runIntelligence`.
- `audit.ts` — `runAudit*` (list/show/trace/timeline/verify/export) +
  `formatMetadata`, `formatTimelineLine`, `computeRelatedEvents` (public).
- `audit-insights.ts` — `runAuditStats/Anomalies/Effectiveness/Report/Actor/
  Policy` + `deltaSign`.
- `main.ts` — `handleGovernanceCommand` dispatcher.

**Local Contracts:**
- Each module stays ≤ 1,000 lines (leaf-extraction threshold, #717).
- `../governance.ts` re-exports `handleGovernanceCommand` and the three public
  `format*`/`computeRelatedEvents` helpers; do not add logic there.
- **Purity invariant (sentinel-enforced):** governance code writes only
  `GovernanceStore`; never imports audit emitters directly (emission flows
  through audited store decorators from `src/governance/audit-decorators.ts`).
- Relative imports: `../../../` → `src/`, `../` → `src/cli/commands/`.
- Dynamic imports use the same depth (`../../../governance/...`).

**Work Guidance:**
- Source-scan sentinels read the barrel + all modules via
  `tests/helpers/governance-source.ts` `readGovernanceSource()`; use it for any
  new text sentinel instead of reading `governance.ts` directly.

**Verification:**
- `tests/governance/governance-sentinels.vitest.ts` — P9 purity.
- `tests/governance/audit-migration.test.ts` — no direct emitter usage.
- `tests/cli/commands/governance-*.vitest.ts` + `tests/governance/*.test.ts`.
