/**
 * X4.4 — Execution Rollback Handler
 *
 * Executes a RollbackIntent as a governed execution through the full
 * lifecycle state machine. The rollback action follows the same lifecycle
 * as a regular execution (CREATED → VALIDATING → READY → RUNNING →
 * SUCCEEDED) and, on success, transitions the original FAILED execution
 * to ROLLED_BACK.
 *
 * X4 does not decide when rollback is appropriate — that decision belongs
 * to governance. This handler records and executes the supplied
 * RollbackIntent.
 *
 * @invariant Original execution must be in FAILED state.
 * @invariant Rollback follows the governed execution lifecycle.
 * @invariant Rollback evidence links to the original execution.
 * @invariant Original execution only transitions to ROLLED_BACK after
 *   rollback execution succeeds.
 */

import {
  ExecutionState,
  IllegalStateTransitionError,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
  type ExecutionResult,
  type RollbackIntent,
} from "./contracts/execution-runtime-contract.js";
import type { ExecutionIntent, ExecutionEvidence } from "./contracts/execution-intent-contract.js";
import { ExecutionStateMachine } from "./execution-state-machine.js";
import { CancellationToken, ExecutionCancelledError } from "./cancellation-token.js";

// ---------------------------------------------------------------------------
// Evidence ID generation
// ---------------------------------------------------------------------------

const ROLLBACK_LINK_PREFIX = "rlink-";
let rollbackLinkCounter = 0;

function generateLinkageId(): string {
  rollbackLinkCounter++;
  return `${ROLLBACK_LINK_PREFIX}${Date.now().toString(36)}-${rollbackLinkCounter}`;
}

// ---------------------------------------------------------------------------
// ExecutionRollbackHandler
// ---------------------------------------------------------------------------

export class ExecutionRollbackHandler {
  constructor(
    private readonly stateMachine: ExecutionStateMachine,
    private readonly emitter: ExecutionEvidenceEmitter,
  ) {}

  /**
   * Execute a rollback as a governed execution.
   *
   * Flow:
   * 1. Validate original execution is FAILED
   * 2. Build a rollback ExecutionIntent from RollbackIntent
   * 3. Create a new rollback execution through the state machine
   * 4. Drive through lifecycle: CREATED → VALIDATING → READY → RUNNING
   * 5. Execute the rollback action (if executor provided)
   * 6. On success, transition original FAILED → ROLLED_BACK via
   *    linkage evidence
   * 7. On failure, original stays FAILED, rollback is FAILED
   *
   * @param originalExecutionId - The FAILED execution to roll back.
   * @param rollbackIntent - Describes the rollback action and reason.
   * @param rollbackAction - Optional async function performing the
   *   actual rollback work. Returns true on success. Receives a
   *   CancellationToken for cooperative cancellation.
   * @returns Result of the rollback execution.
   * @throws {IllegalStateTransitionError} If original is not FAILED.
   */
  async rollback(
    originalExecutionId: string,
    rollbackIntent: RollbackIntent,
    rollbackAction?: (token?: CancellationToken) => Promise<boolean>,
  ): Promise<ExecutionResult> {
    // 1. Validate original is FAILED
    const originalStatus = this.stateMachine.getStatus(originalExecutionId);
    if (originalStatus !== ExecutionState.FAILED) {
      throw new IllegalStateTransitionError(originalExecutionId, originalStatus, ExecutionState.ROLLED_BACK);
    }

    // 2. Build rollback ExecutionIntent
    const rollbackExecIntent = this.buildRollbackExecutionIntent(
      originalExecutionId,
      rollbackIntent,
    );
    const token = new CancellationToken();

    // 3. Create rollback execution (new lifecycle)
    const rollbackExId = this.stateMachine.createExecution(rollbackExecIntent);

    // 4. Drive through lifecycle to RUNNING
    this.stateMachine.transitionTo(rollbackExId, ExecutionState.VALIDATING);
    this.stateMachine.transitionTo(rollbackExId, ExecutionState.READY);
    this.stateMachine.transitionTo(rollbackExId, ExecutionState.RUNNING);

    // 5. Execute the rollback action
    let success: boolean;
    try {
      success = rollbackAction ? await rollbackAction(token) : true;
    } catch (err) {
      if (err instanceof ExecutionCancelledError) {
        this.stateMachine.transitionTo(rollbackExId, ExecutionState.FAILED);
        return this.buildResult(rollbackExId, rollbackIntent, ExecutionState.FAILED);
      }
      success = false;
    }

    if (success) {
      // 6a. Rollback succeeded — mark rollback execution SUCCEEDED
      this.stateMachine.transitionTo(rollbackExId, ExecutionState.SUCCEEDED);

      // 6b. Emit linkage evidence connecting rollback to original
      const linkageEvidence = this.buildLinkageEvidence(
        originalExecutionId,
        rollbackExId,
        rollbackIntent,
        true,
      );
      this.emitter.emit("ExecutionRollbackCompleted", linkageEvidence);

      // 6c. Transition original FAILED → ROLLED_BACK
      this.stateMachine.transitionTo(originalExecutionId, ExecutionState.ROLLED_BACK);

      return this.buildResult(rollbackExId, rollbackIntent, ExecutionState.SUCCEEDED);
    }

    // 7. Rollback failed — mark rollback as FAILED, original stays FAILED
    this.stateMachine.transitionTo(rollbackExId, ExecutionState.FAILED);
    const failEvidence = this.buildLinkageEvidence(
      originalExecutionId,
      rollbackExId,
      rollbackIntent,
      false,
    );
    this.emitter.emit("ExecutionRollbackCompleted", failEvidence);

    return this.buildResult(rollbackExId, rollbackIntent, ExecutionState.FAILED);
  }

  // -----------------------------------------------------------------------
  // Internal — helpers
  // -----------------------------------------------------------------------

  /**
   * Build a minimal ExecutionIntent for the rollback action from
   * the supplied RollbackIntent and original execution context.
   */
  private buildRollbackExecutionIntent(
    originalExecutionId: string,
    rollbackIntent: RollbackIntent,
  ): ExecutionIntent {
    const now = new Date().toISOString();
    return {
      intentId: `rollback-${originalExecutionId}`,
      proposalId: "",
      actor: "rollback-handler",
      action: `rollback:${rollbackIntent.action}`,
      target: originalExecutionId,
      justification: `Rollback of ${originalExecutionId}: ${rollbackIntent.reason}`,
      constraints: {
        maxFilesChanged: 100,
        allowedPaths: [],
        blockedPaths: [],
        verificationRequired: true,
        allowedTools: [],
      },
      riskClass: "medium",
      expectedEffect: `Undo execution ${originalExecutionId}`,
      sourceEvidenceId: rollbackIntent.sourceEvidenceId,
      createdAt: now,
      expiration: "",
      approvalReference: "",
      approvedBy: "",
      approvedAt: "",
      intentHash: "",
    };
  }

  /**
   * Build linkage evidence connecting rollback execution to original.
   */
  private buildLinkageEvidence(
    originalExecutionId: string,
    rollbackExId: string,
    rollbackIntent: RollbackIntent,
    succeeded: boolean,
  ): ExecutionEvidence {
    const now = new Date().toISOString();
    return {
      evidenceId: generateLinkageId(),
      intentId: rollbackIntent.intentId,
      startedAt: now,
      completedAt: now,
      outcome: succeeded ? "PARTIAL" : "FAILED",
      summary: `Rollback ${succeeded ? "completed" : "failed"} for execution ${originalExecutionId} via ${rollbackExId}: ${rollbackIntent.reason}`,
      artifacts: [],
      verificationPassed: succeeded,
      evidenceHash: "",
    };
  }

  /**
   * Build an ExecutionResult from the rollback execution.
   */
  private buildResult(
    rollbackExId: string,
    rollbackIntent: RollbackIntent,
    state: ExecutionState.SUCCEEDED | ExecutionState.FAILED,
  ): ExecutionResult {
    return {
      executionId: rollbackExId,
      intentId: rollbackIntent.intentId,
      state,
      evidenceId: this.stateMachine.getLatestEvidenceId(rollbackExId),
    };
  }
}
