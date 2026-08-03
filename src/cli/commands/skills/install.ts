import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { parseSkillContent } from "../../../skills/types.js";
import { githubRawCandidates, fetchSkillFromUrls, fetchText } from "./net.js";
import { loadMarketplaces, resolveSkillInMarketplaces, listAvailableSkills } from "./marketplace.js";

export interface InstallOptions {
  list?: boolean;
  available?: boolean;
  name?: string;
  /** Install a skill from a local dir/file or https URL. */
  from?: string;
}

/**
 * Map CLI args (everything after `alix skills`) to InstallOptions.
 *
 * CLI surface is subcommand-based:
 * alix skills available → { available: true }
 * alix skills install → {} (help)
 * alix skills install <name> → { name }
 * alix skills install --list → { list: true }
 *
 * bare `available`/`install` subcommand required — first non-flag
 * arg is the subcommand, NOT a skill name. (Previously the first non-flag
 * arg unconditionally mapped to `name`, so `alix skills available`
 * tried to install a skill literally named "available", and
 * `alix skills install tdd` tried to install one named "install".)
 * legacy `--available` flag still honored for backward compat.
 */
export function resolveInstallOptions(args: string[]): InstallOptions {
  const flags = new Set<string>();
  const positional: string[] = [];
  let from: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--from") {
      from = args[i + 1];
      i++; // consume the value token
    } else if (a.startsWith("--")) {
      flags.add(a);
    } else {
      positional.push(a);
    }
  }
  const sub = positional[0] ?? "";
  return {
    available: sub === "available" || flags.has("--available"),
    list: flags.has("--list"),
    name: sub === "install" ? positional[1] : undefined,
    from,
  };
}

export async function runInstall(opts: InstallOptions): Promise<void> {
  const homeDir = process.env.HOME ?? "";
  const alixDir = join(homeDir, ".alix");
  const skillsDir = join(alixDir, "skills");

  // Show available skills across registered marketplaces
  if (opts.available) {
    await listAvailableSkills();
    return;
  }

  // Ensure .alix directory exists
  if (!existsSync(alixDir)) {
    await mkdir(alixDir, { recursive: true });
  }
  if (!existsSync(skillsDir)) {
    await mkdir(skillsDir, { recursive: true });
  }

  // List installed skills
  if (opts.list) {
    await listInstalledSkills(skillsDir);
    return;
  }

  // Install a skill from a local path or https URL.
  // Checked before opts.name so `install <name> --from <src>` hits this path.
  if (opts.from) {
    await installFromSource(opts.from, opts.name, skillsDir);
    return;
  }

  // Install a skill by name from the registered marketplaces
  if (opts.name) {
    const destDir = join(skillsDir, opts.name);
    if (existsSync(join(destDir, "SKILL.md"))) {
      console.log("already installed");
      return;
    }
    const marketplaces = await loadMarketplaces();
    const { repoUrl, content } = await resolveSkillInMarketplaces(opts.name, marketplaces);
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "SKILL.md"), content, "utf8");
    console.log(`Installed: ${opts.name} (from ${repoUrl})`);
    return;
  }

  // Default: show help
  printSkillsHelp();
}

export function printSkillsHelp(): void {
  console.log(`ALiX Skills

Usage:
  alix skills available                              List skills available from registered marketplaces
  alix skills install <name>                         Install a skill from a registered marketplace
  alix skills install <name> --from <path|url>       Install a skill from a local dir/file or https URL
  alix skills install --list                         List installed skills
  alix skills marketplace list                       List registered marketplaces
  alix skills marketplace add <name> <url>           Register a marketplace (github.com https URL)
  alix skills marketplace remove <name>              Unregister a marketplace

Run 'alix skills available' to see skills you can install.
`);
}

/**
 * Install a skill from a source outside the registered marketplaces.
 *
 * Source may be:
 *   - a local directory containing SKILL.md  → name derived from dir name (or --from filename)
 *   - a local SKILL.md file
 *   - an https:// URL to a SKILL.md file     → name derived from the manifest's `name`
 *   - a github.com repo / blob / tree URL    → SKILL.md resolved automatically
 *   - a raw.githubusercontent.com file URL   → fetched directly
 *
 * The content must parse as a valid skill manifest (name + description).
 * Remote sources are restricted to https — a fetched skill's instructions are
 * trusted and injected into agent prompts, so plain http is rejected.
 */
async function installFromSource(source: string, name: string | undefined, skillsDir: string): Promise<void> {
  let content: string;
  let fallbackName: string | undefined;

  if (source.startsWith("http://")) {
    throw new Error("Remote skills must use https:// (plain http is rejected)");
  }

  if (source.startsWith("https://")) {
    const candidates = githubRawCandidates(source, name);
    content = await fetchSkillFromUrls(candidates ?? [source], source, name);
  } else {
    // Local path: directory containing SKILL.md, or a SKILL.md file itself
    let st;
    try {
      st = await stat(source);
    } catch {
      throw new Error(`Source not found: ${source}`);
    }
    if (st.isDirectory()) {
      content = await readFile(join(source, "SKILL.md"), "utf8");
      fallbackName = basename(source);
    } else {
      content = await readFile(source, "utf8");
      fallbackName = basename(source, ".md");
    }
  }

  const { manifest } = parseSkillContent(content);
  if (!manifest) {
    // Unreachable for the URL path (already validated); covers local files.
    throw new Error(`Source does not contain a valid skill manifest (needs 'name' and 'description' frontmatter): ${source}`);
  }
  const resolvedName = name ?? manifest.name ?? fallbackName;
  if (!resolvedName) {
    throw new Error(`Could not determine a skill name for ${source} — pass one: alix skills install <name> --from <path|url>`);
  }

  const targetDir = join(skillsDir, resolvedName);
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, "SKILL.md"), content, "utf8");
  console.log(`Installed: ${resolvedName} (from ${source})`);
}

async function listInstalledSkills(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    console.log("No skills installed.");
    return;
  }

  const entries = await readdir(dir);
  if (entries.length === 0) {
    console.log("No skills installed.");
    return;
  }

  console.log("Installed skills:\n");
  for (const name of entries) {
    const skillPath = join(dir, name, "SKILL.md");
    if (existsSync(skillPath)) {
      console.log(`  ${name}`);
    }
  }
}
