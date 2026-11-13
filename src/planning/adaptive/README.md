# Adaptive Policy

## Overview
Defines the deterministic substrate switch between context-assembly and reasoning modes. It maps five boolean execution signals onto an orthogonal `ContextMode`/`ReasoningMode` decision while preserving the EventLog and execution-state anchors.

## Interface
- `ContextMode`: `STATE_ONLY`, `STATE_WITH_EVIDENCE`, or `HISTORY_AWARE` [policy.ts:ContextMode].
- `ReasoningMode`: `ODA` or `ReAct` [policy.ts:ReasoningMode].
- `ExecutionSignals` with `latestObservationRequired`, `historicalDependency`, `repeatedFailure`, `highUncertainty`, and `multiStepInteraction` [policy.ts:ExecutionSignals].
- `SubstrateAnchors` fixes `eventLogAuthoritative`, `executionStateAnchor`, and `historySelective` to `true` [policy.ts:SubstrateAnchors].
- `AdaptiveDecision` carries `contextMode`, `reasoningMode`, sorted trigger names, and the anchors [policy.ts:AdaptiveDecision].
- `AdaptivePolicy.decide(signals)` [policy.ts:AdaptivePolicy].

## Invariants
- Decisions are pure: signals are defensively copied and coerced to booleans, with no I/O, executor coupling, or state mutation [policy.ts:AdaptivePolicy].
- Context signals affect only `contextMode`; reasoning signals affect only `reasoningMode` [policy.ts:AdaptivePolicy].
- Context precedence is `HISTORY_AWARE` from `historicalDependency`, otherwise `STATE_WITH_EVIDENCE` from `repeatedFailure`, otherwise `STATE_ONLY` [policy.ts:AdaptivePolicy].
- `latestObservationRequired` is recorded as a trigger but does not change the selected context mode [policy.ts:AdaptivePolicy].
- `highUncertainty` or `multiStepInteraction` selects `ReAct`; otherwise reasoning remains `ODA` [policy.ts:AdaptivePolicy].
- Triggers are de-duplicated and sorted for deterministic output [policy.ts:AdaptivePolicy].
- The decision and trigger list are frozen, and anchors always assert selective history that never bypasses execution state [policy.ts:AdaptivePolicy], [policy.ts:SubstrateAnchors].

## Side Effects
- ["None"]

## Verification
- Run: `pnpm test`
