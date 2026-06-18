/**
 * Tests for P4.3-Sf.1 — Dependency policy (lifecycle script checks).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractLifecyclePackages,
  compareVersions,
  versionMatches,
  checkLifecyclePolicy,
  LIFECYCLE_ERROR_CODES,
} from "../../../src/security/supply-chain/dependency-policy.js";
import type { AllowlistFile, LifecycleScriptPackage } from "../../../src/security/supply-chain/dependency-policy.js";

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  });

  it("returns negative when a < b", () => {
    assert.ok(compareVersions("1.0.0", "2.0.0") < 0);
    assert.ok(compareVersions("1.0.0", "1.1.0") < 0);
    assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
  });

  it("returns positive when a > b", () => {
    assert.ok(compareVersions("2.0.0", "1.0.0") > 0);
    assert.ok(compareVersions("1.1.0", "1.0.0") > 0);
    assert.ok(compareVersions("1.0.1", "1.0.0") > 0);
  });

  it("handles leading v prefix", () => {
    assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  });
});

// ---------------------------------------------------------------------------
// versionMatches
// ---------------------------------------------------------------------------

describe("versionMatches", () => {
  it("matches exact version", () => {
    assert.ok(versionMatches("1.0.0", "1.0.0"));
  });

  it("matches wildcard", () => {
    assert.ok(versionMatches("5.0.0", "*"));
  });

  it("matches >= range", () => {
    assert.ok(versionMatches("12.0.0", ">=12.0.0"));
    assert.ok(versionMatches("13.5.0", ">=12.0.0"));
    assert.ok(!versionMatches("11.0.0", ">=12.0.0"));
  });

  it("matches <= range", () => {
    assert.ok(versionMatches("7.6.2", "<=7.6.2"));
    assert.ok(versionMatches("7.0.0", "<=7.6.2"));
    assert.ok(!versionMatches("8.0.0", "<=7.6.2"));
  });

  it("matches compound range", () => {
    assert.ok(versionMatches("7.0.0", ">=6.0.0 <=7.6.2"));
    assert.ok(versionMatches("7.6.2", ">=6.0.0 <=7.6.2"));
    assert.ok(!versionMatches("8.0.0", ">=6.0.0 <=7.6.2"));
    assert.ok(!versionMatches("5.0.0", ">=6.0.0 <=7.6.2"));
  });

  it("rejects version outside range", () => {
    assert.ok(!versionMatches("0.19.0", ">=0.20.0"));
  });
});

// ---------------------------------------------------------------------------
// extractLifecyclePackages
// ---------------------------------------------------------------------------

describe("extractLifecyclePackages", () => {
  it("returns empty list for lockfile with no lifecycle packages", () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": { name: "test", version: "1.0.0" },
        "node_modules/foo": { name: "foo", version: "1.0.0", hasInstallScript: false },
      },
    };
    const { packages } = extractLifecyclePackages(lockfile);
    assert.equal(packages.length, 0);
  });

  it("extracts packages with lifecycle scripts", () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": {
          name: "test",
          version: "1.0.0",
          dependencies: { "better-sqlite3": "12.10.0" },
        },
        "node_modules/better-sqlite3": {
          name: "better-sqlite3",
          version: "12.10.0",
          hasInstallScript: true,
        },
      },
    };
    const { packages } = extractLifecyclePackages(lockfile);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, "better-sqlite3");
    assert.equal(packages[0].version, "12.10.0");
    assert.equal(packages[0].isDirect, true);
  });

  it("skips linked packages", () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": { name: "test", version: "1.0.0" },
        "node_modules/linked-pkg": {
          name: "linked-pkg",
          version: "1.0.0",
          hasInstallScript: true,
          link: true,
        },
      },
    };
    const { packages } = extractLifecyclePackages(lockfile);
    assert.equal(packages.length, 0);
  });

  it("detects transitive lifecycle packages", () => {
    const lockfile = {
      lockfileVersion: 3,
      packages: {
        "": { name: "test", version: "1.0.0" },
        "node_modules/transitive-dep": {
          name: "transitive-dep",
          version: "1.0.0",
          hasInstallScript: true,
        },
      },
    };
    const { packages } = extractLifecyclePackages(lockfile);
    assert.equal(packages.length, 1);
    assert.equal(packages[0].isDirect, false);
  });
});

// ---------------------------------------------------------------------------
// checkLifecyclePolicy
// ---------------------------------------------------------------------------

describe("checkLifecyclePolicy", () => {
  const now = new Date("2026-06-18");
  const futureDate = new Date("2027-01-01");

  const sampleAllowlist: AllowlistFile = {
    packages: [
      {
        name: "better-sqlite3",
        versionRange: ">=12.0.0",
        scripts: ["install"],
        reason: "Native SQLite binding",
        owner: "boduga",
        created: "2025-06-01",
        expiry: "2027-06-01",
      },
    ],
  };

  it("approves a package in the allowlist", () => {
    const packages: LifecycleScriptPackage[] = [
      { name: "better-sqlite3", version: "12.10.0", nodeModulesPath: "node_modules/better-sqlite3", isDirect: true },
    ];
    const result = checkLifecyclePolicy(packages, sampleAllowlist, now);
    assert.ok(result.ok);
    assert.equal(result.approved.length, 1);
    assert.equal(result.newUnapproved.length, 0);
    assert.equal(result.expiredEntries.length, 0);
  });

  it("flags a new unapproved package", () => {
    const packages: LifecycleScriptPackage[] = [
      { name: "malicious-pkg", version: "1.0.0", nodeModulesPath: "node_modules/malicious-pkg", isDirect: true },
    ];
    const result = checkLifecyclePolicy(packages, sampleAllowlist, now);
    assert.ok(!result.ok);
    assert.equal(result.newUnapproved.length, 1);
    assert.equal(result.newUnapproved[0].name, "malicious-pkg");
    assert.ok(result.findings.some((f) => f.code === LIFECYCLE_ERROR_CODES.UNEXPECTED_LIFECYCLE_SCRIPT));
  });

  it("flags an expired allowlist entry", () => {
    const expiredAllowlist: AllowlistFile = {
      packages: [
        {
          name: "better-sqlite3",
          versionRange: ">=12.0.0",
          scripts: ["install"],
          reason: "Native SQLite binding",
          owner: "boduga",
          created: "2024-06-01",
          expiry: "2025-06-01", // expired
        },
      ],
    };
    const packages: LifecycleScriptPackage[] = [
      { name: "better-sqlite3", version: "12.10.0", nodeModulesPath: "node_modules/better-sqlite3", isDirect: true },
    ];
    const result = checkLifecyclePolicy(packages, expiredAllowlist, now);
    assert.ok(!result.ok);
    assert.equal(result.expiredEntries.length, 1);
    assert.ok(result.findings.some((f) => f.code === LIFECYCLE_ERROR_CODES.ALLOWLIST_ENTRY_EXPIRED));
  });

  it("does not flag non-expired entry", () => {
    const packages: LifecycleScriptPackage[] = [
      { name: "better-sqlite3", version: "12.10.0", nodeModulesPath: "node_modules/better-sqlite3", isDirect: true },
    ];
    const result = checkLifecyclePolicy(packages, sampleAllowlist, futureDate);
    assert.ok(result.ok);
    assert.equal(result.expiredEntries.length, 0);
  });

  it("handles multiple packages correctly", () => {
    const multiAllowlist: AllowlistFile = {
      packages: [
        { name: "pkg-a", versionRange: ">=1.0.0", scripts: ["install"], reason: "ok", owner: "boduga", created: "2025-01-01", expiry: "2027-01-01" },
        { name: "pkg-b", versionRange: ">=2.0.0", scripts: ["postinstall"], reason: "ok", owner: "boduga", created: "2025-01-01", expiry: "2027-01-01" },
      ],
    };
    const packages: LifecycleScriptPackage[] = [
      { name: "pkg-a", version: "1.0.0", nodeModulesPath: "node_modules/pkg-a", isDirect: true },
      { name: "pkg-b", version: "2.1.0", nodeModulesPath: "node_modules/pkg-b", isDirect: true },
      { name: "pkg-c", version: "1.0.0", nodeModulesPath: "node_modules/pkg-c", isDirect: false },
    ];
    const result = checkLifecyclePolicy(packages, multiAllowlist, now);
    assert.ok(!result.ok); // pkg-c is unapproved
    assert.equal(result.approved.length, 2);
    assert.equal(result.newUnapproved.length, 1);
    assert.equal(result.newUnapproved[0].name, "pkg-c");
  });
});
