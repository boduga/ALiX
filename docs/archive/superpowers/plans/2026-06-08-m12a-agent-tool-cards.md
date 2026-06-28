# M0.12-A: Agent Card + Tool Card Schemas and Registry

**Status:** ✅ Completed (M0.12) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed `AgentCard` and `ToolCard` schemas plus an in-memory `CardRegistry` with register/list/find-by-capability, validation, and duplicate ID rejection.

**Architecture:** Three small files in `src/registry/` — types with validation functions for each card type, and a `CardRegistry` class that holds agents and tools in `Map<string, T>` structures. Validation happens on registration. Duplicate IDs are rejected. Disabled cards are excluded from list/find results by default.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/registry/agent-card.ts` | **Create** | `AgentCard` type, `validateAgentCard()` |
| `src/registry/tool-card.ts` | **Create** | `ToolCard` type, `validateToolCard()` |
| `src/registry/card-registry.ts` | **Create** | `CardRegistry` class |
| `tests/registry/card-registry.test.ts` | **Create** | Tests for all registry operations |

---

### Task 1: Create AgentCard type

**Files:**
- Create: `src/registry/agent-card.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * agent-card.ts — AgentCard schema and validation.
 *
 * Describes an agent identity with capabilities, domains, execution profile,
 * and safety metadata. Cards are validated before registration.
 */

export interface AgentCard {
  id: string;
  name: string;
  description: string;
  version: string;
  domains: string[];
  capabilities: string[];
  modelProfile?: string;
  executionProfile?: "general" | "research" | "coding" | "critic" | "artifact";
  inputModes?: string[];
  outputModes?: string[];
  maxConcurrency?: number;
  safetyTags?: string[];
  enabled: boolean;
}

export interface AgentCardValidation {
  valid: boolean;
  errors: string[];
}

export function validateAgentCard(card: AgentCard): AgentCardValidation {
  const errors: string[] = [];
  if (!card.id || typeof card.id !== "string") errors.push("id is required");
  if (!card.name || typeof card.name !== "string") errors.push("name is required");
  if (!card.description) errors.push("description is required");
  if (!card.version) errors.push("version is required");
  if (!Array.isArray(card.domains)) errors.push("domains must be an array");
  if (!Array.isArray(card.capabilities)) errors.push("capabilities must be an array");
  if (card.enabled === undefined) errors.push("enabled is required");
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/registry/agent-card.ts
git commit -m "feat(registry): add AgentCard type and validation"
```

---

### Task 2: Create ToolCard type

**Files:**
- Create: `src/registry/tool-card.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * tool-card.ts — ToolCard schema and validation.
 *
 * Describes a tool with capabilities, risk level, approval mode,
 * and side effects. Cards are validated before registration.
 */

export interface ToolCard {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  approvalMode: "auto" | "ask" | "deny";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  allowedExecutionProfiles?: string[];
  sideEffects?: "none" | "read" | "write" | "network" | "system";
  enabled: boolean;
}

export interface ToolCardValidation {
  valid: boolean;
  errors: string[];
}

export function validateToolCard(card: ToolCard): ToolCardValidation {
  const errors: string[] = [];
  if (!card.id || typeof card.id !== "string") errors.push("id is required");
  if (!card.name || typeof card.name !== "string") errors.push("name is required");
  if (!card.description) errors.push("description is required");
  if (!card.version) errors.push("version is required");
  if (!Array.isArray(card.capabilities)) errors.push("capabilities must be an array");
  const validRisks = ["low", "medium", "high", "critical"];
  if (!validRisks.includes(card.riskLevel)) errors.push(`riskLevel must be one of: ${validRisks.join(", ")}`);
  const validApprovals = ["auto", "ask", "deny"];
  if (!validApprovals.includes(card.approvalMode)) errors.push(`approvalMode must be one of: ${validApprovals.join(", ")}`);
  if (card.enabled === undefined) errors.push("enabled is required");
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/registry/tool-card.ts
git commit -m "feat(registry): add ToolCard type and validation"
```

---

### Task 3: Create CardRegistry

**Files:**
- Create: `src/registry/card-registry.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * card-registry.ts — In-memory registry for AgentCards and ToolCards.
 *
 * Supports register, list, find-by-capability, and disabled-card filtering.
 * Duplicate IDs are rejected on registration.
 */

import type { AgentCard } from "./agent-card.js";
import { validateAgentCard } from "./agent-card.js";
import type { ToolCard } from "./tool-card.js";
import { validateToolCard } from "./tool-card.js";

export class CardRegistry {
  private agents = new Map<string, AgentCard>();
  private tools = new Map<string, ToolCard>();

  registerAgent(card: AgentCard): void {
    const validation = validateAgentCard(card);
    if (!validation.valid) throw new Error(`Invalid AgentCard: ${validation.errors.join("; ")}`);
    if (this.agents.has(card.id)) throw new Error(`Agent already registered: ${card.id}`);
    this.agents.set(card.id, card);
  }

  registerTool(card: ToolCard): void {
    const validation = validateToolCard(card);
    if (!validation.valid) throw new Error(`Invalid ToolCard: ${validation.errors.join("; ")}`);
    if (this.tools.has(card.id)) throw new Error(`Tool already registered: ${card.id}`);
    this.tools.set(card.id, card);
  }

  listAgents(includeDisabled = false): AgentCard[] {
    const all = Array.from(this.agents.values());
    return includeDisabled ? all : all.filter(a => a.enabled);
  }

  listTools(includeDisabled = false): ToolCard[] {
    const all = Array.from(this.tools.values());
    return includeDisabled ? all : all.filter(t => t.enabled);
  }

  findAgentsByCapability(capability: string, includeDisabled = false): AgentCard[] {
    return this.listAgents(includeDisabled).filter(a => a.capabilities.includes(capability));
  }

  findToolsByCapability(capability: string, includeDisabled = false): ToolCard[] {
    return this.listTools(includeDisabled).filter(t => t.capabilities.includes(capability));
  }

  getAgent(id: string): AgentCard | undefined {
    return this.agents.get(id);
  }

  getTool(id: string): ToolCard | undefined {
    return this.tools.get(id);
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/registry/card-registry.ts
git commit -m "feat(registry): add CardRegistry with register/list/find-by-capability"
```

---

### Task 4: Write tests

**Files:**
- Create: `tests/registry/card-registry.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAgentCard } from "../../src/registry/agent-card.js";
import { validateToolCard } from "../../src/registry/tool-card.js";
import { CardRegistry } from "../../src/registry/card-registry.js";
import type { AgentCard } from "../../src/registry/agent-card.js";
import type { ToolCard } from "../../src/registry/tool-card.js";

describe("AgentCard validation", () => {

  it("passes for valid card", () => {
    const card: AgentCard = {
      id: "research.scout", name: "Research Scout", description: "Searches the web",
      version: "1.0.0", domains: ["research"], capabilities: ["web.search"],
      enabled: true,
    };
    assert.equal(validateAgentCard(card).valid, true);
  });

  it("fails for missing id", () => {
    const card = { name: "Test", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true } as AgentCard;
    const v = validateAgentCard(card);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some(e => e.includes("id")));
  });

  it("fails for missing name", () => {
    assert.equal(validateAgentCard({ id: "x", name: "", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true } as AgentCard).valid, false);
  });
});

describe("ToolCard validation", () => {

  it("passes for valid card", () => {
    const card: ToolCard = {
      id: "web.search", name: "Web Search", description: "Search the web",
      version: "1.0.0", capabilities: ["web.search"],
      riskLevel: "low", approvalMode: "auto", enabled: true,
    };
    assert.equal(validateToolCard(card).valid, true);
  });

  it("fails for invalid riskLevel", () => {
    const card = { id: "t", name: "t", description: "x", version: "1.0", capabilities: [], riskLevel: "extreme", approvalMode: "auto", enabled: true } as ToolCard;
    assert.equal(validateToolCard(card).valid, false);
  });

  it("fails for missing approvalMode", () => {
    const card = { id: "t", name: "t", description: "x", version: "1.0", capabilities: [], riskLevel: "low", approvalMode: "", enabled: true } as ToolCard;
    assert.equal(validateToolCard(card).valid, false);
  });
});

describe("CardRegistry", () => {

  it("registers and lists agents", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "a1", name: "Agent 1", description: "x", version: "1.0", domains: ["d"], capabilities: ["c1"], enabled: true });
    reg.registerAgent({ id: "a2", name: "Agent 2", description: "x", version: "1.0", domains: ["d"], capabilities: ["c2"], enabled: true });
    assert.equal(reg.listAgents().length, 2);
  });

  it("rejects duplicate agent IDs", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "dup", name: "A", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true });
    assert.throws(() => reg.registerAgent({ id: "dup", name: "B", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true }));
  });

  it("rejects duplicate tool IDs", () => {
    const reg = new CardRegistry();
    reg.registerTool({ id: "t1", name: "T", description: "x", version: "1.0", capabilities: [], riskLevel: "low", approvalMode: "auto", enabled: true });
    assert.throws(() => reg.registerTool({ id: "t1", name: "T2", description: "x", version: "1.0", capabilities: [], riskLevel: "low", approvalMode: "auto", enabled: true }));
  });

  it("findAgentsByCapability returns matching agents", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "r1", name: "R1", description: "x", version: "1.0", domains: [], capabilities: ["web.search"], enabled: true });
    reg.registerAgent({ id: "r2", name: "R2", description: "x", version: "1.0", domains: [], capabilities: ["file.read"], enabled: true });
    assert.equal(reg.findAgentsByCapability("web.search").length, 1);
    assert.equal(reg.findAgentsByCapability("web.search")[0].id, "r1");
  });

  it("findToolsByCapability returns matching tools", () => {
    const reg = new CardRegistry();
    reg.registerTool({ id: "ws", name: "Web Search", description: "x", version: "1.0", capabilities: ["web.search"], riskLevel: "low", approvalMode: "auto", enabled: true });
    reg.registerTool({ id: "fr", name: "File Read", description: "x", version: "1.0", capabilities: ["file.read"], riskLevel: "low", approvalMode: "auto", enabled: true });
    assert.equal(reg.findToolsByCapability("file.read").length, 1);
    assert.equal(reg.findToolsByCapability("file.read")[0].id, "fr");
  });

  it("excludes disabled cards by default", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "enabled", name: "E", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true });
    reg.registerAgent({ id: "disabled", name: "D", description: "x", version: "1.0", domains: [], capabilities: [], enabled: false });
    assert.equal(reg.listAgents().length, 1);
    assert.equal(reg.listAgents(true).length, 2);
  });

  it("getAgent returns single agent by ID", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "get_me", name: "G", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true });
    assert.ok(reg.getAgent("get_me"));
    assert.equal(reg.getAgent("nonexistent"), undefined);
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/registry/card-registry.test.js 2>&1
```

Expected: 12+ tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/registry/card-registry.test.ts
git commit -m "test(registry): card validation, registration, lookup, and disabled filtering"
```
