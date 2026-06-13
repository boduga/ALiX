/**
 * continuation-manager.ts — Resume blocked tool calls after approval.
 *
 * Verifies approval status, argsHash integrity, then re-executes the
 * original tool call. Each continuation is one-shot — removed on resume.
 */

import type { ApprovalStore } from "../approvals/approval-store.js";
import type { ContinuationStore } from "./continuation-store.js";
import type { EventLog } from "../events/event-log.js";

export interface ContinuationManagerDeps {
  continuationStore: ContinuationStore;
  approvalStore: ApprovalStore;
  eventLog?: EventLog;
  executeTool: (toolCall: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    agentId?: string;
    source?: string;
  }) => Promise<{ kind: string; output?: string; content?: string; message?: string }>;
}

export class ContinuationManager {
  constructor(private deps: ContinuationManagerDeps) {}

  /**
   * Resume a blocked tool call after approval.
   * Returns the tool result or an error message.
   */
  async resumeApproved(approvalId: string): Promise<{ resumed: boolean; output?: string; error?: string }> {
    // 1. Verify approval is actually approved
    const approval = this.deps.approvalStore.get(approvalId);
    if (!approval) {
      return { resumed: false, error: `Approval not found: ${approvalId}` };
    }
    if (approval.status !== "approved") {
      return { resumed: false, error: `Approval ${approvalId} status is '${approval.status}', not 'approved'` };
    }

    // 2. Look up continuation
    const cont = this.deps.continuationStore.findByApprovalId(approvalId);
    if (!cont) {
      return { resumed: false, error: `No continuation record for approval: ${approvalId}` };
    }
    if (cont.kind !== "tool" || !cont.toolCall) {
      return { resumed: false, error: `Continuation '${cont.kind}' cannot be resumed (only 'tool' supported in M0.30)` };
    }

    // 2b. Check for migration issues (legacy continuations without agentId)
    if (cont.migrationIssue === "missing-agent-identity") {
      return {
        resumed: false,
        error: `This continuation was created by an older version and lacks agent identity. ` +
          `Cannot resume under ownership enforcement. Please re-run the tool manually.`,
      };
    }

    // 3. Verify argsHash integrity
    const { hashArgs } = await import("../tools/executor.js");
    const currentHash = hashArgs(cont.toolCall.args);
    if (currentHash !== cont.toolCall.argsHash) {
      // Emit resume.failed — args mismatch
      if (this.deps.eventLog) {
        await this.deps.eventLog.append({
          sessionId: cont.sessionId,
          actor: "policy",
          type: "approval.resume.failed",
          payload: {
            approvalId,
            sessionId: cont.sessionId,
            capability: cont.toolCall.capability,
            toolName: cont.toolCall.name,
            status: "failed" as const,
            reason: `Args hash mismatch — expected ${cont.toolCall.argsHash}, got ${currentHash}`,
            argsHash: currentHash,
          },
        }).catch(() => {});
      }
      return { resumed: false, error: `Args hash mismatch — expected ${cont.toolCall.argsHash}, got ${currentHash}. Continuation rejected for safety.` };
    }

    // 4. Remove continuation (one-shot)
    await this.deps.continuationStore.remove(approvalId);

    // 5. Re-execute (pass agentId through for ownership check)
    const result = await this.deps.executeTool({
      ...cont.toolCall,
      source: "continuation-resume",
    });
    if (result.kind === "success") {
      // Emit approval.resumed + continuation.consumed
      if (this.deps.eventLog) {
        await this.deps.eventLog.append({
          sessionId: cont.sessionId,
          actor: "policy",
          type: "approval.resumed",
          payload: {
            approvalId,
            continuationId: approvalId,
            requestId: cont.toolCall.toolCallId,
            sessionId: cont.sessionId,
            capability: cont.toolCall.capability,
            toolName: cont.toolCall.name,
            status: "resumed" as const,
            cwd: cont.cwd,
            argsHash: cont.toolCall.argsHash,
          },
        }).catch(() => {});
        await this.deps.eventLog.append({
          sessionId: cont.sessionId,
          actor: "policy",
          type: "continuation.consumed",
          payload: {
            approvalId,
            continuationId: approvalId,
            requestId: cont.toolCall.toolCallId,
            sessionId: cont.sessionId,
            capability: cont.toolCall.capability,
            toolName: cont.toolCall.name,
            status: "resumed" as const,
            cwd: cont.cwd,
            argsHash: cont.toolCall.argsHash,
          },
        }).catch(() => {});
      }
      return { resumed: true, output: result.output || result.content || "(tool completed)" };
    }

    // Emit resume.failed — tool execution error
    if (this.deps.eventLog) {
      await this.deps.eventLog.append({
        sessionId: cont.sessionId,
        actor: "policy",
        type: "approval.resume.failed",
        payload: {
          approvalId,
          sessionId: cont.sessionId,
          capability: cont.toolCall.capability,
          toolName: cont.toolCall.name,
          status: "failed" as const,
          reason: result.kind === "error" ? result.message : "Tool request denied",
        },
      }).catch(() => {});
    }
    return { resumed: false, error: result.kind === "error" ? result.message : "Tool request denied" };
  }
}
