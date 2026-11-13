# Context Relevance Decision (J2)

## Overview
Scores one context item against a compact objective as a Noul probability, then ranks, thresholds, and caps the scored items in deterministic code. The decision never sends a memory or session dump: callers project one objective plus one item per engine call, and the local correlation id stays out of the remote payload. Shipping profiles are shadow-only, so filtering fails closed until a calibrated active profile is promoted.

## Interface
- `ContextRelevanceInput`, `ContextRelevanceItemInput`, and `ContextRelevanceProjection`: bounded objective-plus-one-item input and minimal projected payload [projection.ts:ContextRelevanceInput], [projection.ts:ContextRelevanceProjection].
- `createContextRelevanceProjector`, `projectContextRelevance`, and `readRelevanceProjection`: build the `context-relevance/v1` projector, project then gate/seal for remote transport, and leniently read a sealed payload for local engines [projection.ts:createContextRelevanceProjector], [projection.ts:projectContextRelevance], [projection.ts:readRelevanceProjection].
- `scoreRelevanceLocally`: deterministic lexical baseline returning the fraction of objective content terms present in the item, with no confidence field [local-baseline.ts:scoreRelevanceLocally].
- `thresholdProfileById`, `thresholdProfileForEngine`, `tryThresholdProfileForEngine`, and `resolveProfileForEngine`: resolve a decision-specific threshold profile for the engine that actually answered [thresholds.ts:thresholdProfileById], [thresholds.ts:thresholdProfileForEngine], [thresholds.ts:tryThresholdProfileForEngine], [thresholds.ts:resolveProfileForEngine].
- `selectWithEngineThresholds`: per-engine threshold filter, probability-descending stable ranking, optional cap, and selected/rejected id reporting [selection.ts:selectWithEngineThresholds].
- `runContextRelevanceShadow`: one-item-at-a-time shadow evaluation that journals attempts and returns kept/rejected items with `authority: "none"` [shadow.ts:runContextRelevanceShadow].
- `selectContextItems`: integration seam with `"off"`, `"shadow"`, and `"active"` modes; `"off"` is the default [selection-service.ts:selectContextItems].
- `toJevRelevanceRequest` and `fromJevRelevanceResponse`: map the sealed projection to one Noul question keyed `context-relevant` and validate the returned probability strictly [jev-mapping.ts:toJevRelevanceRequest], [jev-mapping.ts:fromJevRelevanceResponse].
- `CONTEXT_RELEVANCE_CORPUS` and `ContextRelevanceFixture`: labeled objective/item fixtures, including deliberate lexical-baseline false positives [corpus.ts:CONTEXT_RELEVANCE_CORPUS].

## Invariants
- Exactly one objective and one context item are projected per call; a whole dump is not a valid projection [projection.ts:ContextRelevanceInput].
- The item's local correlation id never enters the projected payload; only objective and item text cross [projection.ts:ContextRelevanceItemInput].
- Objective text is truncated to `MAX_OBJECTIVE_CHARS = 1_500` and item text to `MAX_ITEM_CHARS = 2_000`, with an ellipsis replacing the clipped tail [projection.ts:MAX_OBJECTIVE_CHARS], [projection.ts:MAX_ITEM_CHARS].
- Projection rejects an empty objective or empty item before any engine call [projection.ts:createContextRelevanceProjector].
- The local baseline returns probability zero when the objective has no content terms, so a meaningless objective selects nothing [local-baseline.ts:scoreRelevanceLocally].
- Seeded context-relevance profiles are `shadow`, not active; `thresholdProfileForEngine` throws rather than applying an uncalibrated threshold [thresholds.ts:CONTEXT_RELEVANCE_PROFILES], [thresholds.ts:thresholdProfileForEngine].
- A configured profile applies only when it belongs to the same engine and is active; otherwise resolution falls back to that engine's own active profile, so a fallback engine never inherits another engine's calibration [thresholds.ts:resolveProfileForEngine].
- Ranking is deterministic: probability descending with original index as the tie-breaker, followed by an optional item cap [selection.ts:selectWithEngineThresholds].
- Items no engine could score are kept rather than silently dropped, and the shadow result explicitly carries no execution authority [shadow.ts:runContextRelevanceShadow].
- Disabled context relevance returns the original items unchanged with no engine calls, and `selectContextItems` defaults to `"off"` identity behavior [shadow.ts:runContextRelevanceShadow], [selection-service.ts:selectContextItems].
- Jev mapping accepts only a finite Noul answer between 0 and 1; missing or out-of-range answers throw `MalformedResultError` instead of being coerced [jev-mapping.ts:fromJevRelevanceResponse].

## Side Effects
- The shadow runner invokes the configured decision engines through `executeWithFallback`; remote transport can occur only when the route and engine are enabled [shadow.ts:scoreItem].
- Journal records are appended through the optional `DecisionJournalStore` for every attempt [shadow.ts:runContextRelevanceShadow].
- Projection sealing produces a deterministic content hash used as the replay key; it performs no I/O itself [projection.ts:projectContextRelevance].
- The local baseline and selection functions perform no file, network, clock, or process I/O [local-baseline.ts:scoreRelevanceLocally], [selection.ts:selectWithEngineThresholds].

## Verification
- Run: `pnpm test`
