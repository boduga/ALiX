// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Real-session shadow measurement (issue #616 / #628 follow-up).
 *
 * Answers the live go/no-go question the FakeModel harness cannot: on a REAL
 * agent session EventLog, what would the bounded state-aware prompt
 * (`buildExecutionContext`, P + Σ + O + E + Tools) cost versus the transcript
 * prompt the live loop actually admitted?
 *
 * Read-only and non-invasive:
 *  - EventLog is read, never written.
 *  - No `execution.*` events are appended; the bridge is a measurement-only
 *    projection of live session events onto the projector vocabulary.
 *  - Nothing here is wired into `runTaskLoop`; it is a benchmark harness.
 *
 * Gap it exposes: live sessions emit `tool.*` / `artifact.*` / `session.*`
 * but never `execution.created`, and `project()` fails closed without it.
 * `mapSessionEventsToProjectorHistory` synthesizes that seed and maps the
 * events that DO exist, so the projection (and its coverage) is measurable.
 *
 * @module benchmark/session-shadow
 */

import { EventLog } from "../src/events/event-log.js";
import { payloadString, type AlixEvent } from "../src/events/types.js";
import type { UniversalBenchmarkRow } from "./universal-row.js";
import { shadowReportToUniversal } from "./universal-row.js";
import {
  project,
  toExecutionState,
  type ProjectorEvent,
} from "../src/runtime/execution-state/execution-state-projector.js";
import type { ExecutionState } from "../src/runtime/execution-state/execution-state.js";
import {
  buildExecutionContext,
  type EvidenceInput,
  type ObservationInput,
  type ToolInput,
} from "../src/runtime/context/context-builder.js";
import { estimateTokens } from "./tokens.js";

// ─── Candidate session → projector bridge ───────────────────────────

export type SessionBridgeCoverage = {
  totalEvents: number;
  mappedEvents: number;
  ignoredEvents: number;
  proposedActions: number;
  completedActions: number;
  artifacts: number;
};

export type SessionBridgeResult = {
  projectorEvents: ProjectorEvent[];
  coverage: SessionBridgeCoverage;
};

/**
 * Candidate, measurement-only mapping from live session events onto the
 * projector vocabulary. Synthesizes `execution.created` (required by
 * `project()`) plus a `running` status, then maps the events that exist today:
 *
 *   tool.requested         → execution.action_proposed   (actionId=toolCallId)
 *   tool.completed/failed  → execution.action_completed  (actionId=toolCallId)
 *   artifact.created       → execution.artifact_registered (uri=path)
 *   session.ended          → execution.status_changed completed
 *
 * Everything else is ignored (the projector tolerates non-`execution.*`
 * history, but we do not forward it — this is a state-adequacy measurement,
 * not a full history replay). Deterministic and side-effect free. Payload
 * reads use the shared `payloadString` guard; event types dispatch through
 * the mapper table below.
 */
export function mapSessionEventsToProjectorHistory(
  events: readonly AlixEvent[],
  opts: { executionId: string; objective: string },
): SessionBridgeResult {
  const projectorEvents: ProjectorEvent[] = [];
  const coverage: SessionBridgeCoverage = {
    totalEvents: events.length,
    mappedEvents: 0,
    ignoredEvents: 0,
    proposedActions: 0,
    completedActions: 0,
    artifacts: 0,
  };

  // Seeds use negative seqs so they sort before every real event (seq >= 1).
  // When the live loop already emitted `execution.*` (ExecutionStateEmitter),
  // forward those instead of synthesizing — otherwise `project()` would see a
  // duplicate `execution.created` and fail closed.
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const hasGenesis = sorted.some((e) => e.type === "execution.created");
  if (!hasGenesis) {
    projectorEvents.push({
      seq: -2,
      type: "execution.created",
      payload: { executionId: opts.executionId, objective: opts.objective },
    });
    projectorEvents.push({
      seq: -1,
      type: "execution.status_changed",
      payload: { status: "running" },
    });
  }

  let statusEmitted = "running";
  const push = (pe: ProjectorEvent): void => {
    projectorEvents.push(pe);
  };

  const completeAction = (e: AlixEvent): void => {
    const actionId = payloadString(e.payload, "toolCallId");
    if (!actionId) {
      coverage.ignoredEvents++;
      return;
    }
    push({ seq: e.seq, type: "execution.action_completed", payload: { actionId } });
    coverage.completedActions++;
    coverage.mappedEvents++;
  };

  const mappers: Record<string, (e: AlixEvent) => void> = {
    "tool.requested": (e) => {
      const actionId = payloadString(e.payload, "toolCallId");
      if (!actionId) {
        coverage.ignoredEvents++;
        return;
      }
      const kind = payloadString(e.payload, "toolName") ?? "tool";
      const description = payloadString(e.payload, "capability");
      push({
        seq: e.seq,
        type: "execution.action_proposed",
        payload: { actionId, kind, ...(description ? { description } : {}) },
      });
      coverage.proposedActions++;
      coverage.mappedEvents++;
    },
    "tool.completed": completeAction,
    "tool.failed": completeAction,
    "artifact.created": (e) => {
      const artifactId = payloadString(e.payload, "artifactId");
      const uri = payloadString(e.payload, "path");
      if (!artifactId || !uri) {
        coverage.ignoredEvents++;
        return;
      }
      const kind = payloadString(e.payload, "mimeType");
      push({
        seq: e.seq,
        type: "execution.artifact_registered",
        payload: { artifactId, uri, ...(kind ? { kind } : {}) },
      });
      coverage.artifacts++;
      coverage.mappedEvents++;
    },
    "session.ended": (e) => {
      if (statusEmitted !== "completed") {
        push({
          seq: e.seq,
          type: "execution.status_changed",
          payload: { status: "completed" },
        });
        statusEmitted = "completed";
      }
      coverage.mappedEvents++;
    },
  };

  for (const e of sorted) {
    if (e.type.startsWith("execution.")) {
      push({ seq: e.seq, type: e.type, payload: e.payload, ...(e.id ? { id: e.id } : {}) });
      coverage.mappedEvents++;
      continue;
    }
    const map = mappers[e.type];
    if (map) map(e);
    else coverage.ignoredEvents++;
  }

  return { projectorEvents, coverage };
}

// ─── Shadow measurement ─────────────────────────────────────────────

export type SessionShadowReport = {
  ok: boolean;
  reason?: string;
  sessionId: string;
  executionId: string;
  events: SessionBridgeCoverage;
  state: {
    objective: string;
    status: string;
    pendingActions: number;
    activeCapabilities: number;
    constraints: number;
    artifacts: number;
  } | null;
  livePromptTokens: number | null;
  shadowPromptTokens: number;
  deltaTokens: number | null;
  ratio: number | null;
  bounded: boolean;
  sections: {
    stateChars: number;
    observationChars: number;
    evidenceChars: number;
    evidenceAdmitted: number;
    toolsCount: number;
    historyIncluded: boolean;
  } | null;
  /** Same measurement as a universal row (harness emission point). */
  universal: UniversalBenchmarkRow;
};

function readObjective(events: readonly AlixEvent[]): string | undefined {
  for (const e of events) {
    if (e.type !== "user.message") continue;
    const text =
      payloadString(e.payload, "content") ??
      payloadString(e.payload, "text") ??
      payloadString(e.payload, "message");
    if (text) return text.length > 2000 ? text.slice(0, 2000) : text;
  }
  return undefined;
}

function latestObservation(events: readonly AlixEvent[]): ObservationInput {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "tool.output" && e.type !== "tool.completed") continue;
    const preview = payloadString(e.payload, "outputPreview");
    if (preview) {
      return { content: preview, kind: e.type, toolName: payloadString(e.payload, "toolName") };
    }
  }
  return null;
}

function recentEvidence(events: readonly AlixEvent[], limit = 8): EvidenceInput[] {
  const out: EvidenceInput[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    if (e.type !== "tool.output") continue;
    const preview = payloadString(e.payload, "outputPreview");
    if (!preview) continue;
    out.push({
      id: payloadString(e.payload, "toolCallId"),
      content: preview,
      kind: "tool_output",
      source: payloadString(e.payload, "toolName"),
    });
  }
  return out.reverse();
}

/** Live admitted prompt tokens: worst-case over the session's assembled turns. */
function maxAdmittedTokens(events: readonly AlixEvent[]): number | null {
  let max: number | null = null;
  for (const e of events) {
    if (e.type !== "context.assembled") continue;
    const p = e.payload;
    const admitted =
      typeof p === "object" && p !== null && !Array.isArray(p) &&
      typeof (p as Record<string, unknown>).admittedTokens === "number"
        ? ((p as Record<string, unknown>).admittedTokens as number)
        : undefined;
    if (admitted !== undefined && (max === null || admitted > max)) max = admitted;
  }
  return max;
}

/**
 * Measure the bounded state-aware prompt on a real session EventLog.
 * Read-only. Never throws on projection failure — returns `{ok:false, reason}`.
 */
export async function measureSessionShadow(
  sessionDir: string,
  opts?: {
    objective?: string;
    tools?: readonly ToolInput[];
    model?: { maxContextTokens?: number; inputTokenLimit?: number } | null;
  },
): Promise<SessionShadowReport> {
  const log = new EventLog(sessionDir);
  const events = await log.readAll();
  const sessionId = sessionDir.split(/[\\/]/).filter(Boolean).pop() ?? "unknown";
  const objective = opts?.objective ?? readObjective(events) ?? `session ${sessionId}`;

  const { projectorEvents, coverage } = mapSessionEventsToProjectorHistory(events, {
    executionId: sessionId,
    objective,
  });

  const livePromptTokens = maxAdmittedTokens(events);

  let state: ExecutionState;
  try {
    state = toExecutionState(project(projectorEvents));
  } catch (err) {
    const failed: SessionShadowReport = {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      sessionId,
      executionId: sessionId,
      events: coverage,
      state: null,
      livePromptTokens,
      shadowPromptTokens: 0,
      deltaTokens: null,
      ratio: null,
      bounded: false,
      sections: null,
      universal: null as unknown as UniversalBenchmarkRow,
    };
    failed.universal = shadowReportToUniversal(failed);
    return failed;
  }

  const built = buildExecutionContext(
    { name: "session-shadow", body: objective },
    state,
    latestObservation(events),
    recentEvidence(events),
    opts?.tools ?? null,
    { model: opts?.model ?? null },
  );

  const shadowPromptTokens = estimateTokens(built.prompt);
  const deltaTokens = livePromptTokens === null ? null : livePromptTokens - shadowPromptTokens;
  const ratio =
    livePromptTokens && livePromptTokens > 0 ? shadowPromptTokens / livePromptTokens : null;

  const report: SessionShadowReport = {
    ok: true,
    sessionId,
    executionId: sessionId,
    events: coverage,
    state: {
      objective: state.objective,
      status: state.status,
      pendingActions: state.pendingActions.length,
      activeCapabilities: state.activeCapabilities.length,
      constraints: state.constraints.length,
      artifacts: state.artifacts.length,
    },
    livePromptTokens,
    shadowPromptTokens,
    deltaTokens,
    ratio,
    bounded: built.metadata.bounded,
    sections: {
      stateChars: built.metadata.stateChars,
      observationChars: built.metadata.observationChars,
      evidenceChars: built.metadata.evidenceChars,
      evidenceAdmitted: built.metadata.evidenceAdmitted,
      toolsCount: built.metadata.toolsCount,
      historyIncluded: built.metadata.historyIncluded,
    },
    universal: null as unknown as UniversalBenchmarkRow,
  };
  report.universal = shadowReportToUniversal(report);
  return report;
}
