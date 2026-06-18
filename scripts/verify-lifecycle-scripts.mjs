#!/usr/bin/env node

/**
 * P4.3-Sf.1 — Verify lifecycle scripts against allowlist.
 *
 * Reads package-lock.json and the lifecycle-script allowlist, then
 * checks for unapproved or expired entries. Outputs results to stdout
 * and exits with code 0 (pass) or 1 (fail).
 *
 * Usage:
 *   node scripts/verify-lifecycle-scripts.mjs [--json]
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const jsonMode = process.argv.includes("--json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compareVersions(a, b) {
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

function versionMatches(version, range) {
  const v = version.replace(/^v/, "");
  if (range === "*" || range === ">=0.0.0") return true;

  const parts = range.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts.every((p) => versionMatches(v, p));

  if (range.startsWith(">=")) return compareVersions(v, range.slice(2)) >= 0;
  if (range.startsWith("<=")) return compareVersions(v, range.slice(2)) <= 0;
  if (range.startsWith(">")) return compareVersions(v, range.slice(1)) > 0;
  if (range.startsWith("<")) return compareVersions(v, range.slice(1)) < 0;
  if (range.startsWith("^")) {
    const min = range.slice(1);
    const parts = min.split(".").map(Number);
    parts[0] = (parts[0] || 0) + 1;
    if (parts.length > 1) parts[1] = 0;
    if (parts.length > 2) parts[2] = 0;
    const max = parts.join(".");
    return compareVersions(v, min) >= 0 && compareVersions(v, max) < 0;
  }
  if (range.startsWith("~")) {
    const min = range.slice(1);
    const parts = min.split(".").map(Number);
    parts[1] = (parts[1] || 0) + 1;
    if (parts.length > 2) parts[2] = 0;
    const max = parts.join(".");
    return compareVersions(v, min) >= 0 && compareVersions(v, max) < 0;
  }
  return compareVersions(v, range) >= 0;
}

// ---------------------------------------------------------------------------
// Load lockfile
// ---------------------------------------------------------------------------

let lockfile;
try {
  lockfile = JSON.parse(
    await readFile(resolve(projectRoot, "package-lock.json"), "utf-8")
  );
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("ERROR: package-lock.json not found.");
    process.exit(1);
  }
  console.error(`ERROR: failed to parse package-lock.json: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load allowlist
// ---------------------------------------------------------------------------

let allowlist;
try {
  allowlist = JSON.parse(
    await readFile(
      resolve(projectRoot, "security/lifecycle-script-allowlist.json"),
      "utf-8"
    )
  );
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("ERROR: security/lifecycle-script-allowlist.json not found.");
    process.exit(1);
  }
  console.error(`ERROR: failed to parse allowlist: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Extract and check
// ---------------------------------------------------------------------------

const entries = allowlist.packages ?? [];
const policy = allowlist.policy ?? {};
const now = new Date();

// Extract lifecycle packages
const packages = lockfile.packages ?? {};
const directDeps = new Set();
const rootPkg = packages[""] ?? {};
const deps = rootPkg.dependencies ?? {};
const devDeps = rootPkg.devDependencies ?? {};
for (const dep of Object.keys({ ...deps, ...devDeps })) directDeps.add(dep);

const lifecyclePackages = [];
for (const [key, pkg] of Object.entries(packages)) {
  if (key === "") continue;
  if (!pkg.hasInstallScript) continue;
  if (pkg.link) continue;

  const name = pkg.name ?? key.split("node_modules/").pop() ?? key;
  lifecyclePackages.push({
    name,
    version: pkg.version ?? "unknown",
    path: key,
    isDirect: directDeps.has(name),
  });
}

// Check each package
const findings = [];
const approved = [];
const newUnapproved = [];
const expiredEntries = [];

for (const pkg of lifecyclePackages) {
  const match = entries.find(
    (e) => e.name === pkg.name && versionMatches(pkg.version, e.versionRange)
  );

  if (match) {
    if (match.expiry && now >= new Date(match.expiry)) {
      expiredEntries.push(match);
      findings.push({
        code: "SC_LIFECYCLE_EXPIRED",
        severity: "error",
        message: `Allowlist entry for "${pkg.name}" expired on ${match.expiry}.`,
        package: pkg,
        details: `Owner: ${match.owner}. Reason: ${match.reason}`,
      });
    } else {
      approved.push(pkg);
    }
  } else {
    newUnapproved.push(pkg);
    findings.push({
      code: "SC_LIFECYCLE_UNEXPECTED",
      severity: "error",
      message: `Package "${pkg.name}@${pkg.version}" has lifecycle scripts but is not in the allowlist.`,
      package: pkg,
      details:
        "Add this package to security/lifecycle-script-allowlist.json with a reason, owner, and expiry date.",
    });
  }
}

// Check for expired entries not matched by any current package
for (const entry of entries) {
  if (entry.expiry && now >= new Date(entry.expiry)) {
    const isCurrentlyUsed = lifecyclePackages.some(
      (p) =>
        p.name === entry.name &&
        versionMatches(p.version, entry.versionRange)
    );
    if (isCurrentlyUsed && !expiredEntries.some((e) => e.name === entry.name)) {
      expiredEntries.push(entry);
      findings.push({
        code: "SC_LIFECYCLE_EXPIRED",
        severity: "error",
        message: `Allowlist entry for "${entry.name}" expired on ${entry.expiry}.`,
        details: `Owner: ${entry.owner}. Reason: ${entry.reason}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Output results
// ---------------------------------------------------------------------------

const errors = findings.filter((f) => f.severity === "error");
const ok = errors.length === 0;

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        ok,
        totalLifecyclePackages: lifecyclePackages.length,
        approved: approved.map((p) => p.name),
        newUnapproved: newUnapproved.map((p) => ({
          name: p.name,
          version: p.version,
          path: p.path,
          isDirect: p.isDirect,
        })),
        expiredEntries: expiredEntries.map((e) => e.name),
        findings,
      },
      null,
      2
    )
  );
} else {
  console.log(`Lifecycle Script Verification — ${ok ? "PASSED" : "FAILED"}\n`);
  console.log(`Total packages with lifecycle scripts: ${lifecyclePackages.length}`);
  console.log(`Approved: ${approved.length}`);
  console.log(`Unapproved: ${newUnapproved.length}`);
  console.log(`Expired entries: ${expiredEntries.length}`);
  console.log();

  if (newUnapproved.length > 0) {
    console.log("NEW UNAPPROVED PACKAGES:");
    for (const p of newUnapproved) {
      console.log(`  - ${p.name}@${p.version} (${p.path}) [${p.isDirect ? "direct" : "transitive"}]`);
    }
    console.log();
  }

  if (expiredEntries.length > 0) {
    console.log("EXPIRED ALLOWLIST ENTRIES:");
    for (const e of expiredEntries) {
      console.log(`  - ${e.name} (expired: ${e.expiry}, owner: ${e.owner})`);
    }
    console.log();
  }

  if (approved.length > 0) {
    console.log("APPROVED:");
    for (const p of approved) {
      console.log(`  - ${p.name}@${p.version}`);
    }
  }
}

process.exit(ok ? 0 : 1);
