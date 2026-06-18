/**
 * remote-access-policy.test.ts — S0.5: Secure startup validation.
 *
 * Validates that:
 *  1. Loopback hosts are always safe
 *  2. 0.0.0.0 warns but is allowed
 *  3. Non-loopback host without auth is rejected
 *  4. High-visibility warnings are produced for non-loopback
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkStartupSafety } from "../../../src/security/inspector/remote-access-policy.js";
import type { AlixConfig } from "../../../src/config/schema.js";

function makeUiConfig(overrides?: Partial<AlixConfig["ui"]>): Pick<AlixConfig, "ui"> {
  return {
    ui: {
      enabled: true,
      host: "127.0.0.1",
      port: 4137,
      transport: "sse",
      security: {
        authentication: "disabled-loopback-development",
        remoteAccess: false,
        allowedHosts: ["127.0.0.1", "::1", "localhost"],
        allowedOrigins: [],
        trustedProxyCidrs: [],
        requireTlsForRemote: true,
      },
      ...overrides,
    },
  };
}

describe("checkStartupSafety", () => {
  it("loopback host is safe", () => {
    const result = checkStartupSafety(makeUiConfig({ host: "127.0.0.1" }));
    assert.ok(result.ok);
    assert.equal(result.warnings.length, 0);
  });

  it("localhost is safe", () => {
    const result = checkStartupSafety(makeUiConfig({ host: "localhost" }));
    assert.ok(result.ok);
    assert.equal(result.warnings.length, 0);
  });

  it("IPv6 loopback ::1 is safe", () => {
    const result = checkStartupSafety(makeUiConfig({ host: "::1" }));
    assert.ok(result.ok);
    assert.equal(result.warnings.length, 0);
  });

  it("0.0.0.0 warns but is allowed", () => {
    const result = checkStartupSafety(makeUiConfig({ host: "0.0.0.0" }));
    assert.ok(result.ok, "0.0.0.0 should be allowed (with warnings)");
    assert.ok(result.warnings.length > 0, "0.0.0.0 should produce warnings");
    assert.ok(result.warnings.some(w => w.includes("0.0.0.0")), "warning should mention 0.0.0.0");
  });

  it("non-loopback host without auth is rejected", () => {
    const result = checkStartupSafety(makeUiConfig({
      host: "192.168.1.1",
      security: {
        authentication: "disabled-loopback-development",
        remoteAccess: false,
        allowedHosts: ["192.168.1.1"],
        allowedOrigins: [],
        trustedProxyCidrs: [],
        requireTlsForRemote: true,
      },
    }));
    assert.ok(!result.ok, "non-loopback without auth should be rejected");
    assert.ok(result.warnings.length > 0);
    assert.ok(result.error.includes("non-loopback host"), "error should mention non-loopback");
  });

  it("non-loopback host without security config is rejected", () => {
    const config = makeUiConfig({ host: "192.168.1.1" });
    delete (config.ui as any).security;
    const result = checkStartupSafety(config);
    assert.ok(!result.ok, "non-loopback without security config should be rejected");
  });

  it("external hostname produces warnings even if allowed", () => {
    const result = checkStartupSafety(makeUiConfig({
      host: "0.0.0.0",
      security: {
        authentication: "required",
        remoteAccess: true,
        allowedHosts: ["*"],
        allowedOrigins: [],
        trustedProxyCidrs: [],
        requireTlsForRemote: true,
      },
    }));
    assert.ok(result.ok, "0.0.0.0 with auth should be accepted");
    assert.ok(result.warnings.length > 0, "should include warnings");
  });
});
