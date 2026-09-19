import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PROMPT_REGISTRY } from "../../src/prompts/registry.js";
import { estimateTokens } from "../../src/utils/tokens.js";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 16);
}

describe("prompt registry", () => {
  it("has unique ids and versions", () => {
    const ids = PROMPT_REGISTRY.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const e of PROMPT_REGISTRY) {
      assert.match(e.version, /^\d+\.\d+\.\d+$/);
      assert.ok(e.source.length > 0);
    }
  });

  it("every entry resolves non-empty text", () => {
    for (const e of PROMPT_REGISTRY) {
      assert.ok(e.text.trim().length > 50, `${e.id} text too short`);
    }
  });

  it("reports per-layer token accounting", () => {
    const rows = PROMPT_REGISTRY.map(e => ({
      id: e.id,
      chars: e.text.length,
      // cl100k is the calibrated GPT-style tokenizer; used here only as a
      // relative size signal, not a billing figure.
      tokens: estimateTokens(e.text, "cl100k_base"),
    }));
    for (const row of rows) {
      assert.ok(row.tokens > 0, `${row.id} has no tokens`);
      assert.ok(row.tokens < 5000, `${row.id} exceeds 5000 heuristic tokens (${row.tokens})`);
    }
    const total = rows.reduce((n, r) => n + r.tokens, 0);
    assert.ok(total < 20000, `registry total exceeds 20000 heuristic tokens (${total})`);
  });

  // Text snapshot: fails loudly on unversioned prompt edits. When this
  // fails after an intentional prompt change, bump the entry version and
  // update the hash below.
  it("prompt texts match snapshot hashes", () => {
    const snapshot: Record<string, string> = {
      "agent.system-base": "56c5831bf6f8596d",
      "agent.research-supplement": "b874aa6c71159b03",
      "agent.execution-supplement": "7b62665ebcd35a95",
      "agent.verification-supplement": "f104d69cfdfe3fa3",
      "agent.shell-task": "240b73f373d06efe",
      "agent.read-only-mode": "47cee00c48da8752",
      "subagent.explorer": "ecf0727acebe1ee7",
      "subagent.reviewer": "a6c459924c1ea509",
      "subagent.test-investigator": "5b445591748fd480",
      "subagent.docs-researcher": "36f722f069f3b831",
      "subagent.worker": "43df6b28ad9296dd",
      "subagent.researcher": "ce69bbea7e10e472",
      "planner.graph": "25ba5b338988e8cc",
      "route.retrieval-system": "4a663044320ac9ba",
    };
    for (const e of PROMPT_REGISTRY) {
      assert.equal(sha(e.text), snapshot[e.id], `${e.id} text changed without a version bump (update snapshot + version)`);
    }
  });
});
