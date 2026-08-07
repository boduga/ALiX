import { join, dirname, basename } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  githubRawCandidates,
  fetchSkillFromUrls,
  fetchText,
  fetchJson,
  parseGithubUrl,
  EXCLUDED_DIRS as PACKAGE_EXCLUDED_DIRS,
} from "./net.js";
import { parseSkillContent } from "../../../skills/types.js";

export interface Marketplace {
  name: string;
  url: string;
}

export interface RepoSkill {
  name: string;
  description: string;
  path: string;
  repoUrl: string;
}

export const DEFAULT_MARKETPLACES: readonly Marketplace[] = [
  { name: "anthropics/skills", url: "https://github.com/anthropics/skills" },
  { name: "langfuse/skills", url: "https://github.com/langfuse/skills" },
];

/** Path segments that never count as a repo's skills, even if they contain a SKILL.md. */
export const EXCLUDED_DIRS: readonly string[] = [
  ".git",
  ".github",
  ".cursor",
  ".codex-plugin",
  ".claude-plugin",
  "node_modules",
  "vendor",
  "dist",
  "assets",
  "plugins",
  "template",
];

/** Absolute path to the marketplace registry file for a given home dir. */
export function marketplacesPath(homeDir?: string): string {
  return join(homeDir ?? process.env.HOME ?? "", ".alix", "marketplaces.json");
}

function isMarketplace(m: unknown): m is Marketplace {
  return (
    typeof m === "object" &&
    m !== null &&
    typeof (m as Marketplace).name === "string" &&
    typeof (m as Marketplace).url === "string"
  );
}

/** Persist the given marketplaces to disk, creating ~/.alix as needed. */
export async function saveMarketplaces(mps: Marketplace[], homeDir?: string): Promise<void> {
  const p = marketplacesPath(homeDir);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(mps, null, 2) + "\n", "utf8");
}

/**
 * Load the registered marketplaces. Seeds DEFAULT_MARKETPLACES on first use
 * and tolerates a missing/corrupt/empty file — never crashes.
 */
export async function loadMarketplaces(homeDir?: string): Promise<Marketplace[]> {
  const p = marketplacesPath(homeDir);
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch {
    return seedDefaults(homeDir);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return seedDefaults(homeDir);
  }
  if (Array.isArray(parsed)) {
    const mps = parsed.filter(isMarketplace);
    // A valid registry is a non-empty array whose every entry is valid; a
    // partially-invalid or empty array is treated as corrupt and reseeded.
    if (mps.length === parsed.length && mps.length > 0) return mps;
  }
  return seedDefaults(homeDir);
}

async function seedDefaults(homeDir?: string): Promise<Marketplace[]> {
  const seeded = [...DEFAULT_MARKETPLACES];
  await saveMarketplaces(seeded, homeDir);
  return seeded;
}

/** Normalize a marketplace URL for duplicate comparison (owner/repo, https github.com). */
function normalizeUrl(url: string): string {
  const parsed = parseGithubUrl(url);
  if (!parsed) return url;
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

/**
 * Register a new marketplace. Throws on invalid input (empty name, non-https,
 * non-github.com host). Duplicates (by name or normalized URL) return
 * { added: false } without persisting.
 */
export async function addMarketplace(
  name: string,
  url: string,
  homeDir?: string,
): Promise<{ added: boolean; marketplaces: Marketplace[] }> {
  if (!name || name.trim().length === 0) {
    throw new Error("Marketplace name is required");
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:") {
    throw new Error("Marketplace URL must use https:// (plain http is rejected)");
  }
  if (u.hostname.toLowerCase() !== "github.com") {
    throw new Error(`Marketplace URL must be a github.com repository (got ${u.hostname})`);
  }
  const current = await loadMarketplaces(homeDir);
  if (current.some((m) => m.name === name)) {
    return { added: false, marketplaces: current };
  }
  const normalized = normalizeUrl(url);
  if (current.some((m) => normalizeUrl(m.url) === normalized)) {
    return { added: false, marketplaces: current };
  }
  const marketplaces = [...current, { name, url }];
  await saveMarketplaces(marketplaces, homeDir);
  return { added: true, marketplaces };
}

/** Unregister a marketplace. Throws when the name is not registered. */
export async function removeMarketplace(
  name: string,
  homeDir?: string,
): Promise<{ removed: boolean; marketplaces: Marketplace[] }> {
  const current = await loadMarketplaces(homeDir);
  if (!current.some((m) => m.name === name)) {
    throw new Error(`Marketplace '${name}' is not registered`);
  }
  const marketplaces = current.filter((m) => m.name !== name);
  await saveMarketplaces(marketplaces, homeDir);
  return { removed: true, marketplaces };
}

type TreeEntry = { path: string; type: string };
type TreesResponse = { tree: TreeEntry[]; truncated?: boolean };

/**
 * Discover categories in a marketplace repo by walking its recursive git
 * tree. A `category` is a top-level `skills/<X>/` directory that has a
 * SKILL.md two levels deep under it — i.e. some `skills/<X>/<Y>/SKILL.md`
 * path exists. This means `<X>` is a category (e.g. mattpocock's
 * `engineering`) and `<Y>` is a skill within it (e.g. `wayfinder`).
 *
 * Marketplaces whose skills live directly at `skills/<name>/SKILL.md`
 * (superpowers/obra-style flat layout) return an empty array — their
 * top-level `skills/<X>/` directories are skills themselves, not
 * categories, and probing `skills/<X>/<name>/SKILL.md` against them
 * would always 404. (The static per-name probe in `githubRawCandidates`
 * already reaches them.)
 *
 * Returns an empty array when the repo has no `skills/` root, when the
 * tree fetch fails, or when no categories exist. Used by
 * `resolveSkillInMarketplaces` to extend the install probe to 2-deep
 * layouts like `skills/engineering/<name>/SKILL.md` (mattpocock).
 */
export async function listMarketplaceCategories(repoUrl: string): Promise<string[]> {
  try {
    const parsed = parseRepoUrl(repoUrl);
    const treesUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/HEAD?recursive=1`;
    const res = await fetchJson<TreesResponse>(treesUrl);
    const tree = res.tree ?? [];
    // A directory at `skills/<X>/` is a category only when there's a
    // SKILL.md two levels deep: `skills/<X>/<Y>/SKILL.md`. This excludes
    // marketplaces whose skills live directly at `skills/<name>/SKILL.md`
    // (superpowers/obra-style flat layout) — those are skills themselves,
    // not categories. Probing `skills/<X>/<name>/SKILL.md` against them
    // would always 404 because the layout is `skills/<name>/`, not
    // `skills/<X>/<name>/`.
    const categories = new Set<string>();
    for (const entry of tree) {
      if (entry.type !== "blob") continue;
      const m = entry.path.match(/^skills\/([^/]+)\/[^/]+\/SKILL\.md$/);
      if (m) categories.add(m[1]);
    }
    return [...categories];
  } catch {
    return [];
  }
}

/** Parse a github.com repo URL into { owner, repo }, throwing otherwise. */
function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed || parsed.host !== "github.com") {
    throw new Error(`Not a GitHub repo URL: ${repoUrl}`);
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

/**
 * List skills in a GitHub repo by walking its recursive git tree. A skill is a
 * SKILL.md blob whose path has no excluded segment. Candidates are fetched
 * sequentially (capped at opts.limit ?? 50 successfully parsed) and validated
 * as a skill manifest. Throws when the trees API call fails; raw-fetch or
 * parse failures for individual skills are skipped.
 */
export async function listRepoSkills(repoUrl: string, opts?: { limit?: number }): Promise<RepoSkill[]> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const treesUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
  const res = await fetchJson<TreesResponse>(treesUrl);
  const limit = opts?.limit ?? 50;
  const results: RepoSkill[] = [];
  for (const entry of res.tree ?? []) {
    if (entry.type !== "blob" || !entry.path.endsWith("/SKILL.md")) continue;
    if (entry.path.split("/").some((seg) => EXCLUDED_DIRS.includes(seg))) continue;
    if (results.length >= limit) break;
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${entry.path}`;
      const { content } = await fetchText(rawUrl);
      const { manifest } = parseSkillContent(content);
      if (manifest) {
        results.push({ name: manifest.name, description: manifest.description, path: entry.path, repoUrl });
      }
    } catch {
      // Skip a skill whose raw fetch or manifest parse failed.
    }
  }
  return results;
}

export interface SkillPackageFile {
  /** Path relative to the skill directory (e.g. "scripts/recalc.py"). */
  relPath: string;
  content: string;
}

export interface SkillPackage {
  /** Derived skill name: opts.name, else the skill directory basename. */
  name: string;
  files: SkillPackageFile[];
}

/** Cap on the total fetched package size to bound memory (20MB). */
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;

/**
 * Resolve the skill directory and ref inside a GitHub repo from a parsed
 * github.com path, or undefined when the URL doesn't point at a skill
 * directory:
 *   repo-root (rest empty)          → skills/<name>/ when a name is given
 *   blob/tree/{ref}/{path...}       → the {path...} (a trailing SKILL.md is
 *                                    dropped), ref = {ref} or HEAD when absent
 *   any other github.com path       → undefined (issues/releases/actions pages)
 * undefined results (non-github hosts, raw.githubusercontent, a bare repo root
 * without a name, a blob/tree URL with no path, or a non blob/tree page) let
 * callers fall back to the single-SKILL.md resolution.
 */
/**
 * Parse the trailing `rest` of a github.com URL (the part after the owner/repo)
 * into a tree-reference shape: the ref segment and the path segments under
 * it. Returns undefined when `rest` doesn't look like a tree/blob URL —
 * e.g. it's a repo-root URL (empty `rest`) or some other github.com page
 * (issues, releases, actions). Used by both `skillDirFromGithubUrl` and the
 * 2-deep fallback in `resolveSkillInMarketplaces` so the URL-shape
 * classification lives in one place.
 */
function parseTreeRef(
  rest: string[],
): { ref: string; segments: string[] } | undefined {
  if (rest[0] !== "blob" && rest[0] !== "tree") return undefined;
  return { ref: rest[1] ?? "HEAD", segments: rest.slice(2) };
}

/**
 * Resolve a github.com URL to the skill directory the marketplace convention
 * expects. Supports three marketplace shapes:
 *   - repo-root URL (`https://github.com/owner/repo`) + name → `skills/<name>`
 *   - parent-dir tree URL (`tree/main/skills`) + name → `skills/<name>`
 *   - direct skill URL (`tree/main/<name>` or `tree/main/skills/<name>`) → use as-is
 * Returns undefined for unparseable URLs (issues, releases, blob of SKILL.md
 * at a non-skill path, etc.) so callers fall back to the single-SKILL.md
 * resolution.
 */
function skillDirFromGithubUrl(
  rest: string[],
  name?: string,
): { skillDir: string; ref: string } | undefined {
  if (rest.length === 0) {
    return name ? { skillDir: `skills/${name}`, ref: "HEAD" } : undefined;
  }
  const tree = parseTreeRef(rest);
  if (!tree) return undefined;
  const { ref, segments } = tree;
  // Drop a trailing SKILL.md segment for `blob/.../SKILL.md` URLs —
  // the skill dir is the parent.
  if (segments[segments.length - 1] === "SKILL.md") segments.pop();
  if (segments.length === 0) return undefined;
  // Three shapes resolve to the skill dir:
  //   - one segment, last != name → parent dir, append name
  //     (e.g. `tree/main/skills` + name="brainstorming" → "skills/brainstorming")
  //   - one segment, last == name → direct skill URL, use as-is
  //     (e.g. `tree/main/brainstorming` + name="brainstorming" → "brainstorming")
  //   - many segments → deeper URL already at the skill dir, use as-is
  //     (e.g. `tree/main/skills/brainstorming` → "skills/brainstorming")
  if (name && segments.length === 1 && segments[0] !== name) {
    return { skillDir: `${segments[0]}/${name}`, ref };
  }
  return { skillDir: segments.join("/"), ref };
}

/**
 * Fetch a whole skill package (SKILL.md + scripts/, assets/, LICENSE, ...) from
 * a GitHub blob/tree URL by walking the repo's recursive git tree at the URL's
 * ref (HEAD when none is given) and fetching every file under the skill
 * directory from raw.githubusercontent.com, honoring the package-safe
 * EXCLUDED_DIRS. Returns null when the source isn't a GitHub skill-dir URL
 * (repo root without a name, a non blob/tree page such as issues, a
 * raw.githubusercontent.com URL, or a non-github.com host) or when the derived
 * skill dir has no SKILL.md blob in the tree (a standalone .md file, an empty
 * dir, ...) so callers can fall back to single-file fetch. Throws on a failed
 * trees/raw fetch or when the package exceeds opts.maxBytes.
 */
export async function fetchSkillPackage(
  repoUrlOrPath: string,
  opts?: { name?: string; maxBytes?: number },
): Promise<SkillPackage | null> {
  const parsed = parseGithubUrl(repoUrlOrPath);
  if (!parsed || parsed.host !== "github.com") return null;
  const resolved = skillDirFromGithubUrl(parsed.rest, opts?.name);
  if (resolved === undefined) return null;
  const { skillDir, ref } = resolved;

  const treesUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${ref}?recursive=1`;
  const { tree } = await fetchJson<TreesResponse>(treesUrl);
  const entries = tree ?? [];

  // Fail fast: the skill dir must contain a SKILL.md blob, else this isn't a
  // package (a standalone .md file, an empty dir, a garbage page, ...). Return
  // null BEFORE fetching any blobs so callers fall back to single-file fetch.
  if (!entries.some((e) => e.type === "blob" && e.path === `${skillDir}/SKILL.md`)) {
    return null;
  }

  const prefix = `${skillDir}/`;
  const maxBytes = opts?.maxBytes ?? MAX_PACKAGE_BYTES;
  const files: SkillPackageFile[] = [];
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== "blob" || !entry.path.startsWith(prefix)) continue;
    const relPath = entry.path.slice(prefix.length);
    if (!relPath || relPath.split("/").some((seg) => PACKAGE_EXCLUDED_DIRS.includes(seg))) continue;
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${ref}/${entry.path}`;
    const { content } = await fetchText(rawUrl);
    total += Buffer.byteLength(content, "utf8");
    if (total > maxBytes) {
      throw new Error(`Skill package under ${repoUrlOrPath} exceeds ${maxBytes} bytes`);
    }
    files.push({ relPath, content });
  }

  // Defensive: the SKILL.md prescan above guarantees at least one file.
  if (files.length === 0) {
    throw new Error(`No SKILL.md found under ${repoUrlOrPath}`);
  }
  const name = opts?.name ?? basename(skillDir);
  return { name, files };
}

/**
 * Resolve a skill name against registered marketplaces, returning the first
 * repo that yields a valid SKILL.md. Aggregated error when none do.
 */
export async function resolveSkillInMarketplaces(
  name: string,
  marketplaces: Marketplace[],
): Promise<{ repoUrl: string; content: string }> {
  const failures: string[] = [];
  for (const mp of marketplaces) {
    const candidates = githubRawCandidates(mp.url, name);
    if (candidates) {
      try {
        const content = await fetchSkillFromUrls(candidates, mp.url, name);
        return { repoUrl: mp.url, content };
      } catch (e) {
        // Static 3-path probe failed. Some marketplaces (mattpocock) layer
        // skills under `skills/<category>/<name>/SKILL.md` — neither the
        // root path, root `<name>/`, nor `skills/<name>/` probe can reach
        // them. Discover categories from the marketplace's recursive tree
        // and try `<subdir>/<category>/<name>/SKILL.md` per category before
        // recording the marketplace as failed. The tree fetch only happens
        // when the static paths fail (one extra HTTP round-trip on the
        // uncommon path), keeping the common path zero-overhead. The subdir
        // is the path components of the tree URL (e.g. `skills` for a
        // marketplace URL `tree/main/skills`), or `skills` for a repo-root
        // marketplace URL — matching the convention that the listed
        // marketplace entries land under a `skills/` namespace.
        const parsed = parseGithubUrl(mp.url);
        if (parsed) {
          // For tree URLs (e.g. `tree/main/skills`), use the URL's ref
          // (defaulting to `HEAD`) and the subdir path components as the
          // 2-deep base. For repo-root URLs, default ref=`HEAD` and
          // subdir=`skills` to match the convention that listed
          // marketplace entries land under a `skills/` namespace.
          let ref = "HEAD";
          let subdir = "skills";
          const tree = parseTreeRef(parsed.rest);
          if (tree && tree.segments.length > 0) {
            ref = tree.ref;
            subdir = tree.segments.join("/");
          }
          const categories = await listMarketplaceCategories(mp.url);
          if (categories.length > 0) {
            const base = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${ref}/${subdir}/`;
            const deepCandidates = categories.map((c) => `${base}${c}/${name}/SKILL.md`);
            try {
              const content = await fetchSkillFromUrls(deepCandidates, mp.url, name);
              return { repoUrl: mp.url, content };
            } catch (e2) {
              failures.push(`  ${mp.name} (${mp.url}): ${e instanceof Error ? e.message : String(e)}`);
              continue;
            }
          }
        }
        failures.push(`  ${mp.name} (${mp.url}): ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      failures.push(`  ${mp.name} (${mp.url}): not a GitHub repo URL`);
    }
  }
  throw new Error(
    `Could not find skill '${name}' in ${marketplaces.length} registered marketplaces.\n${failures.join("\n")}\n` +
      `\nThe skill name may be misspelled. Check it with: alix skills available\n` +
      `Or install by explicit repo path: alix skills install <name> --from <repo-url>`,
  );
}

/** Truncate a skill description to a scannable one-liner for listings. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Print skills across marketplaces, grouped, tolerating per-marketplace failures. */
export async function listAvailableSkills(
  marketplaces?: Marketplace[],
  opts?: { limit?: number },
): Promise<void> {
  const mps = marketplaces ?? (await loadMarketplaces());
  for (const mp of mps) {
    try {
      const skills = await listRepoSkills(mp.url, { limit: opts?.limit });
      console.log(`\n${mp.name} (${mp.url}):`);
      for (const skill of skills) {
        console.log(`  ${skill.name.padEnd(24)} ${truncate(skill.description, 120)}`);
      }
    } catch (e) {
      console.error(
        `Failed to list skills for ${mp.name} (${mp.url}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  console.log("\nInstall with: alix skills install <skill>");
}

/** Dispatch a marketplace subcommand (list/add/remove) with console output. */
export async function runMarketplaceCommand(
  action: "list" | "add" | "remove",
  name?: string,
  url?: string,
  homeDir?: string,
): Promise<void> {
  if (action === "list") {
    const mps = await loadMarketplaces(homeDir);
    for (const mp of mps) console.log(`${mp.name} ${mp.url}`);
    return;
  }
  if (action === "add") {
    if (!name || !url) throw new Error("Usage: alix skills marketplace add <name> <url>");
    const { added, marketplaces } = await addMarketplace(name, url, homeDir);
    console.log(
      added ? `Added marketplace '${name}' (${url})` : `Marketplace '${name}' is already registered`,
    );
    for (const mp of marketplaces) console.log(`${mp.name} ${mp.url}`);
    return;
  }
  if (action === "remove") {
    if (!name) throw new Error("Usage: alix skills marketplace remove <name>");
    const { marketplaces } = await removeMarketplace(name, homeDir);
    console.log(`Removed marketplace '${name}'`);
    for (const mp of marketplaces) console.log(`${mp.name} ${mp.url}`);
    return;
  }
  throw new Error(`Unknown marketplace action: ${action}`);
}

/**
 * Resolve a skill as a full package across registered marketplaces, returning
 * the first marketplace whose repo has the skill under `skills/<name>/`
 * (via fetchSkillPackage's GitHub tree walk). Returns null when no marketplace
 * yields a package — the caller falls back to the single-file resolution
 * (resolveSkillInMarketplaces) for genuinely single-file skills. Per-marketplace
 * fetch failures are swallowed; the next marketplace is tried.
 */
export async function resolveSkillPackageInMarketplaces(
  name: string,
  marketplaces: Marketplace[],
): Promise<{ repoUrl: string; pkg: SkillPackage } | null> {
  for (const mp of marketplaces) {
    try {
      const pkg = await fetchSkillPackage(mp.url, { name });
      if (pkg) return { repoUrl: mp.url, pkg };
    } catch {
      // trees/raw failure for this marketplace — try the next.
    }
  }
  return null;
}
