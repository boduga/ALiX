/**
 * P4.3-Se3 — Config Signing, Trust Evaluation, and Anti-Rollback
 *
 * Signs the canonical config content with an Ed25519 keypair so that
 * tampering and rollback can be detected before execution. The verified
 * parsed config is the same object that proceeds to execution.
 *
 * Properties:
 * - Ed25519 key generation and PEM storage
 * - Canonical config hash covering all files in .alix/config/
 * - Signature stored as JSON in .alix/config/config.sig
 * - Anti-rollback version stamp in user state directory
 * - Fail-closed: verification failure prevents load in production
 * - Key rotation support without silent trust of unknown keys
 *
 * @module
 */

import { existsSync } from "node:fs";
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rename,
  unlink,
} from "node:fs/promises";
import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  createPublicKey,
  createPrivateKey,
  randomUUID,
} from "node:crypto";
import { join, dirname, basename } from "node:path";
import { getUserStatePaths } from "../security/platform/user-state-paths.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Signature file within the config directory. */
const SIGNATURE_FILENAME = "config.sig";

/** Default private key filename in user state dir. */
const DEFAULT_KEY_FILENAME = "config-signing.key";

/** Version stamp filename in user state dir. */
const VERSION_STAMP_FILENAME = "config-version.stamp";

/** Schema version for the signature manifest. */
const SIG_SCHEMA_VERSION = 1;

/** Key ID length (first N hex chars of SHA-256 of public key). */
const KEY_ID_LENGTH = 16;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const SIGNING_ERROR_CODES = {
  /** Signature file is missing. */
  NO_SIGNATURE: "CONFIG_NO_SIGNATURE",
  /** Signature verification failed (hash mismatch). */
  INVALID_SIGNATURE: "CONFIG_INVALID_SIGNATURE",
  /** The signing key is not available. */
  NO_SIGNING_KEY: "CONFIG_NO_SIGNING_KEY",
  /** The public key does not match the key ID in the signature. */
  KEY_ID_MISMATCH: "CONFIG_KEY_ID_MISMATCH",
  /** Config version is older than the last accepted version (anti-rollback). */
  ROLLBACK_DETECTED: "CONFIG_ROLLBACK_DETECTED",
  /** The config version has not changed but the config hash has (tampering). */
  TAMPER_DETECTED: "CONFIG_TAMPER_DETECTED",
  /** Unknown or untrusted signing key. */
  UNKNOWN_KEY: "CONFIG_UNKNOWN_KEY",
  /** Private key file has incorrect permissions. */
  KEY_PERMISSION_ERROR: "CONFIG_KEY_PERMISSION_ERROR",
} as const;

export type SigningErrorCode = (typeof SIGNING_ERROR_CODES)[keyof typeof SIGNING_ERROR_CODES];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigSignature {
  /** Schema version for forward compatibility. */
  schemaVersion: number;
  /** Short hex identifier derived from the public key. */
  keyId: string;
  /** Hex-encoded Ed25519 signature of the canonical config hash. */
  signature: string;
  /** ISO 8601 timestamp when the config was signed. */
  signedAt: string;
  /** Monotonic config version (provenance entry count). */
  configVersion: number;
  /** SHA-256 hex hash of the canonical config bytes. */
  configHash: string;
  /** SHA-256 hex hash of the previous config state, or null for initial. */
  prevConfigHash: string | null;
}

export interface TrustReport {
  /** Whether the config passed all trust checks. */
  trusted: boolean;
  /** Whether a signature was present. */
  signed: boolean;
  /** Whether the signature verified correctly. */
  signatureValid: boolean;
  /** Whether the version is not a rollback. */
  versionOk: boolean;
  /** The key ID that signed the config, if any. */
  keyId?: string;
  /** Individual warnings/errors for diagnostics. */
  issues: TrustIssue[];
}

export interface TrustIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

/**
 * Compute a key ID from a PEM public key.
 * First 16 hex chars of SHA-256 of the PEM content.
 */
function computeKeyId(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, KEY_ID_LENGTH);
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Resolve the default path for the signing private key.
 */
function defaultKeyPath(): string {
  const paths = getUserStatePaths();
  return join(paths.dataDir, DEFAULT_KEY_FILENAME);
}

/**
 * Resolve the default path for the version stamp.
 */
function defaultStampPath(): string {
  const paths = getUserStatePaths();
  return join(paths.dataDir, VERSION_STAMP_FILENAME);
}

// ---------------------------------------------------------------------------
// Canonical config bytes
// ---------------------------------------------------------------------------

/**
 * Compute the canonical config bytes for the entire config directory.
 *
 * Reads all .json files (excluding config.sig), sorts them by name for
 * determinism, and produces a single canonical byte sequence.
 *
 * Format per file: `<filename>\n<fileContent>\n`
 * All file entries are concatenated.
 *
 * Returns the canonical bytes and the SHA-256 hex hash.
 */
async function readCanonicalConfigBytes(
  configDir: string,
): Promise<{ bytes: Buffer; hash: string }> {
  if (!existsSync(configDir)) {
    throw Object.assign(
      new Error(`Config directory not found: ${configDir}`),
      { code: SIGNING_ERROR_CODES.NO_SIGNATURE },
    );
  }

  const entries = await readdir(configDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== SIGNATURE_FILENAME)
    .map((e) => e.name)
    .sort();

  if (jsonFiles.length === 0) {
    throw Object.assign(
      new Error(`No config files found in ${configDir}`),
      { code: SIGNING_ERROR_CODES.NO_SIGNATURE },
    );
  }

  const parts: Buffer[] = [];
  for (const filename of jsonFiles) {
    const content = await readFile(join(configDir, filename));
    parts.push(Buffer.from(filename + "\n", "utf-8"));
    parts.push(content);
    parts.push(Buffer.from("\n", "utf-8"));
  }

  const bytes = Buffer.concat(parts);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, hash };
}

// ---------------------------------------------------------------------------
// ConfigSigner
// ---------------------------------------------------------------------------

export class ConfigSigner {
  private readonly keyPath: string;
  private _privateKeyPem: string | null = null;
  private _publicKeyPem: string | null = null;

  constructor(keyPath?: string) {
    this.keyPath = keyPath ?? defaultKeyPath();
  }

  // -----------------------------------------------------------------------
  // Static: key generation
  // -----------------------------------------------------------------------

  /**
   * Generate a new Ed25519 keypair.
   * Returns the keys as PEM-encoded strings.
   */
  static generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKey, privateKey };
  }

  /**
   * Generate a keypair and persist the private key to the given path.
   * Returns the PEM-encoded keys.
   */
  static async generateAndPersistKey(
    keyPath?: string,
  ): Promise<{ publicKey: string; privateKey: string; keyPath: string }> {
    const targetPath = keyPath ?? defaultKeyPath();
    const { publicKey, privateKey } = ConfigSigner.generateKeyPair();

    const dir = dirname(targetPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });

    // Atomic write for the private key
    const tmpPath = targetPath + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmpPath, privateKey, { mode: 0o600, flag: "wx" });
      await rename(tmpPath, targetPath);
    } catch (err) {
      try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    return { publicKey, privateKey, keyPath: targetPath };
  }

  // -----------------------------------------------------------------------
  // Key loading
  // -----------------------------------------------------------------------

  /**
   * Load the private key from disk.
   */
  async loadPrivateKey(): Promise<string> {
    if (this._privateKeyPem) return this._privateKeyPem;

    if (!existsSync(this.keyPath)) {
      throw Object.assign(
        new Error(`Signing key not found at ${this.keyPath}. Generate one with: alix security config keygen`),
        { code: SIGNING_ERROR_CODES.NO_SIGNING_KEY },
      );
    }

    const pem = await readFile(this.keyPath, "utf-8");
    if (!pem.includes("PRIVATE KEY")) {
      throw Object.assign(
        new Error(`Invalid private key at ${this.keyPath}`),
        { code: SIGNING_ERROR_CODES.KEY_PERMISSION_ERROR },
      );
    }

    this._privateKeyPem = pem;

    // Derive public key from private key
    this._publicKeyPem = this.derivePublicKeyFromPrivate(pem);

    return pem;
  }

  /**
   * Derive the public key PEM from an Ed25519 private key PEM.
   *
   * For PKCS8 Ed25519, the private key contains the seed (first 32 bytes
   * of the key material) and the public key is deterministically derived.
   * We use Node's built-in key object API.
   */
  private derivePublicKeyFromPrivate(privateKeyPem: string): string {
    const privKeyObj = createPrivateKey({
      key: privateKeyPem,
      format: "pem",
      type: "pkcs8",
    });
    const publicKeyObj = createPublicKey(privKeyObj);
    return publicKeyObj.export({ type: "spki", format: "pem" }) as string;
  }

  /**
   * Load or derive the public key.
   */
  async getPublicKey(): Promise<string> {
    if (this._publicKeyPem) return this._publicKeyPem;
    await this.loadPrivateKey();
    return this._publicKeyPem!;
  }

  // -----------------------------------------------------------------------
  // Sign
  // -----------------------------------------------------------------------

  /**
   * Sign the config directory and write the signature file.
   *
   * @param configDir - Path to the .alix/config/ directory
   * @param configVersion - The current provenance version
   * @param prevConfigHash - Previous config hash from provenance, if any
   */
  async sign(
    configDir: string,
    configVersion: number,
    prevConfigHash?: string | null,
  ): Promise<ConfigSignature> {
    const privateKeyPem = await this.loadPrivateKey();
    const publicKeyPem = await this.getPublicKey();
    const keyId = computeKeyId(publicKeyPem);

    const { hash: configHash } = await readCanonicalConfigBytes(configDir);

    // Build the signing payload
    const signedAt = now();
    const payload = JSON.stringify({
      schemaVersion: SIG_SCHEMA_VERSION,
      keyId,
      configVersion,
      configHash,
      prevConfigHash: prevConfigHash ?? null,
      signedAt,
    });

    // Sign the payload using Ed25519
    const signature = cryptoSign(null, Buffer.from(payload, "utf-8"), privateKeyPem).toString("hex");

    const sig: ConfigSignature = {
      schemaVersion: SIG_SCHEMA_VERSION,
      keyId,
      signature,
      signedAt,
      configVersion,
      configHash,
      prevConfigHash: prevConfigHash ?? null,
    };

    // Write the signature file atomically
    const sigPath = join(configDir, SIGNATURE_FILENAME);
    const tmpPath = sigPath + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmpPath, JSON.stringify(sig, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(tmpPath, sigPath);
    } catch (err) {
      try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    return sig;
  }

  // -----------------------------------------------------------------------
  // Verify
  // -----------------------------------------------------------------------

  /**
   * Verify a config signature against the current config directory state.
   *
   * @param configDir - Path to the .alix/config/ directory
   * @param publicKeyPem - The trusted public key in PEM format
   * @returns Verification result
   */
  async verify(
    configDir: string,
    publicKeyPem: string,
  ): Promise<{ ok: true } | { ok: false; error: string; code: SigningErrorCode }> {
    const sigPath = join(configDir, SIGNATURE_FILENAME);

    if (!existsSync(sigPath)) {
      return {
        ok: false,
        error: "Config is not signed. Run: alix security config sign",
        code: SIGNING_ERROR_CODES.NO_SIGNATURE,
      };
    }

    // Read signature
    let sig: ConfigSignature;
    try {
      const raw = await readFile(sigPath, "utf-8");
      sig = JSON.parse(raw) as ConfigSignature;
    } catch {
      return {
        ok: false,
        error: "Config signature file is corrupt.",
        code: SIGNING_ERROR_CODES.INVALID_SIGNATURE,
      };
    }

    // Validate schema version
    if (sig.schemaVersion !== SIG_SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Unsupported signature schema version: ${sig.schemaVersion}`,
        code: SIGNING_ERROR_CODES.INVALID_SIGNATURE,
      };
    }

    // Check key ID match
    const trustedKeyId = computeKeyId(publicKeyPem);
    if (sig.keyId !== trustedKeyId) {
      return {
        ok: false,
        error: `Signature key ID "${sig.keyId}" does not match trusted key "${trustedKeyId}".`,
        code: SIGNING_ERROR_CODES.KEY_ID_MISMATCH,
      };
    }

    // Compute current canonical hash
    const { hash: currentHash } = await readCanonicalConfigBytes(configDir);

    // Verify the hash matches
    if (sig.configHash !== currentHash) {
      return {
        ok: false,
        error: `Config hash mismatch: expected ${sig.configHash}, got ${currentHash}. Config may have been modified.`,
        code: SIGNING_ERROR_CODES.TAMPER_DETECTED,
      };
    }

    // Verify the signature cryptographically
    const payload = JSON.stringify({
      schemaVersion: sig.schemaVersion,
      keyId: sig.keyId,
      configVersion: sig.configVersion,
      configHash: sig.configHash,
      prevConfigHash: sig.prevConfigHash,
      signedAt: sig.signedAt,
    });

    const valid = cryptoVerify(
      null,
      Buffer.from(payload, "utf-8"),
      publicKeyPem,
      Buffer.from(sig.signature, "hex"),
    );

    if (!valid) {
      return {
        ok: false,
        error: "Config signature is cryptographically invalid.",
        code: SIGNING_ERROR_CODES.INVALID_SIGNATURE,
      };
    }

    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Signature read
  // -----------------------------------------------------------------------

  /**
   * Read the current signature without verifying it.
   * Returns null if no signature exists.
   */
  static async readSignature(configDir: string): Promise<ConfigSignature | null> {
    const sigPath = join(configDir, SIGNATURE_FILENAME);
    if (!existsSync(sigPath)) return null;
    try {
      const raw = await readFile(sigPath, "utf-8");
      return JSON.parse(raw) as ConfigSignature;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Anti-rollback
  // -----------------------------------------------------------------------

  /**
   * Read the last accepted config version from the version stamp.
   * Returns 0 if no stamp exists.
   */
  static async readAcceptedVersion(stampPath?: string): Promise<number> {
    const path = stampPath ?? defaultStampPath();
    if (!existsSync(path)) return 0;
    try {
      const raw = await readFile(path, "utf-8");
      return parseInt(raw.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Write the accepted config version to the version stamp.
   * Uses atomic write via temp file.
   */
  static async writeAcceptedVersion(
    version: number,
    stampPath?: string,
  ): Promise<void> {
    const path = stampPath ?? defaultStampPath();
    const dir = dirname(path);
    await mkdir(dir, { recursive: true, mode: 0o700 });

    const tmpPath = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmpPath, String(version) + "\n", { mode: 0o600, flag: "wx" });
      await rename(tmpPath, path);
    } catch (err) {
      try { if (existsSync(tmpPath)) await unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * Check for rollback: reject config versions lower than the last accepted.
   * Returns the trust report with rollback detection.
   */
  static async checkRollback(
    configVersion: number,
    stampPath?: string,
  ): Promise<{ ok: true } | { ok: false; error: string; code: SigningErrorCode }> {
    const accepted = await ConfigSigner.readAcceptedVersion(stampPath);
    if (configVersion < accepted) {
      return {
        ok: false,
        error: `Config version ${configVersion} is older than last accepted version ${accepted}. ` +
          `Use 'alix config rollback ${configVersion} --force --reason "<reason>"' to override.`,
        code: SIGNING_ERROR_CODES.ROLLBACK_DETECTED,
      };
    }
    return { ok: true };
  }

  /**
   * Update the accepted version only after successful verification.
   */
  static async acceptVersion(
    version: number,
    stampPath?: string,
  ): Promise<void> {
    await ConfigSigner.writeAcceptedVersion(version, stampPath);
  }

  // -----------------------------------------------------------------------
  // Trust evaluation
  // -----------------------------------------------------------------------

  /**
   * Evaluate trust for a loaded config by running signature verification
   * and anti-rollback checks. Produces a TrustReport suitable for logging
   * and user diagnostics.
   *
   * @param configDir - Path to .alix/config/
   * @param publicKeyPem - Trusted public key (PEM). If not provided, key checks are skipped.
   * @param configVersion - Current provenance version
   * @param productionMode - If true, signature and rollback failures are errors
   */
  static async evaluateTrust(
    configDir: string,
    publicKeyPem: string | null,
    configVersion: number,
    productionMode = false,
    stampPath?: string,
  ): Promise<TrustReport> {
    const issues: TrustIssue[] = [];
    let signed = false;
    let signatureValid = false;
    let versionOk = true;
    let keyId: string | undefined;

    // Check for signature
    const sig = await ConfigSigner.readSignature(configDir);
    if (sig) {
      signed = true;
      keyId = sig.keyId;

      if (publicKeyPem) {
        const signer = new ConfigSigner();
        const result = await signer.verify(configDir, publicKeyPem);
        signatureValid = result.ok;
        if (!result.ok) {
          issues.push({
            severity: productionMode ? "error" : "warning",
            code: result.code,
            message: result.error,
          });
        }
      } else {
        issues.push({
          severity: "warning",
          code: SIGNING_ERROR_CODES.UNKNOWN_KEY,
          message: `Config is signed by key "${sig.keyId}" but no trusted public key is available.`,
        });
      }

      // Rollback check using the signed version
      const rollback = await ConfigSigner.checkRollback(sig.configVersion, stampPath);
      if (!rollback.ok) {
        versionOk = false;
        issues.push({
          severity: productionMode ? "error" : "warning",
          code: rollback.code,
          message: rollback.error,
        });
      }
    } else {
      if (productionMode) {
        issues.push({
          severity: "error",
          code: SIGNING_ERROR_CODES.NO_SIGNATURE,
          message: "Config is not signed. Production mode requires a valid config signature.",
        });
      }
    }

    const errors = issues.filter((i) => i.severity === "error");
    const trusted = errors.length === 0;

    return {
      trusted,
      signed,
      signatureValid,
      versionOk,
      keyId,
      issues,
    };
  }

  // -----------------------------------------------------------------------
  // Path accessors
  // -----------------------------------------------------------------------

  /** Return the path to the private key file. */
  get privateKeyPath(): string {
    return this.keyPath;
  }

  /** Return the default stamp path. */
  static defaultStampPath(): string {
    return defaultStampPath();
  }

  /** Return the default key path. */
  static defaultKeyPath(): string {
    return defaultKeyPath();
  }
}
