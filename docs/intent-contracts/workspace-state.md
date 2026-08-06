# Workspace-state intent — recognition contract

**Status**: Active (PR delivering T1 on wayfinder map #376)
**Owner**: `src/runtime/action-classifier.ts` (`WORKSPACE_ANCHORS`)
**Test corpus**: `tests/runtime/action-classifier.test.ts → describe("classifyAction — workspace-state recognition contract")`

## Intent definition

A user prompt belongs to the **workspace-state** family when it asks about the **current state** of the local system or workspace and requires **inspection** — not mutation, not external lookup, not generation. The answer depends on something the local shell or filesystem can read.

Distinct from adjacent intent families:

| Family | Asks | Means |
|---|---|---|
| **workspace-state** *(this family)* | "what is the current state?" | shell or filesystem inspection |
| **workspace-mutation** | "change the state" | filesystem write |
| **shell-execution** | "run a command, observe output" | command execution, side-effect-agnostic |
| **read-only-analysis** | "explain / summarize / describe" | analytical reasoning on existing text |
| **planning** | "design / propose / decide" | decision-making, no execution |
| **generation** | "produce new text/code" | free-form authoring |

## Recognizer

**Mechanism**: deterministic regex (`WORKSPACE_ANCHORS` family in `src/runtime/action-classifier.ts`).
**Trigger precedence**: workspace-state dominates retrieval + generation signals (line 406, `classifyAction`).
**Confidence**: workspace-state matches return `confidence: 0.95` (≥ 0.7 Layer-1 floor), which **short-circuits the model fallback at `task-router.ts:352`** — `modelClassifyAction` is never called for these prompts.

### Pattern set (current)

| Pattern | Matches |
|---|---|
| `\b(?:is|are)\s+\S+(?:\s+\S+){0,4}?\s+(?:installed\|available\|running)\b` | "is X installed/available/running", "are services running" |
| `\bdo\s+i\s+have\s+\w[\w.-]*` | "do I have X" |
| `\bcheck\s+(?:if\|whether)\b` | "check if X", "check whether X" |
| `\bwhat(?:'s\|\s+is)\s+running\b` | "what's running", "what is running [on port N]" |

## Confidence boundary

- Layer 1 hit with confidence ≥ 0.7 → route to `ExecutionRoute.agent` (full system prompt + tool access).
- Below 0.7 → falls to `ambiguous`, then to model fallback (`modelClassifyAction`).
- The four patterns above all yield `confidence: 0.95`; the boundary has zero fallback exposure for this family as currently scoped.

## Positive corpus (must classify `workspace_action`)

Each test in `tests/runtime/action-classifier.test.ts → describe("positive corpus")`:

| Prompt | Intent | Confidence |
|---|---|---|
| `is llama.cpp installed` | `workspace_action` | 0.95 |
| `is curl installed` | `workspace_action` | 0.95 |
| `is git installed on this machine` | `workspace_action` | 0.95 |
| `do I have docker` | `workspace_action` | 0.95 |
| `what is running on port 3000` | `workspace_action` | 0.95 |
| `check if postgres is running` | `workspace_action` | 0.95 |

## Negative corpus (must NOT classify `workspace_action`)

Each test in `describe("negative corpus")`:

| Prompt | Expected NOT-workspace_action because |
|---|---|
| `write installation instructions` | belongs to generation |
| `document how to install curl` | belongs to generation / read-only-analysis |
| `compare installers` | belongs to read-only-analysis |
| `explain the install process` | belongs to read-only-analysis |
| `should I install curl` | belongs to planning (decision question) |

Negative tests assert `intent !== "workspace_action"`. Current observable classification for the corpus: `ambiguous` (0.5) for all five — meaning Layer 2 model fallback decides. Acceptable.

## Ambiguous corpus (mixed-intent routing policy)

| Prompt | Layer-1 classification | Policy |
|---|---|---|
| `if curl isn't installed, install it` | `ambiguous` (0.5) | Probe AND mutation — defer to Layer 2 so the chain sees both halves. Mutation half would be lost if only workspace-state surfaced. |
| `is curl installed or do I need to install it` | `workspace_action` (0.95) | Primary signal is the probe; the conditional decision half is non-actionable. workspace-state wins. |

## No-overlap verification

Each test in `describe("no-overlap with adjacent intent families")`:

| Adjacent family | Sample prompts | Asserts |
|---|---|---|
| **shell-execution** | `ls`, `cat package.json`, `npm test` | These do NOT classify `workspace_action` (route to `tool.shell.run` upstream via `isShellTask` and `NATURAL_SHELL_MAP`). |
| **workspace-mutation** | `install curl`, `create a file called notes.md`, `rename foo.ts to bar.ts` | These do NOT classify `workspace_action`. (Currently `ambiguous`; belongs to T8 = workspace-mutation recognition contract.) |
| **generation** | `write a script that checks if curl is installed` | Does NOT classify `workspace_action`. (Currently `standalone_generation`; belongs to T12.) |

## Done checklist

For every canonical intent, the artifact must include (per wayfinder map #376 §Done definition):

- ✅ Recognizer documented (this file)
- ✅ Positive corpus (6 prompts, all routing correctly)
- ✅ Negative corpus (5 prompts, none routing here)
- ✅ Ambiguous corpus (2 prompts with documented routing policy)
- ✅ Confidence boundary (0.95 ≥ 0.7 Layer-1 floor; no fallback exposure)
- ✅ Unit tests for each corpus (`tests/runtime/action-classifier.test.ts`)
- ✅ No-overlap verification against adjacent families (T9 shell-execution, T8 workspace-mutation, T12 generation)

## Provenance

- T1 (#377) on wayfinder map #376
- Bug history: shell-state probes returning `ambiguous` → model fallback non-deterministic → routed to `direct` executor with one-line system prompt → user-visible "I don't have direct access to your system" refusal pattern.
- Recognition contract format anchored here is the template for T7-T13 (workspace-mutation, shell-execution, read-only-analysis, planning, generation, agent-loop-mode).
