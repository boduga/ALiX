import { describe, it } from "node:test";
import assert from "node:assert";
import { CapabilityNegotiator } from "../../src/providers/capability-negotiator.js";
import type { ModelCapabilities } from "../../src/providers/types.js";

describe("CapabilityNegotiator", () => {
  it("negotiates for Claude-style provider", () => {
    const negotiator = new CapabilityNegotiator();
    const caps: ModelCapabilities = {
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      inputTokenLimit: 200000,
      outputTokenLimit: 4096,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
    };
    const result = negotiator.negotiate(caps, { taskType: "code_edit" });
    assert.ok(result.contextBudget > 0);
    assert.equal(result.editFormat, "structured_patch");
  });

  it("negotiates for Gemini-style provider", () => {
    const negotiator = new CapabilityNegotiator();
    const caps: ModelCapabilities = {
      provider: "google",
      model: "gemini-2.5-pro",
      inputTokenLimit: 1048576,
      outputTokenLimit: 65536,
      effectiveContextBudget: 800000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
    const result = negotiator.negotiate(caps, { taskType: "code_edit" });
    assert.ok(result.contextBudget > 500000);
    assert.equal(result.editFormat, "search_replace");
  });

  it("enables vision for UI tasks", () => {
    const negotiator = new CapabilityNegotiator();
    const caps: ModelCapabilities = {
      provider: "google",
      model: "gemini-2.5-pro",
      inputTokenLimit: 1048576,
      outputTokenLimit: 65536,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
    };
    const result = negotiator.negotiate(caps, { taskType: "ui_review" });
    assert.equal(result.visionEnabled, true);
  });

  it("enables structured output for plans", () => {
    const negotiator = new CapabilityNegotiator();
    const caps: ModelCapabilities = {
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      inputTokenLimit: 200000,
      outputTokenLimit: 4096,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
    };
    const result = negotiator.negotiate(caps, { taskType: "planning" });
    assert.equal(result.structuredOutputEnabled, true);
  });
});