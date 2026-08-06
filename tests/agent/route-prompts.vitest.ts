/**
 * route-prompts.vitest.ts — T16 #393
 *
 * Tests Layer 3 prompt construction. buildDirectPrompt consumes canonical-
 * intent labels (ActionIntent) emitted by Layer 1 and returns deterministic
 * prompt + tool manifest + permission scope. The function signature carries
 * NO raw prompt text — re-classification is forbidden per T15 audit (#390).
 *
 * Verifies:
 *   - Each canonical intent produces a deterministic prompt
 *   - Permission scope respects the read-only / mutation boundary
 *   - System prompt always identifies as ALiX (existing test contract)
 *   - No-reclassification closed-world: same intent → identical output
 */

import { describe, it, expect } from "vitest";
import { buildDirectPrompt } from "../../src/agent/route-prompts.js";

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
