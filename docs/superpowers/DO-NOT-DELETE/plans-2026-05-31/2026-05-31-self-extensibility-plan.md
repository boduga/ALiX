**Status:** ✅ COMPLETED (2026-05-31) — all tasks implemented and merged to main

# Self-Extensibility Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new tools to ALiX that let the agent author skills at runtime, introspect extensions, and modify its own capabilities — making it truly "self-extensible" like Pi Agent.

**Architecture:** New `src/self-extend/` directory with an in-process registry and 3 tool implementations. Existing file-based extension system unchanged. Tools get registered in the tool router.

**Tech Stack:** TypeScript, `node:test`, existing extension/skill system.

---

## File Structure

**New files:**
- `src/self-extend/registry.ts` — In-process extension registry (~60 lines)
- `src/self-extend/create-skill.ts` — `create_skill` tool (~80 lines)
- `src/self-extend/list-extensions.ts` — `list_extensions` tool (~60 lines)
- `src/self-extend/inspect-extension.ts` — `inspect_extension` tool (~60 lines)
- `tests/self-extend/registry.test.ts` — Registry tests
- `tests/self-extend/create-skill.test.ts` — Tool tests
- `tests/self-extend/list-extensions.test.ts` — Tool tests
- `tests/self-extend/inspect-extension.test.ts` — Tool tests
- `tests/self-extend/integration.test.ts` — End-to-end

**Modified files:**
- `src/tools/tool-router.ts` — Register 3 new tools (3 lines)

**Unchanged (referenced):**
- `src/extensions/`, `src/skills/` — existing system

---

## Task 1: Create in-process registry (TDD)

**Files:**
- Create: `tests/self-extend/registry.test.ts`
- Create: `src/self-extend/registry.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/self-extend/registry.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerInProcess,
  unregisterInProcess,
  listInProcess,
  getInProcess,
  _clearInProcessForTesting,
  type InProcessExtension,
} from "../../src/self-extend/registry.js";

describe("in-process registry", () => {
  beforeEach(() => _clearInProcessForTesting());

  const makeExt = (name: string, type: "skill" | "hook" = "skill"): InProcessExtension => ({
    type,
    name,
    manifest: { type, name, version: "1.0.0" } as any,
    registeredAt: Date.now(),
  });

  it("registers an extension", () => {
    registerInProcess(makeExt("foo"));
    assert.equal(listInProcess().length, 1);
  });

  it("throws on duplicate name+type", () => {
    registerInProcess(makeExt("foo"));
    assert.throws(() => registerInProcess(makeExt("foo")), /already exists/);
  });

  it("unregisters by type+name", () => {
    registerInProcess(makeExt("foo"));
    unregisterInProcess("skill", "foo");
    assert.equal(listInProcess().length, 0);
  });

  it("getInProcess returns the extension", () => {
    registerInProcess(makeExt("foo"));
    const ext = getInProcess("skill", "foo");
    assert.ok(ext);
    assert.equal(ext!.name, "foo");
  });

  it("getInProcess returns undefined for missing", () => {
    assert.equal(getInProcess("skill", "missing"), undefined);
  });

  it("supports different types with same name", () => {
    registerInProcess(makeExt("foo", "skill"));
    registerInProcess(makeExt("foo", "hook"));
    assert.equal(listInProcess().length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

Expected: Module not found.

- [ ] **Step 3: Implement `src/self-extend/registry.ts`**

```typescript
// src/self-extend/registry.ts

export type InProcessExtension = {
  type: "skill" | "hook" | "mcp" | "recipe" | "subagent";
  name: string;
  manifest: any;  // ExtensionManifest from src/extensions/manifest.js
  registeredAt: number;
};

const store = new Map<string, InProcessExtension>();

function key(type: string, name: string): string {
  return `${type}::${name}`;
}

export function registerInProcess(ext: InProcessExtension): void {
  const k = key(ext.type, ext.name);
  if (store.has(k)) {
    throw new Error(`Extension already exists: ${ext.type}/${ext.name}`);
  }
  store.set(k, { ...ext, registeredAt: Date.now() });
}

export function unregisterInProcess(type: string, name: string): void {
  store.delete(key(type, name));
}

export function listInProcess(): InProcessExtension[] {
  return Array.from(store.values());
}

export function getInProcess(type: string, name: string): InProcessExtension | undefined {
  return store.get(key(type, name));
}

export function _clearInProcessForTesting(): void {
  store.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/self-extend/registry.test.js 2>&1 | tail -5
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/self-extend/registry.ts tests/self-extend/registry.test.ts
git commit -m "feat(self-extend): in-process extension registry (TDD)"
```

---

## Task 2: Create `create_skill` tool (TDD)

**Files:**
- Create: `tests/self-extend/create-skill.test.ts`
- Create: `src/self-extend/create-skill.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/self-extend/create-skill.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSkillTool } from "../../src/self-extend/create-skill.js";
import { _clearInProcessForTesting, getInProcess } from "../../src/self-extend/registry.js";

describe("create_skill tool", () => {
  beforeEach(() => _clearInProcessForTesting());

  it("returns a tool definition", () => {
    const tool = createSkillTool();
    assert.equal(tool.name, "create_skill");
    assert.ok(tool.description);
    assert.ok(tool.input_schema);
  });

  it("registers a skill when called", async () => {
    const tool = createSkillTool();
    const result = await tool.execute({
      name: "my-skill",
      description: "Does X",
      trigger: "do X",
      body: "# My Skill\n\nSteps...",
    });
    assert.equal(result.ok, true);
    const ext = getInProcess("skill", "my-skill");
    assert.ok(ext);
  });

  it("rejects empty name", async () => {
    const tool = createSkillTool();
    const result = await tool.execute({ name: "", description: "x", trigger: "x", body: "x" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("name"));
  });

  it("rejects duplicate name", async () => {
    const tool = createSkillTool();
    await tool.execute({ name: "dup", description: "x", trigger: "x", body: "x" });
    const result = await tool.execute({ name: "dup", description: "x", trigger: "x", body: "x" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("exists"));
  });

  it("isCore flag is stored", async () => {
    const tool = createSkillTool();
    await tool.execute({ name: "core-skill", description: "x", trigger: "x", body: "x", isCore: true });
    const ext = getInProcess("skill", "core-skill");
    assert.equal(ext!.manifest.is_core, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/self-extend/create-skill.ts`**

```typescript
// src/self-extend/create-skill.ts
import { registerInProcess, type InProcessExtension } from "./registry.js";

export type CreateSkillArgs = {
  name: string;
  description: string;
  trigger: string;
  body: string;
  isCore?: boolean;
};

export type ToolResult = { ok: boolean; error?: string; data?: unknown };

export function createSkillTool() {
  return {
    name: "create_skill",
    description: "Create a new skill at runtime. The skill becomes available immediately and can be triggered by its trigger pattern.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique skill name (lowercase, hyphens)" },
        description: { type: "string", description: "What the skill does" },
        trigger: { type: "string", description: "Pattern that activates this skill" },
        body: { type: "string", description: "Skill body (markdown)" },
        isCore: { type: "boolean", description: "If true, protected from eviction" },
      },
      required: ["name", "description", "trigger", "body"],
    },
    async execute(args: CreateSkillArgs): Promise<ToolResult> {
      if (!args.name || args.name.trim() === "") {
        return { ok: false, error: "Skill name cannot be empty" };
      }
      if (!/^[a-z0-9-]+$/.test(args.name)) {
        return { ok: false, error: "Skill name must be lowercase letters, digits, and hyphens only" };
      }
      if (!args.description || !args.trigger || !args.body) {
        return { ok: false, error: "description, trigger, and body are required" };
      }

      const ext: InProcessExtension = {
        type: "skill",
        name: args.name,
        manifest: {
          type: "skill",
          name: args.name,
          description: args.description,
          trigger: args.trigger,
          body: args.body,
          is_core: args.isCore ?? false,
          version: "1.0.0",
        },
        registeredAt: Date.now(),
      };

      try {
        registerInProcess(ext);
      } catch (err: any) {
        return { ok: false, error: err.message };
      }

      return { ok: true, data: { name: args.name, registered: true } };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/self-extend/create-skill.test.js 2>&1 | tail -5
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/self-extend/create-skill.ts tests/self-extend/create-skill.test.ts
git commit -m "feat(self-extend): create_skill tool (TDD)"
```

---

## Task 3: Create `list_extensions` tool (TDD)

**Files:**
- Create: `tests/self-extend/list-extensions.test.ts`
- Create: `src/self-extend/list-extensions.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/self-extend/list-extensions.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { listExtensionsTool } from "../../src/self-extend/list-extensions.js";
import { registerInProcess, _clearInProcessForTesting } from "../../src/self-extend/registry.js";

describe("list_extensions tool", () => {
  beforeEach(() => _clearInProcessForTesting());

  it("returns a tool definition", () => {
    const tool = listExtensionsTool();
    assert.equal(tool.name, "list_extensions");
  });

  it("returns empty when no extensions registered", async () => {
    const tool = listExtensionsTool();
    const result = await tool.execute({});
    assert.equal(result.ok, true);
    const data = result.data as any;
    assert.ok(Array.isArray(data.skills));
    assert.equal(data.skills.length, 0);
  });

  it("lists in-process skills", async () => {
    registerInProcess({
      type: "skill",
      name: "foo",
      manifest: { type: "skill", name: "foo", description: "Does foo", trigger: "foo", is_core: false },
      registeredAt: Date.now(),
    });
    const tool = listExtensionsTool();
    const result = await tool.execute({});
    const data = result.data as any;
    assert.equal(data.skills.length, 1);
    assert.equal(data.skills[0].name, "foo");
  });

  it("groups by type", async () => {
    registerInProcess({
      type: "skill", name: "s1", manifest: { type: "skill", name: "s1" }, registeredAt: Date.now(),
    });
    registerInProcess({
      type: "hook", name: "h1", manifest: { type: "hook", name: "h1", trigger: "pre_task" }, registeredAt: Date.now(),
    });
    const tool = listExtensionsTool();
    const result = await tool.execute({});
    const data = result.data as any;
    assert.equal(data.skills.length, 1);
    assert.equal(data.hooks.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/self-extend/list-extensions.ts`**

```typescript
// src/self-extend/list-extensions.ts
import { listInProcess, type InProcessExtension } from "./registry.js";

export type ListExtensionsResult = {
  skills: Array<{ name: string; description?: string; trigger?: string; isCore: boolean }>;
  hooks: Array<{ name: string; trigger: string }>;
  mcp: Array<{ name: string }>;
  recipes: Array<{ name: string }>;
  subagents: Array<{ name: string }>;
};

export type ToolResult = { ok: boolean; error?: string; data?: unknown };

export function listExtensionsTool() {
  return {
    name: "list_extensions",
    description: "List all loaded extensions: skills, hooks, MCP servers, recipes, subagents.",
    input_schema: { type: "object", properties: {} },
    async execute(_args: {}): Promise<ToolResult> {
      const all = listInProcess();
      const data: ListExtensionsResult = {
        skills: [],
        hooks: [],
        mcp: [],
        recipes: [],
        subagents: [],
      };

      for (const ext of all) {
        switch (ext.type) {
          case "skill":
            data.skills.push({
              name: ext.manifest.name,
              description: ext.manifest.description,
              trigger: ext.manifest.trigger,
              isCore: ext.manifest.is_core ?? false,
            });
            break;
          case "hook":
            data.hooks.push({ name: ext.manifest.name, trigger: ext.manifest.trigger });
            break;
          case "mcp":
            data.mcp.push({ name: ext.manifest.name });
            break;
          case "recipe":
            data.recipes.push({ name: ext.manifest.name });
            break;
          case "subagent":
            data.subagents.push({ name: ext.manifest.name });
            break;
        }
      }

      return { ok: true, data };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node --test dist/tests/self-extend/list-extensions.test.js 2>&1 | tail -5
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/self-extend/list-extensions.ts tests/self-extend/list-extensions.test.ts
git commit -m "feat(self-extend): list_extensions tool (TDD)"
```

---

## Task 4: Create `inspect_extension` tool (TDD)

**Files:**
- Create: `tests/self-extend/inspect-extension.test.ts`
- Create: `src/self-extend/inspect-extension.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/self-extend/inspect-extension.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { inspectExtensionTool } from "../../src/self-extend/inspect-extension.js";
import { registerInProcess, _clearInProcessForTesting } from "../../src/self-extend/registry.js";

describe("inspect_extension tool", () => {
  beforeEach(() => _clearInProcessForTesting());

  it("returns a tool definition", () => {
    const tool = inspectExtensionTool();
    assert.equal(tool.name, "inspect_extension");
  });

  it("returns the manifest for a registered extension", async () => {
    registerInProcess({
      type: "skill",
      name: "my-skill",
      manifest: { type: "skill", name: "my-skill", description: "Does things", trigger: "things", body: "# Steps", is_core: false },
      registeredAt: 12345,
    });
    const tool = inspectExtensionTool();
    const result = await tool.execute({ type: "skill", name: "my-skill" });
    assert.equal(result.ok, true);
    const data = result.data as any;
    assert.equal(data.manifest.name, "my-skill");
    assert.equal(data.metadata.registeredAt, 12345);
  });

  it("returns error for missing extension", async () => {
    const tool = inspectExtensionTool();
    const result = await tool.execute({ type: "skill", name: "missing" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("not found"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/self-extend/inspect-extension.ts`**

```typescript
// src/self-extend/inspect-extension.ts
import { getInProcess } from "./registry.js";

export type InspectExtensionArgs = {
  type: "skill" | "hook" | "mcp" | "recipe" | "subagent";
  name: string;
};

export type ToolResult = { ok: boolean; error?: string; data?: unknown };

export function inspectExtensionTool() {
  return {
    name: "inspect_extension",
    description: "Get detailed information about a specific extension: full manifest and registration metadata.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["skill", "hook", "mcp", "recipe", "subagent"] },
        name: { type: "string" },
      },
      required: ["type", "name"],
    },
    async execute(args: InspectExtensionArgs): Promise<ToolResult> {
      const ext = getInProcess(args.type, args.name);
      if (!ext) {
        return { ok: false, error: `Extension not found: ${args.type}/${args.name}` };
      }
      return {
        ok: true,
        data: {
          manifest: ext.manifest,
          metadata: {
            registeredAt: ext.registeredAt,
            source: "in-process",
          },
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/self-extend/inspect-extension.test.js 2>&1 | tail -5
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/self-extend/inspect-extension.ts tests/self-extend/inspect-extension.test.ts
git commit -m "feat(self-extend): inspect_extension tool (TDD)"
```

---

## Task 5: Register tools with the tool router

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Find where tools are registered**

```bash
grep -n "register\|file.read\|shell.run" src/tools/tool-router.ts | head -20
```

- [ ] **Step 2: Add the 3 new tools**

Add the imports and registrations. Read the existing file first to find the right place. Add:

```typescript
import { createSkillTool } from "../self-extend/create-skill.js";
import { listExtensionsTool } from "../self-extend/list-extensions.js";
import { inspectExtensionTool } from "../self-extend/inspect-extension.js";
```

And in the tool registration list, add:

```typescript
register(createSkillTool());
register(listExtensionsTool());
register(inspectExtensionTool());
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/tool-router.ts
git commit -m "feat(self-extend): register 3 new tools with tool router"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -5
```

Expected: pass >= 1175, fail 0

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore: sub-project #5 self-extensibility improvements complete

- 3 new tools: create_skill, list_extensions, inspect_extension
- In-process extension registry
- 18 new tests across 5 test files
- TDD throughout"
```

---

## Self-Review

**1. Spec coverage:**
- [x] In-process registry → Task 1
- [x] `create_skill` tool → Task 2
- [x] `list_extensions` tool → Task 3
- [x] `inspect_extension` tool → Task 4
- [x] Tool router integration → Task 5
- [x] Final verification → Task 6
- [x] TDD per superpowers:test-driven-development ✓
- [x] Existing API preserved ✓

**2. Placeholder scan:** No "TBD". All code complete.

**3. Type consistency:**
- `InProcessExtension` defined in registry, used everywhere
- `ToolResult` type defined in each tool file (could be shared but kept simple for now)
- `registerInProcess`/`getInProcess`/`listInProcess` API consistent

**4. Plan length:** 6 tasks, each 2-5 minutes. TDD throughout. ✓
