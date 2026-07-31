# Mode-Aware Prompts — Design Spec

**Status:** Draft  
**Date:** 2026-07-29  
**Prerequisite:** Tool Summary spec (provides intent signal for classifier)

---

## 1. Problem

ALiX uses a single system prompt for the entire agent session. The model receives the same behavioral instructions whether it is gathering context, making code changes, or verifying those changes. This means:

- Planning-phase instructions (e.g. "search thoroughly before editing") compete for attention with execution-phase instructions ("make minimal changes")
- The model sometimes verifies during planning or plans during execution, because there is no structural boundary
- The operator has no visual cue about what phase the agent is in

## 2. Solution

Three mode supplements layered on top of the base prompt:

```
┌──────────────────────────┐
│     Base Prompt          │  ← Always active (tool rules, tone, etc.)
├──────────────────────────┤
│  Research Supplement     │  ← Active when intent == research
│  or                      │
│  Mutation Supplement     │  ← Active when intent == mutation
│  or                      │
│  Validation Supplement   │  ← Active when intent == validation
└──────────────────────────┘
```

The mode is classified by the **runtime**, not the model. The prompt changes silently — no model-visible announcements. The operator sees a mode indicator in the TUI header.

## 3. Intent Classification

The loop classifies the model's observed behavior from tool calls, not from tool names alone. The classifier inspects the tool name AND its arguments:

| Intent | Tool name patterns | Argument signals |
|---|---|---|
| **Research** | `file.read`, `dir.search`, grep/glob patterns, web fetch/search, MCP discovery | Paths under `tests/` suggest "understanding test structure" (still research) |
| **Mutation** | `file.edit`, `file.create`, `file.delete`, `patch.apply`, `shell.run` | `shell.run` with compile/build/format/npm-install → mutation; `shell.run` with test/lint → validation |
| **Validation** | `shell.run` (with test/lint/typecheck/verify args), any tool returning pass/fail | Command strings containing `test`, `lint`, `typecheck`, `verify`, `check`, `build --dry-run` |

**Rules:**

- The classifier runs once per iteration, after tool calls execute
- Mode is sticky: it only changes when the new intent contradicts the current mode for ≥2 consecutive iterations (prevents flickering)
- Default = Research (the model starts in exploration mode)
- If no tool calls were made in an iteration, the mode does not change

### IntentClassifier

```typescript
type AgentIntent = "research" | "mutation" | "validation";

class IntentClassifier {
  classify(
    toolCalls: ToolCallRequest[],
    toolResults: ToolResult[],
  ): AgentIntent | null {  // null = no change
    // Inspect each tool call's name + args
    // Return the dominant intent, or null if ambiguous
  }
}
```

## 4. Prompt Supplements

### Research Supplement

```
## Research Phase

Your current focus is understanding the codebase and gathering context.
- Search with different wordings — first-pass results often miss key details
- Trace symbols back to their definitions before making assumptions
- Do NOT make code changes until you have a complete picture
- When you have enough context, the system will transition to Execution
```

### Mutation Supplement

```
## Execution Phase

You have an understanding of the codebase and are now making changes.
- Follow existing code conventions (naming, patterns, libraries)
- Make minimal, focused edits — one logical change per file
- Do not add comments unless the code is complex or the user asks
- After each change, verify it compiles or passes basic checks
```

### Validation Supplement

```
## Verification Phase

Your changes are written and you are now verifying correctness.
- Run tests, typecheck, or lint relevant to the change
- Do NOT modify tests to make them pass — fix the implementation
- If verification fails, return to Execution to fix the issue
- Provide a summary of what was tested and the results
```

## 5. Prompt Assembly

In `agent-loop.ts`, after the base prompt is assembled:

```typescript
const intent = classifier.classify(lastToolCalls, lastResults);
const supplement = intent === "research" ? RESEARCH_SUPPLEMENT
  : intent === "mutation" ? MUTATION_SUPPLEMENT
  : VALIDATION_SUPPLEMENT;

const SYSTEM_PROMPT = [basePrompt, supplement].join("\n\n");
```

The base prompt is unchanged. The supplement is appended. No "switching to" messages.

## 6. TUI Header Indicator

The current mode is displayed in the agent tab header using a small colored badge:

| Mode | Badge | Color |
|---|---|---|
| Research | `R` | Blue (`\x1b[34m`) |
| Execution | `E` | Yellow (`\x1b[33m`) |
| Verification | `V` | Green (`\x1b[32m`) |

Rendered as part of the agent-view status row. The operator sees the current intent at a glance.

## 7. Files Changed

| File | Change |
|---|---|
| `src/agent/system-prompt.ts` | Add three supplement constants, `RESEARCH_SUPPLEMENT`, `MUTATION_SUPPLEMENT`, `VALIDATION_SUPPLEMENT`. Export them. |
| `src/agent/agent-loop.ts` | Import classifier, pass intent to `setupSystemPrompt`, assemble supplement into SYSTEM_PROMPT |
| `src/run/task-loop.ts` | Import `IntentClassifier`. After tool-execution loop, call classifier and pass result to next iteration |
| `src/tui/views/agent-view.ts` | Render intent badge in the status row |

## 8. Non-goals

- No model-visible "mode switch" messages — transitions are silent
- No separate lifecycle state machine — intent is derived, not prescribed
- No governance impact — the classifier does not gate tool execution
- No plan-approval gate integration — the existing plan gate operates independently
- No session persistence of intent (the classifier re-derives each iteration)

## 9. Dependencies

- Tool Summary spec: the `summary` field helps the classifier disambiguate `shell.run` calls (a summary saying "Running tests" vs "Building project" is a stronger signal than argument parsing alone)
- Staged Synthesis spec: the Progress Ledger naturally shows the "current mode" as a section marker
