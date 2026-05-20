import { createInterface } from "node:readline";
import type { ModelAdapter, NormalizedRequest, ToolCall, TokenUsage } from "../providers/types.js";
import type { MemoryStore } from "../utils/memory/store.js";
import { extractDecisions, promptDecisionConfirmation } from "../utils/memory/decision-extractor.js";

/**
 * Prompt the user with a question and return their response.
 */
export async function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Extract decisions from session events and save confirmed ones to memory.
 * Wraps memoryStore.save() in try/catch to prevent crashes during cleanup.
 */
export async function saveDecisionsToMemory(
  sessionEvents: Awaited<ReturnType<import("../events/event-log.js").EventLog["readAll"]>>,
  memoryStore: MemoryStore
): Promise<void> {
  const decisions = extractDecisions(sessionEvents);
  if (decisions.length === 0) {
    console.log("[Memory] No decisions found to save.");
    return;
  }

  const confirmedDecisions = await promptDecisionConfirmation(decisions);
  if (confirmedDecisions.length === 0) {
    console.log("[Memory] No decisions saved.");
    return;
  }

  console.log(`[Memory] Saving ${confirmedDecisions.length} decision(s) to memory:`);
  for (const decision of confirmedDecisions) {
    try {
      await memoryStore.save({
        name: decision.name,
        description: decision.description,
        type: decision.type,
        content: decision.content,
        confidence: decision.confidence,
        confirmations: decision.confirmations,
        source: decision.source,
      });
      console.log(`  - [${decision.type}] ${decision.content}`);
    } catch (err) {
      console.error(`[Memory] Failed to save decision "${decision.name}": ${(err as Error).message}`);
    }
  }
}

/**
 * Stream a request to the provider and collect the response.
 */
export async function streamToResponse(
  provider: ModelAdapter,
  request: NormalizedRequest
): Promise<{ text: string; toolCalls: ToolCall[]; usage?: TokenUsage }> {
  if (!provider.stream) throw new Error("Provider does not support streaming");
  let text = "";
  let toolCalls: ToolCall[] = [];
  let usage: TokenUsage | undefined;
  for await (const chunk of provider.stream(request)) {
    if (chunk.type === "text_delta") text += chunk.text;
    if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
    if (chunk.type === "usage") usage = chunk.usage;
    if (chunk.type === "error") throw new Error(chunk.error);
  }
  return { text, toolCalls, usage };
}