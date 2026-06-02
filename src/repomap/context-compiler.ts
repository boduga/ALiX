import type { TaskType } from "../task-classifier.js";
import type { EventLog } from "../events/event-log.js";
import { CONTEXT_EVENT_TYPES } from "../events/types.js";
import type { RepoMapCreatedPayload, ContextBundleCreatedPayload, ContextItemRef } from "../events/types.js";
import { ContextPipeline, RankingStage, BudgetingStage, RepoMapStage, SemanticSearchStage } from "./context-pipeline.js";
import type { RepoMapOutput, ContextBundle as PipelineContextBundle, ContextItem as PipelineContextItem } from "./context-pipeline.js";
import { EmbeddingCache } from "./embedding-cache.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, stat as statSync, readFile, writeFile } from "node:fs/promises";
import { rankContextCandidate } from "./context-ranker.js";
import { readGitActivity } from "./git-activity.js";
import { PatternRegistry } from "../context/pattern-registry.js";

// Re-export types from pipeline for backward compatibility
export type ContextKind = "file" | "symbol" | "test" | "config" | "doc";
export type ContextItem = PipelineContextItem;
export type ContextBundle = PipelineContextBundle;

// Helper functions removed - using pipeline stages instead

export type ContextCompilerOptions = {
  root: string;
  maxTokens?: number;
  eventLog?: EventLog;
  sessionId?: string;
};

// Simple in-memory cache for compiled context bundles (60s TTL)
const contextCache = new Map<string, { result: ContextBundle; timestamp: number }>();
const CONTEXT_CACHE_TTL_MS = 60_000;

export class ContextCompiler {
  private repoMap?: RepoMapOutput;
  private embeddingCache?: EmbeddingCache;

  constructor(private options: ContextCompilerOptions) {}

  async warm(): Promise<RepoMapOutput> {
    // Use RepoMapStage from the pipeline
    const stage = new RepoMapStage();
    this.repoMap = await stage.process({ root: this.options.root });

    // Read git activity for recency boosting
    const gitActivity = await readGitActivity(this.options.root);
    this.repoMap.gitActivity = gitActivity;

    this.embeddingCache = new EmbeddingCache(this.options.root);

    // Note: Embeddings are built lazily on first use (saves 68MB ONNX model load
    // for tasks that don't need semantic search). Call ensureEmbeddings() explicitly
    // if needed.

    // Emit context.repo_map_created
    if (this.options.eventLog && this.options.sessionId) {
      await this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "system",
        type: CONTEXT_EVENT_TYPES.REPO_MAP_CREATED,
        payload: {
          sourceFileCount: this.repoMap.sourceFiles.length,
          testFileCount: this.repoMap.testFiles.length,
          symbolCount: this.repoMap.symbols.length,
          dependencyCount: this.countDependencies(),
        } as RepoMapCreatedPayload,
      });
    }

    return this.repoMap;
  }

  private async buildEmbeddings(): Promise<void> {
    if (!this.repoMap || !this.embeddingCache) return;
    const files = [...this.repoMap.fileEntries.values()]
      .filter(e => e.kind === "source" && e.content)
      .map(e => ({ path: e.path, content: e.content, kind: e.kind }));
    await this.embeddingCache.buildEmbeddings(files);
  }

  private countDependencies(): number {
    if (!this.repoMap) return 0;
    let count = 0;
    for (const file of this.repoMap.sourceFiles) {
      count += this.repoMap.dependencyGraph.dependenciesOf(file).length;
    }
    return count;
  }

  async compileContext(
    task: string,
    taskType: TaskType,
    pinnedPaths?: string[]
  ): Promise<ContextBundle> {
    // Check cache first
    const cacheKey = `${taskType}::${task}::${JSON.stringify(pinnedPaths ?? [])}`;
    const cached = contextCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL_MS) {
      return cached.result;
    }

    const maxTokens = this.options.maxTokens ?? 20000;

    // Reuse warm() cache if available
    if (!this.repoMap) {
      await this.warm();
    }

    const semanticStage = new SemanticSearchStage({ root: this.options.root, task });

    // Load pattern stats for threshold adjustment
    let thresholdBias = 0;
    const patternsDir = join(this.options.root, ".alix", "patterns");
    try {
      const registry = new PatternRegistry(patternsDir);
      await registry.init();
      const stats = registry.getStats(taskType);
      if (stats) {
        thresholdBias = registry.getThresholdBias(taskType);
      }
    } catch {
      // No registry yet - use default threshold
    }

    const pipeline = new ContextPipeline([
      semanticStage,
      new RankingStage({
        task,
        taskType,
        pinnedPaths: pinnedPaths ?? [],
        gitActivity: this.repoMap?.gitActivity,
        semanticSearchStage: semanticStage,
        thresholdBias,
      }),
      new BudgetingStage({ maxTokens }),
    ]);

    const result = await pipeline.run(this.repoMap!) as { bundle: ContextBundle };
    const bundle = result.bundle;

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
          omittedCount: 0,
        } as ContextBundleCreatedPayload,
      });
    }

    // Cache the result
    contextCache.set(cacheKey, { result: bundle, timestamp: Date.now() });

    return bundle;
  }

  async pinFile(path: string, reason: string): Promise<void> {
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