import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface CacheManager {
  get(key: string): string | null;
  set(key: string, value: string): void;
  has(key: string): boolean;
  invalidate(prefix: string): void;
  clear(): void;
  readonly size: number;
}

export class InMemoryCacheManager implements CacheManager {
  private cache = new Map<string, string>();

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  invalidate(prefix: string): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * File-backed cache manager for cross-session persistence.
 */
export class PersistentCacheManager implements CacheManager {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    // Ensure cache directory exists
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
  }

  private cacheFile(key: string): string {
    // Use hash to avoid filesystem issues with special characters
    const hash = Buffer.from(key).toString("base64").replace(/[/+=]/g, "_");
    return join(this.cacheDir, `${hash}.cache`);
  }

  get(key: string): string | null {
    const file = this.cacheFile(key);
    if (!existsSync(file)) return null;
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    const file = this.cacheFile(key);
    try {
      writeFileSync(file, value, "utf8");
    } catch (e) {
      // Silently fail - cache is optional
    }
  }

  has(key: string): boolean {
    return existsSync(this.cacheFile(key));
  }

  invalidate(prefix: string): void {
    if (!existsSync(this.cacheDir)) return;
    const files = readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith(".cache")) {
        const key = this.fileToKey(file);
        if (key.startsWith(prefix)) {
          try {
            unlinkSync(join(this.cacheDir, file));
          } catch {
            // Ignore errors
          }
        }
      }
    }
  }

  clear(): void {
    if (!existsSync(this.cacheDir)) return;
    const files = readdirSync(this.cacheDir);
    for (const file of files) {
      if (file.endsWith(".cache")) {
        try {
          unlinkSync(join(this.cacheDir, file));
        } catch {
          // Ignore errors
        }
      }
    }
  }

  get size(): number {
    if (!existsSync(this.cacheDir)) return 0;
    return readdirSync(this.cacheDir).filter(f => f.endsWith(".cache")).length;
  }

  private fileToKey(file: string): string {
    const name = file.replace(".cache", "");
    return Buffer.from(name, "base64").toString("utf8");
  }
}
