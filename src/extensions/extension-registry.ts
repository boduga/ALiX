import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";

export type ExtensionKind = "tool" | "skill" | "hook" | "recipe" | "subagent" | "plugin" | "mcp";

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  kind: ExtensionKind;
  entrypoint: string;
  capabilities: string[];
  permissions: PolicyRule[];
  enabled?: boolean;
};

export type PolicyRule = {
  id: string;
  capability: string | string[];
  effect: "allow" | "ask" | "deny";
  paths?: string[];
};

export type RegisteredExtension = ExtensionManifest & {
  loadedAt: string;
  enabled: boolean;
};

export class ExtensionRegistry {
  private extensions = new Map<string, RegisteredExtension>();

  register(manifest: ExtensionManifest): void {
    if (this.extensions.has(manifest.id)) {
      throw new Error(`Extension "${manifest.id}" is already registered`);
    }
    const extension: RegisteredExtension = {
      ...manifest,
      loadedAt: new Date().toISOString(),
      enabled: manifest.enabled ?? true,
    };
    this.extensions.set(manifest.id, extension);
  }

  get(id: string): RegisteredExtension | undefined {
    return this.extensions.get(id);
  }

  list(): RegisteredExtension[] {
    return Array.from(this.extensions.values());
  }

  listByKind(kind: ExtensionKind): RegisteredExtension[] {
    return this.list().filter((ext) => ext.kind === kind);
  }

  listEnabled(): RegisteredExtension[] {
    return this.list().filter((ext) => ext.enabled);
  }

  disable(id: string): void {
    const ext = this.extensions.get(id);
    if (!ext) {
      throw new Error(`Extension "${id}" not found`);
    }
    ext.enabled = false;
  }

  enable(id: string): void {
    const ext = this.extensions.get(id);
    if (!ext) {
      throw new Error(`Extension "${id}" not found`);
    }
    ext.enabled = true;
  }

  async loadFromDir(dirPath: string): Promise<number> {
    let count = 0;
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const entryStat = await stat(fullPath);
      if (!entryStat.isDirectory()) {
        continue;
      }
      const manifestPath = join(fullPath, "manifest.json");
      try {
        const content = await readFile(manifestPath, "utf-8");
        const manifest: ExtensionManifest = JSON.parse(content);
        this.register(manifest);
        count++;
      } catch {
        // Skip directories without manifest.json
      }
    }
    return count;
  }

  async loadFromConfig(configPath: string): Promise<void> {
    const content = await readFile(configPath, "utf-8");
    const config: { extensions: ExtensionManifest[] } = JSON.parse(content);
    for (const manifest of config.extensions ?? []) {
      this.register(manifest);
    }
  }
}