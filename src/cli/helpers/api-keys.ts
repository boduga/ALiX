/**
 * API-key resolution shared by all CLI commands that touch a provider's key.
 *
 * Resolution order (spec §7):
 *   1. Environment variable -> process.env[<provider.env>]
 *   2. User config         -> ~/.config/alix/config.json `apiKeys[providerId]`
 *   3. Ollama              -> empty string ("") - local, no key needed
 *   4. Otherwise           -> undefined
 *
 * Never throws. Missing files / malformed JSON / absent providers all resolve
 * safely to "no key found" without surfacing I/O errors to callers.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { PROVIDERS } from "../../providers/catalog.js";
import { isCredentialReference, parseCredentialReference } from "../../security/credentials/credential-reference.js";
import type { CredentialStore } from "../../security/credentials/credential-store.js";

// Test seam - override the user-config path without touching real filesystem.
let userConfigPathOverride: string | undefined;

export function _setUserConfigPathOverride(path: string | undefined): void {
  userConfigPathOverride = path;
}

function resolveUserConfigPath(): string {
  return userConfigPathOverride ?? join(homedir(), ".config", "alix", "config.json");
}

/**
 * Read the `apiKeys[providerId]` value from the user config.
 * Returns `null` when the file is missing, malformed, or the entry is
 * non-string / empty.
 */
export async function getSavedApiKey(providerId: string): Promise<string | null> {
  const path = resolveUserConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { apiKeys?: Record<string, unknown> };
    const value = parsed.apiKeys?.[providerId];
    if (typeof value !== "string" || value.length === 0) return null;
    // A `cred://<provider>/<keyLabel>` reference must be resolved through the
    // credential store before the key is usable. Returning the literal
    // reference string (as before) made live model lookups fail with 401.
    if (isCredentialReference(value)) {
      return resolveApiKeyReference(value);
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Resolve a `cred://<provider>/<keyLabel>` reference through the credential
 * store. Returns the resolved secret, or `null` when the store is unavailable
 * or the credential is missing (callers treat `null` as "no key", so this
 * fails soft — it never throws).
 */
export async function resolveApiKeyReference(ref: string): Promise<string | null> {
  const parsed = parseCredentialReference(ref);
  if (!parsed) return null;
  try {
    const store = await loadCredentialStore();
    return store.get(parsed.provider, parsed.keyLabel);
  } catch {
    return null;
  }
}

/** Lazily-loaded credential store (same construction the loader uses). */
let _credentialStore: CredentialStore | undefined;
async function loadCredentialStore(): Promise<CredentialStore> {
  if (_credentialStore) return _credentialStore;
  const { chooseBackend, loadCredentialStoreWithKeychainFallback } =
    await import("../../security/credentials/backend-selection.js");
  const backend = await chooseBackend();
  _credentialStore = await loadCredentialStoreWithKeychainFallback(
    backend,
    () => { /* silent — key resolution should not surface store warnings */ },
  );
  return _credentialStore;
}

/**
 * Write `apiKeys[providerId] = key` to the user config, creating the
 * directory + file as needed and preserving any other keys / fields.
 */
export async function setApiKey(providerId: string, key: string): Promise<void> {
  const userConfigPath = resolveUserConfigPath();
  const userConfigDir = dirname(userConfigPath);
  await mkdir(userConfigDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(userConfigPath, "utf8")) as Record<string, unknown>;
  } catch {
    /* no config yet */
  }

  const apiKeys = (existing.apiKeys ?? {}) as Record<string, string>;
  apiKeys[providerId] = key;
  const updated = { ...existing, apiKeys };
  await writeFile(userConfigPath, JSON.stringify(updated, null, 2) + "\n");
}

/**
 * Remove `apiKeys[providerId]` from the user config entirely (no-op when it is
 * not present). Unlike `setApiKey(provider, "")`, this does not leave a stale
 * empty-string entry behind.
 */
export async function deleteApiKey(providerId: string): Promise<void> {
  const userConfigPath = resolveUserConfigPath();
  const userConfigDir = dirname(userConfigPath);
  await mkdir(userConfigDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(userConfigPath, "utf8")) as Record<string, unknown>;
  } catch {
    /* no config yet */
  }

  const apiKeys = (existing.apiKeys ?? {}) as Record<string, unknown>;
  if (!(providerId in apiKeys)) return;
  delete apiKeys[providerId];
  const updated = { ...existing, apiKeys };
  await writeFile(userConfigPath, JSON.stringify(updated, null, 2) + "\n");
}

/**
 * Resolve an API key with the spec's full precedence chain.
 * Returns `undefined` only when no key is recoverable for non-ollama
 * providers or when the provider id is unknown.
 */
export async function getApiKey(providerId: string): Promise<string | undefined> {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return undefined;

  // 1. Environment variable - always wins.
  if (process.env[provider.env]) return process.env[provider.env];

  // 2. User config.
  const saved = await getSavedApiKey(providerId);
  if (saved) return saved;

  // 3. Ollama - empty string (spec §7: "Empty string for Ollama").
  if (providerId === "ollama") return "";

  // 4. None.
  return undefined;
}