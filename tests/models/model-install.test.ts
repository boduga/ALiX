import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyProfile, listAllProfiles, showProfileDetail } from "../../src/models/model-install.js";

const TEST_DIR = join(process.cwd(), `.test-model-install-${Date.now()}`);
const ALIX_DIR = join(TEST_DIR, ".alix");
const CONFIG_PATH = join(ALIX_DIR, "config.json");

function createConfig(overrides: Record<string, unknown> = {}): void {
  mkdirSync(ALIX_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({
    version: 1, model: { provider: "ollama", name: "test" },
    permissions: { default: "allow" as const, tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, repoMapMode: "lite" as const, maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process" as const, shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const },
    ...overrides,
  }, null, 2), "utf-8");
}

describe("model-install", () => {
  beforeEach(() => { if (existsSync(ALIX_DIR)) rmSync(ALIX_DIR, { recursive: true, force: true }); });
  afterEach(() => { if (existsSync(ALIX_DIR)) rmSync(ALIX_DIR, { recursive: true, force: true }); });

  it("listAllProfiles returns built-in profiles", () => {
    const ids = listAllProfiles().map(p => p.id);
    assert.ok(ids.includes("minimal-local")); assert.ok(ids.includes("balanced-local")); assert.ok(ids.includes("all-cloud"));
  });
  it("showProfileDetail returns profile by ID", () => {
    assert.equal(showProfileDetail("balanced-local")?.id, "balanced-local");
  });
  it("showProfileDetail returns undefined for unknown", () => {
    assert.equal(showProfileDetail("nonexistent"), undefined);
  });
  it("applyProfile returns error for unknown profile", () => {
    const r = applyProfile("nonexistent", TEST_DIR);
    assert.equal(r.success, false); assert.ok(r.message.includes("Unknown profile"));
  });
  it("applyProfile writes config changes", () => {
    createConfig(); applyProfile("balanced-local", TEST_DIR);
    const updated = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    assert.equal(updated.modelProfile, "balanced-local");
  });
  it("applyProfile with dry-run does not write", () => {
    createConfig(); const before = readFileSync(CONFIG_PATH, "utf-8");
    applyProfile("balanced-local", TEST_DIR, true);
    assert.equal(readFileSync(CONFIG_PATH, "utf-8"), before);
  });
  it("dry-run returns changes and preserved", () => {
    createConfig(); const r = applyProfile("balanced-local", TEST_DIR, true);
    assert.ok(r.changes); assert.ok(Array.isArray(r.preserved));
  });
  it("preserves unrelated sections", () => {
    createConfig({ apiKeys: { anthropic: "sk-test" } }); applyProfile("balanced-local", TEST_DIR);
    const u = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    assert.equal(u.apiKeys.anthropic, "sk-test");
  });
});
