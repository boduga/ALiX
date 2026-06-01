import { describe, it } from "node:test";
import assert from "node:assert";
import { SubagentFinding, WebSourceFinding, SynthesisFinding } from "../../src/config/schema.js";

describe("ResearchFinding types", () => {
  it("WebSourceFinding has required fields", () => {
    const finding: WebSourceFinding = {
      type: "web_source",
      content: "OAuth 2.0 best practices",
      url: "https://auth.example.com/guide",
      title: "OAuth 2.0 Best Practices",
      confidence: "high",
    };
    assert.strictEqual(finding.type, "web_source");
    assert.strictEqual(finding.url, "https://auth.example.com/guide");
    assert.strictEqual(finding.title, "OAuth 2.0 Best Practices");
  });

  it("SynthesisFinding has required fields", () => {
    const finding: SynthesisFinding = {
      type: "synthesis",
      content: "Auth should use OAuth 2.0 with PKCE",
      sources: ["https://auth.example.com", "src/auth/oauth.ts"],
      confidence: "high",
    };
    assert.strictEqual(finding.type, "synthesis");
    assert.strictEqual(finding.sources.length, 2);
  });

  it("SubagentFinding supports research types", () => {
    const webSource: SubagentFinding = {
      type: "web_source",
      content: "Best practices guide",
      confidence: "high",
      refs: ["https://example.com"],
    };
    const synthesis: SubagentFinding = {
      type: "synthesis",
      content: "Recommendation",
      confidence: "medium",
      refs: ["url1"],
    };
    assert.strictEqual(webSource.type, "web_source");
    assert.strictEqual(synthesis.type, "synthesis");
  });
});