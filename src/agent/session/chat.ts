// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — lightweight chat path (#717 step 5b: decomposed from AgentSessionBuilder.build()).
 *
 * @module agent-session
 */

import { randomUUID } from "node:crypto";
import "node:fs";
import "node:path";
import "node:path";
import "node:os";
import "node:url";
import "../../events/event-log.js";

import type { ExecutionContext } from "../../observability/execution-context.js";
import "../../tracing/noop-client.js";
import "../agent.js";
import { withTraceRun } from "../run-root.js";
import "../../run/task-loop.js";
import { createProvider } from "../../providers/registry.js";
import type { ModelAdapter } from "../../providers/types.js";
import "../../runtime/task-router.js";
import "../../runtime/cancellation-token.js";
import "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import "../../kernel/workflow-run.js";
import "../../repomap/context-compiler.js";
import "../../config/context-limits.js";
import "../../config/model-resolver.js";
import "../../config/context-budget.js";
import "../../utils/tokens.js";
import "../../skills/dispatcher.js";
import "../../skills/lifecycle.js";
import "../../mcp/tool-selector.js";
import "../../mcp/tool-discovery.js";
import "../../agents/tool-name-map.js";
import { continueTruncatedGeneration, TRUNCATION_CONTINUATION_LIMIT } from "../../run/helpers.js";
import "../../kernel/minimal-metrics.js";
import "../system-prompt.js";
import { resolveDirectOutputCeiling } from "./setup.js";
import { AgentTurnResult } from "./types.js";

import type { SessionState } from "./state.js";

const CHAT_SEARCH_TIMEOUT_MS = 2000;

export async function runSearch(state: SessionState, query: string): Promise<string> {
  if (!state.config.chatSearchTool) return "";
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), CHAT_SEARCH_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      state.config.chatSearchTool(query),
      timeout,
    ]);
    return result ?? "";
  } catch {
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function ensureChatProvider(
  state: SessionState,
): Promise<ModelAdapter | null> {
  if (state.chatReady) return state.chatProviderInstance;
  state.chatReady = true;
  if (state.config.chatProvider) {
    state.chatProviderInstance = state.config.chatProvider;
    return state.chatProviderInstance;
  }
  if (!state.config.chatModel) return null;
  try {
    state.chatProviderInstance = await createProvider(
      state.config.chatModel,
      state.config.chatApiKey,
    );
    return state.chatProviderInstance;
  } catch {
    state.chatProviderInstance = null;
    return null;
  }
}

export async function processChat(
  state: SessionState,
  message: string,
): Promise<AgentTurnResult> {
  const sessionId = state.session?.sessionId ?? "chat";
  const runId = `run-${randomUUID().slice(0, 8)}`;
  const chatContext: ExecutionContext = { runId, sessionId };
  const traceRun = state.traceClient.startRun({
    runId,
    sessionId,
    task: message,
    actor: "chat",
    startedAt: Date.now(),
  });
  // Shared terminal-outcome wrapper (src/agent/run-root.ts): maps the body
  // result to success/error, classifies an escaping throw via
  // isCancellationError (operator cancellation is a normal terminal, never
  // a failure), and endRuns exactly once via the finally.
  return withTraceRun(
    state.traceClient,
    traceRun,
    "processChat ended before its outcome could be recorded",
    (result) =>
      // chat-error is the chat path's own caught-terminal (the body never
      // throws); anything else — including the no-provider placeholder —
      // is a successful invocation.
      result.reason === "chat-error"
        ? { status: "error", error: result.summary, endedAt: Date.now() }
        : { status: "success", endedAt: Date.now() },
    () => processChatBody(state, message, chatContext),
  );
}

export async function processChatBody(
  state: SessionState,
  message: string,
  chatContext: ExecutionContext,
): Promise<AgentTurnResult> {
  const sessionId = state.session?.sessionId ?? "chat";
  const provider = await ensureChatProvider(state);
  if (!provider) {
    return {
      summary: `[chat:no-provider] ${message}`,
      sessionId,
      toolCalls: [],
      reason: "chat",
    };
  }

  state.chatMessages.push({ role: "user", content: message });
  try {
    // Run search BEFORE the model call so the assistant sees fresh
    // context. If search fails or times out, we proceed without it —
    // the chat path never throws because of a search hiccup.
    let effectiveUserContent: string = message;
    if (state.config.chatSearchTool) {
      const searchContext = await runSearch(state, message);
      if (searchContext) {
        effectiveUserContent = `${message}\n\n${state.chatSearchLabel}\n${searchContext}`;
        state.chatMessages[state.chatMessages.length - 1] = {
          role: "user",
          content: effectiveUserContent,
        };
      }
    }

    const response = await provider.complete({
      systemPrompt: state.chatSystemPrompt,
      // Defensive copy so the provider's view of the conversation
      // doesn't change after we push the assistant reply below.
      messages: state.chatMessages.slice(),
      context: chatContext,
      maxOutputTokens: await resolveDirectOutputCeiling(
        state.config.chatModel,
        state.config.chatApiKey,
      ),
    });
    let text = response.text?.trim() ?? "";
    // Truncation continuation: a `finish_reason=length` on a single-shot
    // chat call means the model ran out of output budget mid-answer. Keep
    // generating in follow-up turns so the user never sees a silently cut
    // reply. Delegated to the shared continueTruncatedGeneration helper
    // (src/run/helpers.ts — the same contract the task loop uses): only
    // the LAST partial segment is re-fed as context, never the cumulative
    // text, so continuation context grows linearly instead of quadratically.
    if (response.finishReason === "length" && text.length > 0) {
      const merged = await continueTruncatedGeneration({
        initialText: text,
        messages: state.chatMessages,
        maxContinuations: TRUNCATION_CONTINUATION_LIMIT,
        generateNext: async (msgs) => {
          const next = await provider.complete({
            systemPrompt: state.chatSystemPrompt,
            messages: msgs,
            // Thread the synthetic run context so continuation spans
            // resolve to the same run/trace as the initial call (R1).
            context: chatContext,
            maxOutputTokens: await resolveDirectOutputCeiling(
              state.config.chatModel,
              state.config.chatApiKey,
            ),
          });
          return {
            text: (next.text ?? "").trim(),
            finishReason: next.finishReason,
            toolCalls: next.toolCalls ?? [],
          };
        },
      });
      text = merged.text;
    }
    // The chat history records ONE clean assistant reply (the fully merged
    // answer), never the intermediate partials / continuation prompts.
    state.chatMessages.push({ role: "assistant", content: text });
    return {
      summary: text || `[chat] ${message}`,
      sessionId,
      toolCalls: [],
      reason: "chat",
      ...(response.usage ? { usage: response.usage as any } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Drop the user message we optimistically appended so the next turn
    // doesn't see a phantom exchange.
    state.chatMessages.pop();
    return {
      summary: `[chat error] ${message}`,
      sessionId,
      toolCalls: [],
      reason: "chat-error",
    };
  }
}
