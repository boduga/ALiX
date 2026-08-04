import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, stat, rm, copyFile, realpath, rename } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { parseSkillContent, type SkillManifest } from "../../../skills/types.js";
import { githubRawCandidates, fetchSkillFromUrls, parseGithubUrl, EXCLUDED_DIRS } from "./net.js";
import { checkManifest, scanSkillFiles, scanSkillDirectory, type SkillScanResult } from "../../../skills/security.js";
import { assessTrust, createInstallGate, type TrustLevel } from "../../../skills/trust.js";
import { SkillInstallHistory, type SkillInstallRecord } from "../../../security/evidence/skill-install-history.js";
import {
  loadMarketplaces,
  resolveSkillInMarketplaces,
  listAvailableSkills,
  fetchSkillPackage,
  DEFAULT_MARKETPLACES,
  resolveSkillPackageInMarketplaces,
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
  /** Bypass the trust confirmation (never bypasses hard scan denials). */
  force?: boolean;
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
 * Atomically install a skill: run `build` into a fresh temp sibling dir,
 * verify SKILL.md exists, then swap-rename into place. An existing target is
 * backed up first and removed only after the new copy succeeds, so a failed
 * or interrupted install never leaves a partially-written skill.
 */
export async function atomicInstallSkill(
  targetDir: string,
  build: (tmpDir: string) => Promise<void>,
): Promise<void> {
  const tmpDir = `${targetDir}.tmp-${randomUUID()}`;
  const backup = `${targetDir}.old-${randomUUID()}`;
  await mkdir(tmpDir, { recursive: true });
  try {
    await build(tmpDir);
    if (!existsSync(join(tmpDir, "SKILL.md"))) {
      throw new Error(`Install did not produce SKILL.md under ${tmpDir}`);
    }
    if (existsSync(targetDir)) await rename(targetDir, backup);
    try {
      await rename(tmpDir, targetDir);
    } catch (err) {
      if (existsSync(backup)) await rename(backup, targetDir);
      throw err;
    }
    if (existsSync(backup)) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Write every file of an in-memory skill package into a target directory, creating parent dirs. */
async function writePackageFiles(tmpDir: string, files: SkillPackageFile[]): Promise<void> {
  for (const file of files) {
    const dest = join(tmpDir, file.relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content, "utf8");
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
    force: flags.has("--force"),
  };
}

/** Best-effort read of skills.safety config; defaults on failure. */
export async function loadSafetyConfig(): Promise<{
  requireConfirmation: boolean;
  scanScripts: boolean;
  denyNetwork: boolean;
  sandboxTimeoutMs: number;
}> {
  try {
    const { loadConfig } = await import("../../../config/loader.js");
    const config = await loadConfig(process.cwd());
    const safety = config.skills?.safety;
    return {
      requireConfirmation: safety?.requireConfirmation ?? true,
      scanScripts: safety?.scanScripts ?? true,
      denyNetwork: safety?.denyNetwork ?? true,
      sandboxTimeoutMs: safety?.sandboxTimeoutMs ?? 30_000,
    };
  } catch {
    return { requireConfirmation: true, scanScripts: true, denyNetwork: true, sandboxTimeoutMs: 30_000 };
  }
}

/**
 * Run the safety gate for a resolved skill, record the decision to evidence,
 * and return the outcome. The caller writes files only on "approve".
 */
async function gateAndRecordInstall(params: {
  name: string;
  source: string;
  manifest: SkillManifest | null;
  packageFiles?: SkillPackageFile[];
  sourceDir?: string;
  skillsDir: string;
  force: boolean;
  trustLevel: TrustLevel;
  sourceLabel: string;
}): Promise<"approve" | "deny"> {
  const safety = await loadSafetyConfig();
  const manifest = params.manifest;
  if (!manifest) throw new Error("Source does not contain a valid skill manifest");

  const manifestReport = checkManifest(manifest, { core: params.trustLevel === "core" });
  let scan: SkillScanResult | null = null;
  if (safety.scanScripts) {
    if (params.packageFiles && params.packageFiles.length > 0) {
      scan = scanSkillFiles(params.packageFiles);
    } else if (params.sourceDir) {
      scan = await scanSkillDirectory(params.sourceDir, { excluded: EXCLUDED_DIRS });
    }
  }

  const gate = createInstallGate();
  const outcome = await gate({
    name: params.name,
    source: params.source,
    trust: { level: params.trustLevel, sourceLabel: params.sourceLabel, reason: "" },
    manifest: manifestReport,
    scan,
    force: params.force,
    interactive: Boolean(process.stdin.isTTY),
    requireConfirmation: safety.requireConfirmation,
  });

  const evidenceDir = join(params.skillsDir, "..", "security");
  // Build the record without any `undefined` values — the evidence store's
  // canonical JSON serializer rejects undefined, so omit the optional license
  // key entirely when the manifest declares none.
  const record: SkillInstallRecord = {
    skillName: params.name,
    source: params.source,
    trustLevel: params.trustLevel,
    manifestName: manifest.name,
    manifestVersion: manifest.version,
    requestedTools: manifestReport.requestedTools,
    scanOk: scan ? scan.ok : true,
    scanErrorCount: scan ? scan.errorCount : 0,
    scanWarningCount: scan ? scan.warningCount : 0,
    filesScanned: scan?.filesScanned ?? 0,
    approved: outcome === "approve",
    force: params.force,
    reason: outcome === "approve" ? "approved" : "blocked",
  };
  if (manifestReport.license !== undefined) {
    record.license = manifestReport.license;
  }
  await new SkillInstallHistory(evidenceDir).recordInstall(record);

  return outcome;
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
    await installFromSource(opts.from, opts.name, skillsDir, opts.force ?? false);
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
    // Package-first (Task 4): prefer the full package (SKILL.md + scripts/ +
    // assets/ + LICENSE) when the marketplace repo has skills/<name>/; fall
    // back to the single-file fetch for genuinely single-file skills.
    const pkgHit = await resolveSkillPackageInMarketplaces(opts.name, marketplaces);
    let content: string;
    let repoUrl: string;
    let packageFiles: SkillPackageFile[] | undefined;
    if (pkgHit) {
      repoUrl = pkgHit.repoUrl;
      packageFiles = pkgHit.pkg.files;
      content = packageFiles.find((f) => f.relPath === "SKILL.md")?.content ?? "";
    } else {
      ({ repoUrl, content } = await resolveSkillInMarketplaces(opts.name, marketplaces));
    }
    const { manifest } = parseSkillContent(content);
    if (!manifest) {
      throw new Error(`Marketplace skill '${opts.name}' has no valid manifest`);
    }
    const trust = assessTrust(repoUrl, {
      marketplaces,
      verifiedUrls: DEFAULT_MARKETPLACES.map((m) => m.url),
    });
    const outcome = await gateAndRecordInstall({
      name: opts.name,
      source: repoUrl,
      manifest,
      packageFiles,
      skillsDir,
      force: opts.force ?? false,
      trustLevel: trust.level,
      sourceLabel: trust.sourceLabel,
    });
    if (outcome === "deny") {
      throw new Error(
        `Skill install blocked: ${opts.name} from ${repoUrl}. Re-run with --force to override the trust confirmation.`,
      );
    }
    await atomicInstallSkill(destDir, async (tmpDir) => {
      if (packageFiles) {
        await writePackageFiles(tmpDir, packageFiles);
      } else {
        await writeFile(join(tmpDir, "SKILL.md"), content, "utf8");
      }
    });
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
  alix skills run <name> <script> [args...]          Run a skill script sandboxed (no network, temp HOME, timeout)
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
async function installFromSource(source: string, name: string | undefined, skillsDir: string, force: boolean): Promise<void> {
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
    // A github.com blob/tree URL installs the whole package: enumerate the
    // skill dir's files and fetch them all (fetchSkillPackage returns null for
    // a standalone .md blob, an empty dir, or a garbage page, so the
    // single-SKILL.md resolution below still runs). Repo-root URLs,
    // raw.githubusercontent.com, non-GitHub https URLs, and other github.com
    // pages (issues, releases, ...) keep the single-SKILL.md resolution — a
    // garbage page falls through to the HTML-page error, not the package
    // fetch.
    const parsedGithub = parseGithubUrl(source);
    const isGithubDirUrl =
      parsedGithub !== null &&
      parsedGithub.host === "github.com" &&
      (parsedGithub.rest[0] === "blob" || parsedGithub.rest[0] === "tree");
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
  if (packageFiles && name && manifest.name !== name) {
    // Mirror the local misleading-name guard (resolveSkillDir): never install
    // a URL package under a given name that doesn't match its manifest name.
    throw new Error(
      `Skill '${name}' not found at ${source}; the package's manifest name is '${manifest.name}'. Omit --name to install under the manifest name.`,
    );
  }
  const resolvedName = name ?? manifest.name ?? fallbackName;
  if (!resolvedName) {
    throw new Error(`Could not determine a skill name for ${source} — pass one: alix skills install <name> --from <path|url>`);
  }

  const targetDir = join(skillsDir, resolvedName);
  const targetExisted = existsSync(targetDir);
  await mkdir(targetDir, { recursive: true });
  if (sourceIsDir) {
    const [sourceReal, targetReal] = await Promise.all([realpath(sourceDir), realpath(targetDir)]);
    if (sourceReal === targetReal) {
      throw new Error(
        `Source ${source} resolves install target ${targetDir}; skill already installed.`,
      );
    }
  }
  // Layer 3 safety gate: scan + trust + confirmation before anything is written.
  const marketplaces = await loadMarketplaces();
  const trust = assessTrust(source, {
    marketplaces,
    verifiedUrls: DEFAULT_MARKETPLACES.map((m) => m.url),
  });
  const outcome = await gateAndRecordInstall({
    name: resolvedName,
    source,
    manifest,
    packageFiles,
    sourceDir: sourceIsDir ? sourceDir : undefined,
    skillsDir,
    force,
    trustLevel: trust.level,
    sourceLabel: trust.sourceLabel,
  });
  if (outcome === "deny") {
    if (!targetExisted) {
      // The mkdir above exists for the self-copy realpath guard; on a denied
      // install it leaves an empty dir behind. Remove it so a blocked install
      // leaves no trace. Safe: it is empty or freshly created.
      await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    }
    throw new Error(
      `Skill install blocked: ${resolvedName} from ${source}. Re-run with --force to override the trust confirmation (hard scan denials cannot be overridden).`,
    );
  }

  if (sourceIsDir) {
    // Local-directory package source: copy whole skill folder (SKILL.md,
    // scripts/, assets/, LICENSE, ...) minus EXCLUDED_DIRS, atomically.
    await atomicInstallSkill(targetDir, async (tmpDir) => {
      await copyDir(sourceDir, tmpDir);
    });
  } else if (packageFiles) {
    // URL package source: write every fetched file, atomically.
    await atomicInstallSkill(targetDir, async (tmpDir) => {
      await writePackageFiles(tmpDir, packageFiles);
    });
  } else {
    // Single-file source (local .md or fetched content): write just SKILL.md.
    await atomicInstallSkill(targetDir, async (tmpDir) => {
      await writeFile(join(tmpDir, "SKILL.md"), content, "utf8");
    });
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
