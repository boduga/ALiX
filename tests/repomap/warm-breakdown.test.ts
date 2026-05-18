import { describe, it } from "node:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { Dirent } from "node:fs";
import { buildDependencyGraph } from "../../src/repomap/dependency-graph.js";
import { extractTopLevelSymbols, type ExtractedSymbol } from "../../src/repomap/symbol-extractor.js";
import { existsSync } from "node:fs";

type FileEntry = {
  path: string;
  kind: "source" | "test" | "config" | "docs" | "unknown";
  language?: string;
  lineCount?: number;
  content?: string;
};

type RepoMap = {
  sourceFiles: string[];
  testFiles: string[];
  configFiles: string[];
  docsFiles: string[];
  fileEntries: Map<string, FileEntry>;
  dependencyGraph: ReturnType<typeof buildDependencyGraph>;
  symbols: ExtractedSymbol[];
};

function classifyKind(path: string): FileEntry["kind"] {
  if (/package\.json$|tsconfig\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|Makefile$/.test(path)) return "config";
  if (/README|AGENTS\.md$|CLAUDE\.md$|HARNESS\.md$|^docs\//.test(path)) return "docs";
  if (/(\.test\.|\.spec\.|^test\/|^tests\/|__tests__)/.test(path)) return "test";
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp)$/.test(path)) return "source";
  return "unknown";
}

async function buildRepoMapTimed(root: string): Promise<{ map: RepoMap; timings: Record<string, number> }> {
  const timings: Record<string, number> = {};
  const ignoredDirs = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);
  const fileEntries = new Map<string, FileEntry>();
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  const configFiles: string[] = [];
  const docsFiles: string[] = [];

  // Phase 1: Directory traversal
  const traverseStart = performance.now();
  const dirs: string[] = [root];
  while (dirs.length > 0) {
    const current = dirs.pop()!;
    let entries: Dirent[] = [];
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        dirs.push(join(current, entry.name));
      } else if (entry.isFile()) {
        const fullPath = join(current, entry.name);
        const rel = relative(root, fullPath);
        const kind = classifyKind(rel);
        let info: import("node:fs").Stats;
        try { info = await stat(fullPath); } catch { continue; }
        let content: string | undefined;
        if (info.size < 100_000) {
          try { content = await readFile(fullPath, "utf8"); } catch { /* ignore */ }
        }
        const lineCount = content ? content.split("\n").length : Math.ceil(info.size / 80);
        const fileEntry: FileEntry = { path: rel, kind, lineCount, content };
        fileEntries.set(rel, fileEntry);
        if (kind === "source") sourceFiles.push(rel);
        else if (kind === "test") testFiles.push(rel);
        else if (kind === "config") configFiles.push(rel);
        else if (kind === "docs") docsFiles.push(rel);
      }
    }
  }
  timings.directoryTraversal = performance.now() - traverseStart;

  // Phase 2: Dependency graph building
  const depGraphStart = performance.now();
  const entries = [...fileEntries.values()].map(e => ({ path: e.path, content: e.content }));
  const dependencyGraph = buildDependencyGraph(entries);
  timings.dependencyGraph = performance.now() - depGraphStart;

  // Phase 3: Symbol extraction
  const symbolStart = performance.now();
  const sourceEntries = [...fileEntries.values()].filter(e => e.kind === "source" && e.content);
  const symbols = sourceEntries.flatMap(e => extractTopLevelSymbols(e.path, e.content ?? ""));
  timings.symbolExtraction = performance.now() - symbolStart;

  timings.total = timings.directoryTraversal + timings.dependencyGraph + timings.symbolExtraction;

  const map: RepoMap = { sourceFiles, testFiles, configFiles, docsFiles, fileEntries, dependencyGraph, symbols };
  return { map, timings };
}

describe("ContextCompiler.warm() detailed breakdown", () => {
  it("shows per-operation timing for warm()", async () => {
    const projectRoot = process.cwd();
    const { timings } = await buildRepoMapTimed(projectRoot);

    console.log("\n=== warm() Operation Breakdown ===");
    console.log(`Directory traversal: ${timings.directoryTraversal.toFixed(2)} ms (${((timings.directoryTraversal / timings.total) * 100).toFixed(1)}%)`);
    console.log(`Dependency graph:   ${timings.dependencyGraph.toFixed(2)} ms (${((timings.dependencyGraph / timings.total) * 100).toFixed(1)}%)`);
    console.log(`Symbol extraction:  ${timings.symbolExtraction.toFixed(2)} ms (${((timings.symbolExtraction / timings.total) * 100).toFixed(1)}%)`);
    console.log(`-----------------------------------------`);
    console.log(`Total warm() time:   ${timings.total.toFixed(2)} ms`);
    console.log("======================================\n");

    // Verify timings are recorded
    console.log(`Files scanned: ${timings.directoryTraversal > 0 ? "yes" : "no"}`);
    console.log(`Dep graph built: ${timings.dependencyGraph > 0 ? "yes" : "no"}`);
    console.log(`Symbols extracted: ${timings.symbolExtraction > 0 ? "yes" : "no"}`);
  });
});