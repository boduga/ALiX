/**
 * ui-security.test.ts — S0.2: UI security schema validation.
 *
 * Ensures that:
 *  1. DEFAULT_CONFIG has secure defaults
 *  2. Existing configs without ui.security still load
 *  3. authentication: "disabled-loopback-development" is rejected on non-loopback hosts
 *  4. remoteAccess: true with non-loopback host is rejected
 *  5. Loopback hosts pass security validation
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { validateConfig, isLoopbackHost } from "../../src/config/validator.js";
import type { AlixConfig } from "../../src/config/schema.js";

function makeConfig(overrides?: Partial<AlixConfig["ui"]> & { security?: AlixConfig["ui"]["security"] }): AlixConfig {
  return {
    version: 1,
    model: { provider: "test", name: "test-model" },
    permissions: { default: "ask", tools: {}, protectedPaths: [], denyCommands: [], allowNetworkDomains: [] },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 10000, envAllowlist: [] },
    ui: {
      enabled: true,
      host: "127.0.0.1",
      port: 4137,
      transport: "sse",
      ...overrides,
    },
  };
}

// ── isLoopbackHost ──

test("isLoopbackHost returns true for 127.0.0.1", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
});

test("isLoopbackHost returns true for localhost", () => {
  assert.equal(isLoopbackHost("localhost"), true);
});

test("isLoopbackHost returns true for ::1", () => {
  assert.equal(isLoopbackHost("::1"), true);
});

test("isLoopbackHost returns true for [::1]", () => {
  assert.equal(isLoopbackHost("[::1]"), true);
});

test("isLoopbackHost returns false for 0.0.0.0", () => {
  assert.equal(isLoopbackHost("0.0.0.0"), false);
});

test("isLoopbackHost returns false for external host", () => {
  assert.equal(isLoopbackHost("192.168.1.1"), false);
});

// ── Defaults ──

test("DEFAULT_CONFIG has ui.security with secure defaults", () => {
  const sec = DEFAULT_CONFIG.ui.security;
  assert.ok(sec, "security should be defined");
  assert.equal(sec!.authentication, "disabled-loopback-development");
  assert.equal(sec!.remoteAccess, false);
  assert.ok(Array.isArray(sec!.allowedHosts));
  assert.ok(Array.isArray(sec!.allowedOrigins));
  assert.ok(Array.isArray(sec!.trustedProxyCidrs));
  assert.equal(sec!.requireTlsForRemote, true);
});

test("config without ui.security does not fail validation", () => {
  const config = makeConfig();
  delete (config.ui as any).security;
  const result = validateConfig(config);
  assert.equal(result.valid, true);
  const secIssues = result.issues.filter(i => i.path.startsWith("ui.security"));
  assert.equal(secIssues.length, 0);
});

// ── Authentication validation ──

test("disabled-loopback-development on loopback host is valid (with warning)", () => {
  const config = makeConfig({
    host: "127.0.0.1",
    security: {
      authentication: "disabled-loopback-development",
      remoteAccess: false,
      allowedHosts: ["127.0.0.1", "::1", "localhost"],
      allowedOrigins: [],
      trustedProxyCidrs: [],
      requireTlsForRemote: true,
    },
  });
  const result = validateConfig(config);
  // Should pass (valid = true despite warning)
  assert.equal(result.valid, true);
  const authWarnings = result.issues.filter(i => i.path === "ui.security.authentication" && i.level === "warning");
  assert.ok(authWarnings.length >= 1, "should warn about disabled authentication");
});

test("disabled-loopback-development on non-loopback host is rejected", () => {
  const config = makeConfig({
    host: "0.0.0.0",
    security: {
      authentication: "disabled-loopback-development",
      remoteAccess: false,
      allowedHosts: ["0.0.0.0"],
      allowedOrigins: [],
      trustedProxyCidrs: [],
      requireTlsForRemote: true,
    },
  });
  const result = validateConfig(config);
  const authErrors = result.issues.filter(i => i.path === "ui.security.authentication" && i.level === "error");
  assert.ok(authErrors.length >= 1, "should error on non-loopback host with disabled auth");
  assert.equal(result.valid, false);
});

// ── Remote access validation ──

test("remoteAccess: true on non-loopback host is rejected", () => {
  const config = makeConfig({
    host: "0.0.0.0",
    security: {
      authentication: "required",
      remoteAccess: true,
      allowedHosts: ["*"],
      allowedOrigins: [],
      trustedProxyCidrs: [],
      requireTlsForRemote: true,
    },
  });
  const result = validateConfig(config);
  const remoteErrors = result.issues.filter(i => i.path === "ui.security.remoteAccess" && i.level === "error");
  assert.ok(remoteErrors.length >= 1, "should error about remote access not yet approved");
  assert.equal(result.valid, false);
});

test("remoteAccess: true on loopback host is valid", () => {
  const config = makeConfig({
    host: "127.0.0.1",
    security: {
      authentication: "required",
      remoteAccess: true,
      allowedHosts: ["127.0.0.1", "::1", "localhost"],
      allowedOrigins: [],
      trustedProxyCidrs: [],
      requireTlsForRemote: true,
    },
  });
  const result = validateConfig(config);
  const remoteErrors = result.issues.filter(i => i.path === "ui.security.remoteAccess" && i.level === "error");
  assert.equal(remoteErrors.length, 0);
  assert.equal(result.valid, true);
});

// ── IPv6 loopback ──

test("disabled-loopback-development on IPv6 loopback is valid", () => {
  const config = makeConfig({
    host: "::1",
    security: {
      authentication: "disabled-loopback-development",
      remoteAccess: false,
      allowedHosts: ["127.0.0.1", "::1", "localhost"],
      allowedOrigins: [],
      trustedProxyCidrs: [],
      requireTlsForRemote: true,
    },
  });
  const result = validateConfig(config);
  const authErrors = result.issues.filter(i => i.path === "ui.security.authentication" && i.level === "error");
  assert.equal(authErrors.length, 0, "IPv6 loopback should be valid");
  assert.equal(result.valid, true);
});
