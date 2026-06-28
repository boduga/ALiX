# Zero-Default Model Configuration Design

**Date:** 2026-06-03
**Status:** ✅ Completed (M0.7)
**Principles:**
1. User must always provide model config — no code defaults
2. All hardcoded providers/names → config variables
3. Provider catalog is pulled live via API (already works)
4. Validation comes from the menu system pulling real model names from the API — not code validators

## Motivation

ALiX currently has **24 hardcoded model name strings** across 4 files:

| File | Count | What |
|------|-------|------|
| `src/config/defaults.ts` | 12 | MODEL_TIERS (6) + subagent tiers (6) |
| `src/providers/catalog.ts` | ~11 | DEFAULT_MODELS — fallback per-provider |
| `src/agents/subagent-manager.ts` | 1 | Hardcoded `llama3.2:3b` fallback |

These hardcoded names:
- Become stale when new models are released
- Introduce fake/typo model names (e.g., `gemini-3-pro-image-preview` instead of `gemini-3-pro-image`)
- Silently override user intent ("why is it using gemini when I set deepseek?")

The fix: **remove all model strings from code, make user config the only source of truth.**

## Architecture

### Current State

```
defaults.ts        → 12 hardcoded model names (tiers + subagents)
catalog.ts         → 11 hardcoded default model names (per-provider)
subagent-manager.ts → 1 hardcoded fallback (llama3.2:3b)
validator.ts       → 1 hardcoded provider list
```

### Target State

```
defaults.ts        → Remove MODEL_TIERS. Keep only structural defaults (timeout, port, paths).
catalog.ts         → Remove DEFAULT_MODELS map. Keep only the live API fetchers.
subagent-manager.ts → Replace fallback with inheritance from main model (unreachable state).
validator.ts       → Remove hardcoded VALID_PROVIDERS list.
loader.ts          → If model is missing, throw with clear error.
```

### Inheritance Chain

User sets only `model.provider` and `model.name`:

```
config.model = { provider: "deepseek", name: "deepseek-v4-flash" }
  ↓  (loader fills unset subagent tiers)
config.subagents.thinking = { provider: "deepseek", name: "deepseek-v4-flash" }
config.subagents.coding   = { provider: "deepseek", name: "deepseek-v4-flash" }
config.subagents.fast     = { provider: "deepseek", name: "deepseek-v4-flash" }
config.subagents.critic   = { provider: "deepseek", name: "deepseek-v4-flash" }
config.subagents.tiny     = { provider: "deepseek", name: "deepseek-v4-flash" }
config.subagents.image    = { provider: "deepseek", name: "deepseek-v4-flash" }
```

Each tier can still be individually overridden in config:

```json
{
  "model": { "provider": "deepseek", "name": "deepseek-v4-flash" },
  "subagents": {
    "thinking": { "provider": "anthropic", "name": "claude-opus-4-8" }
  }
}
```

## Data Flow

```
alix run "fix bug"
  ↓
loader.ts → loadConfig()
  ↓
config.model is missing? → throw: "No model configured. Run: alix config set-default-model"
  ↓
For each subagent tier:
  tier is missing? → inherit from config.model
  ↓
Validated config with concrete values everywhere (none hardcoded)
  ↓
runTask runs normally
```

## Files Affected

### Modified

| File | Change |
|------|--------|
| `src/config/defaults.ts` | Remove MODEL_TIERS. Remove subagent model names from DEFAULT_CONFIG. Keep structural defaults. |
| `src/config/loader.ts` | Add load-time validation: throw if model missing. Add inheritance: for each unset tier, copy from config.model. |
| `src/config/validator.ts` | Remove VALID_PROVIDERS hardcoded list. |
| `src/config/schema.ts` | Change `model.provider` union type to `provider: string` (live API is the validator now). |
| `src/providers/catalog.ts` | Remove DEFAULT_MODELS map. |
| `src/agents/subagent-manager.ts` | Replace hardcoded fallback with throw (unreachable after loader fix). |

### Other files that may need test updates

- `tests/config-loader.test.ts` — may test default model values
- `tests/config/validator.test.ts` — may test VALID_PROVIDERS
- `tests/anthropic-provider.test.ts` — may reference hardcoded models
- `tests/provider-types.test.ts` — may reference hardcoded models

## Migration & Error Messages

| Scenario | Message |
|----------|---------|
| No model configured | `"No model configured. Run: alix config set-default-model"` |
| Provider fetched but API returned "" | `"Provider X returned an empty model list. Check connection and API key."` |
| Subagent tier missing (should be unreachable) | `"Subagent tier 'X' is unconfigured. This should not happen — file a bug."` |

## What Stays Unchanged

- `alix config set-default-model` — unchanged (live API menu)
- `alix config show` — unchanged
- All provider classes, MCP, tools, patch, TUI — unchanged
- Provider catalog API fetcher — unchanged

## Success Criteria

- [ ] `defaults.ts` has zero model strings (empty MODEL_TIERS or removed)
- [ ] `catalog.ts` has zero model strings (DEFAULT_MODELS removed)
- [ ] `subagent-manager.ts` has zero model strings (fallback removed)
- [ ] `validator.ts` has no VALID_PROVIDERS
- [ ] `loader.ts` throws if model missing
- [ ] `loader.ts` fills unset subagent tiers from model
- [ ] All existing tests pass (with any needed test updates)
- [ ] `alix run` errors cleanly when no model is configured
- [ ] `alix config set-default-model` then `alix run` works
- [ ] Subagents use main model by default

## Out of Scope

- Adding new CLI commands (existing `config set-default-model` is sufficient)
- Rewriting the provider class system
- Changing how ProviderSpec works
- Any visual/UI changes
