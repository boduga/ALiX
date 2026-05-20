import type { TaskType } from "../task-classifier.js";
import type { EventLog } from "../events/event-log.js";
import { CONTEXT_EVENT_TYPES } from "../events/types.js";
import type { RepoMapCreatedPayload, ContextBundleCreatedPayload, ContextItemRef } from "../events/types.js";
import { ContextPipeline, RepoMapStage, RankingStage, BudgetingStage } from "./context-pipeline.js";
import type { RepoMapOutput, ContextBundle as PipelineContextBundle, ContextItem as PipelineContextItem } from "./context-pipeline.js";
import { EmbeddingCache } from "./embedding-cache.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, stat as statSync, readFile, writeFile } from "node:fs/promises";
import { rankContextCandidate } from "./context-ranker.js";

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

export class ContextCompiler {
  private repoMap?: RepoMapOutput;
  private embeddingCache?: EmbeddingCache;

  constructor(private options: ContextCompilerOptions) {}

  async warm(): Promise<RepoMapOutput> {
    // Use RepoMapStage from the pipeline
    const stage = new RepoMapStage();
    this.repoMap = await stage.process({ root: this.options.root });
    this.embeddingCache = new EmbeddingCache(this.options.root);

    // Build embeddings in background (non-blocking)
    this.buildEmbeddings().catch(() => {});

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

  async compile(
    task: string,
    taskType: TaskType,
    maxTokens: number,
    pinnedPaths: string[] = []
  ): Promise<ContextBundle> {
    const maxTokensToUse = maxTokens ?? this.options.maxTokens ?? 20000;

    // Build pipeline for compile
    const pipeline = new ContextPipeline([
      new RepoMapStage(),
      new RankingStage({ task, taskType, pinnedPaths }),
      new BudgetingStage({ maxTokens: maxTokensToUse }),
    ]);

    const result = await pipeline.run({ root: this.options.root }) as { bundle: ContextBundle };
    return result.bundle;
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