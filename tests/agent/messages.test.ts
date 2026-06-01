import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildErrorMessage, buildToolsForProvider } from "../../src/agent/messages.js";

describe("buildErrorMessage", () => {
  it("formats error with kind and message", () => {
    const msg = buildErrorMessage({ kind: "error", message: "boom" });
    assert.ok(msg.includes("boom"));
  });

  it("includes retryable hint when retryable: true", () => {
    const msg = buildErrorMessage({ kind: "error", message: "x", retryable: true });
    assert.ok(msg.includes("retry") || msg.includes("again"));
  });

  it("includes hint when provided", () => {
    const msg = buildErrorMessage({ kind: "error", message: "x", hint: "fix this" });
    assert.ok(msg.includes("fix this"));
  });
});

describe("buildToolsForProvider", () => {
  it("returns array of tool defs", () => {
    const tools = buildToolsForProvider({ editFormatPreference: "structured_patch" });
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
  });

  it("respects provider's edit format preference", () => {
    const structured = buildToolsForProvider({ editFormatPreference: "structured_patch" });
    const searchReplace = buildToolsForProvider({ editFormatPreference: "search_replace" });
    // Different preferences may produce different tools
    assert.notDeepEqual(structured, searchReplace);
  });
});