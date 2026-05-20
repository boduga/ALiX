import { readFile, writeFile, stat as statSync, mkdir } from "node:fs/promises";
import { Dirent } from "node:fs";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";
import type { TaskType } from "../task-classifier.js";
import { buildDependencyGraph, DependencyGraph } from "./dependency-graph.js";
import type { EventLog } from "../events/event-log.js";
import { CONTEXT_EVENT_TYPES } from "../events/types.js";
import type { RepoMapCreatedPayload, ContextBundleCreatedPayload, ContextItemRef } from "../events/types.js";

type SerializedDependencyGraph = {
  dependencies: [string, string[]][];
  dependents: [string, string[]][];
};

function buildDependencyGraphFromCache(serialized: SerializedDependencyGraph): DependencyGraph {
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const [path, deps] of serialized.dependencies) {
    dependencies.set(path, new Set(deps));
  }
  for (const [path, deps] of serialized.dependents) {
    dependents.set(path, new Set(deps));
  }

  const graph = {
    dependenciesOf(path: string) {
      return [...(dependencies.get(path) ?? [])];
    },
    dependentsOf(path: string) {
      return [...(dependents.get(path) ?? [])];
    },
    transitiveDependenciesOf(path: string, maxDepth = 10): string[] {
      const visited = new Set<string>();
      const queue: { file: string; depth: number }[] = [{ file: path, depth: 0 }];

      while (queue.length > 0) {
        const { file: current, depth } = queue.shift()!;
        if (visited.has(current) || depth > maxDepth) continue;
        visited.add(current);

        const deps = [...(dependencies.get(current) ?? [])];
        for (const dep of deps) {
          if (!visited.has(dep)) {
            queue.push({ file: dep, depth: depth + 1 });
          }
        }
      }

      visited.delete(path);
      return [...visited];
    },
    findCycles(): string[][] {
      const cycles: string[][] = [];
      const visited = new Set<string>();
      const stack: string[] = [];

      const dfs = (node: string): void => {
        if (stack.includes(node)) {
          const cycleStartIndex = stack.indexOf(node);
          const cycle = [...stack.slice(cycleStartIndex), node];
          cycles.push(cycle);
          return;
        }
        if (visited.has(node)) return;

        visited.add(node);
        stack.push(node);

        for (const dep of [...(dependencies.get(node) ?? [])]) {
          dfs(dep);
        }

        stack.pop();
      };

      for (const [node] of serialized.dependencies) {
        dfs(node);
      }

      return cycles;
    },
    impactScore(path: string): number {
      const directDependents = [...(dependents.get(path) ?? [])].length;
      const transitiveDependents = graph.transitiveDependenciesOf(path, 5).length;
      return directDependents + (transitiveDependents * 0.5);
    },
    get files(): string[] {
      const fileSet = new Set<string>();
      for (const [path] of serialized.dependencies) {
        fileSet.add(path);
      }
      for (const [path] of serialized.dependents) {
        fileSet.add(path);
      }
      return [...fileSet];
    },
  };

  return graph as unknown as DependencyGraph;
}
import { extractTopLevelSymbols, type ExtractedSymbol } from "./symbol-extractor.js";
import { readGitActivity } from "./git-activity.js";
import { rankContextCandidate } from "./context-ranker.js";
import { EmbeddingCache } from "./embedding-cache.js";

export type ContextKind = "file" | "symbol" | "test" | "config" | "doc";

export type ContextItem = {
  path: string;
  kind: ContextKind;
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
  dependencyGraph: DependencyGraph;
  symbols: ExtractedSymbol[];
  gitActivity: Map<string, number>;
};

/** Token estimate: ~4 chars per token for English/prose, lower for code. */
function estimateFileTokens(path: string, lineCount: number, isSource: boolean): number {
  const base = isSource ? lineCount * 2 : lineCount * 1.5;
  return Math.ceil(base);
}

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

/** Map a source file to its corresponding test file(s) by naming convention. */
function findTestsFor(path: string, testFiles: string[]): string[] {
  // src/foo.ts → tests/foo.test.ts, tests/foo.spec.ts, test/foo.ts
  // src/auth/handler.ts → tests/auth/handler.test.ts, test/auth/handler.spec.ts
  const normalized = path.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx)$/, "");
  const candidates = [
    normalized.replace(/^src\//, "tests/"),
    normalized.replace(/^src\//, "test/"),
    normalized.replace(/\//g, "/"),
  ];
  const results: string[] = [];
  for (const tf of testFiles) {
    const tn = tf.replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "").replace(/^tests?\//, "");
    if (candidates.some(c => tn.includes(c) || c.includes(tn))) {
      results.push(tf);
    }
  }
  return results;
}

function isSourceKind(kind: string): boolean {
  return kind === "source";
}

function classifyKind(path: string): FileEntry["kind"] {
  if (/package\.json$|tsconfig\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|Makefile$/.test(path)) return "config";
  if (/README|AGENTS\.md$|CLAUDE\.md$|HARNESS\.md$|^docs\//.test(path)) return "docs";
  if (/(\.test\.|\.spec\.|^test\/|^tests\/|__tests__)/.test(path)) return "test";
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp)$/.test(path)) return "source";
  return "unknown";
}

async function buildRepoMap(root: string): Promise<RepoMap> {
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

  const dependencyGraph = buildDependencyGraph([...fileEntries.values()].map(e => ({ path: e.path, content: e.content })));
  const symbols = [...fileEntries.values()].filter(e => e.kind === "source" && e.content).flatMap(e => extractTopLevelSymbols(e.content ?? "", e.path));

  return { sourceFiles, testFiles, configFiles, docsFiles, fileEntries, dependencyGraph, symbols, gitActivity: new Map() };
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

export type ContextCompilerOptions = {
  root: string;
  maxTokens?: number;
  eventLog?: EventLog;
  sessionId?: string;
};

export class ContextCompiler {
  private repoMap?: RepoMap;
  private cachePath?: string;
  private cacheTimestamp = 0;
  private embeddingCache?: EmbeddingCache;
  private pinnedFiles = new Set<string>();

  constructor(private options: ContextCompilerOptions) {}

  async warm(): Promise<RepoMap> {
    const root = this.options.root;
    // Check for valid cache first
    this.cachePath = join(root, ".alix", "context-cache.json");
    this.embeddingCache = new EmbeddingCache(root);
    const cached = await this.loadFromCache(root);
    let repoMap: RepoMap;
    if (cached) {
      repoMap = cached;
      this.repoMap = repoMap; // Set before async operations
      // Build embeddings for source files in background after cache load
      this.buildEmbeddings(root).catch(() => {}); // non-blocking
    } else {
      // Build fresh and cache
      repoMap = await buildRepoMap(root);
      this.repoMap = repoMap; // Set BEFORE saveToCache - this was the bug
      await this.saveToCache(root);
      await this.buildEmbeddings(root);
    }

    // Emit context.repo_map_created
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "system",
        type: CONTEXT_EVENT_TYPES.REPO_MAP_CREATED,
        payload: {
          sourceFileCount: repoMap.sourceFiles.length,
          testFileCount: repoMap.testFiles.length,
          symbolCount: repoMap.symbols.length,
          dependencyCount: this.countDependencies(repoMap),
        } as RepoMapCreatedPayload,
      });
    }

    return repoMap;
  }

  private async buildEmbeddings(root: string): Promise<void> {
    if (!this.repoMap || !this.embeddingCache) return;
    const files = [...this.repoMap.fileEntries.values()]
      .filter(e => e.kind === "source" && e.content)
      .map(e => ({ path: e.path, content: e.content, kind: e.kind }));
    await this.embeddingCache.buildEmbeddings(files);
  }

  private async loadFromCache(root: string): Promise<RepoMap | null> {
    const cachePath = join(root, ".alix", "context-cache.json");
    try {
      const mtime = (await statSync(cachePath)).mtimeMs;
      const rootMtime = (await statSync(root)).mtimeMs;
      if (mtime < rootMtime) return null; // stale

      const content = await readFile(cachePath, "utf8");
      const data = JSON.parse(content);

      // Verify repo hasn't changed significantly (check top-level dirs)
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(root, { withFileTypes: true });
      const cacheMtime = data._cacheTime || 0;

      // Check if any cached file is newer than cache
      const cachedPaths = [
        ...(data.sourceFiles ?? []),
        ...(data.testFiles ?? []),
        ...(data.configFiles ?? []),
        ...(data.docsFiles ?? []),
      ];
      for (const sf of cachedPaths) {
        try {
          const filePath = join(root, sf);
          const fileMtime = (await statSync(filePath)).mtimeMs;
          if (fileMtime > cacheMtime) return null; // stale
        } catch {
          // File deleted, cache stale
          return null;
        }
      }

      return {
        sourceFiles: data.sourceFiles,
        testFiles: data.testFiles,
        configFiles: data.configFiles,
        docsFiles: data.docsFiles,
        fileEntries: new Map(data.fileEntries),
        dependencyGraph: buildDependencyGraphFromCache(data.dependencyGraph),
        symbols: data.symbols,
        gitActivity: new Map(data.gitActivity),
      };
    } catch {
      return null;
    }
  }

  private async saveToCache(root: string): Promise<void> {
    if (!this.repoMap || !this.cachePath) return;
    try {
      await mkdir(join(root, ".alix"), { recursive: true });
      const deps: [string, string[]][] = [];
      const depFn = this.repoMap.dependencyGraph.dependenciesOf.bind(this.repoMap.dependencyGraph);
      const allDeps = new Set([...this.repoMap.sourceFiles, ...this.repoMap.testFiles]);
      for (const path of allDeps) {
        const d = depFn(path);
        if (d.length > 0) deps.push([path, d]);
      }
      const depRets: [string, string[]][] = [];
      const retFn = this.repoMap.dependencyGraph.dependentsOf.bind(this.repoMap.dependencyGraph);
      for (const path of allDeps) {
        const d = retFn(path);
        if (d.length > 0) depRets.push([path, d]);
      }
      const data = {
        _cacheTime: Date.now(),
        sourceFiles: this.repoMap.sourceFiles,
        testFiles: this.repoMap.testFiles,
        configFiles: this.repoMap.configFiles,
        docsFiles: this.repoMap.docsFiles,
        fileEntries: [...this.repoMap.fileEntries.entries()],
        dependencyGraph: { dependencies: deps, dependents: depRets },
        symbols: this.repoMap.symbols,
        gitActivity: [...this.repoMap.gitActivity.entries()],
      };
      const cacheDir = join(root, ".alix");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(this.cachePath, JSON.stringify(data), "utf8");
    } catch (err) {
      // Log but don't throw - cache write failures are non-fatal
      console.warn("[ContextCompiler] Failed to save cache:", err);
    }
  }

  private countDependencies(repoMap: RepoMap): number {
    let count = 0;
    for (const file of repoMap.sourceFiles) {
      count += repoMap.dependencyGraph.dependenciesOf(file).length;
    }
    return count;
  }

  async compile(
    task: string,
    taskType: TaskType,
    maxTokens: number,
    pinnedPaths: string[] = []
  ): Promise<ContextBundle> {
    const { fileEntries, sourceFiles, testFiles, configFiles, docsFiles, dependencyGraph, symbols } = this.repoMap ?? await buildRepoMap(process.cwd());

    const mentions = extractTaskMentions(task);

    const items: ContextItem[] = [];

    // 1. Task-mentioned files → primary
    for (const mention of mentions) {
      for (const sf of sourceFiles) {
        const entry = fileEntries.get(sf);
        if (!entry) continue;
        const score = scoreMention(sf, [mention]);
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
    }

    // 2. Config files → supporting
    for (const cf of configFiles) {
      const entry = fileEntries.get(cf);
      if (!entry) continue;
      items.push({
        path: cf,
        kind: "config",
        score: 10,
        tokenEstimate: estimateFileTokens(cf, entry.lineCount ?? 20, false),
        reason: "config_file",
      });
    }

    // 3. Test files related to primary sources → tests
    const primaryPaths = new Set(items.filter(i => i.kind === "file").map(i => i.path));
    for (const pf of primaryPaths) {
      const related = findTestsFor(pf, testFiles);
      for (const tf of related) {
        const entry = fileEntries.get(tf);
        if (!entry) continue;
        items.push({
          path: tf,
          kind: "test",
          score: 40,
          tokenEstimate: estimateFileTokens(tf, entry.lineCount ?? 50, false),
          reason: `test_relationship:${pf}`,
        });
      }
    }

    // 4. Pinned files → always included, highest score
    for (const pinned of pinnedPaths) {
      if (!items.some(i => i.path === pinned)) {
        const entry = fileEntries.get(pinned);
        if (entry) {
          items.push({
            path: pinned,
            kind: entry.kind === "test" ? "test" : entry.kind === "config" ? "config" : "file",
            score: 200,
            tokenEstimate: estimateFileTokens(pinned, entry.lineCount ?? 100, isSourceKind(entry.kind)),
            reason: "pinned",
          });
        }
      }
    }

    // 4b. Dependency-related files for mentioned source files
    const currentPrimaryPaths = new Set(items.filter(i => i.kind === "file").map(i => i.path));
    for (const primaryPath of currentPrimaryPaths) {
      for (const relatedPath of [...dependencyGraph.dependenciesOf(primaryPath), ...dependencyGraph.dependentsOf(primaryPath)]) {
        const entry = fileEntries.get(relatedPath);
        if (!entry || entry.kind !== "source") continue;
        const ranked = rankContextCandidate({
          path: relatedPath,
          baseKind: entry.kind,
          mentionScore: 0,
          dependencyDistance: 1,
          symbolMatched: false,
          relatedTest: false,
          config: false,
          gitTouches: 0,
        });
        items.push({
          path: relatedPath,
          kind: "file",
          score: ranked.score,
          tokenEstimate: estimateFileTokens(relatedPath, entry.lineCount ?? 100, true),
          reason: ranked.reasons.join(","),
        });
      }
    }

    // 4c. Symbol matches — when task mentions a symbol name
    const taskWords = new Set(task.toLowerCase().split(/[^a-zA-Z0-9_$]+/).filter(Boolean));
    for (const symbol of symbols) {
      if (!taskWords.has(symbol.name.toLowerCase())) continue;
      const ranked = rankContextCandidate({
        path: symbol.path,
        baseKind: "source",
        mentionScore: 0,
        dependencyDistance: null,
        symbolMatched: true,
        relatedTest: false,
        config: false,
        gitTouches: 0,
      });
      items.push({
        path: symbol.path,
        kind: "symbol",
        symbolName: symbol.name,
        lineStart: symbol.line,
        lineEnd: symbol.line,
        score: ranked.score,
        tokenEstimate: 20,
        reason: ranked.reasons.join(","),
      });
    }

    // 5. Task type signal — bugfix needs tests more, docs needs docs more
    if (taskType === "bugfix") {
      for (const tf of testFiles.slice(0, 5)) {
        if (!items.some(i => i.path === tf)) {
          const entry = fileEntries.get(tf);
          if (entry) {
            items.push({
              path: tf,
              kind: "test",
              score: 20,
              tokenEstimate: estimateFileTokens(tf, entry.lineCount ?? 50, false),
              reason: "bugfix_hint",
            });
          }
        }
      }
    }

    // Deduplicate by path, keeping highest score
    const deduped = new Map<string, ContextItem>();
    for (const item of items) {
      const existing = deduped.get(item.path);
      if (!existing || item.score > existing.score) {
        deduped.set(item.path, item);
      }
    }
    items.length = 0;
    for (const [, v] of deduped) items.push(v);

    // Sort by score descending
    items.sort((a, b) => b.score - a.score);

    // Budget: fill until maxTokens, then stop
    let usedTokens = 0;
    const budgeted: ContextItem[] = [];
    for (const item of items) {
      if (usedTokens + item.tokenEstimate > maxTokens && budgeted.length > 0) break;
      budgeted.push(item);
      usedTokens += item.tokenEstimate;
    }

    const pinned = budgeted.filter(i => i.reason === "pinned");
    const primary = budgeted.filter(i => (i.kind === "file" || i.kind === "symbol") && i.reason !== "pinned");
    const tests = budgeted.filter(i => i.kind === "test");
    const supporting = budgeted.filter(i => i.kind === "config" || i.kind === "doc");

    return {
      id: `bundle-${Date.now()}`,
      taskType,
      budget: { maxTokens, usedTokens },
      primaryFiles: primary,
      supportingFiles: supporting,
      tests,
      pinned,
    };
  }

  async compileContext(
    task: string,
    taskType: TaskType,
    pinned?: string[]
  ): Promise<ContextBundle> {
    const maxTokens = this.options.maxTokens ?? 20000;
    const bundle = await this.compile(task, taskType, maxTokens, pinned ?? []);

    // Emit context.bundle_created
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "system",
        type: CONTEXT_EVENT_TYPES.BUNDLE_CREATED,
        payload: {
          bundleId: bundle.id,
          taskType: bundle.taskType,
          usedTokens: bundle.budget.usedTokens,
          maxTokens: bundle.budget.maxTokens,
          primaryFiles: bundle.primaryFiles.map(toContextItemRef),
          supportingFiles: bundle.supportingFiles.map(toContextItemRef),
          tests: bundle.tests.map(toContextItemRef),
          omittedCount: 0,
        } as ContextBundleCreatedPayload,
      });
    }

    return bundle;
  }

  async pinFile(path: string, reason: string): Promise<void> {
    this.pinnedFiles.add(path);
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "user",
        type: CONTEXT_EVENT_TYPES.FILE_PINNED,
        payload: { path, reason },
      });
    }
  }

  async unpinFile(path: string): Promise<void> {
    this.pinnedFiles.delete(path);
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "user",
        type: CONTEXT_EVENT_TYPES.FILE_UNPINNED,
        payload: { path },
      });
    }
  }
}

function toContextItemRef(item: ContextItem): ContextItemRef {
  return {
    path: item.path,
    kind: item.kind,
    score: item.score,
    reason: item.reason,
    symbolName: item.symbolName,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
  };
}