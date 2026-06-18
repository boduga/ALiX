/**
 * security-headers.test.ts — S0.4: Baseline security headers.
 *
 * Validates that:
 *  1. All responses include baseline security headers
 *  2. API responses include Cache-Control: no-store
 *  3. SSE endpoint retains Cache-Control: no-cache and X-Accel-Buffering: no
 *  4. /healthz includes security headers
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { get, request } from "node:http";

const EXPECTED_HEADERS = [
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-resource-policy",
  "content-security-policy",
  "x-frame-options",
  "x-xss-protection",
  "strict-transport-security",
  "cache-control",
];

describe("Security headers", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sec-headers-"));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("/healthz includes all baseline security headers", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const headers = await httpGetHeaders(`${url}/healthz`);
      for (const h of EXPECTED_HEADERS) {
        assert.ok(headers[h], `response should have header: ${h}`);
      }
      assert.equal(headers["x-content-type-options"], "nosniff");
      assert.equal(headers["referrer-policy"], "no-referrer");
      assert.equal(headers["cross-origin-resource-policy"], "same-origin");
      assert.equal(headers["content-security-policy"], "default-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    } finally {
      await close();
    }
  });

  it("API response includes Cache-Control: no-store", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const headers = await httpGetHeaders(`${url}/api/approvals`);
      assert.equal(headers["cache-control"], "no-store");
    } finally {
      await close();
    }
  });

  it("SSE response has Cache-Control: no-cache and X-Accel-Buffering: no", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const sessionId = "test-session-headers";
    const eventsDir = join(tmpDir, ".alix", "sessions", sessionId);
    mkdirSync(eventsDir, { recursive: true });

    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      // SSE connections stay open — check headers from the response object
      // before closing the connection
      const res = await fetch(`${url}/api/sessions/${sessionId}/events`);
      try {
        assert.equal(res.headers.get("cache-control"), "no-cache");
        assert.equal(res.headers.get("x-accel-buffering"), "no");
      } finally {
        // Cancel the stream to avoid hanging
        await res.body?.cancel();
      }
    } finally {
      await close();
    }
  });
});

/**
 * Perform an HTTP request and return response headers.
 */
async function httpGetHeaders(url: string, options?: { method?: string }): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const req = get(url, { method: options?.method ?? "GET" }, (res) => {
      // Consume body to free the socket
      let body = "";
      res.on("data", (chunk) => void (body += chunk));
      res.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          headers[key] = Array.isArray(value) ? value[0] : (value ?? "");
        }
        resolve(headers);
      });
    });
    req.on("error", reject);
  });
}
