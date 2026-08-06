# Read-only-analysis intent — recognition contract

**Status**: Active (T10 on wayfinder map #376)
**Owner**: `src/runtime/action-classifier.ts` (`READ_ONLY_ANALYSIS_ANCHORS`)
**Test corpus**: `tests/runtime/action-classifier.test.ts → describe("classifyAction — read-only-analysis recognition contract")`

## Intent definition

A user prompt belongs to the **read-only-analysis** family when it asks the runtime to **explain, summarize, describe, review, analyze, or compare existing content** — distinct from `workspace_state` (inspect local repo), `generation` (produce new text), and `planning` (decide/propose).

Distinct from adjacent intent families:

| Family | Asks | Means |
|---|---|---|
| **read-only-analysis** *(this family)* | "explain / summarize / describe / review" | analytical reasoning on existing content |
| **workspace-state** | "what is the current state?" | shell or filesystem inspection |
| **workspace-mutation** | "change the state" | filesystem write |
| **shell-execution** | "run a command, observe output" | command execution |
| **planning** | "decide / propose / recommend" | decision-making, no execution |
| **generation** | "produce new text/code" | free-form authoring |

## Recognizer

**Mechanism**: deterministic regex (`READ_ONLY_ANALYSIS_ANCHORS` family in `src/runtime/action-classifier.ts`).
**Trigger precedence**: read-only-analysis fires AFTER workspace (state and mutation win) and BEFORE generation/external_retrieval. When T11 (planning) is integrated, planning dominates read_only_analysis.
**Confidence**: read-only-analysis matches return `confidence: 0.85` (≥ 0.7 Layer-1 floor).

### Pattern set (current)

| Pattern | Matches |
|---|---|
| `\b(?:explain|summarize|describe|review|analyze|examine|inspect)\s+` | Direct verb forms: "explain X", "summarize README.md" |
| `\bcompare\s+\S+\s+(?:to|with|against)\s+\S+` | "compare X to Y" |
| `\bwhat\s+(?:does|is|are)\s+\S+` | "what is X", "what does X do" |
| `\bhow\s+(?:does|do|is|are)\s+\S+` | "how does X work" |
| `\bwalk\s+(?:me\s+)?through\b` | "walk me through X" |
| `\btell\s+me\s+about\b` | "tell me about X" |
| `\b(?:give\s+me\s+(?:an?\s+)?)?overview\s+of\b` | "give me an overview of X" |
| `\b(?:what(?:'s\|\s+is)\s+)?(?:the\s+)?difference\s+between\b` | "what's the difference between X and Y" |
| `\bpros\s+(?:and\|&)\s+cons\b` | "pros and cons" |

## Confidence boundary

- Layer 1 hit with confidence ≥ 0.7 → route to `ExecutionRoute.chat`.
- Below 0.7 → falls to `ambiguous`, then to model fallback (`modelClassifyAction`).
- Direct verb matches yield `confidence: 0.85`; question forms (`what is X`) yield `0.75`.

## Positive corpus (must classify `read_only_analysis`)

Each test in `tests/runtime/action-classifier.test.ts → describe("positive corpus (must classify read_only_analysis)")`:

| Prompt | Intent | Confidence |
|---|---|---|
| `explain the install process` | `read_only_analysis` | 0.85 |
| `summarize README.md` | `read_only_analysis` | 0.85 |
| `describe how X works` | `read_only_analysis` | 0.85 |
| `review this PR` | `read_only_analysis` | 0.85 |
| `compare X to Y` | `read_only_analysis` | 0.85 |
| `walk me through the auth flow` | `read_only_analysis` | 0.85 |
| `analyze the auth flow` | `read_only_analysis` | 0.85 |
| `what is dependency injection` | `read_only_analysis` | 0.75 |

## Negative corpus (must NOT classify `read_only_analysis`)

| Prompt | Expected NOT-read_only_analysis because |
|---|---|
| `is curl installed` | belongs to workspace-state |
| `do I have docker` | belongs to workspace-state |
| `create foo.ts` | belongs to workspace-mutation |
| `write a poem about X` | belongs to generation |
| `should I use X or Y` | belongs to planning |
| `ls` | belongs to shell-execution |

## Ambiguous corpus (mixed-intent routing policy)

| Prompt | Layer-1 classification | Policy |
|---|---|---|
| `tell me about X` | `read_only_analysis` | Verb form ("tell me about") is unambiguously analytical. |
| `analyze the codebase` | `workspace_action` | Workspace anchor (`the codebase`) wins over the analytical verb. Trigger precedence: workspace first. |
| `what is running on port 3000` | `workspace_action` | State probe wins over the question form. Trigger precedence: workspace first. |

## No-overlap verification

| Adjacent family | Sample prompts | Asserts |
|---|---|---|
| **workspace-state** | `is curl installed` | classifies as `workspace_action`, not `read_only_analysis` |
| **generation** | `write a poem about X` | classifies as `standalone_generation`, not `read_only_analysis` |

## Taxonomy binding

This contract IS the Layer-1 recognizer for the canonical `read_only_analysis` intent. Per the canonical-taxonomy ownership matrix:

| Canonical intent | Layer-1 owner | Layer-3 consumer | Layer-4 consumer | Status |
|---|---|---|---|---|
| `read_only_analysis` | `classifyAction` (`action-classifier.ts:READ_ONLY_ANALYSIS_ANCHORS`) | `taskRouter` (legacy fallback `classifyTask → "research"` at line 485) | chat / agent loop | **Active (T10)** |

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

This recognizer sits at Layer 1. Layer 3 dispatches `read_only_analysis` to `kind: "chat"` (the legacy fallback path). Future T11 integration will let Layer 3 distinguish `planning` from `read_only_analysis` without needing the `classifyTask` call.

### Reconcile with `task-router.ts:485` `classifyTask → "research"`

The legacy Layer-2 planning-lens call remains orthogonal. It is NOT deleted by T10. The closed-world invariant test for `kind: "chat"` continues to pin Layer 1 → Layer 3 routing. The `classifyTask` fallback inside `taskRouter:485` is documented as Finding 3 in canonical-taxonomy.md and tracked as a follow-on.

## Done checklist

- ✅ Recognizer documented (this file)
- ✅ Positive corpus (8 prompts, all routing correctly)
- ✅ Negative corpus (6 prompts, none routing here)
- ✅ Ambiguous corpus (3 prompts with documented routing policy)
- ✅ Confidence boundary (0.85 ≥ 0.7 Layer-1 floor)
- ✅ Unit tests for each corpus (`tests/runtime/action-classifier.test.ts`)
- ✅ No-overlap verification against adjacent families (T7, T8, T9, T11, T12)
- ✅ Taxonomy binding to `canonical-taxonomy.md`

## Provenance

- T10 (#387) on wayfinder map #376
- Builds on T14 (#386) canonical-taxonomy + ownership matrix
- Depends on T1 (#377) workspace-state recognizer (precedent for per-family contract format)
- Reconciles with canonical-taxonomy Re-classification audit Finding 3
- Recognition contract format anchored here is the template for T13 (agent-loop-mode)
