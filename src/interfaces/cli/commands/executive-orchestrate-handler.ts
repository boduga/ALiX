/**
 * P10.9.2c-T3 — Recovery CLI: `alix executive orchestrate`.
 *
 * Scans terminal-status child proposals (applied/failed) that carry an
 * `executive_remediate` lineage, reconciles their parent plan steps, and
 * resumes execution on completed transitions.
 *
 * Flags:
 *   --plan <id>   Scope to proposals linked to a specific plan
 *   --dry-run     Pure preview — no state or evidence mutations
 *   --json        Structured JSON output
 *
 * @module
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { createExecutiveStores, executiveDir, executivePlansDir } from "../../../execution/executive/executive-context.js";
import { AdaptationProposalStore } from "../../../planning/adaptation/adaptation-proposal-store.js";
import { EvidenceStore } from "../../../governance/security/evidence/evidence-store.js";
import {
  reconcileChildProposal,
  planChildReconciliation,
} from "../../../execution/executive/executive-orchestrator.js";
import type { ReconcileResult } from "../../../execution/executive/executive-orchestrator.js";
import type { ExecutionStateStore } from "../../../execution/executive/execution-state-store.js";
import type { ExecutionEngine } from "../../../execution/executive/execution-engine.js";
import type { EvidenceEventWriter } from "../../../coordination/workflow/evidence-writer.js";

export async function handleOrchestrateCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const useJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  const planFilterIdx = args.indexOf("--plan");
  const planFilter = planFilterIdx >= 0 ? args[planFilterIdx + 1] : undefined;

  // 1. Load all proposals
  const store = new AdaptationProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const all = await store.list();
  const proposals = planFilter
    ? all.filter(p => {
        const payload = p.payload as Record<string, unknown>;
        return payload?.planId === planFilter;
      })
    : all;

  // 2. Filter: terminal status + executive_remediate lineage
  const matched = proposals.filter(p => {
    const payload = p.payload as Record<string, unknown> | undefined;
    if (!payload || payload.source !== "executive_remediate") return false;
    if (p.status !== "applied" && p.status !== "failed") return false;
    if (!payload.planId || !payload.stepId) return false;
    return true;
  });

  if (matched.length === 0) {
    if (useJson) {
      console.log(JSON.stringify({ scanned: proposals.length, matched: 0, reconciled: 0, plansResumed: [], results: [] }));
    } else {
      console.log(`Scanned ${proposals.length} proposals.\nNo remediated child proposals found.`);
    }
    return;
  }

  // 3. Set up executive stores (state store needed for BOTH dry-run and effectful path)
  const execDir = executiveDir(cwd);

  // Execution state files are stored as <planId>-state.json inside the
  // plans directory (canonical pattern: ExecutionStateStore(join(execDir, "plans"))).
  let stateStore: ExecutionStateStore | undefined;
  if (existsSync(executivePlansDir(cwd))) {
    stateStore = createExecutiveStores(cwd).stateStore;
  }

  // Effectful stores only needed for non-dry-run
  let engine: ExecutionEngine | undefined;
  let writer: EvidenceEventWriter | undefined;
  if (!dryRun) {
    if (!stateStore) {
      console.error("Executive state store not found at " + join(execDir, "plans"));
      process.exit(1);
    }
    const { StepRunner } = await import("../../../execution/executive/step-runner.js");
    const { ExecutionEngine: EE } = await import("../../../execution/executive/execution-engine.js");
    const { EvidenceEventWriter: EEW } = await import("../../../coordination/workflow/evidence-writer.js");

    const planStore = createExecutiveStores(cwd).planStore;
    const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "security") });
    writer = new EEW((type, payload) => evidenceStore.append(type, payload));
    const runner = new StepRunner(writer);
    engine = new EE(planStore, stateStore!, runner, writer);
  }

  // 4. Reconcile each matched proposal
  const results: ReconcileResult[] = [];
  const resumedPlans = new Set<string>();

  for (const p of matched) {
    if (dryRun) {
      // Pure preview via planChildReconciliation — never mutates
      const planId = String((p.payload as any).planId);
      const stepId = String((p.payload as any).stepId);
      let state;
      try {
        state = stateStore?.load(planId);
      } catch {
        /* plan not found */
      }

      if (state) {
        const preview = planChildReconciliation(p, state);
        results.push({
          childProposalId: p.id,
          planId,
          stepId,
          transitioned: preview.newStatus !== null,
          newStepStatus: preview.newStatus ?? undefined,
          summary: `[dry-run] ${preview.summary}`,
        });
      } else {
        results.push({
          childProposalId: p.id,
          planId,
          stepId,
          transitioned: false,
          summary: `[dry-run] Parent plan ${planId} not found — skipped`,
        });
      }
    } else {
      // Effectful reconcile: transition step, record evidence, resume
      const result = await reconcileChildProposal(p, stateStore!, engine!, writer!);
      results.push(result);
      if (result.transitioned && result.newStepStatus === "completed") {
        resumedPlans.add(result.planId);
      }
    }
  }

  // 5. Output
  const scanned = proposals.length;
  const matchedCount = matched.length;
  const reconciled = results.filter(r => r.transitioned).length;
  const plansResumed = Array.from(resumedPlans).sort();

  if (useJson) {
    console.log(JSON.stringify({ scanned, matched: matchedCount, reconciled, plansResumed, results }));
  } else {
    console.log(`Scanned ${scanned} proposals.`);
    console.log(`Found ${matchedCount} matched child proposals (${matched.filter(p => p.status === "applied").length} applied, ${matched.filter(p => p.status === "failed").length} failed).`);
    console.log(`Reconciled ${reconciled} steps across ${new Set(results.filter(r => r.transitioned).map(r => r.planId)).size} plans.`);
    if (plansResumed.length) {
      console.log(`Resumed ${plansResumed.length} plan(s) (${plansResumed.join(", ")}).`);
    }
    console.log("");
    for (const r of results) {
      const icon = r.transitioned ? (r.newStepStatus === "completed" ? "✓" : "⚠") : "·";
      console.log(`  ${r.childProposalId.padEnd(10)} ${icon} ${r.summary}`);
    }
  }
}
