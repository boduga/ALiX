/**
 * P5.1e — AgentCardApplier tests.
 *
 * AgentCardApplier applies approved AdaptationProposals with action
 *   create_agent_card | update_agent_card | add_capability
 * by writing to .alix/cards/agents/<id>.json.
 *
 * These tests use a temporary directory for the .alix/cards/agents/ path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentCardApplier } from "../../../src/adaptation/appliers/agent-card-applier.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal but valid AgentCard payload for use in proposal.payload.
 * Matches AgentCard shape from src/registry/agent-card.ts.
 */
function makeCardPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test.agent",
    name: "Test Agent",
    description: "An agent used in tests",
    version: "1.0.0",
    domains: ["general"],
    capabilities: ["test.capability"],
    enabled: true,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "prop-2026-06-19-001",
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "approved",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "test.agent" },
    payload: makeCardPayload(),
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.85,
    evidenceFingerprints: ["fp-1", "fp-2"],
    reason: "test",
    approvedBy: "alice",
    approvedAt: "2026-06-19T00:00:01.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpRoot: string;
let cardsDir: string;
let applier: AgentCardApplier;

beforeEach(() => {
  // Create a fresh temp root with .alix/cards/agents/ inside.
  tmpRoot = mkdtempSync(join(tmpdir(), "agent-card-applier-"));
  cardsDir = join(tmpRoot, ".alix", "cards", "agents");
  mkdirSync(cardsDir, { recursive: true });
  applier = new AgentCardApplier(cardsDir);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function cardPath(id: string): string {
  return join(cardsDir, `${id}.json`);
}

// ---------------------------------------------------------------------------
// Status guard
// ---------------------------------------------------------------------------

describe("AgentCardApplier — status guard", () => {
  it("throws when proposal status is 'pending'", async () => {
    const proposal = makeProposal({ status: "pending" });
    await expect(applier.apply(proposal)).rejects.toThrow(/expected "approved"/i);
  });

  it("throws when proposal status is 'rejected'", async () => {
    const proposal = makeProposal({ status: "rejected" });
    await expect(applier.apply(proposal)).rejects.toThrow(/expected "approved"/i);
  });

  it("throws when proposal status is 'applied'", async () => {
    const proposal = makeProposal({ status: "applied" });
    await expect(applier.apply(proposal)).rejects.toThrow(/expected "approved"/i);
  });
});

// ---------------------------------------------------------------------------
// create_agent_card
// ---------------------------------------------------------------------------

describe("AgentCardApplier — create_agent_card", () => {
  it("writes the agent card JSON to .alix/cards/agents/<id>.json", async () => {
    const proposal = makeProposal({
      action: "create_agent_card",
      target: { kind: "agent_card", id: "create.target" },
      payload: makeCardPayload({ id: "create.target", name: "Create Target" }),
    });

    await applier.apply(proposal);

    const out = cardPath("create.target");
    expect(existsSync(out)).toBe(true);
    const written = JSON.parse(readFileSync(out, "utf-8"));
    expect(written.id).toBe("create.target");
    expect(written.name).toBe("Create Target");
    expect(written.capabilities).toEqual(["test.capability"]);
  });

  it("uses the agent_card target id from the proposal (not payload id) as filename", async () => {
    const proposal = makeProposal({
      action: "create_agent_card",
      target: { kind: "agent_card", id: "target.id" },
      payload: makeCardPayload({ id: "payload.id", name: "P" }),
    });

    await applier.apply(proposal);

    expect(existsSync(cardPath("target.id"))).toBe(true);
    expect(existsSync(cardPath("payload.id"))).toBe(false);
  });

  it("writes pretty-printed JSON", async () => {
    const proposal = makeProposal({
      action: "create_agent_card",
      target: { kind: "agent_card", id: "pretty" },
      payload: makeCardPayload({ id: "pretty" }),
    });

    await applier.apply(proposal);

    const raw = readFileSync(cardPath("pretty"), "utf-8");
    // Pretty-printed JSON contains a newline + two-space indent.
    expect(raw).toContain("\n  ");
  });
});

// ---------------------------------------------------------------------------
// update_agent_card
// ---------------------------------------------------------------------------

describe("AgentCardApplier — update_agent_card", () => {
  it("deep-merges payload into the existing card and writes back", async () => {
    const id = "merge.target";
    writeFileSync(
      cardPath(id),
      JSON.stringify(
        {
          id,
          name: "Original Name",
          description: "Original desc",
          version: "1.0.0",
          domains: ["general"],
          capabilities: ["old.cap"],
          enabled: true,
          executionProfile: "coding",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const proposal = makeProposal({
      action: "update_agent_card",
      target: { kind: "agent_card", id },
      payload: {
        name: "Updated Name",
        capabilities: ["new.cap", "another.cap"],
      },
    });

    await applier.apply(proposal);

    const updated = JSON.parse(readFileSync(cardPath(id), "utf-8"));
    expect(updated.name).toBe("Updated Name");
    expect(updated.description).toBe("Original desc");
    expect(updated.version).toBe("1.0.0");
    expect(updated.executionProfile).toBe("coding");
    expect(updated.capabilities).toEqual(["new.cap", "another.cap"]);
  });

  it("throws when target card does not exist", async () => {
    const proposal = makeProposal({
      action: "update_agent_card",
      target: { kind: "agent_card", id: "does.not.exist" },
      payload: { name: "x" },
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// add_capability
// ---------------------------------------------------------------------------

describe("AgentCardApplier — add_capability", () => {
  it("adds the capability to the existing card's capabilities array", async () => {
    const id = "cap.target";
    writeFileSync(
      cardPath(id),
      JSON.stringify(
        {
          id,
          name: "Cap Target",
          description: "x",
          version: "1.0.0",
          domains: ["general"],
          capabilities: ["existing.cap"],
          enabled: true,
        },
        null,
        2,
      ),
      "utf-8",
    );

    const proposal = makeProposal({
      action: "add_capability",
      target: { kind: "agent_card", id },
      payload: { capability: "newly.added.cap" },
    });

    await applier.apply(proposal);

    const updated = JSON.parse(readFileSync(cardPath(id), "utf-8"));
    expect(updated.capabilities).toEqual(["existing.cap", "newly.added.cap"]);
  });

  it("preserves other fields on the existing card", async () => {
    const id = "preserve.target";
    writeFileSync(
      cardPath(id),
      JSON.stringify(
        {
          id,
          name: "Preserve",
          description: "x",
          version: "1.0.0",
          domains: ["research"],
          capabilities: ["old"],
          enabled: true,
          executionProfile: "research",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const proposal = makeProposal({
      action: "add_capability",
      target: { kind: "agent_card", id },
      payload: { capability: "added" },
    });

    await applier.apply(proposal);

    const updated = JSON.parse(readFileSync(cardPath(id), "utf-8"));
    expect(updated.name).toBe("Preserve");
    expect(updated.executionProfile).toBe("research");
    expect(updated.domains).toEqual(["research"]);
    expect(updated.capabilities).toEqual(["old", "added"]);
  });

  it("throws when target card does not exist", async () => {
    const proposal = makeProposal({
      action: "add_capability",
      target: { kind: "agent_card", id: "missing.card" },
      payload: { capability: "x.y.z" },
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/not found/i);
  });

  it("throws when payload is missing the 'capability' field", async () => {
    const id = "no.cap";
    writeFileSync(
      cardPath(id),
      JSON.stringify(
        {
          id,
          name: "x",
          description: "x",
          version: "1.0.0",
          domains: [],
          capabilities: [],
          enabled: true,
        },
        null,
        2,
      ),
      "utf-8",
    );

    const proposal = makeProposal({
      action: "add_capability",
      target: { kind: "agent_card", id },
      payload: {},
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/capability/i);
  });
});

// ---------------------------------------------------------------------------
// Unsupported action
// ---------------------------------------------------------------------------

describe("AgentCardApplier — unsupported actions", () => {
  it("throws on 'adjust_skill_definition'", async () => {
    const proposal = makeProposal({ action: "adjust_skill_definition" });
    await expect(applier.apply(proposal)).rejects.toThrow(/unsupported action/i);
  });

  it("throws on 'create_improvement_issue'", async () => {
    const proposal = makeProposal({ action: "create_improvement_issue" });
    await expect(applier.apply(proposal)).rejects.toThrow(/unsupported action/i);
  });

  it("throws on 'suggest_routing_weight'", async () => {
    const proposal = makeProposal({ action: "suggest_routing_weight" });
    await expect(applier.apply(proposal)).rejects.toThrow(/unsupported action/i);
  });
});
