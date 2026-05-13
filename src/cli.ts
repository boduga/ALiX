#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import { ALIX_VERSION } from "./index.js";
import { runTask } from "./run.js";
import { startServer } from "./server/server.js";

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY", hint: "sk-ant-..." },
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", hint: "sk-..." },
  { id: "google", name: "Google Gemini", env: "GEMINI_API_KEY", hint: "AIza..." },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY", hint: "sk-or-..." },
  { id: "groq", name: "Groq", env: "GROQ_API_KEY", hint: "gsk_..." },
  { id: "ollama", name: "Ollama", env: "OLLAMA_API_KEY", hint: "(local, may be empty)" },
  { id: "perplexity", name: "Perplexity", env: "PERPLEXITY_API_KEY", hint: "pplx-..." },
  { id: "minimax", name: "MiniMax", env: "MINIMAX_API_KEY", hint: "..." },
  { id: "zhipuai", name: "ZhipuAI", env: "ZHIPUAI_API_KEY", hint: "..." },
  { id: "grokai", name: "GrokAI", env: "GROKAI_API_KEY", hint: "..." },
  { id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY", hint: "sk-..." }
];

async function prompt(question: string): Promise<string> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function setApiKey(providerId: string, key: string): Promise<void> {
  // Try user config first (~/.config/alix/config.json)
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");

  try {
    await mkdir(userConfigDir, { recursive: true });
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(userConfigPath, "utf8"));
    } catch {
      // no existing config
    }
    const updated = { ...existing, apiKeys: { ...((existing as any).apiKeys ?? {}), [providerId]: key } };
    await writeFile(userConfigPath, JSON.stringify(updated, null, 2) + "\n");
    console.log(`Saved to ${userConfigPath}`);
  } catch (err) {
    console.error("Failed to write config:", err);
    process.exit(1);
  }
}

async function selectProvider(): Promise<string> {
  console.log("Select a provider to configure:\n");
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i];
    console.log(`  ${i + 1}. ${p.name} (${p.env})`);
  }
  console.log(`  0. Cancel\n`);

  const answer = await prompt("Enter number: ");
  const num = parseInt(answer, 10);

  if (num === 0 || isNaN(num) || num > PROVIDERS.length) {
    console.log("Cancelled.");
    process.exit(0);
  }

  return PROVIDERS[num - 1].id;
}

interface ModelInfo {
  id: string;
  displayName: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

async function listModels(providerId: string, apiKey: string): Promise<ModelInfo[]> {
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
      // Ollama serves a local model list at /api/tags
      const base = "http://localhost:11434";
      const response = await fetch(`${base}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { models: Array<{ name: string }> };
      return data.models.map((m) => ({ id: m.name, displayName: m.name }));
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
    default:
      throw new Error(`Model listing not yet implemented for ${providerId}`);
  }
}

const [, , command, ...args] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>"
  alix serve
  alix config show
  alix config set-key     Interactive API key setup for 11 providers
  alix config set-default-model  Interactive model selection (fetches from provider API)
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(ALIX_VERSION);
  process.exit(0);
}

if (command === "config" && args[0] === "set-key") {
  const providerId = await selectProvider();
  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  console.log(`\nSetting API key for ${provider.name} (${provider.env})`);
  const key = await prompt(`API key (${provider.hint}): `);
  if (!key) {
    console.log("No key entered. Cancelled.");
    process.exit(0);
  }
  await setApiKey(providerId, key);
  // Inject into current process so the key works immediately
  process.env[provider.env] = key;
  console.log(`\nDone! ${provider.name} API key saved and loaded.`);
  process.exit(0);
}

if (command === "config" && args[0] === "set-default-model") {
  const providerId = await selectProvider();
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  let apiKey = process.env[provider.env];
  if (!apiKey) {
    console.log(`\nNo API key found for ${provider.name} in ${provider.env}.`);
    const key = await prompt(`Enter API key (${provider.hint}): `);
    if (!key) { console.log("Cancelled."); process.exit(0); }
    await setApiKey(providerId, key);
    apiKey = key;
    process.env[provider.env] = key;
  }

  console.log(`\nFetching available models for ${provider.name}...\n`);
  let models: ModelInfo[];
  try {
    models = await listModels(providerId, apiKey);
  } catch (err) {
    console.error(`Failed to fetch models: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (models.length === 0) {
    console.log("No models found.");
    process.exit(1);
  }

  // Show up to 20 models with token limits if available
  const shown = models.slice(0, 20);
  for (let i = 0; i < shown.length; i++) {
    const m = shown[i];
    const tokens = m.maxInputTokens
      ? ` (in: ${(m.maxInputTokens / 1000).toFixed(0)}k)`
      : "";
    console.log(`  ${i + 1}. ${m.displayName}${tokens}`);
  }
  if (models.length > 20) console.log(`  ... and ${models.length - 20} more`);

  const answer = await prompt(`\nSelect model (1-${shown.length}, 0 to cancel): `);
  const num = parseInt(answer, 10);
  if (num === 0 || isNaN(num) || num > shown.length) {
    console.log("Cancelled.");
    process.exit(0);
  }

  const selected = shown[num - 1];

  // Save to user config: update model.provider + model.name
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");
  await mkdir(userConfigDir, { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(userConfigPath, "utf8"));
  } catch { /* no config yet */ }

  const updated = {
    ...existing,
    model: { ...((existing as any).model ?? {}), provider: providerId, name: selected.id },
  };
  await writeFile(userConfigPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(`\nDefault model set to "${selected.id}" for ${provider.name}.`);
  console.log(`Saved to ${userConfigPath}`);
  process.exit(0);
}

if (command === "config" && args[0] === "show") {
  console.log(JSON.stringify(await loadConfig(process.cwd()), null, 2));
  process.exit(0);
}

if (command === "run") {
  const task = args.join(" ").trim();
  if (!task) {
    console.error("Usage: alix run \"<task>\"");
    process.exit(1);
  }
  const result = await runTask(process.cwd(), task);
  console.log(result.summary);
  console.log(`Session: ${result.sessionId}`);
  process.exit(0);
}

if (command === "serve") {
  const config = await loadConfig(process.cwd());
  const server = await startServer(process.cwd(), config.ui.port);
  console.log(`ALiX inspector running at ${server.url}`);
  await new Promise(() => undefined);
}

console.error(`Unknown command: ${command}`);
process.exit(1);