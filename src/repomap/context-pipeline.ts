import type { Dirent } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildDependencyGraph, type DependencyGraph } from "./dependency-graph.js";
import { extractTopLevelSymbols, type ExtractedSymbol } from "./symbol-extractor.js";

/**
 * A stage in the context compilation pipeline.
 * Each stage transforms input to output, optionally caching results.
 */
export interface ContextStage<Input, Output> {
  /** Human-readable name for logging/debugging */
  name: string;
  /** Process the input and produce output */
  process(input: Input): Promise<Output>;
}

/**
 * Context compilation pipeline.
 * Runs stages in order, passing each stage's output to the next.
 */
export class ContextPipeline {
  private stages: ContextStage<unknown, unknown>[] = [];

  constructor(stages: ContextStage<unknown, unknown>[] = []) {
    this.stages = stages;
  }

  /** Add a stage to the pipeline */
  addStage(stage: ContextStage<unknown, unknown>): this {
    this.stages.push(stage);
    return this;
  }

  /** Run all stages in sequence */
  async run(input: unknown): Promise<unknown> {
    let result = input;
    for (const stage of this.stages) {
      result = await stage.process(result);
    }
    return result;
  }

  /** Get stage names for debugging */
  get stageNames(): string[] {
    return this.stages.map(s => s.name);
  }
}

type FileEntry = {
  path: string;
  kind: "source" | "test" | "config" | "docs" | "unknown";
  language?: string;
  lineCount?: number;
  content?: string;
};

export type RepoMapOutput = {
  sourceFiles: string[];
  testFiles: string[];
  configFiles: string[];
  docsFiles: string[];
  fileEntries: Map<string, FileEntry>;
  dependencyGraph: DependencyGraph;
  symbols: ExtractedSymbol[];
  gitActivity: Map<string, number>;
  root: string;
};

function classifyKind(path: string): FileEntry["kind"] {
  if (/package\.json$|tsconfig\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|Makefile$/.test(path)) return "config";
  if (/README|AGENTS\.md$|CLAUDE\.md$|HARNESS\.md$|^docs\//.test(path)) return "docs";
  if (/(\.test\.|\.spec\.|^test\/|^tests\/|__tests__)/.test(path)) return "test";
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp)$/.test(path)) return "source";
  return "unknown";
}

export async function buildRepoMap(root: string): Promise<RepoMapOutput> {
  const { readdir, stat } = await import("node:fs/promises");
  const ignoredDirs = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);
  const fileEntries = new Map<string, FileEntry>();
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  const configFiles: string[] = [];
  const docsFiles: string[] = [];

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

  const filesWithContent = [...fileEntries.values()].filter(e => e.content);
  const dependencyGraph = buildDependencyGraph(filesWithContent.map(e => ({ path: e.path, content: e.content })));
  const symbols = filesWithContent.filter(e => e.kind === "source").flatMap(e => extractTopLevelSymbols(e.content ?? "", e.path));

  return { sourceFiles, testFiles, configFiles, docsFiles, fileEntries, dependencyGraph, symbols, gitActivity: new Map(), root };
}

export class RepoMapStage implements ContextStage<{ root: string }, RepoMapOutput> {
  name = "repo-map";

  async process(input: { root: string }): Promise<RepoMapOutput> {
    return buildRepoMap(input.root);
  }
}