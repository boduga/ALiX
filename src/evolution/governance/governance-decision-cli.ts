// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A3 — Governance Decision CLI.
 *
 * CLI handler for the `alix governance evolution decide` command.
 * Validates evolution state, retrieves A2 evidence, optionally generates
 * A2.5 recommendations, produces a binding GovernanceDecision, and
 * executes it through the GovernanceDecisionBridge.
 *
 * @module governance-decision-cli
 */

import type { VerificationEvidenceLedger } from "../verification/evidence/evidence-ledger.js";
import type { GovernanceDecisionBridge, GovernanceDecisionBridgeResult } from "./governance-decision-bridge.js";
import type { GovernancePolicyConfig, GovernanceDecision, GovernanceDecisionKind } from "./contracts/decision-contract.js";
import { DEFAULT_GOVERNANCE_POLICY } from "./contracts/decision-contract.js";
import { generateDecision } from "./decision-engine.js";
import { RecommendationEngine, DEFAULT_RECOMMENDATION_CONFIG } from "../verification/recommendation/recommendation-engine.js";
import type { EvolutionStateMachine } from "../../evolution/evolution-state-machine.js";
import { EvolutionState } from "../../evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// DecideDeps
// ---------------------------------------------------------------------------

/**
 * Dependencies for the governance decision CLI command.
 *
 * @property stateMachine - Evolution lifecycle state machine (validates state).
 * @property evidenceLedger - A2 verification evidence ledger (retrieves evidence).
 * @property decisionBridge - A3 governance decision bridge (executes decisions).
 * @property policyConfig - Optional policy config override (defaults to DEFAULT_GOVERNANCE_POLICY).
 */
export interface DecideDeps {
  stateMachine: EvolutionStateMachine;
  evidenceLedger: VerificationEvidenceLedger;
  decisionBridge: GovernanceDecisionBridge;
  policyConfig?: GovernancePolicyConfig;
}

// ---------------------------------------------------------------------------
// ANSI helpers (mirrors evolution-cli.ts pattern)
// ---------------------------------------------------------------------------

function red(msg: string): string {
  return `\x1b[31m${msg}\x1b[0m`;
}

function green(msg: string): string {
  return `\x1b[32m${msg}\x1b[0m`;
}

function yellow(msg: string): string {
  return `\x1b[33m${msg}\x1b[0m`;
}

function bold(msg: string): string {
  return `\x1b[1m${msg}\x1b[0m`;
}

function dim(msg: string): string {
  return `\x1b[2m${msg}\x1b[0m`;
}

const BAR = "═══════════════════════════════════════════════════════════════";

// ---------------------------------------------------------------------------
// runDecide
// ---------------------------------------------------------------------------

/**
 * Execute the `alix governance evolution decide` command.
 *
 * Flow:
 * 1. Parse --policy flag from args.
 * 2. Validate evolution exists via stateMachine.getStatus().
 * 3. Check evolution is in UNDER_REVIEW state.
 * 4. Retrieve latest VerificationEvidence via evidenceLedger.listByProposal().
 * 5. Generate an A2.5 GovernanceRecommendation from the evidence.
 * 6. Call generateDecision(evidence, recommendation, policyConfig).
 * 7. Call decisionBridge.execute(decision) to persist + transition + emit.
 * 8. Output result (JSON or ANSI-colored terminal output).
 *
 * @param deps - Decoupled dependencies (state machine, ledger, bridge, policy).
 * @param evolutionId - The evolution proposal ID to decide on.
 * @param jsonMode - Whether to output raw JSON.
 * @param args - Remaining CLI args (after subcommand and id) for flag parsing.
 */
export async function runDecide(
  deps: DecideDeps,
  evolutionId: string,
  jsonMode: boolean,
  args: string[],
): Promise<void> {
  // Step 0: Parse --policy flag
  const policyName = extractPolicyFlag(args);
  const policyConfig = deps.policyConfig ?? resolvePolicyConfig(policyName);

  // Step 1: Validate evolution exists
  let currentState: string;
  try {
    currentState = deps.stateMachine.getStatus(evolutionId);
  } catch {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Evolution not found: ${evolutionId}` }));
    } else {
      console.log(red(`Evolution not found: ${evolutionId}`));
    }
    process.exitCode = 1;
    return;
  }

  // Step 2: Check evolution is in UNDER_REVIEW state
  if (currentState !== EvolutionState.UNDER_REVIEW) {
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        error: `Evolution ${evolutionId} is in state ${currentState}; must be UNDER_REVIEW to decide`,
      }));
    } else {
      console.log(red(
        `Evolution ${evolutionId} is in state ${currentState}; must be UNDER_REVIEW to decide`,
      ));
    }
    process.exitCode = 1;
    return;
  }

  // Step 3: Retrieve latest VerificationEvidence from A2 ledger
  const evidenceList = await deps.evidenceLedger.listByProposal(evolutionId);
  if (evidenceList.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({
        ok: false,
        error: `No verification evidence found for evolution: ${evolutionId}`,
      }));
    } else {
      console.log(red(`No verification evidence found for evolution: ${evolutionId}`));
    }
    process.exitCode = 1;
    return;
  }

  // Latest evidence = most recent by verifiedAt
  const latestEvidence = [...evidenceList].sort(
    (a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime(),
  )[0]!;

  // Step 4: Generate A2.5 GovernanceRecommendation from the evidence
  const engine = new RecommendationEngine(DEFAULT_RECOMMENDATION_CONFIG);
  const recommendation = engine.generate(latestEvidence);

  // Step 5: Generate the decision
  const decision = generateDecision(latestEvidence, recommendation, { policyConfig });

  // Step 6: Execute the decision through the bridge
  const bridgeResult = await deps.decisionBridge.execute(decision);

  // Step 7: Output result
  if (jsonMode) {
    console.log(JSON.stringify({
      ok: true,
      decision: serializeDecision(decision),
      bridgeResult: {
        lifecycleTransitioned: bridgeResult.lifecycleTransitioned,
        error: bridgeResult.error ?? null,
        transition: bridgeResult.transition
          ? {
              from: bridgeResult.transition.previous,
              to: bridgeResult.transition.current,
            }
          : null,
      },
    }, null, 2));
    return;
  }

  renderDecisionResult(evolutionId, decision, bridgeResult);
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

/**
 * Extract the --policy flag value from CLI args.
 * Removes the flag and its value from the args array (side effect, matching
 * the isJsonMode pattern in evolution-cli.ts).
 *
 * @param args - CLI args array (mutated in place).
 * @returns The policy name, or "default" if not specified.
 */
function extractPolicyFlag(args: string[]): string {
  const idx = args.indexOf("--policy");
  if (idx !== -1 && idx + 1 < args.length) {
    const name = args[idx + 1];
    args.splice(idx, 2);
    return name;
  }
  return "default";
}

/**
 * Resolve a policy name to a GovernancePolicyConfig.
 * Currently only supports the "default" policy.
 *
 * @param policyName - The named policy requested via --policy.
 * @returns A GovernancePolicyConfig.
 */
function resolvePolicyConfig(policyName: string): GovernancePolicyConfig {
  if (policyName === "default" || !policyName) {
    return { ...DEFAULT_GOVERNANCE_POLICY };
  }
  // For now only "default" is supported; future work may add named policies.
  // Fail safe: use default policy for unrecognized names.
  return { ...DEFAULT_GOVERNANCE_POLICY };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a GovernanceDecision for JSON output.
 * Converts readonly arrays to mutable arrays for clean JSON serialization.
 */
function serializeDecision(decision: GovernanceDecision): Record<string, unknown> {
  return {
    decisionId: decision.decisionId,
    proposalId: decision.proposalId,
    evolutionId: decision.evolutionId,
    kind: decision.kind,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    risks: [...decision.risks],
    evidenceId: decision.evidenceId,
    recommendationId: decision.recommendationId,
    recommendationAvailable: decision.recommendationAvailable,
    followedRecommendation: decision.followedRecommendation,
    overrideReason: decision.overrideReason,
    policySnapshot: { ...decision.policySnapshot },
    targetState: decision.targetState,
    decidedAt: decision.decidedAt,
    decidedBy: decision.decidedBy,
  };
}

// ---------------------------------------------------------------------------
// Terminal renderers
// ---------------------------------------------------------------------------

/**
 * Render the governance decision result to the terminal (ANSI-colored).
 */
function renderDecisionResult(
  evolutionId: string,
  decision: GovernanceDecision,
  bridgeResult: GovernanceDecisionBridgeResult,
): void {
  console.log(bold(`Governance Decision for Evolution: ${evolutionId}`));
  console.log(BAR);
  console.log(`  Decision:        ${formatDecisionKind(decision.kind)}`);
  console.log(`  Decision ID:     ${decision.decisionId}`);
  console.log(`  Confidence:      ${(decision.confidence * 100).toFixed(1)}%`);
  console.log(`  Reasoning:       ${decision.reasoning}`);
  console.log(`  Evidence:        ${decision.evidenceId}`);
  if (decision.recommendationId) {
    console.log(`  Recommendation:  ${decision.recommendationId}`);
    console.log(`  Followed Rec:    ${decision.followedRecommendation ? green("yes") : red("no")}`);
    if (decision.overrideReason) {
      console.log(`  Override Reason: ${dim(decision.overrideReason)}`);
    }
  }
  console.log(`  Target State:    ${bold(decision.targetState)}`);
  console.log(`  Decided By:      ${decision.decidedBy}`);
  console.log(`  Decided At:      ${decision.decidedAt}`);
  console.log("");
  console.log(`  Lifecycle Transition: ${bridgeResult.lifecycleTransitioned ? green("yes") : "no"}`);
  if (bridgeResult.error) {
    console.log(`  Error:           ${red(bridgeResult.error)}`);
  }
  if (bridgeResult.transition) {
    console.log(`  From:            ${bridgeResult.transition.previous}`);
    console.log(`  To:              ${bridgeResult.transition.current}`);
  }
  console.log("");
  console.log(green("✓ Governance decision executed."));
}

/**
 * Format a GovernanceDecisionKind with ANSI color.
 */
function formatDecisionKind(kind: GovernanceDecisionKind): string {
  switch (kind) {
    case "APPROVE":
      return green(kind);
    case "REJECT":
      return red(kind);
    case "MONITOR":
      return yellow(kind);
    case "REQUEST_MORE_EVIDENCE":
      return yellow(kind);
  }
}
