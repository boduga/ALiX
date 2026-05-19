import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { EventLog } from "../events/event-log.js";
import { POLICY_EVENT_TYPES } from "../events/types.js";
import type { ApprovalRequestedPayload, ApprovalResolvedPayload } from "../events/types.js";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type Approval = {
  id: string;
  prompt: string;
  status: ApprovalStatus;
};

export type ApprovalRequest = {
  toolCallId?: string;
  patchProposalId?: string;
  prompt: string;
};

export type ApprovalResult = {
  decision: "approved" | "denied" | "edited";
  reason?: string;
};

export type ApprovalManagerOptions = {
  eventLog?: EventLog;
  sessionId?: string;
  /** Custom prompt function for testing (defaults to readline promptUser) */
  promptFn?: (prompt: string) => Promise<string>;
};

export class ApprovalManager {
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

  constructor(private options: ApprovalManagerOptions = {}) {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    const approvalId = generateApprovalId();

    // Emit approval.requested
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "system",
        type: POLICY_EVENT_TYPES.APPROVAL_REQUESTED,
        payload: {
          approvalId,
          toolCallId: request.toolCallId,
          patchProposalId: request.patchProposalId,
          prompt: request.prompt,
          choices: ["approve", "deny", "edit"],
        } as ApprovalRequestedPayload,
      });
    }

    this.pendingApprovals.set(approvalId, request);

    // Prompt user (blocking) - use injected function if available
    const promptFn = this.options.promptFn ?? promptUser;
    const userChoice = await promptFn(request.prompt);
    const result = this.resolveUserChoice(userChoice);

    // Remove from pending
    this.pendingApprovals.delete(approvalId);

    // Emit approval.resolved
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "user",
        type: POLICY_EVENT_TYPES.APPROVAL_RESOLVED,
        payload: {
          approvalId,
          decision: result.decision,
          reason: result.reason,
        } as ApprovalResolvedPayload,
      });
    }

    return result;
  }

  private resolveUserChoice(choice: string): ApprovalResult {
    if (choice === "y" || choice === "yes" || choice === "approve") {
      return { decision: "approved" };
    }
    if (choice === "e" || choice === "edit") {
      return { decision: "edited" };
    }
    return { decision: "denied", reason: "User denied" };
  }

  getPendingCount(): number {
    return this.pendingApprovals.size;
  }
}

export class ApprovalQueue {
  private approvals = new Map<string, Approval>();

  request(prompt: string): Approval {
    const approval = { id: randomUUID(), prompt, status: "pending" as const };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  resolve(id: string, status: Exclude<ApprovalStatus, "pending">): Approval {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error(`Unknown approval: ${id}`);
    if (approval.status !== "pending") return approval;
    const resolved = { ...approval, status };
    this.approvals.set(id, resolved);
    return resolved;
  }

  pending(): Approval[] {
    return Array.from(this.approvals.values()).filter((approval) => approval.status === "pending");
  }
}

function generateApprovalId(): string {
  return `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function promptUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(`${prompt} [y/n/e]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}
