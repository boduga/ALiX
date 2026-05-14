import type { ChildProcess } from "node:child_process";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../../mcp/types.js";
import type { McpTransport } from "../../mcp/transport.js";
import type { McpTransportType } from "../../config/schema.js";

export class StdioTransport implements McpTransport {
  readonly name: string;
  readonly type: McpTransportType = "stdio";

  private proc: ChildProcess;
  private messageHandler: ((msg: JsonRpcResponse | JsonRpcNotification) => void) | null = null;
  private readBuffer = "";

  constructor(name: string, proc: ChildProcess) {
    this.name = name;
    this.proc = proc;

    // Collect stderr for logging
    proc.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[MCP:${name} stderr] ${chunk.toString().trim()}`);
    });

    // Single stdout listener handles all routing.
    // Pending requests check pendingCallbacks by ID first; everything else
    // is forwarded to the messageHandler (notifications, stray messages).
    proc.stdout?.on("data", (chunk: Buffer) => {
      this.readBuffer += chunk.toString();
      const lines = this.readBuffer.split("\n");
      this.readBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
          // Route request responses to their pending callbacks
          if ("id" in msg && msg.id !== undefined) {
            const id = String(msg.id);
            const pending = this.pendingCallbacks.get(id);
            if (pending) {
              this.pendingCallbacks.delete(id);
              pending.resolve(msg as JsonRpcResponse);
              continue;
            }
          }
          this.messageHandler?.(msg);
        } catch {
          // Skip malformed JSON
        }
      }
    });

    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[MCP:${name}] process exited with code ${code}`);
      }
    });
  }

  async connect(): Promise<void> {
    // stdio processes connect immediately on spawn
  }

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.proc.stdin) {
        reject(new Error("stdin not available"));
        return;
      }

      const id = String(message.id);
      const timeout = setTimeout(() => {
        reject(new Error(`Request ${id} timed out after 30s`));
      }, 30_000);

      this.pendingCallbacks.set(id, {
        resolve: (msg: JsonRpcResponse) => {
          clearTimeout(timeout);
          this.pendingCallbacks.delete(id);
          if ("error" in msg && msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg);
          }
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          this.pendingCallbacks.delete(id);
          reject(err);
        }
      });

      const msgStr = JSON.stringify(message) + "\n";
      this.proc.stdin.write(msgStr, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingCallbacks.delete(id);
          reject(err);
        }
      });
    });
  }

  private pendingCallbacks = new Map<string, {
    resolve: (msg: JsonRpcResponse) => void;
    reject: (err: Error) => void;
  }>();

  async sendNotification(message: JsonRpcNotification): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.proc.stdin) {
        resolve();
        return;
      }
      const msgStr = JSON.stringify(message) + "\n";
      this.proc.stdin.write(msgStr, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.messageHandler = handler;
  }

  async close(): Promise<void> {
    this.proc.kill();
    this.proc.stdin?.destroy();
    this.proc.stdout?.destroy();
    this.proc.stderr?.destroy();
  }
}