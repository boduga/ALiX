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
  GROUNDED_MAX_TOOL_ROUNDS,
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
      // A retrieval round (system prompt = the retrieval prompt) keeps calling
      // tools; the synthesis round (GROUNDED_SYNTHESIS_PROMPT) answers. Keyed
      // off the prompt, not the call index, so the bounded retrieval loop can
      // add rounds without breaking the fixture.
      const isSynthesis = request.systemPrompt === GROUNDED_SYNTHESIS_PROMPT;
      return isSynthesis
        ? { text: synthesisText, toolCalls: [], finishReason }
        : { text: "", toolCalls: [{ id: "tc1", name: "alix_web_search", args: { query: "x" } }] };
    },
  } as unknown as ModelAdapter;
}

/** The synthesis call is identified by its system prompt, not its position. */
function synthesisRequest(requests: RecordedRequest[]): RecordedRequest | undefined {
  return requests.find((r) => r.systemPrompt === GROUNDED_SYNTHESIS_PROMPT);
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

    const synthesis = synthesisRequest(requests);
    assert.ok(synthesis, "a synthesis call must have been made");
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

describe("grounded_chat retrieval loop", () => {
  it("chains search then fetch, and synthesizes from every collected result", async () => {
    const executed: string[] = [];
    const requests: RecordedRequest[] = [];
    const route = {
      kind: "grounded_chat" as const,
      prompt: "list all west african presidents",
      allowedTools: ["web.search", "web.fetch"],
      diagnostic: { classification: "external_retrieval" },
    };
    // Retrieval round 1 -> search. Round 2 -> fetch. Round 3 -> no tool call,
    // which is the natural end of the loop. Then the synthesis call runs once
    // more, keyed off the synthesis prompt.
    let retrievalRound = 0;
    const provider: ModelAdapter = {
      id: "mock",
      capabilities: {},
      complete: async (request: RecordedRequest) => {
        requests.push(request);
        if (request.systemPrompt === GROUNDED_SYNTHESIS_PROMPT) {
          return { text: "All sixteen presidents, enumerated from the fetched page.", toolCalls: [] };
        }
        retrievalRound++;
        if (retrievalRound === 1) {
          return { text: "", toolCalls: [{ id: "s1", name: "alix_web_search", args: { query: "presidents" } }] };
        }
        if (retrievalRound === 2) {
          return { text: "", toolCalls: [{ id: "f1", name: "alix_web_fetch", args: { url: "https://x" } }] };
        }
        return { text: "I have the page now.", toolCalls: [] };
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
            return { kind: "success" as const, output: `content from ${req.name}` };
          },
        }),
        toolCandidateAliases: ALIASES,
      } as never,
    );

    // The search AND the fetch both ran — the whole point of the loop.
    assert.deepEqual(executed, ["web.search", "web.fetch"]);
    // The synthesis saw both results, not just the first round's.
    const synthesis = requests.find((r) => r.systemPrompt === GROUNDED_SYNTHESIS_PROMPT)!;
    assert.ok(synthesis);
    const synthesisMessages = (synthesis as { messages?: Array<{ content: string }> }).messages ?? [];
    const joined = synthesisMessages.map((m) => m.content).join("\n");
    assert.match(joined, /content from web\.search/);
    assert.match(joined, /content from web\.fetch/);
    assert.match(answer, /All sixteen presidents/);
  });

  it("stops at the round bound when the model keeps requesting tools", async () => {
    let retrievalCalls = 0;
    const executed: string[] = [];
    const route = {
      kind: "grounded_chat" as const,
      prompt: "loop forever",
      allowedTools: ["web.search", "web.fetch"],
      diagnostic: { classification: "external_retrieval" },
    };
    const provider: ModelAdapter = {
      id: "mock",
      capabilities: {},
      complete: async (request: RecordedRequest) => {
        if (request.systemPrompt === GROUNDED_SYNTHESIS_PROMPT) {
          return { text: "bounded answer", toolCalls: [] };
        }
        retrievalCalls++;
        // Never stops asking for tools.
        return { text: "", toolCalls: [{ id: `s${retrievalCalls}`, name: "alix_web_search", args: { query: "x" } }] };
      },
    } as unknown as ModelAdapter;

    await executeGroundedChatBehavior(
      route as never,
      { permissions: { allowNetworkDomains: [] } } as never,
      {
        cwd: process.cwd(),
        eventLog: { append: async () => {} },
        providerFactory: async () => provider,
        toolExecutorFactory: async () => ({
          execute: async (req: { name: string }) => {
            executed.push(req.name);
            return { kind: "success" as const, output: "x" };
          },
        }),
        toolCandidateAliases: ALIASES,
      } as never,
    );

    // Bounded on EXECUTED tools: never more rounds than the cap allows, even
    // though the model keeps asking. (Provider calls = rounds + 1 initial.)
    assert.equal(
      executed.length,
      GROUNDED_MAX_TOOL_ROUNDS,
      `retrieval must be bounded to ${GROUNDED_MAX_TOOL_ROUNDS} tool rounds`,
    );
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
    // Retrieval rounds call tools; the first synthesis round leaks a fetch as
    // prose; the re-synthesis answers. Keyed off the system prompt so the
    // bounded retrieval loop's extra rounds do not shift the fixture.
    let synthesisRounds = 0;
    const provider: ModelAdapter = {
      id: "mock",
      capabilities: {},
      complete: async (request: RecordedRequest) => {
        requests.push(request);
        if (request.systemPrompt !== GROUNDED_SYNTHESIS_PROMPT) {
          return { text: "", toolCalls: [{ id: "tc1", name: "alix_web_search", args: { query: "x" } }] };
        }
        synthesisRounds++;
        return synthesisRounds === 1
          ? {
              text: "I'll fetch the page that lists all 16 states.\n\n<dots_function_call>\n[alix_web_fetch]\n{\"url\":\"https://example.com/list\"}\n```",
              toolCalls: [],
            }
          : { text: "Benin: Patrice Tal. Burkina Faso: Ibrahim Traore.", toolCalls: [] };
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

    // The leaked fetch actually ran (the bounded search rounds plus the
    // recovered leaked fetch), and the answer is a real one.
    assert.ok(executed.length >= 2, `expected the leaked fetch to dispatch (ran ${executed.length})`);
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
        if (request.systemPrompt === GROUNDED_SYNTHESIS_PROMPT) {
          return { text: "I'll fetch the page and compile the list for you.", toolCalls: [] };
        }
        return { text: "", toolCalls: [{ id: "tc1", name: "alix_web_search", args: { query: "x" } }] };
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