/**
 * host-policy.test.ts — S0.3: Host header validation for the Inspector.
 *
 * Validates that:
 *  1. Valid loopback forms are accepted by default
 *  2. IPv6 loopback is supported
 *  3. Absent Host header is rejected for API requests
 *  4. Malformed hosts are rejected
 *  5. Unapproved hostnames are rejected
 *  6. The rejected raw Host does not appear in the error response
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateHost, normalizeHost, type HostPolicyResult } from "../../../src/security/inspector/host-policy.js";

const DEFAULT_ALLOWED = ["127.0.0.1", "::1", "localhost"];

describe("normalizeHost", () => {
  it("strips port from host:port", () => {
    assert.equal(normalizeHost("127.0.0.1:4137"), "127.0.0.1");
  });

  it("strips port from IPv6 [::1]:port", () => {
    assert.equal(normalizeHost("[::1]:4137"), "::1");
    assert.equal(normalizeHost("[::1]"), "::1");
  });

  it("lowercases the host", () => {
    assert.equal(normalizeHost("LOCALHOST"), "localhost");
    assert.equal(normalizeHost("LocalHost:4137"), "localhost");
  });

  it("handles bare IPv6 address", () => {
    assert.equal(normalizeHost("::1"), "::1");
  });

  it("returns trimmed host", () => {
    assert.equal(normalizeHost("  127.0.0.1  "), "127.0.0.1");
  });
});

describe("validateHost", () => {
  it("accepts 127.0.0.1 with port", () => {
    const result = validateHost("127.0.0.1:4137", DEFAULT_ALLOWED);
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.normalizedHost, "127.0.0.1");
  });

  it("accepts 127.0.0.1 without port", () => {
    const result = validateHost("127.0.0.1", DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("accepts localhost", () => {
    const result = validateHost("localhost", DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("accepts IPv6 loopback ::1", () => {
    const result = validateHost("::1", DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("accepts IPv6 loopback with brackets and port", () => {
    const result = validateHost("[::1]:4137", DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("accepts capitalized localhost", () => {
    const result = validateHost("LocalHost:8080", DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("rejects absent Host header", () => {
    const result = validateHost(undefined, DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.statusCode, 400);
      assert.ok(result.error.length > 0);
    }
  });

  it("rejects empty Host header", () => {
    const result = validateHost("", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects malformed host with invalid port", () => {
    const result = validateHost("127.0.0.1:abc", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
  });

  it("rejects port with special characters", () => {
    const result = validateHost("127.0.0.1:!!", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects trailing colon with no port", () => {
    const result = validateHost("127.0.0.1:", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects external host not in allowed list", () => {
    const result = validateHost("evil-server.com:4137", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.statusCode, 403);
    }
  });

  it("rejects IP not in allowed list", () => {
    const result = validateHost("192.168.1.1:4137", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.statusCode, 403);
    }
  });

  it("does not include the rejected raw Host in the error message", () => {
    const result = validateHost("evil-server.com:4137", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.ok(!result.error.includes("evil-server.com"), "error should not contain the raw host");
      assert.ok(result.error.includes("invalid_host"), "error should mention invalid_host");
    }
  });

  it("accepts custom allowed hosts", () => {
    const result = validateHost("my-inspector.local:4137", ["my-inspector.local"]);
    assert.ok(result.ok);
  });

  it("handles Host header as array (takes first)", () => {
    const result = validateHost(["127.0.0.1:4137", "evil.com"], DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("returns stable invalid_host error for external hosts", () => {
    const result = validateHost("external.com", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.ok(result.error.includes("invalid_host"));
    }
  });
});

// ── Sc1.1 DNS rebinding detection ─────────────────────────────────

describe("validateHost — DNS rebinding", () => {
  it("rejects IP address when only hostnames are allowed", () => {
    const result = validateHost("192.168.1.1:4137", ["my-inspector.local"]);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 403);
  });

  it("rejects hostname when only IPs are allowed", () => {
    const result = validateHost("evil.com", ["127.0.0.1", "::1"]);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 403);
  });

  it("does not flag DNS rebinding when allowed list has both IP and hostname (but still rejects unknown IP)", () => {
    // DNS rebinding check is skipped because the allowed list has both types.
    // But the IP is still not in the allowed list, so it's rejected.
    const result = validateHost("192.168.1.1", ["127.0.0.1", "::1", "my-inspector.local"]);
    assert.ok(!result.ok);
    // Error should not be a DNS rebinding error — it's just not in the list
    if (!result.ok) {
      assert.equal(result.error, "invalid_host");
    }
  });

  it("allows hostname when it's in the allowed list along with IPs", () => {
    const result = validateHost("my-inspector.local", ["127.0.0.1", "localhost", "my-inspector.local"]);
    assert.ok(result.ok);
  });
});

// ── Sc1.1 Reject userinfo, path, fragment ──────────────────────────

describe("validateHost — userinfo/path/fragment rejection", () => {
  it("rejects userinfo in Host header", () => {
    const result = validateHost("user:pass@127.0.0.1", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects path in Host header", () => {
    const result = validateHost("127.0.0.1/path", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects fragment in Host header", () => {
    const result = validateHost("127.0.0.1#fragment", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects query string in Host header", () => {
    const result = validateHost("127.0.0.1?query=1", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects control characters in Host header", () => {
    const result = validateHost("127.0.0.1\x00", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });
});

// ── Sc1.1 IPv6 bracket validation ──────────────────────────────────

describe("validateHost — IPv6 bracket validation", () => {
  it("rejects unmatched opening bracket", () => {
    const result = validateHost("[::1", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects empty bracket pair", () => {
    const result = validateHost("[]", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects garbage after bracketed IPv6 without port", () => {
    const result = validateHost("[::1]garbage", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("rejects invalid port after bracketed IPv6", () => {
    const result = validateHost("[::1]:99999", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });
});

// ── Sc1.1 Hostname syntax validation ──────────────────────────────

describe("validateHost — hostname syntax", () => {
  it("rejects overlong hostname", () => {
    const long = "a".repeat(254) + ".com";
    const result = validateHost(long, [long]);
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.statusCode, 400);
  });

  it("strips trailing dot in hostname (FQDN notation)", () => {
    const result = validateHost("localhost.", DEFAULT_ALLOWED);
    assert.ok(result.ok);
  });

  it("rejects hostname segment starting with hyphen", () => {
    const result = validateHost("-bad.localhost", DEFAULT_ALLOWED);
    assert.ok(!result.ok);
  });
});
