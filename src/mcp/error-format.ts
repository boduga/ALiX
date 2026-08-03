// src/mcp/error-format.ts

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
      return `MCP server "${err.server}" denied access. Check server permissions.`;
    case "unknown":
      return `MCP server "${err.server}" error: ${err.detail ?? err.cause ?? "unknown"}`;
  }
}

export function classifyMcpError(err: Error): McpErrorKind {
  const msg = err.message.toLowerCase();
  if (msg.includes("enoent") || msg.includes("econnrefused") || msg.includes("connect")) {
    return "connection";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("not found") || msg.includes("unknown tool")) {
    return "tool_not_found";
  }
  // HTTP transport failures carry a status code (e.g. "HTTP 400: ..."). The
  // body is the server's rejection message, not a malformed payload — don't
  // mislabel it as a parse/invalid response.
  if (/^http \d{3}/.test(msg)) {
    if (msg.includes("401") || msg.includes("403") || msg.includes("session") || msg.includes("unauthorized") || msg.includes("denied")) {
      return "permission_denied";
    }
    return "connection";
  }
  if (msg.includes("parse") || msg.includes("json") || msg.includes("invalid")) {
    return "invalid_response";
  }
  return "unknown";
}
