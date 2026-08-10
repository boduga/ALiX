/**
 * route-executor.ts — Task route execution dispatcher.
 *
 * Defines the RuntimeExecutor interface and the executeRoute() dispatcher.
 * Two implementations exist: local (same process) and daemon (Unix socket).
 * Both delegate their execution behavior to the shared functions in
 * route-execution.ts — adapter-specific code is limited to where the config
 * comes from and where the result goes.
 *
 * Seam vs session.ts: this module is the task-route execution seam — given a
 * classified TaskRoute it produces a text result, dispatching through one of
 * the two adapters. session.ts owns the higher-level agent session lifecycle
 * (streaming turns, plan approval, memory, event persistence) and is NOT part
 * of this seam: its agent loop (runTask) is only reached through
 * executeAgent, and the daemon's handleRun routes agent routes straight to
 * runTask rather than through DaemonRuntimeExecutor. Keep session.ts out of
 * this module.
 */

import type { TaskRoute, RouteDiagnostic } from "./task-router.js";
import {
  executeChatBehavior,
  executeDirectBehavior,
  executeGroundedChatBehavior,
  executeToolBehavior,
} from "./route-execution.js";

/** Re-export RouteDiagnostic so callers can import it from one place. */
export type { RouteDiagnostic } from "./task-router.js";

/** Context shared by all route executors. */
export interface RuntimeContext {
  cwd: string;
  sessionId: string;
  sessionDir: string;
  eventLog: any; // EventLog
  config: any;   // AlixConfig
  approvalStore?: any;
  onStream?: (chunk: any) => void;
  /**
   * Non-persistent diagnostic callback. Fires once per dispatch with the
   * route's `RouteDiagnostic` (when present). Callers that want to surface
   * *why* a prompt routed to direct / grounded_chat / agent wire a hook
   * here. Per the contract:
   *   - callback failures are swallowed
   *   - nothing is persisted
   *   - no events are emitted
   */
  onRouteDiagnostic?: (diagnostic: RouteDiagnostic) => void;
}

/** Interface each execution backend must implement. */
export interface RuntimeExecutor {
  executeDirect(route: TaskRoute & { kind: "direct" }, ctx: RuntimeContext): Promise<string>;
  executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string>;
  executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string>;
  executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string>;
  executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string>;
}

/**
 * Forward a route's diagnostic through `ctx.onRouteDiagnostic` if the
 * callback is present. Failures are swallowed — the diagnostic channel
 * is observability, never a control surface.
 */
function forwardDiagnostic(route: TaskRoute, ctx: RuntimeContext): void {
  const diagnostic = "diagnostic" in route ? route.diagnostic : undefined;
  if (!diagnostic || !ctx.onRouteDiagnostic) return;
  try {
    ctx.onRouteDiagnostic(diagnostic);
  } catch {
    // Intentionally swallow — diagnostics must never break dispatch.
  }
}

/** Dispatch a TaskRoute to the correct executor method. */
export async function executeRoute(
  route: TaskRoute,
  ctx: RuntimeContext,
  executor: RuntimeExecutor,
): Promise<string> {
  // Non-persistent diagnostic forwarding happens for every route kind
  // that carries a `diagnostic`. The executor implementations are
  // free to forward their own diagnostics in addition, but the
  // dispatcher is the single canonical place so a missing executor
  // implementation can't silently drop the signal.
  forwardDiagnostic(route, ctx);

  switch (route.kind) {
    case "direct":
      return executor.executeDirect(route, ctx);
    case "tool":
      return executor.executeTool(route, ctx);
    case "chat":
      return executor.executeChat(route, ctx);
    case "grounded_chat":
      return executor.executeGroundedChat(route, ctx);
    case "agent":
      return executor.executeAgent(route, ctx);
  }
}

/** Local (same-process) executor — used by no-daemon TUI and CLI commands. */
export class LocalRuntimeExecutor implements RuntimeExecutor {
  /**
   * Direct execution — no lifecycle, no tools, no artifacts.
   *
   *  - Arithmetic: returns the route's pre-computed `answer` string.
   *  - Standalone generation: one provider call, no tool loop.
   *
   * This method intentionally does **not** import `ToolExecutor` or
   * `runTask`; the direct path must stay free of side-effecting
   * executors so it remains safe to invoke from read-only contexts.
   */
  async executeDirect(route: TaskRoute & { kind: "direct" }, ctx: RuntimeContext): Promise<string> {
    // Local passes its historical 512-token cap; the daemon omits it.
    return executeDirectBehavior(route, ctx.config, { maxOutputTokens: 512 });
  }

  async executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string> {
    return executeToolBehavior(route, ctx.config, {
      eventLog: ctx.eventLog,
      cwd: ctx.cwd,
      approvalStore: ctx.approvalStore,
    });
  }

  async executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string> {
    // Local passes its historical 512-token cap; the daemon omits it.
    return executeChatBehavior(route, ctx.config, { maxOutputTokens: 512 });
  }

  async executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string> {
    return executeGroundedChatBehavior(route, ctx.config, {
      eventLog: ctx.eventLog,
      cwd: ctx.cwd,
      approvalStore: ctx.approvalStore,
      // Local passes its historical 512-token cap; the daemon omits it.
      maxOutputTokens: 512,
    });
  }

  async executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string> {
    const { runTask } = await import("../agent/agent-loop.js");
    const result = await runTask(ctx.cwd, route.task, {
      sharedSession: {
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        eventLog: ctx.eventLog,
      },
      planMode: false,
      streaming: !!ctx.onStream,
    }, ctx.onStream);
    return result.summary || "(task completed)";
  }
}
