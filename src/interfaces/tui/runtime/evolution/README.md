# TUI Evolution Projection

## Overview

The TUI evolution-loop projection: a self-driven read model over canonical evolution artifacts (lifecycle registry, learning findings, forecasts, governance recommendations/decisions, capability measurements, correlations). It assembles one immutable snapshot per collector cycle for the workbench evolution surface. The projection is an association layer only — it never becomes a new domain store and never rewrites canonical identities.

The class is intentionally I/O-backed (fresh JSONL reads and an async learning recompute), so its `snapshot()` is async even though it registers structurally as a durable builder via `update`/`snapshot`/`reset` plus `exportState`/`importState`.

## Interface

- `EvolutionProjection` — the projection builder; `update` (no-op for session-scoped events), `ingestSessionless`, `snapshot`, `reset`, `exportState`, `importState` [evolution-projection.ts:EvolutionProjection]
- `EvolutionReadSources` — injected fresh-read sources for `lifecycle`, `forecasts`, `correlations`, `recommendations`, and a `learning.learn(now)` recompute [evolution-projection.ts:EvolutionReadSources]
- `EvolutionProjectionOptions` — `sources` plus an optional deterministic cycle `clock` [evolution-projection.ts:EvolutionProjectionOptions]
- `EvolutionProjectionState` — persisted dedup/measurement/proposal-target/learning state [evolution-projection.ts:EvolutionProjectionState]
- `NON_EVENTLOG_AUTHORITATIVE_STAGES` — `lifecycle | forecasts | correlations | decisions`, read from canonical artifacts rather than the EventLog [evolution-projection.ts:NON_EVENTLOG_AUTHORITATIVE_STAGES]
- `assembleEvolutionSnapshot(inputs)` — pure assembly of the immutable snapshot from stage inputs [evolution-snapshot-assembler.ts:assembleEvolutionSnapshot]
- `EvolutionAssemblerInputs` / `StageInput` / `MeasurementRecord` — assembler inputs and the projection's own measurement DTO [evolution-snapshot-assembler.ts:EvolutionAssemblerInputs] [evolution-snapshot-assembler.ts:StageInput] [evolution-snapshot-assembler.ts:MeasurementRecord]
- `learningCapabilityId(finding)` — maps a learning finding to its capability [evolution-snapshot-assembler.ts:learningCapabilityId]
- `buildEvolutionLinks(args)` — builds the reference-by-id link index [evolution-link-builder.ts:buildEvolutionLinks]
- `BuildEvolutionLinksArgs` — forecasts, recommendations, measurements, correlations, proposal targets [evolution-link-builder.ts:BuildEvolutionLinksArgs]
- Snapshot types: `EvolutionProjectionSnapshot`, `EvolutionStageName`, `StageStatus`, `StageState`, `CapabilitySpineEntry`, `EvolutionLink`, `EvolutionLinkKind`, `EvolutionNodeType`, and the row shapes (`LifecycleRow`, `ForecastRow`, `LearningPatternRow`, `DecisionRow`, `MeasurementRow`, `CorrelationRow`) [evolution-projection-snapshot.ts:EvolutionProjectionSnapshot] [evolution-projection-snapshot.ts:StageStatus] [evolution-projection-snapshot.ts:EvolutionLink]

## Invariants

- One snapshot carries a single `generatedAt` from the collector clock, flat stage states, a capability-rooted spine, and a reference-by-id link index — never per-stage timestamps [evolution-projection-snapshot.ts:EvolutionProjectionSnapshot]
- The six stages are fixed: `lifecycle | learning | forecasts | decisions | measurements | correlations` [evolution-projection-snapshot.ts:EvolutionStageName]
- `StageStatus` is `available | empty | unavailable`; `empty` (healthy source, zero artifacts) is distinct from `unavailable` (failed source) and there is no `stale` state in v1 [evolution-projection-snapshot.ts:StageStatus]
- `StageState.items` is ALWAYS empty when `status !== "available"` [evolution-projection-snapshot.ts:StageState]
- Links preserve many-to-many association and carry no causality in direction; a forecast→measurement edge is only emitted through a `Correlation` bridge [evolution-link-builder.ts:buildEvolutionLinks]
- `DecisionRow` is a projected view derived from an A2.5 recommendation via `recommendationKindToDecisionKind`; it is never an authoritative A3 record, and `projectedDecision`/`targetState` are null when the kind maps to no decision [evolution-snapshot-assembler.ts:toDecisionStage]
- `MeasurementRow` must not carry `proposalId`/`forecastId`/`correlationId`; the projection measurement keeps `eventId = String(event.seq)` as its dedup/restart marker [evolution-snapshot-assembler.ts:MeasurementRecord]
- Sessionless ingestion dedupes by `event.seq` against persisted `seenSeqs`, so restart never re-applies relayed events [evolution-projection.ts:EvolutionProjection]
- `update()` deliberately consumes nothing (governance/measurement events are sessionless, delivered through the relay) [evolution-projection.ts:EvolutionProjection]
- `snapshot()` never throws; a failed source becomes an `unavailable` stage, and a failed learning recompute marks learning `unavailable` while retaining `lastSuccessful` [evolution-projection.ts:EvolutionProjection]
- Lifecycle, forecasts, correlations, and decisions are read from canonical persisted artifacts, not the EventLog [evolution-projection.ts:NON_EVENTLOG_AUTHORITATIVE_STAGES]
- The spine unions capability ids from lifecycle, forecast subjects, measurement capabilities, and proposal targets, sorted for stable ordering [evolution-snapshot-assembler.ts:collectCapabilityIds]

## Side Effects

- `EvolutionProjection.snapshot()` performs async fresh reads of all persisted sources (forecasts/correlations/recommendations JSONL plus lifecycle) and may run an async learning recompute [evolution-projection.ts:EvolutionProjection]
- The cycle clock defaults to `Date.now()` when no deterministic clock is injected [evolution-projection.ts:EvolutionProjection]
- `exportState`/`importState` round-trip the durable dedup, measurement, proposal-target, and learning state [evolution-projection.ts:EvolutionProjection]
- ["None"] for network, disk writes, or locks — assembly is pure and the projection only reads its injected sources [evolution-snapshot-assembler.ts:assembleEvolutionSnapshot]

## Verification

- Run: `pnpm test`
