# Codebase Duplication Consolidation

**Context:** The render-pipeline refactor (P1-P4) identified that the same pattern-extraction approach applies broadly across the codebase. A sweep of `src/agent/`, `src/run/`, `src/providers/`, and `src/cli/` found ~2000 lines of duplicated code, with the hottest concentration in the agent session layer (a single 1861-char system prompt string duplicated verbatim between two files).

**Goal:** Eliminate ~2000 lines of duplication, consolidate shared constants, and eliminate copy-paste hazards where two copies of the same string can diverge.

**Strategy:** 5 priorities, sequential. Each is independent and testable.

---

### P5: Extract SYSTEM_PROMPT_BASE to a shared module

`agent-loop.ts:278` and `session.ts:1861` each define the same `const BASE = ` ... long system prompt string verbatim, differing only in one appended section (read-only mode prompt, shell task prompt). Any edit to one must be made to the other.

**Create** `src/agent/system-prompt.ts`:
```ts
// src/agent/system-prompt.ts
// Single source of truth for the base system prompt shared by
// the direct agent loop (agent-loop.ts) and the session-based
// loop (session.ts). The two callers append their own tool-policy
// and mode-specific sections.

export const SYSTEM_PROMPT_BASE = `<system_prompt>
... (the full 1861-char string) ...
</system_prompt>`;
```

**Modify** `agent-loop.ts:278`: replace the literal `const BASE = ` at line 278 with `import { SYSTEM_PROMPT_BASE } from './system-prompt.js'`.

**Modify** `session.ts:1861`: same replacement.

**Impact:** -1850 lines of duplication removed. Two files converge on one source of truth.

---

### P6: Extract session outcome evaluation chain

`task-loop.ts` has the same 4-line pattern (log.append + saveDecisionsToMemory + evaluatePattern + return) repeated ~6 times at different completion points.

**Create** a helper function `completeSession(session, log, memoryStore, sessionDir, taskType, sessionId, text): RunResult` that does all four steps in one call.

**Impact:** -50 lines, eliminates risk of forgetting a step at one of the 6 call sites.

---

### P7: Extract FAILURE_REASONS + prompt fragments into shared constants

`agent-loop.ts:420` and `session.ts:1089-1093` both define:
```ts
const FAILURE_REASONS = new Set(["max_iterations", "max_repairs", "rejected_scope_expansion"]);
```

Move to `system-prompt.ts` alongside `SYSTEM_PROMPT_BASE`.

Also extract the "Read-Only Mode" and "Shell Task" appended prompt blocks into the same shared module.

**Impact:** -35 lines, eliminates 2 duplicate sets + 2 duplicate prompt fragments.

---

### P8: Consolidate dashboard renderer helpers

Three dashboard renderers (`dashboard-renderer.ts`, `governance-dashboard-renderer.ts`, `executive-dashboard-renderer.ts`) each define their own `pad()`, `truncate()`, `bar()`, `pct()`, `icon()` helpers with slight naming differences.

**Create** `src/tui/dashboard-helpers.ts` and move all shared helpers there. Each renderer imports from it instead of defining its own.

**Impact:** -60 lines, eliminates the risk of different renderers truncating/padding differently.

---

### P9: Fix shouldAutoDisableStreaming + extractMutationPaths duplication

`shouldAutoDisableStreaming` is defined identically in `agent/stream.ts:3` and `run/helpers.ts:379`. Keep one definition, import it in the other.

Same for `extractMutationPaths` in `run/helpers.ts:247` and `agent/mutations.ts:12`.

**Impact:** -30 lines, small but prevents future divergence bugs.

---

## Verification

After each priority:
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — full suite passes
- commit
