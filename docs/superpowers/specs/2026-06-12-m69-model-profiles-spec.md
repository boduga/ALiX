# M0.69 — Model Profiles + Doctor + Fit

> **Status:** Spec draft

## Goal

Add a model profile system to ALiX: built-in presets that configure provider/model/tier mappings per use case, plus CLI diagnostics (`doctor`), ranking (`fit`), and application (`install-profile`, `apply-profile`, `list-profiles`, `show-profile`).

## Architecture

Five built-in profiles stored as JSON files in `src/config/profiles/`. A `ProfileRegistry` loads them at startup and validates them at runtime against TypeScript-defined type guards in `profile-types.ts`. Profiles are partial config patches — they set `model`, `subagents` tiers, and `runtime` limits, but must preserve unrelated config sections (policy, workspace, daemon, memory, approvals, tools, logging).

CLI commands are thin wrappers; all logic lives in `src/models/*.ts`. Config precedence:

    CLI flags
      > explicit `alix config set ...` overrides
      > selected `modelProfile`
      > built-in defaults

## Profiles

### five built-in profiles

| Profile | Mode | Key attribute |
|---------|------|---------------|
| `minimal-local` | local-first | Lowest resource requirement. Single small local model for all tiers. |
| `balanced-local` | local-first | Default for 16-32 GB machines. Local models per tier with cloud fallback. |
| `power-local` | local-first | High-end local. Larger local models, more context, heavier tiers. |
| `cloud-balanced` | cloud-first | API models for reasoning/coding/critique, local for embeddings & fallback. |
| `all-cloud` | cloud-only | No local model dependency at all. All tiers via API providers. |

### Profile JSON shape

```typescript
type ModelTier =
  | "default"
  | "planner"
  | "researcher"
  | "coder"
  | "critic"
  | "embeddings";

type ProfileModel = {
  provider: string;
  name: string;
  temperature?: number;
  contextWindow?: number;
};

type ProfileData = {
  id: string;                       // kebab-case, matches filename
  name: string;                     // Human-readable
  description: string;
  mode: "local-first" | "cloud-first" | "cloud-only";
  hardware: {
    minRamGb: number;
    recommendedRamGb: number;
    requiresGpu: boolean;
    minVramGb: number;
  };
  models: Partial<Record<ModelTier, ProfileModel>>;
  fallbacks?: {
    enabled: boolean;
    local?: { provider: string; name: string };
    cloud?: { provider: string; name: string };
  };
  runtime?: {
    maxConcurrentAgents?: number;
    maxContextTokens?: number;
    toolMode?: string;
    shellMode?: string;
    localModelsRequired?: boolean;
    ollamaRequired?: boolean;
  };
  install?: {
    ollamaPull?: string[];          // model tags to pull during install-profile
  };
};
```

### cloud-balanced vs all-cloud

`cloud-balanced` uses cloud for reasoning/coding but keeps local embeddings and optional local fallback. `all-cloud` requires zero local infrastructure — doctor checks only API keys and network, never GPU/RAM/fit.

## Config integration

`alix models apply-profile <id>` writes a bounded patch to `.alix/config.json`:

```jsonc
{
  "modelProfile": "cloud-balanced",
  "model": {
    "provider": "anthropic",
    "name": "claude-haiku-4-5"
  }
  // plus models.default, models.planner, etc.
  // plus runtime subsection from profile
}
```

It MUST preserve: policy, workspace, daemon, memory, approvals, tools, logging, apiKeys.

The safe config merge pipeline is:

```
read existing config
build bounded patch from profile
newConfig = deepMerge(existingConfig, profilePatch)
newConfig = applyModelOverrides(newConfig, existingConfig.modelOverrides)
writeConfig(newConfig)
```

Manual `alix config set` overrides are tracked via `modelOverrides` and surfaced by `doctor` as "modified by local config overrides."

## File structure

```
src/config/profiles/
  minimal-local.json
  balanced-local.json
  power-local.json
  cloud-balanced.json
  all-cloud.json

src/config/profile-types.ts
src/config/profile-registry.ts
src/config/hardware-detect.ts

src/models/model-fit.ts
src/models/model-doctor.ts
src/models/model-install.ts

src/cli/commands/models.ts
```

## Sub-milestones

### M0.69a — Profile Registry

- `profile-types.ts`: `ProfileData`, `ProfileHardware`, `ProfileModelMap` types
- 5 JSON profiles in `src/config/profiles/`
- `profile-registry.ts`: `listProfiles()`, `getProfile(id)`, `matchHardware(profile, system) → 'compatible' | 'partial' | 'incompatible'`
- Tests: validate every JSON profile loads and matches its type, matchHardware returns correct tier

### M0.69b — Hardware Detector

- `hardware-detect.ts`: `detectSystem()` returning:
  - OS (linux/macos/windows)
  - CPU architecture + count
  - total RAM
  - GPU vendor/model/VRAM (nvidia-smi, rocminfo, Apple Silicon sysctl)
  - Ollama availability + installed models (`ollama list`)
  - configured API providers + key presence
- Borrows pattern from Odysseus `services/hwfit/hardware.py` but adapted for Node.js (subprocess calls, no PyTorch dependency)
- Tests: mocked GPU/RAM responses, missing binaries, Ollama not found

### M0.69c — Model Doctor

- `model-doctor.ts`: `runDoctor(system, config, profiles) → DoctorReport`
- Report sections: Hardware, Local Runtime, API Providers, Profile Compatibility, Issues
- `alix models doctor` CLI wraps it with formatted output
- Tests: doctor report shape, partial compatibility, missing API keys, GPU below threshold

### M0.69d — Model Fit Ranking

- `model-fit.ts`: `rankProfiles(system, config, options) → FitRanking[]`
- Ranks profiles by: hardware fit + use case + mode preference (local-first vs cloud-first)
- `alix models fit`, `alix models fit --role coder`, `alix models fit --mode cloud-first`
- Output: ranked list with reason and suggestion
- Tests: ranking order, role weighting, mode filtering

### M0.69e — Profile Apply/Install/List/Show UX

- `model-install.ts`: `applyProfile(profileId)`, `installProfile(profileId)`, `listProfiles()`, `showProfile(id)`
- `applyProfile`: write bounded config patch via `deepMerge(existingConfig, profilePatch)` pipeline, preserve unrelated sections
- `installProfile`: 
  - `minimal-local` / `balanced-local` / `power-local`: pulls required Ollama models, then applies profile
  - `cloud-balanced`: pulls optional local embedding/fallback models if configured, then applies profile
  - `all-cloud`: performs provider/API-key checks only, then applies profile
- `--dry-run` flag on both `apply-profile` and `install-profile`: shows what would be written and what is preserved without mutating config
- `--json` flag on `doctor`, `fit`, `show-profile`: machine-readable output for TUI/Inspector
- Commands: `alix models apply-profile <id> [--dry-run]`, `alix models install-profile <id> [--dry-run]`, `alix models list-profiles`, `alix models show-profile <id> [--json]`
- Tests: config file round-trip, ollama pull simulation, override preservation, dry-run output

### M0.69f — Docs + Demo Path

- User-facing happy path documented in `docs/user-manual.md`:
  ```
  alix models doctor
  alix models fit
  alix models apply-profile balanced-local --dry-run
  alix models install-profile balanced-local
  alix config get modelProfile
  ```
- README update with profile concept summary
- `alix demo local` compatibility check against active profile

## Risks

1. **Node.js GPU detection**: nvidia-smi parsing is fragile across platforms. Use Node.js `child_process.execFile` with timeout; fall back gracefully to "unknown."
2. **Ollama pull in install**: Long-running op. Run as subprocess with progress output; timeout after 5 min per model.
3. **Config overwrite**: The bounded patch approach must use `readConfig → deepMerge(existingConfig, profilePatch) → applyModelOverrides → writeConfig` — reverse the order and you clobber unrelated sections. Test explicitly that policy/etc. sections survive.
4. **Profile drift**: If a user manually edits config after apply-profile, `doctor` must detect and report the delta.

## Command outputs

### `alix models doctor`

```
ALiX Model Doctor

Hardware
  OS: Linux x64
  RAM: 31.2 GB
  GPU: NVIDIA RTX 3060
  VRAM: 12 GB

Local Runtime
  Ollama: running
  Installed models:
    qwen3:4b
    qwen2.5-coder:7b

API Providers
  Anthropic: configured
  OpenAI: missing key
  Google: configured

Profile Compatibility
  minimal-local     ✅ compatible
  balanced-local    ✅ compatible
  power-local       ⚠️ partial: coder model may exceed VRAM
  cloud-balanced    ✅ compatible
  all-cloud         ✅ compatible: API keys configured, no local runtime required

Issues
  - power-local coder tier recommends devstral:24b, but detected VRAM is below recommended threshold.
  - OpenAI provider configured in schema but OPENAI_API_KEY is missing.

Next
  Run: alix models fit
```

### `alix models fit`

```
Recommended Profiles

1. balanced-local  ✅ best fit
   Why:
   - Fits available RAM
   - Uses local models for default/planner/coder
   - Keeps cloud fallback for research
   - Good latency/quality balance

2. cloud-balanced  ✅ compatible
   Why:
   - Best quality
   - Requires API keys
   - Higher cost

3. minimal-local   ✅ compatible
   Why:
   - Safest local-only option
   - Lower code quality

4. power-local     ⚠️ not recommended
   Why:
   - Coder tier likely too large for this machine

Suggested command:
  alix models install-profile balanced-local
```

## Out of scope for M0.69

- User-defined custom profiles (`~/.alix/profiles/*.json`) — deferred to M0.72
- Live benchmark speed tests — deferred to M0.70/M0.71
- Profile auto-switching based on battery/task — deferred
- UI for profile management in the TUI — deferred
