# F4 — External Selection Observability: Impact Analysis & Plan

**Status:** complete — both observation bypasses and the coverage-vocabulary gap are implemented and tested.

**Problem (cohort `t3d-2026-09-28-c`, F4):** eight MCP/external tasks produced
**zero** `tool.selection.observed` events, so the cohort has no external/MCP
selection scopes at all and T3 says nothing about selector behaviour when
external candidates are in play. The cause is two distinct bypasses of the
observation seam, not one.

## 1. Where observation happens today

| Piece | Location |
|---|---|
| Observation payload builder | `buildSelectionObservation` — `src/run/task-loop/predicates.ts:530` |
| Emitter | `src/run/task-loop/main.ts:1267-1290`, inside `handleToolResult` |
| Event type | `TOOL_EVENT_TYPES.SELECTION_OBSERVED = "tool.selection.observed"` — `src/events/types.ts:129` |
| Frozen surface | `frozenSurface.candidates` / `.bindings` built once per run in the task loop |
| Replay reader | `extractToolSelectionScopes` — `src/decision/tool-selection-replay.ts:289` |
| Evaluation | `selectionOutcomeFromObservation` — `src/decision/tool-selection-evaluation.ts:246` |

Everything downstream (scope freezing, sanitized candidate ids, local-only
bindings, scoping provenance, outcome dimensions, replay, corpus tooling)
already consumes that one event shape. It is the only seam that matters.

## 2. Bypass A — the `alix_mcp_search_tools` short-circuit

```text
src/run/task-loop/main.ts:1401  const mcpSearchResult = await handleMcpToolSearch(toolCall, eventHandlerDeps);
src/run/task-loop/main.ts:1402  if (mcpSearchResult.handled && mcpSearchResult.message) {
src/run/task-loop/main.ts:1403    messages.push(mcpSearchResult.message);
src/run/task-loop/main.ts:1404    continue;                       ← never reaches handleToolResult
src/run/task-loop/main.ts:1405  }
```

(and the same short-circuit as a `GateSentinel` at `:1330`.)

**Key finding:** the frozen surface *does exist* for that call. `alix_mcp_search_tools`
is a normal member of the frozen candidate set — it appears in cohort C's
deterministic rankings (`builtin:alix_mcp_search_tools`) and in the offered sets
of several scopes. So this path is not "no selection happened"; it is a real
selection that the instrumentation drops. The honest fix is a **real
observation**, not a "not applicable" marker.

Smallest change: extract the emission block from `handleToolResult` into a
helper (`emitSelectionObservation`) and call it on the short-circuit path with
the same inputs the loop already has (`frozenSurface`, `scopeId`, `iteration`,
`frozenScoping`, `frozenRanking`, `selectionSignatures`).

## 3. Bypass B — single-tool external turns on the route path

**Amendment 2026-09-29 (found during implementation):** the original claim that
"no model chose among candidates" is **wrong**. `executeGroundedChatBehavior`
does make a model call:

```text
src/runtime/route-execution.ts:270  provider.complete({ ..., tools: tools.length ? tools : undefined })
src/runtime/route-execution.ts:281  if (response.toolCalls.length > 0) { const tc = response.toolCalls[0]; ... }
```

The model **does** choose, from a small allowlisted surface (`web_search` and/or
`web_fetch`, filtered by `route.allowedTools`). The x2–x8 traces showing no
`model.usage` simply reflect that this path does not emit usage events — the
choice is real.

Consequence: Bypass B should emit a **real frozen scope** (candidates = the
offered web tools, chosen = the tool the model issued), not a
`not_applicable` marker. `not_applicable` remains correct only for turns with no
model choice at all. That is better news for F4: the external family can produce
genuine selection scopes.

**Blocker to resolve first (layering):** `src/runtime/**` currently imports
nothing from `src/decision/**` (verified: empty grep), while the observation
builder lives in `src/run/task-loop/predicates.ts`, which *does* import
`decision/selection-outcome.js` and `decision/tool-selection-candidates.js`.
Emitting from `executeGroundedChatBehavior` therefore needs a decision-neutral
seam. Options:

1. dependency-neutral payload construction in the runtime path — the ids here
   are plain `builtin:alix_web_search` / `builtin:alix_web_fetch` with no MCP
   handles to sanitize, and the payload type can be shared from a neutral module
   (`src/events/types.ts` or `src/runtime/contracts/`), with a shape-parity test
   against the loop emitter (recommended);
2. inject the frozen surface into the route behaviour through `ToolExecutionDeps`
   (callers already pass `eventLog`/`cwd`), so the runtime never freezes anything;
   more plumbing, no shape duplication;
3. move freeze+emit into a neutral module both import — cleanest long term,
   largest change.

Option 1 or 2 should be chosen before implementing Bypass B; the sentinel path
(§2) does not need it.

### Amendment 2026-09-29 (second): Option 2 needs a boundary decision

Option 2 was chosen (inject the immutable frozen surface through
`ToolExecutionDeps`; runtime adds only the actual choice and execution facts).
Reconnaissance for the wiring found that the premise does not hold for this
path:

```text
src/agent/session/turn.ts:322-346   builds RuntimeContext, dispatches executeRouteGoverned
src/daemon/daemon-server.ts:488     dispatches executeRoute
```

Both grounded-chat dispatchers live in `src/agent/**` and `src/daemon/**`. The
documented Jev rule (`docs/jev/AGENTS.md` §Verification, and its import-specific
grep) is that `src/agent`, `src/runtime`, `src/policy`, `src/providers` and
`src/kernel` **never import `src/decision/`** — and today that grep is empty for
`src/agent`. The only layer that currently imports the selection machinery is
`src/run/task-loop/predicates.ts` (`decision/selection-outcome.js`,
`decision/tool-selection-candidates.js`), which is outside the exclusion set.

So "the run/orchestration layer owns selection semantics and freezes the
surface" is true for the task loop but **not** for the grounded route, whose
dispatcher is inside the exclusion set. Option 2 therefore needs one of:

1. **A documented, narrow exception** — allow the two dispatchers to import the
   *observation* helpers (pure instrumentation: no engine, no route, no
   authority), while the exclusion continues to forbid decision *engine/routing*
   imports. Strengthen the import test to assert the decision **engine**
   (`decision/engines/**`, `decision/decisions/**`, router/selection-service)
   is never reachable from those layers, rather than the whole folder.
2. **Move only the pure assembly** — `buildSelectionObservation` +
   `emitSelectionObservation` into a neutral module (e.g.
   `src/runtime/contracts/selection-observation.ts`) with the DTO, leaving
   candidate freezing in the run layer. Then runtime/agent import the neutral
   module and never `src/decision/`. This is Option 3 reduced to its minimum:
   one emitter, one builder, no second interpretation.

Recommendation: **2** if the caller can supply frozen candidates through deps
(then `src/decision` never enters `src/runtime` or `src/agent` at all, and the
documented rule is untouched); otherwise **1** with the import test tightened as
described. Both preserve the single-builder property Option 1 was rejected for.
Bypass B remains unimplemented until this is settled.

```text
src/run/task-loop/main.ts              ← never entered (no model.usage/agent.decision in the trace)
src/runtime/route-executor.ts:103      case "grounded_chat": return executor.executeGroundedChat(route, ctx);
src/runtime/route-execution.ts:249     executeGroundedChatBehavior(...)   ← executes the external tool here
src/daemon/daemon-runtime-executor.ts:85  async executeGroundedChat(...)
```

Cohort C evidence: `x2`–`x8` traces contain exactly one
`tool.requested`/`tool.completed` and **no** `model.usage`, `agent.decision` or
`context.assembled` — the action classifier picked the route and the route
executed one tool. **No model chose among candidates, so there is no selection
to observe.** Emitting a fabricated scope here would be worse than emitting
nothing; the correct record is an explicit *not applicable* marker.

Smallest change: a sibling event `tool.selection.not_applicable` carrying
`{ scopeId?, tool, executor, reason, sessionId }`, emitted by the grounded-chat
behaviour when it dispatches an external tool, with reason values
`route-selected-tool` (classifier chose) and `non-selection-tool`
(discovery/status tools outside the frozen surface).

## 4. Invariants to pin

```text
external tool requested
  → either a tool.selection.observed scope exists
  OR  a tool.selection.not_applicable record exists with a reason

raw mcp__ handle
  → never serialized into a frozen scope or a Jev projection
```

Tests:

- a loop turn that calls `alix_mcp_search_tools` emits a selection scope whose
  chosen candidate is `builtin:alix_mcp_search_tools` (Bypass A);
- a grounded-chat external turn emits `tool.selection.not_applicable` with
  reason `route-selected-tool` and **no** `tool.selection.observed` (Bypass B);
- a scan over frozen-scope payloads and Jev projections finds no `mcp__`
  substring; raw handles remain only in `candidateBindings` (local-only);
- request-without-record: for every external `tool.requested` in a session,
  one of the two records exists (the invariant, asserted over a session trace).

## 5. Replay / network semantics — unchanged

- Live execution may use the network per policy (`web_fetch` SSRF rules,
  `allowNetworkDomains`); nothing here relaxes them.
- Offline replay never falls back to live network: external tools replay only
  from recorded-response fixtures under exact `(tool, argsSignature)` matching
  and a miss is `unknown` (`src/decision/tool-selection-fixtures.ts`,
  `tool-selection-replay.ts`).
- Recorded-response replay stays exact-match only.

## 6. The new cohort

### Amendment 2026-09-29 (third): three findings from the first test pass

Attempting the F4 invariant tests surfaced three things worth fixing before the
cohort, none of which is a behaviour defect in the emitter itself:

1. **The grounded route's provider-facing tool names are not the canonical
   candidate names.** `webSearchTool()` / `webFetchTool()` are named
   `web_search` / `web_fetch` (`src/tools/web-search.ts:18`,
   `src/tools/web-fetch.ts:351`), and `task-router.ts:479/521` allow-lists those
   names, while the task loop's frozen candidate ids are
   `builtin:alix_web_search` / `builtin:alix_web_fetch`. Emitting
   `builtin:web_search` from the grounded path would put the same tool in two
   different key spaces and make cross-path comparison impossible. The grounded
   emission must normalise provider names onto the canonical candidate names
   (a small alias table owned by the route), while `chosen` keeps the name the
   model actually emitted.
2. **`makeToolExecutor` has no test seam.** Unlike `makeProvider`, it always
   constructs a real `ToolExecutor` and hands it `deps.cwd` as the session
   directory, so any test of a route behaviour's own logic (tool choice,
   observation) needs a real session layout. Adding
   `toolExecutorFactory?(config, deps)` mirroring `providerFactory` is the
   honest fix.
3. **The invariant tests are drafted but were not landed green.** Four of five
   passed against the seam; the offered-surface-equals-provider-surface test
   stayed red because the fixture's `allowedTools` did not match the real tool
   names, which is itself finding 1. They should be re-landed with the fixture
   corrected rather than committed red.

No runtime behaviour was left changed by this attempt: the experimental edits
were reverted to the last verified commit (`99dc0530`).

Open **`t3d-2026-09-29-d`** (new cohort id — never appended to cohort C), with a
new frozen header, targeting **16–20 external scopes**:

| Family | Scopes | Shape |
|---|---:|---|
| MCP discovery | 3–4 | "which MCP tools exist / what does server X offer" |
| MCP tool selection | 4 | multi-step tasks where an MCP candidate competes with builtins |
| Web search | 3 | research with `web_search` offered alongside local search |
| Web fetch | 3 | fetch a URL, then use the content |
| SSRF / policy refusal | 2 | private-address fetch, refused, recorded as fact |
| External failure | 2 | unreachable host / bad endpoint |
| Multi-iteration external | 3 | fetch → read → cross-check, spanning iterations |

The cohort must be designed so external **selection** can actually happen: a
single-tool grounded turn yields `not_applicable` by construction (§3), so the
scope-producing prompts are the multi-step ones that reach the task loop with
MCP candidates offered.

**Success criterion for F4 is observability, not a verdict:**

```text
external selection is observable
candidate sets are preserved
MCP identities remain sanitized
actual-vs-Jev comparisons can be formed
completion / failure / latency are measurable
```

No promotion question is in scope. Only after F4 closes does the plan move to
the verification-detection / read-only offer gap.

## 7. Closure amendment 2026-09-29 (fourth)

The final coverage contract replaces the earlier draft reasons with the narrow
payload approved for implementation:

```ts
type ToolSelectionNotApplicable = {
  type: "tool.selection.not_applicable";
  scopeId: string;
  iteration: number;
  route: "grounded" | "task-loop";
  reason:
    | "no_tool_call"
    | "no_tools_offered"
    | "non_selection_turn";
};
```

The grounded path emits `no_tool_call` when tools were offered and the model
returned no tool call, and `no_tools_offered` when an observing path received an
empty surface. It never invents `chosenCandidateId`, never reclassifies the turn
as a failed selection, and emits no `tool.selection.observed` alongside it.
Replay continues to extract selector samples only from observed records, so
coverage telemetry cannot enter agreement statistics.

The MCP leak acceptance test now scans identity-bearing fields only:
`candidateId`, `label`, `offered`, `chosen`, `chosenCandidateId`, and
requirement/scoping/ranking entries. Candidate descriptions and local-only
`candidateBindings` are deliberately excluded, so the sentinel description's
literal `mcp__` prose is not mistaken for a serialized handle.

F4 is therefore closed as an observability result. Cohort
`t3d-2026-09-29-d` remains valid and frozen, but coverage-limited for its two
scope-less/no-tool-call tasks because that vocabulary did not exist during
collection. It must not be discarded or recollected solely for this fix.
