# Model Tier Decision (J3)

## Overview
Bounded-choice decision that selects one of ALiX's enabled canonical model tiers
for a task, using request features only. The decision never sees or returns a
provider/model ID: resolution to a concrete `provider`/`name` happens locally
through the canonical `models.*` configuration after the tier is chosen. It
ships a deterministic local baseline, a JEV wire mapping, a shadow runner, and a
feature-flagged selection service; the default mode is `off`, so wiring the call
site changes no routing.

## Interface
- `TIER_CANDIDATES`, `listEnabledTiers`, `isModelTierValue`, `filterTierCandidates`, `assertEnabledTier`, `filterTiersByCapability` [tiers.ts:TIER_CANDIDATES]
- `resolveEnabledTierModel`, `describeCurrentRouting`, `tierMatchesCurrentRouting`, `CurrentRouting` [tiers.ts:resolveEnabledTierModel]
- `ModelTierRequestFeatures`, `ModelTierProjection`, `createModelTierProjector`, `projectModelTier`, `readModelTierProjection`, `MODEL_TIER_TASK_KINDS`, `MAX_PROMPT_CHARS` [projection.ts:ModelTierRequestFeatures], [projection.ts:createModelTierProjector]
- `chooseTierLocally`, `LocalTierChoice` deterministic baseline [local-baseline.ts:chooseTierLocally]
- `toJevModelTierRequest`, `fromJevModelTierResponse`, `renderModelTierState`, `TIER_DESCRIPTIONS`, `JEV_MODEL_TIER_QUESTION_ID` [jev-mapping.ts:toJevModelTierRequest], [jev-mapping.ts:TIER_DESCRIPTIONS]
- `ModelTierFixture`, `MODEL_TIER_CORPUS` feature→tier fixtures, including `unsatisfiable` abstain cases [corpus.ts:MODEL_TIER_CORPUS]
- `runModelTierShadow`, `ModelTierShadowDeps`, `ModelTierShadowResult`, `ModelTierObservation` [shadow.ts:runModelTierShadow]
- `selectModelTier`, `ModelTierSelectionMode`, `ModelTierSelection` [selection-service.ts:selectModelTier]
- Barrel re-export of every module above [index.ts:index]

## Invariants
- The candidate set is enabled canonical tiers only; unknown or unconfigured tiers are rejected by `assertEnabledTier`, never coerced or defaulted [tiers.ts:assertEnabledTier]
- The projector emits only request features (taskKind, promptChars, needsTools, needsVision, longContext); prompt text, source, tool output, provider, and model IDs never enter [projection.ts:ModelTierProjection]
- `promptChars` is finite, floored, clamped to `[0, MAX_PROMPT_CHARS]`, and defaults to 0 for a non-number [projection.ts:createModelTierProjector]
- `needsVision` is an image-INPUT hint, not a gate; a pass/fail capability requirement must be enforced by the caller via `filterTiersByCapability`, never decided probabilistically [projection.ts:ModelTierRequestFeatures]
- `filterTiersByCapability` drops unconfigured tiers and treats an undeclared capability as unsatisfied (fail closed) [tiers.ts:filterTiersByCapability]
- `resolveEnabledTierModel` fails closed on an unknown or unconfigured tier rather than falling back to `models.default` [tiers.ts:resolveEnabledTierModel]
- `image` is a candidate tier used only when the deliverable IS an image; composite deliverables keep `synthesis`/`code`/`analysis` [local-baseline.ts:chooseTierLocally]
- The local baseline abstains (returns no tier with a reason) when nothing enabled fits, and it never applies hard capability constraints [local-baseline.ts:chooseTierLocally]
- The JEV request requires at least one candidate and at most `JEV_MAX_CHOICE_OPTIONS`; a non-candidate response is rejected, never coerced [jev-mapping.ts:toJevModelTierRequest]
- `TIER_DESCRIPTIONS` names every task kind the state can send, including `synthesis` in the `thinking` rubric [jev-mapping.ts:TIER_DESCRIPTIONS]
- A shadow result always carries `authority: "none"` and, when disabled, returns no observation and no records [shadow.ts:ModelTierShadowResult]
- `selectModelTier` defaults to mode `off` (keep existing routing); `shadow` journals but keeps existing routing; `active` returns the selected tier for local resolution [selection-service.ts:selectModelTier]

## Side Effects
- `runModelTierShadow` appends `DecisionJournalRecord` entries to the injected `DecisionJournalStore` for every attempt [shadow.ts:runModelTierShadow]
- `runModelTierShadow` may invoke a remote JEV engine when it is enabled and available [shadow.ts:runModelTierShadow]
- `selectModelTier` performs no routing change in `off` or `shadow` mode [selection-service.ts:selectModelTier]

## Verification
- Run: `pnpm test`
