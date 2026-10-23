# Harness shim catalog — PRE-R009

Source snapshot: `64f2fdaf`. Status: offline source register; no retirement,
ablation, telemetry expansion, or publication authorized. Gate B/Q13 remain HOLD.
Parent: `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (document version v1.2).

## Evidence limits

GitNexus concept query (`harness shim prompt guidance context strategy patch
format fallback nudge`) returned malformed/NUL paths and mismatched symbol
identities. Graph integrity remains unresolved; its edges and caller counts are
not usable evidence. Entries below were confirmed directly against branch
source. Named callsites are examples, not a complete dynamic caller census.
Named tests establish available verification coverage; this catalog does not
claim they were executed. No model calls or new instrumentation ran.

For **every entry**, production activation count, denominator, per-model
frequency, incremental token/cost/latency, and causal effectiveness are
**unmeasured**. Static presence is not runtime usage. Historical suite results
cannot be attributed to an individual shim without an admissible comparison.
Existing events may support later analysis; no per-token or per-prompt events
should be added to the authoritative event log merely to populate this table.

## Core register

| ID / class | Owner and trigger | Applicability / static consumers and tests | Keep / retirement criterion and safeguard |
|---|---|---|---|
| HC-01 / M2 candidate | `src/agents/agent/system-prompt.ts`: `SYSTEM_PROMPT_BASE`, `RESEARCH_SUPPLEMENT`, `MUTATION_SUPPLEMENT`, `VALIDATION_SUPPLEMENT`. Base assembly supplies parallel execution and thorough context gathering; phase selection supplies phase-specific instructions. | Provider-independent shared prompt. `src/agents/agent/session/setup.ts` assembles base; `src/execution/run/task-loop/context-phase.ts` builds effective prompt. `tests/agent/system-prompt-coordination.test.ts` covers explicit coordination guidance, not causal benefit of parallel/search advice. | Keep pending authorized paired HC-01 comparison. Isolate advisory parallel/search text only. **Current Parallel Execution section also contains mandatory explicit-coordination routing**; deleting the entire section would remove an authority contract. Preserve that paragraph and phase verification rules in both arms. No effectiveness or retirement verdict yet. |
| HC-02 / S1 guidance plus enforcement | `renderToolManifest` in `src/agents/agent/system-prompt.ts` renders exact offered names and structured-call/XML instructions. `buildOfferedExecutableTools` and `resolveExecutableToolName` in `src/agents/tool-name-resolver.ts` own exact-name resolution. Trigger: manifest assembly and each attempted dispatch. | All providers; dynamic `mcp__*` handles require offered MCP executor binding. `context-phase.ts` renders manifest; `task-loop/main.ts` composes offered surface; `src/agents/subagent-cli.ts` resolves worker calls. `tests/agents/exact-tool-name-resolver.vitest.ts`, `tests/agents/subagent-cli.test.ts`, `tests/run/tool-hallucination-guard.vitest.ts`. | Preserve exact-name boundary. Any future guidance-only simplification requires offered-name/tool-call parity across native and fallback calls. Never admit executor IDs, old aliases, guessed names, or unoffered MCP handles. Model competence cannot replace enforcement. |
| HC-03 / M2 candidate | `defaultEditFormatForProvider`, `buildEditFormatPolicy`, private `normalizePreferredFormat` in `src/execution/patch/edit-format-policy.ts`. Trigger: provider/agent policy construction. | `google`, `local`, `ollama`, `minimax`, `zhipuai`, `grokai` default to `search_replace`; others default to `structured_patch`. Google normalization forces `search_replace`; `full_file` preference normalizes to `search_replace`. `src/agents/agent/agent.ts` and `src/agents/subagent-cli.ts` construct policy. `tests/patch-engine.test.ts`, `tests/patch-tools.test.ts`, `tests/tools/tool-router.test.ts`. | Keep pending authorized per-model format comparison; provider labels alone do not establish current weakness. Compare executable patch preferences while preserving syntax normalization and HC-04. Keep all allowed executable formats; no full-file authorization through a preference toggle. |
| HC-04 / S0, not a removable shim | `buildEditFormatPolicy` in same file returns `fullFileRewrite: "deny"`; `src/capabilities/tools/tool-router.ts` consumes policy. Trigger: policy creation / proposed patch execution. | Provider-independent deny. Same patch/router tests as HC-03; safety qualification remains a separate gate. | Preserve. Replacement requires equivalent enforcement, explicit security review, and independent qualification. Never bundle with HC-03 format ablation. A model promise is not an equivalent control. |
| HC-05 / M1 | `ContextCompiler` in `src/context/repomap/context-compiler.ts`; `warm` builds RepoMap and lazy embedding caches; `compileContext` checks 60-second cache then semantic search, ranking and budgeting. Missing pattern registry falls back to zero threshold bias. | Provider-independent context assembly; default maximum 20,000 tokens unless supplied. `session/setup.ts` constructs compiler and calls `compileContext`; `subagent-cli.ts` constructs worker compiler. `tests/repomap/context-compiler.test.ts`, `context-pipeline.test.ts`, `context-events.test.ts`, `warm-overhead.test.ts`. | Keep. Light/ranked/deep comparisons require defined equivalent inputs, token accounting and task quality evidence (PRE-R008); they are not evidence for deleting compiler. Preserve workspace containment, budget limits, pin semantics and retrieval-as-data boundaries. Existing `context.repo_map_created` / `context.bundle_created` events are conditional on event log and session ID; cache hits return before bundle event. Event counts therefore are not a complete invocation denominator. |

## Current fallback and nudge register

| ID / class | Exact owner, trigger and limits | Static consumers / tests | Keep / retirement criterion and safeguard |
|---|---|---|---|
| SH-01 / M2 candidate with S1 boundary | `src/execution/run/task-loop/main.ts`, XML fallback inside `runTaskLoop`: no structured calls, text contains `<`, provider tools exist. Extracts matching registered tool tags and string parameters into calls. | Same loop then resolves offered names and dispatches normally. `tests/run/tool-hallucination-guard.vitest.ts` covers invalid-tool handling; no dedicated XML-parser qualification claimed here. | Keep until native-call parity demonstrated for every supported affected model/transport. Retirement must not create alternate aliases or bypass exact offered-name and policy checks. Main-loop fallback presence does not imply worker-loop parity. |
| SH-02 / M2 candidate | `runNoToolsCompletion` in `src/execution/run/task-loop/completion-phase.ts`; no valid calls and no completion signal, with remaining iteration budget. `NO_TOOL_NUDGE_LIMIT = 1` in `main.ts`. Tool-marker branch lists available exact names; ordinary branch requests one tool at a time. | `main.ts` calls completion phase; `tests/agent/session-continuity.vitest.ts` covers substantive-answer preservation after nudge/acknowledgment. | Keep pending measured completion/extra-turn tradeoff. Preserve earlier substantive answer when next reply is only acknowledgment. This sequential nudge conflicts with generic parallel-default advice; catalog records conflict, not authorization to change it. Never weaken executed-evidence completion requirements to avoid extra turns. |
| SH-03 / M1 plus S1 completion boundary | `runNoToolsCompletion`, `runDeferredCompletion` in `completion-phase.ts`: missing synthesis or unsubstantiated completion triggers bounded reprompt. `synthesisRequested`, `emptySynthesisRetryRequested` bound synthesis retries; `MAX_UNCONFIRMED_DONE_ATTEMPTS = 2` in `main.ts` bounds evidence correction. | Loop completion path; `tests/agent/session-continuity.vitest.ts`, `tests/run/task-loop-coordination-completion.vitest.ts`. | Keep bounded synthesis recovery until answer retention and completion parity proven. Reprompt text may be compared separately; mutation, post-mutation verification and verified coordination evidence gates must remain. Prose or `alix_done` cannot supply missing execution evidence. |
| SH-04 / M1 tool-surface recovery | `runTaskLoop` in `main.ts` calls `handleShedToolCall`: a known registry tool was scoped out, called, and not previously retried. Adds schema back; `shedToolsRetried` bounds retry once per name. | Sequential and parallel dispatch branches; `tests/run/task-loop-shed-tool.vitest.ts`. Existing `tooling.scope.reintroduced` event records reason `shed_tool_called`. | Keep until tool-scoping admission/recovery parity demonstrated. Reintroduction supplies schema, not authority: exact offered-name, policy, cancellation and execution checks still apply. Do not count event frequency as quality benefit. |
| SH-05 / M1 worker output nudge | `toolsForSubagentIteration` in `src/agents/subagent-cli.ts` reserves final iteration for `WRITE_TOOLS` plus `alix_done` only when write mode has missing owned outputs. Rejected unoffered call supplies owned-output nudge; coordination branch says produce only task-requested outputs inside permitted scope. | Worker provider loop; `tests/agents/subagent-cli.test.ts`. Applies to write workers only; no provider-specific rule. | Keep pending worker completion parity at matched budgets. Ownership and read-only restrictions must remain enforceable independently. Do not broaden paths or replace task objective merely to produce any file. |

## Completion boundary

Catalog fields now have concrete source owners, triggers, applicability, coverage
and retirement conditions. PRE-R009's **runtime usage evidence remains open**.
Close that field only with a reproducible run/observation source, model and
provider identity, activation definition, denominator, and missing-data policy.
Do not invent counts, start ablations, or infer effectiveness from catalog size.
Graph repair and independent security qualification remain separate blockers.
