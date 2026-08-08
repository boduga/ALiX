import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateMessageTokens, ensureEncoder } from "../src/utils/tokens.js";

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

test("estimateTokens counts tokens with the o200k_base tokenizer", async () => {
  await ensureEncoder("o200k_base");
  const text = "hello world this is a test";
  const tokens = estimateTokens(text, "o200k_base");
  assert.ok(tokens > 0);
});