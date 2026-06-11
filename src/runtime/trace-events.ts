/**
 * trace-events.ts — Normalize runtime events into a unified TraceEvent shape.
 *
 * Converts policy.decision, approval.*, continuation.*, tool.*, and task.*
 * events into a common format for the Trace TUI panel.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type TraceSourceType =
  | "policy"
  | "approval"
  | "continuation"
  | "tool"
  | "task"
  | "session"
  | "daemon"
  | "runtime"
  | "replay";

export type TraceEventFilter = "all" | TraceSourceType;

export type TraceDetailMode = "summary" | "json" | "links" | "chain" | "replay";

export type TraceSelectionState = {
  selectedIndex: number;     // -1 = nothing selected
  selectedTraceId?: string;
  detailOpen: boolean;
  detailMode: TraceDetailMode;
};

export type TraceEvent = {
  id: string;
  timestamp: string;
  sourceType: TraceSourceType;
  eventType: string;
  label: string;
  status?: "pending" | "allowed" | "denied" | "running" | "success" | "failed" | "completed";
  detail?: string;
  sessionId?: string;
  taskId?: string;
  approvalId?: string;
  continuationId?: string;
  toolCallId?: string;
  capability?: string;
  toolName?: string;
  rawEvent?: unknown;           // full source event for JSON drilldown view
  sessionFilePath?: string;     // path to session events.jsonl on disk
};

// ─── Normalizer ──────────────────────────────────────────────────────

/**
 * Normalize a raw API-style runtime event into a TraceEvent.
 * Returns null if the event type has no trace mapping.
 */
export function toTraceEvent(event: {
  type?: string;
  action?: string;
  timestamp?: string;
  id?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}): TraceEvent | null {
  const ts = event.timestamp || (event as any).createdAt || new Date().toISOString();
  const id = event.id || `${event.type || event.action}_${Date.now()}`;
  // Accept both `type` (EventLog) and `action` (RuntimeIndexEvent)
  const type = (event.type || event.action || "").replace(/^tool\./, "tool.");
  const payload = event.payload || {};
  const rawEvent = event;

  // Policy
  if (type === "policy.decision") {
    const decision = (payload as any).decision;
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "policy",
      eventType: type,
      label: `policy: ${(payload as any).capability || "?"}`,
      status: decision === "allow" ? "allowed" : decision === "deny" ? "denied" : "pending",
      detail: (payload as any).reason,
      sessionId: (payload as any).sessionId,
      capability: (payload as any).capability,
    };
  }

  // Approval lifecycle
  if (type.startsWith("approval.")) {
    const p = payload as any;
    const statusMap: Record<string, string> = {
      "approval.created": "pending",
      "approval.reused": "pending",
      "approval.resolved": p.status === "approved" ? "success" : "denied",
      "approval.resumed": "success",
      "approval.resume.failed": "failed",
    };
    const labelMap: Record<string, string> = {
      "approval.created": "approval created",
      "approval.reused": "approval reused",
      "approval.resolved": `approval ${p.status || "resolved"}`,
      "approval.resumed": "approval resumed",
      "approval.resume.failed": "approval resume failed",
    };
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "approval",
      eventType: type,
      label: `${labelMap[type] || type}`,
      status: (statusMap[type] || "pending") as any,
      detail: p.reason || "",
      sessionId: p.sessionId,
      approvalId: p.approvalId,
      capability: p.capability,
      toolName: p.toolName,
    };
  }

  // Continuation lifecycle
  if (type.startsWith("continuation.")) {
    const p = payload as any;
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "continuation",
      eventType: type,
      label: type === "continuation.created" ? "continuation created" : "continuation consumed",
      status: type === "continuation.created" ? "pending" : "success",
      detail: p.reason || "",
      sessionId: p.sessionId,
      approvalId: p.approvalId,
      continuationId: p.continuationId || p.approvalId,
      toolName: p.toolName,
    };
  }

  // Tool lifecycle
  if (type.startsWith("tool.")) {
    const p = payload as any;
    const statusMap: Record<string, string> = {
      "tool.requested": "pending",
      "tool.started": "running",
      "tool.completed": "success",
      "tool.failed": "failed",
      "tool.output": "running",
    };
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "tool",
      eventType: type,
      label: `${p.toolName || "tool"} ${type.replace("tool.", "")}`,
      status: (statusMap[type] || "pending") as any,
      detail: p.error || p.outputPreview || "",
      sessionId: p.sessionId,
      toolCallId: p.toolCallId,
      toolName: p.toolName,
      capability: p.capability || p.canonicalCapability,
    };
  }

  // Task events (from daemon or runtime)
  if (type.startsWith("task.") || type === "task") {
    const p = payload as any;
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "task",
      eventType: type,
      label: p?.task || type,
      status: type.includes("completed") || type.includes("done") ? "completed" : "running",
      detail: p?.error || "",
      sessionId: p?.sessionId,
      taskId: p?.id || p?.taskId,
    };
  }

  // Replay lifecycle
  if (type.startsWith("replay.")) {
    const p = payload as any;
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "replay",
      eventType: type,
      label: `replay ${type.replace("replay.", "")}`,
      status: type.includes("blocked") || type.includes("failed") ? "failed" : "success",
      detail: p.reason || p.blockReason || "",
      sessionId: p.sessionId,
    };
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert an array of event-like objects into a sorted TraceEvent array.
 */
export function traceEventsFromLog(events: any[], sessionFilePath?: string): TraceEvent[] {
  const traces: TraceEvent[] = [];
  for (const e of events) {
    const t = toTraceEvent(e);
    if (t) {
      if (sessionFilePath) t.sessionFilePath = sessionFilePath;
      traces.push(t);
    }
  }
  // Sort chronologically (oldest first)
  return traces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/** Find events related to a selected trace event by shared entity IDs. */
export function traceChainContext(
  allEvents: TraceEvent[],
  selected: TraceEvent,
  maxResults = 12,
): TraceEvent[] {
  const related = new Map<string, TraceEvent>();
  const addIfMissing = (t: TraceEvent) => { if (!related.has(t.id)) related.set(t.id, t); };

  // Priority 1: same toolCallId
  if (selected.toolCallId) {
    for (const e of allEvents) {
      if (e.toolCallId === selected.toolCallId) addIfMissing(e);
    }
  }

  // Priority 2: same approvalId
  if (selected.approvalId && related.size < maxResults) {
    for (const e of allEvents) {
      if (e.approvalId === selected.approvalId) addIfMissing(e);
    }
  }

  // Priority 3: same continuationId
  if (selected.continuationId && related.size < maxResults) {
    for (const e of allEvents) {
      if (e.continuationId === selected.continuationId) addIfMissing(e);
    }
  }

  // Priority 4: same sessionId within ±5 minute window
  if (selected.sessionId && related.size < maxResults) {
    const selectedTime = new Date(selected.timestamp).getTime();
    for (const e of allEvents) {
      if (e.sessionId === selected.sessionId) {
        const eventTime = new Date(e.timestamp).getTime();
        if (Math.abs(eventTime - selectedTime) < 300_000) addIfMissing(e);
      }
    }
  }

  // Exclude self, sort chronologically
  related.delete(selected.id);
  return [...related.values()]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(0, maxResults);
}

/**
 * Format a TraceEvent into a single-line display string.
 */
export function formatTraceEvent(t: TraceEvent): string {
  const time = new Date(t.timestamp).toLocaleTimeString();
  const iconMap: Record<string, string> = {
    allowed: "●",
    denied: "✗",
    pending: "○",
    running: "▶",
    success: "✔",
    failed: "✗",
    completed: "✔",
  };
  const icon = t.status ? (iconMap[t.status] || " ") : " ";
  const src = t.sourceType.padEnd(14);
  const label = t.label.slice(0, 50);
  return `  ${time}  ${icon} ${src} ${label}`;
}
