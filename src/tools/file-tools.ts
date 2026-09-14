import { existsSync, createReadStream } from "node:fs";
import { readdir, readFile as fsReadFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, join, resolve, relative, sep } from "node:path";
import { minimatch } from "minimatch";
import type { ToolResult, FileMatch } from "./types.js";
import { withRetry } from "../runtime/retry.js";
import { consoleSink, createMultiplexDiagnosticSink } from "../runtime/runtime-diagnostics.js";
import { createDiagnosticStoreSink, DiagnosticEventStore } from "../observability/diagnostic-event-store.js";
import { IGNORED_DIRS, loadGitignore, isIgnoredPath } from "./ignore.js";

const diagSink = createMultiplexDiagnosticSink(
  consoleSink,
  createDiagnosticStoreSink(new DiagnosticEventStore(process.cwd() + "/.alix/diagnostics")),
);

const DEFAULT_GREP_LIMIT = 200;
const DEFAULT_GLOB_LIMIT = 500;
const MAX_SEARCH_LIMIT = 5_000;

function clampLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip a leading inline-flags group (e.g. `(?i)`, `(?-i)`) from a pattern and
 * fold it into the `caseSensitive` flag. JavaScript regexes do not support
 * inline flags, so without this `(?i)TODO` is an invalid pattern and would be
 * silently treated as a literal (returning no matches). Returns the cleaned
 * pattern and the effective case sensitivity.
 */
function stripInlineFlags(
  pattern: string,
  caseSensitive: boolean | undefined,
): { pattern: string; caseSensitive: boolean } {
  let cs = caseSensitive === true;
  let p = pattern;
  const m = /^\(\?([a-z]*)(?:-([a-z]+))?\)/.exec(p);
  if (m) {
    const on = m[1] ?? "";
    const off = m[2] ?? "";
    if (on.includes("i")) cs = false;
    if (off.includes("i")) cs = true;
    p = p.slice(m[0].length);
  }
  return { pattern: p, caseSensitive: cs };
}

/**
 * Walk workspace files (relative paths), skipping ignored directories and
 * gitignored paths. Sequential and bounded by the caller's early exit.
 */
export async function* walkWorkspaceFiles(
  root: string,
  ignorePatterns: string[],
  subdir?: string,
): AsyncGenerator<string> {
  const resolvedRoot = resolve(root);
  const start = subdir ? resolve(resolvedRoot, subdir) : resolvedRoot;
  // Fail closed for a scope that escapes the workspace.
  const relStart = relative(resolvedRoot, start);
  if (relStart === ".." || relStart.startsWith(`..${sep}`) || isAbsolute(relStart)) return;
  async function* walk(dir: string): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(resolvedRoot, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (isIgnoredPath(rel, ignorePatterns)) continue;
        yield* walk(full);
      } else if (entry.isFile()) {
        if (isIgnoredPath(rel, ignorePatterns)) continue;
        yield rel;
      }
    }
  }
  yield* walk(start);
}

/** Stream a file's lines; returns early for binary-looking content (NUL byte). */
async function* readLinesStreaming(path: string): AsyncGenerator<{ lineNumber: number; line: string }> {
  const stream = createReadStream(path, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber++;
      if (lineNumber === 1 && line.includes("\u0000")) return; // binary file
      yield { lineNumber, line };
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

export type GrepSearchArgs = {
  root: string;
  pattern: string;
  caseSensitive?: boolean;
  include?: string[];
  headLimit?: number;
  path?: string;
};

/**
 * Content search across the workspace (#719). Regex by default (falls back
 * to a literal match for invalid regexes), bounded by headLimit.
 */
export async function grepSearch(args: GrepSearchArgs): Promise<ToolResult> {
  const { root } = args;
  const headLimit = clampLimit(args.headLimit, DEFAULT_GREP_LIMIT);
  const normalized = stripInlineFlags(args.pattern, args.caseSensitive);
  const pattern = normalized.pattern;
  const flags = normalized.caseSensitive ? "" : "i";
  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern, flags);
  } catch {
    matcher = new RegExp(escapeRegExp(pattern), flags);
  }
  const include = args.include?.filter(Boolean) ?? [];
  const ignorePatterns = loadGitignore(root);
  const matches: FileMatch[] = [];

  for await (const rel of walkWorkspaceFiles(root, ignorePatterns, args.path)) {
    if (include.length > 0 && !include.some((g) => minimatch(rel, g, { dot: true }))) continue;
    try {
      for await (const { lineNumber, line } of readLinesStreaming(join(root, rel))) {
        if (matcher.test(line)) {
          matches.push({ path: rel, lineNumber, line });
          if (matches.length >= headLimit) return { kind: "success", matches };
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return { kind: "success", matches };
}

export type GlobMatchArgs = {
  root: string;
  pattern: string;
  headLimit?: number;
  path?: string;
};

/**
 * Filename search across the workspace (#720): `*`, `**`, `?`, `{a,b}`
 * against workspace-relative paths, honoring ignore rules. Returns bounded
 * workspace-relative paths (newline-joined output).
 */
export async function globMatch(args: GlobMatchArgs): Promise<ToolResult> {
  const { root, pattern } = args;
  const headLimit = clampLimit(args.headLimit, DEFAULT_GLOB_LIMIT);
  const ignorePatterns = loadGitignore(root);
  const matches: string[] = [];

  for await (const rel of walkWorkspaceFiles(root, ignorePatterns, args.path)) {
    if (minimatch(rel, pattern, { dot: true })) {
      matches.push(rel);
      if (matches.length >= headLimit) break;
    }
  }
  return { kind: "success", output: matches.join("\n") };
}

export async function readFile(args: { root: string; path: string }): Promise<ToolResult> {
  const { root, path } = args;
  const resolvedRoot = resolve(root);

  let resolvedPath: string;
  try {
    resolvedPath = resolve(resolvedRoot, path);
  } catch {
    return { kind: "error", message: `Invalid path: ${path}` };
  }

  const relPath = relative(resolvedRoot, resolvedPath);
  if (relPath === ".." || relPath.startsWith(`..${sep}`) || isAbsolute(relPath)) {
    return { kind: "error", message: `Path is outside workspace: ${path}` };
  }

  if (!existsSync(resolvedPath)) {
    return { kind: "error", message: `File not found: ${path}` };
  }

  try {
    // File reads are idempotent — safe to retry on transient failures
    const content = await withRetry(
      `file.read: ${path}`,
      () => fsReadFile(resolvedPath, "utf8"),
      { maxRetries: 1, baseDelayMs: 200 },
      (d) => diagSink.emit(d),
    );
    return { kind: "success", content };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export type DirSearchArgs = {
  root: string;
  pattern: string;
  extensions: string[];
  headLimit?: number;
  path?: string;
};

/**
 * Substring search across workspace files (#721). Streams each file line by
 * line, shares the ignore walk with grep/glob, and stops as soon as
 * headLimit matches are collected.
 */
export async function searchDir(args: DirSearchArgs): Promise<ToolResult> {
  const { root, extensions } = args;
  const headLimit = clampLimit(args.headLimit, DEFAULT_GREP_LIMIT);
  // Literal substring search. A leading `(?i)` makes it case-insensitive;
  // otherwise matching stays case-sensitive (unchanged default).
  const inline = /^\(\?([a-z]*)\)/.exec(args.pattern);
  const caseInsensitive = inline ? inline[1].includes("i") : false;
  const pattern = inline ? args.pattern.slice(inline[0].length) : args.pattern;
  const needle = caseInsensitive ? pattern.toLowerCase() : pattern;
  const ignorePatterns = loadGitignore(root);
  const matches: FileMatch[] = [];

  for await (const rel of walkWorkspaceFiles(root, ignorePatterns, args.path)) {
    if (extensions.length > 0) {
      const ext = "." + (rel.split(".").pop() ?? "");
      if (!extensions.includes(ext)) continue;
    }
    try {
      for await (const { lineNumber, line } of readLinesStreaming(join(root, rel))) {
        const hay = caseInsensitive ? line.toLowerCase() : line;
        if (hay.includes(needle)) {
          matches.push({ path: rel, lineNumber, line });
          if (matches.length >= headLimit) return { kind: "success", matches };
        }
      }
    } catch {
      // skip binary or unreadable files
    }
  }

  return { kind: "success", matches };
}
