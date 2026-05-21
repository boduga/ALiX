# Orchestrator Auto-Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Fabric-style pattern chain to distill vague user prompts into structured ALiX plans.

**Architecture:** Pattern files as markdown prompts + TypeScript pattern runner. Patterns apply in sequence: distill_intent → extract_constraints → identify_context → build_plan. Each pattern outputs JSON, next pattern consumes it.

**Tech Stack:** TypeScript, existing LLM client, fs module for pattern loading.

---

### Task 1: Create Auto-Refine Type Definitions

**Files:**
- Create: `src/types/auto-refine.ts`
- Test: `tests/orchestrator/auto-refine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type {
  DistilledIntent,
  ExtractedConstraints,
  ContextNeeds,
  AlixPlan,
  RefinedPlan,
} from "../../src/types/auto-refine.js";

describe("AutoRefine types", () => {
  it("DistilledIntent has correct shape", () => {
    const intent: DistilledIntent = {
      intent: "Add user authentication",
      type: "feature",
      successSignal: "Users can log in and out",
    };
    expect(intent.intent).toBeTruthy();
    expect(["feature", "bugfix", "refactor", "research", "question"]).toContain(intent.type);
  });

  it("RefinedPlan has all stages", () => {
    const plan: RefinedPlan = {
      intent: { intent: "test", type: "feature", successSignal: "test" },
      constraints: { hardConstraints: [], softConstraints: [], forbidden: [], preferences: {} },
      context: { requiredContext: { files: [], patterns: [], searchQueries: [] }, optionalContext: { files: [], searchQueries: [] }, contextSummary: "" },
      plan: { title: "", intent: "", type: "feature", stages: [], acceptanceCriteria: [], riskLevel: "low", estimatedComplexity: "simple" },
    };
    expect(plan.intent).toBeDefined();
    expect(plan.constraints).toBeDefined();
    expect(plan.context).toBeDefined();
    expect(plan.plan).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --grep "AutoRefine types" 2>&1 | tail -10`
Expected: FAIL with "Cannot find module" or "type not found"

- [ ] **Step 3: Write the type definitions**

```typescript
// src/types/auto-refine.ts

export type IntentType = "feature" | "bugfix" | "refactor" | "research" | "question";

export interface DistilledIntent {
  intent: string; // Core intent (<15 words, imperative)
  type: IntentType;
  successSignal: string; // How to know when done
}

export interface ExtractedConstraints {
  hardConstraints: string[]; // Must be satisfied
  softConstraints: string[]; // Preferences
  forbidden: string[]; // Explicitly prohibited
  preferences: {
    style?: string;
    techStack?: string[];
    outputFormat?: string;
  };
}

export interface ContextItem {
  files: string[];
  patterns: string[];
  searchQueries: string[];
}

export interface ContextNeeds {
  requiredContext: ContextItem;
  optionalContext: ContextItem;
  contextSummary: string; // 2 sentences
}

export interface PlanStage {
  name: string;
  description: string;
  tools?: string[];
  input?: string[];
  output: string;
}

export interface AlixPlan {
  title: string;
  intent: string;
  type: IntentType;
  stages: PlanStage[];
  acceptanceCriteria: string[];
  riskLevel: "low" | "medium" | "high";
  estimatedComplexity: "simple" | "moderate" | "complex";
}

export interface RefinedPlan {
  intent: DistilledIntent;
  constraints: ExtractedConstraints;
  context: ContextNeeds;
  plan: AlixPlan;
  gaps?: string[]; // Missing information
}

export interface PatternVariables {
  prompt?: string;
  intent?: string;
  raw_prompt?: string;
  constraints?: ExtractedConstraints;
  project_type?: string;
  context_needs?: ContextNeeds;
}

export interface Strategy {
  name: string;
  description: string;
  modification: string; // How to modify the system prompt
  temperature: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --grep "AutoRefine types" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/auto-refine.ts tests/orchestrator/auto-refine.test.ts
git commit -m "feat(orchestrator): add auto-refine type definitions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Create Pattern Files (Markdown Prompts)

**Files:**
- Create: `src/config/patterns/distill_intent/system.md`
- Create: `src/config/patterns/extract_constraints/system.md`
- Create: `src/config/patterns/identify_context/system.md`
- Create: `src/config/patterns/build_plan/system.md`
- Test: `tests/orchestrator/patterns.test.ts`

- [ ] **Step 1: Create distill_intent pattern**

Create: `src/config/patterns/distill_intent/system.md`

```markdown
# Instruction

You are an intent distillation engine. Given a vague user prompt, extract the core intent.

## Format

Output ONLY a JSON object, no additional text:
```json
{
  "intent": "What the user actually wants (imperative, <15 words)",
  "type": "feature|bugfix|refactor|research|question",
  "success_signal": "How to know when done (<=3 sentences)"
}
```

## Process

1. Identify the action verb (create, fix, add, remove, optimize, compare)
2. Identify the subject (what is being acted upon)
3. Identify the desired outcome
4. Classify the type
5. Define success signal

## Examples

Input: "make the login faster"
Output: {"intent": "Optimize login performance", "type": "feature", "success_signal": "Login completes in under 500ms for all users."}

Input: "fix the bug where things crash"
Output: {"intent": "Fix application crash on startup", "type": "bugfix", "success_signal": "Application starts without errors and remains stable."}

Input: "{{prompt}}"
```

- [ ] **Step 2: Create extract_constraints pattern**

Create: `src/config/patterns/extract_constraints/system.md`

```markdown
# Instruction

You are a constraint extraction engine. Given an intent, identify all constraints and preferences.

## Format

Output ONLY a JSON object, no additional text:
```json
{
  "hard_constraints": ["Must be satisfied or the output fails"],
  "soft_constraints": ["Preferences that improve quality"],
  "forbidden": ["Explicitly prohibited approaches or outcomes"],
  "preferences": {
    "style": "e.g., functional, declarative, verbose",
    "tech_stack": ["constraints on language/framework/lib versions"],
    "output_format": "e.g., json, markdown, code only"
  }
}
```

## Process

1. Look for constraint keywords: "must", "only", "never", "always", "except"
2. Identify performance requirements: "fast", "<100ms", "scalable"
3. Identify style preferences: "clean", "readable", "minimal"
4. Identify forbidden patterns: "don't use X", "avoid Y"

## Examples

Input: "Add caching with Redis, must be under 10ms, don't use memcached"
Output: {"hard_constraints": ["Response time under 10ms"], "soft_constraints": [], "forbidden": ["memcached"], "preferences": {"style": "clean", "tech_stack": ["Redis"], "output_format": "code"}}

Intent: "{{intent}}"
Raw prompt: "{{raw_prompt}}"
```

- [ ] **Step 3: Create identify_context pattern**

Create: `src/config/patterns/identify_context/system.md`

```markdown
# Instruction

You are a context planner. Given an intent and constraints, identify what context is needed.

## Format

Output ONLY a JSON object, no additional text:
```json
{
  "required_context": {
    "files": ["specific files the agent must read"],
    "patterns": ["file patterns to scan, e.g., 'src/**/*.ts'"],
    "search_queries": ["code search terms to understand structure"]
  },
  "optional_context": {
    "files": ["helpful but not critical"],
    "search_queries": ["would improve quality"]
  },
  "context_summary": "What the agent needs to understand (2 sentences)"
}
```

## Process

1. Identify files mentioned in intent
2. Identify file patterns needed (src/**/*.ts, tests/**/*.py)
3. Identify code patterns to search for (e.g., "authentication middleware", "database models")
4. Determine read vs. modify vs. create needs

## Examples

Intent: "Add user authentication"
Output: {"required_context": {"files": ["src/app.ts", "src/routes/"], "patterns": ["src/**/*.ts", "tests/**/*.ts"], "search_queries": ["authentication", "session", "jwt"]}, "optional_context": {"files": [], "search_queries": ["auth middleware examples"]}, "context_summary": "Need to understand current app structure and authentication patterns."}

Intent: {{intent}}
Constraints: {{constraints}}
Project type: {{project_type}}
```

- [ ] **Step 4: Create build_plan pattern**

Create: `src/config/patterns/build_plan/system.md`

```markdown
# Instruction

You are a project planner. Convert a distilled intent into a structured ALiX plan.

## Format

Output ONLY a JSON object, no additional text:
```json
{
  "title": "Brief title",
  "intent": "The distilled intent",
  "type": "feature|bugfix|refactor|research",
  "stages": [
    {"name": "explore", "description": "Understand the current state", "tools": ["grep", "read"], "output": "Current state summary"},
    {"name": "plan", "description": "Design the approach", "input": ["explore output"], "output": "Design document"},
    {"name": "implement", "description": "Write the code", "input": ["plan output"], "output": "Modified files list"},
    {"name": "verify", "description": "Test the changes", "input": ["implement output"], "output": "Test results"}
  ],
  "acceptance_criteria": ["Concrete criterion 1", "Concrete criterion 2"],
  "risk_level": "low|medium|high",
  "estimated_complexity": "simple|moderate|complex"
}
```

## Rules

- Simple tasks (1-2 files): 2-3 stages (explore → implement → verify)
- Medium tasks (3-10 files): 3-4 stages (add plan stage)
- Complex tasks (10+ files): 4-5 stages (add review stage)
- risk_level: low (1-2 files), medium (3-10 files or refactor), high (10+ files or multiple systems)

## Examples

Intent: "Add user authentication"
Output: {"title": "Add user authentication", "intent": "Add user authentication", "type": "feature", "stages": [{"name": "explore", "description": "Understand current auth patterns", "tools": ["grep", "read"], "output": "Auth patterns summary"}, {"name": "plan", "description": "Design authentication approach", "input": ["explore output"], "output": "Auth design"}, {"name": "implement", "description": "Implement auth system", "input": ["plan output"], "output": "Modified files"}, {"name": "verify", "description": "Test authentication", "input": ["implement output"], "output": "Test results"}], "acceptance_criteria": ["Users can register", "Users can login", "Protected routes require auth"], "risk_level": "medium", "estimated_complexity": "moderate"}

Intent: {{intent}}
Constraints: {{constraints}}
Context needs: {{context_needs}}
```

- [ ] **Step 5: Write test for pattern loading**

```typescript
// tests/orchestrator/patterns.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

describe("Pattern files", () => {
  const patternsDir = join(process.cwd(), "src/config/patterns");

  it("all expected pattern directories exist", async () => {
    const patterns = ["distill_intent", "extract_constraints", "identify_context", "build_plan"];
    for (const pattern of patterns) {
      const dir = join(patternsDir, pattern);
      const files = await readdir(dir);
      expect(files).toContain("system.md");
    }
  });

  it("each pattern has valid JSON output structure", async () => {
    const patterns = ["distill_intent", "extract_constraints", "identify_context", "build_plan"];
    for (const pattern of patterns) {
      const patternPath = join(patternsDir, pattern, "system.md");
      const content = await readFile(patternPath, "utf8");
      // Pattern should have {{variable}} placeholders
      expect(content).toMatch(/\{\{.*\}\}/);
    }
  });
});
```

- [ ] **Step 6: Run test to verify patterns exist**

Run: `npm run test:node -- --grep "Pattern files" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/patterns/ tests/orchestrator/patterns.test.ts
git commit -m "feat(orchestrator): add Fabric-style pattern files

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Implement Pattern Runner

**Files:**
- Create: `src/orchestrator/pattern-runner.ts`
- Modify: `src/config/defaults.ts` (add patternsDir)
- Test: `tests/orchestrator/pattern-runner.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/orchestrator/pattern-runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { applyPattern } from "../../src/orchestrator/pattern-runner.js";

describe("PatternRunner", () => {
  it("loads and applies distill_intent pattern", async () => {
    const result = await applyPattern("distill_intent", {
      prompt: "add user authentication",
    });
    expect(result).toHaveProperty("intent");
    expect(result).toHaveProperty("type");
    expect(["feature", "bugfix", "refactor", "research", "question"]).toContain(result.type);
  });

  it("throws on missing pattern", async () => {
    await expect(applyPattern("nonexistent_pattern", {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --grep "PatternRunner" 2>&1 | tail -10`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the pattern runner**

```typescript
// src/orchestrator/pattern-runner.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { PatternVariables, Strategy } from "../types/auto-refine.js";

export interface PatternRunnerDeps {
  callLLM?: (options: { system: string; user: string; temperature?: number }) => Promise<string>;
  patternsDir?: string;
}

const DEFAULT_DEPS: Required<PatternRunnerDeps> = {
  callLLM: async ({ system, user }) => {
    // This will be replaced with actual LLM call in integration
    throw new Error("LLM not configured - callLLM must be provided");
  },
  patternsDir: join(DEFAULT_CONFIG.configDir, "patterns"),
};

/**
 * Substitute {{variable}} placeholders with actual values
 */
function substituteVariables(
  template: string,
  variables: PatternVariables
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    result = result.split(placeholder).join(stringValue);
  }
  return result;
}

/**
 * Load a pattern file by name
 */
export async function loadPattern(
  patternName: string,
  patternsDir: string
): Promise<string> {
  const patternPath = join(patternsDir, patternName, "system.md");
  return readFile(patternPath, "utf8");
}

/**
 * Parse JSON from LLM response, handling common failures
 */
function parseJsonResponse(response: string): any {
  // Try direct parse first
  try {
    return JSON.parse(response);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Fall through to regex extraction
      }
    }

    // Regex extraction for key fields
    const result: Record<string, any> = {};

    // Try to extract intent field
    const intentMatch = response.match(/"intent"\s*:\s*"([^"]+)"/);
    if (intentMatch) result.intent = intentMatch[1];

    // Try to extract type field
    const typeMatch = response.match(/"type"\s*:\s*"([^"]+)"/);
    if (typeMatch) result.type = typeMatch[1];

    // If we found at least intent, return partial result
    if (result.intent) {
      return result;
    }

    // Last resort: throw the original response
    throw new Error(`Failed to parse JSON from response: ${response.slice(0, 200)}...`);
  }
}

/**
 * Apply a pattern to extract structured information
 */
export async function applyPattern<T = any>(
  patternName: string,
  variables: PatternVariables,
  deps: PatternRunnerDeps = {}
): Promise<T> {
  const { callLLM, patternsDir } = { ...DEFAULT_DEPS, ...deps };

  // 1. Load pattern file
  const pattern = await loadPattern(patternName, patternsDir);

  // 2. Substitute variables
  const prompt = substituteVariables(pattern, variables);

  // 3. Call LLM with pattern as system prompt
  const response = await callLLM({
    system: pattern,
    user: prompt,
  });

  // 4. Parse JSON response
  return parseJsonResponse(response) as T;
}

/**
 * Apply a pattern with a specific strategy
 */
export async function applyPatternWithStrategy<T = any>(
  patternName: string,
  variables: PatternVariables,
  strategy: Strategy,
  deps: PatternRunnerDeps = {}
): Promise<T> {
  const pattern = await loadPattern(
    deps.patternsDir ?? DEFAULT_DEPS.patternsDir,
    patternName
  );

  // Apply strategy modification to system prompt
  const modifiedSystem = `${pattern.trim()}\n\n# Strategy\n${strategy.modification}`;

  const { callLLM } = { ...DEFAULT_DEPS, ...deps };

  const prompt = substituteVariables(pattern, variables);
  const response = await callLLM({
    system: modifiedSystem,
    user: prompt,
    temperature: strategy.temperature,
  });

  return parseJsonResponse(response) as T;
}
```

- [ ] **Step 4: Update defaults.ts to include patternsDir**

```typescript
// src/config/defaults.ts (add to exports)
export const DEFAULT_CONFIG_DIR = join(process.env.HOME ?? "", ".config", "alix");
```

Add to existing config:
```typescript
configDir: DEFAULT_CONFIG_DIR,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:node -- --grep "PatternRunner" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/pattern-runner.ts src/config/defaults.ts tests/orchestrator/pattern-runner.test.ts
git commit -m "feat(orchestrator): implement pattern runner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Implement Strategy Manager

**Files:**
- Create: `src/orchestrator/strategies.ts`
- Create: `src/config/strategies/cot.json`
- Create: `src/config/strategies/self-refine.json`
- Create: `src/config/strategies/reflexion.json`
- Test: `tests/orchestrator/strategies.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/orchestrator/strategies.test.ts
import { describe, it, expect } from "vitest";
import { getStrategy, listStrategies, STRATEGIES } from "../../src/orchestrator/strategies.js";

describe("StrategyManager", () => {
  it("returns cot strategy by default", () => {
    const strategy = getStrategy("cot");
    expect(strategy.name).toBe("Chain-of-Thought");
    expect(strategy.temperature).toBe(0.3);
  });

  it("returns self-refine for quality-critical tasks", () => {
    const strategy = getStrategy("self-refine");
    expect(strategy.name).toBe("Self-Refinement");
  });

  it("lists all available strategies", () => {
    const strategies = listStrategies();
    expect(strategies).toContain("cot");
    expect(strategies).toContain("self-refine");
    expect(strategies).toContain("reflexion");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --grep "StrategyManager" 2>&1 | tail -10`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create strategy files**

Create: `src/config/strategies/cot.json`

```json
{
  "name": "Chain-of-Thought",
  "description": "Step-by-step reasoning for complex tasks",
  "modification": "Think step by step. Break down the problem into smaller components before answering.",
  "temperature": 0.3
}
```

Create: `src/config/strategies/self-refine.json`

```json
{
  "name": "Self-Refinement",
  "description": "Answer, critique, refine cycle for quality-critical outputs",
  "modification": "1. Provide initial answer\n2. Critique your answer for errors or improvements\n3. Refine and provide final answer",
  "temperature": 0.2
}
```

Create: `src/config/strategies/reflexion.json`

```json
{
  "name": "Reflexion",
  "description": "Brief review then refine, good for bug fixes",
  "modification": "1. Answer the question\n2. Briefly note any potential issues\n3. Provide corrected version if needed",
  "temperature": 0.25
}
```

- [ ] **Step 4: Write the strategy manager**

```typescript
// src/orchestrator/strategies.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Strategy } from "../types/auto-refine.js";

const STRATEGIES_DIR = join(process.cwd(), "src/config/strategies");

export const STRATEGIES = ["cot", "self-refine", "reflexion", "standard"] as const;

/**
 * Get a strategy by name
 */
export async function getStrategy(name: string): Promise<Strategy> {
  if (name === "standard") {
    return {
      name: "Standard",
      description: "Direct answer without explanation",
      modification: "",
      temperature: 0.3,
    };
  }

  const strategyPath = join(STRATEGIES_DIR, `${name}.json`);
  const content = await readFile(strategyPath, "utf8");
  return JSON.parse(content);
}

/**
 * List all available strategy names
 */
export async function listStrategies(): Promise<string[]> {
  return [...STRATEGIES];
}

/**
 * Select default strategy based on task type
 */
export function selectDefaultStrategy(
  intentType: string
): string {
  switch (intentType) {
    case "bugfix":
      return "reflexion"; // Review own work
    case "feature":
      return "cot"; // Step-by-step for new code
    case "refactor":
      return "self-refine"; // Quality critical
    case "research":
      return "cot"; // Systematic exploration
    default:
      return "cot";
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:node -- --grep "StrategyManager" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/strategies.ts src/config/strategies/*.json tests/orchestrator/strategies.test.ts
git commit -m "feat(orchestrator): implement strategy manager

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Implement Auto-Refine Orchestrator

**Files:**
- Create: `src/orchestrator/auto-refine.ts`
- Test: `tests/orchestrator/auto-refine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/orchestrator/auto-refine.test.ts
import { describe, it, expect, vi } from "vitest";
import { autoRefine } from "../../src/orchestrator/auto-refine.js";

describe("AutoRefine", () => {
  const mockCallLLM = vi.fn().mockResolvedValue(JSON.stringify({
    intent: "Add user authentication",
    type: "feature",
    success_signal: "Users can log in and out",
  }));

  it("distills a vague prompt into structured plan", async () => {
    const result = await autoRefine("add user login", {
      callLLM: mockCallLLM,
    });

    expect(result.intent).toHaveProperty("intent");
    expect(result.intent).toHaveProperty("type");
    expect(result.plan).toHaveProperty("stages");
  });

  it("returns partial results on pattern failure", async () => {
    const partialLLM = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ intent: "Add auth", type: "feature" }))
      .mockRejectedValueOnce(new Error("LLM failed"));

    const result = await autoRefine("add auth", { callLLM: partialLLM });

    // Should have intent but no plan
    expect(result.intent).toBeDefined();
    expect(result.plan).toBeUndefined();
    expect(result.gaps).toContain("plan");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:node -- --grep "AutoRefine" 2>&1 | tail -10`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the auto-refine orchestrator**

```typescript
// src/orchestrator/auto-refine.ts
import { applyPattern, applyPatternWithStrategy } from "./pattern-runner.js";
import { getStrategy, selectDefaultStrategy } from "./strategies.js";
import type {
  DistilledIntent,
  ExtractedConstraints,
  ContextNeeds,
  AlixPlan,
  RefinedPlan,
} from "../types/auto-refine.js";

export interface AutoRefineDeps {
  callLLM: (options: { system: string; user: string; temperature?: number }) => Promise<string>;
  projectType?: string;
  patternsDir?: string;
}

export interface AutoRefineOptions {
  strategy?: string;
  skipStages?: string[];
}

/**
 * Auto-refine a vague user prompt into a structured ALiX plan
 */
export async function autoRefine(
  rawPrompt: string,
  deps: AutoRefineDeps,
  options: AutoRefineOptions = {}
): Promise<RefinedPlan> {
  const result: Partial<RefinedPlan> = {};
  const gaps: string[] = [];

  // Get strategy
  const intentType = options.strategy ?? "cot";
  const strategy = await getStrategy(intentType);

  // Pattern 1: Distill intent
  try {
    const intentResult = await applyPatternWithStrategy<DistilledIntent>(
      "distill_intent",
      { prompt: rawPrompt },
      strategy,
      deps
    );
    result.intent = intentResult;
  } catch (error) {
    gaps.push("intent");
    console.error("Failed to distill intent:", error);
  }

  // Pattern 2: Extract constraints
  try {
    const constraintsResult = await applyPatternWithStrategy<ExtractedConstraints>(
      "extract_constraints",
      {
        intent: result.intent?.intent ?? rawPrompt,
        raw_prompt: rawPrompt,
      },
      strategy,
      deps
    );
    result.constraints = constraintsResult;
  } catch (error) {
    gaps.push("constraints");
    console.error("Failed to extract constraints:", error);
  }

  // Pattern 3: Identify context
  try {
    const contextResult = await applyPatternWithStrategy<ContextNeeds>(
      "identify_context",
      {
        intent: result.intent?.intent ?? "",
        constraints: result.constraints ?? { hardConstraints: [], softConstraints: [], forbidden: [], preferences: {} },
        project_type: deps.projectType ?? "Generic",
      },
      strategy,
      deps
    );
    result.context = contextResult;
  } catch (error) {
    gaps.push("context");
    console.error("Failed to identify context:", error);
  }

  // Pattern 4: Build plan
  try {
    const planResult = await applyPatternWithStrategy<AlixPlan>(
      "build_plan",
      {
        intent: result.intent?.intent ?? rawPrompt,
        constraints: result.constraints ?? { hardConstraints: [], softConstraints: [], forbidden: [], preferences: {} },
        context_needs: result.context ?? { requiredContext: { files: [], patterns: [], searchQueries: [] }, optionalContext: { files: [], searchQueries: [] }, contextSummary: "" },
      },
      strategy,
      deps
    );
    result.plan = planResult;
  } catch (error) {
    gaps.push("plan");
    console.error("Failed to build plan:", error);
  }

  // Return result with gaps if incomplete
  return {
    intent: result.intent ?? { intent: rawPrompt, type: "question", successSignal: "" },
    constraints: result.constraints ?? { hardConstraints: [], softConstraints: [], forbidden: [], preferences: {} },
    context: result.context ?? {
      requiredContext: { files: [], patterns: [], searchQueries: [] },
      optionalContext: { files: [], searchQueries: [] },
      contextSummary: "",
    },
    plan: result.plan ?? {
      title: "",
      intent: rawPrompt,
      type: result.intent?.type ?? "question",
      stages: [],
      acceptanceCriteria: [],
      riskLevel: "medium",
      estimatedComplexity: "moderate",
    },
    gaps: gaps.length > 0 ? gaps : undefined,
  };
}

/**
 * Quick distill - just intent and type, skip full plan
 */
export async function quickDistill(
  prompt: string,
  deps: AutoRefineDeps
): Promise<DistilledIntent> {
  const strategy = await getStrategy("cot");
  return applyPatternWithStrategy<DistilledIntent>(
    "distill_intent",
    { prompt },
    strategy,
    deps
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:node -- --grep "AutoRefine" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/auto-refine.ts tests/orchestrator/auto-refine.test.ts
git commit -m "feat(orchestrator): implement auto-refine orchestrator

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Integrate with Orchestrator (Wire into run.ts)

**Files:**
- Modify: `src/orchestrator/run.ts`
- Modify: `src/cli/commands/run.ts`

- [ ] **Step 1: Add auto-refine option to run command**

In `src/cli/commands/run.ts`, add to the command options:

```typescript
.option("--no-auto-refine", "Skip auto-refinement of prompt")
.option("--strategy <strategy>", "Reasoning strategy (cot, self-refine, reflexion)")
```

- [ ] **Step 2: Import and use autoRefine in orchestrator**

In `src/orchestrator/run.ts`, add:

```typescript
import { autoRefine } from "./auto-refine.js";
```

Before the agent loop, add:

```typescript
// Auto-refine prompt if enabled
if (options.autoRefine !== false) {
  const refined = await autoRefine(task, {
    callLLM: createLLMCaller(provider),
    projectType: detectProjectType(),
  });

  // Use refined plan
  if (refined.plan.stages.length > 0) {
    console.log(`\n📋 Refined plan: ${refined.plan.title}`);
    console.log(`   Risk: ${refined.plan.riskLevel} | Complexity: ${refined.plan.estimatedComplexity}`);
    console.log(`   Stages: ${refined.plan.stages.map(s => s.name).join(" → ")}`);

    if (options.verbose) {
      console.log("\n   Intent:", refined.intent.intent);
      console.log("   Constraints:", refined.constraints.hardConstraints.length, "hard,", refined.constraints.softConstraints.length, "soft");
    }

    // Store refined plan for agent to use
    sessionContext.refinedPlan = refined;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npm run test:node 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/run.ts src/cli/commands/run.ts
git commit -m "feat(orchestrator): integrate auto-refine into run command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Add Integration Test (End-to-End)

**Files:**
- Create: `tests/integration/auto-refine.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/integration/auto-refine.integration.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { autoRefine } from "../../src/orchestrator/auto-refine.js";
import { detectProvider } from "../../src/cli/commands/init.js";

describe("AutoRefine Integration", () => {
  let callLLM: (options: any) => Promise<string>;

  beforeAll(() => {
    // Use actual LLM if available, skip if not
    const provider = detectProvider();
    if (!process.env[getEnvVar(provider.provider)]) {
      console.log("Skipping integration test - no API key");
      return;
    }

    // Create LLM caller - this is project-specific
    callLLM = async ({ system, user }) => {
      // This would call the actual LLM
      throw new Error("Integration test needs actual LLM setup");
    };
  });

  it("handles a vague prompt end-to-end", async () => {
    // This test requires actual LLM integration
    // Skip if no API key available
    if (!callLLM) {
      console.log("Skipping - requires API key");
      return;
    }

    const result = await autoRefine("make the app faster", { callLLM });

    expect(result.intent.intent).toBeTruthy();
    expect(result.plan.stages.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test:node -- --grep "AutoRefine Integration" 2>&1`
Expected: PASS (or skipped if no API key)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/auto-refine.integration.test.ts
git commit -m "test(orchestrator): add auto-refine integration test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] All 4 pattern files created with correct markdown structure
- [ ] Pattern runner loads files and substitutes variables
- [ ] Strategy files created (cot, self-refine, reflexion)
- [ ] Strategy manager loads and applies strategies
- [ ] Auto-refine orchestrator chains all 4 patterns
- [ ] Error handling returns partial results with gaps
- [ ] Integration with run.ts wired (optional via flag)
- [ ] All tests pass
- [ ] Types consistent across all modules

---

### Final: Analyze and Commit

Run: `npm run build && npm run test:node 2>&1 | tail -15`

Then commit all remaining changes:

```bash
git add .
git commit -m "chore: finalize orchestrator auto-refine implementation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```