# M0.69 — Model Profiles + Doctor + Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a model profile system (built-in presets), hardware/provider detection, `models doctor` diagnostic, `models fit` ranking, and `models install/apply-profile` UX to ALiX.

**Architecture:** Five built-in profiles stored as JSON in `src/config/profiles/` loaded and validated at runtime by a `ProfileRegistry`. Hardware detection via Node.js subprocess (nvidia-smi, sysctl, ollama). CLI commands in `src/cli/commands/models.ts` are thin wrappers; all logic lives in `src/models/*.ts`. Profile application uses a dedicated `applyProfilePatch()` that touches only `modelProfile`, `model`, `models`, and `runtime` fields — never unrelated sections.

**Tech Stack:** TypeScript, existing `AlixConfig` schema, `node:child_process` for hardware probes, `node:test`. JSON profiles are copied into `dist/` at build time via a dedicated npm script so runtime loading works in both source and packaged modes.

**Spec:** `docs/superpowers/specs/2026-06-12-m69-model-profiles-spec.md`

---

## Implementation order

1. **M0.69a** — Schema + Profile Types + Strict Validation  
2. **M0.69b** — Profile JSON files + asset copy into dist  
3. **M0.69c** — Profile Registry (load, validate, matchHardware)  
4. **M0.69d** — Config Patch Engine (bounded `applyProfilePatch`)  
5. **M0.69e** — Hardware + Provider Detector  
6. **M0.69f** — Model Doctor  
7. **M0.69g** — Model Fit Ranking  
8. **M0.69h** — CLI (doctor, fit, list-profiles, show-profile, apply-profile, install-profile)  
9. **M0.69i** — Documentation

---

## File Structure

### Create
- `src/config/profiles/minimal-local.json`
- `src/config/profiles/balanced-local.json`
- `src/config/profiles/power-local.json`
- `src/config/profiles/cloud-balanced.json`
- `src/config/profiles/all-cloud.json`
- `src/config/profile-types.ts` — TypeScript types + strict runtime validation
- `src/config/profile-registry.ts` — `loadProfiles()`, `listProfiles()`, `getProfile(id)`, `matchHardware()`
- `src/config/profile-patch.ts` — `applyProfilePatch()`: bounded config patching engine (modelProfile, model, models, runtime limits only)
- `src/config/hardware-detect.ts` — `detectSystem()`: OS, RAM, GPU, Ollama, API providers
- `src/models/model-doctor.ts` — `runDoctor()` returning `DoctorReport`
- `src/models/model-fit.ts` — `rankProfiles()` returning `FitRanking[]`
- `src/models/model-install.ts` — `applyProfile()`, `installProfile()`, `listAllProfiles()`, `showProfileDetail()`
- `src/cli/commands/models.ts` — all `alix models *` command handlers
- `tests/config/profile-registry.test.ts`
- `tests/config/hardware-detect.test.ts`
- `tests/config/profile-patch.test.ts`
- `tests/models/model-doctor.test.ts`
- `tests/models/model-fit.test.ts`
- `tests/models/model-install.test.ts`

### Modify
- `src/config/schema.ts` — add `modelProfile?: string` and `models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>` to `AlixConfig`
- `src/cli.ts` — add `alix models` command dispatch
- `package.json` — add `copy:profiles` script and wire into `build`

---

### Task 1: Schema + Profile Types + Strict Validation

**Files:**
- Create: `src/config/profile-types.ts`
- Modify: `src/config/schema.ts`

- [ ] **Step 1: Add modelProfile and models to AlixConfig schema**

In `src/config/schema.ts`, add to the `AlixConfig` type:
```typescript
export type AlixConfig = {
  version: 1;
  model: ModelConfig;
  permissions: PermissionConfig;
  context: ContextConfig;
  runtime: RuntimeConfig;
  ui: UiConfig;
  apiKeys?: Record<string, string>;
  mcpServers?: McpServerConfig[];
  mcpServerPaths?: string[];
  skills?: { factory?: SkillFactoryConfig; store?: SkillStoreConfig; };
  extensions?: { store?: ExtensionStoreConfig; };
  subagents?: SubagentConfig;
  toolConfig?: ToolConfig;
  modelProfile?: string;                                                        // NEW: active profile ID
  models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>;  // NEW: per-tier model mappings
};
```

- [ ] **Step 2: Create profile-types.ts with strict runtime validation**

```typescript
/**
 * profile-types.ts — TypeScript types + runtime validation for model profiles.
 *
 * validateProfile() is a type guard used at load time to reject malformed
 * JSON profiles. It checks all known fields strictly.
 */

export type ModelTier =
  | "default"
  | "planner"
  | "researcher"
  | "coder"
  | "critic"
  | "embeddings";

export type ProfileMode = "local-first" | "cloud-first" | "cloud-only";

export type ProfileModel = {
  provider: string;
  name: string;
  temperature?: number;
  contextWindow?: number;
};

export type ProfileHardware = {
  minRamGb: number;
  recommendedRamGb: number;
  requiresGpu: boolean;
  minVramGb: number;
};

export type ProfileFallbacks = {
  enabled: boolean;
  local?: { provider: string; name: string };
  cloud?: { provider: string; name: string };
};

export type ProfileRuntime = {
  maxConcurrentAgents?: number;
  maxContextTokens?: number;
  toolMode?: string;
  shellMode?: string;
  localModelsRequired?: boolean;
  ollamaRequired?: boolean;
};

export type ProfileInstall = {
  ollamaPull?: string[];
};

export type ProfileData = {
  id: string;
  name: string;
  description: string;
  mode: ProfileMode;
  hardware: ProfileHardware;
  models: Partial<Record<ModelTier, ProfileModel>>;
  fallbacks?: ProfileFallbacks;
  runtime?: ProfileRuntime;
  install?: ProfileInstall;
};

const VALID_MODES = new Set(["local-first", "cloud-first", "cloud-only"]);
const VALID_TIERS = new Set(["default", "planner", "researcher", "coder", "critic", "embeddings"]);

/** Runtime validation: ensure a loaded profile matches ProfileData shape. */
export function validateProfile(raw: unknown): raw is ProfileData {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;

  if (typeof p.id !== "string" || !p.id) return false;
  if (typeof p.name !== "string" || !p.name) return false;
  if (!VALID_MODES.has(p.mode as string)) return false;

  // Validate hardware
  if (!p.hardware || typeof p.hardware !== "object") return false;
  const hw = p.hardware as Record<string, unknown>;
  if (typeof hw.minRamGb !== "number" || hw.minRamGb < 0) return false;
  if (typeof hw.recommendedRamGb !== "number") return false;
  if (typeof hw.requiresGpu !== "boolean") return false;
  if (typeof hw.minVramGb !== "number" || hw.minVramGb < 0) return false;

  // Validate models — only known tier keys allowed, each with valid entry
  if (!p.models || typeof p.models !== "object") return false;
  for (const key of Object.keys(p.models)) {
    if (!VALID_TIERS.has(key)) return false;          // reject typos like "planer"
    const entry = (p.models as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object") return false;
    const m = entry as Record<string, unknown>;
    if (typeof m.provider !== "string" || !m.provider) return false;
    if (typeof m.name !== "string" || !m.name) return false;
    if (m.temperature !== undefined && typeof m.temperature !== "number") return false;
    if (m.contextWindow !== undefined && typeof m.contextWindow !== "number") return false;
  }

  // Validate fallbacks if present
  if (p.fallbacks !== undefined) {
    if (typeof p.fallbacks !== "object") return false;
    const fb = p.fallbacks as Record<string, unknown>;
    if (typeof fb.enabled !== "boolean") return false;
    for (const side of ["local", "cloud"] as const) {
      if (fb[side] !== undefined) {
        if (typeof fb[side] !== "object") return false;
        const e = fb[side] as Record<string, unknown>;
        if (typeof e.provider !== "string" || typeof e.name !== "string") return false;
      }
    }
  }

  // Validate install.ollamaPull if present
  if (p.install !== undefined) {
    if (typeof p.install !== "object") return false;
    const inst = p.install as Record<string, unknown>;
    if (inst.ollamaPull !== undefined) {
      if (!Array.isArray(inst.ollamaPull)) return false;
      if (!inst.ollamaPull.every((m: unknown) => typeof m === "string")) return false;
    }
  }

  return true;
}
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 4: Commit**

```bash
git add src/config/profile-types.ts src/config/schema.ts
git commit -m "feat(config): add profile types, strict validation, and schema fields (modelProfile, models)"
```

---

### Task 2: Built-in Profile JSON files + asset copy

**Files:**
- Create: `src/config/profiles/minimal-local.json`
- Create: `src/config/profiles/balanced-local.json`
- Create: `src/config/profiles/power-local.json`
- Create: `src/config/profiles/cloud-balanced.json`
- Create: `src/config/profiles/all-cloud.json`
- Modify: `package.json`

- [ ] **Step 1: Create minimal-local.json**

```json
{
  "id": "minimal-local",
  "name": "Minimal Local",
  "description": "Lowest resource requirement. Single small local model for all tiers.",
  "mode": "local-first",
  "hardware": { "minRamGb": 8, "recommendedRamGb": 16, "requiresGpu": false, "minVramGb": 0 },
  "models": {
    "default": { "provider": "ollama", "name": "qwen3:4b", "temperature": 0.3, "contextWindow": 16384 },
    "planner": { "provider": "ollama", "name": "qwen3:4b", "temperature": 0.3, "contextWindow": 16384 },
    "coder": { "provider": "ollama", "name": "qwen2.5-coder:7b", "temperature": 0.1, "contextWindow": 16384 },
    "critic": { "provider": "ollama", "name": "qwen3:4b", "temperature": 0.2, "contextWindow": 16384 },
    "embeddings": { "provider": "ollama", "name": "qwen3-embedding:0.6b" }
  },
  "fallbacks": { "enabled": false },
  "runtime": { "maxConcurrentAgents": 1, "maxContextTokens": 16000 },
  "install": { "ollamaPull": ["qwen3:4b", "qwen2.5-coder:7b", "qwen3-embedding:0.6b"] }
}
```

- [ ] **Step 2: Create balanced-local.json**

```json
{
  "id": "balanced-local",
  "name": "Balanced Local",
  "description": "Default local-first profile for 16-32 GB RAM machines.",
  "mode": "local-first",
  "hardware": { "minRamGb": 16, "recommendedRamGb": 32, "requiresGpu": false, "minVramGb": 0 },
  "models": {
    "default": { "provider": "ollama", "name": "qwen3:4b", "temperature": 0.3, "contextWindow": 32768 },
    "planner": { "provider": "ollama", "name": "qwen3:8b", "temperature": 0.2, "contextWindow": 32768 },
    "coder": { "provider": "ollama", "name": "qwen2.5-coder:7b", "temperature": 0.1, "contextWindow": 32768 },
    "critic": { "provider": "ollama", "name": "qwen3:8b", "temperature": 0.2, "contextWindow": 32768 },
    "embeddings": { "provider": "ollama", "name": "qwen3-embedding:0.6b" }
  },
  "fallbacks": { "enabled": true, "cloud": { "provider": "anthropic", "name": "claude-haiku-4-5" } },
  "runtime": { "maxConcurrentAgents": 2, "maxContextTokens": 24000 },
  "install": { "ollamaPull": ["qwen3:4b", "qwen3:8b", "qwen2.5-coder:7b", "qwen3-embedding:0.6b"] }
}
```

- [ ] **Step 3: Create power-local.json**

```json
{
  "id": "power-local",
  "name": "Power Local",
  "description": "High-end local profile for machines with 32+ GB RAM and optional GPU.",
  "mode": "local-first",
  "hardware": { "minRamGb": 32, "recommendedRamGb": 64, "requiresGpu": false, "minVramGb": 0 },
  "models": {
    "default": { "provider": "ollama", "name": "qwen3:8b", "temperature": 0.3, "contextWindow": 65536 },
    "planner": { "provider": "ollama", "name": "qwen3:14b", "temperature": 0.2, "contextWindow": 65536 },
    "coder": { "provider": "ollama", "name": "qwen2.5-coder:14b", "temperature": 0.1, "contextWindow": 65536 },
    "critic": { "provider": "ollama", "name": "qwen3:14b", "temperature": 0.2, "contextWindow": 65536 },
    "embeddings": { "provider": "ollama", "name": "qwen3-embedding:0.6b" }
  },
  "fallbacks": { "enabled": true, "cloud": { "provider": "anthropic", "name": "claude-sonnet-4-5" } },
  "runtime": { "maxConcurrentAgents": 3, "maxContextTokens": 48000 },
  "install": { "ollamaPull": ["qwen3:8b", "qwen3:14b", "qwen2.5-coder:14b", "qwen3-embedding:0.6b"] }
}
```

- [ ] **Step 4: Create cloud-balanced.json**

```json
{
  "id": "cloud-balanced",
  "name": "Cloud Balanced",
  "description": "Cloud-first for reasoning and coding, with local embeddings and optional local fallback.",
  "mode": "cloud-first",
  "hardware": { "minRamGb": 8, "recommendedRamGb": 16, "requiresGpu": false, "minVramGb": 0 },
  "models": {
    "default": { "provider": "anthropic", "name": "claude-haiku-4-5", "temperature": 0.3, "contextWindow": 128000 },
    "planner": { "provider": "anthropic", "name": "claude-haiku-4-5", "temperature": 0.2, "contextWindow": 128000 },
    "coder": { "provider": "anthropic", "name": "claude-sonnet-4-5", "temperature": 0.1, "contextWindow": 128000 },
    "researcher": { "provider": "perplexity", "name": "sonar-pro", "temperature": 0.3, "contextWindow": 128000 },
    "critic": { "provider": "openai", "name": "gpt-4.1", "temperature": 0.2, "contextWindow": 128000 },
    "embeddings": { "provider": "ollama", "name": "qwen3-embedding:0.6b" }
  },
  "fallbacks": { "enabled": true, "local": { "provider": "ollama", "name": "qwen3:4b" } },
  "runtime": { "maxConcurrentAgents": 4, "maxContextTokens": 96000 },
  "install": { "ollamaPull": ["qwen3-embedding:0.6b"] }
}
```

- [ ] **Step 5: Create all-cloud.json**

```json
{
  "id": "all-cloud",
  "name": "All Cloud",
  "description": "Zero local model dependency. All tiers via API providers.",
  "mode": "cloud-only",
  "hardware": { "minRamGb": 4, "recommendedRamGb": 8, "requiresGpu": false, "minVramGb": 0 },
  "models": {
    "default": { "provider": "anthropic", "name": "claude-haiku-4-5", "temperature": 0.3, "contextWindow": 128000 },
    "planner": { "provider": "anthropic", "name": "claude-sonnet-4-5", "temperature": 0.2, "contextWindow": 128000 },
    "coder": { "provider": "anthropic", "name": "claude-sonnet-4-5", "temperature": 0.1, "contextWindow": 128000 },
    "researcher": { "provider": "perplexity", "name": "sonar-pro", "temperature": 0.3, "contextWindow": 128000 },
    "critic": { "provider": "openai", "name": "gpt-4.1", "temperature": 0.2, "contextWindow": 128000 },
    "embeddings": { "provider": "openai", "name": "text-embedding-3-small" }
  },
  "fallbacks": { "enabled": false },
  "runtime": { "localModelsRequired": false, "ollamaRequired": false, "maxConcurrentAgents": 4, "maxContextTokens": 96000 }
}
```

- [ ] **Step 6: Add copy:profiles script to package.json**

Add to the `scripts` section of `package.json`:
```json
"copy:profiles": "mkdir -p dist/src/config/profiles && cp src/config/profiles/*.json dist/src/config/profiles/",
```

Then update the `build` script to run it after `tsc`:
```json
"build": "tsc -p tsconfig.json && npm run copy:profiles && mkdir -p dist/src/ui dist/src/db/migrations && cp src/ui/index.html src/ui/app.js src/ui/projection.js src/ui/styles.css dist/src/ui/ && cp src/db/migrations/0001_m09_kernel.sql dist/src/db/migrations/",
```

- [ ] **Step 7: Compile check + verify profiles copy**

```bash
npm run build
node --eval "
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'dist/src/config/profiles');
console.log('dist profiles:', fs.readdirSync(dir));
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  console.log(f + ': id=' + data.id + ' mode=' + data.mode + ' tiers=' + Object.keys(data.models).length);
}
"
```
Expected: 5 profiles print from `dist/src/config/profiles/`

- [ ] **Step 8: Commit**

```bash
git add src/config/profiles/ package.json
git commit -m "feat(config): add 5 built-in model profiles with copy:profiles build step"
```

---

### Task 3: Profile Registry

**Files:**
- Create: `src/config/profile-registry.ts`
- Create: `tests/config/profile-registry.test.ts`

- [ ] **Step 1: Create profile-registry.ts**

```typescript
/**
 * profile-registry.ts — Load, validate, and query built-in model profiles.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type ProfileData, validateProfile } from "./profile-types.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type HardwareMatch = "compatible" | "partial" | "incompatible";

export type SystemInfo = {
  os: string;
  cpu: string;
  ramGb: number;
  gpuName?: string;
  vramGb?: number;
  hasGpu: boolean;
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  installedModels: string[];
  apiProviders: Record<string, { configured: boolean; hasKey: boolean }>;
};

// ─── Registry ──────────────────────────────────────────────────────────

let _profiles: ProfileData[] | null = null;

/** Get the directory containing profile JSON files (dist/ or src/ fallback). */
function profilesDir(): string {
  const distDir = join(dirname(fileURLToPath(import.meta.url)), "profiles");
  const srcDir = join(process.cwd(), "src", "config", "profiles");
  return existsSync(distDir) ? distDir : srcDir;
}

/** Load all built-in profiles from disk. Validates each at load time. */
export function loadProfiles(): ProfileData[] {
  if (_profiles) return _profiles;
  const dir = profilesDir();
  const profiles: ProfileData[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    if (!validateProfile(raw)) {
      console.error(`[profile-registry] Skipping invalid profile: ${file}`);
      continue;
    }
    profiles.push(raw as ProfileData);
  }

  _profiles = profiles;
  return profiles;
}

/** Get all profiles. Returns empty array on error. */
export function listProfiles(): ProfileData[] {
  try {
    return loadProfiles();
  } catch {
    return [];
  }
}

/** Get a single profile by ID. */
export function getProfile(id: string): ProfileData | undefined {
  return listProfiles().find(p => p.id === id);
}

/** Check if a cloud profile has the required API keys. */
function hasApiKeysForProfile(profile: ProfileData, system: SystemInfo): boolean {
  // A profile is viable if at least one provider used by its models has a key
  const neededProviders = new Set(
    Object.values(profile.models).map(m => m.provider)
  );
  return Array.from(neededProviders).some(p => system.apiProviders[p]?.hasKey);
}

/** Check hardware compatibility for a single profile. */
export function matchHardware(profile: ProfileData, system: SystemInfo): HardwareMatch {
  // cloud-only profiles only care about API keys, never about GPU/RAM/Ollama
  if (profile.mode === "cloud-only") {
    return hasApiKeysForProfile(profile, system) ? "compatible" : "incompatible";
  }

  const hw = profile.hardware;

  // RAM check
  if (system.ramGb < hw.minRamGb) return "incompatible";

  // GPU check
  if (hw.requiresGpu && !system.hasGpu) return "incompatible";
  if (hw.minVramGb > 0 && (system.vramGb ?? 0) < hw.minVramGb) return "incompatible";

  // Ollama check for local-first profiles
  if (profile.mode === "local-first") {
    if (!system.ollamaInstalled) return "partial";
    if (!system.ollamaRunning) return "partial";
  }

  // Cloud-first: needs API keys for cloud tiers
  if (profile.mode === "cloud-first") {
    if (!hasApiKeysForProfile(profile, system)) return "incompatible";
  }

  // Partial: RAM above minimum but below recommended
  if (system.ramGb < hw.recommendedRamGb) return "partial";

  return "compatible";
}
```

- [ ] **Step 2: Write the test file**

Create `tests/config/profile-registry.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchHardware, type SystemInfo } from "../../src/config/profile-registry.js";
import { type ProfileData } from "../../src/config/profile-types.js";

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    id: "test-profile",
    name: "Test",
    description: "",
    mode: "local-first",
    hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 },
    models: { default: { provider: "ollama", name: "test-model" } },
    ...overrides,
  };
}

function makeSystem(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    os: "linux", cpu: "x64", ramGb: 16,
    hasGpu: false, ollamaInstalled: true, ollamaRunning: true,
    installedModels: [], apiProviders: {},
    ...overrides,
  };
}

describe("matchHardware", () => {
  it("returns compatible when system meets all requirements", () => {
    assert.equal(matchHardware(makeProfile(), makeSystem({ ramGb: 16 })), "compatible");
  });

  it("returns incompatible when RAM is below minimum", () => {
    const p = makeProfile({ hardware: { minRamGb: 16, recommendedRamGb: 32, requiresGpu: false, minVramGb: 0 } });
    assert.equal(matchHardware(p, makeSystem({ ramGb: 8 })), "incompatible");
  });

  it("returns incompatible when GPU required but absent", () => {
    const p = makeProfile({ hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: true, minVramGb: 8 } });
    assert.equal(matchHardware(p, makeSystem({ ramGb: 32, hasGpu: false })), "incompatible");
  });

  it("returns partial when Ollama is not running for local-first", () => {
    const s = makeSystem({ ramGb: 16, ollamaInstalled: false, ollamaRunning: false });
    assert.equal(matchHardware(makeProfile(), s), "partial");
  });

  it("returns incompatible when cloud-only profile has no API keys", () => {
    const p = makeProfile({ mode: "cloud-only", models: { default: { provider: "anthropic", name: "claude" } } });
    const s = makeSystem({ apiProviders: { anthropic: { configured: true, hasKey: false } } });
    assert.equal(matchHardware(p, s), "incompatible");
  });

  it("returns compatible when cloud-only profile has API keys", () => {
    const p = makeProfile({ mode: "cloud-only", models: { default: { provider: "anthropic", name: "claude" } } });
    const s = makeSystem({ apiProviders: { anthropic: { configured: true, hasKey: true } } });
    assert.equal(matchHardware(p, s), "compatible");
  });

  it("returns compatible for cloud-only with no GPU and no Ollama", () => {
    const p = makeProfile({ mode: "cloud-only", models: { default: { provider: "anthropic", name: "claude" } } });
    const s = makeSystem({ ramGb: 8, hasGpu: false, ollamaInstalled: false, ollamaRunning: false, apiProviders: { anthropic: { configured: true, hasKey: true } } });
    assert.equal(matchHardware(p, s), "compatible");
  });

  it("returns partial when above min but below recommended RAM", () => {
    const p = makeProfile({ hardware: { minRamGb: 8, recommendedRamGb: 32, requiresGpu: false, minVramGb: 0 } });
    assert.equal(matchHardware(p, makeSystem({ ramGb: 16 })), "partial");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run build && node --test dist/tests/config/profile-registry.test.js
```
Expected: tests pass

- [ ] **Step 4: Commit**

```bash
git add src/config/profile-registry.ts tests/config/profile-registry.test.ts
git commit -m "feat(config): add profile registry with hardware matching (cloud-only special-cased)"
```

---

### Task 4: Config Patch Engine

**Files:**
- Create: `src/config/profile-patch.ts`
- Create: `tests/config/profile-patch.test.ts`

- [ ] **Step 1: Create profile-patch.ts**

```typescript
/**
 * profile-patch.ts — Bounded config patching for model profiles.
 *
 * applyProfilePatch writes only these fields to an AlixConfig:
 *   modelProfile, model, models (per-tier mappings)
 *
 * It NEVER touches: policy, workspace, daemon, memory, approvals,
 * tools, logging, apiKeys, permissions, mcpServers, context,
 * skills, extensions, ui, toolConfig.
 */

import type { AlixConfig } from "../config/schema.js";
import type { ProfileData } from "./profile-types.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type ProfilePatch = {
  modelProfile: string;
  model?: { provider: string; name: string; temperature?: number };
  models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>;
  runtime?: { maxContextTokens?: number };
};

// ─── Sections the patch must never touch ───────────────────────────────

export const PRESERVED_SECTIONS = [
  "policy", "workspace", "daemon", "memory", "approvals", "tools",
  "logging", "apiKeys", "permissions", "mcpServers", "mcpServerPaths",
  "context", "skills", "extensions", "ui", "toolConfig",
];

// ─── Build a bounded patch from a profile ──────────────────────────────

export function buildProfilePatch(profile: ProfileData): ProfilePatch {
  const patch: ProfilePatch = {
    modelProfile: profile.id,
  };

  // Default model from the profile's "default" tier
  if (profile.models.default) {
    patch.model = {
      provider: profile.models.default.provider,
      name: profile.models.default.name,
    };
    if (profile.models.default.temperature !== undefined) {
      patch.model.temperature = profile.models.default.temperature;
    }
  }

  // Per-tier model mappings — writes to config.models, not subagents
  patch.models = {};
  for (const [tier, model] of Object.entries(profile.models)) {
    patch.models[tier] = {
      provider: model.provider,
      name: model.name,
    };
    if (model.temperature !== undefined) patch.models[tier].temperature = model.temperature;
    if (model.contextWindow !== undefined) patch.models[tier].contextWindow = model.contextWindow;
  }

  // Runtime limit
  if (profile.runtime?.maxContextTokens) {
    patch.runtime = { maxContextTokens: profile.runtime.maxContextTokens };
  }

  return patch;
}

// ─── Apply a bounded patch to an existing config ───────────────────────

export function applyProfilePatch(
  existingConfig: AlixConfig,
  patch: ProfilePatch,
): AlixConfig {
  const result: Record<string, unknown> = { ...(existingConfig as any) };

  // Only these fields may change
  result.modelProfile = patch.modelProfile;

  if (patch.model) {
    result.model = { ...(result.model as object), ...patch.model };
  }

  if (patch.models) {
    result.models = { ...((result.models as object) || {}), ...patch.models };
  }

  if (patch.runtime) {
    result.runtime = { ...(result.runtime as object), ...patch.runtime };
  }

  return result as AlixConfig;
}
```

- [ ] **Step 2: Write the test file**

Create `tests/config/profile-patch.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProfilePatch, applyProfilePatch, PRESERVED_SECTIONS } from "../../src/config/profile-patch.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ProfileData } from "../../src/config/profile-types.js";

function makeMinimalConfig(): AlixConfig {
  return {
    version: 1,
    model: { provider: "ollama", name: "old-model" },
    permissions: { default: "allow", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
    apiKeys: { anthropic: "sk-preserved" },
  };
}

function makeProfile(): ProfileData {
  return {
    id: "balanced-local",
    name: "Balanced Local",
    description: "",
    mode: "local-first",
    hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 },
    models: {
      default: { provider: "ollama", name: "qwen3:4b", temperature: 0.3, contextWindow: 32768 },
      coder: { provider: "ollama", name: "qwen2.5-coder:7b", temperature: 0.1 },
      embeddings: { provider: "ollama", name: "test" },
    },
    runtime: { maxContextTokens: 24000 },
  };
}

describe("buildProfilePatch", () => {
  it("includes modelProfile", () => {
    const patch = buildProfilePatch(makeProfile());
    assert.equal(patch.modelProfile, "balanced-local");
  });

  it("includes default model as model", () => {
    const patch = buildProfilePatch(makeProfile());
    assert.equal(patch.model?.provider, "ollama");
    assert.equal(patch.model?.name, "qwen3:4b");
  });

  it("includes per-tier mappings", () => {
    const patch = buildProfilePatch(makeProfile());
    assert.ok(patch.models?.coder);
    assert.equal(patch.models!.coder.name, "qwen2.5-coder:7b");
  });

  it("includes runtime limit", () => {
    const patch = buildProfilePatch(makeProfile());
    assert.equal(patch.runtime?.maxContextTokens, 24000);
  });
});

describe("applyProfilePatch", () => {
  it("updates modelProfile", () => {
    const config = makeMinimalConfig();
    const patch = buildProfilePatch(makeProfile());
    const result = applyProfilePatch(config, patch);
    assert.equal(result.modelProfile, "balanced-local");
  });

  it("updates model settings", () => {
    const config = makeMinimalConfig();
    const patch = buildProfilePatch(makeProfile());
    const result = applyProfilePatch(config, patch);
    assert.equal(result.model.name, "qwen3:4b");
  });

  it("preserves apiKeys", () => {
    const config = makeMinimalConfig();
    const patch = buildProfilePatch(makeProfile());
    const result = applyProfilePatch(config, patch);
    assert.equal(result.apiKeys?.anthropic, "sk-preserved");
  });

  it("preserves permissions", () => {
    const config = makeMinimalConfig();
    const patch = buildProfilePatch(makeProfile());
    const result = applyProfilePatch(config, patch);
    assert.equal(result.permissions.default, "allow");
  });

  it("writes per-tier models", () => {
    const config = makeMinimalConfig();
    const patch = buildProfilePatch(makeProfile());
    const result = applyProfilePatch(config, patch);
    assert.equal(result.models?.coder.name, "qwen2.5-coder:7b");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run build && node --test dist/tests/config/profile-patch.test.js
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/config/profile-patch.ts tests/config/profile-patch.test.ts
git commit -m "feat(config): add bounded profile patch engine (modelProfile, model, models, runtime only)"
```

---

### Task 5: Hardware + Provider Detector

**Files:**
- Create: `src/config/hardware-detect.ts`
- Create: `tests/config/hardware-detect.test.ts`

- [ ] **Step 1: Create hardware-detect.ts**

```typescript
/**
 * hardware-detect.ts — Detect system hardware, local runtime, and API providers.
 *
 * Adapted from Odysseus hwfit/hardware.py patterns: nvidia-smi for NVIDIA,
 * sysctl for macOS, /proc/meminfo for RAM on Linux, ollama list for models.
 * All probe failures are graceful (return "unknown" or zero, never throw).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform } from "node:os";
import type { SystemInfo } from "./profile-registry.js";

// ─── Helpers ───────────────────────────────────────────────────────────

function exec(cmd: string, args: string[], timeout = 5000): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", timeout }).trim();
  } catch {
    return null;
  }
}

function readFirstFile(paths: string[]): string | null {
  for (const p of paths) {
    try { return readFileSync(p, "utf-8").trim(); } catch { /* try next */ }
  }
  return null;
}

// ─── OS Detection ──────────────────────────────────────────────────────

function detectOS(): { os: string; cpu: string } {
  const p = platform();
  const os = p === "darwin" ? "macos" : p === "win32" ? "windows" : "linux";
  let cpu = "x64";
  if (p === "darwin") {
    cpu = (exec("uname", ["-m"]) || "x86_64").includes("arm") ? "arm64" : "x64";
  } else if (p === "linux") {
    cpu = (exec("uname", ["-m"]) || "x86_64").includes("aarch64") ? "arm64" : "x64";
  }
  return { os, cpu };
}

// ─── RAM Detection ─────────────────────────────────────────────────────

function detectRAM(): number {
  if (platform() === "darwin") {
    const out = exec("sysctl", ["-n", "hw.memsize"]);
    if (out) return Math.round(parseInt(out, 10) / (1024 ** 3) * 10) / 10;
  }
  if (platform() === "linux") {
    const meminfo = readFirstFile(["/proc/meminfo"]);
    if (meminfo) {
      for (const line of meminfo.split("\n")) {
        if (line.startsWith("MemTotal:")) {
          const kb = parseInt(line.replace(/[^0-9]/g, ""), 10);
          if (kb) return Math.round(kb / (1024 * 1024) * 10) / 10;
        }
      }
    }
  }
  if (platform() === "win32") {
    const out = exec("wmic", ["OS", "get", "TotalVisibleMemorySize", "/Value"]);
    if (out) {
      const m = out.match(/TotalVisibleMemorySize=(\d+)/);
      if (m) return Math.round(parseInt(m[1], 10) / (1024 * 1024) * 10) / 10;
    }
  }
  return 0;
}

// ─── GPU Detection ─────────────────────────────────────────────────────

function detectGPU(): { gpuName?: string; vramGb?: number; hasGpu: boolean } {
  const nvOut = exec("nvidia-smi", ["--query-gpu=memory.total,name", "--format=csv,noheader,nounits"]);
  if (nvOut) {
    const lines = nvOut.split("\n").filter(Boolean);
    if (lines.length > 0) {
      const parts = lines[0].split(",").map(s => s.trim());
      const vramMb = parseFloat(parts[0]);
      return { gpuName: parts[1] || "NVIDIA GPU", vramGb: Math.round(vramMb / 1024 * 10) / 10, hasGpu: true };
    }
  }
  if (platform() === "darwin") {
    const brand = exec("sysctl", ["-n", "machdep.cpu.brand_string"]);
    if (brand?.includes("Apple")) {
      const memsize = exec("sysctl", ["-n", "hw.memsize"]);
      const totalGb = memsize ? parseInt(memsize, 10) / (1024 ** 3) : 0;
      return { gpuName: brand, vramGb: totalGb > 0 ? Math.round(totalGb * 0.75 * 10) / 10 : undefined, hasGpu: true };
    }
  }
  return { hasGpu: false };
}

// ─── Ollama Detection ──────────────────────────────────────────────────

function detectOllama(): { installed: boolean; running: boolean; models: string[] } {
  if (!(exec("which", ["ollama"]) || exec("where", ["ollama"]))) {
    return { installed: false, running: false, models: [] };
  }
  const list = exec("ollama", ["list"], 3000);
  if (!list) return { installed: true, running: false, models: [] };
  const models = list.split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  return { installed: true, running: true, models };
}

// ─── API Provider Detection ────────────────────────────────────────────
// Distinguishes "configured" (referenced in config or apiKeys) from
// "hasKey" (the env var or apiKey value is actually set).

function detectAPIProviders(config: Record<string, unknown>): Record<string, { configured: boolean; hasKey: boolean }> {
  const providers: Record<string, { configured: boolean; hasKey: boolean }> = {};
  const known = ["anthropic", "openai", "google", "perplexity", "groq", "mistral", "cohere", "deepseek"];
  const apiKeys = (config.apiKeys as Record<string, string>) || {};
  const model = config.model as Record<string, unknown> | undefined;
  const models = config.models as Record<string, Record<string, unknown>> | undefined;

  for (const p of known) {
    const envKey = `${p.toUpperCase()}_API_KEY`;
    const hasKey = !!apiKeys[p] || !!process.env[envKey];

    // "configured" means referenced anywhere in config — not just having a key
    const configured =
      model?.provider === p ||
      (models && Object.values(models).some((m: any) => m?.provider === p)) ||
      !!apiKeys[p];

    providers[p] = { configured, hasKey };
  }

  return providers;
}

// ─── Main ──────────────────────────────────────────────────────────────

export function detectSystem(config?: Record<string, unknown>): SystemInfo {
  const { os, cpu } = detectOS();
  const ramGb = detectRAM();
  const gpu = detectGPU();
  const ollama = detectOllama();
  const apiProviders = config ? detectAPIProviders(config) : {};
  return { os, cpu, ramGb, ...gpu, ollamaInstalled: ollama.installed, ollamaRunning: ollama.running, installedModels: ollama.models, apiProviders };
}
```

- [ ] **Step 2: Write the test file**

Create `tests/config/hardware-detect.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSystem } from "../../src/config/hardware-detect.js";

describe("hardware-detect", () => {
  it("detects OS and CPU without throwing", () => {
    const result = detectSystem();
    assert.ok(["linux", "macos", "windows"].includes(result.os));
    assert.ok(typeof result.cpu === "string");
  });

  it("returns RAM as a positive number or zero", () => {
    assert.ok(typeof detectSystem().ramGb === "number");
    assert.ok(detectSystem().ramGb >= 0);
  });

  it("hasGpu is a boolean", () => {
    assert.equal(typeof detectSystem().hasGpu, "boolean");
  });

  it("returns installedModels as string array", () => {
    assert.ok(Array.isArray(detectSystem().installedModels));
  });

  it("ollamaInstalled and ollamaRunning are booleans", () => {
    const r = detectSystem();
    assert.equal(typeof r.ollamaInstalled, "boolean");
    assert.equal(typeof r.ollamaRunning, "boolean");
  });

  it("distinguishes configured vs hasKey for API providers", () => {
    const config = {
      apiKeys: { anthropic: "sk-xxx" },
      model: { provider: "openai", name: "gpt-4" },
    };
    const r = detectSystem(config as any);
    assert.equal(r.apiProviders.anthropic?.hasKey, true, "anthropic has key");
    assert.equal(r.apiProviders.anthropic?.configured, true, "anthropic configured via apiKeys");
    assert.equal(r.apiProviders.openai?.hasKey, false, "openai no key");
    assert.equal(r.apiProviders.openai?.configured, true, "openai configured via model.provider");
  });

  it("returns apiProviders as empty object without config", () => {
    assert.equal(Object.keys(detectSystem().apiProviders).length, 0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run build && node --test dist/tests/config/hardware-detect.test.js
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/config/hardware-detect.ts tests/config/hardware-detect.test.ts
git commit -m "feat(config): add hardware and provider detection (configured vs hasKey distinction)"
```

---

### Task 6: Model Doctor

**Files:**
- Create: `src/models/model-doctor.ts`
- Create: `tests/models/model-doctor.test.ts`

- [ ] **Step 1: Create model-doctor.ts**

```typescript
/**
 * model-doctor.ts — Diagnose system health, provider status, and profile compatibility.
 */

import type { ProfileData } from "../config/profile-types.js";
import { matchHardware, type SystemInfo } from "../config/profile-registry.js";

export type DoctorSection = { title: string; items: string[] };
export type DoctorIssue = { severity: "error" | "warning" | "info"; message: string };
export type ProfileCompatEntry = { id: string; name: string; status: "compatible" | "partial" | "incompatible"; reason?: string };

export type DoctorReport = {
  sections: DoctorSection[];
  profileCompatibility: ProfileCompatEntry[];
  issues: DoctorIssue[];
  nextStep?: string;
};

export function runDoctor(
  system: SystemInfo,
  config: Record<string, unknown>,
  profiles: ProfileData[],
  activeProfileId?: string,
): DoctorReport {
  const sections: DoctorSection[] = [];
  const issues: DoctorIssue[] = [];
  const profileCompatibility: ProfileCompatEntry[] = [];

  // Section 1: Hardware
  const hwItems = [`OS: ${system.os === "macos" ? "macOS" : system.os} ${system.cpu}`, `RAM: ${system.ramGb > 0 ? `${system.ramGb} GB` : "unknown"}`];
  if (system.hasGpu) {
    hwItems.push(`GPU: ${system.gpuName || "detected"}`);
    if (system.vramGb) hwItems.push(`VRAM: ${system.vramGb} GB`);
  } else {
    hwItems.push("GPU: none detected");
  }
  sections.push({ title: "Hardware", items: hwItems });
  if (system.ramGb <= 0) issues.push({ severity: "warning", message: "Could not detect system RAM." });

  // Section 2: Local Runtime
  const rtItems: string[] = [];
  if (system.ollamaInstalled) {
    rtItems.push(system.ollamaRunning ? "Ollama: running" : "Ollama: installed but not running");
    if (system.installedModels.length > 0) {
      rtItems.push("Installed models:");
      rtItems.push(...system.installedModels.map(m => `  ${m}`));
    } else {
      rtItems.push("  No models installed.");
    }
  } else {
    rtItems.push("Ollama: not found");
  }
  sections.push({ title: "Local Runtime", items: rtItems });
  if (!system.ollamaInstalled) {
    issues.push({ severity: "info", message: "Ollama not detected. Install from https://ollama.com for local model support." });
  } else if (!system.ollamaRunning) {
    issues.push({ severity: "warning", message: "Ollama is installed but not running. Start it with: ollama serve" });
  }

  // Section 3: API Providers
  const provItems: string[] = [];
  for (const [name, info] of Object.entries(system.apiProviders)) {
    const status = !info.configured ? "not configured" : !info.hasKey ? "missing key" : "configured";
    provItems.push(`${name}: ${status}`);
    if (info.configured && !info.hasKey) {
      issues.push({ severity: "warning", message: `${name} provider referenced in config but ${name.toUpperCase()}_API_KEY is missing.` });
    }
  }
  if (Object.keys(system.apiProviders).length > 0) sections.push({ title: "API Providers", items: provItems });

  // Section 4: Profile Compatibility
  for (const profile of profiles) {
    const match = matchHardware(profile, system);
    let reason: string | undefined;
    if (match === "compatible") {
      if (profile.mode === "cloud-only" || profile.mode === "cloud-first") reason = "API keys configured";
    } else if (match === "partial") {
      if (profile.mode === "local-first" && !system.ollamaRunning) reason = "Ollama not running";
      else if (system.ramGb < profile.hardware.recommendedRamGb) reason = `RAM below recommended ${profile.hardware.recommendedRamGb} GB`;
    } else if (match === "incompatible") {
      if (system.ramGb < profile.hardware.minRamGb) reason = `Requires ${profile.hardware.minRamGb} GB RAM (detected ${system.ramGb} GB)`;
      else if (profile.hardware.requiresGpu && !system.hasGpu) reason = "Requires GPU";
    }
    profileCompatibility.push({ id: profile.id, name: profile.name, status: match, reason });
  }

  // Detect incompatible active profile
  if (activeProfileId) {
    const active = profiles.find(p => p.id === activeProfileId);
    if (active && matchHardware(active, system) === "incompatible") {
      issues.push({ severity: "warning", message: `Active profile "${activeProfileId}" is incompatible with current hardware. Consider switching.` });
    }
  }

  return { sections, profileCompatibility, issues, nextStep: issues.length === 0 ? undefined : "Run: alix models fit" };
}
```

- [ ] **Step 2: Write the test file**

Create `tests/models/model-doctor.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDoctor } from "../../src/models/model-doctor.js";
import type { ProfileData } from "../../src/config/profile-types.js";
import type { SystemInfo } from "../../src/config/profile-registry.js";

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return { id: "balanced-local", name: "Balanced Local", description: "", mode: "local-first", hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "ollama", name: "test" } }, ...overrides };
}

function makeSystem(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return { os: "linux", cpu: "x64", ramGb: 16, hasGpu: false, ollamaInstalled: true, ollamaRunning: true, installedModels: ["test-model"], apiProviders: { anthropic: { configured: true, hasKey: true } }, ...overrides };
}

describe("runDoctor", () => {
  it("produces hardware section with RAM", () => {
    const report = runDoctor(makeSystem(), {}, [makeProfile()]);
    assert.ok(report.sections.find(s => s.title === "Hardware")?.items.some(i => i.includes("RAM")));
  });

  it("produces local runtime section", () => {
    assert.ok(runDoctor(makeSystem(), {}, [makeProfile()]).sections.find(s => s.title === "Local Runtime"));
  });

  it("marks profile as compatible when hardware passes", () => {
    assert.equal(runDoctor(makeSystem(), {}, [makeProfile()]).profileCompatibility[0].status, "compatible");
  });

  it("marks profile as incompatible when RAM is insufficient", () => {
    const p = makeProfile({ hardware: { minRamGb: 32, recommendedRamGb: 64, requiresGpu: false, minVramGb: 0 } });
    assert.equal(runDoctor(makeSystem({ ramGb: 8 }), {}, [p]).profileCompatibility[0].status, "incompatible");
  });

  it("reports missing API keys as issues", () => {
    const s = makeSystem({ apiProviders: { anthropic: { configured: true, hasKey: false } } });
    assert.ok(runDoctor(s, {}, [makeProfile()]).issues.some(i => i.message.includes("API_KEY")));
  });

  it("reports missing Ollama", () => {
    const s = makeSystem({ ollamaInstalled: false, ollamaRunning: false });
    assert.ok(runDoctor(s, {}, [makeProfile()]).issues.some(i => i.message.includes("Ollama not detected")));
  });

  it("warns when active profile is incompatible", () => {
    const p = makeProfile({ id: "power-local", hardware: { minRamGb: 32, recommendedRamGb: 64, requiresGpu: false, minVramGb: 0 } });
    assert.ok(runDoctor(makeSystem({ ramGb: 8 }), {}, [p], "power-local").issues.some(i => i.message.includes("incompatible")));
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run build && node --test dist/tests/models/model-doctor.test.js
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/models/model-doctor.ts tests/models/model-doctor.test.ts
git commit -m "feat(models): add model doctor with hardware, provider, and profile compatibility checks"
```

---

### Task 7: Model Fit Ranking

**Files:**
- Create: `src/models/model-fit.ts`
- Create: `tests/models/model-fit.test.ts`

- [ ] **Step 1: Create model-fit.ts**

```typescript
/**
 * model-fit.ts — Rank profiles by hardware fit, use case, and mode preference.
 *
 * When --mode is provided, it acts as a filter (only profiles of that mode).
 * Future: add --prefer for soft preference.
 */

import type { ProfileData } from "../config/profile-types.js";
import { matchHardware, type SystemInfo } from "../config/profile-registry.js";

export type FitRanking = { profile: ProfileData; rank: number; status: "best fit" | "compatible" | "not recommended"; reasons: string[] };
export type FitOptions = { role?: string; mode?: string };

const ROLE_BIAS: Record<string, { local: number; cloud: number }> = {
  coder: { local: 8, cloud: 7 },
  researcher: { local: 4, cloud: 9 },
  planner: { local: 5, cloud: 7 },
  critic: { local: 5, cloud: 8 },
  general: { local: 6, cloud: 6 },
};

export function rankProfiles(system: SystemInfo, profiles: ProfileData[], options: FitOptions = {}): FitRanking[] {
  const scores: FitRanking[] = [];

  for (const profile of profiles) {
    const match = matchHardware(profile, system);
    const reasons: string[] = [];
    let score = 0;

    // Mode filter: when --mode is set, skip profiles that don't match
    if (options.mode && profile.mode !== options.mode) continue;

    if (match === "incompatible") {
      scores.push({ profile, rank: 0, status: "not recommended", reasons: ["Incompatible: hardware requirements not met"] });
      continue;
    }

    // Hardware fit
    if (match === "compatible") { score += 10; reasons.push("Fits available hardware"); }
    else { score += 5; reasons.push("Partially fits hardware"); }

    // Role weighting
    const role = options.role || "general";
    const bias = ROLE_BIAS[role] || ROLE_BIAS.general!;
    score += profile.mode.startsWith("local") ? bias.local : bias.cloud;

    // Bonus features
    if (profile.models.embeddings) score += 1;
    if (profile.fallbacks?.enabled) score += 1;

    // Descriptive reasons
    if (profile.mode === "local-first") {
      reasons.push("Uses local models for default/planner/coder");
      if (profile.fallbacks?.enabled) reasons.push("Keeps cloud fallback for research");
    } else if (profile.mode === "cloud-first") {
      reasons.push("Best quality with API models");
      if (profile.fallbacks?.enabled) reasons.push("Has local fallback option");
    }

    if (profile.id === "minimal-local") reasons.push("Safest local-only option");
    if (profile.id === "balanced-local") reasons.push("Good latency/quality balance");
    if (profile.id === "power-local" && match === "partial") reasons.push("Coder tier likely too large for this machine");
    if (profile.id === "cloud-balanced" || profile.id === "all-cloud") {
      reasons.push("Requires API keys");
      if (match === "compatible") reasons.push("Higher cost");
    }

    const status = score >= 15 ? "best fit" : score >= 8 ? "compatible" : "not recommended";
    scores.push({ profile, rank: score, status, reasons });
  }

  return scores.sort((a, b) => b.rank - a.rank);
}
```

- [ ] **Step 2: Write the test file**

Create `tests/models/model-fit.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankProfiles } from "../../src/models/model-fit.js";
import type { ProfileData } from "../../src/config/profile-types.js";
import type { SystemInfo } from "../../src/config/profile-registry.js";

describe("rankProfiles", () => {
  const system: SystemInfo = {
    os: "linux", cpu: "x64", ramGb: 16, hasGpu: true, gpuName: "RTX 3060", vramGb: 12,
    ollamaInstalled: true, ollamaRunning: true, installedModels: ["qwen3:4b"],
    apiProviders: { anthropic: { configured: true, hasKey: true } },
  };
  const profiles: ProfileData[] = [
    { id: "minimal-local", name: "Minimal Local", description: "", mode: "local-first", hardware: { minRamGb: 4, recommendedRamGb: 8, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "ollama", name: "qwen3:4b" }, embeddings: { provider: "ollama", name: "test" } } },
    { id: "balanced-local", name: "Balanced Local", description: "", mode: "local-first", hardware: { minRamGb: 8, recommendedRamGb: 16, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "ollama", name: "qwen3:4b" }, coder: { provider: "ollama", name: "qwen2.5-coder:7b" }, embeddings: { provider: "ollama", name: "test" } }, fallbacks: { enabled: true } },
    { id: "all-cloud", name: "All Cloud", description: "", mode: "cloud-only", hardware: { minRamGb: 4, recommendedRamGb: 8, requiresGpu: false, minVramGb: 0 }, models: { default: { provider: "anthropic", name: "claude-haiku-4-5" }, coder: { provider: "openai", name: "gpt-4" }, embeddings: { provider: "openai", name: "text-embedding-3-small" } } },
  ];

  it("returns at least one result", () => {
    assert.ok(rankProfiles(system, profiles).length > 0);
  });

  it("sorts by rank descending", () => {
    const results = rankProfiles(system, profiles);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].rank >= results[i].rank);
    }
  });

  it("marks incompatible profiles as not recommended", () => {
    const huge: ProfileData = { id: "huge", name: "Huge", description: "", mode: "local-first", hardware: { minRamGb: 128, recommendedRamGb: 256, requiresGpu: true, minVramGb: 48 }, models: { default: { provider: "ollama", name: "huge" } } };
    assert.equal(rankProfiles(system, [huge])[0].status, "not recommended");
  });

  it("respects mode filter — cloud-only only shows that mode", () => {
    const results = rankProfiles(system, profiles, { mode: "cloud-only" });
    assert.ok(results.every(r => r.profile.mode === "cloud-only"));
  });

  it("respects role filter for coder bias", () => {
    assert.ok(rankProfiles(system, profiles, { role: "coder" }).length > 0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run build && node --test dist/tests/models/model-fit.test.js
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/models/model-fit.ts tests/models/model-fit.test.ts
git commit -m "feat(models): add model fit ranking with role/mode weighting"
```

---

### Task 8: Profile Apply/Install/List/Show + CLI

**Files:**
- Create: `src/models/model-install.ts`
- Create: `tests/models/model-install.test.ts`
- Create: `src/cli/commands/models.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create model-install.ts**

```typescript
/**
 * model-install.ts — Apply, install, list, and show model profiles.
 *
 * applyProfile: delegates to profile-patch.ts for bounded config writes.
 * installProfile: pulls required Ollama models (if applicable), then applies.
 * listAllProfiles, showProfileDetail: query the registry.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getProfile, listProfiles } from "../config/profile-registry.js";
import { buildProfilePatch, applyProfilePatch, type ProfilePatch } from "../config/profile-patch.js";
import type { ProfileData } from "../config/profile-types.js";
import type { AlixConfig } from "../config/schema.js";

export type ApplyResult = { success: boolean; message: string; changes?: ProfilePatch; preserved?: string[] };
export type InstallResult = { success: boolean; message: string; pulled: string[]; skipped: string[]; errors: string[] };

function configPath(cwd: string): string { return join(cwd, ".alix", "config.json"); }

function readConfig(cwd: string): AlixConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) throw new Error(`No config found at ${path}. Run "alix init" first.`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeConfig(cwd: string, config: AlixConfig): void {
  writeFileSync(configPath(cwd), JSON.stringify(config, null, 2), "utf-8");
}

// ─── Query ─────────────────────────────────────────────────────────────

export function listAllProfiles(): ProfileData[] { return listProfiles(); }
export function showProfileDetail(id: string): ProfileData | undefined { return getProfile(id); }

// ─── Apply ─────────────────────────────────────────────────────────────

const PRESERVED = ["policy", "workspace", "daemon", "memory", "approvals", "tools", "logging", "apiKeys", "permissions", "mcpServers", "mcpServerPaths", "context", "skills", "extensions", "ui", "toolConfig"];

export function applyProfile(profileId: string, cwd: string, dryRun = false): ApplyResult {
  const profile = getProfile(profileId);
  if (!profile) {
    return { success: false, message: `Unknown profile: ${profileId}. Use "alix models list-profiles" to see available profiles.` };
  }
  const config = readConfig(cwd);
  const patch = buildProfilePatch(profile);
  const newConfig = applyProfilePatch(config, patch);

  if (dryRun) {
    return { success: true, message: `[DRY-RUN] Would apply profile: ${profileId}`, changes: patch, preserved: PRESERVED.filter(s => (config as any)[s] !== undefined) };
  }
  writeConfig(cwd, newConfig);
  return { success: true, message: `Applied profile: ${profile.id} — ${profile.name}`, changes: patch, preserved: PRESERVED.filter(s => (config as any)[s] !== undefined) };
}

// ─── Install ───────────────────────────────────────────────────────────

export function installProfile(profileId: string, cwd: string, dryRun = false): InstallResult | ApplyResult {
  const profile = getProfile(profileId);
  if (!profile) return { success: false, message: `Unknown profile: ${profileId}` };

  // cloud-only: no model download needed
  if (profile.mode === "cloud-only") {
    return dryRun
      ? { success: true, message: `[DRY-RUN] Would validate API keys and apply profile: ${profileId}`, pulled: [], skipped: [], errors: [] }
      : applyProfile(profileId, cwd);
  }

  const modelsToPull = profile.install?.ollamaPull || [];
  const pulled: string[] = [];
  const errors: string[] = [];

  for (const model of modelsToPull) {
    if (dryRun) continue;
    try {
      execFileSync("ollama", ["pull", model], { timeout: 300000, stdio: "pipe" });
      pulled.push(model);
    } catch { errors.push(model); }
  }

  const applyResult = dryRun ? applyProfile(profileId, cwd, true) : applyProfile(profileId, cwd);
  return {
    success: applyResult.success && errors.length === 0,
    message: dryRun ? `[DRY-RUN] Would install profile: ${profileId} (would pull ${modelsToPull.length} models)` : `Installed profile: ${profileId}. Pulled ${pulled.length}, errors ${errors.length}.`,
    pulled, skipped: dryRun ? modelsToPull : [], errors,
  };
}
```

- [ ] **Step 2: Write the test file**

Create `tests/models/model-install.test.ts`:
```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { applyProfile, listAllProfiles, showProfileDetail } from "../../src/models/model-install.js";

const TEST_DIR = join(process.cwd(), `.test-model-install-${Date.now()}`);
const ALIX_DIR = join(TEST_DIR, ".alix");
const CONFIG_PATH = join(ALIX_DIR, "config.json");

function createConfig(overrides: Record<string, unknown> = {}): void {
  mkdirSync(ALIX_DIR, { recursive: true });
  const config = {
    version: 1,
    model: { provider: "ollama", name: "test" },
    permissions: { default: "allow" as const, tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, repoMapMode: "lite" as const, maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process" as const, shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const },
    ...overrides,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

describe("model-install", () => {
  beforeEach(() => { if (existsSync(ALIX_DIR)) rmSync(ALIX_DIR, { recursive: true, force: true }); });
  afterEach(() => { if (existsSync(ALIX_DIR)) rmSync(ALIX_DIR, { recursive: true, force: true }); });

  it("listAllProfiles returns built-in profiles", () => {
    const ids = listAllProfiles().map(p => p.id);
    assert.ok(ids.includes("minimal-local"));
    assert.ok(ids.includes("balanced-local"));
    assert.ok(ids.includes("all-cloud"));
  });

  it("showProfileDetail returns profile by ID", () => {
    assert.equal(showProfileDetail("balanced-local")?.id, "balanced-local");
  });

  it("showProfileDetail returns undefined for unknown ID", () => {
    assert.equal(showProfileDetail("nonexistent"), undefined);
  });

  it("applyProfile returns error for unknown profile", () => {
    const result = applyProfile("nonexistent", TEST_DIR);
    assert.equal(result.success, false);
    assert.ok(result.message.includes("Unknown profile"));
  });

  it("applyProfile writes config changes", () => {
    createConfig();
    applyProfile("balanced-local", TEST_DIR);
    const updated = JSON.parse(require("fs").readFileSync(CONFIG_PATH, "utf-8"));
    assert.equal(updated.modelProfile, "balanced-local");
  });

  it("applyProfile with dry-run does not write", () => {
    createConfig();
    const before = require("fs").readFileSync(CONFIG_PATH, "utf-8");
    applyProfile("balanced-local", TEST_DIR, true);
    const after = require("fs").readFileSync(CONFIG_PATH, "utf-8");
    assert.equal(before, after);
  });

  it("dry-run returns changes and preserved sections", () => {
    createConfig();
    const result = applyProfile("balanced-local", TEST_DIR, true);
    assert.ok(result.changes);
    assert.ok(Array.isArray(result.preserved));
  });
});
```

- [ ] **Step 3: Create src/cli/commands/models.ts**

```typescript
/**
 * models.ts — CLI commands for model profile management.
 * Thin wrappers; all logic lives in src/models/*.ts and src/config/*.ts.
 */

export async function handleModelsDoctor(args: string[]): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { runDoctor } = await import("../../models/model-doctor.js");
  const { listProfiles } = await import("../../config/profile-registry.js");
  const config = await loadConfig(process.cwd());
  const system = detectSystem(config as any);
  const report = runDoctor(system, config as any, listProfiles(), config.modelProfile);
  const json = args.includes("--json");
  if (json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log("\nALiX Model Doctor\n");
  for (const sec of report.sections) {
    console.log(sec.title);
    for (const i of sec.items) console.log(`  ${i.startsWith("  ") ? i : `  ${i}`}`);
    console.log();
  }
  console.log("Profile Compatibility");
  for (const pc of report.profileCompatibility) {
    const icon = pc.status === "compatible" ? "✅" : pc.status === "partial" ? "⚠️" : "❌";
    console.log(`  ${icon} ${pc.id.padEnd(20)} ${pc.status}${pc.reason ? `: ${pc.reason}` : ""}`);
  }
  if (report.issues.length > 0) {
    console.log("\nIssues");
    for (const issue of report.issues) console.log(`  ${issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️"} ${issue.message}`);
  }
  if (report.nextStep) console.log(`\nNext\n  ${report.nextStep}`);
}

export async function handleModelsFit(args: string[]): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { rankProfiles } = await import("../../models/model-fit.js");
  const { listProfiles } = await import("../../config/profile-registry.js");
  const config = await loadConfig(process.cwd());
  const system = detectSystem(config as any);

  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role" && args[i + 1]) opts.role = args[++i];
    if (args[i] === "--mode" && args[i + 1]) opts.mode = args[++i];
    if (args[i] === "--json") opts.json = "true";
  }
  const results = rankProfiles(system, listProfiles(), opts);
  if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
  console.log("\nRecommended Profiles\n");
  results.forEach((r, i) => {
    const icon = r.status === "best fit" ? "✅ best fit" : r.status === "compatible" ? "✅ compatible" : "⚠️ not recommended";
    console.log(`${i + 1}. ${r.profile.id.padEnd(20)} ${icon}`);
    r.reasons.forEach(rs => console.log(`   ${rs}`));
    console.log();
  });
  const best = results[0];
  if (best && best.status !== "not recommended") console.log(`Suggested command:\n  alix models install-profile ${best.profile.id}`);
}

export async function handleModelsList(args: string[]): Promise<void> {
  const { listProfiles, matchHardware } = await import("../../config/profile-registry.js");
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const config = await loadConfig(process.cwd());
  const system = detectSystem(config as any);
  const profiles = listProfiles();
  if (args.includes("--json")) { console.log(JSON.stringify(profiles, null, 2)); return; }
  console.log("\nAvailable Profiles\n");
  for (const p of profiles) {
    const m = matchHardware(p, system);
    const icon = m === "compatible" ? "✅" : m === "partial" ? "⚠️" : "❌";
    const active = config.modelProfile === p.id ? " (active)" : "";
    console.log(`  ${icon} ${p.id.padEnd(22)} ${p.name}${active}`);
    console.log(`     ${p.description}`);
    console.log(`     Mode: ${p.mode} | RAM: ${p.hardware.minRamGb}-${p.hardware.recommendedRamGb} GB`);
    console.log();
  }
}

export async function handleModelsShow(args: string[]): Promise<void> {
  const { showProfileDetail } = await import("../../models/model-install.js");
  const id = args.find(a => !a.startsWith("--"));
  if (!id) { console.error("Usage: alix models show-profile <id> [--json]"); process.exit(1); }
  const profile = showProfileDetail(id);
  if (!profile) { console.error(`Unknown profile: ${id}`); process.exit(1); }
  if (args.includes("--json")) { console.log(JSON.stringify(profile, null, 2)); return; }
  console.log(`\n${profile.name} (${profile.id})`);
  console.log(`  ${profile.description}`);
  console.log(`  Mode: ${profile.mode}`);
  console.log(`  Hardware: ${profile.hardware.minRamGb}–${profile.hardware.recommendedRamGb} GB RAM${profile.hardware.requiresGpu ? ", GPU required" : ""}`);
  console.log("\nTiers:");
  for (const [tier, model] of Object.entries(profile.models)) {
    console.log(`  ${tier.padEnd(12)} ${model.provider}/${model.name}`);
  }
  if (profile.fallbacks?.enabled) {
    console.log("\nFallbacks:");
    if (profile.fallbacks.cloud) console.log(`  cloud  ${profile.fallbacks.cloud.provider}/${profile.fallbacks.cloud.name}`);
    if (profile.fallbacks.local) console.log(`  local  ${profile.fallbacks.local.provider}/${profile.fallbacks.local.name}`);
  }
}

export async function handleModelsApply(args: string[]): Promise<void> {
  const { applyProfile } = await import("../../models/model-install.js");
  const id = args.find(a => !a.startsWith("--"));
  if (!id) { console.error("Usage: alix models apply-profile <id> [--dry-run]"); process.exit(1); }
  const result = applyProfile(id, process.cwd(), args.includes("--dry-run"));
  console.log(result.message);
  if (result.changes && args.includes("--dry-run")) {
    console.log("\nWould write:");
    for (const [k, v] of Object.entries(result.changes)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    console.log("\nPreserved:");
    for (const s of result.preserved || []) console.log(`  ${s}`);
  }
  if (!result.success) process.exit(1);
}

export async function handleModelsInstall(args: string[]): Promise<void> {
  const { installProfile } = await import("../../models/model-install.js");
  const id = args.find(a => !a.startsWith("--"));
  if (!id) { console.error("Usage: alix models install-profile <id> [--dry-run]"); process.exit(1); }
  const result = await installProfile(id, process.cwd(), args.includes("--dry-run"));
  console.log(result.message);
  if (!result.success) process.exit(1);
}

const HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  "doctor": handleModelsDoctor,
  "fit": handleModelsFit,
  "list-profiles": handleModelsList,
  "show-profile": handleModelsShow,
  "apply-profile": handleModelsApply,
  "install-profile": handleModelsInstall,
};

export async function handleModelsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    console.error("Usage: alix models <doctor|fit|list-profiles|show-profile|apply-profile|install-profile>");
    console.error("  alix models doctor               Run system and profile diagnostic");
    console.error("  alix models fit                   Rank profiles by hardware fit");
    console.error("  alix models list-profiles         List available profiles");
    console.error("  alix models show-profile <id>     Show profile details");
    console.error("  alix models apply-profile <id>    Apply a profile to config");
    console.error("  alix models install-profile <id>  Pull models and apply profile");
    process.exit(1);
  }
  await handler(args.slice(1));
}
```

- [ ] **Step 4: Add dispatch in src/cli.ts**

Find the command dispatch area (around `alix init`, `alix config`, `alix sop` handlers) and add:
```typescript
if (command === "models") {
  const { handleModelsCommand } = await import("./cli/commands/models.js");
  await handleModelsCommand(args);
}
```

Add help text alongside existing `alix doctor` / `alix daemon doctor` lines:
```typescript
  alix models doctor         Diagnose hardware, providers, and profile compatibility
  alix models fit            Rank model profiles for your system
  alix models list-profiles  List available model profiles
  alix models show-profile   Show profile details
  alix models apply-profile  Apply a profile to config
  alix models install-profile  Pull models and apply profile
```

- [ ] **Step 5: Compile check + smoke test**

```bash
npm run build && npx tsc --noEmit
node dist/src/cli.js models list-profiles
node dist/src/cli.js models show-profile balanced-local
```

- [ ] **Step 6: Commit**

```bash
git add src/models/model-install.ts tests/models/model-install.test.ts src/cli/commands/models.ts src/cli.ts
git commit -m "feat(cli): add models doctor/fit/list/show/apply/install commands"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/user-manual.md`
- Modify: `README.md`

- [ ] **Step 1: Add Model Profiles section to user-manual.md**

After the Configuration section, add:
- What profiles are (presets for model/tier mapping per use case)
- The five built-in profiles table
- Happy path: `alix models doctor → alix models fit → alix models install-profile balanced-local`
- Config precedence: CLI flags > `alix config set` overrides > `modelProfile` > built-in defaults

- [ ] **Step 2: Update README**

Add a brief mention of model profiles and the `alix models` command group.

- [ ] **Step 3: Commit**

```bash
git add docs/user-manual.md README.md
git commit -m "docs: add model profile concepts, commands, and happy path"
```

---

### Verification

1. `npm run build` — clean compile, profiles copied to dist
2. `node --test dist/tests/config/profile-registry.test.js dist/tests/config/hardware-detect.test.js dist/tests/config/profile-patch.test.js dist/tests/models/model-doctor.test.js dist/tests/models/model-fit.test.js dist/tests/models/model-install.test.js` — all pass
3. `node dist/src/cli.js models list-profiles` — shows 5 profiles
4. `node dist/src/cli.js models doctor` — runs without errors
5. `node dist/src/cli.js models fit` — ranks profiles
6. `node dist/src/cli.js models show-profile balanced-local` — shows details
7. `node dist/src/cli.js models apply-profile balanced-local --dry-run` — shows dry-run output
8. Per CLAUDE.md: `mcp__gitnexus__detect_changes` — verify only expected files changed
