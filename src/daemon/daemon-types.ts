/**
 * daemon-types.ts — Shared protocol types for daemon client/server communication.
 *
 * Commands are JSON-line messages sent from client to server.
 * Responses are JSON-line messages sent from server to client.
 */

/** Commands a client can send to the daemon. */
export type DaemonCommand =
  | { command: "run"; task: string; sessionMode?: string; planMode?: boolean }
  | { command: "ping" }
  | { command: "status" }
  | { command: "cancel"; taskId: string };

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
  | { type: "cancel.error"; taskId: string; message: string };
