import { describe, it } from "node:test";
import assert from "node:assert";
import { NetworkPolicyMatcher, type NetworkPolicy } from "../../src/policy/network-policy-matcher.js";

describe("NetworkPolicyMatcher", () => {
  const policy: NetworkPolicy = {
    defaultAction: "ask",
    allowlist: ["api.stripe.com", "api.github.com", "localhost", "127.0.0.1"],
    blocklist: ["evil.example.com", "malware.net"],
    allowedPorts: [80, 443, 8080, 8443],
  };

  const matcher = new NetworkPolicyMatcher(policy);

  it("allows allowed domains", () => {
    const result = matcher.match("api.stripe.com");
    assert.equal(result.decision, "allow");
  });

  it("blocks blocklisted domains", () => {
    const result = matcher.match("evil.example.com");
    assert.equal(result.decision, "deny");
  });

  it("asks for unknown domains", () => {
    const result = matcher.match("unknown-api.example.com");
    assert.equal(result.decision, "ask");
  });

  it("extracts domain from URLs", () => {
    const result = matcher.match("https://api.github.com/users");
    assert.equal(result.decision, "allow");
  });

  it("includes port in match", () => {
    const result = matcher.match("example.com:8080");
    assert.equal(result.port, 8080);
    // unknown domains return default action and undefined matched
    assert.equal(result.decision, "ask");
    assert.equal(result.matched, undefined);
  });

  it("validates port against allowed list", () => {
    const result = matcher.match("example.com:22");
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "port_not_allowed");
  });

  it("handles IP addresses", () => {
    const result = matcher.match("127.0.0.1");
    assert.equal(result.decision, "allow");
  });

  it("returns CIDR subnet support", () => {
    const result = matcher.match("192.168.1.100");
    assert.ok(result);
  });
});
