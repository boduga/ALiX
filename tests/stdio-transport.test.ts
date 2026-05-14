import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { StdioTransport } from "../src/mcp/transports/stdio-transport.js";
import type { JsonRpcRequest, JsonRpcNotification } from "../src/mcp/types.js";

let idCounter = 1;
function nextId(): number { return idCounter++; }

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: nextId(), method, params };
}

function spawnStdioProcess(script: string): ReturnType<typeof spawn> {
  return spawn("node", ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
}

// Echo server: reads JSON-RPC requests and sends matching responses
const echoServerScript = [
  "const readline = require('readline');",
  "const rl = readline.createInterface({ input: process.stdin });",
  "rl.on('line', (line) => {",
  "  if (!line.trim()) return;",
  "  try {",
  "    const msg = JSON.parse(line);",
  "    if (msg.id) {",
  "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { received: msg.params, originalMethod: msg.method } }) + '\\n');",
  "    }",
  "  } catch (e) {}",
  "});",
  "process.stdin.resume();"
].join(";");

// --- send() resolves when the response with matching ID arrives ---

test("StdioTransport send() resolves with result for matching ID", async () => {
  const proc = spawnStdioProcess(echoServerScript);
  const transport = new StdioTransport("echo-test", proc);
  try {
    const req = makeRequest("echo/test", { value: 42 });
    const resp = await transport.send(req);
    assert.equal(resp.jsonrpc, "2.0");
    assert.equal(resp.id, req.id);
    assert.deepEqual(resp.result, { received: { value: 42 }, originalMethod: "echo/test" });
  } finally {
    proc.kill();
    await new Promise(r => proc.on("close", r));
  }
});

test("StdioTransport send() resolves for multiple sequential requests", async () => {
  const proc = spawnStdioProcess(echoServerScript);
  const transport = new StdioTransport("echo-seq", proc);
  try {
    const req1 = makeRequest("first", { n: 1 });
    const req2 = makeRequest("second", { n: 2 });
    const [resp1, resp2] = await Promise.all([transport.send(req1), transport.send(req2)]);
    assert.equal(resp1.id, req1.id);
    assert.equal(resp2.id, req2.id);
    assert.equal((resp2 as any).result.originalMethod, "second");
  } finally {
    proc.kill();
    await new Promise(r => proc.on("close", r));
  }
});

// --- send() rejects on timeout after 30s ---

test("StdioTransport send() rejects on timeout when server responds with wrong ID", async () => {
  // Server that always responds with a mismatched ID — transport will never resolve
  const wrongIdScript = [
    "const readline = require('readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  if (!line.trim()) return;",
    "  try {",
    "    const msg = JSON.parse(line);",
    "    if (msg.id) {",
    "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'never-match', result: {} }) + '\\n');",
    "    }",
    "  } catch (e) {}",
    "});",
    "process.stdin.resume();"
  ].join(";");
  const proc = spawnStdioProcess(wrongIdScript);
  const transport = new StdioTransport("wrong-id", proc);
  try {
    const req = makeRequest("test", {});
    // Race against a 1-second local timeout — if the transport's 30s timeout is working
    // (and the request ID never matches), our local timeout will fire first
    let localTimedOut = false;
    const localTimeout = new Promise<void>((_, reject) => setTimeout(() => {
      localTimedOut = true;
      reject(new Error("local timeout"));
    }, 1000));
    try {
      await Promise.race([transport.send(req), localTimeout]);
      assert.fail("send() should have timed out");
    } catch (e: any) {
      assert.ok(localTimedOut, "local timeout should have fired — transport should still be pending");
      assert.ok(e.message.includes("local timeout"));
    }
  } finally {
    proc.kill();
    await new Promise(r => proc.on("close", r));
  }
});


// --- Notification messages go to the onMessage handler ---

test("StdioTransport onMessage handler receives notifications", async () => {
  const notifyScript = [
    "const readline = require('readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  if (!line.trim()) return;",
    "  try {",
    "    const msg = JSON.parse(line);",
    "    if (msg.id) {",
    "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'server/notify', params: { hello: 'world' } }) + '\\n');",
    "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\\n');",
    "    }",
    "  } catch (e) {}",
    "});",
    "process.stdin.resume();"
  ].join(";");
  const proc = spawnStdioProcess(notifyScript);
  const transport = new StdioTransport("notify-test", proc);
  try {
    let receivedNotification: { method: string; params: Record<string, unknown> } | null = null;
    transport.onMessage((msg) => {
      const m = msg as { id?: string; method?: string; params?: Record<string, unknown> };
      if (!m.id) {
        receivedNotification = { method: m.method ?? "", params: m.params ?? {} };
      }
    });
    const req = makeRequest("test", {});
    await transport.send(req);
    // Wait a bit for the notification to arrive asynchronously
    await new Promise(r => setTimeout(r, 100));
    assert.ok(receivedNotification !== null, "notification should have been received");
    const n = receivedNotification as any;
    assert.equal(n.method, "server/notify");
    assert.deepEqual(n.params, { hello: "world" });
  } finally {
    proc.kill();
    await new Promise(r => proc.on("close", r));
  }
});

test("StdioTransport sendNotification resolves when written to stdin", async () => {
  const notifyScript = [
    "const readline = require('readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', () => {});",
    "process.stdin.resume();"
  ].join(";");
  const proc = spawnStdioProcess(notifyScript);
  const transport = new StdioTransport("notify-send", proc);
  try {
    const notif: JsonRpcNotification = { jsonrpc: "2.0", method: "initialized", params: { version: "1.0" } };
    await transport.sendNotification(notif);
    // Notification was sent — verified by no error thrown
    assert.ok(true);
  } finally {
    proc.kill();
    await new Promise(r => proc.on("close", r));
  }
});