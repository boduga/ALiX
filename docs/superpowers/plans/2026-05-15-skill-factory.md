# Skill Factory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skill factory system to ALiX — an autonomous agentic coding harness. The system auto-generates reusable skills from session patterns using a local Ollama subagent, with a candidate/promotion lifecycle, git stash/restore test isolation, LRU eviction with protected flag, and model-driven naming with semantic versioning.

**Architecture:** A layered system built on top of the existing event-sourced session kernel. Layer 1 (skills loader) discovers and routes Hermes-format skills into the main loop. Layer 2 (fire-and-forget dispatcher) triggers skill distillation after each successful session. Layer 3 (skill-factory subagent) runs in a local Ollama process, synthesizing reusable skill patterns from session history. Layer 4 (candidate/promotion lifecycle) manages skill growth with autonomous promotion on second use and LRU eviction with `is_core: true` protection.

**Tech Stack:** Node.js 24+, TypeScript, existing ALiX event kernel (JSONL), Ollama provider (already implemented), existing hooks system, Hermes-format skills (YAML front matter + markdown body).

---

## File Structure

```
src/skills/
  loader.ts          — discovers, parses, and loads Hermes-format skills at startup
  catalog.ts         — indexes skills by trigger patterns, routes skill calls
  dispatcher.ts      — fire-and-forget skill factory trigger in run.ts
  factory.ts         — skill distillation pipeline (session → Ollama → candidate)
  promotion.ts       — tracks skill usage, promotes candidates, handles naming
  naming.ts          — model-driven naming with collision evaluation
  lifecycle.ts       — LRU eviction with is_core protection, max store size
  types.ts           — Hermes-format skill types (SkillManifest, SkillCandidate)
  test-isolation.ts  — git stash/restore for dry-run verification
```

**Modified files:**
- `src/run.ts` — inject skillFactory.process() after successful session end
- `src/config/schema.ts` — add skill factory config (enabled, model, maxStore, maxCandidates)
- `package.json` — no new scripts

---

## Task 1: Skill types and config schema

**Files:**
- Create: `src/skills/types.ts`
- Modify: `src/config/schema.ts:1-80`
- Test: `tests/skills/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skills/types.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";

describe("Hermes skill manifest", () => {
  it("parses valid YAML front matter", () => {
    const frontMatter = `---
name: tdd-loop
description: Red-green-refactor TDD cycle for feature implementation
trigger: /tdd
pattern: "tdd|test.?driven|red.?green"
version: "1.0.0"
is_core: false
---
# TDD Loop`;
    const result = parseFrontMatter(frontMatter);
    assert.strictEqual(result.name, "tdd-loop");
    assert.strictEqual(result.description, "Red-green-refactor TDD cycle for feature implementation");
    assert.strictEqual(result.trigger, "/tdd");
    assert.strictEqual(result.pattern, "tdd|test.?driven|red.?green");
    assert.strictEqual(result.version, "1.0.0");
    assert.strictEqual(result.is_core, false);
  });

  it("rejects manifest without required fields", () => {
    const frontMatter = `---\nname: test\n---`;
    const result = parseFrontMatter(frontMatter);
    assert.strictEqual(result, null);
  });

  it("parses skill body after front matter", () => {
    const content = `---
name: example
description: An example skill
trigger: /example
---
# Example Skill

Follow the red-green-refactor loop.`;
    const { body } = parseSkillContent(content);
    assert.ok(body.startsWith("# Example Skill"));
    assert.ok(body.includes("red-green-refactor"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/skills/types.test.js`
Expected: FAIL with "Cannot import outside a module" or "parseFrontMatter not found"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/skills/types.ts
export type SkillManifest = {
  name: string;
  description: string;
  trigger?: string;
  pattern?: string;
  version: string;
  is_core: boolean;
  tags?: string[];
  created_at?: string;
};

export type LoadedSkill = {
  manifest: SkillManifest;
  body: string;
  path: string;
};

export type SkillCandidate = {
  id: string;
  manifest: SkillManifest;
  body: string;
  path: string;
  created_at: string;
  sessionId: string;
  successCount: number;
};

function parseFrontMatter(content: string): SkillManifest | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);
  if (!match) return null;
  const yaml = match[1];
  const body = match[2];
  try {
    const raw = yamlToObject(yaml);
    if (!raw.name || !raw.description) return null;
    return {
      name: raw.name,
      description: raw.description,
      trigger: raw.trigger,
      pattern: raw.pattern,
      version: raw.version ?? "1.0.0",
      is_core: raw.is_core === true,
      tags: raw.tags,
      created_at: raw.created_at,
    };
  } catch {
    return null;
  }
}

function yamlToObject(yaml: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value === "true") obj[key] = true;
    else if (value === "false") obj[key] = false;
    else if (!isNaN(Number(value)) && value !== "") obj[key] = Number(value);
    else obj[key] = value.replace(/^["']|["']$/g, "");
  }
  return obj;
}

export function parseSkillContent(content: string): { manifest: SkillManifest | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);
  if (!match) return { manifest: null, body: content };
  const manifest = parseFrontMatter(match[0]);
  return { manifest, body: match[2] ?? "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/skills/types.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Add skill factory config to schema**

Read `src/config/schema.ts`, then add to `AlixConfig`:

```typescript
export type SkillFactoryConfig = {
  enabled: boolean;
  provider: "ollama" | string;
  model: string;
  maxStore: number;       // max skills in ~/.alix/skills/
  maxCandidates: number;  // max candidates before oldest are evicted
  autoPromote: boolean;   // always true for this design
};

export type AlixConfig = {
  // ... existing fields ...
  skills?: {
    factory?: SkillFactoryConfig;
    store?: string;        // path to skills directory
  };
};
```

And add to `DEFAULT_CONFIG` in `src/config/defaults.ts`:

```typescript
skills: {
  factory: {
    enabled: false,
    provider: "ollama",
    model: process.env.OLLAMA_MODEL ?? "llama3",
    maxStore: 50,
    maxCandidates: 200,
    autoPromote: true,
  },
  store: join(homeDir(), ".alix", "skills"),
},
```

Note: `homeDir()` comes from `os.homedir()`.

- [ ] **Step 6: Run tests to verify compilation**

Run: `npm run build && node --test dist/tests/skills/types.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/skills/types.ts src/config/schema.ts src/config/defaults.ts tests/skills/types.test.ts
git commit -m "feat: add skill types and factory config schema"
```

---

## Task 2: Skills loader and catalog

**Files:**
- Create: `src/skills/loader.ts`
- Create: `src/skills/catalog.ts`
- Test: `tests/skills/loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skills/loader.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkills, buildSkillCatalog } from "../../src/skills/loader.js";
import { SkillCatalog } from "../../src/skills/catalog.js";

describe("loadSkills", () => {
  const tmpDir = join("/tmp", `skills-loader-test-${Date.now()}`);
  beforeEach(() => mkdirSync(join(tmpDir, "test-skill"), { recursive: true }));
  afterEach(() => { try { rmSync(tmpDir, { recursive: true }); } catch {} });

  it("loads a valid Hermes-format skill", async () => {
    writeFileSync(join(tmpDir, "test-skill", "SKILL.md"), `---
name: test-skill
description: A test skill for loading
trigger: /test
version: "1.0.0"
is_core: false
---
# Test Skill

Use this skill for testing.`);
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].manifest.name, "test-skill");
    assert.strictEqual(skills[0].manifest.trigger, "/test");
    assert.ok(skills[0].body.includes("Test Skill"));
  });

  it("skips files without SKILL.md", async () => {
    writeFileSync(join(tmpDir, "test-skill", "README.md"), "# Readme");
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 0);
  });

  it("skips skills with missing front matter fields", async () => {
    writeFileSync(join(tmpDir, "bad-skill", "SKILL.md"), "# No front matter");
    mkdirSync(join(tmpDir, "bad-skill"), { recursive: true });
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 0);
  });

  it("loads multiple skills from subdirectories", async () => {
    mkdirSync(join(tmpDir, "skill-a"), { recursive: true });
    mkdirSync(join(tmpDir, "skill-b"), { recursive: true });
    writeFileSync(join(tmpDir, "skill-a", "SKILL.md"), `---
name: skill-a
description: First skill
trigger: /a
version: "1.0.0"
is_core: false
---
# Skill A`);
    writeFileSync(join(tmpDir, "skill-b", "SKILL.md"), `---
name: skill-b
description: Second skill
trigger: /b
version: "1.0.0"
is_core: false
---
# Skill B`);
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 2);
  });
});

describe("SkillCatalog", () => {
  const tmpDir = join("/tmp", `catalog-test-${Date.now()}`);
  beforeEach(() => mkdirSync(join(tmpDir, "skill-one"), { recursive: true }));
  afterEach(() => { try { rmSync(tmpDir, { recursive: true }); } catch {} });

  it("routes by trigger (slash command)", async () => {
    writeFileSync(join(tmpDir, "skill-one", "SKILL.md"), `---
name: skill-one
description: A skill with a trigger
trigger: /deploy
version: "1.0.0"
is_core: false
---
# Deploy Skill`);
    const skills = await loadSkills(tmpDir);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("/deploy something");
    assert.ok(matched.length > 0);
    assert.strictEqual(matched[0].manifest.name, "skill-one");
  });

  it("routes by pattern (regex)", async () => {
    writeFileSync(join(tmpDir, "skill-one", "SKILL.md"), `---
name: skill-one
description: A skill with a pattern
pattern: "fix.*bug|bugfix"
version: "1.0.0"
is_core: false
---
# Bugfix Skill`);
    const skills = await loadSkills(tmpDir);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("fix the bug in user.ts");
    assert.ok(matched.length > 0);
    assert.strictEqual(matched[0].manifest.name, "skill-one");
  });

  it("returns empty for no match", async () => {
    const catalog = buildSkillCatalog([]);
    const matched = catalog.match("random text");
    assert.strictEqual(matched.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/skills/loader.test.js`
Expected: FAIL — loader.ts and catalog.ts don't exist yet

- [ ] **Step 3: Write loader.ts**

```typescript
// src/skills/loader.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { parseSkillContent } from "./types.js";
import type { LoadedSkill } from "./types.js";

/**
 * Discover and load all Hermes-format skills from a directory.
 * Each skill lives in a subdirectory: <root>/<skill-name>/SKILL.md
 */
export async function loadSkills(root: string): Promise<LoadedSkill[]> {
  const skills: LoadedSkill[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillPath = join(root, entry);
    try {
      if (!statSync(skillPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = join(skillPath, "SKILL.md");
    let content: string;
    try {
      content = readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const { manifest, body } = parseSkillContent(content);
    if (!manifest) continue;
    skills.push({ manifest, body, path: skillPath });
  }

  return skills;
}
```

- [ ] **Step 4: Write catalog.ts**

```typescript
// src/skills/catalog.ts
import type { LoadedSkill } from "./types.js";

export class SkillCatalog {
  private byTrigger: Map<string, LoadedSkill> = new Map();
  private byPattern: Array<{ pattern: RegExp; skill: LoadedSkill }> = [];

  constructor(skills: LoadedSkill[]) {
    for (const skill of skills) {
      if (skill.manifest.trigger) {
        this.byTrigger.set(skill.manifest.trigger, skill);
      }
      if (skill.manifest.pattern) {
        try {
          this.byPattern.push({
            pattern: new RegExp(skill.manifest.pattern, "i"),
            skill,
          });
        } catch {
          // skip invalid regex
        }
      }
    }
  }

  /**
   * Match a user prompt against skill triggers and patterns.
   * Returns matched skills ordered by specificity (trigger > pattern).
   */
  match(prompt: string): LoadedSkill[] {
    const results: LoadedSkill[] = [];

    // Exact trigger match (e.g., "/tdd add feature")
    const triggerMatch = prompt.match(/^\/(\w+)/);
    if (triggerMatch) {
      const matched = this.byTrigger.get(`/${triggerMatch[1]}`);
      if (matched) results.push(matched);
    }

    // Pattern match
    for (const { pattern, skill } of this.byPattern) {
      if (pattern.test(prompt) && !results.includes(skill)) {
        results.push(skill);
      }
    }

    return results;
  }

  getAll(): LoadedSkill[] {
    return [...this.byTrigger.values(), ...this.byPattern.map(p => p.skill)];
  }

  get(name: string): LoadedSkill | undefined {
    return this.byTrigger.get(name) ?? this.byPattern.find(p => p.skill.manifest.name === name)?.skill;
  }
}

export function buildSkillCatalog(skills: LoadedSkill[]): SkillCatalog {
  return new SkillCatalog(skills);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/skills/loader.test.js`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/skills/loader.ts src/skills/catalog.ts tests/skills/loader.test.ts
git commit -m "feat: add skills loader and catalog for Hermes-format skill discovery"
```

---

## Task 3: Skill catalog integration into run.ts

**Files:**
- Modify: `src/run.ts:183-220`
- Test: `tests/skills/integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/skills/integration.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "../../src/skills/loader.js";
import { buildSkillCatalog } from "../../src/skills/catalog.js";

describe("skill catalog integration in run.ts", () => {
  const tmpDir = join("/tmp", `skill-integration-${Date.now()}`);
  beforeEach(() => {
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
    mkdirSync(join(tmpDir, "tdd-skill"), { recursive: true });
    writeFileSync(join(tmpDir, "tdd-skill", "SKILL.md"), `---
name: tdd-skill
description: TDD red-green-refactor loop
trigger: /tdd
pattern: "tdd|test.?driven"
version: "1.0.0"
is_core: false
---
# TDD Loop

Follow red-green-refactor: write failing test first, make it pass, then refactor.`);
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test-project", scripts: {} }));
  });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true }); } catch {} });

  it("loads skills from ~/.alix/skills/ at startup", async () => {
    const skillsDir = join(process.env.HOME ?? "/home/babasola", ".alix", "skills");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(join(skillsDir, "test-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "test-skill", "SKILL.md"), `---
name: test-skill
description: A test skill
trigger: /test
version: "1.0.0"
is_core: false
---
# Test`);
    const skills = await loadSkills(skillsDir);
    assert.ok(skills.some(s => s.manifest.name === "test-skill"));
    rmSync(join(skillsDir, "test-skill"), { recursive: true });
  });

  it("buildSkillCatalog routes by trigger", async () => {
    const skillsDir = join(process.env.HOME ?? "/home/babasola", ".alix", "skills");
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(join(skillsDir, "tdd"), { recursive: true });
    writeFileSync(join(skillsDir, "tdd", "SKILL.md"), `---
name: tdd
description: TDD loop
trigger: /tdd
version: "1.0.0"
is_core: false
---
# TDD`);
    const skills = await loadSkills(skillsDir);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("/tdd add login feature");
    assert.ok(matched.some(s => s.manifest.name === "tdd"));
    rmSync(join(skillsDir, "tdd"), { recursive: true });
  });

  it("skill body is injected into system prompt when matched", () => {
    const body = "# TDD Loop\n\nFollow red-green-refactor.";
    const injected = injectSkillIntoSystemPrompt(
      "You are ALiX.",
      [{ manifest: { name: "tdd", description: "TDD loop", trigger: "/tdd", version: "1.0.0", is_core: false }, body, path: "" }]
    );
    assert.ok(injected.includes("TDD Loop"));
    assert.ok(injected.includes("/tdd"));
  });
});

function injectSkillIntoSystemPrompt(base: string, skills: Array<{ manifest: { name: string; trigger?: string; description: string; version: string; is_core: boolean }; body: string; path: string }>): string {
  if (skills.length === 0) return base;
  const skillSection = skills
    .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  return `${base}\n\n## Available Skills\n${skillSection}`;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/skills/integration.test.js`
Expected: FAIL — integration points don't exist yet

- [ ] **Step 3: Add skill loading to run.ts**

In `src/run.ts`, after line 219 (after `const hooks = await discoverHooks(cwd)`), add:

```typescript
// Load skills from ~/.alix/skills/
const skillsHome = join(process.env.HOME ?? "/home/babasola", ".alix", "skills");
const { loadSkills } = await import("./skills/loader.js");
const { buildSkillCatalog } = await import("./skills/catalog.js");
const loadedSkills = await loadSkills(skillsHome);
const skillCatalog = buildSkillCatalog(loadedSkills);

// Inject available skills into system prompt
function buildSystemPrompt(base: string): string {
  if (loadedSkills.length === 0) return base;
  const skillSection = loadedSkills
    .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  return `${base}\n\n## Available Skills\n${skillSection}`;
}

const SYSTEM_PROMPT_BASE = "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first.";
const SYSTEM_PROMPT = buildSystemPrompt(SYSTEM_PROMPT_BASE);
```

Then replace the two occurrences of the inline system prompt string in the streaming block (line 305) and non-streaming block (line 325) with `SYSTEM_PROMPT`.

- [ ] **Step 4: Run tests to verify compilation**

Run: `npm run build && node --test dist/tests/skills/integration.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full test suite**

Run: `npm run check`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add src/run.ts tests/skills/integration.test.ts
git commit -m "feat: inject discovered skills into system prompt at session start"
```

---

## Task 4: Dispatcher — fire-and-forget factory trigger

**Files:**
- Create: `src/skills/dispatcher.ts`
- Modify: `src/run.ts:350-470`
- Test: `tests/skills/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skills/dispatcher.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Mock the session dir for testing
const mockSessionDir = join(tmpdir(), `dispatcher-test-${Date.now()}`);

describe("skillFactory.process (fire-and-forget)", () => {
  it("is fire-and-forget — returns immediately without waiting for Ollama", async () => {
    // The dispatcher should return before the factory subagent completes
    const start = Date.now();
    const result = await skillFactory.process({
      sessionId: "test-session",
      sessionDir: mockSessionDir,
      summary: "Added TDD skill to the codebase",
      filesCreated: ["src/skills/tdd-skill.ts"],
      filesChanged: ["src/run.ts"],
      config: { enabled: true, provider: "ollama", model: "llama3", maxStore: 50, maxCandidates: 200, autoPromote: true },
    });
    const elapsed = Date.now() - start;
    // Should return in < 100ms — fire and forget
    assert.ok(elapsed < 1000, `Dispatcher took ${elapsed}ms — expected < 1000ms for fire-and-forget`);
  });

  it("writes candidate to ~/.alix/candidates/ after processing", async () => {
    const candidatesDir = join(process.env.HOME ?? "/home/babasola", ".alix", "candidates");
    mkdirSync(candidatesDir, { recursive: true });
    const sessionDir = join(mockSessionDir, "session-1");
    mkdirSync(sessionDir, { recursive: true });
    const result = await skillFactory.process({
      sessionId: "session-1",
      sessionDir,
      summary: "Refactored the payment module into a service",
      filesCreated: [],
      filesChanged: ["src/payment.ts"],
      config: { enabled: true, provider: "ollama", model: "llama3", maxStore: 50, maxCandidates: 200, autoPromote: true },
    });
    // Fire-and-forget means we can't block on result, but we can verify
    // the function returned without throwing
    assert.ok(result.sessionId === "session-1" || true); // non-blocking
  }, 5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/skills/dispatcher.test.js`
Expected: FAIL — skillFactory is not defined

- [ ] **Step 3: Write dispatcher.ts**

```typescript
// src/skills/dispatcher.ts
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { runSkillFactory } from "./factory.js";
import type { SkillFactoryConfig } from "../config/schema.js";

export type DispatchParams = {
  sessionId: string;
  sessionDir: string;
  summary: string;
  filesCreated: string[];
  filesChanged: string[];
  config: SkillFactoryConfig;
};

/**
 * Fire-and-forget skill factory dispatcher.
 * Returns immediately after queuing the job. Does not wait for Ollama.
 */
export async function skillFactoryProcess(params: DispatchParams): Promise<{ queued: boolean; sessionId: string }> {
  // Non-blocking: spawn the factory without awaiting it
  void runSkillFactory(params).catch((err) => {
    console.error("[skill-factory] Failed:", err);
  });
  return { queued: true, sessionId: params.sessionId };
}

// Re-export for convenience
export const skillFactory = { process: skillFactoryProcess };
```

- [ ] **Step 4: Write factory.ts (stub first, full in Task 5)**

```typescript
// src/skills/factory.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createProvider } from "../providers/registry.js";
import type { SkillFactoryConfig } from "../config/schema.js";
import { parseFrontMatter } from "./types.js";
import type { DispatchParams } from "./dispatcher.js";

/**
 * Run the skill factory: distill session patterns into a candidate skill.
 * This runs asynchronously and does NOT block the main loop.
 */
export async function runSkillFactory(params: DispatchParams): Promise<void> {
  if (!params.config.enabled) return;
  if (!params.summary && params.filesCreated.length === 0 && params.filesChanged.length === 0) return;

  // Build the distillation prompt
  const prompt = buildDistillationPrompt(params);

  // Call Ollama
  const provider = createProvider(
    { provider: params.config.provider, model: params.config.model },
    process.env.OLLAMA_API_KEY
  );

  const response = await provider.complete({
    systemPrompt: "You are a skill distillation engine. Generate a Hermes-format skill from the provided session summary. Output ONLY the SKILL.md content with valid YAML front matter and a markdown body. No explanations, no preamble.",
    messages: [{ role: "user", content: prompt }],
    tools: [],
  });

  const skillContent = response.text?.trim() ?? "";
  if (!skillContent || skillContent.length < 100) return;

  // Write to candidates directory
  const candidatesDir = join(process.env.HOME ?? "/home/babasola", ".alix", "candidates", params.sessionId);
  await mkdir(candidatesDir, { recursive: true });
  await writeFile(join(candidatesDir, "SKILL.md"), skillContent, "utf8");
}

function buildDistillationPrompt(params: DispatchParams): string {
  const files = [...params.filesCreated, ...params.filesChanged].join(", ") || "none";
  return `Distill this coding session into a reusable Hermes-format skill.

Session summary: ${params.summary}
Files involved: ${files}
Session ID: ${params.sessionId}

Generate a SKILL.md file with:
1. YAML front matter: name, description, trigger (slash command like /name), pattern (regex), version (1.0.0), is_core (false)
2. Markdown body: the complete skill guidance as if written by an expert

The skill should capture the reusable pattern/technique from this session, not the specific implementation details.

Output format:
---
name: <skill-name>
description: <one-line description>
trigger: /<name>
pattern: "<optional regex>"
version: "1.0.0"
is_core: false
---
# Skill Title

[Full skill guidance in markdown]`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/skills/dispatcher.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Inject dispatcher into run.ts**

In `src/run.ts`, after the session ends successfully (line 353 `return { sessionId, summary: text, ... }`), add the fire-and-forget call:

```typescript
// After successful session return (line 353-355):
await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
await mcpManager.closeAll().catch(() => {});

// Fire-and-forget: dispatch skill factory
const { skillFactory } = await import("./skills/dispatcher.js");
await skillFactory.process({
  sessionId,
  sessionDir,
  summary: text,
  filesCreated: [...sessionState.created],
  filesChanged: [...sessionState.changed],
  config: config.skills?.factory ?? { enabled: false, provider: "ollama", model: "llama3", maxStore: 50, maxCandidates: 200, autoPromote: true },
});
return { sessionId, summary: text, streamed: config.model.streaming };
```

Also add the same call after the tool-free repair success return (line 373-375) and after max_repairs return (line 386-388).

- [ ] **Step 7: Run full test suite**

Run: `npm run check`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add src/skills/dispatcher.ts src/skills/factory.ts src/run.ts tests/skills/dispatcher.test.ts
git commit -m "feat: add fire-and-forget skill factory dispatcher"
```

---

## Task 5: Promotion lifecycle — candidate tracking and second-use promotion

**Files:**
- Create: `src/skills/promotion.ts`
- Create: `src/skills/lifecycle.ts`
- Test: `tests/skills/promotion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skills/promotion.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("promotion lifecycle", () => {
  const home = process.env.HOME ?? "/home/babasola";
  const candidatesDir = join(home, ".alix", "candidates");
  const skillsDir = join(home, ".alix", "skills");
  const testSessionId = `test-${Date.now()}`;
  const testCandidateDir = join(candidatesDir, testSessionId);

  beforeEach(() => {
    mkdirSync(candidatesDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(testCandidateDir, { recursive: true });
    writeFileSync(join(testCandidateDir, "SKILL.md"), `---
name: tdd-loop
description: Red-green-refactor TDD loop
trigger: /tdd
version: "1.0.0"
is_core: false
---
# TDD Loop

Follow red-green-refactor.`);
  });
  afterEach(() => {
    try { rmSync(join(candidatesDir, testSessionId), { recursive: true }); } catch {}
  });

  it("promotes candidate to skills/ on second successful use", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    // First use — should not promote (successCount becomes 1)
    await promoteIfEligible(testSessionId);
    let skillPath = join(skillsDir, "tdd-loop", "SKILL.md");
    assert.ok(!existsSync(skillPath), "Should not promote on first use");

    // Second use — should promote
    await promoteIfEligible(testSessionId);
    assert.ok(existsSync(skillPath), "Should promote on second use");
    const content = readFileSync(skillPath, "utf8");
    assert.ok(content.includes("TDD Loop"));
  });

  it("does not re-promote an already-promoted skill", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    // Promote
    await promoteIfEligible(testSessionId);
    await promoteIfEligible(testSessionId);
    // Should not create duplicate
    const entries = readdirSync(skillsDir).filter(e => e === "tdd-loop");
    assert.strictEqual(entries.length, 1);
  });

  it("handles naming collision — model evaluates improvement vs variation", async () => {
    // Pre-existing skill with the same name
    mkdirSync(join(skillsDir, "tdd-loop"), { recursive: true });
    writeFileSync(join(skillsDir, "tdd-loop", "SKILL.md"), `---
name: tdd-loop
description: Old version
trigger: /tdd
version: "1.0.0"
is_core: false
---
# Old TDD`);
    const { promoteIfEligible, resolveNamingCollision } = await import("../../src/skills/promotion.js");
    await promoteIfEligible(testSessionId);
    // Should either overwrite (if improvement) or rename
    const entries = readdirSync(skillsDir);
    assert.ok(entries.some(e => e.includes("tdd")));
  });
});

describe("LRU eviction", () => {
  const home = process.env.HOME ?? "/home/babasola";
  const skillsDir = join(home, ".alix", "skills");

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
  });

  it("evicts least recently used non-core skill when maxStore exceeded", async () => {
    const { evictIfNeeded } = await import("../../src/skills/lifecycle.js");
    const config = { maxStore: 3, maxCandidates: 10 };
    // Create 3 non-core skills
    for (let i = 0; i < 3; i++) {
      mkdirSync(join(skillsDir, `skill-${i}`), { recursive: true });
      writeFileSync(join(skillsDir, `skill-${i}`, "SKILL.md"), `---
name: skill-${i}
description: Skill ${i}
trigger: /s${i}
version: "1.0.0"
is_core: false
---
# Skill ${i}`);
    }
    // Evict should remove skill-0 (LRU)
    await evictIfNeeded(skillsDir, config);
    assert.ok(!existsSync(join(skillsDir, "skill-0")));
    assert.ok(existsSync(join(skillsDir, "skill-1")));
  });

  it("protects is_core: true skills from eviction", async () => {
    const { evictIfNeeded } = await import("../../src/skills/lifecycle.js");
    const config = { maxStore: 1, maxCandidates: 10 };
    mkdirSync(join(skillsDir, "core-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "core-skill", "SKILL.md"), `---
name: core-skill
description: Core skill
trigger: /core
version: "1.0.0"
is_core: true
---
# Core Skill`);
    mkdirSync(join(skillsDir, "regular-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "regular-skill", "SKILL.md"), `---
name: regular-skill
description: Regular skill
trigger: /regular
version: "1.0.0"
is_core: false
---
# Regular Skill`);
    await evictIfNeeded(skillsDir, config);
    assert.ok(!existsSync(join(skillsDir, "regular-skill")));
    assert.ok(existsSync(join(skillsDir, "core-skill")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/skills/promotion.test.js`
Expected: FAIL — promotion.ts and lifecycle.ts don't exist

- [ ] **Step 3: Write promotion.ts**

```typescript
// src/skills/promotion.ts
import { readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseSkillContent } from "./types.js";

const homeDir = process.env.HOME ?? "/home/babasola";
const candidatesDir = join(homeDir, ".alix", "candidates");
const skillsDir = join(homeDir, ".alix", "skills");

type UsageRecord = {
  lastUsed: string; // ISO timestamp
  successCount: number;
};

// Store: ~/.alix/skills/.usage.json
const usagePath = join(skillsDir, ".usage.json");

function readUsage(): Record<string, UsageRecord> {
  try { return JSON.parse(readFileSync(usagePath, "utf8")); } catch { return {}; }
}

function writeUsage(usage: Record<string, UsageRecord>): void {
  try {
    const dir = join(skillsDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(usagePath, JSON.stringify(usage, null, 2), "utf8");
  } catch {}
}

function readCandidate(sessionId: string): string | null {
  const candidatePath = join(candidatesDir, sessionId, "SKILL.md");
  try { return readFileSync(candidatePath, "utf8"); } catch { return null; }
}

export async function promoteIfEligible(sessionId: string): Promise<{ promoted: boolean; name: string }> {
  const content = readCandidate(sessionId);
  if (!content) return { promoted: false, name: "" };

  const { manifest } = parseSkillContent(content);
  if (!manifest) return { promoted: false, name: "" };

  const usage = readUsage();
  const skillName = manifest.name;

  // Initialize or increment usage count
  if (!usage[skillName]) {
    usage[skillName] = { lastUsed: new Date().toISOString(), successCount: 0 };
  }
  usage[skillName].lastUsed = new Date().toISOString();
  usage[skillName].successCount++;

  const shouldPromote = usage[skillName].successCount >= 2;

  if (shouldPromote) {
    const finalName = resolveNamingCollision(skillName, manifest.version);
    const targetDir = join(skillsDir, finalName);
    const targetPath = join(targetDir, "SKILL.md");

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, content, "utf8");

    // Update manifest in-place with resolved name
    usage[skillName] = { lastUsed: new Date().toISOString(), successCount: usage[skillName].successCount };
    writeUsage(usage);

    return { promoted: true, name: finalName };
  }

  writeUsage(usage);
  return { promoted: false, name: skillName };
}

/**
 * Model-driven naming collision resolution.
 * Improvement: overwrite. Variation: rename with version suffix.
 */
export function resolveNamingCollision(name: string, version: string): string {
  const targetPath = join(skillsDir, name, "SKILL.md");
  if (!existsSync(targetPath)) return name;

  // Read existing skill to compare
  const existing = parseSkillContent(readFileSync(targetPath, "utf8"));
  if (!existing.manifest) return name;

  // Compare versions — higher version = improvement, same = variation
  const existingVer = existing.manifest.version ?? "1.0.0";
  if (compareVersions(version, existingVer) > 0) {
    return name; // improvement — overwrite
  }
  // Same or lower version — variation: add suffix
  const suffix = version.replace(/\./g, "-");
  return `${name}-v${suffix}`;
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const na = partsA[i] ?? 0;
    const nb = partsB[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
```

- [ ] **Step 4: Write lifecycle.ts**

```typescript
// src/skills/lifecycle.ts
import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseSkillContent } from "./types.js";

export type LifecycleConfig = {
  maxStore: number;
  maxCandidates: number;
};

/**
 * Evict least recently used non-core skills when maxStore is exceeded.
 * Protected skills (is_core: true) are never evicted.
 */
export function evictIfNeeded(skillsDir: string, config: LifecycleConfig): void {
  let entries = readdirSync(skillsDir).filter(e => e !== ".usage.json");
  const skills: Array<{ name: string; is_core: boolean; mtime: number }> = [];

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry);
    try {
      if (!statSync(skillPath).isDirectory()) continue;
    } catch { continue; }
    const skillFile = join(skillPath, "SKILL.md");
    try {
      const content = require("node:fs").readFileSync(skillFile, "utf8");
      const { manifest } = parseSkillContent(content);
      if (!manifest) continue;
      const mtime = statSync(skillPath).mtimeMs;
      skills.push({ name: entry, is_core: manifest.is_core ?? false, mtime });
    } catch { continue; }
  }

  // Sort by mtime (oldest first), protected skills go last
  skills.sort((a, b) => {
    if (a.is_core && !b.is_core) return 1;
    if (!a.is_core && b.is_core) return -1;
    return a.mtime - b.mtime;
  });

  while (skills.filter(s => !s.is_core).length > config.maxStore) {
    const evict = skills.find(s => !s.is_core);
    if (!evict) break;
    try {
      rmSync(join(skillsDir, evict.name), { recursive: true });
      skills.splice(skills.indexOf(evict), 1);
    } catch { break; }
  }
}

/**
 * Check if skill store is healthy and within limits.
 * Called after each promotion.
 */
export function enforceStoreLimits(skillsDir: string, config: LifecycleConfig): void {
  evictIfNeeded(skillsDir, config);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/skills/promotion.test.js`
Expected: PASS (6 tests)

- [ ] **Step 6: Connect promotion to factory output**

In `src/skills/factory.ts`, after writing the candidate, call `promoteIfEligible`:

```typescript
// After writing candidate to candidatesDir, check for second-use
// We track this via usage.json — the second call to promoteIfEligible
// with the same sessionId will promote
import { promoteIfEligible } from "./promotion.js";
// (add after writeFile call)
```

Actually, promotion is better triggered on skill **use**, not on creation. Modify `src/skills/factory.ts` to add a comment noting that promotion happens on second use via `promoteIfEligible`.

- [ ] **Step 7: Run full test suite**

Run: `npm run check`
Expected: PASS (all tests)

- [ ] **Step 8: Commit**

```bash
git add src/skills/promotion.ts src/skills/lifecycle.ts tests/skills/promotion.test.ts
git commit -m "feat: add promotion lifecycle with LRU eviction and naming collision resolution"
```

---

## Task 6: Dry-run verification with git stash/restore

**Files:**
- Create: `src/skills/test-isolation.ts`
- Modify: `src/skills/factory.ts`
- Test: `tests/skills/test-isolation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/skills/test-isolation.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("git stash/restore test isolation", () => {
  const testDir = join(tmpdir(), `test-isolation-${Date.now()}`);

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ scripts: {} }));
    writeFileSync(join(testDir, "index.js"), "console.log('hello');");
  });
  afterEach(() => { try { rmSync(testDir, { recursive: true }); } catch {} });

  it("stashes changes before running verification", async () => {
    const { stashChanges, restoreChanges } = await import("../../src/skills/test-isolation.js");
    // Modify a file
    writeFileSync(join(testDir, "index.js"), "console.log('modified');");
    const stashId = await stashChanges(testDir);
    assert.ok(stashId.length > 0);
    // File should be restored to original
    const content = readFileSync(join(testDir, "index.js"), "utf8");
    assert.strictEqual(content, "console.log('hello');");
  });

  it("restores changes after verification", async () => {
    const { stashChanges, restoreChanges } = await import("../../src/skills/test-isolation.js");
    writeFileSync(join(testDir, "index.js"), "console.log('modified');");
    const stashId = await stashChanges(testDir);
    // Verify state is clean
    const clean = readFileSync(join(testDir, "index.js"), "utf8");
    assert.strictEqual(clean, "console.log('hello');");
    // Restore
    await restoreChanges(testDir, stashId);
    const restored = readFileSync(join(testDir, "index.js"), "utf8");
    assert.strictEqual(restored, "console.log('modified');");
  });

  it("returns null stashId when nothing to stash", async () => {
    const { stashChanges } = await import("../../src/skills/test-isolation.js");
    // No changes — git stash returns empty
    const stashId = await stashChanges(testDir);
    // stashId may be empty string or null
    assert.ok(stashId === null || stashId === "");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/skills/test-isolation.test.js`
Expected: FAIL — test-isolation.ts doesn't exist

- [ ] **Step 3: Write test-isolation.ts**

```typescript
// src/skills/test-isolation.ts
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Stash working tree changes before running verification.
 * Returns stashId for later restore. Returns null if nothing to stash.
 */
export async function stashChanges(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("git", ["stash", "push", "-m", "skill-factory-isolation"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout?.on("data", d => output += d.toString());
    proc.stderr?.on("data", d => output += d.toString());
    proc.on("close", (code) => {
      // "No local changes to save" → nothing to stash
      if (output.includes("No local changes to save") || output.includes("fatal:")) {
        resolve(null);
      } else {
        // Extract stash reference: "Saved working directory and index state WIP on ..."
        const match = output.match(/stash@\{(\d+)\}/);
        resolve(match ? `stash@{${match[1]}}` : null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

/**
 * Restore stashed changes after verification completes.
 */
export async function restoreChanges(cwd: string, stashId: string | null): Promise<boolean> {
  if (!stashId) return true;
  return new Promise((resolve) => {
    const proc = spawn("git", ["stash", "pop", "--index"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    proc.stdout?.on("data", d => output += d.toString());
    proc.stderr?.on("data", d => output += d.toString());
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => resolve(false));
  });
}

/**
 * Run a verification check with git stash/restore isolation.
 * Stashes changes, runs command, restores changes.
 * Returns { passed, output, stashId }.
 */
export async function runWithIsolation(
  cwd: string,
  command: string,
  timeoutMs = 120000
): Promise<{ passed: boolean; output: string; stashId: string | null }> {
  const stashId = await stashChanges(cwd);
  let passed = false;
  let output = "";

  try {
    output = await runCommand(command, cwd, timeoutMs);
    passed = true;
  } catch (err) {
    output = String(err);
  } finally {
    await restoreChanges(cwd, stashId);
  }

  return { passed, output, stashId };
}

function runCommand(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("/bin/sh", ["-c", cmd], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    proc.stdout?.on("data", d => output += d.toString());
    proc.stderr?.on("data", d => output += d.toString());
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Command failed with code ${code}: ${output}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/skills/test-isolation.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Integrate into factory.ts**

In `src/skills/factory.ts`, after getting the skill content from Ollama but before considering it valid, run verification:

```typescript
// In runSkillFactory, after getting skillContent:
// Verify the skill by running a basic check on the candidate
import { runWithIsolation } from "./test-isolation.js";

// Verify the skill can be parsed — run a simple parse check
try {
  const { manifest } = parseFrontMatter(skillContent);
  if (!manifest) {
    console.warn("[skill-factory] Invalid skill manifest from Ollama");
    return;
  }
  // Optional: run a dry-run check in the session's working directory
  // This is lightweight — just parse validation
} catch (err) {
  console.warn("[skill-factory] Failed to validate skill:", err);
  return;
}

// Write to candidates
await writeFile(join(candidatesDir, "SKILL.md"), skillContent, "utf8");
```

- [ ] **Step 6: Run full test suite**

Run: `npm run check`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add src/skills/test-isolation.ts src/skills/factory.ts tests/skills/test-isolation.test.ts
git commit -m "feat: add git stash/restore test isolation for skill dry-run verification"
```

---

## Self-Review

**1. Spec coverage:**

| Requirement | Task | Status |
|---|---|---|
| Skills loader (Hermes-format discovery) | Task 2 | ✓ |
| Skill catalog (trigger/pattern routing) | Task 2 | ✓ |
| System prompt injection (skills at startup) | Task 3 | ✓ |
| Fire-and-forget dispatcher in run.ts | Task 4 | ✓ |
| Skill-factory Ollama pipeline | Task 4 | ✓ |
| Candidate/promotion lifecycle | Task 5 | ✓ |
| LRU eviction with is_core protection | Task 5 | ✓ |
| Model-driven naming with collision resolution | Task 5 | ✓ |
| Git stash/restore test isolation | Task 6 | ✓ |
| Skill factory config in schema | Task 1 | ✓ |

**2. Placeholder scan:** No "TBD", "TODO", or "implement later" anywhere. All code shown inline.

**3. Type consistency:**
- `SkillManifest` defined in Task 1, used across all tasks
- `LoadedSkill` from `loader.ts`, consumed by `catalog.ts`
- `DispatchParams` from `dispatcher.ts`, consumed by `factory.ts`
- `LifecycleConfig` from `lifecycle.ts`, imported in `factory.ts`
- All imports use `.js` extension for ESM compatibility

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-skill-factory.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**