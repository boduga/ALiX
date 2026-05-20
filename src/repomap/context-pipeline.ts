import type { Dirent } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildDependencyGraph, type DependencyGraph } from "./dependency-graph.js";
import { extractTopLevelSymbols, type ExtractedSymbol } from "./symbol-extractor.js";
import { rankContextCandidate } from "./context-ranker.js";
import type { TaskType } from "../task-classifier.js";

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

// ─── RankingStage ─────────────────────────────────────────────────────────────

export type ContextItem = {
  path: string;
  kind: "file" | "symbol" | "test" | "config" | "doc";
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  score: number;
  tokenEstimate: number;
  reason: string;
};

export type RankingInput = RepoMapOutput;
export type RankingOutput = {
  items: ContextItem[];
  repoMap: RepoMapOutput;
  task: string;
  taskType: TaskType;
};

/** Extract file paths mentioned in the task string. */
function extractTaskMentions(task: string): string[] {
  const paths: string[] = [];
  const patterns = [
    /["'`]([^\s`]+?\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|json|md|toml|yaml|yml))["'`]/g,
    /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp|json|md|toml|yaml|yml))(?=\s|$)/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(task)) !== null) {
      paths.push(match[1]);
    }
  }
  return [...new Set(paths)];
}

/** Score a file for relevance to a task mention. */
function scoreMention(file: string, mentions: string[]): number {
  const normalized = file.replace(/^\.\//, "");
  let best = 0;
  for (const mention of mentions) {
    if (normalized === mention) return 100;
    if (normalized.includes(mention) || mention.includes(normalized)) best = Math.max(best, 70);
    const mentionBase = mention.replace(/\.[^.]+$/, "");
    const fileBase = normalized.replace(/\.[^.]+$/, "");
    if (fileBase === mentionBase) best = Math.max(best, 60);
  }
  return best;
}

/** Map a source file to its corresponding test file(s) by naming convention. */
function findTestsFor(path: string, testFiles: string[]): string[] {
  const normalized = path.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx)$/, "");
  const candidates = [
    normalized.replace(/^src\//, "tests/"),
    normalized.replace(/^src\//, "test/"),
  ];
  return testFiles.filter(tf => {
    const tn = tf.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "").replace(/^tests?\//, "");
    return candidates.some(c => tn.includes(c) || c.includes(tn));
  });
}

function estimateFileTokens(path: string, lineCount: number, isSource: boolean): number {
  const base = isSource ? lineCount * 2 : lineCount * 1.5;
  return Math.ceil(base);
}

export class RankingStage implements ContextStage<RankingInput, RankingOutput> {
  name = "ranking";

  constructor(private options: { task: string; taskType: TaskType; pinnedPaths?: string[] } = { task: "", taskType: "unknown" }) {}

  async process(input: RankingInput): Promise<RankingOutput> {
    const { task, taskType, pinnedPaths = [] } = this.options;
    const mentions = extractTaskMentions(task);
    const items: ContextItem[] = [];

    // 1. Task-mentioned files
    for (const sf of input.sourceFiles) {
      const entry = input.fileEntries.get(sf);
      if (!entry) continue;
      const score = scoreMention(sf, mentions);
      if (score > 0) {
        items.push({
          path: sf,
          kind: "file",
          score,
          tokenEstimate: estimateFileTokens(sf, entry.lineCount ?? 100, true),
          reason: score >= 100 ? "task_mention_exact" : "task_mention_fuzzy",
        });
      }
    }

    // 2. Config files
    for (const cf of input.configFiles) {
      const entry = input.fileEntries.get(cf);
      if (!entry) continue;
      items.push({
        path: cf,
        kind: "config",
        score: 10,
        tokenEstimate: estimateFileTokens(cf, entry.lineCount ?? 20, false),
        reason: "config_file",
      });
    }

    // 3. Pinned files
    for (const pinned of pinnedPaths) {
      if (!items.some(i => i.path === pinned)) {
        const entry = input.fileEntries.get(pinned);
        if (entry) {
          items.push({
            path: pinned,
            kind: entry.kind === "test" ? "test" : entry.kind === "config" ? "config" : "file",
            score: 200,
            tokenEstimate: estimateFileTokens(pinned, entry.lineCount ?? 100, entry.kind === "source"),
            reason: "pinned",
          });
        }
      }
    }

    // Sort by score descending
    items.sort((a, b) => b.score - a.score);

    return { items, repoMap: input, task, taskType };
  }
}