import type { Dirent } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { buildDependencyGraph, type DependencyGraph } from "./dependency-graph.js";
import { extractTopLevelSymbols, type ExtractedSymbol } from "./symbol-extractor.js";
import { rankContextCandidate } from "./context-ranker.js";
import type { TaskType } from "../task-classifier.js";
import { SemanticSearchIndex, type SearchResult } from "../context/semantic-search.js";

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

export class SemanticSearchStage implements ContextStage<RepoMapOutput, RepoMapOutput> {
  name = "semantic-search";
  private searchIndex: SemanticSearchIndex;
  private indexed: boolean = false;

  constructor(private options: { root: string; task: string }) {
    this.searchIndex = new SemanticSearchIndex(options.root);
  }

  async process(input: RepoMapOutput): Promise<RepoMapOutput> {
    await this.searchIndex.init();
    if (!this.indexed) {
      for (const [relPath, entry] of input.fileEntries) {
        if (entry.kind === "source" && entry.content) {
          try {
            const fullPath = join(input.root, relPath);
            await this.searchIndex.indexFile(fullPath, entry.content);
          } catch { /* skip indexing errors */ }
        }
      }
      this.indexed = true;
    }
    return input;
  }

  getSearchIndex(): SemanticSearchIndex {
    return this.searchIndex;
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

export type ContextBundle = {
  id: string;
  taskType: TaskType;
  budget: {
    maxTokens: number;
    usedTokens: number;
  };
  primaryFiles: ContextItem[];
  supportingFiles: ContextItem[];
  tests: ContextItem[];
  pinned: ContextItem[];
};

export class BudgetingStage implements ContextStage<RankingOutput, { bundle: ContextBundle }> {
  name = "budgeting";

  constructor(private options: { maxTokens: number } = { maxTokens: 20000 }) {}

  async process(input: RankingOutput): Promise<{ bundle: ContextBundle }> {
    const { maxTokens } = this.options;
    let usedTokens = 0;
    const budgeted: ContextItem[] = [];

    for (const item of input.items) {
      if (usedTokens + item.tokenEstimate > maxTokens && budgeted.length > 0) break;
      budgeted.push(item);
      usedTokens += item.tokenEstimate;
    }

    return {
      bundle: {
        id: `bundle-${Date.now()}`,
        taskType: input.taskType,
        budget: { maxTokens, usedTokens },
        primaryFiles: budgeted.filter(i => i.kind === "file" || i.kind === "symbol"),
        supportingFiles: budgeted.filter(i => i.kind === "config" || i.kind === "doc"),
        tests: budgeted.filter(i => i.kind === "test"),
        pinned: budgeted.filter(i => i.reason === "pinned"),
      },
    };
  }
}

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

// Minimum score threshold — ignore anything below this
const MIN_SCORE_THRESHOLD = 50;

// Only add dependencies for high-confidence matches
const DEPENDENCY_THRESHOLD = 80;

function estimateFileTokens(path: string, lineCount: number, isSource: boolean): number {
  const base = isSource ? lineCount * 2 : lineCount * 1.5;
  return Math.ceil(base);
}

// Semantic search: max results and minimum score
const SEMANTIC_MAX_RESULTS = 3;
const SEMANTIC_MIN_SCORE = 70;

// Skip semantic search only when task explicitly mentions a file (file-mention wins)
function shouldSkipSemanticSearch(task: string): boolean {
  return /\.(ts|tsx|js|jsx|py|go|rs|java|kt|json|md)(?=\s|$)/.test(task);
}

export class RankingStage implements ContextStage<RankingInput, RankingOutput> {
  name = "ranking";

  constructor(private options: { task: string; taskType: TaskType; pinnedPaths?: string[]; semanticSearchStage?: SemanticSearchStage; gitActivity?: Map<string, number> } = { task: "", taskType: "unknown" }) {}

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
        let finalScore = score;
        if (this.options.gitActivity && this.options.gitActivity.size > 0) {
          const gitScore = this.options.gitActivity.get(sf) ?? 0;
          if (gitScore > 0) {
            finalScore += Math.min(gitScore * 2, 20); // Up to 20 point boost
          }
        }
        items.push({
          path: sf,
          kind: "file",
          score: finalScore,
          tokenEstimate: estimateFileTokens(sf, entry.lineCount ?? 100, true),
          reason: score >= 100 ? "task_mention_exact" : "task_mention_fuzzy",
        });
        // Also add related test files for mentioned source files
        const relatedTests = findTestsFor(sf, input.testFiles);
        for (const rt of relatedTests) {
          const testEntry = input.fileEntries.get(rt);
          if (testEntry) {
            items.push({
              path: rt,
              kind: "test",
              score: score - 10, // Slightly lower than source file
              tokenEstimate: estimateFileTokens(rt, testEntry.lineCount ?? 30, false),
              reason: `test_for:${sf}`,
            });
          }
        }
      }
    }

    // Skip semantic search when task explicitly mentions a file
    if (this.options.semanticSearchStage && !shouldSkipSemanticSearch(task)) {
      const searchIndex = this.options.semanticSearchStage.getSearchIndex();
      const searchResults = await searchIndex.search(task, SEMANTIC_MAX_RESULTS);
      for (const result of searchResults) {
        // Filter by minimum score
        if (result.score < SEMANTIC_MIN_SCORE) continue;
        if (!items.some(i => i.path === result.path)) {
          const entry = input.fileEntries.get(result.path);
          if (entry) {
            items.push({
              path: result.path,
              kind: entry.kind === "test" ? "test" : entry.kind === "config" ? "config" : "file",
              symbolName: result.symbolName,
              lineStart: result.lineStart,
              lineEnd: result.lineEnd,
              score: result.score,
              tokenEstimate: estimateFileTokens(result.path, entry.lineCount ?? 100, entry.kind === "source"),
              reason: `semantic_match:${result.symbolName}`,
            });
          }
        }
      }
    }

    // 2. Config files (only if task explicitly mentions them)
    const taskMentionsConfig = mentions.some(m =>
      /package\.json|tsconfig|pyproject|go\.mod|Cargo\.toml/i.test(m)
    );
    if (taskMentionsConfig) {
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
    }

    // 3. Bugfix hint: include test files even without explicit mentions
    if (taskType === "bugfix") {
      for (const tf of input.testFiles) {
        const entry = input.fileEntries.get(tf);
        if (!entry) continue;
        items.push({
          path: tf,
          kind: "test",
          score: 5,
          tokenEstimate: estimateFileTokens(tf, entry.lineCount ?? 30, false),
          reason: "bugfix_hint",
        });
      }
    }

    // 4. Pinned files
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

    // 5. Add dependencies only for high-confidence matches (score > DEPENDENCY_THRESHOLD)
    const highConfidencePaths = new Set(
      items.filter(i => (i.kind === "file" || i.kind === "symbol") && i.score >= DEPENDENCY_THRESHOLD).map(i => i.path)
    );
    for (const mentioned of highConfidencePaths) {
      const deps = input.dependencyGraph.dependenciesOf(mentioned);
      for (const dep of deps) {
        if (!highConfidencePaths.has(dep) && !items.some(i => i.path === dep)) {
          const depEntry = input.fileEntries.get(dep);
          if (depEntry) {
            items.push({
              path: dep,
              kind: depEntry.kind === "test" ? "test" : depEntry.kind === "config" ? "config" : "file",
              score: 15, // Lower score for dependencies
              tokenEstimate: estimateFileTokens(dep, depEntry.lineCount ?? 100, depEntry.kind === "source"),
              reason: `dependency_distance:1`,
            });
          }
        }
      }
    }

    // 6. Extract symbols (only when task doesn't explicitly mention a file)
    if (input.symbols.length > 0 && !shouldSkipSemanticSearch(task)) {
      // Extract "words" from task (symbols must match a task word, not just a substring)
      const taskWords = new Set(task.toLowerCase().match(/\b[a-z][a-z0-9]{2,}\b/g) || []);
      for (const sym of input.symbols) {
        const symLower = sym.name.toLowerCase();
        // Symbol matches if it's a full word in the task
        if (taskWords.has(symLower) || symLower === task.toLowerCase().replace(/\s+/g, '_')) {
          const fileEntry = input.fileEntries.get(sym.file);
          if (fileEntry && fileEntry.content) {
            items.push({
              path: sym.file,
              kind: "symbol",
              symbolName: sym.name,
              lineStart: sym.line,
              lineEnd: sym.line,
              score: 80,
              tokenEstimate: estimateFileTokens(sym.file, 10, false),
              reason: `symbol_match:${sym.name}`,
            });
          }
        }
      }
    }

    // Re-sort after adding dependencies and symbols
    items.sort((a, b) => b.score - a.score);

    // 7. Filter to minimum score threshold
    const filteredItems = items.filter(i => i.score >= MIN_SCORE_THRESHOLD);

    return { items: filteredItems, repoMap: input, task, taskType };
  }
}