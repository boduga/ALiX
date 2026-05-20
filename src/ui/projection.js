export function projectSubagentEvents(events) {
  return events
    .filter(e => e.actor === "subagent" && e.type.startsWith("subagent."))
    .map(e => ({
      type: e.type,
      subagentId: e.payload?.subagentId ?? "",
      role: e.payload?.role ?? "",
      timestamp: e.timestamp,
      duration: e.type === "subagent.completed"
        ? new Date(e.timestamp).getTime() - new Date(events.find(x => x.type === "subagent.started" && x.payload?.subagentId === e.payload?.subagentId)?.timestamp ?? e.timestamp).getTime()
        : undefined,
      status: e.type === "subagent.completed" ? "success" : e.type === "subagent.failed" ? "failed" : undefined,
    }));
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
  const latestBundle = latestPayload(events, "context.bundle_created");
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