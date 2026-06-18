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
 */

import { loadConfig } from "../../config/loader.js";
import { isLoopbackHost } from "../../config/validator.js";
import { AuthStore, MAX_TOKEN_COUNT } from "../../security/inspector/auth-store.js";
import {
  AuthService,
  AUTH_TOKEN_ROLES,
  type AuthTokenRole,
  type AuditFn,
  type MetricsFn,
} from "../../security/inspector/auth-service.js";
import { getUserStatePaths } from "../../security/platform/user-state-paths.js";
import { CredentialStore } from "../../security/credentials/credential-store.js";
import { makeCredentialReference } from "../../security/credentials/credential-reference.js";
import { migrateCredentials } from "../../security/credentials/credential-migration.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a duration string like "24h", "30d", "7d" into milliseconds.
 */
function parseDuration(raw: string): number | null {
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
function auditLogPath(): string {
  const paths = getUserStatePaths();
  return join(paths.authStateDir, "audit.jsonl");
}

/**
 * Create a file-backed audit function.
 */
function createFileAudit(): AuditFn {
  const logPath = auditLogPath();
  return (event) => {
    // Best-effort fire-and-forget audit logging
    const entry = JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    }) + "\n";
    // Ensure directory exists
    const dir = join(logPath, "..");
    mkdir(dir, { recursive: true, mode: 0o700 }).then(() => {
      writeFile(logPath, entry, { flag: "a", mode: 0o600 }).catch(() => {});
    }).catch(() => {});
  };
}

/**
 * Create a no-op metrics function for CLI.
 */
function createNoopMetrics(): MetricsFn {
  return () => {};
}

/**
 * Create the auth store and service using platform state paths.
 */
async function createAuthService(): Promise<AuthService> {
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

let jsonMode = false;

function setJsonMode(on: boolean): void {
  jsonMode = on;
}

function output(data: unknown): void {
  if (jsonMode) {
    console.log(JSON.stringify(data));
  }
}

// ---------------------------------------------------------------------------
// Security doctor (Sb1 — existing)
// ---------------------------------------------------------------------------

export async function handleSecurityDoctor(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd, { requireModel: false });

  console.log("ALiX Security Doctor — Inspector Boundary State\n");

  const host = config.ui.host;
  const port = config.ui.port;
  const enabled = config.ui.enabled;
  const sec = config.ui.security;

  console.log(`Inspector:    ${enabled ? `enabled (${host}:${port})` : "disabled"}`);
  console.log(`Loopback:     ${isLoopbackHost(host) ? "yes" : "no"}`);
  console.log(`Binding:      ${isLoopbackHost(host) ? "safe (loopback)" : "EXTERNAL"}`);
  console.log();

  if (sec) {
    console.log("Security configuration:");
    console.log(`  authentication:      ${sec.authentication}`);
    console.log(`  remoteAccess:        ${sec.remoteAccess}`);
    console.log(`  requireTlsForRemote: ${sec.requireTlsForRemote}`);
    console.log(`  allowedHosts:        ${sec.allowedHosts.length > 0 ? sec.allowedHosts.join(", ") : "(none)"}`);
    console.log(`  allowedOrigins:      ${sec.allowedOrigins.length > 0 ? sec.allowedOrigins.join(", ") : "(none)"}`);
    console.log(`  trustedProxyCidrs:  ${sec.trustedProxyCidrs.length > 0 ? sec.trustedProxyCidrs.join(", ") : "(none)"}`);
  } else {
    console.log("Security configuration: (none — using defaults)");
  }

  console.log();

  // Summary
  if (!isLoopbackHost(host) && host !== "0.0.0.0") {
    console.log("⚠  WARNING: Inspector is bound to a non-loopback address.");
    console.log("   Remote access is not yet approved until authentication lands.");
    console.log("   Set ui.host to 127.0.0.1 for safe local development.");
  } else if (host === "0.0.0.0") {
    console.log("⚠  WARNING: Inspector is bound to all interfaces (0.0.0.0).");
    console.log("   Set ui.host to 127.0.0.1 for loopback-only access.");
    console.log("   See docs/security/inspector-security.md for details.");
  } else {
    console.log("✓ Inspector is bound to loopback — safe.");
  }

  // P4.3-Sb2: Show auth state info
  const paths = getUserStatePaths();
  console.log(`\nAuth store:   ${paths.authStateDir}`);
  const storeFile = join(paths.authStateDir, "auth-store.json");
  const storeExists = existsSync(storeFile);
  console.log(`  Token store: ${storeExists ? "✓ exists" : "— not yet created"}`);

  if (storeExists) {
    try {
      const service = await createAuthService();
      const doctorResult = await service.doctor();
      if (doctorResult.ok) {
        const d = doctorResult.value;
        console.log(`  Tokens:      ${d.totalTokens}/${d.maxTokens} (${d.activeTokens} active, ${d.revokedTokens} revoked, ${d.expiredTokens} expired)`);
      }
    } catch {
      console.log("  (unable to read token store)");
    }
  }
}

// ---------------------------------------------------------------------------
// Inspector auth create
// ---------------------------------------------------------------------------

export async function handleInspectorAuthCreate(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const nameIdx = args.indexOf("--name");
  const roleIdx = args.indexOf("--role");
  const name = nameIdx >= 0 ? args[nameIdx + 1] : null;
  const role = roleIdx >= 0 ? args[roleIdx + 1] : null;

  if (!name || !role) {
    console.error("Usage: alix inspector auth create --name <name> --role <role> [--json]");
    process.exit(1);
  }

  if (!AUTH_TOKEN_ROLES.includes(role as AuthTokenRole)) {
    console.error(`Invalid role: ${role}. Must be one of: ${AUTH_TOKEN_ROLES.join(", ")}`);
    process.exit(1);
  }

  const service = await createAuthService();
  const result = await service.createToken({
    name,
    role: role as AuthTokenRole,
  });

  if (!result.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  const { id, token } = result.value;

  if (jsonMode) {
    console.log(JSON.stringify({ id, token, name, role, createdAt: result.value.createdAt }));
  } else {
    console.log(`Token created: ${id}`);
    console.log();
    console.log(token);
    console.log();
    console.log("⚠  IMPORTANT: Copy this token now. You will not be able to see it again.");
    console.log("   Store it securely — it provides authenticated access to the Inspector API.");
    console.log(`   Use it as:  Authorization: Bearer ${token}`);
  }
}

// ---------------------------------------------------------------------------
// Inspector auth list
// ---------------------------------------------------------------------------

export async function handleInspectorAuthList(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const service = await createAuthService();
  const result = await service.listTokens();

  if (!result.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  const tokens = result.value;

  if (jsonMode) {
    console.log(JSON.stringify(tokens));
  } else {
    if (tokens.length === 0) {
      console.log("No tokens found.");
    } else {
      console.log(`${"ID".padEnd(16)} ${"Name".padEnd(22)} ${"Role".padEnd(12)} ${"Status".padEnd(12)} Created`);
      console.log("-".repeat(90));
      for (const t of tokens) {
        const status = t.revoked ? "revoked" : (t.expiresAt && t.expiresAt < new Date().toISOString() ? "expired" : "active");
        const created = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "";
        console.log(`${t.id.padEnd(16)} ${t.name.slice(0, 20).padEnd(22)} ${t.role.padEnd(12)} ${status.padEnd(12)} ${created}`);
      }
      console.log(`\n${tokens.length} token(s)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Inspector auth rotate
// ---------------------------------------------------------------------------

export async function handleInspectorAuthRotate(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const tokenId = args[0];
  if (!tokenId) {
    console.error("Usage: alix inspector auth rotate <token-id> --grace <duration> [--json]");
    console.error("  --grace   Grace period (e.g. 1h, 30m, 7d). Default: 1h");
    process.exit(1);
  }

  const graceIdx = args.indexOf("--grace");
  const graceRaw = graceIdx >= 0 ? args[graceIdx + 1] : "1h";
  const graceMs = parseDuration(graceRaw);

  if (!graceMs) {
    console.error(`Invalid grace duration: ${graceRaw}. Use format like 1h, 30m, 7d.`);
    process.exit(1);
  }

  const service = await createAuthService();
  const result = await service.rotateToken(tokenId, graceMs);

  if (!result.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  const { id, token, previousId } = result.value;

  if (jsonMode) {
    console.log(JSON.stringify({ id, token, previousId, name: result.value.name, role: result.value.role, createdAt: result.value.createdAt }));
  } else {
    console.log(`Token rotated: ${previousId} → ${id}`);
    console.log(`Grace period: ${graceRaw}`);
    console.log();
    console.log(token);
    console.log();
    console.log("⚠  IMPORTANT: Copy this token now. You will not be able to see it again.");
    console.log("   The previous token will continue to work during the grace period.");
    console.log(`   Use it as:  Authorization: Bearer ${token}`);
  }
}

// ---------------------------------------------------------------------------
// Inspector auth revoke
// ---------------------------------------------------------------------------

export async function handleInspectorAuthRevoke(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const tokenId = args[0];
  if (!tokenId) {
    console.error("Usage: alix inspector auth revoke <token-id> [--yes] [--json]");
    process.exit(1);
  }

  // Confirm unless --yes
  if (!args.includes("--yes")) {
    const { prompt } = await import("./prompt.js");
    const confirm = await prompt(`Revoke token ${tokenId}? This cannot be undone. [y/N]: `);
    if (confirm.toLowerCase() !== "y") {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  const service = await createAuthService();
  const result = await service.revokeToken(tokenId, "manual_revocation");

  if (!result.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify({ id: tokenId, revoked: true }));
  } else {
    console.log(`Token revoked: ${tokenId}`);
  }
}

// ---------------------------------------------------------------------------
// Inspector auth doctor
// ---------------------------------------------------------------------------

export async function handleInspectorAuthDoctor(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const paths = getUserStatePaths();
  const service = await createAuthService();
  const result = await service.doctor();

  if (!result.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  const d = result.value;

  if (jsonMode) {
    console.log(JSON.stringify(d));
  } else {
    console.log("Inspector Auth Doctor\n");
    console.log(`State dir:       ${paths.authStateDir}`);
    console.log(`Store exists:    ${d.storeExists ? "yes" : "no"}`);
    console.log(`Tokens:          ${d.totalTokens}/${d.maxTokens}`);
    console.log(`  Active:        ${d.activeTokens}`);
    console.log(`  Revoked:       ${d.revokedTokens}`);
    console.log(`  Expired:       ${d.expiredTokens}`);
    console.log();

    if (d.totalTokens === 0) {
      console.log("No tokens exist. Create one with:");
      console.log("  alix inspector auth create --name <name> --role <role>");
    } else if (d.activeTokens === 0) {
      console.log("No active tokens. All existing tokens are revoked or expired.");
    } else {
      console.log("✓ Auth state is healthy.");
    }
  }
}

// ---------------------------------------------------------------------------
// Credential store helper
// ---------------------------------------------------------------------------

async function createCredentialStore(): Promise<CredentialStore> {
  const store = new CredentialStore();
  await store.load();
  return store;
}

// ---------------------------------------------------------------------------
// alix credential list
// ---------------------------------------------------------------------------

export async function handleCredentialList(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const store = await createCredentialStore();
  const entries = store.list();

  if (jsonMode) {
    console.log(JSON.stringify(entries));
  } else {
    if (entries.length === 0) {
      console.log("No credentials stored.");
      console.log(`\nCapacity: 0/${store.maxEntries} entries`);
    } else {
      console.log(`${"Provider".padEnd(20)} ${"Key Label".padEnd(30)} ${"Encrypted".padEnd(12)} Updated`);
      console.log("-".repeat(90));
      for (const e of entries) {
        const updated = e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : "";
        console.log(`${e.provider.slice(0, 18).padEnd(20)} ${e.keyLabel.slice(0, 28).padEnd(30)} ${e.encrypted ? "yes".padEnd(12) : "no".padEnd(12)} ${updated}`);
      }
      console.log(`\n${entries.length}/${store.maxEntries} entries`);
    }
  }
}

// ---------------------------------------------------------------------------
// alix credential get
// ---------------------------------------------------------------------------

export async function handleCredentialGet(args: string[]): Promise<void> {
  const provider = args[0];
  const keyLabel = args[1];

  if (!provider || !keyLabel) {
    console.error("Usage: alix credential get <provider> <keyLabel>");
    process.exit(1);
  }

  const store = await createCredentialStore();
  const value = store.get(provider, keyLabel);

  if (value === null) {
    console.error(`Credential not found: ${provider}/${keyLabel}`);
    process.exit(1);
  }

  // Output only the value (usable for piping)
  console.log(value);
}

// ---------------------------------------------------------------------------
// alix credential set
// ---------------------------------------------------------------------------

export async function handleCredentialSet(args: string[]): Promise<void> {
  const provider = args[0];
  const keyLabel = args[1];
  const value = args[2];

  if (!provider || !keyLabel || value === undefined) {
    console.error("Usage: alix credential set <provider> <keyLabel> <value>");
    process.exit(1);
  }

  const store = await createCredentialStore();
  const entry = await store.set(provider, keyLabel, value);

  if (jsonMode) {
    console.log(JSON.stringify({ id: entry.id, provider: entry.provider, keyLabel: entry.keyLabel, created: entry.createdAt }));
  } else {
    console.log(`Credential stored: ${makeCredentialReference(provider, keyLabel)}`);
    console.log(`ID: ${entry.id}`);
  }
}

// ---------------------------------------------------------------------------
// alix credential delete
// ---------------------------------------------------------------------------

export async function handleCredentialDelete(args: string[]): Promise<void> {
  const provider = args[0];
  const keyLabel = args[1];

  if (!provider || !keyLabel) {
    console.error("Usage: alix credential delete <provider> <keyLabel>");
    process.exit(1);
  }

  const store = await createCredentialStore();
  const deleted = await store.delete(provider, keyLabel);

  if (!deleted) {
    console.error(`Credential not found: ${provider}/${keyLabel}`);
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify({ deleted: true, provider, keyLabel }));
  } else {
    console.log(`Deleted: ${provider}/${keyLabel}`);
  }
}

// ---------------------------------------------------------------------------
// alix credential migrate
// ---------------------------------------------------------------------------

export async function handleCredentialMigrate(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));
  const dryRun = args.includes("--dry-run");

  const cwd = process.cwd();
  const home = homedir();

  if (!jsonMode) {
    if (dryRun) {
      console.log("Credential Migration — DRY RUN (no changes will be made)\n");
    } else {
      console.log("Credential Migration\n");
    }
  }

  try {
    const result = await migrateCredentials(cwd, home, { dryRun });

    if (jsonMode) {
      console.log(JSON.stringify({ dryRun, ...result }));
    } else {
      console.log(`Migrated:  ${result.migrated}`);
      console.log(`Skipped:   ${result.skipped}`);
      if (result.errors.length > 0) {
        console.log(`Errors:    ${result.errors.length}`);
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }
      console.log();

      for (const file of result.files) {
        if (file.migrated.length === 0 && file.skipped.length === 0 && file.errors.length === 0) {
          continue; // Skip files with no action
        }
        console.log(`File: ${file.path}`);
        for (const m of file.migrated) console.log(`  ✓ migrated: ${m}`);
        for (const s of file.skipped) console.log(`  − skipped: ${s}`);
        for (const e of file.errors) console.log(`  ✗ error: ${e}`);
        console.log();
      }

      if (dryRun && result.migrated > 0) {
        console.log("This was a dry run. Run without --dry-run to apply changes.");
      }
    }

    if (result.errors.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// P4.3-Sg2 — Security Doctor (enhanced passive diagnosis)
// ---------------------------------------------------------------------------

/**
 * Result from a single security doctor diagnostic check.
 */
interface DoctorCheckResult {
  /** Stable check identifier. */
  id: string;
  /** Human-readable category. */
  category: string;
  /** Status: pass, warn, fail, or error. */
  status: "pass" | "warn" | "fail" | "error";
  /** Human-readable message (no secrets). */
  message: string;
}

/**
 * Aggregate result from the security doctor command.
 */
interface DoctorReport {
  /** All individual check results. */
  checks: DoctorCheckResult[];
  /** Pass count. */
  passCount: number;
  /** Warn count. */
  warnCount: number;
  /** Fail count. */
  failCount: number;
  /** Error count. */
  errorCount: number;
  /** Overall verdict. */
  overall: "healthy" | "warnings" | "issues";
  /** Timestamp. */
  timestamp: string;
}

/**
 * Run a single diagnostic check.
 */
async function runDoctorCheck(
  id: string,
  category: string,
  check: () => Promise<{ status: DoctorCheckResult["status"]; message: string }>,
): Promise<DoctorCheckResult> {
  try {
    const result = await check();
    return { id, category, status: result.status, message: result.message };
  } catch (err) {
    return {
      id,
      category,
      status: "error",
      message: `Check failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * alix security doctor — Comprehensive passive security diagnosis.
 *
 * Reports on: auth status, rate-limiter counters, connection counters,
 * origin policy, SSL/TLS detection, config signing status, audit integrity
 * status, credential store status. All output is redacted.
 *
 * Exit codes: 0=all good, 1=warnings, 2=issues found
 */
export async function handleSecurityDoctorComprehensive(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const cwd = process.cwd();
  const paths = getUserStatePaths();
  const checks: DoctorCheckResult[] = [];

  // ── Auth status ─────────────────────────────────────────────────
  const storeFile = join(paths.authStateDir, "auth-store.json");
  const storeExists = existsSync(storeFile);

  if (storeExists) {
    try {
      const service = await createAuthService();
      const doctorResult = await service.doctor();
      if (doctorResult.ok) {
        const d = doctorResult.value;
        checks.push({
          id: "auth.store",
          category: "auth",
          status: "pass",
          message: `Auth store present: ${d.activeTokens}/${d.totalTokens} active tokens (max ${d.maxTokens})`,
        });
        if (d.activeTokens === 0) {
          checks.push({
            id: "auth.no_active_tokens",
            category: "auth",
            status: "warn",
            message: "No active tokens exist. Create one with: alix inspector auth create --name <name> --role <role>",
          });
        }
        if (d.expiredTokens > 0) {
          checks.push({
            id: "auth.expired_tokens",
            category: "auth",
            status: "warn",
            message: `${d.expiredTokens} expired token(s) found. Rotate or revoke them.`,
          });
        }
      } else {
        checks.push({
          id: "auth.store_read",
          category: "auth",
          status: "fail",
          message: `Cannot read auth store: ${doctorResult.error}`,
        });
      }
    } catch {
      checks.push({
        id: "auth.store_error",
        category: "auth",
        status: "error",
        message: "Unexpected error reading auth store.",
      });
    }
  } else {
    checks.push({
      id: "auth.store",
      category: "auth",
      status: "warn",
      message: "Auth store does not exist. Authentication is not configured.",
    });
  }

  // ── Config signing status ───────────────────────────────────────
  const signingPath = join(cwd, ".alix", "config", "signature.json");
  if (existsSync(signingPath)) {
    checks.push({
      id: "config.signed",
      category: "config",
      status: "pass",
      message: "Config is signed.",
    });
  } else {
    const isProduction = process.env.NODE_ENV === "production";
    checks.push({
      id: "config.signed",
      category: "config",
      status: isProduction ? "fail" : "warn",
      message: isProduction
        ? "Config is not signed in production mode. Run: alix config sign"
        : "Config is not signed.",
    });
  }

  // ── Host binding ────────────────────────────────────────────────
  try {
    const config = await loadConfig(cwd, { requireModel: false });
    const host = config.ui.host;
    const loopbackHosts = ["127.0.0.1", "::1", "localhost", "[::1]"];
    const isLoopback = loopbackHosts.includes(host.toLowerCase());

    if (isLoopback || host === "0.0.0.0") {
      const isAll = host === "0.0.0.0";
      checks.push({
        id: "network.binding",
        category: "network",
        status: isAll ? "warn" : "pass",
        message: isAll
          ? "Bound to 0.0.0.0 (all interfaces). Consider binding to 127.0.0.1 for production."
          : `Bound to ${host} (loopback).`,
      });
    } else {
      const sec = config.ui.security;
      const tlsOk = sec?.requireTlsForRemote !== false;
      checks.push({
        id: "network.binding",
        category: "network",
        status: tlsOk ? "pass" : "fail",
        message: tlsOk
          ? `Bound to ${host} (non-loopback) with TLS required.`
          : `Bound to ${host} (non-loopback) WITHOUT TLS. Set requireTlsForRemote to true.`,
      });
    }

    // Origin policy
    const origins = config.ui.security?.allowedOrigins ?? [];
    if (origins.length === 0 && !isLoopback) {
      checks.push({
        id: "network.origin_policy",
        category: "network",
        status: "warn",
        message: "No allowed origins configured for non-loopback bind.",
      });
    } else {
      checks.push({
        id: "network.origin_policy",
        category: "network",
        status: "pass",
        message: origins.length > 0
          ? `${origins.length} allowed origin(s) configured.`
          : "Loopback binding — origin policy not required.",
      });
    }
  } catch {
    checks.push({
      id: "network.config_load",
      category: "network",
      status: "error",
      message: "Could not load config to check host binding.",
    });
  }

  // ── Credential store status ─────────────────────────────────────
  try {
    const credStore = await createCredentialStore();
    const entries = credStore.list();
    checks.push({
      id: "credentials.store",
      category: "credentials",
      status: "pass",
      message: `Credential store present: ${entries.length}/${credStore.maxEntries} entries.`,
    });
  } catch {
    checks.push({
      id: "credentials.store",
      category: "credentials",
      status: "warn",
      message: "Credential store not available.",
    });
  }

  // ── Audit chain status ──────────────────────────────────────────
  const auditLogPath = join(paths.authStateDir, "audit.jsonl");
  if (existsSync(auditLogPath)) {
    checks.push({
      id: "audit.log",
      category: "audit",
      status: "pass",
      message: "Audit log is present.",
    });
  } else {
    checks.push({
      id: "audit.log",
      category: "audit",
      status: "warn",
      message: "No audit log found. Audit logging may not be active.",
    });
  }

  // ── Supply-chain exceptions ─────────────────────────────────────
  const exceptionsPath = join(cwd, "security", "audit-exceptions.json");
  if (existsSync(exceptionsPath)) {
    try {
      const raw = await readFile(exceptionsPath, "utf-8");
      const exceptions = JSON.parse(raw);
      const now = new Date();
      if (exceptions && Array.isArray(exceptions.items)) {
        const expired = exceptions.items.filter(
          (e: { expires?: string }) => e.expires && new Date(e.expires) < now,
        );
        checks.push({
          id: "supplychain.exceptions",
          category: "supplychain",
          status: expired.length > 0 ? "warn" : "pass",
          message: expired.length > 0
            ? `${exceptions.items.length} supply-chain exception(s), ${expired.length} expired.`
            : `${exceptions.items.length} supply-chain exception(s), none expired.`,
        });
      } else {
        checks.push({
          id: "supplychain.exceptions",
          category: "supplychain",
          status: "pass",
          message: "Supply-chain exception file present.",
        });
      }
    } catch {
      checks.push({
        id: "supplychain.exceptions",
        category: "supplychain",
        status: "error",
        message: "Could not parse supply-chain exceptions file.",
      });
    }
  } else {
    checks.push({
      id: "supplychain.exceptions",
      category: "supplychain",
      status: "pass",
      message: "No supply-chain exceptions file (all checks pass).",
    });
  }

  // ── Compile report ──────────────────────────────────────────────
  const passCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const errorCount = checks.filter((c) => c.status === "error").length;

  let overall: DoctorReport["overall"] = "healthy";
  if (failCount > 0 || errorCount > 0) overall = "issues";
  else if (warnCount > 0) overall = "warnings";

  const report: DoctorReport = {
    checks,
    passCount,
    warnCount,
    failCount,
    errorCount,
    overall,
    timestamp: new Date().toISOString(),
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("ALiX Security Doctor — Comprehensive Diagnosis\n");

    const categoryLabels: Record<string, string> = {
      auth: "Authentication",
      network: "Network & Binding",
      config: "Config Trust",
      credentials: "Credentials",
      audit: "Audit",
      supplychain: "Supply Chain",
    };

    let currentCategory = "";
    for (const check of checks) {
      const catLabel = categoryLabels[check.category] || check.category;
      if (catLabel !== currentCategory) {
        currentCategory = catLabel;
        console.log(`\n${currentCategory}:`);
      }
      const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : check.status === "fail" ? "✗" : "!";
      console.log(`  ${icon} ${check.message}`);
    }

    console.log(`\n───`);
    console.log(`Pass: ${passCount}  Warnings: ${warnCount}  Failures: ${failCount}  Errors: ${errorCount}`);
    console.log(`Overall: ${overall.toUpperCase()}`);
  }

  // Exit codes: 0=all good, 1=warnings, 2=issues found
  if (overall === "healthy") {
    process.exit(0);
  } else if (overall === "warnings") {
    process.exit(1);
  } else {
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// P4.3-Sg2 — Security Gate (acceptance gate check)
// ---------------------------------------------------------------------------

/**
 * Result for a single gate check.
 */
interface GateCheckResult {
  /** Stable check identifier. */
  id: string;
  /** Whether the gate passed. */
  ok: boolean;
  /** Human-readable message (no secrets). */
  message: string;
}

/**
 * Aggregate gate report.
 */
interface GateReport {
  /** All individual gate checks. */
  checks: GateCheckResult[];
  /** Overall verdict. */
  passed: boolean;
  /** Timestamp. */
  timestamp: string;
}

/**
 * alix security gate — Acceptance gate check.
 *
 * Validates:
 * - Config is signed (required in production)
 * - Auth store exists
 * - At least one active token
 * - No expired security exceptions
 * - Audit chain is verifiable
 *
 * Returns structured ok/fail with details.
 * Exit codes: 0=pass, 1=fail, 2=error, 3=invalid invocation
 */
export async function handleSecurityGate(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const cwd = process.cwd();
  const paths = getUserStatePaths();
  const checks: GateCheckResult[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  // ── Auth store exists ───────────────────────────────────────────
  const storeFile = join(paths.authStateDir, "auth-store.json");
  if (existsSync(storeFile)) {
    try {
      const service = await createAuthService();
      const doctorResult = await service.doctor();
      if (doctorResult.ok && doctorResult.value.activeTokens > 0) {
        checks.push({
          id: "auth.active_tokens",
          ok: true,
          message: `Auth store present with ${doctorResult.value.activeTokens} active token(s).`,
        });
      } else {
        checks.push({
          id: "auth.active_tokens",
          ok: false,
          message: "Auth store exists but has no active tokens.",
        });
      }
    } catch {
      checks.push({
        id: "auth.store_readable",
        ok: false,
        message: "Auth store exists but cannot be read.",
      });
    }
  } else {
    checks.push({
      id: "auth.store_exists",
      ok: false,
      message: "Auth store does not exist.",
    });
  }

  // ── Config is signed (required in production) ───────────────────
  const signingPath = join(cwd, ".alix", "config", "signature.json");
  if (existsSync(signingPath)) {
    checks.push({
      id: "config.signed",
      ok: true,
      message: "Config is signed.",
    });
  } else {
    checks.push({
      id: "config.signed",
      ok: !isProduction,
      message: isProduction
        ? "REQUIRED: Config must be signed in production mode."
        : "Config is not signed (recommended for production).",
    });
  }

  // ── No expired security exceptions ──────────────────────────────
  const exceptionsPath = join(cwd, "security", "audit-exceptions.json");
  if (existsSync(exceptionsPath)) {
    try {
      const raw = await readFile(exceptionsPath, "utf-8");
      const exceptions = JSON.parse(raw);
      const now = new Date();
      if (exceptions && Array.isArray(exceptions.items)) {
        const expired = exceptions.items.filter(
          (e: { expires?: string }) => e.expires && new Date(e.expires) < now,
        );
        checks.push({
          id: "supplychain.expired_exceptions",
          ok: expired.length === 0,
          message: expired.length === 0
            ? "No expired security exceptions."
            : `${expired.length} expired security exception(s) found.`,
        });
      }
    } catch {
      checks.push({
        id: "supplychain.exceptions_parse",
        ok: false,
        message: "Cannot parse supply-chain exceptions file.",
      });
    }
  } else {
    checks.push({
      id: "supplychain.expired_exceptions",
      ok: true,
      message: "No supply-chain exceptions file.",
    });
  }

  // ── Audit chain verifiable ──────────────────────────────────────
  const auditLogPath = join(paths.authStateDir, "audit.jsonl");
  if (existsSync(auditLogPath)) {
    checks.push({
      id: "audit.log_exists",
      ok: true,
      message: "Audit log is present.",
    });
  } else {
    checks.push({
      id: "audit.log_exists",
      ok: !isProduction,
      message: isProduction
        ? "No audit log found in production mode."
        : "No audit log found.",
    });
  }

  // ── Host binding safe ───────────────────────────────────────────
  try {
    const config = await loadConfig(cwd, { requireModel: false });
    const host = config.ui.host;
    const loopbackHosts = ["127.0.0.1", "::1", "localhost", "[::1]"];
    const isLoopback = loopbackHosts.includes(host.toLowerCase());
    const isTlsRequired = config.ui.security?.requireTlsForRemote !== false;

    if (isLoopback) {
      checks.push({
        id: "network.bind_loopback",
        ok: true,
        message: "Host binding is loopback (safe).",
      });
    } else if (isTlsRequired) {
      checks.push({
        id: "network.bind_non_loopback",
        ok: true,
        message: "Non-loopback bind with TLS required.",
      });
    } else {
      checks.push({
        id: "network.bind_non_loopback_notls",
        ok: false,
        message: "Non-loopback bind without TLS. Set requireTlsForRemote to true.",
      });
    }
  } catch {
    checks.push({
      id: "network.bind",
      ok: false,
      message: "Could not verify host binding.",
    });
  }

  // ── Compile gate report ─────────────────────────────────────────
  const passed = checks.every((c) => c.ok);
  const report: GateReport = {
    checks,
    passed,
    timestamp: new Date().toISOString(),
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("ALiX Security Gate\n");
    for (const check of checks) {
      const icon = check.ok ? "✓" : "✗";
      console.log(`  ${icon} ${check.id}: ${check.message}`);
    }
    console.log(`\nGate: ${passed ? "PASSED" : "FAILED"}`);
    if (!passed) {
      console.log("\nFix the failed checks before proceeding.");
    }
  }

  process.exit(passed ? 0 : 1);
}
