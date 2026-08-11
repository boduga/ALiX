# Capability Classification + Provider Fallback Patterns in Adjacent Systems

Research ticket: [#473 — "Research: Capability classification + provider fallback patterns in adjacent systems"](https://github.com/boduga/ALiX/issues/473)
Date: 2026-08-10
Feeds: "What is the canonical `CapabilityKind` vocabulary?" + "One provider/binding vocabulary + fallback model" (ADR-0013, greenfield plan Workstream 1)

## TL;DR — recommended vocabulary for ALiX

- **There is no universal semantic-kind enum in adjacent systems.** The industry classifies by *invocation surface* (command vs skill vs tool vs hook), by *implementation* (Semantic Kernel's native vs semantic function), or by *free-text description* (Claude Code / Agent Skills). Nobody ships a `kind` enum that means what ADR-0013 §6 wants. The closest semantic schemes distinguish along **four orthogonal axes**: side-effect (read vs write), composition (atomic vs workflow), control (model/user/application initiated), and autonomy (delegated agent).
- **Adoptable `CapabilityKind`**: `query` | `operation` | `workflow` | `agent` (+ `core` kept as an ALiX provenance nuance). Drop the implementation-shaped drafts `tool`, `plugin`, `custom` (greenfield design §7.1, `src/capability/types.ts:7`). These four map to real, sourced precedents below.
- **Adoptable provider-binding + fallback vocabulary**: borrow the gateway/router conventions — an **ordered `providers[]` list** (priority), `allow_fallbacks: boolean` (explicit pin vs auto), **bounded single-pass iteration**, and **fallback-eligible error classes** (unavailable/429/5xx/timeout) vs fatal (malformed/400/auth). Reuse ALiX's existing `CircuitBreaker` + `checkProvider` as the health/availability signal in the resolver.
- **ALiX's own precedent is static, not dynamic**: the provider is chosen once at startup from `models.default`/`models[tier]`; there is no per-request provider failover in the runtime loop. Circuit breaker exists but is not wired into request routing. That is exactly the gap the capability provider-binding model must close.

---

## 1. Semantic capability classification vocabularies (with sources)

### 1.1 MCP protocol — the canonical protocol-level taxonomy (operations / data / workflows)

MCP defines **three server primitives**, distinguished by *what they are semantically* and *who controls them*:

> | Feature | Explanation | Who controls it |
> | **Tools** | Functions your LLM can actively call … Tools can write databases, call external APIs, modify files, trigger other logic. | Model |
> | **Resources** | Passive data sources provide read-only access … file contents, database schemas, API documentation. | Application |
> | **Prompts** | Pre-built instruction templates tell the model to work with specific tools and resources. | User |

Source: [MCP "Understanding MCP servers" (2026-07-28)](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts) — verbatim table.

Semantically this is a **query/operation/workflow** split in different words: Resources = read-only data access (queries), Tools = single side-effectful operations ("Each tool performs a single operation with typed inputs/outputs"), Prompts = reusable workflows ("structured templates … create comprehensive workflows"). The **2025-11-25 spec** keeps these three primitives and adds only an experimental **tasks** *utility* — "tracking durable requests with polling and deferred result retrieval" — not a fourth top-level primitive. Source: [MCP 2025-11-25 changelog](https://modelcontextprotocol.info/specification/2025-11-25/changelog/).

### 1.2 Claude Code — classification by invocation surface + description, not by a kind enum

- **Commands and skills are the same mechanism**; a `.claude/commands/*.md` and a `.claude/skills/*/SKILL.md` both create `/name`. Built-in commands execute "fixed logic directly"; bundled skills are "prompt-based" (both listed in the commands reference, marked *Skill*). Source: prior ALiX research [`docs/research/custom-command-patterns.md`](custom-command-patterns.md) §1.5; [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills).
- **There is no `kind` field.** A skill is classified by free-text `description` (+ `when_to_use`), plus invocation-control flags (`user-invocable`, `disable-model-invocation`) and a `context: fork` + `agent` pair for subagent delegation. So Claude Code's only semantic axes are **description** and **who may invoke it** — no semantic-kind enum.
- **Hooks are lifecycle, not capability taxonomy** (`PreToolUse`, `PostToolUse`, …): they classify *when* code runs around a step, not what a capability *is*. Not a model for `CapabilityKind`.

### 1.3 Agent Skills open standard (agentskills.io) — description-driven, progressive disclosure

> "A skill is a folder containing a `SKILL.md` file. The file includes metadata (`name`, `description` — the minimum) and instructions telling an agent how to perform a specific task."

Required frontmatter is **only `name` + `description`**; optional `license`, `compatibility`, `metadata`, `allowed-tools`. Source: [agentskills.io specification](https://agentskills.io/specification). There is **no semantic category enum** — classification is by description plus the progressive-disclosure stages (discovery → activation → execution). This is the open standard Claude Code, Cursor, Codex, and Cline now share.

### 1.4 Microsoft Semantic Kernel — classification by implementation (the anti-model for CapabilityKind)

Semantic Kernel's taxonomy is **purely by implementation/expression**, exactly what ADR-0013 §6 forbids for `kind`:

> - **Plugin**: "A domain-specific collection made available to the SK as a group of finely-tuned functions."
> - **Function**: "A computational machine comprised of Semantic AI and/or native code that's available in a PLUGIN."
> - **Native Function**: "expressed with traditional computing language (C#, Python, Typescript)…"
> - **Semantic Function**: "expressed in natural language in a text file `skprompt.txt`…"

Source: [microsoft/semantic-kernel GLOSSARY.md](https://raw.githubusercontent.com/microsoft/semantic-kernel/main/docs/GLOSSARY.md) (verbatim). Note: *"native vs semantic describes how a function is built, not what it computes."* This is a useful contrast case: it maps onto ALiX's **provider** dimension, not the kind dimension. (Legacy term "Skills" was renamed to "Plugins"; both mean the container.)

### 1.5 Emergent semantic taxonomies worth citing

These are less-adopted but show the semantic axes real projects converge on:

- **[synaptiai/agent-capability-standard](https://github.com/synaptiai/agent-capability-standard)** — the closest thing to a *semantic capability ontology*:
  - **Capability**: "An atomic primitive that does one thing well" — has a `layer` classification and a **`mutation` flag** (side-effect marker).
  - **Workflow**: "An ordered, conditional, or parallel composition of capabilities."
  - **Skill**: "A self-contained unit that implements a capability" (SKILL.md + YAML frontmatter).
  - **Layer**: "A functional category grouping capabilities by their primary purpose" — 9 cognitive layers (PERCEIVE, UNDERSTAND, REASON, MODEL, SYNTHESIZE, EXECUTE, VERIFY, REMEMBER, COORDINATE) over 36 atomic capabilities.
  - Key: it separates **atomic capability** (operation/query) from **workflow** (composition), and marks **read vs mutate** on every capability — the two axes below.
- **[govtech Agentic Risk Capability Framework](https://govtech-responsibleai.github.io/agentic-risk-capability-framework/arc_framework/elements/)** — three capability categories: **cognitive** (planning, analysis, learning), **interaction** (communication, tool use), **operational** (executing actions).
- **[iso-capabilities](https://socket.dev/npm/package/@agent-pattern-labs/iso-capabilities/overview/0.1.1)** — role-based policy checks across five dimensions: **tools, MCP servers, commands (allowlist/denylist), filesystem modes, network modes** — treats "command" and "query"-ish filesystem/network access as distinct permissioned capability types.
- **[Knowledge Operations capability model](https://gerasimos.github.io/knowledge-operations/)** — distinguishes **retrieval access patterns** (vector/hybrid/SQL/graph/BM25) from **knowledge operations** (the orchestration-layer decision of *when/what/how* to retrieve). Retrieval is an access pattern; the operation is the composed decision.
- **[Cherry AI agent workspace](https://docs.cherryai.com.cn/docs/en-us/advanced-basic/agent-workspace/tools-knowledge-skills-mcp.md)** — a practical 4-way classification: **built-in tools** (direct actions), **knowledge bases** (retrievable materials = queries), **skills** (workflows/standards), **MCP** (external tool/data connections).

### 1.6 What the vocabulary actually converges on

The ticket asks whether "operation/query/command/workflow/agent" exists anywhere worth adopting. It does, as *orthogonal axes*, not one enum:

| Axis | Question | Evidence | Maps to ALiX |
| --- | --- | --- | --- |
| **Side-effect** | read-only vs mutating | MCP Resources=read vs Tools=write; synaptiai `mutation` flag; CQRS query/command; iso-capabilities filesystem modes | `query` vs `operation` |
| **Composition** | atomic vs multi-step | MCP Tools "single operation" vs Prompts "workflows"; synaptiai Capability vs Workflow; Agent Skills as workflows | `operation` vs `workflow` |
| **Control** | model / user / application initiated | MCP control column; Claude Code `user-invocable`/`disable-model-invocation` | metadata, not kind |
| **Autonomy** | delegated autonomous execution | Claude Code `context: fork` + `agent`; MCP async tasks; synaptiai COORDINATE layer (delegate/synchronize/invoke/inquire) | `agent` |
| **Implementation** | how it's built (native/prompt/tool/mcp/cli) | Semantic Kernel native-vs-semantic; ALiX ADR-0013 provider types | **provider dimension, NOT kind** |

**Conclusion for (a):** No adjacent system ships a semantic `CapabilityKind` enum; they classify by surface, description, or implementation. The only semantic scheme worth adopting is a small kind union over the *side-effect* and *composition* axes — `query` / `operation` / `workflow` / `agent` — with control as metadata. Everything else (native, tool, mcp, cli, daemon, plugin) belongs in the provider binding.

---

## 2. Provider fallback / priority patterns (with sources)

All adjacent routers use the same core vocabulary with different spellings. Key primitives: **ordered priority list**, **bounded iteration**, **allow_fallbacks toggle**, **fallback-eligible error classes**, **health-based auto-selection**, **attempt observability**.

### 2.1 Vercel AI Gateway — provider routing + model failover

- **Provider-level** `providerOptions.gateway`: `order` (exact provider sequence; first in list tried first), `only` (restrict to a subset; fail if none available), `sort` (`cost` | `ttft` | `tps`), `has` (capability filter, e.g. `['implicit-caching']`).
- **Model-level** `models` array: "Fallback models are tried **in the specified order** until a request succeeds or no options remain. Any error — context limits, unsupported inputs, provider outages, capability mismatches (multimodal, tool-calling) — can trigger a fallback. The response comes from the **first model/provider combination that succeeds**."
- **Health-based default**: "dynamically chooses providers based on recent uptime and latency" unless `order`/`only` override.
- **Observability**: `result.providerMetadata.modelAttempts` reports each model tried (`canonicalSlug`, `modelId`, `providerAttempts` error details).

Sources: [Vercel — Model Fallbacks](https://examples.vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks), [Provider Filtering, Ordering & Sorting](https://examples.vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering), [Model fallbacks changelog](https://vercel.com/changelog/model-fallbacks-now-available-in-vercel-ai-gateway), [Provider Options](https://examples.vercel.com/docs/ai-gateway/models-and-providers/provider-options).

### 2.2 OpenRouter — two layered mechanisms

- **Provider routing** (`provider` object): `order` = "try providers in this exact, prioritized order"; `allow_fallbacks` = fall through to other providers when your picks fail (default `true`; set `false` to pin only approved providers for compliance/region/BYOK); `only` / `ignore`; `sort` by `price` | `throughput` | `latency`; `max_price`, `preferred_min_throughput`, `preferred_max_latency`.
- **Model fallbacks** (`models` array): "If the first model returns an error, OpenRouter automatically tries the next model in the list … walks the models array **once, in order** — it is not an infinite retry chain. Non-fallback-eligible errors (e.g. a 400 for a malformed request) come straight back without triggering fallback."
- **Health-based**: provider failover routes around down/slow providers using real-time health (response times, error rates, availability) with a **~30-second outage window**.
- **Presets**: centralize a fallback chain + provider rules once, reference as `@preset/name`.

Sources: [OpenRouter — Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [OpenRouter — Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection), [OpenRouter — How Model Routing Works](https://openrouter.ai/docs/guides/routing/model-fallbacks), [OpenRouter — Failover vs Model Fallbacks](http://openrouter.hconeai.com/blog/insights/reliability-failover/).

### 2.3 LangChain — `with_fallbacks()` / `RunnableWithFallbacks`

- Wrap a primary runnable with an **ordered fallback list**; try primary, then each fallback with the same input until one succeeds or all are exhausted; return the last exception when everything fails.
- **Trigger control**: `exceptions_to_handle` (default `(Exception,)`) and `exception_key`; for distinguishing retryable vs fatal errors (e.g. `RateLimitError` vs `AuthenticationError`) LangChain docs recommend explicit `try/except` instead — i.e. **fallback is error-class-gated, not blanket**.
- **Agent middleware**: `modelFallbackMiddleware(primary, fallbacks…)` in `createAgent`.
- **LangSmith LLM Gateway** (server-side): define fallback configs as **ordered chains keyed on HTTP status codes** (429, 500, 502, 503, 504); each attempt is traced and counted separately.
- **Best practice**: order fallbacks by increasing latency/cost ("fast lookup → expensive LLM"), never reversed.

Sources: [LangChain — Model fallbacks](https://docs.langchain.com/langsmith/llm-gateway-fallbacks), [RunnableWithFallbacks reference](https://reference.langchain.com/python/langchain-core/runnables/fallbacks/RunnableWithFallbacks), [langchain_js model_fallback middleware](https://github.com/langchain-ai/langchain/blob/8182d6302dc81bc62849f9aa88ff698489b0e665/libs/langchain_v1/langchain/agents/middleware/model_fallback.py#L24).

### 2.4 Cross-cutting fallback pattern summary

| Pattern | Vercel | OpenRouter | LangChain | Notes |
| --- | --- | --- | --- | --- |
| Ordered priority list | `order` | `order` | `fallbacks` list | Always deterministic, first-success wins |
| Bounded iteration | models array | walks once | exhausts list | No infinite retry; return last error |
| Pin vs auto | `only` | `allow_fallbacks` | — | Explicit "do not fall through" for compliance |
| Error-class gating | any error incl. capability mismatch | fallback-eligible vs 400-fatal | `exceptions_to_handle`, status-code gates | Unavailable/429/5xx/timeout ⇒ fallback; malformed/auth ⇒ fatal |
| Health-based selection | uptime+latency | 30s outage window | gateway health | Needed for the "unpinned" case |
| Attempt observability | `modelAttempts` | `provider_responses` | per-attempt tracing | Which provider/model served + why each attempt failed |

---

## 3. ALiX's own provider-routing precedent (file:line)

ALiX routes across ~14 providers (anthropic, openai, google, openrouter, groq, ollama, perplexity, minimax, minimax-token-plan, zhipuai, grokai, deepseek, local-llama, mock). The architecture is **static selection + retry**, not dynamic cross-provider failover.

- **Static, once-per-process selection**: `resolveModelConfig(config, tier?)` reads the canonical `models.default` or `models[tier]` and returns a single `{ provider, model }` (src/config/model-resolver.ts:16-59). It is called once at session start (src/agent/agent.ts:116-123) to build the model adapter.
- **Provider factory**: `createProvider({ provider, model }, apiKey)` lazy-loads the provider class, caches instances by `provider:model:apiKey`, and wraps them with `withProviderContracts` (180s complete / 60s stream-idle timeouts) (src/providers/registry.ts:42-61).
- **Init-time detection precedence (auto mode)**: `detectProvider()` — env var wins → user-config `apiKeys` (in `PROVIDERS` order) → **ollama as final fallback** (src/providers/catalog.ts:235-262). Init mode selection: explicit `--provider` (flagged) > auto `detectProvider()` (non-TTY) > interactive prompt (src/cli/helpers/provider-selection.ts:358-390). This is ALiX's only *ordered multi-source* provider selection, and it mirrors the `order`-list pattern in §2.
- **Circuit breaker exists but is not wired into routing**: `CircuitBreaker` — closed/open/half-open, trips after 3 consecutive failures, 30s cooldown before probe (src/providers/circuit-breaker.ts:9-67). It is referenced only by observability (`src/observability/health-snapshot.ts:154`), not by the request path. This is the health/availability signal that the capability resolver should reuse.
- **Explicit health probe**: `checkProvider(provider, model, apiKey)` runs a test complete + stream round-trip and returns a `ProviderHealthResult` (src/providers/provider-doctor.ts:27-66); surfaced via `alix provider doctor` (src/cli/commands/provider-doctor.ts, wired at src/cli.ts:2727).
- **HTTP-level retry (same provider)**: `fetchWithRetry` retries 429/5xx up to 3 times with exponential backoff (src/providers/unified-complete.ts:63-80) — retry on the same endpoint, never a switch to another provider.
- **Tool-result retryability**: tool errors carry a `retryable` flag; the agent is told whether to retry or not (src/run/event-handlers.ts:271,342-373; src/agent/messages.ts:6-10).
- **Tooling-scope fallback**: `scopeToolsByTask` returns a `fallbackFull` result that re-admits previously scoped-out tools (TOOLING_SCOPE_FALLBACK_FULL, src/run/task-loop.ts:434-448; re-introduction at 1119).

**Local takeaway:** ALiX's "multi-provider" support is *selection* (pick one at startup) + *retry* (retry the same one), with health/breaker infrastructure present but not consulted at dispatch. There is no `providers[]` ordered list, no `allow_fallbacks` toggle, and no attempt log on the hot path today — the greenfield capability provider-binding model is the first place to introduce them.

---

## 4. What's directly adoptable for CapabilityKind + provider-binding

### 4.1 CapabilityKind (semantic, per ADR-0013 §6)

Adopt a small **semantic** kind union over the side-effect and composition axes, and move every implementation term to the provider binding:

```ts
type CapabilityKind = "core" | "query" | "operation" | "workflow" | "agent";
```

| Kind | Meaning | Evidence |
| --- | --- | --- |
| `core` | Built-in ALiX runtime capability (e.g. `core.session.list`) | Existing ALiX draft keeps `core`; provenance nuance, not an implementation |
| `query` | Read-only, side-effect-free data access | MCP Resources (read-only, application-controlled); synaptiai `mutation: false`; iso-capabilities filesystem read modes |
| `operation` | Single atomic side-effectful action | MCP Tools ("each tool performs a single operation"); synaptiai atomic capability with `mutation: true` |
| `workflow` | Ordered / conditional / parallel composition of capabilities | MCP Prompts ("workflows"); Agent Skills; synaptiai Workflow definition |
| `agent` | Delegated autonomous subagent execution | Claude Code `context: fork` + `agent`; MCP async tasks; synaptiai COORDINATE layer |

**Drop from `kind`** (they are implementations / surfaces, not semantic forms): `tool`, `plugin`, `custom`, `mcp`, `cli`, `daemon` — the greenfield design's current `kind` draft (`"core" | "tool" | "skill" | "workflow" | "plugin" | "custom"`, design spec §7.1 lines 235-241) and the live `src/capability/types.ts:7` (`"core" | "tool" | "skill" | "custom" | "workflow" | "plugin"`) both leak implementation vocabulary. `skill` is an *invocation surface / packaging format* (SKILL.md folder), not a semantic form; keep it out of `kind` (can remain a tag/category or a provider class).

**Keep orthogonal dimensions as metadata, not kind** (all have precedents):
- control / who may initiate — Claude Code `user-invocable`, `disable-model-invocation`; MCP control column;
- `mutation` / `side_effect: boolean` — synaptiai `mutation` flag (query=read, operation=write);
- `category`, `tags` — design spec §7.1 already has `category`/`tags`; Agent Skills uses free-text `description`.

The design spec's `strategy` field (`"native" | "tool" | "daemon" | "agent" | "cli" | "workflow" | "plugin"`, §9 lines 322-331) is the **provider** dimension and should move into the provider binding as `provider.type`, per ADR-0013 §4/§6.

### 4.2 Provider binding + fallback (per ADR-0013 §4, §5; plan Workstream 4)

Model the binding vocabulary on the converged gateway/router conventions (§2), which already match the plan's requirements:

- **Ordered providers list with explicit priority** — `providers: ProviderBinding[]` ordered best-first (Vercel `order`, OpenRouter `order`, LangChain `fallbacks` list). Satisfies plan §4.2 "configured priority" and "deterministic for equivalent inputs."
- **`allow_fallbacks: boolean`** (default `true`) to pin a single provider when compliance/region requires (OpenRouter `allow_fallbacks`; Vercel `only`). Plan §4.2's "permission compatibility / workspace constraints" map to `only`-style restrictions.
- **Bounded single-pass fallback execution** — walk the list once; return the first success or the last error (OpenRouter walks `models` once; LangChain exhausts then returns last exception). No infinite retry.
- **Fallback-eligible error classification** — separate unavailable/429/5xx/timeout/context-length (⇒ try next provider) from fatal malformed/400/auth (⇒ return immediately). This mirrors LangSmith's status-code gates, OpenRouter's "non-fallback-eligible errors", and ALiX's existing `retryable` flag (src/run/event-handlers.ts:342).
- **Health-based selection for the unpinned case** — wire the existing `CircuitBreaker` (src/providers/circuit-breaker.ts) and `checkProvider` health probe (src/providers/provider-doctor.ts) into the resolver's `getAvailableProviders(id, context)` (plan §2.2), so availability filters the candidate list. Vercel/OpenRouter both do health-based auto-selection; ALiX has the components but hasn't connected them.
- **Attempt observability** — record which provider served and why each failed (Vercel `modelAttempts`, OpenRouter `provider_responses`). Feeds A7/P5.5 health signals without changing capability lifecycle (ADR-0013 §8).
- **Provider outage ≠ capability lifecycle change** — provider failover must not deprecate the capability (ADR-0013 §8, plan §4.3/§11.2). This is exactly OpenRouter's two-layer split: *provider* failover keeps the same model/capability alive; *model/capability* fallback is a separate, explicit list.

---

## 5. Sources

### Semantic classification
- MCP — Understanding MCP servers (Tools/Resources/Prompts + control): https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts
- MCP — Specification 2025-11-25 (3 server primitives; experimental tasks utility): https://modelcontextprotocol.info/specification/2025-11-25/
- Claude Code — Extend Claude with skills (commands merged into skills): https://code.claude.com/docs/en/skills
- Agent Skills open standard — overview + specification: https://agentskills.io/ · https://agentskills.io/specification
- Semantic Kernel — GLOSSARY (Plugin/Function/Native/Semantic): https://github.com/microsoft/semantic-kernel/blob/main/docs/GLOSSARY.md
- synaptiai/agent-capability-standard — GLOSSARY (Capability/Workflow/Skill/Layer, 9 layers): https://github.com/synaptiai/agent-capability-standard/blob/main/docs/GLOSSARY.md
- govtech Agentic Risk Capability Framework — elements: https://govtech-responsibleai.github.io/agentic-risk-capability-framework/arc_framework/elements/
- iso-capabilities (role-based tool/MCP/command/filesystem/network policy): https://socket.dev/npm/package/@agent-pattern-labs/iso-capabilities/overview/0.1.1
- Knowledge Operations capability model: https://gerasimos.github.io/knowledge-operations/
- Cherry AI — Tools / Knowledge Bases / Skills / MCP: https://docs.cherryai.com.cn/docs/en-us/advanced-basic/agent-workspace/tools-knowledge-skills-mcp.md
- Prior ALiX research on the same surface (skills/commands convergence): docs/research/custom-command-patterns.md

### Provider fallback / priority
- Vercel AI Gateway — Model Fallbacks: https://examples.vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks
- Vercel AI Gateway — Provider Filtering, Ordering & Sorting: https://examples.vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering
- Vercel — Model fallbacks changelog: https://vercel.com/changelog/model-fallbacks-now-available-in-vercel-ai-gateway
- OpenRouter — Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- OpenRouter — Provider Routing (order/allow_fallbacks/only/sort): https://openrouter.ai/docs/guides/routing/provider-selection
- OpenRouter — Failover vs Model Fallbacks: http://openrouter.hconeai.com/blog/insights/reliability-failover/
- LangChain — Model fallbacks (LangSmith gateway, status-code gates): https://docs.langchain.com/langsmith/llm-gateway-fallbacks
- LangChain — RunnableWithFallbacks: https://reference.langchain.com/python/langchain-core/runnables/fallbacks/RunnableWithFallbacks
- LangChain — model_fallback agent middleware: https://github.com/langchain-ai/langchain/blob/8182d6302dc81bc62849f9aa88ff698489b0e665/libs/langchain_v1/langchain/agents/middleware/model_fallback.py#L24

### ALiX local precedent (this repo)
- src/config/model-resolver.ts (static model selection)
- src/providers/registry.ts (createProvider factory), src/providers/catalog.ts (detectProvider precedence), src/providers/circuit-breaker.ts, src/providers/provider-doctor.ts, src/providers/unified-complete.ts (fetchWithRetry)
- src/run/event-handlers.ts (retryable), src/run/task-loop.ts (tooling-scope fallback)
- src/capability/types.ts (current kind union), docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md, docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md
