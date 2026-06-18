/**
 * P4.3-Sf.1 — Lifecycle-script inventory and allowlist enforcement.
 *
 * Inspects package-lock.json for packages with lifecycle scripts, checks them
 * against a curated allowlist, and returns a structured result including new
 * (unapproved) packages and expired entries.
 *
 * CLI: alix security supply-chain lifecycle-check
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Error codes (stable — never change these strings)
// ---------------------------------------------------------------------------

export const LIFECYCLE_ERROR_CODES = {
  /** A new package with lifecycle scripts was found that is not in the allowlist. */
  UNEXPECTED_LIFECYCLE_SCRIPT: "SC_LIFECYCLE_UNEXPECTED" as const,
  /** An allowlist entry has expired and must be renewed. */
  ALLOWLIST_ENTRY_EXPIRED: "SC_LIFECYCLE_EXPIRED" as const,
  /** The package-lock.json file could not be read or parsed. */
  LOCKFILE_UNREADABLE: "SC_LOCKFILE_UNREADABLE" as const,
  /** The allowlist file could not be read or parsed. */
  ALLOWLIST_UNREADABLE: "SC_ALLOWLIST_UNREADABLE" as const,
  /** The lockfile is missing required fields. */
  LOCKFILE_MALFORMED: "SC_LOCKFILE_MALFORMED" as const,
  /** The lockfile is not present. */
  LOCKFILE_MISSING: "SC_LOCKFILE_MISSING" as const,
} as const;

export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[keyof typeof LIFECYCLE_ERROR_CODES];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LifecycleScriptPackage {
  /** Package name. */
  name: string;
  /** Installed version. */
  version: string;
  /** Path within node_modules (lockfile key). */
  nodeModulesPath: string;
  /** Whether the package is a direct dependency (vs transitive). */
  isDirect: boolean;
}

export interface AllowlistEntry {
  name: string;
  versionRange: string;
  scripts: string[];
  reason: string;
  owner: string;
  created: string;
  expiry: string;
}

export interface AllowlistFile {
  description?: string;
  lastReviewed?: string;
  policy?: {
    failOnNew?: boolean;
    failOnExpired?: boolean;
    expiryWindowDays?: number;
    allowDevOnlyScripts?: boolean;
  };
  packages: AllowlistEntry[];
}

export interface LifecycleFinding {
  code: LifecycleErrorCode;
  severity: "error" | "warning";
  message: string;
  package?: LifecycleScriptPackage;
  details?: string;
}

export interface LifecycleCheckResult {
  /** Overall pass/fail. */
  ok: boolean;
  /** Total packages with lifecycle scripts found. */
  totalLifecyclePackages: number;
  /** Packages that are approved in the allowlist. */
  approved: LifecycleScriptPackage[];
  /** Packages with lifecycle scripts NOT in the allowlist. */
  newUnapproved: LifecycleScriptPackage[];
  /** Allowlist entries that have expired. */
  expiredEntries: AllowlistEntry[];
  /** Individual findings (errors + warnings). */
  findings: LifecycleFinding[];
}

// ---------------------------------------------------------------------------
// Lockfile parsing
// ---------------------------------------------------------------------------

interface LockfilePackage {
  name?: string;
  version?: string;
  hasInstallScript?: boolean;
  link?: boolean;
}

interface PackageLock {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<string, LockfilePackage>;
}

/**
 * Extract packages with lifecycle scripts from a package-lock.json object.
 */
export function extractLifecyclePackages(
  lockfile: PackageLock
): { packages: LifecycleScriptPackage[]; error?: LifecycleFinding } {
  if (!lockfile || !lockfile.packages) {
    return {
      packages: [],
      error: {
        code: LIFECYCLE_ERROR_CODES.LOCKFILE_MALFORMED,
        severity: "error",
        message: "package-lock.json is missing the 'packages' field (lockfileVersion >= 3 required).",
      },
    };
  }

  const directDeps = new Set<string>();
  // Direct dependencies are listed at the root level under node_modules/<name>
  for (const [key, pkg] of Object.entries(lockfile.packages)) {
    if (key === "" && pkg) {
      // The empty string key represents the root package
      // Direct dependencies are in node_modules/<name>
      const rootPkg = pkg as Record<string, unknown>;
      const deps = (rootPkg as any).dependencies ?? {};
      const devDeps = (rootPkg as any).devDependencies ?? {};
      for (const dep of Object.keys(deps)) directDeps.add(dep);
      for (const dep of Object.keys(devDeps)) directDeps.add(dep);
    }
  }

  const packages: LifecycleScriptPackage[] = [];

  for (const [key, pkg] of Object.entries(lockfile.packages)) {
    if (key === "") continue; // skip root
    if (!pkg.hasInstallScript) continue;
    if (pkg.link) continue; // skip linked packages

    const name = pkg.name ?? key.split("node_modules/").pop() ?? key;
    const version = pkg.version ?? "unknown";
    const isDirect = directDeps.has(name);

    packages.push({ name, version, nodeModulesPath: key, isDirect });
  }

  return { packages };
}

// ---------------------------------------------------------------------------
// Version range matching
// ---------------------------------------------------------------------------

/**
 * Simple semver range check. Supports exact, >=, <=, >, <, and hyphen ranges.
 * This is intentionally minimal — complex ranges should be reviewed manually.
 */
export function versionMatches(version: string, range: string): boolean {
  // Split into clean parts
  const v = version.replace(/^v/, "");

  // Exact match
  if (range === v) return true;

  // Star wildcard
  if (range === "*" || range === ">=0.0.0") return true;

  // Compound ranges like ">=6.0.0 <=7.6.2"
  const parts = range.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.every((p) => versionMatches(v, p));
  }

  // >= check
  if (range.startsWith(">=")) {
    return compareVersions(v, range.slice(2)) >= 0;
  }
  // <= check
  if (range.startsWith("<=")) {
    return compareVersions(v, range.slice(2)) <= 0;
  }
  // > check
  if (range.startsWith(">")) {
    return compareVersions(v, range.slice(1)) > 0;
  }
  // < check
  if (range.startsWith("<")) {
    return compareVersions(v, range.slice(1)) < 0;
  }
  // ^ range — within same major
  if (range.startsWith("^")) {
    const min = range.slice(1);
    const max = bumpMajor(min);
    return compareVersions(v, min) >= 0 && compareVersions(v, max) < 0;
  }
  // ~ range — within same minor
  if (range.startsWith("~")) {
    const min = range.slice(1);
    const max = bumpMinor(min);
    return compareVersions(v, min) >= 0 && compareVersions(v, max) < 0;
  }
  // No operator — treat as >= (minimum version)
  return compareVersions(v, range) >= 0;
}

function bumpMajor(v: string): string {
  const parts = v.split(".").map(Number);
  parts[0] = (parts[0] || 0) + 1;
  if (parts.length > 1) parts[1] = 0;
  if (parts.length > 2) parts[2] = 0;
  return parts.join(".");
}

function bumpMinor(v: string): string {
  const parts = v.split(".").map(Number);
  parts[1] = (parts[1] || 0) + 1;
  if (parts.length > 2) parts[2] = 0;
  return parts.join(".");
}

/**
 * Compare two semver version strings. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.replace(/^v/, "").split(".").map(Number);
  const bParts = b.replace(/^v/, "").split(".").map(Number);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Allowlist loading
// ---------------------------------------------------------------------------

/**
 * Load and parse the lifecycle-script allowlist file.
 */
export async function loadAllowlist(
  allowlistPath: string
): Promise<{ allowlist: AllowlistFile | null; error?: LifecycleFinding }> {
  try {
    const raw = await readFile(allowlistPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed.packages || !Array.isArray(parsed.packages)) {
      return {
        allowlist: null,
        error: {
          code: LIFECYCLE_ERROR_CODES.ALLOWLIST_UNREADABLE,
          severity: "error",
          message: "Allowlist is missing the 'packages' array.",
          details: `Path: ${allowlistPath}`,
        },
      };
    }

    // Validate each entry
    for (let i = 0; i < parsed.packages.length; i++) {
      const entry = parsed.packages[i];
      if (!entry.name || !entry.versionRange) {
        return {
          allowlist: null,
          error: {
            code: LIFECYCLE_ERROR_CODES.ALLOWLIST_UNREADABLE,
            severity: "error",
            message: `Allowlist entry ${i} is missing required fields (name, versionRange).`,
            details: JSON.stringify(entry),
          },
        };
      }
    }

    return { allowlist: parsed as AllowlistFile };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        allowlist: null,
        error: {
          code: LIFECYCLE_ERROR_CODES.ALLOWLIST_UNREADABLE,
          severity: "error",
          message: "Lifecycle script allowlist file not found.",
          details: `Expected at: ${allowlistPath}`,
        },
      };
    }
    return {
      allowlist: null,
      error: {
        code: LIFECYCLE_ERROR_CODES.ALLOWLIST_UNREADABLE,
        severity: "error",
        message: "Failed to parse lifecycle script allowlist.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Policy check
// ---------------------------------------------------------------------------

/**
 * Check all lifecycle-script packages against the allowlist.
 */
export function checkLifecyclePolicy(
  lockfilePackages: LifecycleScriptPackage[],
  allowlist: AllowlistFile,
  now: Date = new Date()
): LifecycleCheckResult {
  const entries = allowlist.packages ?? [];
  const policy = allowlist.policy ?? {};
  const findings: LifecycleFinding[] = [];
  const approved: LifecycleScriptPackage[] = [];
  const newUnapproved: LifecycleScriptPackage[] = [];
  const expiredEntries: AllowlistEntry[] = [];

  // Check each lockfile package against the allowlist
  for (const pkg of lockfilePackages) {
    const match = entries.find(
      (e) => e.name === pkg.name && versionMatches(pkg.version, e.versionRange)
    );

    if (match) {
      // Check expiry
      if (match.expiry) {
        const expiryDate = new Date(match.expiry);
        if (now >= expiryDate) {
          expiredEntries.push(match);
          if (policy.failOnExpired !== false) {
            findings.push({
              code: LIFECYCLE_ERROR_CODES.ALLOWLIST_ENTRY_EXPIRED,
              severity: "error",
              message: `Allowlist entry for "${pkg.name}" expired on ${match.expiry}.`,
              package: pkg,
              details: `Owner: ${match.owner}. Reason: ${match.reason}`,
            });
          }
        }
      }
      approved.push(pkg);
    } else {
      newUnapproved.push(pkg);
      if (policy.failOnNew !== false) {
        findings.push({
          code: LIFECYCLE_ERROR_CODES.UNEXPECTED_LIFECYCLE_SCRIPT,
          severity: "error",
          message: `Package "${pkg.name}@${pkg.version}" has lifecycle scripts but is not in the allowlist.`,
          package: pkg,
          details:
            "Add this package to security/lifecycle-script-allowlist.json with a reason, owner, and expiry date.",
        });
      }
    }
  }

  // Also check for expired entries not matched by any current package
  for (const entry of entries) {
    if (entry.expiry) {
      const expiryDate = new Date(entry.expiry);
      if (now >= expiryDate) {
        const isCurrentlyUsed = lockfilePackages.some(
          (p) => p.name === entry.name && versionMatches(p.version, entry.versionRange)
        );
        if (isCurrentlyUsed && !expiredEntries.includes(entry)) {
          expiredEntries.push(entry);
          if (policy.failOnExpired !== false) {
            findings.push({
              code: LIFECYCLE_ERROR_CODES.ALLOWLIST_ENTRY_EXPIRED,
              severity: "error",
              message: `Allowlist entry for "${entry.name}" expired on ${entry.expiry}.`,
              details: `Owner: ${entry.owner}. Reason: ${entry.reason}`,
            });
          }
        }
      }
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  const ok = errors.length === 0;

  return {
    ok,
    totalLifecyclePackages: lockfilePackages.length,
    approved,
    newUnapproved,
    expiredEntries,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function runLifecycleCheck(
  projectRoot: string,
  allowlistRelPath: string = "security/lifecycle-script-allowlist.json"
): Promise<LifecycleCheckResult> {
  const lockfilePath = resolve(projectRoot, "package-lock.json");
  const allowlistPath = resolve(projectRoot, allowlistRelPath);

  // Load lockfile
  let lockfile: PackageLock;
  try {
    const raw = await readFile(lockfilePath, "utf-8");
    lockfile = JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        totalLifecyclePackages: 0,
        approved: [],
        newUnapproved: [],
        expiredEntries: [],
        findings: [
          {
            code: LIFECYCLE_ERROR_CODES.LOCKFILE_MISSING,
            severity: "error",
            message: "package-lock.json not found. Run npm install to generate it.",
            details: `Expected at: ${lockfilePath}`,
          },
        ],
      };
    }
    return {
      ok: false,
      totalLifecyclePackages: 0,
      approved: [],
      newUnapproved: [],
      expiredEntries: [],
      findings: [
        {
          code: LIFECYCLE_ERROR_CODES.LOCKFILE_UNREADABLE,
          severity: "error",
          message: "Failed to read or parse package-lock.json.",
          details: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  // Extract lifecycle packages
  const { packages, error: extractError } = extractLifecyclePackages(lockfile);
  if (extractError) {
    return {
      ok: false,
      totalLifecyclePackages: 0,
      approved: [],
      newUnapproved: [],
      expiredEntries: [],
      findings: [extractError],
    };
  }

  // Load allowlist
  const { allowlist, error: allowlistError } = await loadAllowlist(allowlistPath);
  if (!allowlist) {
    return {
      ok: false,
      totalLifecyclePackages: packages.length,
      approved: [],
      newUnapproved: [],
      expiredEntries: [],
      findings: allowlistError
        ? [allowlistError]
        : [
            {
              code: LIFECYCLE_ERROR_CODES.ALLOWLIST_UNREADABLE,
              severity: "error",
              message: "Failed to load lifecycle script allowlist.",
            },
          ],
    };
  }

  return checkLifecyclePolicy(packages, allowlist);
}
