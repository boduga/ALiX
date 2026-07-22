/**
 * approval-manager.ts — TUI commands for approval lifecycle.
 *
 * Parses /approvals, /approve, /deny commands.
 * Follows the same pattern as WorkspaceManager.
 */

import type { ApprovalSnapshot, ApprovalRecordSnapshot } from './snapshot.js';

export type ApprovalManagerResult =
  | { handled: false }
  | { handled: true; message: string; action?: "approved" | "denied"; approvalId?: string };

export interface ApprovalManagerDeps {
  listPendingApprovals(): Promise<Array<{ id: string; capabilities?: string[]; reason: string; toolId?: string; createdAt: string }>>;
  resolveApproval(id: string, status: "approved" | "denied"): Promise<{ success: boolean; message: string }>;
}

const APPROVAL_PREFIXES = ["/approvals", "/approval"] as const;

/**
 * Extract a file path or command target from the approval reason string.
 * The policy gate embeds the target inside the reason for several rule
 * kinds (e.g. "Path is protected: /tmp/foo", "Command is denied: rm -rf").
 * When no embedded target is found, returns undefined so callers can fall
 * back to the raw reason text.
 */
function extractTarget(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  // "Path is protected: <path>" / "Command is denied: <cmd>" / "Command '<cmd>'..."
  const colonMatch = reason.match(/:\s+(.+)$/);
  if (colonMatch?.[1]) return colonMatch[1].trim();
  return undefined;
}

export class ApprovalManager {
  private deps: ApprovalManagerDeps;

  constructor(deps: ApprovalManagerDeps) {
    this.deps = deps;
  }

  async tryHandleCommand(input: string): Promise<ApprovalManagerResult> {
    const trimmed = input.trim();

    // /approvals or /approval — list pending
    if ((APPROVAL_PREFIXES as readonly string[]).includes(trimmed)) {
      return this.handleList();
    }

    // /approve <id> or /approve (exact, no arg)
    if (trimmed.startsWith("/approve ") || trimmed === "/approve") {
      const id = trimmed === "/approve" ? "" : trimmed.slice(9).trim();
      if (!id) return { handled: true, message: "Usage: /approve <approval-id>" };
      return this.handleResolve(id, "approved");
    }

    // /deny <id> or /deny (exact, no arg)
    if (trimmed.startsWith("/deny ") || trimmed === "/deny") {
      const id = trimmed === "/deny" ? "" : trimmed.slice(6).trim();
      if (!id) return { handled: true, message: "Usage: /deny <approval-id>" };
      return this.handleResolve(id, "denied");
    }

    return { handled: false };
  }

  private async handleList(): Promise<ApprovalManagerResult> {
    const pending = await this.deps.listPendingApprovals();
    if (pending.length === 0) {
      return { handled: true, message: "No pending approvals." };
    }
    const lines = pending.map(a =>
      `  ${a.id} — ${(a.capabilities?.[0]) ?? "unknown"} (${a.reason})` +
      ` — created ${new Date(a.createdAt).toLocaleString()}`
    );
    return {
      handled: true,
      message: `Pending approvals:\n${lines.join("\n")}`,
    };
  }

  private async handleResolve(id: string, status: "approved" | "denied"): Promise<ApprovalManagerResult> {
    const result = await this.deps.resolveApproval(id, status);
    return {
      handled: true,
      message: result.message,
      action: status,
      approvalId: id,
    };
  }

  /**
   * Build an ApprovalSnapshot from current state.
   * recentlyResolved is always empty — resolution tracking is deferred.
   */
  async snapshot(): Promise<ApprovalSnapshot> {
    const pending = await this.deps.listPendingApprovals();
    return {
      pending: pending.map(r => ({
        id: r.id,
        toolName: r.capabilities?.[0] ?? 'unknown',
        // Derive a target path from the reason string when it embeds one
        // (e.g. "Path is protected: /tmp/foo"). Fall back to the raw
        // reason so the operator can always see *something* to approve.
        targetPath: extractTarget(r.reason) ?? r.reason ?? '',
        args: {},
        requestedAt: Date.parse(r.createdAt) || Date.now(),
        requestedBy: 'system',
      })),
      recentlyResolved: [],
      totalPending: pending.length,
      totalResolved: 0,
    };
  }
}
