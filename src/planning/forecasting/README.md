# Health Forecasting Engine

## Overview
Deterministic P11.5 forecasting pipeline that projects per-subsystem health scores. `ForecastingEngine` loads the latest strategic plan, an optional confidence model, and score history, then calls the pure `buildHealthForecast` function to produce a `HealthForecast` with damped per-window projections, confidence intervals, and confidence-bucket metadata. The result is persisted append-only to a JSONL store. No LLM and no probabilistic inference are involved.

## Interface
- `ScoreProjection` — one subsystem's current score, forward `projectedScores`, aligned `lowerBound`/`upperBound`, `forecastConfidence`, `observedDeltaPerWindow`, and `observationCount` `[forecasting-types.ts:ScoreProjection]`.
- `HealthForecast` — `schemaVersion: "p11.5.0"`, `forecastId`, `generatedAt`, optional `sourceConfidenceModelId`, `sourcePlanId`, `rootCauseAnalysisId`, `correlationGraphId`, `projections`, `forecastWindows`, `windowDurationMs`, and `meta` bucket counts `[forecasting-types.ts:HealthForecast]`.
- `ForecastingEngineConfig` / `ForecastingObservationContext` / `HealthForecastSummary` — configuration, injected `generatedAt` context, and list-projection type `[forecasting-types.ts:ForecastingEngineConfig]`.
- `ForecasterError` — error class with code `FORECASTER_ERROR` `[forecasting-types.ts:ForecasterError]`.
- `DEFAULT_FORECASTING_CONFIG` — 3 forecast windows, trend window 5, dampening 0.3, 7-day window, thresholds 0.7/0.4 `[forecasting-config.ts:DEFAULT_FORECASTING_CONFIG]`.
- `buildHealthForecast(plan, confidenceModel, scoreHistory, currentScores, context, config?)` — pure forecast constructor `[build-health-forecast.ts:buildHealthForecast]`.
- `ForecastingEngine` with `run()` and `loadLatestForecast()` `[forecasting-engine.ts:ForecastingEngine]`.
- `HealthForecastStore` with `save`, `loadLatest`, `loadById`, and `list` `[health-forecast-store.ts:HealthForecastStore]`.
- `validateForecast(raw)` — structural validator returning a typed forecast or throwing `ForecasterError` `[health-forecast-store.ts:validateForecast]`.
- `V1ScoreSnapshotAdapter` — stub `ScoreSnapshotProvider` that returns empty maps `[score-snapshot-adapter.ts:V1ScoreSnapshotAdapter]`.

## Invariants
- `buildHealthForecast` requires `plan.schemaVersion === "p11.3.0"`, non-empty `planId`/`generatedAt`, and an ISO-8601 `context.generatedAt`, else it throws `ForecasterError` `[build-health-forecast.ts:buildHealthForecast]`.
- Config validation requires 1–3 forecast windows, `trendWindow >= 2`, dampening in 0–1, `windowDurationMs > 0`, and `highConfidenceThreshold > mediumConfidenceThreshold` within 0–1 `[build-health-forecast.ts:validateConfig]`.
- A confidence model whose `sourcePlanId` does not match the plan is ignored with a warning and confidence falls back to 0.5 `[build-health-forecast.ts:buildHealthForecast]`.
- Current-score resolution order is `currentScores` → last history value → active plan objective `currentScore` → skip the subsystem `[build-health-forecast.ts:buildHealthForecast]`.
- When no subsystem has a resolvable current score, an empty forecast with zeroed `meta` is returned rather than throwing `[build-health-forecast.ts:buildEmptyForecast]`.
- Trend is `(last - first) / (n - 1)` over the trailing `trendWindow` history entries, and `0` when fewer than two points exist `[build-health-forecast.ts:buildHealthForecast]`.
- Per-subsystem confidence is the rounded (3 dp) mean of finite `resultingConfidence` updates, else `0.5` `[build-health-forecast.ts:buildHealthForecast]`.
- Projections damp toward `DEFAULT_MEAN_SCORE = 80` by `dampeningFactor * (w + 1) / forecastWindows` and clamp to 0–100 `[build-health-forecast.ts:buildHealthForecast]`.
- Interval spread is `(1 - confidence) * 15`, growing by `1 + w * 0.2` per window and clamped to 0–100 `[build-health-forecast.ts:buildHealthForecast]`.
- `forecastId` is `"forecast-" + sanitizeTimestamp(generatedAt)` `[build-health-forecast.ts:buildHealthForecast]`.
- Meta buckets count forecasts at or above the high threshold, between medium and high, and below medium `[build-health-forecast.ts:buildHealthForecast]`.
- `validateForecast` enforces schema `p11.5.0`, non-empty IDs, ISO `generatedAt`, 1–3 windows, the eight valid subsystem ids, score/confidence ranges 0–100 / 0–1, and array lengths equal to `forecastWindows` `[health-forecast-store.ts:validateForecast]`.
- `ForecastingEngine.run()` throws `ForecasterError` when no strategic plan is available `[forecasting-engine.ts:ForecastingEngine]`.
- `loadLatest` returns `null` on a missing file, an empty file, or a corrupted last line (warning logged for `ForecasterError`) `[health-forecast-store.ts:loadLatest]`.

## Side Effects
- `HealthForecastStore.save` validates the forecast, creates the store directory when absent, and appends one JSON line to `health-forecasts.jsonl` `[health-forecast-store.ts:save]`.
- `HealthForecastStore.loadLatest` / `loadById` / `list` read the JSONL file from disk and skip malformed lines `[health-forecast-store.ts:list]`.
- `ForecastingEngine.run()` calls `scoreSnapshotProvider.loadScoresAt` once per trailing window to assemble history `[forecasting-engine.ts:ForecastingEngine]`.
- `ForecastingEngine.run()` persists the forecast through `healthForecastStore.save` `[forecasting-engine.ts:ForecastingEngine]`.
- `buildHealthForecast` performs no I/O and reads no clock or randomness; `generatedAt` is injected `[build-health-forecast.ts:buildHealthForecast]`.
- A plan/confidence-model mismatch writes a `console.warn` `[build-health-forecast.ts:buildHealthForecast]`.

## Verification
- Run: `pnpm test`
