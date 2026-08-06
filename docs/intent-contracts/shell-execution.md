# Shell-execution intent — recognition contract

**Status**: Active (T9 on wayfinder map #376)
**Owner**: `src/runtime/action-classifier.ts` (`SHELL_EXECUTION_ANCHORS`)
**Test corpus**: `tests/runtime/action-classifier.test.ts → describe("classifyAction — shell-execution recognition contract")`

## Intent definition

A user prompt belongs to the **shell-execution** family when the user wants to **run a shell command and observe its output**. The user is asking the runtime to execute a command — not to inspect current state (workspace-state), mutate a file (workspace-mutation), explain existing text (read-only-analysis), or write free-form prose (generation).

Distinct from adjacent intent families:

| Family | Asks | Means |
|---|---|---|
| **shell-execution** *(this family)* | "run a command, observe output" | command execution, side-effect-agnostic |
| **workspace-state** | "what is the current state?" | shell or filesystem inspection (read-only) |
| **workspace-mutation** | "change the state" | filesystem write |
| **read-only-analysis** | "explain / summarize / describe" | analytical reasoning on existing text |
| **planning** | "decide / propose / recommend" | decision-making, no execution |
| **generation** | "produce new text/code" | free-form authoring |

## Recognizer

**Mechanism**: deterministic regex (`SHELL_EXECUTION_ANCHORS` family in `src/runtime/action-classifier.ts`).
**Trigger precedence**: shell-execution fires AFTER workspace-mutation (so `rm foo.txt` is mutation, not shell) and AFTER workspace-state (so `ls` is shell, but `what's running` is state). When a bare command implies mutation (`rm`, `mv`, `mkdir`, etc.), workspace-mutation wins.
**Confidence**: shell-execution matches return `confidence: 0.85` (≥ 0.7 Layer-1 floor).

### Pattern set (current)

| Pattern | Matches |
|---|---|
| `^\s*(?:ls\|cat\|head\|tail\|grep\|find\|pwd\|echo\|env\|which)\b` | Bare read commands |
| `^\s*(?:npm\|pnpm\|yarn\|node\|npx\|bun)\s+\w` | Package manager / node commands |
| `^\s*(?:git\|docker\|kubectl\|make\|cargo\|go)\s+\w` | Common dev tools |
| `^\s*(?:rm\|mv\|cp\|mkdir\|touch\|chmod)\s+\S` | Mutation commands (note: routed to workspace-mutation instead when deterministic match wins) |
| `\brun\s+(?:the\s+)?(?:npm\|pnpm\|yarn\|tests?\|build\|lint)\b` | "run npm test", "run the build" |
| `\bexecute\s+` | "execute X" |

## Confidence boundary

- Layer 1 hit with confidence ≥ 0.7 → route to `ExecutionRoute.tool` (shell.run tool).
- Below 0.7 → falls to `ambiguous`, then to model fallback (`modelClassifyAction`).
- The patterns above yield `confidence: 0.85`; the boundary has zero fallback exposure for direct command matches.

## Positive corpus (must classify `shell_execution`)

Each test in `tests/runtime/action-classifier.test.ts → describe("positive corpus")`:

| Prompt | Intent | Confidence |
|---|---|---|
| `ls` | `shell_execution` | 0.85 |
| `ls -la` | `shell_execution` | 0.85 |
| `cat package.json` | `shell_execution` | 0.85 |
| `npm test` | `shell_execution` | 0.85 |
| `npm run build` | `shell_execution` | 0.85 |
| `git status` | `shell_execution` | 0.85 |
| `find . -name '*.ts'` | `shell_execution` | 0.85 |
| `run the build` | `shell_execution` | 0.85 |
| `execute the migration` | `shell_execution` | 0.85 |

## Negative corpus (must NOT classify `shell_execution`)

| Prompt | Expected NOT-shell_execution because |
|---|---|
| `is curl installed` | belongs to workspace-state |
| `what's running on port 3000` | belongs to workspace-state |
| `create foo.ts` | belongs to workspace-mutation |
| `rm foo.txt` | belongs to workspace-mutation (mutation verbs win over bare shell) |
| `explain the install process` | belongs to read-only-analysis |
| `should I use X or Y` | belongs to planning |
| `write a poem about X` | belongs to generation |

## Ambiguous corpus (mixed-intent routing policy)

| Prompt | Layer-1 classification | Policy |
|---|---|---|
| `what's in package.json` | `shell_execution` (`cat package.json`) | The imperative "what's in X" maps to `cat`; shell wins. |
| `remove foo.ts and check git status` | `workspace_mutation` | Mutation verb wins over shell; the second clause is an observed side-effect. |
| `run npm test and explain failures` | `shell_execution` | Primary action is execution; the "explain" is downstream analysis. |

## No-overlap verification

| Adjacent family | Sample prompts | Asserts |
|---|---|---|
| **workspace-state** | `is curl installed`, `what's running on port 3000` | These do NOT classify `shell_execution`. |
| **workspace-mutation** | `create foo.ts`, `rm foo.txt`, `mv foo bar` | These do NOT classify `shell_execution`. |
| **read-only-analysis** | `explain the install process` | Does NOT classify `shell_execution`. |
| **planning** | `should I use X or Y` | Does NOT classify `shell_execution`. |
| **generation** | `write a poem about X` | Does NOT classify `shell_execution`. |

## Taxonomy binding

This contract IS the Layer-1 recognizer for the canonical `shell_execution` intent. Per the canonical-taxonomy ownership matrix:

| Canonical intent | Layer-1 owner | Layer-3 consumer | Layer-4 consumer | Status |
|---|---|---|---|---|
| `shell_execution` | `classifyAction` (`action-classifier.ts:SHELL_EXECUTION_ANCHORS`) | `taskRouter` (line 378, `kind: "tool"`) | shell.run tool | **Active (T9)** |

### Chain position

Canonical-intent chain (4 layers):
```
CanonicalIntent (semantic)        ← Layer 1 — THIS recognizer
  ↓
TaskType (planning lens)
  ← Layer 2 — orthogonal, not in routing chain
  ↓
ExecutionRoute (dispatch)
  ← Layer 3 — consumer of Layer 1 label
  ↓
Prompt
  ← Layer 4
```

This recognizer sits at Layer 1. Layer 3 dispatches to `kind: "tool"` and Layer 4 invokes `shell.run`. The existing `isShellTask` at `task-classifier.ts:142` remains as the Layer-2 planning lens for the agent loop — it is orthogonal, not re-derived from prompt text inside the routing chain.

### Reconcile with `isShellTask` (`task-classifier.ts:142`)

`isShellTask` continues to exist as a Layer-2 planning lens. It is NOT deleted by T9. Layer 1 emits `shell_execution` based on deterministic regex; Layer 2's `isShellTask` is the agent loop's planning-lens view (used to decide whether the agent should adopt a shell-execution sub-strategy). They serve different purposes.

## Done checklist

- ✅ Recognizer documented (this file)
- ✅ Positive corpus (≥6 prompts, all routing correctly)
- ✅ Negative corpus (≥5 prompts, none routing here)
- ✅ Ambiguous corpus (≥2 prompts with documented routing policy)
- ✅ Confidence boundary (0.85 ≥ 0.7 Layer-1 floor)
- ✅ Unit tests for each corpus (`tests/runtime/action-classifier.test.ts`)
- ✅ No-overlap verification against adjacent families (T7, T8, T10, T11, T12)
- ✅ Taxonomy binding to `canonical-taxonomy.md`

## Provenance

- T9 (#385) on wayfinder map #376
- Builds on T14 (#386) canonical-taxonomy + ownership matrix
- Depends on T1 (#377) workspace-state recognizer (precedent for per-family contract format)
- Reconciles with `isShellTask` at `task-classifier.ts:142` (Layer-2 planning lens, orthogonal)
