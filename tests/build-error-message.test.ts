import test from "node:test";
import assert from "node:assert/strict";
import { buildErrorMessage } from "../src/run.js";

// --- Error results ---

test("buildErrorMessage includes Error prefix", () => {
  const msg = buildErrorMessage({ kind: "error", message: "something failed" });
  assert.ok(msg.includes("Error: something failed"));
});

test("buildErrorMessage includes Hint when hint is present", () => {
  const msg = buildErrorMessage({ kind: "error", message: "bad path", hint: "Check the path is inside the project" });
  assert.ok(msg.includes("Hint: Check the path is inside the project"));
});

test("buildErrorMessage does not include Hint when hint is absent", () => {
  const msg = buildErrorMessage({ kind: "error", message: "oops" });
  assert.ok(!msg.includes("Hint:"));
});

test("buildErrorMessage signals fatal for retryable: false", () => {
  const msg = buildErrorMessage({ kind: "error", message: "invalid api key", retryable: false });
  assert.ok(msg.includes("do not retry"));
  assert.ok(!msg.includes("may be transient"));
});

test("buildErrorMessage signals transient hint for retryable: true", () => {
  const msg = buildErrorMessage({ kind: "error", message: "timeout", retryable: true });
  assert.ok(msg.includes("may be transient"));
  assert.ok(!msg.includes("do not retry"));
});

test("buildErrorMessage omits retry signal when retryable is undefined", () => {
  const msg = buildErrorMessage({ kind: "error", message: "oops" });
  assert.ok(!msg.includes("do not retry"));
  assert.ok(!msg.includes("may be transient"));
});

test("buildErrorMessage formats full fatal error correctly", () => {
  const msg = buildErrorMessage({
    kind: "error",
    message: "invalid api key",
    hint: "Check ANTHROPIC_API_KEY is set",
    retryable: false
  });
  assert.ok(msg.startsWith("Error: invalid api key"));
  assert.ok(msg.includes("Hint: Check ANTHROPIC_API_KEY is set"));
  assert.ok(msg.includes("do not retry"));
});

test("buildErrorMessage formats full retryable error correctly", () => {
  const msg = buildErrorMessage({
    kind: "error",
    message: "connection refused",
    hint: "Check the server is running",
    retryable: true
  });
  assert.ok(msg.startsWith("Error: connection refused"));
  assert.ok(msg.includes("Hint: Check the server is running"));
  assert.ok(msg.includes("may be transient"));
});