# Generation intent — recognition contract

**Status**: Active (T12, PR #389 on wayfinder map #376)
**Owner**: `src/runtime/action-classifier.ts` (`GENERATION_SIGNALS`)
**Test corpus**: `tests/runtime/action-classifier.test.ts → describe("classifyAction — generation recognition contract")`

## Intent definition

A user prompt belongs to the **generation** family when it asks the runtime to **author new text or code** in response — no inspection of the local system, no external lookup, no decision. The answer is produced entirely by the model's own generative capacity; nothing on disk or on the wire needs to be read first.

Distinct from adjacent intent families:

| Family | Asks | Means |
|---|---|---|
| **generation** *(this family)* | "produce new text/code" | free-form authoring |
| **workspace-state** | "what is the current state?" | shell or filesystem inspection |
| **workspace-mutation** | "change the state" | filesystem write |
| **shell-execution** | "run a command, observe output" | command execution |
| **external-retrieval** | "look up something fresh" | web / docs search |
| **read-only-analysis** | "explain / summarize / describe" | analytical reasoning on existing text |
| **planning** | "design / propose / decide" | decision-making, no execution |
| **arithmetic** | "compute X" | exact numeric compute |

## Recognizer

**Mechanism**: deterministic regex (`GENERATION_SIGNALS` family in `src/runtime/action-classifier.ts`).
**Trigger precedence**: generation is the **default positive** — it dominates `ambiguous` (line 319) and is short-circuited only by `arithmetic` (Layer 1 → returns `direct` with `answer`) and `workspace_action` (Layer 1 → returns `agent`). Retrieval (`external_retrieval`) is a separate Layer-1 family that does **not** dominate generation; see "No-overlap" below.
**Confidence**: generation matches return `confidence: 0.85` (≥ 0.7 Layer-1 floor).

### Pattern set (current)

| Pattern | Matches |
|---|---|
| `\bwrite\s+(?:a\|an\|the\|me\|some)\s+(?:poem\|story\|essay\|function\|script\|snippet\|example\|joke\|email\|letter\|song\|haiku\|limerick\|paragraph\|biography\|summary)\b` | "write a poem/story/function/script" |
| `\bdraft\s+(?:a\|an\|the\|me\|some)\b` | "draft a memo/letter/essay" |
| `\bmake\s+up\s+(?:a\|an\|the\|me\|some)\b` | "make up a story/joke/excuse" |
| `\bgenerate\s+(?:a\|an\|the\|me\|some)\b` | "generate a/an/the/me/some …" |
| `\bcompose\s+(?:a\|an\|the\|me\|some)\b` | "compose a/an/the/me/some …" |
| `\bin\s+(?:python\|javascript\|typescript\|java\|c\+\+\|go\|rust\|ruby\|php\|swift\|kotlin)\b` | "Write Fibonacci function in Python" |
| `\bexplain\s+\S[\s\S]{0,80}?\s+to\s+me\b` | "explain X to me" with no workspace anchor |

## Confidence boundary

- Layer 1 hit with confidence ≥ 0.7 → route to `ExecutionRoute.direct` (one model call, no tool loop).
- Below 0.7 → falls to `ambiguous` (0.5), then to model fallback (`modelClassifyAction`).
- Generation confidence is `0.85`, below the `0.95` reserved for `workspace_action`. The gap is intentional: workspace probes are exact (the shell can answer them), generation is "ask the model for new content" which is more brittle than probing local state.

## Positive corpus (must classify `generation`)

Each test in `tests/runtime/action-classifier.test.ts → describe("positive corpus")`:

| Prompt | Reason |
|---|---|
| `write a poem about the sea` | `\bwrite a poem\b` hit |
| `generate a function that reverses a string` | `\bgenerate a\b` hit |
| `draft a memo on remote work` | `\bdraft a\b` hit |
| `compose a song about rain` | `\bcompose a\b` hit |
| `make up a story about a dragon` | `\bmake up a\b` hit |
| `Write Fibonacci function in Python` | `\bin python\b` hit |
| `Explain SQL to me` | `\bexplain … to me\b` hit (no workspace anchor) |

## Negative corpus (must NOT classify `generation`)

Each test in `describe("negative corpus")`:

| Prompt | Owned by |
|---|---|
| `is curl installed on this machine` | workspace_state (T7) |
| `what files are in this repo` | workspace_state (T7) |
| `Add a Fibonacci implementation to my repo` | workspace_mutation (T8) |
| `remove cache from npm` | workspace_mutation (T8) |
| `ls` | shell_execution (T9) |
| `list files` | shell_execution (T9) |
| `what is dependency injection` | read_only_analysis (T10) |
| `plan the migration to postgres` | planning (T11) |
| `2 + 2` | arithmetic |
| `latest Kubernetes release version` | external_retrieval |

Negative tests assert `intent !== "generation"`.

## Ambiguous corpus (documented policy, not accident)

| Prompt | Layer-1 classification | Policy |
|---|---|---|
| `write a script that checks if curl is installed` | `generation` (0.85) | The prompt asks the runtime to **author** a script — produce text for the user to read — not to **execute** it. Generation wins over shell_execution because the user did not ask for execution; they asked for authoring. The same subject matter ("is curl installed") flips to `workspace_action` when the prompt carries a `WORKSPACE_ANCHOR` (e.g. `is curl installed on this machine`). |
| `is curl installed on this machine` | `workspace_action` (0.95) | The anchored probe of the same subject matter — workspace-state wins over generation because workspace-state returns a fact rather than authored text. |

The two prompts above are **the same subject matter** routed by anchor presence; both policies are pinned and tested (see `workspace-state.md` line 85 for the cross-reference).

## No-overlap verification

Each test in `describe("no-overlap with sibling recognizer families")`:

| Sibling family | Asserts |
|---|---|
| **arithmetic** | generation positives (`write a poem`, `draft a memo`, `make up a story`, `compose a song`) do **not** classify `arithmetic`. |
| **workspace_action** | generation positives do not classify `workspace_action`. |
| **external_retrieval** | generation positives do not classify `external_retrieval`. |

This asserts the precedence tiers (arithmetic → workspace → retrieval → generation) leave generation **reachable** rather than starved — a future recognizer graduation (T7-T11) must not silently steal these prompts.

## Done checklist

For every canonical intent, the artifact must include (per wayfinder map #376 §Done definition):

- ✅ Recognizer documented (this file)
- ✅ Positive corpus (7 prompts, all routing correctly)
- ✅ Negative corpus (10 prompts, none routing here)
- ✅ Ambiguous corpus (2 prompts with documented routing policy)
- ✅ Confidence boundary (0.85 ≥ 0.7 Layer-1 floor; direct route, no model fallback for hits)
- ✅ Unit tests for each corpus (`tests/runtime/action-classifier.test.ts`)
- ✅ No-overlap verification against adjacent families (T7, T8, T9, T10, T11, T13)

## Provenance

- T12 (#389) on wayfinder map #376
- The `ActionIntent` value was previously spelled `standalone_generation` (per `docs/intent-contracts/canonical-taxonomy.md` mapping table — `generation ← standalone_generation, 1:1`). T12 graduated it to the canonical `generation` label to align the runtime label with the canonical intent family vocabulary. The rename touched `src/runtime/action-classifier.ts` (type union, return, confidence case, system prompt, VALID list, three comments), `src/runtime/task-router.ts` (Layer-3 dispatch check at lines 421/454), and the test files that assert the string (`tests/runtime/{action-classifier,task-router,route-executor}.test.ts`, `tests/daemon/daemon-server.test.ts`, `tests/agent/session-direct-path.vitest.ts`).
- Recognition contract format anchored here is the template for T13 (agent-loop-mode) and any future recognizer addition.

## Taxonomy binding

- Canonical intent: **`generation`** (per `docs/intent-contracts/canonical-taxonomy.md`).
- Current `ActionIntent` label: **`generation`** (graduated from `standalone_generation` at T12).
- Mapping: **1:1** (no other canonical intent shares a recognizer family with generation).