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

  it("falls back to cause when invalid response has no detail", () => {
    const e: McpError = { kind: "invalid_response", server: "github", cause: "Unexpected token in JSON" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("Unexpected token in JSON"));
    assert.ok(!msg.includes("parse error"), "should not show the generic placeholder when a cause exists");
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

  it("classifies HTTP 400 with session rejection as permission_denied", () => {
    const e = new Error('HTTP 400: {"error":"Invalid session"}');
    const kind = classifyMcpError(e);
    assert.equal(kind, "permission_denied");
  });

  it("classifies HTTP 401 as permission_denied", () => {
    const e = new Error("HTTP 401: Unauthorized");
    const kind = classifyMcpError(e);
    assert.equal(kind, "permission_denied");
  });

  it("classifies other HTTP statuses as connection, not invalid_response", () => {
    const e = new Error("HTTP 500: Internal Server Error");
    const kind = classifyMcpError(e);
    assert.equal(kind, "connection");
  });

  it("still classifies genuine JSON parse failures as invalid_response", () => {
    const e = new Error("Unexpected token < in JSON at position 0");
    const kind = classifyMcpError(e);
    assert.equal(kind, "invalid_response");
  });
});
