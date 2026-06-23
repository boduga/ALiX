/**
 * P9.0b.1 — CLI smoke test for `alix governance` dispatched through src/cli.ts.
 *
 * These are end-to-end smoke tests: they invoke the handler directly but
 * exercise the same code path the top-level CLI dispatcher would use.
 * They assert the handler does not crash and that unknown subcommands error.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceCommand } from "../../../src/cli/commands/governance.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-smoke-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("alix governance — CLI smoke (dispatcher path)", () => {
  it("health subcommand renders without crashing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleGovernanceCommand(["health"]);

    // It must not write to stderr.
    expect(err).not.toHaveBeenCalled();

    // It must produce some output.
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output.length).toBeGreaterThan(0);

    log.mockRestore();
    err.mockRestore();
  });

  it("unknown subcommand exits with error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number | string | null) => {
        throw new Error(`process.exit(${code ?? 0})`);
      }) as never);

    let captured: Error | undefined;
    try {
      await handleGovernanceCommand(["bogus-subcommand"]);
    } catch (e) {
      captured = e as Error;
    }

    expect(err).toHaveBeenCalled();
    expect(captured?.message).toBe("process.exit(1)");
    expect(exit).toHaveBeenCalledWith(1);

    err.mockRestore();
    exit.mockRestore();
  });
});
