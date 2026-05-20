import type { AlixEvent, SessionProjection } from "./types.js";

export function replay(events: AlixEvent[]): SessionProjection {
  const sessionId = events[0]?.sessionId ?? "";
  const projection: SessionProjection = {
    sessionId,
    eventCount: events.length,
    approvals: {},
    changedFiles: []
  };

  for (const event of events) {
    // Domain events (canonical source)
    if (event.type === "patch.changed_files" || event.type === "patch.applied") {
      const payload = event.payload as { changedFiles?: string[] };
      projection.changedFiles.push(...(payload.changedFiles ?? []));
    }
    if (event.type === "file.created") {
      // Track created files if needed
    }
    if (event.type === "file.deleted") {
      // Track deleted files if needed
    }
    // Backward compat: also read from tool.completed
    if (event.type === "tool.completed") {
      const payload = event.payload as { toolName?: string; changedFiles?: string[] };
      if (payload.toolName === "patch.apply") {
        projection.changedFiles.push(...(payload.changedFiles ?? []));
      }
    }
    if (event.type === "session.ended") {
      const payload = event.payload as { summary?: string };
      projection.summary = payload.summary;
    }
  }

  projection.changedFiles = Array.from(new Set(projection.changedFiles));
  return projection;
}
