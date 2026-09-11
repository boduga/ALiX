import { describe, it, expect, vi, afterEach } from "vitest";
import { freellmapiSpec, DEFAULT_FREELLMAPI_BASE_URL } from "../../src/providers/specs/freellmapi-spec.js";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";
import { FreeLLMAPIProvider } from "../../src/providers/freellmapi-provider.js";
import { complete, _setFetchForTesting } from "../../src/providers/unified-complete.js";
import { createProvider, listProviders } from "../../src/providers/registry.js";
import { getDefaultModel, PROVIDERS, listModels } from "../../src/providers/catalog.js";
import { makeMockFetch } from "./helpers/mock-fetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("freellmapiSpec", () => {
  it("targets the local FreeLLMAPI OpenAI-compat endpoint", () => {
    expect(DEFAULT_FREELLMAPI_BASE_URL).toBe("http://localhost:3001");
    expect(freellmapiSpec.baseUrl).toBe("http://localhost:3001/v1/chat/completions");
  });

  it("inherits OpenAI Bearer auth", () => {
    expect(freellmapiSpec.authHeader("freellmapi-abc")).toEqual({
      Authorization: "Bearer freellmapi-abc",
    });
  });

  it("inherits request/response normalization from the OpenAI base", () => {
    expect(freellmapiSpec.toRequestBody).toBe(openaiBaseSpec.toRequestBody);
    expect(freellmapiSpec.fromResponse).toBe(openaiBaseSpec.fromResponse);
  });
});

describe("FreeLLMAPIProvider", () => {
  it("identifies as freellmapi with the requested default model", () => {
    const provider = new FreeLLMAPIProvider();
    expect(provider.id).toBe("freellmapi");
    expect(provider.capabilities.model).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("declares tools + streaming, conservative vision/parallel-tools", () => {
    const caps = new FreeLLMAPIProvider({ model: "x" }).capabilities;
    expect(caps.supportsTools).toBe(true);
    expect(caps.supportsStreaming).toBe(true);
    // Router serves many upstreams: fail closed until verified per model.
    expect(caps.supportsVision).toBe(false);
    expect(caps.parallelToolCalls).toBe(false);
  });

  it("complete() hits the local endpoint with Bearer auth and the model", async () => {
    const mock = makeMockFetch([{
      status: 200,
      body: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] },
    }]);
    _setFetchForTesting(mock.fetch as any);

    const provider = new FreeLLMAPIProvider({ apiKey: "freellmapi-test", model: "m" });
    const resp = await provider.complete({ systemPrompt: "", messages: [] });
    expect(resp.text).toBe("hi");
    expect(mock.calls[0].url).toBe("http://localhost:3001/v1/chat/completions");
    const headers = mock.calls[0].init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer freellmapi-test");
    expect((mock.calls[0].init.body as string)).toContain('"model":"m"');
  });
});

describe("freellmapi registration", () => {
  it("createProvider resolves the lazy adapter", async () => {
    const provider = await createProvider(
      { provider: "freellmapi", model: "m" } as any,
      "freellmapi-test",
    );
    expect(provider.id).toBe("freellmapi");
  });

  it("listProviders includes FreeLLMAPI", () => {
    expect(listProviders()).toContainEqual({
      id: "freellmapi",
      name: "FreeLLMAPI (local router)",
      envKey: "FREELLMAPI_API_KEY",
    });
  });

  it("unified complete() routes by provider id", async () => {
    const mock = makeMockFetch([{
      status: 200,
      body: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] },
    }]);
    _setFetchForTesting(mock.fetch as any);

    const resp = await complete("freellmapi", "m", { systemPrompt: "", messages: [] }, { apiKey: "k" });
    expect(resp.text).toBe("ok");
    expect(mock.calls[0].url).toBe("http://localhost:3001/v1/chat/completions");
  });
});

describe("freellmapi catalog", () => {
  it("default model is the requested Nemotron free tier", () => {
    expect(getDefaultModel("freellmapi")).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("PROVIDERS lists FreeLLMAPI", () => {
    expect(PROVIDERS).toContainEqual({
      id: "freellmapi",
      name: "FreeLLMAPI",
      env: "FREELLMAPI_API_KEY",
      hint: "freellmapi-...",
    });
  });

  it("listModels queries the local /v1/models", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "a" }, { id: "b" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const models = await listModels("freellmapi", "k");
    expect(models).toEqual([
      { id: "a", displayName: "a" },
      { id: "b", displayName: "b" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer k" },
      }),
    );
  });
});
