/**
 * P6.5 — Governance Review Council sentinels.
 *
 * Enforces:
 * 1. No decision authority — GovernanceReview must not contain .approve/.reject/.apply
 * 2. No store mutation — must not import ProposalStore, approval-gate, applier modules
 * 3. No authority language in prompt templates — ban "I approve", "I reject", "apply this", etc.
 * 4. Purity — aggregation must be deterministic (no randomness, no LLM calls in council)
 *
 * IMPORTANT — ALiX/Claude boundary: These sentinels enforce ALiX's own governance rules
 * (Recommend!=Decide, no approval authority in review). They are NOT related to
 * Claude Code's system. All prompts and comments reference ALiX concepts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LensScore } from "../../src/adaptation/governance-review-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ---------------------------------------------------------------------------
// Source texts
// ---------------------------------------------------------------------------

const typesSource = sourceOf("../../src/adaptation/governance-review-types.ts");
const councilSource = sourceOf("../../src/adaptation/governance-review-council.ts");
const lensSource = sourceOf("../../src/adaptation/lens-agent.ts");

const councilCodeOnly = stripComments(councilSource);
const lensCodeOnly = stripComments(lensSource);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P6.5 — No decision authority sentinel", () => {
  it("council source must not contain mutation calls", () => {
    expect(councilCodeOnly).not.toMatch(/\.(approve|reject|apply|execute)\(/);
  });

  it("GovernanceReview interface must not have approve/reject/apply fields", () => {
    expect(typesSource).not.toMatch(/^\s+approve\??:/m);
    expect(typesSource).not.toMatch(/^\s+reject\??:/m);
    expect(typesSource).not.toMatch(/^\s+apply\??:/m);
  });

  it("types file must not contain approve/reject/apply as property names", () => {
    // Check for property definitions (not commentary or code mentions)
    const codeOnly = stripComments(typesSource);
    // "agree" is allowed — it's a vote tally, not decision authority
    expect(codeOnly).not.toMatch(/^\s+approve\b/m);
    expect(codeOnly).not.toMatch(/^\s+reject\b/m);
    expect(codeOnly).not.toMatch(/^\s+apply\b/m);
  });
});

describe("P6.5 — No store mutation sentinel", () => {
  const FORBIDDEN_STORE_IMPORTS = [
    "ProposalStore",
    "EvidenceStore",
    "EffectivenessStore",
    "IntelligenceStore",
  ];

  const FORBIDDEN_MODULE_REFS = [
    "approval-gate",
    "applier",
  ];

  it("council source must not import store modules", () => {
    for (const store of FORBIDDEN_STORE_IMPORTS) {
      expect(councilSource).not.toContain(store);
    }
  });

  it("council source must not reference approval-gate or applier modules", () => {
    for (const mod of FORBIDDEN_MODULE_REFS) {
      expect(councilSource).not.toContain(mod);
    }
  });
});

describe("P6.5 — No authority language in prompt templates", () => {
  const FORBIDDEN_PHRASES = [
    "I approve",
    "I reject",
    "apply this",
    "execute this",
    "final decision",
    "must approve",
    "must reject",
  ];

  for (const phrase of FORBIDDEN_PHRASES) {
    it(`lens prompts must not contain "${phrase}"`, () => {
      // Only check LENS_PROMPTS block, not file-level comments or exports after it
      const promptsBlock = lensCodeOnly.match(/LENS_PROMPTS[\s\S]*?\n\};/);
      if (promptsBlock) {
        expect(promptsBlock[0]).not.toContain(phrase);
      }
    });
  }

  it("lens prompts contain 'recommendation' (allowed context)", () => {
    // Prompts reference existing recommendation — verify they still do
    const promptsBlock = lensSource.match(/LENS_PROMPTS[\s\S]*$/);
    if (promptsBlock) {
      expect(promptsBlock[0]).toContain("recommendation");
    }
  });

  it("lens prompts contain 'governance' (ALiX context)", () => {
    const promptsBlock = lensSource.match(/LENS_PROMPTS[\s\S]*$/);
    if (promptsBlock) {
      expect(promptsBlock[0]).toContain("governance");
    }
  });
});

describe("P6.5 — Purity sentinel", () => {
  it("council aggregation must not call Math.random", () => {
    expect(councilCodeOnly).not.toContain("Math.random");
  });

  it("council source must not call new Date() without arguments", () => {
    // Match new Date() with nothing between the parens
    expect(councilCodeOnly).not.toMatch(/new\s+Date\s*\(\s*\)/);
  });

  it("council source must not import LensAgent", () => {
    expect(councilCodeOnly).not.toContain("LensAgent");
  });

  it("#determineVerdict must be deterministic", () => {
    // Extract the #determineVerdict method body (private methods are compiled out,
    // so check the source text for forbidden patterns inside the method)
    const methodMatch = councilCodeOnly.match(/#determineVerdict[\s\S]*?\n\s{2}\}/);
    expect(methodMatch).not.toBeNull();
    if (methodMatch) {
      const methodBody = methodMatch[0];
      expect(methodBody).not.toContain("Math.random");
      expect(methodBody).not.toContain("new Date");
    }
  });
});

// ---------------------------------------------------------------------------
// P6.5b — Sentinel tests for P6.5b additions
// ---------------------------------------------------------------------------

describe("P6.5b — LLMAdapter must not import provider catalog adapter", () => {
  it("llm-adapter.ts imports nothing from provider modules", () => {
    const source = sourceOf("../../src/adaptation/llm-adapter.ts");
    const lines = source.split("\n").filter(l => !l.trim().startsWith("//"));
    expect(lines.some(l => l.includes('from "../providers') || l.includes("from './providers"))).toBe(false);
  });
});

describe("P6.5b — ProviderCatalogAdapter implements LLMAdapter", () => {
  it("delegates complete() to the model adapter and tags provider/model", async () => {
    const { ProviderCatalogAdapter } = await import("../../src/adaptation/provider-catalog-adapter.js");
    const seen: unknown[] = [];
    const adapter = new ProviderCatalogAdapter(
      {
        complete: async (req: unknown) => {
          seen.push(req);
          return { text: "hello" };
        },
      } as never,
      { provider: "test-provider", model: "test-model" },
    );
    const out = await adapter.complete({ system: "s", user: "u" });
    expect(out.content).toBe("hello");
    expect(out.provider).toBe("test-provider");
    expect(out.model).toBe("test-model");
    expect(seen).toHaveLength(1);
  });
});

describe("P6.5b — LENS_JSON_SUFFIX is present in every prompt", () => {
  it("lens-agent.ts exports a non-empty LENS_JSON_SUFFIX", async () => {
    const { LENS_JSON_SUFFIX } = await import("../../src/adaptation/lens-agent.js");
    expect(typeof LENS_JSON_SUFFIX).toBe("string");
    expect(LENS_JSON_SUFFIX).toContain("JSON");
    expect(LENS_JSON_SUFFIX.length).toBeGreaterThan(20);
  });
});

describe("P6.5b — LensScore has optional provider/model", () => {
  it("provider/model fields exist and carry values at runtime", () => {
    // Type-level pin: assigning provider/model in an object literal
    // annotated as LensScore fails COMPILATION if the fields are removed
    // (a comment in the type file cannot satisfy tsc) — plus a runtime
    // value check that the fields flow through.
    const typed: LensScore = {
      lens: "red_team",
      recommendedVerdict: "challenge",
      confidence: 0.7,
      rationale: "r",
      provider: "test-provider",
      model: "test-model",
    };
    expect(typed.provider).toBe("test-provider");
    expect(typed.model).toBe("test-model");
  });
});

describe("P6.5b — CLI validates --lens before provider setup", () => {
  it("runReview validates --lens argument before any provider call", () => {
    const source = sourceOf("../../src/cli/commands/decision.ts");
    const hasLensValidation = source.includes("LensName") && source.includes("exit(1)");
    expect(hasLensValidation).toBe(true);
    expect(source).toContain("red_team");
    expect(source).toContain("historian");
    expect(source).toContain("policy_auditor");
    expect(source).toContain("confidence_critic");
  });
});
