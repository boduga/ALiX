import { parseSkillContent } from "../../../skills/types.js";

/**
 * Top-level directory entries that are never copied when installing a skill
 * package, whether from a local directory (install.ts copyDir) or a GitHub
 * URL (marketplace.ts fetchSkillPackage). Package-safe: keeps vendored /
 * generated / tooling cruft out of ~/.alix/skills/<name> while preserving
 * assets/ and scripts/. Deliberately distinct from marketplace.ts's
 * EXCLUDED_DIRS, which is the *listing* exclusion (drops assets/template) and
 * must NOT be used for installing.
 */
export const EXCLUDED_DIRS: readonly string[] = [
  ".git",
  ".github",
  ".DS_Store",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".pytest_cache",
  "dist",
  "build",
];

export interface ParsedGithubUrl {
  host: "github.com" | "raw.githubusercontent.com";
  owner: string;
  repo: string;
  /** path segments after {owner}/{repo} */
  rest: string[];
}

/**
 * Parse a github.com or raw.githubusercontent.com URL into its owner, repo, and
 * remaining path. Returns null when the URL isn't GitHub-shaped. Normalizes a
 * trailing `.git` and trailing slashes — the one shared URL-transform used by
 * githubRawCandidates, parseRepoUrl, and normalizeUrl.
 */
export function parseGithubUrl(source: string): ParsedGithubUrl | null {
  let u: URL;
  try {
    u = new URL(source);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "raw.githubusercontent.com") return null;
  const seg = u.pathname.replace(/\.git$/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (seg.length < 2) return null;
  const [owner, repo, ...rest] = seg;
  return { host, owner, repo, rest };
}

/** Reject anything but https — fetched skill content is trusted and injected into prompts. */
function assertHttps(url: string): void {
  let proto: string;
  try {
    proto = new URL(url).protocol;
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (proto !== "https:") throw new Error(`Only https URLs are allowed: ${url}`);
}

/**
 * Resolve a github.com URL into candidate raw.githubusercontent.com URLs to
 * look for a SKILL.md, or null when the source isn't GitHub-shaped.
 *
 * Handles:
 *   github.com/{owner}/{repo}                      → /HEAD/SKILL.md, plus
 *                                                    /HEAD/{name}/SKILL.md and
 *                                                    /HEAD/skills/{name}/SKILL.md when a name is given
 *   github.com/{owner}/{repo}/blob/{ref}/{path}    → the blob if it's a .md/SKILL.md, else <path>/SKILL.md
 *   github.com/{owner}/{repo}/tree/{ref}/{path}    → <path>/SKILL.md
 *   raw.githubusercontent.com/...                  → as-is
 *
 * Note: {ref} is taken as the first path segment after blob/tree, so branch
 * names containing "/" are not supported here — use a raw.githubusercontent.com
 * URL for those.
 */
export function githubRawCandidates(source: string, name?: string): string[] | null {
  const parsed = parseGithubUrl(source);
  if (!parsed) return null;
  if (parsed.host === "raw.githubusercontent.com") return [source];
  const { owner, repo, rest } = parsed;
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/`;

  const candidates: string[] = [];
  if (rest.length === 0) {
    candidates.push(base + "HEAD/SKILL.md");
    if (name) {
      candidates.push(base + `HEAD/${name}/SKILL.md`);
      candidates.push(base + `HEAD/skills/${name}/SKILL.md`);
    }
  } else if (rest[0] === "blob" || rest[0] === "tree") {
    const kind = rest[0];
    const ref = rest[1] ?? "HEAD";
    const p = rest.slice(2);
    const r = base + ref + "/";
    if (kind === "blob") {
      const last = p[p.length - 1] ?? "";
      if (last === "SKILL.md" || last.endsWith(".md")) {
        candidates.push(r + p.join("/"));
      } else {
        candidates.push(r + p.join("/"));
        candidates.push(r + [...p, "SKILL.md"].join("/"));
      }
    } else {
      candidates.push(r + [...p, "SKILL.md"].join("/"));
    }
  } else {
    return null; // some other github.com page (actions, releases, issues, …)
  }
  return candidates;
}

/**
 * Fetch and validate a skill from a list of candidate URLs, returning the
 * first whose content parses as a skill manifest. Throws a helpful error when
 * none do.
 */
export async function fetchSkillFromUrls(urls: string[], sourceLabel: string, name?: string): Promise<string> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const { content, isHtml } = await fetchText(url);
      if (parseSkillContent(content).manifest) return content;
      failures.push(isHtml ? `${url} (returned an HTML page, not a skill)` : `${url} (not a valid skill manifest)`);
    } catch (e) {
      failures.push(`${url} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const tried = name
    ? `Tried ${urls.length} location(s) for skill '${name}' under ${sourceLabel}.`
    : `Tried ${urls.length} location(s) under ${sourceLabel}.`;
  throw new Error(
    `Could not find a valid SKILL.md.\n${tried}\n` +
    `For a GitHub repo, pass the skill name for multi-skill repos: alix skills install <name> --from <repo-url>\n` +
    `Failures:\n  ${failures.join("\n  ")}`,
  );
}

/** Fetch a remote text payload over https with a 15s timeout and 1MB cap. */
export async function fetchText(url: string): Promise<{ content: string; isHtml: boolean }> {
  assertHttps(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = res.headers.get("content-length");
    if (len && Number(len) > 1_000_000) {
      throw new Error(`response larger than 1MB`);
    }
    // Keep the timeout alive through the body read so a mid-body stall aborts too.
    const content = await res.text();
    const ctype = res.headers.get("content-type") ?? "";
    return { content, isHtml: ctype.includes("text/html") };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch a JSON payload over https with a 15s timeout. Always sends a UA (GitHub requires one for api.github.com). */
export async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  assertHttps(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "alix", ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Keep the timeout alive through the body read so a mid-body stall aborts too.
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
