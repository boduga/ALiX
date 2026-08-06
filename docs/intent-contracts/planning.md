# Planning intent — recognition contract

**Status**: Active (T11 on wayfinder map #376)
**Owner**: `src/runtime/action-classifier.ts` (`PLANNING_ANCHORS`)
**Test corpus**: `tests/runtime/action-classifier.test.ts → describe("classifyAction — planning recognition contract")`

## Intent definition

A user prompt belongs to the **planning** family when it asks the runtime to **make a choice, propose an approach, recommend a library, or compare alternatives** — NOT to inspect current state, execute a command, mutate a file, or read-only explain existing text. The answer is a decision or a proposal, not an observation or an action.

Distinct from adjacent intent families:

| Family | Asks | Means |
|---|---|---|
| **planning** *(this family)* | "decide / propose / recommend" | decision-making, no execution |
| **workspace-state** | "what is the current state?" | shell or filesystem inspection |
| **workspace-mutation** | "change the state" | filesystem write |
| **shell-execution** | "run a command, observe output" | command execution |
| **read-only-analysis** | "explain / summarize / describe" | analytical reasoning on existing text |
| **generation** | "produce new text/code" | free-form authoring |

## Recognizer

**Mechanism**: deterministic regex (`PLANNING_ANCHORS` family in `src/runtime/action-classifier.ts`).
**Trigger precedence**: planning fires AFTER `standalone_generation` (so "write a plan for X" routes to generation, not planning — the noun "plan" is the object of a generative verb, not the imperative verb "plan" itself) and BEFORE the `ambiguous` fallback. Planning dominates `read_only_analysis`, which is currently absorbed by the `ambiguous` bucket.
**Confidence**: planning matches return `confidence: 0.85` (≥ 0.7 Layer-1 floor), which short-circuits the model fallback.

### Pattern set (current)

| Pattern | Matches |
|---|---|
| `\bshould\s+(?:i|we)\s+(?:use\|adopt\|migrate\|switch\|upgrade\|refactor\|implement\|add\|remove\|drop)\b` | "should I use X", "should we adopt X" |
| `\bdesign\s+(?:a\s+|the\s+|an?\s+)?\w` | "design a cache layer", "design the auth flow" |
| `\bplan\s+(?:the\|a\|an\|my\|our)\s+\w` | "plan the migration", "plan a refactor" (imperative planning verb) |
| `\bpropose\s+(?:a\s+|an\s+|the\s+)?\w` | "propose an architecture" |
| `\brecommend\s+(?:a\s+|an\s+|the\s+)?\w` | "recommend a library" |
| `\bdecide\s+(?:between\|on\|whether\|if)\b` | "decide between A and B", "decide on the approach" |
| `\bchoose\s+between\b` | "choose between X and Y" |
| `\bwhat(?:'s\|\s+is)\s+the\s+best\s+\w+` | "what's the best way to do X" |
| `\bcompare\s+(?:options\|alternatives\|approaches)\b` | "compare options for X" |

## Confidence boundary

- Layer 1 hit with confidence ≥ 0.7 → route to `ExecutionRoute.chat` (full system prompt + tool access).
- Below 0.7 → falls to `ambiguous`, then to model fallback (`modelClassifyAction`).
- The patterns above all yield `confidence: 0.85`; the boundary has zero fallback exposure for direct decision-verb matches.

## Positive corpus (must classify `planning`)

Each test in `tests/runtime/action-classifier.test.ts → describe("positive corpus (must classify planning)")`:

| Prompt | Intent | Confidence |
|---|---|---|
| `should I use X or Y` | `planning` | 0.85 |
| `should we adopt X` | `planning` | 0.85 |
| `design a cache layer` | `planning` | 0.85 |
| `plan the migration` | `planning` | 0.85 |
| `propose an architecture` | `planning` | 0.85 |
| `recommend a library` | `planning` | 0.85 |

## Negative corpus (must NOT classify `planning`)

| Prompt | Expected NOT-planning because |
|---|---|
| `explain the install process` | belongs to read-only-analysis |
| `summarize README.md` | belongs to read-only-analysis |
| `write a poem about X` | belongs to generation |
| `write a plan for X` | belongs to generation (noun-after-determiner form; documented in `GENERATION_SIGNALS` regex comment) |
| `ls` | belongs to shell-execution |
| `is curl installed` | belongs to workspace-state |

Negative tests assert `intent !== "planning"`. Pre-T11, all planning-flavored prompts landed in `ambiguous`; after T11, they route correctly.

## Ambiguous corpus (mixed-intent routing policy)

| Prompt | Layer-1 classification | Policy |
|---|---|---|
| `explain git to me` | `read_only_analysis` | "explain" is a read-only-analysis verb; the question form doesn't imply decision-making. |
| `what's the best way to do X` | `planning` | Decision framing; "best" implies choosing among alternatives. |
| `compare X and Y for our use case` | `ambiguous` (0.5) | Mixed read-only-analysis + planning; defer to Layer 2 so the chain sees both halves. |

## No-overlap verification

| Adjacent family | Sample prompts | Asserts |
|---|---|---|
| **read-only-analysis** | `explain the install process`, `summarize README.md` | These do NOT classify `planning`. (Currently `ambiguous`; will graduate when T10 ships.) |
| **generation** | `write a poem about X`, `write a plan for migration` | These do NOT classify `planning`. |
| **workspace-state** | `is curl installed`, `what's running on port 3000` | These do NOT classify `planning`. |
| **workspace-mutation** | `create foo.ts`, `rename X to Y` | These do NOT classify `planning`. |
| **shell-execution** | `ls`, `cat package.json` | These do NOT classify `planning`. |

## Taxonomy binding

This contract IS the Layer-1 recognizer for the canonical `planning` intent. Per the canonical-taxonomy ownership matrix:

| Canonical intent | Layer-1 owner | Layer-3 consumer | Layer-4 consumer | Status |
|---|---|---|---|---|
| `planning` | `classifyAction` (`action-classifier.ts:PLANNING_ANCHORS`) | `taskRouter` (line 485 legacy `classifyTask → "research"`) | chat / agent loop | **Active (T11)** |

### Chain position

Canonical-intent chain (4 layers):
```
CanonicalIntent (semantic)        ← Layer 1 — THIS recognizer
  ↓
TaskType (planning lens: bugfix | feature | refactor | docs | research | unknown)
  ← Layer 2 — orthogonal, not in routing chain
  ↓
ExecutionRoute (dispatch: direct | tool | chat | grounded_chat | agent)
  ← Layer 3 — consumer of Layer 1 label
  ↓
Prompt (exact text + tool manifest + permissions sent model)
  ← Layer 4
```

This recognizer sits at Layer 1. Layer 3 currently routes `planning` via the legacy ambiguous-fallback at `task-router.ts:485` (`classifyTask → "research"` → `kind: "chat"`). Removing that fallback and routing `planning` directly is tracked separately per `canonical-taxonomy.md` Finding 3 — T11 enables this; the actual removal is a future refactor.

### Reconcile with `task-router.ts:485`

`classifyTask` (Layer-2 planning lens) remains as an orthogonal consumer — it does NOT re-derive the canonical intent from raw prompt text inside the routing chain. It is called from `taskRouter:485` only when `classifyAction` returns `ambiguous`, and that path is acceptable by current architecture (TaskType is the planning lens, not part of the routing chain). T11 enables removing this fallback in a future ticket.

## Done checklist

- ✅ Recognizer documented (this file)
- ✅ Positive corpus (≥6 prompts, all routing correctly)
- ✅ Negative corpus (≥5 prompts, none routing here)
- ✅ Ambiguous corpus (≥2 prompts with documented routing policy)
- ✅ Confidence boundary (0.85 ≥ 0.7 Layer-1 floor)
- ✅ Unit tests for each corpus (`tests/runtime/action-classifier.test.ts`)
- ✅ No-overlap verification against adjacent families (T7, T8, T9, T10, T12)
- ✅ Taxonomy binding to `canonical-taxonomy.md`

## Provenance

- T11 (#391) on wayfinder map #376
- Builds on T14 (#386) canonical-taxonomy + ownership matrix
- Depends on T1 (#377) workspace-state recognizer (precedent for per-family contract format)
- Reconciles with canonical-taxonomy Re-classification audit Finding 3
- Recognition contract format anchored here is the template for T8/T9/T10/T12 (per the workspace-state template)
