#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "./config/loader.js";
import { ALIX_VERSION } from "./index.js";
import { EXIT_CODES, runTask } from "./run.js";
import { ApiError } from "./providers/base.js";
import { startServer } from "./server/server.js";
import { McpManager } from "./mcp/manager.js";
import { MemoryStore } from "./utils/memory/store.js";
import type { MemoryType } from "./utils/memory/types.js";

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

async function getSavedApiKey(providerId: string): Promise<string | null> {
  const userConfigPath = join(homedir(), ".config", "alix", "config.json");
  try {
    const data = JSON.parse(await readFile(userConfigPath, "utf8")) as Record<string, unknown>;
    const apiKeys = (data as any).apiKeys ?? {};
    if (typeof apiKeys[providerId] === "string" && apiKeys[providerId]) return apiKeys[providerId];
  } catch { /* no config yet */ }
  return null;
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
    case "zhipuai": {
      const response = await fetch("https://open.bigmodel.cn/api/paas/v4/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.name ?? m.id }));
    }
    case "grokai": {
      const response = await fetch("https://api.grok.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = (await response.json()) as { data: Array<{ id: string; display_name?: string }> };
      return data.data.map((m) => ({ id: m.id, displayName: m.display_name ?? m.id }));
    }
    default:
      throw new Error(`Model listing not yet implemented for ${providerId}`);
  }
}

const [, , command, ...args] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>" [--no-stream] [--mode=auto|ask|bypass]
  alix serve
  alix config show
  alix config set-key     Interactive API key setup for 11 providers
  alix config set-default-model  Interactive model selection (fetches from provider API)
  alix mcp list           List connected MCP servers and their tools
  alix mcp add            Add an MCP server (interactive prompts)
  alix mcp remove <name>  Disconnect an MCP server
  alix mcp discover <pkg> Discover an npm MCP package
  alix mcp test <name>    Test an MCP server connection
  alix extension list     List installed extensions
  alix extension install <path>  Install an extension from a directory
  alix extension uninstall <id>   Uninstall an extension (e.g. skill/my-skill)
  alix extension search <query>  Search extensions by name, description, or tag
  alix agent <role> "<prompt>"   Spawn a subagent (explorer|reviewer|test_investigator|docs_researcher|worker)
  alix memory list [--query <text>]  List memory entries
  alix memory add --name <n> --content <c>  Add a memory entry
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

  let apiKey = process.env[provider.env] ?? (await getSavedApiKey(providerId));
  if (!apiKey) {
    console.log(`\nNo API key found for ${provider.name}.`);
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

  // Show up to 50 models with token limits if available
  const MAX_SHOWN = 50;
  const shown = models.slice(0, MAX_SHOWN);
  for (let i = 0; i < shown.length; i++) {
    const m = shown[i];
    const tokens = m.maxInputTokens
      ? ` (in: ${(m.maxInputTokens / 1000).toFixed(0)}k)`
      : "";
    console.log(`  ${i + 1}. ${m.displayName}${tokens}`);
  }
  if (models.length > MAX_SHOWN) console.log(`  ... and ${models.length - MAX_SHOWN} more`);

  const answer = await prompt(`\nSelect model (1-${shown.length}, 0 to cancel): `);
  const num = parseInt(answer, 10);
  if (num === 0 || isNaN(num) || num > shown.length) {
    console.log("Cancelled.");
    process.exit(0);
  }

  const selected = shown[num - 1];

  // Save to project config (.alix/config.json) if inside a git repo,
  // otherwise user config (~/.config/alix/config.json)
  const projectConfigPath = join(process.cwd(), ".alix", "config.json");
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");
  const configPath = existsSync(join(process.cwd(), ".git")) ? projectConfigPath : userConfigPath;
  const isProjectConfig = configPath === projectConfigPath;

  await mkdir(isProjectConfig ? join(process.cwd(), ".alix") : userConfigDir, { recursive: true });
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(configPath, "utf8")); } catch { /* no config yet */ }

  const updated = {
    ...existing,
    model: { provider: providerId, name: selected.id },
  };
  await writeFile(configPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(`\nDefault model set to "${selected.id}" for ${provider.name}.`);
  console.log(`Saved to ${configPath}`);
  process.exit(0);
}

if (command === "config" && args[0] === "show") {
  console.log(JSON.stringify(await loadConfig(process.cwd()), null, 2));
  process.exit(0);
}

if (command === "run") {
  const taskArgs = args.join(" ").trim();
  const noStream = taskArgs.includes("--no-stream");
  const modeMatch = taskArgs.match(/--mode=(\w+)/);
  const mode = modeMatch ? (modeMatch[1] as "auto" | "ask" | "bypass") : undefined;
  const cleanTask = taskArgs.replace(/\s*--no-stream\s*/g, " ").replace(/\s*--mode=\w+\s*/g, " ").trim();
  if (!cleanTask) {
    console.error("Usage: alix run \"<task>\" [--no-stream] [--mode=auto|ask|bypass]");
    process.exit(1);
  }
  try {
    const result = await runTask(process.cwd(), cleanTask, { streaming: noStream ? false : undefined, sessionMode: mode });
    if (!result.streamed) {
      console.log(result.summary);
    }
    console.log(`Session: ${result.sessionId}`);
    if (result.reason === "rejected_scope_expansion") {
      process.exit(EXIT_CODES.REJECTED_SCOPE_EXPANSION);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ApiError) {
      if (msg.includes("credit balance") || msg.includes("upgrade")) {
        console.error(`\n⚠️  API: Insufficient credits.\n    ${err.detail}\n\nFix: Add credits or switch providers:\n     alix config set-default-model openai gpt-4o`);
      } else if (msg.includes("invalid_request_error") || err.status === 401) {
        console.error(`\n⚠️  API: Authentication failed.\n    ${err.detail}\n\nFix: Check your API key.`);
      } else {
        console.error(`\n⚠️  API error (${err.status}):\n    ${err.detail}`);
      }
    } else {
      console.error(`\n⚠️  ${msg}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

if (command === "serve") {
  const config = await loadConfig(process.cwd());
  const server = await startServer(process.cwd(), config.ui.host, config.ui.port);
  console.log(`ALiX inspector running at ${server.url}`);
  await new Promise(() => undefined);
}

if (command === "mcp") {
  const config = await loadConfig(process.cwd());
  const mcpManager = new McpManager(config);
  await mcpManager.initialize();

  try {
    const subcommand = args[0] ?? "";
    switch (subcommand) {
      case "list": {
        const servers = mcpManager.listServers();
        const tools = mcpManager.listTools();
        if (servers.length === 0) {
          console.log("No MCP servers connected.");
          console.log("Add servers in .alix/config.json under 'mcpServers'.");
        } else {
          console.log(`Connected servers: ${servers.length}`);
          for (const server of servers) {
            const serverTools = tools.filter((t) => t.serverName === server);
            console.log(`  ${server}: ${serverTools.length} tools`);
            for (const tool of serverTools) {
              console.log(`    - ${tool.fullName}${tool.description ? ` — ${tool.description}` : ""}`);
            }
          }
        }
        break;
      }
      case "add": {
        if (!args[1]) {
          console.log("Interactive MCP server setup.\n");
        }
        const name = args[1] ?? await prompt("Server name (e.g. fetch): ");
        const type = (args[2] ?? await prompt("Type [stdio|http|websocket] (default: stdio): ")) || "stdio";
        if (!name) { console.error("Cancelled."); process.exit(0); }

        const serverConfig: Record<string, unknown> = { name, type };

        if (type === "stdio") {
          const command = await prompt("Command (e.g. uvx or npx): ");
          const rawArgs = await prompt("Args (e.g. mcp-server-fetch, comma-separated): ");
          const argsList = rawArgs ? rawArgs.split(",").map((s: string) => s.trim()) : [];
          Object.assign(serverConfig, { command, args: argsList });
        } else if (type === "http" || type === "websocket") {
          const url = await prompt("URL (e.g. http://localhost:3000): ");
          Object.assign(serverConfig, { url });
        }

        const apiKey = await prompt("API key (optional, skip if none): ");
        if (apiKey.trim()) {
          const envKey = `${name.toUpperCase().replace(/-/g, "_")}_API_KEY`;
          Object.assign(serverConfig, { env: { [envKey]: apiKey.trim() } });
        }

        console.log(`\nServer config:`);
        console.log(JSON.stringify(serverConfig, null, 2));

        const confirm = await prompt("\nAdd to project config (.alix/config.json)? [y/N]: ");
        if (confirm.toLowerCase() !== "y") { console.log("Cancelled."); process.exit(0); }

        const projectConfigPath = join(process.cwd(), ".alix", "config.json");
        await mkdir(join(process.cwd(), ".alix"), { recursive: true });
        let existing: Record<string, unknown> = {};
        try { existing = JSON.parse(await readFile(projectConfigPath, "utf8")); } catch { /* no config yet */ }

        const servers: unknown[] = existing.mcpServers ? [...(existing.mcpServers as unknown[])] : [];
        servers.push(serverConfig);
        const updated = { ...existing, mcpServers: servers };
        await writeFile(projectConfigPath, JSON.stringify(updated, null, 2) + "\n");
        console.log(`Added '${name}' to .alix/config.json`);
        break;
      }
      case "remove": {
        const name = args[1];
        if (!name) {
          console.error("Usage: alix mcp remove <name>");
          process.exit(1);
        }
        await mcpManager.closeServer(name);
        console.log(`Server '${name}' disconnected.`);
        break;
      }
      case "discover": {
        const packageName = args[1];
        if (!packageName) {
          console.error("Usage: alix mcp discover <npm-package-name>");
          process.exit(1);
        }
        try {
          const info = await mcpManager.discoverServer(packageName);
          console.log(`Server: ${info.name} v${info.version}`);
          console.log(`Tools: ${info.toolCount}`);
          for (const t of info.toolNames) {
            console.log(`  - ${t}`);
          }

          const confirm = await prompt("\nAdd to project config (.alix/config.json)? [y/N]: ");
          if (confirm.toLowerCase() !== "y") {
            console.log("Cancelled.");
            process.exit(0);
          }

          const projectConfigPath = join(process.cwd(), ".alix", "config.json");
          await mkdir(join(process.cwd(), ".alix"), { recursive: true });
          let existing: Record<string, unknown> = {};
          try { existing = JSON.parse(await readFile(projectConfigPath, "utf8")); } catch { /* no config yet */ }

          const servers: unknown[] = existing.mcpServers ? [...(existing.mcpServers as unknown[])] : [];
          servers.push({ name: info.name, type: "stdio", command: "uvx", args: [packageName] });
          const updated = { ...existing, mcpServers: servers };
          await writeFile(projectConfigPath, JSON.stringify(updated, null, 2) + "\n");
          console.log(`Added '${info.name}' to .alix/config.json`);
        } catch (err) {
          console.error(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }
      case "test": {
        const name = args[1];
        if (!name) {
          console.error("Usage: alix mcp test <name>");
          process.exit(1);
        }
        if (!mcpManager.listServers().includes(name)) {
          console.error(`Server '${name}' not found. Run 'alix mcp list' to see connected servers.`);
          process.exit(1);
        }
        const client = mcpManager.getClient(name);
        const tools = mcpManager.listTools().filter((t) => t.serverName === name);
        console.log(`Server: ${name}`);
        if (client?.serverInfo) {
          console.log(`Version: ${client.serverInfo.version}`);
        }
        console.log(`Tools: ${tools.length}`);
        for (const tool of tools) {
          console.log(`  - ${tool.fullName}${tool.description ? ` — ${tool.description}` : ""}`);
        }
        break;
      }
      default: {
        console.error(`Unknown mcp subcommand: '${subcommand}'`);
        console.error("Available: list, add, remove, discover, test");
        process.exit(1);
      }
    }
  } finally {
    await mcpManager.closeAll().catch(() => {});
  }
  process.exit(0);
}

if (command === "extension") {
  const { homedir } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const { ExtensionRegistry } = await import("./extensions/registry.js");

  const storePath = pjoin(homedir(), ".alix", "extensions");
  const registry = new ExtensionRegistry(storePath);

  const sub = args[0];
  if (sub === "list") {
    const typeFilter = args[1] as any;
    const all = registry.list(typeFilter ? { type: typeFilter } : undefined);
    console.log(`Installed extensions (${all.length}):`);
    for (const ext of all) {
      const m = ext.manifest;
      const core = m.is_core ? " [core]" : "";
      const trigger = (m as any).trigger ? ` trigger:${(m as any).trigger}` : "";
      console.log(`  ${m.type}/${m.name}${core} — ${m.description} (v${m.version})${trigger}`);
    }
  } else if (sub === "install") {
    const src = args[1];
    if (!src) { console.error("Usage: alix extension install <path>"); process.exit(1); }
    const installed = await registry.install(src);
    if (installed) {
      console.log(`Installed: ${installed.manifest.type}/${installed.manifest.name}`);
    } else {
      console.error("Install failed: no EXTENSION.yaml found or manifest invalid");
      process.exit(1);
    }
  } else if (sub === "uninstall") {
    const id = args[1];
    if (!id) { console.error("Usage: alix extension uninstall <type>/<name>"); process.exit(1); }
    const removed = await registry.uninstall(id);
    if (removed) {
      console.log(`Uninstalled: ${id}`);
    } else {
      console.log(`Failed: ${id} not found or is a core extension`);
      process.exit(1);
    }
  } else if (sub === "search") {
    const query = (args[1] ?? "").toLowerCase();
    if (!query) { console.error("Usage: alix extension search <query>"); process.exit(1); }
    const all = registry.list();
    const matches = all.filter(e =>
      e.manifest.name.toLowerCase().includes(query) ||
      e.manifest.description.toLowerCase().includes(query) ||
      e.manifest.tags?.some(t => t.toLowerCase().includes(query))
    );
    console.log(`Search results for "${query}":`);
    if (matches.length === 0) { console.log("  (no matches)"); }
    for (const ext of matches) {
      console.log(`  ${ext.manifest.type}/${ext.manifest.name} — ${ext.manifest.description}`);
    }
  } else {
    console.log("Usage: alix extension [list|install|uninstall|search]");
    console.log("  list [type]    — list installed extensions, optionally filter by type");
    console.log("  install <path> — install extension from a directory");
    console.log("  uninstall <id> — uninstall by id (e.g. skill/my-skill)");
    console.log("  search <query> — search by name, description, or tag");
  }
  process.exit(0);
}

// --- alix agent <role> "prompt" --- runs subagent in same process (no recursion)
const agentRole = process.argv[3];
if (command === "agent" && agentRole) {
  const prompt = process.argv.slice(4).join(" ");
  if (!prompt) { console.error("Usage: alix agent <role> <prompt>"); process.exit(1); }
  const config = await loadConfig(process.cwd());
  const provider = config.model.provider;
  const model = config.model.name;
  const { SubagentCLI } = await import("./agents/subagent-cli.js");
  const extraArgs = process.argv.slice(6);
  await SubagentCLI.main([
    "--subagent", agentRole,
    "--task-id", crypto.randomUUID(),
    "--prompt", prompt,
    "--mode", "read_only",
    "--session-id", `cli-${Date.now()}`,
    "--provider", provider,
    "--model", model,
    "--output", "text",
    ...extraArgs,
  ]);
  // SubagentCLI.main() exits the process itself — if we reach here, something went wrong
  process.exit(1);
}

// --- alix run --subagent <role> --- subagent process entry point (called by parent) ---
if (command === "run" && args[0] === "--subagent") {
  const { SubagentCLI } = await import("./agents/subagent-cli.js");
  // Pass through any extra args (e.g. --model, --owned-paths)
  const extraArgs = process.argv.slice(7);
  const subagentArgs = ["--subagent", args[1],
    "--task-id", args[2] ?? crypto.randomUUID(),
    "--prompt", args[3] ?? "",
    "--mode", args[4] ?? "read_only",
    "--session-id", args[5] ?? `cli-${Date.now()}`,
    ...extraArgs,
  ];
  await SubagentCLI.main(subagentArgs);
  process.exit(1);
}

// --- alix memory --- memory management commands ---
if (command === "memory") {
  const memoryDir = resolve(process.cwd(), ".alix/memory");
  const sub = args[0];

  if (sub === "list") {
    const queryIdx = args.indexOf("--query");
    const query = queryIdx !== -1 ? args.slice(queryIdx + 1).join(" ") : args.slice(1).join(" ");
    const store = new MemoryStore(memoryDir);
    await store.init();
    const results = await store.find(query, 20);
    if (results.length === 0) {
      console.log("No memory entries found.");
    } else {
      for (const entry of results) {
        console.log(`[${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
        console.log(`  ${entry.content.slice(0, 100)}${entry.content.length > 100 ? "..." : ""}`);
        console.log();
      }
    }
  } else if (sub === "add") {
    const nameIdx = args.indexOf("--name");
    const typeIdx = args.indexOf("--type");
    const contentIdx = args.indexOf("--content");
    const descIdx = args.indexOf("--description");

    const name = nameIdx !== -1 ? args[nameIdx + 1] : null;
    const type = typeIdx !== -1 ? args[typeIdx + 1] : "project";
    const content = contentIdx !== -1 ? args[contentIdx + 1] : null;
    const description = descIdx !== -1 ? args[descIdx + 1] ?? "" : "";

    if (!name || !content) {
      console.error("Usage: alix memory add --name <name> --content <content> [--type <type>] [--description <desc>]");
      process.exit(1);
    }

    const store = new MemoryStore(memoryDir);
    await store.init();
    await store.save({
      name,
      description,
      type: type as MemoryType,
      content,
      confidence: 0.7,
      confirmations: 1,
    });
    await store.buildIndex();
    console.log("Memory entry saved.");
  } else if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: alix memory search <query>");
      process.exit(1);
    }
    const store = new MemoryStore(memoryDir);
    await store.init();
    const results = await store.find(query, 10);
    console.log(`Found ${results.length} entries:`);
    for (const entry of results) {
      console.log(`  [${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
    }
  } else if (sub === "stats") {
    const { readdir } = await import("node:fs/promises");
    const dirs: MemoryType[] = ["user", "project", "feedback", "reference"];
    for (const dir of dirs) {
      const files = await readdir(join(memoryDir, dir)).catch(() => []);
      console.log(`${dir}: ${files.length} entries`);
    }
  } else {
    console.log("Usage: alix memory [list|add|search|stats]");
    console.log("  list [--query <text>]  - List memory entries, optionally filter by query");
    console.log("  add --name <n> --content <c> [--type <t>] [--description <d>] - Add a memory entry");
    console.log("  search <query>         - Search memory entries");
    console.log("  stats                  - Show memory statistics");
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
