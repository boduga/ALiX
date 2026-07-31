/**
 * src/utils/dir-search.ts
 *
 * Retry-based directory search utility.
 * Recursively searches a directory for files matching a glob-like pattern,
 * re-executing the search until a match is found or retries are exhausted.
 *
 * No external runtime dependencies — uses only Node.js built-ins.
 * Compatible with the existing `file-tools.ts` search infrastructure.
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirSearchOptions {
  /** Absolute or relative path to the directory to search. */
  dir: string;
  /**
   * File-name glob-like pattern to search for.
   * Supports `*` as a wildcard (matches any characters within the filename).
   * Examples: "*.ts", "README*", "config.*", "test-*.vitest.ts"
   */
  pattern: string;
  /** Milliseconds to wait between retries (default: 2000). */
  retryInterval?: number;
  /** Maximum number of retry attempts (default: 5). */
  maxRetries?: number;
}

export interface DirSearchResult {
  /** True if at least one matching file was found. */
  found: boolean;
  /** Relative file paths (relative to `dir`) that matched the pattern. */
  files: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".alix",
  ".claude",
]);

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

/**
 * Convert a glob-like pattern to a RegExp for matching file names.
 * Supports:
 *   - `*`  — matches any sequence of characters (except path separators)
 *   - Literal characters match themselves
 *
 * More complex patterns (e.g., `**`, `?`, `{a,b}`) are NOT supported to
 * avoid external dependencies. Use `*` for broad matching or literal names
 * for exact matching.
 */
function patternToRegex(pattern: string): RegExp {
  // Escape all regex-special characters except `*`
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Convert `*` to `.*`
  const regexStr = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`);
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recursively walk a directory tree and collect file paths (relative to `root`)
 * whose names match the given RegExp pattern.
 */
async function walkDir(
  dir: string,
  patternRe: RegExp,
  root: string,
): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied, symlink loop, etc. — skip silently
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        const subResults = await walkDir(join(dir, entry.name), patternRe, root);
        results.push(...subResults);
      }
    } else if (entry.isFile()) {
      if (patternRe.test(entry.name)) {
        results.push(relative(root, join(dir, entry.name)));
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search a directory recursively for files whose names match the given pattern.
 *
 * The search is repeated (with a configurable delay between attempts) until
 * at least one matching file is found or `maxRetries` attempts are exhausted.
 *
 * @returns An object with `found` (boolean) and `files` (relative file paths).
 *
 * @example
 * ```ts
 * const result = await searchDirWithRetry({
 *   dir: "/home/user/project",
 *   pattern: "*.ts",
 *   retryInterval: 1000,
 *   maxRetries: 3,
 * });
 * // → { found: true, files: ["src/index.ts", "src/utils/helper.ts"] }
 * ```
 */
export async function searchDirWithRetry(
  options: DirSearchOptions,
): Promise<DirSearchResult> {
  const {
    dir,
    pattern,
    retryInterval = 2000,
    maxRetries = 5,
  } = options;

  const resolvedDir = resolve(dir);

  // If the directory doesn't exist, return immediately
  if (!existsSync(resolvedDir)) {
    return { found: false, files: [] };
  }

  const patternRe = patternToRegex(pattern);

  // First attempt
  let files = await walkDir(resolvedDir, patternRe, resolvedDir);
  if (files.length > 0) {
    return { found: true, files };
  }

  // Retry loop with polling
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await sleep(retryInterval);

    files = await walkDir(resolvedDir, patternRe, resolvedDir);
    if (files.length > 0) {
      return { found: true, files };
    }
  }

  // No matches found after all retries
  return { found: false, files: [] };
}
