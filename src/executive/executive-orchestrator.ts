/**
 * P10.9.2c — ExecutiveOrchestrator: lifecycle automation for plan-child proposal reconciliation.
 *
 * When a remediation proposal created by the executive bridge reaches a terminal
 * status (applied, failed, rejected), the orchestrator transitions the parent plan
 * step and resumes execution.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import type { AdaptationProposal, ProposalStatus } from "../adaptation/adaptation-types.js";
import type { PlanExecutionState, StepRuntimeStatus } from "./executive-plan-types.js";
import type { ExecutionStateStore } from "./execution-state-store.js";
import type { ExecutionEngine } from "./execution-engine.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChildLineageInfo {
  planId: string;
  stepId: string;
  parentProposalId: string;
}

export interface ReconcileResult {
  childProposalId: string;
  planId: string;
  stepId: string;
  transitioned: boolean;
  newStepStatus?: StepRuntimeStatus;
  summary: string;
}

export interface OrchestrateResult {
  scanned: number;
  matched: number;
  reconciled: number;
  plansResumed: string[];
  results: ReconcileResult[];
}

// ── OrchestrationSequence ────────────────────────────────────────────────────

export function orchestrationSequence(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

// ── Pure functions ───────────────────────────────────────────────────────────

export function extractChildLineage(proposal: AdaptationProposal): ChildLineageInfo | null {
  const payload = proposal.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  if (payload.source !== "executive_remediate") return null;
  if (!payload.planId || !payload.stepId || !payload.parentProposalId) return null;
  return {
    planId: String(payload.planId),
    stepId: String(payload.stepId),
    parentProposalId: String(payload.parentProposalId),
  };
}

export function computeStepTransition(
  state: PlanExecutionState,
  stepId: string,
  childStatus: ProposalStatus,
): StepRuntimeStatus | null {
  const stepState = state.stepStates[stepId];
  if (!stepState) return null;
  if (stepState.status !== "waiting_for_bridge") return null;
  if (childStatus === "applied") return "completed";
  if (childStatus === "failed") return "blocked";
  return null;
}

export function planChildReconciliation(
  proposal: AdaptationProposal,
  state: PlanExecutionState,
): { newStatus: StepRuntimeStatus | null; summary: string } {
  const lineage = extractChildLineage(proposal);
  if (!lineage) {
    return { newStatus: null, summary: "Proposal has no executive_remediate lineage — skipped" };
  }
  if (!state.stepStates[lineage.stepId]) {
    return { newStatus: null, summary: `Step ${lineage.stepId} not found in plan ${lineage.planId}` };
  }
  return {
    newStatus: computeStepTransition(state, lineage.stepId, proposal.status),
    summary: `Step ${lineage.stepId} → compute transition for child ${proposal.id} (${proposal.status})`,
  };
}

// ── Effectful reconciliation ─────────────────────────────────────────────────

export async function reconcileChildProposal(
  proposal: AdaptationProposal,
  stateStore: ExecutionStateStore,
  engine: ExecutionEngine,
  writer: EvidenceEventWriter,
): Promise<ReconcileResult> {
  const lineage = extractChildLineage(proposal);
  if (!lineage) {
    return {
      childProposalId: proposal.id,
      planId: "",
      stepId: "",
      transitioned: false,
      summary: "Proposal has no executive_remediate lineage — skipped",
    };
  }

  let state: PlanExecutionState | null = null;
  try {
    state = stateStore.load(lineage.planId);
  } catch {
    // store.load throws on corrupted data; handled below via null check
  }
  if (!state) {
    return {
      childProposalId: proposal.id,
      planId: lineage.planId,
      stepId: lineage.stepId,
      transitioned: false,
      summary: `Parent plan ${lineage.planId} not found — skipped`,
    };
  }

  const { newStatus } = planChildReconciliation(proposal, state);
  if (!newStatus) {
    const stepStatus = state.stepStates[lineage.stepId]?.status ?? "unknown";
    return {
      childProposalId: proposal.id,
      planId: lineage.planId,
      stepId: lineage.stepId,
      transitioned: false,
      summary: `Step ${lineage.stepId} status is "${stepStatus}" — no transition needed`,
    };
  }

  const executionId = `orchestration-${orchestrationSequence()}`;
  stateStore.update(lineage.planId, {
    from: state.status,
    to: state.status,
    executionId,
    reason: `Child proposal ${proposal.id} (${proposal.status}) → step ${lineage.stepId} → ${newStatus}`,
  }, (s: PlanExecutionState) => {
    s.stepStates[lineage.stepId].status = newStatus;
    if (newStatus === "completed") {
      s.stepStates[lineage.stepId].completedAt = new Date().toISOString();
    }
    s.stepStates[lineage.stepId].summary =
      `Orchestrated from child proposal ${proposal.id} (${proposal.status})`;
    return s;
  });

  const evidenceResult = await writer.recordExecutiveStepOrchestrated({
    planId: lineage.planId,
    stepId: lineage.stepId,
    parentProposalId: lineage.parentProposalId,
    childProposalId: proposal.id,
    childStatus: proposal.status,
    newStepStatus: newStatus,
  });
  if (!evidenceResult) {
    console.warn(
      `[executive-orchestrator] Failed to record executive_step_orchestrated evidence for plan ${lineage.planId} step ${lineage.stepId} — non-blocking, audit trail may be incomplete`,
    );
  }

  if (newStatus === "completed") {
    await engine.runReadySteps(lineage.planId);
  }

  return {
    childProposalId: proposal.id,
    planId: lineage.planId,
    stepId: lineage.stepId,
    transitioned: true,
    newStepStatus: newStatus,
    summary: `Child proposal ${proposal.id} (${proposal.status}) → step ${lineage.stepId} → ${newStatus}`,
  };
}

// ── Event hook ───────────────────────────────────────────────────────────────

export interface OrchestrationHook {
  onProposalTerminal(proposal: AdaptationProposal): Promise<void>;
}

export class ExecutiveOrchestrator implements OrchestrationHook {
  constructor(
    private readonly stateStore: ExecutionStateStore,
    private readonly engine: ExecutionEngine,
    private readonly writer: EvidenceEventWriter,
  ) {}

  async onProposalTerminal(proposal: AdaptationProposal): Promise<void> {
    try {
      const lineage = extractChildLineage(proposal);
      if (!lineage) return;

      await reconcileChildProposal(proposal, this.stateStore, this.engine, this.writer);
    } catch (e) {
      console.warn(
        `[executive-orchestrator] Failed to orchestrate proposal ${proposal.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
