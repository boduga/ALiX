import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateMessageTokens, truncateToTokenBudget, ensureEncoder } from "../src/utils/tokens.js";

const ENCODING = "cl100k_base";

test("estimateTokens counts tokens with tiktoken", async () => {
  await ensureEncoder(ENCODING);
  const text = "hello world this is a test";
  const tokens = estimateTokens(text, ENCODING);
  assert.ok(tokens > 0);
});

test("estimateTokens returns 0 for empty string", async () => {
  await ensureEncoder(ENCODING);
  assert.equal(estimateTokens("", ENCODING), 0);
});

test("estimateMessageTokens includes role overhead", async () => {
  await ensureEncoder(ENCODING);
  const msg = { role: "user", content: "hello" };
  const tokens = estimateMessageTokens(msg, ENCODING);
  // role overhead is 5, content "hello" ≈ 1 token
  assert.ok(tokens >= 6);
});

test("estimateMessageTokens includes name overhead", async () => {
  await ensureEncoder(ENCODING);
  const msg = { role: "user", name: "alice", content: "hello" };
  const withName = estimateMessageTokens(msg, ENCODING);
  const withoutName = estimateMessageTokens({ role: "user", content: "hello" }, ENCODING);
  assert.ok(withName > withoutName);
});

test("truncateToTokenBudget keeps most recent messages", async () => {
  await ensureEncoder(ENCODING);
  const messages = [
    { role: "user", content: "a".repeat(10000) },
    { role: "assistant", content: "b".repeat(10000) },
    { role: "user", content: "c".repeat(10000) },
  ];
  const { kept, dropped } = truncateToTokenBudget(messages, 4000, ENCODING);
  assert.ok(kept.length < messages.length);
  assert.ok(dropped.length > 0);
  // Should keep most recent messages
  assert.equal(kept[kept.length - 1].content, "c".repeat(10000));
});

test("truncateToTokenBudget returns all messages when under budget", async () => {
  await ensureEncoder(ENCODING);
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ];
  const { kept, dropped } = truncateToTokenBudget(messages, 100000, ENCODING);
  assert.equal(kept.length, messages.length);
  assert.equal(dropped.length, 0);
});

test("truncateToTokenBudget returns empty kept when budget too small", async () => {
  await ensureEncoder(ENCODING);
  const messages = [
    { role: "user", content: "a".repeat(10000) },
  ];
  // Budget is so small even one message won't fit
  const { kept, dropped } = truncateToTokenBudget(messages, 1, ENCODING);
  assert.ok(kept.length <= 1);
});

test("estimateTokens falls back to char/4 for char4 encoding", async () => {
  await ensureEncoder("char4");
  const text = "hello world";
  const tokens = estimateTokens(text, "char4");
  // "hello world" is 11 chars, 11/4 = 2.75 → ceil = 3
  assert.equal(tokens, 3);
});