/**
 * P4.3-Sd2 — Audit Checkpoint Keys and Signed Checkpoints
 *
 * Provides Ed25519 keypair generation, signed checkpoint creation, and
 * checkpoint verification. Private keys are stored in the user state
 * directory (not project state) with restrictive permissions (0o600).
 *
 * Checkpoints are tamper-evident evidence, not tamper-proof guarantees.
 *
 * @module
 */

import {
  generateKeyPairSync,
  sign,
  verify,
  createHash,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { canonicalStringify } from "./canonical-json.js";
import { getUserStatePaths } from "../platform/user-state-paths.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_FILENAME = "audit-checkpoint.key";
const DOMAIN_PREFIX = "alix-audit-v1:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointPayload {
  /** Workspace identifier — binds the checkpoint to a specific project. */
  workspaceId: string;

  /** The sequence number of the v2 record this checkpoint anchors. */
  sequence: number;

  /** The recordHash of the v2 record this checkpoint anchors. */
  recordHash: string;

  /** Unix timestamp (ms) of checkpoint creation. */
  timestamp: number;

  /** First 8 hex chars of the SHA-256 digest of the public key (DER). */
  keyId: string;
}

export interface SignedCheckpoint {
  payload: CheckpointPayload;
  /** Hex-encoded Ed25519 signature over the canonical checkpoint payload. */
  signature: string;
}

export interface CheckpointVerifyResult {
  ok: boolean;
  reason?: string;
}

export interface CheckpointKeyPair {
  /** PEM-encoded private key (PKCS#8). */
  privateKeyPem: string;
  /** PEM-encoded public key (SPKI format). */
  publicKeyPem: string;
  /** Key ID — first 8 hex chars of SHA-256(public key DER). */
  keyId: string;
}

// ---------------------------------------------------------------------------
// Key path
// ---------------------------------------------------------------------------

/**
 * Resolve the path where the audit checkpoint private key is stored.
 * This is a user-scoped path (not project-scoped):
 *   ~/.local/state/alix-inspector/audit-checkpoint.key
 */
function checkpointKeyPath(): string {
  const paths = getUserStatePaths();
  // authStateDir is ~/.local/state/alix-inspector/auth
  // We want ~/.local/state/alix-inspector/audit-checkpoint.key
  return join(dirname(paths.authStateDir), KEY_FILENAME);
}

// ---------------------------------------------------------------------------
// KeyID computation
// ---------------------------------------------------------------------------

/**
 * Compute the key ID from a PEM public key (SPKI format).
 * Key ID = first 8 hex chars of SHA-256(public key DER bytes).
 */
function computeKeyId(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  const der = key.export({ type: "spki", format: "der" }) as Buffer;
  return createHash("sha256").update(der).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Key generation and storage
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 keypair for audit checkpoints.
 * Returns the keypair but does NOT persist it.
 */
export function generateCheckpointKeyPair(): CheckpointKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const privateKeyPem = privateKey as string;
  const publicKeyPem = publicKey as string;
  const keyId = computeKeyId(publicKeyPem);

  return { privateKeyPem, publicKeyPem, keyId };
}

/**
 * Store the checkpoint private key in the user state directory.
 * Creates parent directories with 0o700, key file with 0o600.
 * Overwrites any existing key.
 */
export function storeCheckpointPrivateKey(keyPair: CheckpointKeyPair): string {
  const keyPath = checkpointKeyPath();
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, keyPair.privateKeyPem, { encoding: "utf-8", mode: 0o600 });
  return keyPath;
}

/**
 * Load the checkpoint private key from the user state directory.
 * Returns null if no key exists.
 */
export function loadCheckpointPrivateKey(): string | null {
  const keyPath = checkpointKeyPath();
  if (!existsSync(keyPath)) return null;
  try {
    return readFileSync(keyPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load or generate the checkpoint keypair.
 *
 * If a key exists on disk, loads it and derives the public key
 * and key ID. Otherwise generates a new keypair, stores it, and
 * returns it.
 */
export function loadOrCreateCheckpointKeyPair(): CheckpointKeyPair {
  const existing = loadCheckpointPrivateKey();
  if (existing !== null) {
    // Derive public key from private key.
    const privKey = createPrivateKey(existing);
    // createPublicKey accepts KeyObject at runtime but TS types lack this overload
    const pubKey = createPublicKey(privKey as never);
    const publicKeyPem = pubKey.export({ type: "spki", format: "pem" }) as string;
    const keyId = computeKeyId(publicKeyPem);
    return { privateKeyPem: existing, publicKeyPem, keyId };
  }

  // Generate new keypair and store it.
  const keyPair = generateCheckpointKeyPair();
  storeCheckpointPrivateKey(keyPair);
  return keyPair;
}

// ---------------------------------------------------------------------------
// Trusted public keys
// ---------------------------------------------------------------------------

const trustedKeys: Map<string, string> = new Map();

/**
 * Import a trusted public key for checkpoint verification.
 *
 * @param pem - PEM-encoded Ed25519 public key (SPKI format).
 * @param keyId - Optional key ID. If omitted, computed from the key.
 * @returns The computed or provided key ID.
 */
export function importTrustedPublicKey(pem: string, keyId?: string): string {
  const id = keyId ?? computeKeyId(pem);
  trustedKeys.set(id, pem);
  return id;
}

/**
 * Look up a trusted public key by key ID.
 * Returns the PEM string or null if not found.
 */
export function getTrustedPublicKey(keyId: string): string | null {
  return trustedKeys.get(keyId) ?? null;
}

/**
 * Clear all trusted public keys (for testing).
 */
export function clearTrustedKeys(): void {
  trustedKeys.clear();
}

// ---------------------------------------------------------------------------
// Canonical checkpoint payload serialization
// ---------------------------------------------------------------------------

/**
 * Produce the canonical JSON form of a CheckpointPayload for signing.
 * Uses `canonicalStringify` which sorts keys alphabetically.
 */
function canonicalCheckpointPayload(payload: CheckpointPayload): string {
  return canonicalStringify(payload);
}

// ---------------------------------------------------------------------------
// Checkpoint creation
// ---------------------------------------------------------------------------

export interface CreateCheckpointOptions {
  /** Workspace identifier (e.g., project directory path or UUID). */
  workspaceId: string;

  /** Current v2 sequence number (from head sidecar). */
  sequence: number;

  /** Current v2 record hash (from head sidecar). */
  recordHash: string;

  /** The Ed25519 private key PEM to sign with (PKCS#8). */
  privateKeyPem: string;

  /** The key ID of the signing key. */
  keyId: string;
}

/**
 * Create a signed checkpoint.
 *
 * 1. Build canonical checkpoint payload (sorted keys).
 * 2. Sign with Ed25519 private key using domain prefix.
 * 3. Return `SignedCheckpoint`.
 */
export function createCheckpoint(options: CreateCheckpointOptions): SignedCheckpoint {
  const payload: CheckpointPayload = {
    workspaceId: options.workspaceId,
    sequence: options.sequence,
    recordHash: options.recordHash,
    timestamp: Date.now(),
    keyId: options.keyId,
  };

  const canonical = canonicalCheckpointPayload(payload);
  const data = Buffer.from(DOMAIN_PREFIX + canonical, "utf-8");
  const sigBuffer = sign(null, data, options.privateKeyPem);
  const signature = sigBuffer.toString("hex");

  return { payload, signature };
}

// ---------------------------------------------------------------------------
// Checkpoint verification
// ---------------------------------------------------------------------------

export interface VerifyCheckpointOptions {
  /** The signed checkpoint to verify. */
  checkpoint: SignedCheckpoint;

  /** The expected workspace ID. */
  workspaceId: string;

  /**
   * Public key PEM to verify against (SPKI format).
   * If omitted, looks up the keyId from trusted keys.
   */
  publicKeyPem?: string;
}

/**
 * Verify a signed checkpoint.
 *
 * 1. Validate payload fields.
 * 2. Verify workspaceId matches.
 * 3. Load the public key (from option or trusted keys via keyId).
 * 4. Verify the Ed25519 signature against the canonical payload.
 *
 * Caller is responsible for verifying sequence/recordHash against the
 * audit chain (the verifier does not have access to the chain here).
 */
export function verifyCheckpoint(options: VerifyCheckpointOptions): CheckpointVerifyResult {
  const { checkpoint, workspaceId } = options;
  const p = checkpoint.payload;

  // 1. Validate payload fields.
  if (
    typeof p.workspaceId !== "string" ||
    typeof p.sequence !== "number" ||
    typeof p.recordHash !== "string" ||
    typeof p.timestamp !== "number" ||
    typeof p.keyId !== "string"
  ) {
    return { ok: false, reason: "Invalid checkpoint payload: missing or malformed fields" };
  }

  if (typeof checkpoint.signature !== "string" || checkpoint.signature.length === 0) {
    return { ok: false, reason: "Invalid checkpoint: missing signature" };
  }

  // 2. Verify workspace.
  if (p.workspaceId !== workspaceId) {
    return {
      ok: false,
      reason: `Workspace mismatch: expected ${workspaceId}, got ${p.workspaceId}`,
    };
  }

  // 3. Load public key.
  let publicKeyPem: string | undefined = options.publicKeyPem;
  if (!publicKeyPem) {
    const trusted = getTrustedPublicKey(p.keyId);
    if (!trusted) {
      return {
        ok: false,
        reason: `No trusted public key found for keyId ${p.keyId}`,
      };
    }
    publicKeyPem = trusted;
  }

  // 4. Rebuild canonical payload and verify signature.
  const payload: CheckpointPayload = {
    workspaceId: p.workspaceId,
    sequence: p.sequence,
    recordHash: p.recordHash,
    timestamp: p.timestamp,
    keyId: p.keyId,
  };

  const canonical = canonicalCheckpointPayload(payload);
  const data = Buffer.from(DOMAIN_PREFIX + canonical, "utf-8");
  const sigBuffer = Buffer.from(checkpoint.signature, "hex");

  const valid = verify(null, data, publicKeyPem, sigBuffer);

  if (!valid) {
    return { ok: false, reason: "Signature verification failed" };
  }

  return { ok: true };
}
