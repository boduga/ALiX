import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export class UserPreferenceStore {
  private filePath: string;
  private data: Record<string, unknown> = {};
  private initialized = false;

  constructor(baseDir: string, filename = 'preferences.json') {
    this.filePath = join(baseDir, filename);
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (existsSync(this.filePath)) {
      const content = readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
    }
    this.initialized = true;
  }

  async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    if (key in this.data) {
      return this.data[key] as T;
    }
    return defaultValue;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
    this.persist();
  }

  async delete(key: string): Promise<void> {
    delete this.data[key];
    this.persist();
  }

  async list(): Promise<Record<string, unknown>> {
    return { ...this.data };
  }

  async clear(): Promise<void> {
    this.data = {};
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }
}
