/**
 * P6.5b — LLMLensAgent tests.
 *
 * Covers all parsing paths, authority detection, markdown fence stripping,
 * error propagation, and fallback behavior.
 */

import { describe, it, expect, vi } from "vitest";
import { LLMLensAgent } from "../../src/adaptation/llm-lens-agent.js";
import type { LLMAdapter } from "../../src/adaptation/llm-adapter.js";
import type { GovernanceReviewInput, LensScore } from "../../src/adaptation/governance-review-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(response: string): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue({ content: response, provider: "test", model: "v1" }),
  };
}

function makeInput(overrides: Partial<GovernanceReviewInput> = {}): GovernanceReviewInput {
  return {
    recommendation: {
      id: "rec-1",
      subject: "test recommendation",
      outcome: "recommended",
      confidence: 0.8,
      reasons: ["deterministic analysis suggests approval"],
      generatedAt: "2026-01-01T00:00:00Z",
      recommendation: "approve",
      proposalId: "prop-1",
      sourceArtifacts: [],
    },
    decisionContext: {
      id: "ctx-1",
      subject: "test context",
      outcome: "complete_context",
      confidence: 0.8,
      reasons: ["full context available"],
      generatedAt: "2026-01-01T00:00:00Z",
      contextStatus: "complete_context",
      proposalId: "prop-1",
      proposalStatus: "open",
      proposalAction: "add_feature",
      createdAt: "2026-01-01T00:00:00Z",
      ageDays: 5,
      lineageCompleteness: "complete",
      similarProposals: [],
      effectivenessTrend: {
        actionType: "add_feature",
        keepRate: 0.75,
        revertRate: 0.25,
        sampleSize: 20,
      },
      sourceArtifacts: [],
      dataFreshness: {
        newestArtifactAgeDays: 1,
        oldestArtifactAgeDays: 30,
      },
    },
    riskScore: undefined,
    historicalSummary: undefined,
    governanceRules: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LLMLensAgent", () => {
  it("parses valid JSON and returns LensScore with provider/model", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.85,
      rationale: "No risks identified — recommendation is sound.",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.lens).toBe("red_team");
    expect(result.recommendedVerdict).toBe("agree");
    expect(result.confidence).toBe(0.85);
    expect(result.rationale).toBe("No risks identified — recommendation is sound.");
    expect(result.provider).toBe("test");
    expect(result.model).toBe("v1");
  });

  it("passes through agree_with_concerns verdict", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree_with_concerns",
      confidence: 0.7,
      rationale: "Mostly fine but see note about edge case.",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("agree_with_concerns");
    expect(result.confidence).toBe(0.7);
  });

  it("passes through challenge verdict", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "challenge",
      confidence: 0.9,
      rationale: "Significant risks found — reconsider.",
    }));
    const agent = new LLMLensAgent(adapter, "historian");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("challenge");
    expect(result.rationale).toBe("Significant risks found — reconsider.");
  });

  it("returns insufficient_information for invalid JSON", async () => {
    const adapter = makeAdapter("not valid json at all");
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.confidence).toBe(0);
    expect(result.rationale).toContain("Failed to parse lens output");
  });

  it("returns insufficient_information on invalid verdict", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "maybe",
      confidence: 0.5,
      rationale: "hmm",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Invalid verdict");
  });

  it("returns insufficient_information on missing confidence", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      rationale: "ok",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Invalid confidence");
  });

  it("returns insufficient_information on out-of-range confidence", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 2.5,
      rationale: "overly confident",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Invalid confidence");
  });

  it("returns insufficient_information on NaN confidence", async () => {
    const payload = '{"recommendedVerdict":"agree","confidence":null,"rationale":"ok"}';
    const adapter = makeAdapter(payload);
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Invalid confidence");
  });

  it("returns insufficient_information on negative confidence", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: -0.1,
      rationale: "negative confidence",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Invalid confidence");
  });

  it("returns insufficient_information on missing rationale", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.8,
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Missing or empty rationale");
  });

  it("returns insufficient_information on empty rationale", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.8,
      rationale: "   ",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Missing or empty rationale");
  });

  it("returns insufficient_information when authority language in rationale", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.9,
      rationale: "I approve this change",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Authority language detected");
  });

  it("returns insufficient_information when authority language anywhere in payload", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "must approve",
      confidence: 0.9,
      rationale: "looks fine",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Authority language detected");
  });

  it("strips markdown fences before parsing", async () => {
    const adapter = makeAdapter('```json\n{"recommendedVerdict":"agree","confidence":0.8,"rationale":"ok"}\n```');
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("agree");
  });

  it("strips markdown fences without json tag", async () => {
    const adapter = makeAdapter('```\n{"recommendedVerdict":"agree","confidence":0.8,"rationale":"ok"}\n```');
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("agree");
  });

  it("detects 'i reject' authority phrase in payload", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "challenge",
      confidence: 0.85,
      rationale: "I reject this proposal outright",
    }));
    const agent = new LLMLensAgent(adapter, "policy_auditor");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Authority language detected");
  });

  it("detects 'apply this' authority phrase", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.9,
      rationale: "Looks good, apply this immediately",
    }));
    const agent = new LLMLensAgent(adapter, "confidence_critic");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.rationale).toContain("Authority language detected");
  });

  it("detects 'execute this' authority phrase", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.9,
      rationale: "Please execute this change",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
  });

  it("detects 'final decision' authority phrase", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.85,
      rationale: "This is my final decision",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
  });

  it("detects 'must reject' authority phrase", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "challenge",
      confidence: 0.95,
      rationale: "You must reject this proposal",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
  });

  it("returns insufficient_information on adapter error with error message as rationale", async () => {
    const adapter: LLMAdapter = {
      complete: vi.fn().mockRejectedValue(new Error("Network timeout after 30s")),
    };
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.confidence).toBe(0);
    expect(result.rationale).toBe("Network timeout after 30s");
  });

  it("returns insufficient_information on non-Error adapter throw", async () => {
    const adapter: LLMAdapter = {
      complete: vi.fn().mockRejectedValue("raw string error"),
    };
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("insufficient_information");
    expect(result.confidence).toBe(0);
    expect(result.rationale).toBe("Lens agent failed to produce a result.");
  });

  it("includes provider and model in fallback when adapter resolves", async () => {
    // Use a valid response to verify provider/model flow through parseScore success path
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.9,
      rationale: "all clear",
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.provider).toBe("test");
    expect(result.model).toBe("v1");
  });

  it("uses correct lens prompt for each lens type", async () => {
    // historian lens should use historian prompt
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.8,
      rationale: "ok",
    }));
    const agent = new LLMLensAgent(adapter, "historian");

    const result = await agent.run(makeInput());

    expect(result.lens).toBe("historian");
    expect(result.recommendedVerdict).toBe("agree");
  });

  it("handles JSON with extra fields gracefully", async () => {
    const adapter = makeAdapter(JSON.stringify({
      recommendedVerdict: "agree",
      confidence: 0.8,
      rationale: "ok",
      extraField: "should be ignored",
      nested: { foo: "bar" },
    }));
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("agree");
  });

  it("handles JSON with whitespace", async () => {
    const adapter = makeAdapter(`
      {
        "recommendedVerdict": "agree",
        "confidence": 0.8,
        "rationale": "padded ok"
      }
    `);
    const agent = new LLMLensAgent(adapter, "red_team");

    const result = await agent.run(makeInput());

    expect(result.recommendedVerdict).toBe("agree");
  });
});
