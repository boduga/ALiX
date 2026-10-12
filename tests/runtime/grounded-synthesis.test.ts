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
import {
  executeGroundedChatBehavior,
  extractLeakedToolCall,
  isNonSubstantiveSynthesis,
  GROUNDED_SYNTHESIS_PROMPT,
} from "../../src/runtime-state/runtime/route-execution.js";
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
  });

  it("does not invite a follow-up retrieval plan", () => {
    // Session 1791828877329 answered with "I'll fetch the page ..." plus a raw
    // <dots_function_call> block. The prompt must push toward answering now.
    assert.match(GROUNDED_SYNTHESIS_PROMPT, /answer now/i);
    assert.match(GROUNDED_SYNTHESIS_PROMPT, /do not request, describe, or emit another tool call/i);
    assert.doesNotMatch(GROUNDED_SYNTHESIS_PROMPT, /what still needs fetching/i);
  });
});

describe("isNonSubstantiveSynthesis", () => {
  it("rejects empty and plan-only answers", () => {
    assert.equal(isNonSubstantiveSynthesis(""), true);
    assert.equal(isNonSubstantiveSynthesis("   "), true);
    assert.equal(
      isNonSubstantiveSynthesis("I'll fetch the page that lists all 16 states and compile the list."),
      true,
    );
  });

  it("rejects a leaked tool-call block", () => {
    assert.equal(
      isNonSubstantiveSynthesis('...\n<dots_function_call>\n[alix_web_fetch]\n{"url":"https://x"}\n```'),
      true,
    );
    assert.equal(isNonSubstantiveSynthesis('[alix_web_fetch]{"url":"https://x"}'), true);
  });

  it("accepts a real answer and an explicit insufficiency statement", () => {
    assert.equal(isNonSubstantiveSynthesis("Benin: Patrice Tal. Burkina Faso: Ibrahim Traore."), false);
    assert.equal(isNonSubstantiveSynthesis("The retrieved pages did not contain a list of presidents."), false);
  });
});

describe("extractLeakedToolCall", () => {
  const offered = new Set(["alix_web_search", "alix_web_fetch"]);

  it("recovers the dots_function_call shape observed in session 1791828877329", () => {
    const leaked = extractLeakedToolCall(
      "I'll fetch it.\n\n<dots_function_call>\n[alix_web_fetch]\n{\"url\":\"https://example.com/list\"}\n```",
      offered,
    );
    assert.deepEqual(leaked, { name: "alix_web_fetch", args: { url: "https://example.com/list" } });
  });

  it("recovers the bare bracketed shape", () => {
    const leaked = extractLeakedToolCall('[alix_web_search]{"query":"x"}', offered);
    assert.deepEqual(leaked, { name: "alix_web_search", args: { query: "x" } });
  });

  it("refuses a name that was not offered (never widens the tool surface)", () => {
    assert.equal(extractLeakedToolCall('[alix_shell_run]{"cmd":"rm -rf /"}', offered), undefined);
  });

  it("refuses malformed JSON and non-object payloads", () => {
    assert.equal(extractLeakedToolCall('[alix_web_fetch]{"url":', offered), undefined);
    assert.equal(extractLeakedToolCall('[alix_web_fetch][1,2,3]', offered), undefined);
  });

  it("returns undefined when there is nothing to recover", () => {
    assert.equal(extractLeakedToolCall("Just a normal answer about presidents.", offered), undefined);
  });
});

describe("grounded_chat leaked-call recovery (end to end)", () => {
  it("dispatches a leaked fetch and re-synthesizes a real answer", async () => {
    const requests: RecordedRequest[] = [];
    const executed: string[] = [];
    const route = {
      kind: "grounded_chat" as const,
      prompt: "search the web and list all west african presidents",
      allowedTools: ["web.search", "web.fetch"],
      diagnostic: { classification: "external_retrieval" },
    };
    // Turn 1: real tool call. Turn 2 (synthesis): leaks a fetch as prose.
    // Turn 3 (re-synthesis after the leaked fetch): a real answer.
    const provider: ModelAdapter = {
      id: "mock",
      capabilities: {},
      complete: async (request: RecordedRequest) => {
        requests.push(request);
        if (requests.length === 1) {
          return { text: "", toolCalls: [{ id: "tc1", name: "alix_web_search", args: { query: "x" } }] };
        }
        if (requests.length === 2) {
          return {
            text: "I'll fetch the page that lists all 16 states.\n\n<dots_function_call>\n[alix_web_fetch]\n{\"url\":\"https://example.com/list\"}\n```",
            toolCalls: [],
          };
        }
        return { text: "Benin: Patrice Tal. Burkina Faso: Ibrahim Traore.", toolCalls: [] };
      },
    } as unknown as ModelAdapter;

    const answer = await executeGroundedChatBehavior(
      route as never,
      { permissions: { allowNetworkDomains: [] } } as never,
      {
        cwd: process.cwd(),
        eventLog: { append: async () => {} },
        providerFactory: async () => provider,
        toolExecutorFactory: async () => ({
          execute: async (req: { name: string }) => {
            executed.push(req.name);
            return { kind: "success" as const, output: "full page content" };
          },
        }),
        toolCandidateAliases: ALIASES,
      } as never,
    );

    // The leaked fetch actually ran (search + the recovered fetch), and the
    // answer is a real one, not the plan text or the leaked block.
    assert.equal(executed.length, 2, "search plus the recovered leaked fetch");
    assert.match(answer, /Benin: Patrice Tal/);
    assert.doesNotMatch(answer, /dots_function_call/);
    assert.doesNotMatch(answer, /I'll fetch/);
  });

  it("reports insufficient data rather than returning a plan as the answer", async () => {
    const requests: RecordedRequest[] = [];
    const route = {
      kind: "grounded_chat" as const,
      prompt: "list all west african presidents",
      allowedTools: ["web.search", "web.fetch"],
      diagnostic: { classification: "external_retrieval" },
    };
    const provider: ModelAdapter = {
      id: "mock",
      capabilities: {},
      complete: async (request: RecordedRequest) => {
        requests.push(request);
        return requests.length === 1
          ? { text: "", toolCalls: [{ id: "tc1", name: "alix_web_search", args: { query: "x" } }] }
          : { text: "I'll fetch the page and compile the list for you.", toolCalls: [] };
      },
    } as unknown as ModelAdapter;

    const answer = await executeGroundedChatBehavior(
      route as never,
      { permissions: { allowNetworkDomains: [] } } as never,
      {
        cwd: process.cwd(),
        eventLog: { append: async () => {} },
        providerFactory: async () => provider,
        toolExecutorFactory: async () => ({
          execute: async () => ({ kind: "success" as const, output: "snippets" }),
        }),
        toolCandidateAliases: ALIASES,
      } as never,
    );

    assert.equal(answer, "The retrieved data was not sufficient to answer this question.");
  });
});