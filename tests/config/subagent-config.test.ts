import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSubagentRole,
  isSubagentsEnabled,
} from "../../src/operations/config/subagent-config.js";
import type { AlixConfig } from "../../src/operations/config/schema.js";

function config(subagents: AlixConfig["subagents"]): AlixConfig {
  return { subagents } as AlixConfig;
}

test("reads disabled when subagents is absent", () => {
  assert.equal(isSubagentsEnabled(undefined), false);
  assert.equal(isSubagentsEnabled(config(undefined)), false);
});

test("reads the enabled behavior flag", () => {
  assert.equal(
    isSubagentsEnabled(config({ enabled: true, roles: [] })),
    true,
  );
  assert.equal(
    isSubagentsEnabled(config({ enabled: false, roles: [] })),
    false,
  );
});

test("never consults models.* for the behavior flag", () => {
  const full = {
    subagents: { enabled: true, roles: [] },
    models: { default: { provider: "openai", name: "gpt-4o" } },
  } as unknown as AlixConfig;
  assert.equal(isSubagentsEnabled(full), true);
});

test("resolves a configured role by name", () => {
  const cfg = config({
    enabled: true,
    roles: [{ role: "worker", mode: "write" }],
  });
  assert.equal(getSubagentRole(cfg, "worker")?.mode, "write");
  assert.equal(getSubagentRole(cfg, "explorer"), undefined);
});

test("returns undefined when no roles are configured", () => {
  assert.equal(getSubagentRole(undefined, "worker"), undefined);
  assert.equal(getSubagentRole(config(undefined), "worker"), undefined);
});
