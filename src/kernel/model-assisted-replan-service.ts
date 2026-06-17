/**
 * model-assisted-replan-service.ts — Full workflow orchestrator for model-assisted replanning.
 *
 * Owns the model-assisted replan pipeline:
 *   1. Load run, capture planRevision
 *   2. Build bounded replan context (via CollaborationContextBuilder)
 *   3. Call ModelReplanAdapter.proposeRevision()
 *   4. Validate via ReplanValidator
 *   5. Simulate via ReplanSimulator
 *   6. Analyze impact via ReplanImpactAnalyzer
 *   7. Persist proposal to ReplanProposalStore
 *   8. Evaluate via ReplanApprovalGate
 *   9. If auto-approved: consume + apply atomically via ReplanApplier
 *   10. If pending: return awaiting_approval (caller checks back later)
 *
 * Recovery guarantees:
 * - Run never stranded in "replanning" after model timeout, invalid output,
 *   approval denial, or CAS conflict
 * - Failed proposals are persisted with error state
 * - Mechanical fallback remains when no model configured
 *
 * All imports use .js extensions (NodeNext).
 */

import type { CoordinationRun, PlanRevision, PlanTriggerKind } from "./coordination-types.js";
import { recomputeRunStatus } from "./coordination-types.js";
import { computeFingerprint, createProposalRecord } from "./replan-types.js";
import type {
  PlanRevisionDraft,
  ModelReplanContext,
  TriggerEvidence,
  ImpactAnalysis,
  ProposalRecord,
  SimulatedGraph,
  ValidationResult,
} from "./replan-types.js";
import { CoordinationStore } from "./coordination-store.js";
import { CollaborationContextBuilder } from "./collaboration-context-builder.js";
import { ModelReplanAdapter, ReplanAdapterError } from "./model-replan-adapter.js";
import { ReplanValidator } from "./replan-validator.js";
import { ReplanSimulator } from "./replan-simulator.js";
import { ReplanImpactAnalyzer } from "./replan-impact-analyzer.js";
import { ReplanProposalStore } from "./replan-proposal-store.js";
import { ReplanApprovalGate } from "./replan-approval-gate.js";
import { ReplanApplier } from "./replan-applier.js";
import type { CollaborativePlanner } from "./collaborative-planner.js";

// ─── ServiceResult ─────────────────────────────────────────────────────

export interface ServiceResult {
  /** Status of the replan operation. */
  status: "proposed" | "invalid" | "awaiting_approval" | "approved" | "applied" | "failed";
  /** The proposal ID if a proposal was persisted. */
  proposalId?: string;
  /** The approval ID if the proposal requires manual approval. */
  approvalId?: string;
  /** The updated coordination run, set when applied. */
  run?: CoordinationRun;
  /** The plan revision record, set when applied. */
  revision?: PlanRevision;
  /** Error messages, non-empty on failure. */
  errors: string[];
}

// ─── Options ──────────────────────────────────────────────────────────

export interface ModelAssistedReplanServiceOptions {
  store: CoordinationStore;
  contextBuilder: CollaborationContextBuilder;
  /** Optional model adapter. When absent, falls back to mechanical replanner. */
  adapter?: ModelReplanAdapter;
  proposalStore: ReplanProposalStore;
  approvalGate: ReplanApprovalGate;
  applier: ReplanApplier;
  impactAnalyzer: ReplanImpactAnalyzer;
  /** Optional mechanical fallback replanner when no model adapter configured. */
  mechanicalReplanner?: CollaborativePlanner;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const EMPTY_SIMULATED: SimulatedGraph = {
  workers: [], edges: [], idMap: {},
  valid: true, errors: [], warnings: [],
};

// ─── Service ──────────────────────────────────────────────────────────

export class ModelAssistedReplanService {
  constructor(private readonly options: ModelAssistedReplanServiceOptions) {}

  // ── Public: proposeRevision ──────────────────────────────────────────

  /**
   * Propose and optionally apply a model-assisted plan revision.
   *
   * Full workflow:
   *   1. Load run, capture planRevision
   *   2. Build bounded replan context
   *   3. Call ModelReplanAdapter (or fall back to mechanical replan)
   *   4. Validate draft via ReplanValidator
   *   5. Simulate draft via ReplanSimulator
   *   6. Analyze impact via ReplanImpactAnalyzer
   *   7. Persist proposal
   *   8. Evaluate approval gate
   *   9. Auto-approved: consume + apply atomically
   *   10. Pending: return awaiting_approval
   *
   * Recovery: on any failure before apply, run status is restored from
   * "replanning" to its safe computed status (never stranded).
   */
  async proposeRevision(
    runId: string,
    trigger: PlanTriggerKind,
    evidence: TriggerEvidence,
    signal?: AbortSignal,
  ): Promise<ServiceResult> {
    // ── 1. Load run and capture planRevision ──────────────────────────

    const run = await this.options.store.load(runId);
    if (!run) {
      return { status: "failed", errors: [`Coordination run not found: ${runId}`] };
    }

    if (run.status !== "replanning" && run.status !== "running") {
      return { status: "failed", errors: [`Run ${runId} is in status ${run.status}, not eligible for replanning`] };
    }

    const expectedPlanRevision = run.planRevision ?? 0;
    const existingWorkers = [...run.workers];

    if (signal?.aborted) {
      await this.restoreRunStatus(runId);
      return { status: "failed", errors: ["Operation aborted by signal"] };
    }

    // ── Mechanical fallback ───────────────────────────────────────────

    if (!this.options.adapter) {
      return this.executeMechanicalFallback(runId, trigger, evidence);
    }

    // ── 2. Build bounded replan context ───────────────────────────────

    let context: ModelReplanContext;
    try {
      context = await this.options.contextBuilder.buildModelReplanContext(
        runId,
        trigger,
        evidence,
      );
    } catch (err) {
      await this.restoreRunStatus(runId);
      return {
        status: "failed",
        errors: [`Failed to build replan context: ${coerceError(err)}`],
      };
    }

    // ── 3. Call ModelReplanAdapter ────────────────────────────────────

    let draft: PlanRevisionDraft;
    let provider: string | undefined;
    let model: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    try {
      draft = await this.options.adapter.proposeRevision(context, signal);

      const adapterEvidence = this.options.adapter.lastEvidence;
      if (adapterEvidence) {
        provider = adapterEvidence.provider;
        model = adapterEvidence.model;
        if (adapterEvidence.usage) {
          usage = {
            inputTokens: adapterEvidence.usage.inputTokens,
            outputTokens: adapterEvidence.usage.outputTokens,
            totalTokens: adapterEvidence.usage.inputTokens + adapterEvidence.usage.outputTokens,
          };
        }
      }
    } catch (err) {
      await this.restoreRunStatus(runId);

      if (err instanceof ReplanAdapterError) {
        if (err.code === "aborted") {
          return { status: "failed", errors: ["Model call was aborted"] };
        }
        if (err.code === "parse_error" || err.code === "validation_error") {
          return { status: "failed", errors: [`Model produced invalid output: ${err.message}`] };
        }
        return { status: "failed", errors: [`Model adapter error (${err.code}): ${err.message}`] };
      }

      return { status: "failed", errors: [`Unexpected model error: ${coerceError(err)}`] };
    }

    // ── 4. Validate draft ─────────────────────────────────────────────

    const validationResult = ReplanValidator.validate(draft, existingWorkers);

    if (!validationResult.valid) {
      const draftFingerprint = computeFingerprint(draft);
      const invalidProposal = createProposalRecord({
        runId,
        expectedPlanRevision,
        status: "invalid",
        trigger,
        evidence,
        draft,
        draftFingerprint,
        validationResult,
        provider,
        model,
        usage,
        error: validationResult.errors.map((e) => e.message).join("; "),
      });

      await this.persistBestEffort(invalidProposal);
      await this.restoreRunStatus(runId);

      return {
        status: "invalid",
        proposalId: invalidProposal.id,
        errors: validationResult.errors.map((e) => e.message),
      };
    }

    // ── 5. Simulate draft ─────────────────────────────────────────────

    const simulatedGraph = ReplanSimulator.simulate(draft, existingWorkers);

    if (!simulatedGraph.valid) {
      const draftFingerprint = computeFingerprint(draft);
      const simFailedProposal = createProposalRecord({
        runId,
        expectedPlanRevision,
        status: "invalid",
        trigger,
        evidence,
        draft,
        draftFingerprint,
        simulatedGraph,
        validationResult,
        provider,
        model,
        usage,
        error: simulatedGraph.errors.map((e) => e.message).join("; "),
      });

      await this.persistBestEffort(simFailedProposal);
      await this.restoreRunStatus(runId);

      return {
        status: "invalid",
        proposalId: simFailedProposal.id,
        errors: simulatedGraph.errors.map((e) => e.message),
      };
    }

    // ── 6. Analyze impact ─────────────────────────────────────────────

    let impactAnalysis: ImpactAnalysis;
    try {
      const analyzeResult = await this.options.impactAnalyzer.analyze(
        draft,
        existingWorkers,
        simulatedGraph,
      );
      impactAnalysis = analyzeResult.impactAnalysis;
    } catch (err) {
      const draftFingerprint = computeFingerprint(draft);
      const analysisFailedProposal = createProposalRecord({
        runId,
        expectedPlanRevision,
        status: "invalid",
        trigger,
        evidence,
        draft,
        draftFingerprint,
        validationResult,
        simulatedGraph,
        provider,
        model,
        usage,
        error: `Impact analysis failed: ${coerceError(err)}`,
      });

      await this.persistBestEffort(analysisFailedProposal);
      await this.restoreRunStatus(runId);

      return {
        status: "invalid",
        proposalId: analysisFailedProposal.id,
        errors: [`Impact analysis failed: ${coerceError(err)}`],
      };
    }

    // ── 7. Persist proposal ───────────────────────────────────────────

    const draftFingerprint = computeFingerprint(draft);
    const impactFingerprint = computeFingerprint(impactAnalysis);

    const proposal = createProposalRecord({
      runId,
      expectedPlanRevision,
      trigger,
      evidence,
      draft,
      draftFingerprint,
      validationResult,
      simulatedGraph,
      impactAnalysis,
      impactFingerprint,
      provider,
      model,
      usage,
    });

    let persistedProposal: ProposalRecord;
    try {
      persistedProposal = await this.options.proposalStore.create(proposal);
    } catch (err) {
      await this.restoreRunStatus(runId);
      return {
        status: "failed",
        errors: [`Failed to persist proposal: ${coerceError(err)}`],
      };
    }

    // ── 8. Evaluate approval gate ─────────────────────────────────────

    let gateResult;
    try {
      gateResult = await this.options.approvalGate.evaluate(
        impactAnalysis,
        runId,
        draftFingerprint,
        impactFingerprint,
      );
    } catch (err) {
      await this.options.proposalStore.updateStatus(runId, persistedProposal.id, "failed", {
        error: `Approval gate error: ${coerceError(err)}`,
      }).catch(() => {});
      await this.restoreRunStatus(runId);
      return {
        status: "failed",
        proposalId: persistedProposal.id,
        errors: [`Approval gate evaluation failed: ${coerceError(err)}`],
      };
    }

    // ── 9. Handle gate result ─────────────────────────────────────────

    // Map agentAssignments for the applier's draftWorkerId → agentId mapping
    // The ReplanApplier sets agentId to "unassigned" for new/replacement workers
    // because it does not accept agentAssignments. The caller is responsible for
    // setting agentId after apply by examining the impact analysis.

    if (gateResult.approved && gateResult.autoApproved) {
      // Auto-approved: apply directly
      return this.applyInternal(
        persistedProposal,
        draft,
        simulatedGraph,
        expectedPlanRevision,
      );
    }

    if (gateResult.approved && !gateResult.autoApproved) {
      // Already approved (pre-existing approved record): consume and apply
      const bindingKey = `replan:${runId}:${draftFingerprint}`;
      const approvalId = gateResult.approvalId!;

      try {
        const consumeResult = await this.options.approvalGate.consumeApproved(
          approvalId,
          bindingKey,
          runId,
        );

        if (!consumeResult.consumed) {
          await this.options.proposalStore.updateStatus(
            runId, persistedProposal.id, "failed",
            { error: "Approval consumption failed" },
          ).catch(() => {});
          await this.restoreRunStatus(runId);
          return {
            status: "failed",
            proposalId: persistedProposal.id,
            errors: ["Approval could not be consumed"],
          };
        }
      } catch (err) {
        await this.options.proposalStore.updateStatus(
          runId, persistedProposal.id, "failed",
          { error: `Approval consumption error: ${coerceError(err)}` },
        ).catch(() => {});
        await this.restoreRunStatus(runId);
        return {
          status: "failed",
          proposalId: persistedProposal.id,
          errors: [`Approval consumption failed: ${coerceError(err)}`],
        };
      }

      // Update proposal to approved
      await this.options.proposalStore.updateStatus(
        runId, persistedProposal.id, "approved",
        { approvalId },
      ).catch(() => {});

      return this.applyInternal(
        { ...persistedProposal, approvalId },
        draft,
        simulatedGraph,
        expectedPlanRevision,
      );
    }

    // ── 10. Pending: update proposal status and return ──────────────────

    await this.options.proposalStore.updateStatus(
      runId, persistedProposal.id, "awaiting_approval",
      { approvalId: gateResult.approvalId },
    ).catch(() => {});

    // Restore run status — run stays in running/blocked while awaiting approval
    await this.restoreRunStatus(runId);

    return {
      status: "awaiting_approval",
      proposalId: persistedProposal.id,
      approvalId: gateResult.approvalId,
      errors: [],
    };
  }

  // ── Public: applyApprovedProposal ─────────────────────────────────────

  /**
   * Apply an approved proposal that was previously stored as awaiting_approval.
   *
   * After the approval gate resolves an "awaiting_approval" proposal to "approved"
   * externally, the caller invokes this to finalize the apply under CAS protection.
   *
   * Steps:
   *   1. Reload run + proposal
   *   2. Revalidate fingerprints (expectedPlanRevision must match)
   *   3. Consume the approval
   *   4. Apply via ReplanApplier (CAS)
   *   5. Persist outcome
   */
  async applyApprovedProposal(
    runId: string,
    proposalId: string,
    approvalId: string,
  ): Promise<ServiceResult> {
    // ── 1. Reload run + proposal ─────────────────────────────────────
    const [run, proposal] = await Promise.all([
      this.options.store.load(runId),
      this.options.proposalStore.load(runId, proposalId),
    ]);

    if (!run) {
      return { status: "failed", errors: [`Coordination run not found: ${runId}`] };
    }
    if (!proposal) {
      return { status: "failed", errors: [`Proposal not found: ${proposalId}`] };
    }

    // Verify proposal is in a state that can be applied
    if (proposal.status !== "approved" && proposal.status !== "awaiting_approval") {
      return {
        status: "failed",
        proposalId,
        errors: [`Proposal is in "${proposal.status}" state, cannot apply`],
      };
    }

    // ── 2. Revalidate fingerprints ───────────────────────────────────

    if (proposal.expectedPlanRevision !== (run.planRevision ?? 0)) {
      await this.options.proposalStore.updateStatus(runId, proposalId, "failed", {
        error: `planRevision mismatch: expected ${proposal.expectedPlanRevision}, got ${run.planRevision}`,
      }).catch(() => {});
      return {
        status: "failed",
        proposalId,
        errors: [
          `planRevision mismatch: expected ${proposal.expectedPlanRevision}, got ${run.planRevision}`,
        ],
      };
    }

    // ── 3. Consume the approval ─────────────────────────────────────

    const draftFingerprint = proposal.draftFingerprint;
    const bindingKey = `replan:${runId}:${draftFingerprint}`;

    try {
      const consumeResult = await this.options.approvalGate.consumeApproved(
        approvalId,
        bindingKey,
        runId,
      );

      if (!consumeResult.consumed) {
        await this.options.proposalStore.updateStatus(runId, proposalId, "failed", {
          error: "Approval consumption failed — already consumed or not found",
        }).catch(() => {});
        return {
          status: "failed",
          proposalId,
          errors: ["Approval could not be consumed — already consumed or not found"],
        };
      }
    } catch (err) {
      await this.options.proposalStore.updateStatus(runId, proposalId, "failed", {
        error: `Approval consumption error: ${coerceError(err)}`,
      }).catch(() => {});
      return {
        status: "failed",
        proposalId,
        errors: [`Approval consumption failed: ${coerceError(err)}`],
      };
    }

    // ── 4. Apply via ReplanApplier ─────────────────────────────────

    return this.applyInternal(
      { ...proposal, approvalId },
      proposal.draft,
      proposal.simulatedGraph ?? EMPTY_SIMULATED,
      proposal.expectedPlanRevision,
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Internal apply: runs ReplanApplier.apply() and persists the outcome.
   * Assumes fingerprints and approvals have been checked by the caller.
   */
  private async applyInternal(
    proposal: ProposalRecord,
    draft: PlanRevisionDraft,
    simulatedGraph: SimulatedGraph,
    expectedPlanRevision: number,
  ): Promise<ServiceResult> {
    try {
      const applyResult = await this.options.applier.apply(
        draft,
        simulatedGraph,
        proposal.runId,
      );

      if (!applyResult.applied) {
        const errMsg = applyResult.errors.join("; ") || "CAS conflict — planRevision mismatch";

        await this.options.proposalStore.updateStatus(
          proposal.runId, proposal.id, "failed",
          { error: errMsg },
        ).catch(() => {});
        await this.restoreRunStatus(proposal.runId);

        return {
          status: "failed",
          proposalId: proposal.id,
          errors: [errMsg],
        };
      }

      // Success: update proposal status
      await this.options.proposalStore.updateStatus(
        proposal.runId, proposal.id, "applied",
        { approvalId: proposal.approvalId },
      ).catch(() => {});

      return {
        status: "applied",
        proposalId: proposal.id,
        approvalId: proposal.approvalId,
        run: applyResult.run ?? undefined,
        revision: applyResult.revision ?? undefined,
        errors: [],
      };
    } catch (err) {
      await this.options.proposalStore.updateStatus(
        proposal.runId, proposal.id, "failed",
        { error: `Apply error: ${coerceError(err)}` },
      ).catch(() => {});
      await this.restoreRunStatus(proposal.runId);

      return {
        status: "failed",
        proposalId: proposal.id,
        errors: [`Apply failed: ${coerceError(err)}`],
      };
    }
  }

  /**
   * Fall back to the mechanical CollaborativePlanner.replan() when no
   * model adapter is configured.
   */
  private async executeMechanicalFallback(
    runId: string,
    trigger: PlanTriggerKind,
    evidence: TriggerEvidence,
  ): Promise<ServiceResult> {
    if (!this.options.mechanicalReplanner) {
      return {
        status: "failed",
        errors: ["No model adapter configured and no mechanical replanner available"],
      };
    }

    try {
      const mappedTrigger =
        trigger === "worker_failed" ? "worker_failed" as const :
        trigger === "conflict_detected" ? "conflict_detected" as const :
        "worker_completed" as const;

      const result = await this.options.mechanicalReplanner.replan(runId, {
        triggeredBy: mappedTrigger,
        workerId: evidence.workerId,
      });

      if (result.applied && result.run) {
        return {
          status: "applied",
          run: result.run,
          revision: result.revision ?? undefined,
          errors: [],
        };
      }

      return {
        status: "failed",
        errors: result.errors.length > 0
          ? result.errors
          : ["Mechanical replan did not apply (CAS conflict or no action needed)"],
      };
    } catch (err) {
      return {
        status: "failed",
        errors: [`Mechanical replan error: ${coerceError(err)}`],
      };
    }
  }

  /**
   * Restore the run from "replanning" to a safe computed status.
   * This prevents the run from being stranded after a failure.
   */
  private async restoreRunStatus(runId: string): Promise<void> {
    try {
      await this.options.store.updateRun(runId, (run) => {
        // Temporarily override to bypass the replanning guard in recomputeRunStatus
        run.status = "running";
        run.status = recomputeRunStatus(run);
      });
    } catch {
      // Best-effort — run recovery is important but not critical enough to throw
    }
  }

  /**
   * Persist a proposal record best-effort (never throws).
   */
  private async persistBestEffort(proposal: ProposalRecord): Promise<void> {
    try {
      await this.options.proposalStore.create(proposal);
    } catch {
      // Best-effort — persistence failure doesn't change the recovery path
    }
  }
}

// ─── Helper ─────────────────────────────────────────────────────────────

function coerceError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
