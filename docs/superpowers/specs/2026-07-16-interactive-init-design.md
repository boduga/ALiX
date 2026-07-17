# `alix init` Interactive Provider & Model Selection — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorming complete)
**Author:** Design session
**Related:** commit `e5834581` (detectProvider user-config fallback)

---

## 1. Problem

`alix init` currently auto-detects a provider+model non-interactively. When the user's `~/.config/alix/config.json` lists multiple providers (e.g. openai + deepseek), `init` silently picks the first one in the hardcoded `PROVIDERS` order — there's no way for the user to choose. The init also currently has no flag handling, so `--help` is silently ignored.

Goal: let users pick interactively at init time, while preserving all existing non-interactive behavior.

---

## 2. Behavior Matrix

| Environment | Provider choice | Model choice |
|---|---|---|
| **TTY + no flags** | Prompt over providers with keys + running ollama | Prompt over live `listModels()` |
| **TTY + `--provider X`** | Skip prompt; use `X` | Prompt over live `listModels('X', key)` |
| **TTY + `--provider X --model Y`** | Skip; use `X` | Skip; validate `Y` against live list |
| **Non-TTY (CI/script/piped)** | `detectProvider()` (current behavior from `e5834581`) | `getDefaultModel(provider)` |
| **`--help`** | Print help, exit 0 | — |

**Invariant:** any pipeline that worked before this change keeps working unchanged.

---

## 3. Architecture

### 3.1 New file: `src/cli/helpers/interactive.ts`

Extracted from `src/cli.ts:839-908` (`set-default-model` block). Pure helpers, no side effects on module load.

```ts
import { readline/promises, ... } from "node:...";
import { PROVIDERS, listModels, getDefaultModel, ... } from "../../providers/catalog.js";
import { getSavedApiKey } from "./api-keys.js";   // see 3.2

export interface ProviderInfo { id: string; name: string; env: string; hint: string; }

/** Filter PROVIDERS to those with an env-var key, user-config key, or (for ollama) a running local server. */
export async function resolveProvidersWithKeys(): Promise<ProviderInfo[]>

/** Probe http://localhost:11434/api/tags. Returns true if Ollama responds. */
export async function ollamaReachable(): Promise<boolean>

/** Resolve API key: process.env first, then ~/.config/alix/config.json. Returns "" for ollama. */
export async function getApiKey(providerId: string): Promise<string>

/** Display a numbered list of providers, prompt for selection. Returns provider id. */
export async function selectProviderInteractive(providers: ProviderInfo[]): Promise<string>

/** Display a numbered list of models from listModels(providerId, apiKey), prompt for selection.
 *  Falls back to getDefaultModel(providerId) on network failure (warns once). */
export async function selectModelInteractive(providerId: string, apiKey: string): Promise<{ id: string; displayName: string }>

/** Save provider+model to project config (in git repo) or user config (elsewhere). */
export async function saveModelConfig(providerId: string, modelId: string, cwd: string): Promise<void>
```

### 3.2 New file: `src/cli/helpers/api-keys.ts`

Extracts `getSavedApiKey` and `setApiKey` from `src/cli.ts:18-48`. Lets `init` and `set-default-model` share them without duplicating the user-config path logic.

### 3.3 Modified: `src/cli/commands/init.ts`

```ts
export async function runInit(cwd: string, deps?: InitDependencies): Promise<void> {
  // ... existing git init, AGENTS.md, .gitignore (unchanged) ...

  const args = parseInitArgs(process.argv.slice(3));   // new ~15 lines
  const mode = isInteractive() && !args.provider && !args.model
    ? (args.provider ? "flagged" : "interactive")
    : "auto";

  let providerId: string;
  let modelId: string;

  if (mode === "interactive") {
    const candidates = await resolveProvidersWithKeys();
    if (candidates.length === 0) {
      // No keys + ollama down: fall back to auto-detect (preserves current init behavior).
      const detected = detectProvider();
      providerId = detected.provider;
      modelId = detected.model || getDefaultModel(providerId) || "";
    } else {
      const selectedProvider = await selectProviderInteractive(candidates);
      const apiKey = await getApiKey(selectedProvider);
      const model = await selectModelInteractive(selectedProvider, apiKey);
      providerId = selectedProvider;
      modelId = model.id;
    }
  } else if (mode === "flagged") {
    providerId = args.provider!;
    if (!PROVIDERS.find(p => p.id === providerId)) {
      console.error(`Unknown provider: ${providerId}. Run \`alix models list\` for available providers.`);
      process.exit(1);
    }
    const apiKey = await getApiKey(providerId);
    if (args.model) {
      // Validate --model against live list (catches typos).
      const available = await listModelsOrDefault(providerId, apiKey);
      if (!available.find(m => m.id === args.model)) {
        console.error(`Model ${args.model} not available for ${providerId}. Available: ${available.map(m => m.id).join(", ")}`);
        process.exit(1);
      }
      modelId = args.model;
    } else {
      const model = await selectModelInteractive(providerId, apiKey);
      modelId = model.id;
    }
  } else {
    // mode === "auto" (non-TTY)
    const detected = detectProvider();
    providerId = detected.provider;
    modelId = detected.model || getDefaultModel(providerId) || "";
  }

  // Write .alix/config.json with selected provider/model (preserves existing behavior).
  await writeInitConfig(cwd, providerId, modelId);
}
```

`parseInitArgs` extracts `--provider X` and `--model Y` from argv, errors on unknown flags.

### 3.4 Modified: `src/cli.ts:839-908` (`set-default-model`)

Refactored to use the new helpers. Behavior preserved: still shows all PROVIDERS (no key filtering — unchanged surface).

```ts
if (command === "config" && args[0] === "set-default-model") {
  const providerId = await selectProviderInteractive(PROVIDERS);   // full list
  const apiKey = await getApiKey(providerId);
  if (!apiKey) {
    const key = await prompt(`Enter API key (${PROVIDERS.find(p => p.id === providerId)!.hint}): `);
    if (!key) { console.log("Cancelled."); process.exit(0); }
    await setApiKey(providerId, key);
  }
  const model = await selectModelInteractive(providerId, await getApiKey(providerId));
  await saveModelConfig(providerId, model.id, process.cwd());
  console.log(`\nDefault model set to "${model.id}".`);
  process.exit(0);
}
```

---

## 4. Error Handling

| Failure | Action |
|---|---|
| Not a TTY | Auto-detect path |
| `--provider X` not in PROVIDERS | Exit 1: `Unknown provider: X. Run \`alix models list\` for available providers.` |
| `--model Y` not in live list | Exit 1: `Model Y not available for provider X. Available: ...` |
| `listModels()` network/auth error | Log `[WARN] Could not fetch live model list: <error>. Falling back to defaults.`, use DEFAULT_MODELS |
| Ollama not reachable | Skip from interactive list (don't show) |
| User Ctrl+C | Catch SIGINT, print `Init cancelled.`, exit 130 |
| Empty readline input | Re-prompt with `Invalid choice. Try again.` |
| Invalid number | Re-prompt |
| Existing `.alix/config.json` | Overwrites (matches today's behavior) |
| Zero candidates AND no auto-detect match | Same as today's init: write ollama + empty model |

---

## 5. Testing

### 5.1 Pure unit tests: `tests/cli/init-args.vitest.ts`

No API calls, no filesystem writes outside temp dirs.

- `parseInitArgs()` — flag extraction, rejects unknown flags, handles missing values
- `resolveProvidersWithKeys()` — mocked env + mocked `getSavedApiKey` + mocked `ollamaReachable`; verify filter and order
- `ollamaReachable()` — mocked fetch response; success/timeout/refused
- `getApiKey()` — env wins over user config; returns `""` for ollama
- `selectProviderInteractive()` — mocked readline.question; valid input, invalid input, empty input, cancellation
- `selectModelInteractive()` — mocked listModels (success path), mocked listModels-failing (fallback path with default models)
- `saveModelConfig()` — writes to project config when `.git` exists, user config otherwise; preserves other fields

### 5.2 Live integration tests: `tests/cli/init-live.vitest.ts`

**Per-provider describe blocks**, each gated on that provider's env var:

```ts
const SKIP_IF_NO_KEY = !process.env.OPENAI_API_KEY;
describe.skipIf(SKIP_IF_NO_KEY)("init live: openai", () => {
  it("listModels returns non-empty array", async () => {
    const models = await listModels("openai", process.env.OPENAI_API_KEY!);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty("id");
  });

  it("selectModelInteractive returns a valid model id", async () => {
    // Mock readline.question to return "1"
    // Verify the returned model id is from the actual listModels output
  });
});

// Same pattern for anthropic, google, openrouter, groq, ollama, perplexity, minimax, zhipuai, grokai, deepseek
```

### 5.3 Regression: `tests/cli/init.test.ts` (existing)

Unchanged. Continues to cover auto-detect, .gitignore, AGENTS.md, etc.

### 5.4 Trade-offs

- **Slow:** ~1–3s per live test × 11 providers = ~30s added to `pnpm test:vitest`
- **Cost:** real API usage per CI run (each call is one GET, fractions of a cent)
- **Flaky:** rate-limited / transient failures. Mitigation: vitest `{ retry: 1 }` on live tests; `listModels` already has 15s timeout.
- **CI:** keys must be set as repo secrets. Without them, ~10/11 suites skip silently via `describe.skipIf`.

### 5.5 CI workflow

New job in `.github/workflows/test.yml`:

```yaml
test-live:
  runs-on: ubuntu-latest
  needs: test-vitest
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    # ... etc for each provider secret
  steps:
    - run: pnpm test:vitest tests/cli/init-live.vitest.ts
```

Job passes when all enabled suites pass; absent secrets cause skips (not failures).

---

## 6. Out of Scope

- llama.cpp integration (user has it; existing `ALIX_LLAMA_MODEL_PATH` env var continues to be the path forward; can be a follow-up design)
- Fuzzy search / arrow-key navigation in the prompt (numbered list only; can iterate later)
- Saving model preferences per subagent tier (existing `subagents.critic` auto-fill from `loader.ts:181-189` remains the path)
- Migration of existing init users (current behavior preserved when no TTY / no flags)

---

## 7. Success Criteria

1. `alix init` in a TTY with two configured providers prompts the user to choose.
2. `alix init --help` prints help and exits 0 (currently broken — silently runs init).
3. `alix init --provider X --model Y` works in any environment (TTY or not), validates `Y` against live list.
4. `alix init` in CI / piped input produces the same config as today (no behavior change).
5. `alix config set-default-model` behavior unchanged (regression-tested by existing tests).
6. All 11 providers' `listModels` calls verified by live tests in CI.
7. Per-provider live test suites skip cleanly when their secret is absent.

---

## 8. Implementation Plan (post-brainstorming)

To be written via `superpowers:writing-plans` skill after spec approval.