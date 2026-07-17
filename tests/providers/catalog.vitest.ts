/**
 * Tests for `detectProvider()` and `loadUserConfigApiKeys()` in
 * `src/providers/catalog.ts`.
 *
 * Verifies the env-var-always-wins / user-config-fallback / ollama chain.
 *
 * Test isolation: each test sets a unique tmp config path via the
 * `_setUserConfigPathOverride()` seam and clears all known provider
 * env vars. Restore both in `afterEach`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectProvider,
  loadUserConfigApiKeys,
  PROVIDERS,
  _setUserConfigPathOverride,
} from "../../src/providers/catalog.js";

// Env vars that `detectProvider` reads (computed from PROVIDERS, never hardcoded).
const ALL_ENV_VARS = PROVIDERS.map((p) => p.env);

/** Create a temp dir and return its absolute path. */
function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "alix-catalog-test-"));
}

/** Snapshot of env vars we'll mutate. Captured before each test, restored in afterEach. */
let savedEnv: Record<string, string | undefined>;

function clearKnownEnv() {
  for (const v of ALL_ENV_VARS) delete process.env[v];
}

beforeEach(() => {
  savedEnv = {};
  for (const v of ALL_ENV_VARS) savedEnv[v] = process.env[v];
  clearKnownEnv();
});

afterEach(() => {
  for (const v of ALL_ENV_VARS) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  _setUserConfigPathOverride(undefined);
});

// ---------------------------------------------------------------------------
// loadUserConfigApiKeys
// ---------------------------------------------------------------------------

describe("loadUserConfigApiKeys", () => {
  it("returns {} when config file does not exist", () => {
    _setUserConfigPathOverride(join(mkTmp(), "no-such.json"));
    expect(loadUserConfigApiKeys()).toEqual({});
  });

  it("returns parsed apiKeys when config is valid JSON", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ apiKeys: { openai: "sk-x", deepseek: "sk-y" } }));
    _setUserConfigPathOverride(path);
    const keys = loadUserConfigApiKeys();
    expect(keys).toEqual({ openai: "sk-x", deepseek: "sk-y" });
  });

  it("returns {} when config JSON is malformed (does not throw)", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, "{ broken json");
    _setUserConfigPathOverride(path);
    expect(loadUserConfigApiKeys()).toEqual({});
  });

  it("drops non-string / empty apiKey entries", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        apiKeys: { openai: "sk-real", deepseek: "", google: null as any, anthropic: 42 as any },
      }),
    );
    _setUserConfigPathOverride(path);
    expect(loadUserConfigApiKeys()).toEqual({ openai: "sk-real" });
  });

  it("returns {} when apiKeys field is missing", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ version: 1, model: { provider: "x", name: "y" } }));
    _setUserConfigPathOverride(path);
    expect(loadUserConfigApiKeys()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// detectProvider — precedence chain
// ---------------------------------------------------------------------------

describe("detectProvider precedence", () => {
  it("env var always wins, ignoring user config", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ apiKeys: { openai: "sk-x" } }));
    _setUserConfigPathOverride(path);
    process.env.DEEPSEEK_API_KEY = "sk-from-env";
    expect(detectProvider()).toEqual({
      provider: "deepseek",
      model: expect.any(String) as unknown as string,
    });
  });

  it("falls back to user config when no env var is set", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ apiKeys: { openai: "sk-x" } }));
    _setUserConfigPathOverride(path);
    const result = detectProvider();
    expect(result.provider).toBe("openai");
    expect(typeof result.model).toBe("string");
    expect(result.model.length).toBeGreaterThan(0);
  });

  it("uses first PROVIDERS entry with a key when multiple are configured", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    // PROVIDERS[0] is anthropic; put a key there to verify order is honored.
    writeFileSync(
      path,
      JSON.stringify({ apiKeys: { anthropic: "sk-a", openai: "sk-o", deepseek: "sk-d" } }),
    );
    _setUserConfigPathOverride(path);
    expect(detectProvider().provider).toBe("anthropic");
  });

  it("falls through to ollama when neither env nor user config has any key", () => {
    _setUserConfigPathOverride(join(mkTmp(), "no-such.json"));
    const result = detectProvider();
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("");
  });

  it("ignores unknown provider IDs in user config and uses a known one if present", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      JSON.stringify({ apiKeys: { mystery_provider: "sk-x", openai: "sk-o" } }),
    );
    _setUserConfigPathOverride(path);
    expect(detectProvider().provider).toBe("openai");
  });

  it("returns ollama when only unknown providers are in user config", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ apiKeys: { mystery: "x" } }));
    _setUserConfigPathOverride(path);
    const result = detectProvider();
    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("");
  });

  it("does not throw when user config JSON is malformed", () => {
    const dir = mkTmp();
    const path = join(dir, "config.json");
    writeFileSync(path, "{ broken json");
    _setUserConfigPathOverride(path);
    expect(() => detectProvider()).not.toThrow();
    expect(detectProvider().provider).toBe("ollama");
  });
});
