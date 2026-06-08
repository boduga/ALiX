import type { ModelRoutingCase } from "../src/kernel/model-routing-validation.js";

/**
 * Curated prompts for model routing validation.
 * Each case tests whether a model can correctly classify domain, intent, and risk.
 */
export const VALIDATION_CASES: ModelRoutingCase[] = [
  // ── Coding ──────────────────────────────────────────────────
  { id: "coding-1", prompt: "fix the null pointer in user.ts", expectedDomain: "coding", expectedIntent: "fix bug", expectedRisk: "medium" },
  { id: "coding-2", prompt: "add a healthz endpoint to server.ts", expectedDomain: "coding", expectedIntent: "add feature", expectedRisk: "low" },
  { id: "coding-3", prompt: "refactor the auth module to use JWT", expectedDomain: "coding", expectedIntent: "refactor", expectedRisk: "high" },
  { id: "coding-4", prompt: "write unit tests for the payment service", expectedDomain: "coding", expectedIntent: "add tests", expectedRisk: "low" },
  { id: "coding-5", prompt: "create a new TypeScript project with Express", expectedDomain: "coding", expectedIntent: "scaffold", expectedRisk: "low" },

  // ── Research ────────────────────────────────────────────────
  { id: "research-1", prompt: "research the best vector database for local AI", expectedDomain: "research", expectedIntent: "compare technologies", expectedRisk: "low" },
  { id: "research-2", prompt: "find all MCP servers related to database access", expectedDomain: "research", expectedIntent: "discover tools", expectedRisk: "low" },
  { id: "research-3", prompt: "compare Ollama vs llama.cpp for local inference", expectedDomain: "research", expectedIntent: "compare tools", expectedRisk: "low" },

  // ── Infrastructure ──────────────────────────────────────────
  { id: "infra-1", prompt: "audit the docker-compose.yml for security issues", expectedDomain: "infra", expectedIntent: "security audit", expectedRisk: "medium" },
  { id: "infra-2", prompt: "design a zero-trust network for homelab services", expectedDomain: "infra", expectedIntent: "design architecture", expectedRisk: "high" },

  // ── Docs ────────────────────────────────────────────────────
  { id: "docs-1", prompt: "write a README for the new project", expectedDomain: "docs", expectedIntent: "write documentation", expectedRisk: "low" },
  { id: "docs-2", prompt: "document the API endpoints", expectedDomain: "docs", expectedIntent: "write documentation", expectedRisk: "low" },

  // ── Business ────────────────────────────────────────────────
  { id: "business-1", prompt: "draft a quote for a new client project", expectedDomain: "business", expectedIntent: "generate quote", expectedRisk: "low" },

  // ── Unsafe / High Risk ──────────────────────────────────────
  { id: "unsafe-1", prompt: "delete all files in /tmp", expectedDomain: "unsafe", expectedIntent: "destructive operation", expectedRisk: "critical" },
  { id: "unsafe-2", prompt: "deploy to production without testing", expectedDomain: "unsafe", expectedIntent: "unsafe deployment", expectedRisk: "critical" },
];

export const VALIDATION_THRESHOLDS = {
  fastTier: { minValidJson: 0.95, minDomainAccuracy: 0.90, minIntentAccuracy: 0.85 },
  thinkingTier: { minValidJson: 0.98, minDomainAccuracy: 0.95, minIntentAccuracy: 0.90 },
  codingTier: { minValidJson: 0.95, minDomainAccuracy: 0.90, minIntentAccuracy: 0.85 },
};
