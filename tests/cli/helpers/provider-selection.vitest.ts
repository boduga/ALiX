import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  selectFromList,
  selectProviderInteractive,
  selectModelInteractive,
  _resetModelCache,
  _clearModelCache,
  _wasModelWarned,
  resolveProviders,
  getAvailableModels,
  resolveInitialProviderAndModel,
} from "../../../src/cli/helpers/provider-selection.js";
import { _setUserConfigPathOverride } from "../../../src/cli/helpers/api-keys.js";
import { PROVIDERS } from "../../../src/providers/catalog.js";
import { parseInitArgs } from "../../../src/cli/helpers/init-args.js";

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

  it("does not retry on permanent 4xx failures (auth/not-found) — only 1 fetch call", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const result = await getAvailableModels("openai", fakeFetch);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ id: "gpt-4o", displayName: "gpt-4o" }]); // DEFAULT_MODELS.openai
    expect(_wasModelWarned("openai")).toBe(true);
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("warns exactly once per provider even after a cache reset between two failures", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    await getAvailableModels("openai", fakeFetch);
    _clearModelCache();
    await getAvailableModels("openai", fakeFetch);
    expect(stderrSpy.mock.calls.length).toBe(1);
  });
});

describe("selectFromList", () => {
  const items = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];

  it("returns the selected item by 1-based number", async () => {
    const promptFn = async (q: string) => "1";
    const result = await selectFromList(items, (i) => i.name, { promptFn });
    expect(result).toEqual({ id: "a", name: "Alpha" });
  });

  it("returns null when user cancels with 0", async () => {
    const promptFn = async () => "0";
    expect(await selectFromList(items, (i) => i.name, { promptFn })).toBeNull();
  });

  it("re-prompts on invalid input then accepts next valid selection", async () => {
    const answers = ["99", "abc", "2"];
    const promptFn = async () => answers.shift() ?? "";
    expect(await selectFromList(items, (i) => i.name, { promptFn })).toEqual({ id: "b", name: "Beta" });
  });

  it("re-prompts on empty input then accepts next valid selection", async () => {
    const answers = ["", "1"];
    const promptFn = async () => answers.shift() ?? "";
    expect(await selectFromList(items, (i) => i.name, { promptFn })).toEqual({ id: "a", name: "Alpha" });
  });

  it("returns null + warns when list is empty", async () => {
    const promptFn = async () => "1";
    expect(await selectFromList([], (i) => String(i), { promptFn })).toBeNull();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it("includes optional header line in the prompt header", async () => {
    const promptFn = vi.fn(async (_q: string) => "1");
    await selectFromList(items, (i) => i.name, { promptFn, header: "Choose:" });
    const firstCall = promptFn.mock.calls[0] as unknown as [string];
    expect(firstCall[0]).toContain("Choose:");
  });
});

describe("selectProviderInteractive", () => {
  it("only offers available providers", async () => {
    const avail = await resolveProviders();
    // Mark only openai as available for predictability.
    const filtered = avail.map((p) => (p.id === "openai" ? { ...p, available: true } : { ...p, available: false }));
    const promptFn = async () => "1";
    const id = await selectProviderInteractive(filtered, promptFn);
    expect(id).toBe("openai");
  });

  it("orders providers by apiKeySource priority: environment > user-config > ollama", async () => {
    // Force deterministic ordering: openai=env, anthropic=user-config, ollama=available.
    process.env.OPENAI_API_KEY = "sk-x";
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { anthropic: "sk-a" } }));
    _setUserConfigPathOverride(path);

    const avail = await resolveProviders();
    const available = avail.filter((p) => p.available);
    // The function is called indirectly via selectFromList; we verify by
    // the rendered list order — capture promptFn calls.
    const calls: string[] = [];
    const promptFn = async (q: string) => {
      calls.push(q);
      return "1";
    };
    const id = await selectProviderInteractive(avail, promptFn);
    expect(id).toBe("openai"); // env-first wins selection of "1"
    // The header should mention env-sourced openai before user-sourced anthropic.
    const header = calls[0] ?? "";
    const idxOpenai = header.indexOf("OpenAI");
    const idxAnthropic = header.indexOf("Anthropic");
    expect(idxOpenai).toBeGreaterThan(-1);
    expect(idxAnthropic).toBeGreaterThan(-1);
    expect(idxOpenai).toBeLessThan(idxAnthropic);
  });
});

describe("selectModelInteractive", () => {
  it("returns the selected ModelInfo", async () => {
    const models = [
      { id: "m1", displayName: "Model 1" },
      { id: "m2", displayName: "Model 2" },
    ];
    const promptFn = async () => "2";
    const result = await selectModelInteractive(models, promptFn);
    expect(result).toEqual({ id: "m2", displayName: "Model 2" });
  });
});

describe("resolveInitialProviderAndModel — auto mode", () => {
  it("uses detectProvider() when stdin is not a TTY", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      process.env.OPENAI_API_KEY = "sk-x";
      const res = await resolveInitialProviderAndModel({ help: false });
      expect(res.providerId).toBe("openai");
      expect(typeof res.modelId).toBe("string");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });
});

describe("resolveInitialProviderAndModel — flagged mode", () => {
  it("uses --provider + validates --model against live list", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-4o" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const args = parseInitArgs(["--provider", "openai", "--model", "gpt-5"]);
    const res = await resolveInitialProviderAndModel(args, { fetchFn: fakeFetch });
    expect(res).toEqual({ providerId: "openai", modelId: "gpt-5" });
  });

  it("throws on unknown --provider", async () => {
    const args = parseInitArgs(["--provider", "bogus-xyz"]);
    await expect(resolveInitialProviderAndModel(args)).rejects.toThrow(/unknown provider/i);
  });

  it("throws on invalid --model not present in live list", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const args = parseInitArgs(["--provider", "openai", "--model", "gpt-not-a-real-model"]);
    await expect(
      resolveInitialProviderAndModel(args, { fetchFn: fakeFetch }),
    ).rejects.toThrow(/model .* not found/i);
  });
});

describe("resolveInitialProviderAndModel — interactive mode", () => {
  it("prompts for provider + model when TTY + no flags", async () => {
    process.env.OPENAI_API_KEY = "sk-x";
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const fakeFetch = vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ) as unknown as typeof fetch;

      // Provider pick: 1 → first available (openai). Model pick: 1 → gpt-5.
      const promptFn = async () => "1";
      const res = await resolveInitialProviderAndModel(
        { help: false },
        { promptFn, fetchFn: fakeFetch },
      );
      expect(res.providerId).toBe("openai");
      expect(res.modelId).toBe("gpt-5");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });

  it("throws when no providers are available", async () => {
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    // Force ollama to appear unavailable — dev environments may have it running.
    const catalog = await import("../../../src/providers/catalog.js");
    const ollamaSpy = vi.spyOn(catalog, "getInstalledOllamaModels").mockReturnValue([]);
    try {
      // No env vars, no user config → only ollama is candidate, but no
      // ollama running → resolveProviders marks everything unavailable.
      await expect(resolveInitialProviderAndModel({ help: false })).rejects.toThrow(
        /no available providers/i,
      );
    } finally {
      ollamaSpy.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    }
  });
});
