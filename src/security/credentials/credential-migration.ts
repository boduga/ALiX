/**
 * P4.3-Se1 — Credential Migration
 *
 * Detects inline credentials (API keys, MCP headers/env) in project and user
 * config files, moves them to the platform credential store, and replaces them
 * with `cred://` references in the config.
 *
 * The migration is:
 * - Idempotent: running it twice produces the same result (no duplicate entries)
 * - Transactionsal: preserves the original config if any step fails
 * - Safe: never prints credential values in output
 * - Recoverable: retains a backup of the original config until success
 *
 * @module
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CredentialStore } from "./credential-store.js";
import {
  isCredentialReference,
  makeCredentialReference,
} from "./credential-reference.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationResult {
  /** Number of credentials successfully migrated. */
  migrated: number;
  /** Number of credentials skipped (already references or no value). */
  skipped: number;
  /** Error messages for credentials that could not be migrated. */
  errors: string[];
  /** Per-file details for reporting. */
  files: MigrationFileResult[];
}

export interface MigrationFileResult {
  path: string;
  migrated: string[];
  skipped: string[];
  errors: string[];
}

export interface MigrationOptions {
  /** When true, report what would be migrated without making changes. */
  dryRun?: boolean;
  /** Override the credential store for testing. */
  store?: CredentialStore;
}

// ---------------------------------------------------------------------------
// Provider → env-var mapping (same as config loader)
// ---------------------------------------------------------------------------

const PROVIDER_ENV_MAP: Record<string, string> = {
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zhipuai: "ZHIPUAI_API_KEY",
  grokai: "GROKAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

// ---------------------------------------------------------------------------
// Known credential field patterns
// ---------------------------------------------------------------------------

/**
 * Known secret-like MCP header/env patterns to detect.
 * These are heuristics — any header/env whose value looks like a secret
 * (long random-looking string) is flagged for migration.
 */
const SECRET_LIKE_PATTERNS = [
  /^sk-/i,         // OpenAI/Anthropic-style keys
  /^key-/i,        // Generic key prefix
  /^[A-Za-z0-9+/]{20,}={0,2}$/,  // Base64-looking (20+ chars)
  /^[A-Za-z0-9_-]{32,}$/,       // Hex/hash-looking (32+ chars)
];

/**
 * Detect whether a value looks like a secret (API key, token, etc.).
 * Heuristic only — false positives are possible, which is why migration
 * reports rather than silently converting.
 */
function looksLikeSecret(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length < 8) return false;
  // Skip values that are already credential references
  if (typeof value === "string" && value.startsWith("cred://")) return false;
  // Skip empty strings
  if (value.trim() === "") return false;
  // Skip well-known non-secret values
  if (value === "localhost" || value === "127.0.0.1") return false;
  return SECRET_LIKE_PATTERNS.some((p) => p.test(value));
}

// ---------------------------------------------------------------------------
// Config file helpers
// ---------------------------------------------------------------------------

interface ConfigFile {
  path: string;
  data: Record<string, unknown>;
}

async function readConfigFile(path: string): Promise<ConfigFile | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    return { path, data };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main migration entry point
// ---------------------------------------------------------------------------

/**
 * Migrate inline credentials from user and project config files to the
 * platform credential store.
 *
 * Scans:
 * - `~/.config/alix/config.json` (user config)
 * - `<cwd>/.alix/config.json` (project config)
 *
 * For each file, detects `apiKeys` entries and secret-like MCP headers/env,
 * moves them to the credential store, and replaces them with `cred://`
 * references in the config file.
 *
 * @param cwd - Working directory (project root)
 * @param homedir - User home directory path
 * @param options - Migration options
 */
export async function migrateCredentials(
  cwd: string,
  homedir: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const dryRun = options.dryRun ?? false;
  const store =
    options.store ?? new CredentialStore();

  const result: MigrationResult = {
    migrated: 0,
    skipped: 0,
    errors: [],
    files: [],
  };

  // Load the store (unless already loaded)
  await store.load();

  // Discover config files
  const userConfigPath = join(homedir, ".config", "alix", "config.json");
  const projectConfigPath = join(cwd, ".alix", "config.json");

  const configFiles: (ConfigFile & { source: "user" | "project" })[] = [];
  const userCfg = await readConfigFile(userConfigPath);
  if (userCfg) configFiles.push({ ...userCfg, source: "user" });
  const projCfg = await readConfigFile(projectConfigPath);
  if (projCfg) configFiles.push({ ...projCfg, source: "project" });

  // Process each config file
  for (const { path, data, source } of configFiles) {
    const fileResult: MigrationFileResult = {
      path,
      migrated: [],
      skipped: [],
      errors: [],
    };

    let modified = false;

    // --- Migrate apiKeys ---
    const apiKeys = (data as any).apiKeys as Record<string, unknown> | undefined;
    if (apiKeys && typeof apiKeys === "object") {
      const newApiKeys: Record<string, string> = {};
      for (const [provider, value] of Object.entries(apiKeys)) {
        if (typeof value !== "string" || value.trim() === "") {
          // Skip empty/null keys — preserve them as-is
          (newApiKeys as any)[provider] = value;
          fileResult.skipped.push(`apiKeys.${provider} (empty value)`);
          result.skipped++;
          continue;
        }

        if (isCredentialReference(value)) {
          // Already a reference — skip
          (newApiKeys as any)[provider] = value;
          fileResult.skipped.push(`apiKeys.${provider} (already a reference)`);
          result.skipped++;
          continue;
        }

        // Make a reference
        const ref = makeCredentialReference(provider, "apiKey");

        if (!dryRun) {
          try {
            // Check if this credential already exists in the store
            if (!store.has(provider, "apiKey")) {
              await store.set(provider, "apiKey", value, {
                source: `${source}-config`,
                migratedFrom: path,
              });
              fileResult.migrated.push(`apiKeys.${provider}`);
              result.migrated++;
            } else {
              fileResult.skipped.push(
                `apiKeys.${provider} (credential already in store)`
              );
              result.skipped++;
            }
            (newApiKeys as any)[provider] = ref;
            modified = true;
          } catch (err) {
            const msg = `apiKeys.${provider}: ${err instanceof Error ? err.message : String(err)}`;
            fileResult.errors.push(msg);
            result.errors.push(msg);
            // Preserve original value on failure
            (newApiKeys as any)[provider] = value;
          }
        } else {
          // Dry run: report what would happen
          if (store.has(provider, "apiKey")) {
            fileResult.skipped.push(
              `apiKeys.${provider} (would skip — credential already in store)`
            );
            result.skipped++;
          } else {
            fileResult.migrated.push(`apiKeys.${provider} (would migrate — dry run)`);
            result.migrated++;
          }
          (newApiKeys as any)[provider] = ref;
          modified = true;
        }
      }

      if (Object.keys(newApiKeys).length > 0) {
        (data as any).apiKeys = newApiKeys;
      }
    }

    // --- Migrate MCP header/env secrets ---
    const mcpServers = (data as any).mcpServers;
    if (Array.isArray(mcpServers)) {
      for (let i = 0; i < mcpServers.length; i++) {
        const server = mcpServers[i] as Record<string, unknown>;

        // Check headers
        if (server.headers && typeof server.headers === "object") {
          const headers = server.headers as Record<string, unknown>;
          const newHeaders: Record<string, string> = {};
          for (const [headerName, headerValue] of Object.entries(headers)) {
            if (looksLikeSecret(headerValue)) {
              const keyLabel = `header:${headerName}`;
              const provider = `mcp.${(server.name as string) || `server${i}`}`;
              const ref = makeCredentialReference(provider, keyLabel);

              if (!dryRun) {
                try {
                  if (!store.has(provider, keyLabel)) {
                    await store.set(provider, keyLabel, headerValue as string, {
                      source: `${source}-config`,
                      mcpServer: server.name as string,
                      migratedFrom: path,
                    });
                    fileResult.migrated.push(`mcpServers[${i}].headers.${headerName}`);
                    result.migrated++;
                  } else {
                    fileResult.skipped.push(
                      `mcpServers[${i}].headers.${headerName} (already in store)`
                    );
                    result.skipped++;
                  }
                  newHeaders[headerName] = ref;
                  modified = true;
                } catch (err) {
                  const msg = `mcpServers[${i}].headers.${headerName}: ${err instanceof Error ? err.message : String(err)}`;
                  fileResult.errors.push(msg);
                  result.errors.push(msg);
                  newHeaders[headerName] = headerValue as string;
                }
              } else {
                fileResult.migrated.push(
                  `mcpServers[${i}].headers.${headerName} (would migrate — dry run)`
                );
                result.migrated++;
                newHeaders[headerName] = ref;
                modified = true;
              }
            } else {
              newHeaders[headerName] = headerValue as string;
            }
          }
          server.headers = newHeaders;
        }

        // Check env
        if (server.env && typeof server.env === "object") {
          const env = server.env as Record<string, unknown>;
          const newEnv: Record<string, string> = {};
          for (const [envName, envValue] of Object.entries(env)) {
            if (looksLikeSecret(envValue)) {
              const keyLabel = `env:${envName}`;
              const provider = `mcp.${(server.name as string) || `server${i}`}`;
              const ref = makeCredentialReference(provider, keyLabel);

              if (!dryRun) {
                try {
                  if (!store.has(provider, keyLabel)) {
                    await store.set(provider, keyLabel, envValue as string, {
                      source: `${source}-config`,
                      mcpServer: server.name as string,
                      migratedFrom: path,
                    });
                    fileResult.migrated.push(`mcpServers[${i}].env.${envName}`);
                    result.migrated++;
                  } else {
                    fileResult.skipped.push(
                      `mcpServers[${i}].env.${envName} (already in store)`
                    );
                    result.skipped++;
                  }
                  newEnv[envName] = ref;
                  modified = true;
                } catch (err) {
                  const msg = `mcpServers[${i}].env.${envName}: ${err instanceof Error ? err.message : String(err)}`;
                  fileResult.errors.push(msg);
                  result.errors.push(msg);
                  newEnv[envName] = envValue as string;
                }
              } else {
                fileResult.migrated.push(
                  `mcpServers[${i}].env.${envName} (would migrate — dry run)`
                );
                result.migrated++;
                newEnv[envName] = ref;
                modified = true;
              }
            } else {
              newEnv[envName] = envValue as string;
            }
          }
          server.env = newEnv;
        }
      }
    }

    // --- Write modified config atomically ---
    if (modified && !dryRun) {
      const backupPath = path + "." + randomUUID() + ".bak";
      try {
        // Create backup
        const originalRaw = await readFile(path, "utf-8");
        await writeFile(backupPath, originalRaw, {
          mode: 0o600,
          flag: "wx",
        });

        // Write new config
        const newJson = JSON.stringify(data, null, 2) + "\n";
        const tmpPath = path + "." + randomUUID() + ".tmp";
        await writeFile(tmpPath, newJson, {
          mode: 0o600,
          flag: "wx",
        });
        await rename(tmpPath, path);

        // Remove backup on success
        await unlink(backupPath);
      } catch (err) {
        // Preserve original — rename backup back if the write failed
        try {
          if (existsSync(backupPath)) {
            await rename(backupPath, path);
          }
        } catch {
          // Last-resort: backup remains on disk for manual recovery
        }
        throw new Error(
          `Failed to write updated config to ${path}: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Backup preserved at ${backupPath}`
        );
      }
    }

    result.files.push(fileResult);
  }

  return result;
}
