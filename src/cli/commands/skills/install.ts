import { copyFile, mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { parseSkillContent } from "../../../skills/types.js";

export interface InstallOptions {
  list?: boolean;
  available?: boolean;
  name?: string;
  all?: boolean;
  /** Install a skill not in the bundled set, from a local dir/file or https URL. */
  from?: string;
}

/**
 * Map CLI args (everything after `alix skills`) to InstallOptions.
 *
 * The CLI surface is subcommand-based:
 *   alix skills available           → { available: true }
 *   alix skills install             → {} (help)
 *   alix skills install --all       → { all: true }
 *   alix skills install <name>      → { name }
 *   alix skills install --list      → { list: true }
 *
 * A bare `available`/`install` subcommand is required — the first non-flag
 * arg is the subcommand, NOT the skill name. (Previously the first non-flag
 * arg was unconditionally mapped to `name`, so `alix skills available`
 * tried to install a skill literally named "available", and
 * `alix skills install tdd` tried to install one named "install".)
 * The legacy `--available` flag is still honored for backward compat.
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
    all: flags.has("--all"),
    name: sub === "install" ? positional[1] : undefined,
    from,
  };
}

const CORE_SKILLS: Record<string, string> = {
  tdd: "Test-driven development with red-green-refactor loop",
  debug: "Systematic debugging with reproduce-minimize-hypothesize-fix loop",
  review: "Code review with security, performance, and quality checklist",
  refactor: "Safe refactoring using GitNexus blast radius analysis",
  architect: "Architecture reviews and deepening opportunities",
  simplify: "Code cleanup removing dead code and fixing hacky patterns",
  document: "Auto-generates docstrings, README, and API docs",
  migrate: "Safe migrations with expand-contract and dual-write patterns",
  "test-suite": "Test suite auditing and coverage improvement",
  optimize: "Performance profiling and caching strategies",
};

export async function runInstall(opts: InstallOptions): Promise<void> {
  const homeDir = process.env.HOME ?? "";
  const alixDir = join(homeDir, ".alix");
  const skillsDir = join(alixDir, "skills");

  // Show available skills (bundled)
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

  // Install all core skills
  if (opts.all) {
    await installAllCoreSkills(skillsDir);
    return;
  }

  // Install a non-bundled skill from a local path or https URL.
  // Checked before opts.name so `install <name> --from <src>` hits this path.
  if (opts.from) {
    await installFromSource(opts.from, opts.name, skillsDir);
    return;
  }

  // Install a specific bundled skill
  if (opts.name) {
    await installSkill(opts.name, skillsDir);
    return;
  }

  // Default: show help
  console.log(`ALiX Skills Installer

Usage:
  alix skills available                              List all available skills to install
  alix skills install --all                          Install all core skills
  alix skills install <name>                         Install specific bundled skill
  alix skills install <name> --from <path|url>       Install a skill from a local dir/file or https URL
  alix skills install --list                         List installed skills

Run 'alix skills available' to see all skills you can install.
`);
}

/**
 * Install a skill that is not part of the bundled set.
 *
 * Source may be:
 *   - a local directory containing SKILL.md  → name derived from dir name (or --from filename)
 *   - a local SKILL.md file
 *   - an https:// URL to a SKILL.md file     → name derived from the manifest's `name`
 *
 * The content must parse as a valid skill manifest (name + description).
 * Remote sources are restricted to https — a fetched skill's instructions are
 * trusted and injected into agent prompts, so plain http is rejected.
 */
async function installFromSource(source: string, name: string | undefined, skillsDir: string): Promise<void> {
  let content: string;
  let resolvedName: string | undefined;

  if (source.startsWith("https://")) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(source, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`Failed to fetch ${source}: HTTP ${res.status}`);
    const len = res.headers.get("content-length");
    if (len && Number(len) > 1_000_000) {
      throw new Error(`Refusing to install: ${source} is larger than 1MB`);
    }
    content = await res.text();
  } else if (source.startsWith("http://")) {
    throw new Error("Remote skills must use https:// (plain http is rejected)");
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
      resolvedName = basename(source);
    } else {
      content = await readFile(source, "utf8");
      resolvedName = basename(source, ".md");
    }
  }

  const { manifest } = parseSkillContent(content);
  if (!manifest) {
    throw new Error(`Source does not contain a valid skill manifest (needs 'name' and 'description' frontmatter): ${source}`);
  }
  resolvedName = name ?? manifest.name ?? resolvedName;
  if (!resolvedName) {
    throw new Error(`Could not determine a skill name for ${source} — pass one: alix skills install <name> --from <path|url>`);
  }

  const targetDir = join(skillsDir, resolvedName);
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, "SKILL.md"), content, "utf8");
  console.log(`Installed: ${resolvedName} (from ${source})`);
}

async function installAllCoreSkills(skillsDir: string): Promise<void> {
  const coreSkills = Object.keys(CORE_SKILLS);
  console.log("Installing core skills...\n");

  for (const name of coreSkills) {
    try {
      await installSkill(name, skillsDir);
    } catch (err) {
      console.error(`Failed to install ${name}: ${err}`);
    }
  }
}

async function installSkill(name: string, skillsDir: string): Promise<void> {
  // Source: bundled in CLI (src/cli/commands/skills/<name>/SKILL.md)
  const bundledPath = join(process.cwd(), "src", "cli", "commands", "skills", name, "SKILL.md");
  const destDir = join(skillsDir, name);

  if (!existsSync(bundledPath)) {
    throw new Error(`Skill '${name}' not found in bundle`);
  }

  // Create destination directory
  await mkdir(destDir, { recursive: true });

  // Copy skill file
  await copyFile(bundledPath, join(destDir, "SKILL.md"));
  console.log(`Installed: ${name}`);
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

async function listAvailableSkills(): Promise<void> {
  console.log("Available skills to install:\n");
  for (const [name, description] of Object.entries(CORE_SKILLS)) {
    console.log(`  ${name.padEnd(12)} ${description}`);
  }
  console.log(`\nRun 'alix skills install <name>' to install one, or 'alix skills install --all' for all.`);
}