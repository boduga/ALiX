/**
 * backend-selection.ts — the single decision point for which credential
 * backend is active (issue #350, Phase 2).
 *
 * `chooseBackend` is called from `createCredentialStore` (cli/commands/
 * security.ts) and `loadConfig` (config/loader.ts) — both route through the
 * same rules. The selection rules satisfy both the impact-analysis
 * constraint (no silent-on-load migration) and the Phase-2 goal (prefer
 * keychain when available):
 *
 *   1. A persisted selector file (`.backend` in the credentials dir) wins.
 *      `alix credential migrate --to keychain|plain-file` writes it.
 *   2. Selector unset + an existing plain-file store → plain-file. This is
 *      the no-silent-migration rule: an existing user's credentials do NOT
 *      move to the keychain until they explicitly run `migrate --to`.
 *   3. Selector unset + no existing store (fresh install) + keychain probe
 *      succeeds → keychain. A brand-new install gets the stronger backend
 *      with zero migration risk (empty source store).
 *   4. Otherwise → plain-file (keychain unavailable, or fresh install with
 *      no keychain).
 *
 * The probe uses a throwaway keychain entry, so a missing Secret Service /
 * keychain daemon degrades to plain-file without blocking config load.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getUserStatePaths } from "../platform/user-state-paths.js";
import { CredentialStore } from "./credential-store.js";
import {
  KeychainProvider,
  resolveKeychainEntryFactory,
  probeKeychainWith,
  type KeychainEntryLike,
} from "./keychain-provider.js";

export type CredentialBackend = "keychain" | "plain-file";

/** Sentinel for "no selector file written yet". */
type StoredBackend = CredentialBackend | "auto";

/** The selector file name within the credentials dir. */
const BACKEND_SELECTOR = ".backend";

/** The plain-file store filename (to detect an existing store). */
const PLAIN_STORE_FILENAME = "credential-store.json";

/** Resolve the credentials directory (lazy, shared by both backends). */
export function credentialsDir(): string {
  const paths = getUserStatePaths();
  return join(paths.dataDir, "credentials");
}

function selectorPath(): string {
  return join(credentialsDir(), BACKEND_SELECTOR);
}

export function plainStorePath(): string {
  return join(credentialsDir(), PLAIN_STORE_FILENAME);
}

/**
 * Scrub the plain-file store after a successful migration to a stronger
 * backend. The values are the security concern — the file is overwritten
 * with an empty store so no plain-text secrets remain on disk. The file is
 * kept (not deleted) so the "existing plain-file store" detection in
 * `chooseBackend` still sees a store and never silently migrates a fresh
 * install into a phantom layout.
 */
export async function scrubPlainFileStore(): Promise<void> {
  const path = plainStorePath();
  if (!existsSync(path)) return;
  await writeFile(path, JSON.stringify({ version: 1, credentials: [] }, null, 2) + "\n", {
    mode: 0o600,
  });
}

/** Read the persisted backend selector; "auto" when unset. */
export async function readStoredBackend(): Promise<StoredBackend> {
  try {
    const raw = await readFile(selectorPath(), "utf-8");
    const trimmed = raw.trim();
    if (trimmed === "keychain" || trimmed === "plain-file") return trimmed;
    return "auto";
  } catch {
    return "auto";
  }
}

/** Persist the active backend (called by `alix credential migrate --to`). */
export async function writeStoredBackend(backend: CredentialBackend): Promise<void> {
  const path = selectorPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, backend + "\n", { mode: 0o600 });
}

/**
 * Decide the active backend (see module doc for the rules). Async because
 * the fresh-install path probes the keychain.
 */
export async function chooseBackend(): Promise<CredentialBackend> {
  const stored = await readStoredBackend();
  if (stored !== "auto") return stored;

  // Selector unset: no silent migration of an existing plain-file store.
  if (existsSync(plainStorePath())) return "plain-file";

  // Fresh install → try keychain (empty source, zero migration risk).
  try {
    await probeKeychain();
    return "keychain";
  } catch {
    return "plain-file";
  }
}

/**
 * Probe whether the OS keychain is usable, using a throwaway entry. The
 * probe is the laziness boundary: a missing/broken binding or a missing
 * Secret Service daemon throws, and callers fall back to plain-file. This
 * is the ONLY place the keychain probe lives — backend selection and the
 * keychain provider's load() both route through here.
 */
export async function probeKeychain(): Promise<void> {
  const factory = await resolveKeychainEntryFactory();
  probeKeychainWith(factory);
}

/**
 * Build a CredentialStore for the given backend. The SINGLE construction
 * site — `createCredentialStore` (cli), `migrateBetweenBackends` (cli),
 * and `loadConfig` (loader) all route through here, so a future
 * EncryptedFileProvider (Phase 3) is a one-line addition, not a three-way
 * edit.
 *
 * The caller owns the fallback policy: this function throws if the chosen
 * backend can't be constructed/loaded (e.g. the keychain daemon is gone).
 * Each caller decides whether to try a weaker backend or fail.
 */
export async function createCredentialStoreForBackend(
  backend: CredentialBackend,
): Promise<CredentialStore> {
  if (backend === "keychain") {
    return new CredentialStore({ provider: new KeychainProvider() });
  }
  return new CredentialStore();
}

/** Probe type re-exported for callers that need the entry shape. */
export type { KeychainEntryLike };
