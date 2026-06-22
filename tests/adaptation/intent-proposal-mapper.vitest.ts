/**
 * P7.5c — Intent → Proposal Mapper tests.
 *
 * Validates: mapping logic, error cases, boundary enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ExecutionIntent } from "../../src/adaptation/execution-intent-types.js";
import { IntentProposalMapper } from "../../src/adaptation/intent-proposal-mapper.js";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { IntentStore } from "../../src/adaptation/intent-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCapturedIntent(
  overrides: Partial<ExecutionIntent> & {
    proposedAction?: ExecutionIntent["proposedAction"];
    proposedTarget?: ExecutionIntent["proposedTarget"];
  } = {},
): ExecutionIntent {
  return {
    id: "intent:2026-06-21-test001",
    subject: "Skill run: test-skill",
    outcome: "captured",
    confidence: 1,
    reasons: ["Test intent"],
    generatedAt: "2026-06-21T12:00:00.000Z",
    source: "skill_run",
    skillId: "test-skill",
    input: "test input",
    outputSummary: "test output",
    status: "captured",
    rationale: "Test rationale",
    sourceArtifacts: [{ type: "context", id: "skill:test-skill" }],
    proposedAction: "adjust_skill_definition",
    proposedTarget: { kind: "skill", id: "test-skill" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntentProposalMapper", () => {
  let proposalDir: string;
  let intentDir: string;
  let proposalStore: ProposalStore;
  let intentStore: IntentStore;
  let mapper: IntentProposalMapper;

  beforeEach(() => {
    proposalDir = mkdtempSync(join(tmpdir(), "alix-test-proposal-store-"));
    intentDir = mkdtempSync(join(tmpdir(), "alix-test-intent-store-"));
    proposalStore = new ProposalStore(proposalDir);
    intentStore = new IntentStore(intentDir);
    mapper = new IntentProposalMapper(proposalStore);
  });

  afterEach(() => {
    rmSync(proposalDir, { recursive: true, force: true });
    rmSync(intentDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Success case
  // -----------------------------------------------------------------------

  describe("mapToProposal — success", () => {
    it("maps a valid captured intent with action + target to a pending proposal", async () => {
      const intent = makeCapturedIntent();
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.proposal).toBeDefined();
      expect(result.proposal!.status).toBe("pending");
      expect(result.proposal!.action).toBe("adjust_skill_definition");
      expect(result.proposal!.target).toEqual({ kind: "skill", id: "test-skill" });
      expect(result.proposal!.provenance).toBe("manual");
      expect(result.proposal!.sourceRecommendationType).toBe("intent:skill_run");
      expect(result.proposal!.evidenceFingerprints).toContain("intent:intent:2026-06-21-test001");

      // Verify proposal was persisted
      const loaded = await proposalStore.load(result.proposal!.id);
      expect(loaded).toBeDefined();
      expect(loaded!.status).toBe("pending");

      // Verify intent status was updated to "proposed"
      expect(intent.status).toBe("proposed");
    });

    it("uses intent rationale when reason field is populated", async () => {
      const intent = makeCapturedIntent({ rationale: "Custom rationale for testing" });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(true);
      expect(result.proposal!.reason).toBe("Custom rationale for testing");
    });

    it("generates a fallback reason when rationale is empty", async () => {
      const intent = makeCapturedIntent({ rationale: "" });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(true);
      expect(result.proposal!.reason).toContain("Proposal from skill_run");
      expect(result.proposal!.reason).toContain("test-skill");
    });

    it("honors generatedAt option", async () => {
      const intent = makeCapturedIntent();
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore, {
        generatedAt: "2026-06-21T08:00:00.000Z",
      });

      expect(result.success).toBe(true);
      expect(result.proposal!.createdAt).toBe("2026-06-21T08:00:00.000Z");
      expect(result.proposal!.id).toContain("2026-06-21");
    });
  });

  // -----------------------------------------------------------------------
  // Error: missing proposedAction
  // -----------------------------------------------------------------------

  describe("mapToProposal — missing proposedAction", () => {
    it("returns error when intent has no proposedAction", async () => {
      const intent = makeCapturedIntent({ proposedAction: undefined });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(false);
      expect(result.proposal).toBeUndefined();
      expect(result.errors).toContain(
        "ExecutionIntent has no proposedAction — cannot map to proposal",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Error: missing proposedTarget
  // -----------------------------------------------------------------------

  describe("mapToProposal — missing proposedTarget", () => {
    it("returns error when intent has no proposedTarget", async () => {
      const intent = makeCapturedIntent({ proposedTarget: undefined });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(false);
      expect(result.proposal).toBeUndefined();
      expect(result.errors).toContain(
        "ExecutionIntent has no proposedTarget — cannot map to proposal",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Error: already proposed
  // -----------------------------------------------------------------------

  describe("mapToProposal — already proposed", () => {
    it("returns error when intent status is already 'proposed'", async () => {
      const intent = makeCapturedIntent({ status: "proposed" });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(false);
      expect(result.proposal).toBeUndefined();
      expect(result.errors.some((e) => e.includes("only \"captured\" intents can be proposed"))).toBe(true);
    });

    it("returns error when intent status is 'discarded'", async () => {
      const intent = makeCapturedIntent({ status: "discarded" });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(false);
      expect(result.proposal).toBeUndefined();
      expect(result.errors.some((e) => e.includes("only \"captured\" intents can be proposed"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Different action/target combos
  // -----------------------------------------------------------------------

  describe("mapToProposal — various action/target combinations", () => {
    it("maps update_agent_card action with agent_card target", async () => {
      const intent = makeCapturedIntent({
        proposedAction: "update_agent_card",
        proposedTarget: { kind: "agent_card", id: "my-agent" },
        agentId: "my-agent",
        source: "agent",
      });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(true);
      expect(result.proposal!.action).toBe("update_agent_card");
      expect(result.proposal!.target).toEqual({ kind: "agent_card", id: "my-agent" });
      expect(result.proposal!.sourceRecommendationType).toBe("intent:agent");
    });

    it("maps create_improvement_issue action with issue target", async () => {
      const intent = makeCapturedIntent({
        proposedAction: "create_improvement_issue",
        proposedTarget: { kind: "issue", title: "Fix slow query" },
        source: "cli_run",
      });
      await intentStore.append(intent);

      const result = await mapper.mapToProposal(intent, intentStore);

      expect(result.success).toBe(true);
      expect(result.proposal!.action).toBe("create_improvement_issue");
      expect(result.proposal!.target).toEqual({ kind: "issue", title: "Fix slow query" });
    });
  });
});
