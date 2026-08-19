import { describe, it, expect, vi, afterEach } from "vitest";
import { handleModelsCommand } from "../../../src/cli/commands/models.js";
import { _setCatalogFetchForTesting, _resetCatalogCacheForTesting } from "../../../src/providers/free-model-catalog.js";

const sample = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

function capture(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => lines.push(a.map(String).join(" ")));
  return fn().then(() => { spy.mockRestore(); return lines; });
}

afterEach(() => {
  _resetCatalogCacheForTesting();
  _setCatalogFetchForTesting(globalThis.fetch);
  vi.restoreAllMocks();
});

describe("models free", () => {
  it("lists free models with context and capability flags", async () => {
    _setCatalogFetchForTesting(async () => sample([
      { id: "qwen/qwen3-14b:free", name: "Qwen 3 14B", context_length: 32_000, pricing: { prompt: "0", completion: "0", request: "0" }, supported_parameters: { tools: true, structured_outputs: true, vision: false } },
      { id: "a/no-ctx:free", name: "A", pricing: { prompt: "0", request: "0" }, supported_parameters: {} },
    ]));
    const out = await capture(() => handleModelsCommand(["free"]));
    const text = out.join("\n");
    expect(text).toContain("OpenRouter Free Models");
    expect(text).toContain("qwen/qwen3-14b:free");
    expect(text).toContain("32k");
    expect(text).toContain("[tools,structured]");
    expect(text).toContain("a/no-ctx:free");
    expect(text).toContain("?");
    expect(text).toContain("2 free models.");
  });

  it("emits valid JSON with --json", async () => {
    _setCatalogFetchForTesting(async () => sample([
      { id: "qwen/qwen3-14b:free", name: "Qwen 3 14B", context_length: 32_000, pricing: { prompt: "0", request: "0" }, supported_parameters: { tools: true, structured_outputs: true, vision: false } },
    ]));
    const out = await capture(() => handleModelsCommand(["free", "--json"]));
    const parsed = JSON.parse(out.join("\n")) as unknown[];
    expect(parsed).toHaveLength(1);
    expect((parsed[0] as { id: string }).id).toBe("qwen/qwen3-14b:free");
  });

  it("prints guidance when the catalog is empty", async () => {
    _setCatalogFetchForTesting(async () => sample([
      { id: "b/paid", name: "B", pricing: { prompt: "1.5", request: "1" }, supported_parameters: {} },
    ]));
    const out = await capture(() => handleModelsCommand(["free"]));
    expect(out.join("\n")).toContain("No OpenRouter free models available. Set OPENROUTER_API_KEY and retry.");
  });
});