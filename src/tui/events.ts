import type { TuiStore } from "./store.js";
import type { AgentState, SubagentNode, ApprovalRequest } from "./store.js";

/**
 * Simple event structure for bridging
 */
export interface TuiEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Bridge events to TuiStore state
 */
export class EventLogBridge {
  constructor(private store: TuiStore) {}

  /**
   * Apply a single event to the store
   */
  applyEvent(type: string, payload: Record<string, unknown>): void {
    switch (type) {
      case "session.started":
        this.store.setSessionId(payload.sessionId as string);
        break;

      case "agent.state_changed":
        this.store.setAgentState(payload.state as AgentState);
        if (payload.reasoning) {
          this.store.setAgentReasoning(payload.reasoning as string);
        }
        break;

      case "subagent.started":
        this.store.addSubagent({
          id: payload.id as string,
          role: payload.role as SubagentNode["role"],
          task: payload.task as string,
          status: "running",
          startedAt: Date.now(),
        });
        break;

      case "subagent.result":
        this.store.updateSubagent(payload.id as string, {
          status: payload.status as "completed" | "failed",
          findings: payload.findings as string[],
          endedAt: Date.now(),
        });
        break;

      case "tool.requested":
        this.store.setPendingApproval({
          tool: payload.tool as string,
          command: payload.command as string,
          reason: payload.reason as string,
        });
        break;

      case "tool.approved":
      case "tool.denied":
        this.store.clearPendingApproval();
        break;

      case "diff.created":
        this.store.addDiff({
          path: payload.path as string,
          before: payload.before as string ?? "",
          after: payload.after as string ?? "",
          timestamp: Date.now(),
        });
        break;
    }
  }
}