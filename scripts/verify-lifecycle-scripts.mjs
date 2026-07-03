#!/usr/bin/env node

/**
 * P4.3-Sf.1 — Verify lifecycle scripts against allowlist (pnpm edition).
 *
 * Reads pnpm-workspace.yaml (the pnpm build-approval gate) and the
 * lifecycle-script allowlist, then checks for unapproved or expired
 * entries. pnpm itself enforces the first gate — install fails for
 * unapproved build scripts — so this script verifies policy completeness.
 *
 * Usage:
 *   node scripts/verify-lifecycle-scripts.mjs [--json]
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

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
// Load pnpm build approvals (pnpm-workspace.yaml)
// ---------------------------------------------------------------------------

let workspaceConfig;
try {
  const yamlText = await readFile(
    resolve(projectRoot, "pnpm-workspace.yaml"),
    "utf-8",
  );
  workspaceConfig = parse(yamlText);
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("ERROR: pnpm-workspace.yaml not found.");
    process.exit(1);
  }
  console.error(`ERROR: failed to parse pnpm-workspace.yaml: ${err.message}`);
  process.exit(1);
}

// pnpm v9 stores approved build scripts under `onlyBuiltDependencies` (array)
// or `allowBuilds` (map). Support both.
const allowedBuilds = new Set(
  Array.isArray(workspaceConfig.onlyBuiltDependencies)
    ? workspaceConfig.onlyBuiltDependencies
    : workspaceConfig.allowBuilds
      ? Object.keys(workspaceConfig.allowBuilds).filter(
          (k) => workspaceConfig.allowBuilds[k] === true,
        )
      : [],
);

// ---------------------------------------------------------------------------
// Load allowlist
// ---------------------------------------------------------------------------

let allowlist;
try {
  allowlist = JSON.parse(
    await readFile(
      resolve(projectRoot, "security/lifecycle-script-allowlist.json"),
      "utf-8",
    ),
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
// Cross-reference pnpm-workspace.yaml allowBuilds with security allowlist
// ---------------------------------------------------------------------------

const entries = allowlist.packages ?? [];
const policy = allowlist.policy ?? {};
const now = new Date();

const findings = [];
const approved = [];
const notInAllowlist = [];
const expiredEntries = [];

// Check each pnpm-approved build against the security allowlist
for (const pkgName of allowedBuilds) {
  const match = entries.find((e) => e.name === pkgName);

  if (match) {
    if (match.expiry && now >= new Date(match.expiry)) {
      expiredEntries.push(match);
      findings.push({
        code: "SC_LIFECYCLE_EXPIRED",
        severity: "error",
        message: `Allowlist entry for "${pkgName}" expired on ${match.expiry}.`,
        package: pkgName,
        details: `Owner: ${match.owner}. Reason: ${match.reason}`,
      });
    } else {
      approved.push(pkgName);
    }
  } else {
    notInAllowlist.push(pkgName);
    findings.push({
      code: "SC_LIFECYCLE_UNEXPECTED",
      severity: "error",
      message: `Package "${pkgName}" has pnpm build approval but is not in security/lifecycle-script-allowlist.json.`,
      package: pkgName,
      details:
        "Add this package to security/lifecycle-script-allowlist.json with a reason, owner, and expiry date.",
    });
  }
}

// Check for expired entries not associated with any current pnpm build approval
for (const entry of entries) {
  if (entry.expiry && now >= new Date(entry.expiry)) {
    if (allowedBuilds.has(entry.name) && !expiredEntries.some((e) => e.name === entry.name)) {
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
        totalPnpmApprovedBuilds: allowedBuilds.size,
        approvedInAllowlist: approved,
        notInAllowlist,
        expiredEntries: expiredEntries.map((e) => e.name),
        findings,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Lifecycle Script Verification — ${ok ? "PASSED" : "FAILED"}\n`);
  console.log(`Packages with pnpm build approval: ${allowedBuilds.size}`);
  console.log(`Approved in security allowlist: ${approved.length}`);
  console.log(`Missing from allowlist: ${notInAllowlist.length}`);
  console.log(`Expired entries: ${expiredEntries.length}`);
  console.log();

  if (notInAllowlist.length > 0) {
    console.log("MISSING FROM ALLOWLIST (pnpm-approved but not in security/lifecycle-script-allowlist.json):");
    for (const name of notInAllowlist) {
      console.log(`  - ${name}`);
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
    for (const name of approved) {
      console.log(`  - ${name}`);
    }
  }
}

process.exit(ok ? 0 : 1);
