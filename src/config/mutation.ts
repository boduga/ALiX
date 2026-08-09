/**
 * P4.3-Se2 — Central Config Mutation and Provenance
 *
 * Provides the single, attributable mutation path for all production config
 * changes. Every write goes through this service, producing a provenance
 * record that links each mutation to its actor and the resulting config hash.
 *
 * Properties:
 * - Read-modify-write with atomic file replacement
 * - Dot-path resolution for nested config values
 * - SHA-256 hashing of canonical config bytes
 * - Bounded JSONL provenance log (last 100 entries)
 * - Schema validation before and after mutation
 * - Rejects secret/credential values in project config
 * - Fail-closed: any validation or I/O error prevents the write
 *
 * @module
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { AlixConfig, PersistedAlixConfig } from "./schema.js";
import { validateConfig } from "./validator.js";
import { withoutDerivedModelProjections } from "./persistence.js";
import { isCredentialReference } from "../security/credentials/credential-reference.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of provenance entries before eviction. */
const MAX_PROVENANCE_ENTRIES = 100;

/** Filename for the provenance log within the config directory. */
const PROVENANCE_FILENAME = "provenance.jsonl";

/** Config filename within the config directory. */
const CONFIG_FILENAME = "config.json";

// ---------------------------------------------------------------------------
// Error codes (stable, not exception messages)
// ---------------------------------------------------------------------------

export const MUTATION_ERROR_CODES = {
  /** Path does not exist in config (for delete operations). */
  PATH_NOT_FOUND: "CONFIG_PATH_NOT_FOUND",
  /** The resulting config after mutation would be invalid. */
  INVALID_RESULT: "CONFIG_INVALID_RESULT",
  /** Mutation would write a secret/credential value to project config. */
  SECRET_IN_PROJECT: "CONFIG_SECRET_IN_PROJECT",
  /** The config file is corrupt (invalid JSON). */
  CORRUPT_CONFIG: "CONFIG_CORRUPT",
  /** Atomic write failed (I/O error). */
  WRITE_FAILED: "CONFIG_WRITE_FAILED",
  /** A concurrent mutation was detected (stale read). */
  CONCURRENT_MUTATION: "CONFIG_CONCURRENT_MUTATION",
  /** The config directory does not exist and could not be created. */
  NO_CONFIG_DIR: "CONFIG_NO_CONFIG_DIR",
  /** Mutation targets a loader-derived projection (`model`/`subagents`) that must never be persisted. */
  MODEL_PROJECTION_REJECTED: "CONFIG_MODEL_PROJECTION_REJECTED",
} as const;

export type MutationErrorCode = (typeof MUTATION_ERROR_CODES)[keyof typeof MUTATION_ERROR_CODES];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigMutation {
  /** JSON dot-path (e.g. "model.provider"). */
  path: string;
  /** The operation performed. */
  op: "set" | "delete";
  /** The new value (set only). */
  value?: unknown;
  /** The value before the mutation (undefined for newly created paths). */
  previousValue?: unknown;
}

export interface ConfigProvenance {
  /** Monotonic version number (provenance entry count). */
  version: number;
  /** ISO 8601 timestamp of the mutation. */
  updatedAt: string;
  /** Actor that performed the mutation. */
  updatedBy: "cli" | "daemon" | "migration";
  /** The mutations applied in this entry. */
  mutations: ConfigMutation[];
  /** SHA-256 hash of the config BEFORE this mutation. */
  prevConfigHash: string;
  /** SHA-256 hash of the config AFTER this mutation. */
  configHash: string;
}

export interface MutationOptions {
  /** Actor identifier (defaults to "cli"). */
  updatedBy?: "cli" | "daemon" | "migration";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

/**
 * Compute a deterministic SHA-256 hash of a config object.
 * Uses sorted-key JSON serialization for reproducibility.
 */
export function computeConfigHash(config: AlixConfig | PersistedAlixConfig): string {
  const canonical = JSON.stringify(config, sortedKeysReplacer, 2);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * JSON.stringify replacer that sorts object keys for deterministic output.
 */
function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      sorted[k] = obj[k];
    }
    return sorted;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Dot-path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path within a nested object.
 *
 * Simple dot-path notation: "model.provider" resolves to obj.model.provider.
 * Returns the parent object, the final key, and the current value (or undefined).
 *
 * @throws If an intermediate segment is not an object.
 */
function resolveDotPath(
  obj: Record<string, unknown>,
  path: string,
): { parent: Record<string, unknown>; key: string; value: unknown } {
  const segments = path.split(".");
  if (segments.length === 0 || segments[0] === "") {
    throw Object.assign(new Error(`Invalid config path: "${path}"`), {
      code: MUTATION_ERROR_CODES.PATH_NOT_FOUND,
    });
  }

  // Walk to the parent
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current[seg] === undefined) {
      // Auto-create intermediate objects for set operations
      current[seg] = {};
    }
    const next = current[seg];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw Object.assign(
        new Error(`Cannot traverse through non-object at "${segments.slice(0, i + 1).join(".")}"`),
        { code: MUTATION_ERROR_CODES.PATH_NOT_FOUND },
      );
    }
    current = next as Record<string, unknown>;
  }

  const key = segments[segments.length - 1];
  const value = current[key];
  return { parent: current, key, value };
}

// ---------------------------------------------------------------------------
// Model-projection guard
// ---------------------------------------------------------------------------

/**
 * Model selection must only be persisted under the canonical `models` object.
 * `model` and the six `subagents.<tier>` keys are loader-derived compatibility
 * projections and must never be independently written (single-source
 * invariant) — reject any mutation rooted at them, directing the user to the
 * canonical `alix models` commands.
 *
 * `subagents.enabled`/`roles` are NOT projections: they are behavior config
 * (§2.8.1/§2.8.4) and remain mutable. Every other `subagents.*` key is a model
 * tier projection (canonical tier, legacy profile vocabulary, or any other
 * string `normalizeModelConfig` would drop) and is rejected. Testing a literal
 * behavior-key allowlist — rather than enumerating tier keys — needs no tier
 * vocabulary and catches unknown keys like `subagents.default`.
 */
const SUBAGENT_BEHAVIOR_KEYS = new Set(["enabled", "roles"]);

function assertMutableModelPath(path: string): void {
  const [root, second] = path.split(".");
  if (root === "model") {
    throw projectionRejected(path);
  }
  // `subagents` root (whole-object set / delete) and any non-behavior key
  // under it are model-selection projections.
  if (
    root === "subagents" &&
    (second === undefined || !SUBAGENT_BEHAVIOR_KEYS.has(second))
  ) {
    throw projectionRejected(path);
  }
}

function projectionRejected(path: string): Error {
  return Object.assign(
    new Error(
      `Cannot modify "${path}": model selection is managed by the canonical 'models' object. ` +
      `Use 'alix models set-default' or 'alix models set-tier' instead.`,
    ),
    { code: MUTATION_ERROR_CODES.MODEL_PROJECTION_REJECTED },
  );
}

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

/**
 * Heuristic to detect if a value looks like a secret that should not be
 * stored in project config. Catches:
 * - `cred://` references (always reject in project config)
 * - Long random-looking strings (likely API keys)
 * - Strings containing "sk-", "key-", "token" patterns
 */
/**
 * Heuristic to detect if a value looks like a secret that should not be
 * stored in project config. Catches:
 * - `cred://` references (always reject in project config)
 * - Long random-looking strings (likely API keys)
 * - Strings containing "sk-", "key-", "token" patterns
 * - Objects/arrays containing secret-looking values (recursive)
 */
function looksLikeSecret(value: unknown): boolean {
  if (typeof value === "string") {
    if ((value as string).startsWith("cred://")) return true;
    if (value.length > 30 && /^[A-Za-z0-9_\-+.=/]{30,}$/.test(value)) return true;
    if (/^(sk-|key-|pk-|rk-)/.test(value) && value.length > 20) return true;
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => looksLikeSecret(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => looksLikeSecret(v));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Provenance log management
// ---------------------------------------------------------------------------

async function readProvenanceLog(provenancePath: string): Promise<ConfigProvenance[]> {
  if (!existsSync(provenancePath)) return [];

  const raw = await readFile(provenancePath, "utf-8");
  const entries: ConfigProvenance[] = [];
  for (const line of raw.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as ConfigProvenance);
    } catch {
      // Skip corrupt lines
    }
  }
  return entries;
}

async function writeProvenanceLog(
  provenancePath: string,
  entries: ConfigProvenance[],
): Promise<void> {
  // Bounded: keep only last MAX_PROVENANCE_ENTRIES
  const bounded = entries.slice(-MAX_PROVENANCE_ENTRIES);

  const dir = dirname(provenancePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const content = bounded.map((e) => JSON.stringify(e)).join("\n") + "\n";

  // Atomic write via temp file
  const tmpPath = provenancePath + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmpPath, content, { mode: 0o600, flag: "wx" });
    await rename(tmpPath, provenancePath);
  } catch (err) {
    try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ConfigMutationService
// ---------------------------------------------------------------------------

export class ConfigMutationService {
  private readonly configDir: string;
  private readonly configPath: string;
  private readonly provenancePath: string;
  private lastReadHash: string | null = null;

  constructor(configDir: string) {
    this.configDir = configDir;
    this.configPath = join(configDir, CONFIG_FILENAME);
    this.provenancePath = join(configDir, PROVENANCE_FILENAME);
  }

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  /**
   * Read the current config from disk.
   *
   * Stores the hash of the read bytes for concurrency detection on the
   * next write.
   */
  async read(): Promise<AlixConfig> {
    if (!existsSync(this.configPath)) {
      throw Object.assign(
        new Error(`Config file not found at ${this.configPath}`),
        { code: MUTATION_ERROR_CODES.NO_CONFIG_DIR },
      );
    }

    let raw: string;
    try {
      raw = await readFile(this.configPath, "utf-8");
    } catch (err) {
      throw Object.assign(
        new Error(`Failed to read config: ${err instanceof Error ? err.message : String(err)}`),
        { code: MUTATION_ERROR_CODES.CORRUPT_CONFIG },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Object.assign(
        new Error(`Config file at ${this.configPath} is corrupt (invalid JSON).`),
        { code: MUTATION_ERROR_CODES.CORRUPT_CONFIG },
      );
    }

    const config = parsed as AlixConfig;
    this.lastReadHash = computeConfigHash(config);
    return config;
  }

  // -----------------------------------------------------------------------
  // Write (internal, atomic)
  // -----------------------------------------------------------------------

  /**
  /**
   * Strip projections, write atomically, and return the resulting config hash.
   * Crossing the shared persistence boundary (`withoutDerivedModelProjections`)
   * keeps the canonical single-source invariant: any model/subagent-tier
   * projections in the mutated config are stripped before reaching disk, while
   * behavior `enabled`/`roles` survive. §4.1/Task 11.
   */
  private async writePersisted(mutated: AlixConfig): Promise<string> {
    const persisted = withoutDerivedModelProjections(mutated);
    await this.atomicWrite(persisted);
    return computeConfigHash(persisted);
  }

  /**
   * Atomically write config to disk using temp-file + rename.
   * Accepts a `PersistedAlixConfig` (already stripped of model/subagent-tier
   * projections by `withoutDerivedModelProjections`) or a full `AlixConfig`.
   */
  private async atomicWrite(config: AlixConfig | PersistedAlixConfig): Promise<void> {
    const dir = dirname(this.configPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });

    const json = JSON.stringify(config, sortedKeysReplacer, 2) + "\n";
    const tmpPath = this.configPath + "." + randomUUID() + ".tmp";

    try {
      await writeFile(tmpPath, json, { mode: 0o600, flag: "wx" });
      await rename(tmpPath, this.configPath);
    } catch (err) {
      try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch { /* ignore */ }
      throw Object.assign(
        new Error(`Atomic write failed: ${err instanceof Error ? err.message : String(err)}`),
        { code: MUTATION_ERROR_CODES.WRITE_FAILED },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Concurrency guard
  // -----------------------------------------------------------------------

  /**
   * Check that the config on disk hasn't changed since the last read.
   * Prevents lost-update races from concurrent mutation calls.
   *
   * @param expectedHash - Optional hash to compare against (defaults to lastReadHash).
   *   When provided, the guard checks against this hash rather than the internal state,
   *   allowing set/delete to snapshot the hash before their internal re-read.
   */
  private async checkConcurrency(expectedHash?: string): Promise<void> {
    if (!existsSync(this.configPath)) return; // first write
    const raw = await readFile(this.configPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // corrupt, will be overwritten
    }
    const currentHash = computeConfigHash(parsed as AlixConfig);
    const compareHash = expectedHash ?? this.lastReadHash;
    if (compareHash !== null && currentHash !== compareHash) {
      throw Object.assign(
        new Error("Config was modified by another process since last read. Re-read and retry."),
        { code: MUTATION_ERROR_CODES.CONCURRENT_MUTATION },
      );
    }
  }

  // -----------------------------------------------------------------------
  // Set
  // -----------------------------------------------------------------------

  /**
   * Set a config value at the given dot-path.
   *
   * Reads the current config, validates the mutation, applies it, validates
   * the result, writes atomically, and records provenance.
   *
   * @throws With a stable error code on failure.
   */
  async set(
    path: string,
    value: unknown,
    opts: MutationOptions = {},
  ): Promise<ConfigMutation> {
    const updatedBy = opts.updatedBy ?? "cli";
    assertMutableModelPath(path);
    // Save the hash the caller expects (before our internal read resets it)
    const expectedHash = this.lastReadHash;
    const config = await this.read();
    const prevHash = expectedHash ?? computeConfigHash(config);

    // Resolve path and get previous value
    const { parent, key } = resolveDotPath(config as unknown as Record<string, unknown>, path);
    const previousValue = parent[key];

    // Reject secret values in project config
    if (looksLikeSecret(value)) {
      throw Object.assign(
        new Error(
          `Refusing to write secret/credential value to project config at "${path}". ` +
          `Use a cred:// reference or store the credential with 'alix credential set'.`,
        ),
        { code: MUTATION_ERROR_CODES.SECRET_IN_PROJECT },
      );
    }

    // Apply mutation to an immutable shallow copy
    const mutated = JSON.parse(JSON.stringify(config)) as AlixConfig;
    const mutParent = resolveDotPath(mutated as unknown as Record<string, unknown>, path).parent;
    mutParent[key] = value;

    // Validate resulting config
    const validation = validateConfig(mutated);
    const errors = validation.issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      throw Object.assign(
        new Error(
          `Config mutation would produce invalid config: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        ),
        { code: MUTATION_ERROR_CODES.INVALID_RESULT },
      );
    }

    // Guard against concurrent writes (check against the caller's expected hash)
    await this.checkConcurrency(expectedHash ?? undefined);

    // Write atomically, crossing the shared persistence boundary.
    const newHash = await this.writePersisted(mutated);
    const mutation: ConfigMutation = {
      path,
      op: "set",
      value,
      previousValue,
    };

    await this.appendProvenance({
      updatedAt: now(),
      updatedBy,
      mutations: [mutation],
      prevConfigHash: prevHash,
      configHash: newHash,
    });

    this.lastReadHash = newHash;
    return mutation;
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  /**
   * Delete a config value at the given dot-path.
   *
   * @throws With a stable error code on failure.
   */
  async delete(
    path: string,
    opts: MutationOptions = {},
  ): Promise<ConfigMutation> {
    const updatedBy = opts.updatedBy ?? "cli";
    assertMutableModelPath(path);
    // Save the hash the caller expects (before our internal read resets it)
    const expectedHash = this.lastReadHash;
    const config = await this.read();
    const prevHash = expectedHash ?? computeConfigHash(config);

    // Resolve path
    const { parent, key, value: previousValue } = resolveDotPath(
      config as unknown as Record<string, unknown>,
      path,
    );

    if (previousValue === undefined && !(key in parent)) {
      throw Object.assign(
        new Error(`Config path "${path}" does not exist.`),
        { code: MUTATION_ERROR_CODES.PATH_NOT_FOUND },
      );
    }

    // Apply mutation to a copy
    const mutated = JSON.parse(JSON.stringify(config)) as AlixConfig;
    const mutParent = resolveDotPath(mutated as unknown as Record<string, unknown>, path).parent;
    delete mutParent[key];

    // Validate resulting config
    const validation = validateConfig(mutated);
    const errors = validation.issues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      throw Object.assign(
        new Error(
          `Config mutation would produce invalid config: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        ),
        { code: MUTATION_ERROR_CODES.INVALID_RESULT },
      );
    }

    // Guard against concurrent writes (check against the caller's expected hash)
    await this.checkConcurrency(expectedHash ?? undefined);

    // Write atomically, crossing the shared persistence boundary.
    const newHash = await this.writePersisted(mutated);
    const mutation: ConfigMutation = {
      path,
      op: "delete",
      previousValue,
    };

    await this.appendProvenance({
      updatedAt: now(),
      updatedBy,
      mutations: [mutation],
      prevConfigHash: prevHash,
      configHash: newHash,
    });

    this.lastReadHash = newHash;
    return mutation;
  }

  // -----------------------------------------------------------------------
  // Get value at path
  // -----------------------------------------------------------------------

  /**
   * Read a value from a config object at the given dot-path.
   * Returns undefined if the path does not exist.
   */
  getValue(config: AlixConfig, path: string): unknown {
    try {
      const { value } = resolveDotPath(config as unknown as Record<string, unknown>, path);
      return value;
    } catch {
      return undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Provenance
  // -----------------------------------------------------------------------

  /**
   * Get the provenance log, optionally filtered by path.
   */
  async getProvenance(filterPath?: string): Promise<ConfigProvenance[]> {
    const entries = await readProvenanceLog(this.provenancePath);
    if (!filterPath) return entries;

    return entries.filter((entry) =>
      entry.mutations.some((m) => m.path === filterPath || m.path.startsWith(filterPath + ".")),
    );
  }

  /**
   * Get the current provenance version (entry count).
   */
  async getVersion(): Promise<number> {
    const entries = await readProvenanceLog(this.provenancePath);
    return entries.length;
  }

  /**
   * Append a provenance entry to the JSONL log.
   */
  private async appendProvenance(entry: Omit<ConfigProvenance, "version">): Promise<void> {
    const entries = await readProvenanceLog(this.provenancePath);
    const version = entries.length + 1;

    const full: ConfigProvenance = { ...entry, version };
    entries.push(full);

    await writeProvenanceLog(this.provenancePath, entries);
  }

  // -----------------------------------------------------------------------
  // Paths
  // -----------------------------------------------------------------------

  /** Return the path to the config file. */
  get configFilePath(): string {
    return this.configPath;
  }

  /** Return the path to the provenance log. */
  get provenanceFilePath(): string {
    return this.provenancePath;
  }
}
