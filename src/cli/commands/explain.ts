/**
 * P8.5c.4 — `alix explain` CLI: explain proposal subcommand.
 *
 * READ-ONLY. The dispatcher calls `assembleProposalExplanation` (which is
 * read-only) and renders the resulting ephemeral ProposalExplanation
 * view-model either in a human-readable terminal form or as JSON.
 *
 * CORE INVARIANT: this module NEVER writes any store, evidence chain,
 * adapter, proposal surface, or applier. It only reads (via the assembler).
 * The Task 5 purity sentinel covers BOTH this file and the assembler.
 *
 * @module
 */

import type {
  CalibrationLayer,
  GovernanceLayer,
  LearningLayer,
  OutcomeLayer,
  ProposalExplanation,
  RecommendationLayer,
  RiskLayer,
  UnavailableLayer,
} from "../../explain/proposal-explanation-types.js";
import { assembleProposalExplanation } from "../../explain/proposal-explanation-assembler.js";

// ---------------------------------------------------------------------------
// handleExplainCommand — top-level dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch `alix explain <subcommand> ...`.
 *
 * Only `proposal` is supported in P8.5c. Unknown subcommands (or a missing
 * subcommand) emit an error and exit(1).
 */
export async function handleExplainCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "proposal") {
    await runProposalExplain(args.slice(1));
    return;
  }

  console.error(
    subcommand
      ? `Error: unknown explain subcommand "${subcommand}". Supported: proposal`
      : "Error: explain subcommand required. Supported: proposal",
  );
  console.error("Usage: alix explain proposal <proposal-id> [--window <days>] [--json]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// runProposalExplain — `alix explain proposal <id>`
// ---------------------------------------------------------------------------

async function runProposalExplain(args: string[]): Promise<void> {
  // Strip flags first; the first positional is the proposal id.
  const positionals: string[] = [];
  const jsonMode = args.includes("--json");

  const windowIdx = args.indexOf("--window");
  let windowDays = 90;

  for (let i = 0; i < args.length; i++) {
    if (i === windowIdx) continue; // flag token handled below
    if (windowIdx !== -1 && i === windowIdx + 1) continue; // flag value
    const token = args[i];
    if (token.startsWith("--")) continue; // other flags
    positionals.push(token);
  }

  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value");
      console.error("Usage: alix explain proposal <proposal-id> [--window <days>] [--json]");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const proposalId = positionals[0];
  if (!proposalId) {
    console.error("Error: proposal id required");
    console.error("Usage: alix explain proposal <proposal-id> [--window <days>] [--json]");
    process.exit(1);
  }

  const explanation = await assembleProposalExplanation({
    proposalId,
    cwd: process.cwd(),
    windowDays,
  });

  if (jsonMode) {
    console.log(JSON.stringify(explanation, null, 2));
    return;
  }

  renderTerminal(explanation);
}

// ---------------------------------------------------------------------------
// renderTerminal — human-readable 6-layer walk
// ---------------------------------------------------------------------------

const BAR = "═══════════════════════════════════════════════════════════════";

function renderTerminal(explanation: ProposalExplanation): void {
  console.log(`Proposal ${explanation.proposalId}`);
  console.log(`Generated: ${explanation.generatedAt}`);
  console.log(`Window: ${explanation.windowDays} days`);
  console.log(BAR);

  renderOutcomeLayer(explanation.outcome);
  renderRecommendationLayer(explanation.recommendation);
  renderRiskLayer(explanation.risk);
  renderGovernanceLayer(explanation.governance);
  renderLearningLayer(explanation.learning);
  renderCalibrationLayer(explanation.calibration);

  // Refresh hint — only when Learning layer is empty.
  if (explanation.learning.totalSignals === 0 && explanation.learningRefreshHint) {
    console.log("");
    console.log("── Learning refresh hint ──");
    console.log(` ${explanation.learningRefreshHint}`);
  }

  console.log(BAR);
  renderIntegrityFooter(explanation);
  console.log(BAR);
}

function renderJoinPath(joinPath: string): string {
  // Human-readable annotation for how the layer was resolved.
  switch (joinPath) {
    case "evidence_chain":
      return "via evidence chain";
    case "direct_id":
      return "via direct id on outcome record";
    case "proposal_fallback":
      return "via proposal-scoped fallback";
    case "string_heuristic":
      return "via string heuristic";
    default:
      return joinPath;
  }
}

function renderUnavailable(name: string, layer: UnavailableLayer): void {
  console.log(`── ${name} ──`);
  console.log(` status: not available`);
  console.log(` reason: ${layer.reason}`);
}

function renderOutcomeLayer(layer: OutcomeLayer | UnavailableLayer): void {
  if (layer.status === "not_available") {
    renderUnavailable("Outcome", layer);
    return;
  }
  console.log(`── Outcome ──`);
  console.log(` status: available (${renderJoinPath(layer.joinPath)})`);
  console.log(` outcome: ${layer.outcome}`);
  console.log(` observed: ${layer.observedAt}`);
  console.log(` sources: ${layer.sourceArtifactIds.join(", ")}`);
}

function renderRecommendationLayer(layer: RecommendationLayer | UnavailableLayer): void {
  if (layer.status === "not_available") {
    renderUnavailable("Recommendation", layer);
    return;
  }
  console.log(`── Recommendation ──`);
  console.log(` status: available (${renderJoinPath(layer.joinPath)})`);
  console.log(` decision: ${layer.decision}`);
  console.log(` confidence: ${layer.confidence ?? "n/a"}`);
  console.log(` reasons: ${layer.reasons.length ? layer.reasons.join("; ") : "(none)"}`);
  console.log(` sources: ${layer.sourceArtifactIds.join(", ")}`);
}

function renderRiskLayer(layer: RiskLayer | UnavailableLayer): void {
  if (layer.status === "not_available") {
    renderUnavailable("Risk Assessment", layer);
    return;
  }
  console.log(`── Risk Assessment ──`);
  console.log(` status: available (${renderJoinPath(layer.joinPath)})`);
  console.log(` overall risk: ${layer.overallRisk} (${layer.outcome})`);
  for (const dim of layer.dimensions) {
    console.log(` ${dim.dimension}: ${dim.score} (confidence ${dim.confidence})`);
  }
  console.log(` sources: ${layer.sourceArtifactIds.join(", ")}`);
}

function renderGovernanceLayer(layer: GovernanceLayer | UnavailableLayer): void {
  if (layer.status === "not_available") {
    renderUnavailable("Governance Review", layer);
    return;
  }
  console.log(`── Governance Review ──`);
  console.log(` status: available (${renderJoinPath(layer.joinPath)})`);
  console.log(` verdict: ${layer.verdict}`);
  if (layer.concerns.length) {
    console.log(` concerns: ${layer.concerns.join("; ")}`);
  } else {
    console.log(` concerns: (none)`);
  }
  for (const ls of layer.lensScores) {
    console.log(` lens ${ls.lens}: ${ls.verdict} (confidence ${ls.confidence})`);
  }
  console.log(` sources: ${layer.sourceArtifactIds.join(", ")}`);
}

function renderLearningLayer(layer: LearningLayer): void {
  console.log(`── Learning Signals ──`);
  console.log(` total signals: ${layer.totalSignals}`);
  if (layer.adaptersWithSignals.length === 0) {
    console.log(` adapters with signals: (none)`);
    return;
  }
  for (const adapter of layer.adaptersWithSignals) {
    const signals = layer.signalsByAdapter[adapter] ?? [];
    console.log(` adapter ${adapter}: ${signals.length} signal(s)`);
    for (const sig of signals) {
      console.log(`   ${sig.signalType}: ${sig.summary} (strength ${sig.strength}, confidence ${sig.confidence})`);
    }
  }
}

function renderCalibrationLayer(layer: CalibrationLayer): void {
  console.log(`── Calibration Impact ──`);
  const targets = Object.keys(layer.profilesByTarget);
  if (targets.length === 0) {
    console.log(` profiles: (none)`);
    return;
  }
  for (const target of targets) {
    const profiles = layer.profilesByTarget[target];
    console.log(` target ${target}: ${profiles.length} profile(s)`);
  }
  if (layer.adjustments.length) {
    for (const adj of layer.adjustments) {
      console.log(` adjustment ${adj.target}: ${adj.previousValue} → ${adj.suggestedValue}`);
    }
  }
}

// ---------------------------------------------------------------------------
// renderIntegrityFooter — ExplanationIntegrity summary
// ---------------------------------------------------------------------------

function renderIntegrityFooter(explanation: ProposalExplanation): void {
  const i = explanation.explanationIntegrity;
  console.log(`Explanation Integrity: ${i.layersAvailable}/${i.totalLayers} layers available (${i.completenessPercent}%)`);
  console.log(`Evidence Chain: ${i.evidenceChainUsed ? "used" : "not used"}`);
  console.log(`Fallback Joins Used: ${i.fallbackJoinsUsed ? "Yes" : "No"}`);
  console.log(`Incomplete Chain Layers: ${i.incompleteChainLayers}`);
}
