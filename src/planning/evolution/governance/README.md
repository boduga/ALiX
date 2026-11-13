# Governance Decisions (A3)

## Overview
Turns A2 verification evidence and an optional A2.5 recommendation into a binding, hash-sealed `GovernanceDecision`, persists it, and drives the evolution lifecycle to `APPROVED`, `REJECTED`, or `UNDER_REVIEW`. Decision generation is pure and policy-driven; persistence is append-only and in-memory; the bridge owns the store-then-transition ordering. A CLI command (`alix governance evolution decide`) composes the engine, the recommendation store, and the bridge.

## Interface
- `GovernanceDecisionKind` (`APPROVE` | `REJECT` | `MONITOR` | `REQUEST_MORE_EVIDENCE`) and `VALID_GOVERNANCE_DECISION_KINDS` `[contracts/decision-contract.ts:GovernanceDecisionKind]` `[contracts/decision-contract.ts:VALID_GOVERNANCE_DECISION_KINDS]`.
- `GovernancePolicyConfig` — confidence thresholds, regression limit, escalation behavior, fail-closed flag, reproducibility floor, and optional risk-class overrides `[contracts/decision-contract.ts:GovernancePolicyConfig]`; `DEFAULT_GOVERNANCE_POLICY` sets approve `0.8`, monitor `0.5`, reject `0.3`, zero regressions, `request_evidence`, fail-closed, reproducibility `2` `[contracts/decision-contract.ts:DEFAULT_GOVERNANCE_POLICY]`.
- `GovernanceDecision` — immutable decision record including `decisionId` (`govd-` prefix), policy snapshot, recommendation tracking, and `integrityHash` `[contracts/decision-contract.ts:GovernanceDecision]`.
- `validateGovernanceDecision()` and `validateGovernancePolicyConfig()` — structural validators `[contracts/decision-contract.ts:validateGovernanceDecision]` `[contracts/decision-contract.ts:validateGovernancePolicyConfig]`.
- `GovernanceDecisionStore` interface with `store()`, `get()`, `listByProposal()`, `listByEvolution()` `[contracts/decision-store-contract.ts:GovernanceDecisionStore]`; `InMemoryGovernanceDecisionStore` implements it `[decision-store.ts:InMemoryGovernanceDecisionStore]`; `DecisionNotFoundError` and `DuplicateDecisionError` are its error types `[contracts/decision-store-contract.ts:DecisionNotFoundError]` `[contracts/decision-store-contract.ts:DuplicateDecisionError]`.
- `generateDecision(evidence, recommendation?, options?)` — pure policy evaluation `[decision-engine.ts:generateDecision]`; `DecisionConfig` supplies policy override and evolution id `[decision-engine.ts:DecisionConfig]`.
- `recommendationKindToDecisionKind(kind)` — maps A2.5 kinds (`APPROVE`, `MONITOR`, `REQUEST_ADDITIONAL_EVIDENCE`, `REJECT`, `RISK_GATED_REVIEW`); `ESCALATE` maps to `undefined` `[decision-engine.ts:recommendationKindToDecisionKind]` `[decision-engine.ts:RECOMMENDATION_KIND_MAP]`.
- `decisionKindToTargetState(kind)` — `APPROVE`→`APPROVED`, `REJECT`→`REJECTED`, `MONITOR`/`REQUEST_MORE_EVIDENCE`→`UNDER_REVIEW` `[decision-engine.ts:decisionKindToTargetState]`.
- `computeDecisionIntegrityHash(decision)` — SHA-256 over `alix-governance-decision-v1:` plus canonical JSON `[decision-engine.ts:computeDecisionIntegrityHash]`.
- `GovernanceDecisionBridge` and `GovernanceDecisionBridgeResult` — persist, transition, emit `[governance-decision-bridge.ts:GovernanceDecisionBridge]` `[governance-decision-bridge.ts:GovernanceDecisionBridgeResult]`.
- `runDecide(deps, evolutionId, jsonMode, args)` and `DecideDeps` — CLI composition root supporting `--policy` `[governance-decision-cli.ts:runDecide]` `[governance-decision-cli.ts:DecideDeps]`.
- Barrel re-exports contracts, store, engine, and bridge `[index.ts]`.
- Contract subpackage `contracts/` holds the decision and decision-store type contracts: [./contracts/README.md](./contracts/README.md).

## Invariants
- Decision evaluation order is fixed: expired evidence, then low confidence, then excess regressions, then low reproducibility, then approve, monitor, ESCALATE handling, and finally `REQUEST_MORE_EVIDENCE` `[decision-engine.ts:generateDecision]`.
- Expired evidence rejects when `failClosedOnExpiredEvidence` is true and monitors otherwise `[decision-engine.ts:generateDecision]`.
- `decisionId` is `govd-` plus the first 16 hex chars of SHA-256 over `evidenceId` and the canonical policy config, so different policies yield different ids `[decision-engine.ts:computeDecisionId]`.
- `policySnapshot` is a structured clone captured at decision time; `integrityHash` covers every field except itself and undefined values `[decision-engine.ts:buildDecision]` `[decision-engine.ts:computeDecisionIntegrityHash]`.
- Stored decisions are append-only: duplicate `decisionId` throws, and reads return deep clones `[decision-store.ts:InMemoryGovernanceDecisionStore]`.
- The bridge persists the decision BEFORE attempting any lifecycle transition `[governance-decision-bridge.ts:execute]`.
- A transition error is captured in `error` rather than thrown; a failed evidence emission does not roll back the transition `[governance-decision-bridge.ts:execute]`.
- `runDecide` requires the evolution to be `UNDER_REVIEW` and at least one evidence record, and fails the command if recommendation persistence fails `[governance-decision-cli.ts:runDecide]`.
- Only the `default` policy name resolves; unrecognized names fall back to the default policy `[governance-decision-cli.ts:resolvePolicyConfig]`.

## Side Effects
- Writes a decision into the in-memory store and transitions the evolution state machine `[governance-decision-bridge.ts:execute]`.
- Emits an evolution transition event through the optional evidence bridge `[governance-decision-bridge.ts:execute]`.
- Appends the A2.5 recommendation to its store and surfaces persistence failures `[governance-decision-cli.ts:runDecide]`.
- Writes JSON or ANSI-colored output to stdout and sets `process.exitCode = 1` on failure `[governance-decision-cli.ts:runDecide]` `[governance-decision-cli.ts:renderDecisionResult]`.
- Mutates the incoming args array by splicing out `--policy` and its value `[governance-decision-cli.ts:extractPolicyFlag]`.
- No network access and no durable disk writes in this package.

## Verification
- Run: `pnpm test`
