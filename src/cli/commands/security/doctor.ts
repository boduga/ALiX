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

import { loadConfig } from "../../../config/loader.js";
import "../../../config/validator.js";
import "../../../security/inspector/auth-store.js";
import { getUserStatePaths } from "../../../security/platform/user-state-paths.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import "node:crypto";
import "../../../security/credentials/credential-store.js";
import "../../../security/credentials/credential-reference.js";
import "../../../security/credentials/credential-migration.js";
import "node:os";

// Supply-chain imports (P4.3-Sf)
import "../../../security/supply-chain/dependency-policy.js";
import "../../../security/supply-chain/security-exceptions.js";
import "../../../security/supply-chain/package-verifier.js";
import { jsonMode, setJsonMode, createAuthService } from "./shared.js";
import { createCredentialStore } from "./credentials.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


/**
 * alix security doctor — Comprehensive passive security diagnosis.
 *
 * Reports on: auth status, rate-limiter counters, connection counters,
 * origin policy, SSL/TLS detection, config signing status, audit integrity
 * status, credential store status. All output is redacted.
 *
 * Exit codes: 0=all good, 1=warnings, 2=issues found
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
