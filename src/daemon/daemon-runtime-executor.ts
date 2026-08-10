// src/daemon/daemon-runtime-executor.ts
// RuntimeExecutor adapter for the daemon's socket client.
//
// Crosses the same seam as LocalRuntimeExecutor (see route-executor.ts): the
// four execution methods delegate to the shared behaviors in
// route-execution.ts, so there is exactly ONE implementation of each behavior.
// Daemon-specific code here is limited to adaptation:
//   - config is loaded once for the request lifetime (cached promise)
//   - results are translated into safeWrite(...) socket frames
//   - the daemon's session id, task id, and wire format are preserved
//
// Agent routes are NOT dispatched through this executor — handleRun routes
// them to the runTask path (streaming, deferred plan approval, bypass mode),
// so executeAgent is unreachable from the daemon's dispatch.

import type { Socket } from "node:net";
import type { RuntimeContext, RuntimeExecutor } from "../runtime/route-executor.js";
import type { TaskRoute } from "../runtime/task-router.js";
import {
  executeChatBehavior,
  executeDirectBehavior,
  executeGroundedChatBehavior,
  executeToolBehavior,
} from "../runtime/route-execution.js";
import type { DaemonResponse } from "./daemon-types.js";

export interface DaemonRuntimeExecutorOptions {
  client: Socket;
  sessionId: string;
  taskId: string;
  cwd: string;
  eventLog: any; // EventLog
}

/** Socket-sink adapter: RuntimeExecutor interface over a daemon client connection. */
export class DaemonRuntimeExecutor implements RuntimeExecutor {
  private configPromise: Promise<any> | null = null;

  constructor(private readonly opts: DaemonRuntimeExecutorOptions) {}

  /**
   * Load the request's config exactly once, cached for the request lifetime.
   * Exposed so a caller can build a RuntimeContext from the same instance
   * without triggering a second load.
   */
  getConfig(): Promise<any> {
    if (!this.configPromise) {
      this.configPromise = import("../config/loader.js").then((m) =>
        m.loadConfig(this.opts.cwd),
      );
    }
    return this.configPromise;
  }

  private emitText(text: string): void {
    this.safeWrite({ type: "assistant.text", sessionId: this.opts.sessionId, text });
  }

  private safeWrite(payload: DaemonResponse | Record<string, unknown>): void {
    const client = this.opts.client;
    if (client.destroyed || !client.writable) return;
    client.write(JSON.stringify(payload) + "\n");
  }

  /**
   * Shared shape for single-frame routes: load the request config, run the
   * behavior, emit one assistant.text frame, return the text.
   */
  private async runAndEmit(run: (config: any) => Promise<string>): Promise<string> {
    const config = await this.getConfig();
    const text = await run(config);
    this.emitText(text);
    return text;
  }

  async executeDirect(route: TaskRoute & { kind: "direct" }, _ctx: RuntimeContext): Promise<string> {
    return this.runAndEmit((config) => executeDirectBehavior(route, config));
  }

  async executeChat(route: TaskRoute & { kind: "chat" }, _ctx: RuntimeContext): Promise<string> {
    return this.runAndEmit((config) => executeChatBehavior(route, config));
  }

  async executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, _ctx: RuntimeContext): Promise<string> {
    return this.runAndEmit((config) =>
      executeGroundedChatBehavior(route, config, {
        eventLog: this.opts.eventLog,
        cwd: this.opts.cwd,
      }),
    );
  }

  async executeTool(route: TaskRoute & { kind: "tool" }, _ctx: RuntimeContext): Promise<string> {
    const config = await this.getConfig();
    // Marker frame BEFORE the tool runs — the daemon announces the invocation
    // so the client gets immediate "tool is running" feedback even if the
    // tool later errors. (Existing wire format; the ordering is part of the
    // daemon contract.)
    this.emitText(`→ ${route.tool} ${JSON.stringify(route.args)}\n`);
    const text = await executeToolBehavior(route, config, {
      eventLog: this.opts.eventLog,
      cwd: this.opts.cwd,
      renderApprovalPrompt: false, // a socket client can't act on /approve
    });
    this.emitText(text);
    return text;
  }

  async executeAgent(_route: TaskRoute & { kind: "agent" }, _ctx: RuntimeContext): Promise<string> {
    // Unreachable from handleRun's dispatch (agent routes go to runTask).
    // Throwing here keeps the interface honest: this adapter has no agent path.
    throw new Error(
      "agent routes are handled by handleRun's runTask path, not DaemonRuntimeExecutor",
    );
  }
}
