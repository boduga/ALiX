import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ContextRanker } from "./context-ranker.js";

export interface ContextBundle {
  files: {
    path: string;
    content: string;
    tokens: number;
    rank: number;
  }[];
  totalTokens: number;
  metadata: {
    generatedAt: Date;
    maxTokens: number;
    fileCount: number;
    excludedFiles: string[];
  };
}

export interface ContextBundleBuilderOptions {
  maxTokens?: number;
  priorityExtensions?: string[];
  excludePatterns?: string[];
}

export class ContextBundleBuilder {
  private options: Required<ContextBundleBuilderOptions>;
  private ranker: ContextRanker;

  constructor(options: ContextBundleBuilderOptions = {}) {
    this.options = {
      maxTokens: options.maxTokens ?? 100000,
      priorityExtensions: options.priorityExtensions ?? [".ts", ".tsx", ".js", ".jsx"],
      excludePatterns: options.excludePatterns ?? ["node_modules", ".test.", ".spec."],
    };
    this.ranker = new ContextRanker();
  }

  async buildBundle(rootDir: string, context?: string): Promise<ContextBundle> {
    const files = await this.discoverFiles(rootDir);
    const ranked = this.ranker.rankFiles(files.map(f => ({ path: f })));

    const selected: ContextBundle["files"] = [];
    let totalTokens = 0;
    const excluded: string[] = [];

    for (const file of ranked) {
      if (this.shouldExclude(file.path)) {
        excluded.push(file.path);
        continue;
      }

      const content = await this.readFileContent(file.path);
      const tokens = this.estimateTokens(content);

      if (totalTokens + tokens <= this.options.maxTokens) {
        selected.push({
          path: file.path,
          content,
          tokens,
          rank: file.rank,
        });
        totalTokens += tokens;
      } else {
        excluded.push(file.path);
      }
    }

    return {
      files: selected,
      totalTokens,
      metadata: {
        generatedAt: new Date(),
        maxTokens: this.options.maxTokens,
        fileCount: selected.length,
        excludedFiles: excluded,
      },
    };
  }

  private async discoverFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          files.push(...await this.discoverFiles(fullPath));
        } else if (this.options.priorityExtensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return files;
  }

  private async readFileContent(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }

  private shouldExclude(path: string): boolean {
    return this.options.excludePatterns.some(pattern => path.includes(pattern));
  }
}
