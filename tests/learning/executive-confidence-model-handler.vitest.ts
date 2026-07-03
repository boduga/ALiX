// tests/learning/executive-confidence-model-handler.vitest.ts
//
// P11.4 — CLI handler tests for `alix executive confidence-model`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleConfidenceModelCommand } from "../../src/cli/commands/executive-confidence-model-handler.js";

describe("executive-confidence-model-handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // T20: --latest without saved model prints message
  it("prints message when --latest and no model exists", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await handleConfidenceModelCommand(["--latest"]);

    expect(logSpy).toHaveBeenCalledWith("No saved confidence model found.");
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  // T21: Default mode without plan prints error
  it("prints error when running without a strategic plan", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    await handleConfidenceModelCommand([]);

    expect(errorSpy).toHaveBeenCalled();
    const msg = (errorSpy.mock.calls[0]?.[0] ?? "") as string;
    expect(msg).toContain("Learning engine error");
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
