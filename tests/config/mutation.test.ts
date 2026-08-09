/**
 * P4.3-Se2 — Config Mutation and Provenance Tests
 *
 * Covers:
 * - Config set/delete operations
 * - Dot-path resolution
 * - Atomic writes
 * - Provenance logging (hash-chained, bounded)
 * - Secret value rejection
 * - Concurrent mutation detection
 * - Schema validation on mutation
 * - Bounded provenance eviction
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ConfigMutationService,
  computeConfigHash,
  MUTATION_ERROR_CODES,
  type ConfigProvenance,
} from "../../src/config/mutation.js";
import type { AlixConfig } from "../../src/config/schema.js";
import { DEFAULT_CONFIG, PERMIT_ALL_CONFIG } from "../../src/config/defaults.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestConfig(overrides: Partial<AlixConfig> = {}): AlixConfig {
  return {
    ...DEFAULT_CONFIG,
    model: { provider: "test", name: "test-model", temperature: 0.5 },
    models: { default: { provider: "test", name: "test-model" } },
    ...overrides,
  };
}

async function setupService(): Promise<{
  service: ConfigMutationService;
  dir: string;
  configDir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "alix-mutation-test-"));
  const configDir = join(dir, ".alix", "config");
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  const config = makeTestConfig();
  const configPath = join(configDir, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  const service = new ConfigMutationService(configDir);
  return { service, dir, configDir };
}

// ---------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------

test("ConfigMutationService: set a simple top-level value", async () => {
  const { service, dir } = await setupService();
  try {
    const mutation = await service.set("permissions.default", "allow");
    assert.equal(mutation.op, "set");
    assert.equal(mutation.path, "permissions.default");
    assert.equal(mutation.value, "allow");
    assert.equal(mutation.previousValue, "ask");

    // Verify the config on disk was updated
    const config = await service.read();
    assert.equal(config.permissions.default, "allow");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: set a nested value with auto-created path", async () => {
  const { service, dir } = await setupService();
  try {
    const mutation = await service.set("logging.level", "debug");
    assert.equal(mutation.op, "set");
    assert.equal(mutation.value, "debug");
    assert.equal(mutation.previousValue, undefined);

    const config = await service.read();
    assert.equal((config as any).logging?.level, "debug");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: set records provenance", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow");

    const provenance = await service.getProvenance();
    assert.equal(provenance.length, 1);
    assert.equal(provenance[0].mutations.length, 1);
    assert.equal(provenance[0].mutations[0].path, "permissions.default");
    assert.equal(provenance[0].mutations[0].op, "set");
    assert.equal(provenance[0].mutations[0].value, "allow");
    assert.equal(provenance[0].mutations[0].previousValue, "ask");
    assert.equal(provenance[0].version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: provenance is hash-chained", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow");
    await service.set("permissions.default", "deny");

    const provenance = await service.getProvenance();
    assert.equal(provenance.length, 2);

    // Entry 1's configHash == Entry 2's prevConfigHash
    assert.equal(provenance[0].configHash, provenance[1].prevConfigHash);
    assert.notEqual(provenance[0].configHash, provenance[1].configHash);

    assert.equal(provenance[0].version, 1);
    assert.equal(provenance[1].version, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: provenance has no values for delete operations", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("logging.level", "debug");
    await service.delete("logging.level");

    const provenance = await service.getProvenance();
    const deleteEntry = provenance[1];
    assert.equal(deleteEntry.mutations[0].op, "delete");
    assert.equal(deleteEntry.mutations[0].value, undefined);
    assert.equal(deleteEntry.mutations[0].previousValue, "debug");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Delete operations
// ---------------------------------------------------------------------------

test("ConfigMutationService: delete removes a value", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("logging.level", "debug");
    const mutation = await service.delete("logging.level");
    assert.equal(mutation.op, "delete");
    assert.equal(mutation.path, "logging.level");
    assert.equal(mutation.previousValue, "debug");

    const config = await service.read();
    assert.equal((config as any).logging?.level, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: delete non-existent path throws PATH_NOT_FOUND", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.delete("logging.nonexistent"),
      (err: any) => err.code === MUTATION_ERROR_CODES.PATH_NOT_FOUND,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Dot-path resolution
// ---------------------------------------------------------------------------

test("ConfigMutationService: getValue resolves dot-paths", async () => {
  const { service, dir } = await setupService();
  try {
    const config = await service.read();
    assert.equal(service.getValue(config, "model.provider"), "test");
    assert.equal(service.getValue(config, "model.name"), "test-model");
    assert.equal(service.getValue(config, "model.temperature"), 0.5);
    assert.equal(service.getValue(config, "nonexistent"), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: getValue returns object at intermediate path", async () => {
  const { service, dir } = await setupService();
  try {
    const config = await service.read();
    const model = service.getValue(config, "model");
    assert.ok(typeof model === "object");
    assert.equal((model as any).provider, "test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Secret rejection
// ---------------------------------------------------------------------------

test("ConfigMutationService: rejects cred:// references in project config", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.set("apiKeys", { openai: "cred://openai/apiKey" }),
      (err: any) => err.code === MUTATION_ERROR_CODES.SECRET_IN_PROJECT,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: rejects API-key-looking strings", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.set("apiKeys", { openai: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" }),
      (err: any) => err.code === MUTATION_ERROR_CODES.SECRET_IN_PROJECT,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: allows non-secret string values", async () => {
  const { service, dir } = await setupService();
  try {
    const mutation = await service.set("permissions.default", "allow");
    assert.equal(mutation.value, "allow");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

test("ConfigMutationService: atomic write does not leave temp files", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow");

    const configDir = join(dir, ".alix", "config");
    const { readdir: rd } = await import("node:fs/promises");
    const entries = await rd(configDir);
    const tmpFiles = entries.filter((e: string) => e.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, "No temp files should remain after atomic write");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: written config is valid JSON", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow");

    const configPath = join(dir, ".alix", "config", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.permissions.default, "allow");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Concurrent mutation detection
// ---------------------------------------------------------------------------

test("ConfigMutationService: detects concurrent mutations", async () => {
  const { service, dir } = await setupService();
  try {
    // Read initial state (this sets lastReadHash)
    const config = await service.read();

    // Simulate concurrent write by directly writing to disk WITHOUT re-reading
    // This way lastReadHash still reflects the initial state
    const configPath = join(dir, ".alix", "config", "config.json");
    config.permissions.default = "deny";
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

    // Now try to write — should detect the concurrent change
    await assert.rejects(
      () => service.set("permissions.default", "allow"),
      (err: any) => err.code === MUTATION_ERROR_CODES.CONCURRENT_MUTATION,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

test("ConfigMutationService: rejects mutation producing invalid config", async () => {
  const { service, dir } = await setupService();
  try {
    // Setting models.default.name to empty string would be invalid
    await assert.rejects(
      () => service.set("models.default.name", ""),
      (err: any) => err.code === MUTATION_ERROR_CODES.INVALID_RESULT,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Bounded provenance
// ---------------------------------------------------------------------------

test("ConfigMutationService: provenance log is bounded to 100 entries", async () => {
  const { service, dir } = await setupService();
  try {
    // Create 105 mutations by toggling a value
    for (let i = 0; i < 105; i++) {
      await service.set("permissions.default", i % 2 === 0 ? "allow" : "deny");
    }

    const provenance = await service.getProvenance();
    assert.ok(provenance.length <= 100, `Expected <= 100, got ${provenance.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: oldest entries are evicted when bounded", async () => {
  const { service, dir } = await setupService();
  try {
    // Create 110 mutations
    for (let i = 0; i < 110; i++) {
      await service.set("permissions.default", i % 2 === 0 ? "allow" : "deny");
    }

    const provenance = await service.getProvenance();
    assert.equal(provenance.length, 100);

    // First entry should be version 11 (entries 1-10 evicted)
    assert.equal(provenance[0].version, 11);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Provenance filtering
// ---------------------------------------------------------------------------

test("ConfigMutationService: getProvenance filters by path", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow");
    await service.set("logging.level", "debug");

    const permissionProvenance = await service.getProvenance("permissions.default");
    assert.equal(permissionProvenance.length, 1);
    assert.equal(permissionProvenance[0].mutations[0].path, "permissions.default");

    const loggingProvenance = await service.getProvenance("logging.level");
    assert.equal(loggingProvenance.length, 1);
    assert.equal(loggingProvenance[0].mutations[0].path, "logging.level");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Version tracking
// ---------------------------------------------------------------------------

test("ConfigMutationService: getVersion returns provenance entry count", async () => {
  const { service, dir } = await setupService();
  try {
    assert.equal(await service.getVersion(), 0);

    await service.set("permissions.default", "allow");
    assert.equal(await service.getVersion(), 1);

    await service.set("permissions.default", "deny");
    assert.equal(await service.getVersion(), 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// computeConfigHash
// ---------------------------------------------------------------------------

test("computeConfigHash: produces deterministic hashes", () => {
  const config = makeTestConfig();
  const hash1 = computeConfigHash(config);
  const hash2 = computeConfigHash(config);
  assert.equal(hash1, hash2);
});

test("computeConfigHash: different configs produce different hashes", () => {
  const config1 = makeTestConfig();
  const config2 = makeTestConfig({ model: { provider: "other", name: "other-model" } } as any);
  const hash1 = computeConfigHash(config1);
  const hash2 = computeConfigHash(config2);
  assert.notEqual(hash1, hash2);
});

test("computeConfigHash: produces valid SHA-256 hex", () => {
  const config = makeTestConfig();
  const hash = computeConfigHash(config);
  assert.equal(hash.length, 64);
  assert.ok(/^[a-f0-9]{64}$/.test(hash));
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

test("ConfigMutationService: errors use stable error codes", async () => {
  const { service, dir } = await setupService();
  try {
    try {
      await service.delete("logging.nonexistent");
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.equal(err.code, MUTATION_ERROR_CODES.PATH_NOT_FOUND);
      assert.ok(typeof err.message === "string");
      assert.ok(err.message.length > 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// No config directory
// ---------------------------------------------------------------------------

test("ConfigMutationService: read throws NO_CONFIG_DIR when config missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-mutation-test-"));
  const configDir = join(dir, ".alix", "config");
  // Don't create the config file
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const service = new ConfigMutationService(configDir);
  try {
    await assert.rejects(
      () => service.read(),
      (err: any) => err.code === MUTATION_ERROR_CODES.NO_CONFIG_DIR,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// updatedBy actor
// ---------------------------------------------------------------------------

test("ConfigMutationService: provenance tracks updatedBy actor", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow", { updatedBy: "daemon" });

    const provenance = await service.getProvenance();
    assert.equal(provenance[0].updatedBy, "daemon");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: default updatedBy is 'cli'", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("permissions.default", "allow");

    const provenance = await service.getProvenance();
    assert.equal(provenance[0].updatedBy, "cli");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Model-projection guard (single-source invariant, Task 9.5 Step 1)
// ---------------------------------------------------------------------------

test("ConfigMutationService: rejects config set model.*", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.set("model.provider", "openrouter"),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
    await assert.rejects(
      () => service.set("model.temperature", 0.7),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: rejects config set subagents.*", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.set("subagents.coder.provider", "anthropic"),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
    await assert.rejects(
      () => service.set("subagents", { enabled: false }),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: rejects config delete model", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.delete("model"),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: rejects config delete subagents", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.delete("subagents"),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: guard message directs to alix models commands", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.set("model.temperature", 0.7),
      (err: any) => {
        assert.ok(
          err.message.includes("alix models set-default") || err.message.includes("alix models"),
          `guard message should direct to alix models commands: ${err.message}`,
        );
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: rejected operations do not modify config.json", async () => {
  const { service, dir } = await setupService();
  try {
    const configPath = join(dir, ".alix", "config", "config.json");
    const before = await readFile(configPath, "utf-8");

    await assert.rejects(
      () => service.set("model.provider", "openrouter"),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );
    await assert.rejects(
      () => service.delete("subagents"),
      (err: any) => err.code === MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED,
    );

    const after = await readFile(configPath, "utf-8");
    assert.equal(after, before, "rejected mutations must leave config.json untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
