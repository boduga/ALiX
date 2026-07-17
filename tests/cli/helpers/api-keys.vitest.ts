import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mutating test seam to redirect user-config reads/writes inside a temp dir.
import {
  _setUserConfigPathOverride,
  getSavedApiKey,
  setApiKey,
  getApiKey,
} from "../../../src/cli/helpers/api-keys.js";
import { PROVIDERS } from "../../../src/providers/catalog.js";

const ALL_ENV_VARS = PROVIDERS.map((p) => p.env);
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;

function clearKnownEnv() {
  for (const v of ALL_ENV_VARS) delete process.env[v];
}

beforeEach(() => {
  savedEnv = {};
  for (const v of ALL_ENV_VARS) savedEnv[v] = process.env[v];
  clearKnownEnv();
  tmpDir = mkdtempSync(join(tmpdir(), "alix-api-keys-test-"));
});

afterEach(() => {
  for (const v of ALL_ENV_VARS) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  _setUserConfigPathOverride(undefined);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getSavedApiKey", () => {
  it("returns null when no config file exists", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getSavedApiKey("openai")).toBeNull();
  });

  it("returns the stored key when present", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "sk-stored" } }));
    _setUserConfigPathOverride(path);
    expect(await getSavedApiKey("openai")).toBe("sk-stored");
  });

  it("returns null on malformed JSON without throwing", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, "{ broken json");
    _setUserConfigPathOverride(path);
    expect(await getSavedApiKey("openai")).toBeNull();
  });

  it("returns null when apiKeys field is missing", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ version: 1 }));
    _setUserConfigPathOverride(path);
    expect(await getSavedApiKey("openai")).toBeNull();
  });

  it("returns null for empty-string apiKey entries", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "" } }));
    _setUserConfigPathOverride(path);
    expect(await getSavedApiKey("openai")).toBeNull();
  });
});

describe("setApiKey", () => {
  it("writes a new config file preserving other keys", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { deepseek: "sk-d" }, version: 2 }));
    _setUserConfigPathOverride(path);

    await setApiKey("openai", "sk-new");

    const result = JSON.parse(await fs.readFile(path, "utf8"));
    expect(result.apiKeys).toEqual({ deepseek: "sk-d", openai: "sk-new" });
    expect(result.version).toBe(2);
  });

  it("creates a new config file when none exists", async () => {
    const path = join(tmpDir, "config.json");
    _setUserConfigPathOverride(path);
    await setApiKey("openai", "sk-new");
    const fs = await import("node:fs/promises");
    const result = JSON.parse(await fs.readFile(path, "utf8"));
    expect(result.apiKeys).toEqual({ openai: "sk-new" });
  });
});

describe("getApiKey", () => {
  it("returns env var value when set, ignoring user config", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "sk-user" } }));
    _setUserConfigPathOverride(path);
    process.env.OPENAI_API_KEY = "sk-env";
    expect(await getApiKey("openai")).toBe("sk-env");
  });

  it("falls back to user config when no env var set", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "sk-user" } }));
    _setUserConfigPathOverride(path);
    expect(await getApiKey("openai")).toBe("sk-user");
  });

  it("returns empty string for ollama with no env or user config", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getApiKey("ollama")).toBe("");
  });

  it("returns undefined for non-ollama with no env or user config", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getApiKey("openai")).toBeUndefined();
  });

  it("returns undefined for unknown provider id", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getApiKey("bogus-xyz")).toBeUndefined();
  });
});