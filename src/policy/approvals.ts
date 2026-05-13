import { randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type Approval = {
  id: string;
  prompt: string;
  status: ApprovalStatus;
};

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
