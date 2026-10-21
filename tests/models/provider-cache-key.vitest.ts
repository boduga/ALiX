/**
 * provider-cache-key.vitest.ts — pins that the provider cache key covers every
 * field that shapes the constructed adapter.
 *
 * Found while wiring stratum 9 (local CPU-only). A config asking for
 * `models.default.timeoutMs` was silently ignored: `createProvider`'s cache key
 * omitted `timeoutMs`/`streamIdleTimeoutMs`, so a provider first built with the
 * 300s default was reused for a config that requested a longer bound. The
 * requested timeout never took effect, which made a config value unenforceable.
 *
 * The observable symptom was concrete: an ollama run aborted at exactly 300000ms
 * with `timeoutMs: 1800000` in the config.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const registrySrc = readFileSync(
  join(repoRoot, "src", "models", "providers", "registry.ts"),
  "utf-8",
);

/** Extract the cache-key expression from createProvider. */
function cacheKeyBlock(): string {
  const start = registrySrc.indexOf("const key = ");
  expect(start).toBeGreaterThan(-1);
  const end = registrySrc.indexOf(";", start);
  return registrySrc.slice(start, end);
}

describe("provider cache key", () => {
  it("includes timeoutMs", () => {
    // The exact field whose omission caused a configured timeout to be ignored.
    expect(cacheKeyBlock()).toContain("config.timeoutMs");
  });

  it("includes streamIdleTimeoutMs", () => {
    expect(cacheKeyBlock()).toContain("config.streamIdleTimeoutMs");
  });

  it("includes localModelPath", () => {
    // local-llama resolves its GGUF from this; two different model paths must
    // not share one cached adapter.
    expect(cacheKeyBlock()).toContain("config.localModelPath");
  });

  it("still distinguishes provider, model and base URLs", () => {
    const block = cacheKeyBlock();
    for (const field of [
      "config.provider",
      "model",
      "config.ollamaBaseUrl",
      "config.localLlamaBaseUrl",
      "config.internBaseUrl",
    ]) {
      expect(block).toContain(field);
    }
  });
});
