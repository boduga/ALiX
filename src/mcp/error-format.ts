// src/mcp/error-format.ts

import type { JsonRpcResponse, JsonRpcNotification } from "./types.js";

/**
 * Extract a JSON-RPC error object into an Error, or null when the message
 * carries a result instead. Single source for the "is this a JSON-RPC error
 * frame?" shape shared by every transport — avoids each transport re-deriving
 * it (and diverging, e.g. on the fallback message).
 */
export function jsonRpcError(message: JsonRpcResponse | JsonRpcNotification): Error | null {
  if ("error" in message && message.error) {
    return new Error(message.error.message ?? "JSON-RPC error from server");
  }
  return null;
}

export type McpErrorKind =
  | "connection"
  | "timeout"
  | "tool_not_found"
  | "invalid_response"
  | "permission_denied"
  | "unknown";

export type McpError = {
  kind: McpErrorKind;
  server: string;
  cause?: string;
  tool?: string;
  timeoutMs?: number;
  detail?: string;
};

export function formatMcpError(err: McpError): string {
  switch (err.kind) {
    case "connection":
      return `MCP server "${err.server}" could not connect: ${err.cause ?? "unknown reason"}. Check that the server is running.`;
    case "timeout":
      return `MCP server "${err.server}" timed out after ${err.timeoutMs ?? "?"}ms. The server may be slow or unresponsive.`;
    case "tool_not_found":
      return `MCP server "${err.server}" does not provide tool "${err.tool}". Run \`alix mcp list\` to see available tools.`;
    case "invalid_response":
      return `MCP server "${err.server}" returned an invalid response: ${err.detail ?? err.cause ?? "parse error"}. The server may be incompatible.`;
    case "permission_denied":
      return `MCP server "${err.server}" denied access${err.detail ?? err.cause ? `: ${err.detail ?? err.cause}` : ". Check server permissions."}`;
    case "unknown":
      return `MCP server "${err.server}" error: ${err.detail ?? err.cause ?? "unknown"}`;
  }
}

export function classifyMcpError(err: Error): McpErrorKind {
  const msg = err.message.toLowerCase();
  // HTTP transport failures carry a status code (e.g. "HTTP 400: ..."). Check
  // these FIRST — a status code is a transport fact that must win over any
  // body-derived heuristic (a 504 whose body says "timeout" is a server-side
  // failure, not a client-side timeout; a 500 whose body says "session" is not
  // an auth denial). The body is the server's rejection message, not a
  // malformed payload — don't mislabel it as a parse/invalid response.
  const httpMatch = /^http (\d{3})/.exec(msg);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    // 401/403 are unambiguous auth failures. For other 4xx, treat auth language
    // in the body as permission_denied (e.g. Langfuse 400 "Invalid session").
    // 5xx are server-side → connection.
    const authish4xx = status >= 400 && status < 500
      && (msg.includes("session") || msg.includes("unauthorized") || msg.includes("denied") || msg.includes("permission"));
    return status === 401 || status === 403 || authish4xx ? "permission_denied" : "connection";
  }
  if (msg.includes("enoent") || msg.includes("econnrefused") || msg.includes("connect")) {
    return "connection";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("not found") || msg.includes("unknown tool")) {
    return "tool_not_found";
  }
  if (msg.includes("parse") || msg.includes("json") || msg.includes("invalid")) {
    return "invalid_response";
  }
  return "unknown";
}
