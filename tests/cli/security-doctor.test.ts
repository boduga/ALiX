/**
 * security-doctor.test.ts — P4.3-Sg2: Security doctor and gate command tests.
 *
 * Validates:
 *  1. Doctor JSON output is valid DoctorReport shape
 *  2. Doctor human-readable output contains expected sections
 *  3. Gate JSON output is valid GateReport shape
 *  4. Gate human-readable output contains expected sections
 *  5. JSON output contains no raw credentials
 *
 * Uses console.log capture and process.exit suppression.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const _origExit = process.exit;
const _origConsoleLog = console.log;
let _captured: string[] = [];

process.exit = ((_code?: number): never => {
  throw new Error("__TEST_EXIT__");
}) as typeof process.exit;

console.log = (...args: any[]) => {
  _captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
};

after(() => {
  process.exit = _origExit;
  console.log = _origConsoleLog;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runHandler(fn: () => Promise<void>): Promise<string> {
  _captured = [];
  try {
    await fn();
  } catch (err: unknown) {
    if (
      !(err instanceof Error) ||
      err.message !== "__TEST_EXIT__"
    ) {
      throw err;
    }
  }
  return _captured.join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("security doctor and gate", () => {
  it("doctor --json produces valid DoctorReport", async () => {
    const { handleSecurityDoctorComprehensive } = await import(
      "../../src/cli/commands/security.js"
    );
    const stdout = await runHandler(() =>
      handleSecurityDoctorComprehensive(["--json"]),
    );

    const parsed = JSON.parse(stdout.trim());
    const report = parsed as Record<string, unknown>;

    assert.ok(Array.isArray(report.checks), "should have checks array");
    assert.ok(typeof report.passCount === "number");
    assert.ok(typeof report.warnCount === "number");
    assert.ok(typeof report.failCount === "number");
    assert.ok(typeof report.errorCount === "number");
    assert.ok(
      ["healthy", "warnings", "issues"].includes(report.overall as string),
    );
    assert.ok(typeof report.timestamp === "string");
  });

  it("doctor human-readable output has expected sections", async () => {
    const { handleSecurityDoctorComprehensive } = await import(
      "../../src/cli/commands/security.js"
    );
    const stdout = await runHandler(() =>
      handleSecurityDoctorComprehensive([]),
    );

    assert.ok(stdout.includes("ALiX Security Doctor"), "should have title");
    assert.ok(
      stdout.includes("Pass:") || stdout.includes("Overall:"),
      "should have summary",
    );
  });

  it("gate --json produces valid GateReport", async () => {
    const { handleSecurityGate } = await import(
      "../../src/cli/commands/security.js"
    );
    const stdout = await runHandler(() =>
      handleSecurityGate(["--json"]),
    );

    const parsed = JSON.parse(stdout.trim());
    const report = parsed as Record<string, unknown>;

    assert.ok(Array.isArray(report.checks), "should have checks array");
    assert.ok(typeof report.passed === "boolean");
    assert.ok(typeof report.timestamp === "string");

    for (const check of report.checks as Array<Record<string, unknown>>) {
      assert.ok(typeof check.id === "string");
      assert.ok(typeof check.ok === "boolean");
      assert.ok(typeof check.message === "string");
    }

    // Must not leak credentials
    const json = JSON.stringify(report);
    assert.equal(json.includes("sk-"), false);
    assert.equal(json.includes("Bearer"), false);
  });

  it("gate human-readable output has expected sections", async () => {
    const { handleSecurityGate } = await import(
      "../../src/cli/commands/security.js"
    );
    const stdout = await runHandler(() =>
      handleSecurityGate([]),
    );

    assert.ok(stdout.includes("ALiX Security Gate"), "should have title");
    assert.ok(
      stdout.includes("PASSED") || stdout.includes("FAILED"),
      "should have verdict",
    );
  });
});
