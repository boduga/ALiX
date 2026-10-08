// Canonical multi-agent lifecycle (R4/V10). The runtime emits the `agent.*`
// lifecycle alongside the legacy `subagent.*` vocabulary; the browser timeline
// must show the same roster the TUI does. When canonical lifecycle events are
// present they are authoritative — legacy rows are ignored for those ids so a
// dual-emitting runtime is not rendered twice. From an older log with only
// `subagent.*`, the legacy rows are still projected.
const AGENT_LIFECYCLE_TYPES = new Set([
  "agent.spawned",
  "agent.state_changed",
  "agent.completed",
  "agent.failed",
  "agent.cancelled",
]);
const SUBAGENT_START_TYPES = new Set(["subagent.started", "agent.spawned"]);
const SUBAGENT_SUCCESS_TYPES = new Set(["subagent.completed", "agent.completed"]);
const SUBAGENT_FAILURE_TYPES = new Set(["subagent.failed", "agent.failed", "agent.cancelled"]);

export function projectSubagentEvents(events) {
  const useCanonical = events.some((e) => AGENT_LIFECYCLE_TYPES.has(e.type));
  const isLegacy = (e) => e.actor === "subagent" && e.type?.startsWith("subagent.");
  return events
    .filter((e) => (useCanonical ? AGENT_LIFECYCLE_TYPES.has(e.type) : isLegacy(e)))
    .map((e) => {
      const payload = e.payload ?? {};
      const subagentId = payload.subagentId ?? payload.agentId ?? "";
      const started = events.find(
        (x) => SUBAGENT_START_TYPES.has(x.type) && (x.payload?.subagentId ?? x.payload?.agentId) === subagentId,
      );
      const isTerminal = SUBAGENT_SUCCESS_TYPES.has(e.type) || SUBAGENT_FAILURE_TYPES.has(e.type);
      return {
        type: e.type,
        subagentId,
        role: payload.role ?? "",
        timestamp: e.timestamp,
        duration: isTerminal && started
          ? new Date(e.timestamp).getTime() - new Date(started.timestamp).getTime()
          : undefined,
        status: SUBAGENT_SUCCESS_TYPES.has(e.type) ? "success" : SUBAGENT_FAILURE_TYPES.has(e.type) ? "failed" : undefined,
      };
    });
}

export function buildUiProjection(events) {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const summary = {
    eventCount: ordered.length,
    toolCount: ordered.filter((event) => event.type?.startsWith("tool.")).length,
    errorCount: ordered.filter((event) => event.type === "tool.failed").length,
    policyDecisionCount: ordered.filter((event) => event.type === "policy.decision").length,
    patchCount: ordered.filter((event) => event.type?.startsWith("patch.")).length,
    approvalCount: ordered.filter((event) => event.type?.startsWith("approval.")).length,
    contextEventCount: ordered.filter((event) => event.type?.startsWith("context.")).length,
    verificationCount: ordered.filter((event) => event.type?.startsWith("verification.")).length,
    latestSeq: ordered.at(-1)?.seq ?? 0,
  };

  return {
    summary,
    timeline: ordered,
    context: buildContext(ordered),
    terminal: buildTerminal(ordered),
    diffs: buildDiffs(ordered),
    approvals: buildApprovals(ordered),
    verification: buildVerification(ordered),
    tokens: buildTokens(ordered),
    patches: buildPatches(ordered),
    policyDecisions: buildPolicyDecisions(ordered),
  };
}

export function createReplayState(events) {
  return {
    events: [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    cursor: events.length,
    playing: false,
    speedMs: 700,
  };
}

export function visibleEventsForReplay(state) {
  return state.events.slice(0, Math.max(0, state.cursor));
}

function latestPayload(events, type) {
  return [...events].reverse().find((event) => event.type === type)?.payload ?? null;
}

function buildTerminal(events) {
  const byId = new Map();
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "tool.requested" && payload.toolName === "shell.run") {
      byId.set(payload.toolCallId, {
        toolCallId: payload.toolCallId,
        command: payload.argsPreview?.command ?? "",
        status: "requested",
        outputPreview: "",
      });
    }
    if ((event.type === "tool.completed" || event.type === "tool.failed") && payload.toolName === "shell.run") {
      const item = byId.get(payload.toolCallId) ?? { toolCallId: payload.toolCallId, command: "" };
      item.status = payload.status ?? (event.type === "tool.completed" ? "success" : "error");
      item.outputPreview = payload.outputPreview ?? "";
      item.error = payload.error;
      byId.set(payload.toolCallId, item);
    }
  }
  return [...byId.values()];
}

function buildDiffs(events) {
  const fromToolCompleted = events
    .filter((event) => event.type === "tool.completed" && event.payload?.toolName === "patch.apply")
    .map((event) => ({
      toolCallId: event.payload.toolCallId,
      changedFiles: event.payload.changedFiles ?? [],
      status: "applied",
    }));
  const fromDomainEvent = events
    .filter((event) => event.type === "patch.changed_files")
    .map((event) => ({
      toolCallId: event.payload.toolCallId,
      changedFiles: event.payload.changedFiles ?? [],
      status: "applied",
    }));
  return [...fromToolCompleted, ...fromDomainEvent];
}

function buildApprovals(events) {
  return events
    .filter((event) => event.type?.startsWith("autonomy.scope_"))
    .map((event) => ({
      type: event.type,
      paths: event.payload?.paths ?? [],
      status: event.type.replace("autonomy.scope_", ""),
    }));
}

function buildVerification(events) {
  return events
    .filter((event) => event.type === "verification.check_finished")
    .map((event) => ({
      command: event.payload?.command ?? "",
      status: event.payload?.status ?? "unknown",
      output: event.payload?.output ?? "",
    }));
}

function buildTokens(events) {
  const entries = events
    .filter((event) => event.type === "model.usage")
    .map((event) => event.payload ?? {});
  return {
    entries,
    totalInputTokens: entries.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
    totalOutputTokens: entries.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
  };
}

function buildPolicyDecisions(events) {
  return events
    .filter((event) => event.type === "policy.decision")
    .map((event) => ({
      toolCallId: event.payload?.toolCallId ?? "",
      decision: event.payload?.decision ?? "unknown",
      reason: event.payload?.reason ?? "",
      capability: event.payload?.capability ?? "",
      matchedRuleId: event.payload?.matchedRuleId,
      timestamp: event.timestamp,
    }));
}

function buildPatches(events) {
  return events
    .filter((event) => event.type?.startsWith("patch."))
    .map((event) => ({
      type: event.type,
      proposalId: event.payload?.proposalId ?? "",
      status: getPatchStatus(event.type),
      changedFiles: event.payload?.changedFiles ?? [],
      timestamp: event.timestamp,
    }));
}

function getPatchStatus(type) {
  switch (type) {
    case "patch.proposed": return "proposed";
    case "patch.applied": return "applied";
    case "patch.rolled_back": return "rolled_back";
    case "patch.rejected": return "rejected";
    default: return "pending";
  }
}

function buildContext(events) {
  // Canonical context event is `context.bundle_compiled` (R4/V10); keep
  // `context.bundle_created` as a legacy fallback for older logs.
  const latestBundle = latestPayload(events, "context.bundle_compiled")
    ?? latestPayload(events, "context.bundle_created");
  const latestRepoMap = latestPayload(events, "context.repo_map_created");
  return {
    bundle: latestBundle ? { bundleId: latestBundle.bundleId, primaryFiles: latestBundle.primaryFiles ?? [] } : null,
    repoMap: latestRepoMap ? { repoId: latestRepoMap.repoId, repoName: latestRepoMap.repoName } : null,
  };
}

if (typeof window !== "undefined") {
  window.AlixInspectorProjection = {
    buildUiProjection,
    createReplayState,
    visibleEventsForReplay,
    projectSubagentEvents,
  };
}