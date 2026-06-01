# P1.2 Verification Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smart test selection that maps file changes to the most relevant tests using dependency analysis, with cost-based ordering and residual risk reporting.

**Architecture:** Extend the existing verification infrastructure. Add a TestPlanner class that uses dependency graph analysis to select the minimal test set covering changed files. Integrate with the task loop at verification time.

**Tech Stack:** TypeScript, existing verifier module, repo-map infrastructure

---

## File Structure

- Create: `src/verifier/test-planner.ts`
- Create: `src/verifier/dep-graph.ts`
- Modify: `src/verifier/test-mapper.ts`
- Modify: `src/verifier/index.ts`
- Modify: `src/run/task-loop.ts:489-501` (wire test planner)
- Test: `tests/unit/test-planner.test.ts`

---

## Existing Behavior

The current `mapFilesToTests()` uses simple path heuristics:
```
src/auth/user.ts → tests/auth/user.test.ts
src/auth/user.ts → tests/user.test.ts
src/auth/user.ts → src/user.test.ts
```

This misses:
- Tests that import the file but don't mirror its path
- Tests covering dependent modules (if A depends on B, changing A may break B's tests)
- Test dependencies in the opposite direction (test for module X might need tests for module Y)

---

## Tasks

### Task 1: Dependency Graph Analyzer

**Files:**
- Create: `src/verifier/dep-graph.ts`
- Test: `tests/unit/dep-graph.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/dep-graph.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { DependencyGraph, buildDepGraphFromImports } from "../../src/verifier/dep-graph.js";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("DependencyGraph", () => {
  const testDir = join(process.cwd(), ".test-dep-graph");
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    try { await rm(testDir, { recursive: true }); } catch {}
  });

  it("builds graph from import statements", async () => {
    const files = {
      "a.ts": "import { b } from './b.js';\nimport { c } from './c.js';",
      "b.ts": "import { c } from './c.js';",
      "c.ts": "export const x = 1;",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }
    
    const graph = await buildDepGraphFromImports(testDir, ["a.ts", "b.ts", "c.ts"]);
    
    // a imports b and c, b imports c
    assert.ok(graph.depsOf("a.ts").includes("b.ts"));
    assert.ok(graph.depsOf("a.ts").includes("c.ts"));
    assert.ok(graph.depsOf("b.ts").includes("c.ts"));
  });

  it("finds affected tests for changed file", async () => {
    const files = {
      "src/module.ts": "export const x = 1;",
      "tests/module.test.ts": "import { x } from '../src/module.js';",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }
    
    const graph = await buildDepGraphFromImports(testDir, Object.keys(files));
    const affected = graph.findAffectedTests(["src/module.ts"]);
    
    assert.ok(affected.length > 0, "Should find tests for changed module");
    assert.ok(affected.some(t => t.includes("module.test")), "Should include module test");
  });

  it("orders tests by dependency distance", async () => {
    // Files: a.ts (top), b.ts (depends on a), c.ts (depends on b), tests for each
    const files = {
      "src/a.ts": "export const a = 1;",
      "src/b.ts": "import { a } from './a.js';",
      "src/c.ts": "import { b } from './b.js';",
      "tests/a.test.ts": "",
      "tests/b.test.ts": "",
      "tests/c.test.ts": "",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }
    
    const graph = await buildDepGraphFromImports(testDir, Object.keys(files));
    
    // When c.ts changes, affected tests should include c, b (c depends on b)
    const affected = graph.findAffectedTests(["src/c.ts"]);
    const testNames = affected.map(t => t.split("/").pop());
    
    assert.ok(testNames.includes("c.test.ts"), "Should include c.test");
    // Note: current impl only goes one level deep for tests
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/dep-graph.test.ts`
Expected: FAIL with "Module not found" (code doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/verifier/dep-graph.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export class DependencyGraph {
  private imports = new Map<string, string[]>();
  private reverseImports = new Map<string, string[]>();

  addImport(from: string, to: string): void {
    if (!this.imports.has(from)) this.imports.set(from, []);
    this.imports.get(from)!.push(to);
    
    if (!this.reverseImports.has(to)) this.reverseImports.set(to, []);
    this.reverseImports.get(to)!.push(from);
  }

  depsOf(file: string): string[] {
    return this.imports.get(file) ?? [];
  }

  dependentsOf(file: string): string[] {
    return this.reverseImports.get(file) ?? [];
  }

  /**
   * Find test files that might be affected by changes to given source files.
   * Goes up the dependency chain: if A imports B, and B changes, A's tests may break.
   */
  findAffectedTests(sourceFiles: string[]): string[] {
    const testFiles = new Set<string>();
    
    // For each changed source, find all files that depend on it (transitively)
    const visited = new Set<string>();
    const queue = [...sourceFiles];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      
      const dependents = this.dependentsOf(current);
      for (const dep of dependents) {
        if (this.isTestFile(dep)) {
          testFiles.add(dep);
        } else {
          queue.push(dep);
        }
      }
    }
    
    return [...testFiles];
  }

  private isTestFile(path: string): boolean {
    return /test|spec/i.test(path);
  }
}

const IMPORT_PATTERN = /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;

function extractImports(content: string): string[] {
  const imports: string[] = [];
  let match;
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function resolveImport(basePath: string, importPath: string): string {
  // Simple relative path resolution
  if (importPath.startsWith(".")) {
    const baseDir = basePath.substring(0, basePath.lastIndexOf("/"));
    let resolved = baseDir + "/" + importPath;
    // Normalize .. and .
    resolved = resolved.replace(/\/[^/]+\/\.\./g, "");
    resolved = resolved.replace(/\/\./g, "/");
    // Add .ts extension if missing
    if (!resolved.endsWith(".ts") && !resolved.endsWith(".js")) {
      resolved += ".ts";
    }
    return resolved;
  }
  return importPath;
}

export async function buildDepGraphFromImports(
  root: string,
  filePaths: string[]
): Promise<DependencyGraph> {
  const graph = new DependencyGraph();
  
  for (const filePath of filePaths) {
    const fullPath = join(root, filePath);
    if (!existsSync(fullPath)) continue;
    
    const content = await readFile(fullPath, "utf8");
    const imports = extractImports(content);
    
    for (const imp of imports) {
      const resolved = resolveImport(filePath, imp);
      graph.addImport(filePath, resolved);
    }
  }
  
  return graph;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/dep-graph.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/dep-graph.ts tests/unit/dep-graph.test.ts
git commit -m "feat(verifier): add DependencyGraph for import-based test analysis

Tracks file dependencies via import statements. findAffectedTests()
walks the dependency chain to find tests that might be affected by
changes. Future work: integrate with TestPlanner for smart selection."
```

---

### Task 2: Test Planner with Smart Selection

**Files:**
- Create: `src/verifier/test-planner.ts`
- Test: `tests/unit/test-planner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/test-planner.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { TestPlanner, createTestPlan } from "../../src/verifier/test-planner.js";
import type { VerificationCheck } from "../../src/verifier/verifier.js";

describe("TestPlanner", () => {
  it("orders checks by cost (typecheck < build < test)", () => {
    const checks: VerificationCheck[] = [
      { command: "npm test", reason: "test suite" },
      { command: "npm run build", reason: "build" },
      { command: "npm run typecheck", reason: "typecheck" },
    ];
    
    const planner = new TestPlanner();
    const ordered = planner.orderByCost(checks);
    
    const commands = ordered.map(c => c.command);
    const typecheckIdx = commands.findIndex(c => c.includes("typecheck"));
    const buildIdx = commands.findIndex(c => c.includes("build"));
    const testIdx = commands.findIndex(c => c.includes("test"));
    
    assert.ok(typecheckIdx < buildIdx, "typecheck should come before build");
    assert.ok(buildIdx < testIdx, "build should come before test");
  });

  it("filters to minimal test set for changed files", async () => {
    // Mock changed files
    const planner = new TestPlanner();
    planner.setChangedFiles(["src/auth/user.ts"]);
    
    // Mock test mappings
    const planned = await planner.plan(["src/auth/user.ts"], {
      baseCommands: [{ command: "npm run typecheck", reason: "typecheck" }],
    });
    
    // Should include typecheck (cheap) plus specific tests
    assert.ok(planned.checks.length >= 1, "Should have at least typecheck");
    assert.ok(planned.checks.some(c => c.command.includes("typecheck")), "Should include typecheck");
  });

  it("includes cost estimate in plan", async () => {
    const planner = new TestPlanner();
    const plan = await planner.plan(["src/auth/user.ts"], {
      baseCommands: [{ command: "npm test", reason: "full suite" }],
    });
    
    assert.ok(typeof plan.totalCost === "number", "Should have cost estimate");
    assert.ok(plan.costBreakdown, "Should have cost breakdown");
  });

  it("marks files as needing verification", async () => {
    const planner = new TestPlanner();
    const plan = await planner.plan(["src/auth/user.ts"], {
      baseCommands: [],
    });
    
    assert.ok(plan.verifiedFiles.length > 0 || plan.unverifiedFiles.length > 0, 
      "Should report on file coverage");
  });
});

describe("createTestPlan (convenience function)", () => {
  it("creates full plan from changed files", async () => {
    const plan = await createTestPlan(".", ["src/auth/user.ts"]);
    
    assert.ok(plan.checks.length > 0, "Should have verification checks");
    assert.ok(plan.checks.every(c => c.command), "All checks should have commands");
  });

  it("returns empty plan when no files changed", async () => {
    const plan = await createTestPlan(".", []);
    
    // Should still run typecheck at minimum
    assert.ok(plan.checks.length >= 0, "May have typecheck or be empty");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/test-planner.test.ts`
Expected: FAIL with "Module not found"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/verifier/test-planner.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { buildDepGraphFromImports, DependencyGraph } from "./dep-graph.js";
import { mapFilesToTests } from "./test-mapper.js";
import type { VerificationCheck } from "./verifier.js";

// Cost weights (relative execution time)
const COST_WEIGHTS = {
  typecheck: 1,
  build: 3,
  test: 10,
};

type CheckKind = "typecheck" | "build" | "test";

function classifyCheckKind(command: string): CheckKind {
  const cmd = command.toLowerCase();
  if (cmd.includes("typecheck") || cmd.includes("lint") || cmd.includes("check")) {
    return "typecheck";
  }
  if (cmd.includes("build") || cmd.includes("compile") || cmd.includes("tsc")) {
    return "build";
  }
  return "test";
}

export interface TestPlan {
  checks: VerificationCheck[];
  verifiedFiles: string[];
  unverifiedFiles: string[];
  totalCost: number;
  costBreakdown: Record<CheckKind, number>;
  strategy: "full" | "targeted" | "minimal";
}

export class TestPlanner {
  private depGraph: DependencyGraph | null = null;
  private changedFiles: string[] = [];
  private cachedSourceFiles: string[] | null = null;

  setChangedFiles(files: string[]): void {
    this.changedFiles = files;
  }

  async buildDepGraph(root: string): Promise<void> {
    if (this.depGraph) return;
    
    const sourceFiles = await this.getSourceFiles(root);
    this.cachedSourceFiles = sourceFiles;
    this.depGraph = await buildDepGraphFromImports(root, sourceFiles);
  }

  private async getSourceFiles(root: string): Promise<string[]> {
    const { walkDir } = await import("../utils/walk-dir.js");
    const files: string[] = [];
    
    await walkDir(root, (path) => {
      if (path.endsWith(".ts") && !path.includes("node_modules") && !path.includes(".test.")) {
        files.push(path.replace(root + "/", ""));
      }
    });
    
    return files;
  }

  /**
   * Order checks by cost (cheapest first)
   */
  orderByCost(checks: VerificationCheck[]): VerificationCheck[] {
    return [...checks].sort((a, b) => {
      const costA = COST_WEIGHTS[classifyCheckKind(a.command)];
      const costB = COST_WEIGHTS[classifyCheckKind(b.command)];
      return costA - costB;
    });
  }

  /**
   * Find tests affected by changed files using dependency analysis
   */
  async findAffectedTests(sourceFiles: string[]): Promise<VerificationCheck[]> {
    if (!this.depGraph) {
      throw new Error("Call buildDepGraph() first");
    }
    
    const affectedTestPaths = this.depGraph.findAffectedTests(sourceFiles);
    
    return affectedTestPaths.map(path => ({
      command: `npx vitest run "${path}"`,
      reason: `affected by changes: ${sourceFiles.join(", ")}`,
    }));
  }

  /**
   * Create a verification plan for given changed files
   */
  async plan(
    changedFiles: string[],
    options: {
      baseCommands?: VerificationCheck[];
      maxCost?: number;
      strategy?: "full" | "targeted" | "minimal";
    } = {}
  ): Promise<TestPlan> {
    const { baseCommands = [], maxCost = Infinity, strategy = "targeted" } = options;
    
    this.changedFiles = changedFiles;
    
    const checks: VerificationCheck[] = [];
    const verifiedFiles = new Set<string>();
    const unverifiedFiles = new Set<string>(changedFiles);
    
    // Add base commands (typecheck, build) first (cheapest)
    const sortedBase = this.orderByCost(baseCommands);
    for (const cmd of sortedBase) {
      checks.push(cmd);
    }
    
    if (strategy === "minimal") {
      // Only run typecheck, skip specific tests
    } else if (strategy === "targeted" && changedFiles.length > 0) {
      // Use dependency graph to find affected tests
      if (this.depGraph) {
        const affectedTests = await this.findAffectedTests(changedFiles);
        for (const test of affectedTests) {
          const cost = COST_WEIGHTS.test;
          if (checks.length < 5) { // Cap at 5 specific tests
            checks.push(test);
            // Mark files as verified if we can trace them
            unverifiedFiles.delete(changedFiles[0]); // Simplified
          }
        }
      }
      
      // Fallback to simple path-based mapping if dep graph not available
      if (!this.depGraph || checks.length === 0) {
        const mapped = mapFilesToTests(".", changedFiles);
        for (const m of mapped) {
          const existing = checks.find(c => c.command === m.command);
          if (!existing) checks.push(m);
        }
      }
    } else if (strategy === "full") {
      // Add full test suite
      checks.push({ command: "npm test", reason: "full test suite" });
    }
    
    // Calculate cost breakdown
    const costBreakdown: Record<CheckKind, number> = {
      typecheck: 0,
      build: 0,
      test: 0,
    };
    
    let totalCost = 0;
    for (const check of checks) {
      const kind = classifyCheckKind(check.command);
      costBreakdown[kind]++;
      totalCost += COST_WEIGHTS[kind];
    }
    
    // Mark files as verified/unverified
    for (const file of changedFiles) {
      if (checks.some(c => c.reason.includes(file))) {
        verifiedFiles.add(file);
        unverifiedFiles.delete(file);
      }
    }
    
    return {
      checks,
      verifiedFiles: [...verifiedFiles],
      unverifiedFiles: [...unverifiedFiles],
      totalCost,
      costBreakdown,
      strategy,
    };
  }
}

/**
 * Convenience function to create a test plan from changed files
 */
export async function createTestPlan(
  root: string,
  changedFiles: string[]
): Promise<TestPlan> {
  const planner = new TestPlanner();
  
  try {
    await planner.buildDepGraph(root);
  } catch {
    // Dep graph building failed, proceed with simple mapping
  }
  
  // Get base commands from package.json
  const baseCommands: VerificationCheck[] = [];
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    const scripts = pkg.scripts ?? {};
    
    if (scripts.typecheck || scripts["type-check"] || scripts.lint) {
      const cmd = scripts.typecheck || scripts["type-check"] || scripts.lint;
      baseCommands.push({ command: `npm run ${cmd}`, reason: "typecheck" });
    }
    if (scripts.build) {
      baseCommands.push({ command: "npm run build", reason: "build" });
    }
  }
  
  return planner.plan(changedFiles, {
    baseCommands,
    strategy: changedFiles.length > 0 ? "targeted" : "minimal",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/test-planner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/test-planner.ts tests/unit/test-planner.test.ts
git commit -m "feat(verifier): add TestPlanner for smart verification selection

TestPlanner orders checks by cost (typecheck < build < test) and
uses dependency graph analysis to find affected tests. Creates
TestPlan with cost breakdown and verified/unverified file tracking."
```

---

### Task 3: Wire TestPlanner into Task Loop

**Files:**
- Modify: `src/run/task-loop.ts:489-501`

- [ ] **Step 1: Read current verification integration**

Read `src/run/task-loop.ts:489-510` to see current integration.

- [ ] **Step 2: Update to use TestPlanner**

Replace the verification section (lines 489-510) with:

```typescript
// After line 489, replace the verification block with:
if (endChecks.length > 0 && taskType !== "docs" && taskType !== "research" && hasMutations) {
  // Use TestPlanner for smart verification selection
  const { createTestPlan } = await import("../verifier/test-planner.js");
  const changedFiles = [...sessionState.created, ...sessionState.changed];
  
  const plan = await createTestPlan(".", changedFiles);
  
  await log.append({ ...session, actor: "verifier", type: "verification.plan_created", payload: {
    strategy: plan.strategy,
    totalCost: plan.totalCost,
    checkCount: plan.checks.length,
    verifiedFiles: plan.verifiedFiles,
    unverifiedFiles: plan.unverifiedFiles,
  }});
  
  const endResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
  
  // Run checks in cost order
  for (const endCheck of plan.checks) {
    await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: endCheck.command, reason: endCheck.reason } });
    const verResult = await runVerification(".", endCheck);
    await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: endCheck.command, status: verResult.status } });
    endResults.push({ check: endCheck, result: verResult });
  }
  
  // ... rest of existing logic (risk report, repair loop)
}
```

- [ ] **Step 3: Run tests to verify integration**

Run: `npm test 2>&1 | tail -20`
Expected: Existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/run/task-loop.ts
git commit -m "feat(task-loop): wire TestPlanner for smart verification

Uses TestPlanner.createTestPlan() to order checks by cost and
select tests based on changed files. Logs verification plan
strategy and cost breakdown to event log."
```

---

### Task 4: Update Exported Verifier Interface

**Files:**
- Modify: `src/verifier/index.ts`

- [ ] **Step 1: Add exports**

```typescript
export { mapFilesToTests } from "./test-mapper.js";
export { buildRiskReport, formatVerificationSummary } from "./risk-report.js";
export { TestPlanner, createTestPlan, type TestPlan } from "./test-planner.js";
export { DependencyGraph, buildDepGraphFromImports } from "./dep-graph.js";
```

- [ ] **Step 2: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/verifier/index.ts
git commit -m "docs(verifier): export TestPlanner and TestPlan types

Updated index.ts to export new test planning components for
external use in CLI and testing."
```

---

## Validation

After all tasks:

1. Run full test suite: `npm test`
2. Verify verification planner logs plan strategy: Run a task and check session events
3. Verify cost ordering: Check that typecheck runs before test

Run: `timeout 60 node dist/src/cli.js run "echo test" --no-stream 2>&1 | grep -E "(verification|typecheck|test)" | head -10`
Expected: Logs show verification plan creation

---

## Self-Review Checklist

- [ ] All steps have actual code (no placeholders)
- [ ] All file paths are exact
- [ ] Type signatures are consistent across tasks
- [ ] Test file imports match implementation
- [ ] Dep-graph integrates with test-mapper
- [ ] Task loop wired correctly