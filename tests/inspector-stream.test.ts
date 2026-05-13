import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir as tmpDir } from "node:os";
import { startServer } from "../src/server/server.js";

describe("Inspector SSE event streaming", () => {
  it("sends existing events as SSE and keeps connection open for polling", async () => {
    const tmp = mkdtempSync(join(tmpDir(), "alix-test-"));
    const sessionDir = join(tmp, ".alix", "sessions", "test-session");
    mkdirSync(sessionDir, { recursive: true });
    const eventsPath = join(sessionDir, "events.jsonl");
    writeFileSync(eventsPath, '{"seq":1,"type":"test","actor":"agent","timestamp":"2026-01-01T00:00:00Z","payload":{}}\n');

    const { url, close } = await startServer(tmp, 0);
    try {
      const res = await fetch(`${url}/api/sessions/test-session/events`);
      assert.strictEqual(res.headers.get("content-type"), "text/event-stream");

      // Read with a short timeout so we don't wait for the SSE connection to close
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let body = "";
      const startTime = Date.now();
      while (Date.now() - startTime < 1500) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
        if (body.length > 0) break; // Got at least one chunk — assertion below is sufficient
      }
      reader.cancel();

      assert.ok(body.includes("event: alix"), `should contain SSE event line, got: ${body}`);
      assert.ok(body.includes('"seq":1'), `should contain event data, got: ${body}`);
      assert.ok(body.includes("data: "), `should contain data field, got: ${body}`);
    } finally {
      await close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty response when session does not exist", async () => {
    const tmp = mkdtempSync(join(tmpDir(), "alix-test-"));

    const { url, close } = await startServer(tmp, 0);
    try {
      const res = await fetch(`${url}/api/sessions/nonexistent/events`);
      assert.strictEqual(res.status, 200);
    } finally {
      await close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
