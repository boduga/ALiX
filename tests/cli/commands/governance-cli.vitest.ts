/**
 * P9.0f — CLI tests for `alix governance` subcommands.
 *
 * Tests each subcommand renders expected output, and that unknown subcommands
 * error with exit(1). All tests use temp directories so no real P8 data is
 * consumed — every builder returns empty/default reports.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceCommand } from "../../../src/cli/commands/governance.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("governance CLI", () => {
  it("health subcommand renders output containing 'Governance Health'", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["health"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Governance Health");
    log.mockRestore();
  });

  it("drift subcommand renders output containing 'Drift'", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["drift"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Drift");
    log.mockRestore();
  });

  it("errors on unknown subcommand", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as unknown as () => never);
    await handleGovernanceCommand(["bogus"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    err.mockRestore();
    exit.mockRestore();
  });
});
