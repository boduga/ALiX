import { describe, it, expect } from "vitest";
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
    expect(finding.type).toBe("web_source");
    expect(finding.url).toBe("https://auth.example.com/guide");
    expect(finding.title).toBe("OAuth 2.0 Best Practices");
  });

  it("SynthesisFinding has required fields", () => {
    const finding: SynthesisFinding = {
      type: "synthesis",
      content: "Auth should use OAuth 2.0 with PKCE",
      sources: ["https://auth.example.com", "src/auth/oauth.ts"],
      confidence: "high",
    };
    expect(finding.type).toBe("synthesis");
    expect(finding.sources).toHaveLength(2);
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
    expect(webSource.type).toBe("web_source");
    expect(synthesis.type).toBe("synthesis");
  });
});