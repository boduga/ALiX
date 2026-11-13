# Capability Registry (Agent/Tool Cards)

## Overview

Identity and capability catalog for ALiX: cards describe agents and tools, and a resolver answers which enabled cards cover a task node's required capabilities under a domain and execution profile. Cards are validated before registration and held in an in-memory registry.

The tool side is a derived projection, not a hand-maintained list: membership, `capabilityId`, risk, and mutability come from the canonical tool-capability port, so the card taxonomy cannot drift from the tools that actually exist. The loader reads `.alix/cards/{agents,tools}/*.json` and falls back to built-in defaults independently per card kind.

## Interface

- `AgentCard` — id, name, description, version, domains, capabilities, optional model/execution profile, IO modes, concurrency, safety tags, and `enabled` [agent-card.ts:AgentCard]
- `validateAgentCard(card)` — returns `{ valid, errors }` for required fields [agent-card.ts:validateAgentCard]
- `AgentCardValidation` — validation result shape [agent-card.ts:AgentCardValidation]
- `ToolCard` — id, name, description, version, capabilities, `riskLevel`, `approvalMode`, optional schemas, allowed execution profiles, side effects, and `enabled` [tool-card.ts:ToolCard]
- `validateToolCard(card)` — validates required fields plus risk and approval enums [tool-card.ts:validateToolCard]
- `ToolCardValidation` — validation result shape [tool-card.ts:ToolCardValidation]
- `CardRegistry` — in-memory agent/tool maps with register, list, capability find, and id get [card-registry.ts:CardRegistry]
- `CapabilityResolution` — resolved agents, tools, `missingCapabilities`, and `warnings` [capability-resolver.ts:CapabilityResolution]
- `ResolveInput` — `requiredCapabilities`, optional `domain` and `executionProfile`, and a `registry` [capability-resolver.ts:ResolveInput]
- `resolveCapabilities(input)` — resolves cards per capability and reports gaps [capability-resolver.ts:resolveCapabilities]
- `defaultWorkflowAgentCards()` — five P4.5 workflow catalog cards [card-loader.ts:defaultWorkflowAgentCards]
- `deriveNlpAgentCards()` — NLP delegate cards projected from `AGENT_REGISTRY` [card-loader.ts:deriveNlpAgentCards]
- `defaultAgentCards()` — the eleven default agent cards [card-loader.ts:defaultAgentCards]
- `defaultToolCards(catalog?)` — tool cards derived from `ToolCapabilityRegistry` [card-loader.ts:defaultToolCards]
- `loadCardRegistry(cwd)` — loads card files or built-in defaults into a `CardRegistry` [card-loader.ts:loadCardRegistry]

## Invariants

- Registration validates first and rejects an invalid card with an `Invalid AgentCard`/`Invalid ToolCard` error naming every validation error [card-registry.ts:registerAgent] [card-registry.ts:registerTool]
- Duplicate ids are rejected separately: `Agent already registered` / `Tool already registered` [card-registry.ts:registerAgent] [card-registry.ts:registerTool]
- `listAgents`/`listTools` exclude disabled cards by default and include them only when `includeDisabled` is true [card-registry.ts:listAgents] [card-registry.ts:listTools]
- Capability lookup is a string membership test on `capabilities` [card-registry.ts:findAgentsByCapability] [card-registry.ts:findToolsByCapability]
- `getAgent`/`getTool` do not filter on `enabled`, so a disabled card is still retrievable by id [card-registry.ts:getAgent] [card-registry.ts:getTool]
- `validateAgentCard` requires id, name, description, version, array domains, array capabilities, and a defined `enabled` [agent-card.ts:validateAgentCard]
- `validateToolCard` additionally requires `riskLevel` in `low|medium|high|critical` and `approvalMode` in `auto|ask|deny` [tool-card.ts:validateToolCard]
- Domain filtering is a soft preference: when no agent matches the requested domain, the resolver falls back to the unfiltered capability matches rather than reporting the capability missing [capability-resolver.ts:resolveCapabilities]
- Execution-profile filtering is permissive: an agent with no `executionProfile` always matches; a tool with no `allowedExecutionProfiles` always matches [capability-resolver.ts:resolveCapabilities]
- A capability is reported missing only when both the agent profile match and the tool profile match are empty [capability-resolver.ts:resolveCapabilities]
- High- and critical-risk matching tools emit a `Tool <id> has risk level: <level>` warning [capability-resolver.ts:resolveCapabilities]
- Resolver output deduplicates agents and tools by id, and capabilities in `missingCapabilities`, preserving first-seen order [capability-resolver.ts:resolveCapabilities]
- Defaults are per-kind: if agent files load no valid card, agent defaults are registered; the tool kind falls back independently [card-loader.ts:loadCardRegistry]
- A single unreadable or invalid card file is logged to stderr and skipped; it does not abort loading, and a successfully loaded sibling keeps the defaults suppressed for that kind [card-loader.ts:loadCardRegistry]
- `defaultAgentCards()` is exactly the NLP delegate cards followed by the five workflow cards, and it is catalog metadata only — it neither activates nor instantiates workflow agents [card-loader.ts:defaultAgentCards] [card-loader.ts:defaultWorkflowAgentCards]
- Every tool card is derived from the canonical catalog: a canonical capability with no tool-registry implementation throws instead of being silently dropped [card-loader.ts:defaultToolCards]
- Derived tool `approvalMode` is `auto` only for `low` risk and `ask` otherwise; `sideEffects` is `write` when the capability mutates and `read` otherwise [card-loader.ts:defaultToolCards]
- The `mcp.*` tool name maps to the display name `MCP Tool`; other names are dot/underscore split and title-cased [card-loader.ts:displayName]

## Side Effects

- `loadCardRegistry` reads `.alix/cards/agents` and `.alix/cards/tools` and parses JSON card files [card-loader.ts:loadCardRegistry]
- Load failures are written to `console.error` per file [card-loader.ts:loadCardRegistry]
- `defaultToolCards` constructs a `ToolCapabilityRegistry` and the default tool index when no catalog is supplied [card-loader.ts:defaultToolCards]
- Registration mutates in-memory `Map`s only; this directory performs no file writes, network calls, or lock acquisition [card-registry.ts:CardRegistry]
- `resolveCapabilities` is pure with respect to the supplied registry [capability-resolver.ts:resolveCapabilities]

## Verification

- Run: `pnpm test`
