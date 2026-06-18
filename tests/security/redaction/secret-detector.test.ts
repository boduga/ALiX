/**
 * P4.3-Sa1 — SecretDetector tests
 *
 * Tests every pattern family from the plan: OpenAI, Google, AWS, GitHub,
 * Slack, bearer, basic auth, JWT, PEM, credential URLs, auth headers,
 * and cookies.  Verifies that results have span positions, classification,
 * confidence — and NO raw source context field.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SecretDetector, type SecretSpan } from "../../../src/security/redaction/secret-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a result looks like a valid `SecretSpan` (no extra fields).
 */
function expectValidSpan(
  span: SecretSpan,
  classification: string,
  minConfidence: "high" | "medium" | "low" = "low",
): void {
  assert.equal(typeof span.start, "number", "span.start must be a number");
  assert.equal(typeof span.end, "number", "span.end must be a number");
  assert.ok(span.start >= 0, "span.start must be >= 0");
  assert.ok(span.end > span.start, "span.end must be > span.start");
  assert.equal(span.classification, classification);

  // No raw context
  assert.equal((span as unknown as Record<string, unknown>).context, undefined);

  // Confidence is one of the expected values
  assert.ok(
    ["high", "medium", "low"].includes(span.confidence),
    `Unexpected confidence: ${span.confidence}`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SecretDetector", () => {
  const detector = new SecretDetector();

  // =======================================================================
  // API keys
  // =======================================================================

  describe("API keys", () => {
    it("detects OpenAI sk- keys", () => {
      const spans = detector.detect("sk-abc123DEF456ghi789jkl012");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "api_key", "high");
    });

    it("detects Google AIza keys", () => {
      const spans = detector.detect("AIza12345678901234567890123456789012345");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "api_key", "high");
    });

    it("detects Anthropic sk-ant keys", () => {
      const spans = detector.detect("sk-ant-abcdef1234567890abcdef1234567890abcdef12");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "api_key", "high");
    });

    it("does not flag short strings as api keys", () => {
      const spans = detector.detect("sk-abc");
      assert.equal(spans.length, 0);
    });
  });

  // =======================================================================
  // AWS
  // =======================================================================

  describe("AWS credentials", () => {
    it("detects AWS access key IDs (AKIA)", () => {
      const spans = detector.detect("AKIAIOSFODNN7EXAMPLE");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "aws_access_key", "high");
    });

    it("detects AWS session keys (ASIA)", () => {
      const spans = detector.detect("ASIAIOSFODNN7EXAMPLE");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "aws_access_key", "high");
    });
  });

  // =======================================================================
  // GitHub tokens
  // =======================================================================

  describe("GitHub tokens", () => {
    it("detects ghp_ tokens", () => {
      const spans = detector.detect("ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "api_key", "high");
    });

    it("detects gho_ tokens", () => {
      const spans = detector.detect("gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ");
      assert.ok(spans.length >= 1);
    });

    it("detects ghu_ tokens", () => {
      const spans = detector.detect("ghu_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ");
      assert.ok(spans.length >= 1);
    });

    it("detects ghs_ tokens", () => {
      const spans = detector.detect("ghs_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ");
      assert.ok(spans.length >= 1);
    });

    it("detects ghr_ tokens", () => {
      const spans = detector.detect("ghr_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ");
      assert.ok(spans.length >= 1);
    });
  });

  // =======================================================================
  // Slack tokens
  // =======================================================================

  describe("Slack tokens", () => {
    it("detects xoxb- tokens", () => {
      const spans = detector.detect("xoxb-1234567890-abcdefghijklmn");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "bearer_token", "high");
    });

    it("detects xoxa- tokens", () => {
      const spans = detector.detect("xoxa-1234567890-abcdefghijklmn");
      assert.ok(spans.length >= 1);
    });
  });

  // =======================================================================
  // Bearer tokens
  // =======================================================================

  describe("Bearer tokens", () => {
    it("detects Bearer tokens in Authorization header", () => {
      const spans = detector.detect("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
      assert.ok(spans.length >= 1);
      // Should have at least a bearer_token or auth_header match
      const hasBearerOrAuth = spans.some(
        (s) => s.classification === "bearer_token" || s.classification === "auth_header",
      );
      assert.ok(hasBearerOrAuth);
    });

    it("detects Bearer token standalone", () => {
      const spans = detector.detect("Bearer abcdefghijklmnopqrstuvwxyz123456");
      assert.ok(spans.length >= 1);
    });
  });

  // =======================================================================
  // Basic auth
  // =======================================================================

  describe("Basic auth", () => {
    it("detects Basic auth header value", () => {
      const spans = detector.detect("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "basic_auth", "high");
    });
  });

  // =======================================================================
  // JWT tokens
  // =======================================================================

  describe("JWT tokens", () => {
    it("detects standard JWT format", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ." +
        "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const spans = detector.detect(jwt);
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "jwt", "high");
    });

    it("does not flag three short base64 segments", () => {
      const spans = detector.detect("abc.def.ghi");
      // Should not match because segments don't start with eyJ
      assert.equal(spans.length, 0);
    });
  });

  // =======================================================================
  // PEM private keys
  // =======================================================================

  describe("Private keys", () => {
    it("detects RSA private key block", () => {
      const pem = [
        "-----BEGIN RSA PRIVATE KEY-----",
        "MIIEpAIBAAKCAQEA1MNPw6i3DpX7",
        "-----END RSA PRIVATE KEY-----",
      ].join("\n");
      const spans = detector.detect(pem);
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "private_key", "high");
    });

    it("detects EC private key block", () => {
      const pem = [
        "-----BEGIN EC PRIVATE KEY-----",
        "MHQCAQEEIIm3VYFq",
        "-----END EC PRIVATE KEY-----",
      ].join("\n");
      const spans = detector.detect(pem);
      assert.ok(spans.length >= 1);
    });

    it("detects OPENSSH private key block", () => {
      const pem = [
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "b3BlbnNzaC1rZXktdjEAAAAA",
        "-----END OPENSSH PRIVATE KEY-----",
      ].join("\n");
      const spans = detector.detect(pem);
      assert.ok(spans.length >= 1);
    });

    it("detects generic PRIVATE KEY block", () => {
      const pem = [
        "-----BEGIN PRIVATE KEY-----",
        "MIIJQwIBADANBgkqhkiG9w0BAQEFAASC",
        "-----END PRIVATE KEY-----",
      ].join("\n");
      const spans = detector.detect(pem);
      assert.ok(spans.length >= 1);
    });
  });

  // =======================================================================
  // Credential URLs
  // =======================================================================

  describe("Credential URLs", () => {
    it("detects user:pass@host URLs", () => {
      const spans = detector.detect("https://admin:secret123@example.com/api");
      assert.ok(spans.length >= 1);
      expectValidSpan(spans[0], "credential_url", "high");
    });

    it("detects token@host URLs", () => {
      const spans = detector.detect("https://ghp_abcdefghijklmnopqrstuvwxyz@github.com/repo");
      assert.ok(spans.length >= 1, "Should detect token@host URL");
    });
  });

  // =======================================================================
  // Auth headers and cookies
  // =======================================================================

  describe("Auth headers and cookies", () => {
    it("detects Authorization header", () => {
      const spans = detector.detect("Authorization: Bearer xyz123");
      assert.ok(spans.some((s) => s.classification === "auth_header"));
    });

    it("detects Proxy-Authorization header", () => {
      const spans = detector.detect("Proxy-Authorization: Basic xyz123");
      assert.ok(spans.some((s) => s.classification === "auth_header"));
    });

    it("detects Cookie header", () => {
      const spans = detector.detect("Cookie: sessionId=abc123; secret=xyz");
      assert.ok(spans.some((s) => s.classification === "auth_header"));
    });

    it("detects Set-Cookie header", () => {
      const spans = detector.detect("Set-Cookie: token=abc123; HttpOnly");
      assert.ok(spans.some((s) => s.classification === "auth_header"));
    });
  });

  // =======================================================================
  // High-entropy (disabled by default)
  // =======================================================================

  describe("High-entropy detection", () => {
    it("is disabled by default", () => {
      const detector = new SecretDetector();
      // A long random-looking token that should not match built-in patterns
      const spans = detector.detect("aB3dE5fGhIjKlMnOpQrStUvWxYz0123456789");
      // Should not have generic_secret matches from entropy
      assert.equal(
        spans.some((s) => s.classification === "generic_secret"),
        false,
      );
    });
  });

  // =======================================================================
  // Custom patterns
  // =======================================================================

  describe("Custom patterns", () => {
    it("accepts custom patterns via options", () => {
      const detector = new SecretDetector({
        customPatterns: [
          { pattern: /CUSTOM_KEY_[A-Z0-9]+/g, classification: "api_key" },
        ],
      });
      const spans = detector.detect("CUSTOM_KEY_ABCDEF123456");
      assert.ok(spans.some((s) => s.classification === "api_key"));
    });
  });

  // =======================================================================
  // Edge cases
  // =======================================================================

  describe("Edge cases", () => {
    it("returns empty array for non-string input", () => {
      const spans = detector.detect(42);
      assert.deepEqual(spans, []);
    });

    it("returns empty array for null input", () => {
      const spans = detector.detect(null);
      assert.deepEqual(spans, []);
    });

    it("returns empty array for empty string", () => {
      const spans = detector.detect("");
      assert.deepEqual(spans, []);
    });

    it("handles very long input", () => {
      const long = "sk-test" + "x".repeat(70000);
      const spans = detector.detect(long);
      // Should not throw; input is truncated at MAX_STRING_SCAN
      assert.ok(Array.isArray(spans));
    });

    it("deduplicates overlapping spans", () => {
      // An Authorization header with Bearer token should produce one span
      // (or at least non-overlapping merged spans)
      const spans = detector.detect("Authorization: Bearer xyz123abc456def789ghi012jkl345mno");
      const authHeaders = spans.filter((s) => s.classification === "auth_header");
      // The auth_header pattern only appears once
      assert.ok(authHeaders.length <= 1);
    });
  });

  // =======================================================================
  // No raw context
  // =======================================================================

  describe("No raw source context", () => {
    it("does not expose raw context in results", () => {
      const spans = detector.detect("api_key = sk-abcdefghijklmnopqrstuvwxyz123456");
      for (const span of spans) {
        assert.equal(
          (span as unknown as Record<string, unknown>).context,
          undefined,
          "SecretSpan should not have a context field",
        );
        assert.equal(
          (span as unknown as Record<string, unknown>).line,
          undefined,
          "SecretSpan should not have a line field",
        );
      }
    });
  });

  // =======================================================================
  // Static getDefaultPatterns
  // =======================================================================

  describe("getDefaultPatterns", () => {
    it("returns an array of known patterns", () => {
      const patterns = SecretDetector.getDefaultPatterns();
      assert.ok(patterns.length >= 10);
      for (const p of patterns) {
        assert.ok(p.pattern instanceof RegExp);
        assert.equal(typeof p.classification, "string");
        assert.equal(typeof p.confidence, "string");
      }
    });
  });
});
