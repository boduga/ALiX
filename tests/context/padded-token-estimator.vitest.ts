import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateBudgetTokens,
  estimateMessageBudgetTokens,
  ensureEncoder,
  truncateToTokenBudget,
} from "../../src/utils/tokens.js";
import {
  resolveModelDescriptor,
  clearModelDescriptorCache,
} from "../../src/config/context-limits.js";

const TEXT = "const x = () => foo({ bar: 'baz' });";

describe("estimateBudgetTokens (padded admission estimator)", () => {
  it("pads the base tokenizer estimate by 1.20 and ceils", async () => {
    const meta = await estimateBudgetTokens(TEXT, "cl100k_base");
    const raw = estimateTokens(TEXT, "cl100k_base");
    expect(meta.rawEstimate).toBe(raw);
    expect(meta.budgetEstimate).toBe(Math.ceil(raw * 1.2));
    expect(meta.safetyFactor).toBe(1.2);
    expect(meta.tokenizer).toBe("cl100k_base");
  });

  it("returns estimation metadata { tokenizer, rawEstimate, safetyFactor, budgetEstimate }", async () => {
    const meta = await estimateBudgetTokens(TEXT, "o200k_base");
    expect(Object.keys(meta).sort()).toEqual([
      "budgetEstimate",
      "rawEstimate",
      "safetyFactor",
      "tokenizer",
    ]);
    expect(meta.tokenizer).toBe("o200k_base");
  });

  it("uses the o200k_base tokenizer when requested", async () => {
    const meta = await estimateBudgetTokens(TEXT, "o200k_base");
    expect(meta.tokenizer).toBe("o200k_base");
  });

  it("empty input estimates zero", async () => {
    const meta = await estimateBudgetTokens("", "cl100k_base");
    expect(meta.rawEstimate).toBe(0);
    expect(meta.budgetEstimate).toBe(0);
  });

  it("the padded estimate is the budget-admission number (padded >= raw)", async () => {
    const meta = await estimateBudgetTokens(TEXT, "cl100k_base");
    expect(meta.budgetEstimate).toBeGreaterThanOrEqual(meta.rawEstimate);
    expect(meta.rawEstimate).toBeGreaterThan(0);
  });
});

describe("run-path encoder loading (E1: truncation measures with tiktoken, not char/4)", () => {
  beforeEach(() => {
    clearModelDescriptorCache();
  });

  it("a loaded cl100k_base encoder yields tiktoken counts (2), not char/4 (3), for 'hello world'", async () => {
    await ensureEncoder("cl100k_base");
    // char/4 would be ceil(11/4) = 3 — the exact under-count this ticket removes.
    expect(estimateTokens("hello world", "cl100k_base")).toBe(2);
  });

  it("a loaded o200k_base encoder yields tiktoken counts for code-dense text (12), not char/4 (8)", async () => {
    await ensureEncoder("o200k_base");
    const text = "const x = () => foo({ bar: 1 });";
    // char/4 would be ceil(32/4) = 8.
    expect(estimateTokens(text, "o200k_base")).toBe(12);
  });

  it("a run-path-resolved descriptor tokenizer, once ensured, measures with tiktoken", async () => {
    const d = await resolveModelDescriptor("openai", "gpt-4o");
    // Mirrors the run-path guarantee: setupContextLimits (session.ts) and
    // runTaskCore (agent-loop.ts) resolve the descriptor then ensure the
    // encoder before any admission/truncation call.
    await ensureEncoder(d.tokenizer);
    expect(estimateTokens("hello world", d.tokenizer)).toBe(2); // char/4 would be 3
  });

  it("truncation over a loaded encoder drops by tiktoken, not char/4", async () => {
    await ensureEncoder("cl100k_base");
    const messages = [
      { role: "user", content: "hello world" }, // 5 + 2 = 7 tokens
      { role: "assistant", content: "const x = () => foo({ bar: 1 });" }, // 5 + 12 = 17
    ];
    // cl100k total = 24; char/4 total = (5+3)+(5+8) = 21. A budget of 22
    // therefore discriminates: tiktoken drops the older message, char/4 would
    // keep both.
    const { kept, dropped } = truncateToTokenBudget(messages, 22, "cl100k_base");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].content).toBe("hello world");
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toBe("const x = () => foo({ bar: 1 });");
  });
});

describe("estimateMessageBudgetTokens", () => {
  it("keeps the 5-token role overhead under the padded estimator", async () => {
    const msg = { role: "user", content: "hello" };
    const meta = await estimateMessageBudgetTokens(msg, "cl100k_base");
    const contentTokens = estimateTokens("hello", "cl100k_base");
    expect(meta.rawEstimate).toBeGreaterThanOrEqual(5 + contentTokens);
    expect(meta.budgetEstimate).toBe(Math.ceil(meta.rawEstimate * 1.2));
  });

  it("keeps the 6-token name overhead under the padded estimator", async () => {
    const withName = estimateMessageTokens(
      { role: "user", name: "alice", content: "hello" },
      "cl100k_base",
    );
    const withoutName = estimateMessageTokens(
      { role: "user", content: "hello" },
      "cl100k_base",
    );
    expect(withName - withoutName).toBe(estimateTokens("alice", "cl100k_base") + 6);

    const meta = await estimateMessageBudgetTokens(
      { role: "user", name: "alice", content: "hello" },
      "cl100k_base",
    );
    expect(meta.rawEstimate).toBe(withName);
  });
});
