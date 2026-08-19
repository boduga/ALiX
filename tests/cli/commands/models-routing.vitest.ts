import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleModelsCommand } from "../../../src/cli/commands/models.js";

const chainCases: Array<{ provider: string; model: string; role: string }> = [];

vi.mock("../../../src/models/routing-cli.js", () => ({
  describeRoutingChain: () => chainCases,
}));

vi.mock("../../../src/config/loader.js", () => ({
  loadConfig: async () => ({ models: { default: {} } }),
}));

function capture(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => lines.push(a.map(String).join(" ")));
  return fn().then(() => { spy.mockRestore(); return lines; });
}

beforeEach(() => {
  chainCases.length = 0;
});

describe("models routing", () => {
  it("lists primary", async () => {
    chainCases.push({ provider: "openrouter", model: "openai/gpt-4o", role: "primary" });
    const out = await capture(() => handleModelsCommand(["routing"]));
    const text = out.join("\n");
    expect(text).toContain("Configured Routing Chain");
    expect(text).toContain("openrouter/openai/gpt-4o");
  });

  it("lists free fallback", async () => {
    chainCases.push({ provider: "openrouter", model: "openai/gpt-4o", role: "primary" });
    chainCases.push({ provider: "openrouter", model: "openrouter/free", role: "fallback" });
    const out = await capture(() => handleModelsCommand(["routing"]));
    const text = out.join("\n");
    expect(text).toContain("openrouter/openai/gpt-4o");
    expect(text).toContain("openrouter/openrouter/free");
    expect(text).not.toContain("No fallbacks configured");
  });

  it("lists explicit fallbacks", async () => {
    chainCases.push({ provider: "openrouter", model: "openai/gpt-4o", role: "primary" });
    chainCases.push({ provider: "anthropic", model: "claude-sonnet", role: "fallback" });
    const out = await capture(() => handleModelsCommand(["routing"]));
    const text = out.join("\n");
    expect(text).toContain("anthropic/claude-sonnet");
  });

  it("without routing lists only primary and hints at configuration", async () => {
    chainCases.push({ provider: "openrouter", model: "openai/gpt-4o", role: "primary" });
    const out = await capture(() => handleModelsCommand(["routing"]));
    const text = out.join("\n");
    expect(text).toContain("No fallbacks configured");
    expect(text).toContain("freeFallback");
  });

  it("--json produces valid JSON", async () => {
    chainCases.push({ provider: "openrouter", model: "openai/gpt-4o", role: "primary" });
    chainCases.push({ provider: "openrouter", model: "openrouter/free", role: "fallback" });
    const out = await capture(() => handleModelsCommand(["routing", "--json"]));
    const parsed = JSON.parse(out.join("\n")) as Array<{ provider: string; model: string; role: string }>;
    expect(parsed).toEqual([
      { provider: "openrouter", model: "openai/gpt-4o", role: "primary" },
      { provider: "openrouter", model: "openrouter/free", role: "fallback" },
    ]);
  });
});