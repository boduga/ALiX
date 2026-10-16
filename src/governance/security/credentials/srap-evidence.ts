/**
 * SRAP-1 — Evidence HMAC key lifecycle (`srap-evidence` namespace).
 *
 * Approval decision evidence carries a versioned HMAC credential reference:
 *
 *   credentialRef = hmac-sha256:v<N>:<base64url(HMAC(key_vN, credentialRecordId))>
 *
 * Keys live in the existing CredentialStore under provider namespace
 * `srap-evidence`, label `hmac-key:v<N>` (32 random bytes, base64url). The store
 * has no native per-entry version field, so the version is encoded in the label
 * and old versions coexist as ordinary entries.
 *
 * Contract (src/governance/security/credentials/AGENTS.md):
 * - generate → random 32-byte key `hmac-key:v<N+1>`; the new version is active
 *   immediately (no staged activation);
 * - rotate → the new version becomes active; old versions stay resolvable while
 *   retained approval evidence may reference them;
 * - retire → TWO gates. Eligibility: the version is inactive and no retained
 *   approval evidence references it (`retireEligibility`; retention is
 *   count-based, so the caller supplies the retained-reference count — there is
 *   no wall-clock window). Execution: an explicit operator `retireKey` call —
 *   eligibility never retires on its own and nothing is automatic;
 * - unavailable active key → fail closed (no decision committed);
 * - a ref whose key version is retired is reported unverifiable, never silently
 *   accepted and never an authority reversal;
 * - every key read is audited: raw key material is only reachable through the
 *   audited `sign`/`verify` accessors, whose `audit` sink is mandatory and
 *   awaited — a key read that cannot be durably audited fails the operation
 *   closed (no reference, no verdict).
 *
 * This module owns key lifecycle only. HMAC is computed here; the store is used
 * as a dumb secret holder (get/set/list/delete). No second secret authority.
 *
 * @module
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CredentialStore } from "./credential-store.js";

/** Provider namespace for SRAP evidence keys. */
export const SRAP_EVIDENCE_PROVIDER = "srap-evidence";

/** Prefix of every key label: `<prefix><N>`. */
export const SRAP_KEY_LABEL_PREFIX = "hmac-key:v";

/** Algorithm tag in a `credentialRef`. */
export const SRAP_HMAC_ALGORITHM = "hmac-sha256";

/** Key length in bytes. */
const KEY_BYTES = 32;

/** Thrown when the active key is unavailable (fail-closed). */
export class SrapKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SrapKeyUnavailableError";
  }
}

/** Parsed form of a `credentialRef`. */
export interface ParsedCredentialRef {
  algorithm: string;
  keyVersion: number;
  digest: string;
}

// ---------------------------------------------------------------------------
// Label / version helpers
// ---------------------------------------------------------------------------

/** The store label for a key version. */
export function keyLabel(version: number): string {
  return `${SRAP_KEY_LABEL_PREFIX}${version}`;
}

/** Parse `hmac-key:v<N>` → N, or null when the label is unrelated/malformed. */
export function parseKeyLabel(label: string): number | null {
  if (!label.startsWith(SRAP_KEY_LABEL_PREFIX)) return null;
  const rest = label.slice(SRAP_KEY_LABEL_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number.parseInt(rest, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** All key versions present in the store, ascending. */
export function listKeyVersions(store: CredentialStore): number[] {
  const versions: number[] = [];
  for (const entry of store.list()) {
    if (entry.provider.toLowerCase() !== SRAP_EVIDENCE_PROVIDER) continue;
    const v = parseKeyLabel(entry.keyLabel);
    if (v !== null) versions.push(v);
  }
  return versions.sort((a, b) => a - b);
}

/** The highest (active) key version, or null when none exists. */
export function activeKeyVersion(store: CredentialStore): number | null {
  const versions = listKeyVersions(store);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Generate / rotate / retire
// ---------------------------------------------------------------------------

/**
 * Generate a new key as version `N+1` and return its version. The new key is
 * immediately the active (highest) version. Never overwrites an existing
 * version label.
 */
export async function generateKey(store: CredentialStore): Promise<number> {
  const current = activeKeyVersion(store);
  const next = (current ?? 0) + 1;
  const secret = randomBytes(KEY_BYTES).toString("base64url");
  await store.set(SRAP_EVIDENCE_PROVIDER, keyLabel(next), secret);
  return next;
}

/**
 * Rotate the active key: generate the next version. Returns the new active
 * version. Old versions remain resolvable (rotation is additive).
 */
export async function rotateKey(store: CredentialStore): Promise<number> {
  return generateKey(store);
}

/**
 * Retirement eligibility (gate 1 of 2). A version may be retired only when it
 * is neither the active version nor still referenced by retained approval
 * evidence. Retention is count-based (`maxTerminalRecords`), so this module
 * cannot see approvals — the caller (operator command / approval subsystem)
 * supplies `retainedReferences`. Eligibility never retires anything by itself;
 * it is a precondition for the explicit `retireKey` execution (gate 2).
 */
export interface RetireEligibility {
  eligible: boolean;
  /** Why not, when `eligible` is false. */
  reason?: "active" | "absent" | "retained-references";
}

/** Whether a key version may be retired (gate 1). See {@link retireEligibility}. */
export function retireEligibility(
  store: CredentialStore,
  version: number,
  retainedReferences: number,
): RetireEligibility {
  if (!listKeyVersions(store).includes(version)) return { eligible: false, reason: "absent" };
  if (activeKeyVersion(store) === version) return { eligible: false, reason: "active" };
  if (retainedReferences > 0) return { eligible: false, reason: "retained-references" };
  return { eligible: true };
}

/**
 * Retire a specific key version (gate 2: explicit operator execution).
 *
 * Refuses the active version, and refuses any version still referenced by
 * retained approval evidence (retention must lapse first). Idempotent: retiring
 * an absent version returns false. Never automatic — there is no timer; the
 * operator (or the CLI) calls this deliberately, supplying the retained-
 * reference count from the approval subsystem.
 */
export async function retireKey(
  store: CredentialStore,
  version: number,
  retainedReferences: number,
): Promise<boolean> {
  const verdict = retireEligibility(store, version, retainedReferences);
  if (!verdict.eligible) {
    if (verdict.reason === "absent") return false;
    if (verdict.reason === "active") {
      throw new SrapKeyUnavailableError(
        `Refusing to retire active key v${version}; rotate to a new version first.`,
      );
    }
    throw new SrapKeyUnavailableError(
      `Refusing to retire key v${version}: ${retainedReferences} retained approval record(s) still reference it.`,
    );
  }
  return store.delete(SRAP_EVIDENCE_PROVIDER, keyLabel(version));
}

// ---------------------------------------------------------------------------
// Sign / verify
// ---------------------------------------------------------------------------

/** Load a version's raw key bytes, or null when absent/retired. */
function loadKeyBytes(store: CredentialStore, version: number): Buffer | null {
  const value = store.get(SRAP_EVIDENCE_PROVIDER, keyLabel(version));
  if (value === null || value === "") return null;
  try {
    const buf = Buffer.from(value, "base64url");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Mandatory key-read audit sink.
 *
 * The contract requires every `srap-evidence` key access to be logged ("only
 * trusted approval/audit code resolves `srap-evidence`; key reads are logged").
 * Key material is only reachable through {@link signCredentialRef} /
 * {@link verifyCredentialRef}, and both REQUIRE this sink — there is no default,
 * so a caller cannot read keys while silently skipping the audit.
 *
 * The sink is awaited BEFORE the accessor returns, and a rejected sink fails the
 * whole operation closed: a key read that cannot be durably audited must not
 * produce a signed reference or a verification verdict.
 */
export type KeyReadAudit = (event: {
  operation: "sign" | "verify";
  keyVersion: number;
}) => void | Promise<void>;

/**
 * Sign a credential record id with the active key version.
 *
 * Fail-closed: when there is no active key (or it is unreadable), throws
 * {@link SrapKeyUnavailableError} and the caller must commit no decision; when
 * the mandatory key-read audit rejects, the error propagates and no reference is
 * produced. The key access is always reported through `audit` before the
 * reference is released.
 */
export async function signCredentialRef(
  store: CredentialStore,
  credentialRecordId: string,
  audit: KeyReadAudit,
): Promise<string> {
  const version = activeKeyVersion(store);
  if (version === null) {
    throw new SrapKeyUnavailableError("No active srap-evidence key; cannot sign decision evidence.");
  }
  const key = loadKeyBytes(store, version);
  if (key === null) {
    throw new SrapKeyUnavailableError(`Active srap-evidence key v${version} is unreadable.`);
  }
  // Durable audit BEFORE the reference is released (fail closed).
  await audit({ operation: "sign", keyVersion: version });
  const digest = createHmac("sha256", key).update(credentialRecordId, "utf8").digest("base64url");
  return `${SRAP_HMAC_ALGORITHM}:v${version}:${digest}`;
}

/** Parse a `credentialRef` string, or null when malformed. */
export function parseCredentialRef(ref: string): ParsedCredentialRef | null {
  const parts = ref.split(":");
  if (parts.length !== 3) return null;
  const [algorithm, versionPart, digest] = parts;
  if (algorithm !== SRAP_HMAC_ALGORITHM) return null;
  if (!versionPart.startsWith("v") || !/^v\d+$/.test(versionPart)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(digest)) return null;
  const keyVersion = Number.parseInt(versionPart.slice(1), 10);
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) return null;
  return { algorithm, keyVersion, digest };
}

/**
 * Verify a `credentialRef` against a credential record id.
 *
 * Returns:
 * - `"valid"` — the ref matches the record id under its key version;
 * - `"invalid"` — the ref is well-formed and the version's key exists, but the
 *   digest does not match;
 * - `"unverifiable"` — the ref is malformed or its key version is absent
 *   (never generated or retired). NEVER treated as valid.
 */
export async function verifyCredentialRef(
  store: CredentialStore,
  credentialRecordId: string,
  ref: string,
  audit: KeyReadAudit,
): Promise<"valid" | "invalid" | "unverifiable"> {
  const parsed = parseCredentialRef(ref);
  if (!parsed) return "unverifiable";
  const key = loadKeyBytes(store, parsed.keyVersion);
  // Durable audit of the key access; a rejected sink fails the verification
  // closed (the error propagates) rather than returning a verdict.
  await audit({ operation: "verify", keyVersion: parsed.keyVersion });
  if (key === null) return "unverifiable";
  const expected = createHmac("sha256", key).update(credentialRecordId, "utf8").digest();
  // `Buffer.from` never throws for a base64url string; a malformed digest simply
  // decodes to a different length and is classified `invalid` below.
  const provided = Buffer.from(parsed.digest, "base64url");
  if (provided.length !== expected.length) return "invalid";
  return timingSafeEqual(provided, expected) ? "valid" : "invalid";
}
