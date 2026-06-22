import { describe, it, expect } from "vitest";
import type { ExecutionIntent, IntentSource, IntentStatus } from "../../src/adaptation/execution-intent-types.js";

// ---------------------------------------------------------------------------
// Type shape tests — compile-time + runtime validation
// ---------------------------------------------------------------------------

describe("ExecutionIntent types", () => {
  // -----------------------------------------------------------------------
  // IntentSource union
  // -----------------------------------------------------------------------

  describe("IntentSource", () => {
    it("accepts all four source values", () => {
      const sources: IntentSource[] = ["cli_run", "skill_run", "agent", "recipe"];
      expect(sources).toHaveLength(4);
      // Each value is a valid IntentSource at the type level
      const x: IntentSource = "cli_run";
      const y: IntentSource = "skill_run";
      const z: IntentSource = "agent";
      const w: IntentSource = "recipe";
      expect([x, y, z, w].sort()).toEqual(["agent", "cli_run", "recipe", "skill_run"]);
    });
  });

  // -----------------------------------------------------------------------
  // IntentStatus union
  // -----------------------------------------------------------------------

  describe("IntentStatus", () => {
    it("accepts all three status values", () => {
      const statuses: IntentStatus[] = ["captured", "proposed", "discarded"];
      expect(statuses).toHaveLength(3);
      const a: IntentStatus = "captured";
      const b: IntentStatus = "proposed";
      const c: IntentStatus = "discarded";
      expect([a, b, c].sort()).toEqual(["captured", "discarded", "proposed"]);
    });
  });

  // -----------------------------------------------------------------------
  // ExecutionIntent shape
  // -----------------------------------------------------------------------

  describe("ExecutionIntent", () => {
    it("constructs a minimal captured intent (skill_run)", () => {
      const intent: ExecutionIntent = {
        id: "intent:2026-06-21-abc123",
        subject: "Skill run: code-review",
        outcome: "captured",
        confidence: 1,
        reasons: ["Skill rendered with 2 substituted variable(s)"],
        generatedAt: "2026-06-21T12:00:00.000Z",
        source: "skill_run",
        input: "--prompt: Review the following code",
        outputSummary: "## Code Review\n\nReview the following code for security issues...",
        skillId: "code-review",
        status: "captured",
        rationale: "Skill run: Code Review — 2 variable(s) substituted",
        sourceArtifacts: [
          { type: "context", id: "skill:code-review" },
        ],
      };

      expect(intent.id).toBe("intent:2026-06-21-abc123");
      expect(intent.source).toBe("skill_run");
      expect(intent.skillId).toBe("code-review");
      expect(intent.status).toBe("captured");
      expect(intent.confidence).toBe(1);
    });

    it("includes optional fields when provided", () => {
      const intent: ExecutionIntent = {
        id: "intent:2026-06-21-def456",
        subject: "Agent run: triage-bot",
        outcome: "captured",
        confidence: 0.95,
        reasons: ["Auto-captured from agent execution"],
        generatedAt: "2026-06-21T14:00:00.000Z",
        source: "agent",
        input: "Review issue #123 for triage",
        outputSummary: "Issue triaged: bug, priority high",
        outputRef: "/tmp/agent-output-123.json",
        agentId: "triage-bot",
        status: "captured",
        rationale: "Agent run: triage-bot completed successfully",
        sourceArtifacts: [
          { type: "context", id: "agent:triage-bot" },
          { type: "risk", id: "risk-test-1", timestamp: "2026-06-21T13:00:00.000Z" },
        ],
        warnings: [{ message: "Agent confidence below threshold", severity: "warning" }],
        evidenceRefs: ["ev-001"],
      };

      expect(intent.agentId).toBe("triage-bot");
      expect(intent.outputRef).toBe("/tmp/agent-output-123.json");
      expect(intent.sourceArtifacts).toHaveLength(2);
      expect(intent.warnings).toHaveLength(1);
      expect(intent.evidenceRefs).toEqual(["ev-001"]);
    });

    it("satisfies ExecutionIntent[] with multiple sources", () => {
      const intents: ExecutionIntent[] = [
        {
          id: "intent:2026-06-21-001",
          subject: "CLI run",
          outcome: "captured",
          confidence: 1,
          reasons: ["Test"],
          generatedAt: "2026-06-21T10:00:00.000Z",
          source: "cli_run",
          input: "alix run foo",
          outputSummary: "Task completed",
          status: "captured",
          rationale: "Direct CLI invocation",
          sourceArtifacts: [],
        },
        {
          id: "intent:2026-06-21-002",
          subject: "Recipe run",
          outcome: "captured",
          confidence: 0.85,
          reasons: ["Test"],
          generatedAt: "2026-06-21T11:00:00.000Z",
          source: "recipe",
          input: "run-recipe-1",
          outputSummary: "Recipe executed",
          recipeId: "recipe-1",
          status: "captured",
          rationale: "Recipe execution",
          sourceArtifacts: [{ type: "context", id: "recipe:recipe-1" }],
        },
        {
          id: "intent:2026-06-21-003",
          subject: "Discarded intent",
          outcome: "discarded",
          confidence: 0.5,
          reasons: ["No longer relevant"],
          generatedAt: "2026-06-21T12:00:00.000Z",
          source: "skill_run",
          input: "obsolete",
          outputSummary: "Discarded",
          status: "discarded",
          rationale: "User discarded",
          sourceArtifacts: [],
        },
      ];

      expect(intents).toHaveLength(3);
      expect(new Set(intents.map((i) => i.source))).toEqual(
        new Set(["cli_run", "recipe", "skill_run"]),
      );
      expect(new Set(intents.map((i) => i.status))).toEqual(
        new Set(["captured", "discarded"]),
      );
    });

    it("allows proposedAction and proposedTarget for intents that lead to proposals", () => {
      const intent: ExecutionIntent = {
        id: "intent:2026-06-21-ghi789",
        subject: "Skill run: suggest-optimization",
        outcome: "proposed",
        confidence: 0.88,
        reasons: ["Optimization opportunity detected"],
        generatedAt: "2026-06-21T15:00:00.000Z",
        source: "skill_run",
        input: "Analyze performance of auth middleware",
        outputSummary: "Found N+1 query in auth middleware. Suggested fix: batch query.",
        skillId: "suggest-optimization",
        status: "proposed",
        rationale: "Skill identified a performance improvement opportunity",
        proposedAction: "update_agent_card",
        proposedTarget: { kind: "agent_card", id: "auth-agent" },
        sourceArtifacts: [
          { type: "context", id: "skill:suggest-optimization" },
          { type: "risk", id: "risk-perf-1" },
        ],
      };

      expect(intent.status).toBe("proposed");
      expect(intent.proposedAction).toBe("update_agent_card");
      expect(intent.proposedTarget).toEqual({ kind: "agent_card", id: "auth-agent" });
    });

    it("extends DecisionArtifact — inherited fields are accessible", () => {
      const intent: ExecutionIntent = {
        id: "intent:2026-06-21-jkl012",
        subject: "Test subject",
        outcome: "captured",
        confidence: 0.75,
        reasons: ["reason-1", "reason-2"],
        warnings: [{ message: "Test warning", severity: "info" }],
        evidenceRefs: ["ev-a", "ev-b"],
        generatedAt: "2026-06-21T16:00:00.000Z",
        source: "cli_run",
        input: "test",
        outputSummary: "test summary",
        status: "captured",
        rationale: "test rationale",
        sourceArtifacts: [],
      };

      // All inherited DecisionArtifact fields
      expect(intent.id).toBeTruthy();
      expect(intent.subject).toBeTruthy();
      expect(intent.outcome).toBeTruthy();
      expect(typeof intent.confidence).toBe("number");
      expect(intent.reasons).toHaveLength(2);
      expect(intent.warnings).toHaveLength(1);
      expect(intent.warnings![0].message).toBe("Test warning");
      expect(intent.evidenceRefs).toHaveLength(2);
      expect(intent.generatedAt).toBeTruthy();
    });
  });
});
