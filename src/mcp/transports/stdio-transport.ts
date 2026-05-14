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

    // Route ALL stdout data through one handler — send() has its own listener
    // for response matching, but notifications and stray messages need the handler.
    // We share readBuffer so neither listener starves the other.
    proc.stdout?.on("data", (chunk: Buffer) => {
      this.readBuffer += chunk.toString();
      const lines = this.readBuffer.split("\n");
      this.readBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
            this.messageHandler?.(msg);
          } catch {
            // Skip malformed JSON
          }
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

      // Wrap resolve/reject so we can pass them to the shared handler.
      // The constructor listener routes responses to them when IDs match.
      const handlers = {
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
      };
      this.pendingCallbacks.set(id, handlers);

      // Drain any data already in the buffer that matches this request.
      // This handles the race where the constructor listener hasn't fired yet.
      this.drainBuffer(id, handlers.resolve, handlers.reject);

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

  // Pending request callbacks keyed by message ID.
  // The constructor listener calls this to dispatch stray responses.
  private pendingCallbacks = new Map<string, {
    resolve: (msg: JsonRpcResponse) => void;
    reject: (err: Error) => void;
  }>();

  private drainBuffer(id: string, resolve: (msg: JsonRpcResponse) => void, reject: (err: Error) => void): void {
    for (const line of this.readBuffer.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
        if ("id" in msg && msg.id !== undefined && String(msg.id) === id) {
          // Remove matched line from buffer
          this.readBuffer = this.readBuffer.replace(line + "\n", "").replace(line, "");
          if ("error" in msg && msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg as JsonRpcResponse);
          }
          return;
        }
      } catch {}
    }
  }

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
    const wrapped: typeof handler = (msg) => {
      // If this message matches a pending request, route it there directly.
      if ("id" in msg && msg.id !== undefined) {
        const id = String(msg.id);
        const pending = this.pendingCallbacks.get(id);
        if (pending) {
          clearTimeout; // no-op, timeout is cleared in send's closure
          this.pendingCallbacks.delete(id);
          if ("error" in msg && msg.error) {
            pending.reject(new Error(msg.error.message));
          } else {
            pending.resolve(msg as JsonRpcResponse);
          }
          return;
        }
      }
      handler(msg);
    };
    this.messageHandler = wrapped;
  }

  async close(): Promise<void> {
    this.proc.kill();
    this.proc.stdin?.destroy();
    this.proc.stdout?.destroy();
    this.proc.stderr?.destroy();
  }
}