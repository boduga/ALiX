/**
 * tracing.vitest.ts — Task 6 tracing configuration contract.
 *
 * Covers: disabled-by-default behavior; the explicit deep-merge arm (a single
 * nested override must not clobber sibling tracing fields); store-only
 * credential resolution for tracing.langfuse keys (never env, and only when
 * tracing is enabled); and schema validation (capture modes, limits,
 * flushTimeoutMs, enabled boolean, baseUrl-when-enabled).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, mergeConfig, _setHomedirOverride } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AlixConfig, TracingConfig } from "../../src/config/schema.js";
import { validateConfig } from "../../src/config/validator.js";
import { CredentialStore } from "../../src/security/credentials/credential-store.js";
import { makeCredentialReference } from "../../src/security/credentials/credential-reference.js";

async function tmpHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "alix-tracing-"));
}

function restoreHomedir(): void {
  _setHomedirOverride(undefined);
}

afterEach(() => {
  restoreHomedir();
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
});

function issuePaths(config: AlixConfig): string[] {
  return validateConfig(config).issues.map((i) => i.path);
}

const tracingFragment = (tracing: unknown): AlixConfig =>
  ({ tracing }) as unknown as AlixConfig;

// ---------------------------------------------------------------------------
// Defaults (disabled)
// ---------------------------------------------------------------------------

describe("tracing defaults — disabled by default", () => {
  it("DEFAULT_CONFIG carries the full disabled tracing section", () => {
    const t = DEFAULT_CONFIG.tracing!;
    expect(t.enabled).toBe(false);
    expect(t.capture).toEqual({
      messages: "truncated",
      reasoning: "off",
      toolInput: "truncated",
      toolOutput: "truncated",
      maxMessageChars: 4000,
      maxToolOutputChars: 2000,
    });
    expect(t.flushTimeoutMs).toBe(2000);
    expect(t.langfuse.baseUrl).toBe("");
    expect(t.langfuse.publicKey).toBe(makeCredentialReference("langfuse", "publicKey"));
    expect(t.langfuse.secretKey).toBe(makeCredentialReference("langfuse", "secretKey"));
  });

  it("mergeConfig with no tracing override yields the disabled defaults", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {});
    const t = merged.tracing!;
    expect(t.enabled).toBe(false);
    expect(t.flushTimeoutMs).toBe(2000);
    expect(t.capture.messages).toBe("truncated");
    expect(t.capture.maxToolOutputChars).toBe(2000);
  });

  it("loadConfig returns the disabled default when nothing is configured", async () => {
    const dir = await tmpHome();
    try {
      _setHomedirOverride(dir);
      const config = await loadConfig(dir, { requireModel: false });
      const t = config.tracing!;
      expect(t.enabled).toBe(false);
      expect(t.capture.messages).toBe("truncated");
      expect(t.capture.reasoning).toBe("off");
      expect(t.flushTimeoutMs).toBe(2000);
      // Default langfuse keys are store references; nothing resolved them.
      expect(t.langfuse.publicKey).toBe("cred://langfuse/publicKey");
    } finally {
      restoreHomedir();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("disabled default config validates clean (no tracing issues)", () => {
    const issues = validateConfig({ ...DEFAULT_CONFIG }).issues.filter((i) =>
      i.path.startsWith("tracing"),
    );
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

describe("tracing nested deep-merge arm", () => {
  it("overriding one capture field preserves sibling tracing fields", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      tracing: { capture: { messages: "full" } },
    });
    const t = merged.tracing!;
    expect(t.capture.messages).toBe("full");
    // Siblings preserved, not clobbered.
    expect(t.capture.reasoning).toBe("off");
    expect(t.capture.toolInput).toBe("truncated");
    expect(t.capture.toolOutput).toBe("truncated");
    expect(t.capture.maxMessageChars).toBe(4000);
    expect(t.capture.maxToolOutputChars).toBe(2000);
    expect(t.flushTimeoutMs).toBe(2000);
    expect(t.langfuse).toEqual(DEFAULT_CONFIG.tracing!.langfuse);
    expect(t.enabled).toBe(false);
  });

  it("override layering merges across langfuse / capture / flushTimeoutMs independently", () => {
    const merged = mergeConfig(
      DEFAULT_CONFIG,
      { tracing: { langfuse: { baseUrl: "https://langfuse.example" } } },
      { tracing: { capture: { messages: "full", toolOutput: "off" } } },
      { tracing: { flushTimeoutMs: 5000, enabled: true } },
    );
    const t = merged.tracing!;
    expect(t.enabled).toBe(true);
    expect(t.langfuse.baseUrl).toBe("https://langfuse.example");
    expect(t.langfuse.publicKey).toBe("cred://langfuse/publicKey"); // preserved
    expect(t.capture.messages).toBe("full");
    expect(t.capture.toolOutput).toBe("off");
    expect(t.capture.reasoning).toBe("off"); // default preserved
    expect(t.flushTimeoutMs).toBe(5000);
  });

  it("loadConfig merges project override over user over defaults per-field", async () => {
    const dir = await tmpHome();
    try {
      _setHomedirOverride(dir);
      await mkdir(join(dir, ".config", "alix"), { recursive: true });
      await writeFile(
        join(dir, ".config", "alix", "config.json"),
        JSON.stringify({
          model: { provider: "openai", name: "gpt-4o" },
          tracing: {
            langfuse: { baseUrl: "https://user.langfuse.example" },
            capture: { toolOutput: "off", maxToolOutputChars: 500 },
          },
        }),
      );
      await mkdir(join(dir, ".alix"), { recursive: true });
      await writeFile(
        join(dir, ".alix", "config.json"),
        JSON.stringify({
          tracing: { capture: { messages: "full" } },
        }),
      );
      const config = await loadConfig(dir);
      const t = config.tracing!;
      // Project single-field override did not clobber user langfuse / other capture fields.
      expect(t.capture.messages).toBe("full"); // project override wins
      expect(t.capture.toolOutput).toBe("off"); // user layer preserved
      expect(t.capture.maxToolOutputChars).toBe(500); // user layer preserved
      expect(t.capture.reasoning).toBe("off"); // default preserved
      expect(t.langfuse.baseUrl).toBe("https://user.langfuse.example");
      expect(t.flushTimeoutMs).toBe(2000); // default preserved
      expect(t.enabled).toBe(false);
    } finally {
      restoreHomedir();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Credential handling (store-only; gated on enabled)
// ---------------------------------------------------------------------------

describe("tracing credential resolution", () => {
  async function storeWithLangfuseKeys(
    publicKey: string,
    secretKey: string,
  ): Promise<CredentialStore> {
    const store = new CredentialStore({
      filePath: join(await tmpHome(), "credential-store.json"),
    });
    await store.load();
    await store.set("langfuse", "publicKey", publicKey);
    await store.set("langfuse", "secretKey", secretKey);
    return store;
  }

  it("resolves cred://langfuse keys when tracing is enabled (never injected into env)", async () => {
    const dir = await tmpHome();
    try {
      _setHomedirOverride(dir);
      const store = await storeWithLangfuseKeys("pk-langfuse-abc", "sk-langfuse-xyz");
      await mkdir(join(dir, ".alix"), { recursive: true });
      await writeFile(
        join(dir, ".alix", "config.json"),
        JSON.stringify({
          model: { provider: "openai", name: "gpt-4o" },
          tracing: {
            enabled: true,
            langfuse: { baseUrl: "https://langfuse.example" },
          },
        }),
      );
      const config = await loadConfig(dir, { credentialStore: store });
      expect(config.tracing!.enabled).toBe(true);
      expect(config.tracing!.langfuse.publicKey).toBe("pk-langfuse-abc");
      expect(config.tracing!.langfuse.secretKey).toBe("sk-langfuse-xyz");
      // Store-only: tracing keys are never injected into the environment.
      expect(process.env.LANGFUSE_PUBLIC_KEY).toBeUndefined();
      expect(process.env.LANGFUSE_SECRET_KEY).toBeUndefined();
    } finally {
      restoreHomedir();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT resolve credentials when tracing is disabled (design §10)", async () => {
    const dir = await tmpHome();
    try {
      _setHomedirOverride(dir);
      // Empty store: resolution would fail if attempted.
      const store = new CredentialStore({ filePath: join(dir, "empty-store.json") });
      await store.load();
      await mkdir(join(dir, ".alix"), { recursive: true });
      await writeFile(
        join(dir, ".alix", "config.json"),
        JSON.stringify({
          model: { provider: "openai", name: "gpt-4o" },
          tracing: {
            enabled: false,
            langfuse: { baseUrl: "https://langfuse.example" },
          },
        }),
      );
      const config = await loadConfig(dir, { credentialStore: store });
      // Default cred references left untouched — no store lookups happened.
      expect(config.tracing!.langfuse.publicKey).toBe("cred://langfuse/publicKey");
      expect(config.tracing!.langfuse.secretKey).toBe("cred://langfuse/secretKey");
    } finally {
      restoreHomedir();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fail-open: a missing langfuse credential never fails config load", async () => {
    const dir = await tmpHome();
    try {
      _setHomedirOverride(dir);
      const store = new CredentialStore({ filePath: join(dir, "empty-store.json") });
      await store.load();
      await mkdir(join(dir, ".alix"), { recursive: true });
      await writeFile(
        join(dir, ".alix", "config.json"),
        JSON.stringify({
          model: { provider: "openai", name: "gpt-4o" },
          tracing: {
            enabled: true,
            langfuse: { baseUrl: "https://langfuse.example" },
          },
        }),
      );
      // Must not reject: tracing is fail-open; the unresolved reference stays in
      // place for the tracing factory to detect and degrade to NoopTraceClient.
      const config = await loadConfig(dir, { credentialStore: store });
      expect(config.tracing!.enabled).toBe(true);
      expect(config.tracing!.langfuse.publicKey).toBe("cred://langfuse/publicKey");
      expect(config.tracing!.langfuse.secretKey).toBe("cred://langfuse/secretKey");
    } finally {
      restoreHomedir();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("tracing validation", () => {
  it("rejects invalid capture levels", () => {
    const issues = issuePaths(
      tracingFragment({
        capture: { messages: "always", toolInput: 42 },
      }),
    );
    expect(issues).toContain("tracing.capture.messages");
    expect(issues).toContain("tracing.capture.toolInput");
  });

  it("accepts all valid capture levels", () => {
    for (const level of ["full", "truncated", "off"]) {
      const issues = issuePaths(
        tracingFragment({ capture: { messages: level, reasoning: level } }),
      );
      expect(issues).toEqual([]);
    }
  });

  it("rejects non-negative-limit violations", () => {
    const issues = issuePaths(
      tracingFragment({
        capture: {
          maxMessageChars: -1,
          maxToolOutputChars: 1.5,
        },
      }),
    );
    expect(issues).toContain("tracing.capture.maxMessageChars");
    expect(issues).toContain("tracing.capture.maxToolOutputChars");
  });

  it("accepts non-negative limits (zero allowed)", () => {
    const issues = issuePaths(
      tracingFragment({
        capture: { maxMessageChars: 0, maxToolOutputChars: 2000 },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("rejects non-positive / non-integer flushTimeoutMs", () => {
    for (const bad of [0, -5, 1.5, Number.NaN, Infinity]) {
      const issues = issuePaths(tracingFragment({ flushTimeoutMs: bad }));
      expect(issues).toContain("tracing.flushTimeoutMs");
    }
  });

  it("accepts a positive integer flushTimeoutMs", () => {
    const issues = issuePaths(tracingFragment({ flushTimeoutMs: 2000 }));
    expect(issues).toEqual([]);
  });

  it("rejects a non-boolean tracing.enabled", () => {
    const issues = issuePaths(tracingFragment({ enabled: "yes" }));
    expect(issues).toContain("tracing.enabled");
  });

  it("validates baseUrl only when tracing is enabled", () => {
    // Disabled + malformed baseUrl is valid (defaults carry an empty baseUrl).
    expect(
      issuePaths(tracingFragment({ enabled: false, langfuse: { baseUrl: "" } })),
    ).toEqual([]);
    // Enabled + missing/empty baseUrl is invalid.
    expect(
      issuePaths(tracingFragment({ enabled: true, langfuse: { baseUrl: "" } })),
    ).toContain("tracing.langfuse.baseUrl");
    expect(
      issuePaths(tracingFragment({ enabled: true, langfuse: { baseUrl: "not-a-url" } })),
    ).toContain("tracing.langfuse.baseUrl");
    expect(
      issuePaths(tracingFragment({ enabled: true, langfuse: { baseUrl: "ftp://langfuse.example" } })),
    ).toContain("tracing.langfuse.baseUrl");
    // Enabled + valid http(s) baseUrl passes.
    expect(
      issuePaths(
        tracingFragment({ enabled: true, langfuse: { baseUrl: "https://langfuse.example" } }),
      ),
    ).toEqual([]);
    expect(
      issuePaths(
        tracingFragment({ enabled: true, langfuse: { baseUrl: "http://localhost:3000" } }),
      ),
    ).toEqual([]);
  });

  it("merged full config with defaults is valid (disabled behavior unchanged)", () => {
    const issues = validateConfig(
      { ...DEFAULT_CONFIG, tracing: { ...(DEFAULT_CONFIG.tracing as TracingConfig) } },
    ).issues;
    expect(issues.filter((i) => i.path.startsWith("tracing"))).toEqual([]);
  });
});
