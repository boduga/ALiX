// src/extensions/registry.ts
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parseExtensionManifest, type ExtensionManifest, type ExtensionType, type SkillExtension, type HookExtension, getExtensionId, isCoreExtension } from "./manifest.js";

export type LoadedExtension = {
  manifest: ExtensionManifest;
  path: string;
  installedAt: string;
};

export type VersionInfo = {
  version: string;
  installedAt: string;
  isOutdated?: boolean;
};

export type ListOptions = {
  type?: ExtensionType;
  tag?: string;
  trigger?: string;
  hookTrigger?: "pre_task" | "post_task" | "on_change";
};

export class ExtensionRegistry {
  private extensions = new Map<string, LoadedExtension>();

  constructor(private storePath: string) {
    this.load();
  }

  private load(): void {
    this.extensions.clear();
    if (!existsSync(this.storePath)) return;
    for (const entry of readdirSync(this.storePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(this.storePath, entry.name, "EXTENSION.yaml");
      if (!existsSync(manifestPath)) continue;
      try {
        const content = readFileSync(manifestPath, "utf8");
        const type = this.inferType(entry.name);
        const manifest = parseExtensionManifest(content, type);
        if (!manifest) continue;
        const id = getExtensionId(manifest);
        this.extensions.set(id, {
          manifest,
          path: manifestPath,
          installedAt: manifest.installed_at ?? new Date().toISOString(),
        });
      } catch { /* skip invalid entries */ }
    }
  }

  private inferType(dirName: string): ExtensionType {
    const dashIdx = dirName.indexOf("-");
    if (dashIdx !== -1) {
      const prefix = dirName.slice(0, dashIdx);
      if ((["skill", "hook", "mcp", "recipe", "subagent"] as const).includes(prefix as any)) {
        return prefix as ExtensionType;
      }
    }
    return "skill"; // default
  }

  get(id: string): LoadedExtension | undefined {
    return this.extensions.get(id);
  }

  list(options?: ListOptions): LoadedExtension[] {
    let results = [...this.extensions.values()];
    if (options?.type) {
      results = results.filter(e => e.manifest.type === options.type);
    }
    if (options?.tag) {
      results = results.filter(e => e.manifest.tags?.includes(options.tag!));
    }
    if (options?.trigger) {
      results = results.filter(e => {
        if (e.manifest.type !== "skill") return false;
        const sk = e.manifest as SkillExtension;
        return sk.trigger === options.trigger;
      });
    }
    if (options?.hookTrigger) {
      results = results.filter(e => {
        if (e.manifest.type !== "hook") return false;
        const hk = e.manifest as HookExtension;
        return hk.trigger === options.hookTrigger;
      });
    }
    return results;
  }

  async install(sourcePath: string): Promise<LoadedExtension | null> {
    const manifestPath = join(sourcePath, "EXTENSION.yaml");
    if (!existsSync(manifestPath)) return null;

    const srcDirName = basename(sourcePath);
    const type = this.inferType(srcDirName);
    const content = readFileSync(manifestPath, "utf8");
    const manifest = parseExtensionManifest(content, type);
    if (!manifest) return null;

    const id = getExtensionId(manifest);
    const targetDir = join(this.storePath, `${manifest.type}-${manifest.name}`);

    mkdirSync(targetDir, { recursive: true });

    try {
      for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
        const src = join(sourcePath, entry.name);
        const dst = join(targetDir, entry.name);
        if (entry.isDirectory()) {
          mkdirSync(dst, { recursive: true });
          copyDirRecursive(src, dst);
        } else {
          copyFileSync(src, dst);
        }
      }
    } catch {
      rmSync(targetDir, { recursive: true, force: true });
      return null;
    }

    this.load();
    return this.extensions.get(id) ?? null;
  }

  async uninstall(id: string): Promise<boolean> {
    const ext = this.extensions.get(id);
    if (!ext) return false;
    if (isCoreExtension(ext.manifest)) return false;

    const dir = join(this.storePath, `${ext.manifest.type}-${ext.manifest.name}`);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { return false; }
    this.extensions.delete(id);
    return true;
  }

  count(): number { return this.extensions.size; }

  canCheckVersion(id: string): boolean {
    const ext = this.extensions.get(id);
    return ext !== undefined;
  }

  getVersionInfo(id: string): VersionInfo | null {
    const ext = this.extensions.get(id);
    if (!ext) return null;
    return {
      version: ext.manifest.version,
      installedAt: ext.installedAt,
      isOutdated: false,
    };
  }

  async updateVersion(id: string, newVersion: string): Promise<boolean> {
    const ext = this.extensions.get(id);
    if (!ext || isCoreExtension(ext.manifest)) return false;

    const manifestPath = join(this.storePath, `${ext.manifest.type}-${ext.manifest.name}`, "EXTENSION.yaml");
    let content: string;
    try {
      content = readFileSync(manifestPath, "utf8");
    } catch { return false; }

    const updated = content.replace(/version:\s*[\d.]+/, `version: ${newVersion}`);
    writeFileSync(manifestPath, updated, "utf8");
    this.load();
    return true;
  }
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}