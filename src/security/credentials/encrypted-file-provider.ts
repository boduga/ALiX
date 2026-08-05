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
 * - Wrong passphrase → the derived key is wrong → the GCM auth tag fails;
 *   the provider throws. There is deliberately NO fallback to plain-file
 *   on a wrong passphrase — silently downgrading would defeat the point.
 * - The key is derived from passphrase + a random salt stored in the file.
 *   The salt is key-DERIVING material but useless without the passphrase:
 *   an attacker with file-read access cannot decrypt (the salt alone
 *   yields no key). This is the critical property — the key must NOT be
 *   derivable from anything stored alongside the ciphertext.
 * - Fail closed on corrupt/unsupported files (like PlainFileProvider).
 *
 * File format (on disk):
 *   {
 *     "version": 1,
 *     "kdf": "argon2id",
 *     "salt": "<base64>",            // random per-file salt (key-deriving)
 *     "nonce": "<base64>",           // AES-GCM nonce + auth tag
 *     "ciphertext": "<base64>"       // AES-256-GCM(JSON store)
 *   }
 *
 * Key derivation: `key = argon2id(passphrase, salt, outputLen=32)`. The
 * salt is random and stored alongside the ciphertext; the passphrase is
 * NEVER stored. An attacker with the file alone cannot derive the key.
 * Wrong passphrase → wrong key → GCM auth-tag failure → throw.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hashRaw as argon2HashRaw } from "@node-rs/argon2";
import { getUserStatePaths } from "../platform/user-state-paths.js";
import { type StoreSchema } from "./credential-store.js";
import { emptyStore } from "./plain-file-provider.js";
import { MemoryCredentialProvider } from "./memory-credential-provider.js";

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
  /** Base64 salt fed to argon2id. THE ONLY key-determining material stored. */
  salt: string;
  /** Argon2id parameters (raw string, informational; never used as a key). */
  params?: string;
  nonce: string; // base64
  ciphertext: string; // base64
}

function resolveStorePath(override?: string): string {
  if (override) return override;
  const paths = getUserStatePaths();
  return join(paths.dataDir, "credentials", STORE_FILENAME);
}

/**
 * Derive the 32-byte AES key from the passphrase + a random salt via
 * Argon2id's RAW output (hashRaw → 32 bytes). The salt is the ONLY
 * key-determining material stored in the file. The passphrase is NOT
 * stored anywhere — an attacker with file-read access cannot derive the
 * key without the passphrase, which is the entire point of Phase 3.
 */
async function deriveKey(
  passphrase: string,
  salt: Buffer,
): Promise<Buffer> {
  // hashRaw returns the raw 32-byte derived key (no PHC string involved —
  // the PHC-string-as-key shortcut was the Phase-3 security flaw).
  const raw = await argon2HashRaw(passphrase, { salt, outputLen: KEY_BYTES });
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

/**
 * Decrypt with a passphrase: re-derive the key from passphrase + stored
 * salt, then let the GCM auth tag reject a wrong passphrase. The auth tag
 * failure IS the "incorrect passphrase" signal — no separate argon2.verify
 * needed (and none is done, since the raw salt can't be verified without
 * the passphrase anyway).
 */
async function unlockKey(passphrase: string, env: EncryptedEnvelope): Promise<Buffer> {
  const salt = Buffer.from(env.salt, "base64");
  if (salt.length === 0) {
    throw new Error("Encrypted credential store has no salt — unsupported or corrupt format.");
  }
  return deriveKey(passphrase, salt);
}

function encrypt(key: Buffer, store: StoreSchema, salt: Buffer): EncryptedEnvelope {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(store), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: ENVELOPE_VERSION,
    kdf: "argon2id",
    salt: salt.toString("base64"),
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
 * CRUD is inherited from MemoryCredentialProvider; this class only differs
 * in how it persists the store (encrypt → write) and loads it (read →
 * decrypt).
 */
export class EncryptedFileProvider extends MemoryCredentialProvider {
  readonly backend = "encrypted-file";

  private readonly filePath: string;
  private readonly passphrase: string;
  private salt: Buffer | undefined;

  constructor(options: EncryptedFileProviderOptions) {
    super();
    if (!options.passphrase) {
      throw new Error(
        "EncryptedFileProvider requires a passphrase. Set ALIX_CREDENTIAL_PASSPHRASE or pass it explicitly.",
      );
    }
    this.filePath = options.filePath ?? resolveStorePath();
    this.passphrase = options.passphrase;
  }

  // -----------------------------------------------------------------------
  // CredentialProvider (load only — CRUD inherited from the base)
  // -----------------------------------------------------------------------

  async load(): Promise<void> {
    if (this.loaded) return;

    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });

    if (!existsSync(this.filePath)) {
      // First run: generate a fresh salt (deferred — no key derivation
      // needed until the first persist actually writes the file).
      this.salt = randomBytes(16);
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
    if (!env || env.version !== ENVELOPE_VERSION || env.kdf !== "argon2id" || !env.salt || !env.nonce || !env.ciphertext) {
      throw new Error(`Encrypted credential store at ${this.filePath} has an unsupported format.`);
    }

    // Re-derive the key from passphrase + stored salt. A wrong passphrase
    // yields a wrong key, and the GCM auth tag (checked inside decrypt)
    // rejects it. The salt is key-deriving material but useless without
    // the passphrase — an attacker with the file cannot decrypt.
    const key = await unlockKey(this.passphrase, env);
    this.salt = Buffer.from(env.salt, "base64");
    this.store = decrypt(key, env);
    this.loaded = true;
  }

  // -----------------------------------------------------------------------
  // Persistence (re-encrypt the whole store)
  // -----------------------------------------------------------------------

  protected async persist(): Promise<void> {
    if (!this.salt) {
      this.salt = randomBytes(16);
    }
    const key = await deriveKey(this.passphrase, this.salt);
    const env = encrypt(key, this.store, this.salt);
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, JSON.stringify(env, null, 2) + "\n", { mode: 0o600 });
  }
}
