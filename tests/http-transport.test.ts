// tests/http-transport.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { HttpTransport } from "../src/mcp/transports/http-transport.js";
import type { JsonRpcRequest, JsonRpcNotification } from "../src/mcp/types.js";

const originalFetch = globalThis.fetch;

/** Stub globalThis.fetch with a synchronous Response factory. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: 1, method, params };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers }
  });
}

// --- Session id capture + replay ---

test("HttpTransport captures Mcp-Session-Id and replays it on subsequent requests", async () => {
  const seenHeaders: Array<Record<string, string> | undefined> = [];
  stubFetch((_url, init) => {
    seenHeaders.push(init?.headers as Record<string, string> | undefined);
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: { ok: true } }, { "mcp-session-id": "sess-123" });
  });
  const transport = new HttpTransport("langfuse", "http://localhost:3030/mcp");
  try {
    await transport.send(makeRequest("initialize"));
    await transport.send(makeRequest("tools/list"));
    assert.ok(seenHeaders.length >= 2);
    assert.equal(seenHeaders[0]?.["Mcp-Session-Id"], undefined, "first request carries no session header");
    assert.equal(seenHeaders[1]?.["Mcp-Session-Id"], "sess-123", "subsequent request replays session header");
  } finally {
    restoreFetch();
  }
});

test("HttpTransport drops the session id after close()", async () => {
  const seenHeaders: Array<Record<string, string> | undefined> = [];
  stubFetch((_url, init) => {
    seenHeaders.push(init?.headers as Record<string, string> | undefined);
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: { ok: true } }, { "mcp-session-id": "sess-9" });
  });
  const transport = new HttpTransport("langfuse", "http://localhost:3030/mcp");
  try {
    await transport.send(makeRequest("initialize"));
    await transport.close();
    await transport.send(makeRequest("tools/list"));
    assert.equal(seenHeaders[1]?.["Mcp-Session-Id"], undefined, "session header not replayed after close");
  } finally {
    restoreFetch();
  }
});

// --- Request headers ---

test("HttpTransport advertises streamable HTTP Accept header", async () => {
  let seen: Record<string, string> | undefined;
  stubFetch((_url, init) => {
    seen = init?.headers as Record<string, string> | undefined;
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: {} });
  });
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    await transport.send(makeRequest("initialize"));
    assert.equal(seen?.["Accept"], "application/json, text/event-stream");
  } finally {
    restoreFetch();
  }
});

// --- SSE handling ---

test("HttpTransport parses text/event-stream responses", async () => {
  const sseBody =
    "event: message\n" +
    "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n" +
    "\n" +
    "data: [DONE]\n\n";
  stubFetch(() => new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }));
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    const resp = await transport.send(makeRequest("tools/list"));
    assert.deepEqual(resp.result, { tools: [] });
  } finally {
    restoreFetch();
  }
});

test("HttpTransport throws on JSON-RPC error delivered via SSE", async () => {
  const sseBody = "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32001,\"message\":\"Invalid session\"}}\n\n";
  stubFetch(() => new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } }));
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    await assert.rejects(() => transport.send(makeRequest("tools/list")), /Invalid session/);
  } finally {
    restoreFetch();
  }
});

test("HttpTransport throws when SSE stream ends without a response", async () => {
  stubFetch(() => new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    await assert.rejects(() => transport.send(makeRequest("tools/list")), /no response/i);
  } finally {
    restoreFetch();
  }
});

// --- JSON responses + error status ---

test("HttpTransport returns plain JSON responses", async () => {
  stubFetch(() => jsonResponse({ jsonrpc: "2.0", id: 1, result: { hello: "world" } }));
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    const resp = await transport.send(makeRequest("ping"));
    assert.deepEqual(resp.result, { hello: "world" });
  } finally {
    restoreFetch();
  }
});

test("HttpTransport throws HTTP status and body on non-ok response", async () => {
  stubFetch(() => new Response("{\"error\":\"Invalid session\"}", {
    status: 400,
    headers: { "content-type": "application/json" }
  }));
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    await assert.rejects(
      () => transport.send(makeRequest("tools/list")),
      (e: unknown) => e instanceof Error && e.message.includes("HTTP 400") && e.message.includes("Invalid session")
    );
  } finally {
    restoreFetch();
  }
});

// --- Notifications ---

test("HttpTransport sendNotification replays session id", async () => {
  const seenHeaders: Array<Record<string, string> | undefined> = [];
  stubFetch((_url, init) => {
    seenHeaders.push(init?.headers as Record<string, string> | undefined);
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "sess-abc" });
  });
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    await transport.send(makeRequest("initialize"));
    seenHeaders.length = 0;
    const notif: JsonRpcNotification = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
    await transport.sendNotification(notif);
    assert.equal(seenHeaders[0]?.["Mcp-Session-Id"], "sess-abc");
  } finally {
    restoreFetch();
  }
});

test("HttpTransport sendNotification captures session id issued on a notification response", async () => {
  // First request is a notification; the server issues a session id on its
  // response. The next request must replay it.
  const seenHeaders: Array<Record<string, string> | undefined> = [];
  stubFetch((_url, init) => {
    seenHeaders.push(init?.headers as Record<string, string> | undefined);
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "sess-notif" });
  });
  const transport = new HttpTransport("t", "http://localhost/mcp");
  try {
    const notif: JsonRpcNotification = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };
    await transport.sendNotification(notif);
    assert.equal(seenHeaders[0]?.["Mcp-Session-Id"], undefined, "first notification carries no session header");
    await transport.send(makeRequest("tools/list"));
    assert.equal(seenHeaders[1]?.["Mcp-Session-Id"], "sess-notif", "next request replays session from notification response");
  } finally {
    restoreFetch();
  }
});
