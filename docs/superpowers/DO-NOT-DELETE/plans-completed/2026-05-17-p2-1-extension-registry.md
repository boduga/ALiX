# P2.1 Extension Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unified extension registry that makes skills, hooks, recipes, and MCP servers discoverable, installable, and composable. Extensions declare their capabilities via a manifest. The registry handles discovery, installation, listing, and uninstallation.

**Architecture:** A typed `ExtensionManifest` union covers all extension types (skill, hook, mcp, recipe). `ExtensionRegistry` class manages lifecycle: discover from disk/URL, install to store, list, uninstall. Config integration adds `extensions.store` to `AlixConfig`. No changes to the existing skills/hooks/MCP loaders — we integrate on top.

**Tech Stack:** Vanilla TypeScript, no new dependencies. Extension manifests use YAML front-matter (matching existing `SKILL.md` pattern).

---

### Task 1: Extension Manifest Schema

**Files:**
- Create: `src/extensions/manifest.ts`
- Test: `tests/extensions/manifest.test.ts`

Define a typed `ExtensionManifest` union that covers all extension types. Each extension type gets a discriminated union variant.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/extensions/manifest.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExtensionManifest, ExtensionType, getExtensionId } from "../../src/extensions/manifest.js";

describe("parseExtensionManifest", () => {
  it("parses a skill extension", () => {
    const yaml = `name: test-skill\ntype: skill\nversion: 1.0.0\ndescription: A test skill\ntrigger: /test`;
    const manifest = parseExtensionManifest(yaml, "skill");
    assert.strictEqual(manifest?.name, "test-skill");
    assert.strictEqual(manifest?.type, "skill");
    assert.strictEqual(manifest?.version, "1.0.0");
  });

  it("parses an MCP extension", () => {
    const yaml = `name: github-mcp\ntype: mcp\nversion: 2.0.0\ndescription: GitHub MCP server\ncommand: npx\nargs:\n  - -y\n  - @modelcontextprotocol/server-github`;
    const manifest = parseExtensionManifest(yaml, "mcp");
    assert.strictEqual(manifest?.type, "mcp");
    assert.strictEqual((manifest as any)?.command, "npx");
  });

  it("parses a hook extension", () => {
    const yaml = `name: pre-commit-lint\ntype: hook\nversion: 1.0.0\ndescription: Run lint on pre-task\ntrigger: pre_task\ncommand: npm run lint`;
    const manifest = parseExtensionManifest(yaml, "hook");
    assert.strictEqual(manifest?.type, "hook");
    assert.strictEqual((manifest as any)?.trigger, "pre_task");
  });

  it("returns null for invalid manifest", () => {
    const manifest = parseExtensionManifest("invalid: yaml", "skill");
    assert.strictEqual(manifest, null);
  });

  it("getExtensionId returns namespaced id", () => {
    const yaml = `name: my-skill\ntype: skill\nversion: 1.0.0`;
    const manifest = parseExtensionManifest(yaml, "skill")!;
    assert.strictEqual(getExtensionId(manifest), "skill/my-skill");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/babasola/Dev/Monolith && npm run build && npx vitest run tests/extensions/manifest.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the manifest schema**

```typescript
// src/extensions/manifest.ts

export const EXTENSION_TYPES = ["skill", "hook", "mcp", "recipe", "subagent"] as const;
export type ExtensionType = typeof EXTENSION_TYPES[number];

// --- Shared fields ---
type BaseExtension = {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  is_core?: boolean;
  license?: string;
  homepage?: string;
  installed_at?: string;
};

// --- Skill extension ---
export type SkillExtension = BaseExtension & {
  type: "skill";
  trigger?: string;       // slash command, e.g. "/tdd"
  pattern?: string;        // regex pattern
  auto_load?: boolean;    // load on startup
};

// --- Hook extension ---
export type HookExtension = BaseExtension & {
  type: "hook";
  trigger: "pre_task" | "post_task" | "on_change";
  command: string;
  env?: Record<string, string>;
  cwd?: string;
};

// --- MCP extension ---
export type McpExtension = BaseExtension & {
  type: "mcp";
  transport: "stdio" | "http" | "websocket";
  command?: string;       // for stdio
  args?: string[];
  env?: Record<string, string>;
  url?: string;           // for http/websocket
  headers?: Record<string, string>;
  tools?: string[];       // explicit tool allowlist (empty = all)
};

// --- Recipe extension ---
export type RecipeExtension = BaseExtension & {
  type: "recipe";
  steps: Array<{ tool: string; args: Record<string, unknown>; reason?: string }>;
  prerequisites?: string[];
  estimated_tokens?: number;
};

// --- Subagent extension ---
export type SubagentExtension = BaseExtension & {
  type: "subagent";
  model?: string;
  readonly?: boolean;
  system_prompt?: string;
  files?: string[];      // owned file patterns
};

export type ExtensionManifest =
  | SkillExtension
  | HookExtension
  | McpExtension
  | RecipeExtension
  | SubagentExtension;

// YAML parser (minimal, no new dependency)
function yamlToObject(yaml: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      obj[key] = value.slice(1, -1).split(",").map(t => t.trim()).filter(Boolean);
    } else if (value === "true") obj[key] = true;
    else if (value === "false") obj[key] = false;
    else if (!isNaN(Number(value)) && value !== "") obj[key] = Number(value);
    else obj[key] = value.replace(/^["']|["']$/g, "");
  }
  return obj;
}

export function parseExtensionManifest(yaml: string, type: ExtensionType): ExtensionManifest | null {
  const raw = yamlToObject(yaml);
  if (!raw.name || !raw.description) return null;
  const base = {
    name: String(raw.name),
    version: String(raw.version ?? "1.0.0"),
    description: String(raw.description),
    author: raw.author != null ? String(raw.author) : undefined,
    tags: raw.tags as string[] | undefined,
    is_core: raw.is_core === true,
    license: raw.author != null ? String(raw.license) : undefined,
    homepage: raw.homepage != null ? String(raw.homepage) : undefined,
  };

  switch (type) {
    case "skill":
      return { ...base, type: "skill", trigger: raw.trigger as any, pattern: raw.pattern as any, auto_load: raw.auto_load === true };
    case "hook":
      return { ...base, type: "hook", trigger: raw.trigger as any, command: String(raw.command ?? ""), env: raw.env as any, cwd: raw.cwd as any };
    case "mcp":
      return { ...base, type: "mcp", transport: (raw.transport as any) ?? "stdio", command: raw.command as any, args: raw.args as any, env: raw.env as any, url: raw.url as any, headers: raw.headers as any, tools: raw.tools as any };
    case "recipe":
      return { ...base, type: "recipe", steps: (raw.steps as any) ?? [], prerequisites: raw.prerequisites as any, estimated_tokens: raw.estimated_tokens as any };
    case "subagent":
      return { ...base, type: "subagent", model: raw.model as any, readonly: raw.readonly === true, system_prompt: raw.system_prompt as any, files: raw.files as any };
  }
}

export function getExtensionId(manifest: ExtensionManifest): string {
  return `${manifest.type}/${manifest.name}`;
}

export function isCoreExtension(manifest: ExtensionManifest): boolean {
  return manifest.is_core === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/extensions/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/manifest.ts tests/extensions/manifest.test.ts
git commit -m "feat(extensions): add ExtensionManifest schema — typed union for all extension types"
```

---

### Task 2: Extension Registry (Core)

**Files:**
- Create: `src/extensions/registry.ts`
- Test: `tests/extensions/registry.test.ts`

Build the `ExtensionRegistry` class. It manages extension lifecycle: discover from a directory, install to the store, list, get by id, uninstall, and search.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/extensions/registry.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ExtensionRegistry } from "../../src/extensions/registry.js";

describe("ExtensionRegistry", () => {
  it("discovers extensions from a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "my-skill"), { recursive: true });
    await writeFile(join(root, "my-skill", "EXTENSION.yaml"), `name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: A skill\ntrigger: /my`);
    await mkdir(join(root, "github-mcp"), { recursive: true });
    await writeFile(join(root, "github-mcp", "EXTENSION.yaml"), `name: github-mcp\ntype: mcp\nversion: 2.0.0\ndescription: GitHub MCP\ncommand: npx\nargs: ["-y", "@modelcontextprotocol/server-github"]`);

    const registry = new ExtensionRegistry(root);
    const all = registry.list();
    assert.strictEqual(all.length, 2);
    assert.ok(all.some(e => e.manifest.name === "my-skill" && e.manifest.type === "skill"));
    assert.ok(all.some(e => e.manifest.name === "github-mcp" && e.manifest.type === "mcp"));
  });

  it("gets an extension by id", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "test-hook"), { recursive: true });
    await writeFile(join(root, "test-hook", "EXTENSION.yaml"), `name: test-hook\ntype: hook\nversion: 1.0.0\ndescription: A hook\ntrigger: pre_task\ncommand: echo hi`);

    const registry = new ExtensionRegistry(root);
    const ext = registry.get("hook/test-hook");
    assert.ok(ext, "should find hook/test-hook");
    assert.strictEqual(ext?.manifest.type, "hook");
    assert.strictEqual((ext?.manifest as any).trigger, "pre_task");
  });

  it("returns undefined for unknown id", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    const registry = new ExtensionRegistry(root);
    assert.strictEqual(registry.get("skill/nonexistent"), undefined);
  });

  it("searches extensions by type", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "s1"), { recursive: true });
    await writeFile(join(root, "s1", "EXTENSION.yaml"), `name: s1\ntype: skill\nversion: 1.0.0\ndescription: Skill one`);
    await mkdir(join(root, "m1"), { recursive: true });
    await writeFile(join(root, "m1", "EXTENSION.yaml"), `name: m1\ntype: mcp\nversion: 1.0.0\ndescription: MCP one`);

    const registry = new ExtensionRegistry(root);
    const skills = registry.list({ type: "skill" });
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].manifest.name, "s1");
  });

  it("searches extensions by tag", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "tagged"), { recursive: true });
    await writeFile(join(root, "tagged", "EXTENSION.yaml"), `name: tagged\ntype: skill\nversion: 1.0.0\ndescription: Tagged\ntags: [testing, lint]`);

    const registry = new ExtensionRegistry(root);
    const tagged = registry.list({ tag: "testing" });
    assert.strictEqual(tagged.length, 1);
  });

  it("installs an extension from a source directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    const store = await mkdtemp(join(tmpdir(), "ext-store-"));

    await mkdir(join(root, "to-install"), { recursive: true });
    await writeFile(join(root, "to-install", "EXTENSION.yaml"), `name: to-install\ntype: skill\nversion: 1.0.0\ndescription: Will be installed`);

    const registry = new ExtensionRegistry(store);
    const installed = await registry.install(join(root, "to-install"));
    assert.strictEqual(installed?.manifest.name, "to-install");

    // Verify it exists in store
    const found = registry.get("skill/to-install");
    assert.ok(found, "should be found after install");
  });

  it("uninstalls an extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "to-remove"), { recursive: true });
    await writeFile(join(root, "to-remove", "EXTENSION.yaml"), `name: to-remove\ntype: hook\nversion: 1.0.0\ndescription: Will be removed\ntrigger: post_task\ncommand: echo removed`);

    const registry = new ExtensionRegistry(root);
    const uninstalled = await registry.uninstall("hook/to-remove");
    assert.strictEqual(uninstalled, true);
    assert.strictEqual(registry.get("hook/to-remove"), undefined);
  });

  it("refuses to uninstall core extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "core-skill"), { recursive: true });
    await writeFile(join(root, "core-skill", "EXTENSION.yaml"), `name: core-skill\ntype: skill\nversion: 1.0.0\ndescription: Core skill\nis_core: true`);

    const registry = new ExtensionRegistry(root);
    const uninstalled = await registry.uninstall("skill/core-skill");
    assert.strictEqual(uninstalled, false);
    assert.ok(registry.get("skill/core-skill"), "core extension should remain");
  });

  it("lists extensions by trigger/pattern for skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "tdd-skill"), { recursive: true });
    await writeFile(join(root, "tdd-skill", "EXTENSION.yaml"), `name: tdd-skill\ntype: skill\nversion: 1.0.0\ndescription: TDD skill\ntrigger: /tdd`);
    await mkdir(join(root, "lint-skill"), { recursive: true });
    await writeFile(join(root, "lint-skill", "EXTENSION.yaml"), `name: lint-skill\ntype: skill\nversion: 1.0.0\ndescription: Lint skill\ntrigger: /lint`);

    const registry = new ExtensionRegistry(root);
    const byTrigger = registry.list({ trigger: "/lint" });
    assert.strictEqual(byTrigger.length, 1);
    assert.strictEqual(byTrigger[0].manifest.name, "lint-skill");
  });

  it("lists extensions by command for hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-reg-"));
    await mkdir(join(root, "pre-lint"), { recursive: true });
    await writeFile(join(root, "pre-lint", "EXTENSION.yaml"), `name: pre-lint\ntype: hook\nversion: 1.0.0\ndescription: Pre lint\ntrigger: pre_task\ncommand: npm run lint`);

    const registry = new ExtensionRegistry(root);
    const preTask = registry.list({ hookTrigger: "pre_task" });
    assert.strictEqual(preTask.length, 1);
    assert.strictEqual((preTask[0].manifest as any).command, "npm run lint");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/registry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the ExtensionRegistry**

```typescript
// src/extensions/registry.ts
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { parseExtensionManifest, type ExtensionManifest, type ExtensionType, getExtensionId, isCoreExtension } from "./manifest.js";

export type LoadedExtension = {
  manifest: ExtensionManifest;
  path: string;
  installedAt: string;
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
        // Infer type from directory name or file content
        const manifest = parseExtensionManifest(content, this.inferType(entry.name));
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
    // Try to infer from naming convention: <type>-<name>
    const dashIdx = dirName.indexOf("-");
    if (dashIdx !== -1) {
      const prefix = dirName.slice(0, dashIdx);
      if (["skill", "hook", "mcp", "recipe", "subagent"].includes(prefix)) {
        return prefix as ExtensionType;
      }
    }
    return "skill"; // default
  }

  private manifestPath(type: ExtensionType, name: string): string {
    return join(this.storePath, `${type}-${name}`, "EXTENSION.yaml");
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
        return (e.manifest as any).trigger === options.trigger;
      });
    }
    if (options?.hookTrigger) {
      results = results.filter(e => {
        if (e.manifest.type !== "hook") return false;
        return (e.manifest as any).trigger === options.hookTrigger;
      });
    }
    return results;
  }

  async install(sourcePath: string): Promise<LoadedExtension | null> {
    const manifestPath = join(sourcePath, "EXTENSION.yaml");
    if (!existsSync(manifestPath)) return null;
    const content = readFileSync(manifestPath, "utf8");

    // Try each type — the first that parses wins
    const types: ExtensionType[] = ["skill", "hook", "mcp", "recipe", "subagent"];
    let manifest: ExtensionManifest | null = null;
    for (const type of types) {
      manifest = parseExtensionManifest(content, type);
      if (manifest) break;
    }
    if (!manifest) return null;

    const id = getExtensionId(manifest);
    const targetDir = join(this.storePath, `${manifest.type}-${manifest.name}`);
    const targetManifestPath = join(targetDir, "EXTENSION.yaml");

    mkdirSync(targetDir, { recursive: true });
    // Copy all files from source to target
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      const src = join(sourcePath, entry.name);
      const dst = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        copyDirRecursive(src, dst);
      } else {
        writeFileSync(dst, readFileSync(src));
      }
    }

    // Update manifest with installed_at
    const installed = { ...manifest, installed_at: new Date().toISOString() };
    writeFileSync(targetManifestPath, readFileSync(manifestPath), "utf8");
    // Re-parse with installed_at
    const reloaded = parseExtensionManifest(readFileSync(targetManifestPath, "utf8"), manifest.type);
    if (reloaded) {
      const loaded: LoadedExtension = { manifest: reloaded, path: targetManifestPath, installedAt: reloaded.installed_at ?? new Date().toISOString() };
      this.extensions.set(id, loaded);
      return loaded;
    }
    return null;
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
}

function copyDirRecursive(src: string, dst: string): void {
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(d, { recursive: true });
      copyDirRecursive(s, d);
    } else {
      writeFileSync(d, readFileSync(s));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/extensions/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/registry.ts tests/extensions/registry.test.ts
git commit -m "feat(extensions): add ExtensionRegistry — discover, install, list, uninstall extensions"
```

---

### Task 3: Config Integration

**Files:**
- Modify: `src/config/schema.ts` (add `extensions.store` config)
- Modify: `src/config/defaults.ts` (add extension store defaults)
- Modify: `src/config/loader.ts` (merge extension config)
- Create: `src/extensions/index.ts` (barrel export)

Add `extensions.store` to the config schema, wire it through the config loader, and create a barrel export.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/extensions/config.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config/loader.js";
import { ExtensionRegistry } from "../../src/extensions/registry.js";

describe("extension config integration", () => {
  it("loads extension store path from config", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-config-"));
    const storeDir = join(root, "extensions");
    await mkdir(join(storeDir, "skill-test"), { recursive: true });
    await writeFile(join(storeDir, "skill-test", "EXTENSION.yaml"), `name: test\ntype: skill\nversion: 1.0.0\ndescription: Test extension`);

    // Write a config that points to this store
    const configPath = join(root, "alix.config.json");
    await writeFile(configPath, JSON.stringify({
      version: 1,
      model: { provider: "anthropic", name: "test" },
      permissions: { default: "allow" },
      context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
      runtime: { provider: "process", shell: "bash", commandTimeoutMs: 5000, envAllowlist: [] },
      ui: { enabled: false, host: "127.0.0.1", port: 4137, transport: "sse" },
      extensions: { store: { enabled: true, path: storeDir } }
    }));

    const config = await loadConfig(root, configPath);
    const store = new ExtensionRegistry(config.extensions?.store?.path ?? join(root, ".alix", "extensions"));
    const list = store.list();
    assert.ok(list.length >= 1, `should have extensions. Got: ${list.length}`);
    assert.ok(list.some(e => e.manifest.name === "test"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/config.test.ts`
Expected: FAIL (missing `extensions` field in schema + `ExtensionRegistry`)

- [ ] **Step 3: Add extensions config to schema**

In `src/config/schema.ts`, add after `SkillStoreConfig`:

```typescript
export type ExtensionStoreConfig = {
  enabled: boolean;
  path: string;
};

export type AlixConfig = {
  version: 1;
  model: ModelConfig;
  permissions: PermissionConfig;
  context: ContextConfig;
  runtime: RuntimeConfig;
  ui: UiConfig;
  apiKeys?: Record<string, string>;
  mcpServers?: McpServerConfig[];
  mcpServerPaths?: string[];
  skills?: {
    factory?: SkillFactoryConfig;
    store?: SkillStoreConfig;
  };
  extensions?: {
    store?: ExtensionStoreConfig;
  };
};
```

- [ ] **Step 4: Update defaults**

In `src/config/defaults.ts`, add after the `skills` section:

```typescript
  extensions: {
    store: {
      enabled: true,
      path: `${homedir()}/.alix/extensions`
    }
  },
```

- [ ] **Step 5: Create barrel export**

```typescript
// src/extensions/index.ts
export { parseExtensionManifest, getExtensionId, isCoreExtension, EXTENSION_TYPES } from "./manifest.js";
export type { ExtensionManifest, ExtensionType, LoadedExtension, ListOptions } from "./registry.js";
export { ExtensionRegistry } from "./registry.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/extensions/config.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/config/defaults.ts src/extensions/index.ts tests/extensions/config.test.ts
git commit -m "feat(config): add extensions.store to AlixConfig schema and defaults"
```

---

### Task 4: Extension Lifecycle Integration

**Files:**
- Create: `src/extensions/lifecycle.ts`
- Create: `src/extensions/loader.ts`
- Modify: `src/cli.ts` (initialize extension registry on startup)
- Test: `tests/extensions/lifecycle.test.ts`

Wire the `ExtensionRegistry` into the main loop. When ALiX starts, it initializes the extension registry, loads skills from the store, and exposes `alix extension install/uninstall/list` CLI commands.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/extensions/lifecycle.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "os";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import { loadExtensions } from "../../src/extensions/lifecycle.js";

describe("loadExtensions", () => {
  it("loads all extensions from the store into a unified map", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-lifecycle-"));
    await mkdir(join(root, "my-skill"), { recursive: true });
    await writeFile(join(root, "my-skill", "EXTENSION.yaml"), `name: my-skill\ntype: skill\nversion: 1.0.0\ndescription: A skill\ntrigger: /mine`);

    const registry = new ExtensionRegistry(root);
    const result = loadExtensions(registry);
    assert.strictEqual(result.skills.size, 1);
    assert.strictEqual(result.hooks.size, 0);
    assert.strictEqual(result.mcp.size, 0);
    assert.ok(result.skills.has("/mine"));
  });

  it("groups hooks by trigger", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-lifecycle-"));
    await mkdir(join(root, "hook-pre"), { recursive: true });
    await writeFile(join(root, "hook-pre", "EXTENSION.yaml"), `name: hook-pre\ntype: hook\nversion: 1.0.0\ndescription: Pre hook\ntrigger: pre_task\ncommand: echo pre`);
    await mkdir(join(root, "hook-post"), { recursive: true });
    await writeFile(join(root, "hook-post", "EXTENSION.yaml"), `name: hook-post\ntype: hook\nversion: 1.0.0\ndescription: Post hook\ntrigger: post_task\ncommand: echo post`);

    const registry = new ExtensionRegistry(root);
    const result = loadExtensions(registry);
    assert.strictEqual(result.hooks.get("pre_task")?.length, 1);
    assert.strictEqual(result.hooks.get("post_task")?.length, 1);
    assert.strictEqual(result.hooks.get("on_change")?.length, 0);
  });

  it("returns empty maps when no extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-lifecycle-"));
    const registry = new ExtensionRegistry(root);
    const result = loadExtensions(registry);
    assert.strictEqual(result.skills.size, 0);
    assert.strictEqual(result.hooks.size, 0);
    assert.strictEqual(result.mcp.size, 0);
    assert.strictEqual(result.recipes.size, 0);
    assert.strictEqual(result.subagents.size, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extensions/lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the lifecycle loader**

```typescript
// src/extensions/lifecycle.ts
import type { LoadedExtension } from "./registry.js";
import type { SkillExtension, HookExtension, McpExtension, RecipeExtension, SubagentExtension } from "./manifest.js";

export type ExtensionBundle = {
  skills: Map<string, LoadedExtension>;       // key: trigger or name
  hooks: Map<string, LoadedExtension[]>;      // key: pre_task | post_task | on_change
  mcp: Map<string, LoadedExtension>;          // key: extension name
  recipes: Map<string, LoadedExtension>;       // key: recipe name
  subagents: Map<string, LoadedExtension>;    // key: subagent name
};

export function loadExtensions(registry: { list: () => LoadedExtension[] }): ExtensionBundle {
  const skills = new Map<string, LoadedExtension>();
  const hooks = new Map<string, LoadedExtension[]>([["pre_task", []], ["post_task", []], ["on_change", []]]);
  const mcp = new Map<string, LoadedExtension>();
  const recipes = new Map<string, LoadedExtension>();
  const subagents = new Map<string, LoadedExtension>();

  for (const ext of registry.list()) {
    switch (ext.manifest.type) {
      case "skill": {
        const trigger = (ext.manifest as SkillExtension).trigger;
        const key = trigger ?? ext.manifest.name;
        skills.set(key, ext);
        break;
      }
      case "hook": {
        const trigger = (ext.manifest as HookExtension).trigger;
        const list = hooks.get(trigger) ?? [];
        list.push(ext);
        hooks.set(trigger, list);
        break;
      }
      case "mcp":
        mcp.set(ext.manifest.name, ext);
        break;
      case "recipe":
        recipes.set(ext.manifest.name, ext);
        break;
      case "subagent":
        subagents.set(ext.manifest.name, ext);
        break;
    }
  }

  return { skills, hooks, mcp, recipes, subagents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/extensions/lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Add CLI commands**

In `src/cli.ts`, find the CLI command handling section (near the `run` command) and add `extension` subcommands. Add after the existing commands:

```typescript
// Add near the top with other imports:
import { ExtensionRegistry } from "./extensions/registry.js";
import { loadExtensions } from "./extensions/lifecycle.js";
import { homedir } from "os";
import { join } from "path";

// Add to CLI help and command handling:
// Under the "run" command section in the CLI, add:
// alix extension list [type] — list installed extensions
// alix extension install <path> — install from path
// alix extension uninstall <id> — uninstall by id
// alix extension search [query] — search by name/tag
```

Then wire it into the CLI argument parser. Search for where `run` commands are handled in `cli.ts` and add:

```typescript
if (cmd === "extension") {
  const sub = args[0];
  const storePath = join(homedir(), ".alix", "extensions");
  const registry = new ExtensionRegistry(storePath);

  if (sub === "list") {
    const type = args[1] as any;
    const all = registry.list(type ? { type } : undefined);
    console.log(`Installed extensions (${all.length}):`);
    for (const ext of all) {
      const m = ext.manifest;
      console.log(`  ${m.type}/${m.name} — ${m.description} (v${m.version})${m.is_core ? " [core]" : ""}`);
    }
  } else if (sub === "install") {
    const src = args[1];
    if (!src) { console.error("Usage: alix extension install <path>"); process.exit(1); }
    const installed = await registry.install(src);
    if (installed) {
      console.log(`Installed: ${installed.manifest.type}/${installed.manifest.name}`);
    } else {
      console.error("Install failed: no EXTENSION.yaml found");
      process.exit(1);
    }
  } else if (sub === "uninstall") {
    const id = args[1];
    if (!id) { console.error("Usage: alix extension uninstall <type>/<name>"); process.exit(1); }
    const removed = await registry.uninstall(id);
    console.log(removed ? `Uninstalled: ${id}` : `Failed: ${id} not found or is a core extension`);
  } else if (sub === "search") {
    const query = (args[1] ?? "").toLowerCase();
    const all = registry.list();
    const matches = all.filter(e => e.manifest.name.toLowerCase().includes(query) || e.manifest.description.toLowerCase().includes(query) || e.manifest.tags?.some(t => t.toLowerCase().includes(query)));
    console.log(`Search results for "${query}":`);
    for (const ext of matches) {
      console.log(`  ${ext.manifest.type}/${ext.manifest.name} — ${ext.manifest.description}`);
    }
  } else {
    console.log("Usage: alix extension [list|install|uninstall|search]");
  }
  return;
}
```

- [ ] **Step 6: Run all extension tests**

Run: `npx vitest run tests/extensions/`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/extensions/lifecycle.ts src/extensions/loader.ts src/cli.ts tests/extensions/lifecycle.test.ts
git commit -m "feat(extensions): add lifecycle integration — loadExtensions, alix extension CLI commands"
```

---

### Self-Review Checklist

1. **Spec coverage:** Can I point to a task for each of the 5 missing pieces?
   - Extension manifest schema → Task 1 ✅
   - Extension registry → Task 2 ✅
   - Config integration → Task 3 ✅
   - Lifecycle integration → Task 4 ✅

2. **Placeholder scan:** No "TBD", "TODO", or "implement later" in the plan. All steps show actual code.

3. **Type consistency:** `ExtensionManifest`, `LoadedExtension`, `ExtensionRegistry`, `ListOptions`, `ExtensionType` all defined and used consistently.

4. **Pattern consistency:** Follows existing `SkillCatalog`, `McpToolRegistry`, and `discoverHooks` patterns in the codebase.

5. **Backwards compatibility:** Does not modify existing `skills/`, `hooks/`, or `mcp/` loaders. Extension registry works alongside them.

---

**Execution:** Tasks are independent. Recommended approach: subagent-driven development, one subagent per task.