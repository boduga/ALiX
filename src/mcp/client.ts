import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, McpServerCapabilities, Tool, CallToolResult } from "./types.js";
import type { McpTransport } from "./transport.js";
import { withTimeout, SideEffectTimeoutError } from "../runtime/side-effect-timeout.js";
import { consoleSink, createMultiplexDiagnosticSink } from "../runtime/runtime-diagnostics.js";
import { createDiagnosticStoreSink, DiagnosticEventStore } from "../observability/diagnostic-event-store.js";

const diagSink = createMultiplexDiagnosticSink(
  consoleSink,
  createDiagnosticStoreSink(new DiagnosticEventStore(process.cwd() + "/.alix/diagnostics")),
);

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_MCP_TIMEOUT_MS = 30_000;

export class McpClient {
  private transport: McpTransport;
  private pendingRequests = new Map<string, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private messageId = 0;
  private _capabilities: McpServerCapabilities | null = null;
  private _tools: Tool[] = [];
  private _serverInfo: { name: string; version: string } | null = null;

  constructor(
    transport: McpTransport,
    private readonly timeoutMs: number = DEFAULT_MCP_TIMEOUT_MS,
  ) {
    this.transport = transport;
    transport.onMessage((msg) => this.handleMessage(msg));
  }

  async initialize(clientName = "alix", clientVersion = "1.0"): Promise<McpServerCapabilities> {
    await this.transport.connect();

    const result = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        clientInfo: { name: clientName, version: clientVersion }
      }
    });

    if ("error" in result && result.error) {
      throw new Error(`Initialize failed: ${result.error.message}`);
    }

    const init = result.result as { protocolVersion: string; capabilities: McpServerCapabilities; serverInfo: { name: string; version: string } };
    this._capabilities = init.capabilities;
    this._serverInfo = { name: init.serverInfo.name, version: init.serverInfo.version };

    // Send initialized notification
    await this.transport.sendNotification({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    });

    return init.capabilities;
  }

  async listTools(): Promise<Tool[]> {
    if (this._tools.length > 0) return this._tools;

    const result = await this.transport.send({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/list",
      params: {}
    });

    if ("error" in result && result.error) {
      throw new Error(`tools/list failed: ${result.error.message}`);
    }

    const list = result.result as { tools: Tool[] };
    this._tools = list.tools ?? [];
    return this._tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    const result = await withTimeout(
      `mcp.callTool:${name}`,
      this.timeoutMs,
      () => this.transport.send({
        jsonrpc: "2.0",
        id: this.nextId(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
      (d) => diagSink.emit(d),
    );

    if ("error" in result && result.error) {
      throw new Error(`tools/call failed: ${result.error.message}`);
    }

    return result.result as CallToolResult;
  }

  get capabilities(): McpServerCapabilities | null { return this._capabilities; }
  get serverInfo(): { name: string; version: string } | null { return this._serverInfo; }
  get tools(): Tool[] { return this._tools; }

  async close(): Promise<void> { await this.transport.close(); }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in msg && msg.id !== undefined) {
      const pending = this.pendingRequests.get(String(msg.id));
      if (pending) {
        this.pendingRequests.delete(String(msg.id));
        if ("error" in msg && msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg as JsonRpcResponse);
        }
      }
    }
  }

  private nextId(): string { return String(++this.messageId); }
}