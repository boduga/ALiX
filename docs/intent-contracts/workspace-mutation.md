# Workspace-mutation intent — recognition contract

**Status**: Active (T8 on wayfinder map #376)
**Owner**: `src/runtime/action-classifier.ts` (`MUTATION_ANCHORS`)
**Test corpus**: `tests/runtime/action-classifier.test.ts → describe("classifyAction — workspace-mutation recognition contract")`

## Intent definition

A user prompt belongs to the **workspace-mutation** family when it asks the runtime to **change the local filesystem** — create, edit, delete, rename, install, etc. — distinct from `workspace_action` (state, read-only probes) and `shell_execution` (run a command, observe output).

Distinct from adjacent intent families:

| Family | Asks | Means |
|---|---|---|
| **workspace-mutation** *(this family)* | "change the state" | filesystem write |
| **workspace-state** | "what is the current state?" | shell or filesystem inspection (read-only) |
| **shell-execution** | "run a command, observe output" | command execution |
| **read-only-analysis** | "explain / summarize / describe" | analytical reasoning on existing text |
| **planning** | "decide / propose / recommend" | decision-making, no execution |
| **generation** | "produce new text/code" | free-form authoring |

## Recognizer

**Mechanism**: deterministic regex (`MUTATION_ANCHORS` family in `src/runtime/action-classifier.ts`).
**Trigger precedence**: workspace-mutation fires AFTER workspace-state (state first, then mutation) so that probes with conditional mutation ("is curl installed or do I need to install it") classify as state — preserves T1's documented ambiguous-corpus policy.
**Confidence**: workspace-mutation matches return `confidence: 0.95` (≥ 0.7 Layer-1 floor), which short-circuits the model fallback.

### Pattern set (current)

| Pattern | Matches |
|---|---|
| `^(?:install|uninstall|create|delete|remove|rm|rename|edit|update|touch|mkdir|chmod|chown)\s+\S+` | Imperative verbs at the start of the prompt: "install curl", "create foo.ts", "delete foo.txt" |
| `\b(?:write|put|save|create|make|append|delete|remove|rm)\s+\S+\s+(?:to|into|in|as|from|on)\b` | Superset of legacy `hasWorkspaceWriteIntent` carve-out (now deleted) |
| `\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:file|directory|folder|script|module|component|class|function|endpoint|note|document|test|spec|backup)\b` | Create-new mutation forms |
| `\b(?:rename|move|mv)\s+\S+\s+(?:to|into)\b` | Rename / move forms |
| `\bmake\s+(?:a\s+|an\s+|the\s+)?(?:file|directory|note|script|module|change|list|plan|copy|backup)\b` | "make a X" creation |
| `\bsave\s+(?:changes|the\s+\S+|\S+\s+to)\b` | Save forms |
| `\b(?:write|save)\s+(?:a\s+|an\s+|the\s+)?(?:file|changes|notes|document|backup)\b` | Write/save with object |

## Confidence boundary

- Layer 1 hit with confidence ≥ 0.7 → route to `ExecutionRoute.agent` (full system prompt + tool access).
- Below 0.7 → falls to `ambiguous`, then to model fallback (`modelClassifyAction`).
- The patterns above all yield `confidence: 0.95`; the boundary has zero fallback exposure for direct matches.

## Positive corpus (must classify `workspace_mutation`)

Each test in `tests/runtime/action-classifier.test.ts → describe("positive corpus (must classify workspace_mutation)")`:

| Prompt | Intent | Confidence |
|---|---|---|
| `create foo.ts` | `workspace_mutation` | 0.95 |
| `create a file called notes.md` | `workspace_mutation` | 0.95 |
| `rename foo.ts to bar.ts` | `workspace_mutation` | 0.95 |
| `delete foo.txt` | `workspace_mutation` | 0.95 |
| `remove the cache from npm` | `workspace_mutation` | 0.95 |
| `install curl` | `workspace_mutation` | 0.95 |
| `edit config.ts` | `workspace_mutation` | 0.95 |
| `update README.md` | `workspace_mutation` | 0.95 |
| `save changes` | `workspace_mutation` | 0.95 |
| `mkdir foo` | `workspace_mutation` | 0.95 |

## Negative corpus (must NOT classify `workspace_mutation`)

| Prompt | Expected NOT-workspace_mutation because |
|---|---|
| `is curl installed` | belongs to workspace-state |
| `do I have docker` | belongs to workspace-state |
| `what is running on port 3000` | belongs to workspace-state |
| `write a poem about X` | belongs to generation |
| `should I use X or Y` | belongs to planning |
| `explain the install process` | belongs to read-only-analysis (the noun "install" is part of an explanation, not an imperative) |
| `ls` | belongs to shell-execution |

## Ambiguous corpus (mixed-intent routing policy)

| Prompt | Layer-1 classification | Policy |
|---|---|---|
| `is curl installed or do I need to install it` | `workspace_action` (state wins) | State probe matches; mutation clause is conditional. State wins. |
| `if curl isn't installed, install it` | `ambiguous` | Neither state pattern matches ("isn't installed" doesn't match `\b(?:is|are)\s+...`) nor mutation (mid-prompt "install it" doesn't match leading-verb pattern). Falls to Layer 2. |

## No-overlap verification

| Adjacent family | Sample prompts | Asserts |
|---|---|---|
| **workspace-state** | `is curl installed` | classifies as `workspace_action`, not `workspace_mutation` |
| **shell-execution** | `ls` | classifies as `ambiguous`, not `workspace_mutation` |
| **generation** | `write a poem about X` | classifies as `standalone_generation`, not `workspace_mutation` |

## Taxonomy binding

This contract IS the Layer-1 recognizer for the canonical `workspace_mutation` intent. Per the canonical-taxonomy ownership matrix:

| Canonical intent | Layer-1 owner | Layer-3 consumer | Layer-4 consumer | Status |
|---|---|---|---|---|
| `workspace_mutation` | `classifyAction` (`action-classifier.ts:MUTATION_ANCHORS`) | `taskRouter` (line 352, `kind: "agent"`) | agent loop | **Active (T8)** |

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

This recognizer sits at Layer 1. Layer 3 dispatches `workspace_mutation` to `kind: "agent"` (same path as `workspace_action`).

### Reconcile with `task-router.ts:475-477` `hasWorkspaceWriteIntent`

The legacy carve-out was a regex re-derivation of intent from raw prompt text that bypassed Layer 1's `classifyAction`. As of T8, the `MUTATION_ANCHORS` family is a strict superset of the carve-out's verb set (`write|put|save|create|make|append|delete|remove|rm`) and surfaces `workspace_mutation` at Layer 1. The carve-out is **deleted** as a no-op. The `classifyTask` Layer-2 call at `task-router.ts:485` remains as the orthogonal planning lens.

## Done checklist

- ✅ Recognizer documented (this file)
- ✅ Positive corpus (10 prompts, all routing correctly)
- ✅ Negative corpus (7 prompts, none routing here)
- ✅ Ambiguous corpus (2 prompts with documented routing policy)
- ✅ Confidence boundary (0.95 ≥ 0.7 Layer-1 floor)
- ✅ Unit tests for each corpus (`tests/runtime/action-classifier.test.ts`)
- ✅ No-overlap verification against adjacent families (T7, T9, T11, T12)
- ✅ Taxonomy binding to `canonical-taxonomy.md`
- ✅ Legacy `hasWorkspaceWriteIntent` carve-out deleted as no-op

## Provenance

- T8 (#388) on wayfinder map #376
- Builds on T14 (#386) canonical-taxonomy + ownership matrix
- Depends on T1 (#377) workspace-state recognizer (precedent for per-family contract format)
- Reconciles with `hasWorkspaceWriteIntent` carve-out at `task-router.ts:475-477` (deleted)
- Recognition contract format anchored here is the template for T9/T10/T11/T12
