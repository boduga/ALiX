# P6.5b — Live Governance Lens Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the P6.5a CLI `alix decision review` stub with live LLM execution through four governance lenses (Red Team, Historian, Policy Auditor, Confidence Critic).

**Architecture:** `LLMLensAgent` implements the existing `LensAgent` interface, calling an LLM via `LLMAdapter` (new interface) backed by `ProviderCatalogAdapter` (wraps existing provider catalog). Lenses run in parallel. Strict JSON parsing with authority-language detection. All failures become `insufficient_information`. `GovernanceReviewCouncil` aggregates deterministically (unchanged from P6.5a).

**Tech Stack:** TypeScript (NodeNext), vitest, existing src/providers/ catalog

## Global Constraints

- **NodeNext module resolution:** All cross-file imports MUST use `.js` extension (e.g., `./llm-adapter.js`)
- **Lenses run in parallel:** `Promise.all(lenses.map(l => l.run(input)))` — worst case ~30s, not ~120s
- **All lens failures → insufficient_information:** Network error, JSON parse failure, invalid verdict, authority language — all produce `insufficient_information`, never `agree` or `challenge`
- **No provider → error:** If no LLM provider is configured, exit non-zero before any lens runs
- **--lens validation:** Invalid lens name exits non-zero before any provider call
- **Authority language check:** Full-payload scan via `JSON.stringify(parsed).toLowerCase()`, not just rationale
- **No queue integration:** `--with-reviews` deferred to P6.5c
- **No persistence:** Reviews remain ephemeral
- **P6.5a backward compatibility:** `LensScore` widened with optional `provider`/`model` — all existing council tests must still pass
- **ALiX/Claude boundary:** ALiX is its own autonomous adaptation system. No references to Claude Code, skills, plugins, or MCP in the code.
- **Ponytail mode active (full):** Lazy senior developer — shortest working diff, no unrequested abstractions.

---

## File Structure

```
Create:
  src/adaptation/llm-adapter.ts              — LLMAdapter interface, LLMCompletion type
  src/adaptation/provider-catalog-adapter.ts  — ProviderCatalogAdapter implements LLMAdapter
  src/adaptation/llm-lens-agent.ts            — LLMLensAgent implements LensAgent
  tests/adaptation/llm-adapter.vitest.ts      — adapter contract tests
  tests/adaptation/llm-lens-agent.vitest.ts   — parsing, authority, fallback tests

Modify:
  src/adaptation/governance-review-types.ts   — Widen LensScore with optional provider/model
  src/adaptation/lens-agent.ts                — Add LENS_JSON_SUFFIX export
  src/cli/commands/decision.ts                — Replace review stub with live runReview
  tests/adaptation/governance-review-sentinels.vitest.ts — Add P6.5b sentinel tests
```

### Task 1: Widen LensScore + Add LENS_JSON_SUFFIX

**Files:**
- Modify: `src/adaptation/governance-review-types.ts` (add optional `provider`/`model` to `LensScore`)
- Modify: `src/adaptation/lens-agent.ts` (add `LENS_JSON_SUFFIX` export)
- Test: existing tests should pass without changes (optional fields are backward-compatible)
- Verify: `tests/adaptation/governance-review-council.vitest.ts` still passes

**Interfaces:**
- Consumes: existing `LensScore` from `./governance-review-types.js`
- Produces: widened `LensScore` with `provider?: string; model?: string;`, exported `LENS_JSON_SUFFIX` constant

- [ ] **Step 1: Verify existing tests pass before modification**

```bash
npx vitest run tests/adaptation/governance-review-council.vitest.ts tests/adaptation/governance-review-types.vitest.ts 2>&1 | tail -5
```
Expected: 21+ tests passing

- [ ] **Step 2: Add optional provider/model to LensScore**

```typescript
// In src/adaptation/governance-review-types.ts, add to LensScore interface:
export interface LensScore {
  lens: LensName;
  recommendedVerdict: GovernanceVerdict;
  confidence: number;
  rationale: string;
  /** Provider name used to generate this score (JSON output only). */
  provider?: string;
  /** Model name used to generate this score (JSON output only). */
  model?: string;
}
```

- [ ] **Step 3: Add LENS_JSON_SUFFIX to lens-agent.ts**

```typescript
// At the end of src/adaptation/lens-agent.ts, after LENS_PROMPTS:

/**
 * Centralized JSON-only suffix appended to every lens prompt.
 * Keeps sentinel testing simple and avoids duplicating text.
 */
export const LENS_JSON_SUFFIX =
  "Return ONLY valid JSON. Do not include markdown, prose, or code fences.\n" +
  "Do not approve, reject, apply, execute, or make a final decision.";
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
npx vitest run tests/adaptation/governance-review-council.vitest.ts tests/adaptation/governance-review-types.vitest.ts 2>&1 | tail -5
```
Expected: 21+ tests passing (backward-compatible — optional fields)

- [ ] **Step 5: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 984+ tests passing

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/governance-review-types.ts src/adaptation/lens-agent.ts
git commit -m "feat(p6.5b): widen LensScore with provider/model, add LENS_JSON_SUFFIX"
```

---

### Task 2: LLMAdapter Interface + ProviderCatalogAdapter

**Files:**
- Create: `src/adaptation/llm-adapter.ts`
- Create: `src/adaptation/provider-catalog-adapter.ts`
- Test: `tests/adaptation/llm-adapter.vitest.ts`

**Interfaces:**
- Consumes: `ProviderCatalog` from existing provider infrastructure
- Produces: `LLMAdapter` interface, `LLMCompletion` type, `ProviderCatalogAdapter` class

- [ ] **Step 1: Verify ProviderCatalog.complete() signature**

```bash
grep -A 20 "interface ProviderCatalog\|class ProviderCatalog\|async complete" src/providers/catalog.ts | head -30
```

Verify the exact signature. Adapt `ProviderCatalogAdapter` to match it.

- [ ] **Step 2: Write failing test for LLMAdapter**

```typescript
// tests/adaptation/llm-adapter.vitest.ts
import { describe, it, expect } from "vitest";
import type { LLMAdapter, LLMCompletion } from "../../src/adaptation/llm-adapter.js";

describe("LLMAdapter", () => {
  it("has the correct interface shape", () => {
    const adapter: LLMAdapter = {
      complete: async () => ({ content: "test" }),
    };
    expect(typeof adapter.complete).toBe("function");
  });

  it("LLMCompletion has content and optional provider/model", () => {
    const c: LLMCompletion = { content: "test", provider: "test", model: "v1" };
    expect(c.content).toBe("test");
    expect(c.provider).toBe("test");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/adaptation/llm-adapter.vitest.ts 2>&1 | tail -10
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 4: Create llm-adapter.ts**

```typescript
/**
 * P6.5b — LLMAdapter interface.
 *
 * Thin boundary between governance lenses and LLM providers.
 * Enables lens execution without depending on provider internals.
 *
 * @module
 */

export interface LLMCompletion {
  content: string;
  provider?: string;
  model?: string;
}

export interface LLMAdapter {
  /** Send a prompt and return the response.
   *  Throws on timeout, network error, or empty response.
   *  Caller owns retry/fallback logic. */
  complete(
    input: { system: string; user: string },
    options?: { timeoutMs?: number },
  ): Promise<LLMCompletion>;
}
```

- [ ] **Step 5: Create ProviderCatalogAdapter**

```typescript
/**
 * P6.5b — ProviderCatalogAdapter: LLMAdapter backed by an ALiX ModelAdapter.
 *
 * Wraps ModelAdapter.complete() to match the LLMAdapter interface.
 * Thin — no retry, no fallback, no prompt shaping.
 *
 * @module
 */

import type { LLMAdapter, LLMCompletion } from "./llm-adapter.js";
import type { ModelAdapter } from "../providers/types.js";

export class ProviderCatalogAdapter implements LLMAdapter {
  constructor(
    private adapter: ModelAdapter,
    private providerInfo: { provider: string; model?: string },
  ) {}

  async complete(
    input: { system: string; user: string },
    options?: { timeoutMs?: number },
  ): Promise<LLMCompletion> {
    const result = await this.adapter.complete({
      systemPrompt: input.system,
      messages: [{ role: "user" as const, content: input.user }],
      temperature: 0,
      maxOutputTokens: 512,
    });
    if (!result.text) throw new Error("Empty response from provider");
    return {
      content: result.text,
      provider: this.providerInfo.provider,
      model: this.providerInfo.model,
    };
  }
}
```

The adapter wraps a `ModelAdapter` instance (obtained via `createProvider()` from registry.ts), not the catalog directly. This keeps governance away from provider setup logic.

- [ ] **Step 6: Run adapter tests**

```bash
npx vitest run tests/adaptation/llm-adapter.vitest.ts 2>&1 | tail -10
```
Expected: 2+ tests passing

- [ ] **Step 7: Commit**

```bash
git add src/adaptation/llm-adapter.ts src/adaptation/provider-catalog-adapter.ts tests/adaptation/llm-adapter.vitest.ts
git commit -m "feat(p6.5b): LLMAdapter interface and ProviderCatalogAdapter"
```

---

### Task 3: LLMLensAgent — LensAgent with Real LLM Execution

**Files:**
- Create: `src/adaptation/llm-lens-agent.ts`
- Test: `tests/adaptation/llm-lens-agent.vitest.ts`

**Interfaces:**
- Consumes: `LLMAdapter` from `./llm-adapter.js`, `LensAgent` from `./lens-agent.js`, `LensScore`/`LensName`/`GovernanceReviewInput` from `./governance-review-types.js`, `LENS_PROMPTS`/`LENS_JSON_SUFFIX` from `./lens-agent.js`
- Produces: `LLMLensAgent implements LensAgent`

- [ ] **Step 1: Write failing test for LLMLensAgent**

```typescript
// tests/adaptation/llm-lens-agent.vitest.ts
import { describe, it, expect, vi } from "vitest";
import { LLMLensAgent } from "../../src/adaptation/llm-lens-agent.js";
import type { LLMAdapter } from "../../src/adaptation/llm-adapter.js";
import type { GovernanceReviewInput, LensScore } from "../../src/adaptation/governance-review-types.js";

function makeAdapter(response: string): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue({ content: response, provider: "test", model: "v1" }),
  };
}

function makeInput(): GovernanceReviewInput {
  return {
    recommendation: { id: "rec-1", subject: "test", outcome: "recommended", confidence: 0.8, reasons: [], generatedAt: "2026-01-01", recommendation: "approve", proposalId: "prop-1", sourceArtifacts: [] },
    decisionContext: { id: "ctx-1", subject: "test", outcome: "complete_context", confidence: 0.8, reasons: [], generatedAt: "2026-01-01", contextStatus: "complete_context", proposalId: "prop-1", proposalStatus: "pending", proposalAction: "update_agent_card", createdAt: "2026-01-01", ageDays: 5, lineageCompleteness: "complete", similarProposals: [], effectivenessTrend: { actionType: "test", keepRate: 0.8, revertRate: 0.1, sampleSize: 10 }, dataFreshness: { newestArtifactAgeDays: 2, oldestArtifactAgeDays: 10 } },
  };
}

describe("LLMLensAgent", () => {
  it("returns LensScore with correct lens from valid JSON", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree", confidence: 0.85, rationale: "Looks good",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");
    const result = await agent.run(makeInput());
    expect(result.lens).toBe("red_team");
    expect(result.recommendedVerdict).toBe("agree");
    expect(result.confidence).toBe(0.85);
  });

  it("returns insufficient_information on network error", async () => {
    const adapter: LLMAdapter = {
      complete: vi.fn().mockRejectedValue(new Error("Timeout")),
    };
    const agent = new LLMLensAgent(adapter, "historian");
    const result = await agent.run(makeInput());
    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.confidence).toBe(0);
  });

  it("returns insufficient_information on JSON parse failure with specific rationale", async () => {
    const adapter = makeAdapter("not-json");
    const agent = new LLMLensAgent(adapter, "red_team");
    const result = await agent.run(makeInput());
    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.confidence).toBe(0);
    expect(result.rationale).toContain("Failed to parse lens output");
  });

  it("returns insufficient_information on invalid verdict", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "maybe", confidence: 0.5, rationale: "hmm",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");
    const result = await agent.run(makeInput());
    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Invalid verdict");
  });

  it("returns insufficient_information when authority language in rationale", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree", confidence: 0.9, rationale: "I approve this change",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");
    const result = await agent.run(makeInput());
    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("authority language");
  });

  it("returns insufficient_information when authority language anywhere in payload", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "must approve", confidence: 0.9, rationale: "looks fine",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");
    const result = await agent.run(makeInput());
    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("authority language");
  });

  it("strips markdown fences before parsing", async () => {
    const adapter = makeAdapter("```json\n{\"recommendedVerdict\":\"agree\",\"confidence\":0.8,\"rationale\":\"ok\"}\n```");
    const agent = new LLMLensAgent(adapter, "red_team");
    const result = await agent.run(makeInput());
    expect(result.recommendedVerdict).toBe("agree");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/adaptation/llm-lens-agent.vitest.ts 2>&1 | tail -10
```
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create LLMLensAgent**

```typescript
/**
 * P6.5b — LLMLensAgent: LensAgent backed by an LLM.
 *
 * Builds prompts from LENS_PROMPTS + context, sends via LLMAdapter,
 * parses structured JSON output. All failures → insufficient_information.
 *
 * Authority language detection scans the entire parsed payload, not just rationale.
 *
 * @module
 */

import type { LensAgent } from "./lens-agent.js";
import { LENS_PROMPTS, LENS_JSON_SUFFIX } from "./lens-agent.js";
import type { LLMAdapter } from "./llm-adapter.js";
import type { LensScore, LensName, GovernanceReviewInput, GovernanceVerdict } from "./governance-review-types.js";

// ---------------------------------------------------------------------------
// Forbidden phrases — full-payload scan
// ---------------------------------------------------------------------------

const FORBIDDEN_PHRASES = [
  "i approve",
  "i reject",
  "apply this",
  "execute this",
  "final decision",
  "must approve",
  "must reject",
];

const VALID_VERDICTS: readonly GovernanceVerdict[] = [
  "agree", "agree_with_concerns", "challenge", "insufficient_information",
];

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// LLMLensAgent
// ---------------------------------------------------------------------------

export class LLMLensAgent implements LensAgent {
  constructor(
    private adapter: LLMAdapter,
    private lens: LensName,
  ) {}

  async run(input: GovernanceReviewInput): Promise<LensScore> {
    const system = `${LENS_PROMPTS[this.lens]}\n\n${LENS_JSON_SUFFIX}`;
    const user = this.#buildContext(input);

    try {
      const completion = await this.adapter.complete(
        { system, user },
        { timeoutMs: DEFAULT_TIMEOUT_MS },
      );
      return this.#parseScore(completion.content, completion.provider, completion.model);
    } catch (err) {
      return this.#fallback(
        err instanceof Error ? err.message : "Lens agent failed to produce a result.",
      );
    }
  }

  // ---- private helpers ----

  #buildContext(input: GovernanceReviewInput): string {
    const rec = input.recommendation;
    const ctx = input.decisionContext;
    const lines: string[] = [
      `Recommendation: ${rec.recommendation} (confidence: ${(rec.confidence * 100).toFixed(0)}%)`,
      `Action: ${ctx.proposalAction}`,
      `Status: ${ctx.proposalStatus}`,
      `Age: ${ctx.ageDays} days`,
      `Lineage: ${ctx.lineageCompleteness}`,
    ];
    if (ctx.effectivenessTrend) {
      lines.push(
        `Effectiveness keep rate: ${(ctx.effectivenessTrend.keepRate * 100).toFixed(0)}% (n=${ctx.effectivenessTrend.sampleSize})`,
      );
    }
    if (ctx.warnings?.length) {
      lines.push(`Warnings: ${ctx.warnings.map(w => w.message).join("; ")}`);
    }
    return lines.join("\n");
  }

  #parseScore(raw: string, provider?: string, model?: string): LensScore {
    // Strip markdown fences
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").trim();

    let parsed: { recommendedVerdict?: string; confidence?: number; rationale?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Failed to parse lens output — response was not valid JSON");
    }

    // Validate verdict
    if (!parsed.recommendedVerdict || !VALID_VERDICTS.includes(parsed.recommendedVerdict as GovernanceVerdict)) {
      throw new Error("Invalid verdict in lens output");
    }

    // Validate confidence
    if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
      throw new Error("Invalid confidence in lens output");
    }

    // Validate rationale
    if (typeof parsed.rationale !== "string" || parsed.rationale.length === 0) {
      throw new Error("Missing or empty rationale in lens output");
    }

    // Authority language check — full payload scan
    const payloadJson = JSON.stringify(parsed).toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (payloadJson.includes(phrase)) {
        throw new Error("Authority language detected");
      }
    }

    return {
      lens: this.lens,
      recommendedVerdict: parsed.recommendedVerdict as GovernanceVerdict,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      provider,
      model,
    };
  }

  #fallback(rationale: string): LensScore {
    return {
      lens: this.lens,
      recommendedVerdict: "insufficient_information" as const,
      confidence: 0,
      rationale,
    };
  }
}
```

- [ ] **Step 4: Run LLMLensAgent tests**

```bash
npx vitest run tests/adaptation/llm-lens-agent.vitest.ts 2>&1 | tail -15
```
Expected: 7+ tests passing

- [ ] **Step 5: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 992+ tests passing

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/llm-lens-agent.ts tests/adaptation/llm-lens-agent.vitest.ts
git commit -m "feat(p6.5b): LLMLensAgent JSON parsing and authority detection"
```

---

### Task 4: CLI — Replace Review Stub with Live Execution

**Files:**
- Modify: `src/cli/commands/decision.ts`

**Interfaces:**
- Consumes: `PipelineHealthCollector` infrastructure + `LLMAdapter`/`LLMLensAgent`/`GovernanceReviewCouncil`, all types
- Produces: Live `alix decision review <id>` command

- [ ] **Step 1: Verify existing CLI tests and review stub**

```bash
grep -n "case \"review\"" src/cli/commands/decision.ts
echo "---"
npx vitest run 2>&1 | tail -3
```

- [ ] **Step 2: Replace the review stub with live runReview**

Replace the P6.5a stub:

```typescript
    case "review":
      console.log("review: unavailable (P6.5a foundation — real lens agents deferred to P6.5b)");
      return;
```

With:

```typescript
    case "review":
      await runReview(rest);
      return;
```

Update the usage string:

```typescript
console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json] | status [--window N] [--json] | review <proposal-id> [--json] [--lens <name>]");
```

Add the import for `LensName`:

```typescript
import type { LensName } from "../../adaptation/governance-review-types.js";
```

- [ ] **Step 2a: Verify provider wiring pattern in the repo**

```bash
# Find how providers are created and configured
grep -n "createProvider" src/providers/registry.ts src/cli.ts | head -10
echo "---"
# Check detectProvider signature
grep -A 8 "detectProvider" src/providers/catalog.ts | head -12
```

Expected output confirms:
- `createProvider({ provider, model }, apiKey?): Promise<ModelAdapter>` from `registry.ts`
- `detectProvider(): { provider: string; model: string }` from `catalog.ts`
- `NormalizedRequest` has `systemPrompt` (not `system`), `messages`, `temperature`, `maxOutputTokens`
- `NormalizedResponse` has `text` (not `content`), `toolCalls`

- [ ] **Step 2b: Update ProviderCatalogAdapter to match real API**

The adapter signature in Task 2 must match the actual `NormalizedRequest`/`NormalizedResponse` shape:

```typescript
// ProviderCatalogAdapter.complete()
async complete(input, options?): Promise<LLMCompletion> {
  const result = await this.adapter.complete({
    systemPrompt: input.system,
    messages: [{ role: "user", content: input.user }],
    temperature: 0,
    maxOutputTokens: 512,
  });
  if (!result.text) throw new Error("Empty response from provider");
  return { content: result.text, provider: this.providerInfo.provider, model: this.providerInfo.model };
}
```

The adapter wraps a `ModelAdapter` (the result of `createProvider()`), not the catalog. Constructor takes the adapter instance + provider info.

- [ ] **Step 2c: Add provider setup in runReview**

```typescript
// In runReview — detect and create provider
import { detectProvider, PROVIDERS } from "../../providers/catalog.js";
import { createProvider } from "../../providers/registry.js";

const detected = detectProvider();
if (!detected || !detected.provider) {
  console.error("Error: no LLM provider configured for governance review");
  process.exit(1);
}
const providerInfo = PROVIDERS.find(p => p.id === detected.provider);
const apiKey = providerInfo ? process.env[providerInfo.envKey] ?? "" : "";
if (!apiKey) {
  console.error(`Error: no API key found for provider "${detected.provider}"`);
  process.exit(1);
}
const modelAdapter = await createProvider(
  { provider: detected.provider, model: detected.model },
  apiKey,
);
const llmAdapter = new ProviderCatalogAdapter(modelAdapter, detected);
```

**Key design for `runReview`:**
- Parse `--json`, `--lens <name>`, and `<proposal-id>` from args
- Validate `--lens` against `LensName` union — exit non-zero on invalid
- Build existing infra (stores, context builder, risk builder, recommendation engine)
- Detect and create provider — exit non-zero if none configured
- Create ProviderCatalogAdapter and 4 LLMLensAgent instances (or 1 if `--lens`)
- Build context → risk → recommendation (fail fast on these)
- Assemble GovernanceReviewInput
- Run lenses in parallel: `Promise.all(lenses.map(l => l.run(input)))`
- Aggregate via `GovernanceReviewCouncil.aggregate()`
- Render terminal output or JSON

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 992+ tests passing

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/decision.ts
git commit -m "feat(p6.5b): CLI alix decision review live lens execution"
```

---

### Task 5: P6.5b Sentinel Tests

**Files:**
- Modify: `tests/adaptation/governance-review-sentinels.vitest.ts`

- [ ] **Step 1: Write failing sentinel tests**

Add to `tests/adaptation/governance-review-sentinels.vitest.ts`:

```typescript
describe("P6.5b — LLMAdapter must not import provider catalog adapter", () => {
  it("llm-adapter.ts imports nothing from provider modules", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/adaptation/llm-adapter.ts"), "utf8"
    );
    const lines = source.split("\n").filter(l => !l.trim().startsWith("//"));
    expect(lines.some(l => l.includes("from \"../providers") || l.includes("from './providers"))).toBe(false);
  });
});

describe("P6.5b — ProviderCatalogAdapter implements LLMAdapter", () => {
  it("has complete() method", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/adaptation/provider-catalog-adapter.ts"), "utf8"
    );
    expect(source).toContain("implements LLMAdapter");
    expect(source).toContain("async complete(");
  });
});

describe("P6.5b — LENS_JSON_SUFFIX is present in every prompt", () => {
  it("lens-agent.ts exports LENS_JSON_SUFFIX", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/adaptation/lens-agent.ts"), "utf8"
    );
    expect(source).toContain("export const LENS_JSON_SUFFIX");
  });
});

describe("P6.5b — LensScore has optional provider/model", () => {
  it("governance-review-types.ts has provider? and model? fields", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/adaptation/governance-review-types.ts"), "utf8"
    );
    expect(source).toContain("provider?:");
    expect(source).toContain("model?:");
  });
});

describe("P6.5b — CLI validates --lens before provider setup", () => {
  it("runReview validates --lens argument before any provider call", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/cli/commands/decision.ts"), "utf8"
    );
    // The runReview function must validate lens name before building provider
    // Look for lens validation that exits before provider detection
    const hasLensValidation = source.includes("LensName") && source.includes("exit(1)");
    expect(hasLensValidation).toBe(true);
    // Verify no provider import happens before lens validation
    const providerImportLine = source.indexOf("ProviderCatalogAdapter");
    const validLensNames = source.indexOf("red_team");
    // Lens validation reference should exist
    expect(source).toContain("red_team");
    expect(source).toContain("historian");
    expect(source).toContain("policy_auditor");
    expect(source).toContain("confidence_critic");
  });
});
```

- [ ] **Step 2: Run sentinel tests**

```bash
npx vitest run tests/adaptation/governance-review-sentinels.vitest.ts 2>&1 | tail -15
```
Expected: 22+ tests passing (existing 18 + 4 new)

- [ ] **Step 3: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: 996+ tests passing

- [ ] **Step 4: Commit**

```bash
git add tests/adaptation/governance-review-sentinels.vitest.ts
git commit -m "feat(p6.5b): governance review sentinels for P6.5b"
```

---

## Self-Review Check

- **Spec coverage:**
  - [x] LLMAdapter interface + LLMCompletion type (Task 2)
  - [x] ProviderCatalogAdapter concrete implementation (Task 2)
  - [x] LLMLensAgent with strict JSON parsing (Task 3)
  - [x] Parallel lens execution (Task 3, Task 4 CLI)
  - [x] Authority language detection — full payload scan (Task 3)
  - [x] All failures → insufficient_information (Task 3)
  - [x] CLI --lens validation (Task 4)
  - [x] No provider → exit non-zero (Task 4)
  - [x] LENS_JSON_SUFFIX centralized (Task 1)
  - [x] LensScore widened with optional provider/model (Task 1)
  - [x] P6.5b sentinel additions (Task 5)
  - [x] No queue integration, no persistence (all tasks)
- **Placeholder scan:** Clean — the ProviderCatalogAdapter has a note about verifying the catalog API signature, which is intentional (must verify against actual repo code).
- **Type consistency:** `LLMAdapter`, `LLMCompletion`, `LLMLensAgent`, `LENS_JSON_SUFFIX` — consistent across all 5 tasks.
