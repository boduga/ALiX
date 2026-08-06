# Layer-3 prompt-construction audit

**Status**: Active — T15 audit on wayfinder map #376.
**Kind**: Audit. **Not** a recognizer contract (contrast T7–T13).
**Seed**: `docs/intent-contracts/canonical-taxonomy.md` → Re-classification audit → Finding 1 (`src/agent/session.ts:973`).
**Anchor doc**: [`canonical-taxonomy.md`](./canonical-taxonomy.md) — chain invariant + ownership matrix (T14, #386).

## Scope

Layer-3 prompt construction. This document inventories every site in `src/`
that builds a system prompt, user prompt, or model input **on behalf of an
`ExecutionRoute`** (`direct` | `tool` | `chat` | `grounded_chat` | `agent`), and
classifies whether that site consumes the canonical-intent label the chain
already computed.

This audit **documents inventory and proposes follow-ons. It changes no
production code and adds no tests.** Every remediation named here is deferred
to a follow-on ticket.

## Method

The inventory was built in three passes, in this order:

1. **Route surface enumeration.** `TaskRouteKind` is declared once at
   `src/runtime/task-router.ts:21`. `executeRoute` (`src/runtime/route-executor.ts:60`)
   is the single canonical dispatcher, switching over all five kinds; the
   `RuntimeExecutor` interface (`route-executor.ts:36–42`) names one executor
   method per kind. Two implementations satisfy it — `LocalRuntimeExecutor`
   (same process) and the daemon-side functions in `src/daemon/daemon-server.ts`.
   Both were audited.
2. **Grep sweep.** `rg -n 'systemPrompt:' src --type ts` and
   `rg -n 'You are ALiX|You are a |You are an ' src --type ts`, with `*.test.ts`
   excluded. Every hit was read in context and either admitted to the inventory
   (constructs a prompt for a route) or discarded (see Out-of-scope).
3. **Impact confirmation.** `impact({direction: "upstream"})` was run on
   `executeRoute`, `taskRouter`, `executeDirect`, and
   `executeGroundedChatRoute` to confirm the reachability of each site and that
   no additional caller constructs prompts outside the enumerated set.
   `executeGroundedChatRoute` returned LOW risk / 3 impacted / module `Daemon`,
   confirming the daemon path is a live second implementation and not dead code.

### Classification rule

For each site, three independent questions:

- **Consumes canonical intent?** Does the site read the canonical-intent label
  the chain already produced — reachable at every one of these sites as
  `route.diagnostic.classification` (`RouteDiagnostic`, `task-router.ts:27–32`)?
  **No → re-classification violation**, because the label was computed, carried
  to the site, and then discarded.
- **Consumes TaskType?** Layer 2 is an orthogonal planning lens and is
  explicitly *not* in the routing chain (canonical-taxonomy.md, "Chain
  definition"). Consuming it is **not** a violation.
- **Hardcoded?** Prompt text is a literal with no intent-conditional branch.
  This is a violation **only when the route carries a canonical intent** — which
  every route kind except `tool` does.

## Inventory

`route.diagnostic.classification` is in lexical scope at every site marked
**violation** below. None of them read it.

| # | file:line | Route | Canonical intent? | TaskType? | Hardcoded? | Severity |
|---|---|---|---|---|---|---|
| 1 | `src/agent/session.ts:972-977` | `direct` | N | N | Y | **violation** |
| 2 | `src/runtime/route-executor.ts:109` | `direct` | N | N | Y | **violation** |
| 3 | `src/daemon/daemon-server.ts:327` | `direct` | N | N | Y | **violation** |
| 4 | `src/agent/session.ts:1606-1610` | `chat` | N | N | Y (config-overridable) | **violation** |
| 5 | `src/runtime/route-executor.ts:156` | `chat` | N | N | Y | **violation** |
| 6 | `src/daemon/daemon-server.ts:372` | `chat` | N | N | Y | **violation** |
| 7 | `src/runtime/route-executor.ts:173` | `grounded_chat` (step 1) | N | N | Y | **violation** |
| 8 | `src/daemon/daemon-server.ts:395` | `grounded_chat` (step 1) | N | N | Y | **violation** |
| 9 | `src/runtime/route-executor.ts:204` | `grounded_chat` (step 2, synthesis) | N | N | Y | **violation** |
| 10 | `src/daemon/daemon-server.ts:424` | `grounded_chat` (step 2, synthesis) | N | N | Y | **violation** |
| 11 | `src/agent/agent-loop.ts:372` → `src/agent/system-prompt.ts:33` (`SYSTEM_PROMPT_BASE`) | `agent` | N | N | Y | **violation** |
| 12 | `src/run/task-loop.ts:399-410` (`supplement`) | `agent` | N | N | N (varies by `AgentIntent`) | orthogonal |
| 13 | `src/run/plan-phase.ts:286,308` (`buildPlanSystemPrompt`) | `agent` (plan phase) | N | N | Y | orthogonal |
| 14 | `src/agents/subagent-cli.ts:212` (`ROLE_INSTRUCTIONS`) | `agent` (delegated) | N | Y — via `src/agents/delegate-tool.ts:28` | Y per role | orthogonal |
| 15 | `src/kernel/graph-executor.ts:170,306` (`researchPrefix`) | `agent` (graph node) | N | N | Y | orthogonal |
| 16 | `src/runtime/route-executor.ts:117-150`; `src/daemon/daemon-server.ts:334-360` | `tool` | — | — | — | none |

**Totals**: 16 sites; **11 violations**, 4 orthogonal, 1 none.

Row 16 (`tool`) is **none**, not a violation: the tool route dispatches
`{tool, args}` straight to `ToolExecutor` and constructs no model prompt at
all. There is nothing for a canonical intent to condition. This is the only
route kind that is structurally exempt.

## Findings

### Finding 1 — `direct` route: one prompt for two canonical intents

Sites: `src/agent/session.ts:972-977`, `src/runtime/route-executor.ts:109`,
`src/daemon/daemon-server.ts:327`. This is the seed finding from
canonical-taxonomy.md, expanded from one site to three.

```ts
// src/agent/session.ts:972
const directBasePrompt =
  "You are ALiX, a helpful AI assistant. Answer concisely.";
```

```ts
// src/runtime/route-executor.ts:108
const response = await provider.complete({
  systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
  messages: [{ role: "user", content: route.prompt }],
  maxOutputTokens: 512,
});
```

**Impact.** Per the ownership matrix, the `direct` route is the Layer-3
consumer for **two** canonical intents — `arithmetic` (`task-router.ts:365`)
and `generation` (`task-router.ts:412` deterministic, `:454` model fallback) —
plus the model-fallback `direct` emissions at `task-router.ts:456` and `:464`.
All of them receive the identical eleven-word persona.

The `arithmetic` case is partially masked: when `route.answer` is pre-computed
the site returns before any provider call (`session.ts:938`,
`route-executor.ts:99`). But an `arithmetic`-classified prompt that the
deterministic evaluator declines still falls through to the same generic
prompt. A `generation` intent ("write me a poem about the sea") and a residual
`arithmetic` intent are indistinguishable to the model. "Answer concisely" is
actively wrong for `generation`, which is the intent most likely to want length.

**Follow-on**: **T16 — canonical-intent-conditioned direct prompt.** Introduce a
single `buildDirectPrompt(intent: CanonicalIntent): string` and have all three
call sites consume `route.diagnostic.classification`. Blocked on T7/T8 only to
the extent that `workspace_*` never reaches `direct`; `arithmetic` and
`generation` are already Active in the ownership matrix, so T16 is unblocked
today.

### Finding 2 — `chat` route: hardcoded, and divergent across implementations

Sites: `src/agent/session.ts:1606-1610`, `src/runtime/route-executor.ts:156`,
`src/daemon/daemon-server.ts:372`.

```ts
// src/agent/session.ts:1606
const CHAT_DEFAULT_SYSTEM_PROMPT =
  "You are ALiX in a lightweight chat session. Be brief, direct, and conversational. " +
  "Do not invoke tools, do not run commands, do not edit files. Respond as if you are " +
  "talking to an operator in short sentences, no markdown headings.";
const chatSystemPrompt = config.chatSystemPrompt ?? CHAT_DEFAULT_SYSTEM_PROMPT;
```

**Impact.** Per the ownership matrix, `chat` is the Layer-3 consumer for
`read_only_analysis` (T10, pending) and `planning` (T11, pending) — both
reached through the legacy ambiguous fallback at `task-router.ts:488`. Neither
intent influences the prompt.

This finding carries a second defect the seed did not: the three `chat` sites
do not agree with each other. `session.ts` uses the "lightweight chat session"
text with an explicit no-tools instruction; `route-executor.ts:156` and
`daemon-server.ts:372` use the *`direct`* route's "helpful AI assistant"
one-liner. The same canonical intent therefore gets a materially different
system prompt depending on whether the operator is in the in-process TUI or on
the daemon socket. `config.chatSystemPrompt` overrides only the `session.ts`
site, so operator configuration silently does not apply to the other two.

**Follow-on**: **T17 — unify chat prompt construction across the three
executors**, then condition it on the canonical intent. Sequenced after T10 and
T11 land their recognizers, since the conditioning targets do not exist yet.

### Finding 3 — `grounded_chat` route: intent is known and still unused

Sites: `src/runtime/route-executor.ts:173` and `:204`;
`src/daemon/daemon-server.ts:395` and `:424`.

```ts
// src/runtime/route-executor.ts:173 — step 1, tool-eliciting call
systemPrompt: "You are ALiX, a helpful AI assistant. If you need current information, use the available tools to search. Answer concisely.",
```

```ts
// src/runtime/route-executor.ts:204 — step 2, synthesis call
systemPrompt: "Answer the user's question based on the tool result.",
```

**Impact.** This is the sharpest violation in the audit, because
`grounded_chat` is 1:1 with a single canonical intent: `external_retrieval`
(`task-router.ts:415`, Active in the ownership matrix — no pending recognizer).
The intent is not merely available at the site, it is *implied by the route
kind itself*, and the prompt still does not name it.

The step-1 prompt hedges ("**If** you need current information") for a route
that by construction exists only because the classifier already decided current
information is required. The step-2 synthesis prompt drops the ALiX persona
entirely and issues no grounding or citation instruction, so a retrieval answer
is not required to attribute its tool result.

Both defects are duplicated verbatim in the daemon implementation, so there are
four sites and one bug.

**Follow-on**: **T18 — `external_retrieval` prompt pair.** Replace the hedge
with a directive step-1 prompt and give step 2 an attribution instruction.
Unblocked today: `external_retrieval` needs no pending recognizer.

### Finding 4 — `agent` route: `SYSTEM_PROMPT_BASE` cannot see the intent

Site: `src/agent/agent-loop.ts:372`, sourcing `src/agent/system-prompt.ts:33`.

```ts
// src/agent/agent-loop.ts:372
systemPrompt: SYSTEM_PROMPT,
```

```ts
// src/agent/system-prompt.ts:33
export const SYSTEM_PROMPT_BASE =
  "You are ALiX, an AI coding agent. You have access to tools.\n\n" +
  ...
```

**Impact.** `agent` is the Layer-3 consumer for **both** `workspace_state`
(T7, pending) and `workspace_mutation` (T8, pending) — the two intents the
canonical taxonomy explicitly splits out of today's conflated
`workspace_action`. The taxonomy notes that the split "does not change the
routing decision"; this finding is the reason that framing is incomplete. The
split is *supposed* to change something downstream, and prompt construction is
the natural place — a read-only inspection and a destructive write deserve
different standing instructions. Today they get byte-identical ones.

The agent loop does re-derive the read/write distinction, but at Layer 4 and
from its own signals (`readOnlyTask`, `shellTask` at `agent-loop.ts:366-368`),
not from the canonical label. That is precisely the re-derivation the chain
invariant exists to prevent.

**Follow-on**: **T19 — thread the canonical intent into `SYSTEM_PROMPT`
assembly** so `workspace_state` and `workspace_mutation` yield distinct
standing instructions, and retire the `readOnlyTask` re-derivation in favor of
the Layer-1 label. Hard-blocked on **T7 and T8** — the labels do not exist yet.

### Finding 5 — local/daemon duplication is the structural cause

Sites: `src/runtime/route-executor.ts` vs `src/daemon/daemon-server.ts`,
across findings 1–3 (rows 2/3, 5/6, 7/8, 9/10).

Every non-agent route prompt exists **twice**, copy-pasted between
`LocalRuntimeExecutor` and the daemon's `execute*Route` functions. Finding 2
shows the copies have already drifted. This is not itself a canonical-intent
violation — it is the mechanism that will make findings 1–3 regress after they
are fixed, because a fix applied to one implementation will silently not apply
to the other.

**Impact.** Eight of the eleven violations are four bugs × two implementations.
Any T16/T17/T18 fix that touches only `route-executor.ts` leaves the daemon
socket path on the old prompt, and the divergence is invisible to the
closed-world test (which stops at Layer 3).

**Follow-on**: **T20 — extract route prompts to a shared module** (e.g.
`src/runtime/route-prompts.ts`) consumed by both executors, so T16–T19 have a
single edit site. Recommend sequencing **T20 first**, before T16–T18.

### Finding 6 — `task-loop.ts` supplement: orthogonal, and the proof of concept

Site: `src/run/task-loop.ts:399-410`.

```ts
// src/run/task-loop.ts:399
const supplement = currentIntent === "research" ? RESEARCH_SUPPLEMENT
  : currentIntent === "mutation" ? MUTATION_SUPPLEMENT
  : VALIDATION_SUPPLEMENT;
const effectiveSystemPrompt = `${systemPrompt}\n\n${supplement}${toolManifest}`;
```

**Not a violation.** `currentIntent` is an `AgentIntent`, produced by
`IntentClassifier` from *observed tool calls* (`task-loop.ts:862`), not from
raw prompt text. Per canonical-taxonomy.md's orthogonality table
(`run/task-loop.ts:315`, `run/intent-classifier.ts`), `AgentIntent` is a
Layer-4 agent-loop-mode signal and is explicitly outside the routing chain. No
re-derivation of `CanonicalIntent` occurs.

It is recorded here because it is the **only site in the entire inventory that
conditions a prompt on an intent label at all**, and it demonstrates the exact
mechanism findings 1–4 are missing. T19 should model its implementation on this
site rather than inventing a new pattern — and should note that after T19 the
agent route will carry two intent labels (`CanonicalIntent` at entry,
`AgentIntent` per iteration), which must remain distinct and separately named.

Rows 13–15 are orthogonal for the same class of reason: `plan-phase.ts:308` is
a phase-scoped prompt downstream of the route; `subagent-cli.ts:212` is
role-scoped and consumes TaskType via `delegate-tool.ts:28` (Layer 2, sanctioned
orthogonal); `graph-executor.ts:170,306` conditions on
`node.executionProfile`, a graph-node property, not on prompt text.

## Out of scope

This audit does **not** cover:

- **Layer-4 tool manifests and permissions.** `renderToolManifest`
  (`task-loop.ts:406`), the `tools:` array, and `allowedTools` allowlist
  enforcement (`route-executor.ts:185`) are Layer-4 concerns. Only the system-
  and user-prompt *text* is inventoried.
- **MCP server prompts** and `mcpToolIndex` contributions to the model input.
- **Classifier-internal prompts.** `src/runtime/action-classifier.ts:502` is the
  Layer-1 recognizer's own model-fallback prompt. It constructs a prompt to
  *produce* the canonical intent; it cannot consume one. Not a route site.
- **Non-route model calls.** `src/skills/factory.ts:36`,
  `src/adaptation/lens-agent.ts:37-55`, `src/cli/commands/plan.ts:60`,
  `src/kernel/model-replan-adapter.ts:341,381`,
  `src/providers/provider-doctor.ts:23`. These never pass through `taskRouter`
  and have no `ExecutionRoute`.
- **Prompt *content* quality.** Whether a given prompt is well-written is out of
  scope; this audit asks only whether it is *selected* by the canonical intent.
- **Remediation.** No code changes, no tests, no recognizer contracts.

## Disambiguation — this audit vs. the T14 closed-world invariant

These are adjacent and must not be conflated.

| | T14 closed-world invariant | T15 (this audit) |
|---|---|---|
| Artifact | Executable test — `tests/runtime/action-classifier.test.ts → describe("canonical-intent chain — closed-world invariant")` | Document — inventory + proposed follow-ons |
| Pins | **Layer 1 → Layer 3.** Prompt → `classifyActionWithConfidence` → `taskRouter` produces the expected `(intent, kind)` pair | **Layer 3 → Layer 4.** What the route *does with* the intent once it has it |
| Enforcement | Mechanical, fails CI on regression | None — descriptive only |
| Status of findings | Zero violations by construction (the test *is* the invariant) | 11 violations, all unremediated |

The T14 test passing is **not** evidence that the findings in this document are
absent. The invariant stops exactly where this audit begins: it asserts the
right route kind is chosen, and says nothing about the prompt that route then
builds.

### A note on layer numbering

canonical-taxonomy.md's Finding 1 is labelled "Layer 4 prompt gap" in its
heading and "a Layer 3 gap" in its body. The numbering in the chain definition
is authoritative: **prompt construction is Layer 4**; the *site that should
consume the intent and does not* sits at the Layer 3 → Layer 4 boundary. T15 is
named a "Layer-3 audit" because it audits Layer 3's obligation to propagate its
label forward. Every row in the inventory is a Layer-4 artifact reached from a
Layer-3 decision. The taxonomy doc's inconsistency should be corrected as a
trivial follow-on: **T21 — align Finding 1's layer label with the chain
definition.**

## Provenance

- **This ticket**: T15 (#390), wayfinder map #376.
- **Seed**: T14 (#386) — `docs/intent-contracts/canonical-taxonomy.md`,
  Re-classification audit, Finding 1 (`src/agent/session.ts:973`). T14 recorded
  one site and deferred the inventory to a future map; T15 is that inventory,
  expanded 1 → 16 sites.
- **Referenced contracts**: T7 (`workspace_state`), T8 (`workspace_mutation`),
  T9 (`shell_execution`), T10 (`read_only_analysis`), T11 (`planning`),
  T12, T13. Findings 2 and 4 are blocked on T10/T11 and T7/T8 respectively;
  findings 1, 3, and 5 are unblocked.
- **Proposed follow-ons**: T16 (direct prompt), T17 (chat unification),
  T18 (`external_retrieval` prompt pair), T19 (agent intent threading),
  T20 (shared route-prompt module — sequence first), T21 (taxonomy doc layer-label fix).
