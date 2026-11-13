# MCP Transports

## Overview
Three `McpTransport` implementations carrying JSON-RPC messages to MCP servers: `HttpTransport` posts individual requests to a URL and supports streamable HTTP/SSE responses, `StdioTransport` exchanges newline-delimited JSON with a spawned child process, and `WebSocketTransport` maintains a reconnecting socket with per-request timers. Each class routes responses and notifications through the transport callback contract and applies its own timeout and close behavior.

## Interface
- `HttpTransport` implements `McpTransport`, reports `type = "http"`, and is constructed from `name`, `url`, and optional headers `[http-transport.ts:HttpTransport]`.
- `HttpTransport.send` posts a JSON-RPC request and returns either a JSON response or the first JSON-RPC result read from an SSE response `[http-transport.ts:HttpTransport.send]`.
- `HttpTransport.sendNotification` posts a notification without a required response `[http-transport.ts:HttpTransport.sendNotification]`.
- `StdioTransport` implements `McpTransport`, reports `type = "stdio"`, and is constructed from `name` and a `ChildProcess` `[stdio-transport.ts:StdioTransport]`.
- `StdioTransport.send` writes one newline-terminated request and resolves when the matching response id arrives `[stdio-transport.ts:StdioTransport.send]`.
- `StdioTransport.sendNotification` writes one newline-terminated notification and resolves when the write callback succeeds `[stdio-transport.ts:StdioTransport.sendNotification]`.
- `WebSocketTransport` implements `McpTransport`, reports `type = "websocket"`, and is constructed from `name`, `url`, and optional headers `[websocket-transport.ts:WebSocketTransport]`.
- `WebSocketTransport.send` opens the socket when needed, assigns a request id if absent, and resolves or rejects from the matching response or timeout `[websocket-transport.ts:WebSocketTransport.send]`.
- `WebSocketTransport.sendNotification` sends only when the socket is open and otherwise returns without sending `[websocket-transport.ts:WebSocketTransport.sendNotification]`.
- `onMessage(handler)` registers one response/notification callback on each transport `[http-transport.ts:HttpTransport.onMessage]` `[stdio-transport.ts:StdioTransport.onMessage]` `[websocket-transport.ts:WebSocketTransport.onMessage]`.
- `close()` releases transport-specific resources `[http-transport.ts:HttpTransport.close]` `[stdio-transport.ts:StdioTransport.close]` `[websocket-transport.ts:WebSocketTransport.close]`.
- No child contract directories exist.

## Invariants
- `HttpTransport` connects lazily; `connect()` performs no request `[http-transport.ts:HttpTransport.connect]`.
- Every HTTP request sends `Accept: application/json, text/event-stream` and a non-empty `Content-Type: application/json`, plus the captured session id when present `[http-transport.ts:HttpTransport.requestHeaders]`.
- A non-OK HTTP response throws `HTTP <status>: <body>` `[http-transport.ts:HttpTransport.send]`.
- An HTTP request is aborted after 60 seconds and surfaces as `Request timed out after 60s` `[http-transport.ts:HttpTransport.send]`.
- An SSE response is consumed line by line; malformed `data:` frames are skipped, JSON-RPC errors throw, and the first message containing `result` becomes the response `[http-transport.ts:HttpTransport.handleSSEStream]`.
- An SSE stream with no result throws `Server returned no response for the JSON-RPC request` `[http-transport.ts:HttpTransport.handleSSEStream]`.
- `Mcp-Session-Id` issued by the server is captured from request and notification responses and replayed on later requests `[http-transport.ts:HttpTransport.requestHeaders]` `[http-transport.ts:HttpTransport.sendNotification]`.
- HTTP notification failures are swallowed as best effort `[http-transport.ts:HttpTransport.sendNotification]`.
- `HttpTransport.close()` clears the captured session id and owns no persistent client connection `[http-transport.ts:HttpTransport.close]`.
- Stdio responses are matched by stringified response id; unmatched messages go to the registered message handler `[stdio-transport.ts:StdioTransport]`.
- Malformed stdout JSON is skipped and partial lines remain buffered until a newline arrives `[stdio-transport.ts:StdioTransport]`.
- A stdio request rejects after 10 seconds, when the process has already exited nonzero, or when the process exits before responding `[stdio-transport.ts:StdioTransport.send]`.
- Stdio `connect()` performs no work because the process is already spawned `[stdio-transport.ts:StdioTransport.connect]`.
- Stdio stderr chunks are logged to `console.error` with the transport name and process-exit diagnostics are logged for nonzero exits `[stdio-transport.ts:StdioTransport]`.
- Stdio `close()` kills the child and destroys stdin, stdout, and stderr without waiting for the exit event `[stdio-transport.ts:StdioTransport.close]`.
- `WebSocketTransport.connect()` rejects after 30 seconds if the socket has not opened `[websocket-transport.ts:WebSocketTransport.connect]`.
- A WebSocket request rejects after 60 seconds and removes its pending entry `[websocket-transport.ts:WebSocketTransport.send]`.
- JSON-RPC error responses reject the matching pending WebSocket request; malformed messages are ignored `[websocket-transport.ts:WebSocketTransport.connect]`.
- WebSocket reconnect delay starts at 1,000 ms, doubles up to 30,000 ms, and retries only while `shouldReconnect` is true `[websocket-transport.ts:WebSocketTransport]`.
- WebSocket `close()` disables reconnect, clears the socket, rejects every pending request with `Connection closed`, and clears the pending map `[websocket-transport.ts:WebSocketTransport.close]`.

## Side Effects
- `HttpTransport.send` and `sendNotification` perform network `fetch` calls to the configured URL `[http-transport.ts:HttpTransport.send]` `[http-transport.ts:HttpTransport.sendNotification]`.
- `StdioTransport` attaches stdout, stderr, and exit listeners to the supplied child process and writes to its stdin `[stdio-transport.ts:StdioTransport]` `[stdio-transport.ts:StdioTransport.send]`.
- `StdioTransport.close()` terminates the child process and destroys its stdio streams `[stdio-transport.ts:StdioTransport.close]`.
- `WebSocketTransport` opens network sockets and schedules reconnect timers `[websocket-transport.ts:WebSocketTransport.connect]`.
- `WebSocketTransport.close()` closes the socket and rejects pending requests `[websocket-transport.ts:WebSocketTransport.close]`.
- Stdio diagnostics and nonzero child exits write to the host process stderr through `console.error` `[stdio-transport.ts:StdioTransport]`.

## Verification
- Run: `pnpm test`
