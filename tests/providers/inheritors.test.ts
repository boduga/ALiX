import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groqSpec } from "../../src/providers/specs/groq-spec.js";
import { deepseekSpec } from "../../src/providers/specs/deepseek-spec.js";
import { perplexitySpec } from "../../src/providers/specs/perplexity-spec.js";
import { minimaxSpec } from "../../src/providers/specs/minimax-spec.js";
import { zhipuaiSpec } from "../../src/providers/specs/zhipuai-spec.js";
import { grokaiSpec } from "../../src/providers/specs/grokai-spec.js";
import { openrouterSpec } from "../../src/providers/specs/openrouter-spec.js";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";

describe("OpenAI-compatible inheritors", () => {
  const cases = [
    ["groq", groqSpec, "https://api.groq.com/openai/v1/chat/completions"],
    ["deepseek", deepseekSpec, "https://api.deepseek.com/v1/chat/completions"],
    ["perplexity", perplexitySpec, "https://api.perplexity.ai/v1/chat/completions"],
    ["minimax", minimaxSpec, "https://api.minimax.chat/v1/text/chatcompletion_v2"],
    ["zhipuai", zhipuaiSpec, "https://open.bigmodel.cn/api/paas/v4/chat/completions"],
    ["grokai", grokaiSpec, "https://api.x.ai/v1/chat/completions"],
    ["openrouter", openrouterSpec, "https://openrouter.ai/api/v1/chat/completions"],
  ] as const;

  for (const [name, spec, expectedUrl] of cases) {
    it(`${name} uses correct baseUrl`, () => {
      assert.equal(spec.baseUrl, expectedUrl);
    });
    it(`${name} inherits OpenAI's auth`, () => {
      const headers = spec.authHeader("test-key");
      assert.equal(headers.Authorization, "Bearer test-key");
    });
    it(`${name} inherits toRequestBody from base`, () => {
      assert.equal(spec.toRequestBody, openaiBaseSpec.toRequestBody);
    });
    it(`${name} inherits fromResponse from base`, () => {
      assert.equal(spec.fromResponse, openaiBaseSpec.fromResponse);
    });
  }
});
