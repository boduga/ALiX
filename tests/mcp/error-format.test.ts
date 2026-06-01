// tests/mcp/error-format.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMcpError, classifyMcpError, type McpError } from "../../src/mcp/error-format.js";

describe("formatMcpError", () => {
  it("formats connection refused", () => {
    const e: McpError = { kind: "connection", server: "github", cause: "ECONNREFUSED" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("connect") || msg.includes("refused"));
  });

  it("formats timeout", () => {
    const e: McpError = { kind: "timeout", server: "github", timeoutMs: 5000 };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("timeout") || msg.includes("5000"));
  });

  it("formats tool not found", () => {
    const e: McpError = { kind: "tool_not_found", server: "github", tool: "nonexistent" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("nonexistent"));
  });

  it("formats invalid response", () => {
    const e: McpError = { kind: "invalid_response", server: "github", detail: "JSON parse failed" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("github"));
    assert.ok(msg.includes("JSON parse failed"));
  });
});

describe("classifyMcpError", () => {
  it("classifies ENOENT as connection", () => {
    const e = new Error("spawn ENOENT");
    const kind = classifyMcpError(e);
    assert.equal(kind, "connection");
  });

  it("classifies timeout errors", () => {
    const e = new Error("Request timed out after 5000ms");
    const kind = classifyMcpError(e);
    assert.equal(kind, "timeout");
  });

  it("returns unknown for unrecognized errors", () => {
    const e = new Error("Some random error");
    const kind = classifyMcpError(e);
    assert.equal(kind, "unknown");
  });
});
