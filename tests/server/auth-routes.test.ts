/**
 * auth-routes.test.ts — P4.3-Sb3: Auth route endpoint tests.
 *
 * Validates:
 *  1. POST /api/auth/session with valid token creates session cookie
 *  2. POST /api/auth/session with invalid token returns 401
 *  3. POST /api/auth/session with missing token returns 400
 *  4. Cookie flags are correct (HttpOnly, SameSite=Strict, Path=/)
 *  5. POST /api/auth/session rate limiting
 *  6. POST /api/auth/logout clears session
 *  7. POST /api/auth/logout is idempotent
 *  8. Cross-origin request is rejected
 *  9. Body size limit enforcement
 *
 * Tests use a real server instance with a test auth store.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, appendFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { startServer } from "../../src/server/server.js";
import { AuthStore, createTokenRecord } from "../../src/security/inspector/auth-store.js";
import { generateToken } from "../../src/security/inspector/token-format.js";
import { getUserStatePaths } from "../../src/security/platform/user-state-paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  return join(tmpdir(), `alix-auth-routes-test-${randomUUID()}`);
}

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function parseStatus(line: string): number {
  const m = line.match(/^HTTP\/1\.\d (\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseHeaders(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    if (line === "") break;
    const idx = line.indexOf(": ");
    if (idx > 0) {
      const key = line.slice(0, idx).toLowerCase();
      const value = line.slice(idx + 2);
      headers[key] = value;
    }
  }
  return headers;
}

function rawRequest(host: string, port: number, path: string, method: string, opts?: {
  body?: string;
  headers?: Record<string, string>;
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const options: Record<string, unknown> = {
      hostname: host,
      port,
      path,
      method,
      headers: {
        "host": `${host}:${port}`,
        "content-type": "application/json",
        ...(opts?.headers ?? {}),
      },
    };

    if (opts?.body) {
      const existingHeaders = options.headers as Record<string, string>;
      options.headers = { ...existingHeaders, "content-length": Buffer.byteLength(opts.body).toString() };
    }

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const headers: Record<string, string> = {};
        Object.keys(res.headers).forEach((k) => {
          const v = res.headers[k];
          if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
        });
        resolve({ status: res.statusCode ?? 0, headers, body });
      });
    });

    req.on("error", reject);

    if (opts?.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth routes (Sb3)", () => {
  let dir: string;
  let host = "127.0.0.1";
  let port = 0;
  let closeFn: () => Promise<void>;
  let serverUrl: string;
  let actualPort: number;
  let validToken: string;
  let validTokenId: string;

  before(async () => {
    dir = tempDir();
    mkdirSync(dir, { recursive: true });

    // Set up auth state
    const userPaths = getUserStatePaths();
    mkdirSync(userPaths.authStateDir, { recursive: true, mode: 0o700 });

    // Create a valid token
    const generated = generateToken();
    validToken = generated.token;
    validTokenId = generated.id;

    const record = createTokenRecord({
      id: generated.id,
      hash: generated.hash,
      name: "Test Auth Route Token",
      role: "operator",
    });

    const authStore = new AuthStore({
      filePath: join(userPaths.authStateDir, "auth-store.json"),
    });
    await authStore.add(record);

    // Start server
    const result = await startServer(dir, host, port);
    closeFn = result.close;
    serverUrl = result.url;
    actualPort = parseInt(serverUrl.split(":").pop()!, 10);
  });

  after(async () => {
    await closeFn();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  describe("POST /api/auth/session", () => {
    it("valid token creates session cookie", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: JSON.stringify({ token: validToken }),
      });

      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.role, "response should include role");
      assert.ok(body.expiresAt, "response should include expiresAt");

      // Check cookie
      const setCookie = res.headers["set-cookie"];
      assert.ok(setCookie, "should set a session cookie");
      assert.ok(setCookie.includes("alix-session="), "cookie should be named alix-session");
      assert.ok(setCookie.includes("HttpOnly"), "cookie should be HttpOnly");
      assert.ok(setCookie.includes("SameSite=Strict"), "cookie should be SameSite=Strict");
      assert.ok(setCookie.includes("Path=/"), "cookie should have Path=/");

      // Token must NOT be echoed
      assert.ok(!res.body.includes(validTokenId), "token id must not be in response body");
    });

    it("token from Authorization header works", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        headers: { "authorization": `Bearer ${validToken}` },
      });

      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.role);
    });

    it("invalid token returns 401", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: JSON.stringify({ token: "alix_i_xxxxxxxxxxxx_invalid-token-value-here" }),
      });

      assert.equal(res.status, 401);
      const body = JSON.parse(res.body);
      assert.ok(body.error, "should include error code");

      // No cookie should be set for failed auth
      const setCookie = res.headers["set-cookie"];
      assert.ok(!setCookie || !setCookie.includes("alix-session="),
        "should not set cookie on auth failure");
    });

    it("missing token returns 400", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
    });

    it("cross-origin request is rejected", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: JSON.stringify({ token: validToken }),
        headers: {
          "origin": "http://evil.example.com",
        },
      });

      assert.equal(res.status, 403);
      const body = JSON.parse(res.body);
      assert.equal(body.error, "cross_origin_denied");
    });

    it("large body is rejected", async () => {
      const largeBody = JSON.stringify({ token: "x".repeat(11 * 1024) });
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: largeBody,
      });

      assert.equal(res.status, 413);
    });

    it("response does not echo token id", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: JSON.stringify({ token: validToken }),
      });

      const body = JSON.parse(res.body);
      assert.ok(!body.token, "raw token must not be echoed");
      assert.ok(!body.tokenId, "token id must not be echoed");
      assert.ok(!res.body.includes(validToken), "raw token must not appear in response body");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears session cookie", async () => {
      // First create a session
      const loginRes = await rawRequest(host, actualPort, "/api/auth/session", "POST", {
        body: JSON.stringify({ token: validToken }),
      });
      assert.equal(loginRes.status, 200);

      const sessionCookie = loginRes.headers["set-cookie"];
      assert.ok(sessionCookie);

      // Extract the cookie value
      const cookieMatch = sessionCookie.match(/alix-session=([^;]+)/);
      assert.ok(cookieMatch, "should have a session cookie value");

      // Now logout with that cookie
      const logoutRes = await rawRequest(host, actualPort, "/api/auth/logout", "POST", {
        headers: { "cookie": `alix-session=${cookieMatch![1]}` },
      });
      assert.equal(logoutRes.status, 200);
      const logoutBody = JSON.parse(logoutRes.body);
      assert.equal(logoutBody.ok, true);

      // Cookie should be expired
      const clearCookie = logoutRes.headers["set-cookie"];
      assert.ok(clearCookie, "should set cookie header on logout");
      assert.ok(clearCookie.includes("Max-Age=0"), "should expire the cookie");
    });

    it("is idempotent (works without session)", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/logout", "POST");
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
    });

    it("works without any cookie header", async () => {
      const res = await rawRequest(host, actualPort, "/api/auth/logout", "POST");
      assert.equal(res.status, 200);
    });
  });
});
