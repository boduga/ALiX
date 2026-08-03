import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../../mcp/types.js";
import type { McpTransport } from "../../mcp/transport.js";
import type { McpTransportType } from "../../config/schema.js";

export class HttpTransport implements McpTransport {
  readonly name: string;
  readonly type: McpTransportType = "http";

  private url: string;
  private headers: Record<string, string>;
  private messageHandler: ((msg: JsonRpcResponse | JsonRpcNotification) => void) | null = null;
  // Streamable HTTP servers issue a session id on `initialize` that must be
  // replayed as a header on every subsequent request.
  private sessionId: string | null = null;

  constructor(name: string, url: string, headers: Record<string, string> = {}) {
    this.name = name;
    this.url = url;
    this.headers = headers;
  }

  async connect(): Promise<void> {
    // HTTP transport connects lazily on first request
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(`${this.url}`, {
        method: "POST",
        headers: this.requestHeaders(),
        body: JSON.stringify(message),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Capture the session id the server issued for this connection.
      const sid = response.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;

      const contentType = response.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        return await this.handleSSEStream(response);
      }

      const data = await response.json() as JsonRpcResponse;
      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request timed out after 60s`);
      }
      throw err;
    }
  }

  private requestHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      // Streamable HTTP servers may answer either way per-request; advertise both.
      Accept: "application/json, text/event-stream",
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...this.headers
    };
  }

  private async handleSSEStream(response: Response): Promise<JsonRpcResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    let buffer = "";
    const decoder = new TextDecoder();
    let result: JsonRpcResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data && data !== "[DONE]") {
            let msg: JsonRpcResponse | JsonRpcNotification | null = null;
            try {
              msg = JSON.parse(data) as JsonRpcResponse | JsonRpcNotification;
            } catch {
              // Malformed data frame — skip; a missing result is reported below.
              continue;
            }
            this.messageHandler?.(msg);
            if ("error" in msg && msg.error) {
              throw new Error(msg.error.message ?? "JSON-RPC error from server");
            }
            if ("result" in msg && !result) {
              result = msg as JsonRpcResponse;
            }
          }
        }
      }
    }

    if (!result) {
      throw new Error("Server returned no response for the JSON-RPC request");
    }

    return result;
  }

  async sendNotification(message: JsonRpcNotification): Promise<void> {
    fetch(`${this.url}`, {
      method: "POST",
      headers: this.requestHeaders(),
      body: JSON.stringify(message)
    }).catch(() => {}); // best effort
  }

  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    // HTTP transport is stateless client-side — nothing to close. The server
    // session is dead once the connection ends, so drop it for reuse safety.
    this.sessionId = null;
  }
}
