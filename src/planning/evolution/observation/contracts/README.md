# Observation Contracts

## Overview
Defines the A5.1 observation vocabulary shared by the observation engine and its providers: what to measure (`Observation`), what was measured (`ObservationResult`), and how a provider is registered and invoked (`ObservationProvider`). The module also supplies structural validators for observation definitions and results.

## Interface
- `ObservationStatus` and `VALID_OBSERVATION_STATUSES`: the accepted result statuses `pass`, `fail`, `error`, and `inconclusive` [observation-contract.ts:ObservationStatus] [observation-contract.ts:VALID_OBSERVATION_STATUSES].
- `Observation`: definition carrying `observationId`, provider routing key, description, optional expected value, and provider parameters [observation-contract.ts:Observation].
- `ObservationResult`: measurement record carrying the originating id, status, measurement confidence, ISO timestamp, optional expected/observed values, and raw evidence [observation-contract.ts:ObservationResult].
- `ObservationProvider`: provider contract with `name`, discovery capabilities, optional `canObserve`, and async `observe` [observation-contract.ts:ObservationProvider].
- `validateObservation(value)` and `validateObservationResult(value)` return `ValidationResult` with accumulated error strings [observation-contract.ts:validateObservation] [observation-contract.ts:validateObservationResult].

## Invariants
- An observation requires non-empty `observationId`, `provider`, and `description` [observation-contract.ts:validateObservation].
- A result requires non-empty `observationId` and `observedAt`, a status from `VALID_OBSERVATION_STATUSES`, confidence in the inclusive range 0–1, and a non-null, non-array `evidence` object [observation-contract.ts:validateObservationResult].
- `ObservationResult.confidence` describes confidence in that measurement, not provider-level reliability [observation-contract.ts:ObservationResult].
- `ObservationProvider.canObserve` is a validation guard, not runtime dispatch; `Observation.provider` is the routing key and must match a registered provider name [observation-contract.ts:ObservationProvider] [observation-contract.ts:Observation].
- Provider implementations must never throw and must not mutate the system while observing [observation-contract.ts:ObservationProvider].

## Side Effects
- None. This module declares types, constants, and pure validation helpers; provider implementations own any measurement effects.

## Verification
- Run: `pnpm test`
