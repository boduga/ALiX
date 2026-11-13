# `alix jev` Operator Surface

## Overview
Operator surface for the decision subsystem (J4/J5): read-only inspection of
routes and journalled decisions, outcome labelling, calibration datasets and
reliability reports, threshold-profile derive/promote/rollback, fixture
building from built-in corpora, offline replay with optional compare/gate, a
Jev-vs-baseline disagreement view, and a two-stage blind label-pair workflow
for claim verification. `dispatchJevCommand` is the testable dispatcher;
`handleJevCommand` converts operator errors into a single stderr line and exit
code 1.

## Interface
- `dispatchJevCommand(args, opts?)`, `handleJevCommand(args)` [main.ts:dispatchJevCommand]
- `JevOperatorError`, `JevPaths`, `resolveJevPaths`, `parseDecisionType`, `loadAlixConfig`, `loadDecisionConfig`, `hasJevKey` [ops.ts:JevOperatorError], [ops.ts:parseDecisionType]
- `buildStatus`, `JevStatus`, `RouteStatus` [ops.ts:buildStatus]
- `labelDecision`, `LabelResult`, `exportDataset`, `reliabilityReport` [ops.ts:labelDecision], [ops.ts:exportDataset]
- `listProfiles`, `shippedProfiles`, `deriveProfile`, `promoteProfileById`, `rollbackProfiles`, `activeProfileFor` [ops.ts:deriveProfile], [ops.ts:promoteProfileById]
- `groupChoiceByEngine`, `buildDisagreements`, `DisagreementsReport`, `DisagreementPair`, `DisagreementSide` [ops.ts:buildDisagreements]
- `prepareLabelPair`, `commitLabelPair`, `LabelPairStage`, `LabelPairResult`, `LabelPairSide` [ops.ts:prepareLabelPair], [ops.ts:commitLabelPair]
- `buildFixtures`, `loadFixtures`, `makeExecutor`, `runReplay`, `LOCAL_ENGINE`, `JEV_ENGINE`, `ReplayOptions`, `ReplayReport` [replay-ops.ts:buildFixtures], [replay-ops.ts:runReplay]
- `renderStatus`, `renderDataset`, `renderReliability`, `renderProfiles`, `renderReplay`, `renderDisagreements`, `renderLabelPairEvidence`, `renderLabelPairReveal` [render.ts:renderStatus]

## Invariants
- `parseDecisionType` accepts exactly `claim-verification`, `context-relevance`, `model-tier`, and `risk-escalation`; an unknown decision is an operator error, never coerced [ops.ts:parseDecisionType]
- Promotion requires `approved: true`; `promoteProfileById` throws an operator error telling the caller to re-run with `--approve` [ops.ts:promoteProfileById]
- `--target-accuracy` must be a finite number in `(0, 1]` [main.ts:dispatchJevCommand]
- `profile derive` takes the accuracy-sweep path only for `claim-verification`/`local` and only when no sample carries a native score; other cases use `computeReliability` + `deriveThresholdProfile` and keep the existing error surfaces [ops.ts:deriveProfile]
- Shipped threshold defaults are shadow-only, are never applied, and cannot be promoted because they carry no provenance [ops.ts:shippedProfiles]
- `replay` on `jev` requires `decision.remote.jev.enabled=true` and a store-only key at `apiKeys.typesafe`; both refusals are actionable operator errors [replay-ops.ts:makeExecutor]
- `model-tier` fixture building fails closed when fewer than two tiers are enabled [replay-ops.ts:buildFixtures]
- Accuracy is reported only when a fixture's `expected` is one of its offered candidates; Noul decisions omit accuracy rather than printing 0% [replay-ops.ts:correctnessPredicate]
- `disagreements` pairs exactly `JEV_ENGINE_ID` then `LOCAL_ENGINE_ID` per `projectionHash` (most recent per engine wins); a third engine never enters `paired`, the rate, or the tallies [ops.ts:buildDisagreements]
- `invocations` counts every `projectionHash` group for the decision, including failure-only groups, so it can exceed `paired` [ops.ts:buildDisagreements]
- A side label inherits from an older record for the same engine only when the verdict is unchanged; a flipped verdict never inherits [ops.ts:buildDisagreements]
- `prepareLabelPair` returns only `{ projectionHash, projection }`; no verdict crosses stage 1, keeping blindness structural [ops.ts:prepareLabelPair]
- `label-pair` supports claim-verification only, requires both engine records with disagreeing verdicts, and refuses already-labelled decision ids before the first append [ops.ts:commitLabelPair]
- `--json` without `--truth` is a usage error raised before any store read; interactive truth entry requires a TTY [main.ts:dispatchJevCommand]
- Subsystem errors carrying a `code` are re-presented as single-line operator errors; anything else propagates [ops.ts:JevOperatorError]

## Side Effects
- `label` and `label-pair` append records to `.alix/decisions/labels.jsonl` via the outcome-label store [ops.ts:labelDecision], [ops.ts:commitLabelPair]
- `dataset --out` writes a calibration export file; `fixture build` writes fixture JSON under `.alix/decisions/fixtures/` [ops.ts:exportDataset], [replay-ops.ts:buildFixtures]
- `profile derive` persists a shadow profile via `saveProfileRegistry`; `promote` and `rollback` update `.alix/decisions/profiles.json` [ops.ts:deriveProfile], [ops.ts:rollbackProfiles]
- `status`, `dataset`, `reliability`, `disagreements`, `fixture list`, and `replay` are read-only (no journal or profile writes) [ops.ts:buildStatus], [replay-ops.ts:runReplay]
- `label-pair` reads the protected experiment projection store (optionally `--store-dir`) to render the evidence view [ops.ts:prepareLabelPair]

## Verification
- Run: `pnpm test`
