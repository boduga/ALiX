import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type IndexMetadata = {
  createdAt: string;
  maxAge?: number;
  sourceFiles?: string[];
};

export type IndexStats = {
  indexCount: number;
  totalSize: number;
  oldestIndex?: string;
  newestIndex?: string;
};

interface StoredIndex {
  data: unknown;
  metadata: IndexMetadata;
}

export class RepoIndexStore {
  private baseDir: string;
  private indexDir: string;
  private initialized: boolean = false;

  constructor(baseDir: string, indexDir?: string) {
    this.baseDir = baseDir;
    this.indexDir = indexDir ?? ".alix/indexes";
  }

  async init(): Promise<void> {
    const fullPath = join(this.baseDir, this.indexDir);
    await mkdir(fullPath, { recursive: true });
    this.initialized = true;
  }

  private getIndexPath(name: string): string {
    return join(this.baseDir, this.indexDir, `${name}.json`);
  }

  async save(name: string, data: unknown, metadata?: Partial<IndexMetadata>): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    const storedIndex: StoredIndex = {
      data,
      metadata: {
        createdAt: new Date().toISOString(),
        ...metadata,
      },
    };

    const path = this.getIndexPath(name);
    await writeFile(path, JSON.stringify(storedIndex, null, 2), "utf-8");
  }

  async load(name: string): Promise<unknown | undefined> {
    if (!this.initialized) {
      await this.init();
    }

    const path = this.getIndexPath(name);
    if (!existsSync(path)) {
      return undefined;
    }

    const content = await readFile(path, "utf-8");
    const stored: StoredIndex = JSON.parse(content);
    return stored.data;
  }

  async isStale(name: string, options: { repoModified?: number; maxAge?: number }): Promise<boolean> {
    if (!this.initialized) {
      await this.init();
    }

    const path = this.getIndexPath(name);
    if (!existsSync(path)) {
      return true; // Non-existent index is considered stale
    }

    const content = await readFile(path, "utf-8");
    const stored: StoredIndex = JSON.parse(content);
    const { createdAt } = stored.metadata;

    // Check age-based staleness
    if (options.maxAge !== undefined) {
      const createdTime = new Date(createdAt).getTime();
      const now = Date.now();
      if (now - createdTime > options.maxAge) {
        return true;
      }
    }

    // Check repo modification staleness
    if (options.repoModified !== undefined) {
      const repoModTime = new Date(options.repoModified).getTime();
      const createdTime = new Date(createdAt).getTime();
      if (repoModTime > createdTime) {
        return true;
      }
    }

    return false;
  }

  async delete(name: string): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    const path = this.getIndexPath(name);
    if (existsSync(path)) {
      await rm(path);
    }
  }

  async clearAll(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    const fullPath = join(this.baseDir, this.indexDir);
    const entries = await readdir(fullPath);
    await Promise.all(
      entries
        .filter((e) => e.endsWith(".json"))
        .map((e) => rm(join(fullPath, e)))
    );
  }

  async getStats(): Promise<IndexStats> {
    if (!this.initialized) {
      await this.init();
    }

    const fullPath = join(this.baseDir, this.indexDir);
    const entries = await readdir(fullPath);
    const indexFiles = entries.filter((e) => e.endsWith(".json"));

    if (indexFiles.length === 0) {
      return { indexCount: 0, totalSize: 0 };
    }

    let totalSize = 0;
    let oldestIndex: string | undefined;
    let newestIndex: string | undefined;
    let oldestTime = Infinity;
    let newestTime = -Infinity;

    await Promise.all(
      indexFiles.map(async (file) => {
        const filePath = join(fullPath, file);
        const fileStat = await stat(filePath);
        totalSize += fileStat.size;

        const content = await readFile(filePath, "utf-8");
        const stored: StoredIndex = JSON.parse(content);
        const createdTime = new Date(stored.metadata.createdAt).getTime();

        if (createdTime < oldestTime) {
          oldestTime = createdTime;
          oldestIndex = file.slice(0, -5); // Remove .json extension
        }
        if (createdTime > newestTime) {
          newestTime = createdTime;
          newestIndex = file.slice(0, -5);
        }
      })
    );

    return {
      indexCount: indexFiles.length,
      totalSize,
      oldestIndex,
      newestIndex,
    };
  }
}