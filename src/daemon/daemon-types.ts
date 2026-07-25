/**
 * daemon-types.ts — Shared protocol types for daemon client/server communication.
 *
 * Commands are JSON-line messages sent from client to server.
 * Responses are JSON-line messages sent from server to client.
 */

/** Commands a client can send to the daemon. */
export type DaemonCommand =
  | { command: "run"; task: string; cwd: string; route?: import("../runtime/task-router.js").TaskRoute; sessionMode?: string; planMode?: boolean; planApprovalMode?: "interactive" | "deferred" }
  | { command: "ping" }
  | { command: "status" }
  | { command: "cancel"; taskId: string }
  /**
   * Direct (ephemeral) request — for arithmetic and standalone-generation
   * prompts that don't need a full agent lifecycle. The daemon classifies
   * the task via `taskRouter` BEFORE any TaskRegistry/session/event setup.
   *
   * If the route is `direct`, the daemon emits exactly:
   *   { type: "request.received",  requestId }
   *   { type: "direct.completed",  requestId, text }
   * No session events, no task registry entry, no `.alix/sessions`, no
   * `.alix/plans`.
   *
   * If the route is not `direct`, the daemon responds with a
   * `direct.completed` whose `text` is an error message describing the
   * actual route — the requestId stays ephemeral.
   */
  | { command: "direct"; task: string; requestId: string; cwd?: string };

/** Response events the daemon sends back. */
export type DaemonResponse =
  | { type: "session.started"; sessionId: string }
  | { type: "task.accepted"; sessionId: string; task: string }
  | { type: "task.completed"; sessionId: string; status: string }
  | { type: "task.failed"; sessionId: string; error: string }
  | { type: "task.progress"; sessionId: string; message: string }
  | { type: "tool.event"; sessionId: string; toolName?: string; status?: string; outputPreview?: string }
  | { type: "session.ended"; sessionId: string }
  | { type: "queue.position"; position: number }
  | { type: "error"; message: string }
  | { type: "pong"; sessionId?: string }
  | { type: "cancelled"; sessionId: string }
  | { type: "task.created"; taskId: string; task: string; position: number }
  | { type: "task.cancelled"; taskId: string; requested?: boolean }
  | { type: "cancel.error"; taskId: string; message: string }
  | { type: "assistant.text"; sessionId: string; text: string }
  // ── Direct (ephemeral) protocol — Task 3 ─────────────────────────────
  /** First message emitted for a `direct` command: the daemon has
   *  accepted the requestId and is about to execute. */
  | { type: "request.received"; requestId: string }
  /** Final message emitted for a `direct` command: the answer text.
   *  If execution failed, `text` is an error description prefixed with
   *  `[error]`; the requestId is still present so the client can match. */
  | { type: "direct.completed"; requestId: string; text: string };
