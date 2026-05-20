import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScopeDenialMessage,
  buildScopeRejectionSummary,
} from "../../src/run/event-handlers.js";

test("buildScopeDenialMessage returns proper message format", () => {
  const toolCallId = "call-123";
  const deniedPaths = ["src/secret.ts", "config/api-keys.json"];

  const message = buildScopeDenialMessage(toolCallId, deniedPaths);

  assert.equal(message.role, "user");
  const content = message.content as string;
  assert.ok(content.includes(`id="${toolCallId}"`), "Should include tool call ID");
  assert.ok(content.includes("Error:"), "Should include Error label");
  assert.ok(content.includes("secret.ts"), "Should include denied path");
  assert.ok(content.includes("api-keys.json"), "Should include denied path");
  assert.ok(content.includes("denied by the user"), "Should explain denial");
});

test("buildScopeDenialMessage includes Do NOT attempt warning", () => {
  const message = buildScopeDenialMessage("call-1", ["src/forbidden.ts"]);
  const content = message.content as string;

  assert.ok(content.includes("Do NOT attempt"), "Should warn against retries");
});

test("buildScopeRejectionSummary includes all paths", () => {
  const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const summary = buildScopeRejectionSummary(paths);

  assert.ok(summary.includes("non-TTY ask mode"), "Should mention non-TTY");
  assert.ok(summary.includes("src/a.ts"), "Should include first path");
  assert.ok(summary.includes("src/b.ts"), "Should include second path");
  assert.ok(summary.includes("src/c.ts"), "Should include third path");
});

test("buildScopeRejectionSummary handles single path", () => {
  const summary = buildScopeRejectionSummary(["src/only.ts"]);

  assert.ok(summary.includes("src/only.ts"), "Should include the path");
  assert.ok(summary.includes("rejected"), "Should mention rejection");
});

test("buildScopeDenialMessage and buildScopeRejectionSummary are distinct", () => {
  const toolCallId = "call-abc";
  const paths = ["src/file.ts"];

  const denialMessage = buildScopeDenialMessage(toolCallId, paths);
  const rejectionSummary = buildScopeRejectionSummary(paths);

  // Different purposes: one is a tool result, one is a summary
  assert.notStrictEqual(denialMessage.role, rejectionSummary);
  assert.ok(typeof denialMessage === "object", "Denial message is an object");
  assert.ok(typeof rejectionSummary === "string", "Rejection summary is a string");
});