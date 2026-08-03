import { mkdir, readdir, readFile, writeFile, stat, rm, copyFile, realpath } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { parseSkillContent } from "../../../skills/types.js";
import { githubRawCandidates, fetchSkillFromUrls, parseGithubUrl, EXCLUDED_DIRS } from "./net.js";
import {
  loadMarketplaces,
  resolveSkillInMarketplaces,
  listAvailableSkills,
  fetchSkillPackage,
  type SkillPackageFile,
} from "./marketplace.js";

export interface InstallOptions {
  list?: boolean;
  available?: boolean;
  /** Remove an installed skill from ~/.alix/skills/<name>. */
  remove?: boolean;
  name?: string;
  /** Install a skill from a local dir/file or https URL. */
  from?: string;
}

/**
 * Recursively copy a skill package directory into its install target, skipping
 * any top-level entry whose basename is in EXCLUDED_DIRS. Directories recurse;
 * regular files are copied as-is (SKILL.md, scripts/, assets/, LICENSE, ...).
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src);
  for (const name of entries) {
    if (EXCLUDED_DIRS.includes(name)) continue;
    const srcPath = join(src, name);
    const destPath = join(dest, name);
    const st = await stat(srcPath);
    if (st.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
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
/**
 * Parse the raw `alix skills` arg list once into its flags, positionals, and
 * the `--from` value. The single parser shared by resolveInstallOptions and
 * resolveSkillsCommand — no second, independent flag-splitting loop.
 */
export function parseSkillsArgs(args: string[]): { flags: Set<string>; positional: string[]; from?: string } {
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
  return { flags, positional, from };
}

export function resolveInstallOptions(args: string[]): InstallOptions {
  const { flags, positional, from } = parseSkillsArgs(args);
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

  // Remove an installed skill
  if (opts.remove) {
    if (!opts.name) {
      throw new Error("Usage: alix skills remove <name>");
    }
    await removeSkill(opts.name, skillsDir);
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
  alix skills remove <name>                          Remove an installed skill
  alix skills marketplace list                       List registered marketplaces
  alix skills marketplace add <name> <url>           Register a marketplace (github.com https URL)
  alix skills marketplace remove <name>              Unregister a marketplace

Run 'alix skills available' to see skills you can install.
`);
}

/**
 * Resolve the skill directory inside a local folder that has no top-level
 * SKILL.md — a repo-root package layout such as a clone of anthropics/skills,
 * where skills live at skills/<name>/SKILL.md.
 *
 * Order:
 *   1. `skills/<name>` then `<name>` when a name is given,
 *   2. a unique nested skill directory when exactly one exists and either no
 *      name was given or that skill's manifest.name matches the given name,
 *   3. a clear error otherwise.
 */
async function resolveSkillDir(root: string, name: string | undefined): Promise<string> {
  if (name) {
    for (const candidate of [join(root, "skills", name), join(root, name)]) {
      if (existsSync(join(candidate, "SKILL.md"))) return candidate;
    }
  }
  const nested = await findNestedSkillDirs(root);
  if (nested.length === 1) {
    // A name that matched neither skills/<name> nor <name> must NOT silently
    // install the single nested skill under the given (misleading) name. Fall
    // through to the unique nested skill only when no name was given, or when
    // that skill's manifest.name actually matches the requested name.
    if (!name) return nested[0];
    const content = await readFile(join(nested[0], "SKILL.md"), "utf8");
    const { manifest } = parseSkillContent(content);
    if (manifest && manifest.name === name) return nested[0];
  }
  if (name) {
    throw new Error(`no SKILL.md at ${root}; did you mean ${join(root, "skills", name)}?`);
  }
  if (nested.length > 1) {
    throw new Error(
      `no SKILL.md at ${root}; ${nested.length} nested skills found — pass a name: alix skills install <name> --from <dir>`,
    );
  }
  throw new Error(`no SKILL.md at ${root}; pass a skill name or install from a directory containing SKILL.md`);
}

/**
 * Collect directories under `root` (excluding `root` itself) that directly
 * contain a SKILL.md, skipping EXCLUDED_DIRS. Stops early once more than one is
 * found, so a large repo with a single skill isn't fully walked.
 */
async function findNestedSkillDirs(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length > 1) return;
      if (EXCLUDED_DIRS.includes(entry)) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (existsSync(join(full, "SKILL.md"))) {
        found.push(full);
        if (found.length > 1) return;
      }
      await walk(full);
    }
  }
  await walk(root);
  return found;
}

/**
 * Install a skill from a source outside the registered marketplaces.
 *
 * Source may be:
 *   - a local directory containing SKILL.md  → name derived from dir name (or --from filename)
 *   - a local SKILL.md file
 *   - an https:// URL to a SKILL.md file     → name derived from the manifest's `name`
 *   - a github.com skill-dir/blob/tree URL   → the whole package (SKILL.md + scripts/, assets/, ...) is installed
 *   - a github.com repo-root URL             → SKILL.md resolved automatically
 *   - a raw.githubusercontent.com file URL   → fetched directly
 *
 * The content must parse as a valid skill manifest (name + description).
 * Remote sources are restricted to https — a fetched skill's instructions are
 * trusted and injected into agent prompts, so plain http is rejected.
 */
async function installFromSource(source: string, name: string | undefined, skillsDir: string): Promise<void> {
  let content: string;
  let fallbackName: string | undefined;
  let sourceIsDir = false;
  let packageFiles: SkillPackageFile[] | undefined;
  // Directory to copy when installing a local package: the source folder
  // itself when it has a top-level SKILL.md, or a nested skill subdir when the
  // source is a repo root (e.g. skills/<name>/SKILL.md).
  let sourceDir = source;

  if (source.startsWith("http://")) {
    throw new Error("Remote skills must use https:// (plain http is rejected)");
  }

  if (source.startsWith("https://")) {
    // A github.com skill-dir/blob/tree URL (non-empty path) installs the whole
    // package: enumerate the skill dir's files and fetch them all. Repo-root
    // URLs, raw.githubusercontent.com, and non-GitHub https URLs keep the
    // single-SKILL.md resolution below.
    const parsedGithub = parseGithubUrl(source);
    const isGithubDirUrl =
      parsedGithub !== null && parsedGithub.host === "github.com" && parsedGithub.rest.length > 0;
    const pkg = isGithubDirUrl ? await fetchSkillPackage(source, { name }) : null;
    if (pkg) {
      packageFiles = pkg.files;
      content = packageFiles.find((f) => f.relPath === "SKILL.md")?.content ?? "";
      if (!content) {
        throw new Error(`No SKILL.md found under ${source}`);
      }
    } else {
      const candidates = githubRawCandidates(source, name);
      content = await fetchSkillFromUrls(candidates ?? [source], source, name);
    }
  } else {
    // Local path: directory containing SKILL.md, or a SKILL.md file itself
    let st;
    try {
      st = await stat(source);
    } catch {
      throw new Error(`Source not found: ${source}`);
    }
    if (st.isDirectory()) {
      sourceIsDir = true;
      sourceDir = existsSync(join(source, "SKILL.md"))
        ? source
        : await resolveSkillDir(source, name);
      content = await readFile(join(sourceDir, "SKILL.md"), "utf8");
      fallbackName = basename(sourceDir);
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
  if (sourceIsDir) {
    // Guard against self-copy: `--from <install target>` where the source
    // resolves to the same directory as the target (e.g.
    // `alix skills install foo --from ~/.alix/skills/foo`). Copying a
    // directory onto itself would copyFile(srcPath, srcPath) and truncate
    // every file to 0 bytes — so refuse instead; the skill is already there.
    const [sourceReal, targetReal] = await Promise.all([realpath(sourceDir), realpath(targetDir)]);
    if (sourceReal === targetReal) {
      throw new Error(
        `Source ${source} resolves to the install target ${targetDir}; the skill is already installed.`,
      );
    }
    // Local-directory package source: copy the whole skill folder (SKILL.md,
    // scripts/, assets/, LICENSE, ...) minus EXCLUDED_DIRS.
    await copyDir(sourceDir, targetDir);
  } else if (packageFiles) {
    // URL package source: write every fetched file (SKILL.md + scripts/,
    // assets/, LICENSE, ...) under the skill directory.
    for (const file of packageFiles) {
      const dest = join(targetDir, file.relPath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.content, "utf8");
    }
  } else {
    // Single-file source (local .md or fetched content): write just SKILL.md.
    await writeFile(join(targetDir, "SKILL.md"), content, "utf8");
  }
  console.log(`Installed: ${resolvedName} (from ${source})`);
}

/** Remove an installed skill from ~/.alix/skills/<name>. */
async function removeSkill(name: string, skillsDir: string): Promise<void> {
  const target = join(skillsDir, name);
  if (!existsSync(join(target, "SKILL.md"))) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  await rm(target, { recursive: true, force: true });
  console.log(`Removed: ${name}`);
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
