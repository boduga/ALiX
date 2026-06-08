import type { AlixEvent, InspectorComparison, InspectorContextItem, InspectorSnapshot } from "../events/types.js";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function contextItems(value: unknown): InspectorContextItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is InspectorContextItem => {
    const record = asRecord(item);
    return typeof record.path === "string" && typeof record.kind === "string";
  });
}

function commandFromPayload(payload: UnknownRecord): string | undefined {
  const argsPreview = asRecord(payload.argsPreview);
  return optionalString(argsPreview.command);
}

function findByToolCallId<T extends { toolCallId?: string }>(items: T[], toolCallId: string | undefined): T | undefined {
  return toolCallId ? items.find((item) => item.toolCallId === toolCallId) : undefined;
}

function statusForEndedSession(reason: string | undefined): InspectorSnapshot["summary"]["status"] {
  return reason === "completed" ? "completed" : "failed";
}

function verificationSummary(snapshot: InspectorSnapshot): string {
  if (snapshot.verification.length === 0) return "none";

  const statuses = new Set(snapshot.verification.map((item) => item.status ?? "unknown"));
  if (statuses.size === 1) {
    const [status] = statuses;
    return status ?? "unknown";
  }
  return "mixed";
}

function changedFileSet(snapshot: InspectorSnapshot): Set<string> {
  return new Set(snapshot.diffs.flatMap((diff) => diff.changedFiles));
}

function sortedValues(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function checkpointFilesFromPayload(payload: UnknownRecord): string[] {
  const files = stringArray(payload.files);
  return files.length > 0 ? files : stringArray(payload.checkpointFiles);
}

export function buildInspectorSnapshot(sessionId: string, events: AlixEvent[]): InspectorSnapshot {
  const snapshot: InspectorSnapshot = {
    sessionId,
    summary: {
      eventCount: events.length,
      status: "unknown",
      latestSeq: events.at(-1)?.seq
    },
    timeline: events,
    diffs: [],
    terminal: [],
    approvals: [],
    verification: [],
    tokens: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      entries: []
    }
  };

  for (const event of events) {
    const payload = asRecord(event.payload);
    const toolCallId = optionalString(payload.toolCallId);
    const toolName = optionalString(payload.toolName);

    switch (event.type) {
      case "session.started":
        snapshot.summary.status = "running";
        snapshot.summary.startedAt ??= event.timestamp;
        break;
      case "session.ended": {
        const reason = optionalString(payload.reason);
        snapshot.summary.status = statusForEndedSession(reason);
        snapshot.summary.reason = reason;
        snapshot.summary.endedAt = event.timestamp;
        break;
      }
      case "context.bundle_compiled": {
        const budget = asRecord(payload.budget);
        const maxTokens = budget.maxTokens;
        const usedTokens = budget.usedTokens;
        snapshot.context = {
          taskType: optionalString(payload.taskType),
          budget:
            typeof maxTokens === "number" && typeof usedTokens === "number"
              ? { maxTokens, usedTokens }
              : undefined,
          primaryFiles: contextItems(payload.primaryFiles),
          tests: contextItems(payload.tests),
          supportingFiles: contextItems(payload.supportingFiles),
          pinned: contextItems(payload.pinned)
        };
        break;
      }
      case "tool.requested":
        if (toolName === "shell.run") {
          const command = commandFromPayload(payload);
          if (command) snapshot.terminal.push({ toolCallId, command });
        }
        break;
      case "tool.completed":
      case "tool.failed":
        if (toolName === "shell.run") {
          const terminal = findByToolCallId(snapshot.terminal, toolCallId);
          if (terminal) {
            const status = optionalString(payload.status);
            const outputPreview = optionalString(payload.outputPreview);
            const error = optionalString(payload.error);
            if (status) terminal.status = status;
            if (outputPreview) terminal.outputPreview = outputPreview;
            if (error) terminal.error = error;
          }
        }
        if (toolName === "patch.apply") {
          const changedFiles = stringArray(payload.changedFiles);
          const existing = findByToolCallId(snapshot.diffs, toolCallId);
          if (existing) {
            existing.changedFiles = changedFiles.length > 0 ? changedFiles : existing.checkpointFiles;
            existing.status = event.type === "tool.failed" ? "failed" : "applied";
          } else {
            snapshot.diffs.push({
              toolCallId,
              changedFiles,
              checkpointFiles: [],
              rolledBack: false,
              status: event.type === "tool.failed" ? "failed" : "applied"
            });
          }
        }
        break;
      case "patch.changed_files": {
        const changedFiles = stringArray(payload.changedFiles);
        snapshot.diffs.push({
          toolCallId,
          changedFiles,
          checkpointFiles: [],
          rolledBack: false,
          status: "applied"
        });
        break;
      }
      case "patch.checkpoint_created":
        snapshot.diffs.push({
          toolCallId,
          changedFiles: [],
          checkpointFiles: checkpointFilesFromPayload(payload),
          rolledBack: false,
          status: "checkpointed"
        });
        break;
      case "patch.rollback_completed": {
        const diff = findByToolCallId(snapshot.diffs, toolCallId);
        if (diff) {
          diff.rolledBack = true;
          diff.status = "rolled_back";
        }
        break;
      }
      case "autonomy.scope_expansion":
        snapshot.approvals.push({ toolCallId, toolName, paths: stringArray(payload.paths), status: "pending" });
        break;
      case "autonomy.scope_approved":
      case "autonomy.scope_auto_approved":
      case "autonomy.scope_denied":
      case "autonomy.scope_skipped": {
        const status = event.type.replace("autonomy.scope_", "");
        snapshot.approvals.push({
          toolCallId,
          toolName,
          paths: stringArray(payload.paths),
          status: status === "auto_approved" ? "auto_approved" : (status as "approved" | "denied" | "skipped")
        });
        break;
      }
      case "verification.check_started": {
        const command = optionalString(payload.command);
        if (command) {
          snapshot.verification.push({ command, reason: optionalString(payload.reason), status: "running" });
        }
        break;
      }
      case "verification.check_finished": {
        const command = optionalString(payload.command);
        if (command) {
          const check = snapshot.verification.findLast((item) => item.command === command && item.status === "running");
          const finished = check ?? snapshot.verification[snapshot.verification.push({ command }) - 1];
          finished.status = optionalString(payload.status);
          finished.output = optionalString(payload.output);
        }
        break;
      }
      case "model.usage": {
        const inputTokens = typeof payload.inputTokens === "number" ? payload.inputTokens : 0;
        const outputTokens = typeof payload.outputTokens === "number" ? payload.outputTokens : 0;
        const provider = optionalString(payload.provider) ?? "";
        const entryRates: Record<string, { inputPerM: number; outputPerM: number }> = { google: { inputPerM: 0.15, outputPerM: 0.60 }, deepseek: { inputPerM: 0.014, outputPerM: 0.028 }, openai: { inputPerM: 2.5, outputPerM: 10.0 }, anthropic: { inputPerM: 3.0, outputPerM: 15.0 }, ollama: { inputPerM: 0, outputPerM: 0 }, "local-llama": { inputPerM: 0, outputPerM: 0 } };
        const rate = entryRates[provider] ?? { inputPerM: 0, outputPerM: 0 };
        const cost = ((inputTokens / 1_000_000) * rate.inputPerM) + ((outputTokens / 1_000_000) * rate.outputPerM);
        snapshot.tokens.totalInputTokens += inputTokens;
        snapshot.tokens.totalOutputTokens += outputTokens;
        snapshot.tokens.entries.push({
          provider,
          model: optionalString(payload.model),
          inputTokens,
          outputTokens,
          cost,
        });
        break;
      }
    }
  }

  // M0.9: read workflow/graph/node IDs from event meta
  for (const event of events) {
    const meta = (event as any).meta;
    if (meta?.workflowId && !snapshot.workflowId) snapshot.workflowId = meta.workflowId;
    if (meta?.graphId && !snapshot.graphId) snapshot.graphId = meta.graphId;
    if (meta?.nodeId && !snapshot.nodeId) snapshot.nodeId = meta.nodeId;
  }

  return snapshot;
}

export type SubagentEvent = {
  type: "subagent.started" | "subagent.completed" | "subagent.failed";
  subagentId: string;
  role: string;
  timestamp: string;
  duration?: number;
  status?: "success" | "failed";
};

export function projectSubagentEvents(events: AlixEvent[]): SubagentEvent[] {
  return events
    .filter(e => e.actor === "subagent" && e.type.startsWith("subagent."))
    .map(e => {
      const payload = e.payload as Record<string, unknown>;
      return {
        type: e.type as SubagentEvent["type"],
        subagentId: String(payload?.subagentId ?? ""),
        role: String(payload?.role ?? ""),
        timestamp: e.timestamp,
        duration: e.type === "subagent.completed"
          ? new Date(e.timestamp).getTime() - new Date(events.find(x => x.type === "subagent.started" && (x.payload as Record<string, unknown>)?.subagentId === payload?.subagentId)?.timestamp ?? e.timestamp).getTime()
          : undefined,
        status: e.type === "subagent.completed" ? "success" : e.type === "subagent.failed" ? "failed" : undefined,
      };
    });
}

export function compareInspectorSnapshots(left: InspectorSnapshot, right: InspectorSnapshot): InspectorComparison {
  const leftFiles = changedFileSet(left);
  const rightFiles = changedFileSet(right);

  return {
    leftSessionId: left.sessionId,
    rightSessionId: right.sessionId,
    changedFilesOnlyLeft: sortedValues([...leftFiles].filter((file) => !rightFiles.has(file))),
    changedFilesOnlyRight: sortedValues([...rightFiles].filter((file) => !leftFiles.has(file))),
    changedFilesBoth: sortedValues([...leftFiles].filter((file) => rightFiles.has(file))),
    verificationStatus: { left: verificationSummary(left), right: verificationSummary(right) },
    tokenDelta: {
      inputTokens: right.tokens.totalInputTokens - left.tokens.totalInputTokens,
      outputTokens: right.tokens.totalOutputTokens - left.tokens.totalOutputTokens
    }
  };
}
