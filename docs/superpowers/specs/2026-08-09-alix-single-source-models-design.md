# ALiX Single-Source Model Configuration

**Status:** Approved (2026-08-09)
**Scope:** Make `models` the single persistent source of model assignments; `model` and `subagents.*` become derived compatibility projections; collapse all model writers into the `alix models` family; remove the legacy `config set-default-model` / `config set-tier` commands.

## Context

The active model is currently spread across five overlapping mechanisms:

| Field | Role today | Problem |
|---|---|---|
| `model` (flat) | active model; ~40 runtime readers | a second source that can drift from `models` |
| `models.<tier>` | per-tier map (profile output) | **never read** for the main model; half-wired |
| `modelProfile` | profile pointer | display-only; no runtime effect |
| `subagents.<tier>` | per-tier runtime models | written independently by `set-tier`, can disagree with `models` |
| `apiKeys` | credentials | conflated with model selection by users |

Every runtime consumer reads `config.model.provider` / `config.model.name` (~40 sites across `agent.ts`, `session.ts`, `task-loop.ts`, `daemon-server.ts`, `route-executor.ts`, `cli/commands/*`). Nothing reads `models.default` for the main model. `config.models` is read only in `hardware-detect.ts` and `provider-doctor.ts`. `modelProfile` is read only in `cli/commands/models.ts`.

This caused a real incident: config had `apiKeys["minimax-token-plan"]` and the user expected MiniMax to be active, but the active model was `deepseek-chat` from the flat `model` field. The ambiguity is structural — five fields, two independent writers.

## Architecture

### One store

`models` is the **only** persisted model store:

```jsonc
{
  "modelProfile": "cloud-ai",        // metadata: which preset was applied
  "models": {
    "default":  { "provider": "deepseek", "name": "deepseek-chat" },
    "thinking": { "provider": "...", "name": "..." },
    "coding":   { ... }, "fast": {...}, "critic": {...}, "tiny": {...}, "image": {...}
  }
}
```

`modelProfile` is a pointer to the applied preset — metadata, not a store. `apiKeys` remains a separate, orthogonal section (credentials are not model selection).

### Loader boundary: in-memory normalization

`loadConfig()` becomes a normalization boundary, not a migration command. It never mutates the source object or rewrites `config.json` on load:

```
disk config
    │
    ▼
loadConfig()
    ├── legacy model        → normalized in-memory models.default
    ├── models              → derived in-memory model
    └── models.*            → derived in-memory subagents.*
    │
    ▼
normalized AlixConfig
```

Resolution precedence (one-way):
1. `models.default` exists → authoritative
2. absent + legacy `model` exists → normalize `model` → `models.default` (in-memory value, file untouched)
3. neither → existing `"No model configured"` throw (`loader.ts:205`)
4. both exist → `models.default` wins

`model` and `subagents.*` are **derived compatibility projections**, built from `models` at the boundary so every existing runtime reader keeps working. `model := models.default`; `subagents[tier] := models.<tier> ?? models.default` (preserves today's fallback at `loader.ts:213-223`).

### Explicit resolver

New `src/config/model-resolver.ts`:

```ts
resolveModelConfig(config)            // → models.default
resolveModelConfig(config, "coding")  // → models.coding ?? models.default
resolveModelConfig(config, "thinking")// → models.thinking ?? models.default
```

New code and progressively the drift sites (`session.ts:1180-1224`, `task-loop.ts:811-823`, `agent.ts:113-120`, `subagent-cli.ts:104-116`) migrate to it. Existing readers of the derived `config.model` keep working — the resolver is the target, not a forced rewrite.

### One writer boundary: `alix models` family

The only writers of model assignments:

```
alix models set-default <provider> <model>
alix models set-tier <tier> <provider> <model>
alix models apply-profile <profile>      (unchanged)
alix models install-profile <profile>    (unchanged)
```

- `set-default` writes `models.default` (and derives `model`). Reuses the existing interactive provider+model selection from `src/cli/helpers/provider-selection.ts` (mirrors today's `set-default-model` UX).
- `set-tier` writes `models.<tier>` (and derives `subagents.<tier>`). Takes positional args `<tier> <provider> <model>` (mirrors today's `set-tier` UX at `cli.ts:735`), validating the tier name against the canonical 6.
- `apply-profile` / `install-profile` are updated so profile application writes **only** `modelProfile` + `models` — **not** `model` / `subagents`. The loader derives those.

### Legacy commands removed

`alix config set-default-model` and `alix config set-tier` are **removed entirely** — no aliases, no deprecation period. Migration applies to data, not commands. Existing `config.json` files still get in-memory normalization; the old CLI surface is gone.

## Invariant

> **No configuration writer may persist `model.*` or `subagents.<tier>` as an independent model assignment. All persisted model assignments MUST originate under `models`.**

This is the load-bearing rule of the design. It prevents the five-way drift from recurring.

## Critical files

| File | Change |
|---|---|
| `src/config/loader.ts` | normalize `model` → `models.default`; derive `model`/`subagents` from `models`; fill subagent fallback from `models` |
| `src/config/model-resolver.ts` | NEW — `resolveModelConfig(config, tier?)` |
| `src/config/profile-patch.ts` | write `modelProfile` + `models` only; drop `model` / `subagents` writes (loader derives them) |
| `src/models/model-install.ts` | unchanged read/apply; inherits new patch shape |
| `src/cli/commands/models.ts` | add `set-default`, `set-tier` handlers |
| `src/cli.ts` | remove `config set-default-model` (680-733) and `config set-tier` (735-789) |
| `src/cli/helpers/provider-selection.ts` | `set-default` reuses the existing interactive provider+model selection |
| `src/config/schema.ts` | `models` typed as canonical (already present); document precedence in the type |

## Data flow

```
alix models set-default ...        alix models set-tier ...        apply-profile
        │                                 │                            │
        ▼                                 ▼                            ▼
   models.default                  models.<tier>              modelProfile + models
        │                                 │                            │
        └─────────────────────────────────┴────────────────────────────┘
                                        ▼
                                    models
                                        │
                                        ▼
                                  load/normalize
                                        │
                             ┌──────────┴──────────┐
                             ▼                     ▼
                          model               subagents.*
                        (derived)              (derived)
```

## Error handling

- No `models` and no legacy `model` → existing `"No model configured"` throw; error message points to `alix models set-default` (updated from `set-default-model`).
- Unknown tier to `set-tier` → usage error (same validation as today's tier list).

## Testing

- **Migration:** flat `model` → `models.default` normalized in-memory; file untouched on load; `models.default` wins over flat `model` when both present; neither → throw.
- **Resolver:** `resolveModelConfig(config)` / `(config, tier)` with and without fallback.
- **Writers:** `set-default` writes `models.default` and derives `model`; `set-tier` writes `models.<tier>` and derives `subagents.<tier>`.
- **Profile patch:** `applyProfilePatch` writes only `modelProfile` + `models`, no `model`/`subagents` in the output.
- **Command removal:** assert `alix config set-default-model` and `alix config set-tier` **fail as unknown commands** (not merely undocumented) — prevents a stale registration from resurrecting them.
- **Existing tests** in `tests/config-loader.test.ts`, `tests/config/profile-patch.test.ts`, `tests/models/model-install.test.ts` pin the derived views and must keep passing unchanged (since `model`/`subagents` are still populated post-derivation).
