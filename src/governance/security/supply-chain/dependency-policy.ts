/**
 * P4.3-Sf.1 — Lifecycle-script inventory and allowlist enforcement.
 *
 * Inspects package-lock.json (npm) or pnpm-lock.yaml + node_modules (pnpm)
 * for packages with lifecycle scripts, checks them against a curated
 * allowlist, and returns a structured result including new (unapproved)
 * packages and expired entries.
 *
 * CLI: alix security supply-chain lifecycle-check
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import yaml from "yaml";

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
// pnpm support: pnpm-lock.yaml carries no per-package script flags, so the
// installed node_modules tree is the source of truth for what will execute.
// Gated on pnpm-lock.yaml presence — no lockfile at all stays an error.
// ---------------------------------------------------------------------------

/** Lifecycle script keys npm/pnpm execute around install (matches npm's hasInstallScript). */
const LIFECYCLE_SCRIPT_KEYS = ["preinstall", "install", "postinstall"] as const;

function hasLifecycleScript(pkgJson: Record<string, unknown>): boolean {
  const scripts = pkgJson.scripts;
  if (!scripts || typeof scripts !== "object") return false;
  return LIFECYCLE_SCRIPT_KEYS.some(
    (key) => typeof (scripts as Record<string, unknown>)[key] === "string"
  );
}

/**
 * Extract packages with lifecycle scripts from an installed pnpm
 * node_modules tree. Directness comes from the root package.json
 * (dependencies + devDependencies), mirroring the npm extractor.
 */
export async function extractPnpmLifecyclePackages(
  projectRoot: string
): Promise<{ packages: LifecycleScriptPackage[]; error?: LifecycleFinding }> {
  // Gate: a pnpm lockfile must pin what's installed.
  try {
    const raw = await readFile(resolve(projectRoot, "pnpm-lock.yaml"), "utf-8");
    const parsed: unknown = yaml.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {
        packages: [],
        error: {
          code: LIFECYCLE_ERROR_CODES.LOCKFILE_MALFORMED,
          severity: "error",
          message: "pnpm-lock.yaml could not be parsed as a lockfile mapping.",
        },
      };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        packages: [],
        error: {
          code: LIFECYCLE_ERROR_CODES.LOCKFILE_MISSING,
          severity: "error",
          message: "Neither package-lock.json nor pnpm-lock.yaml found. Run npm install or pnpm install to generate one.",
          details: `Expected at: ${resolve(projectRoot, "package-lock.json")} or ${resolve(projectRoot, "pnpm-lock.yaml")}`,
        },
      };
    }
    return {
      packages: [],
      error: {
        code: LIFECYCLE_ERROR_CODES.LOCKFILE_UNREADABLE,
        severity: "error",
        message: "Failed to read or parse pnpm-lock.yaml.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Direct dependencies from the root package.json (display-only field;
  // unknown root falls back to "all transitive" rather than failing).
  const directDeps = new Set<string>();
  try {
    const rootPkg = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(rootPkg.dependencies ?? {})) directDeps.add(dep);
    for (const dep of Object.keys(rootPkg.devDependencies ?? {})) directDeps.add(dep);
  } catch {
    // No readable root package.json — every package reports transitive.
  }

  // Installed tree must exist; without it nothing can be verified (fail-closed).
  const nodeModulesDir = resolve(projectRoot, "node_modules");
  let entries;
  try {
    entries = await readdir(nodeModulesDir, { withFileTypes: true });
  } catch (err) {
    return {
      packages: [],
      error: {
        code: LIFECYCLE_ERROR_CODES.LOCKFILE_UNREADABLE,
        severity: "error",
        message: "node_modules cannot be read; run pnpm install so installed packages can be verified.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Install roots: top-level links (pnpm links each direct dep here; the
  // right isDirect flag comes from the root package.json) plus every
  // package under the .pnpm store (transitive deps execute install scripts
  // too, so top level alone would miss them). Scoped dirs (@org) expand
  // one level. Dedupe by name@version — a top-level link and its store
  // target are the same installed package.
  const packages: LifecycleScriptPackage[] = [];
  const seen = new Set<string>();
  const consider = async (relPath: string): Promise<void> => {
    let pkgJson: Record<string, unknown>;
    try {
      pkgJson = JSON.parse(
        await readFile(join(nodeModulesDir, relPath, "package.json"), "utf-8")
      ) as Record<string, unknown>;
    } catch {
      return; // Broken entry — nothing executable without a manifest.
    }
    if (!hasLifecycleScript(pkgJson)) return;
    const name = typeof pkgJson.name === "string" ? pkgJson.name : relPath;
    const version = typeof pkgJson.version === "string" ? pkgJson.version : "unknown";
    const key = `${name}@${version}`;
    if (seen.has(key)) return;
    seen.add(key);
    packages.push({
      name,
      version,
      nodeModulesPath: `node_modules/${relPath}`,
      isDirect: directDeps.has(name),
    });
  };

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === ".pnpm") continue; // handled below
    if (entry.name.startsWith("@")) {
      let scoped;
      try {
        scoped = await readdir(join(nodeModulesDir, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of scoped) {
        if (child.name.startsWith(".")) continue;
        if (!child.isDirectory() && !child.isSymbolicLink()) continue;
        await consider(`${entry.name}/${child.name}`);
      }
      continue;
    }
    await consider(entry.name);
  }

  // Transitive store: .pnpm/<key>/node_modules/<pkg> (+ scoped). One level
  // matches pnpm's layout; peer-nested stores resolve through the same
  // top-level links already inventoried, so deeper recursion adds nothing.
  let storeKeys;
  try {
    storeKeys = await readdir(join(nodeModulesDir, ".pnpm"), { withFileTypes: true });
  } catch {
    return { packages };
  }
  for (const keyDir of storeKeys) {
    if (keyDir.name.startsWith(".")) continue;
    if (!keyDir.isDirectory() && !keyDir.isSymbolicLink()) continue;
    const storeModules = join(nodeModulesDir, ".pnpm", keyDir.name, "node_modules");
    let storePkgs;
    try {
      storePkgs = await readdir(storeModules, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const pkg of storePkgs) {
      if (pkg.name.startsWith(".")) continue;
      if (!pkg.isDirectory() && !pkg.isSymbolicLink()) continue;
      if (pkg.name.startsWith("@")) {
        let scoped;
        try {
          scoped = await readdir(join(storeModules, pkg.name), { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of scoped) {
          if (child.name.startsWith(".")) continue;
          if (!child.isDirectory() && !child.isSymbolicLink()) continue;
          await consider(`.pnpm/${keyDir.name}/node_modules/${pkg.name}/${child.name}`);
        }
        continue;
      }
      await consider(`.pnpm/${keyDir.name}/node_modules/${pkg.name}`);
    }
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

  // Load lockfile (npm preferred; pnpm fallback gated on pnpm-lock.yaml)
  let packages: LifecycleScriptPackage[];
  try {
    const raw = await readFile(lockfilePath, "utf-8");
    const lockfile: PackageLock = JSON.parse(raw);
    const { packages: npmPackages, error: extractError } = extractLifecyclePackages(lockfile);
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
    packages = npmPackages;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const { packages: pnpmPackages, error: pnpmError } = await extractPnpmLifecyclePackages(projectRoot);
      if (pnpmError) {
        return {
          ok: false,
          totalLifecyclePackages: 0,
          approved: [],
          newUnapproved: [],
          expiredEntries: [],
          findings: [pnpmError],
        };
      }
      packages = pnpmPackages;
    } else {
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
