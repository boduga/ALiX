// tests/mcp/error-format.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMcpError, classifyMcpError, jsonRpcError, type McpError } from "../../src/mcp/error-format.js";
import type { JsonRpcResponse, JsonRpcNotification } from "../../src/mcp/types.js";

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

  it("permission_denied surfaces the server rejection reason via detail or cause", () => {
    const e: McpError = { kind: "permission_denied", server: "github", detail: "Invalid session" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("Invalid session"), "should include the server's rejection reason");
  });

  it("permission_denied falls back to a generic message when no reason is present", () => {
    const e: McpError = { kind: "permission_denied", server: "github" };
    const msg = formatMcpError(e);
    assert.ok(msg.includes("permissions"), "should retain the generic permissions guidance");
  });
});

describe("jsonRpcError", () => {
  it("returns null for a result-bearing message", () => {
    const msg: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: { ok: true } };
    assert.equal(jsonRpcError(msg), null);
  });

  it("returns an Error for an error-bearing message", () => {
    const msg: JsonRpcResponse = { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Invalid session" } };
    const err = jsonRpcError(msg);
    assert.ok(err instanceof Error);
    assert.equal(err!.message, "Invalid session");
  });

  it("falls back to a stable message when the error carries no message", () => {
    // A malformed server may omit the message entirely (runtime reality even
    // though the type says it's required) — the helper must not produce
    // `new Error(undefined)`.
    const msg = { jsonrpc: "2.0", id: 1, error: { code: -1 } } as unknown as JsonRpcResponse;
    const err = jsonRpcError(msg);
    assert.equal(err!.message, "JSON-RPC error from server");
  });

  it("returns null for a notification", () => {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
    assert.equal(jsonRpcError(msg), null);
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

  it("classifies HTTP 5xx whose body mentions session as connection, not permission_denied", () => {
    const e = new Error("HTTP 500: Session store unavailable");
    const kind = classifyMcpError(e);
    assert.equal(kind, "connection");
  });

  it("classifies HTTP 504 with a timeout body as connection, not timeout", () => {
    const e = new Error("HTTP 504: Gateway Timeout");
    const kind = classifyMcpError(e);
    assert.equal(kind, "connection");
  });

  it("classifies HTTP 400 with no auth language as connection", () => {
    const e = new Error("HTTP 400: Bad Request");
    const kind = classifyMcpError(e);
    assert.equal(kind, "connection");
  });
});
