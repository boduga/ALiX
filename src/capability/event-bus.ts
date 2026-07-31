// src/capability/event-bus.ts
import type { CapabilityEvent } from "./types.js";

export type EventHandler = (event: CapabilityEvent) => void;

export class EventBus {
  private handlers = new Set<EventHandler>();

  emit(event: CapabilityEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* a subscriber must never break delivery */ }
    }
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

/** Adapter seam: maps a platform CapabilityEvent onto the shape the
 *  existing EventLog/observability pipeline expects. A consumer wires this
 *  into EventLog.append; the platform core stays decoupled from EventLog. */
export function toAlixEvent(event: CapabilityEvent, sessionId: string): {
  type: string;
  sessionId: string;
  timestamp: string;
  actor: "system";
  payload: Record<string, unknown>;
} {
  const { type, at, ...payload } = event;
  return {
    type: `capability.${type}`,
    sessionId,
    timestamp: new Date(at).toISOString(),
    actor: "system",
    payload: { ...payload, at },
  };
}
