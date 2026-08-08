import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateBudgetTokens,
  estimateMessageBudgetTokens,
} from "../../src/utils/tokens.js";

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
