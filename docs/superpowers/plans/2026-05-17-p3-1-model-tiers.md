# Model Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable model tiers (`thinking`, `coding`, `fast`) with independent provider+model per tier. Each subagent role references a style bucket. Runtime config overrides via JSON file or env vars.

**Architecture:** `MODEL_TIERS` constant in defaults → `subagents.{thinking|coding|fast}` in config → SubagentManager resolves style → passes `--provider` and `--model` via CLI args to SubagentCLI.

**Tech Stack:** TypeScript, Node.js ESM

---

## Task 1: Add types to schema

**Files:**
- Modify: `src/config/schema.ts:75-82`

- [ ] **Step 1: Add ModelTierConfig type**

Add after `SubagentRoleConfig`:

```typescript
export type ModelTierConfig = {
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "groq" | "ollama" | "perplexity" | "minimax" | "zhipuai" | "grokai" | "deepseek";
  name: string;
};
```

- [ ] **Step 2: Add SubagentStyle type**

```typescript
export type SubagentStyle = "thinking" | "coding" | "fast";
```

- [ ] **Step 3: Update SubagentRoleConfig — replace `model?` and `fastModel?` with `style?`**

```typescript
export type SubagentRoleConfig = {
  role: SubagentRole;
  mode: "read_only" | "write";
  style?: SubagentStyle;  // references MODEL_TIERS bucket
  retryCount?: number;
  enabled?: boolean;
};
```

- [ ] **Step 4: Add SubagentConfig with tier definitions**

Replace existing `SubagentConfig`:

```typescript
export type SubagentConfig = {
  enabled: boolean;
  thinking: ModelTierConfig;
  coding: ModelTierConfig;
  fast: ModelTierConfig;
  roles: SubagentRoleConfig[];
};
```

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts
git commit -m "feat(multi-agent): add ModelTierConfig, SubagentStyle, and SubagentConfig with tier buckets"
```

---

## Task 2: Update defaults with MODEL_TIERS constant

**Files:**
- Modify: `src/config/defaults.ts`

- [ ] **Step 1: Add MODEL_TIERS constant at top of file (after imports)**

```typescript
export const MODEL_TIERS = {
  thinking: { provider: "ollama", name: "phi4-mini-reasoning" },
  coding:   { provider: "ollama", name: "qwen2.5-coder:7b" },
  fast:     { provider: "ollama", name: "llama3.2:3b" },
} as const;
```

- [ ] **Step 2: Update DEFAULT_CONFIG.model to use coding tier**

```typescript
model: {
  provider: MODEL_TIERS.coding.provider,
  name: MODEL_TIERS.coding.name,
  temperature: 0.2,
  streaming: true
},
```

- [ ] **Step 3: Replace subagents block in DEFAULT_CONFIG**

```typescript
subagents: {
  enabled: true,
  thinking: { ...MODEL_TIERS.thinking },
  coding:   { ...MODEL_TIERS.coding },
  fast:     { ...MODEL_TIERS.fast },
  roles: [
    { role: "explorer",          mode: "read_only", style: "fast" },
    { role: "reviewer",          mode: "read_only", style: "thinking" },
    { role: "test_investigator", mode: "read_only", style: "thinking" },
    { role: "docs_researcher",   mode: "read_only", style: "fast" },
    { role: "worker",            mode: "write",     style: "coding" },
  ],
}
```

- [ ] **Step 4: Commit**

```bash
git add src/config/defaults.ts
git commit -m "feat(multi-agent): add MODEL_TIERS constant and update subagents to use tier buckets"
```

---

## Task 3: Update config loader to merge runtime overrides

**Files:**
- Modify: `src/config/loader.ts`

- [ ] **Step 1: Add env var check helper at top of loader.ts**

Add after imports:

```typescript
function getEnvTier(name: "thinking" | "coding" | "fast"): Partial<ModelTierConfig> | undefined {
  const provider = process.env[`ALIX_${name.toUpperCase()}_PROVIDER`];
  const model = process.env[`ALIX_${name.toUpperCase()}_MODEL`];
  if (provider || model) {
    return { ...(provider ? { provider: provider as ModelTierConfig["provider"] } : {}), ...(model ? { name: model } : {}) };
  }
  return undefined;
}
```

- [ ] **Step 2: In mergeConfig(), add tier override logic after defaults merge**

In the `mergeConfig` function, after the existing model/tools merge, add:

```typescript
// Apply env var overrides for model tiers
if (result.subagents) {
  const tiers: ("thinking" | "coding" | "fast")[] = ["thinking", "coding", "fast"];
  for (const tier of tiers) {
    const envOverride = getEnvTier(tier);
    if (envOverride) {
      (result.subagents[tier] as ModelTierConfig) = {
        ...(result.subagents as any)[tier],
        ...envOverride,
      };
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat(multi-agent): allow env vars to override model tier settings"
```

---

## Task 4: Update SubagentManager to resolve style and pass provider+model

**Files:**
- Modify: `src/agents/subagent-manager.ts`

- [ ] **Step 1: Add getRoleModel() helper method**

Add after `getRoleConfig`:

```typescript
getRoleModel(role: SubagentRole): { provider: string; name: string } {
  const roleConfig = this.getRoleConfig(role);
  const style = roleConfig?.style ?? "fast";
  const tier = this.config?.subagents?.[style] as ModelTierConfig | undefined;
  if (!tier) return { provider: "ollama", name: "llama3.2:3b" }; // safe fallback
  return { provider: tier.provider, name: tier.name };
}
```

- [ ] **Step 2: In spawn(), build CLI args to include provider and model**

In the `spawn` method, after building `taskArgs`:

```typescript
const { provider, name } = this.getRoleModel(task.role);
// ...existing taskArgs...
// Build CLI args array
const cliArgs = [
  "--subagent", task.role,
  "--task-id", task.id,
  "--prompt", task.prompt,
  "--mode", task.mode,
  "--session-id", task.contextBundle ?? `sub-${Date.now()}`,
  "--provider", provider,
  "--model", name,
  ...(task.ownedPaths?.length ? ["--owned-paths", task.ownedPaths.join(",")] : []),
];
```

- [ ] **Step 3: Update spawn() to pass cliArgs to spawn() instead of individual args**

```typescript
const child = spawn("node", [cliEntry, "run", "--subagent", ...cliArgs], {
  cwd: this.cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});
```

- [ ] **Step 4: Update import to include ModelTierConfig**

```typescript
import type { ..., ModelTierConfig } from "../config/schema.js";
```

- [ ] **Step 5: Commit**

```bash
git add src/agents/subagent-manager.ts
git commit -m "feat(multi-agent): SubagentManager resolves style to provider+model, passes via CLI args"
```

---

## Task 5: Update SubagentCLI to use --provider and --model args

**Files:**
- Modify: `src/agents/subagent-cli.ts`

- [ ] **Step 1: Add --provider to parseArgs options**

```typescript
options: {
  subagent: { type: "string" },
  "task-id": { type: "string" },
  prompt: { type: "string" },
  model: { type: "string" },
  provider: { type: "string" },
  mode: { type: "string" },
  sessionId: { type: "string" },
  "owned-paths": { type: "string" },
},
```

- [ ] **Step 2: Extract provider override and use in createProvider()**

Replace the existing provider creation:

```typescript
const providerOverride = args.values.provider;
const modelOverride = args.values.model;
const config = mergeConfig(DEFAULT_CONFIG, {});

// Apply overrides (provider from role config takes priority)
if (modelOverride) config.model.name = modelOverride;
if (providerOverride) config.model.provider = providerOverride as any;

// Use role config to set provider if not overridden
if (!providerOverride) {
  const roleStyle = roleConfig?.style ?? "fast";
  const tier = (config.subagents as any)?.[roleStyle];
  if (tier) {
    config.model.provider = tier.provider as any;
    if (!modelOverride) config.model.name = tier.name;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agents/subagent-cli.ts
git commit -m "feat(multi-agent): SubagentCLI accepts --provider arg, uses role style for provider+model"
```

---

## Task 6: Update CLI agent entry point to pass provider

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: In alix agent block, read role config and get provider+model**

Replace the `await SubagentCLI.main([...])` call to include `--provider`:

```typescript
const roleConfig = DEFAULT_CONFIG.subagents.roles.find(r => r.role === agentRole as any);
const style = roleConfig?.style ?? "fast";
const tier = (DEFAULT_CONFIG.subagents as any)[style] as ModelTierConfig;
const provider = tier?.provider ?? "ollama";
const model = tier?.name ?? "llama3.2:3b";

await SubagentCLI.main([
  "--subagent", agentRole,
  "--task-id", crypto.randomUUID(),
  "--prompt", prompt,
  "--mode", "read_only",
  "--session-id", `cli-${Date.now()}`,
  "--provider", provider,
  "--model", model,
  ...extraArgs,
]);
```

- [ ] **Step 2: Add import for ModelTierConfig**

```typescript
import type { ..., ModelTierConfig } from "./config/schema.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(multi-agent): CLI agent entry reads role style, passes provider+model to SubagentCLI"
```

---

## Task 7: Update tests

**Files:**
- Modify: `tests/config-loader.test.ts`
- Modify: `tests/agents/subagent-manager.test.ts`
- Modify: `tests/agents/subagent-cli.test.ts`

- [ ] **Step 1: Update config-loader tests to match new SubagentConfig shape**

Check and update tests that reference `subagents.roles[].fastModel` or `subagents.roles[].model` — these fields no longer exist. Replace with `style` references.

Run: `npm test`
Expected: All pass

- [ ] **Step 2: Commit**

```bash
git add tests/
git commit -m "test(multi-agent): update tests for model tier config shape"
```

---

## Summary of Changes

| File | What Changes |
|------|-------------|
| `src/config/schema.ts` | Add `ModelTierConfig`, `SubagentStyle`, update `SubagentRoleConfig` → `style`, update `SubagentConfig` → tier buckets |
| `src/config/defaults.ts` | Add `MODEL_TIERS` constant, update `model` to use `coding` tier, update `subagents` to define tiers + role styles |
| `src/config/loader.ts` | Add env var override for tiers, merge into config |
| `src/agents/subagent-manager.ts` | Add `getRoleModel()`, resolve style → provider+name, pass via CLI args |
| `src/agents/subagent-cli.ts` | Accept `--provider` arg, use role style for defaults |
| `src/cli.ts` | `alix agent` reads role style, passes provider+model |
| `tests/*.test.ts` | Update for new config shape |