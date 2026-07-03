/**
 * P10.0 + P10.4a — Executive subcommand dispatcher.
 *
 * Top-level entry point for `alix executive ...`. Supports `dashboard` and
 * `plan` subcommands. The `plan` subcommand (P10.4a) provides:
 *   create, list, show, approve, reject, start, run, step, resume
 *
 * Factory functions construct PlanStore, ExecutionStateStore, StepRunner,
 * ExecutionEngine, and PlanApprovalGate on demand. EvidenceEventWriter is
 * wired with a minimal append function (CLI does not have a real
 * EvidenceStore).
 *
 * @module
 */

import { join } from "node:path";
import { runDashboard } from "./executive-dashboard-handler.js";
import { handleEvaluate } from "./executive-evaluate-handler.js";
import { handleOutcomesCommand } from "./executive-outcomes-handler.js";

// P10.4a plan subcommand imports
import { PlanStore } from "../../executive/plan-store.js";
import { ExecutionStateStore } from "../../executive/execution-state-store.js";
import { ExecutionEngine } from "../../executive/execution-engine.js";
import { StepRunner } from "../../executive/step-runner.js";
import { PlanApprovalGate } from "../../executive/plan-approval-gate.js";
import { EvidenceEventWriter } from "../../workflow/evidence-writer.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { buildExecutionPlan } from "../../executive/planning-engine.js";

// Dashboard pipeline imports for plan create
import { buildExecutiveHealthReport } from "../../executive/executive-health.js";
import { buildPriorityReport } from "../../executive/priority-engine.js";
import { buildObjectiveReport } from "../../executive/objective-engine.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { GovernanceStore } from "../../governance/governance-store.js";
import { InvestigationStore } from "../../governance/investigation-store.js";
import { listCompatibleInvestigations } from "../../governance/investigation-compat.js";

export { runDashboard };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLANS_DIR = join(".alix", "executive", "plans");
const EXECUTIVE_DIR = join(".alix", "executive");
const GOVERNANCE_DIR = join(".alix", "governance");
const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function createPlanStore(): PlanStore {
  return new PlanStore(PLANS_DIR);
}

function createStateStore(): ExecutionStateStore {
  return new ExecutionStateStore(PLANS_DIR);
}

function createProposalStore(): ProposalStore {
  return new ProposalStore(PROPOSALS_DIR);
}

/**
 * Minimal evidence event writer for CLI use.
 * Appends events to nowhere — the CLI has no live EvidenceStore.
 */
const writer = new EvidenceEventWriter(
  (_type, _payload) => {
    return Promise.resolve({ id: `evt-${Date.now()}` } as any);
  },
);

function createApprovalGate(): PlanApprovalGate {
  return new PlanApprovalGate(createPlanStore(), createStateStore(), writer);
}

function createEngine(): ExecutionEngine {
  const runner = new StepRunner(writer);
  return new ExecutionEngine(createPlanStore(), createStateStore(), runner, writer, createProposalStore());
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function handleExecutiveCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "dashboard":
      return runDashboard(rest);

    case "plan":
      return handlePlanCommand(rest);

    case "evaluate":
      return handleEvaluate(rest);

    case "outcomes":
      return handleOutcomesCommand(rest);

    case "learn": {
      const { handleLearnCommand } = await import(
        "./executive-learn-handler.js"
      );
      return handleLearnCommand(rest);
    }

    case "recommend": {
      const { handleRecommendCommand } = await import(
        "./executive-recommend-handler.js"
      );
      return handleRecommendCommand(rest);
    }

    case "bridge": {
      const { handleBridgeCommand } = await import(
        "./executive-bridge-handler.js"
      );
      return handleBridgeCommand(rest);
    }

    case "recommendation-effectiveness": {
      const { handleEffectivenessCommand } = await import(
        "./executive-effectiveness-handler.js"
      );
      return handleEffectivenessCommand(rest);
    }

    case "remediate": {
      const { handleRemediateCommand } = await import(
        "./executive-remediate-handler.js"
      );
      return handleRemediateCommand(rest);
    }

    case "subsystem-correlation": {
      const { handleSubsystemCorrelationCommand } = await import(
        "./executive-subsystem-correlation-handler.js"
      );
      return handleSubsystemCorrelationCommand(rest);
    }

    case "orchestrate": {
      const { handleOrchestrateCommand } = await import(
        "./executive-orchestrate-handler.js"
      );
      return handleOrchestrateCommand(rest);
    }

    case "correlate": {
      const { handleCorrelateCommand } = await import(
        "./executive-correlate-handler.js"
      );
      return handleCorrelateCommand(rest);
    }

    case "reason": {
      const { handleReasonCommand } = await import(
        "./executive-reason-handler.js"
      );
      return handleReasonCommand(rest);
    }

    case "strategic-plan": {
      const { handleStrategicPlanCommand } = await import(
        "./executive-strategic-plan-handler.js"
      );
      return handleStrategicPlanCommand(rest);
    }

    case "confidence-model": {
      const { handleConfidenceModelCommand } = await import(
        "./executive-confidence-model-handler.js"
      );
      return handleConfidenceModelCommand(rest);
    }

    default:
      console.error(`Unknown executive subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: dashboard, plan, evaluate, outcomes, learn, recommend, bridge, recommendation-effectiveness, subsystem-correlation, remediate, orchestrate, correlate, reason, strategic-plan, confidence-model");
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Plan subcommand router
// ---------------------------------------------------------------------------

async function handlePlanCommand(args: string[]): Promise<void> {
  const [cmd, ...params] = args;
  switch (cmd) {
    case "create": {
      // Create and persist current dashboard plan
      const windowN = params[0] ? parseInt(params[0], 10) : 7;
      const cwd = process.cwd();

      const healthReport = await buildExecutiveHealthReport({ cwd, windowDays: windowN });
      const trendStore = new ExecutiveTrendStore(join(cwd, EXECUTIVE_DIR));
      const priorSnapshot = await trendStore.loadLatest();
      const priorityReport = buildPriorityReport(healthReport, priorSnapshot);
      await trendStore.save(healthReport);

      const govStore = new GovernanceStore(join(cwd, GOVERNANCE_DIR));
      const invStore = new InvestigationStore(join(cwd, GOVERNANCE_DIR));
      const investigations = await listCompatibleInvestigations(govStore, invStore);
      const objectiveReport = buildObjectiveReport(healthReport, priorityReport, investigations);
      const plan = buildExecutionPlan(objectiveReport);

      const store = createPlanStore();
      const saved = await store.save(plan);
      const stateStore = createStateStore();
      stateStore.init(saved);
      console.log(`Plan created: ${saved.id} (${saved.steps.length} steps)`);
      break;
    }

    case "list": {
      const store = createPlanStore();
      const plans = store.list();
      for (const p of plans) {
        const state = createStateStore().load(p.id);
        console.log(`${p.id}  ${state?.status ?? "unknown"}  ${p.generatedAt.slice(0, 10)}  ${p.steps.length} steps`);
      }
      break;
    }

    case "show": {
      const planId = params[0];
      if (!planId) { console.error("Usage: plan show <planId>"); process.exit(1); }
      try {
        const plan = createPlanStore().load(planId);
        const state = createStateStore().load(planId);
        console.log(`Plan: ${plan.id}`);
        console.log(`Status: ${state?.status ?? "unknown"}`);
        console.log(`Steps: ${plan.steps.length}`);
        if (state) {
          for (const step of plan.steps) {
            const s = state.stepStates[step.id];
            const status = s?.status ?? "unknown";
            const icon = status === "completed" ? "✓" : status === "waiting_for_bridge" ? "⏳" : status === "in_progress" ? "▶" : "○";
            console.log(`  ${icon} ${step.stepNumber}. ${step.title} [${status}]`);
          }
        }
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case "approve": {
      const [planId] = params;
      if (!planId) { console.error("Usage: plan approve <planId>"); process.exit(1); }
      const gate = createApprovalGate();
      const by = process.env.USER ?? "operator";
      try {
        gate.approve(planId, by, `cli-${Date.now()}`);
        console.log(`Plan approved: ${planId}`);
      } catch (e: any) {
        console.error(`Approval failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case "reject": {
      if (params.length === 0) { console.error("Usage: plan reject <planId> [--reason <text>]"); process.exit(1); }
      let planId: string;
      let reason: string;
      const reasonIdx = params.indexOf("--reason");
      if (params[0] === "--reason") {
        // --reason comes before planId: alix executive plan reject --reason bad plan-1
        planId = params[1] ?? "";
        reason = params.slice(2).join(" ") || "No reason given";
      } else {
        planId = params[0];
        reason = reasonIdx >= 0 ? params.slice(reasonIdx + 1).join(" ") : "No reason given";
      }
      if (!planId) { console.error("Usage: plan reject <planId> [--reason <text>]"); process.exit(1); }
      const gate = createApprovalGate();
      const by = process.env.USER ?? "operator";
      try {
        gate.reject(planId, by, reason, `cli-${Date.now()}`);
        console.log(`Plan rejected: ${planId}`);
      } catch (e: any) {
        console.error(`Rejection failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case "start": {
      const [planId] = params;
      if (!planId) { console.error("Usage: plan start <planId>"); process.exit(1); }
      const engine = createEngine();
      try {
        engine.startPlan(planId, process.env.USER ?? "operator");
        console.log(`Plan started: ${planId}`);
      } catch (e: any) {
        console.error(`Start failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case "run": {
      const [planId] = params;
      if (!planId) { console.error("Usage: plan run <planId>"); process.exit(1); }
      const engine = createEngine();
      try {
        const results = await engine.runReadySteps(planId);
        console.log(`Ran ${results.length} steps`);
        for (const r of results) {
          console.log(`  ${r.stepId}: ${r.status} (${r.durationMs}ms)`);
        }
      } catch (e: any) {
        console.error(`Run failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case "step": {
      const [planId, stepId] = params;
      if (!planId || !stepId) { console.error("Usage: plan step <planId> <stepId>"); process.exit(1); }
      const engine = createEngine();
      try {
        const result = await engine.runStep(planId, stepId);
        console.log(`Step ${stepId}: ${result.status} (${result.durationMs}ms)`);
      } catch (e: any) {
        console.error(`Step failed: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case "resume": {
      // P10.4a: aliases "run"
      const [planId] = params;
      if (!planId) { console.error("Usage: plan resume <planId>"); process.exit(1); }
      return handlePlanCommand(["run", ...params]);
    }

    default:
      console.error(`Unknown plan subcommand: ${cmd ?? "(none)"}`);
      console.error("Available: create, list, show, approve, reject, start, run, step, resume");
      process.exit(1);
  }
}
