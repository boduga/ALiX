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

import "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import { parseInlineFlag } from "./audit.js";

// P19-READINESS-START
// ---------------------------------------------------------------------------
// P19 — Readiness Report CLI
// ---------------------------------------------------------------------------

export function readinessFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}


export async function readReadinessBundle(inputPath: string) {
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync(inputPath)) {
    throw new Error(`readiness input not found: "${inputPath}"`);
  }
  const parsed = JSON.parse(readFileSync(inputPath, "utf-8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("readiness input must be a JSON object");
  }
  if (!parsed.workbench || !parsed.policy) {
    throw new Error("readiness input requires workbench and policy");
  }
  return parsed;
}


export function readinessPlan(bundle: any, planId: string) {
  const plan = bundle.workbench.executionPlans.find(
    (p: any) => p.planId === planId,
  );
  if (!plan) throw new Error(`execution plan "${planId}" not found`);
  const approvals = bundle.workbench.approvals
    .filter((a: any) => a.planId === planId && a.decision === "approved")
    .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  if (!approvals.length) {
    throw new Error(`approved approval for plan "${planId}" not found`);
  }
  return { plan, approval: approvals[0] };
}


export async function readinessTrace(bundle: any, planId: string) {
  const { buildLifecycleTrace } = await import(
    "../../../governance/governance-workbench.js"
  );
  const { plan } = readinessPlan(bundle, planId);
  const plans = new Map<string, import("../../../governance/execution-plans.js").GovernanceExecutionPlan>(
    (bundle.workbench.executionPlans ?? []).map((p: any) => [p.remediationId, p]),
  );
  const approvals = new Map<string, import("../../../governance/execution-approval.js").GovernanceExecutionApproval>(
    (bundle.workbench.approvals ?? [])
      .slice()
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .map((a: any) => [a.planId, a]),
  );
  const attempts = new Map<string, import("../../../governance/execution-recorder.js").GovernanceExecutionAttempt>(
    (bundle.workbench.attempts ?? [])
      .slice()
      .sort((a: any, b: any) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
      .map((a: any) => [a.planId, a]),
  );
  const signals = new Map<string, import("../../../governance/governance-signal.js").GovernanceSignal>(
    (bundle.workbench.signals ?? []).map((s: any) => [s.signalId, s]),
  );
  const investigations = new Map<string, import("../../../governance/investigation-types.js").InvestigationRecommendation>(
    (bundle.workbench.investigations ?? []).map((i: any) => [i.id, i]),
  );
  return buildLifecycleTrace(
    plan.remediationId,
    bundle.workbench.remediations ?? [],
    plans, approvals, attempts, signals, investigations,
    new Map<string, import("../../../governance/execution-report.js").GovernanceExecutionReportItem>(),
  );
}


export async function computeReadiness(bundle: any, planId: string) {
  const now = new Date().toISOString();
  const { plan, approval } = readinessPlan(bundle, planId);
  const { classifyExecutionReadiness } = await import(
    "../../../governance/execution-readiness.js"
  );
  const { simulateExecutionPlan } = await import(
    "../../../governance/dry-run-simulator.js"
  );
  const { evaluateReadinessGate } = await import(
    "../../../governance/readiness-policy-gate.js"
  );
  const assessment = classifyExecutionReadiness(plan, approval, { now });
  const simulation = simulateExecutionPlan(plan, approval, assessment, { now });
  const lifecycleTrace = await readinessTrace(bundle, planId);
  const decision = evaluateReadinessGate({
    plan, approval, assessment, simulation,
    policy: bundle.policy,
    visibility: {
      remediationId: plan.remediationId,
      planId: plan.planId,
      approvalId: approval.approvalId,
      lifecycleTrace,
    },
    options: { now },
  });
  return { assessment, simulation, decision, lifecycleTrace };
}


export function renderReadinessAssessment(assessment: any): void {
  console.log("Readiness Assessment");
  console.log(`  ID: ${assessment.assessmentId}`);
  console.log(`  Plan: ${assessment.planId} | Remediation: ${assessment.remediationId}`);
  console.log(`  Level: ${assessment.readinessLevel}`);
  console.log(`  Assessed: ${assessment.assessedAt}`);
  console.log("  Reasons:");
  for (const r of assessment.reasons) {
    console.log(`    ${r.code} — ${r.summary}`);
  }
}


export function renderReadinessSimulation(simulation: any): void {
  console.log("Dry-Run Simulation");
  console.log(`  ID: ${simulation.simulationId}`);
  console.log(`  Status: ${simulation.status}`);
  console.log("  Actions:");
  for (const p of simulation.actionProjections) {
    console.log(`    ${p.actionId}: ${p.kind} → ${p.status}`);
    console.log(`      ${p.expectedEffect}`);
  }
  if (simulation.rollbackNotes.length) {
    console.log(`  Rollback: ${simulation.rollbackNotes.join("; ")}`);
  }
}


export function renderReadinessDecision(decision: any): void {
  console.log("Gate Decision");
  console.log(`  ID: ${decision.decisionId}`);
  console.log(`  Disposition: ${decision.disposition}`);
  console.log(`  Reasons: ${decision.reasonCodes.join(", ")}`);
  console.log(`  Authorization: ${decision.controlledExecutionAuthorization}`);
}


export function renderReadinessReport(report: any): void {
  console.log(`Readiness Report (${report.items.length} items)`);
  console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
  console.log("  Totals:");
  console.log(`    Blocked: ${report.totals.blocked}`);
  console.log(`    Manual only: ${report.totals.manualOnly}`);
  console.log(`    Dry-run allowed: ${report.totals.dryRunAllowed}`);
  console.log(`    Not evaluated: ${report.totals.notEvaluated}`);
  console.log(`    Missing P18 visibility: ${report.totals.missingVisibility}`);
  console.log(`    Future candidates: ${report.totals.futureCandidates}`);
  for (const item of report.items) {
    const flag = item.requiresAttention ? " ⚠" : "  ";
    console.log(`${flag} ${item.remediationId} | ${item.disposition}`);
    console.log(`     Plan: ${item.planId} | P18:${item.tracePresent}`);
  }
}


export async function runReadiness(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    const inputPath = readinessFlag(args, "--input");
    if (!inputPath) {
      throw new Error("--input is required (path to readiness input bundle)");
    }
    const bundle = await readReadinessBundle(inputPath);

    if (subcommand === "report") {
      const { buildExecutionReadinessReport } = await import(
        "../../../governance/execution-readiness-report.js"
      );
      const results = [];
      for (const plan of bundle.workbench.executionPlans) {
        if (bundle.workbench.approvals.some(
          (a: any) => a.planId === plan.planId && a.decision === "approved",
        )) {
          results.push(await computeReadiness(bundle, plan.planId));
        }
      }
      const report = buildExecutionReadinessReport({
        assessments: results.map((r: any) => r.assessment),
        simulations: results.map((r: any) => r.simulation),
        decisions: results.map((r: any) => r.decision),
        lifecycleTraces: results.map((r: any) => r.lifecycleTrace),
        options: {
          since: parseInlineFlag(args, "--since") ?? undefined,
          until: parseInlineFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      });
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderReadinessReport(report);
      }
      return;
    }

    if (!["classify", "simulate", "evaluate"].includes(subcommand)) {
      throw new Error(
        "usage: alix governance readiness {classify|simulate|evaluate} <plan-id> --input <path> [--json]\n" +
        "       alix governance readiness report --input <path> [--json] [--since <iso>] [--until <iso>]",
      );
    }

    const planId = args[1];
    if (!planId) {
      throw new Error(`readiness "${subcommand}" requires a plan ID`);
    }

    if (subcommand === "classify") {
      const { plan, approval } = readinessPlan(bundle, planId);
      const { classifyExecutionReadiness } = await import(
        "../../../governance/execution-readiness.js"
      );
      const assessment = classifyExecutionReadiness(plan, approval, {
        now: new Date().toISOString(),
      });
      if (jsonMode) {
        console.log(JSON.stringify(assessment, null, 2));
      } else {
        renderReadinessAssessment(assessment);
      }
      return;
    }

    const result = await computeReadiness(bundle, planId);

    if (subcommand === "simulate") {
      if (jsonMode) {
        console.log(JSON.stringify(result.simulation, null, 2));
      } else {
        renderReadinessSimulation(result.simulation);
      }
      return;
    }

    if (subcommand === "evaluate") {
      if (jsonMode) {
        console.log(JSON.stringify(result.decision, null, 2));
      } else {
        renderReadinessDecision(result.decision);
      }
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "readiness_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}
