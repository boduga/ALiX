# Zero-Default Model Configuration Implementation Plan

**Status:** ✅ Completed (M0.7) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all 24 hardcoded model name strings from the codebase. User config becomes the only source of truth for model/provider names.

**Architecture:** Strip `MODEL_TIERS` from `defaults.ts`, remove `DEFAULT_MODELS` from `catalog.ts`, replace hardcoded fallback in `subagent-manager.ts` with a throw (unreachable after loader fix), add load-time validation + inheritance in `loader.ts`.

**Tech Stack:** TypeScript, `node:test`, existing config system.

---

## File Structure

**Modified files (6):**
- `src/config/defaults.ts` — Remove MODEL_TIERS, strip model names from DEFAULT_CONFIG.subagents
- `src/config/loader.ts` — Add validation + tier inheritance
- `src/config/validator.ts` — Remove VALID_PROVIDERS
- `src/config/schema.ts` — Change provider types to `string`
- `src/providers/catalog.ts` — Remove `getDefaultModel()` hardcoded map
- `src/agents/subagent-manager.ts` — Remove hardcoded fallback

**Potentially affected test files:**
- `tests/config-loader.test.ts`
- `tests/config/validator.test.ts`
- `tests/providers.test.ts` (provider-types tests)
- `tests/anthropic-provider.test.ts`

---

## Task 1: Strip model names from `defaults.ts`

**Files:**
- Modify: `src/config/defaults.ts`

- [ ] **Step 1: Remove the `MODEL_TIERS` constant**

Delete lines 4-11:
```typescript
export const MODEL_TIERS = {
  thinking: { provider: "ollama", name: "phi4-mini-reasoning" },
  coding:   { provider: "google", name: "gemini-3.5-flash" },
  fast:     { provider: "ollama", name: "llama3.2:3b" },
  critic:   { provider: "ollama", name: "llama3.2:3b" },
  tiny:     { provider: "ollama", name: "llama3.2:3b" },
  image:    { provider: "google", name: "gemini-3-pro-image-preview" },
} as const;
```

- [ ] **Step 2: Remove model fields from `DEFAULT_CONFIG.subagents`**

Replace the `subagents` block in `DEFAULT_CONFIG` (lines ~83-97):
```typescript
  subagents: {
    enabled: true,
    roles: [
      { role: "explorer",         mode: "read_only", style: "fast", retryCount: 1 },
      { role: "reviewer",          mode: "read_only", style: "critic", retryCount: 1 },
      { role: "test_investigator", mode: "read_only", style: "thinking", retryCount: 1 },
      { role: "docs_researcher",   mode: "read_only", style: "fast", retryCount: 1 },
      { role: "worker",            mode: "write",     style: "coding",  retryCount: 0 },
    ],
  }
```

Note: `enabled` and `roles` stay — they're structure, not model names.

- [ ] **Step 3: Also remove the `model` field from `DEFAULT_CONFIG` if it has a model name**

Check if `DEFAULT_CONFIG.model` exists (lines ~15-17). If it references `MODEL_TIERS.coding`, it will break after step 1. Change to `undefined` or remove it:

```typescript
export const DEFAULT_CONFIG: AlixConfig = {
  version: 1,
  model: undefined as any,  // No default — user must configure
  // ...everything else unchanged
};
```

- [ ] **Step 4: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

Expected: TypeScript errors where other code references `MODEL_TIERS`. These will be fixed in subsequent tasks.

- [ ] **Step 5: Check what references `MODEL_TIERS`**

```bash
grep -rn "MODEL_TIERS" src/ | grep -v test | grep -v ".d.ts"
```

If anything references `MODEL_TIERS`, note those files for fixing.

- [ ] **Step 6: Commit**

```bash
git add src/config/defaults.ts
git commit -m "refactor(config): remove MODEL_TIERS and subagent model defaults

All hardcoded model names removed from defaults.ts. User must
now configure model via config file. Structural defaults (version,
timeout, paths, roles) are kept."
```

---

## Task 2: Add model validation + tier inheritance to `loader.ts`

**Files:**
- Modify: `src/config/loader.ts`

- [ ] **Step 1: Read the current `loadConfig` function**

```bash
grep -n "export async function loadConfig\|export function mergeConfig" src/config/loader.ts | head -5
```

Find where `loadConfig` returns (after merging configs).

- [ ] **Step 2: Add validation after config merge**

Find the spot where `loadConfig` returns the final config. Add validation:

```typescript
  // Validate that a model is configured — no hardcoded defaults
  if (!config.model?.provider || !config.model?.name) {
    throw new Error(
      "No model configured. Run: alix config set-default-model\n" +
      "Example: alix config set-default-model deepseek deepseek-v4-flash"
    );
  }

  // Fill unset subagent tiers from the main model
  const TIERS = ["thinking", "coding", "fast", "critic", "tiny", "image"] as const;
  for (const tier of TIERS) {
    if (!config.subagents?.[tier]) {
      if (!config.subagents) config.subagents = { enabled: true } as any;
      (config.subagents as any)[tier] = {
        provider: config.model.provider,
        name: config.model.name,
      };
    }
  }
```

Add this code right before the `return config` (or `return mergeConfig(...)`) line.

- [ ] **Step 3: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 4: Write a quick test that validation works**

```typescript
// Add to tests/config-loader.test.ts or a quick inline test:
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/loader.js";

describe("loadConfig model validation", () => {
  it("throws when no model is configured", async () => {
    await assert.rejects(
      () => loadConfig("/tmp/empty-dir"),
      /No model configured/
    );
  });
});
```

Run: `node --test dist/tests/config-loader.test.js 2>&1 | tail -10`

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat(config): validate model is configured, inherit tiers from model

loadConfig now throws if model.provider or model.name is missing.
Unset subagent tiers (thinking, coding, fast, critic, tiny, image)
are filled from the main model automatically."
```

---

## Task 3: Remove `VALID_PROVIDERS` from `validator.ts`

**Files:**
- Modify: `src/config/validator.ts`

- [ ] **Step 1: Read current validator**

```bash
cat src/config/validator.ts
```

- [ ] **Step 2: Remove `VALID_PROVIDERS`**

Delete the line:
```typescript
const VALID_PROVIDERS = ["mock","anthropic","openai","google","openrouter","groq","ollama","perplexity","minimax","zhipuai","grokai","deepseek","local-llama"] as const;
```

Also remove the check that references it:
```typescript
if (!VALID_PROVIDERS.includes(config.model.provider as any)) {
  issues.push({ path: "model.provider", level: "error", message: `Unknown provider "${config.model.provider}"` });
}
```

The validator should now only check structural things (paths, ports, etc.) — not model names.

- [ ] **Step 3: Update `schema.ts` to remove provider union types**

Find the union types:
```typescript
provider: "mock" | "anthropic" | ... | "local-llama";
```

Replace them with just `provider: string`:
```typescript
provider: string;
```

This applies in `ModelConfig` type and `ModelTierConfig` type.

- [ ] **Step 4: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 5: Update tests that check `VALID_PROVIDERS`**

```bash
grep -n "VALID_PROVIDERS\|valid_providers\|invalid provider" tests/config/validator.test.ts 2>/dev/null | head -5
```

If those tests exist, update them to not check provider validation.

- [ ] **Step 6: Commit**

```bash
git add src/config/validator.ts src/config/schema.ts
git commit -m "refactor(config): remove hardcoded provider validation

VALID_PROVIDERS removed from validator.ts — the live API
menu system (alix config set-default-model) is now the
source of truth for valid providers. Union types in schema.ts
changed from enum to 'provider: string'."
```

---

## Task 4: Remove `DEFAULT_MODELS` from `catalog.ts`

**Files:**
- Modify: `src/providers/catalog.ts`

- [ ] **Step 1: Read the `getDefaultModel` function**

```bash
grep -n "getDefaultModel" src/providers/catalog.ts | head -5
```

- [ ] **Step 2: Remove the hardcoded map**

Replace the whole `getDefaultModel` function (lines ~155-170) with either:
- A function that returns `undefined` or throws
- A function that says "no default models — use live API"

```typescript
/**
 * Get default model for a provider (for init command).
 * Note: No hardcoded defaults — the user must configure a model.
 * The `alix config set-default-model` CLI queries the live API.
 */
export function getDefaultModel(providerId: string): string | undefined {
  return undefined;
}
```

- [ ] **Step 3: Check what calls `getDefaultModel`**

```bash
grep -rn "getDefaultModel" src/ | grep -v test
```

If CLI code calls it and expects a string back, update that caller to handle `undefined`.

- [ ] **Step 4: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/catalog.ts
git commit -m "refactor(providers): remove hardcoded default model map

getDefaultModel() now returns undefined. No hardcoded model names
in catalog.ts. The CLI (alix config set-default-model) uses the
live API to fetch real model names from each provider."
```

---

## Task 5: Remove hardcoded fallback from `subagent-manager.ts`

**Files:**
- Modify: `src/agents/subagent-manager.ts`

- [ ] **Step 1: Find the fallback**

```bash
grep -n "llama3\|fallback" src/agents/subagent-manager.ts | head -5
```

Line 157 has: `if (!tier) return { provider: "ollama", name: "llama3.2:3b" }; // safe fallback`

- [ ] **Step 2: Replace with error**

Change to:
```typescript
    if (!tier) {
      throw new Error(
        `Subagent tier "${style}" is unconfigured. ` +
        `This should not happen because loadConfig fills unset tiers from the main model. ` +
        `File a bug report.`
      );
    }
```

- [ ] **Step 3: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -5
```

- [ ] **Step 4: Check tests that test the fallback**

```bash
grep -rn "fallback\|llama3.2:3b\|tier.*return\|subagent.*default" tests/ | head -5
```

If tests test the fallback behavior, update them to expect the error instead.

- [ ] **Step 5: Commit**

```bash
git add src/agents/subagent-manager.ts
git commit -m "refactor(agents): replace hardcoded subagent fallback with error

The safe fallback { ollama, llama3.2:3b } is now unreachable
since loadConfig fills unset tiers from the main model.
If it somehow triggers, it throws a clear error."
```

---

## Task 6: Fix tests that depended on hardcoded defaults

**Files:**
- Modify: (likely `tests/config-loader.test.ts`, `tests/config/validator.test.ts`, `tests/providers.test.ts`)

- [ ] **Step 1: Run full test suite to find failures**

```bash
npm test 2>&1 | grep -E "✖|FAIL|fail:" | head -20
```

- [ ] **Step 2: Fix each failing test**

Typical failures:
- `tests/config-loader.test.ts`: "loadConfig applies defaults when no config files exist" — this test expects a default model. Update to provide a mock config with a model.
- `tests/config/validator.test.ts`: tests that `VALID_PROVIDERS` rejects bad provider names. Remove/update these tests.
- `tests/providers.test.ts`: may test `getDefaultModel()`. Update to expect `undefined`.

For each test, add a setup that provides the required model config:

```typescript
// Mock config with model for tests that need one
const minConfig = {
  model: { provider: "test", name: "test-model" },
};
```

- [ ] **Step 3: Verify build + all tests pass**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update tests for zero-default model config
- Config loader tests no longer expect default model values
- Validator tests no longer check provider name validation
- Provider catalog tests check for undefined fallback
- Subagent tests handle error instead of fallback"
```

---

## Task 7: Final verification

- [ ] **Step 1: Verify no hardcoded model names remain**

```bash
grep -rn "gemini-\|deepseek-\|claude-\|gpt-\|llama3\|phi4\|qwen\|minimax\|zhipuai\|grokai" src/ | grep -v test | grep -v node_modules | grep -v ".md:" | grep -v "\.ts:.*//" | grep -v "import.*from\|export.*namespace"
```

Count should be 0 (or only in comments/imports).

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(config): zero-default model configuration complete

All 24 hardcoded model name strings removed from codebase.
- defaults.ts: MODEL_TIERS removed, subagent model names stripped
- catalog.ts: getDefaultModel() returns undefined
- subagent-manager.ts: fallback replaced with error
- validator.ts: VALID_PROVIDERS removed
- schema.ts: provider types changed to string
- loader.ts: validation + tier inheritance added
- Tests updated to match new behavior"
```

---

## Self-Review

**1. Spec coverage:**
- [x] Remove MODEL_TIERS from defaults.ts → Task 1
- [x] Remove model names from DEFAULT_CONFIG.subagents → Task 1
- [x] Remove DEFAULT_MODELS from catalog.ts → Task 4
- [x] Remove hardcoded fallback from subagent-manager.ts → Task 5
- [x] Remove VALID_PROVIDERS from validator.ts → Task 3
- [x] Change provider types to string in schema.ts → Task 3
- [x] Add validation: throw if model missing → Task 2
- [x] Add inheritance: fill unset tiers from model → Task 2
- [x] Fix tests → Task 6
- [x] Final verification → Task 7

**2. Placeholder scan:** No TBD, TODO, or "implement later". All code complete.

**3. Type consistency:**
- `config.model` type changes from `ModelConfig` to `{ provider: string, name: string }` — but `ModelConfig` already exists and is just changing one field
- `config.subagents` inherits `{ provider, name }` from `config.model` — same shape as before
- `getDefaultModel()` returns `string | undefined` — callers updated

**4. Plan length:** 7 tasks, each 2-5 minutes. TDD throughout. ✓
