# Agent-loop-mode recognition contract

**Status**: Active (PR delivering T13 on wayfinder map #376)
**Owner**: `src/run/intent-classifier.ts` (`IntentClassifier`)
**Test corpus**: `tests/run/intent-classifier.test.ts`
**Call site**: `src/run/task-loop.ts:315` (the agent loop reads the
sticky `AgentIntent` to choose the per-iteration progress supplement
and the section name in the progress ledger).

## Orthogonality

**`agent_loop_mode` is NOT part of the routing chain.** It is the
sticky `AgentIntent` (research / mutation / validation) emitted
**inside the agent loop** based on **observed tool calls**. It is
post-tool-observation, NOT pre-routing. **Layer 4 only.**

From the canonical-taxonomy ownership matrix (`docs/intent-contracts/canonical-taxonomy.md`):

| Intent | Layer-1 owner | Layer-3 consumer | Layer-4 consumer | Status |
|---|---|---|---|---|
| `agent_loop_mode` | `run/task-loop.ts:315` | — | `IntentClassifier` (AgentIntent) at `run/intent-classifier.ts` (defines `AgentIntent`) | **Layer 4, orthogonal** |

`agent_loop_mode` has **no Layer-1 owner** and **no Layer-3
consumer**. It is consumed exclusively by the agent loop's progress
plumbing — by design, the routing chain does not see it. The
`IntentClassifier` operates purely on observed tool calls; it does
**not** re-derive intent from the user prompt, and therefore cannot
short-circuit or be short-circuited by the routing chain.

If a future reviewer asks "why isn't `agent_loop_mode` in the
routing chain?", the answer is: because the agent loop's job is to
stickily track **what the model is currently doing** across many
iterations, not to pick a route. Routing is a one-shot decision made
before the loop starts; loop-mode is a per-iteration observation made
after the loop emits tool calls.

## Intent definition

The agent loop's mode belongs to the **agent-loop-mode** family and
answers the question "what is the model **currently** doing inside the
loop?" Three mutually-exclusive states, sticky across iterations:

| Family | Asks | Means |
|---|---|---|
| **agent-loop-mode — research** *(this family)* | "model is reading / exploring / fetching" | read-only tools: `file.read`, `grep`, `glob`, `web_search`, `web_fetch`, `dir.search`, `list_files`, `mcp_discovery` |
| **agent-loop-mode — mutation** | "model is changing state" | write tools: `file.edit`, `file.create`, `file.delete`, `file.write`, `file.rename`, `patch.apply`; shell commands matching `MUTATION_COMMAND_RE` (build/install/compile/format) |
| **agent-loop-mode — validation** | "model is verifying state" | shell commands matching `VALIDATION_COMMAND_RE` (test / lint / typecheck / tsc / verify / check / vitest / jest / pytest) |

Distinct from adjacent routing-chain families (which are decided **before**
the agent loop runs):

| Routing-chain family | Decided at | Lives in |
|---|---|---|
| `workspace_state` / `workspace_mutation` | Layer 1 (`classifyAction`) | routing chain |
| `shell_execution` | Layer 3 (`taskRouter` via `isShellTask`) | routing chain |
| `read_only_analysis` / `planning` / `generation` | Layer 1 (`classifyAction`) + Layer 3 model fallback | routing chain |

## Recognizer

**Mechanism**: deterministic finite-state machine. Three pure-function
sub-recognizers, one per `AgentIntent`. The emitted label is the
**dominant sub-recognizer** for the iteration's observed tool calls.
Sticky FSM (`update`) prevents the emitted label from flip-flopping.

**Trigger precedence** (per-iteration tie-breaking, validation > mutation > research):
1. If at least one tool matched the **validation** sub-recognizer AND
   its score dominates the other two, emit `validation`.
2. Else if at least one tool matched the **mutation** sub-recognizer
   AND its score is ≥ the research score, emit `mutation`.
3. Else emit `research` (the safe default — covers unrecognized tools
   and empty sequences).

### Sub-recognizer pattern sets

| Sub-recognizer | Pattern | Matches |
|---|---|---|
| **research** | `RESEARCH_TOOLS` set | `file.read`, `dir.search`, `web_fetch`, `web_search`, `mcp_discovery`, `grep`, `glob`, `list_files` |
| **research** | (default for unrecognized tools) | any tool name not in `RESEARCH_TOOLS` / `MUTATION_TOOLS` and not `shell.run` |
| **mutation** | `MUTATION_TOOLS` set | `file.edit`, `file.create`, `file.delete`, `patch.apply`, `file.write`, `file.rename` |
| **mutation** | `MUTATION_COMMAND_RE` | `\b(build\|compile\|install\|format\|npm\s+(install\|run\s+build)\|go\s+build\|rustc)\b` |
| **mutation** | (default for `shell.run` with unknown command) | any other shell command — **safe default**: shell commands can mutate state, so the model is presumed to be mutating unless it explicitly looks like a validator |
| **validation** | `VALIDATION_COMMAND_RE` | `\b(test\|lint\|typecheck\|tsc\|verify\|check\|vitest\|jest\|pytest)\b` |

Word-boundary anchored so `tsconfig.json` does NOT match `tsc` (the
`c` of `tsc` is followed by `o`, no word boundary). Stays additive
relative to the pre-T13 recognizer: every command previously matched
as validation remains matched.

### Pattern table (positive corpus)

| Command / tool sequence | Sub-recognizer | Emitted |
|---|---|---|
| `file.read` | research | `research` |
| `web_search`, `web_search` | research | `research` |
| `file.read`, `grep`, `glob`, `list_files` | research (all four) | `research` |
| `some_new_tool_we_dont_know` | research (default) | `research` |
| (empty sequence) | research (default + carry-over) | `currentIntent ?? "research"` |
| `file.edit` | mutation | `mutation` |
| `file.write`, `file.create` | mutation | `mutation` |
| `shell.run npm install` | mutation | `mutation` |
| `shell.run npm run build` | mutation | `mutation` |
| `shell.run go build ./...` | mutation | `mutation` |
| `shell.run ls -la` | mutation (safe default) | `mutation` |
| `file.delete`, `file.rename` | mutation | `mutation` |
| `shell.run pnpm test` | validation | `validation` |
| `shell.run pnpm lint` | validation | `validation` |
| `shell.run tsc --noEmit` | validation | `validation` |
| `shell.run vitest run` | validation | `validation` |
| `shell.run jest --ci` | validation | `validation` |
| `shell.run pytest -q` | validation | `validation` |
| `shell.run alix verify` | validation | `validation` |
| `shell.run check ./dist` | validation | `validation` |

### Sticky FSM (≥2-iteration streak)

```ts
update(current, observed, streak):
  if observed === current:
    return { next: current, streak: 0 }
  newStreak = streak + 1
  if newStreak >= 2:
    return { next: observed, streak: 0 }   // flip
  return { next: current, streak: newStreak }   // hold, streak grows
```

`update` is a pure function of `(current, observed, streak)`. Same
inputs → same outputs, every call. Streak is reset to 0 whenever the
observed intent matches the current one.

### Ambiguous corpus (per-iteration tie-breaking)

| Mixed sequence | Emitted | Why |
|---|---|---|
| `file.read` + `file.edit` | `mutation` | mutation score (1) ≥ research score (1); validation score = 0 |
| `web_search` + `file.read` + `file.edit` + `file.write` | `mutation` | mutation score (2) ≥ research score (2); validation score = 0 |
| `file.read` + `shell.run pnpm test` | `validation` | validation score (1) ≥ research score (1); validation beats mutation (mutation score = -1 from the explicit decrement) |
| `file.edit` + `shell.run pnpm test` | `validation` | validation score (1) ≥ mutation score (0) after the explicit decrement |

### Sticky end-to-end pattern (mirrors `task-loop.ts:862`)

```ts
let current: AgentIntent = "research";
let streak = 0;

for (const iteration of iterations) {
  const toolCalls = observeModel(iteration);
  const observed = classifier.classify(toolCalls, current);
  const { next, streak: newStreak } = classifier.update(current, observed, streak);
  current = next;
  streak = newStreak;
}
```

Three integration tests pin this exact flow in
`describe("IntentClassifier — sticky classification flow (end-to-end)")`:

- Research-only iterations hold `research` forever (streak always 0).
- Two consecutive mutation-heavy iterations flip from `research` →
  `mutation` (streak hits 2 on the second iteration).
- A single mutation iteration followed by a research iteration does
  **not** flip (streak resets to 0 because the contradiction pattern
  broke before reaching the threshold).

## Negative corpus (must NOT classify unexpectedly)

Each test in `describe("IntentClassifier — negative corpus (default to research)")`:

| Input | Emitted | Why |
|---|---|---|
| `[mystery_tool, another_unknown]` | `research` | unrecognized tools default to research (safe exploration) |
| `[]` | `currentIntent ?? "research"` | empty sequence carry-over |

## Determinism

`classify` and `update` are pure functions. Same inputs → same
outputs, every call. Pinned in
`describe("IntentClassifier — determinism")` — three identical calls
to `classify(tools)` return the same value; two identical calls to
`update("research", "mutation", 0)` return the same `{next, streak}`.

## No-prompt verification (orthogonality pinning)

Pinned in `describe("IntentClassifier — orthogonality (no prompt dependency)")`:

- `classify.length === 2` — the only parameters are
  `toolCalls` and an optional `currentIntent` carry-over. No prompt
  parameter, no model parameter, no `taskRouter` parameter.
- Same tool sequence returns the same `AgentIntent` regardless of
  any other ambient state (the function does not read from
  `process.env`, no globals, no `Date.now()`, no `Math.random()`).

## Relationship to `classifyAction` (Layer 1 routing)

`classifyAction` (Layer 1, `src/runtime/action-classifier.ts`) decides
**before** the agent loop starts which kind of prompt this is. It
emits `workspace_action`, `arithmetic`, `external_retrieval`, etc.
`IntentClassifier` (Layer 4, this file) decides **during** each
iteration of the agent loop what the model is currently doing. The
two are independent: a `workspace_action` prompt can run an agent loop
whose iterations emit research / mutation / validation. The chain
invariant holds: Layer 1 → Layer 3 → Layer 4 prompt, no
re-classification. `IntentClassifier` lives entirely inside the
agent-loop boundary and does not feed back into routing.

## Bug history

- **T13 contract boundary (this PR)**: `tsc --noEmit` was misclassified
  as `mutation` (default for unknown `shell.run` command). The
  canonical validators list needed `tsc` to recognize the most common
  TypeScript typecheck invocation. Fixed additively (only widens the
  validation regex; no command previously matched as `validation`
  becomes something else).
- **Earlier**: `IntentClassifier` already had the three sub-recognizer
  structure and the sticky FSM. T13 (#384) formalizes them as the
  agent-loop-mode recognition contract.

## Done checklist

For T13 (#384) agent-loop-mode recognition contract:

- ✅ Recognition contract document (`docs/intent-contracts/agent-loop-mode.md`)
  — three sub-recognizers documented, sticky FSM documented, orthogonality
  pinned prominently at the top.
- ✅ Orthogonality section quoting canonical-taxonomy ownership matrix.
- ✅ Unit tests corpus (`tests/run/intent-classifier.test.ts`) — 33 tests
  covering research / mutation / validation positive corpus, negative
  corpus, ambiguous corpus, sticky semantic, sticky end-to-end flow,
  determinism, and orthogonality.
- ✅ No-regression — `tests/runtime/action-classifier.test.ts` still
  passes (62/62).
- ✅ Layer-4-only — no change to `src/runtime/action-classifier.ts`;
  routing chain untouched.

## Provenance

- T13 (#384) on wayfinder map #376.
- Template anchored by `docs/intent-contracts/workspace-state.md`
  (T7) — the canonical per-family recognition contract template
  used for T7–T13.
- Ownership matrix from `docs/intent-contracts/canonical-taxonomy.md`
  (T14).