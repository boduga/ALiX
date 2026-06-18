/**
 * default-binding.test.ts — S0.1: Verify default host is loopback.
 *
 * Ensures that:
 *  1. A fresh config inherits 127.0.0.1 (not 0.0.0.0)
 *  2. An explicitly configured host is preserved
 *  3. Explicit 0.0.0.0 produces a warning
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { validateConfig } from "../../src/config/validator.js";
import type { AlixConfig } from "../../src/config/schema.js";

const MINIMAL_CONFIG: AlixConfig = {
  version: 1,
  model: { provider: "test", name: "test-model" },
  permissions: { default: "ask", tools: {}, protectedPaths: [], denyCommands: [], allowNetworkDomains: [] },
  context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
  runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 10000, envAllowlist: [] },
  ui: { enabled: true, host: "127.0.0.1", port: 4137, transport: "sse" },
};

test("DEFAULT_CONFIG.ui.host is 127.0.0.1", () => {
  assert.equal(DEFAULT_CONFIG.ui.host, "127.0.0.1");
});

test("fresh config with loopback passes validation without warning", () => {
  const result = validateConfig(MINIMAL_CONFIG);
  const hostIssues = result.issues.filter(i => i.path === "ui.host");
  assert.equal(hostIssues.length, 0);
});

test("explicit 127.0.0.1 is preserved and valid", () => {
  const config = { ...MINIMAL_CONFIG, ui: { ...MINIMAL_CONFIG.ui, host: "127.0.0.1" } };
  assert.equal(config.ui.host, "127.0.0.1");
  const result = validateConfig(config);
  const hostWarnings = result.issues.filter(i => i.path === "ui.host" && i.level === "warning");
  assert.equal(hostWarnings.length, 0);
});

test("explicit localhost is preserved", () => {
  const config = { ...MINIMAL_CONFIG, ui: { ...MINIMAL_CONFIG.ui, host: "localhost" } };
  assert.equal(config.ui.host, "localhost");
  const result = validateConfig(config);
  const hostWarnings = result.issues.filter(i => i.path === "ui.host" && i.level === "warning");
  assert.equal(hostWarnings.length, 0);
});

test("explicit 0.0.0.0 produces a migration warning", () => {
  const config = { ...MINIMAL_CONFIG, ui: { ...MINIMAL_CONFIG.ui, host: "0.0.0.0" } };
  const result = validateConfig(config);
  const hostWarnings = result.issues.filter(i => i.path === "ui.host" && i.level === "warning");
  assert.ok(hostWarnings.length >= 1, "should warn about 0.0.0.0");
  assert.ok(hostWarnings[0].message.includes("0.0.0.0"), "warning should mention 0.0.0.0");
});
