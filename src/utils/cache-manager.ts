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
