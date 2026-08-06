# Canonical-intent taxonomy — chain invariant + ownership matrix

**Status**: Active (T14 on wayfinder map #376).
**Owner**: cross-cutting — see ownership matrix below.
**Recognizer layer**: Layer 1 (`src/runtime/action-classifier.ts`).
**No-reclassification rule**: pinned by `tests/runtime/action-classifier.test.ts → describe("canonical-intent chain — closed-world invariant")`.

This document is the **template anchor** for T7–T13. Each per-family recognition
contract must reference the canonical taxonomy and respect the ownership matrix
here. T7–T13 cannot close until they reconcile against this artifact.

## Chain definition

The runtime canonical-intent chain is four layers. Each layer consumes the
previous layer's label; **no layer re-derives intent from raw prompt text** once
a canonical label is in scope.

```
CanonicalIntent   (top-level taxonomy, semantic)        ← Layer 1
        ↓
TaskType          (planning lens: bugfix | feature |    ← Layer 2 (orthogonal)
                   refactor | docs | research |
                   unknown)
        ↓
ExecutionRoute    (dispatch: direct | tool | chat |     ← Layer 3
                   grounded_chat | agent)
        ↓
Prompt            (exact text + tool manifest +         ← Layer 4
                   permissions sent to the model)
```

**Layer 2 is orthogonal, not in the routing chain.** `TaskType` is the planning
lens consumed by the agent loop (e.g. `agent-loop.ts:140`,
`delegate-tool.ts:28`); it is *not* a re-derivation of `CanonicalIntent`.

## Canonical intents (8)

| Intent | One-line definition |
|---|---|
| **workspace_state** | inspect the local filesystem / shell / repo state; answer is what *is*, not what *could be* |
| **workspace_mutation** | change the local filesystem (create, edit, delete, rename, write) |
| **shell_execution** | run a shell command and observe its output (side-effect-agnostic — read or write, doesn't matter) |
| **read_only_analysis** | explain / summarize / describe / review existing content (analytical reasoning, no execution) |
| **planning** | propose a design, plan, decision, or strategy (no execution; the answer is the *what*, not the *do*) |
| **generation** | produce free-form text or code that is not anchored to the local repo (poem, story, generic example, off-repo script) |
| **arithmetic** | evaluate a pure arithmetic expression and return the numeric answer |
| **external_retrieval** | fetch information the model's training data cannot supply (current web, version, price, release, CVE) |

### Mapping to current `ActionIntent` labels

The current Layer 1 classifier (`src/runtime/action-classifier.ts`) emits 5
`ActionIntent` labels. The 8-intent taxonomy splits one of them into two and
relabels others to match the canonical vocabulary:

| Canonical intent | Current `ActionIntent` | Notes |
|---|---|---|
| `arithmetic` | `arithmetic` | 1:1 |
| `generation` | `generation` | 1:1 (graduated from `standalone_generation` at T12, PR #389) |
| `external_retrieval` | `external_retrieval` | 1:1 |
| `workspace_state` ∪ `workspace_mutation` | `workspace_action` | **currently conflated** — the agent loop distinguishes read-only vs write via `isShellTask` / `isReadOnlyTask`. T7 (workspace-state) and T8 (workspace-mutation) graduate the Layer 1 recognizers so the split surfaces at Layer 1, not inside the agent loop |
| (no canonical label — model fallback) | `ambiguous` | Layer 1 emits `ambiguous` when no signal dominates. Model fallback at `task-router.ts:435` may emit a different label |

**The split of `workspace_action` is the canonical pivot** — the existing
runtime already routes to `agent` either way, so the routing decision does not
change; what changes is *which* canonical intent is emitted at Layer 1 for
auditability and downstream tooling.

### Disambiguation from `kernel/model-routing-validation.ts`

`src/kernel/model-routing-validation.ts` defines a **separate** enum also
called `CanonicalIntent` (`read_info`, `summarize`, `research`, `fix_bug`,
`add_feature`, `refactor`, `write_doc`, `audit_config`, `run_command`,
`generate_plan`). That taxonomy is for **M0.9-F model-tier validation** —
which model to route a prompt to — and is **not** the runtime canonical
taxonomy. The two taxonomies will not be unified in this map. They serve
different layers of the stack.

## Ownership matrix

For each canonical intent, which classifier currently routes to it and which
downstream layer consumes the label. **Owner = the file/symbol whose change
shapes the label's surface.**

| Canonical intent | Layer-1 owner | Layer-3 consumer | Layer-4 consumer | Status |
|---|---|---|---|---|
| `arithmetic` | `classifyAction` (`action-classifier.ts:385`) | `taskRouter` (`task-router.ts:363`) | `route-prompts.ts` `buildDirectPrompt` (T16 #393) | Active |
| `generation` | `classifyAction` (`action-classifier.ts:422`, `GENERATION_SIGNALS`) | `taskRouter` (`task-router.ts:454` for model fallback, line 412 for deterministic) | `route-prompts.ts` `buildDirectPrompt` (T16 #393) | Active |
| `external_retrieval` | `classifyAction` (`action-classifier.ts:414`, `RETRIEVAL_SIGNALS`) | `taskRouter` (`task-router.ts:413`) | grounded_chat executor | Active |
| `workspace_state` | `classifyAction` + `WORKSPACE_ANCHORS` (workspace-state subset) | `taskRouter` (`task-router.ts:439`) | agent loop → `isReadOnlyTask` carve-out | **Recognition contract pending T7** |
| `workspace_mutation` | `classifyAction` + new recognizer | `taskRouter` (legacy fallback `hasWorkspaceWriteIntent` at line 475) | agent loop | **Recognition contract pending T8** |
| `shell_execution` | `taskRouter` line 377 via `isShellTask` (`task-classifier.ts:142`) | `taskRouter` (line 378, `kind: "tool"`) | shell.run tool | **Recognition contract pending T9** |
| `read_only_analysis` | `classifyAction` (currently `ambiguous` for most) | `taskRouter` (line 485, `classifyTask → "research"` legacy path) | agent loop / chat | **Recognition contract pending T10** |
| `planning` | `classifyAction` (currently `ambiguous` for most) | `taskRouter` (line 485) | chat / agent loop | **Recognition contract pending T11** |
| `agent_loop_mode` | N/A (Layer 4 only) | N/A | `IntentClassifier.classify` (`intent-classifier.ts:27`) | **Recognition contract pending T13** |

**`agent_loop_mode`** is the sticky `AgentIntent` (research / mutation /
validation) emitted inside the agent loop based on observed tool calls. It is
not part of the routing chain but is documented here for completeness —
T13 owns its recognition contract.

**Orthogonal consumers (not in routing chain; not re-classification violations)**:

| Site | Classifier call | Why not a violation |
|---|---|---|
| `cli/commands/research.ts:12` | `classifyTask(query)` | display label only, no routing decision |
| `agent/agent-loop.ts:140` | `classifyTask(task)` | Layer 2 planning lens inside the agent loop |
| `agent/agent-loop.ts:145-146` | `isShellTask`, `isReadOnlyTask` | Layer 2 planning lens — caps iterations, picks read-only vs mutation mode |
| `run/plan-phase.ts:150` | `isReadOnlyTask`, `isShellTask` | Layer 2 planning lens — gates plan phase |
| `agents/delegate-tool.ts:28` | `classifyTask(prompt)` | Layer 2 planning lens — auto-selects subagent role |
| `run/task-loop.ts:315` | `IntentClassifier` (AgentIntent) | Layer 4 agent-loop-mode, orthogonal |
| `run/intent-classifier.ts` | (defines) `AgentIntent` | Layer 4, orthogonal |

## Re-classification audit

Sites in `src/` that take raw prompt text and output an intent label **without**
consuming a previously-computed canonical-intent label from the chain. Each
finding names the file, the line, the kind of violation, and the proposed
follow-on.

### Finding 1 — `src/agent/session.ts:973` (Layer 4 prompt gap — RESOLVED by T16 #393)

```ts
const directBasePrompt =
  "You are ALiX, a helpful AI assistant. Answer concisely.";
```

The hardcoded prompt at line 973 is constructed **without consulting the
canonical intent** — every prompt routed to `kind: "direct"` gets the same
one-liner, regardless of whether the canonical intent was `arithmetic`,
`generation`, or fallback.

**Status: RESOLVED by T16 (#393).** `session.ts:973` now calls
`buildDirectPrompt(route.diagnostic.classification)`, and prompt construction
lives in `src/runtime/route-prompts.ts` (the Layer 4 Prompt module).

Per the note on layer numbering in `layer-3-prompt-audit.md`, the chain
definition below is authoritative: prompt construction is **Layer 4** — it
consumes the canonical-intent label propagated forward by the Layer 3
`ExecutionRoute` dispatch. (The wayfinder map and the T15 audit title call
this a "Layer 3 gap"; that name audits Layer 3's obligation to propagate the
label forward, not the layer the artifact lives in.)

### Finding 2 — `src/runtime/task-router.ts:475-477` (Layer 3 carve-out)

```ts
const hasWorkspaceWriteIntent =
  /^(?:write|put|save|create|make|append|delete|remove|rm)\b[^.\n]*\b(?:to|into|in|as|from|on)\b/i.test(trimmedTask);
if (hasWorkspaceWriteIntent) {
  return { kind: "agent", task, diagnostic: ... };
}
```

The legacy ambiguous-fallback path applies a regex directly to the raw prompt
to decide whether to route to `agent`. This bypasses Layer 1 (`classifyAction`)
and re-derives intent from prompt text.

**Proposed follow-on**: graduate to a T8 (workspace-mutation) ticket — once
T8's Layer 1 recognizer lands, this carve-out becomes a no-op (the regex is
already a subset of T8's positive corpus) and can be deleted. Document for
fix in the T8 implementation.

### Finding 3 — `src/runtime/task-router.ts:485` (Layer 2 read in routing fallback)

```ts
const taskType = classifyTask(task);
if (taskType === "research" || taskType === "docs") {
  return { kind: "chat", prompt: task };
}
```

The legacy ambiguous-fallback path calls `classifyTask(task)` directly to
decide between `chat` and `agent`. The chain as documented does **not** pass
TaskType to Layer 3, so this is reading raw prompt text for an orthogonal
routing decision. Acceptable by current architecture (TaskType is the planning
lens, not part of the routing chain), but should be flagged.

**Proposed follow-on**: T11 (planning family) should graduate a recognizer
that lets Layer 3 distinguish `planning` from `read_only_analysis` without
calling `classifyTask` from inside `taskRouter`.

## Closed-world invariant

The no-reclassification rule is pinned mechanically by a closed-world test in
`tests/runtime/action-classifier.test.ts → describe("canonical-intent chain —
closed-world invariant")`. The test asserts:

- For each of the 8 canonical intents, the positive-corpus prompt routes
  through `classifyActionWithConfidence` → `taskRouter` and produces the
  expected `(intent, kind)` pair.
- Two prompts with different canonical intents produce structurally different
  routes; the routes are determined by the canonical-intent label, not by a
  re-derivation from prompt text.

The test pins Layer 1 → Layer 3 only. Layer 4 prompt construction is covered
separately by `tests/runtime/route-prompts.vitest.ts` (T16–T20 #393–#397):
every Layer 4 builder consumes the canonical-intent label and never accepts
raw prompt text.

## Done checklist

For the canonical-intent chain invariant and ownership matrix (T14):

- ✅ Canonical taxonomy document (this file) — 8 intents with one-line definitions
- ✅ Ownership matrix — every canonical intent has a Layer-1 owner, Layer-3 consumer, Layer-4 consumer
- ✅ Re-classification audit — 3 sites found, classified by severity, routed to follow-on tickets
- ✅ Closed-world test — `tests/runtime/action-classifier.test.ts → describe("canonical-intent chain — closed-world invariant")`
- ✅ Disambiguation from `kernel/model-routing-validation.ts::CanonicalIntent` documented

## Provenance

- T14 (#386) on wayfinder map #376.
- Builds on T1 (#377) workspace-state recognition contract (`docs/intent-contracts/workspace-state.md`).
- Per-family recognizer contracts (T7–T13) reference this taxonomy. Each T7–T13 ticket cannot close until its recognition contract reconciles against the ownership matrix above.
