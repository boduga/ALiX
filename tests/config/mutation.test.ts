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
    const mutation = await service.set("model.temperature", 0.9);
    assert.equal(mutation.op, "set");
    assert.equal(mutation.path, "model.temperature");
    assert.equal(mutation.value, 0.9);
    assert.equal(mutation.previousValue, 0.5);

    // Verify the config on disk was updated
    const config = await service.read();
    assert.equal(config.model.temperature, 0.9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: set a nested value with auto-created path", async () => {
  const { service, dir } = await setupService();
  try {
    const mutation = await service.set("model.newField", "hello");
    assert.equal(mutation.op, "set");
    assert.equal(mutation.value, "hello");
    assert.equal(mutation.previousValue, undefined);

    const config = await service.read();
    assert.equal((config.model as any).newField, "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: set records provenance", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("model.temperature", 0.7);

    const provenance = await service.getProvenance();
    assert.equal(provenance.length, 1);
    assert.equal(provenance[0].mutations.length, 1);
    assert.equal(provenance[0].mutations[0].path, "model.temperature");
    assert.equal(provenance[0].mutations[0].op, "set");
    assert.equal(provenance[0].mutations[0].value, 0.7);
    assert.equal(provenance[0].mutations[0].previousValue, 0.5);
    assert.equal(provenance[0].version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: provenance is hash-chained", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("model.temperature", 0.7);
    await service.set("model.temperature", 0.9);

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
    await service.set("model.temperature", 0.8);
    await service.delete("model.temperature");

    const provenance = await service.getProvenance();
    const deleteEntry = provenance[1];
    assert.equal(deleteEntry.mutations[0].op, "delete");
    assert.equal(deleteEntry.mutations[0].value, undefined);
    assert.equal(deleteEntry.mutations[0].previousValue, 0.8);
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
    const mutation = await service.delete("model.temperature");
    assert.equal(mutation.op, "delete");
    assert.equal(mutation.path, "model.temperature");
    assert.equal(mutation.previousValue, 0.5);

    const config = await service.read();
    assert.equal(config.model.temperature, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: delete non-existent path throws PATH_NOT_FOUND", async () => {
  const { service, dir } = await setupService();
  try {
    await assert.rejects(
      () => service.delete("model.nonexistent"),
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
    const mutation = await service.set("model.name", "gpt-4o");
    assert.equal(mutation.value, "gpt-4o");
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
    await service.set("model.temperature", 0.3);

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
    await service.set("model.temperature", 0.3);

    const configPath = join(dir, ".alix", "config", "config.json");
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.model.temperature, 0.3);
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
    config.model.temperature = 0.99;
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

    // Now try to write — should detect the concurrent change
    await assert.rejects(
      () => service.set("model.temperature", 0.5),
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
    // Setting model.name to empty string would be invalid
    await assert.rejects(
      () => service.set("model.name", ""),
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
      await service.set("model.temperature", 0.1 + i * 0.01);
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
      await service.set("model.temperature", 0.1 + i * 0.01);
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
    await service.set("model.temperature", 0.7);
    await service.set("model.name", "new-model");

    const tempProvenance = await service.getProvenance("model.temperature");
    assert.equal(tempProvenance.length, 1);
    assert.equal(tempProvenance[0].mutations[0].path, "model.temperature");

    const nameProvenance = await service.getProvenance("model.name");
    assert.equal(nameProvenance.length, 1);
    assert.equal(nameProvenance[0].mutations[0].path, "model.name");
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

    await service.set("model.temperature", 0.7);
    assert.equal(await service.getVersion(), 1);

    await service.set("model.temperature", 0.9);
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
      await service.delete("model.nonexistent");
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
    await service.set("model.temperature", 0.7, { updatedBy: "daemon" });

    const provenance = await service.getProvenance();
    assert.equal(provenance[0].updatedBy, "daemon");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigMutationService: default updatedBy is 'cli'", async () => {
  const { service, dir } = await setupService();
  try {
    await service.set("model.temperature", 0.7);

    const provenance = await service.getProvenance();
    assert.equal(provenance[0].updatedBy, "cli");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
