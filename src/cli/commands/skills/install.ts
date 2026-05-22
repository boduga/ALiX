import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface InstallOptions {
  list?: boolean;
  name?: string;
  all?: boolean;
}

export async function runInstall(opts: InstallOptions): Promise<void> {
  const homeDir = process.env.HOME ?? "";
  const alixDir = join(homeDir, ".alix");
  const skillsDir = join(alixDir, "skills");

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

  // Install specific skill
  if (opts.name) {
    await installSkill(opts.name, skillsDir);
    return;
  }

  // Default: show help
  console.log(`ALiX Skills Installer

Usage:
  alix skills install --all    Install all core skills
  alix skills install <name>    Install specific skill
  alix skills install --list   List installed skills

Core skills available:
  tdd     - Test-driven development
  debug   - Systematic debugging
  review  - Code review checklist
`);
}

async function installAllCoreSkills(skillsDir: string): Promise<void> {
  const coreSkills = ["tdd", "debug", "review"];
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