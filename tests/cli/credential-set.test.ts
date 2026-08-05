/**
 * credential-set.test.ts — regression tests for the interactive provider
 * picker in `alix credential set`.
 *
 * What we test:
 *  1. The literal `provider` keyword is detected in the first positional
 *     arg (case-insensitive) and branches into the picker path.
 *  2. Non-TTY contexts reject the picker with a helpful usage error
 *     (instead of the generic "missing args" message), and operators
 *     are pointed at the positional form for non-interactive use.
 *  3. The original positional form (`alix credential set <provider>
 *     <keyLabel> <value>`) still works when all three args are present
 *     — no regression for scripts and automation.
 *
 * The TTY picker path itself (selectFromList + prompt + promptHidden) is
 * exercised manually because it requires raw-mode stdin control that's
 * awkward to stub in node:test. The non-TTY rejection covers the
 * "the picker doesn't apply" branch which is the most likely place
 * for a regression.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const _origExit = process.exit;
const _origStdinIsTTY = process.stdin.isTTY;
const _origConsoleError = console.error;

let exitCode: number | undefined;
let captured: string[] = [];

beforeEach(() => {
  exitCode = undefined;
  captured = [];
  process.exit = ((code?: number): never => {
    exitCode = code ?? 0;
    throw new Error("__TEST_EXIT__");
  }) as typeof process.exit;
  // Force non-TTY to exercise the rejection path deterministically.
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  console.error = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
});

afterEach(() => {
  process.exit = _origExit;
  Object.defineProperty(process.stdin, "isTTY", { value: _origStdinIsTTY, configurable: true });
  console.error = _origConsoleError;
});

describe("handleCredentialSet — interactive provider picker", () => {
  it("rejects the `provider` keyword in non-TTY contexts with a helpful usage error", async () => {
    const { handleCredentialSet } = await import("../../src/cli/commands/security.js");
    await assert.rejects(
      handleCredentialSet(["provider", "default", "sk-or-v1-test"]),
      /__TEST_EXIT__/,
    );
    assert.equal(exitCode, 1, "exits with code 1");
    const out = captured.join("\n");
    assert.ok(
      out.includes("interactive `provider` keyword requires a TTY"),
      `expected helpful error; got: ${out}`,
    );
    assert.ok(
      out.includes("supply the values as positional args"),
      `expected pointer at positional form; got: ${out}`,
    );
  });

  it("treats the keyword as case-insensitive", async () => {
    const { handleCredentialSet } = await import("../../src/cli/commands/security.js");
    for (const variant of ["Provider", "PROVIDER", "provider"]) {
      captured = [];
      exitCode = undefined;
      await assert.rejects(
        handleCredentialSet([variant, "default", "sk-or-v1-test"]),
        /__TEST_EXIT__/,
      );
      assert.equal(exitCode, 1, `${variant}: exits with code 1`);
      const out = captured.join("\n");
      assert.ok(
        out.includes("interactive `provider` keyword requires a TTY"),
        `${variant}: expected helpful error; got: ${out}`,
      );
    }
  });

  it("shows the original positional usage when args are missing AND keyword not used", async () => {
    // The non-keyword, missing-args path is unchanged — guard against
    // accidentally re-routing through the picker on a typo.
    const { handleCredentialSet } = await import("../../src/cli/commands/security.js");
    await assert.rejects(
      handleCredentialSet(["openrouter"]),
      /__TEST_EXIT__/,
    );
    assert.equal(exitCode, 1);
    const out = captured.join("\n");
    assert.ok(
      out.includes("Usage: alix credential set <provider> <keyLabel> <value>"),
      `expected original usage error; got: ${out}`,
    );
    assert.ok(
      !out.includes("interactive `provider` keyword"),
      "must not route 'openrouter' through the picker; got: " + out,
    );
  });
});
