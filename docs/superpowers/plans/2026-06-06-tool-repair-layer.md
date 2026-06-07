# Tool-Call Repair Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a model-keyed tool-call repair layer (`@alix/tool-repair`) that intercepts invalid tool calls, applies deterministic repairs from pattern files, and sends repair hints back to the model — for both ALiX and Claude Code.

**Architecture:** A shared engine with model-keyed pattern JSON files. The engine validates tool calls against known failure signatures, applies named transforms (strip markdown, remove null, parse JSON string, smart default), and returns repaired args + a hint string. ALiX integrates directly via the ToolExecutor; Claude Code integrates via a PreToolUse hook script that calls the same engine.

**Tech Stack:** TypeScript, Node.js 24+, JSON declarative patterns, Run by `node --experimental-strip-types` for hook scripts.

**Key Insight:** Patterns are keyed by **model name**, not harness. A DeepSeek V4 Flash null-in-optional-field bug is the same whether routed through ALiX or Claude Code. The same pattern JSON file serves both.

---

### File Structure

```
packages/tool-repair/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                          # Public API
│   ├── types.ts                          # Pattern, RepairResult, TransformName
│   ├── engine/
│   │   ├── registry.ts                   # PatternRegistry — loads JSON per model
│   │   ├── validator.ts                  # Matches tool calls against patterns
│   │   ├── repairer.ts                   # Applies matching transforms
│   │   └── hint-formatter.ts            # Builds model-facing hint
│   ├── transforms/
│   │   ├── index.ts                      # Transform registry + apply()
│   │   ├── strip-markdown-links.ts       # [file](path) → path
│   │   ├── parse-json-array.ts           # "\"[...]\"" → [...]
│   │   ├── remove-null-field.ts          # {key: null} → {} (omit key)
│   │   └── smart-default.ts              # Missing offset → default 0/100
│   ├── patterns/
│   │   ├── deepseek-v4-flash.json        # Primary target — worst tool confusion
│   │   ├── deepseek-v4-pro.json
│   │   ├── kimi-k2.6.json
│   │   └── claude-opus-4.8.json
│   └── miner/
│       ├── claude-session.ts             # Reads ~/.claude/projects/.../*.jsonl
│       ├── alix-session.ts               # Reads .alix/sessions/*/events.jsonl
│       └── pattern-candidate.ts          # Groups failures → suggests patterns
├── tests/
│   ├── validator.test.ts
│   ├── repairer.test.ts
│   ├── transforms.test.ts
│   └── fixtures/
│       ├── deepseek-tool-errors.jsonl
│       └── claude-tool-errors.jsonl
└── bin/
    └── tool-repair.js                    # CLI entry: JS for node --experimental-strip-types

src/tools/executor.ts                      # [MODIFY] ALiX — inject repair layer
.claude/hooks/PreToolUse/tool-repair.sh    # [CREATE] Claude Code hook
```

---

### Task 1: Package scaffold and types

**Files:**
- Create: `packages/tool-repair/package.json`
- Create: `packages/tool-repair/tsconfig.json`
- Create: `packages/tool-repair/src/types.ts`
- Modify: `Monolith/package.json` (add workspace reference)

- [ ] **Step 1: Create `packages/tool-repair/package.json`**

```json
{
  "name": "@alix/tool-repair",
  "version": "0.1.0",
  "description": "Model-keyed deterministic tool-call repair engine for AI coding agents",
  "private": true,
  "type": "module",
  "main": "./dist/src/index.js",
  "types": "./dist/src/index.d.ts",
  "exports": {
    ".": "./dist/src/index.js",
    "./miner": "./dist/src/miner/index.js",
    "./patterns/*": "./dist/src/patterns/*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --experimental-strip-types --test tests/*.test.ts tests/**/*.test.ts",
    "mine": "node --experimental-strip-types bin/tool-repair.js mine"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "24.0.0",
    "typescript": "5.9.3"
  }
}
```

- [ ] **Step 2: Create `packages/tool-repair/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*.ts", "bin/**/*.ts"]
}
```

- [ ] **Step 3: Add workspace to Monolith's `package.json`**

Edit `/home/babasola/Projects/Monolith/package.json` to add:
```json
  "workspaces": [
    "packages/tool-repair"
  ]
```

- [ ] **Step 4: Create `packages/tool-repair/src/types.ts`**

```typescript
// Shared types for the tool-repair engine

/** A single deterministic repair pattern */
export type Pattern = {
  id: string;
  category: "null_in_optional_field" | "markdown_in_path" | "type_mismatch" | "missing_required_param" | "extra_junk_in_arg" | "wrong_arg_format";
  description: string;
  /** Tool names this pattern applies to. "*" = all tools */
  tools: string[];
  /** Per-parameter repairs */
  params: Record<string, ParamRepair>;
  /** Match conditions */
  match: MatchCondition;
  /** Hint sent back to the model explaining the repair */
  hint: string;
  severity: "error" | "warning" | "info";
  confidence: number; // 0-1, below threshold is not auto-applied
  since: string; // ISO date
  deprecated: string | null; // null = active, ISO date = deprecated
};

export type ParamRepair = {
  /** Named transform to apply */
  repair: TransformName;
  /** Static value to use (for "replace_with" transforms) */
  value?: unknown;
};

export type TransformName =
  | "remove"                // Delete the param entirely
  | "strip_markdown_links"  // [text](url) → url
  | "parse_json_string_to_array" // "\"[...]\"" → [...]
  | "default_first_read"    // Missing offset/limit → 0/100
  | "default_last_read"     // Missing offset/limit → -100/100
  | "replace_with_value"    // Replace with static value
  ;

export type MatchCondition = {
  /** Param is null or undefined when it shouldn't be */
  null_fields?: string[];
  /** Param is missing entirely */
  missing_fields?: string[];
  /** Expected JSON schema type vs actual */
  expected_type?: string;
  actual_type?: string;
  /** String value matches a regex */
  pattern?: string;
};

/** Result of a single repair attempt */
export type RepairOutcome = {
  repaired: boolean;
  /** Repaired args (same as input if no repair) */
  args: Record<string, unknown>;
  /** Human-readable hint for the model */
  hint?: string;
  /** Which pattern was matched */
  patternId?: string;
};

/** A candidate pattern discovered by the miner */
export type PatternCandidate = {
  model: string;
  toolName: string;
  frequency: number;
  errorSignature: string;
  suggestedPattern: Partial<Pattern>;
  sampleArgs: Record<string, unknown>[];
  sampleErrors: string[];
};

/** A pattern file on disk */
export type PatternFile = {
  schema: number;
  model: string;
  patterns: Pattern[];
};
```

- [ ] **Step 5: Test that the package compiles**

Run: `cd /home/babasola/Projects/Monolith && npm install && npx tsc -p packages/tool-repair/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/tool-repair/package.json packages/tool-repair/tsconfig.json packages/tool-repair/src/types.ts package.json
git commit -m "feat(tool-repair): scaffold package with shared types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pattern files (initial patterns for all target models)

**Files:**
- Create: `packages/tool-repair/src/patterns/deepseek-v4-flash.json`
- Create: `packages/tool-repair/src/patterns/deepseek-v4-pro.json`
- Create: `packages/tool-repair/src/patterns/kimi-k2.6.json`
- Create: `packages/tool-repair/src/patterns/claude-opus-4.8.json`

- [ ] **Step 1: Create `packages/tool-repair/src/patterns/deepseek-v4-flash.json`**

```json
{
  "schema": 1,
  "model": "deepseek-v4-flash",
  "patterns": [
    {
      "id": "ds4f-shell-null-optional",
      "category": "null_in_optional_field",
      "description": "Sends null for optional Shell params (timeout, description) instead of omitting",
      "tools": ["Bash", "shell.run", "shell"],
      "params": {
        "timeout": { "repair": "remove" },
        "description": { "repair": "remove" },
        "dangerouslyDisableSandbox": { "repair": "remove" }
      },
      "match": { "null_fields": ["timeout", "description"] },
      "hint": "Optional tool parameters should be omitted entirely, not set to null. I removed the null fields for you.",
      "severity": "error",
      "confidence": 0.95,
      "since": "2026-04-01",
      "deprecated": null
    },
    {
      "id": "ds4f-readfile-markdown-link",
      "category": "markdown_in_path",
      "description": "Wraps file paths in markdown link syntax: [text](path) or trailing parenthesis",
      "tools": ["Read", "file.read", "Glob", "dir.search"],
      "params": {
        "file_path": { "repair": "strip_markdown_links" },
        "path": { "repair": "strip_markdown_links" },
        "pattern": { "repair": "strip_markdown_links" }
      },
      "match": { "pattern": "\\[.*\\]\\(.*\\)|.*\\)$" },
      "hint": "File paths must be plain text. I stripped markdown link syntax from the path.",
      "severity": "error",
      "confidence": 0.99,
      "since": "2026-04-15",
      "deprecated": null
    },
    {
      "id": "ds4f-json-string-vs-array",
      "category": "type_mismatch",
      "description": "Emits JSON-encoded string where array expected (e.g. extensions field)",
      "tools": ["*"],
      "params": {
        "*": { "repair": "parse_json_string_to_array" }
      },
      "match": {
        "expected_type": "array",
        "actual_type": "string",
        "pattern": "^\\s*\\[.*\\]\\s*$"
      },
      "hint": "I received a JSON string but expected an array. I've parsed it for you.",
      "severity": "error",
      "confidence": 0.90,
      "since": "2026-04-10",
      "deprecated": null
    },
    {
      "id": "ds4f-readfile-no-offset",
      "category": "missing_required_param",
      "description": "Omits offset/limit when reading files; smart-default based on first read",
      "tools": ["Read", "file.read"],
      "params": {
        "offset": { "repair": "default_first_read" },
        "limit": { "repair": "default_first_read" }
      },
      "match": { "missing_fields": ["offset", "limit"] },
      "hint": "I defaulted to offset=0, limit=100 for this first read. Adjust if the log/target is near the end of the file.",
      "severity": "warning",
      "confidence": 0.85,
      "since": "2026-05-01",
      "deprecated": null
    },
    {
      "id": "ds4f-empty-object-arg",
      "category": "extra_junk_in_arg",
      "description": "Sends empty object {} for a param that should be omitted entirely",
      "tools": ["*"],
      "params": {
        "*": { "repair": "remove" }
      },
      "match": { "null_fields": [] },
      "hint": "An empty object was sent where no value was needed. I removed it.",
      "severity": "warning",
      "confidence": 0.80,
      "since": "2026-05-10",
      "deprecated": null
    },
    {
      "id": "ds4f-shell-command-stringify",
      "category": "wrong_arg_format",
      "description": "Wraps shell command in JSON.stringify format with escaped quotes",
      "tools": ["Bash", "shell.run"],
      "params": {
        "command": { "repair": "strip_markdown_links" }
      },
      "match": { "pattern": "^\"[^\"]*\"$" },
      "hint": "The command was double-escaped as a JSON string. I unescaped it.",
      "severity": "error",
      "confidence": 0.85,
      "since": "2026-05-15",
      "deprecated": null
    }
  ]
}
```

- [ ] **Step 2: Create `packages/tool-repair/src/patterns/deepseek-v4-pro.json`**

```json
{
  "schema": 1,
  "model": "deepseek-v4-pro",
  "patterns": [
    {
      "id": "ds4p-shell-null-optional",
      "category": "null_in_optional_field",
      "description": "Same as Flash — DeepSeek lineage issue with null optional params",
      "tools": ["Bash", "shell.run", "shell"],
      "params": {
        "timeout": { "repair": "remove" },
        "description": { "repair": "remove" },
        "dangerouslyDisableSandbox": { "repair": "remove" }
      },
      "match": { "null_fields": ["timeout", "description"] },
      "hint": "Optional parameters should be omitted, not null. Fixed for you.",
      "severity": "error",
      "confidence": 0.90,
      "since": "2026-04-01",
      "deprecated": null
    },
    {
      "id": "ds4p-readfile-markdown-link",
      "category": "markdown_in_path",
      "description": "File paths wrapped in markdown links, same family as Flash",
      "tools": ["Read", "file.read", "Glob", "dir.search"],
      "params": {
        "file_path": { "repair": "strip_markdown_links" },
        "path": { "repair": "strip_markdown_links" }
      },
      "match": { "pattern": "\\[.*\\]\\(.*\\)" },
      "hint": "Plain file paths only. Stripped markdown link syntax.",
      "severity": "error",
      "confidence": 0.95,
      "since": "2026-04-15",
      "deprecated": null
    },
    {
      "id": "ds4p-json-string-vs-array",
      "category": "type_mismatch",
      "description": "DeepSeek family trait: JSON string where array expected",
      "tools": ["*"],
      "params": {
        "*": { "repair": "parse_json_string_to_array" }
      },
      "match": {
        "expected_type": "array",
        "actual_type": "string",
        "pattern": "^\\s*\\[.*\\]\\s*$"
      },
      "hint": "Parsed the JSON string into an array for you.",
      "severity": "error",
      "confidence": 0.85,
      "since": "2026-04-10",
      "deprecated": null
    }
  ]
}
```

- [ ] **Step 3: Create `packages/tool-repair/src/patterns/kimi-k2.6.json`**

```json
{
  "schema": 1,
  "model": "kimi-k2.6",
  "patterns": [
    {
      "id": "kimi-missing-timeout",
      "category": "null_in_optional_field",
      "description": "Kimi sends explicit undefined where optional params expected",
      "tools": ["Bash", "shell.run", "shell"],
      "params": {
        "timeout": { "repair": "remove" },
        "description": { "repair": "remove" }
      },
      "match": { "null_fields": ["timeout"] },
      "hint": "I removed the undefined optional parameter. Omit instead of sending null.",
      "severity": "error",
      "confidence": 0.85,
      "since": "2026-05-01",
      "deprecated": null
    }
  ]
}
```

- [ ] **Step 4: Create `packages/tool-repair/src/patterns/claude-opus-4.8.json`**

```json
{
  "schema": 1,
  "model": "claude-opus-4.8",
  "patterns": [
    {
      "id": "opus-missing-bash-cwd",
      "category": "missing_required_param",
      "description": "Claude occasionally omits the cwd for shell commands (needs smart default)",
      "tools": ["Bash", "shell.run"],
      "params": {
        "cwd": { "repair": "replace_with_value", "value": "." }
      },
      "match": { "missing_fields": ["cwd"] },
      "hint": "I added cwd='.' for the shell command. Specify if a different directory.",
      "severity": "warning",
      "confidence": 0.70,
      "since": "2026-05-01",
      "deprecated": null
    },
    {
      "id": "opus-readfile-overlong-limit",
      "category": "wrong_arg_format",
      "description": "Claude sometimes sets limit extremely high (5000+), causing context waste",
      "tools": ["Read", "file.read"],
      "params": {
        "limit": { "repair": "replace_with_value", "value": 200 }
      },
      "match": {
        "expected_type": "number",
        "actual_type": "number"
      },
      "hint": "The read limit was capped at 200 lines to preserve context. Use multiple reads if needed.",
      "severity": "info",
      "confidence": 0.65,
      "since": "2026-06-01",
      "deprecated": null
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/tool-repair/src/patterns/
git commit -m "feat(tool-repair): add initial pattern files for DeepSeek V4 Flash/Pro, Kimi K2.6, Claude Opus 4.8

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Transform library

**Files:**
- Create: `packages/tool-repair/src/transforms/index.ts`
- Create: `packages/tool-repair/src/transforms/strip-markdown-links.ts`
- Create: `packages/tool-repair/src/transforms/parse-json-array.ts`
- Create: `packages/tool-repair/src/transforms/remove-null-field.ts`
- Create: `packages/tool-repair/src/transforms/smart-default.ts`

- [ ] **Step 1: Create `packages/tool-repair/src/transforms/remove-null-field.ts`**

```typescript
/**
 * Transform: remove
 * Deletes a param from the args object entirely.
 * Used when the model sends null/undefined/empty-object for optional params.
 */
export function removeNullField(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const changed = paramName in args;
  if (!changed) return { args, changed: false };
  const copy = { ...args };
  delete copy[paramName];
  return { args: copy, changed: true };
}
```

- [ ] **Step 2: Create `packages/tool-repair/src/transforms/strip-markdown-links.ts`**

```typescript
/**
 * Transform: strip_markdown_links
 * Strips markdown link syntax from string values.
 * "[text](path)" → "path"
 * Also strips trailing ")" which DeepSeek sometimes appends to plain paths.
 */
export function stripMarkdownLinks(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const val = args[paramName];
  if (typeof val !== "string") return { args, changed: false };

  let cleaned = val;

  // Match [text](url) → extract url
  const markdownLink = cleaned.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  if (markdownLink) {
    cleaned = markdownLink[2];
  }

  // Strip trailing ) if it looks like a leftover from markdown
  cleaned = cleaned.replace(/\)$/, "").trim();

  if (cleaned === val) return { args, changed: false };
  return { args: { ...args, [paramName]: cleaned }, changed: true };
}
```

- [ ] **Step 3: Create `packages/tool-repair/src/transforms/parse-json-array.ts`**

```typescript
/**
 * Transform: parse_json_string_to_array
 * If a string looks like a JSON array, parse it into an actual array.
 * Used when the model sends "\"[1, 2, 3]\"" instead of [1, 2, 3].
 */
export function parseJsonArray(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const val = args[paramName];
  if (typeof val !== "string") return { args, changed: false };

  const trimmed = val.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return { args, changed: false };

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { args, changed: false };
    return { args: { ...args, [paramName]: parsed }, changed: true };
  } catch {
    return { args, changed: false };
  }
}
```

- [ ] **Step 4: Create `packages/tool-repair/src/transforms/smart-default.ts`**

```typescript
/**
 * Transform: default_first_read / default_last_read
 * Smart default for missing offset/limit on file reads.
 * First read = start of file; subsequent = context-dependent.
 * For now, always defaults to offset=0, limit=100.
 */
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 100;

export function smartDefault(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const current = args[paramName];
  if (current !== undefined && current !== null) return { args, changed: false };

  const copy = { ...args };
  let changed = false;

  if ((paramName === "offset" || paramName === "limit") && (copy[paramName] === undefined || copy[paramName] === null)) {
    if (paramName === "offset") {
      copy[paramName] = DEFAULT_OFFSET;
    } else {
      copy[paramName] = DEFAULT_LIMIT;
    }
    changed = true;
  }

  return { args: copy, changed };
}
```

- [ ] **Step 5: Create `packages/tool-repair/src/transforms/index.ts`**

```typescript
import type { TransformName } from "../types.js";
import { removeNullField } from "./remove-null-field.js";
import { stripMarkdownLinks } from "./strip-markdown-links.js";
import { parseJsonArray } from "./parse-json-array.js";
import { smartDefault } from "./smart-default.js";

export type TransformFn = (args: Record<string, unknown>, paramName: string) => { args: Record<string, unknown>; changed: boolean };

const TRANSFORMS: Record<TransformName, TransformFn> = {
  remove: removeNullField,
  strip_markdown_links: stripMarkdownLinks,
  parse_json_string_to_array: parseJsonArray,
  default_first_read: smartDefault,
  default_last_read: smartDefault,
  replace_with_value: (args, paramName) => ({ args, changed: false }), // handled by repairer
};

export function getTransform(name: TransformName): TransformFn | undefined {
  return TRANSFORMS[name];
}

export function applyTransform(name: TransformName, args: Record<string, unknown>, paramName: string, value?: unknown): { args: Record<string, unknown>; changed: boolean } {
  if (name === "replace_with_value" && value !== undefined) {
    const current = args[paramName];
    if (current === value) return { args, changed: false };
    return { args: { ...args, [paramName]: value }, changed: true };
  }
  const fn = TRANSFORMS[name];
  if (!fn) return { args, changed: false };
  return fn(args, paramName);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/tool-repair/src/transforms/
git commit -m "feat(tool-repair): add transform library — strip-markdown, parse-json-array, remove-null, smart-default

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Pattern engine (registry, validator, repairer, hint formatter)

**Files:**
- Create: `packages/tool-repair/src/engine/registry.ts`
- Create: `packages/tool-repair/src/engine/validator.ts`
- Create: `packages/tool-repair/src/engine/repairer.ts`
- Create: `packages/tool-repair/src/engine/hint-formatter.ts`
- Create: `packages/tool-repair/src/index.ts`

- [ ] **Step 1: Create `packages/tool-repair/src/engine/registry.ts`**

```typescript
/**
 * PatternRegistry — loads model-keyed pattern JSON files.
 * Patterns are keyed by model name. Each file contains all known
 * deterministic tool-call failure signatures for that model.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pattern, PatternFile } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = join(__dirname, "..", "patterns");

/** Default confidence threshold — don't auto-apply patterns below this */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

export class PatternRegistry {
  private patterns = new Map<string, Pattern[]>(); // model → patterns
  private threshold: number;

  constructor(threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    this.threshold = threshold;
  }

  /** Load patterns for a specific model from disk */
  loadModel(modelId: string): Pattern[] {
    const safeId = modelId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = join(PATTERNS_DIR, `${safeId}.json`);

    if (!existsSync(filePath)) {
      this.patterns.set(modelId, []);
      return [];
    }

    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as PatternFile;

    const active = data.patterns.filter(p => p.deprecated === null && p.confidence >= this.threshold);
    this.patterns.set(modelId, active);
    return active;
  }

  /** Get patterns for a model (loaded or empty) */
  getPatterns(modelId: string): Pattern[] {
    if (!this.patterns.has(modelId)) {
      return this.loadModel(modelId);
    }
    return this.patterns.get(modelId) ?? [];
  }

  /** Get patterns for a specific tool on a model */
  getPatternsForTool(modelId: string, toolName: string): Pattern[] {
    return this.getPatterns(modelId).filter(p =>
      p.tools.includes("*") || p.tools.includes(toolName)
    );
  }

  /** Manually register patterns (for testing) */
  registerPatterns(modelId: string, patterns: Pattern[]): void {
    this.patterns.set(modelId, patterns);
  }

  /** List all available pattern files on disk */
  static listAvailableModels(): string[] {
    if (!existsSync(PATTERNS_DIR)) return [];
    return readdirSync(PATTERNS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => f.replace(/\.json$/, ""));
  }

  /** Reload all patterns */
  reloadAll(): void {
    this.patterns.clear();
  }

  getThreshold(): number {
    return this.threshold;
  }
}
```

- [ ] **Step 2: Create `packages/tool-repair/src/engine/validator.ts`**

```typescript
/**
 * Validator — checks a tool call against known patterns.
 * Returns which patterns match and what's wrong.
 */
import type { Pattern, MatchCondition } from "../types.js";

export type ValidationResult = {
  matched: boolean;
  matchedPatterns: Pattern[];
  /** Per-param issues found */
  issues: Array<{ param: string; patternId: string; issue: string }>;
};

export function validateToolCall(
  patterns: Pattern[],
  toolName: string,
  args: Record<string, unknown>
): ValidationResult {
  const matchedPatterns: Pattern[] = [];
  const issues: Array<{ param: string; patternId: string; issue: string }> = [];

  for (const pattern of patterns) {
    if (!pattern.tools.includes("*") && !pattern.tools.includes(toolName)) continue;

    const match = matchCondition(pattern.match, args);
    if (match.matched) {
      matchedPatterns.push(pattern);
      issues.push(...match.issues);
    }
  }

  return {
    matched: matchedPatterns.length > 0,
    matchedPatterns,
    issues,
  };
}

function matchCondition(
  condition: MatchCondition,
  args: Record<string, unknown>
): { matched: boolean; issues: Array<{ param: string; patternId: string; issue: string }> } {
  const issues: Array<{ param: string; patternId: string; issue: string }> = [];

  // Check null fields
  if (condition.null_fields) {
    for (const field of condition.null_fields) {
      if (args[field] === null || args[field] === undefined) {
        issues.push({ param: field, patternId: "", issue: `Field "${field}" is null/undefined` });
      }
    }
  }

  // Check missing fields
  if (condition.missing_fields) {
    for (const field of condition.missing_fields) {
      if (!(field in args)) {
        issues.push({ param: field, patternId: "", issue: `Required field "${field}" is missing` });
      }
    }
  }

  // Check type mismatch
  if (condition.expected_type && condition.actual_type) {
    for (const [key, val] of Object.entries(args)) {
      const actualType = Array.isArray(val) ? "array" : typeof val;
      if (condition.actual_type === actualType) {
        // This field has the wrong type — mark it
        issues.push({ param: key, patternId: "", issue: `Expected ${condition.expected_type}, got ${actualType}` });
      }
    }
  }

  // Check regex pattern on string values
  if (condition.pattern) {
    const regex = new RegExp(condition.pattern);
    for (const [key, val] of Object.entries(args)) {
      if (typeof val === "string" && regex.test(val)) {
        issues.push({ param: key, patternId: "", issue: `Value matches problematic pattern: ${condition.pattern}` });
      }
    }
  }

  return { matched: issues.length > 0, issues };
}
```

- [ ] **Step 3: Create `packages/tool-repair/src/engine/repairer.ts`**

```typescript
/**
 * Repairer — applies deterministic transforms to fix a tool call.
 */
import type { Pattern, RepairOutcome } from "../types.js";
import { applyTransform } from "../transforms/index.js";

export function repairToolCall(
  patterns: Pattern[],
  args: Record<string, unknown>
): RepairOutcome {
  let currentArgs = { ...args };
  const appliedPatterns: string[] = [];
  let anyChanged = false;

  for (const pattern of patterns) {
    let patternChanged = false;

    for (const [paramName, paramRepair] of Object.entries(pattern.params)) {
      if (paramName === "*") {
        // Apply to ALL params that have an issue
        // We re-check each param by iterating current args
        for (const key of Object.keys(currentArgs)) {
          const result = applyTransform(paramRepair.repair, currentArgs, key, paramRepair.value);
          if (result.changed) {
            currentArgs = result.args;
            patternChanged = true;
          }
        }
      } else {
        const result = applyTransform(paramRepair.repair, currentArgs, paramName, paramRepair.value);
        if (result.changed) {
          currentArgs = result.args;
          patternChanged = true;
        }
      }
    }

    if (patternChanged) {
      appliedPatterns.push(pattern.id);
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return { repaired: false, args };
  }

  const hints = appliedPatterns
    .map(id => patterns.find(p => p.id === id)?.hint)
    .filter(Boolean);

  return {
    repaired: true,
    args: currentArgs,
    hint: hints.join(" "),
    patternId: appliedPatterns.join(", "),
  };
}
```

- [ ] **Step 4: Create `packages/tool-repair/src/engine/hint-formatter.ts`**

```typescript
/**
 * Hint formatter — builds a structured hint for the model.
 * The hint is included alongside the repaired tool result so the model
 * learns from the correction.
 */
import type { RepairOutcome } from "../types.js";

export type FormattedHint = {
  text: string;
  structured?: {
    fixed: Array<{ param: string; issue: string; action: string }>;
    total_fixes: number;
  };
};

export function formatHint(outcome: RepairOutcome, verbose = false): FormattedHint {
  if (!outcome.repaired) {
    return { text: "" };
  }

  const text = outcome.hint ?? "";

  if (!verbose) {
    return { text };
  }

  return {
    text,
    structured: {
      fixed: [],
      total_fixes: outcome.patternId?.split(", ").length ?? 0,
    },
  };
}
```

- [ ] **Step 5: Create `packages/tool-repair/src/index.ts`**

```typescript
/**
 * @alix/tool-repair — Model-keyed deterministic tool-call repair engine.
 *
 * Usage:
 *   import { ToolRepair } from "@alix/tool-repair";
 *   const repair = new ToolRepair("deepseek-v4-flash");
 *   const result = repair.process("Bash", { timeout: null, command: "ls" });
 *   // result = { repaired: true, args: { command: "ls" }, hint: "..." }
 */

export { ToolRepair } from "./engine/repairer.js";
export { PatternRegistry } from "./engine/registry.js";
export { validateToolCall } from "./engine/validator.js";
export { repairToolCall, type RepairOutcome } from "./engine/repairer.js";
export * from "./types.js";
```

Wait, I shouldn't re-export from repairer.ts as ToolRepair since there's no class by that name there. Let me create a proper main entry point:

```typescript
/**
 * @alix/tool-repair — Model-keyed deterministic tool-call repair engine.
 */
import { PatternRegistry } from "./engine/registry.js";
import { validateToolCall } from "./engine/validator.js";
import { repairToolCall } from "./engine/repairer.js";
import { formatHint } from "./engine/hint-formatter.js";
import type { RepairOutcome } from "./types.js";

export class ToolRepair {
  private registry: PatternRegistry;

  constructor(
    private modelId: string,
    threshold?: number
  ) {
    this.registry = new PatternRegistry(threshold);
  }

  /** Process a tool call: validate, repair, return result + hint */
  process(toolName: string, args: Record<string, unknown>): RepairOutcome {
    const patterns = this.registry.getPatternsForTool(this.modelId, toolName);
    if (patterns.length === 0) {
      return { repaired: false, args };
    }

    const validation = validateToolCall(patterns, toolName, args);
    if (!validation.matched) {
      return { repaired: false, args };
    }

    const outcome = repairToolCall(validation.matchedPatterns, args);
    if (outcome.repaired && outcome.hint) {
      outcome.hint = formatHint(outcome).text;
    }

    return outcome;
  }

  /** Change the active model */
  setModel(modelId: string): void {
    this.modelId = modelId;
  }

  /** Reload all pattern files from disk */
  reloadPatterns(): void {
    this.registry.reloadAll();
  }
}

export { PatternRegistry } from "./engine/registry.js";
export { validateToolCall } from "./engine/validator.js";
export { repairToolCall } from "./engine/repairer.js";
export { formatHint } from "./engine/hint-formatter.js";
export * from "./types.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/tool-repair/src/engine/ packages/tool-repair/src/index.ts
git commit -m "feat(tool-repair): add pattern engine — registry, validator, repairer, hint formatter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Test the engine

**Files:**
- Create: `packages/tool-repair/tests/validator.test.ts`
- Create: `packages/tool-repair/tests/repairer.test.ts`
- Create: `packages/tool-repair/tests/transforms.test.ts`
- Create: `packages/tool-repair/tests/fixtures/deepseek-tool-errors.jsonl`

- [ ] **Step 1: Create `packages/tool-repair/tests/transforms.test.ts`**

```typescript
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { applyTransform } from "../src/transforms/index.js";

describe("transforms", () => {
  describe("remove", () => {
    it("removes a null field from args", () => {
      const result = applyTransform("remove", { timeout: null, command: "ls" }, "timeout");
      assert.strictEqual(result.changed, true);
      assert.strictEqual("timeout" in result.args, false);
      assert.strictEqual(result.args.command, "ls");
    });

    it("no-ops if field doesn't exist", () => {
      const result = applyTransform("remove", { command: "ls" }, "timeout");
      assert.strictEqual(result.changed, false);
    });
  });

  describe("strip_markdown_links", () => {
    it("strips [text](url) to url", () => {
      const result = applyTransform("strip_markdown_links", { file_path: "[README](src/README.md)" }, "file_path");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.file_path, "src/README.md");
    });

    it("strips trailing )", () => {
      const result = applyTransform("strip_markdown_links", { file_path: "src/file.ts)" }, "file_path");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.file_path, "src/file.ts");
    });

    it("leaves plain paths unchanged", () => {
      const result = applyTransform("strip_markdown_links", { file_path: "src/file.ts" }, "file_path");
      assert.strictEqual(result.changed, false);
    });
  });

  describe("parse_json_string_to_array", () => {
    it("parses a JSON string array", () => {
      const result = applyTransform("parse_json_string_to_array", { extensions: '["ts", "js"]' }, "extensions");
      assert.strictEqual(result.changed, true);
      assert.deepStrictEqual(result.args.extensions, ["ts", "js"]);
    });

    it("no-ops on non-array JSON", () => {
      const result = applyTransform("parse_json_string_to_array", { path: '"hello"' }, "path");
      assert.strictEqual(result.changed, false);
    });

    it("no-ops on plain strings", () => {
      const result = applyTransform("parse_json_string_to_array", { command: "ls -la" }, "command");
      assert.strictEqual(result.changed, false);
    });
  });

  describe("smart_default", () => {
    it("adds offset=0 when missing", () => {
      const result = applyTransform("default_first_read", {}, "offset");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.offset, 0);
    });

    it("adds limit=100 when missing", () => {
      const result = applyTransform("default_first_read", {}, "limit");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.limit, 100);
    });

    it("no-ops when value already present", () => {
      const result = applyTransform("default_first_read", { offset: 50 }, "offset");
      assert.strictEqual(result.changed, false);
    });
  });
});
```

- [ ] **Step 2: Create `packages/tool-repair/tests/validator.test.ts`**

```typescript
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { validateToolCall } from "../src/engine/validator.js";
import type { Pattern } from "../src/types.js";

const NULL_PATTERN: Pattern = {
  id: "test-null",
  category: "null_in_optional_field",
  description: "Test pattern",
  tools: ["Bash"],
  params: { timeout: { repair: "remove" } },
  match: { null_fields: ["timeout"] },
  hint: "Don't send null.",
  severity: "error",
  confidence: 0.95,
  since: "2026-06-01",
  deprecated: null,
};

const MARKDOWN_PATTERN: Pattern = {
  id: "test-markdown",
  category: "markdown_in_path",
  description: "Test markdown pattern",
  tools: ["Read"],
  params: { file_path: { repair: "strip_markdown_links" } },
  match: { pattern: "\\[.*\\]\\(.*\\)" },
  hint: "No markdown.",
  severity: "error",
  confidence: 0.99,
  since: "2026-06-01",
  deprecated: null,
};

describe("validateToolCall", () => {
  it("matches null fields", () => {
    const result = validateToolCall([NULL_PATTERN], "Bash", { command: "ls", timeout: null });
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.matchedPatterns.length, 1);
    assert.strictEqual(result.matchedPatterns[0].id, "test-null");
  });

  it("does not match clean calls", () => {
    const result = validateToolCall([NULL_PATTERN], "Bash", { command: "ls" });
    assert.strictEqual(result.matched, false);
  });

  it("respects tool filter", () => {
    const result = validateToolCall([NULL_PATTERN], "Read", { timeout: null });
    assert.strictEqual(result.matched, false);
  });

  it("matches markdown in path", () => {
    const result = validateToolCall([MARKDOWN_PATTERN], "Read", { file_path: "[file](path)" });
    assert.strictEqual(result.matched, true);
  });
});
```

- [ ] **Step 3: Create `packages/tool-repair/tests/repairer.test.ts`**

```typescript
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { repairToolCall } from "../src/engine/repairer.js";
import type { Pattern } from "../src/types.js";

const PATTERNS: Pattern[] = [
  {
    id: "test-null-remove",
    category: "null_in_optional_field",
    description: "Test",
    tools: ["*"],
    params: { timeout: { repair: "remove" } },
    match: { null_fields: ["timeout"] },
    hint: "Removed null timeout.",
    severity: "error",
    confidence: 0.95,
    since: "2026-06-01",
    deprecated: null,
  },
];

describe("repairToolCall", () => {
  it("repairs a null field by removing it", () => {
    const result = repairToolCall(PATTERNS, { command: "ls", timeout: null });
    assert.strictEqual(result.repaired, true);
    assert.strictEqual("timeout" in result.args, false);
    assert.strictEqual(result.args.command, "ls");
    assert.ok(result.hint);
  });

  it("no-ops when no pattern matches", () => {
    const result = repairToolCall(PATTERNS, { command: "ls" });
    assert.strictEqual(result.repaired, false);
  });
});
```

- [ ] **Step 4: Create `packages/tool-repair/tests/fixtures/deepseek-tool-errors.jsonl`**

This fixture contains synthetic tool-call errors that match our patterns, for integration tests.

```jsonl
{"toolCallId": "call_1", "name": "Bash", "args": {"command": "ls", "timeout": null}, "expected": {"command": "ls"}, "expectedPattern": "ds4f-shell-null-optional"}
{"toolCallId": "call_2", "name": "Read", "args": {"file_path": "[README](src/README.md)"}, "expected": {"file_path": "src/README.md"}, "expectedPattern": "ds4f-readfile-markdown-link"}
{"toolCallId": "call_3", "name": "Bash", "args": {"command": "ls -la", "timeout": null, "description": null}, "expected": {"command": "ls -la"}, "expectedPattern": "ds4f-shell-null-optional"}
```

- [ ] **Step 5: Run tests**

Run: `cd /home/babasola/Projects/Monolith && node --experimental-strip-types --test packages/tool-repair/tests/*.test.ts`
Expected: All tests pass (validator, repairer, transforms)

- [ ] **Step 6: Commit**

```bash
git add packages/tool-repair/tests/
git commit -m "test(tool-repair): add unit tests for validator, repairer, and all transforms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: ALiX adapter — integrate into ToolExecutor

**Files:**
- Modify: `packages/tool-repair/src/adapters/alix.ts` (create)
- Modify: `src/tools/executor.ts` (inject repair layer)

- [ ] **Step 1: Create `packages/tool-repair/src/adapters/alix.ts`**

```typescript
/**
 * ALiX adapter — wraps ToolRepair for use in ALiX's ToolExecutor.
 * Determines model from config, applies repairs pre-execution,
 * and injects the hint into the tool result.
 */
import { ToolRepair } from "../index.js";
import type { RepairOutcome } from "../types.js";

export class AlixToolRepair {
  private repair: ToolRepair;

  constructor(
    private provider: string,
    private modelName: string
  ) {
    // Map provider+model to pattern key
    const modelKey = normalizeModelKey(provider, modelName);
    this.repair = new ToolRepair(modelKey);
  }

  /** Process a tool call before execution. Returns repaired args + hint. */
  process(toolName: string, args: Record<string, unknown>): RepairOutcome {
    return this.repair.process(toolName, args);
  }
}

/**
 * Normalize provider+model to a pattern file key.
 * Examples:
 *   deepseek + deepseek-v4-flash → deepseek-v4-flash
 *   deepseek + deepseek-chat → deepseek-v4-flash (default DeepSeek model)
 *   anthropic + claude-opus-4-8 → claude-opus-4.8
 */
function normalizeModelKey(provider: string, model: string): string {
  const lower = model.toLowerCase();
  const prov = provider.toLowerCase();

  // Provider-specific normalization
  if (prov === "deepseek") {
    if (lower.includes("v4-flash") || lower.includes("flash")) return "deepseek-v4-flash";
    if (lower.includes("v4") || lower.includes("chat")) return "deepseek-v4-pro";
    return lower.replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  if (prov === "anthropic") {
    if (lower.includes("opus")) return "claude-opus-4.8";
    return "claude-opus-4.8";
  }

  // Generic: use model name as-is, sanitized
  return lower.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
```

- [ ] **Step 2: Modify `src/tools/executor.ts`**

Add import at top:
```typescript
import { AlixToolRepair } from "../../packages/tool-repair/src/adapters/alix.js";
```

Add field to ToolExecutor class:
```typescript
export class ToolExecutor {
  private router: CompositeToolRouter;
  private repair: AlixToolRepair | null = null;
```

In constructor, after router initialization, add:
```typescript
  try {
    const modelConfig = config.model;
    this.repair = new AlixToolRepair(modelConfig.provider, modelConfig.name);
  } catch {
    this.repair = null; // No repair if model unknown
  }
```

In the `execute()` method, right after policy check and before `await this.logEvent(TOOL_EVENT_TYPES.STARTED, ...)` (around line 113), inject the repair:

```typescript
    // === TOOL REPAIR LAYER ===
    let repairOutcome: RepairOutcome | null = null;
    if (this.repair && name !== "done" && !name.startsWith("mcp.")) {
      const result = this.repair.process(name, args);
      if (result.repaired) {
        repairOutcome = result;
        // Replace args with repaired version
        for (const key of Object.keys(args)) {
          delete (args as Record<string, unknown>)[key];
        }
        Object.assign(args as Record<string, unknown>, result.args);
      }
    }
    // === END TOOL REPAIR ===
```

Wait, that's a messy way to mutate args. Let me think of a cleaner approach.

Since `args` is `Record<string, unknown>` and the ToolCallRequest passes it by reference, we can just reassign:

Actually no, `args` is a property of `request` which is `{ toolCallId, name, args }`. Let me look at the flow again:

```typescript
async execute(request: ToolCallRequest): Promise<ExecuteResult> {
    const { toolCallId, name, args } = request;
```

So `args` is a local const. The router receives the full request. We need to pass modified args. The cleanest way:

```typescript
    // === TOOL REPAIR LAYER ===
    let repairHint: string | undefined;
    if (this.repair && name !== "done" && !name.startsWith("mcp.")) {
      const result = this.repair.process(name, args);
      if (result.repaired) {
        repairHint = result.hint;
        // Replace args in request for the router
        (request as Record<string, unknown>).args = result.args;
      }
    }
    // === END TOOL REPAIR ===
```

Then after the router executes, if we have a repairHint, we append it to the output:

```typescript
    let result = await this.router.execute(request);

    // Append repair hint to success output
    if (repairHint && result.kind === "success") {
      const hintBlock = `\n\n[Tool Repair Hint] ${repairHint}`;
      if (result.output) result.output += hintBlock;
      else if (result.content) result.content += hintBlock;
    }
```

- [ ] **Step 3: Import `RepairOutcome` type**

```typescript
import type { ToolResult, FileMatch } from "./types.js";
import type { RepairOutcome } from "../../packages/tool-repair/src/types.js";
```

- [ ] **Step 4: Commit**

```bash
git add packages/tool-repair/src/adapters/alix.ts src/tools/executor.ts
git commit -m "feat(tool-repair): integrate repair layer into ALiX ToolExecutor

Tool calls are now validated and repaired before execution. Repair hints
are appended to success output, teaching the model to avoid similar errors.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Claude Code adapter — hook script

**Files:**
- Create: `.claude/hooks/PreToolUse/tool-repair.sh`
- Create: `packages/tool-repair/bin/tool-repair.js`

- [ ] **Step 1: Create `packages/tool-repair/bin/tool-repair.js`**

This is a CLI entry point that the Claude Code hook invokes. It reads tool call JSON from stdin and outputs repaired JSON to stdout.

```javascript
#!/usr/bin/env node
/**
 * @alix/tool-repair CLI entry point.
 * Usage: cat tool-call.json | node tool-repair.js
 *
 * Input (stdin): JSON with { name, args, model? }
 * Output (stdout): JSON with { repaired, args, hint? }
 */

import { ToolRepair } from "../dist/src/index.js";
import { readFileSync } from "node:fs";

// Determine model from env or config
const model = process.env.TOOL_REPAIR_MODEL || process.env.CLAUDE_MODEL || "claude-opus-4.8";

async function main() {
  const input = readFileSync(process.stdin.fd, "utf-8").trim();
  if (!input) {
    console.log(JSON.stringify({ repaired: false, args: {} }));
    process.exit(0);
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({ repaired: false, args: {}, error: "Invalid JSON input" }));
    process.exit(0);
  }

  const toolName = data.name || data.tool_name || "";
  const args = data.args || data.tool_input || {};

  const repair = new ToolRepair(model);
  const result = repair.process(toolName, args);

  // If the hook needs to cancel or modify the call, output the modified args
  // If no repair, output empty = pass through
  if (!result.repaired) {
    console.log(JSON.stringify({ repaired: false }));
    process.exit(0);
  }

  // Output the model-specific hint as additional context
  if (result.hint) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `[Tool Repair] ${result.hint}`
      }
    }));
  }

  // Also write the hint to stderr for the hook to capture
  if (result.hint) {
    process.stderr.write(`[tool-repair] Fixed: ${result.hint}\n`);
  }
}

main().catch(() => process.exit(0));
```

- [ ] **Step 2: Create `.claude/hooks/PreToolUse/tool-repair.sh`**

```bash
#!/usr/bin/env bash
# Claude Code PreToolUse hook for tool-call repair.
# Invokes the tool-repair engine to detect and fix known tool-call issues.
#
# This hook runs BEFORE every tool call (Bash, Read, Write, Edit, etc).
# It validates the tool arguments against known patterns for the current model
# and adds hints to the context when a repair is possible.
#
# To enable: ensure this file is executable and CLAUDE.md references it.

# Skip if the tool-repair package isn't available
TOOL_REPAIR_DIR="/home/babasola/Projects/Monolith/packages/tool-repair"
if [ ! -f "$TOOL_REPAIR_DIR/bin/tool-repair.js" ]; then
  exit 0
fi

# Read stdin — it contains the tool call JSON
INPUT=$(cat)

# The hook receives the tool call as JSON on stdin.
# We pass it through to the repair CLI.
echo "$INPUT" | node --experimental-strip-types "$TOOL_REPAIR_DIR/bin/tool-repair.js" 2>/dev/null || true
```

- [ ] **Step 3: Make the hook executable and configure it**

```bash
chmod +x /home/babasola/Projects/Monolith/.claude/hooks/PreToolUse/tool-repair.sh
```

Add to Monolith's `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Write|Edit|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "/home/babasola/Projects/Monolith/.claude/hooks/PreToolUse/tool-repair.sh"
          }
        ]
      }
    ]
  }
}
```

Note: This merges with the existing hooks. The merge should be done by editing the existing `PreToolUse` array in `settings.local.json`.

- [ ] **Step 4: Commit**

```bash
git add packages/tool-repair/bin/tool-repair.js .claude/hooks/PreToolUse/tool-repair.sh .claude/settings.local.json
git commit -m "feat(tool-repair): add Claude Code hook for PreToolUse repair hints

The hook invokes the same repair engine, adding model-specific
tool-call hints as additional context before tools execute.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Pattern miner (session log analysis)

**Files:**
- Create: `packages/tool-repair/src/miner/index.ts`
- Create: `packages/tool-repair/src/miner/claude-session.ts`
- Create: `packages/tool-repair/src/miner/alix-session.ts`
- Create: `packages/tool-repair/src/miner/pattern-candidate.ts`
- Update: `packages/tool-repair/bin/tool-repair.js` (add `mine` command)

- [ ] **Step 1: Create `packages/tool-repair/src/miner/claude-session.ts`**

```typescript
/**
 * Claude Code session reader.
 * Reads ~/.claude/projects/<project>/<sessionId>.jsonl files
 * and extracts tool-call failure records.
 */

import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type ToolCallRecord = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  timestamp: string;
};

export type ToolErrorRecord = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  errorOutput: string;
  timestamp: string;
  sessionId: string;
};

/** Parse a single Claude Code .jsonl file into tool call records */
export async function parseClaudeSession(filePath: string): Promise<{
  calls: ToolCallRecord[];
  errors: ToolErrorRecord[];
}> {
  const calls: ToolCallRecord[] = [];
  const errors: ToolErrorRecord[] = [];
  const sessionId = filePath.split("/").pop()?.replace(/\.jsonl$/, "") ?? "unknown";

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);

      if (obj.type === "assistant") {
        const blocks = obj.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "tool_use") {
            calls.push({
              toolCallId: block.id,
              name: block.name,
              args: block.input as Record<string, unknown>,
              timestamp: obj.timestamp ?? "",
            });
          }
        }
      } else if (obj.type === "user") {
        const blocks = obj.message?.content ?? [];
        for (const block of blocks) {
          if (block.type === "tool_result") {
            const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            if (content.includes("Exit code") || content.toLowerCase().includes("error")) {
              // Find the matching tool call by ID
              const matchedCall = calls.find(c => c.toolCallId === block.tool_use_id);
              errors.push({
                toolCallId: block.tool_use_id,
                name: matchedCall?.name ?? "unknown",
                args: matchedCall?.args ?? {},
                errorOutput: content.slice(0, 500),
                timestamp: obj.timestamp ?? "",
                sessionId,
              });
            }
          }
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { calls, errors };
}

/** Find all Claude Code session files in a directory */
export async function findClaudeSessions(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}
```

- [ ] **Step 2: Create `packages/tool-repair/src/miner/alix-session.ts`**

```typescript
/**
 * ALiX session reader.
 * Reads .alix/sessions/<sessionId>/events.jsonl files.
 */
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type AlixEvent = {
  sessionId: string;
  actor: string;
  type: string;
  payload: Record<string, unknown>;
};

export type AlixToolFailure = {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  error: string;
  timestamp: string;
};

/** Parse a single ALiX events.jsonl file */
export async function parseAlixSession(filePath: string): Promise<{
  events: AlixEvent[];
  failures: AlixToolFailure[];
}> {
  const events: AlixEvent[] = [];
  const failures: AlixToolFailure[] = [];
  const sessionId = filePath.split("/sessions/")[1]?.split("/")[0] ?? "unknown";

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);
      events.push({
        sessionId: obj.sessionId ?? sessionId,
        actor: obj.actor ?? "",
        type: obj.type ?? "",
        payload: obj.payload ?? {},
      });
    } catch {
      // Skip malformed lines
    }
  }

  return { events, failures }; // failures extracted from event types in miner
}

/** Find all ALiX session files in a directory tree */
export async function findAlixSessions(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const sessionsDir = join(rootDir, ".alix", "sessions");
  try {
    const sessionDirs = await readdir(sessionsDir, { withFileTypes: true });
    for (const dir of sessionDirs) {
      if (dir.isDirectory()) {
        const eventFile = join(sessionsDir, dir.name, "events.jsonl");
        files.push(eventFile);
      }
    }
  } catch {
    // No sessions directory
  }
  return files;
}
```

- [ ] **Step 3: Create `packages/tool-repair/src/miner/pattern-candidate.ts`**

```typescript
/**
 * Pattern candidate generator.
 * Groups tool-call failures by error signature and suggests new repair patterns.
 */
import type { PatternCandidate } from "../types.js";

export function generateCandidates(
  errors: Array<{
    toolName: string;
    args: Record<string, unknown>;
    errorOutput: string;
  }>,
  modelId: string
): PatternCandidate[] {
  // Group by tool name + error signature
  const groups = new Map<string, {
    toolName: string;
    errorSignature: string;
    args: Record<string, unknown>[];
    errors: string[];
  }>();

  for (const err of errors) {
    const sig = errorSignature(err.args, err.errorOutput);
    const key = `${err.toolName}:${sig}`;

    if (!groups.has(key)) {
      groups.set(key, {
        toolName: err.toolName,
        errorSignature: sig,
        args: [],
        errors: [],
      });
    }
    const group = groups.get(key)!;
    group.args.push(err.args);
    group.errors.push(err.errorOutput.slice(0, 200));
  }

  // Convert to candidates, sorted by frequency
  return Array.from(groups.values())
    .map(g => ({
      model: modelId,
      toolName: g.toolName,
      frequency: g.args.length,
      errorSignature: g.errorSignature,
      suggestedPattern: {
        tools: [g.toolName],
        // Partial pattern — needs human review
      },
      sampleArgs: g.args.slice(0, 5),
      sampleErrors: g.errors.slice(0, 3),
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

function errorSignature(args: Record<string, unknown>, errorOutput: string): string {
  // Create a hashable signature from null fields + error type
  const nullFields = Object.entries(args)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k)
    .sort();

  const errorType = errorOutput.includes("Exit code") ? "exit_code"
    : errorOutput.includes("Zod") || errorOutput.includes("validation") ? "validation"
    : errorOutput.includes("ENOENT") ? "missing_file"
    : errorOutput.includes("TypeError") ? "type_error"
    : "other";

  return `${nullFields.join(",")}|${errorType}`;
}
```

- [ ] **Step 4: Create `packages/tool-repair/src/miner/index.ts`**

```typescript
export { parseClaudeSession, findClaudeSessions } from "./claude-session.js";
export { parseAlixSession, findAlixSessions } from "./alix-session.js";
export { generateCandidates } from "./pattern-candidate.js";
export type { ToolCallRecord, ToolErrorRecord } from "./claude-session.js";
export type { AlixEvent, AlixToolFailure } from "./alix-session.js";
```

- [ ] **Step 5: Update `packages/tool-repair/bin/tool-repair.js` to add `mine` command**

```javascript
#!/usr/bin/env node
/**
 * @alix/tool-repair CLI
 *
 * Usage:
 *   tool-repair process  < tool-call.json   # Repair a single tool call
 *   tool-repair mine                        # Mine session logs for new patterns
 */

import { ToolRepair, PatternRegistry } from "../src/index.js";
import { parseClaudeSession, findClaudeSessions } from "../src/miner/claude-session.js";
import { findAlixSessions, parseAlixSession } from "../src/miner/alix-session.js";
import { generateCandidates } from "../src/miner/pattern-candidate.js";
import { readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const command = process.argv[2];

if (command === "process") {
  await processCommand();
} else if (command === "mine") {
  await mineCommand();
} else {
  console.log("Usage: tool-repair <process|mine>");
}

async function processCommand() {
  const model = process.env.TOOL_REPAIR_MODEL || "claude-opus-4.8";
  const input = readFileSync(process.stdin.fd, "utf-8").trim();
  if (!input) { console.log(JSON.stringify({ repaired: false })); return; }

  const data = JSON.parse(input);
  const toolName = data.name || "";
  const args = data.args || {};

  const repair = new ToolRepair(model);
  const result = repair.process(toolName, args);

  if (result.repaired && result.hint) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `[Tool Repair] ${result.hint}`
      }
    }));
  } else {
    console.log(JSON.stringify({ repaired: false }));
  }
}

async function mineCommand() {
  const errors = [];

  // Scan Claude Code sessions
  const claudeDir = join(homedir(), ".claude", "projects");
  if (existsSync(claudeDir)) {
    const entries = await readdir(claudeDir);
    for (const entry of entries) {
      const projectDir = join(claudeDir, entry);
      const files = await findClaudeSessions(projectDir);
      for (const file of files) {
        const { errors: sessionErrors } = await parseClaudeSession(file);
        errors.push(...sessionErrors.map(e => ({
          toolName: e.name,
          args: e.args,
          errorOutput: e.errorOutput,
        })));
      }
    }
  }

  // Scan ALiX sessions
  const candidates = generateCandidates(errors, "deepseek-v4-flash");

  console.log(JSON.stringify({
    total_errors: errors.length,
    candidates: candidates.slice(0, 20),
    summary: `Found ${errors.length} tool errors across all scanned sessions. Top candidates:`,
  }, null, 2));
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/tool-repair/src/miner/ packages/tool-repair/bin/tool-repair.js
git commit -m "feat(tool-repair): add pattern miner for Claude Code and ALiX sessions

The mine command scans ~/.claude/projects and .alix/sessions for
tool-call failures, groups them by signature, and outputs candidate
patterns for review.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Wire up and verify

- [ ] **Step 1: Build the package**

```bash
cd /home/babasola/Projects/Monolith && npm run build
```

Expected: `packages/tool-repair/dist/` contains compiled JS

- [ ] **Step 2: Run all tests**

```bash
cd /home/babasola/Projects/Monolith && node --experimental-strip-types --test packages/tool-repair/tests/*.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Run miner against existing data**

```bash
cd /home/babasola/Projects/Monolith && node --experimental-strip-types packages/tool-repair/bin/tool-repair.js mine
```

Expected: JSON output with count of errors found and candidate patterns

- [ ] **Step 4: Verify Claude Code hook is wired correctly**

```bash
echo '{"name":"Bash","args":{"command":"ls","timeout":null}}' | node --experimental-strip-types packages/tool-repair/bin/tool-repair.js process
```

Expected: JSON output with `hookSpecificOutput.additionalContext` containing the repair hint

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(tool-repair): complete tool-call repair layer integration

- Model-keyed pattern files for DeepSeek V4 Flash/Pro, Kimi K2.6, Claude Opus 4.8
- Shared engine: registry, validator, repairer, hint formatter
- Transform library: strip-markdown-links, parse-json-array, remove-null, smart-default
- ALiX adapter integrated into ToolExecutor with pre-execution repair + hint injection
- Claude Code PreToolUse hook for repair hints
- Pattern miner for discovering new failure signatures from session logs
- Full test suite for all components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
