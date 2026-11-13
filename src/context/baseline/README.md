# Baseline Intelligence

## Overview
Subsystem health baseline framework built around sensor providers, structured artifacts, framework-owned comparison, and normalized health scoring. Providers capture data; the registry and numeric comparator interpret it consistently.

## Interface
- `BaselineSubsystem`, `ProviderState`, `BaselineArtifact`, `DriftItem`, and `BaselineComparison` [baseline-types.ts:BaselineArtifact]
- `BaselineProvider` with `captureBaseline()`, `captureCurrent()`, and provider metadata [baseline-provider.ts:BaselineProvider]
- `BaselineComparator` and `NumericComparator` [baseline-comparator.ts:NumericComparator]
- `computeHealthScore(drift, weights?)` [health-score.ts:computeHealthScore]
- `BaselineRegistry` with registration, discovery, description, `runOne()`, and `runAll()` [baseline-registry.ts:BaselineRegistry]
- `createDefaultBaselineRegistry()` with built-in subsystem sensors [baseline-registry.ts:createDefaultBaselineRegistry]
- Baseline providers: [./providers/README.md](./providers/README.md) documents the concrete subsystem sensors.

## Invariants
- Providers are sensors only; comparison, scoring, and recommendations belong to the framework [baseline-provider.ts:BaselineProvider]
- Registry registration is exclusive per subsystem and unknown lookups throw rather than returning a placeholder [baseline-registry.ts:register]
- `runOne()` captures baseline and current concurrently, then delegates comparison to the shared comparator [baseline-registry.ts:runOne]
- Numeric comparison examines numeric artifact fields, derives absolute delta, classifies relative drift severity, and sorts critical/high items first [baseline-comparator.ts:buildDriftItems]
- Empty drift scores 100/excellent; otherwise per-metric retention is weighted, averaged, rounded, and banded at 90/70/40 [health-score.ts:computeHealthScore]
- Default registry construction registers exactly one provider per built-in subsystem [baseline-registry.ts:createDefaultBaselineRegistry]

## Side Effects
- Provider captures read subsystem state, including `.alix` stores, through the provider implementations rather than this framework layer [baseline-registry.ts:runOne]
- Registry and comparator operations perform no writes or network calls themselves [baseline-registry.ts:runAll]

## Verification
- Run: `pnpm test`
