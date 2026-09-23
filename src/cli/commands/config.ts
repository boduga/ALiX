/**
 * `alix config` subcommands — extracted from `src/cli.ts` (#717 step 6).
 * Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, projectConfigDir, userConfigDir } from "../../config/loader.js";
import "../../config/model-resolver.js";
import "../../index.js";
import { prompt } from "./prompt.js";
import { setApiKey } from "../helpers/api-keys.js";
import { PROVIDERS } from "../../providers/catalog.js";

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

export async function handleConfigSetKey(_args: string[]): Promise<void> {
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

/**
 * `--global` (alias `--user`) targets the user config; `--project` (the
 * default) targets the project config. Project wins at load time, so a project
 * can override a global default — including pinning a subsystem off.
 */
const SCOPE_FLAGS = ["--global", "--user", "--project"];

function resolveConfigScope(rawArgs: string[]): {
  dir: string;
  scope: "project" | "user";
  args: string[];
} {
  const global = rawArgs.includes("--global") || rawArgs.includes("--user");
  const project = rawArgs.includes("--project");
  if (global && project) {
    console.error("Use either --global or --project, not both.");
    process.exit(1);
  }
  return {
    dir: global ? userConfigDir() : projectConfigDir(process.cwd()),
    scope: global ? "user" : "project",
    args: rawArgs.filter((arg) => !SCOPE_FLAGS.includes(arg)),
  };
}

/** The user config may not exist yet; an empty file is a no-op for the loader. */
function ensureConfigFile(dir: string): void {
  const file = join(dir, "config.json");
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, "{}\n", { encoding: "utf8", mode: 0o600 });
}

export async function handleConfigGet(rawArgs: string[]): Promise<void> {
  const { dir, scope, args } = resolveConfigScope(rawArgs);
  const path = args[1];
  if (!path) {
    console.error("Usage: alix config get <path> [--global|--project]");
    console.error("Example: alix config get model.provider");
    process.exit(1);
  }
  const { ConfigMutationService } = await import("../../config/mutation.js");
  const service = new ConfigMutationService(dir);
  // --global reads the user file as written; the default reads the effective
  // merged config (project over user).
  const config = scope === "user"
    ? await service.read().catch(() => ({}) as never)
    // `requireModel: false`: reading a config path is diagnostic and must work
    // before any model is configured (the loader's documented diagnostic mode).
    : await loadConfig(process.cwd(), { requireModel: false, suppressWarnings: true });
  const value = service.getValue(config, path);
  if (value === undefined) {
    console.log(`(not set)`);
  } else if (typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
  process.exit(0);
}

export async function handleConfigSet(rawArgs: string[]): Promise<void> {
  const { dir, scope, args } = resolveConfigScope(rawArgs);
  const path = args[1];
  const valueStr = args[2];
  if (!path || valueStr === undefined) {
    console.error("Usage: alix config set <path> <value> [--global|--project]");
    console.error("Example: alix config set permissions.default allow");
    console.error("Example: alix config set decision.remote.jev.enabled true --global");
    process.exit(1);
  }
  // Parse value: try JSON first, fall back to string
  let value: unknown = valueStr;
  try { value = JSON.parse(valueStr); } catch { /* keep as string */ }

  if (scope === "user") ensureConfigFile(dir);
  const { ConfigMutationService } = await import("../../config/mutation.js");
  const service = new ConfigMutationService(dir);
  try {
    const mutation = await service.set(path, value);
    console.log(`Set ${path} = ${JSON.stringify(value)} (${scope})`);
    console.log(`(previous: ${mutation.previousValue === undefined ? "not set" : JSON.stringify(mutation.previousValue)})`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleConfigDelete(rawArgs: string[]): Promise<void> {
  const { dir, scope, args } = resolveConfigScope(rawArgs);
  const path = args[1];
  if (!path) {
    console.error("Usage: alix config delete <path> [--global|--project]");
    console.error("Example: alix config delete logging.level");
    process.exit(1);
  }
  const { ConfigMutationService } = await import("../../config/mutation.js");
  const service = new ConfigMutationService(dir);
  try {
    const mutation = await service.delete(path);
    console.log(`Deleted ${path} (${scope})`);
    console.log(`(was: ${mutation.previousValue === undefined ? "not set" : JSON.stringify(mutation.previousValue)})`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleConfigHistory(rawArgs: string[]): Promise<void> {
  const { dir, scope, args } = resolveConfigScope(rawArgs);
  const { ConfigMutationService } = await import("../../config/mutation.js");
  const service = new ConfigMutationService(dir);
  const json = args.includes("--json");
  const entries = await service.getProvenance();
  if (entries.length === 0) {
    console.log(`No ${scope} config mutation history.`);
    process.exit(0);
  }
  if (json) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    for (const entry of entries) {
      const time = new Date(entry.updatedAt).toLocaleString();
      console.log(`#${entry.version}  ${time}  by ${entry.updatedBy}`);
      for (const m of entry.mutations) {
        const prev = m.previousValue !== undefined ? ` (was: ${JSON.stringify(m.previousValue)})` : "";
        if (m.op === "set") {
          console.log(`  ${m.op}  ${m.path} = ${JSON.stringify(m.value)}${prev}`);
        } else {
          console.log(`  ${m.op}  ${m.path}${prev}`);
        }
      }
      console.log(`  hash: ${entry.configHash.slice(0, 12)}...`);
      console.log();
    }
    console.log(`${entries.length} ${scope} entries (max 100)`);
  }
  process.exit(0);
}

export async function handleConfigProvenance(rawArgs: string[]): Promise<void> {
  const { dir, scope, args } = resolveConfigScope(rawArgs);
  const { ConfigMutationService } = await import("../../config/mutation.js");
  const service = new ConfigMutationService(dir);
  const json = args.includes("--json");
  // filter path: first non-flag arg after "provenance"
  const filterPath = args.slice(1).find(a => !a.startsWith("--"));
  const entries = filterPath ? await service.getProvenance(filterPath) : await service.getProvenance();
  if (entries.length === 0) {
    console.log(
      filterPath
        ? `No ${scope} provenance entries for path "${filterPath}".`
        : `No ${scope} provenance entries.`,
    );
    process.exit(0);
  }
  if (json) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    console.log(`Config provenance (${scope}) ${filterPath ? `for "${filterPath}" ` : ""}(${entries.length} entries):\n`);
    for (const entry of entries) {
      const time = new Date(entry.updatedAt).toLocaleString();
      console.log(`v${entry.version}  ${time}  ${entry.updatedBy}`);
      for (const m of entry.mutations) {
        const icon = m.op === "set" ? "+" : "-";
        console.log(`  ${icon} ${m.path}`);
      }
      console.log(`  prev: ${entry.prevConfigHash.slice(0, 12)}...  ->  ${entry.configHash.slice(0, 12)}...`);
      console.log();
    }
  }
  process.exit(0);
}

export async function handleConfigRollback(args: string[]): Promise<void> {
  const versionStr = args[1];
  const force = args.includes("--force");
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;

  if (!versionStr) {
    console.error("Usage: alix config rollback <version> --force --reason \"<reason>\"");
    process.exit(1);
  }
  if (!force) {
    console.error("Rollback requires --force. Use --reason to explain why.");
    process.exit(1);
  }
  if (!reason) {
    console.error("Rollback requires --reason \"<explanation>\".");
    process.exit(1);
  }

  const version = parseInt(versionStr, 10);
  if (isNaN(version) || version < 1) {
    console.error(`Invalid version: ${versionStr}`);
    process.exit(1);
  }

  const { ConfigSigner } = await import("../../config/signing.js");
  await ConfigSigner.writeAcceptedVersion(version);
  console.log(`Rolled back accepted config version to ${version}.`);
  console.log(`Reason: ${reason}`);
  process.exit(0);
}

export async function handleConfigShow(args: string[]): Promise<void> {
  const config = await loadConfig(process.cwd());
  // Redact sensitive values by default
  const redact = !args.includes("--reveal-secrets");
  const output = JSON.parse(JSON.stringify(config));
  if (redact && output.apiKeys) {
    for (const [provider, key] of Object.entries(output.apiKeys)) {
      if (typeof key === "string" && key.length > 8) {
        output.apiKeys[provider] = key.slice(0, 8) + "…REDACTED";
      }
    }
  }
  if (redact && output.model?.apiKey) {
    output.model.apiKey = output.model.apiKey.slice(0, 8) + "…REDACTED";
  }
  if (!redact && process.stdin.isTTY) {
    console.error("WARNING: --reveal-secrets exposes API keys in plaintext. Confirm? [y/N]");
    // readline confirm would be ideal but this is a safety prompt
  }
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

