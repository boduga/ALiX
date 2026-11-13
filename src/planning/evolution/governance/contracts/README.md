# Governance Decision Contracts

## Overview

Type and interface contracts for the A3 governance decision layer: the binding outcome of governance review over an evolution proposal, its policy parameterization, and the append-only store that persists decisions. These modules are pure types plus pure validators — no I/O, no store access. Concrete decision evaluation lives in `../decision-engine.ts`; persistence lives in `../decision-store.ts`.

## Interface

- `GovernanceDecisionKind` — the four decision kinds `APPROVE | REJECT | MONITOR | REQUEST_MORE_EVIDENCE` [decision-contract.ts:GovernanceDecisionKind]
- `VALID_GOVERNANCE_DECISION_KINDS` — runtime list of those four kinds [decision-contract.ts:VALID_GOVERNANCE_DECISION_KINDS]
- `GovernancePolicyConfig` — policy parameterization (confidence thresholds, regression budget, escalate behavior, reproducibility floor, optional `riskClassOverrides`) [decision-contract.ts:GovernancePolicyConfig]
- `DEFAULT_GOVERNANCE_POLICY` — conservative defaults: approve ≥ 0.8, monitor ≥ 0.5, reject < 0.3, zero regressions, fail-closed on expired evidence, reproducibility ≥ 2 [decision-contract.ts:DEFAULT_GOVERNANCE_POLICY]
- `GovernanceDecision` — immutable decision record with proposal/evolution ids, `kind`, epistemic `confidence`, `reasoning`, `risks`, `evidenceId`, recommendation-following flags, captured `policySnapshot`, `targetState`, `decidedAt`, `decidedBy`, optional `integrityHash` [decision-contract.ts:GovernanceDecision]
- `isValidGovernanceDecisionKind(v)` — kind membership guard [decision-contract.ts:isValidGovernanceDecisionKind]
- `validateGovernanceDecision(value)` — structural validation producing a `ValidationResult` [decision-contract.ts:validateGovernanceDecision]
- `validateGovernancePolicyConfig(value)` — structural + threshold-ordering validation for a policy config [decision-contract.ts:validateGovernancePolicyConfig]
- `DecisionNotFoundError` / `DuplicateDecisionError` — typed store errors carrying `kind` and `decisionId` [decision-store-contract.ts:DecisionNotFoundError] [decision-store-contract.ts:DuplicateDecisionError]
- `GovernanceDecisionStore` — append-only store interface: `store`, `get`, `listByProposal`, `listByEvolution` [decision-store-contract.ts:GovernanceDecisionStore]

## Invariants

- Exactly four decision kinds exist; `ESCALATE` is a decision path, not a kind [decision-contract.ts:GovernanceDecisionKind]
- `decisionId` must carry the `govd-` prefix [decision-contract.ts:validateGovernanceDecision]
- `confidence` is epistemic and must be a finite number in `[0, 1]` [decision-contract.ts:validateGovernanceDecision]
- Policy thresholds must satisfy `rejectConfidenceThreshold < minMonitorConfidence < minApproveConfidence` [decision-contract.ts:validateGovernancePolicyConfig]
- `maxAllowedRegressions` must be a non-negative integer and `minReproducibilityLevel` a positive integer [decision-contract.ts:validateGovernancePolicyConfig]
- `policySnapshot` is captured at decision time and immutable within the decision, so past decisions stay interpretable after policy changes [decision-contract.ts:GovernanceDecision]
- `targetState` is one of `APPROVED | REJECTED | UNDER_REVIEW` and `decidedBy` one of `operator | governance_policy | auto_escalation` [decision-contract.ts:validateGovernanceDecision]
- A stored decision is never modified or deleted; storing a duplicate `decisionId` raises `DuplicateDecisionError` [decision-store-contract.ts:GovernanceDecisionStore] [decision-store-contract.ts:DuplicateDecisionError]
- Store reads return defensive deep copies, and `get` on a missing id raises `DecisionNotFoundError` [decision-store-contract.ts:GovernanceDecisionStore]
- `listByProposal`/`listByEvolution` return an empty array when no decisions match [decision-store-contract.ts:GovernanceDecisionStore]
- Validators are pure: no side effects, no I/O, no store access [decision-contract.ts:validateGovernanceDecision] [decision-contract.ts:validateGovernancePolicyConfig]

## Side Effects

- ["None"] — these modules define types, constants, guards, and pure validators; they perform no I/O, mutation, locking, or network access [decision-contract.ts:validateGovernanceDecision] [decision-store-contract.ts:GovernanceDecisionStore]

## Verification

- Run: `pnpm test`
