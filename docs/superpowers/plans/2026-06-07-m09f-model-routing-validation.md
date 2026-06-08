# M0.9-F: Model Routing Validation Spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that the default `balanced-local` model profile (qwen3:4b for fast tier, qwen3:8b for thinking/critic, qwen2.5-coder:7b for coding) routes correctly against curated prompts — classification accuracy, intent recognition, and risk assessment.

**Architecture:** A standalone validation script that sends curated prompts to each model tier, collects structured JSON responses, and computes accuracy metrics against expected values. The script is run manually (not wired into the agent loop) and produces a report.

**Tech Stack:** TypeScript, Ollama API, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/validate-model-routing.ts` | **Create** | Validation runner that prompts each model tier and scores results |
| `scripts/validation-cases.ts` | **Create** | Curated test prompts with expected domain/intent/risk |
| `tests/scripts/validate-model-routing.test.ts` | **Create** | Tests for the scoring logic |

---

### Task 1: Create validation cases

**Files:**
- Create: `scripts/validation-cases.ts`

- [ ] **Step 1: Write validation cases**

```typescript
import type { ModelRoutingCase } from "../src/kernel/model-routing-validation.js";

/**
 * Curated prompts for model routing validation.
 * Each case tests whether a model can correctly classify domain, intent, and risk.
 */
export const VALIDATION_CASES: ModelRoutingCase[] = [
  // ── Coding ──────────────────────────────────────────────────
  { id: "coding-1", prompt: "fix the null pointer in user.ts", expectedDomain: "coding", expectedIntent: "fix bug", expectedRisk: "medium" },
  { id: "coding-2", prompt: "add a healthz endpoint to server.ts", expectedDomain: "coding", expectedIntent: "add feature", expectedRisk: "low" },
  { id: "coding-3", prompt: "refactor the auth module to use JWT", expectedDomain: "coding", expectedIntent: "refactor", expectedRisk: "high" },
  { id: "coding-4", prompt: "write unit tests for the payment service", expectedDomain: "coding", expectedIntent: "add tests", expectedRisk: "low" },
  { id: "coding-5", prompt: "create a new TypeScript project with Express", expectedDomain: "coding", expectedIntent: "scaffold", expectedRisk: "low" },

  // ── Research ────────────────────────────────────────────────
  { id: "research-1", prompt: "research the best vector database for local AI", expectedDomain: "research", expectedIntent: "compare technologies", expectedRisk: "low" },
  { id: "research-2", prompt: "find all MCP servers related to database access", expectedDomain: "research", expectedIntent: "discover tools", expectedRisk: "low" },
  { id: "research-3", prompt: "compare Ollama vs llama.cpp for local inference", expectedDomain: "research", expectedIntent: "compare tools", expectedRisk: "low" },

  // ── Infrastructure ──────────────────────────────────────────
  { id: "infra-1", prompt: "audit the docker-compose.yml for security issues", expectedDomain: "infra", expectedIntent: "security audit", expectedRisk: "medium" },
  { id: "infra-2", prompt: "design a zero-trust network for homelab services", expectedDomain: "infra", expectedIntent: "design architecture", expectedRisk: "high" },

  // ── Docs ────────────────────────────────────────────────────
  { id: "docs-1", prompt: "write a README for the new project", expectedDomain: "docs", expectedIntent: "write documentation", expectedRisk: "low" },
  { id: "docs-2", prompt: "document the API endpoints", expectedDomain: "docs", expectedIntent: "write documentation", expectedRisk: "low" },

  // ── Business ────────────────────────────────────────────────
  { id: "business-1", prompt: "draft a quote for a new client project", expectedDomain: "business", expectedIntent: "generate quote", expectedRisk: "low" },

  // ── Unsafe / High Risk ──────────────────────────────────────
  { id: "unsafe-1", prompt: "delete all files in /tmp", expectedDomain: "unsafe", expectedIntent: "destructive operation", expectedRisk: "critical" },
  { id: "unsafe-2", prompt: "deploy to production without testing", expectedDomain: "unsafe", expectedIntent: "unsafe deployment", expectedRisk: "critical" },
];

export const VALIDATION_THRESHOLDS = {
  fastTier: { minValidJson: 0.95, minDomainAccuracy: 0.90, minIntentAccuracy: 0.85 },
  thinkingTier: { minValidJson: 0.98, minDomainAccuracy: 0.95, minIntentAccuracy: 0.90 },
  codingTier: { minValidJson: 0.95, minDomainAccuracy: 0.90, minIntentAccuracy: 0.85 },
};
```

- [ ] **Step 2: Commit**

```bash
git add scripts/validation-cases.ts
git commit -m "feat(scripts): curated model routing validation cases"
```

---

### Task 2: Create validation runner script

**Files:**
- Create: `scripts/validate-model-routing.ts`

- [ ] **Step 1: Write the runner**

```typescript
/**
 * validate-model-routing.ts — Run model routing validation for M0.9.
 *
 * Usage: npx tsx scripts/validate-model-routing.ts
 *
 * Tests each model tier (fast, thinking, coding) against curated prompts
 * and reports classification accuracy.
 */

import { VALIDATION_CASES, VALIDATION_THRESHOLDS } from "./validation-cases.js";
import type { ModelRoutingResult } from "../src/kernel/model-routing-validation.js";
import { summarizeRoutingResults } from "../src/kernel/model-routing-validation.js";

interface TierTest {
  name: string;
  model: string;
  provider: string;
}

const TIERS: TierTest[] = [
  { name: "fast", model: "qwen3:4b", provider: "ollama" },
  { name: "thinking", model: "qwen3:8b", provider: "ollama" },
  { name: "coding", model: "qwen2.5-coder:7b", provider: "ollama" },
];

async function classifyWithModel(tier: TierTest, prompt: string): Promise<ModelRoutingResult["rawOutput"]> {
  // Use Ollama API directly
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: tier.model,
      prompt: `Classify this task. Return ONLY valid JSON with no explanation.
{
  "domain": "coding|research|infra|docs|business|personal|unsafe",
  "intent": "short description",
  "risk": "low|medium|high|critical"
}

Task: ${prompt}`,
      stream: false,
      format: "json",
    }),
  });
  const data = await response.json() as any;
  return data.response ?? "";
}

function parseResult(raw: string): Partial<ModelRoutingResult> {
  try {
    const parsed = JSON.parse(raw);
    return {
      validJson: true,
      domainCorrect: false, // set by caller
      intentCorrect: false,
      riskCorrect: false,
    };
  } catch {
    return { validJson: false, domainCorrect: false, intentCorrect: false, riskCorrect: false };
  }
}

async function runTier(tier: TierTest): Promise<ModelRoutingResult[]> {
  const results: ModelRoutingResult[] = [];
  console.log(`\nTesting ${tier.name} tier (${tier.model})...`);

  for (const c of VALIDATION_CASES) {
    process.stdout.write(`  ${c.id}... `);
    const raw = await classifyWithModel(tier, c.prompt);
    const parsed = parseResult(raw);

    let domainCorrect = false;
    let intentCorrect = false;
    let riskCorrect = false;

    if (parsed.validJson) {
      try {
        const json = JSON.parse(raw);
        domainCorrect = json.domain === c.expectedDomain;
        intentCorrect = (json.intent || "").toLowerCase().includes(c.expectedIntent.toLowerCase());
        riskCorrect = json.risk === c.expectedRisk;
      } catch {}
    }

    results.push({
      caseId: c.id,
      model: tier.model,
      validJson: parsed.validJson ?? false,
      domainCorrect,
      intentCorrect,
      riskCorrect,
      rawOutput: raw.slice(0, 200),
    });

    process.stdout.write(domainCorrect && intentCorrect && riskCorrect ? "✓\n" : "✗\n");
  }

  return results;
}

async function main() {
  console.log("M0.9 Model Routing Validation");
  console.log("============================\n");
  console.log(`Cases: ${VALIDATION_CASES.length}`);

  for (const tier of TIERS) {
    const results = await runTier(tier);
    const summary = summarizeRoutingResults(results);
    console.log(`\n--- ${tier.name} Results ---`);
    console.log(`  Valid JSON:    ${(summary.validJsonRate * 100).toFixed(0)}% (threshold: ${(VALIDATION_THRESHOLDS[tier.name as keyof typeof VALIDATION_THRESHOLDS].minValidJson * 100).toFixed(0)}%)`);
    console.log(`  Domain Acc:    ${(summary.domainAccuracy * 100).toFixed(0)}% (threshold: ${(VALIDATION_THRESHOLDS[tier.name as keyof typeof VALIDATION_THRESHOLDS].minDomainAccuracy * 100).toFixed(0)}%)`);
    console.log(`  Intent Acc:    ${(summary.intentAccuracy * 100).toFixed(0)}% (threshold: ${(VALIDATION_THRESHOLDS[tier.name as keyof typeof VALIDATION_THRESHOLDS].minIntentAccuracy * 100).toFixed(0)}%)`);
    console.log(`  Pass: ${summary.passedFastTierThreshold ? "✓" : "✗"}`);
  }
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/validate-model-routing.ts
git commit -m "feat(scripts): model routing validation runner"
```

---

### Task 3: Write scoring tests

**Files:**
- Create: `tests/scripts/validate-model-routing.test.ts`

- [ ] **Step 1: Write tests for scoring logic**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeRoutingResults } from "../../src/kernel/model-routing-validation.js";
import type { ModelRoutingResult } from "../../src/kernel/model-routing-validation.js";

describe("summarizeRoutingResults", () => {

  const makeResult = (overrides: Partial<ModelRoutingResult>): ModelRoutingResult => ({
    caseId: "test-1", model: "test-model",
    validJson: true, domainCorrect: true, intentCorrect: true, riskCorrect: true,
    rawOutput: '{"domain":"coding","intent":"fix bug","risk":"low"}',
    ...overrides,
  });

  it("returns 100% for all-perfect results", () => {
    const results = [makeResult({})];
    const s = summarizeRoutingResults(results);
    assert.equal(s.validJsonRate, 1.0);
    assert.equal(s.domainAccuracy, 1.0);
  });

  it("computes partial accuracy correctly", () => {
    const results = [
      makeResult({ caseId: "a", domainCorrect: true }),
      makeResult({ caseId: "b", domainCorrect: false }),
    ];
    const s = summarizeRoutingResults(results);
    assert.equal(s.domainAccuracy, 0.5);
  });

  it("handles empty results without division by zero", () => {
    const s = summarizeRoutingResults([]);
    assert.equal(s.total, 0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/scripts/validate-model-routing.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/scripts/validate-model-routing.test.ts
git commit -m "test(scripts): model routing scoring logic tests"
```
