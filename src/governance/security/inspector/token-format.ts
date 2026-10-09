/**
 * P4.3-Sb2 — Token Format, Parsing, and Generation
 *
 * Token format: `alix_i_<12-char-id>_<43-char-base64url-secret>`
 *
 * - Generate 32 random bytes for the secret, base64url-encode without padding.
 * - The ID is 12 random base64url characters.
 * - SHA-256 hash of the full token string is what gets stored.
 * - Constant-time comparison for hash verification.
 *
 * @module
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Token prefix for Inspector API tokens. */
export const TOKEN_PREFIX = "alix_i_";

/** Length of the random token ID (base64url characters). */
export const TOKEN_ID_LENGTH = 12;

/** Number of random bytes for the secret (32 bytes → 43 base64url chars). */
export const SECRET_BYTES = 32;

/** Expected length of the base64url-encoded secret (43 chars, no padding). */
export const SECRET_ENCODED_LENGTH = 43;

/** Maximum token string length to accept before rejecting. */
export const MAX_TOKEN_LENGTH = 256;

// ---------------------------------------------------------------------------
// Base64url encoding (no padding)
// ---------------------------------------------------------------------------

/**
 * Encode a Buffer as base64url without padding.
 */
function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode a base64url string (without padding) back to a Buffer.
 */
function base64urlDecode(s: string): Buffer {
  // Restore padding
  let padded = s.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) {
    padded += "=";
  }
  return Buffer.from(padded, "base64");
}

// ---------------------------------------------------------------------------
// Alphabet
// ---------------------------------------------------------------------------

/**
 * Token ID alphabet: alphanumeric only (no underscore or hyphen).
 * The underscore is the field separator in the token format,
 * so the ID must not contain it. Hyphen is also excluded for clarity.
 */
const TOKEN_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// ---------------------------------------------------------------------------
// Token ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a random token ID (12 base64url characters).
 */
function generateTokenId(): string {
  const bytes = randomBytes(9); // 9 bytes = 72 bits → 12 base64url chars
  let result = "";
  // Encode 6 bits at a time
  let bits = 0;
  let bitCount = 0;
  for (const b of bytes) {
    bits = (bits << 8) | b;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      const idx = (bits >> bitCount) & 0x3f;
      // Clamp to 62 (alphanumeric only — exclude _ and -)
      const clampedIdx = idx < TOKEN_ID_ALPHABET.length ? idx : idx % TOKEN_ID_ALPHABET.length;
      result += TOKEN_ID_ALPHABET[clampedIdx];
    }
  }
  // Flush remaining bits
  if (bitCount > 0) {
    const idx = (bits << (6 - bitCount)) & 0x3f;
    const clampedIdx = idx < TOKEN_ID_ALPHABET.length ? idx : idx % TOKEN_ID_ALPHABET.length;
    result += TOKEN_ID_ALPHABET[clampedIdx];
  }
  return result.slice(0, TOKEN_ID_LENGTH);
}

// ---------------------------------------------------------------------------
// ParsedToken
// ---------------------------------------------------------------------------

export interface ParsedToken {
  /** The token ID extracted from the token string. */
  id: string;
  /** The raw secret bytes (32 bytes). */
  secret: Buffer;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Result of generating a new token.
 */
export interface GeneratedToken {
  /** The 12-character token ID. */
  id: string;
  /** The full token string (shown exactly once). */
  token: string;
  /** SHA-256 hash of the full token string (what gets stored). */
  hash: string;
}

/**
 * Generate a new Inspector API token.
 *
 * The full token string is returned exactly once; only the SHA-256 hash
 * should be persisted.
 */
export function generateToken(): GeneratedToken {
  const id = generateTokenId();
  const secretBytes = randomBytes(SECRET_BYTES);
  const secret = base64urlEncode(secretBytes);
  const token = `${TOKEN_PREFIX}${id}_${secret}`;
  const hash = sha256(token);
  return { id, token, hash };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Result of token parsing.
 */
export type ParseTokenResult =
  | { ok: true; id: string; secret: Buffer }
  | { ok: false; error: string };

/**
 * Parse a token string into its components.
 *
 * Validates format, lengths, and character sets before extracting.
 * Rejects oversized or malformed tokens.
 */
export function parseToken(raw: string): ParseTokenResult {
  // 1. Reject oversized tokens before any processing
  if (raw.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: "token_too_long" };
  }

  // 2. Check prefix
  if (!raw.startsWith(TOKEN_PREFIX)) {
    return { ok: false, error: "invalid_token_format" };
  }

  const body = raw.slice(TOKEN_PREFIX.length);

  // 3. Split on first underscore after the prefix (ID and secret are separated by _)
  const underscoreIdx = body.indexOf("_");
  if (underscoreIdx === -1) {
    return { ok: false, error: "invalid_token_format" };
  }

  const id = body.slice(0, underscoreIdx);
  const secret = body.slice(underscoreIdx + 1);

  // 4. Validate ID length
  if (id.length !== TOKEN_ID_LENGTH) {
    return { ok: false, error: "invalid_token_format" };
  }

  // 5. Validate ID characters (alphanumeric only — underscore is the field separator)
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    return { ok: false, error: "invalid_token_format" };
  }

  // 6. Validate secret length
  if (secret.length !== SECRET_ENCODED_LENGTH) {
    return { ok: false, error: "invalid_token_format" };
  }

  // 7. Validate secret characters (base64url only)
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    return { ok: false, error: "invalid_token_format" };
  }

  // 8. Decode secret bytes
  let secretBytes: Buffer;
  try {
    secretBytes = base64urlDecode(secret);
  } catch {
    return { ok: false, error: "invalid_token_format" };
  }

  // 9. Verify secret byte count
  if (secretBytes.length !== SECRET_BYTES) {
    return { ok: false, error: "invalid_token_format" };
  }

  return { ok: true, id, secret: secretBytes };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a string.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Convert a hex hash string to a Buffer for constant-time comparison.
 */
function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Result of token verification.
 */
export type VerifyTokenResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Verify a raw token string against a stored SHA-256 hash.
 *
 * Uses constant-time comparison to prevent timing attacks.
 * Both the wrong-id and wrong-secret cases take the same comparison path.
 */
export function verifyTokenHash(raw: string, storedHash: string): VerifyTokenResult {
  // 1. Parse the token first (validates format)
  const parsed = parseToken(raw);
  if (!parsed.ok) {
    // For timing safety: still compute a hash and compare against a dummy
    // so the failure path length doesn't leak whether the token was parseable.
    const dummy = sha256(raw.slice(0, 64));
    try {
      timingSafeEqual(hexToBuffer(dummy), hexToBuffer(dummy));
    } catch {
      // ignore
    }
    return { ok: false, error: parsed.error };
  }

  // 2. Compute hash of the full token string
  const computedHash = sha256(raw);

  // 3. Constant-time comparison
  const computedBuf = hexToBuffer(computedHash);
  const storedBuf = hexToBuffer(storedHash);

  if (computedBuf.length !== storedBuf.length) {
    // Mismatched lengths — still do a constant-time dummy comparison
    try {
      timingSafeEqual(computedBuf, computedBuf);
    } catch {
      // ignore
    }
    return { ok: false, error: "invalid_token" };
  }

  const match = timingSafeEqual(computedBuf, storedBuf);

  if (!match) {
    return { ok: false, error: "invalid_token" };
  }

  return { ok: true };
}
