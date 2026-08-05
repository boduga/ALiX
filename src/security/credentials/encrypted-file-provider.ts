/**
 * EncryptedFileProvider — passphrase-encrypted `CredentialProvider` backend
 * (issue #350, Phase 3).
 *
 * The whole store (values AND metadata) is encrypted at rest with
 * AES-256-GCM. The key is derived from a passphrase via Argon2id (the
 * Password Hashing Competition winner), with the salt embedded in the
 * stored Argon2 PHC string so the file is self-contained.
 *
 * Target use case: headless / CI / daemon / container environments where
 * the OS keychain (Phase 2) is unavailable. The passphrase is supplied via
 * the `ALIX_CREDENTIAL_PASSPHRASE` env var (automation) or typed once per
 * session (interactive).
 *
 * Security posture:
 * - Values never appear in plaintext on disk (the file is the ciphertext).
 * - Wrong passphrase → `argon2.verify` fails AND the GCM auth tag fails;
 *   the provider throws. There is deliberately NO fallback to plain-file
 *   on a wrong passphrase — silently downgrading would defeat the point.
 * - Fail closed on corrupt/unsupported files (like PlainFileProvider).
 *
 * File format (on disk):
 *   {
 *     "version": 1,
 *     "kdf": "argon2id",
 *     "phc": "$argon2id$...",        // embeds salt + params
 *     "nonce": "<base64>",           // AES-GCM nonce
 *     "ciphertext": "<base64>"       // AES-256-GCM(JSON store)
 *   }
 *
 * Key derivation: `key = sha256(phc)`. The PHC string is deterministic for
 * (passphrase, salt, params), so re-deriving on unlock yields the same key;
 * sha256 just normalizes the PHC string to the 32 bytes AES needs.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { getUserStatePaths } from "../platform/user-state-paths.js";
import {
  MAX_CREDENTIAL_ENTRIES,
  lookupKey,
  type CredentialEntry,
  type StoreSchema,
} from "./credential-store.js";
import { emptyStore } from "./plain-file-provider.js";
import type { CredentialProvider } from "./credential-provider.js";
import type { CredentialBackend } from "./backend-selection.js";

/** Default store file name within the credentials directory. */
const STORE_FILENAME = "encrypted-store.json";

/** Schema version for the on-disk encrypted envelope. */
const ENVELOPE_VERSION = 1;

/** AES-GCM key size in bytes (32 → AES-256). */
const KEY_BYTES = 32;

/** AES-GCM nonce size in bytes. */
const NONCE_BYTES = 12;

export interface EncryptedFileProviderOptions {
  /** Override the store file path (for testing). Defaults to the platform state dir. */
  filePath?: string;
  /** The passphrase used to derive the encryption key. Required. */
  passphrase: string;
}

/** The on-disk encrypted envelope. */
interface EncryptedEnvelope {
  version: number;
  kdf: "argon2id";
  phc: string;
  nonce: string; // base64
  ciphertext: string; // base64
}

function resolveStorePath(override?: string): string {
  if (override) return override;
  const paths = getUserStatePaths();
  return join(paths.dataDir, "credentials", STORE_FILENAME);
}

/** Derive the 32-byte AES key from the passphrase (via Argon2id PHC). */
async function deriveKey(passphrase: string): Promise<{ key: Buffer; phc: string }> {
  // A fresh salt per file; argon2 embeds it in the PHC string.
  const salt = randomBytes(16);
  const phc = await argon2Hash(passphrase, { salt });
  const key = createHash("sha256").update(phc, "utf8").digest();
  return { key, phc };
}

/** Derive the key from a stored PHC (salt embedded). Verifies the passphrase. */
async function unlockKey(passphrase: string, phc: string): Promise<Buffer> {
  const ok = await argon2Verify(phc, passphrase);
  if (!ok) {
    throw new Error(
      "Incorrect passphrase for the encrypted credential store. " +
        "Set ALIX_CREDENTIAL_PASSPHRASE to the correct value.",
    );
  }
  // Deterministic given the stored PHC (which embeds salt + params).
  return createHash("sha256").update(phc, "utf8").digest();
}

function encrypt(key: Buffer, store: StoreSchema): EncryptedEnvelope {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(store), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: ENVELOPE_VERSION,
    kdf: "argon2id",
    phc: "",
    nonce: Buffer.concat([nonce, tag]).toString("base64"), // nonce + GCM tag
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(key: Buffer, env: EncryptedEnvelope): StoreSchema {
  const raw = Buffer.from(env.nonce, "base64");
  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(NONCE_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, "base64")), decipher.final()]);
  } catch {
    throw new Error(
      "Failed to decrypt the credential store — the passphrase is incorrect or the file is corrupt.",
    );
  }
  const parsed = JSON.parse(plaintext.toString("utf8"));
  if (!parsed || (parsed as StoreSchema).version !== 1 || !Array.isArray((parsed as StoreSchema).credentials)) {
    throw new Error("Decrypted credential store has an unsupported schema.");
  }
  return parsed as StoreSchema;
}

/**
 * Passphrase-encrypted file backend. Whole-store AES-256-GCM at rest.
 */
export class EncryptedFileProvider implements CredentialProvider {
  readonly backend = "encrypted-file";

  private readonly filePath: string;
  private readonly passphrase: string;
  private store: StoreSchema;
  private loaded = false;
  private phc: string | undefined;

  constructor(options: EncryptedFileProviderOptions) {
    if (!options.passphrase) {
      throw new Error(
        "EncryptedFileProvider requires a passphrase. Set ALIX_CREDENTIAL_PASSPHRASE or pass it explicitly.",
      );
    }
    this.filePath = options.filePath ?? resolveStorePath();
    this.passphrase = options.passphrase;
    this.store = emptyStore();
  }

  // -----------------------------------------------------------------------
  // CredentialProvider
  // -----------------------------------------------------------------------

  async load(): Promise<void> {
    if (this.loaded) return;

    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });

    if (!existsSync(this.filePath)) {
      // First run: derive a fresh key (generates a new salt) so a later
      // persist has a key ready. The store stays empty.
      const { key, phc } = await deriveKey(this.passphrase);
      this.phc = phc;
      this.store = emptyStore();
      this.loaded = true;
      return;
    }

    const raw = await readFile(this.filePath, "utf-8");
    let env: EncryptedEnvelope;
    try {
      env = JSON.parse(raw) as EncryptedEnvelope;
    } catch {
      throw new Error(
        `Encrypted credential store at ${this.filePath} is corrupt (invalid JSON). ` +
          "Remove the file to reset, or restore from backup.",
      );
    }
    if (!env || env.version !== ENVELOPE_VERSION || env.kdf !== "argon2id" || !env.phc || !env.nonce || !env.ciphertext) {
      throw new Error(`Encrypted credential store at ${this.filePath} has an unsupported format.`);
    }

    const key = await unlockKey(this.passphrase, env.phc);
    this.phc = env.phc;
    this.store = decrypt(key, env);
    this.loaded = true;
  }

  get(provider: string, keyLabel: string): string | null {
    const key = lookupKey(provider, keyLabel);
    const found = this.store.credentials.find(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );
    return found ? found.value : null;
  }

  async set(
    provider: string,
    keyLabel: string,
    value: string,
    metadata?: Record<string, string>,
    migratedFrom?: CredentialBackend,
  ): Promise<CredentialEntry> {
    if (!this.loaded) {
      throw new Error("Encrypted credential store not loaded. Call load() before setting credentials.");
    }

    const key = lookupKey(provider, keyLabel);
    const existing = this.store.credentials.find(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );

    if (existing) {
      existing.value = value;
      existing.entry.updatedAt = new Date().toISOString();
      if (metadata !== undefined) existing.entry.metadata = metadata;
      if (migratedFrom !== undefined) existing.entry.migratedFrom = migratedFrom;
      await this.persist();
      return { ...existing.entry };
    }

    if (this.store.credentials.length >= MAX_CREDENTIAL_ENTRIES) {
      throw new Error(
        `Credential store is full: ${MAX_CREDENTIAL_ENTRIES} entries maximum. ` +
          "Delete unused credentials before adding new ones.",
      );
    }

    const entry: CredentialEntry = {
      id: randomUUID(),
      provider,
      keyLabel,
      encrypted: true,
      backend: "encrypted-file",
      migratedFrom,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata,
    };
    this.store.credentials.push({ entry, value });
    await this.persist();
    return { ...entry };
  }

  async delete(provider: string, keyLabel: string): Promise<boolean> {
    if (!this.loaded) {
      throw new Error("Encrypted credential store not loaded. Call load() before deleting credentials.");
    }
    const key = lookupKey(provider, keyLabel);
    const idx = this.store.credentials.findIndex(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );
    if (idx === -1) return false;
    this.store.credentials.splice(idx, 1);
    await this.persist();
    return true;
  }

  list(): CredentialEntry[] {
    return this.store.credentials.map((c) => ({ ...c.entry }));
  }

  serialize(): StoreSchema {
    return this.store;
  }

  // -----------------------------------------------------------------------
  // Persistence (re-encrypt the whole store)
  // -----------------------------------------------------------------------

  private async persist(): Promise<void> {
    if (!this.phc) {
      // No key yet (store created but never persisted). Derive one.
      const { key, phc } = await deriveKey(this.passphrase);
      this.phc = phc;
    }
    const key = createHash("sha256").update(this.phc, "utf8").digest();
    const env = encrypt(key, this.store);
    env.phc = this.phc;
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, JSON.stringify(env, null, 2) + "\n", { mode: 0o600 });
  }
}
