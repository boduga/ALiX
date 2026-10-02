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
      "agent.system-base": "3f8b304be91a23b0",
      "agent.research-supplement": "b874aa6c71159b03",
      "agent.execution-supplement": "7b62665ebcd35a95",
      "agent.verification-supplement": "f104d69cfdfe3fa3",
      "agent.shell-task": "54517b069791b569",
      "agent.read-only-mode": "47cee00c48da8752",
      "subagent.explorer": "688d0d2d82929e9f",
      "subagent.reviewer": "0dee12e10bd5c931",
      "subagent.test-investigator": "22872bbc841610b6",
      "subagent.docs-researcher": "36f722f069f3b831",
      "subagent.worker": "43df6b28ad9296dd",
      "subagent.researcher": "f4fea7a09a499d77",
      "planner.graph": "0b216b9fe8900680",
      "route.retrieval-system": "e92d8e599b6d8489",
    };
    for (const e of PROMPT_REGISTRY) {
      assert.equal(sha(e.text), snapshot[e.id], `${e.id} text changed without a version bump (update snapshot + version)`);
    }
  });

  // Prompt text is model-facing instruction: naming a retired tool spelling
  // sends the model at a fail-closed tool boundary (`shell_run`, `done`, and
  // `file_create` are all rejected — only exact offered `alix_*` names resolve).
  it("prompt texts use exact model-facing tool names", () => {
    const retiredSpellings = [
      "`done`", "`shell_run`", "`file_read`", "`file_create`", "`file_write`",
      "`grep_search`", "`glob_match`", "`dir_search`", "`patch_apply`",
      "`mcp_search_tools`", "`file.read`", "`shell.run`",
    ];
    for (const e of PROMPT_REGISTRY) {
      for (const spelling of retiredSpellings) {
        assert.ok(
          !e.text.includes(spelling),
          `${e.id} instructs the model to use ${spelling}; the resolver accepts only exact offered alix_* names`,
        );
      }
    }
  });
});
