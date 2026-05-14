import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type RepoFileKind = "source" | "test" | "config" | "docs" | "asset" | "unknown";

export type RepoFileSummary = {
  path: string;
  kind: RepoFileKind;
  language?: string;
  sizeBytes: number;
  lineCount?: number;
};

export type SymbolSummary = {
  path: string;
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  line?: number;
};

export type RepoMapLite = {
  root: string;
  generatedAt: string;
  files: RepoFileSummary[];
  configFiles: string[];
  docsFiles: string[];
  testFiles: string[];
  sourceFiles: string[];
  topLevelSymbols: SymbolSummary[];
};

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

export async function buildRepoMapLite(root: string): Promise<RepoMapLite> {
  const paths = await walk(root);
  const files: RepoFileSummary[] = [];
  const topLevelSymbols: SymbolSummary[] = [];

  for (const path of paths) {
    const fullPath = join(root, path);
    const info = await stat(fullPath);
    const text = await readTextIfSmall(fullPath, info.size);
    const lineCount = text ? text.split("\n").length : undefined;
    const kind = classify(path);
    files.push({ path, kind, language: languageFor(path), sizeBytes: info.size, lineCount });
    if (text && kind === "source") {
      topLevelSymbols.push(...extractSymbols(path, text));
    }
  }

  return {
    root,
    generatedAt: new Date().toISOString(),
    files,
    configFiles: files.filter((file) => file.kind === "config").map((file) => file.path),
    docsFiles: files.filter((file) => file.kind === "docs").map((file) => file.path),
    testFiles: files.filter((file) => file.kind === "test").map((file) => file.path),
    sourceFiles: files.filter((file) => file.kind === "source").map((file) => file.path),
    topLevelSymbols
  };
}

async function walk(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  const dirs = [dir];
  while (dirs.length > 0) {
    const current = dirs.pop()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        dirs.push(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(root, fullPath));
      }
    }
  }
  return files.sort();
}

async function readTextIfSmall(path: string, size: number): Promise<string | undefined> {
  if (size > 200_000) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function classify(path: string): RepoFileKind {
  if (/package\.json$|tsconfig\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|Makefile$/.test(path)) return "config";
  if (/README|AGENTS\.md$|CLAUDE\.md$|HARNESS\.md$|^docs\//.test(path)) return "docs";
  if (/(\.test\.|\.spec\.|^test\/|^tests\/|__tests__)/.test(path)) return "test";
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp)$/.test(path)) return "source";
  return "unknown";
}

function languageFor(path: string): string | undefined {
  return path.split(".").pop();
}

function extractSymbols(path: string, text: string): SymbolSummary[] {
  const symbols: SymbolSummary[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const match =
      line.match(/export\s+function\s+(\w+)/) ??
      line.match(/function\s+(\w+)/) ??
      line.match(/class\s+(\w+)/) ??
      line.match(/export\s+const\s+(\w+)/);
    if (match) {
      symbols.push({
        path,
        name: match[1],
        kind: line.includes("class") ? "class" : line.includes("const") ? "const" : "function",
        line: index + 1
      });
    }
  });
  return symbols;
}
