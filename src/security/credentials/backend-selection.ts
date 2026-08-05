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
import { emptyStore } from "./plain-file-provider.js";
import {
  KeychainProvider,
  resolveKeychainEntryFactory,
  probeKeychainWith,
  type KeychainEntryLike,
} from "./keychain-provider.js";
import { EncryptedFileProvider } from "./encrypted-file-provider.js";

export type CredentialBackend = "keychain" | "plain-file" | "encrypted-file";

/**
 * The env var supplying the encrypted-file backend's passphrase (headless /
 * CI / daemon use). Interactive sessions can prompt via the CLI instead.
 */
export const CREDENTIAL_PASSPHRASE_ENV = "ALIX_CREDENTIAL_PASSPHRASE";

/**
 * Resolve the encrypted-file passphrase. Policy: explicit → env → optional
 * interactive prompt → error. The single passphrase resolver — the migrate
 * command and the session path both route through here, so the fallback
 * chain (and the security of where a passphrase may come from) lives in one
 * place.
 *
 * `promptFn` is optional: when supplied AND stdin is a TTY, the operator is
 * prompted once (hidden) if no explicit/env passphrase is available. This
 * is what enables the spec's "type once per session" flow. When omitted
 * (or non-TTY), the function throws with a clear headless hint.
 */
export async function resolveCredentialPassphrase(
  explicit?: string,
  promptFn?: (question: string) => Promise<string>,
): Promise<string> {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env[CREDENTIAL_PASSPHRASE_ENV];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (promptFn && process.stdin.isTTY) {
    const value = await promptFn("Encrypted store passphrase: ");
    if (value && value.length > 0) return value;
  }
  throw new Error(
    `Encrypted credential store needs a passphrase. Set ${CREDENTIAL_PASSPHRASE_ENV} ` +
      "(headless) or run interactively from a TTY.",
  );
}

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
  // The tomb shape is owned by the plain-file provider (its schema).
  await writeFile(path, JSON.stringify(emptyStore(), null, 2) + "\n", {
    mode: 0o600,
  });
}

/** Read the persisted backend selector; "auto" when unset. */
export async function readStoredBackend(): Promise<StoredBackend> {
  try {
    const raw = await readFile(selectorPath(), "utf-8");
    const trimmed = raw.trim();
    if (trimmed === "keychain" || trimmed === "plain-file" || trimmed === "encrypted-file") return trimmed;
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
  passphrase?: string,
  promptFn?: (question: string) => Promise<string>,
): Promise<CredentialStore> {
  switch (backend) {
    case "keychain":
      return new CredentialStore({ provider: new KeychainProvider() });
    case "encrypted-file":
      return new CredentialStore({
        provider: new EncryptedFileProvider({
          passphrase: passphrase ?? (await resolveCredentialPassphrase(undefined, promptFn)),
        }),
      });
    case "plain-file":
    default:
      return new CredentialStore();
  }
}

/**
 * Load the store for `backend`, falling back to plain-file when the keychain
 * is unavailable at load time (constraint #3: a missing keychain must never
 * block config load or credential operations). Wraps
 * `createCredentialStoreForBackend` + `load()` with the single warn-and-fall-
 * back policy, so the try-keychain-catch-warn-fallback shape is NOT copy-
 * pasted in the CLI factory and config loader.
 *
 * An `encrypted-file` backend does NOT fall back on failure — a wrong
 * passphrase or missing passphrase source must surface loudly, never
 * silently downgrade to plaintext storage.
 *
 * `promptFn` enables the interactive session flow: when the encrypted-file
 * store has no env passphrase and stdin is a TTY, the operator is prompted
 * once. The loader (config load) deliberately passes NO promptFn — config
 * load must never block on interactive input; it throws and the caller
 * decides.
 */
export async function loadCredentialStoreWithKeychainFallback(
  backend: CredentialBackend,
  warn: (msg: string) => void = (msg) => console.warn(msg),
  promptFn?: (question: string) => Promise<string>,
): Promise<CredentialStore> {
  if (backend === "encrypted-file") {
    const store = await createCredentialStoreForBackend("encrypted-file", undefined, promptFn);
    await store.load();
    return store;
  }
  if (backend !== "keychain") {
    const store = await createCredentialStoreForBackend("plain-file");
    await store.load();
    return store;
  }
  try {
    const store = await createCredentialStoreForBackend("keychain");
    await store.load();
    return store;
  } catch (err) {
    warn(
      `Keychain backend unavailable (${err instanceof Error ? err.message : String(err)}); ` +
        "falling back to the plain-file credential store.",
    );
    const store = await createCredentialStoreForBackend("plain-file");
    await store.load();
    return store;
  }
}

/** Probe type re-exported for callers that need the entry shape. */
export type { KeychainEntryLike };
