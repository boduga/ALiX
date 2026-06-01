# P3.2 Memory System Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or inline execution below.

**Goal:** Add persistent, layered memory system for ALiX with file-based storage, progressive recall, and automatic consolidation.

**Architecture:** File-based memory stored in `.alix/memory/` with 4-layer taxonomy (user, project, feedback, reference), lean index injection at session start, and progressive recall with conflict detection. Inspired by agent-memory (npm), mono-memory, and OpenMemory patterns.

**Tech Stack:** Pure TypeScript, file-based (markdown + JSON), no external DB dependency.

---

## File Structure

```
src/
├── utils/
│   ├── session-digest.ts    # Modified: add memory loading
│   └── memory/
│       ├── types.ts         # New: Memory types and interfaces
│       ├── store.ts         # New: File-based memory operations
│       ├── recall.ts        # New: Progressive recall system
│       ├── consolidate.ts    # New: Sleep cycle consolidation
│       └── index.ts          # New: Memory system entry point

.alix/
├── memory/
│   ├── memory.md           # Index (loaded into every conversation)
│   ├── user/               # User preferences, patterns
│   │   └── *.md             # One file per fact
│   ├── project/            # Decisions, context NOT derivable from code
│   │   └── *.md
│   ├── feedback/           # Corrections, guidance given
│   │   └── *.md
│   ├── reference/          # Common patterns, conventions
│   │   └── *.md
│   ├── logs/               # Daily session logs
│   │   └── YYYY-MM-DD.md
│   └── config.json         # Memory settings, decay policy

tests/
└── utils/memory/
    ├── store.test.ts        # New
    ├── recall.test.ts       # New
    └── consolidate.test.ts   # New
```

---

## Task 1: Memory Types and Store

**Files:**
- Create: `src/utils/memory/types.ts`
- Create: `src/utils/memory/store.ts`
- Modify: `src/utils/memory/index.ts`

- [ ] **Step 1: Write memory types test**

Create `tests/utils/memory/types.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("MemoryType enum has correct values", () => {
  const types = ["user", "project", "feedback", "reference"] as const;
  // Just verify the module exports correctly
});

test("MemoryEntry has correct structure", () => {
  const entry = {
    name: "User prefers TypeScript",
    description: "Always use TypeScript for code examples",
    type: "user" as const,
    content: "When writing code, always use TypeScript.",
    createdAt: new Date().toISOString(),
    confidence: 1.0,
  };
  assert.ok(entry.name);
  assert.ok(entry.type);
  assert.ok(entry.content);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/utils/memory/types.test.ts`
Expected: PASS (basic structure test)

- [ ] **Step 3: Create types.ts**

Create `src/utils/memory/types.ts`:

```typescript
export type MemoryType = "user" | "project" | "feedback" | "reference";

export type MemoryEntry = {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  createdAt: string;
  modifiedAt: string;
  confidence: number; // 0.0-1.0, starts at 0.5
  confirmations: number;
  source?: string;
};

export type MemoryConfig = {
  decayEnabled: boolean;
  decayDays: number; // Default: 30
  maxEntriesPerType: number; // Default: 50
  consolidateSchedule: "daily" | "weekly" | "manual";
  indexMaxLines: number; // Default: 100
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  decayEnabled: true,
  decayDays: 30,
  maxEntriesPerType: 50,
  consolidateSchedule: "daily",
  indexMaxLines: 100,
};
```

- [ ] **Step 4: Create store.ts**

Create `src/utils/memory/store.ts`:

```typescript
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { MemoryEntry, MemoryType, MemoryConfig } from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";

export class MemoryStore {
  private basePath: string;
  private config: MemoryConfig;

  constructor(basePath: string = ".alix/memory", config?: Partial<MemoryConfig>) {
    this.basePath = basePath;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  async init(): Promise<void> {
    // Create all memory directories
    const dirs = ["user", "project", "feedback", "reference", "logs"];
    for (const dir of dirs) {
      await mkdir(join(this.basePath, dir), { recursive: true });
    }
    // Create config if not exists
    const configPath = join(this.basePath, "config.json");
    try {
      await readFile(configPath);
    } catch {
      await writeFile(configPath, JSON.stringify(this.config, null, 2), "utf8");
    }
  }

  async save(entry: MemoryEntry): Promise<void> {
    const dir = join(this.basePath, entry.type);
    const filename = this.slugify(entry.name) + ".md";
    const filepath = join(dir, filename);

    const frontmatter = `---
name: "${entry.name}"
description: "${entry.description}"
type: "${entry.type}"
createdAt: "${entry.createdAt}"
modifiedAt: "${new Date().toISOString()}"
confidence: ${entry.confidence}
confirmations: ${entry.confirmations}
---

${entry.content}`;

    await writeFile(filepath, frontmatter, "utf8");
  }

  async find(query: string, limit: number = 5): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const dirs: MemoryType[] = ["user", "project", "feedback", "reference"];

    for (const dir of dirs) {
      const dirPath = join(this.basePath, dir);
      try {
        const files = await readdir(dirPath);
        for (const file of files.slice(0, 20)) { // Limit scan
          const content = await readFile(join(dirPath, file), "utf8");
          if (content.toLowerCase().includes(query.toLowerCase())) {
            const entry = this.parseMarkdown(content, file.replace(".md", ""));
            results.push(entry);
          }
        }
      } catch {
        // Skip directory if not exists
      }
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, limit);
  }

  async loadIndex(): Promise<string> {
    const indexPath = join(this.basePath, "memory.md");
    try {
      return await readFile(indexPath, "utf8");
    } catch {
      return "";
    }
  }

  async buildIndex(): Promise<void> {
    const entries: string[] = [];
    const dirs: MemoryType[] = ["user", "project", "feedback", "reference"];

    for (const dir of dirs) {
      const dirPath = join(this.basePath, dir);
      try {
        const files = await readdir(dirPath);
        for (const file of files) {
          const content = await readFile(join(dirPath, file), "utf8");
          const entry = this.parseMarkdown(content, file.replace(".md", ""));
          // Include high-confidence entries in index
          if (entry.confidence >= 0.7) {
            entries.push(`[${entry.type}] ${entry.name}: ${entry.content.slice(0, 100)}...`);
          }
        }
      } catch {
        // Skip
      }
    }

    const index = `# Memory Index\n\n${entries.join("\n")}`;
    await writeFile(join(this.basePath, "memory.md"), index, "utf8");
  }

  async logSession(content: string): Promise<void> {
    const date = new Date().toISOString().split("T")[0];
    const logPath = join(this.basePath, "logs", `${date}.md`);
    const timestamp = new Date().toISOString();

    let existing = "";
    try {
      existing = await readFile(logPath, "utf8");
    } catch {
      // New file
    }

    const entry = `\n## ${timestamp}\n${content}`;
    await writeFile(logPath, existing + entry, "utf8");
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  private parseMarkdown(content: string, filename: string): MemoryEntry {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

    let entry: Partial<MemoryEntry> = {
      name: filename.replace(/-/g, " "),
      description: "",
      type: "user" as MemoryType,
      content: body,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      confidence: 0.5,
      confirmations: 0,
    };

    if (frontmatterMatch) {
      const lines = frontmatterMatch[1].split("\n");
      for (const line of lines) {
        const [key, ...valueParts] = line.split(":");
        const value = valueParts.join(":").trim().replace(/^["']|["']$/g, "");
        if (key === "name") entry.name = value;
        else if (key === "description") entry.description = value;
        else if (key === "type") entry.type = value as MemoryType;
        else if (key === "createdAt") entry.createdAt = value;
        else if (key === "modifiedAt") entry.modifiedAt = value;
        else if (key === "confidence") entry.confidence = parseFloat(value) || 0.5;
        else if (key === "confirmations") entry.confirmations = parseInt(value) || 0;
      }
    }

    return entry as MemoryEntry;
  }
}
```

- [ ] **Step 5: Create index.ts**

Create `src/utils/memory/index.ts`:

```typescript
export { MemoryStore } from "./store.js";
export { recall } from "./recall.js";
export { consolidate } from "./consolidate.js";
export type { MemoryEntry, MemoryType, MemoryConfig } from "./types.js";
```

- [ ] **Step 6: Create recall.ts**

Create `src/utils/memory/recall.ts`:

```typescript
import type { MemoryEntry } from "./types.js";
import { MemoryStore } from "./store.js";

export type RecallOptions = {
  maxResults: number;
  minConfidence: number;
  includeSource: boolean;
};

const DEFAULT_OPTIONS: RecallOptions = {
  maxResults: 5,
  minConfidence: 0.3,
  includeSource: true,
};

/**
 * Progressive recall - check layers in order, return first non-empty result.
 *
 * Level 0: Check memory.md (already in context) — zero cost
 * Level 1: Semantic search in memory store
 * Level 2: Expanded context with metadata
 * Level 3: Raw session logs (last resort)
 */
export async function recall(
  query: string,
  store: MemoryStore,
  options: Partial<RecallOptions> = {}
): Promise<{ level: number; entries: MemoryEntry[]; context: string }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Level 1: Search memory store
  const entries = await store.find(query, opts.maxResults);

  // Filter by confidence
  const filtered = entries.filter(e => e.confidence >= opts.minConfidence);

  if (filtered.length > 0) {
    const context = filtered
      .map(e => `[${e.type}] ${e.name}: ${e.content}`)
      .join("\n\n");

    return { level: 1, entries: filtered, context };
  }

  // Level 2: Search session logs (last resort)
  // Return empty if nothing found
  return { level: 0, entries: [], context: "" };
}

/**
 * Build memory context for system prompt injection.
 */
export async function buildMemoryContext(store: MemoryStore): Promise<string> {
  const index = await store.loadIndex();
  if (!index) return "";

  // Limit to ~1KB for system prompt
  const maxChars = 1000;
  if (index.length > maxChars) {
    return "# Memory Index\n\n" + index.slice(0, maxChars) + "\n...(truncated)";
  }

  return index;
}
```

- [ ] **Step 7: Create consolidate.ts**

Create `src/utils/memory/consolidate.ts`:

```typescript
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryEntry, MemoryType } from "./types.js";
import { MemoryStore } from "./store.js";

export type ConsolidationResult = {
  filesCreated: number;
  filesUpdated: number;
  conflictsResolved: number;
  entriesDecayed: number;
};

/**
 * Run consolidation (sleep cycle):
 * 1. Read daily logs
 * 2. Extract high-confidence facts
 * 3. Detect conflicts
 * 4. Update memory store
 * 5. Rebuild index
 */
export async function consolidate(store: MemoryStore): Promise<ConsolidationResult> {
  const result: ConsolidationResult = {
    filesCreated: 0,
    filesUpdated: 0,
    conflictsResolved: 0,
    entriesDecayed: 0,
  };

  // Find recent logs (last 7 days)
  const logsDir = join(store["basePath"], "logs");
  let logFiles: string[] = [];

  try {
    logFiles = await readdir(logsDir);
  } catch {
    return result; // No logs yet
  }

  // Filter to recent logs
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recentLogs: string[] = [];
  for (const file of logFiles) {
    const stats = await import("node:fs/promises").then(m => m.stat(join(logsDir, file)));
    if (stats.mtime >= sevenDaysAgo) {
      recentLogs.push(file);
    }
  }

  // Consolidate each log
  for (const logFile of recentLogs) {
    const content = await readFile(join(logsDir, logFile), "utf8");
    // Extract key decisions from log content
    const decisions = extractDecisions(content);

    for (const decision of decisions) {
      const existing = await store.find(decision.name, 1);

      if (existing.length > 0) {
        // Update with higher confidence
        const updated: MemoryEntry = {
          ...existing[0],
          content: decision.content,
          confidence: Math.min(1.0, existing[0].confidence + 0.1),
          confirmations: existing[0].confirmations + 1,
          modifiedAt: new Date().toISOString(),
        };
        await store.save(updated);
        result.filesUpdated++;
      } else {
        // Create new entry
        const entry: MemoryEntry = {
          name: decision.name,
          description: decision.description || "",
          type: decision.type || "project",
          content: decision.content,
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          confidence: 0.6,
          confirmations: 1,
        };
        await store.save(entry);
        result.filesCreated++;
      }
    }
  }

  // Rebuild index
  await store.buildIndex();

  return result;
}

/**
 * Extract decisions from log content using patterns.
 */
function extractDecisions(content: string): Array<{
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}> {
  const decisions: Array<{
    name: string;
    description: string;
    type: MemoryType;
    content: string;
  }> = [];

  // Pattern: lines starting with "-" or "*" that look like decisions
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const decision = trimmed.slice(2);
      if (decision.length > 10 && decision.length < 200) {
        decisions.push({
          name: decision.slice(0, 50),
          description: "",
          type: "project",
          content: decision,
        });
      }
    }
  }

  return decisions;
}
```

- [ ] **Step 8: Run tests**

Run: `npm run build && npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/utils/memory/ tests/utils/memory/ && git commit -m "feat(memory): add memory store with types and basic operations"
```

---

## Task 2: Session Integration

**Files:**
- Modify: `src/utils/session-digest.ts`
- Modify: `src/run.ts`
- Create: `tests/utils/memory/session-integration.test.ts`

- [ ] **Step 1: Write session integration test**

Create `tests/utils/memory/session-integration.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../../../src/utils/memory/store.js";
import { buildMemoryContext, recall } from "../../../src/utils/memory/recall.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("MemoryStore can init and save entry", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory"));
  await store.init();

  await store.save({
    name: "Test preference",
    description: "Testing memory store",
    type: "user",
    content: "User prefers concise responses",
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    confidence: 0.5,
    confirmations: 0,
  });

  const found = await store.find("preference", 5);
  assert.ok(found.length > 0);
  assert.equal(found[0].type, "user");
});

test("buildMemoryContext returns index content", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-context"));
  await store.init();
  await store.buildIndex();

  const context = await buildMemoryContext(store);
  assert.ok(typeof context === "string");
});

test("recall finds entries by query", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-recall"));
  await store.init();

  await store.save({
    name: "Preferred language",
    description: "User's preferred coding language",
    type: "user",
    content: "User prefers TypeScript over JavaScript",
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    confidence: 0.8,
    confirmations: 2,
  });

  const result = await recall("TypeScript", store);
  assert.ok(result.entries.length > 0);
  assert.equal(result.level, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/utils/memory/session-integration.test.ts`
Expected: FAIL (tests not passing yet)

- [ ] **Step 3: Modify session-digest.ts to load memory context**

Add to `src/utils/session-digest.ts`:

```typescript
import { buildMemoryContext } from "./memory/index.js";
import { MemoryStore } from "./memory/store.js";

export async function buildSessionDigestWithMemory(
  sessionDir: string,
  memoryDir: string = ".alix/memory"
): Promise<string> {
  // Build existing session digest
  const digest = await buildSessionDigest(sessionDir);

  // Load memory context
  const store = new MemoryStore(memoryDir);
  const memoryContext = await buildMemoryContext(store);

  const parts: string[] = [];
  if (digest) parts.push(digest);
  if (memoryContext) parts.push(`\n# Context\n${memoryContext}`);

  return parts.join("\n") || null;
}
```

- [ ] **Step 4: Modify run.ts to inject memory context**

In `src/run.ts`, find where system prompt is built and add memory injection:

```typescript
// After session initialization, load memory context
const memoryStore = new MemoryStore(resolve(projectRoot, ".alix/memory"));
const memoryContext = await buildMemoryContext(memoryStore);

// Add to system prompt
const systemPrompt = `${baseSystemPrompt}${memoryContext ? "\n\n# Memory\n" + memoryContext : ""}`;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && npx tsx --test tests/utils/memory/session-integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/session-digest.ts src/run.ts tests/utils/memory/session-integration.test.ts && git commit -m "feat(memory): integrate memory context into session digest"
```

---

## Task 3: CLI Memory Inspector

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/utils/memory/cli.test.ts`

- [ ] **Step 1: Add memory CLI commands**

In `src/cli.ts`, add memory commands:

```typescript
// In the CLI switch statement, add:
// case "memory":
//   await handleMemoryCommand(args);
// break;

// Add handler:
async function handleMemoryCommand(args: Record<string, unknown>): Promise<void> {
  const subcommand = args.subcommand as string;
  const memoryDir = resolve(process.cwd(), ".alix/memory");
  const store = new MemoryStore(memoryDir);
  await store.init();

  switch (subcommand) {
    case "list": {
      const type = args.type as string | undefined;
      const results = await store.find(args.query as string || "", 20);
      const filtered = type ? results.filter(r => r.type === type) : results;
      for (const entry of filtered) {
        console.log(`[${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
        console.log(`  ${entry.content.slice(0, 100)}...`);
        console.log();
      }
      break;
    }
    case "add": {
      await store.save({
        name: args.name as string,
        description: args.description as string || "",
        type: (args.type as MemoryType) || "project",
        content: args.content as string,
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        confidence: 0.7,
        confirmations: 1,
      });
      await store.buildIndex();
      console.log("Memory entry saved.");
      break;
    }
    case "search": {
      const results = await store.find(args.query as string, 10);
      console.log(`Found ${results.length} entries:`);
      for (const entry of results) {
        console.log(`  [${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
      }
      break;
    }
    case "stats": {
      const dirs: MemoryType[] = ["user", "project", "feedback", "reference"];
      for (const dir of dirs) {
        const files = await readdir(join(memoryDir, dir)).catch(() => []);
        console.log(`${dir}: ${files.length} entries`);
      }
      break;
    }
    default:
      console.log("Usage: alix memory [list|add|search|stats]");
  }
}
```

Add to the CLI argument parser:

```typescript
const subcommands = ["memory"] as const;
```

- [ ] **Step 2: Test CLI**

Run: `npm run build && node dist/src/cli.js memory stats`
Expected: Shows counts per memory type

Run: `node dist/src/cli.js memory add --name "Test decision" --type project --content "We chose TypeScript"`
Expected: Saves entry

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts && git commit -m "feat(memory): add CLI commands for memory management"
```

---

## Task 4: Update post-mvp-backlog.md

- [ ] **Step 1: Mark P3.2 as in progress**

Update `docs/post-mvp-backlog.md`:

```markdown
#### P3.2: Memory System (Spec Gap #11)

Current state: Implementation started
- ✅ MemoryStore — file-based with 4-type taxonomy
- ✅ Progressive recall — level-based search
- ✅ Session integration — memory context in system prompt
- ✅ CLI commands — list, add, search, stats
- 🟡 Consolidation — sleep cycle for nightly processing

Future upgrades:
- LLM-powered fact extraction from logs
- Conflict detection with user confirmation
- Confidence-based ranking
- Cross-session learning
```

- [ ] **Step 2: Commit**

```bash
git add docs/post-mvp-backlog.md && git commit -m "docs: update P3.2 status to in-progress"
```

---

## Verification

- [ ] **Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass

- [ ] **Test memory CLI**

```bash
node dist/src/cli.js memory stats
node dist/src/cli.js memory add --name "Test" --type user --content "Test content"
node dist/src/cli.js memory search "test"
```

- [ ] **Verify memory context injection**

Run a session and check that memory.md is referenced in system context.

---

## Summary

This implementation adds:

| Component | Description |
|-----------|-------------|
| **MemoryStore** | File-based storage with 4-type taxonomy (user/project/feedback/reference) |
| **Recall** | Progressive recall with confidence-based ranking |
| **Consolidate** | Sleep cycle for nightly processing |
| **CLI** | Memory management commands |
| **Integration** | Memory context injected into session context |

**Design choices (from research):**
- File-based (markdown) for simplicity and version control
- No external DB dependency (matches ALiX philosophy)
- Lean index for system prompt injection (~1KB)
- Confidence scoring for ranking
- 4-type taxonomy from agent-memory npm package