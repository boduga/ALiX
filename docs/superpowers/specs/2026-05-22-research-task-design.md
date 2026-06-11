# Research Task Type - Design Spec

**Status:** ✅ Completed (M0.26) — Design implemented and committed to main.

> **Status:** Draft
> **Created:** 2026-05-22

## Overview

Add `research` task type to ALiX for non-coding prompts that need web search. Depth determined by prompt heuristics, not separate mode.

## Problem

ALiX currently only handles coding task types (bugfix, feature, refactor, docs, unknown). Non-coding queries like "find all places where X is used" or "analyze our auth architecture" fall through to `unknown` and follow the wrong pipeline.

## Solution

### Task Classification

Add `research` type with patterns:

```typescript
const RESEARCH_PATTERNS = [
  /research|study|investigate|analyze/i,
  /find all|search for|look up|look into/i,
  /compare|evaluate|assess|review/i,
  /what is|how does|explain|understand/i,
  /best practices|recommended|guidelines/i,
];
```

### Depth Detection

```typescript
function detectDepth(prompt: string): 'quick' | 'deep' {
  const deepSignals = [
    /\bdeep\s+research\b/i,
    /\b(analyze|compare|evaluate|assess)\b/i,
    /\b(comprehensive|thorough|detailed)\b/i,
    /(\bAND\b|&).*(\bAND\b|&)/,  // Multiple entities
  ];
  return deepSignals.some(r => r.test(prompt)) ? 'deep' : 'quick';
}
```

### Finding Types

Extend `SubagentFinding` for research:

```typescript
type WebSource = {
  type: "web_source";
  content: string;      // Summary of the source
  url: string;          // Source URL
  title: string;       // Page title
  confidence: "high" | "medium" | "low";
};

type Synthesis = {
  type: "synthesis";
  content: string;     // Synthesized findings
  sources: string[];    // URLs or file paths
  confidence: "high" | "medium" | "low";
};
```

### Integration Points

#### 1. TaskClassifier (`src/task-classifier.ts`)

```typescript
interface ClassifiedTask {
  type: "bugfix" | "feature" | "refactor" | "docs" | "research" | "unknown";
  depth: "quick" | "deep";  // For research only
  confidence: "high" | "medium" | "low";
}
```

#### 2. Tool Policy (`src/subagents/tool-policy.ts`)

```typescript
function getToolPolicy(role: SubagentRole): ToolPolicy {
  switch (role) {
    case "researcher":
      return {
        allow: ["file.read", "git.diff", "git.log", "shell.run"],
        allowMcp: ["brave-search"],  // Web search
        deny: ["file.write", "git.push", "shell.exec"],
      };
    // ...
  }
}
```

#### 3. ContextCompiler (`src/repomap/context-compiler.ts`)

```typescript
function rankContext(taskType: string, depth: string): ContextConfig {
  if (taskType === "research") {
    return {
      include: depth === "deep" ? ["docs", "architecture", "code"] : ["docs"],
      exclude: ["node_modules", "dist", ".git"],
      maxTokens: depth === "deep" ? 8000 : 4000,
    };
  }
  // Existing logic for other types
}
```

#### 4. TaskLoop (`src/run/task-loop.ts`)

```typescript
const RESEARCH_LIMITS = {
  quick: { maxIterations: 3, maxSearchCalls: 3 },
  deep: { maxIterations: 15, maxSearchCalls: 10, crossReference: true },
};

function shouldExitLoop(taskType: string, state: LoopState): ExitReason {
  if (taskType === "research") {
    const limits = RESEARCH_LIMITS[depth];
    if (state.searchCalls >= limits.maxSearchCalls) return "max_search_calls";
    if (state.iterations >= limits.maxIterations) return "max_iterations";
    if (modelSaysDone(state)) return "completed";
  }
  // Existing exit logic...
}
```

### Exit Conditions

Research exits when:
1. Model signals done (no more search calls planned)
2. Max search calls reached
3. Max iterations reached
4. User interrupts

Research **skips verification** (no tests to run).

### Output Format

```markdown
## Research: <query>

### Findings

**Web Sources:**
- [Title](url) - Summary (confidence: high)

**Repo Context:**
- `src/auth/token.ts` - JWT validation logic
- `docs/auth.md` - Auth architecture overview

### Synthesis

[Concise answer with source attribution]

---
Quick research • 3 sources • 2 search calls
```

### User Interface

```bash
# Quick research (default)
alix research "what's our current auth strategy"

# Deep research (comprehensive)
alix research "compare auth strategies for microservices vs monolith"

# Inline research (within coding session)
> research "best practices for rate limiting"
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/task-classifier.ts` | Add research type + depth detection |
| `src/run.ts` | Wire research exit conditions |
| `src/run/task-loop.ts` | Add research limits config |
| `src/subagents/tool-policy.ts` | Add researcher role tool policy |
| `src/repomap/context-compiler.ts` | Context bias for research |
| `src/config/schema.ts` | Add WebSource, Synthesis finding types |
| `src/cli/commands/research.ts` | New CLI command (optional) |

## Testing

1. Classify various research prompts correctly
2. Depth detection works for quick vs deep
3. Tool policy allows MCP search, denies write
4. Loop exits at correct conditions
5. Output format includes web sources

## Open Questions

- [ ] Should research persist findings to memory for future sessions?
- [ ] How to handle conflicting web sources?
- [ ] Rate limiting for search calls?