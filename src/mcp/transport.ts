import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "./types.js";
import type { McpTransportType } from "../config/schema.js";

export interface McpTransport {
  readonly name: string;
  readonly type: McpTransportType;

  connect(): Promise<void>;
  send(message: JsonRpcRequest): Promise<JsonRpcResponse>;
  sendNotification(message: JsonRpcNotification): Promise<void>;
  onMessage(handler: (message: JsonRpcResponse | JsonRpcNotification) => void): void;
  close(): Promise<void>;
}