/**
 * ignore.ts — Shared workspace ignore rules (#721).
 *
 * One definition of "what the workspace search surface ignores" so content
 * search (grep.search/dir.search), filename search (glob.match), and the
 * RepoMap walk agree. Directory names + root `.gitignore` patterns.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { minimatch } from "minimatch";

/** Directory names never traversed by any workspace walk. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".alix",
]);

/**
 * Load root-level .gitignore patterns (comments/blank/negation lines
 * dropped). A lightweight subset of gitignore semantics.
 */
export function loadGitignore(root: string): string[] {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
  } catch {
    return [];
  }
}

/** True when a workspace-relative path matches any ignore pattern. */
export function isIgnoredPath(relPath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = relPath.split(sep).join("/");
  for (const pattern of patterns) {
    const p = pattern.replace(/\/$/, "");
    if (!p) continue;
    if (minimatch(normalized, p, { dot: true })) return true;
    // Directory patterns also ignore their contents.
    if (minimatch(normalized, `${p}/**`, { dot: true })) return true;
  }
  return false;
}
