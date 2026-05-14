import test from "node:test";
import assert from "node:assert/strict";
import { classifyError } from "../src/tools/executor.js";

type ErrorResult = { kind: "error"; message: string; retryable?: boolean; hint?: string };

// --- classifyError: non-retryable (fatal) errors ---

test("classifyError marks 'unknown mcp tool' as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Unknown MCP tool: mcp_server_tool" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 'not initialized' as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "MCP manager not initialized" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 'authentication failed' as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Authentication failed for provider" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 401 as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Request failed: 401 Unauthorized" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 403 as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Request failed: 403 Forbidden" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 'invalid api key' as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Invalid API key provided" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 'permission denied' as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Permission denied accessing resource" });
  assert.equal(result.retryable, false);
});

test("classifyError marks 'path is outside' as retryable: false", () => {
  const result = classifyError({ kind: "error", message: "Path is outside workspace" });
  assert.equal(result.retryable, false);
});

// --- classifyError: retryable (transient) errors ---

test("classifyError marks 'timed out' as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Request timed out after 30s" });
  assert.equal(result.retryable, true);
});

test("classifyError marks 'timeout' as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Connection timeout" });
  assert.equal(result.retryable, true);
});

test("classifyError marks 429 rate limit as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Request failed: 429 Too Many Requests" });
  assert.equal(result.retryable, true);
});

test("classifyError marks 'rate limit' as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Rate limit exceeded" });
  assert.equal(result.retryable, true);
});

test("classifyError marks 'connection' error as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Connection error" });
  assert.equal(result.retryable, true);
});

test("classifyError marks ECONNREFUSED as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "connect ECONNREFUSED 127.0.0.1:3000" });
  assert.equal(result.retryable, true);
});

test("classifyError marks ETIMEDOUT as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "connect ETIMEDOUT" });
  assert.equal(result.retryable, true);
});

test("classifyError marks 503 as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Service unavailable: 503" });
  assert.equal(result.retryable, true);
});

test("classifyError marks 'unavailable' as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Service unavailable" });
  assert.equal(result.retryable, true);
});

// --- classifyError: unknown errors default to retryable ---

test("classifyError marks unknown error as retryable: true", () => {
  const result = classifyError({ kind: "error", message: "Something went wrong" });
  assert.equal(result.retryable, true);
});

test("classifyError preserves original message and kind", () => {
  const result = classifyError({ kind: "error", message: "foobar", hint: "Check your config" });
  assert.equal(result.kind, "error");
  assert.equal(result.message, "foobar");
  assert.equal(result.hint, "Check your config");
});

test("classifyError preserves existing retryable value on fatal errors", () => {
  const result = classifyError({ kind: "error", message: "path is outside workspace", retryable: false });
  assert.equal(result.retryable, false);
});