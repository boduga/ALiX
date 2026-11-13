# Risk Escalation Decision (J6)

## Overview
Bounded probabilistic decision that judges the severity of exactly one action as `low`, `medium`, or `high`. Deterministic policy composes that tier into an approval requirement; this decision can only escalate, never waive, what policy already requires. A projector reduces the action to a minimal capability-plus-description payload before any engine sees it.

## Interface
- Risk tier vocabulary and validator: `RISK_TIERS`, `RiskTier`, `isRiskTier`, `RISK_TIER_CANDIDATES` in [schema.ts:RISK_TIERS]
- Decision identity and bounded projection: `RISK_ESCALATION_DECISION`, `RISK_ESCALATION_PROJECTOR_VERSION`, `MAX_CAPABILITY_CHARS`, `MAX_SUMMARY_CHARS`, `MAX_DETAIL_CHARS`, `RiskEscalationActionInput`, `RiskEscalationProjection`, `createRiskEscalationProjector`, `projectRiskEscalation`, `readRiskProjection` in [projection.ts:createRiskEscalationProjector]
- Deterministic fallback/comparison arm: `classifyRiskLocally`, `LocalRiskVerdict` in [local-baseline.ts:classifyRiskLocally]
- System One wire mapping: `JEV_RISK_QUESTION_ID`, `RISK_CRITERIA`, `renderRiskState`, `toJevRiskRequest`, `fromJevRiskResponse` in [jev-mapping.ts:toJevRiskRequest]
- Shadow runner and observation types: `RiskObservation`, `RiskEscalationShadowResult`, `RiskEscalationShadowDeps`, `RiskEscalationShadowInput`, `runRiskEscalationShadow` in [shadow.ts:runRiskEscalationShadow]
- Feature-gated selection seam: `RiskSelectionMode`, `RiskSelection`, `selectRiskTier` in [selection-service.ts:selectRiskTier]
- Labeled fixtures and adversarial fixtures: `RiskEscalationFixture`, `RISK_ESCALATION_CORPUS` in [corpus.ts:RISK_ESCALATION_CORPUS]
- Barrel re-export of every module above: [index.ts:index]

## Invariants
- The legal verdict space is code-defined and ordered; unknown tiers are rejected, never coerced — `fromJevRiskResponse` throws `MalformedResultError` for a non-tier choice ([jev-mapping.ts:fromJevRiskResponse]).
- Escalation composes monotonically (JEV-8): `recommendApproval = composeApproval(policyRequires ?? false, riskExceeds)`; an unknown observed tier counts as exceeding the low-risk bar ([shadow.ts:runRiskEscalationShadow]).
- The projection is minimum-necessary: only capability, bounded summary, and bounded detail are accepted; raw commands, arguments, and tool output never enter ([projection.ts:RiskEscalationProjection]).
- A projection with an empty capability or empty summary throws before any engine runs, so a disabled or invalid action performs no remote call and writes no journal record ([projection.ts:createRiskEscalationProjector]).
- The local baseline cannot clear a read-only capability: for members of `READ_ONLY_CAPABILITIES` it returns `low` regardless of descriptive wording ([local-baseline.ts:classifyRiskLocally]).
- Anything unknown escalates: a capability outside `READ_ONLY_CAPABILITIES` with no destructive or mutation marker returns `medium` ([local-baseline.ts:classifyRiskLocally]).
- `riskEscalation.enabled !== true` yields `enabled: false` with no records and `authority: "none"` ([shadow.ts:runRiskEscalationShadow]).
- Selection mode defaults to `"off"`, which judges nothing and returns only the mode ([selection-service.ts:selectRiskTier]); `"shadow"` returns observations without a tier; `"active"` returns the observed tier plus the advisory recommendation.
- Every shadow result carries `authority: "none"`; the recommendation is advisory and PolicyGate remains the sole approval authority ([shadow.ts:RiskEscalationShadowResult]).

## Side Effects
- Appends one `DecisionJournalRecord` per executed engine outcome to the injected `DecisionJournalStore` after the run completes ([shadow.ts:runRiskEscalationShadow]).
- Executes the configured decision route through `buildPlan` / `executeWithFallback`, which may perform a remote System One call when the route resolves to a remote engine ([shadow.ts:runConfigured]).
- Runs the local baseline engine a second time over the same sealed projection when `compareBaseline` is not disabled and the observed engine is not the local engine ([shadow.ts:runLocalBaseline]).
- No execution authority is granted, and no policy or approval state is written by this module ([selection-service.ts:selectRiskTier]).

## Verification
- Run: `pnpm test`
- Decision contract tests: `tests/decision/risk-escalation.test.ts` — schema, projection bounds/redaction, baseline corpus, Jev mapping, fallback, shadow journaling, and `selectRiskTier` off/shadow/active.
