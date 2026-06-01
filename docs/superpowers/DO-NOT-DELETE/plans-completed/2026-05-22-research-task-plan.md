# Research Task Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `research` task type to ALiX for non-coding prompts that need web search, with depth detection (quick/deep) from prompt heuristics.

**Architecture:** Extend task classifier with research patterns + depth detection. Add researcher tool policy with MCP search access. Modify task loop to skip verification and set research-specific limits.

**Tech Stack:** TypeScript, ALiX config system, MCP tools, existing task loop infrastructure

---

## Task 1: Extend TaskClassifier with Research Type

**Files:**
- Modify: `src/task-classifier.ts`
- Test: `tests/unit/task-classifier.test.ts` (create if missing)

- [ ] **Step 1: Add RESEARCH_PATTERNS constant**

```typescript
const RESEARCH_PATTERNS = [
  /\bresearch\b/i,
  /\bstudy\b/i,
  /\binvestigate\b/i,
  /\banalyze\b/i,
  /\bfind all\b/i,
  /\bsearch for\b/i,
  /\blook up\b/i,
  /\blook into\b/i,
  /\bcompare\b/i,
  /\bevaluate\b/i,
  /\bassess\b/i,
  /\breview\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bexplain\b/i,
  /\bunderstand\b/i,
  /\bbest practices\b/i,
  /\brecommended\b/i,
  /\bguidelines\b/i,
];
```

- [ ] **Step 2: Add depth detection function**

```typescript
const DEEP_RESEARCH_SIGNALS = [
  /\bdeep\s+research\b/i,
  /\b(analyze|compare|evaluate|assess)\b/i,
  /\b(comprehensive|thorough|detailed)\b/i,
  /\barchitecture\b/i,
  /\bstrategy\b/i,
  /\bpatterns?\b/i,
];

export function detectResearchDepth(prompt: string): "quick" | "deep" {
  return DEEP_RESEARCH_SIGNALS.some((r) => r.test(prompt)) ? "deep" : "quick";
}
```

- [ ] **Step 3: Add ResearchDepth to exports**

```typescript
export type TaskType = "bugfix" | "feature" | "refactor" | "docs" | "research" | "unknown";
export type ResearchDepth = "quick" | "deep";
export type ClassifiedTask = { type: TaskType; depth: ResearchDepth; confidence: "high" | "medium" | "low" };

export function classifyTask(prompt: string): TaskType {
  if (BUGFIX_PATTERNS.some((p) => p.test(prompt))) return "bugfix";
  if (FEATURE_PATTERNS.some((p) => p.test(prompt))) return "feature";
  if (REFACTOR_PATTERNS.some((p) => p.test(prompt))) return "refactor";
  if (DOCS_PATTERNS.some((p) => p.test(prompt))) return "docs";
  if (RESEARCH_PATTERNS.some((p) => p.test(prompt))) return "research";
  return "unknown";
}
```

- [ ] **Step 4: Write tests**

```typescript
import { describe, it, expect } from "vitest";
import { classifyTask, detectResearchDepth } from "../../src/task-classifier.js";

describe("classifyTask", () => {
  it("returns research for research patterns", () => {
    expect(classifyTask("research auth tokens")).toBe("research");
    expect(classifyTask("investigate memory leak")).toBe("research");
    expect(classifyTask("analyze database schema")).toBe("research");
  });

  it("returns research for search patterns", () => {
    expect(classifyTask("search for all JWT usages")).toBe("research");
    expect(classifyTask("find all places using cache")).toBe("research");
  });

  it("returns research for analyze patterns", () => {
    expect(classifyTask("compare auth strategies")).toBe("research");
    expect(classifyTask("evaluate caching approaches")).toBe("research");
  });
});

describe("detectResearchDepth", () => {
  it("detects deep research", () => {
    expect(detectResearchDepth("deep research on auth")).toBe("deep");
    expect(detectResearchDepth("analyze auth architecture")).toBe("deep");
    expect(detectResearchDepth("compare microservices strategies")).toBe("deep");
  });

  it("defaults to quick", () => {
    expect(detectResearchDepth("research auth tokens")).toBe("quick");
    expect(detectResearchDepth("find all JWT usages")).toBe("quick");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/task-classifier.test.ts --config vitest.config.mts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/task-classifier.ts tests/unit/task-classifier.test.ts
git commit -m "feat(classifier): add research task type with depth detection"
```

---

## Task 2: Add Research Finding Types to Schema

**Files:**
- Modify: `src/config/schema.ts`
- Test: `tests/unit/research-finding-types.test.ts` (create)

- [ ] **Step 1: Add research finding types after SubagentFinding**

```typescript
export type WebSourceFinding = {
  type: "web_source";
  content: string;
  url: string;
  title: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];
};

export type SynthesisFinding = {
  type: "synthesis";
  content: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
};

export type ResearchFinding = WebSourceFinding | SynthesisFinding;
```

- [ ] **Step 2: Update SubagentFinding union to include research types**

```typescript
export type SubagentFinding = {
  type: "file_ref" | "code_location" | "summary" | "risk_flag" | "web_source" | "synthesis";
  content: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];
};
```

- [ ] **Step 3: Write tests**

```typescript
import { describe, it, expect } from "vitest";

describe("ResearchFinding types", () => {
  it("WebSourceFinding has required fields", () => {
    const finding = {
      type: "web_source" as const,
      content: "OAuth 2.0 best practices",
      url: "https://auth.example.com/guide",
      title: "OAuth 2.0 Best Practices",
      confidence: "high" as const,
    };
    expect(finding.type).toBe("web_source");
    expect(finding.url).toBeDefined();
  });

  it("SynthesisFinding has required fields", () => {
    const finding = {
      type: "synthesis" as const,
      content: "Auth should use OAuth 2.0 with PKCE",
      sources: ["https://auth.example.com", "src/auth/oauth.ts"],
      confidence: "high" as const,
    };
    expect(finding.type).toBe("synthesis");
    expect(finding.sources).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/research-finding-types.test.ts --config vitest.config.mts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts tests/unit/research-finding-types.test.ts
git commit -m "feat(schema): add research finding types (web_source, synthesis)"
```

---

## Task 3: Add Researcher Tool Policy

**Files:**
- Modify: `src/subagents/tool-policy.ts`
- Test: Add tests to existing tool-policy test file

- [ ] **Step 1: Add researcher role case to getToolPolicy**

```typescript
case "researcher":
  return {
    allow: ["file.read", "git.diff", "git.log", "shell.run"],
    allowMcp: true,
    deny: ["file.write", "git.push", "shell.exec"],
    requireApproval: [],
  };
```

- [ ] **Step 2: Add RESEARCHER role to SubagentRole in schema**

```typescript
export type SubagentRole = "auto" | "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker" | "researcher";
```

- [ ] **Step 3: Update filterTools to allow MCP for researcher**

Find the filterTools function and ensure it allows MCP tools for researcher role:

```typescript
if (role === "researcher") {
  // Allow MCP tools for web search
  return tools.filter((t) => t.source === "mcp" || t.name === "alix_done");
}
```

- [ ] **Step 4: Run existing tests**

Run: `node --test dist/tests/subagents/tool-policy.test.js`
Expected: PASS (existing tests still work)

- [ ] **Step 5: Commit**

```bash
git add src/subagents/tool-policy.ts src/config/schema.ts
git commit -m "feat(tool-policy): add researcher role with MCP search access"
```

---

## Task 4: Add Research Limits to TaskLoop

**Files:**
- Modify: `src/run/task-loop.ts`
- Test: Add research exit condition tests

- [ ] **Step 1: Add research limits constant**

```typescript
const RESEARCH_LIMITS = {
  quick: { maxIterations: 3, maxSearchCalls: 3 },
  deep: { maxIterations: 15, maxSearchCalls: 10 },
} as const;
```

- [ ] **Step 2: Update shouldExitLoop for research type**

In the shouldExitLoop function, add research handling:

```typescript
if (taskType === "research") {
  const depth = detectResearchDepth(task); // Pass depth from outer scope
  const limits = RESEARCH_LIMITS[depth];
  if (state.searchCalls >= limits.maxSearchCalls) return "max_search_calls";
  if (state.iterations >= limits.maxIterations) return "max_iterations";
}
```

- [ ] **Step 3: Add search call counter to loop state**

Track search calls in the loop state:

```typescript
type LoopState = {
  // ... existing fields
  searchCalls?: number;
};
```

- [ ] **Step 4: Skip verification for research type**

Find the verification section and add early return for research:

```typescript
// Skip verification for docs and research tasks
if (taskType === "docs" || taskType === "research") {
  // Research completes when model signals done
  if (modelSaysDone(state)) {
    return { reason: "completed" as const };
  }
  return { reason: "verification_skipped" as const };
}
```

- [ ] **Step 5: Run existing tests**

Run: `node --test dist/tests/run/task-loop.test.js`
Expected: PASS (existing tests still work)

- [ ] **Step 6: Commit**

```bash
git add src/run/task-loop.ts
git commit -m "feat(task-loop): add research exit conditions and limits"
```

---

## Task 5: Update ContextCompiler for Research Bias

**Files:**
- Modify: `src/repomap/context-ranker.ts`
- Modify: `src/repomap/context-pipeline.ts`
- Test: Add research context tests

- [ ] **Step 1: Update ranking weights for research type**

In context-ranker.ts, add research bias:

```typescript
if (taskType === "research") {
  // Bias toward docs and architecture files
  if (isDocFile(path)) score += 20;
  if (isArchitectureFile(path)) score += 15;
  // Lower score for test files (less relevant for research)
  if (isTestFile(path)) score -= 10;
}
```

- [ ] **Step 2: Add isDocFile and isArchitectureFile helpers**

```typescript
function isDocFile(path: string): boolean {
  return /\.(md|txt|rst)$/.test(path) || /readme|changelog|docs?/i.test(path);
}

function isArchitectureFile(path: string): boolean {
  return /architecture|design|overview|adr/i.test(path) || /CONTEXT\.md$/.test(path);
}
```

- [ ] **Step 3: Update BudgetingStage for research**

In context-pipeline.ts, adjust budget allocation for research:

```typescript
if (bundle.taskType === "research") {
  // Research needs more doc coverage, less code
  budget.primaryWeight = 0.4;    // Less code
  budget.supportingWeight = 0.4;  // More docs
  budget.testsWeight = 0.1;       // Fewer tests
}
```

- [ ] **Step 4: Run existing tests**

Run: `node --test dist/tests/repomap/context-ranker.test.js dist/tests/repomap/context-pipeline.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-ranker.ts src/repomap/context-pipeline.ts
git commit -m "feat(context): bias ranking toward docs for research tasks"
```

---

## Task 6: Update run.ts to Wire Research Type

**Files:**
- Modify: `src/run.ts`
- Test: Update autonomous loop tests

- [ ] **Step 1: Import classifyTask result with depth**

Find where classifyTask is called and update:

```typescript
const taskType = classifyTask(task);
const researchDepth = taskType === "research" ? detectResearchDepth(task) : undefined;
```

- [ ] **Step 2: Pass depth to TaskLoopDeps**

Update TaskLoopDeps interface to include researchDepth:

```typescript
type TaskLoopDeps = {
  // ... existing fields
  researchDepth?: "quick" | "deep";
};
```

- [ ] **Step 3: Update autonomous loop tests**

In the test file, add research task type test:

```typescript
it("research task skips verification", () => {
  const taskType = "research";
  const state = { iterations: 1, toolCalls: [] };
  const shouldExit = shouldExitLoop(taskType, state, "research auth tokens");
  expect(shouldExit.reason).toBe("verification_skipped");
});
```

- [ ] **Step 4: Run tests**

Run: `node --test dist/tests/run/autonomous-loop.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/run.ts
git commit -m "feat(run): wire research task type and depth into task loop"
```

---

## Task 7: Add CLI Research Command (Optional)

**Files:**
- Create: `src/cli/commands/research.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create research command handler**

```typescript
import type { CommandHandler } from "./types.js";

export const researchCommand: CommandHandler = async (args, config) => {
  const query = args._[0];
  if (!query) {
    console.error("Usage: alix research <query>");
    process.exit(1);
  }

  // Set research task type
  const task = `research ${query}`;

  // Run with research settings
  await runTask(task, { taskType: "research", depth: detectResearchDepth(task) });
};
```

- [ ] **Step 2: Wire into CLI index**

```typescript
case "research":
  return researchCommand(args, config);
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/research.ts src/cli/index.ts
git commit -m "feat(cli): add research command"
```

---

## Verification

After all tasks, run:
```bash
npm run test:node
npx vitest run tests/unit/task-classifier.test.ts tests/unit/research-finding-types.test.ts --config vitest.config.mts
```

All tests should pass. Model tiers should still work (verified earlier).

---

## Files Summary

| Task | Files | Lines |
|------|-------|-------|
| 1 | task-classifier.ts + test | ~40 new |
| 2 | schema.ts + test | ~25 new |
| 3 | tool-policy.ts + schema.ts | ~15 new |
| 4 | task-loop.ts | ~20 new |
| 5 | context-ranker.ts + context-pipeline.ts | ~30 new |
| 6 | run.ts | ~15 new |
| 7 | research.ts + index.ts (optional) | ~30 new |