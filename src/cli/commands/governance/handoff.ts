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

// P19-READINESS-END

// P20-HANDOFF-START
// ---------------------------------------------------------------------------
// P20 — Handoff CLI
// ---------------------------------------------------------------------------

export function handoffFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}


export function renderHandoffReport(report: any): void {
  console.log(`Handoff Report (${report.items.length} items)`);
  console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
  console.log("  Totals:");
  console.log(`    Pending: ${report.totals.pending}`);
  console.log(`    Completed: ${report.totals.completed}`);
  console.log(`    Failed: ${report.totals.failed}`);
  console.log(`    Evidence missing: ${report.totals.evidenceMissing}`);
  for (const item of report.items) {
    console.log(`  ${item.handoffId} | ${item.status} | ${item.planId} | ${item.actionCount} actions`);
  }
}


export async function runHandoff(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    if (subcommand === "report") {
      const { buildHandoffReport } = await import("../../../governance/handoff-report.js");
      const { readFileSync, existsSync } = await import("node:fs");
      const inputPath = handoffFlag(args, "--input");
      if (!inputPath) throw new Error("--input is required");
      if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));
      const report = buildHandoffReport(
        bundle.handoffs ?? [],
        bundle.validations ?? [],
        bundle.attempts ?? [],
        {
          since: handoffFlag(args, "--since") ?? undefined,
          until: handoffFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      );
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderHandoffReport(report);
      }
      return;
    }

    if (!["build", "validate", "prepare-record"].includes(subcommand)) {
      throw new Error(
        "usage: alix governance handoff {build|validate|prepare-record|report} <plan-id> --input <path> [--json]",
      );
    }

    const planId = args[1];
    if (!planId) throw new Error(`handoff "${subcommand}" requires a plan ID`);

    const inputPath = handoffFlag(args, "--input");
    if (!inputPath) throw new Error("--input is required");

    const { readFileSync, existsSync } = await import("node:fs");
    if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

    const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));

    if (subcommand === "build") {
      const { buildHandoffPackage } = await import("../../../governance/handoff-builder.js");
      const { classifyExecutionReadiness } = await import("../../../governance/execution-readiness.js");
      const { simulateExecutionPlan } = await import("../../../governance/dry-run-simulator.js");
      const { evaluateReadinessGate } = await import("../../../governance/readiness-policy-gate.js");
      const { buildLifecycleTrace } = await import("../../../governance/governance-workbench.js");

      const plan = bundle.executionPlans?.find((p: any) => p.planId === planId);
      if (!plan) throw new Error(`plan "${planId}" not found`);
      const approval = bundle.approvals?.find(
        (a: any) => a.planId === planId && a.decision === "approved",
      );
      if (!approval) throw new Error(`approved approval for "${planId}" not found`);

      const now = new Date().toISOString();
      const assessment = classifyExecutionReadiness(plan, approval, { now });
      const simulation = simulateExecutionPlan(plan, approval, assessment, { now });
      const plansMap = new Map<string, any>(bundle.executionPlans?.map((p: any) => [p.remediationId, p]) ?? []);
      const approvalsMap = new Map<string, any>(bundle.approvals?.map((a: any) => [a.planId, a]) ?? []);
      const lifecycleTrace = buildLifecycleTrace(
        plan.remediationId, bundle.remediations ?? [],
        plansMap, approvalsMap, new Map(), new Map(), new Map(), new Map(),
      );
      const decision = evaluateReadinessGate({
        plan, approval, assessment, simulation,
        policy: bundle.policy,
        visibility: { remediationId: plan.remediationId, planId: plan.planId, approvalId: approval.approvalId, lifecycleTrace },
        options: { now },
      });
      const pkg = buildHandoffPackage({ plan, approval, assessment, simulation, decision, lifecycleTrace }, { now });

      if (jsonMode) {
        console.log(JSON.stringify(pkg, null, 2));
      } else {
        console.log("Handoff Package");
        console.log(`  ID: ${pkg.handoffId}`);
        console.log(`  Plan: ${pkg.planId} | Disposition: ${pkg.disposition}`);
        console.log(`  Actions: ${pkg.actions.length}`);
        console.log(`  Status: ${pkg.status} | Manual only: ${pkg.explicitlyManualOnly}`);
      }
      return;
    }

    if (subcommand === "validate") {
      const { validateHandoffEvidence } = await import("../../../governance/handoff-evidence.js");
      const handoffs = bundle.handoffs ?? [];
      const handoff = handoffs.find((h: any) => h.handoffId === planId);
      if (!handoff) throw new Error(`handoff "${planId}" not found`);
      const evidencePath = handoffFlag(args, "--evidence");
      if (!evidencePath || !existsSync(evidencePath)) throw new Error("--evidence path required");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
      const requiredRefs = (handoff.evidence ?? []).filter((e: any) => e.required).map((e: any) => e.ref);
      const result = validateHandoffEvidence(requiredRefs, evidence);

      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Evidence Validation: ${result.valid ? "PASS" : "FAIL"}`);
        console.log(`  Required: ${result.totalRequired} Captured: ${result.totalCaptured}`);
        if (result.missingRefs.length) console.log(`  Missing: ${result.missingRefs.join(", ")}`);
      }
      return;
    }

    if (subcommand === "prepare-record") {
      const { prepareHandoffRecord } = await import("../../../governance/handoff-recorder.js");
      const handoffs = bundle.handoffs ?? [];
      const handoff = handoffs.find((h: any) => h.handoffId === planId);
      if (!handoff) throw new Error(`handoff "${planId}" not found`);
      const evidencePath = handoffFlag(args, "--evidence");
      if (!evidencePath || !existsSync(evidencePath)) throw new Error("--evidence path required");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
      const record = prepareHandoffRecord(handoff, evidence, { now: new Date().toISOString() });

      if (jsonMode) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log("Handoff Record (not persisted)");
        console.log(`  Attempt: ${record.attemptId}`);
        console.log(`  Status: ${record.status}`);
        console.log(`  Actions: ${record.actionResults.length}`);
        console.log(`  Executed by: ${record.executedBy}`);
      }
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "handoff_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}


// P20-HANDOFF-END

// P21-CLOSURE-START
// ---------------------------------------------------------------------------
// P21 — Closure CLI
// ---------------------------------------------------------------------------

export async function runHandoffClosureAction(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    if (!["evidence", "closure"].includes(subcommand)) {
      throw new Error("usage: alix governance handoff {evidence|closure} ...");
    }

    if (subcommand === "closure" && args[1] === "report") {
      const { buildHumanExecutionClosureReport } = await import(
        "../../../governance/human-execution-closure-report.js"
      );
      const { readFileSync, existsSync } = await import("node:fs");
      const inputPath = closureFlag(args, "--input");
      if (!inputPath) throw new Error("--input is required");
      if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));
      const report = buildHumanExecutionClosureReport(
        bundle.handoffRefs ?? [],
        bundle.evidenceRefs ?? [],
        bundle.closureReviews ?? [],
        {
          since: closureFlag(args, "--since") ?? undefined,
          until: closureFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      );

      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Closure Report (${report.items.length} items)`);
        console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
        console.log("  Totals:");
        console.log(`    Awaiting evidence: ${report.totals.awaitingEvidence}`);
        console.log(`    Evidence submitted: ${report.totals.withEvidence - report.totals.accepted - report.totals.rejected - report.totals.incomplete - report.totals.needsFollowUp}`);
        console.log(`    Accepted: ${report.totals.accepted}`);
        console.log(`    Rejected: ${report.totals.rejected}`);
        console.log(`    Incomplete: ${report.totals.incomplete}`);
        console.log(`    Needs follow-up: ${report.totals.needsFollowUp}`);
        for (const item of report.items) {
          const flag = item.followUpRequired ? " ⚠" : "  ";
          console.log(`${flag} ${item.handoffId} | ${item.status} | ${item.evidenceCount} ev`);
        }
      }
      return;
    }

    if (subcommand === "evidence" && args[1] === "append") {
      const handoffId = closureFlag(args, "--handoff");
      const kind = closureFlag(args, "--kind");
      const label = closureFlag(args, "--label");
      const summary = closureFlag(args, "--summary");
      const submittedBy = closureFlag(args, "--submitted-by");
      const uri = closureFlag(args, "--uri");
      const preparedRecordId = closureFlag(args, "--prepared-record");
      const contentHash = closureFlag(args, "--content-hash");
      const inputPath = closureFlag(args, "--input");

      if (!handoffId) throw new Error("--handoff is required");
      if (!kind) throw new Error("--kind is required");
      if (!label) throw new Error("--label is required");
      if (!summary) throw new Error("--summary is required");
      if (!submittedBy) throw new Error("--submitted-by is required");

      const { readFileSync, existsSync } = await import("node:fs");
      if (!inputPath || !existsSync(inputPath)) throw new Error("--input path required (bundle with store config)");
      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));

      const { FileEvidenceLedgerStore } = await import("../../../governance/human-execution-evidence-ledger.js");
      const { FileClosureReviewStore } = await import("../../../governance/human-execution-closure-review.js");
      const { AuditedClosureRecorder } = await import("../../../governance/audited-human-execution-closure.js");

      const storeDir = bundle.storeDir ?? ".alix/governance";
      const evPath = `${storeDir}/human-execution-evidence-ledger.jsonl`;
      const revPath = `${storeDir}/human-execution-closure-reviews.jsonl`;
      const auditPath = `${storeDir}/p21-audit-events.jsonl`;

      const evStore = new FileEvidenceLedgerStore(evPath);
      const revStore = new FileClosureReviewStore(revPath, () => evStore.listEvidence());
      const recorder = new AuditedClosureRecorder(evStore, revStore, auditPath);

      const evidenceRef = {
        evidenceId: `${handoffId}-${kind}-${Date.now()}`,
        handoffId,
        preparedRecordId: preparedRecordId ?? null,
        kind: kind as any,
        uri: uri ?? null,
        label,
        summary,
        submittedBy,
        submittedAt: new Date().toISOString(),
        contentHash: contentHash ?? null,
        auditRefs: [],
      };

      const result = await recorder.appendEvidence(evidenceRef);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Evidence appended: ${result.evidenceId}`);
        console.log(`  Handoff: ${result.handoffId}`);
        console.log(`  Audit refs: ${result.auditRefs.join(", ")}`);
      }
      return;
    }

    if (subcommand === "closure" && args[1] === "review") {
      const handoffId = closureFlag(args, "--handoff");
      const decision = closureFlag(args, "--decision");
      const rationale = closureFlag(args, "--rationale");
      const reviewedBy = closureFlag(args, "--reviewed-by");
      const evidenceIdsRaw = closureFlag(args, "--evidence");
      const followUpSummary = closureFlag(args, "--follow-up-summary");
      const inputPath = closureFlag(args, "--input");

      if (!handoffId) throw new Error("--handoff is required");
      if (!decision) throw new Error("--decision is required");
      if (!rationale) throw new Error("--rationale is required");
      if (!reviewedBy) throw new Error("--reviewed-by is required");
      if (!evidenceIdsRaw) throw new Error("--evidence is required (comma-separated IDs)");

      const { readFileSync, existsSync } = await import("node:fs");
      if (!inputPath || !existsSync(inputPath)) throw new Error("--input path required");
      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));

      const { FileEvidenceLedgerStore } = await import("../../../governance/human-execution-evidence-ledger.js");
      const { FileClosureReviewStore } = await import("../../../governance/human-execution-closure-review.js");
      const { AuditedClosureRecorder } = await import("../../../governance/audited-human-execution-closure.js");

      const storeDir = bundle.storeDir ?? ".alix/governance";
      const evPath = `${storeDir}/human-execution-evidence-ledger.jsonl`;
      const revPath = `${storeDir}/human-execution-closure-reviews.jsonl`;
      const auditPath = `${storeDir}/p21-audit-events.jsonl`;

      const evStore = new FileEvidenceLedgerStore(evPath);
      const revStore = new FileClosureReviewStore(revPath, () => evStore.listEvidence());
      const recorder = new AuditedClosureRecorder(evStore, revStore, auditPath);

      const evidenceIds = evidenceIdsRaw.split(",").map((s: string) => s.trim());
      const internalDecision = decision.replace(/-/g, "_");

      const review = {
        closureReviewId: `cr-${handoffId}-${Date.now()}`,
        handoffId,
        preparedRecordId: closureFlag(args, "--prepared-record") ?? null,
        decision: internalDecision as any,
        rationale,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        evidenceIds,
        followUpRequired: internalDecision === "needs_follow_up" || internalDecision === "incomplete",
        followUpSummary: followUpSummary ?? null,
        auditRefs: [],
      };

      const result = await recorder.appendReview(review);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Closure review recorded: ${result.closureReviewId}`);
        console.log(`  Handoff: ${result.handoffId}`);
        console.log(`  Decision: ${result.decision}`);
        console.log(`  Audit refs: ${result.auditRefs.join(", ")}`);
      }
      return;
    }

    throw new Error("usage: alix governance handoff {evidence append ...|closure review ...|closure report ...}");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "closure_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}


export function closureFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}
