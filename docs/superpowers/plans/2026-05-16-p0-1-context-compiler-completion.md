# P0.1 Context Compiler Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the missing P0.1 Context Compiler work so ALiX can select high-quality repo context using task intent, symbols, dependency relationships, git activity, and a strict token budget.

**Architecture:** Keep the current `ContextCompiler` public API stable, but split the missing intelligence into small helpers under `src/repomap/`. The compiler remains the orchestration point: repo map -> task mentions -> dependency/symbol/git signals -> ranked budgeted `ContextBundle` -> prompt injection in `run.ts`.

**Tech Stack:** TypeScript, Node built-ins, `node:test`, existing `ContextCompiler`, existing `buildRepoMapLite`, no new runtime dependencies.

---

## Current Status

Already implemented:
- `src/repomap/context-compiler.ts` exists and is wired into `src/run.ts`.
- `ContextCompiler.warm()` builds a repo map.
- `ContextCompiler.compile()` returns a typed `ContextBundle`.
- Task type is provided by `classifyTask()`.
- Task-mentioned files, config files, related tests, pinned files, and approximate token budgets are supported.

Still missing:
- Import/export dependency graph.
- Symbol-level context inside `ContextCompiler`.
- Git activity scoring.
- Stronger ranking that combines mention, dependency, symbol, test, config, and recency signals.
- Rich prompt context beyond path lists.
- Updated backlog status after completion.

## File Structure

- Create `src/repomap/dependency-graph.ts`
  - Parse simple static imports/exports from TS/JS files.
  - Resolve relative imports to repo paths.
  - Return direct dependency and dependent relationships.

- Create `src/repomap/symbol-extractor.ts`
  - Extract top-level functions/classes/interfaces/types/consts from source files.
  - Include line numbers and lightweight signature text.

- Create `src/repomap/git-activity.ts`
  - Read recent git history with `git log`.
  - Score recently changed files without failing outside git repos.

- Create `src/repomap/context-ranker.ts`
  - Combine ranked signals into a deterministic score and reason list.

- Modify `src/repomap/context-compiler.ts`
  - Use the new helpers.
  - Add symbol items to `ContextBundle`.
  - Add dependency-related files.
  - Preserve current API shape where possible.

- Modify `src/run.ts`
  - Include richer context in the system prompt: primary files, symbols, related files, tests, and reasons.

- Modify `tests/repomap/context-compiler.test.ts`
  - Add integration coverage for dependencies, symbols, git recency, ranking, and budget behavior.

- Create tests:
  - `tests/repomap/dependency-graph.test.ts`
  - `tests/repomap/symbol-extractor.test.ts`
  - `tests/repomap/git-activity.test.ts`
  - `tests/repomap/context-ranker.test.ts`

- Modify `docs/post-mvp-backlog.md`
  - Update P0.1 current state after implementation.

---

### Task 1: Dependency Graph

**Files:**
- Create: `src/repomap/dependency-graph.ts`
- Test: `tests/repomap/dependency-graph.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/repomap/dependency-graph.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDependencyGraph } from "../../src/repomap/dependency-graph.js";

describe("buildDependencyGraph", () => {
  it("maps direct relative imports to repo paths", () => {
    const graph = buildDependencyGraph([
      { path: "src/app.ts", content: "import { auth } from './auth';\nexport function app() { return auth(); }" },
      { path: "src/auth.ts", content: "export function auth() { return true; }" },
    ]);

    assert.deepEqual(graph.dependenciesOf("src/app.ts"), ["src/auth.ts"]);
    assert.deepEqual(graph.dependentsOf("src/auth.ts"), ["src/app.ts"]);
  });

  it("resolves index imports", () => {
    const graph = buildDependencyGraph([
      { path: "src/app.ts", content: "import { auth } from './auth';" },
      { path: "src/auth/index.ts", content: "export const auth = true;" },
    ]);

    assert.deepEqual(graph.dependenciesOf("src/app.ts"), ["src/auth/index.ts"]);
  });

  it("ignores package imports and unresolved imports", () => {
    const graph = buildDependencyGraph([
      { path: "src/app.ts", content: "import express from 'express';\nimport x from './missing';" },
    ]);

    assert.deepEqual(graph.dependenciesOf("src/app.ts"), []);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: TypeScript fails because `src/repomap/dependency-graph.ts` does not exist.

- [ ] **Step 3: Implement dependency graph**

Create `src/repomap/dependency-graph.ts`:

```ts
import { dirname, join, normalize } from "node:path";

export type DependencyInputFile = {
  path: string;
  content?: string;
};

export type DependencyGraph = {
  dependenciesOf(path: string): string[];
  dependentsOf(path: string): string[];
};

const IMPORT_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']|export\s+[^"']*from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export function buildDependencyGraph(files: DependencyInputFile[]): DependencyGraph {
  const knownPaths = new Set(files.map((file) => normalizePath(file.path)));
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const file of files) {
    const from = normalizePath(file.path);
    const imports = extractImportSpecifiers(file.content ?? "");
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelativeImport(from, specifier, knownPaths);
      if (!resolved) continue;
      addEdge(dependencies, from, resolved);
      addEdge(dependents, resolved, from);
    }
  }

  return {
    dependenciesOf(path: string) {
      return [...(dependencies.get(normalizePath(path)) ?? [])].sort();
    },
    dependentsOf(path: string) {
      return [...(dependents.get(normalizePath(path)) ?? [])].sort();
    },
  };
}

function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

function resolveRelativeImport(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  const base = normalizePath(join(dirname(fromPath), specifier));
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function addEdge(map: Map<string, Set<string>>, from: string, to: string): void {
  const set = map.get(from) ?? new Set<string>();
  set.add(to);
  map.set(from, set);
}

function normalizePath(path: string): string {
  return normalize(path).replace(/\\/g, "/");
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/repomap/dependency-graph.test.js
```

Expected: all dependency graph tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repomap/dependency-graph.ts tests/repomap/dependency-graph.test.ts
git commit -m "feat: add repo dependency graph"
```

---

### Task 2: Symbol Extractor

**Files:**
- Create: `src/repomap/symbol-extractor.ts`
- Test: `tests/repomap/symbol-extractor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/repomap/symbol-extractor.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractTopLevelSymbols } from "../../src/repomap/symbol-extractor.js";

describe("extractTopLevelSymbols", () => {
  it("extracts exported functions, classes, interfaces, types, and consts", () => {
    const symbols = extractTopLevelSymbols("src/auth.ts", [
      "export function login(user: string) { return user; }",
      "export class AuthService {}",
      "export interface User { id: string }",
      "export type Role = 'admin';",
      "export const TOKEN = 'x';",
    ].join("\n"));

    assert.deepEqual(symbols.map((symbol) => [symbol.name, symbol.kind, symbol.line]), [
      ["login", "function", 1],
      ["AuthService", "class", 2],
      ["User", "interface", 3],
      ["Role", "type", 4],
      ["TOKEN", "const", 5],
    ]);
  });

  it("keeps a compact signature", () => {
    const [symbol] = extractTopLevelSymbols("src/auth.ts", "export function login(user: string) { return user; }");
    assert.equal(symbol.signature, "export function login(user: string) { return user; }");
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: TypeScript fails because `src/repomap/symbol-extractor.ts` does not exist.

- [ ] **Step 3: Implement symbol extractor**

Create `src/repomap/symbol-extractor.ts`:

```ts
export type ExtractedSymbolKind = "function" | "class" | "interface" | "type" | "const";

export type ExtractedSymbol = {
  path: string;
  name: string;
  kind: ExtractedSymbolKind;
  line: number;
  signature: string;
};

const SYMBOL_PATTERNS: Array<{ kind: ExtractedSymbolKind; pattern: RegExp }> = [
  { kind: "function", pattern: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", pattern: /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "const", pattern: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/ },
  { kind: "function", pattern: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", pattern: /^\s*class\s+([A-Za-z_$][\w$]*)/ },
];

export function extractTopLevelSymbols(path: string, content: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;
      symbols.push({
        path,
        name: match[1],
        kind,
        line: index + 1,
        signature: line.trim(),
      });
      break;
    }
  });

  return symbols;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/repomap/symbol-extractor.test.js
```

Expected: all symbol extractor tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repomap/symbol-extractor.ts tests/repomap/symbol-extractor.test.ts
git commit -m "feat: add context symbol extractor"
```

---

### Task 3: Git Activity Reader

**Files:**
- Create: `src/repomap/git-activity.ts`
- Test: `tests/repomap/git-activity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/repomap/git-activity.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitActivity } from "../../src/repomap/git-activity.js";

describe("readGitActivity", () => {
  it("returns an empty map outside a git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alix-git-activity-"));
    try {
      const activity = await readGitActivity(dir);
      assert.deepEqual([...activity.entries()], []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses git log numstat output", async () => {
    const activity = await readGitActivity("/repo", {
      runGitLog: async () => [
        "src/a.ts",
        "src/b.ts",
        "src/a.ts",
      ].join("\n"),
    });

    assert.equal(activity.get("src/a.ts"), 2);
    assert.equal(activity.get("src/b.ts"), 1);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: TypeScript fails because `src/repomap/git-activity.ts` does not exist.

- [ ] **Step 3: Implement git activity reader**

Create `src/repomap/git-activity.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitActivityOptions = {
  maxCommits?: number;
  runGitLog?: () => Promise<string>;
};

export async function readGitActivity(root: string, options: GitActivityOptions = {}): Promise<Map<string, number>> {
  const maxCommits = options.maxCommits ?? 50;
  let output: string;

  try {
    output = options.runGitLog
      ? await options.runGitLog()
      : (await execFileAsync("git", ["log", `--max-count=${maxCommits}`, "--name-only", "--pretty=format:"], { cwd: root })).stdout;
  } catch {
    return new Map();
  }

  const activity = new Map<string, number>();
  for (const line of output.split("\n")) {
    const path = line.trim();
    if (!path || path.includes("\t")) continue;
    activity.set(path, (activity.get(path) ?? 0) + 1);
  }
  return activity;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/repomap/git-activity.test.js
```

Expected: all git activity tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repomap/git-activity.ts tests/repomap/git-activity.test.ts
git commit -m "feat: add git activity context signal"
```

---

### Task 4: Context Ranker

**Files:**
- Create: `src/repomap/context-ranker.ts`
- Test: `tests/repomap/context-ranker.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/repomap/context-ranker.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankContextCandidate } from "../../src/repomap/context-ranker.js";

describe("rankContextCandidate", () => {
  it("combines mention, dependency, symbol, test, config, and git activity signals", () => {
    const ranked = rankContextCandidate({
      path: "src/auth.ts",
      baseKind: "source",
      mentionScore: 100,
      dependencyDistance: 1,
      symbolMatched: true,
      relatedTest: false,
      config: false,
      gitTouches: 3,
    });

    assert.equal(ranked.score, 163);
    assert.deepEqual(ranked.reasons, [
      "task_mention:100",
      "dependency_distance:1",
      "symbol_match",
      "git_activity:3",
    ]);
  });

  it("scores config files without pretending they are edit targets", () => {
    const ranked = rankContextCandidate({
      path: "package.json",
      baseKind: "config",
      mentionScore: 0,
      dependencyDistance: null,
      symbolMatched: false,
      relatedTest: false,
      config: true,
      gitTouches: 0,
    });

    assert.equal(ranked.score, 10);
    assert.deepEqual(ranked.reasons, ["config_file"]);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Expected: TypeScript fails because `src/repomap/context-ranker.ts` does not exist.

- [ ] **Step 3: Implement ranker**

Create `src/repomap/context-ranker.ts`:

```ts
export type RankInput = {
  path: string;
  baseKind: "source" | "test" | "config" | "docs" | "unknown";
  mentionScore: number;
  dependencyDistance: number | null;
  symbolMatched: boolean;
  relatedTest: boolean;
  config: boolean;
  gitTouches: number;
};

export type RankOutput = {
  score: number;
  reasons: string[];
};

export function rankContextCandidate(input: RankInput): RankOutput {
  let score = 0;
  const reasons: string[] = [];

  if (input.mentionScore > 0) {
    score += input.mentionScore;
    reasons.push(`task_mention:${input.mentionScore}`);
  }
  if (input.dependencyDistance !== null) {
    const dependencyScore = Math.max(0, 30 - input.dependencyDistance * 10);
    if (dependencyScore > 0) {
      score += dependencyScore;
      reasons.push(`dependency_distance:${input.dependencyDistance}`);
    }
  }
  if (input.symbolMatched) {
    score += 25;
    reasons.push("symbol_match");
  }
  if (input.relatedTest) {
    score += 40;
    reasons.push("related_test");
  }
  if (input.config) {
    score += 10;
    reasons.push("config_file");
  }
  if (input.gitTouches > 0) {
    const recencyScore = Math.min(18, input.gitTouches * 6);
    score += recencyScore;
    reasons.push(`git_activity:${input.gitTouches}`);
  }

  return { score, reasons };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/repomap/context-ranker.test.js
```

Expected: all context ranker tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-ranker.ts tests/repomap/context-ranker.test.ts
git commit -m "feat: add context ranking signals"
```

---

### Task 5: Wire Signals Into ContextCompiler

**Files:**
- Modify: `src/repomap/context-compiler.ts`
- Test: `tests/repomap/context-compiler.test.ts`

- [ ] **Step 1: Add failing integration tests**

Append these tests inside `describe("compile()", ...)` in `tests/repomap/context-compiler.test.ts`:

```ts
    it("includes dependency-related files for mentioned source files", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "app.ts"), "import { auth } from './auth';\nexport function app() { return auth(); }");
      writeFileSync(join(tmpDir, "src", "auth.ts"), "export function auth() { return true; }");
      await warm();

      const bundle = await compiler.compile("fix src/app.ts", "bugfix", 10000, []);
      const paths = bundle.primaryFiles.map(f => f.path);

      assert.ok(paths.includes("src/app.ts"));
      assert.ok(paths.includes("src/auth.ts"));
      assert.ok(bundle.primaryFiles.find(f => f.path === "src/auth.ts")?.reason.includes("dependency_distance:1"));
    });

    it("includes symbol context when task mentions a symbol", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "auth.ts"), "export function login(user: string) { return user; }\nexport function logout() {}");
      await warm();

      const bundle = await compiler.compile("fix login behavior", "bugfix", 10000, []);
      const symbols = bundle.primaryFiles.filter(f => f.kind === "symbol");

      assert.ok(symbols.some(symbol => symbol.symbolName === "login"));
    });
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/repomap/context-compiler.test.js
```

Expected: new dependency/symbol tests fail.

- [ ] **Step 3: Update ContextCompiler types and repo map**

Modify `src/repomap/context-compiler.ts` imports:

```ts
import { buildDependencyGraph, type DependencyGraph } from "./dependency-graph.js";
import { extractTopLevelSymbols, type ExtractedSymbol } from "./symbol-extractor.js";
import { readGitActivity } from "./git-activity.js";
import { rankContextCandidate } from "./context-ranker.js";
```

Extend `RepoMap`:

```ts
type RepoMap = {
  sourceFiles: string[];
  testFiles: string[];
  configFiles: string[];
  docsFiles: string[];
  fileEntries: Map<string, FileEntry>;
  dependencyGraph: DependencyGraph;
  symbols: ExtractedSymbol[];
  gitActivity: Map<string, number>;
};
```

In `buildRepoMap()`, after walking files:

```ts
  const dependencyGraph = buildDependencyGraph([...fileEntries.values()].map((entry) => ({
    path: entry.path,
    content: entry.content,
  })));
  const symbols = [...fileEntries.values()]
    .filter((entry) => entry.kind === "source" && entry.content)
    .flatMap((entry) => extractTopLevelSymbols(entry.path, entry.content ?? ""));
  const gitActivity = await readGitActivity(root);

  return { sourceFiles, testFiles, configFiles, docsFiles, fileEntries, dependencyGraph, symbols, gitActivity };
```

- [ ] **Step 4: Add dependency and symbol candidates**

In `compile()`, destructure:

```ts
const { fileEntries, sourceFiles, testFiles, configFiles, docsFiles, dependencyGraph, symbols, gitActivity } = this.repoMap ?? await buildRepoMap(process.cwd());
```

After task-mentioned primary items are created, add:

```ts
    const currentPrimaryPaths = new Set(items.filter(i => i.kind === "file").map(i => i.path));
    for (const primaryPath of currentPrimaryPaths) {
      for (const relatedPath of [...dependencyGraph.dependenciesOf(primaryPath), ...dependencyGraph.dependentsOf(primaryPath)]) {
        const entry = fileEntries.get(relatedPath);
        if (!entry || entry.kind !== "source") continue;
        const ranked = rankContextCandidate({
          path: relatedPath,
          baseKind: entry.kind,
          mentionScore: 0,
          dependencyDistance: 1,
          symbolMatched: false,
          relatedTest: false,
          config: false,
          gitTouches: gitActivity.get(relatedPath) ?? 0,
        });
        items.push({
          path: relatedPath,
          kind: "file",
          score: ranked.score,
          tokenEstimate: estimateFileTokens(relatedPath, entry.lineCount ?? 100, true),
          reason: ranked.reasons.join(","),
        });
      }
    }

    const taskWords = new Set(task.toLowerCase().split(/[^a-zA-Z0-9_$]+/).filter(Boolean));
    for (const symbol of symbols) {
      if (!taskWords.has(symbol.name.toLowerCase())) continue;
      const ranked = rankContextCandidate({
        path: symbol.path,
        baseKind: "source",
        mentionScore: 0,
        dependencyDistance: null,
        symbolMatched: true,
        relatedTest: false,
        config: false,
        gitTouches: gitActivity.get(symbol.path) ?? 0,
      });
      items.push({
        path: symbol.path,
        kind: "symbol",
        symbolName: symbol.name,
        lineStart: symbol.line,
        lineEnd: symbol.line,
        score: ranked.score,
        tokenEstimate: 20,
        reason: ranked.reasons.join(","),
      });
    }
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/repomap/context-compiler.test.js
```

Expected: context compiler tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/repomap/context-compiler.ts tests/repomap/context-compiler.test.ts
git commit -m "feat: enrich context compiler signals"
```

---

### Task 6: Richer Prompt Context

**Files:**
- Modify: `src/run.ts`
- Test: add to existing run/system prompt coverage if present; otherwise create `tests/context-prompt.test.ts`

- [ ] **Step 1: Extract prompt context rendering**

Create an exported helper in `src/run.ts` near `buildToolsForProvider()`:

```ts
export function renderContextBundleForPrompt(contextBundle: import("./repomap/context-compiler.js").ContextBundle): string {
  const lines: string[] = ["## Context Files"];
  if (contextBundle.primaryFiles.length > 0) {
    lines.push(`Primary files: ${contextBundle.primaryFiles.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  if (contextBundle.primaryFiles.some(f => f.kind === "symbol")) {
    const symbols = contextBundle.primaryFiles
      .filter(f => f.kind === "symbol")
      .map(f => `${f.symbolName}@${f.path}:${f.lineStart} (${f.reason})`);
    lines.push(`Symbols: ${symbols.join(", ")}`);
  }
  if (contextBundle.tests.length > 0) {
    lines.push(`Related tests: ${contextBundle.tests.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  if (contextBundle.supportingFiles.length > 0) {
    lines.push(`Supporting files: ${contextBundle.supportingFiles.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Write failing prompt rendering test**

Create `tests/context-prompt.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderContextBundleForPrompt } from "../src/run.js";

test("renderContextBundleForPrompt includes reasons and symbol locations", () => {
  const rendered = renderContextBundleForPrompt({
    id: "bundle-test",
    taskType: "bugfix",
    budget: { maxTokens: 1000, usedTokens: 100 },
    primaryFiles: [
      { path: "src/auth.ts", kind: "file", score: 100, tokenEstimate: 80, reason: "task_mention:100" },
      { path: "src/auth.ts", kind: "symbol", symbolName: "login", lineStart: 3, lineEnd: 3, score: 25, tokenEstimate: 20, reason: "symbol_match" },
    ],
    supportingFiles: [
      { path: "package.json", kind: "config", score: 10, tokenEstimate: 20, reason: "config_file" },
    ],
    tests: [
      { path: "tests/auth.test.ts", kind: "test", score: 40, tokenEstimate: 50, reason: "test_relationship:src/auth.ts" },
    ],
    pinned: [],
  });

  assert.match(rendered, /src\/auth\.ts \(task_mention:100\)/);
  assert.match(rendered, /login@src\/auth\.ts:3 \(symbol_match\)/);
  assert.match(rendered, /tests\/auth\.test\.ts \(test_relationship:src\/auth\.ts\)/);
});
```

- [ ] **Step 3: Verify RED, then wire helper**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/context-prompt.test.js
```

Expected before helper export: compile failure or test failure.

Then replace the inline `## Context Files` construction inside `buildSystemPrompt()` with:

```ts
    if (contextBundle.primaryFiles.length > 0 || contextBundle.tests.length > 0 || contextBundle.supportingFiles.length > 0) {
      parts.push(renderContextBundleForPrompt(contextBundle));
    }
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node --test dist/tests/context-prompt.test.js
```

Expected: prompt rendering test passes.

- [ ] **Step 5: Commit**

```bash
git add src/run.ts tests/context-prompt.test.ts
git commit -m "feat: render rich context prompt"
```

---

### Task 7: Update Backlog Status

**Files:**
- Modify: `docs/post-mvp-backlog.md`

- [ ] **Step 1: Update P0.1 current state**

Replace the P0.1 current-state paragraph with:

```md
Current state: `ContextCompiler` is wired into `runTask` and produces a ranked `ContextBundle`. It includes task-mentioned files, config files, related tests, pinned files, dependency-related files, symbol-level matches, git activity scoring, and token-budget enforcement. Remaining future upgrades are semantic search, Tree-sitter-grade parsing, and richer snippet extraction.
```

- [ ] **Step 2: Update P0.1 components list**

Change the P0.1 component bullets to:

```md
Key components implemented:
- ✅ `IntentClassifier` — task type classification via `src/task-classifier.ts`
- ✅ `SymbolExtractor` — top-level exported symbol extraction
- ✅ `DependencyGraph` — relative import/export graph
- ✅ `GitActivityReader` — recent git activity scoring
- ✅ `ContextRanker` — combined scoring for mentions, dependencies, symbols, tests, config, and recency
- ✅ `ContextBudgeter` — approximate token budget enforcement

Future upgrades:
- Tree-sitter parser for more precise symbols and references
- Semantic search over repo content
- Snippet-level context extraction instead of path-level prompt hints
```

- [ ] **Step 3: Verify docs diff**

Run:

```bash
git diff -- docs/post-mvp-backlog.md
```

Expected: only P0.1 status changes.

- [ ] **Step 4: Commit**

```bash
git add docs/post-mvp-backlog.md
git commit -m "docs: update context compiler backlog status"
```

---

### Task 8: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full check**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all non-skipped tests pass.

- [ ] **Step 2: Run GitNexus detect changes**

Run GitNexus staged or final detection before final commit/PR:

```bash
npx gitnexus analyze
```

Then use GitNexus change detection via MCP.

Expected: review any affected flows. If GitNexus reports HIGH or CRITICAL risk, stop and report before continuing.

- [ ] **Step 3: Final integration commit if needed**

If any final cleanup remains:

```bash
git add .
git commit -m "feat: complete p0 context compiler"
```

---

## Self-Review

Spec coverage:
- Dependency graph: Task 1 and Task 5.
- Symbol context: Task 2 and Task 5.
- Git activity: Task 3 and Task 5.
- Ranking: Task 4 and Task 5.
- Budget enforcement: existing compiler keeps this; Task 5 preserves it.
- Richer prompt context: Task 6.
- Backlog update: Task 7.

Placeholder scan:
- No `TBD`, `TODO`, `implement later`, or unspecified “write tests” steps remain.

Type consistency:
- `ExtractedSymbol`, `DependencyGraph`, `RankInput`, and `ContextBundle` property names are used consistently across tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-16-p0-1-context-compiler-completion.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

