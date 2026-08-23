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

  it("never returns a cred:// reference as the literal string", async () => {
    // A `cred://` value must be resolved through the credential store, never
    // returned as the raw reference. The store may or may not hold the secret
    // in this environment — the invariant is that the reference string itself
    // must not leak through (that is what caused 401s in set-default).
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "cred://openai/apiKey" } }));
    _setUserConfigPathOverride(path);
    const value = await getSavedApiKey("openai");
    expect(value).not.toBe("cred://openai/apiKey");
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
  it("ignores env var and returns user-config value when both are set", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "sk-user" } }));
    _setUserConfigPathOverride(path);
    process.env.OPENAI_API_KEY = "sk-env";
    expect(await getApiKey("openai")).toBe("sk-user");
  });

  it("returns user config value when no env var is set", async () => {
    const path = join(tmpDir, "config.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, JSON.stringify({ apiKeys: { openai: "sk-user" } }));
    _setUserConfigPathOverride(path);
    expect(await getApiKey("openai")).toBe("sk-user");
  });

  it("ignores a stray env var when no config key exists", async () => {
    // Store-only: an env var must never authenticate on its own.
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    process.env.OPENAI_API_KEY = "sk-env";
    expect(await getApiKey("openai")).toBeUndefined();
  });

  it("returns empty string for ollama with no user config", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getApiKey("ollama")).toBe("");
  });

  it("returns undefined for non-ollama with no user config", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getApiKey("openai")).toBeUndefined();
  });

  it("returns undefined for unknown provider id", async () => {
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
    expect(await getApiKey("bogus-xyz")).toBeUndefined();
  });
});