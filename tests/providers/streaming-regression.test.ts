/**
 * streaming-regression.test.ts — Verify every provider spec's stream
 * chunk parser handles real SSE/SSE-like responses correctly.
 *
 * Tests focus on fromStreamChunk — no HTTP calls, no real API keys.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleSpec } from "../../src/providers/specs/google-spec.js";
import { openaiSpec } from "../../src/providers/specs/openai-spec.js";
import { anthropicSpec } from "../../src/providers/specs/anthropic-spec.js";
import { ollamaSpec } from "../../src/providers/specs/ollama-spec.js";
import { deepseekSpec } from "../../src/providers/specs/deepseek-spec.js";
import { groqSpec } from "../../src/providers/specs/groq-spec.js";
import { perplexitySpec } from "../../src/providers/specs/perplexity-spec.js";
import { minimaxSpec } from "../../src/providers/specs/minimax-spec.js";
import { zhipuaiSpec } from "../../src/providers/specs/zhipuai-spec.js";
import { grokaiSpec } from "../../src/providers/specs/grokai-spec.js";
import { openrouterSpec } from "../../src/providers/specs/openrouter-spec.js";
import { localLlamaSpec } from "../../src/providers/specs/local-llama-spec.js";
import type { ProviderSpec } from "../../src/providers/spec-types.js";
import type { StreamChunk } from "../../src/providers/types.js";

const STREAMING_SPECS: [string, ProviderSpec][] = [
  ["google", googleSpec],
  ["openai", openaiSpec],
  ["anthropic", anthropicSpec],
  ["ollama", ollamaSpec],
  ["deepseek", deepseekSpec],
  ["groq", groqSpec],
  ["perplexity", perplexitySpec],
  ["minimax", minimaxSpec],
  ["zhipuai", zhipuaiSpec],
  ["grokai", grokaiSpec],
  ["openrouter", openrouterSpec],
  ["local-llama", localLlamaSpec],
];

/** Lines that every openai-compat spec should parse as text_delta */
const OPENAI_DELTA_LINE = `data: {"choices":[{"delta":{"content":"Hello"}}]}`;

/** Lines that every openai-compat spec should parse as a done signal */
const OPENAI_DONE_LINE = "data: [DONE]";

/** Lines that every openai-compat spec should parse as usage */
const OPENAI_USAGE_LINE = `data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}`;

interface ChunkTestCase {
  line: string;
  assert: (chunk: StreamChunk | null, name: string) => void;
}

// ── Per-spec test-case builders ──────────────────────────────────────────

function openaiTestCases(): ChunkTestCase[] {
  return [
    {
      line: OPENAI_DELTA_LINE,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk`);
        assert.equal(c!.type, "text_delta", `${name}: expected text_delta`);
        assert.equal((c as { type: "text_delta"; text: string }).text, "Hello");
      },
    },
    {
      line: OPENAI_DONE_LINE,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk for [DONE]`);
        assert.equal(c!.type, "done", `${name}: expected done`);
      },
    },
    {
      line: OPENAI_USAGE_LINE,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk for usage`);
        assert.equal(c!.type, "usage", `${name}: expected usage`);
      },
    },
  ];
}

function googleTestCases(): ChunkTestCase[] {
  return [
    {
      line: `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}`,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk`);
        assert.equal(c!.type, "text_delta", `${name}: expected text_delta`);
        assert.equal((c as { type: "text_delta"; text: string }).text, "Hello");
      },
    },
    {
      // Partial text (empty string) — Google sends empty parts
      line: `data: {"candidates":[{"content":{"parts":[{}]}}]}`,
      assert: (c, _name) => {
        assert.equal(c, null, "Google: empty parts should return null");
      },
    },
    {
      // Non-text chunk — e.g. safety metadata
      line: `data: {"candidates":[{"finishReason":"STOP","safetyRatings":[]}]}`,
      assert: (c, _name) => {
        assert.equal(c, null, "Google: finish-only chunk should return null");
      },
    },
  ];
}

function anthropicTestCases(): ChunkTestCase[] {
  return [
    {
      line: `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}`,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk`);
        assert.equal(c!.type, "text_delta");
        assert.equal((c as { type: "text_delta"; text: string }).text, "Hello");
      },
    },
    {
      line: `data: {"type":"message_stop"}`,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk for message_stop`);
        assert.equal(c!.type, "done");
      },
    },
    {
      line: `data: {"type":"message_delta","usage":{"input_tokens":10,"output_tokens":5}}`,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk for usage`);
        assert.equal(c!.type, "usage");
      },
    },
  ];
}

function ollamaTestCases(): ChunkTestCase[] {
  return [
    {
      line: `{"response":"Hello"}`,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk`);
        assert.equal(c!.type, "text_delta");
        assert.equal((c as { type: "text_delta"; text: string }).text, "Hello");
      },
    },
    {
      line: `{"done":true,"response":""}`,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected done`);
        assert.equal(c!.type, "done");
      },
    },
  ];
}

/** local-llama has its own fromStreamChunk that omits usage parsing */
function localLlamaTestCases(): ChunkTestCase[] {
  return [
    {
      line: OPENAI_DELTA_LINE,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk`);
        assert.equal(c!.type, "text_delta");
        assert.equal((c as { type: "text_delta"; text: string }).text, "Hello");
      },
    },
    {
      line: OPENAI_DONE_LINE,
      assert: (c, name) => {
        assert.notEqual(c, null, `${name}: expected non-null chunk for [DONE]`);
        assert.equal(c!.type, "done");
      },
    },
  ];
}

/** Per-spec test-case mapping */
const SPEC_CASES: Record<string, ChunkTestCase[]> = {
  google: googleTestCases(),
  openai: openaiTestCases(),
  anthropic: anthropicTestCases(),
  ollama: ollamaTestCases(),
  deepseek: openaiTestCases(),
  groq: openaiTestCases(),
  perplexity: openaiTestCases(),
  minimax: openaiTestCases(),
  zhipuai: openaiTestCases(),
  grokai: openaiTestCases(),
  openrouter: openaiTestCases(),
  "local-llama": localLlamaTestCases(),
};

// ── Boundary / edge-case lines shared by all specs ───────────────────────

interface EdgeCase { line: string; reason: string }

const EDGE_CASES: EdgeCase[] = [
  { line: "", reason: "empty line" },
  { line: ": keepalive", reason: "SSE comment/keepalive" },
  { line: "data: ", reason: "data with no payload" },
  { line: "data: null", reason: "data: null" },
  { line: "data: {\"bad_json\"", reason: "malformed JSON" },
  { line: "not even close", reason: "garbage input" },
];

// ── Tests ────────────────────────────────────────────────────────────────

describe("streaming regression", () => {
  for (const [name, spec] of STREAMING_SPECS) {
    const cases = SPEC_CASES[name];
    if (!cases) throw new Error(`Missing test cases for ${name}`);

    describe(name, () => {
      it("parses content chunks correctly", () => {
        for (const tc of cases) {
          const result = spec.fromStreamChunk(tc.line);
          tc.assert(result, name);
        }
      });

      it("returns null for edge cases", () => {
        for (const ec of EDGE_CASES) {
          const result = spec.fromStreamChunk(ec.line);
          assert.equal(result, null, `${name}: expected null for "${ec.line}" (${ec.reason}); got ${result?.type ?? "null"}`);
        }
      });

      it("is a function", () => {
        assert.equal(typeof spec.fromStreamChunk, "function");
      });
    });
  }

  // ── Cross-spec sanity ──

  it("all openai-compat specs parse text_delta identically", () => {
    const openaiCompat: [string, ProviderSpec][] = [
      ["openai", openaiSpec], ["deepseek", deepseekSpec], ["groq", groqSpec],
      ["perplexity", perplexitySpec], ["minimax", minimaxSpec], ["zhipuai", zhipuaiSpec],
      ["grokai", grokaiSpec], ["openrouter", openrouterSpec], ["local-llama", localLlamaSpec],
    ];
    for (const [, spec] of openaiCompat) {
      const chunk = spec.fromStreamChunk(OPENAI_DELTA_LINE);
      assert.notEqual(chunk, null);
      assert.equal(chunk!.type, "text_delta");
    }
  });

  it("all openai-compat specs parse [DONE] as done", () => {
    const openaiCompat: [string, ProviderSpec][] = [
      ["openai", openaiSpec], ["deepseek", deepseekSpec], ["groq", groqSpec],
      ["perplexity", perplexitySpec], ["minimax", minimaxSpec], ["zhipuai", zhipuaiSpec],
      ["grokai", grokaiSpec], ["openrouter", openrouterSpec], ["local-llama", localLlamaSpec],
    ];
    for (const [, spec] of openaiCompat) {
      const chunk = spec.fromStreamChunk(OPENAI_DONE_LINE);
      assert.notEqual(chunk, null);
      assert.equal(chunk!.type, "done");
    }
  });
});
