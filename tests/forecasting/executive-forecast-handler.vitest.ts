// tests/forecasting/executive-forecast-handler.vitest.ts
//
// P11.5 — CLI handler tests for `alix executive forecast`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleForecastCommand } from "../../src/cli/commands/executive-forecast-handler.js";

describe("executive-forecast-handler", () => {
  beforeEach(() => vi.restoreAllMocks());

  // T18: --latest without saved forecast prints message
  it("prints message when --latest and no forecast exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    await handleForecastCommand(["--latest"]);
    expect(logSpy).toHaveBeenCalledWith("No saved health forecast found.");
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  // T19: Default mode without plan prints error
  it("prints error when running without a strategic plan", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    await handleForecastCommand([]);
    expect(errorSpy).toHaveBeenCalled();
    const msg = (errorSpy.mock.calls[0]?.[0] ?? "") as string;
    expect(msg).toContain("Forecasting engine error");
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
