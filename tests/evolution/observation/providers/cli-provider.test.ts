// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CliObservationProvider } from "../../../../src/evolution/observation/providers/cli-provider.js";

describe("CliObservationProvider", () => {
  const provider = new CliObservationProvider();

  it("has name 'cli'", () => {
    assert.equal(provider.name, "cli");
  });

  it("has cli capability", () => {
    assert.ok(provider.capabilities.includes("cli"));
  });

  it("captures exit code 0 as pass", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "cli",
      description: "Echo test",
      params: { command: "node", args: ["-e", "process.exit(0)"] },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.confidence, 1.0);
    assert.equal(result.evidence.exitCode, 0);
  });

  it("captures exit code 1 as fail when expected is 0", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "cli",
      description: "Failing command",
      expected: 0,
      params: { command: "node", args: ["-e", "process.exit(1)"] },
    });
    assert.equal(result.status, "fail");
    assert.equal(result.evidence.exitCode, 1);
  });

  it("sets status to pass when no expected value (reality capture)", async () => {
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "cli",
      description: "Capture stdout",
      params: { command: "node", args: ["-e", "console.log('hello')"] },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "number");
  });

  it("captures stdout and stderr in evidence", async () => {
    const result = await provider.observe({
      observationId: "obs-4",
      provider: "cli",
      description: "Test output",
      params: { command: "node", args: ["-e", "console.log('out'); console.error('err')"] },
    });
    assert.equal(result.evidence.stdout, "out\n");
    assert.equal(result.evidence.stderr, "err\n");
  });

  it("returns error when command not found", async () => {
    const result = await provider.observe({
      observationId: "obs-5",
      provider: "cli",
      description: "Nonexistent",
      params: { command: "nonexistent-command-xyz" },
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
  });

  it("returns error result (never throws) on invalid command", async () => {
    // Should not throw — should return error result
    const result = await provider.observe({
      observationId: "obs-6",
      provider: "cli",
      description: "Invalid",
      params: { command: "" },
    });
    assert.equal(result.status, "error");
  });

  it("downgrades confidence on stderr output", async () => {
    const result = await provider.observe({
      observationId: "obs-7",
      provider: "cli",
      description: "Stderr warning",
      params: { command: "node", args: ["-e", "console.error('warn')"] },
    });
    // stderr present => confidence < 1.0
    assert.ok(result.confidence < 1.0);
    assert.ok(result.confidence > 0);
  });
});
