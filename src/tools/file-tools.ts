import { existsSync } from "node:fs";
import { readdir, readFile as fsReadFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { ToolResult, FileMatch } from "./types.js";
import { withRetry } from "../runtime/retry.js";
import { consoleSink } from "../runtime/runtime-diagnostics.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".alix"]);

export async function readFile(args: { root: string; path: string }): Promise<ToolResult> {
  const { root, path } = args;
  const resolvedRoot = resolve(root);

  let resolvedPath: string;
  try {
    resolvedPath = resolve(resolvedRoot, path);
  } catch {
    return { kind: "error", message: `Invalid path: ${path}` };
  }

  if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
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
      (d) => consoleSink.emit(d),
    );
    return { kind: "success", content };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function searchDir(args: { root: string; pattern: string; extensions: string[] }): Promise<ToolResult> {
  const { root, pattern, extensions } = args;
  const matches: FileMatch[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        await walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const ext = "." + (entry.name.split(".").pop() ?? "");
        if (extensions.length > 0 && !extensions.includes(ext)) continue;
        const filePath = join(dir, entry.name);
        const rel = relative(root, filePath);
        try {
          const content = await fsReadFile(filePath, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(pattern)) {
              matches.push({ path: rel, lineNumber: i + 1, line: lines[i] });
            }
          }
        } catch {
          // skip binary or unreadable files
        }
      }
    }
  }

  await walk(root);
  return { kind: "success", matches };
}