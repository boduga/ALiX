import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveProviders,
  getAvailableModels,
  _resetModelCache,
  _wasModelWarned,
} from "../../../src/cli/helpers/provider-selection.js";
import { _setUserConfigPathOverride } from "../../../src/cli/helpers/api-keys.js";
import { PROVIDERS } from "../../../src/providers/catalog.js";

const ALL_ENV_VARS = PROVIDERS.map((p) => p.env);
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function clearKnownEnv() {
  for (const v of ALL_ENV_VARS) delete process.env[v];
}

beforeEach(() => {
  savedEnv = {};
  for (const v of ALL_ENV_VARS) savedEnv[v] = process.env[v];
  clearKnownEnv();
  tmpDir = mkdtempSync(join(tmpdir(), "alix-sel-test-"));
  _setUserConfigPathOverride(join(tmpDir, "missing.json"));
  _resetModelCache();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  for (const v of ALL_ENV_VARS) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  _setUserConfigPathOverride(undefined);
  _resetModelCache();
  rmSync(tmpDir, { recursive: true, force: true });
  stderrSpy.mockRestore();
});

describe("resolveProviders", () => {
  it("returns ALL PROVIDERS in PROVIDERS array order", async () => {
    const result = await resolveProviders();
    expect(result.map((p) => p.id)).toEqual(PROVIDERS.map((p) => p.id));
  });

  it("marks providers with env-var key as available + apiKeySource='environment'", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const result = await resolveProviders();
    const openai = result.find((p) => p.id === "openai")!;
    expect(openai.available).toBe(true);
    expect(openai.apiKeySource).toBe("environment");
  });

  it("marks providers with user-config key as available + apiKeySource='user-config'", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { deepseek: "sk-d" } }));
    _setUserConfigPathOverride(path);
    const result = await resolveProviders();
    const ds = result.find((p) => p.id === "deepseek")!;
    expect(ds.available).toBe(true);
    expect(ds.apiKeySource).toBe("user-config");
  });

  it("marks ollama as apiKeySource='ollama' when no env key is set", async () => {
    const result = await resolveProviders();
    const ol = result.find((p) => p.id === "ollama")!;
    expect(ol.apiKeySource).toBe("ollama");
  });

  it("marks providers with no key as apiKeySource='none' and available=false", async () => {
    const result = await resolveProviders();
    const openai = result.find((p) => p.id === "openai")!;
    expect(openai.available).toBe(false);
    expect(openai.apiKeySource).toBe("none");
  });
});

describe("getAvailableModels", () => {
  it("returns the live list when fetch succeeds", async () => {
    // Provide an env key so getApiKey resolves, then verify model list comes back.
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5", display_name: "GPT-5" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;
    const result = await getAvailableModels("openai", fakeFetch);
    expect(result).toEqual([{ id: "gpt-5", displayName: "GPT-5" }]);
    expect(_wasModelWarned("openai")).toBe(false);
  });

  it("retries once on transient 5xx and returns the second result", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    let calls = 0;
    const fakeFetch = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response("server error", { status: 503 });
      return new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const result = await getAvailableModels("openai", fakeFetch);
    expect(result).toEqual([{ id: "gpt-5", displayName: "gpt-5" }]);
    expect(calls).toBe(2);
  });

  it("falls back to getDefaultModel single-entry list after retry also fails", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    const result = await getAvailableModels("openai", fakeFetch);
    expect(result).toEqual([{ id: "gpt-4o", displayName: "gpt-4o" }]); // DEFAULT_MODELS.openai
    expect(_wasModelWarned("openai")).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("caches the result and does not re-fetch on subsequent calls", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;
    await getAvailableModels("openai", fakeFetch);
    await getAvailableModels("openai", fakeFetch);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("warns once per provider per process even when called multiple times", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    await getAvailableModels("openai", fakeFetch);
    await getAvailableModels("openai", fakeFetch);
    expect(stderrSpy.mock.calls.length).toBe(1);
  });
});