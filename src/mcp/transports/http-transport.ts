import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../../mcp/types.js";
import type { McpTransport } from "../../mcp/transport.js";
import type { McpTransportType } from "../../config/schema.js";

export class HttpTransport implements McpTransport {
  readonly name: string;
  readonly type: McpTransportType = "http";

  private url: string;
  private headers: Record<string, string>;
  private messageHandler: ((msg: JsonRpcResponse | JsonRpcNotification) => void) | null = null;

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
        headers: {
          "Content-Type": "application/json",
          ...this.headers
        },
        body: JSON.stringify(message),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

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
            try {
              const msg = JSON.parse(data) as JsonRpcResponse | JsonRpcNotification;
              this.messageHandler?.(msg);
              if ("result" in msg && !("error" in msg) && !result) {
                result = msg as JsonRpcResponse;
              }
            } catch {}
          }
        }
      }
    }

    return result ?? { jsonrpc: "2.0", id: "", result: {} };
  }

  async sendNotification(message: JsonRpcNotification): Promise<void> {
    fetch(`${this.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(message)
    }).catch(() => {}); // best effort
  }

  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    // HTTP is stateless — nothing to close
  }
}