/**
 * Tests for P4.3-Sf.2 — Security exceptions (advisory policy).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  parseAuditResult,
  checkExceptionsPolicy,
  runExceptionsCheck,
  EXCEPTION_ERROR_CODES,
} from "../../../src/governance/security/supply-chain/security-exceptions.js";
import type { ExceptionsFile, AdvisoryFinding } from "../../../src/governance/security/supply-chain/security-exceptions.js";

// ---------------------------------------------------------------------------
// parseAuditResult
// ---------------------------------------------------------------------------

describe("parseAuditResult", () => {
  it("parses valid npm audit JSON output", () => {
    const auditJson = JSON.stringify({
      vulnerabilities: {
        "protobufjs": {
          isDirect: false,
          name: "protobufjs",
          severity: "critical",
          via: [{ title: "Prototype Pollution in protobufjs" }],
          effects: [],
        },
      },
    });
    const { findings } = parseAuditResult(auditJson);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, "protobufjs");
    assert.equal(findings[0].severity, "critical");
    assert.ok(findings[0].isProduction);
  });

  it("handles empty vulnerabilities", () => {
    const { findings } = parseAuditResult(JSON.stringify({ vulnerabilities: {} }));
    assert.equal(findings.length, 0);
  });

  it("handles invalid JSON gracefully", () => {
    const { findings, error } = parseAuditResult("not json");
    assert.equal(findings.length, 0);
    assert.ok(error);
    assert.equal(error.code, EXCEPTION_ERROR_CODES.AUDIT_PARSE_FAILED);
  });

  it("detects dev-only advisories", () => {
    const auditJson = JSON.stringify({
      vulnerabilities: {
        "vite": {
          isDirect: true,
          name: "vite",
          severity: "high",
          via: [{ title: "Vite Server File Access" }],
          effects: ["dev"],
        },
      },
    });
    const { findings } = parseAuditResult(auditJson);
    assert.equal(findings.length, 1);
    assert.ok(findings[0].isDev);
    assert.ok(!findings[0].isProduction);
  });

  it("extracts title from via array", () => {
    const auditJson = JSON.stringify({
      vulnerabilities: {
        "test-pkg": {
          name: "test-pkg",
          severity: "high",
          via: [{ title: "Test Advisory Title", name: "test-pkg" }],
        },
      },
    });
    const { findings } = parseAuditResult(auditJson);
    assert.equal(findings[0].title, "Test Advisory Title");
  });
});

// ---------------------------------------------------------------------------
// checkExceptionsPolicy
// ---------------------------------------------------------------------------

describe("checkExceptionsPolicy", () => {
  const now = new Date("2026-06-18");

  const sampleExceptions: ExceptionsFile = {
    policy: {
      failOnUnexcepted: true,
      failOnExpired: true,
      failSeverity: "critical",
      warnSeverity: "high",
      expiryWindowDays: 90,
    },
    advisories: [
      {
        id: "protobufjs",
        severity: "critical",
        package: "protobufjs",
        title: "Prototype Pollution in protobufjs",
        reason: "Transitive dep, no user input path",
        owner: "boduga",
        created: "2026-06-18",
        expiry: "2026-09-16",
      },
    ],
  };

  it("accepts an excepted advisory", () => {
    const findings: AdvisoryFinding[] = [
      {
        id: "protobufjs",
        severity: "critical",
        package: "protobufjs",
        title: "Prototype Pollution in protobufjs",
        isProduction: true,
        isDev: false,
      },
    ];
    const result = checkExceptionsPolicy(findings, sampleExceptions, now);
    assert.ok(result.ok);
    assert.equal(result.excepted.length, 1);
    assert.equal(result.unexcepted.length, 0);
  });

  it("flags an unexcepted critical advisory", () => {
    const findings: AdvisoryFinding[] = [
      {
        id: "unknown-vuln",
        severity: "critical",
        package: "unknown-pkg",
        title: "Critical vulnerability in unknown-pkg",
        isProduction: true,
        isDev: false,
      },
    ];
    const result = checkExceptionsPolicy(findings, sampleExceptions, now);
    assert.ok(!result.ok);
    assert.equal(result.unexcepted.length, 1);
    assert.ok(result.findings.some((f) => f.code === EXCEPTION_ERROR_CODES.UNEXCEPTED_ADVISORY));
  });

  it("warns for unexcepted high advisory (below fail threshold)", () => {
    const findings: AdvisoryFinding[] = [
      {
        id: "unknown-high",
        severity: "high",
        package: "unknown-high-pkg",
        title: "High severity advisory",
        isProduction: true,
        isDev: false,
      },
    ];
    const result = checkExceptionsPolicy(findings, sampleExceptions, now);
    // Fail severity is "critical", so "high" should warn but not fail
    assert.equal(result.unexcepted.length, 1);
    assert.ok(result.findings.some((f) => f.severity === "warning"));
  });

  it("flags an expired exception", () => {
    const expiredExceptions: ExceptionsFile = {
      policy: { failOnExpired: true },
      advisories: [
        {
          id: "protobufjs",
          severity: "critical",
          package: "protobufjs",
          title: "Old proto issue",
          reason: "Was reviewed last year",
          owner: "boduga",
          created: "2025-01-01",
          expiry: "2025-06-01", // expired
        },
      ],
    };
    const findings: AdvisoryFinding[] = [
      {
        id: "protobufjs",
        severity: "critical",
        package: "protobufjs",
        title: "Old proto issue",
        isProduction: true,
        isDev: false,
      },
    ];
    const result = checkExceptionsPolicy(findings, expiredExceptions, now);
    assert.ok(!result.ok);
    assert.equal(result.expiredExceptions.length, 1);
    assert.ok(result.findings.some((f) => f.code === EXCEPTION_ERROR_CODES.EXCEPTION_EXPIRED));
  });

  it("skips dev-only advisories in productionOnly mode", () => {
    const prodExceptions: ExceptionsFile = {
      policy: {
        failOnUnexcepted: true,
        productionOnly: true,
        failSeverity: "high",
        warnSeverity: "moderate",
      },
      advisories: [],
    };
    const findings: AdvisoryFinding[] = [
      {
        id: "dev-vite",
        severity: "high",
        package: "vite",
        title: "Dev tool vulnerability",
        isProduction: false,
        isDev: true,
      },
    ];
    const result = checkExceptionsPolicy(findings, prodExceptions, now);
    assert.ok(result.ok);
    assert.equal(result.unexcepted.length, 0);
  });

  it("accepts low-severity advisories below warn threshold", () => {
    const findings: AdvisoryFinding[] = [
      {
        id: "low-issue",
        severity: "low",
        package: "low-pkg",
        title: "Low severity issue",
        isProduction: true,
        isDev: false,
      },
    ];
    const result = checkExceptionsPolicy(findings, sampleExceptions, now);
    assert.ok(result.ok);
    assert.equal(result.excepted.length, 1);
    assert.equal(result.unexcepted.length, 0);
  });
});

// ---------------------------------------------------------------------------
// pnpm audit shape
// ---------------------------------------------------------------------------

describe("parseAuditResult — pnpm advisory map", () => {
  /**
   * `pnpm audit --json` emits `{ advisories: { <id>: {...} } }`, not npm's
   * `{ vulnerabilities: {...} }`. Parsing only the npm shape returned zero
   * findings for every real pnpm report, which made any policy check built on
   * it report a clean bill of health regardless of what was installed.
   */
  const pnpmReport = JSON.stringify({
    advisories: {
      "1120786": {
        id: 1120786,
        module_name: "vite",
        severity: "moderate",
        title: "launch-editor: NTLMv2 hash disclosure",
        vulnerable_versions: ">=8.0.0 <=8.0.15",
        github_advisory_id: "GHSA-v6wh-96g9-6wx3",
        findings: [{ version: "8.0.13", dev: true, paths: [".>vitest>vite"] }],
      },
      "1240107": {
        id: 1240107,
        module_name: "brace-expansion",
        severity: "high",
        title: "DoS via uncontrolled recursion",
        github_advisory_id: "GHSA-qhr7-859c-m2p7",
        findings: [{ version: "5.0.9", dev: false, paths: [".>minimatch>brace-expansion"] }],
      },
    },
    metadata: { vulnerabilities: { moderate: 1, high: 1 } },
  });

  it("does not silently return zero findings", () => {
    const { findings, error } = parseAuditResult(pnpmReport);
    assert.equal(error, undefined);
    assert.equal(findings.length, 2, "a non-empty pnpm report must yield findings");
  });

  it("maps package, severity, production flag and GHSA id", () => {
    const { findings } = parseAuditResult(pnpmReport);
    const vite = findings.find((f) => f.package === "vite");
    const brace = findings.find((f) => f.package === "brace-expansion");

    assert.ok(vite);
    assert.equal(vite.severity, "moderate");
    assert.equal(vite.isDev, true, "all-dev findings must be dev-only");
    assert.equal(vite.isProduction, false);
    assert.equal(vite.id, "GHSA-v6wh-96g9-6wx3", "the stable advisory id is preferred");

    assert.ok(brace);
    assert.equal(brace.isDev, false);
    assert.equal(brace.isProduction, true);
  });

  it("still parses the npm vulnerabilities shape", () => {
    const npmReport = JSON.stringify({
      vulnerabilities: {
        vite: { name: "vite", severity: "high", via: [{ title: "x" }] },
      },
    });
    const { findings } = parseAuditResult(npmReport);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].package, "vite");
  });

  it("reports a parse error for malformed JSON instead of an empty clean report", () => {
    const { findings, error } = parseAuditResult("not json");
    assert.equal(findings.length, 0);
    assert.equal(error?.code, EXCEPTION_ERROR_CODES.AUDIT_PARSE_FAILED);
  });
});

// ---------------------------------------------------------------------------
// runExceptionsCheck — the policy path must actually run
// ---------------------------------------------------------------------------

describe("runExceptionsCheck", () => {
  function fixture(expiry: string): string {
    const root = mkdtempSync("/tmp/alix-exceptions-fixture-");
    mkdirSync(join(root, "security"), { recursive: true });
    writeFileSync(
      join(root, "security", "audit-exceptions.json"),
      JSON.stringify({
        policy: { failOnUnexcepted: true, failOnExpired: true, failSeverity: "critical", warnSeverity: "high" },
        advisories: [
          {
            id: "protobufjs",
            severity: "critical",
            package: "protobufjs",
            title: "Prototype Pollution",
            reason: "test fixture",
            owner: "boduga",
            created: "2026-06-18",
            expiry,
          },
        ],
      })
    );
    return root;
  }

  const advisoryFor = (pkg: string, severity = "critical") =>
    JSON.stringify({
      advisories: {
        "1": { id: 1, module_name: pkg, severity, title: "t", github_advisory_id: "GHSA-test" },
      },
    });

  it("evaluates the policy instead of reporting an unconditional pass", async () => {
    const root = fixture("2026-09-16");
    try {
      const result = await runExceptionsCheck(root, undefined, {
        auditJson: advisoryFor("protobufjs"),
        now: new Date("2026-10-31T00:00:00Z"),
      });
      assert.equal(result.ok, false, "an expired exception must fail the check");
      assert.equal(result.expiredExceptions.length, 1);
      assert.ok(result.findings.some((f) => f.code === EXCEPTION_ERROR_CODES.EXCEPTION_EXPIRED));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails on an unexcepted critical advisory", async () => {
    const root = fixture("2099-01-01");
    try {
      const result = await runExceptionsCheck(root, undefined, {
        auditJson: advisoryFor("brand-new-critical"),
        now: new Date("2026-10-31T00:00:00Z"),
      });
      assert.equal(result.ok, false);
      assert.equal(result.unexcepted.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when every advisory is excepted and current", async () => {
    const root = fixture("2099-01-01");
    try {
      const result = await runExceptionsCheck(root, undefined, {
        auditJson: advisoryFor("protobufjs"),
        now: new Date("2026-10-31T00:00:00Z"),
      });
      assert.equal(result.ok, true);
      assert.equal(result.expiredExceptions.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the audit cannot be run", async () => {
    const root = fixture("2099-01-01");
    try {
      const result = await runExceptionsCheck(root, undefined, {
        runAudit: async () => {
          throw new Error("audit binary missing");
        },
      });
      assert.equal(result.ok, false, "a broken audit invocation is not a clean report");
      assert.ok(result.findings.some((f) => f.code === EXCEPTION_ERROR_CODES.AUDIT_FAILED));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("listOnly returns declarations without a policy verdict", async () => {
    const root = fixture("2026-09-16");
    try {
      const result = await runExceptionsCheck(root, undefined, { listOnly: true });
      assert.equal(result.ok, true);
      assert.equal(result.excepted.length, 1);
      assert.equal(result.expiredExceptions.length, 0, "list does not evaluate expiry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Unknown audit shapes must not pass silently
// ---------------------------------------------------------------------------

describe("parseAuditResult — unrecognised shapes", () => {
  it("errors instead of reporting a clean graph for valid JSON with no known shape", () => {
    // The pnpm-shape bug and an unknown future format are the same fail-open:
    // zero findings with no error, which a policy check reads as "nothing found".
    const { findings, error } = parseAuditResult(JSON.stringify({ metadata: { vulnerabilities: 0 } }));
    assert.equal(findings.length, 0);
    assert.equal(error?.code, EXCEPTION_ERROR_CODES.AUDIT_PARSE_FAILED);
  });

  it("rejects a non-object vulnerabilities value rather than iterating it", () => {
    // A truthy non-object is the discriminating case: without the explicit
    // shape check this falls through to Object.entries("abc"), which yields
    // index entries and returns zero findings as a *successful* clean report.
    const { findings, error } = parseAuditResult(JSON.stringify({ vulnerabilities: "abc" }));
    assert.equal(findings.length, 0);
    assert.equal(error?.code, EXCEPTION_ERROR_CODES.AUDIT_PARSE_FAILED);
    assert.match(
      String(error?.details),
      /neither an 'advisories' nor a 'vulnerabilities' object/,
      "the error must name the shape problem, not surface an incidental TypeError"
    );
  });

  it("still accepts an explicitly empty advisories or vulnerabilities object", () => {
    for (const raw of [JSON.stringify({ advisories: {} }), JSON.stringify({ vulnerabilities: {} })]) {
      const { findings, error } = parseAuditResult(raw);
      assert.equal(error, undefined, "an explicit empty report is a legitimate clean result");
      assert.equal(findings.length, 0);
    }
  });
});
