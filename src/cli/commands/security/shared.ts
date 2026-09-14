/**
 * security.ts — Security diagnostics and Inspector auth management for ALiX.
 *
 * Provides:
 * - `alix security doctor` — Inspector boundary state diagnostics (Sb1)
 * - `alix inspector auth create --name <name> --role <role>` (Sb2)
 * - `alix inspector auth list` (Sb2)
 * - `alix inspector auth rotate <token-id> --grace <duration>` (Sb2)
 * - `alix inspector auth revoke <token-id> [--yes]` (Sb2)
 * - `alix inspector auth doctor` (Sb2)
 * - `alix audit verify [--json]` — streaming audit log verification (Sd2)
 * - `alix audit checkpoint --output <path>` — create signed checkpoint (Sd2)
 * - `alix audit checkpoint-verify <path>` — verify checkpoint (Sd2)
 */

import "../../../config/loader.js";
import "../../../config/validator.js";
import { AuthStore } from "../../../security/inspector/auth-store.js";
import { AuthService, type AuditFn, type MetricsFn } from "../../../security/inspector/auth-service.js";
import { getUserStatePaths } from "../../../security/platform/user-state-paths.js";
import { join } from "node:path";
import { mkdirSync, appendFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import "../../../security/credentials/credential-store.js";
import "../../../security/credentials/credential-reference.js";
import "../../../security/credentials/credential-migration.js";
import "node:os";

// Supply-chain imports (P4.3-Sf)
import "../../../security/supply-chain/dependency-policy.js";
import "../../../security/supply-chain/security-exceptions.js";
import "../../../security/supply-chain/package-verifier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a duration string like "24h", "30d", "7d" into milliseconds.
 */
export function parseDuration(raw: string): number | null {
  const match = raw.match(/^(\d+)(h|d|m|s)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}


/**
 * Derive the audit log path for Inspector auth events.
 */
export function auditLogPath(): string {
  const paths = getUserStatePaths();
  return join(paths.authStateDir, "audit.jsonl");
}


/**
 * Create a file-backed audit function.
 * Uses synchronous writes so errors propagate to the caller
 * (audit failure can fail the enclosing mutation).
 */
export function createFileAudit(): AuditFn {
  const logPath = auditLogPath();
  return (event) => {
    try {
      const dir = join(logPath, "..");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const entry = JSON.stringify({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        ...event,
      }) + "\n";
      appendFileSync(logPath, entry, { mode: 0o600 });
    } catch (err) {
      // Re-throw so the mutation can fail if audit cannot persist
      throw err;
    }
  };
}


/**
 * Create a no-op metrics function for CLI.
 */
export function createNoopMetrics(): MetricsFn {
  return () => {};
}


/**
 * Create the auth store and service using platform state paths.
 */
export async function createAuthService(): Promise<AuthService> {
  const paths = getUserStatePaths();
  await mkdir(paths.authStateDir, { recursive: true, mode: 0o700 });
  const store = new AuthStore({
    filePath: join(paths.authStateDir, "auth-store.json"),
  });
  const audit = createFileAudit();
  const metrics = createNoopMetrics();
  return new AuthService(store, audit, metrics);
}

// ---------------------------------------------------------------------------
// JSON output helper
// ---------------------------------------------------------------------------

export let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}
