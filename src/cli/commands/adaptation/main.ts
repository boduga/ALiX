/**
 * P5.1g — adaptation CLI command.
 *
 * Closes the reflection → propose → approve → apply loop:
 *
 *   ReflectionReport
 *     → `propose` converts recommendations into pending proposals
 *     → `approve`/`reject` route through ApprovalGate (records evidence)
 *     → `apply` routes through ApprovalGate, which dispatches to the
 *       AgentCardApplier or SkillApplier selected by `proposal.target.kind`
 *
 * Governance invariant (owned by ApprovalGate, not this module): **no approval,
 * no mutation**. The CLI never calls an applier directly — it selects the
 * applier by target kind and hands it to the gate, which is the sole owner of
 * status transitions and evidence recording for approve/reject/apply. Only the
 * `propose` step records evidence itself (`adaptation_proposed`), because that
 * happens before any gate involvement.
 *
 * Subcommands:
 *   list [--status <status>]       List proposals (optionally filtered by status)
 *   show <id>                      Show full proposal details
 *   propose <report.json>          Convert a ReflectionReport into proposals
 *   approve <id1> [id2] ... [--by <actor>]  Approve one or more pending proposals
 *   reject <id> [--reason <text>]  Reject a pending proposal
 *   apply <id>                     Apply an approved proposal
 *   revert <id> [--reason <text>]  Create a revert proposal for an applied proposal
 *
 *   intelligence [--since] [--until] [--min-bucket-size <n>] [--min-confidence <n>] [--json]
 * @module
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { AdaptationProposalStore } from "../../../adaptation/adaptation-proposal-store.js";
import "../../../adaptation/recommendation-to-proposal.js";
import { ApprovalGate } from "../../../adaptation/approval-gate.js";
import "../../../adaptation/appliers/agent-card-applier.js";
import "../../../adaptation/appliers/skill-applier.js";
import "../../../adaptation/revert-applier.js";
import "../../../adaptation/appliers/governance-change-applier.js";
import "../../../adaptation/snapshot-store.js";
import "../../../adaptation/recommendation-to-proposal.js";
import "../../../adaptation/effectiveness-reporter.js";
import "../../../adaptation/effectiveness-store.js";
import "../../../adaptation/auto-proposal-generator.js";
import { EvidenceStore } from "../../../security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../../workflow/evidence-writer.js";
import "../../../adaptation/intelligence-reporter.js";
import "../../../adaptation/intelligence-store.js";
import "../../../adaptation/proposal-lifecycle-analyzer.js";
import "../../../adaptation/proposal-scorer.js";
import "../../../adaptation/priority-store.js";
import "../../../adaptation/effectiveness-trend-analyzer.js";
import "../../../adaptation/bucket-aggregator.js";
import "../../../adaptation/revert-signal-analyzer.js";
import "../../../adaptation/confidence-calibration-analyzer.js";
import "../../../adaptation/capability-evolution-store.js";
import "../../../adaptation/capability-evolution-proposal-generator.js";
import "../../../adaptation/capability-evolution-reporter.js";
import "../../../adaptation/lineage-builder.js";
import "../../../adaptation/proposal-readiness.js";
import { ExecutiveOrchestrator } from "../../../executive/executive-orchestrator.js";
import type { OrchestrationHook } from "../../../executive/executive-orchestrator.js";
import { ExecutionStateStore } from "../../../executive/execution-state-store.js";
import { ExecutionEngine } from "../../../executive/execution-engine.js";
import { PlanStore } from "../../../executive/plan-store.js";
import { StepRunner } from "../../../executive/step-runner.js";
import { runList, runShow, runPropose, runApprove, runReject, runApply, runLineage, runEffectiveness, runGenerate, runRevert, runIntelligence, runPrioritize, runCapabilityEvolution } from "./handlers.js";
import { printUsage } from "./renderers.js";
import { PROPOSALS_DIR, EVIDENCE_DIR } from "./shared.js";

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handle `alix adaptation <subcommand>`.
 *
 * Wires up AdaptationProposalStore, EvidenceStore (+ EvidenceEventWriter), ApprovalGate,
 * and the two appliers. `apply` selects an applier by `proposal.target.kind`
 * and routes THROUGH ApprovalGate.apply — never calling the applier directly.
 */
export async function handleAdaptationCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  const cwd = process.cwd();
  const store = new AdaptationProposalStore(join(cwd, PROPOSALS_DIR));
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const writer = new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload));
  const gate = new ApprovalGate(store, writer);

  // ★ NEW: Construct ExecutiveOrchestrator if executive data exists
  const plansDir = join(cwd, ".alix", "executive", "plans");
  let orchestrator: OrchestrationHook | undefined;
  if (existsSync(plansDir)) {
    const planStore = new PlanStore(plansDir);
    const stateStore = new ExecutionStateStore(plansDir);
    const runner = new StepRunner(writer);
    const engine = new ExecutionEngine(planStore, stateStore, runner, writer);
    orchestrator = new ExecutiveOrchestrator(stateStore, engine, writer);
  }

  switch (subcommand) {
    case "list":
      await runList(store, rest);
      return;
    case "show":
      await runShow(store, rest);
      return;
    case "propose":
      await runPropose(store, writer, rest);
      return;
    case "approve":
      await runApprove(gate, rest);
      return;
    case "reject":
      await runReject(gate, rest);
      return;
    case "apply":
      await runApply(cwd, store, gate, writer, rest, orchestrator);
      return;
    case "effectiveness":
      await runEffectiveness(cwd, store, evidenceStore, rest);
      return;
    case "generate":
      await runGenerate(cwd, store, writer, rest);
      return;
    case "revert":
      await runRevert(cwd, store, writer, rest);
      return;
    case "intelligence":
      await runIntelligence(cwd, store, evidenceStore, rest);
      return;
    case "prioritize":
      await runPrioritize(cwd, store, rest);
      return;
    case "capability-evolution":
      await runCapabilityEvolution(cwd, store, evidenceStore, rest);
      return;
    case "lineage":
      await runLineage(cwd, store, evidenceStore, rest);
      return;
    default:
      console.error(`Unknown adaptation subcommand: "${subcommand}"`);
      printUsage(true);
      process.exit(1);
  }
}
