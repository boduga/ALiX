/**
 * tracing-config-edge.vitest.ts — Task 21 configuration delta.
 *
 * The Task 6 file (tests/config/tracing.vitest.ts) already asserts the full
 * shape, defaults, deep-merge arm, and store-only credential resolution. This
 * file adds ONLY the delta the Task 21 brief names explicitly and that the
 * Task 6 suite does NOT already pin with these exact inputs:
 *
 *   - the exact out-of-domain capture levels "loud" / "garbage" (brief item 4)
 *   - NaN / Infinity on capture limits (brief item 5; Task 6 only tried -1/1.5)
 *   - the deep-merge invariant restated exactly as the brief words it: override
 *     `tracing.capture.messages` WITHOUT deleting `tracing.langfuse`,
 *     `tracing.capture.toolOutput`, `tracing.flushTimeoutMs`.
 *
 * All assertions assert the REAL current behavior (src/config/validator.ts,
 * src/config/loader.ts:427-466): invalid levels/limits/flushTimeoutMs are
 * REJECTED by the validator (never coerced/defaulted); limits accept 0; and the
 * merge arm at loader.ts:455-460 deep-merges each of langfuse/capture/flushTimeoutMs
 * so a single-field override preserves untouched siblings at their DEFAULTS.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 21 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, mergeConfig, _setHomedirOverride } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { AlixConfig } from "../../src/config/schema.js";
import { validateConfig } from "../../src/config/validator.js";

afterEach(() => {
  _setHomedirOverride(undefined);
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
});

async function tmpHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "alix-tracing-edge-"));
}

function issuePaths(tracing: unknown): string[] {
  const config = { tracing } as unknown as AlixConfig;
  return validateConfig(config).issues.map((i) => i.path);
}

// ---------------------------------------------------------------------------
// Invalid capture levels — the brief's exact named values
// ---------------------------------------------------------------------------

describe("tracing invalid capture levels (brief names)", () => {
  it("rejects messages:'loud' (out-of-domain)", () => {
    expect(issuePaths({ capture: { messages: "loud" } })).toContain(
      "tracing.capture.messages",
    );
  });

  it("rejects toolOutput:'garbage' (out-of-domain)", () => {
    expect(issuePaths({ capture: { toolOutput: "garbage" } })).toContain(
      "tracing.capture.toolOutput",
    );
  });

  it("rejects the same invalid value on every mode field", () => {
    for (const field of ["messages", "reasoning", "toolInput", "toolOutput"]) {
      expect(issuePaths({ capture: { [field]: "willy-nilly" } })).toContain(
        `tracing.capture.${field}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid limits — NaN / Infinity explicitly (brief item 5)
// ---------------------------------------------------------------------------

describe("tracing invalid limits (NaN / Infinity)", () => {
  it("rejects maxMessageChars: NaN (Number.isInteger guard)", () => {
    expect(
      issuePaths({ capture: { maxMessageChars: Number.NaN } }),
    ).toContain("tracing.capture.maxMessageChars");
  });

  it("rejects maxToolOutputChars: Infinity (Number.isInteger guard)", () => {
    expect(
      issuePaths({ capture: { maxToolOutputChars: Infinity } }),
    ).toContain("tracing.capture.maxToolOutputChars");
  });

  it("accepts a zero limit (non-negative integer allows 0)", () => {
    // Real behavior: 0 IS a non-negative integer → valid. It truncates every
    // string to empty at level "truncated" (capture.ts truncateTo(_,0)).
    expect(issuePaths({ capture: { maxMessageChars: 0 } })).toEqual([]);
    expect(issuePaths({ capture: { maxToolOutputChars: 0 } })).toEqual([]);
  });

  it("rejects a non-integer positive fraction (1.5 → Number.isInteger false)", () => {
    expect(
      issuePaths({ capture: { maxMessageChars: 1.5 } }),
    ).toContain("tracing.capture.maxMessageChars");
  });
});

// ---------------------------------------------------------------------------
// Deep-merge invariant — the exact brief words (brief item 3)
// ---------------------------------------------------------------------------

describe("tracing deep-merge invariant (override messages, keep the rest)", () => {
  it("overriding tracing.capture.messages preserves langfuse / toolOutput / flushTimeoutMs (mergeConfig layer)", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      tracing: { capture: { messages: "full" } },
    });
    const t = merged.tracing!;

    // Touched key → the OVERRIDE.
    expect(t.capture.messages).toBe("full");

    // Untouched keys → their DEFAULTS, never deleted by the single-field override.
    expect(t.capture.toolOutput).toBe("truncated");
    expect(t.capture.toolInput).toBe("truncated");
    expect(t.capture.reasoning).toBe("off");
    expect(t.capture.maxMessageChars).toBe(4000);
    expect(t.capture.maxToolOutputChars).toBe(2000);
    expect(t.flushTimeoutMs).toBe(2000);
    expect(t.langfuse).toEqual(DEFAULT_CONFIG.tracing!.langfuse);
    expect(t.langfuse.baseUrl).toBe("");
    expect(t.langfuse.publicKey).toBe("cred://langfuse/publicKey");
    expect(t.langfuse.secretKey).toBe("cred://langfuse/secretKey");
  });

  it("the same invariant holds end-to-end through loadConfig (user config layer)", async () => {
    const dir = await tmpHome();
    try {
      _setHomedirOverride(dir);
      await mkdir(join(dir, ".config", "alix"), { recursive: true });
      await writeFile(
        join(dir, ".config", "alix", "config.json"),
        JSON.stringify({
          model: { provider: "openai", name: "gpt-4o" },
          tracing: {
            langfuse: { baseUrl: "https://langfuse.example" },
          },
        }),
      );
      await mkdir(join(dir, ".alix"), { recursive: true });
      await writeFile(
        join(dir, ".alix", "config.json"),
        JSON.stringify({
          tracing: { capture: { messages: "off" } },
        }),
      );

      const config = await loadConfig(dir);
      const t = config.tracing!;
      // The single project override of messages did NOT delete the user's
      // langfuse block nor the default toolOutput/flushTimeoutMs.
      expect(t.capture.messages).toBe("off");
      expect(t.langfuse.baseUrl).toBe("https://langfuse.example");
      expect(t.langfuse.publicKey).toBe("cred://langfuse/publicKey");
      expect(t.capture.toolOutput).toBe("truncated");
      expect(t.flushTimeoutMs).toBe(2000);
      expect(t.enabled).toBe(false);
    } finally {
      _setHomedirOverride(undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("untouched tracing keys keep their DEFAULTS (disabled-by-default survives the merge)", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      tracing: { capture: { messages: "truncated" } },
    });
    const t = merged.tracing!;
    // The override is byte-identical to the default: nothing changed.
    expect(t.enabled).toBe(false);
    expect(t.flushTimeoutMs).toBe(DEFAULT_CONFIG.tracing!.flushTimeoutMs);
    expect(t.langfuse).toEqual(DEFAULT_CONFIG.tracing!.langfuse);
    expect(t.capture).toEqual(DEFAULT_CONFIG.tracing!.capture);
  });
});
