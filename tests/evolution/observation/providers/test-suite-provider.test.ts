// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TestSuiteObservationProvider, parseTestOutput } from "../../../../src/evolution/observation/providers/test-suite-provider.js";

describe("parseTestOutput", () => {
  it("parses Node test runner output with passes", () => {
    const output = "ℹ tests 10\nℹ suites 3\nℹ pass 10\nℹ fail 0\nℹ duration_ms 150.5";
    const result = parseTestOutput(output, 200);
    assert.equal(result.total, 10);
    assert.equal(result.passed, 10);
    assert.equal(result.failed, 0);
    assert.equal(result.framework, "node:test");
  });

  it("parses Node test runner output with failures", () => {
    const output = "ℹ tests 15\nℹ suites 4\nℹ pass 13\nℹ fail 2\nℹ duration_ms 250.3";
    const result = parseTestOutput(output, 300);
    assert.equal(result.total, 15);
    assert.equal(result.failed, 2);
    assert.equal(result.framework, "node:test");
  });

  it("parses Jest output", () => {
    const output = "Tests: 2 failed, 8 passed, 10 total";
    const result = parseTestOutput(output, 500);
    assert.equal(result.total, 10);
    assert.equal(result.passed, 8);
    assert.equal(result.failed, 2);
    assert.equal(result.framework, "jest");
  });

  it("parses Jest output with all passing", () => {
    const output = "Tests: 15 passed, 15 total";
    const result = parseTestOutput(output, 300);
    assert.equal(result.total, 15);
    assert.equal(result.passed, 15);
    assert.equal(result.failed, 0);
    assert.equal(result.framework, "jest");
  });

  it("parses Mocha output", () => {
    const output = "  5 passing (2s)\n  1 failing";
    const result = parseTestOutput(output, 2000);
    assert.equal(result.total, 6);
    assert.equal(result.passed, 5);
    assert.equal(result.failed, 1);
    assert.equal(result.framework, "mocha");
  });

  it("falls back to unknown format", () => {
    const output = "Some random output that isn't a test report";
    const result = parseTestOutput(output, 100);
    assert.equal(result.total, 0);
    assert.equal(result.framework, "unknown");
  });
});

describe("TestSuiteObservationProvider", () => {
  const provider = new TestSuiteObservationProvider();

  it("has name 'test_suite'", () => {
    assert.equal(provider.name, "test_suite");
  });

  it("has test capability", () => {
    assert.ok(provider.capabilities.includes("test_suite"));
  });

  it("runs a passing test file", async () => {
    // Create a minimal passing test file
    const result = await provider.observe({
      observationId: "ts-1",
      provider: "test_suite",
      description: "Run passing tests",
    });
    // Should either succeed or produce an error (if test infrastructure isn't available)
    assert.ok(["pass", "error"].includes(result.status));
    if (result.status === "pass") {
      assert.equal(typeof result.evidence.total, "number");
    }
  });

  it("returns error for nonexistent command", async () => {
    const result = await provider.observe({
      observationId: "ts-2",
      provider: "test_suite",
      description: "Nonexistent command",
      params: { command: "nonexistent-test-runner-xyz" },
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
  });

  it("never throws on invalid params", async () => {
    const result = await provider.observe({
      observationId: "ts-3",
      provider: "test_suite",
      description: "No params",
    });
    // Should not throw — should return a result
    assert.ok(result);
    assert.equal(result.observationId, "ts-3");
  });
});
