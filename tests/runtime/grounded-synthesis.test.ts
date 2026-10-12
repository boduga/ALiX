/**
 * grounded-synthesis.test.ts — the grounded_chat SYNTHESIS step.
 *
 * The synthesis call is where the user-visible answer is written. Two defects
 * made a truncated or partial enumeration pass as a finished answer:
 *
 *  1. A flat 512-token `maxOutputTokens` cut long enumerated answers ("list all
 *     X") mid-list — the exact shape this route exists to produce.
 *  2. `finishReason` was never inspected, so a `length` stop was returned
 *     verbatim with no indication that the answer was incomplete.
 *
 * Plus the prompt told the model nothing about completeness, so a first call
 * satisfied from search metadata (titles/URLs/snippets) could return a single
 * leading item and look complete. Session 1791824290404 returned exactly one
 * president out of sixteen.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeGroundedChatBehavior, GROUNDED_SYNTHESIS_PROMPT } from "../../src/runtime-state/runtime/route-execution.js";
import type { ModelAdapter } from "../../src/models/providers/types.js";

const ALIASES: Record<string, string> = { "web.search": "alix_web_search", "web.fetch": "alix_web_fetch" };

type RecordedRequest = {
  systemPrompt?: string;
  maxOutputTokens?: number;
  tools?: Array<{ name: string }>;
};

/**
 * Provider that calls a tool on turn 1, then synthesizes on turn 2 with the
 * supplied finish reason so truncation is observable.
 */
function scriptedProvider(
  finishReason: string | undefined,
  requests: RecordedRequest[],
  synthesisText = "synthesized answer",
): ModelAdapter {
  return {
    id: "mock",
    capabilities: {},
    complete: async (request: RecordedRequest) => {
      requests.push(request);
      return requests.length === 1
        ? { text: "", toolCalls: [{ id: "tc1", name: "alix_web_search", args: { query: "x" } }] }
        : { text: synthesisText, toolCalls: [], finishReason };
    },
  } as unknown as ModelAdapter;
}

async function runSynthesis(finishReason: string | undefined, synthesisText?: string): Promise<{
  answer: string;
  requests: RecordedRequest[];
}> {
  const requests: RecordedRequest[] = [];
  const route = {
    kind: "grounded_chat" as const,
    prompt: "list all west african presidents",
    allowedTools: ["web.search", "web.fetch"],
    diagnostic: { classification: "external_retrieval" },
  };

  const answer = await executeGroundedChatBehavior(
    route as never,
    { permissions: { allowNetworkDomains: [] } } as never,
    {
      cwd: process.cwd(),
      eventLog: { append: async () => {} },
      providerFactory: async () => scriptedProvider(finishReason, requests, synthesisText),
      toolExecutorFactory: async () => ({
        execute: async () => ({ kind: "success" as const, output: "search metadata" }),
      }),
      toolCandidateAliases: ALIASES,
    } as never,
  );

  return { answer, requests };
}

describe("grounded_chat synthesis", () => {
  it("derives an output ceiling above the historical 512-token cap", async () => {
    const { requests } = await runSynthesis("stop");

    // Turn 2 is the synthesis call.
    const synthesis = requests[1]!;
    assert.ok(
      synthesis.maxOutputTokens !== undefined && synthesis.maxOutputTokens > 512,
      `synthesis must not be capped at the historical 512 tokens (got ${synthesis.maxOutputTokens})`,
    );
  });

  it("marks a length-truncated synthesis instead of returning it as complete", async () => {
    const { answer } = await runSynthesis("length", "Here is the list:\n\n* Benin: Patrice Tal");

    assert.match(answer, /Benin: Patrice Tal/, "the partial text is preserved");
    assert.match(
      answer,
      /response truncated at the model output limit/i,
      "a `length` stop must be surfaced, not silently returned as a finished answer",
    );
  });

  it("returns a clean finish unchanged, with no truncation marker", async () => {
    const { answer } = await runSynthesis("stop", "All sixteen presidents, enumerated.");

    assert.equal(answer, "All sixteen presidents, enumerated.");
    assert.doesNotMatch(answer, /truncated/i);
  });

  it("demands a complete answer rather than the first item", () => {
    // The prompt is the only lever on model-side completeness; pin the rules
    // that address the "announced a list, returned one item" failure.
    assert.match(GROUNDED_SYNTHESIS_PROMPT, /enumerate every item/i);
    assert.match(GROUNDED_SYNTHESIS_PROMPT, /never answer with just the first one/i);
    assert.match(GROUNDED_SYNTHESIS_PROMPT, /search metadata/i);
  });
});