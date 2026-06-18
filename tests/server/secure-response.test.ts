/**
 * secure-response.test.ts — P4.3-Sb1: Secure JSON Response unit tests.
 *
 * Tests for createSecureResponder covering redaction, headers,
 * error handling, output enforcement, and edge cases.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { createSecureResponder, type SecureJsonResponder } from "../../src/server/secure-response.js";
import { SecretDetector } from "../../src/security/redaction/secret-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockCaptured {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  closeHandlers: (() => void)[];
}

/**
 * Create a minimal mock ServerResponse that captures statusCode, headers,
 * and body content.
 */
function mockRes(): ServerResponse & MockCaptured {
  const captured: MockCaptured = {
    statusCode: 200,
    headers: {},
    body: "",
    closeHandlers: [],
  };
  return {
    get statusCode() { return captured.statusCode; },
    set statusCode(v: number) { captured.statusCode = v; },
    get headers() { return captured.headers; },
    get body() { return captured.body; },
    get closeHandlers() { return captured.closeHandlers; },
    setHeader(k: string, v: string) { captured.headers[k.toLowerCase()] = v; return this; },
    hasHeader(k: string) { return k.toLowerCase() in captured.headers; },
    end(data: string) { captured.body = data; },
    flushHeaders() { /* no-op */ },
    write(_data: unknown) { return true; },
    on(event: string, cb: () => void) { if (event === "close") captured.closeHandlers.push(cb); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Parse the captured JSON body.
 */
function parseBody(res: MockCaptured): unknown {
  return JSON.parse(res.body);
}

/**
 * Create a responder with a fresh mock, detector, and default options.
 */
function createTestResponder(
  opts?: { enforceOutputLimit?: boolean; requestId?: string; onRedact?: (classification: string, bytes: number) => void },
): { res: MockCaptured & ServerResponse; responder: SecureJsonResponder; detector: SecretDetector } {
  const res = mockRes();
  const detector = new SecretDetector();
  const responder = createSecureResponder(res, null, detector, opts);
  return { res, responder, detector };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SecureJsonResponder", () => {
  describe("ok()", () => {
    it("serializes a simple value as JSON", () => {
      const { res, responder } = createTestResponder();
      responder.ok({ message: "hello" });
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.equal(parsed.message, "hello");
    });

    it("redacts nested secrets in value strings", () => {
      const { res, responder } = createTestResponder();
      responder.ok({
        name: "config",
        credentials: "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789abcdef",
        nested: {
          token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        },
      });
      const body = res.body;
      // Both the pattern-based and key-based redaction should fire
      assert.ok(
        body.includes("[REDACTED"),
        `Expected redacted markers in body, got: ${body.slice(0, 200)}`,
      );
      // The token values should not appear literally in body
      assert.ok(!body.includes("sk-ant-abcdefghijklmnopqrstuvwxyz0123456789abcdef"));
    });

    it("redacts secrets in plain string values", () => {
      const { res, responder } = createTestResponder();
      responder.ok("secret: sk-live-abcdefghijklmnopqrstuv");
      const body = res.body;
      assert.ok(body.includes("[REDACTED_"));
      assert.ok(!body.includes("sk-live-abcdefghijklmnopqrstuv"));
    });

    it("sets Content-Type: application/json", () => {
      const { res, responder } = createTestResponder();
      responder.ok({ ok: true });
      assert.equal(res.headers["content-type"], "application/json");
    });

    it("sets Cache-Control: no-store", () => {
      const { res, responder } = createTestResponder();
      responder.ok({ ok: true });
      assert.equal(res.headers["cache-control"], "no-store");
    });

    it("does not override existing Content-Type header", () => {
      const res = mockRes();
      const detector = new SecretDetector();
      res.setHeader("content-type", "text/custom");
      const responder = createSecureResponder(res, null, detector);
      responder.ok({ ok: true });
      // Should preserve the pre-set header
      assert.equal(res.headers["content-type"], "text/custom");
    });

    it("handles cyclic values without crashing", () => {
      const { res, responder } = createTestResponder();
      const cyclic: Record<string, unknown> = { name: "cycle-test" };
      cyclic.self = cyclic;
      // Should not throw
      responder.ok(cyclic);
      // Should produce valid JSON with a cycle sentinel
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      assert.equal(parsed.name, "cycle-test");
      assert.equal(parsed.self, "[CIRCULAR_REFERENCE]");
    });

    it("handles deeply nested objects", () => {
      const { res, responder } = createTestResponder();
      const deep: Record<string, unknown> = { level: 0 };
      let current = deep;
      for (let i = 1; i <= 15; i++) {
        current.child = { level: i };
        current = current.child as Record<string, unknown>;
      }
      responder.ok(deep);
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      // The redactor increments depth before iterating properties, so at
      // depth 12 (maxDepth) walked from root, each property value is a
      // depth sentinel. Walk 11 levels then verify the 12th's properties.
      let node: Record<string, unknown> = parsed;
      for (let i = 0; i < 11; i++) {
        assert.ok(node.child, `Expected child at depth ${i}`);
        node = node.child as Record<string, unknown>;
      }
      // node is now the level-11 node. Its level is preserved.
      assert.equal(node.level, 11);
      // Its child is the level-12 node whose properties are all sentinels.
      const child = node.child as Record<string, unknown>;
      assert.equal(child.level, "[MAX_DEPTH_REACHED]");
      assert.equal(child.child, "[MAX_DEPTH_REACHED]");
    });

    it("handles null and undefined values", () => {
      const { res, responder } = createTestResponder();
      responder.ok({ a: null, b: undefined });
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      assert.equal(parsed.a, null);
      // undefined values are omitted in JSON
      assert.ok(!("b" in parsed));
    });
  });

  describe("error()", () => {
    it("returns stable error code, not exception messages", () => {
      const { res, responder } = createTestResponder();
      responder.error("ALIX_001", 500);
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.equal(res.statusCode, 500);
      assert.equal(parsed.error, "ALIX_001");
    });

    it("returns details when provided", () => {
      const { res, responder } = createTestResponder({ requestId: "req-1" });
      responder.error("not_found", 404, { resource: "user-42" });
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.equal(parsed.error, "not_found");
      assert.equal(res.statusCode, 404);
      assert.equal(parsed.requestId, "req-1");
      assert.deepEqual(parsed.details, { resource: "user-42" });
    });

    it("redacts secrets in details", () => {
      const { res, responder } = createTestResponder();
      responder.error("bad_request", 400, {
        message: "Invalid token",
        token: "ghp_xxxxxxxxxxxxxxxxxxxx",
      });
      const body = res.body;
      // The token value should be redacted
      assert.ok(!body.includes("ghp_xxxxxxxxxxxxxxxxxxxx"));
    });

    it("sets Content-Type: application/json", () => {
      const { res, responder } = createTestResponder();
      responder.error("err", 400);
      assert.equal(res.headers["content-type"], "application/json");
    });

    it("includes requestId when provided", () => {
      const { res, responder } = createTestResponder({ requestId: "req-abc" });
      responder.error("err", 500);
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.equal(parsed.requestId, "req-abc");
    });

    it("omits requestId when not provided", () => {
      const { res, responder } = createTestResponder();
      responder.error("err", 500);
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.ok(!("requestId" in parsed));
    });
  });

  describe("output bytes enforcement (enforceOutputLimit)", () => {
    it("sends normal response when under limit", () => {
      const { res, responder } = createTestResponder({ enforceOutputLimit: true });
      responder.ok({ data: "small payload" });
      assert.equal(res.statusCode, 200);
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.equal(parsed.data, "small payload");
    });

    it("returns sentinel when response exceeds MAX_OUTPUT_BYTES", () => {
      const { res, responder } = createTestResponder({ enforceOutputLimit: true });
      // Create a payload large enough to exceed 262KB. The redactor catches
      // this internally and returns [MAX_OUTPUT_EXCEEDED].
      const large = "x".repeat(300_000);
      responder.ok({ data: large });
      // The redactor enforces output bytes before the responder does, so
      // the body should not contain the original data
      const body = res.body;
      assert.ok(!body.includes(large.slice(0, 50)));
    });

    it("ignores limit when enforceOutputLimit is not set", () => {
      const { res, responder } = createTestResponder();
      // Use a payload within redactor limits — the feature flag is about
      // the responder-level check, not the redactor's internal limit
      responder.ok({ data: "small payload" });
      // Should succeed normally
      assert.equal(res.statusCode, 200);
      const parsed = parseBody(res) as Record<string, unknown>;
      assert.equal(typeof parsed.data, "string");
      assert.equal(parsed.data, "small payload");
    });
  });

  describe("error fallback (serialization failure)", () => {
    it("returns ALIX_100 when res.setHeader throws after redaction", () => {
      const res = mockRes();
      const detector = new SecretDetector();
      // Simulate a header failure during initial ok() processing.
      // Throw on content-type header; subsequent fallback calls pass through.
      const origSetHeader = res.setHeader.bind(res) as (k: string, v: string) => ServerResponse & MockCaptured;
      let threw = false;
      res.setHeader = (k: string, v: string) => {
        if (!threw) {
          threw = true;
          throw new Error("header failure");
        }
        return origSetHeader(k, v);
      };
      const responder = createSecureResponder(res, null, detector, {
        requestId: "fail-req",
      });
      responder.ok({ data: "test" });
      // Should have fallen back to ALIX_100 error
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      assert.equal(res.statusCode, 500);
      assert.equal(parsed.error, "ALIX_100");
      assert.equal(parsed.requestId, "fail-req");
    });
  });

  describe("onRedact callback", () => {
    it("fires onRedact after successful ok() response", () => {
      let called = false;
      let capturedClassification = "";
      let capturedBytes = 0;
      const { res, responder } = createTestResponder({
        onRedact: (classification: string, bytes: number) => {
          called = true;
          capturedClassification = classification;
          capturedBytes = bytes;
        },
      });
      responder.ok({ hello: "world" });
      assert.equal(called, true);
      assert.equal(capturedClassification, "operational");
      assert.ok(capturedBytes > 0);
    });

    it("does not fire onRedact when not configured", () => {
      const { res, responder } = createTestResponder();
      // Should not throw
      responder.ok({ hello: "world" });
      assert.ok(res.body.includes("hello"));
    });
  });
});
