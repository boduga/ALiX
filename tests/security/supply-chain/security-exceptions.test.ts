/**
 * Tests for P4.3-Sf.2 — Security exceptions (advisory policy).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAuditResult,
  checkExceptionsPolicy,
  EXCEPTION_ERROR_CODES,
} from "../../../src/security/supply-chain/security-exceptions.js";
import type { ExceptionsFile, AdvisoryFinding } from "../../../src/security/supply-chain/security-exceptions.js";

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
