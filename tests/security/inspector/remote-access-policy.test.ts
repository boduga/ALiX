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
import {
  checkStartupSafety,
  resolveAccessMode,
  validateRemoteAccessStartup,
  remoteAccessDoctorReport,
  validateRemoteAccess,
  isEncrypted,
  detectConnectionSecurity,
  shouldSetSecureCookie,
  type RemoteAccessConfig,
} from "../../../src/security/inspector/remote-access-policy.js";
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

function makeRemoteConfig(overrides?: Partial<RemoteAccessConfig>): RemoteAccessConfig {
  return {
    bindHost: "127.0.0.1",
    remoteAccess: false,
    requireTlsForRemote: true,
    allowedHosts: ["127.0.0.1", "::1", "localhost"],
    allowedOrigins: [],
    ...overrides,
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

// ---------------------------------------------------------------------------
// Sc1.4 — resolveAccessMode
// ---------------------------------------------------------------------------

describe("resolveAccessMode", () => {
  it("returns loopback for 127.0.0.1", () => {
    assert.equal(resolveAccessMode("127.0.0.1"), "loopback");
  });

  it("returns loopback for localhost", () => {
    assert.equal(resolveAccessMode("localhost"), "loopback");
  });

  it("returns remote for 0.0.0.0 (not loopback)", () => {
    assert.equal(resolveAccessMode("0.0.0.0"), "remote");
  });

  it("returns remote for external host", () => {
    assert.equal(resolveAccessMode("my-server.example.com"), "remote");
  });

  it("returns remote for non-loopback IP", () => {
    assert.equal(resolveAccessMode("192.168.1.1"), "remote");
  });
});

// ---------------------------------------------------------------------------
// Sc1.4 — validateRemoteAccessStartup
// ---------------------------------------------------------------------------

describe("validateRemoteAccessStartup", () => {
  it("validates loopback mode", () => {
    const result = validateRemoteAccessStartup(makeRemoteConfig({
      bindHost: "127.0.0.1",
      remoteAccess: false,
    }));
    assert.equal(result.mode, "loopback");
    assert.equal(result.valid, true);
  });

  it("errors on remote access without allowed hosts", () => {
    const result = validateRemoteAccessStartup(makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
      allowedHosts: [],
    }));
    assert.equal(result.mode, "remote");
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("errors on wildcard host with remote access", () => {
    const result = validateRemoteAccessStartup(makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
      allowedHosts: ["*"],
    }));
    assert.equal(result.valid, false);
  });

  it("errors on wildcard origin with remote access", () => {
    const result = validateRemoteAccessStartup(makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
      allowedHosts: ["my-server.example.com"],
      allowedOrigins: ["*"],
    }));
    assert.equal(result.valid, false);
  });

  it("warns on remote access without TLS requirement", () => {
    const result = validateRemoteAccessStartup(makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
      allowedHosts: ["my-server.example.com"],
      requireTlsForRemote: false,
    }));
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
  });

  it("passes with valid remote config", () => {
    const result = validateRemoteAccessStartup(makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
      allowedHosts: ["my-server.example.com"],
      allowedOrigins: ["https://my-server.example.com"],
      requireTlsForRemote: true,
    }));
    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// Sc1.4 — connection security detection
// ---------------------------------------------------------------------------

describe("detectConnectionSecurity", () => {
  it("detects cleartext by default", () => {
    const req = mockRequest({});
    assert.equal(detectConnectionSecurity(req), "cleartext");
  });

  it("detects proxy TLS termination", () => {
    const req = mockRequest({ "x-forwarded-proto": "https" });
    assert.equal(detectConnectionSecurity(req), "proxy-tls");
  });

  it("detects direct TLS", () => {
    const req = mockRequest({}, true);
    assert.equal(detectConnectionSecurity(req), "direct-tls");
  });
});

describe("isEncrypted", () => {
  it("returns false for cleartext", () => {
    assert.equal(isEncrypted(mockRequest({})), false);
  });

  it("returns true for proxy-tls", () => {
    assert.equal(isEncrypted(mockRequest({ "x-forwarded-proto": "https" })), true);
  });

  it("returns true for direct-tls", () => {
    assert.equal(isEncrypted(mockRequest({}, true)), true);
  });
});

// ---------------------------------------------------------------------------
// Sc1.4 — validateRemoteAccess (per-request)
// ---------------------------------------------------------------------------

describe("validateRemoteAccess", () => {
  it("allows loopback cleartext bearer", () => {
    const config = makeRemoteConfig({ bindHost: "127.0.0.1" });
    const req = mockRequest({});
    const result = validateRemoteAccess(req, config, true, false);
    assert.equal(result.ok, true);
  });

  it("rejects cleartext remote bearer", () => {
    const config = makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
    });
    const req = mockRequest({}); // cleartext
    const result = validateRemoteAccess(req, config, true, false);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "cleartext_remote_bearer_denied");
    }
  });

  it("allows remote bearer over TLS proxy", () => {
    const config = makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
    });
    const req = mockRequest({ "x-forwarded-proto": "https" });
    const result = validateRemoteAccess(req, config, true, false);
    assert.equal(result.ok, true);
  });

  it("rejects cleartext remote cookie", () => {
    const config = makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
    });
    const req = mockRequest({});
    const result = validateRemoteAccess(req, config, false, true);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "cleartext_remote_cookie_denied");
    }
  });

  it("allows loopback peer behind proxy on remote host", () => {
    const config = makeRemoteConfig({
      bindHost: "192.168.1.1",
      remoteAccess: true,
    });
    const req = mockRequest({}, false, "127.0.0.1");
    const result = validateRemoteAccess(req, config, true, false);
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Sc1.4 — shouldSetSecureCookie
// ---------------------------------------------------------------------------

describe("shouldSetSecureCookie", () => {
  it("returns false for loopback cleartext", () => {
    const req = mockRequest({});
    assert.equal(shouldSetSecureCookie(req, "loopback"), false);
  });

  it("returns true for loopback with TLS", () => {
    const req = mockRequest({}, true);
    assert.equal(shouldSetSecureCookie(req, "loopback"), true);
  });

  it("returns true for remote always", () => {
    const req = mockRequest({});
    assert.equal(shouldSetSecureCookie(req, "remote"), true);
  });
});

// ---------------------------------------------------------------------------
// Sc1.4 — remoteAccessDoctorReport
// ---------------------------------------------------------------------------

describe("remoteAccessDoctorReport", () => {
  it("produces a report for loopback config", () => {
    const report = remoteAccessDoctorReport(makeRemoteConfig({
      bindHost: "127.0.0.1",
    }));
    assert.equal(report.mode, "loopback");
    assert.equal(report.remoteAccessEnabled, false);
    assert.equal(report.tlsRequired, true);
    assert.ok(Array.isArray(report.startupWarnings));
    assert.ok(Array.isArray(report.startupErrors));
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRequest(
  headers: Record<string, string>,
  encrypted: boolean = false,
  remoteAddress: string = "10.0.0.1",
) {
  return {
    headers: headers as Record<string, string | string[] | undefined>,
    socket: { encrypted, remoteAddress },
  } as unknown as Parameters<typeof detectConnectionSecurity>[0];
}
