/**
 * event-envelope.ts — Canonical ALiX event envelope + adapter.
 *
 * Wraps existing EventLog events into the canonical shape defined in the
 * PRD (schemaVersion, actorType, eventType, visibility, causality, etc.).
 * Legacy payloads are preserved under payload.legacy.
 *
 * The canonical envelope is an ADDITIONAL output path — existing EventLog
 * continues to work unchanged.
 */

import type { AlixEvent, EventMeta } from "../events/types.js";

// ─── Canonical Types ────────────────────────────────────────────────

export type ActorType = "user" | "agent" | "tool" | "model" | "system" | "sidecar" | "policy";
export type EventVisibility = "public" | "internal" | "sensitive";

export interface CanonicalEvent<TPayload = unknown> {
  id: string;
  schemaVersion: "1.0";
  timestamp: string;
  sessionId: string;
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  actorType: ActorType;
  actorId: string;
  eventType: string;
  payload: TPayload & { legacy?: unknown };
  visibility: EventVisibility;
  causality?: { parentEventId?: string; traceId?: string; spanId?: string };
  integrity?: { payloadHash?: string; previousEventHash?: string };
}

export interface EventSink {
  emit(event: CanonicalEvent): Promise<void>;
}

// ─── Mapping Helpers ────────────────────────────────────────────────

/** Map legacy actor values to canonical ActorType. */
function mapActor(actor: string): ActorType {
  switch (actor) {
    case "user": return "user";
    case "agent": return "agent";
    case "tool": return "tool";
    case "system": return "system";
    case "verifier": return "system";
    case "policy": return "policy";
    case "subagent": return "agent";
    default: return "system";
  }
}

/** Determine visibility based on event type. */
function inferVisibility(eventType: string): EventVisibility {
  if (eventType.includes("secret") || eventType.includes(".sensitive")) return "sensitive";
  if (eventType.startsWith("agent.") || eventType.startsWith("tool.")) return "internal";
  return "public";
}

// ─── Adapter ────────────────────────────────────────────────────────

/** Convert a legacy AlixEvent to a CanonicalEvent. */
export function toCanonicalEvent(
  legacy: AlixEvent,
  meta?: EventMeta,
): CanonicalEvent {
  return {
    id: legacy.id,
    schemaVersion: "1.0",
    timestamp: legacy.timestamp,
    sessionId: legacy.sessionId,
    workflowId: meta?.workflowId ?? legacy.runId,
    graphId: meta?.graphId,
    nodeId: meta?.nodeId,
    actorType: mapActor(legacy.actor),
    actorId: legacy.actor,
    eventType: legacy.type,
    payload: {
      ...(legacy.payload as Record<string, unknown>),
      legacy: legacy.payload,
    },
    visibility: inferVisibility(legacy.type),
    causality: {
      parentEventId: legacy.parentEventId,
      traceId: meta?.traceId,
      spanId: meta?.spanId,
    },
  };
}

/** Write a canonical event to stdout for pipe/shell consumption. */
export function emitJsonLine(event: CanonicalEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * CanonicalEventSink — writes canonical events to an in-memory buffer
 * for batch SQLite insertion, and optionally to stdout.
 */
export class CanonicalEventSink implements EventSink {
  private buffer: CanonicalEvent[] = [];
  private stdout: boolean;

  constructor(opts?: { stdout?: boolean }) {
    this.stdout = opts?.stdout ?? false;
  }

  async emit(event: CanonicalEvent): Promise<void> {
    this.buffer.push(event);
    if (this.stdout) {
      emitJsonLine(event);
    }
  }

  /** Return buffered events and clear. */
  flush(): CanonicalEvent[] {
    const events = [...this.buffer];
    this.buffer = [];
    return events;
  }

  /** Return buffered events without clearing. */
  peek(): CanonicalEvent[] {
    return [...this.buffer];
  }

  get size(): number {
    return this.buffer.length;
  }
}
