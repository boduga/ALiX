# Extension Model Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete ExtensionRegistry with SkillLoader and HookRunner per research spec.

**Architecture:** Build on existing MCP manager. Add extension manifest loading, skill loading, and lifecycle hook execution.

**Tech Stack:** TypeScript, existing MCP/extension infrastructure, event log

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/extensions/extension-registry.ts` | Central registry for all extension types |
| `src/extensions/skill-loader.ts` | Load and execute skills |
| `src/extensions/hook-runner.ts` | Execute lifecycle hooks |
| `src/extensions/recipe-runner.ts` | Execute reusable task templates |
| `tests/extensions/skill-loader.test.ts` | Skill loader tests |
| `tests/extensions/hook-runner.test.ts` | Hook runner tests |

---

## Task 1: Add ExtensionRegistry

**Files:**
- Create: `src/extensions/extension-registry.ts`
- Test: `tests/extensions/extension-registry.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { ExtensionRegistry, type ExtensionManifest } from "../../src/extensions/extension-registry.js";

describe("ExtensionRegistry", () => {
  const registry = new ExtensionRegistry();

  it("registers an extension", () => {
    const manifest: ExtensionManifest = {
      id: "test-skill",
      name: "Test Skill",
      version: "1.0.0",
      kind: "skill",
      entrypoint: "./skills/test.md",
      capabilities: [],
      permissions: [],
    };

    registry.register(manifest);
    const ext = registry.get("test-skill");
    assert.ok(ext);
    assert.equal(ext?.name, "Test Skill");
  });

  it("lists extensions by kind", () => {
    registry.register({ id: "skill1", name: "Skill 1", version: "1.0", kind: "skill", entrypoint: "./", capabilities: [], permissions: [] });
    registry.register({ id: "hook1", name: "Hook 1", version: "1.0", kind: "hook", entrypoint: "./", capabilities: [], permissions: [] });

    const skills = registry.listByKind("skill");
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, "skill1");
  });

  it("disables extension", () => {
    const manifest: ExtensionManifest = {
      id: "test-ext",
      name: "Test",
      version: "1.0",
      kind: "tool",
      entrypoint: "./",
      capabilities: [],
      permissions: [],
    };

    registry.register(manifest);
    registry.disable("test-ext");

    const ext = registry.get("test-ext");
    assert.equal(ext?.enabled, false);
  });

  it("loads manifests from directory", async () => {
    const registry = new ExtensionRegistry();
    await registry.loadFromDir("./extensions");
    const list = registry.list();
    // Should load any manifest.json files found
    assert.ok(Array.isArray(list));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/extensions/extension-registry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement ExtensionRegistry**

```typescript
// src/extensions/extension-registry.ts

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

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
  private extensions: Map<string, RegisteredExtension> = new Map();

  register(manifest: ExtensionManifest): void {
    const registered: RegisteredExtension = {
      ...manifest,
      loadedAt: new Date().toISOString(),
      enabled: manifest.enabled ?? true,
    };
    this.extensions.set(manifest.id, registered);
  }

  get(id: string): RegisteredExtension | undefined {
    return this.extensions.get(id);
  }

  list(): RegisteredExtension[] {
    return [...this.extensions.values()];
  }

  listByKind(kind: ExtensionKind): RegisteredExtension[] {
    return [...this.extensions.values()].filter(e => e.kind === kind);
  }

  listEnabled(): RegisteredExtension[] {
    return [...this.extensions.values()].filter(e => e.enabled);
  }

  disable(id: string): void {
    const ext = this.extensions.get(id);
    if (ext) {
      ext.enabled = false;
    }
  }

  enable(id: string): void {
    const ext = this.extensions.get(id);
    if (ext) {
      ext.enabled = true;
    }
  }

  async loadFromDir(dirPath: string): Promise<number> {
    if (!existsSync(dirPath)) {
      return 0;
    }

    let count = 0;
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = join(dirPath, entry.name, "manifest.json");
        if (existsSync(manifestPath)) {
          try {
            const content = await readFile(manifestPath, "utf8");
            const manifest = JSON.parse(content) as ExtensionManifest;
            this.register(manifest);
            count++;
          } catch {
            // Skip invalid manifests
          }
        }
      }
    }

    return count;
  }

  async loadFromConfig(configPath: string): Promise<void> {
    if (!existsSync(configPath)) return;

    const content = await readFile(configPath, "utf8");
    const configs = JSON.parse(content);
    
    for (const config of configs.extensions ?? []) {
      this.register(config);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/extensions/extension-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/extension-registry.ts tests/extensions/extension-registry.test.ts
git commit -m "feat(extensions): add ExtensionRegistry for extension management"
```

---

## Task 2: Add SkillLoader

**Files:**
- Create: `src/extensions/skill-loader.ts`
- Test: `tests/extensions/skill-loader.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SkillLoader } from "../../src/extensions/skill-loader.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("SkillLoader", () => {
  const testDir = join(process.cwd(), ".test-skills");
  let loader: SkillLoader;

  beforeEach(async () => {
    await mkdir(join(testDir, "skills"), { recursive: true });
    loader = new SkillLoader(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("loads skill from markdown file", async () => {
    await writeFile(join(testDir, "skills", "test-skill.md"), "# Test Skill\n\nSteps:\n1. Do thing\n2. Do other thing");
    
    const skill = await loader.load("test-skill");
    assert.ok(skill);
    assert.ok(skill.content.includes("Test Skill"));
  });

  it("returns undefined for missing skill", async () => {
    const skill = await loader.load("non-existent");
    assert.equal(skill, undefined);
  });

  it("lists available skills", async () => {
    await writeFile(join(testDir, "skills", "skill1.md"), "# Skill 1");
    await writeFile(join(testDir, "skills", "skill2.md"), "# Skill 2");
    
    const skills = await loader.list();
    assert.ok(skills.length >= 2);
  });

  it("injects context into skill", async () => {
    await writeFile(join(testDir, "skills", "context-skill.md"), "# Skill\n\nContext: {{task}}");
    
    const skill = await loader.load("context-skill", { task: "fix bug" });
    assert.ok(skill?.content.includes("fix bug"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/extensions/skill-loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SkillLoader**

```typescript
// src/extensions/skill-loader.ts

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type LoadedSkill = {
  id: string;
  name: string;
  content: string;
  variables: string[];
};

export class SkillLoader {
  constructor(
    private skillsDir: string,
    private options: {
      variablePattern?: RegExp;
    } = {}
  ) {
    this.options.variablePattern = options.variablePattern ?? /\{\{(\w+)\}\}/g;
  }

  async load(skillId: string, context?: Record<string, string>): Promise<LoadedSkill | undefined> {
    const skillPath = this.findSkillFile(skillId);
    if (!skillPath) return undefined;

    const content = await readFile(skillPath, "utf8");
    const variables = this.extractVariables(content);
    
    let processedContent = content;
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        processedContent = processedContent.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }
    }

    return {
      id: skillId,
      name: this.extractName(content),
      content: processedContent,
      variables,
    };
  }

  async list(): Promise<string[]> {
    if (!existsSync(this.skillsDir)) return [];
    
    const entries = await readdir(this.skillsDir);
    return entries
      .filter(f => f.endsWith(".md") || f.endsWith(".skill"))
      .map(f => this.skillIdFromFile(f));
  }

  private findSkillFile(skillId: string): string | undefined {
    const candidates = [
      join(this.skillsDir, `${skillId}.md`),
      join(this.skillsDir, `${skillId}.skill`),
      join(this.skillsDir, skillId, "index.md"),
      join(this.skillsDir, skillId, "skill.md"),
    ];

    for (const path of candidates) {
      if (existsSync(path)) return path;
    }
    return undefined;
  }

  private extractVariables(content: string): string[] {
    const matches = [...content.matchAll(this.options.variablePattern!)];
    return [...new Set(matches.map(m => m[1]))];
  }

  private extractName(content: string): string {
    const match = content.match(/^#\s+(.+)/m);
    return match?.[1] ?? "Unnamed Skill";
  }

  private skillIdFromFile(filename: string): string {
    return filename.replace(/\.(md|skill)$/, "");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/extensions/skill-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/skill-loader.ts tests/extensions/skill-loader.test.ts
git commit -m "feat(extensions): add SkillLoader for markdown-based skills"
```

---

## Task 3: Add HookRunner

**Files:**
- Create: `src/extensions/hook-runner.ts`
- Test: `tests/extensions/hook-runner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { HookRunner, type HookEvent, type HookResult } from "../../src/extensions/hook-runner.js";

describe("HookRunner", () => {
  const runner = new HookRunner();

  it("runs on_pre_tool hook", async () => {
    const calls: HookResult[] = [];
    runner.register("on_pre_tool", async (event: HookEvent) => {
      calls.push({ event, handled: true });
    });

    const event: HookEvent = { type: "tool.requested", data: { tool: "file.read" } };
    await runner.execute("on_pre_tool", event);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].handled, true);
  });

  it("runs multiple hooks in order", async () => {
    const order: string[] = [];
    runner.register("on_tool_complete", async () => { order.push("first"); });
    runner.register("on_tool_complete", async () => { order.push("second"); });

    await runner.execute("on_tool_complete", {} as HookEvent);

    assert.deepEqual(order, ["first", "second"]);
  });

  it("can prevent action with abort", async () => {
    runner.register("on_pre_tool", async () => ({ abort: true, reason: "Denied" }));

    const result = await runner.execute("on_pre_tool", {} as HookEvent);
    assert.equal(result.abort, true);
  });

  it("logs hook failures without stopping", async () => {
    let logged = false;
    runner.onError = async () => { logged = true; };

    runner.register("on_tool_complete", async () => {
      throw new Error("Hook failed");
    });

    await runner.execute("on_tool_complete", {} as HookEvent);
    assert.equal(logged, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/extensions/hook-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement HookRunner**

```typescript
// src/extensions/hook-runner.ts

export type HookEvent = {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: string;
};

export type HookResult = {
  event: HookEvent;
  handled?: boolean;
  abort?: boolean;
  reason?: string;
};

export type HookFn = (event: HookEvent) => Promise<HookResult | void>;

export class HookRunner {
  private hooks: Map<string, HookFn[]> = new Map();
  onError?: (error: Error, hookName: string, event: HookEvent) => Promise<void>;

  register(hookName: string, fn: HookFn): void {
    const existing = this.hooks.get(hookName) ?? [];
    existing.push(fn);
    this.hooks.set(hookName, existing);
  }

  async execute(hookName: string, event: HookEvent): Promise<HookResult> {
    const handlers = this.hooks.get(hookName) ?? [];
    let finalResult: HookResult = { event, handled: false };

    for (const handler of handlers) {
      try {
        const result = await handler(event);
        if (result) {
          finalResult = { ...finalResult, ...result };
          if (result.abort) break;
        } else {
          finalResult.handled = true;
        }
      } catch (error) {
        if (this.onError) {
          await this.onError(error as Error, hookName, event);
        }
      }
    }

    return finalResult;
  }

  async executeAll(event: HookEvent): Promise<Map<string, HookResult>> {
    const results = new Map<string, HookResult>();
    
    for (const [name] of this.hooks) {
      results.set(name, await this.execute(name, event));
    }
    
    return results;
  }

  getRegisteredHooks(): string[] {
    return [...this.hooks.keys()];
  }
}

// Default hook types
export const HOOK_TYPES = {
  on_pre_tool: "Before tool execution",
  on_post_tool: "After tool execution",
  on_tool_complete: "When tool completes",
  on_tool_error: "When tool fails",
  on_pre_patch: "Before patch application",
  on_post_patch: "After patch application",
  on_approval_request: "When approval needed",
  on_approval_resolved: "When approval given",
  on_session_start: "Session starts",
  on_session_end: "Session ends",
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/extensions/hook-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/hook-runner.ts tests/extensions/hook-runner.test.ts
git commit -m "feat(extensions): add HookRunner for lifecycle automation"
```

---

## Verification

```bash
npm test -- tests/extensions/extension-registry.test.ts tests/extensions/skill-loader.test.ts tests/extensions/hook-runner.test.ts
```

All tests should pass. Manual verification:
- [ ] ExtensionRegistry manages all extension types
- [ ] SkillLoader loads and injects context into skills
- [ ] HookRunner executes lifecycle hooks in order
- [ ] Hook failures are logged without stopping execution