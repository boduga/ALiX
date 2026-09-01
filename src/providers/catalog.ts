import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Provider catalog - shared definitions for provider selection and model listing.
 * Consolidated from src/cli.ts to avoid duplication.
 */

export interface ProviderInfo {
  id: string;
  name: string;
  env: string;
  hint: string;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY", hint: "sk-ant-..." },
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", hint: "sk-..." },
  { id: "google", name: "Google Gemini", env: "GEMINI_API_KEY", hint: "AIza..." },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY", hint: "sk-or-..." },
  { id: "groq", name: "Groq", env: "GROQ_API_KEY", hint: "gsk_..." },
  { id: "ollama", name: "Ollama", env: "OLLAMA_API_KEY", hint: "(local, may be empty)" },
  { id: "local-llama", name: "Local Llama.cpp", env: "ALIX_LLAMA_BASE_URL", hint: "(local, no API key)" },
  { id: "perplexity", name: "Perplexity", env: "PERPLEXITY_API_KEY", hint: "pplx-..." },
  { id: "minimax", name: "MiniMax", env: "MINIMAX_API_KEY", hint: "..." },
  { id: "minimax-token-plan", name: "MiniMax (Token Plan)", env: "MINIMAX_TOKEN_PLAN_KEY", hint: "sk-cp-..." },
  { id: "zhipuai", name: "ZhipuAI", env: "ZHIPUAI_API_KEY", hint: "..." },
  { id: "grokai", name: "GrokAI", env: "GROKAI_API_KEY", hint: "..." },
  { id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY", hint: "sk-..." }
];

export async function listModels(providerId: string, apiKey: string): Promise<ModelInfo[]> {
  switch (providerId) {
    case "anthropic": {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name: string; max_input_tokens?: number; max_tokens?: number }> };
      return data.data.map((m) => ({
        id: m.id,
        displayName: m.display_name ?? m.id,
        maxInputTokens: m.max_input_tokens,
        maxOutputTokens: m.max_tokens,
      }));
    }
    case "openai": {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "google": {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { models: Array<{ name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number }> };
      return data.models.map((m) => ({
        id: m.name.replace("models/", ""),
        displayName: m.displayName ?? m.name,
        maxInputTokens: m.inputTokenLimit,
        maxOutputTokens: m.outputTokenLimit,
      }));
    }
    case "openrouter": {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/alix-cli/alix",
          "X-Title": "ALiX",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.name ?? m.id }));
    }
    case "groq": {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "ollama": {
      const base = "http://localhost:11434";
      const response = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { models: Array<{ name: string }> };
      return data.models.map((m) => ({ id: m.name, displayName: m.name }));
    }
    case "local-llama": {
      return listLocalLlamaGgufModels(resolveLocalLlamaScanDir(readUserConfigLocalModelPath()));
    }
    case "deepseek": {
      const response = await fetch("https://api.deepseek.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.id }));
    }
    case "perplexity": {
      const response = await fetch("https://api.perplexity.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "minimax": {
      const response = await fetch("https://api.minimax.chat/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "minimax-token-plan": {
      const response = await fetch("https://api.minimax.io/anthropic/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string; max_input_tokens?: number; max_tokens?: number }> };
      return data.data.map((m) => ({
        id: m.id,
        displayName: m.display_name ?? m.id,
        maxInputTokens: m.max_input_tokens,
        maxOutputTokens: m.max_tokens,
      }));
    }
    case "zhipuai": {
      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    case "grokai": {
      const response = await fetch("https://api.grokai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

/**
 * Launcher context-size default — the reference the size-scaled context cap is
 * computed from (must stay in sync with the launcher's `KNOB_DEFAULTS.ctxSize`).
 */
const LOCAL_LLAMA_CTX_DEFAULT = 4096;

/** Mid-size reference file (bytes) that maps to the full default ctx. */
const LOCAL_LLAMA_REFERENCE_BYTES = 2 * 1024 ** 3; // 2 GiB

const LOCAL_LLAMA_MODEL_DIR_DEFAULT = join(homedir(), "llama.cpp", "models");

/**
 * Resolve the local-llama scan directory (spec decision 2): config
 * `localModelPath` > `ALIX_LLAMA_MODEL_PATH` env > `~/llama.cpp/models`.
 *
 * `env` is an injectable seam (defaults to `process.env`) for precedence tests.
 */
export function resolveLocalLlamaScanDir(
  configLocalModelPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return configLocalModelPath
    ?? env.ALIX_LLAMA_MODEL_PATH
    ?? LOCAL_LLAMA_MODEL_DIR_DEFAULT;
}

/**
 * Size-scaled context cap for a GGUF model (spec decision 2): a larger file
 * maps to a smaller safe `maxInputTokens`, so `minContext` selection can route
 * to it. Deterministic, no GGUF parser — a 2 GiB file maps to the full launcher
 * ctx default; every doubling past that halves the cap (floored at 1024).
 */
export function localLlamaMaxInputTokens(sizeBytes: number): number {
  const ratio = LOCAL_LLAMA_REFERENCE_BYTES / Math.max(sizeBytes, 1);
  const cap = Math.round(LOCAL_LLAMA_CTX_DEFAULT * ratio);
  return Math.min(LOCAL_LLAMA_CTX_DEFAULT, Math.max(cap, 1024));
}

/**
 * Scan a directory for direct-child `*.gguf` models (spec decision 2): no
 * recursion, no symlink follow, non-`.gguf` ignored. Missing/empty directory
 * returns `[]` — `getAvailableModels` then falls back to the local-llama
 * `DEFAULT_MODELS` entry. `id` is the full filename (becomes the selection id),
 * `displayName` the file stem.
 */
export function listLocalLlamaGgufModels(
  scanDir: string,
  fsSeam: {
    readdir: (dir: string) => Array<{ name: string; isFile: () => boolean; isSymbolicLink: () => boolean }>;
    stat: (path: string) => { size: number };
  } = {
    readdir: (dir) => readdirSync(dir, { withFileTypes: true }),
    stat: (path) => statSync(path),
  },
): ModelInfo[] {
  let entries;
  try {
    entries = fsSeam.readdir(scanDir);
  } catch {
    return [];
  }

  const models: ModelInfo[] = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue; // no dirs, no symlinks
    if (!ent.name.toLowerCase().endsWith(".gguf")) continue;
    let size = 0;
    try {
      size = fsSeam.stat(join(scanDir, ent.name)).size;
    } catch {
      continue; // unstatable entry → skip, don't fail the scan
    }
    models.push({
      id: ent.name,
      displayName: ent.name.replace(/\.gguf$/i, ""),
      maxInputTokens: localLlamaMaxInputTokens(size),
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Default models per provider (for `alix init` command).
 * Chosen for broad capability coverage at each provider's best price/performance tier.
 */
const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  openrouter: "openrouter/auto",
  groq: "llama-3.3-70b-versatile",
  ollama: "qwen2.5-coder:7b",
  "local-llama": "phi-3-mini-4k-instruct-q4_K_M.gguf",
  perplexity: "sonar-pro",
  minimax: "minimax-text-01",
  "minimax-token-plan": "MiniMax-M3",
  zhipuai: "glm-4-flash",
  grokai: "grok-2-latest",
  deepseek: "deepseek-chat",
};

/**
 * Get default model for a provider (for init command).
 */
export function getDefaultModel(providerId: string): string | undefined {
  return DEFAULT_MODELS[providerId];
}

// Test seam — override the user-config path without touching real filesystem.
let userConfigPathOverride: string | undefined;

/** Test seam: override path to user config (~/.config/alix/config.json). */
export function _setUserConfigPathOverride(path: string | undefined): void {
  userConfigPathOverride = path;
}

function resolveUserConfigPath(): string {
  return userConfigPathOverride ?? join(homedir(), ".config", "alix", "config.json");
}

/**
 * Read the `apiKeys` map from the user config (~/.config/alix/config.json).
 * Returns {} if the file is missing, unreadable, or malformed JSON.
 * Never throws; never returns the actual key values to logs.
 */
export function loadUserConfigApiKeys(): Record<string, string> {
  try {
    const path = resolveUserConfigPath();
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { apiKeys?: Record<string, string> };
    const keys = parsed.apiKeys ?? {};
    // Defensive: only keep string entries with non-empty values.
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(keys)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read the default model's `localModelPath` from the user config
 * (~/.config/alix/config.json → `models.default.localModelPath`).
 * Returns undefined if missing, unreadable, or not a string.
 * Never throws.
 */
export function readUserConfigLocalModelPath(): string | undefined {
  try {
    const path = resolveUserConfigPath();
    if (!existsSync(path)) return undefined;
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as {
      models?: { default?: { localModelPath?: string } };
    };
    const lp = parsed.models?.default?.localModelPath;
    return typeof lp === "string" && lp.length > 0 ? lp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect provider from available environment variables, falling back to
 * the user config's `apiKeys` (in PROVIDERS order), then to ollama.
 *
 * Precedence (highest first):
 *   1. Env vars — `process.env[<PROVIDER.env>]`
 *   2. User config — `~/.config/alix/config.json` → `apiKeys[<provider>]`
 *   3. Ollama — always available (may have empty model name)
 */
export function detectProvider(): { provider: string; model: string } {
  // 1. Env vars — always win.
  for (const p of PROVIDERS) {
    if (process.env[p.env]) {
      return { provider: p.id, model: getDefaultModel(p.id) ?? "" };
    }
  }

  // 2. User config apiKeys — first provider with a non-empty key, in PROVIDERS order.
  const apiKeys = loadUserConfigApiKeys();
  for (const p of PROVIDERS) {
    if (apiKeys[p.id]) {
      return { provider: p.id, model: getDefaultModel(p.id) ?? "" };
    }
  }

  // 3. Final fallback: ollama with empty model name.
  return { provider: "ollama", model: "" };
}

/**
 * Query Ollama for locally installed models.
 * Returns array of model names (e.g. ["qwen3:4b", "qwen2.5-coder:7b"]),
 * or empty array if Ollama is not installed, not running, or has no models.
 */
export function getInstalledOllamaModels(): string[] {
  try {
    const list = execFileSync("ollama", ["list"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return list
      .split("\n")
      .slice(1) // skip header
      .map(l => l.split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}