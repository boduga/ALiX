# Pre-Execution Risk Forecast (A9)

## Overview
A9 forecasts pre-execution governance risk. Deterministic, read-only adapters project raw proposal, measurement, and enriched-proposal evidence into risk detectors; each detector emits `DetectorFinding` records that the builder aggregates into a content-addressed `Forecast`. A separate correlation slice links forecasts to later measurements through a strict two-hop bridge, an append-only JSONL store persists forecasts and correlations, and a bridge maps forecast bands onto A2.5 `GovernanceRecommendation` kinds for the A3 decision path.

## Interface
- `Forecast`, `ForecastContent`, `ForecastKind`, `RiskBand`, `ForecastId` — forecast artifact and its content-addressed identity `[contracts/contract.ts:Forecast]`
- `Correlation`, `CorrelationContent`, `CorrelationId` — forecast ⇄ measurement pair artifact `[contracts/contract.ts:Correlation]`
- `ProposalEventRecord`, `CapabilityMeasurementRecord`, `EnrichedProposalRecord`, `DetectorFinding`, `ForecastAdapter` — raw adapter and detector shapes `[contracts/contract.ts:ProposalEventRecord]`
- `FORECAST_VERSION`, `CORRELATION_VERSION`, `GENERATOR_VERSION`, `FORECAST_HORIZON_DAYS` — locked version and horizon constants `[contracts/contract.ts:FORECAST_VERSION]`
- `canonicalizeForecast`, `forecastIdFor`, `canonicalizeCorrelation`, `correlationIdFor` — canonical JSON and SHA-256 identity `[identity.ts:forecastIdFor]`
- `RISK_BAND_THRESHOLDS`, `internalScoreToBand` — locked band projection `[risk-band.ts:RISK_BAND_THRESHOLDS]`
- `clamp01`, `assertUnitInterval` — shared numeric helpers `[scale.ts:assertUnitInterval]`
- `readCandidateTargetId` — canonical `payload.candidate.target.id` accessor `[bridge-target.ts:readCandidateTargetId]`
- `buildForecast` — aggregate findings into one forecast `[forecast-builder.ts:buildForecast]`
- `ForecastEngine`, `ForecastEngineAdapters`, `ForecastRunDetail` — detector orchestration with per-detector isolation `[forecast-engine.ts:ForecastEngine]`
- `JsonlStore`, `JsonlStoreConfig` — shared append-only, content-addressed JSONL persistence `[jsonl-store.ts:JsonlStore]`
- `ForecastsStore`, `forecastContentOf` — `.alix/governance/forecasts.jsonl` store `[forecasts-store.ts:ForecastsStore]`
- `CorrelationsStore`, `correlationContentOf` — `.alix/governance/correlations.jsonl` store `[correlations-store.ts:CorrelationsStore]`
- `ForecastsAdapter` — read-only queries by proposal, capability, and validity window `[forecasts-adapter.ts:ForecastsAdapter]`
- `CorrelationsAdapter` — read-only queries by forecast and measurement `[correlations-adapter.ts:CorrelationsAdapter]`
- `buildCorrelation`, `measurementOutcomeToBand` — correlation construction and outcome-to-band projection `[correlation-builder.ts:buildCorrelation]`
- `CorrelationEngine`, `CorrelationEngineDependencies` — measurement-arrival-driven two-hop correlation `[correlation-engine.ts:CorrelationEngine]`
- `buildGovernanceRecommendation`, `forecastBandToRecommendationKind` — A2.5 bridge from forecast band to recommendation kind `[bridge.ts:buildGovernanceRecommendation]`
- `runForecastCli`, `recommendationToDecision`, `RunForecastCliOpts`, `ForecastCliResult`, `DecisionSurface` — CLI compose/persist/bridge surface `[forecast-cli.ts:runForecastCli]`
- Adapters: [./adapters/README.md](./adapters/README.md) — read-only proposal, measurement, and enriched-proposal projections
- Detectors: [./detectors/README.md](./detectors/README.md) — pure trust-velocity, evidence-completeness, and fingerprint-coincidence scoring

## Invariants
- Forecast artifacts are content-addressed by SHA-256 over canonical content excluding `forecastId`; `generatedAt` is identity-bearing `[contracts/contract.ts:ForecastContent]`
- Forecast and correlation contracts must not carry `primary`, `correlationStatus`, or other correlation semantics `[contracts/contract.ts:Forecast]`
- Measurement records must not expose `proposalId`, `sourceProposalIds`, `forecastId`, or `correlationId` `[contracts/contract.ts:CapabilityMeasurementRecord]`
- `internalScoreToBand` uses locked thresholds low `[0,0.3)`, medium `[0.3,0.6)`, high `[0.6,0.85)`, critical `[0.85,1]` and throws `RangeError` for non-finite or out-of-range scores `[risk-band.ts:internalScoreToBand]`
- `buildForecast` rejects empty finding sets and mismatched subjects, takes the max-score finding (kind tie-break ascending), weights confidence by internal score, and dedupes evidence refs in encounter order `[forecast-builder.ts:buildForecast]`
- The forecast horizon spans `generatedAt` plus `FORECAST_HORIZON_DAYS` (30) days `[forecast-builder.ts:buildForecast]`
- `ForecastEngine.forecast` throws when any detector fails, while `forecastDetailed` isolates failures into `detectorFailures` and still runs the other detectors `[forecast-engine.ts:forecastDetailed]`
- No findings produces an empty forecast set; an empty artifact is never built `[forecast-engine.ts:forecastDetailed]`
- JSONL append is atomic via temp file + `rename`; a corrupt line is skipped on read and preserved on later appends `[jsonl-store.ts:JsonlStore]`
- Appending an identical id and content is a no-op returning `false`; different content under the same id throws a fatal identity collision `[jsonl-store.ts:append]`
- `findValidAt` treats the horizon inclusively and throws on an unparseable query timestamp while excluding unparseable stored horizons `[forecasts-adapter.ts:findValidAt]`
- Correlation authorization is a strict two-hop bridge: matching `payload.candidate.target.id`, a required `proposal.executed`, no `proposal.rejected`, and an inclusive measurement horizon; mismatches are never repaired `[correlation-engine.ts:CorrelationEngine]`
- Measurement outcome maps deterministically to an observed band: `effective` → low, `inconclusive` → medium, `ineffective` → critical `[correlation-builder.ts:measurementOutcomeToBand]`
- Correlation identity covers forecast id, measurement id, foreign provenance, and resolution; the timestamp argument is not identity-bearing `[correlation-builder.ts:buildCorrelation]`
- Correlation output is sorted by `forecastId` then `measurementId`, and one independent correlation is emitted per qualifying pair `[correlation-engine.ts:CorrelationEngine]`
- Band mapping is `low`/`medium` → `MONITOR` and `high`/`critical` → `RISK_GATED_REVIEW`, which A3 maps to `REQUEST_MORE_EVIDENCE` `[bridge.ts:forecastBandToRecommendationKind]`
- `recommendationId` is `a9-rec:<forecastId>` and `evidenceId` is a SHA-256 digest of sorted evidence refs, so identical forecasts produce identical recommendations `[bridge.ts:buildGovernanceRecommendation]`
- CLI run: adapter failure yields a warning and empty source, a detector failure with zero findings exits `1`, and a JSONL write failure exits `1` without claiming persistence `[forecast-cli.ts:runForecastCli]`
- `--dimension` filters output to one `ForecastKind` `[forecast-cli.ts:runForecastCli]`

## Side Effects
- Appends forecasts to `.alix/governance/forecasts.jsonl` `[forecasts-store.ts:ForecastsStore]`
- Appends correlations to `.alix/governance/correlations.jsonl` `[correlations-store.ts:CorrelationsStore]`
- Creates the store directory and writes a fsynced temp file before renaming `[jsonl-store.ts:append]`
- Reads the EventLog via `readAll()` through the proposal and measurement adapters `[adapters/proposal-events-adapter.ts:ProposalEventsAdapter]`
- Reads adaptation proposal, effectiveness, and security stores through the enriched-proposals source `[adapters/enriched-proposals-source.ts:createEnrichedProposalsSource]`
- Prints forecast, recommendation, and A3 decision output to the operator CLI `[forecast-cli.ts:runForecastCli]`

## Verification
- Run: `pnpm test`
