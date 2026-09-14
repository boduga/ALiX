/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import { join } from "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import { runDashboard } from "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import { runActions } from "./actions.js";
import { runAnalytics, runFailureAnalysis, runFrictionAnalysis, runPolicySuggestions, runReport } from "./analytics.js";
import { runAudit } from "./audit.js";
import { runEvolutionDiscover, runEvolutionForecast, runEvolutionLearn } from "./evolution.js";
import { runExecution } from "./execution.js";
import { runHandoff, runHandoffClosureAction } from "./handoff.js";
import { runDecide, runInbox, runReview } from "./inbox.js";
import { runIntelligence } from "./intelligence.js";
import { runInvestigate } from "./investigation.js";
import { runGovernanceApprove, runGovernanceCleanup, runGovernanceExplain, runGovernanceList, runGovernanceReject } from "./lifecycle.js";
import { runReadiness } from "./readiness.js";
import { runDrift, runHealth, runIntegrity, runLensReview, runRecommend, runStatus } from "./status.js";
import { runWorkbench } from "./workbench.js";

export async function handleGovernanceCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "status":
      return runStatus(rest);
    case "health":
      return runHealth(rest);
    case "drift":
      return runDrift(rest);
    case "lens-review":
      return runLensReview(rest);
    case "policies": {
      const { DEFAULT_GOVERNANCE_POLICIES } = await import("../../../governance/autonomous-policy.js");
      console.log(`P12.1 Autonomous Governance Policies (${DEFAULT_GOVERNANCE_POLICIES.length}):\n`);
      for (const p of DEFAULT_GOVERNANCE_POLICIES) {
        const icon = p.decision === "deny" ? "🔴" : p.decision === "ask" ? "🟡" : "🟢";
        const parts: string[] = [];
        for (const [k, v] of Object.entries(p.match)) {
          if (v !== undefined && Array.isArray(v) && v.length > 0) {
            parts.push(`  ${k}: ${v.join(", ")}`);
          }
        }
        console.log(`${icon} [${p.decision}] ${p.id}`);
        console.log(`   ${p.description}`);
        if (parts.length) console.log(parts.join("\n"));
        if (p.approvalRole) console.log(`   approvalRole: ${p.approvalRole}`);
        console.log();
      }
      return;
    }
    case "integrity":
      return runIntegrity(rest);
    case "recommend":
      return runRecommend(rest);
    case "risk-score": {
      const { riskScoreCLI } = await import("../../../governance/risk-scoring.js");
      riskScoreCLI(args.slice(1));
      return;
    }
    case "approval": {
      const { approvalCLI } = await import("../../../governance/approval-workflow.js");
      approvalCLI(rest);
      return;
    }
    case "analytics":
      return runAnalytics(rest);
    case "failure-analysis":
      return runFailureAnalysis(rest);
    case "policy-suggestions":
      return runPolicySuggestions(rest);
    case "friction-analysis":
      return runFrictionAnalysis(rest);
    case "report": {
      if (rest[0] === "compliance") {
        const { handleGovernanceReportCommand } = await import("../governance-report.js");
        return handleGovernanceReportCommand(rest, { cwd: process.cwd() });
      }
      return runReport(rest);
    }
    case "inbox":
      return runInbox(rest);
    case "review":
      return runReview(rest);
    case "decide":
      return runDecide(rest);
    case "actions":
      return runActions(rest);
    case "audit":
      return runAudit(rest);
    case "readiness":
      return runReadiness(rest);
    case "handoff":
      if (rest[0] === "evidence" || rest[0] === "closure") { return runHandoffClosureAction(rest); }
	      return runHandoff(rest);
    case "intelligence":
      return runIntelligence(rest);
    case "evolution": {
      // A8 T7: intercept `learn` subcommand before delegating to A0-A7
      // evolution-cli.js. The A8 path is structurally distinct: it
      // consumes EventLog + GovernanceStore + EnrichedProposal[] (NOT
      // stateMachine/decision-bridge). Adding the route here keeps A8
      // co-located with the other evolution subcommands while leaving
      // the A0-A7 handler signature untouched.
      if (rest[0] === "learn") {
        return runEvolutionLearn(rest.slice(1));
      }
      // A9 Slice 5: intercept `forecast` alongside `learn`. The A9 path is
      // structurally distinct (forecast pipeline + A9-owned forecasts.jsonl);
      // it never exposes correlation as an operator command.
      if (rest[0] === "forecast") {
        return runEvolutionForecast(rest.slice(1));
      }
      // A1: intercept `discover` — pattern discovery + governance intake.
      if (rest[0] === "discover") {
        return runEvolutionDiscover(rest.slice(1));
      }
      const { handleEvolutionCommand } = await import("../../../governance/evolution-cli.js");
      const { EvolutionStateMachine } = await import("../../../evolution/evolution-state-machine.js");
      const { ExecutionEvidenceStore } = await import("../../../runtime/execution-evidence-store.js");
      const { InMemoryGovernanceDecisionStore } = await import("../../../evolution/governance/decision-store.js");
      const { GovernanceDecisionBridge } = await import("../../../evolution/governance/governance-decision-bridge.js");
      const { InMemoryVerificationEvidenceLedger } = await import("../../../evolution/verification/evidence/evidence-ledger.js");
      const { DEFAULT_GOVERNANCE_POLICY } = await import("../../../evolution/governance/contracts/decision-contract.js");
      const { PatternRegistry } = await import("../../../context/pattern-registry.js");
      const cwd = process.cwd();
      // Use a shared state machine instance — in production this would
      // be wired through dependency injection. For the read-only CLI we
      // create a fresh one; evolutions must be created programmatically.
      const stateMachine = new EvolutionStateMachine();
      const evidenceStore = new ExecutionEvidenceStore(cwd);
      // NOTE: In-memory — no evidence persistence between CLI invocations.
      // The `decide` command requires a persistent VerificationEvidenceLedger
      // (e.g., backed by X3b storage). In-memory demo only.
      const evidenceLedger = new InMemoryVerificationEvidenceLedger();
      const decisionStore = new InMemoryGovernanceDecisionStore();
      const decisionBridge = new GovernanceDecisionBridge(stateMachine, decisionStore);
      // A6 curation reads the pattern registry (memory-backed) at `.alix/patterns`
      // (the same layout task-loop.ts and context-compiler.ts use).
      const patternRegistry = new PatternRegistry(join(cwd, ".alix", "patterns"));
      await patternRegistry.init();
      const deps = { stateMachine, evidenceStore, evidenceLedger, decisionBridge, decisionStore, policyConfig: DEFAULT_GOVERNANCE_POLICY, patternRegistry };
      return handleEvolutionCommand(rest, deps);
    }
    case "replay": {
      const { handleGovernanceReplayCommand } = await import("../governance-replay.js");
      return handleGovernanceReplayCommand(rest);
    }
    case "calibration": {
      const { handleGovernanceCalibrationCommand } = await import("../governance-calibration.js");
      const output = handleGovernanceCalibrationCommand(rest, { cwd: process.cwd() });
      console.log(output);
      return;
    }
    case "policy-review": {
      const { handleGovernancePolicyReviewCommand } = await import("../governance-policy-review.js");
      const output = await handleGovernancePolicyReviewCommand(rest, { cwd: process.cwd() });
      console.log(output);
      return;
    }
    case "policy-review-outcome": {
      const { handleGovernancePolicyReviewOutcomeCommand } = await import("../governance-policy-review-outcome.js");
      const output = await handleGovernancePolicyReviewOutcomeCommand(rest, { cwd: process.cwd() });
      console.log(output);
      return;
    }
    case "learning-synthesis": {
      const { handleGovernanceLearningSynthesisCommand } = await import("../governance-learning-synthesis.js");
      const output = handleGovernanceLearningSynthesisCommand(rest, { cwd: process.cwd() });
      console.log(output);
      return;
    }
    case "propose": {
      const recommendationId = rest[0];
      if (!recommendationId) {
        console.error("Usage: alix governance propose <recommendation-id>");
        process.exit(2);
      }
      const json = rest.includes("--json");
      const { createGovernanceProposal } = await import("../../../governance/governance-proposal-generator.js");
      const result = await createGovernanceProposal({ recommendationId });
      if (!result.ok) {
        if (json) {
          console.log(JSON.stringify({ ok: false, reason: result.reason }));
        } else {
          console.error(result.reason);
        }
        process.exit(1);
      }
      if (json) {
        console.log(JSON.stringify({ ok: true, proposalId: result.proposalId, recommendationId }));
      } else {
        console.log(`Governance proposal created.`);
        console.log(`  Proposal:        ${result.proposalId}`);
        console.log(`  Recommendation:  ${recommendationId}`);
        console.log(``);
        console.log(`Review and approve:`);
        console.log(`  alix governance explain ${result.proposalId}`);
        console.log(`  alix adaptation approve ${result.proposalId}`);
      }
      return;
    }
    case "approve":
      return runGovernanceApprove(rest);
    case "reject":
      return runGovernanceReject(rest);
    case "list":
      return runGovernanceList(rest);
    case "cleanup":
      return runGovernanceCleanup(rest);
    case "explain": {
      if (rest[0] === "trace" || rest[0] === "window") {
        const { handleGovernanceExplainCommand } = await import("../governance-explain.js");
        const output = handleGovernanceExplainCommand(rest, { cwd: process.cwd() });
        console.log(output);
        return;
      }
      return runGovernanceExplain(rest);
    }
    case "dashboard":
      return runDashboard(rest);
    case "investigate":
      return runInvestigate(rest);
    case "execution":
      return runExecution(rest);
    case "workbench":
      return runWorkbench(rest);
    default:
      console.error(
        `Unknown governance subcommand: "${subcommand ?? ""}"`,
      );
      console.error(
        "Usage: alix governance {status|health|drift|lens-review|integrity|policies|recommend|propose|approve|reject|list|cleanup|explain|dashboard|investigate} [--window <days>] [--json]",
      );
      process.exit(1);
  }
}
