# Decision CLI Commands

## Overview
`alix decision` operator surface. Every handler builds decision infrastructure from `.alix` stores under the current working directory, then renders or emits JSON for decision context, risk, recommendations, the operator queue, strategic briefs, pipeline health, governance lens review, outcome tracking, lens calibration, and execution intents. `main.ts` performs dispatch only; each subcommand lives in its own module `[main.ts:handleDecisionCommand]`.

## Interface
- `handleDecisionCommand(args)`: dispatches the first positional argument to `runContext`, `runRisk`, `runRecommend`, `runQueue`, `runBrief`, `runStatus`, `runReview`, `runOutcome`, or `runIntent`; an unknown subcommand prints usage and exits 1 `[main.ts:handleDecisionCommand]`.
- `buildDecisionInfrastructure(cwd)` returns `DecisionInfrastructure` with `proposalStore`, `evidenceStore`, `effectivenessStore`, `intelligenceStore`, `lineageBuilder`, and `contextBuilder` `[shared.ts:buildDecisionInfrastructure]`.
- Path constants `PROPOSALS_DIR`, `EVIDENCE_DIR`, `EFFECTIVENESS_DIR`, `INTELLIGENCE_DIR`, `OUTCOMES_DIR` are workspace-relative; `INTENTS_DIR` is resolved against `homedir()` `[shared.ts:PROPOSALS_DIR]` `[shared.ts:INTENTS_DIR]`.
- `runContext`, `runRisk`, `runRecommend` render `DecisionContext`, `RiskScore`, and `ApprovalRecommendation` respectively, each with a `--json` branch `[context-risk.ts:runContext]` `[context-risk.ts:runRisk]` `[context-risk.ts:runRecommend]`.
- `runQueue` builds `QueueInput` per pending proposal and sorts/limits via `OperatorQueue.build` `[queue-brief.ts:runQueue]`; `runBrief` builds a `StrategicBrief` from effectiveness, intelligence, and lifecycle evidence records `[queue-brief.ts:runBrief]`; `runStatus` builds a pipeline health report via `PipelineHealthCollector` and `PipelineHealthBuilder` `[queue-brief.ts:runStatus]`.
- `runReview` runs governance lenses (`red_team`, `historian`, `policy_auditor`, `confidence_critic`) and aggregates them through `GovernanceReviewCouncil.aggregate` `[review.ts:runReview]`; `renderReview(review, singleLens?)` is exported separately `[review.ts:renderReview]`.
- `runOutcome` dispatches `record`, `show`, `report`, and `lens-calibration` `[outcome.ts:runOutcome]`; `VALID_OUTCOMES` is the closed set `success | partial_success | neutral | failure | unknown` `[outcome.ts:VALID_OUTCOMES]`.
- `runIntent` dispatches `list`, `show`, and `propose`; `statusIcon(status)` maps intent status to an emoji `[intent.ts:runIntent]` `[intent.ts:statusIcon]`.

## Invariants
- `runReview` validates `--lens` before any provider or store setup, so an invalid lens exits before side effects `[review.ts:runReview]`.
- `--window` for `runBrief` accepts only 30, 90, or 180 and exits 1 otherwise `[queue-brief.ts:runBrief]`; `runOutcomeReport` and `runOutcomeLensCalibration` require a positive integer window `[outcome.ts:runOutcomeReport]` `[outcome.ts:runOutcomeLensCalibration]`.
- `runQueue` requires `--limit` to be a non-negative integer and exits 1 otherwise `[queue-brief.ts:runQueue]`.
- Outcome resolution never fabricates confidence: confidence is taken from a stored recommendation only when found, or from a validated `--recommendation-confidence` in `[0, 1]` `[outcome.ts:runOutcomeRecord]`.
- Governance review auto-lookup uses `queryByProposal(subjectId)` rather than listing all reviews, so a review for another proposal cannot leak into the outcome link `[outcome.ts:runOutcomeRecord]`.
- `runOutcomeRecord` writes `subjectType: "proposal"` and `observationWindowDays: 30` for every record `[outcome.ts:runOutcomeRecord]`.
- `runIntentPropose` accepts only intents with status `captured` and requires both `proposedAction` and `proposedTarget`, exiting 1 otherwise `[intent.ts:runIntentPropose]`.
- `runQueue` skips a pending proposal when context building throws, reporting the skip, instead of aborting the queue `[queue-brief.ts:runQueue]`.
- `runStatus` defaults `--window` to 30 days `[queue-brief.ts:runStatus]`; `runOutcomeReport` and `runOutcomeLensCalibration` also default to 30 days `[outcome.ts:runOutcomeReport]` `[outcome.ts:runOutcomeLensCalibration]`.

## Side Effects
- `runRecommend` appends the built `RiskScore` to `RiskScoreStore` and the recommendation to `ApprovalRecommendationStore`; both writes are best-effort and log-and-continue on failure `[context-risk.ts:runRecommend]`.
- `runReview` appends the aggregated review to `GovernanceReviewStore` best-effort after lens execution and aggregation `[review.ts:runReview]`.
- `runOutcomeRecord` appends an `OutcomeRecord` to `OutcomeStore` under `<cwd>/.alix/adaptation/outcomes` `[outcome.ts:runOutcomeRecord]` `[shared.ts:OUTCOMES_DIR]`.
- `runIntentPropose` creates an adaptation proposal through `IntentProposalMapper.mapToProposal` using the workspace proposal store `[intent.ts:runIntentPropose]`.
- Handlers read state from the workspace `.alix` stores built by `buildDecisionInfrastructure` and from `~/.alix/execution/intents` for intents `[shared.ts:buildDecisionInfrastructure]` `[shared.ts:INTENTS_DIR]`.
- `runReview` creates a live provider from detected provider/model configuration and reads the provider API key from the environment variable named by the provider catalog `[review.ts:runReview]`.
- Output goes to stdout/stderr through `console.log`/`console.error`; validation failures terminate the process with `process.exit(1)` `[main.ts:handleDecisionCommand]` `[outcome.ts:runOutcome]`.

## Verification
- Run: `pnpm test`
