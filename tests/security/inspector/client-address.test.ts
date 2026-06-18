/**
 * client-address.test.ts — Sc1.3 Client address resolution tests.
 *
 * Covers:
 * - CIDR parsing
 * - Address normalization (IPv4, IPv6, IPv4-mapped)
 * - X-Forwarded-For chain parsing and bounds
 * - Trusted proxy CIDR matching
 * - Forged forwarding header rejection
 * - Malformed header rejection
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCidr,
  normalizeAddress,
  parseForwardedChain,
  resolveClientAddress,
  proxyTrustDiagnostic,
} from "../../../src/security/inspector/client-address.js";

// ---------------------------------------------------------------------------
// CIDR parsing
// ---------------------------------------------------------------------------

describe("parseCidr", () => {
  it("parses IPv4 CIDR", () => {
    const cidr = parseCidr("10.0.0.0/8");
    assert.ok(cidr);
    assert.equal(cidr.isV6, false);
    assert.equal(cidr.prefixLen, 8);
    assert.deepEqual(cidr.network, [10, 0, 0, 0]);
  });

  it("parses /32 CIDR", () => {
    const cidr = parseCidr("192.168.1.1/32");
    assert.ok(cidr);
    assert.equal(cidr.prefixLen, 32);
  });

  it("parses /0 CIDR (all addresses)", () => {
    const cidr = parseCidr("0.0.0.0/0");
    assert.ok(cidr);
    assert.equal(cidr.prefixLen, 0);
  });

  it("returns null for invalid CIDR", () => {
    assert.equal(parseCidr("not-a-cidr"), null);
    assert.equal(parseCidr("10.0.0.0"), null); // no prefix
    assert.equal(parseCidr("10.0.0.0/33"), null); // prefix too large
    assert.equal(parseCidr("10.0.0.0/-1"), null); // negative prefix
    assert.equal(parseCidr("10.0.0.0/abc"), null); // non-numeric prefix
  });
});

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

describe("normalizeAddress", () => {
  it("normalizes IPv4", () => {
    assert.equal(normalizeAddress("192.168.1.1"), "192.168.1.1");
    assert.equal(normalizeAddress(" 192.168.1.1 "), "192.168.1.1");
  });

  it("normalizes IPv4-mapped IPv6 to IPv4", () => {
    assert.equal(normalizeAddress("::ffff:192.168.1.1"), "192.168.1.1");
    assert.equal(normalizeAddress("::ffff:127.0.0.1"), "127.0.0.1");
  });

  it("normalizes IPv6", () => {
    const n = normalizeAddress("::1");
    assert.ok(n.includes(":"));
    assert.ok(!n.includes("::")); // should be expanded
  });

  it("lowercases addresses", () => {
    assert.equal(normalizeAddress("ABCD::1"), normalizeAddress("abcd::1"));
  });
});

// ---------------------------------------------------------------------------
// X-Forwarded-For chain parsing
// ---------------------------------------------------------------------------

describe("parseForwardedChain", () => {
  it("parses single proxy hop", () => {
    const result = parseForwardedChain("10.0.0.1, 10.0.0.2");
    assert.ok(result);
    assert.equal(result!.client, "10.0.0.1");
    assert.equal(result!.chain.length, 2);
  });

  it("parses multiple proxy hops", () => {
    const result = parseForwardedChain("1.2.3.4, 10.0.0.1, 10.0.0.2");
    assert.ok(result);
    assert.equal(result!.client, "1.2.3.4");
    assert.equal(result!.chain.length, 3);
  });

  it("rejects chain exceeding max hops", () => {
    const longChain = Array.from({ length: 7 }, (_, i) => `10.0.0.${i + 1}`).join(", ");
    const result = parseForwardedChain(longChain);
    assert.equal(result, null);
  });

  it("rejects malformed addresses in chain", () => {
    const result = parseForwardedChain("10.0.0.1, <script>alert(1)</script>");
    assert.equal(result, null);
  });

  it("rejects suspicious characters", () => {
    assert.equal(parseForwardedChain("10.0.0.1, 10.0.0.2; droptable"), null);
    assert.equal(parseForwardedChain("10.0.0.1, {evil}"), null);
  });

  it("returns null for empty header", () => {
    assert.equal(parseForwardedChain(""), null);
  });
});

// ---------------------------------------------------------------------------
// Client address resolution
// ---------------------------------------------------------------------------

describe("resolveClientAddress", () => {
  function mockReq(peer: string, headers?: Record<string, string | string[] | undefined>) {
    return {
      socket: { remoteAddress: peer },
      headers: headers ?? {},
    } as Parameters<typeof resolveClientAddress>[0];
  }

  it("uses peer address when no trusted CIDRs", () => {
    const req = mockReq("10.0.0.1", { "x-forwarded-for": "1.2.3.4" });
    const result = resolveClientAddress(req, []);
    assert.equal(result.address, "10.0.0.1");
    assert.equal(result.fromProxy, false);
  });

  it("uses peer address when peer not in trusted CIDR", () => {
    const req = mockReq("10.0.0.1", { "x-forwarded-for": "1.2.3.4" });
    const result = resolveClientAddress(req, ["127.0.0.1/32"]);
    assert.equal(result.address, "10.0.0.1");
    assert.equal(result.fromProxy, false);
  });

  it("extracts client from X-Forwarded-For when peer is trusted", () => {
    const req = mockReq("10.0.0.1", { "x-forwarded-for": "1.2.3.4, 10.0.0.2" });
    const result = resolveClientAddress(req, ["10.0.0.0/8"]);
    assert.equal(result.address, "1.2.3.4");
    assert.equal(result.fromProxy, true);
  });

  it("rejects forged forwarding from untrusted peer", () => {
    // Attacker at 1.2.3.4 sends X-Forwarded-For claiming to be 127.0.0.1
    const req = mockReq("1.2.3.4", { "x-forwarded-for": "127.0.0.1" });
    const result = resolveClientAddress(req, ["10.0.0.0/8"]);
    // Peer is not in trusted CIDR, so we use the peer's actual address
    assert.equal(result.address, "1.2.3.4");
    assert.equal(result.fromProxy, false);
  });

  it("falls back to peer on malformed forwarding header", () => {
    const req = mockReq("10.0.0.1", { "x-forwarded-for": "<malformed>" });
    const result = resolveClientAddress(req, ["10.0.0.0/8"]);
    assert.equal(result.address, "10.0.0.1");
    assert.equal(result.fromProxy, false);
  });
});

// ---------------------------------------------------------------------------
// Proxy trust diagnostics
// ---------------------------------------------------------------------------

describe("proxyTrustDiagnostic", () => {
  it("reports no proxy trust by default", () => {
    const diag = proxyTrustDiagnostic([]);
    assert.equal(diag.proxyTrustConfigured, false);
    assert.equal(diag.warnings.length, 0);
  });

  it("reports valid CIDR configuration", () => {
    const diag = proxyTrustDiagnostic(["10.0.0.0/8"]);
    assert.equal(diag.proxyTrustConfigured, true);
    assert.equal(diag.warnings.length, 0);
  });

  it("warns on invalid CIDRs", () => {
    const diag = proxyTrustDiagnostic(["not-a-cidr", "10.0.0.0/8"]);
    assert.equal(diag.warnings.length, 1);
  });
});
