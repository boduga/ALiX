import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePolicyRevision } from "../../src/policy/policy-revision.js";
import type { AlixConfig } from "../../src/config/schema.js";

function makeConfig(overrides?: Partial<AlixConfig>): AlixConfig {
  return {
    permissions: {
      default: "ask",
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: "ask",
      shellWhitelist: { enabled: false, commands: [], allowUnmatched: true },
      ...overrides?.permissions,
    },
    ...overrides,
  } as AlixConfig;
}

describe("computePolicyRevision", () => {
  it("produces stable hash for same config", () => {
    const a = computePolicyRevision(makeConfig());
    const b = computePolicyRevision(makeConfig());
    assert.equal(a, b);
  });

  it("changes when default policy changes", () => {
    const a = computePolicyRevision(makeConfig());
    const c = computePolicyRevision(makeConfig({
      permissions: {
        default: "deny",
        tools: {},
        protectedPaths: [],
        allowNetworkDomains: [],
        denyCommands: [],
        sessionMode: "ask",
        shellWhitelist: { enabled: false, commands: [], allowUnmatched: true },
      },
    }));
    assert.notEqual(a, c);
  });

  it("changes when tools config changes", () => {
    const a = computePolicyRevision(makeConfig());
    const b = computePolicyRevision(makeConfig({
      permissions: {
        default: "ask",
        tools: { "file.write": "deny" },
        protectedPaths: [],
        allowNetworkDomains: [],
        denyCommands: [],
        sessionMode: "ask",
        shellWhitelist: { enabled: false, commands: [], allowUnmatched: true },
      },
    }));
    assert.notEqual(a, b);
  });

  it("changes when protected paths change", () => {
    const a = computePolicyRevision(makeConfig());
    const b = computePolicyRevision(makeConfig({
      permissions: {
        default: "ask",
        tools: {},
        protectedPaths: ["/etc"],
        allowNetworkDomains: [],
        denyCommands: [],
        sessionMode: "ask",
        shellWhitelist: { enabled: false, commands: [], allowUnmatched: true },
      },
    }));
    assert.notEqual(a, b);
  });

  it("produces deterministic output", () => {
    const rev = computePolicyRevision(makeConfig());
    assert.equal(typeof rev, "string");
    assert.equal(rev.length, 64); // SHA-256 hex
  });
});
