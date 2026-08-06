/**
 * route-prompts.vitest.ts — T16 #393 + T17 #394
 *
 * Tests Layer 3 prompt construction. Both buildDirectPrompt and
 * buildChatPrompt consume canonical-intent labels (ActionIntent) emitted by
 * Layer 1 and return deterministic prompt + tool manifest + permission scope.
 * Function signatures carry NO raw prompt text — re-classification is
 * forbidden per T15 audit (#390).
 *
 * Verifies:
 *   - Each canonical intent produces a deterministic prompt (both routes)
 *   - Permission scope respects the read-only / mutation boundary
 *   - System prompt always identifies as ALiX (existing test contract)
 *   - No-reclassification closed-world: same intent → identical output
 *   - buildChatPrompt threads prior-turn intent metadata when provided
 */

import { describe, it, expect } from "vitest";
import {
  buildDirectPrompt,
  buildChatPrompt,
  buildExternalRetrievalPrompt,
} from "../../src/agent/route-prompts.js";

describe("buildDirectPrompt — Layer 3 prompt construction (T16 #393)", () => {
  describe("deterministic per canonical intent", () => {
    it("arithmetic — minimal prompt, no tools, read-only", () => {
      const p = buildDirectPrompt("arithmetic");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
      expect(p.permissions.shellExecution).toBe(false);
      expect(p.permissions.networkAccess).toBe(false);
    });

    it("generation — text prompt, no tools, read-only", () => {
      const p = buildDirectPrompt("generation");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt).toContain("Produce");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });

    it("read_only_analysis — analysis prompt, no tools, read-only", () => {
      const p = buildDirectPrompt("read_only_analysis");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt.toLowerCase()).toMatch(/do not/);
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });

    it("planning — planning prompt, no mutation tools, read-only", () => {
      const p = buildDirectPrompt("planning");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt.toLowerCase()).toMatch(/do not/);
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
      expect(p.permissions.shellExecution).toBe(false);
    });

    it("shell_execution — defensive fallback (routes to tool in practice)", () => {
      const p = buildDirectPrompt("shell_execution");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });

    it("external_retrieval — defensive fallback (routes to grounded_chat in practice)", () => {
      const p = buildDirectPrompt("external_retrieval");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });

    it("workspace_action — defensive fallback (legacy conflated, routes to agent)", () => {
      const p = buildDirectPrompt("workspace_action");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.permissions.workspaceWrite).toBe(true);
      expect(p.permissions.shellExecution).toBe(true);
    });

    it("workspace_mutation — defensive fallback (routes to agent in practice)", () => {
      const p = buildDirectPrompt("workspace_mutation");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.permissions.workspaceWrite).toBe(true);
      expect(p.permissions.shellExecution).toBe(true);
    });

    it("ambiguous — neutral fallback, read-only", () => {
      const p = buildDirectPrompt("ambiguous");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });
  });

  describe("no-reclassification invariant (Layer 3 closed-world)", () => {
    it("two prompts with same intent produce identical Layer-3 output", () => {
      // The function takes only the intent label — two calls with the same
      // intent are structurally indistinguishable. This pins the invariant:
      // raw prompt text is NOT an input.
      const p1 = buildDirectPrompt("generation");
      const p2 = buildDirectPrompt("generation");
      expect(p1).toEqual(p2);
    });

    it("two different intents produce structurally different prompts", () => {
      const arithmetic = buildDirectPrompt("arithmetic");
      const generation = buildDirectPrompt("generation");
      expect(arithmetic.systemPrompt).not.toBe(generation.systemPrompt);
    });

    it("function takes exactly one argument (raw prompt text not accepted)", () => {
      // TypeScript enforces this statically; the runtime check below pins
      // the arity so a future refactor that adds a parameter is caught by
      // the Layer-3 closed-world test.
      expect(buildDirectPrompt.length).toBe(1);
    });
  });

  describe("existing test contract preserved — every intent mentions ALiX", () => {
    // session-direct-path.vitest.ts asserts: req.systemPrompt.toMatch(/ALiX/).
    // Pin that contract for every intent family.
    const intents = [
      "arithmetic",
      "generation",
      "read_only_analysis",
      "planning",
      "shell_execution",
      "external_retrieval",
      "workspace_action",
      "workspace_mutation",
      "ambiguous",
    ] as const;

    for (const intent of intents) {
      it(`${intent} system prompt contains ALiX`, () => {
        expect(buildDirectPrompt(intent).systemPrompt).toMatch(/ALiX/);
      });
    }
  });
});

describe("buildChatPrompt — Layer 3 chat prompt construction (T17 #394)", () => {
  describe("chat-specific per canonical intent", () => {
    it("arithmetic — direct numeric answer", () => {
      const p = buildChatPrompt("arithmetic");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt).toContain("arithmetic");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });

    it("generation — conversational generation prompt", () => {
      const p = buildChatPrompt("generation");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt).toContain("generated");
      expect(p.toolManifest).toEqual([]);
    });

    it("read_only_analysis — analysis-friendly chat prompt", () => {
      const p = buildChatPrompt("read_only_analysis");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt.toLowerCase()).toMatch(/analyz|summari/);
      expect(p.toolManifest).toEqual([]);
    });

    it("planning — design/discussion chat prompt", () => {
      const p = buildChatPrompt("planning");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt.toLowerCase()).toMatch(/plan|design|recommend/);
      expect(p.toolManifest).toEqual([]);
    });

    it("shell_execution — defensive, no execution", () => {
      const p = buildChatPrompt("shell_execution");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt.toLowerCase()).toMatch(/do not/);
      expect(p.toolManifest).toEqual([]);
    });

    it("external_retrieval — defensive, points to agent path", () => {
      const p = buildChatPrompt("external_retrieval");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.toolManifest).toEqual([]);
    });

    it("workspace_action — defensive, mutation scope", () => {
      const p = buildChatPrompt("workspace_action");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.permissions.workspaceWrite).toBe(true);
    });

    it("workspace_mutation — defensive, mutation scope", () => {
      const p = buildChatPrompt("workspace_mutation");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.permissions.workspaceWrite).toBe(true);
    });

    it("ambiguous — neutral fallback, no tools, read-only", () => {
      const p = buildChatPrompt("ambiguous");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.toolManifest).toEqual([]);
      expect(p.permissions.workspaceWrite).toBe(false);
    });
  });

  describe("thread metadata", () => {
    it("no threadIntents argument — no metadata block", () => {
      const p = buildChatPrompt("ambiguous");
      expect(p.systemPrompt).not.toContain("[Thread intents");
    });

    it("empty threadIntents array — no metadata block", () => {
      const p = buildChatPrompt("ambiguous", []);
      expect(p.systemPrompt).not.toContain("[Thread intents");
    });

    it("non-empty threadIntents — metadata block appended", () => {
      const p = buildChatPrompt("planning", ["read_only_analysis", "planning"]);
      expect(p.systemPrompt).toContain(
        "[Thread intents so far: read_only_analysis, planning]",
      );
    });

    it("thread metadata appends to every intent", () => {
      const intents = [
        "arithmetic",
        "generation",
        "read_only_analysis",
        "planning",
        "shell_execution",
        "external_retrieval",
        "workspace_action",
        "workspace_mutation",
        "ambiguous",
      ] as const;
      for (const intent of intents) {
        const p = buildChatPrompt(intent, ["planning"]);
        expect(p.systemPrompt).toContain("[Thread intents so far: planning]");
      }
    });
  });

  describe("no-reclassification invariant (chat path closed-world)", () => {
    it("two calls with same intent + same thread produce identical prompts", () => {
      const thread = ["read_only_analysis", "planning"] as const;
      const p1 = buildChatPrompt("planning", thread);
      const p2 = buildChatPrompt("planning", thread);
      expect(p1).toEqual(p2);
    });

    it("two different intents produce structurally different prompts", () => {
      const arithmetic = buildChatPrompt("arithmetic");
      const generation = buildChatPrompt("generation");
      expect(arithmetic.systemPrompt).not.toBe(generation.systemPrompt);
    });

    it("function accepts at most 2 arguments (raw text never accepted)", () => {
      // Pin the arity — raw prompt text is forbidden.
      expect(buildChatPrompt.length).toBeLessThanOrEqual(2);
    });
  });

  describe("chat route contract — never expose tools across any intent", () => {
    const intents = [
      "arithmetic",
      "generation",
      "read_only_analysis",
      "planning",
      "shell_execution",
      "external_retrieval",
      "workspace_action",
      "workspace_mutation",
      "ambiguous",
    ] as const;

    for (const intent of intents) {
      it(`${intent} chat prompt has empty tool manifest`, () => {
        expect(buildChatPrompt(intent).toolManifest).toEqual([]);
      });
    }
  });
});

describe("buildExternalRetrievalPrompt — Layer 3 grounded_chat prompt pair (T18 #395)", () => {
  describe("external_retrieval — primary case", () => {
    it("system prompt identifies ALiX and is retrieval-aware", () => {
      const p = buildExternalRetrievalPrompt("external_retrieval");
      expect(p.systemPrompt).toContain("ALiX");
      expect(p.systemPrompt.toLowerCase()).toMatch(/current|search|retriev/);
      expect(p.systemPrompt.toLowerCase()).toMatch(/do not/);
    });

    it("userPromptTemplate wraps the raw query", () => {
      const p = buildExternalRetrievalPrompt("external_retrieval");
      const wrapped = p.userPromptTemplate("latest node version");
      expect(wrapped).toContain("latest node version");
      expect(wrapped.toLowerCase()).toMatch(/retrieval|search/);
    });

    it("tool manifest exposes retrieval tools only", () => {
      const p = buildExternalRetrievalPrompt("external_retrieval");
      const names = p.toolManifest.map((t) => t.name);
      expect(names).toContain("web.search");
      expect(names).toContain("web_fetch");
      // No mutation tools.
      expect(names).not.toContain("shell.run");
      expect(names).not.toContain("file.write");
    });

    it("permissions: read-only, network-isolated, no shell, no mutation", () => {
      const p = buildExternalRetrievalPrompt("external_retrieval");
      expect(p.permissions.workspaceWrite).toBe(false);
      expect(p.permissions.shellExecution).toBe(false);
      expect(p.permissions.networkAccess).toBe(true);
    });
  });

  describe("defensive cases — non-retrieval intent still returns retrieval prompt", () => {
    // Layer 3 invariant: function takes the label, returns the prompt.
    // If a non-retrieval intent is passed (e.g., legacy ambiguous fallback),
    // the function returns the canonical retrieval prompt. The executor
    // owns routing decisions; Layer 3 is honest about what it returns.
    const intents = [
      "arithmetic",
      "generation",
      "read_only_analysis",
      "planning",
      "shell_execution",
      "workspace_action",
      "workspace_mutation",
      "ambiguous",
    ] as const;

    for (const intent of intents) {
      it(`${intent} still returns retrieval prompt (defensive)`, () => {
        const p = buildExternalRetrievalPrompt(intent);
        expect(p.systemPrompt).toContain("ALiX");
        expect(p.toolManifest.map((t) => t.name)).toContain("web.search");
        expect(p.permissions.networkAccess).toBe(true);
      });
    }
  });

  describe("no-reclassification invariant (grounded_chat closed-world)", () => {
    it("two calls with same intent produce identical prompt pair", () => {
      const p1 = buildExternalRetrievalPrompt("external_retrieval");
      const p2 = buildExternalRetrievalPrompt("external_retrieval");
      expect(p1.systemPrompt).toBe(p2.systemPrompt);
      expect(p1.toolManifest).toEqual(p2.toolManifest);
      expect(p1.permissions).toEqual(p2.permissions);
    });

    it("userPromptTemplate is deterministic — same query → same wrapped text", () => {
      const p = buildExternalRetrievalPrompt("external_retrieval");
      expect(p.userPromptTemplate("foo")).toBe(p.userPromptTemplate("foo"));
    });

    it("function takes exactly one argument (raw text never accepted)", () => {
      expect(buildExternalRetrievalPrompt.length).toBe(1);
    });
  });
});
