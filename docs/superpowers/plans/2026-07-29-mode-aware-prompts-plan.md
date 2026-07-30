# Mode-Aware Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify the agent's current intent type (research / mutation / validation) from observed tool calls and arguments, then layer a mode-specific prompt supplement on top of the base system prompt. No model-visible mode announcements.

**Architecture:** An `IntentClassifier` module inspects completed tool calls (name + args) each iteration and returns the dominant intent. Mode is sticky — it only changes after 2+ consecutive contradictory observations. The classifier result flows through the task-loop deps to `setupSystemPrompt()`, which appends the corresponding supplement. TUI shows a mode badge in the agent-view status row.

**Tech Stack:** TypeScript, task-loop.ts, agent-loop.ts, TUI

## Global Constraints

- No model-visible mode-switch messages — transitions are silent
- Mode is derived, not prescribed — no separate lifecycle state machine
- The classifier does NOT gate or authorize tool execution (governance-neutral)
- Sticky: ≥2 consecutive contradictory iterations before switching modes
- Default mode: research (model starts in exploration)

---
## File Structure

| File | Role | Change |
|---|---|---|
| `src/run/intent-classifier.ts` | NEW — intent classification module | `IntentClassifier.classify()` based on tool names + args |
| `src/agent/system-prompt.ts` | Prompt constants | Add `RESEARCH_SUPPLEMENT`, `MUTATION_SUPPLEMENT`, `VALIDATION_SUPPLEMENT` constants. Export them. |
| `src/run/task-loop.ts` | Agent loop | Import classifier, call after tool loop, pass intent via deps or callback |
| `src/agent/agent-loop.ts` | System prompt assembly | Accept intent, append supplement to base prompt |
| `src/tui/views/agent-view.ts` | TUI scrollback | Render mode badge in status row |

---

### Task 1: Create IntentClassifier

**Files:**
- Create: `src/run/intent-classifier.ts`

**Interfaces:**
- Produces: `AgentIntent` type, `IntentClassifier` class

The classifier inspects tool calls from one iteration and determines the dominant intent. `shell.run` requires argument analysis (command strings).

- [ ] **Step 1: Create the file**

```typescript
// src/run/intent-classifier.ts
// Classifies the agent's current intent from observed tool calls.
// Sticky: mode only changes after ≥2 consecutive contradictory iterations.

export type AgentIntent = "research" | "mutation" | "validation";

// Tool name patterns for intent classification
const RESEARCH_TOOLS = new Set([
  "file.read", "dir.search", "web_fetch", "web_search",
  "mcp_discovery", "grep", "glob", "list_files",
]);

const MUTATION_TOOLS = new Set([
  "file.edit", "file.create", "file.delete", "patch.apply",
  "file.write", "file.rename",
]);

/** Detect validation intent from shell command strings. */
const VALIDATION_COMMAND_RE = /\b(test|lint|typecheck|verify|check|vitest|jest|pytest)\b/i;
const MUTATION_COMMAND_RE = /\b(build|compile|install|format|npm\s+(install|run\s+build)|go\s+build|rustc)\b/i;

export class IntentClassifier {
  /**
   * Classify a batch of tool calls from one iteration.
   * Returns the dominant intent, defaulting to research.
   */
  classify(toolCalls: Array<{ name: string; args: Record<string, unknown> }>): AgentIntent {
    if (toolCalls.length === 0) return "research";

    let researchScore = 0;
    let mutationScore = 0;
    let validationScore = 0;

    for (const tc of toolCalls) {
      if (RESEARCH_TOOLS.has(tc.name)) {
        researchScore++;
      } else if (MUTATION_TOOLS.has(tc.name)) {
        mutationScore++;
      } else if (tc.name === "shell.run") {
        const command = String(tc.args.command ?? "");
        if (VALIDATION_COMMAND_RE.test(command)) {
          mutationScore--;
          validationScore++;
        } else if (MUTATION_COMMAND_RE.test(command)) {
          mutationScore++;
        } else {
          // Default for shell.run with unknown command: count as mutation
          mutationScore++;
        }
      }
      // Unrecognized tools: count as research (exploration)
      else {
        researchScore++;
      }
    }

    if (validationScore > 0 && validationScore >= researchScore && validationScore >= mutationScore) {
      return "validation";
    }
    if (mutationScore > 0 && mutationScore >= researchScore) {
      return "mutation";
    }
    return "research";
  }

  /**
   * Apply sticky logic: only change mode after ≥2 consecutive iterations
   * where the new intent differs from the current one.
   */
  update(current: AgentIntent, observed: AgentIntent, streak: number): { next: AgentIntent; streak: number } {
    if (observed === current) {
      return { next: current, streak: 0 };
    }
    const newStreak = streak + 1;
    if (newStreak >= 2) {
      return { next: observed, streak: 0 };
    }
    return { next: current, streak: newStreak };
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean build.

---

### Task 2: Add prompt supplements

**Files:**
- Modify: `src/agent/system-prompt.ts`

Add three mode-specific supplement constants.

- [ ] **Step 1: Add supplement constants**

In `src/agent/system-prompt.ts`, at the end:

```typescript
export const RESEARCH_SUPPLEMENT =
`## Research Phase

Your current focus is understanding the codebase and gathering context.
- Search with different wordings — first-pass results often miss key details
- Trace symbols back to their definitions before making assumptions
- Do NOT make code changes until you have a complete picture
- When you have enough context, the system will transition you to Execution`;

export const MUTATION_SUPPLEMENT =
`## Execution Phase

You have an understanding of the codebase and are now making changes.
- Follow existing code conventions (naming, patterns, libraries)
- Make minimal, focused edits — one logical change per file
- Do not add comments unless the code is complex or the user asks
- After each change, verify it compiles or passes basic checks`;

export const VALIDATION_SUPPLEMENT =
`## Verification Phase

Your changes are written and you are now verifying correctness.
- Run tests, typecheck, or lint relevant to the change
- Do NOT modify tests to make them pass — fix the implementation
- If verification fails, return to Execution to fix the issue
- Provide a summary of what was tested and the results`;
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean build.

---

### Task 3: Wire intent classifier into task-loop

**Files:**
- Modify: `src/run/task-loop.ts`

The loop creates an `IntentClassifier` instance and calls `classify()` after each tool-execution iteration. The resulting intent is stored as loop state and passed through to `setupSystemPrompt()`.

- [ ] **Step 1: Import and instantiate classifier**

Near the top of `runTaskLoop`:

```typescript
import { IntentClassifier, type AgentIntent } from "./intent-classifier.js";

// Then inside runTaskLoop:
const intentClassifier = new IntentClassifier();
let currentIntent: AgentIntent = "research";
let intentStreak = 0;
```

- [ ] **Step 2: Classify after tool execution**

After the tool-execution loop (after `for (const toolCall of toolCalls)` ends, around line 591) and the mutation tracking, add:

```typescript
// ── Intent classification ──────────────────────────────
const observedIntent = intentClassifier.classify(toolCalls);
const result = intentClassifier.update(currentIntent, observedIntent, intentStreak);
currentIntent = result.next;
intentStreak = result.streak;
```

- [ ] **Step 3: Pass intent to setupSystemPrompt**

The `TaskLoopDeps` interface or the `setupSystemPrompt` function needs to accept `currentIntent`. Since `setupSystemPrompt` only runs once per loop iteration, add `currentIntent` to `TaskLoopDeps`:

```typescript
// In TaskLoopDeps (near the interface definition)
currentIntent?: AgentIntent;
```

Then in the system prompt assembly section (around the `SYSTEM_PROMPT` build), after `SYSTEM_PROMPT_BASE`, append the supplement:

```typescript
// After SYSTEM_PROMPT_BASE is set
const supplement = currentIntent === "research" ? RESEARCH_SUPPLEMENT
  : currentIntent === "mutation" ? MUTATION_SUPPLEMENT
  : VALIDATION_SUPPLEMENT;
const fullPrompt = `${baseSystemPrompt}\n\n${supplement}`;
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: clean build.

---

### Task 4: Wire intent into agent-loop.ts

**Files:**
- Modify: `src/agent/agent-loop.ts`

The `setupSystemPrompt` function (or equivalent in agent-loop.ts) currently builds SYSTEM_PROMPT from the base prompt, workspace, skills, etc. It needs to accept an intent and append the supplement.

- [ ] **Step 1: Find the prompt assembly**

In `src/agent/agent-loop.ts`, find where SYSTEM_PROMPT is built (around line 279-318). After the `lines.join("\n\n")` line, add:

```typescript
// Append mode-specific supplement
if (currentIntent) {
  const { RESEARCH_SUPPLEMENT, MUTATION_SUPPLEMENT, VALIDATION_SUPPLEMENT } =
    await import("./system-prompt.js");
  const supplement = currentIntent === "research" ? RESEARCH_SUPPLEMENT
    : currentIntent === "mutation" ? MUTATION_SUPPLEMENT
    : VALIDATION_SUPPLEMENT;
  lines.push(supplement);
}
```

- [ ] **Step 2: Pass intent through the call chain**

The `runTask` function and `runTaskLoop` need to forward the intent. The `TaskLoopDeps` already has `currentIntent?` from Task 3. Pass it:

```typescript
// In agent-loop.ts when calling runTaskLoop
const taskLoopDeps: TaskLoopDeps = {
  // ...existing deps
  currentIntent,
};
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean build.

---

### Task 5: Render mode badge in TUI

**Files:**
- Modify: `src/tui/views/agent-view.ts`

- [ ] **Step 1: Add mode to PerTabState**

In `src/tui/state.ts`:

```typescript
export interface PerTabState {
  // ...existing fields
  currentIntent?: 'research' | 'mutation' | 'validation';  // NEW
}
```

- [ ] **Step 2: Add mode badge rendering**

In `agent-view.ts`, after the runtime status line (row 5) and before the scrollback, add a mode indicator line when mode is not research (research is the default, no badge needed):

```typescript
// Mode badge — indicates the agent's current phase
const intent = ctx.perTab.currentIntent;
if (intent && intent !== 'research') {
  const color = intent === 'mutation' ? '\x1b[33m' : '\x1b[32m';
  const label = intent === 'mutation' ? 'E' : 'V';
  c.write(2, 5, `${color}[${label}]\x1b[0m`);
}
```

- [ ] **Step 3: Sync intent from snapshot**

In `app.ts`, in the snapshot-sync path, copy `snap.session?.currentIntent` to each tab's `perTab.currentIntent`.

Add to `SessionMetadata` in `snapshot.ts`:

```typescript
export interface SessionMetadata {
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly phase: SessionPhase;
  readonly version: string;
  readonly startedAt: number;
  readonly turns: number;
  readonly currentIntent?: 'research' | 'mutation' | 'validation';  // NEW
}
```

- [ ] **Step 4: Build and run tests**

```bash
npm run build
npx vitest run tests/tui/
```

Expected: all tests pass.

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Intent classification is a new module with no behavioral impact on existing flows (defaults to "research" when no tools are called).

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(prompts): add mode-aware prompt supplements with intent classifier

IntentClassifier derives research/mutation/validation intent from tool
names and arguments. The system prompt is layered with a mode-specific
supplement (no model-visible announcements). TUI shows a badge indicator
when the mode is non-default. Sticky: requires 2+ consecutive observations
before switching modes to prevent flickering.

Co-Authored-By: Claude <noreply@anthropic.com>"
```
