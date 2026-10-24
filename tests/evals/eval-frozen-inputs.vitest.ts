/**
 * eval-frozen-inputs.vitest.ts — pins the §3 frozen-input contract.
 *
 * The collection proposal says a run admitted with a missing pin is not Gate B
 * evidence. The dangerous failure is not a crash: it is a plausible-looking
 * value standing in for an unmeasured one, which is why the model revision and
 * an unknown rate must come back `null` with a blocking reason instead of a
 * guess.
 */

import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureFrozenInputs, CORPUS_FILES } from "../../src/operations/evals/eval-frozen-inputs.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

describe("captureFrozenInputs", () => {
  it("pins config, tools, corpus and environment deterministically", () => {
    const at = new Date("2026-10-23T12:00:00.000Z");
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", { now: at });
    const b = captureFrozenInputs(repoRoot, "openai", "gpt-4o", { now: at });

    expect(a.configHash).toBe(b.configHash);
    expect(a.offeredToolsHash).toBe(b.offeredToolsHash);
    expect(a.corpusHash).toBe(b.corpusHash);
    expect(a.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.offeredToolsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.corpusHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.offeredTools.length).toBeGreaterThan(0);
    expect(a.offeredTools).toEqual([...a.offeredTools].sort());
    expect(a.corpusFiles).toHaveLength(CORPUS_FILES.length);
    expect(a.corpusFiles.every(f => f.sha256 !== null)).toBe(true);
    expect(a.environment.node).toBe(process.version);
  });

  it("changes the config pin when the model changes", () => {
    const at = new Date("2026-10-23T12:00:00.000Z");
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", { now: at });
    const b = captureFrozenInputs(repoRoot, "openai", "gpt-4", { now: at });
    expect(a.configHash).not.toBe(b.configHash);
  });

  it("records the pricing rate that applied at the pin time", () => {
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", {
      now: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(a.pricing.inputPerMillion).toBe(2.5);
    expect(a.pricing.outputPerMillion).toBe(10);
    expect(a.pricing.currency).toBe("USD");
    expect(a.pricing.effectiveFrom).toBe("2025-01-01");
  });

  it("blocks the run when no rate is known, instead of assuming a price", () => {
    // A BILLABLE provider with no catalog rate. `ollama` cannot serve here: it is
    // non-billable by definition, so $0 is measured rather than unknown.
    const a = captureFrozenInputs(repoRoot, "hive", "unlisted-model", {
      now: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(a.pricing.inputPerMillion).toBeNull();
    expect(a.pricing.effectiveFrom).toBeNull();
    expect(a.blocking.some(r => /no pricing pin/.test(r))).toBe(true);
    expect(a.admissible).toBe(false);
  });

  it("blocks the run when the immutable model revision is unknown", () => {
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", {
      now: new Date("2026-10-23T12:00:00.000Z"),
    });
    // A plain alias is not an immutable identity, so this must be reported as
    // unknown rather than filled with the alias itself.
    expect(a.model.revision).toBeNull();
    expect(a.model.revisionSource).toBeNull();
    expect(a.model.name).toBe("gpt-4o");
    expect(a.blocking.some(r => /immutable model revision/.test(r))).toBe(true);
    expect(a.admissible).toBe(false);
  });

  it("accepts a dated snapshot model id as the immutable revision", () => {
    const a = captureFrozenInputs(repoRoot, "hive", "deepseek-ai/deepseek-v4.1-flash-1017", {
      now: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(a.model.revision).toBe("deepseek-ai/deepseek-v4.1-flash-1017");
    expect(a.model.revisionSource).toBe("model-id-snapshot");
    expect(a.blocking.some(r => /immutable model revision/.test(r))).toBe(false);
  });

  it("prefers a provider-reported fingerprint over the model id", () => {
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", {
      now: new Date("2026-10-23T12:00:00.000Z"),
      providerRevision: "fp_abc123",
    });
    expect(a.model.revision).toBe("fp_abc123");
    expect(a.model.revisionSource).toBe("provider-reported");
    expect(a.blocking.some(r => /immutable model revision/.test(r))).toBe(false);
  });

  it("prefers an operator rate snapshot and records its provenance", () => {
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", {
      now: new Date("2026-10-23T12:00:00.000Z"),
      rateSnapshot: {
        provider: "openai",
        model: "gpt-4o",
        inputPerMillion: 2.5,
        outputPerMillion: 10,
        currency: "USD",
        source: "provider pricing page",
        observedAt: "2026-10-23T09:00:00.000Z",
      },
    });
    expect(a.pricing.provenance).toBe("operator-snapshot");
    expect(a.pricing.source).toBe("provider pricing page");
    expect(a.pricing.observedAt).toBe("2026-10-23T09:00:00.000Z");
  });

  it("refuses a rate snapshot for a different model rather than repricing silently", () => {
    const a = captureFrozenInputs(repoRoot, "openai", "gpt-4o", {
      now: new Date("2026-10-23T12:00:00.000Z"),
      rateSnapshot: {
        provider: "openai",
        model: "gpt-4",
        inputPerMillion: 30,
        outputPerMillion: 60,
        currency: "USD",
        source: "provider pricing page",
        observedAt: "2026-10-23T09:00:00.000Z",
      },
    });
    expect(a.pricing.inputPerMillion).toBeNull();
    expect(a.blocking.some(r => /does not match/.test(r))).toBe(true);
    expect(a.admissible).toBe(false);
  });

  it("reports a missing corpus file as blocking rather than hashing nothing", () => {
    const a = captureFrozenInputs(join(repoRoot, "does-not-exist"), "openai", "gpt-4o", {
      now: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(a.corpusFiles.every(f => f.sha256 === null)).toBe(true);
    expect(a.blocking.some(r => /corpus file is missing/.test(r))).toBe(true);
    expect(a.admissible).toBe(false);
  });
});

describe("non-billable providers", () => {
  it("pins a local provider at $0 rather than blocking on a missing rate", async () => {
    const { captureFrozenInputs } = await import("../../src/operations/evals/eval-frozen-inputs.js");
    // Zero is MEASURED for a local CPU provider, not unknown. Treating "no rate"
    // as unknown blocked stratum 9 entirely, which costs nothing and therefore
    // needs no ceiling enforcement.
    const a = captureFrozenInputs(repoRoot, "ollama", "llama3.2:3b", {
      now: new Date("2026-10-24T12:00:00.000Z"),
      providerRevision: "a80c4f17acd5",
    });
    expect(a.pricing.provenance).toBe("non-billable");
    expect(a.pricing.inputPerMillion).toBe(0);
    expect(a.pricing.outputPerMillion).toBe(0);
    expect(a.blocking).toEqual([]);
    expect(a.admissible).toBe(true);
  });

  it("still requires an immutable revision for a local model", async () => {
    const { captureFrozenInputs } = await import("../../src/operations/evals/eval-frozen-inputs.js");
    // A mutable tag is not an identity; `llama3.2:3b` can be repointed.
    const a = captureFrozenInputs(repoRoot, "ollama", "llama3.2:3b", {
      now: new Date("2026-10-24T12:00:00.000Z"),
    });
    expect(a.blocking.some(r => /immutable model revision/.test(r))).toBe(true);
  });
});
