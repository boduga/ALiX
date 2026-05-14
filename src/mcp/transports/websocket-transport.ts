import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../../mcp/types.js";
import type { McpTransport } from "../../mcp/transport.js";
import type { McpTransportType } from "../../config/schema.js";

export class WebSocketTransport implements McpTransport {
  readonly name: string;
  readonly type: McpTransportType = "websocket";

  private url: string;
  private headers: Record<string, string>;
  private messageHandler: ((msg: JsonRpcResponse | JsonRpcNotification) => void) | null = null;
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private messageId = 0;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30_000;
  private shouldReconnect = true;

  constructor(name: string, url: string, headers: Record<string, string> = {}) {
    this.name = name;
    this.url = url;
    this.headers = headers;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        headers: this.headers
      });

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as JsonRpcResponse | JsonRpcNotification;
          this.messageHandler?.(msg);

          if ("id" in msg && msg.id !== undefined) {
            const id = String(msg.id);
            const pending = this.pendingRequests.get(id);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingRequests.delete(id);
              if ("error" in msg && msg.error) {
                pending.reject(new Error(msg.error.message));
              } else {
                pending.resolve(msg as JsonRpcResponse);
              }
            }
          }
        } catch {}
      };

      this.ws.onerror = () => {
        // error logged via onclose
      };

      this.ws.onclose = () => {
        if (this.shouldReconnect && this.reconnectDelay <= this.maxReconnectDelay) {
          setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
            this.connect().catch(() => {});
          }, this.reconnectDelay);
        }
      };

      setTimeout(() => reject(new Error("WebSocket connection timeout")), 30_000);
    });
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = String(message.id ?? ++this.messageId);
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out`));
      }, 60_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify({ ...message, id }));
    });
  }

  async sendNotification(message: JsonRpcNotification): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();
  }
}