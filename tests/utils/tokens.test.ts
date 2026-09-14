import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateBudgetTokens,
  estimateMessageBudgetTokens,
  tokenCountCacheSize,
  clearTokenCountCache,
} from "../../src/utils/tokens.js";

describe("token estimation cache (#699)", () => {
  it("encodes repeated text once and returns identical metadata", async () => {
    clearTokenCountCache();
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const first = await estimateBudgetTokens(text, "cl100k_base");
    const sizeAfterFirst = tokenCountCacheSize("cl100k_base");
    const second = await estimateBudgetTokens(text, "cl100k_base");
    const sizeAfterSecond = tokenCountCacheSize("cl100k_base");

    assert.deepEqual(second, first, "budget decisions unchanged for equivalent input");
    assert.equal(sizeAfterSecond, sizeAfterFirst, "no new encode for unchanged text");
  });

  it("caches each distinct message content once", async () => {
    clearTokenCountCache();
    const system = "SYSTEM PROMPT: follow the rules.";
    const msg = { role: "user", content: "hello world" };
    await estimateBudgetTokens(system, "cl100k_base");
    await estimateMessageBudgetTokens(msg, "cl100k_base");
    const after = tokenCountCacheSize("cl100k_base");

    // Re-estimating both adds nothing new.
    await estimateBudgetTokens(system, "cl100k_base");
    await estimateMessageBudgetTokens(msg, "cl100k_base");
    assert.equal(tokenCountCacheSize("cl100k_base"), after);
  });
});
