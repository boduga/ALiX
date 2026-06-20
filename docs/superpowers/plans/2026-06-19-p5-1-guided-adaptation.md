# P5.1 — Guided Adaptation: Human-Approved Changes from Reflection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop between reflection and action — convert ReflectionReport recommendations into structured AdaptationProposals that a human can approve, then apply a narrow set of safe mutations to agent cards and skills.

**Architecture:** Recommendation → AdaptationProposal (structured change) → approval gate → narrow applier → evidence. The hard rule is **no approval, no mutation**. This is not self-evolution — it's ALiX proposing narrow changes and a human deciding whether to apply them.

**Tech Stack:** TypeScript (TSX/ESM), P4.4 EvidenceStore, P4.5 WorkflowCoordinator, P4.6 HookManager, P5.0 ReflectionReport/Recommendation types.

## Global Constraints

- **No mutation without explicit human approval.** Every applier call is gated on an approved AdaptationProposal.
- Only two mutation sources are supported in P5.1: `agent_card` (read+modify+write JSON) and `skill_definition` (read+modify+write JSON). All other proposal types are recorded with "manual action required".
- Every proposal lifecycle stage records evidence: `adaptation_proposed`, `adaptation_approved`, `adaptation_rejected`, `adaptation_applied`, `adaptation_failed`.
- Proposals live under `.alix/adaptation/proposals/<id>.json` (append-only, never mutated in place).
- All appliers are pure I/O: read JSON, modify, write, record evidence. No in-process state mutation.

---
### File Structure

| File | Role |
|------|------|
| `src/adaptation/adaptation-types.ts` | **Create** — AdaptationProposal, ProposalAction, ProposalStatus types |
| `src/adaptation/proposal-store.ts` | **Create** — JSON file persistence under `.alix/adaptation/proposals/` |
| `src/adaptation/recommendation-to-proposal.ts` | **Create** — Maps P5.0 Recommendation → AdaptationProposal |
| `src/adaptation/approval-gate.ts` | **Create** — approve/reject/apply with evidence |
| `src/adaptation/appliers/agent-card-applier.ts` | **Create** — write agent card JSON to .alix/cards/agents/ |
| `src/adaptation/appliers/skill-applier.ts` | **Create** — write skill JSON to .alix/skills/workflow/ |
| `src/cli/commands/adaptation.ts` | **Create** — `alix adaptation list/show/approve/reject/apply` |
| `tests/adaptation/` | **Create** — 6 test files |

---
## Task 1: P5.1a — AdaptationProposal Schema

**Files:**
- Create: `src/adaptation/adaptation-types.ts`
- Test: `tests/adaptation/adaptation-types.vitest.ts`

**Interfaces:**
- Produces: `ProposalAction`, `ProposalTarget`, `ProposalStatus`, `AdaptationProposal` types

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

describe("AdaptationProposal types", () => {
  it("constructs a valid proposal", () => {
    const proposal: AdaptationProposal = {
      id: "prop-2026-06-19-001",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "pending",
      action: "create_agent_card",
      target: { kind: "agent_card", id: "new.agent" },
      payload: {
        id: "new.agent",
        name: "New Agent",
        description: "Fills a capability gap",
        version: "1.0.0",
        domains: ["general"],
        capabilities: ["capability.x"],
        enabled: true,
      },
      sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.92,
      evidenceFingerprints: ["abc123def456"],
      reason: "12 goals required capability.x but no agent covers it",
    };
    expect(proposal.status).toBe("pending");
    expect(proposal.action).toBe("create_agent_card");
  });
});
```

- [ ] **Step 2: Create `src/adaptation/adaptation-types.ts`**

```typescript
export type ProposalAction =
  | "create_agent_card"
  | "update_agent_card"
  | "add_capability"
  | "adjust_skill_definition"
  | "create_improvement_issue"
  | "suggest_routing_weight";

export type ProposalTarget =
  | { kind: "agent_card"; id: string }
  | { kind: "skill"; id: string }
  | { kind: "capability"; capability: string; agentId?: string }
  | { kind: "issue"; title: string }
  | { kind: "routing_weight"; capability: string };

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface AdaptationProposal {
  /** Unique ID like "prop-YYYY-MM-DD-NNN" */
  id: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** Current state in the approval lifecycle */
  status: ProposalStatus;
  /** What action to take when applied */
  action: ProposalAction;
  /** What entity the action targets */
  target: ProposalTarget;
  /** The change payload (shape depends on action) */
  payload: Record<string, unknown>;
  /** What P5.0 Recommendation generated this proposal */
  sourceRecommendationType: string;
  /** Confidence from the source recommendation */
  sourceConfidence: number;
  /** Evidence fingerprints that justify the change */
  evidenceFingerprints: string[];
  /** Human-readable reason */
  reason: string;
  /** Approval metadata (set by approval gate) */
  approvedBy?: string;
  approvedAt?: string;
  /** Application metadata (set by applier) */
  appliedAt?: string;
  error?: string;
}
```

- [ ] **Step 3: Commit**
```bash
git add src/adaptation/adaptation-types.ts tests/adaptation/adaptation-types.vitest.ts
git commit -m "feat(p5.1a): add AdaptationProposal, ProposalAction, ProposalStatus types"
```

---
## Task 2: P5.1b — ProposalStore (JSON persistence)

**Files:**
- Create: `src/adaptation/proposal-store.ts`
- Test: `tests/adaptation/proposal-store.vitest.ts`

**Interfaces:**
- Produces: `ProposalStore` class with `save()`, `load(id)`, `list(status?)`, `update(id, patch)`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

describe("ProposalStore", () => {
  let dir: string;
  let store: ProposalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prop-"));
    store = new ProposalStore(dir);
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("saves and loads a proposal", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-1", createdAt: "2026-06-19T00:00:00Z", status: "pending",
      action: "create_agent_card", target: { kind: "agent_card", id: "x" },
      payload: {}, sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.9, evidenceFingerprints: [], reason: "test",
    };
    await store.save(proposal);
    const loaded = await store.load("prop-1");
    expect(loaded).toEqual(proposal);
  });

  it("lists proposals by status", async () => {
    for (const id of ["a", "b", "c"]) {
      await store.save({
        id, createdAt: "2026-06-19T00:00:00Z", status: id === "a" ? "approved" : "pending",
        action: "create_agent_card", target: { kind: "agent_card", id },
        payload: {}, sourceRecommendationType: "capability_gap",
        sourceConfidence: 0.9, evidenceFingerprints: [], reason: "x",
      });
    }
    const pending = await store.list("pending");
    expect(pending.length).toBe(2);
  });
});
```

- [ ] **Step 2: Create `src/adaptation/proposal-store.ts`**

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AdaptationProposal, ProposalStatus } from "./adaptation-types.js";

export class ProposalStore {
  constructor(private readonly dir: string) {}

  async save(proposal: AdaptationProposal): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2), "utf-8");
  }

  async load(id: string): Promise<AdaptationProposal | null> {
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async list(status?: ProposalStatus): Promise<AdaptationProposal[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith(".json"));
    const proposals: AdaptationProposal[] = files.map(f =>
      JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as AdaptationProposal
    );
    return status ? proposals.filter(p => p.status === status) : proposals;
  }

  async update(id: string, patch: Partial<AdaptationProposal>): Promise<AdaptationProposal> {
    const existing = await this.load(id);
    if (!existing) throw new Error(`Proposal not found: ${id}`);
    const updated = { ...existing, ...patch, id }; // id is immutable
    await this.save(updated);
    return updated;
  }
}
```

- [ ] **Step 3: Commit**
```bash
git add src/adaptation/proposal-store.ts tests/adaptation/proposal-store.vitest.ts
git commit -m "feat(p5.1b): add ProposalStore — JSON persistence for AdaptationProposals"
```

---
## Task 3: P5.1c — RecommendationToProposal Converter

**Files:**
- Create: `src/adaptation/recommendation-to-proposal.ts`
- Test: `tests/adaptation/recommendation-to-proposal.vitest.ts`

**Interfaces:**
- Consumes: `Recommendation` from P5.0
- Produces: `RecommendationToProposal.convert(rec) → AdaptationProposal | null`

- [ ] **Test** — verify that a `capability_gap` recommendation produces a `create_agent_card` proposal
- [ ] **Implement** — maps `capability_gap` to `create_agent_card`, `routing_adjustment` to `suggest_routing_weight`, others to `create_improvement_issue`
- [ ] **Commit**: `"feat(p5.1c): add RecommendationToProposal — P5.0 recommendations to P5.1 proposals"`

---
## Task 4: P5.1d — Approval Gate (no mutation without approval)

**Files:**
- Create: `src/adaptation/approval-gate.ts`
- Test: `tests/adaptation/approval-gate.vitest.ts`

**Interfaces:**
- Consumes: `ProposalStore`, `EvidenceEventWriter` from P4.4
- Produces: `ApprovalGate.approve(id, by)`, `.reject(id, by, reason)`, `.apply(id, appliers)`

The hard rule lives here. **apply** requires the proposal status to be `"approved"` — otherwise throws.

- [ ] **Test** — approve() sets status, records evidence, no mutation
- [ ] **Test** — apply() requires approved status, throws on pending
- [ ] **Test** — reject() records evidence
- [ ] **Implement** — three methods, evidence recording on each transition
- [ ] **Commit**: `"feat(p5.1d): add ApprovalGate — enforces no-approval-no-mutation invariant"`

---
## Task 5: P5.1e — Agent Card Applier

**Files:**
- Create: `src/adaptation/appliers/agent-card-applier.ts`
- Test: `tests/adaptation/appliers/agent-card-applier.vitest.ts`

**Interfaces:**
- Consumes: approved `AdaptationProposal` with `action: "create_agent_card" | "update_agent_card" | "add_capability"`
- Produces: writes JSON to `.alix/cards/agents/<id>.json`

- [ ] **Test** — `create_agent_card` writes the agent card JSON, evidence recorded
- [ ] **Test** — `add_capability` merges capability into existing card
- [ ] **Implement** — read existing or create new; modify in memory; write; record evidence
- [ ] **Commit**: `"feat(p5.1e): add AgentCardApplier — write/update agent cards from approved proposals"`

---
## Task 6: P5.1f — Skill Applier

**Files:**
- Create: `src/adaptation/appliers/skill-applier.ts`
- Test: `tests/adaptation/appliers/skill-applier.vitest.ts`

**Interfaces:**
- Consumes: approved `AdaptationProposal` with `action: "adjust_skill_definition"`
- Produces: writes JSON to `.alix/skills/workflow/<id>.json`

- [ ] **Test** — `adjust_skill_definition` replaces step's action description
- [ ] **Test** — fails if skill file doesn't exist
- [ ] **Implement** — read skill, deep-merge payload into steps, write, record evidence
- [ ] **Commit**: `"feat(p5.1f): add SkillApplier — adjust skill definitions from approved proposals"`

---
## Task 7: P5.1g — CLI

**Files:**
- Create: `src/cli/commands/adaptation.ts`
- Modify: `src/cli.ts`

- [ ] Create `handleAdaptationCommand(args)` with subcommands: `list`, `show <id>`, `propose <report.json>`, `approve <id>`, `reject <id>`, `apply <id>`
- [ ] Add help text + dispatch in cli.ts
- [ ] Commit: `"feat(p5.1g): add adaptation CLI — list/show/propose/approve/reject/apply"`

---
## Verification

```bash
npx vitest run tests/adaptation/ tests/reflection/ tests/workflow/ tests/cli/ tests/security/evidence/ --config vitest.config.mts
```

---
## Summary

After P5.1, the loop is closed:

```
ReflectionReport
  ↓
RecommendationToProposal.convert()
  ↓
AdaptationProposal (pending)
  ↓
Human: alix adaptation approve <id>
  ↓
ApprovalGate (records evidence: adaptation_approved)
  ↓
Human: alix adaptation apply <id>
  ↓
Applier (records evidence: adaptation_applied)
  ↓
Agent card or skill file updated
```

Hard rule maintained: **no approval, no mutation**. P5.1 is guided adaptation, not self-evolution. The next step toward self-evolution (P5.2) would require the system to iterate on its own proposals — that's a different design problem and deliberately deferred.
