# Governance CLI Commands

## Overview
`alix governance <subcommand>` handlers and their terminal renderers. This
directory is the implementation behind the `../governance.ts` compatibility
barrel, which re-exports `handleGovernanceCommand` plus the three public
formatting helpers and nothing else [../governance.ts]. One module owns each
command family (status/lifecycle/inbox/actions/execution/workbench/audit/
analytics), so the families never cross-import each other; shared ANSI colors,
color classifiers, and flag parsers live in `shared.ts` to keep that separation
[shared.ts:parseFlags]. The dispatcher routes a subcommand string to one
handler and prints usage plus exits non-zero on an unknown subcommand
[main.ts:handleGovernanceCommand].

## Interface
- `handleGovernanceCommand(args)` — dispatcher for `status`, `health`, `drift`, `lens-review`, `policies`, `integrity`, `recommend`, `risk-score`, `approval`, `analytics`, `failure-analysis`, `policy-suggestions`, `friction-analysis`, `report`, `inbox`, `review`, `decide`, `actions`, `audit`, `readiness`, `handoff`, `intelligence`, `evolution`, `replay`, `calibration`, `policy-review`, `policy-review-outcome`, `learning-synthesis`, `propose`, `approve`, `reject`, `list`, `cleanup`, `explain`, `dashboard`, `investigate`, `execution`, `workbench` [main.ts:handleGovernanceCommand]
- `report` forwards `compliance` to `../governance-report.js` and `explain` forwards `trace|window` to `../governance-explain.js`, otherwise both fall through to the local handlers [main.ts:handleGovernanceCommand]
- `runStatus`, `runHealth`, `runDrift`, `runLensReview`, `runIntegrity`, `runRecommend` and renderers `renderHealth`, `renderAssessment`, `renderDrift`, `renderLensReview`, `renderIntegrity`, `renderRecommendations` [status.ts:runHealth], [status.ts:renderHealth], [status.ts:runRecommend]
- `runGovernanceApprove`, `runGovernanceReject`, `runGovernanceList`, `runGovernanceCleanup`, `runGovernanceExplain` [lifecycle.ts:runGovernanceApprove], [lifecycle.ts:runGovernanceCleanup]
- `runInbox`, `runInboxList`, `runInboxRefresh`, `runReview`, `runDecide`, `renderInboxList`, `renderDecisionCreated` [inbox.ts:runInbox], [inbox.ts:runDecide], [inbox.ts:renderDecisionCreated]
- `runActions`, `runActionsList`, `runActionsRefresh`, `runActionsMarkExecuted`, `runActionsDismiss`, `transitionId`, `isActionsSubcommand`, `ActionsSubcommand` (`"list" | "refresh" | "mark-executed" | "dismiss"`) [actions.ts:runActions], [actions.ts:ActionsSubcommand], [actions.ts:transitionId]
- `runExecution`, `runExecutionRemediate`, `runExecutionRemediationTransition`, `runExecutionPlan`, `runExecutionApproval`, `runExecutionRecord`, `runExecutionReport`, `loadExecutionStores`, `EXECUTION_STORE_SUBDIR` [execution.ts:runExecution], [execution.ts:loadExecutionStores], [execution.ts:EXECUTION_STORE_SUBDIR]
- `runWorkbench`, `runWorkbenchQueue`, `runWorkbenchTrace`, `runWorkbenchSummary`, `loadWorkbenchSnapshot`, `QUEUE_LABELS` [workbench.ts:runWorkbench], [workbench.ts:runWorkbenchTrace], [workbench.ts:QUEUE_LABELS]
- `runReadiness`, `readinessFlag`, `readReadinessBundle`, `readinessPlan`, `readinessTrace`, `computeReadiness`, `renderReadinessAssessment`, `renderReadinessSimulation`, `renderReadinessDecision`, `renderReadinessReport` [readiness.ts:runReadiness], [readiness.ts:readReadinessBundle], [readiness.ts:computeReadiness]
- `runHandoff` (`build|validate|prepare-record|report`), `runHandoffClosureAction` (`evidence|closure`), `handoffFlag`, `closureFlag`, `renderHandoffReport` [handoff.ts:runHandoff], [handoff.ts:runHandoffClosureAction]
- `runIntelligence` (`outcomes|signals|calibration|report`), `intelligenceFlag` [intelligence.ts:runIntelligence]
- `runAudit` (`list|show|trace|timeline|verify|export|actor|policy|stats|anomalies|effectiveness|report`), `printAuditHelp`, `formatMetadata`, `formatTimelineLine`, `computeRelatedEvents`, `extractPositionalArg`, `TimelineEvent` [audit.ts:runAudit], [audit.ts:computeRelatedEvents], [audit.ts:TimelineEvent]
- `runAuditStats`, `runAuditAnomalies`, `runAuditEffectiveness`, `runAuditReport`, `runAuditActor`, `runAuditPolicy`, `deltaSign` [audit-insights.ts:runAuditStats], [audit-insights.ts:deltaSign]
- `runInvestigate`, `runInvestigateList`, `runInvestigateShow`, `runInvestigateUpdate`, `runInvestigateGenerate`, `renderInvestigationDetail` [investigation.ts:runInvestigate]
- `runAnalytics`, `runFailureAnalysis`, `runPolicySuggestions`, `runFrictionAnalysis`, `runReport` and renderers, `BAR` [analytics.ts:runReport], [analytics.ts:BAR]
- `runEvolutionLearn`, `runEvolutionDiscover`, `runEvolutionForecast` [evolution.ts:runEvolutionLearn], [evolution.ts:runEvolutionForecast]
- Shared surface: `RESET`/`BOLD`/`DIM`/`GREEN`/`YELLOW`/`RED`/`CYAN`/`MAGENTA`, `colorForSeverity`, `colorForRecommendation`, `colorForRate`, `colorForState`, `EVENT_TYPE_COLORS`, `eventTypeColor`, `parseFlags`, `parseRecommendFlags`, `parseSectionFlag`, `parseInlineFlag`, `VALID_PRIORITIES`, `VALID_SOURCES`, `VALID_SECTIONS`, `ParsedOpts`, `ParsedRecommendOpts` [shared.ts:colorForSeverity], [shared.ts:eventTypeColor], [shared.ts:parseSectionFlag]

## Invariants
- Every module in this directory is covered by the P9 purity sentinel, which reads the barrel plus every `*.ts` module [tests/helpers/governance-source.ts:readGovernanceSource] and forbids P8 mutation imports and direct write calls such as `writeFile(`, `appendFile(`, `save(`, `appendSignal(`, `createProposal(`, `applyProposal(` [tests/governance/governance-sentinels.vitest.ts:FORBIDDEN_IMPORTS], [tests/governance/governance-sentinels.vitest.ts:FORBIDDEN_WRITE_CALLS]
- The only governance-owned write surface is `GovernanceStore.append()`; audit emission flows through audited store decorators rather than direct emitter calls [status.ts:runHealth], [tests/governance/audit-migration.test.ts]
- Each module is kept well under 1,000 lines by splitting one command family per file; the largest is `audit-insights.ts` at 747 lines [audit-insights.ts:runAuditStats]
- The barrel `../governance.ts` re-exports `handleGovernanceCommand`, `formatMetadata`, `formatTimelineLine`, and `computeRelatedEvents` only and carries no logic [../governance.ts]
- `runHealth`/`runDrift`/`runLensReview`/`runIntegrity` persist the artifact they render, so a rendered report corresponds to a stored record [status.ts:runHealth], [status.ts:runDrift], [status.ts:runLensReview], [status.ts:runIntegrity]
- `runRecommend` filters the generated recommendation set by `--priority` and `--source` after generation, so stored artifact identity is `artifact.id` and not the filtered list [status.ts:runRecommend]
- `runWorkbenchTrace` resolves signal, investigation, plan, approval, attempt, and remediation hops from the real stores, and derives report items over a window starting at `1970-01-01T00:00:00.000Z` so older remediations do not render phantom "not yet in execution report" gaps [workbench.ts:TRACE_WINDOW_START], [tests/cli/commands/governance-workbench-trace-wiring.vitest.ts]
- `readinessTrace` derives the same report from the caller's input bundle rather than a store read, and `readReadinessBundle` requires an existing `--input` path [readiness.ts:readinessTrace], [readiness.ts:runReadiness]
- `computeRelatedEvents` is read-only: it orders related events by same-trace → same-session → parent/child, de-duplicates, sorts chronologically, and excludes the focal event [audit.ts:computeRelatedEvents]
- `transitionId` derives an ID from the timestamp, an 8-character proposal-id prefix, and 4 random base-36 characters, so concurrent transitions do not collide on the same proposal and instant [actions.ts:transitionId]
- `runDecide` requires exactly one of `--accept`/`--dismiss`/`--defer`/`--escalate`/`--convert-to-issue` and a non-empty `--reason`, exiting 1 on zero or multiple kind flags [inbox.ts:runDecide], [inbox.ts:KIND_FLAGS]
- `createOperatorDecision` validates signal existence, rationale, and an optional review backlink (the review must belong to the same signal); record validation is delegated to `store.append()` rather than duplicated [../../../../governance/decision-capture.ts:createOperatorDecision]
- `renderDecisionCreated` always prints that the decision is advisory and mutates nothing (`No signal, policy, or gate mutation.`) [inbox.ts:renderDecisionCreated]
- `runEvolutionLearn` passes an explicitly empty `enrichedProposals` array to `runLearnCli`, which is a deliberate no-op seam rather than an analysis failure [evolution.ts:runEvolutionLearn]
- `runGovernanceCleanup` refuses a proposal that is not `orphaned`, and refuses one already `cleaned`, before any tombstone write [lifecycle.ts:runGovernanceCleanup]
- Flag parsers exit the process on malformed input: `parseFlags` exits 1 for a bad `--window`, `parseSectionFlag` exits 2 for a missing or unknown `--section`, and `handleGovernanceCommand` exits 1 on an unknown subcommand [shared.ts:parseFlags], [shared.ts:parseSectionFlag], [main.ts:handleGovernanceCommand]

## Side Effects
- `runHealth` appends a `"health"` report and a derived `"assessment"`; `runDrift` appends `"drift"`, `runLensReview` appends `"lensReviews"`, `runIntegrity` appends `"integrity"` via `GovernanceStore.append()` [status.ts:runHealth], [status.ts:runDrift], [status.ts:runLensReview], [status.ts:runIntegrity]
- Read-only analytics and status commands read the run ledger and failure memory from `.alix/governance` through `FileLedgerStore` and `FileFailureMemoryStore` without writing [analytics.ts:runAnalytics], [analytics.ts:runFailureAnalysis], [status.ts:runStatus]
- `runGovernanceApprove`/`runGovernanceReject` mutate proposals in `.alix/adaptation/proposals` through `ApprovalGate` [lifecycle.ts:runGovernanceApprove], [lifecycle.ts:runGovernanceReject]
- `runGovernanceCleanup` marks the proposal `systemState.cleaned = true` and leaves the file on disk, and records a `governance_orphan_cleaned` evidence event through `EvidenceEventWriter` into `.alix/evidence` [lifecycle.ts:runGovernanceCleanup]
- `runGovernanceList`/`runGovernanceExplain` read `.alix/adaptation/proposals` and `.alix/evidence` and write nothing [lifecycle.ts:runGovernanceList], [lifecycle.ts:runGovernanceExplain]
- `runActionsRefresh`/`runActionsMarkExecuted`/`runActionsDismiss` write through `auditActionQueueStore(...)` so each mutation emits exactly one audit event via the decorator, and `runActionsList` is read-only [actions.ts:runActionsRefresh], [actions.ts:runActionsMarkExecuted]
- `runDecide` appends the operator decision through `auditDecisionStore(...)` [inbox.ts:runDecide]
- `runExecution` reads and writes the remediation, plan, approval, attempt, and investigation JSONL stores under `.alix/governance`; `remediate` reads a recommendations JSON file from disk and `record` appends an attempt [execution.ts:loadExecutionStores], [execution.ts:EXECUTION_STORE_SUBDIR], [execution.ts:runExecutionRecord]
- `runAuditExport --output` delegates the write to `exportAuditEventsToFile` in `../governance-audit-exporter.js`, keeping the file write outside this directory's purity envelope [audit.ts:runAuditExport], [../governance-audit-exporter.ts:exportAuditEventsToFile]
- `runReadiness`, `runHandoff`, and `runIntelligence` read their input bundle from `--input` with `readFileSync`/`existsSync` and do not persist derived results [readiness.ts:readReadinessBundle], [handoff.ts:runHandoff], [intelligence.ts:runIntelligence]
- Renderers write to stdout (`console.log`). Usage and error paths write to stderr; several families exit non-zero (`runDecide` and the flag parsers via `process.exit`, the dispatcher on an unknown subcommand), while `execution.ts` reports problems to stderr and returns without calling `process.exit` [shared.ts:parseFlags], [main.ts:handleGovernanceCommand], [execution.ts:runExecutionRemediate]
- `runRecommend` persists the generated artifact via `generateRecommendations`, which appends to the `"recommendations"` collection; `--priority`/`--source` filter only the rendered subset [status.ts:runRecommend], [../../../../governance/governance-recommendation-generator.ts:generateRecommendations]

## Verification
- Run: `pnpm test`
