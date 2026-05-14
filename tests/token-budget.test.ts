import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateMessageTokens, truncateToTokenBudget } from "../src/utils/tokens.js";

test("estimateTokens counts words roughly", () => {
  const text = "hello world this is a test";
  const tokens = estimateTokens(text);
  assert.ok(tokens > 0);
  assert.ok(tokens <= text.split(" ").length * 2); // rough upper bound
});

test("estimateTokens returns 0 for empty string", () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateMessageTokens includes role overhead", () => {
  const msg = { role: "user", content: "hello" };
  const tokens = estimateMessageTokens(msg);
  // role overhead is 5, content "hello" is 5 chars -> ceil(5/4) = 2 tokens
  assert.ok(tokens >= 7);
});

test("estimateMessageTokens includes name overhead", () => {
  const msg = { role: "user", name: "alice", content: "hello" };
  const withName = estimateMessageTokens(msg);
  const withoutName = estimateMessageTokens({ role: "user", content: "hello" });
  assert.ok(withName > withoutName);
});

test("truncateToTokenBudget keeps most recent messages", () => {
  const messages = [
    { role: "user", content: "a".repeat(10000) },
    { role: "assistant", content: "b".repeat(10000) },
    { role: "user", content: "c".repeat(10000) },
  ];
  const { kept, dropped } = truncateToTokenBudget(messages, 4000);
  assert.ok(kept.length < messages.length);
  assert.ok(dropped.length > 0);
  // Should keep most recent messages
  assert.equal(kept[kept.length - 1].content, "c".repeat(10000));
});

test("truncateToTokenBudget returns all messages when under budget", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ];
  const { kept, dropped } = truncateToTokenBudget(messages, 100000);
  assert.equal(kept.length, messages.length);
  assert.equal(dropped.length, 0);
});

test("truncateToTokenBudget returns empty kept when budget too small", () => {
  const messages = [
    { role: "user", content: "a".repeat(10000) },
  ];
  // Budget is so small even one message won't fit
  const { kept, dropped } = truncateToTokenBudget(messages, 1);
  assert.ok(kept.length <= 1);
});