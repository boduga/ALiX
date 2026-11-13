# Forecast Contracts

## Overview
A9 pre-execution risk forecast type contract. `contract.ts` declares the content-addressed `Forecast` and `Correlation` artifacts, the three locked forecast kinds, the risk band vocabulary, the raw read-only adapter records, the pure detector finding shape, and the version constants. The module is types and constants only: no persistence, no correlation logic, no CLI, and no write path.

## Interface
- `ForecastId` and `CorrelationId` are content-addressed SHA-256 hex identity strings `[contract.ts:ForecastId]` `[contract.ts:CorrelationId]`.
- `ForecastKind` is the locked closed set `trust-velocity`, `evidence-completeness`, `fingerprint-coincidence` `[contract.ts:ForecastKind]`.
- `RiskBand` is the locked closed set `low`, `medium`, `high`, `critical` `[contract.ts:RiskBand]`.
- `Forecast` carries `forecastId`, `forecastVersion`, `subject`, `subjectCapability`, `prediction`, `horizon`, `confidence`, and `provenance` `[contract.ts:Forecast]`.
- `ForecastContent` is `Omit<Forecast, "forecastId">`, the canonical identity input `[contract.ts:ForecastContent]`.
- `Correlation` pairs one `forecastId` with one `measurementId` and carries `foreignProvenance` and `resolution` `[contract.ts:Correlation]`.
- `CorrelationContent` is `Omit<Correlation, "correlationId">` `[contract.ts:CorrelationContent]`.
- `ProposalEventRecord`, `CapabilityMeasurementRecord`, and `EnrichedProposalRecord` are the three raw adapter output records `[contract.ts:ProposalEventRecord]` `[contract.ts:CapabilityMeasurementRecord]` `[contract.ts:EnrichedProposalRecord]`.
- `DetectorFinding` is the detector output shape `[contract.ts:DetectorFinding]`.
- `ForecastAdapter<T>` is the read-only adapter contract with `name` and `list()` `[contract.ts:ForecastAdapter]`.
- `FORECAST_VERSION`, `CORRELATION_VERSION`, `GENERATOR_VERSION`, and `FORECAST_HORIZON_DAYS` are the version/horizon constants `[contract.ts:FORECAST_VERSION]` `[contract.ts:CORRELATION_VERSION]` `[contract.ts:GENERATOR_VERSION]` `[contract.ts:FORECAST_HORIZON_DAYS]`.
- No child contract directories exist.

## Invariants
- `Forecast` and `Correlation` do not carry `primary`, `correlationStatus`, or correlation semantics; the forecast layer is correlation-free `[contract.ts:Forecast]` `[contract.ts:Correlation]`.
- `Correlation` forbids `primary`, `terminal`, `resolved`, `attempted`, and `correlationStatus`; one correlation exists per `(forecastId, measurementId)` pair with no group artifact `[contract.ts:Correlation]`.
- `CapabilityMeasurementRecord` exposes no `proposalId`, `sourceProposalIds`, `forecastId`, or `correlationId` `[contract.ts:CapabilityMeasurementRecord]`.
- `ForecastContent` structurally excludes `forecastId` from identity canonicalization `[contract.ts:ForecastContent]`.
- `Correlation.foreignProvenance.proposalId` is the forecast subject, never a measurement-carried proposal id `[contract.ts:Correlation]`.
- `ProposalEventRecord.payload` is preserved verbatim and its `capabilityId` is populated only for `proposal.submitted`, empty otherwise `[contract.ts:ProposalEventRecord]`.
- `ProposalEventRecord.kind` is the closed five-member proposal lifecycle set `[contract.ts:ProposalEventRecord]`.
- `EnrichedProposalRecord.sourceConfidence` is documented as finite in `[0,1]` with 0 when absent `[contract.ts:EnrichedProposalRecord]`.
- `DetectorFinding.internalScore` and `confidence` are documented as `[0,1]` `[contract.ts:DetectorFinding]`.
- `ForecastAdapter.list()` is the only adapter method; adapters never write and joins belong above the adapter boundary `[contract.ts:ForecastAdapter]`.
- Risk band thresholds are stated as `[0.0,0.3)` low, `[0.3,0.6)` medium, `[0.6,0.85)` high, `[0.85,1.0]` critical, with the executable thresholds living in `risk-band.ts` `[contract.ts:RiskBand]`.
- `FORECAST_HORIZON_DAYS` is the default forecast validity horizon of 30 days `[contract.ts:FORECAST_HORIZON_DAYS]`.

## Side Effects
- ["None"]

## Verification
- Run: `pnpm test`
