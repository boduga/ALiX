# F4 — External Selection Observability: Impact Analysis & Plan

**Status:** analysis complete; implementation not started.

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
