import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface InstallOptions {
  list?: boolean;
  available?: boolean;
  name?: string;
  all?: boolean;
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

  // Show available skills (bundled)
  if (opts.available) {
    await listAvailableSkills();
    return;
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

  // Default: show help
  console.log(`ALiX Skills Installer

Usage:
  alix skills available          List all available skills to install
  alix skills install --all      Install all core skills
  alix skills install <name>     Install specific skill
  alix skills install --list     List installed skills

Run 'alix skills available' to see all skills you can install.
`);
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