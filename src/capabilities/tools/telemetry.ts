/**
 * telemetry.ts — Best-effort tool telemetry emission.
 *
 * A single home for the P0 rule "telemetry must never fail the tool it
 * describes": every EventLog append here is fail-open. Under cross-process
 * lock contention an append can throw at the 5s acquisition deadline — the
 * ToolResult (and any artifact file) is authoritative, the event is not.
 *
 * The event `type` stays generic (`TType extends string`) so call sites keep
 * their canonical constants (`TOOL_/FILE_/PATCH_/MCP_EVENT_TYPES`) instead of
 * widening to `string`; payloads keep their inferred shapes.
 */

import type { EventLog } from "../../runtime-state/events/event-log.js";

export async function emitToolTelemetry<TType extends string, TPayload>(
  log: EventLog | undefined,
  sessionId: string | undefined,
  type: TType,
  payload: TPayload,
): Promise<void> {
  if (!log) return;
  try {
    await log.append({
      sessionId: sessionId ?? "unknown",
      actor: "system",
      type,
      payload,
    });
  } catch { /* tool telemetry is observability, not correctness */ }
}
