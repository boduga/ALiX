/**
 * `alix extension / mcp` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, projectConfigDir } from "../../config/loader.js";
import "../../config/model-resolver.js";
import "../../index.js";
import { prompt } from "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";

export async function handleMcpRoot(args: string[]): Promise<void> {
  const config = await loadConfig(process.cwd());
  const { McpManager } = await import("../../mcp/manager.js");
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
        await mkdir(projectConfigDir(process.cwd()), { recursive: true });
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
          await mkdir(projectConfigDir(process.cwd()), { recursive: true });
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

export async function handleExtensionRoot(args: string[]): Promise<void> {
  const { homedir } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const { ExtensionRegistry } = await import("../../extensions/registry.js");

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

