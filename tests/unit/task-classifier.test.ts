import { describe, it, expect } from "vitest";
import { classifyTask, detectResearchDepth } from "../../src/task-classifier.js";

describe("classifyTask", () => {
  it("returns research for research patterns", () => {
    expect(classifyTask("research auth tokens")).toBe("research");
    expect(classifyTask("investigate memory leak")).toBe("research");
    expect(classifyTask("analyze database schema")).toBe("research");
  });

  it("returns research for search patterns", () => {
    expect(classifyTask("search for all JWT usages")).toBe("research");
    expect(classifyTask("find all places using cache")).toBe("research");
  });

  it("returns research for analyze patterns", () => {
    expect(classifyTask("compare auth strategies")).toBe("research");
    expect(classifyTask("evaluate caching approaches")).toBe("research");
  });

  it("still classifies other types correctly", () => {
    expect(classifyTask("fix the login bug")).toBe("bugfix");
    expect(classifyTask("add user profile")).toBe("feature");
    expect(classifyTask("refactor the auth module")).toBe("refactor");
    expect(classifyTask("update the readme")).toBe("docs");
    expect(classifyTask("random text")).toBe("unknown");
  });
});

describe("detectResearchDepth", () => {
  it("detects deep research", () => {
    expect(detectResearchDepth("deep research on auth")).toBe("deep");
    expect(detectResearchDepth("analyze auth architecture")).toBe("deep");
    expect(detectResearchDepth("compare microservices strategies")).toBe("deep");
    expect(detectResearchDepth("comprehensive review of security")).toBe("deep");
  });

  it("defaults to quick", () => {
    expect(detectResearchDepth("research auth tokens")).toBe("quick");
    expect(detectResearchDepth("find all JWT usages")).toBe("quick");
    expect(detectResearchDepth("search for docs")).toBe("quick");
  });
});