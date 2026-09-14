// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — shared session engine for run, run --chat, and tui.
 *
 * P1: One session = one logical conversation/task, potentially spanning
 * multiple user turns. First turn includes full setup (agent init, graph,
 * context, plan). Subsequent turns reuse the session and accumulate messages.
 *
 * @module agent-session
 */

import "node:crypto";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import "node:path";
import "node:os";
import { fileURLToPath } from "node:url";
import "../../events/event-log.js";

import type { ToolCall } from "../../providers/types.js";
import type { StreamHandler } from "../stream.js";
import "../../tracing/noop-client.js";
import "../agent.js";
import "../run-root.js";
import "../../run/task-loop.js";
import "../../providers/registry.js";
import "../../runtime/task-router.js";
import { ExecutionCancelledError } from "../../runtime/cancellation-token.js";
import { type AgentLivenessState } from "../agent-liveness.js";
import "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import "../../repomap/context-compiler.js";
import "../../config/model-resolver.js";
import "../../utils/tokens.js";
import "../../skills/dispatcher.js";
import "../../skills/lifecycle.js";
import "../../mcp/tool-selector.js";
import "../../mcp/tool-discovery.js";
import "../../agents/tool-name-map.js";
import "../../kernel/minimal-metrics.js";
import { AgentSessionEvents, Message, ToolExecution, ToolResult } from "./types.js";

// ---------------------------------------------------------------------------
// Cached package-version lookup. Walked once at module-load time so all
// callers (AgentSession.getVersion, DaemonAgentSession.getVersion, etc.)
// share a single synchronous read.
// ---------------------------------------------------------------------------
export const VERSION_WALK_MAX_DEPTH = 6;
export const VERSION_FALLBACK = "0.0.0";
export let cachedVersion: string | null = null;
export function readVersionCached(): string {
  if (cachedVersion !== null) return cachedVersion;
  // Try walking from CWD first
  const fromCwd = walkForPackageJson(process.cwd());
  if (fromCwd) {
    cachedVersion = fromCwd;
    return cachedVersion;
  }
  // Fall back to walking from this module's location (handles daemon
  // running from /tmp where the project isn't on disk)
  try {
    const moduleDir = nodePath.dirname(fileURLToPath(import.meta.url));
    const fromModule = walkForPackageJson(moduleDir);
    if (fromModule) {
      cachedVersion = fromModule;
      return cachedVersion;
    }
  } catch {
    /* import.meta.url unavailable */
  }
  cachedVersion = VERSION_FALLBACK;
  return cachedVersion;
}

export function walkForPackageJson(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < VERSION_WALK_MAX_DEPTH; i++) {
    const candidate = nodePath.join(dir, "package.json");
    if (nodeFs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(nodeFs.readFileSync(candidate, "utf8")) as { name?: string; version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        /* malformed */
      }
    }
    const parent = nodePath.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}


/**
 * Lifecycle phases for an agent session. The active phase is observed
 * by the TUI (and any other consumer) but only mutated by the session
 * itself. Originally defined in tui/state.ts — moved here to fix the
 * triangular dependency where agent code imported from the UI layer.
 * tui/state.ts now re-exports this from here.
 *
 * String-valued enum so Object.values(SessionPhase).length === 6
 * (TypeScript numeric enums emit reverse-mappings, doubling the count).
 */

export function livenessEventType(state: AgentLivenessState): string {
  switch (state) {
    case "stalled":
      return "agent.liveness.stalled";
    case "warning":
      return "agent.liveness.warning";
    case "healthy":
      return "agent.liveness.recovered";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/**
 * Distinguish an operator/execution cancellation from a genuine failure.
 * Operator cancels surface exclusively as an ExecutionCancelledError — the
 * stream pump and raceWithCancellation throw it explicitly on the operator's
 * abort signal. ONLY that type (matched by class, with a name fallback for a
 * cross-realm copy) is a cancellation. A provider-internal abort (e.g.
 * AbortSignal.timeout at the transport, or a 408-style timeout error) is NOT
 * an operator cancel and must stay a failure. A stall warning is neither —
 * the watchdog never terminates, so a stall alone never reaches this
 * predicate.
 */
export function isCancellationError(err: unknown): boolean {
  return (
    err instanceof ExecutionCancelledError ||
    (err instanceof Error && err.name === "ExecutionCancelledError")
  );
}

/**
 * Wrap a `StreamHandler` so it also fires `AgentSessionEvents.onToken` for
 * each text chunk (per spec §13). When `events` is undefined, the original
 * handler is returned unchanged. The original handler is always invoked so
 * existing token-level consumers (e.g. raw stdout writers) keep working.
 */
export function buildSessionStreamHandler(
  onStream: StreamHandler | undefined,
  events: AgentSessionEvents | undefined,
): StreamHandler | undefined {
  if (!events) return onStream;
  if (!onStream) {
    return (chunk) => {
      if (chunk.type === "text" && typeof chunk.text === "string") {
        events.onToken(chunk.text);
      }
    };
  }
  return (chunk) => {
    onStream(chunk);
    if (chunk.type === "text" && typeof chunk.text === "string") {
      events.onToken(chunk.text);
    }
  };
}

/**
 * Fire `AgentSessionEvents.onToolCall` / `onToolResult` for the current turn
 * (per spec §13). No-op when `events` is undefined.
 *
 * Tool calls: emitted in the order they were extracted from message tags
 * (one entry per tool invocation, identified by toolCallId).
 * Tool results: emitted for every `<tool_result>` block in the current
 * message history, in message order. Only results added during this turn
 * fire (caller passes `newMessages` slice).
 */
export function emitSessionEvents(
  events: AgentSessionEvents | undefined,
  turnToolCalls: readonly ToolCall[],
  messages: readonly Message[],
  toolHistory: readonly ToolExecution[],
): void {
  if (!events) return;
  for (const tc of turnToolCalls) {
    events.onToolCall(tc);
  }
  // Derive tool results from the message log. Extract from messages only —
  // this gives the most recent result per toolCallId without depending on
  // internal tool-history shape.
  const results = extractToolResultsFromMessages(messages);
  for (const result of results) {
    events.onToolResult(result);
  }
  // Avoid unused-var lint: toolHistory is reserved for future richer signal
  // extraction (e.g. error categorisation from execution records).
  void toolHistory;
}

// Internal helper — exported so tests can call it directly.
export function extractToolResultsFromMessages(
  msgs: readonly Message[],
): ToolResult[] {
  const results: ToolResult[] = [];
  const re = /<tool_result\s+id="([^"]*)">([\s\S]*?)<\/tool_result>/g;
  for (const msg of msgs) {
    if (msg.role !== "user") continue;
    if (typeof msg.content !== "string") continue;
    let match: RegExpExecArray | null;
    while ((match = re.exec(msg.content)) !== null) {
      const id = match[1];
      const body = match[2].trim();
      const isError =
        /^Error[:\s]/i.test(body) ||
        body.toLowerCase().includes("access denied");
      results.push({ toolCallId: id, content: body, isError });
    }
  }
  return results;
}
