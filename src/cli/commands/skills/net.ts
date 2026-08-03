import { parseSkillContent } from "../../../skills/types.js";

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
  let u: URL;
  try {
    u = new URL(source);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "raw.githubusercontent.com") return [source];
  if (host !== "github.com") return null;

  const seg = u.pathname.replace(/\.git$/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (seg.length < 2) return null;
  const [owner, repo, ...rest] = seg;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = res.headers.get("content-length");
  if (len && Number(len) > 1_000_000) {
    throw new Error(`response larger than 1MB`);
  }
  const content = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  return { content, isHtml: ctype.includes("text/html") };
}

/** Fetch a JSON payload over https with a 15s timeout. Always sends a UA (GitHub requires one for api.github.com). */
export async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "alix", ...headers } });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
