# Model Context Protocol (MCP) Integration

## Overview
This package is ALiX's client side of the Model Context Protocol. It discovers, connects to, and governs external MCP servers (stdio, HTTP, WebSocket), turns their advertised tools into callable ALiX tools, and adds the surrounding machinery needed to keep a large external catalog usable: schema caching, deferral handles, ranked tool selection, category/trust cataloguing, and a meta-tool for introspection. It owns transport and protocol mechanics only; approval decisions for `mcp.*` capabilities belong to the policy layer.

## Interface
- `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcError`, `JsonRpcNotification`, `McpServerCapabilities`, `JsonSchema`, `Tool`, `CallToolResult` — wire and tool-descriptor shapes `[types.ts:JsonRpcRequest]` `[types.ts:McpServerCapabilities]` `[types.ts:Tool]` `[types.ts:CallToolResult]`.
- `McpTransport` — transport seam with `name`, `type`, `connect`, `send`, `sendNotification`, `onMessage`, `close` `[transport.ts:McpTransport]`.
- `McpClient` — one JSON-RPC session per server: `initialize`, `listTools`, `callTool`, `close`, plus `capabilities`, `serverInfo`, `tools` getters `[client.ts:McpClient]`.
- `McpToolRegistry` / `RegisteredTool` — server→tool registration keyed by `fullName` (`"server/tool"`); `createTransport`, `registerServer`, `getTool`, `listTools`, `listMcpServers`, `getClient`, `callTool`, `closeServer` `[registry.ts:McpToolRegistry]` `[registry.ts:RegisteredTool]`.
- `McpManager` — lifecycle owner over the registry and process manager: `initialize`, `callTool`, `listTools`, `listServers`, `getCapabilityRules`, `getClient`, `getDeferral`, `closeServer`, `discoverServer`, `closeAll` `[manager.ts:McpManager]`.
- `ProcessManager` — stdio child-process pool with `getOrCreate`, `closeServer`, `closeIdle`, `closeAll`, `listActiveServers` `[process-manager.ts:ProcessManager]`.
- `KnownServer` / `KNOWN_MCP_SERVERS` / `findServer` — curated catalog of well-known servers (github, filesystem, fetch, git, postgres, puppeteer, slack) `[server-registry.ts:KNOWN_MCP_SERVERS]` `[server-registry.ts:findServer]`.
- `MappedPolicyRule` / `mapServerCapabilities` — translates server capabilities into `mcp:<server>:default` and per-tool policy rules `[capability-mapper.ts:mapServerCapabilities]`.
- `MetaToolExecutor` — introspection commands `catalog.list`, `catalog.by_category`, `tools.search`, `schema.get`, `schema.list` `[meta-tool.ts:MetaToolExecutor]`.
- `McpToolDeferral` / `DeferredToolEntry` — opaque executable handles (`name`), internal executor name (`execName`), and readable-but-not-executable `searchName` `[tool-deferral.ts:McpToolDeferral]` `[tool-deferral.ts:DeferredToolEntry]`.
- `ToolSelector` / `createToolSelector` — ranks a deferred catalog into a bounded per-turn tool set `[tool-selector.ts:ToolSelector]` `[tool-selector.ts:createToolSelector]`.
- `SchemaCache` — optional-TTL, optional-size LRU cache for tool schemas `[tool-cache.ts:SchemaCache]`.
- `searchTools` / `SearchResult` — deterministic scored name search `[tool-search.ts:searchTools]`.
- `ToolCatalog`, `ToolCategory`, `TrustLevel`, `ToolDescriptor` — category and trust-level grouping `[tool-catalog.ts:ToolCatalog]`.
- `ToolDiscovery` — model-facing tool search over the deferred catalog `[tool-discovery.ts:ToolDiscovery]`.
- `ToolProvenanceTracker`, `ProvenanceEntry`, `ProvenanceExport` — per-session tool usage provenance `[provenance.ts:ToolProvenanceTracker]`.
- `withRetry` / `RetryOptions` — exponential-backoff retry helper `[retry.ts:withRetry]`.
- `jsonRpcError`, `McpError`, `McpErrorKind`, `formatMcpError`, `classifyMcpError` — error normalization `[error-format.ts:classifyMcpError]`.
- Transport implementations live in [./transports/README.md](./transports/README.md) (stdio, HTTP, WebSocket).

## Invariants
- `initialize` connects the transport first, then sends `initialize` with `protocolVersion` `"2024-11-05"`, and only then sends `notifications/initialized` `[client.ts:initialize]` `[client.ts:PROTOCOL_VERSION]`.
- `listTools` caches the first successful `tools/list` result; later calls return the cached array without another round trip `[client.ts:listTools]`.
- `callTool` is bounded by `withTimeout` at `DEFAULT_MCP_TIMEOUT_MS` (30 000 ms) and emits timeout diagnostics through the multiplex diagnostic sink `[client.ts:callTool]` `[client.ts:DEFAULT_MCP_TIMEOUT_MS]`.
- A server that fails initialization or tool discovery is closed before the error is rethrown, so no partial client or partial tool set becomes reachable `[registry.ts:registerServer]`.
- `fullName` is always `"<server>/<tool>"`: a tool name already prefixed with the server name has that prefix stripped exactly once `[registry.ts:registerServer]`.
- MCP call results are conservatively non-retryable and outcome-unknown — both an MCP `isError` response and a thrown transport error return `outcomeUnknown: true, retryable: false`, because the remote effect may already have applied `[registry.ts:callTool]`.
- `callTool` for an unregistered tool or a disconnected server returns a `kind: "error"` result rather than throwing `[registry.ts:callTool]`.
- `closeServer` removes the client and every registered tool whose key starts with `"<server>/"` `[registry.ts:closeServer]`.
- Server connection failures during `initialize` are classified and logged, and do not abort startup of the remaining servers `[manager.ts:initialize]`.
- Auto-discovery is silent-by-design: `npx --yes <path>` is tried first, then the path as a direct command, and both failures are swallowed `[manager.ts:autoDiscoverServer]`.
- `discoverServer` prefers `uvx`, falls back to `npx --yes`, and throws a formatted error only when both fail `[manager.ts:discoverServer]`.
- Capability rules are produced only when the server advertises capabilities; the default server rule covers `mcp.<server>.*` with effect `ask`, and every per-tool rule is also `ask` `[capability-mapper.ts:mapServerCapabilities]`.
- A handle collision or duplicate during `buildIndex` throws rather than silently returning a shorter catalog `[tool-deferral.ts:buildIndex]`.
- `searchName` is discovery text and is never the executable name; only `name` (the `mcp__<hash>` handle) is offered to the model `[tool-deferral.ts:DeferredToolEntry]`.
- Deferral search returns at most 3 entries by default `[tool-deferral.ts:search]`.
- Selection is bounded by both a tool cap and a token budget: `effectiveMax = min(maxTools, floor(tokenBudget / 25), tools.length)`, with `createToolSelector` defaulting to 20 tools and a 3 000-token budget `[tool-selector.ts:select]` `[tool-selector.ts:createToolSelector]` `[tool-selector.ts:MIN_TOKENS_PER_TOOL]`.
- `SAFE_FALLBACK_NAMES` reserve a small set of well-known read/fetch tools against budget pressure `[tool-selector.ts:SAFE_FALLBACK_NAMES]`.
- Search is deterministic and ranked: exact name 100, name prefix 80, substring 50 (+10 name-only), Levenshtein similarity up to 40 when relative distance ≤ 0.5, and an exact-name hit short-circuits to a single result `[tool-search.ts:searchTools]`.
- `searchTools` on a blank query returns the full catalog; a non-blank query returns at most 10 matches, and both paths report `kind: "success"` `[tool-discovery.ts:ToolDiscovery]`.
- `classifyMcpError` gives an HTTP status code precedence over body heuristics: 401/403 (and auth-ish 4xx) are `permission_denied`, other 5xx are `connection` `[error-format.ts:classifyMcpError]`.
- `withRetry` retries only `econnrefused`, `timeout`, `etimedout`, and `econnreset` by default, with delay `baseDelayMs * 2^attempt` `[retry.ts:withRetry]`.
- `SchemaCache` applies TTL eviction on read and size eviction on write, both only when the corresponding option is set `[tool-cache.ts:SchemaCache]`.
- `MetaToolExecutor` throws on an unknown command instead of returning a partial answer `[meta-tool.ts:MetaToolExecutor]`.
- `ProcessManager.closeIdle` defaults to a 300 000 ms idle threshold `[process-manager.ts:closeIdle]`.
- `autoDiscoverServer` and file naming aside, categories and trust levels are inferred from names when not supplied: `inferCategory` maps substrings to a `ToolCategory`, `inferTrustLevel` treats `builtin`/`filesystem`/`shell`/`git` as `builtin` and otherwise `remote` `[tool-catalog.ts:inferCategory]` `[tool-catalog.ts:inferTrustLevel]`.

## Side Effects
- Establishing a server may spawn a child process with `spawn` and `buildChildEnv`, and close it with `transport.close()` plus `proc.kill()` `[registry.ts:createTransport]` `[process-manager.ts:getOrCreate]` `[process-manager.ts:closeServer]`.
- HTTP and WebSocket transports open network connections to configured URLs `[registry.ts:createTransport]`.
- `callTool` performs a remote `tools/call` and may execute arbitrary third-party server behavior `[client.ts:callTool]`.
- Timeout diagnostics are written to the multiplex sink that includes `process.cwd() + "/.alix/diagnostics"` `[client.ts:diagSink]`.
- Connection and discovery failures are written to `console.error` with `formatMcpError` text `[manager.ts:initialize]`.
- `ProcessManager` mutates its in-memory process table on `getOrCreate`, `closeServer`, and `closeAll` `[process-manager.ts:ProcessManager]`.
- `MetaToolExecutor.execute` reads the catalog, discovery, and schema-cache dependencies but performs no writes of its own `[meta-tool.ts:MetaToolExecutor]`.
- `ToolProvenanceTracker` mutates per-tool counters and timestamps in memory; `clearSession` zeroes invocation counts without deleting entries `[provenance.ts:ToolProvenanceTracker]`.

## Verification
- Run: `pnpm test`
