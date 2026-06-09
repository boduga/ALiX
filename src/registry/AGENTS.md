# DOX — Registry (Agent/Tool Cards)

**Purpose:** Agent and tool identity, capability registration, and resolution — answers "can ALiX do this?"

**Ownership:**
- `agent-card.ts` — AgentCard type, validateAgentCard()
- `tool-card.ts` — ToolCard type, validateToolCard()
- `card-registry.ts` — In-memory registry with register/list/find/get
- `capability-resolver.ts` — Resolve capabilities to agents/tools with domain and profile filtering
- `card-loader.ts` — Load cards from `.alix/cards/{agents,tools}/*.json`, fall back to 6 agent + 4 tool defaults

**Local Contracts:**
- Cards must pass validation before registration (description required, valid risk levels, etc.).
- Duplicate IDs are rejected on registration.
- Disabled cards are excluded from capability resolution by default.
- Card loader falls back to built-in defaults when no card files exist.

**Work Guidance:**
- CapabilityResolver feeds into RuntimeGate (src/policy/runtime-gate.ts) as the first layer.
- Adding a new built-in card means updating `card-loader.ts` default functions and possibly `capability-resolver.ts`.

**Verification:**
- `tests/registry/card-registry.test.ts` — registration, listing, filtering, duplicates
- `tests/registry/card-loader.test.ts` — disk loading, defaults, invalid files
