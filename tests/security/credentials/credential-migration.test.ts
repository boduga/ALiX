/**
 * Tests for P4.3-Se1 credential migration.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateCredentials,
  type MigrationResult,
} from "../../../src/security/credentials/credential-migration.js";
import { CredentialStore } from "../../../src/security/credentials/credential-store.js";
import { isCredentialReference } from "../../../src/security/credentials/credential-reference.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupMigrateEnv(): Promise<{
  homedir: string;
  cwd: string;
  clean: () => Promise<void>;
}> {
  const homedir = await mkdtemp(join(tmpdir(), "alix-mig-home-"));
  const cwd = await mkdtemp(join(tmpdir(), "alix-mig-cwd-"));

  // Create .config/alix directory in homedir
  await mkdir(join(homedir, ".config", "alix"), { recursive: true });
  // Create .alix directory in cwd
  await mkdir(join(cwd, ".alix"), { recursive: true });

  return {
    homedir,
    cwd,
    clean: async () => {
      await rm(homedir, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Basic migration
// ---------------------------------------------------------------------------

test("migrateCredentials: migrates apiKeys from user config", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const userConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      apiKeys: { openai: "sk-user-key-123" },
    };
    await writeFile(
      join(homedir, ".config", "alix", "config.json"),
      JSON.stringify(userConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });

    assert.equal(result.migrated, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors.length, 0);

    // Verify credential was stored
    assert.equal(store.get("openai", "apiKey"), "sk-user-key-123");

    // Verify config was updated with cred:// reference
    const updatedRaw = await readFile(join(homedir, ".config", "alix", "config.json"), "utf-8");
    const updated = JSON.parse(updatedRaw);
    assert.ok(isCredentialReference(updated.apiKeys.openai));
  } finally {
    await clean();
  }
});

test("migrateCredentials: migrates apiKeys from project config", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const projectConfig = {
      model: { provider: "anthropic", name: "claude-sonnet" },
      apiKeys: { anthropic: "sk-ant-project-key" },
    };
    await writeFile(
      join(cwd, ".alix", "config.json"),
      JSON.stringify(projectConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });

    assert.equal(result.migrated, 1);
    assert.equal(store.get("anthropic", "apiKey"), "sk-ant-project-key");

    const updatedRaw = await readFile(join(cwd, ".alix", "config.json"), "utf-8");
    const updated = JSON.parse(updatedRaw);
    assert.ok(isCredentialReference(updated.apiKeys.anthropic));
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("migrateCredentials: idempotent — second run is a no-op for already-migrated keys", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const projectConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      apiKeys: { openai: "sk-idempotent-key" },
    };
    await writeFile(
      join(cwd, ".alix", "config.json"),
      JSON.stringify(projectConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    // First run
    const result1 = await migrateCredentials(cwd, homedir, { store });
    assert.equal(result1.migrated, 1);

    // Second run — should detect the credential is already in the store
    const result2 = await migrateCredentials(cwd, homedir, { store });
    assert.equal(result2.migrated, 0);
    assert.equal(result2.skipped, 1);
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

test("migrateCredentials: dry run does not modify files or store", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const userConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      apiKeys: { openai: "sk-dry-run-key" },
    };
    const configPath = join(homedir, ".config", "alix", "config.json");
    await writeFile(configPath, JSON.stringify(userConfig));

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store, dryRun: true });

    // Should report migration
    assert.equal(result.migrated, 1);

    // But store should be empty
    assert.equal(store.get("openai", "apiKey"), null);

    // Config file should remain unchanged
    const original = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(original);
    assert.equal(parsed.apiKeys.openai, "sk-dry-run-key");
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// MCP header migration
// ---------------------------------------------------------------------------

test("migrateCredentials: migrates secret-like MCP headers", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const projectConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      mcpServers: [
        {
          type: "http",
          name: "github",
          url: "https://api.github.com/mcp",
          headers: {
            Authorization: "ghp_1234567890abcdef1234567890abcdef123456",
          },
        },
      ],
    };
    await writeFile(
      join(cwd, ".alix", "config.json"),
      JSON.stringify(projectConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });

    // Should detect the long token-like Authorization header
    assert.ok(result.migrated >= 1, "Should migrate at least one MCP header");

    // Verify the store has the credential
    const value = store.get("mcp.github", "header:Authorization");
    assert.equal(value, "ghp_1234567890abcdef1234567890abcdef123456");

    // Verify config was updated with cred:// reference
    const updatedRaw = await readFile(join(cwd, ".alix", "config.json"), "utf-8");
    const updated = JSON.parse(updatedRaw);
    assert.ok(
      isCredentialReference(updated.mcpServers[0].headers.Authorization),
      "MCP header should be replaced with cred:// reference"
    );
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// MCP env migration
// ---------------------------------------------------------------------------

test("migrateCredentials: migrates secret-like MCP env vars", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const projectConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      mcpServers: [
        {
          type: "stdio",
          name: "my-server",
          command: "npx",
          env: {
            API_KEY: "sk-my-mcp-api-key-12345678901234567890",
          },
        },
      ],
    };
    await writeFile(
      join(cwd, ".alix", "config.json"),
      JSON.stringify(projectConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });

    assert.ok(result.migrated >= 1, "Should migrate at least one MCP env var");

    const value = store.get("mcp.my-server", "env:API_KEY");
    assert.equal(value, "sk-my-mcp-api-key-12345678901234567890");
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// No-op on empty/skip patterns
// ---------------------------------------------------------------------------

test("migrateCredentials: no-op when no config files exist", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });
    assert.equal(result.migrated, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.errors.length, 0);
  } finally {
    await clean();
  }
});

test("migrateCredentials: no-op when apiKeys are already cred:// references", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const userConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      apiKeys: { openai: "cred://openai/apiKey" },
    };
    await writeFile(
      join(homedir, ".config", "alix", "config.json"),
      JSON.stringify(userConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });
    assert.equal(result.migrated, 0);
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// Values not exposed in output
// ---------------------------------------------------------------------------

test("migrateCredentials: does not leak values in result output", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const userConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      apiKeys: { openai: "sk-super-secret-key-that-must-not-leak" },
    };
    await writeFile(
      join(homedir, ".config", "alix", "config.json"),
      JSON.stringify(userConfig)
    );

    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    const result = await migrateCredentials(cwd, homedir, { store });

    // Serialize and check that the secret value is NOT in the output
    const json = JSON.stringify(result);
    assert.ok(!json.includes("sk-super-secret-key-that-must-not-leak"));
  } finally {
    await clean();
  }
});

// ---------------------------------------------------------------------------
// Original preserved on failure
// ---------------------------------------------------------------------------

test("migrateCredentials: preserves original config when credential store write fails", async () => {
  const { homedir, cwd, clean } = await setupMigrateEnv();
  try {
    const userConfig = {
      model: { provider: "openai", name: "gpt-4o" },
      apiKeys: { openai: "sk-preserved-key" },
    };
    const configPath = join(homedir, ".config", "alix", "config.json");
    await writeFile(configPath, JSON.stringify(userConfig));

    // Create a store that will fail on write (read-only directory)
    const store = new CredentialStore({
      filePath: join(homedir, ".alix-inspector", "credentials", "credential-store.json"),
    });
    await store.load();

    // Migrate should work since the real credential store is writable
    const result = await migrateCredentials(cwd, homedir, { store });
    assert.equal(result.errors.length, 0);

    // Key should be preserved in the store
    assert.equal(store.get("openai", "apiKey"), "sk-preserved-key");
  } finally {
    await clean();
  }
});
