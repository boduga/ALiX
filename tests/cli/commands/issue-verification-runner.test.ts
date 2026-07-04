// tests/cli/commands/issue-verification-runner.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCommandAllowed,
  runVerificationCommand,
  runVerificationSuite,
  type VerificationConfig,
  type VerificationCommand,
} from "../../../src/cli/commands/issue-verification-runner.js";

const baseConfig: VerificationConfig = {
  enabled: true,
  dryRun: false,
  commands: [],
  allowedPrefixes: ["pnpm build", "pnpm typecheck", "pnpm test", "echo", "false"],
  blockedPrefixes: ["rm -rf", "sudo", "git push", "git commit"],
  timeoutMs: 10000,
};

const blockedConfig: VerificationConfig = {
  ...baseConfig,
  blockedPrefixes: ["pnpm build", ...baseConfig.blockedPrefixes],
};

// ---------------------------------------------------------------------------
// isCommandAllowed
// ---------------------------------------------------------------------------

describe("isCommandAllowed", () => {
  it("allows commands matching allowed prefixes", () => {
    assert.strictEqual(isCommandAllowed("echo hello", baseConfig).allowed, true);
    assert.strictEqual(isCommandAllowed("pnpm build", baseConfig).allowed, true);
    assert.strictEqual(isCommandAllowed("pnpm typecheck", baseConfig).allowed, true);
  });

  it("blocks commands matching blocked prefixes", () => {
    const result = isCommandAllowed("sudo rm -rf /", baseConfig);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason);
  });

  it("blocks commands not in allowed list when allowed list is non-empty", () => {
    const result = isCommandAllowed("npm install", baseConfig);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason);
  });

  it("blocked prefix takes precedence over allowed prefix", () => {
    const result = isCommandAllowed("pnpm build", blockedConfig);
    assert.strictEqual(result.allowed, false);
  });
});

// ---------------------------------------------------------------------------
// runVerificationCommand
// ---------------------------------------------------------------------------

describe("runVerificationCommand", () => {
  it("passes for a successful command", () => {
    const cmd: VerificationCommand = { label: "Echo", command: "echo ok" };
    const result = runVerificationCommand(cmd, baseConfig);
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.exitCode, 0);
  });

  it("fails for a failing command", () => {
    const cmd: VerificationCommand = { label: "Fail", command: "false" };
    const result = runVerificationCommand(cmd, baseConfig);
    assert.strictEqual(result.status, "fail");
  });

  it("blocks disallowed commands", () => {
    const cmd: VerificationCommand = { label: "Blocked", command: "sudo ls" };
    const result = runVerificationCommand(cmd, baseConfig);
    assert.strictEqual(result.status, "blocked");
    assert.ok(result.failureReason);
  });

  it("includes duration on success", () => {
    const cmd: VerificationCommand = { label: "Echo", command: "echo ok" };
    const result = runVerificationCommand(cmd, baseConfig);
    assert.strictEqual(result.status, "pass");
    assert.ok(typeof result.durationMs === "number");
  });
});

// ---------------------------------------------------------------------------
// runVerificationSuite
// ---------------------------------------------------------------------------

describe("runVerificationSuite", () => {
  it("passes when all commands pass", () => {
    const result = runVerificationSuite(
      [
        { label: "Echo1", command: "echo a" },
        { label: "Echo2", command: "echo b" },
      ],
      baseConfig,
    );
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.results.length, 2);
  });

  it("stops on first failure", () => {
    const result = runVerificationSuite(
      [
        { label: "Ok", command: "echo ok" },
        { label: "Fail", command: "false" },
        { label: "Never", command: "echo never" },
      ],
      baseConfig,
    );
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.results.length, 2);
  });

  it("stops on blocked command", () => {
    const result = runVerificationSuite(
      [
        { label: "Ok", command: "echo ok" },
        { label: "Blocked", command: "sudo ls" },
      ],
      baseConfig,
    );
    assert.strictEqual(result.status, "blocked");
    assert.strictEqual(result.results.length, 2);
  });
});
