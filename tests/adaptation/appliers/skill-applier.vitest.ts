/**
 * P5.1f — SkillApplier tests.
 *
 * SkillApplier applies approved AdaptationProposals with action
 *   adjust_skill_definition
 * by writing to .alix/skills/workflow/<id>.json.
 *
 * Payload contract for adjust_skill_definition:
 *   {
 *     step:   string  — the SkillStep.step identifier to target (e.g. "plan")
 *     action: string  — the new action description to write onto that step
 *   }
 * The applier finds the matching step by its `step` id and replaces the
 * step's `action` field. All other steps and fields are preserved.
 *
 * These tests use a temporary directory for the .alix/skills/workflow/ path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillApplier } from "../../../src/adaptation/appliers/skill-applier.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal but valid SkillDefinition payload (matches the shape in
 * src/workflow/skill.ts). Used both to seed files and as proposal payloads.
 */
function makeSkillDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "issue-lifecycle",
    name: "Issue Lifecycle",
    description: "Full issue lifecycle: intake, plan, review, execute, PR",
    requiresCapabilities: [
      "workflow.intake",
      "workflow.planning",
      "workflow.review",
      "workflow.execution",
      "workflow.pr",
    ],
    steps: [
      { step: "intake", agent: "workflow.intake", action: "Read and validate issue, produce WorkPackage" },
      { step: "plan", agent: "workflow.planning", action: "Convert WorkPackage to ExecutionPlan" },
      {
        step: "review-plan",
        agent: "workflow.review",
        action: "Review ExecutionPlan for completeness and risk",
        requiresApproval: true,
      },
      {
        step: "execute",
        agent: "workflow.execution",
        action: "Execute each subtask with test gating",
        requiresApproval: true,
      },
      { step: "review-code", agent: "workflow.review", action: "Review completed code changes" },
      { step: "pr", agent: "workflow.pr", action: "Create draft PR with evidence links" },
    ],
    ...overrides,
  };
}

function makeProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "prop-2026-06-19-001",
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "approved",
    action: "adjust_skill_definition",
    target: { kind: "skill", id: "issue-lifecycle" },
    payload: { step: "plan", action: "Convert WorkPackage to ExecutionPlan with risk annotations" },
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.85,
    evidenceFingerprints: ["fp-1", "fp-2"],
    reason: "test",
    approvedBy: "alice",
    approvedAt: "2026-06-19T00:00:01.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpRoot: string;
let skillsDir: string;
let applier: SkillApplier;

beforeEach(() => {
  // Create a fresh temp root with .alix/skills/workflow/ inside.
  tmpRoot = mkdtempSync(join(tmpdir(), "skill-applier-"));
  skillsDir = join(tmpRoot, ".alix", "skills", "workflow");
  mkdirSync(skillsDir, { recursive: true });
  applier = new SkillApplier(skillsDir);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function skillPath(id: string): string {
  return join(skillsDir, `${id}.json`);
}

// ---------------------------------------------------------------------------
// Status guard
// ---------------------------------------------------------------------------

describe("SkillApplier — status guard", () => {
  it("throws when proposal status is 'pending'", async () => {
    const proposal = makeProposal({ status: "pending" });
    await expect(applier.apply(proposal)).rejects.toThrow(/expected "approved"/i);
  });

  it("throws when proposal status is 'rejected'", async () => {
    const proposal = makeProposal({ status: "rejected" });
    await expect(applier.apply(proposal)).rejects.toThrow(/expected "approved"/i);
  });

  it("throws when proposal status is 'applied'", async () => {
    const proposal = makeProposal({ status: "applied" });
    await expect(applier.apply(proposal)).rejects.toThrow(/expected "approved"/i);
  });
});

// ---------------------------------------------------------------------------
// adjust_skill_definition
// ---------------------------------------------------------------------------

describe("SkillApplier — adjust_skill_definition", () => {
  it("replaces the targeted step's action description", async () => {
    const id = "issue-lifecycle";
    writeFileSync(skillPath(id), JSON.stringify(makeSkillDefinition(), null, 2), "utf-8");

    const newAction = "Convert WorkPackage to ExecutionPlan with explicit risk annotations";
    const proposal = makeProposal({
      target: { kind: "skill", id },
      payload: { step: "plan", action: newAction },
    });

    await applier.apply(proposal);

    const updated = JSON.parse(readFileSync(skillPath(id), "utf-8"));
    const planStep = updated.steps.find((s: { step: string }) => s.step === "plan");
    expect(planStep.action).toBe(newAction);
  });

  it("preserves the other steps and all other fields on the skill", async () => {
    const id = "issue-lifecycle";
    const original = makeSkillDefinition();
    writeFileSync(skillPath(id), JSON.stringify(original, null, 2), "utf-8");

    const proposal = makeProposal({
      target: { kind: "skill", id },
      payload: { step: "execute", action: "Run each subtask with mandatory test gates" },
    });

    await applier.apply(proposal);

    const updated = JSON.parse(readFileSync(skillPath(id), "utf-8"));
    // Untouched fields preserved
    expect(updated.id).toBe("issue-lifecycle");
    expect(updated.name).toBe("Issue Lifecycle");
    expect(updated.description).toBe(original.description);
    expect(updated.requiresCapabilities).toEqual(original.requiresCapabilities);
    // All six steps still present
    expect(updated.steps).toHaveLength(6);
    // Other steps' actions untouched
    const intake = updated.steps.find((s: { step: string }) => s.step === "intake");
    expect(intake.action).toBe("Read and validate issue, produce WorkPackage");
    // Targeted step updated
    const execute = updated.steps.find((s: { step: string }) => s.step === "execute");
    expect(execute.action).toBe("Run each subtask with mandatory test gates");
    // Non-action fields on the targeted step preserved
    expect(execute.agent).toBe("workflow.execution");
    expect(execute.requiresApproval).toBe(true);
  });

  it("uses the skill target id from the proposal (not payload id) as filename", async () => {
    // Seed a skill under one id, target it by a different id in the payload.
    writeFileSync(skillPath("issue-lifecycle"), JSON.stringify(makeSkillDefinition(), null, 2), "utf-8");

    const proposal = makeProposal({
      target: { kind: "skill", id: "issue-lifecycle" },
      payload: {
        // payload carries a different id — must be ignored as the filename key
        id: "different.id",
        step: "plan",
        action: "x",
      },
    });

    await applier.apply(proposal);

    expect(existsSync(skillPath("issue-lifecycle"))).toBe(true);
    expect(existsSync(skillPath("different.id"))).toBe(false);
  });

  it("writes pretty-printed JSON", async () => {
    const id = "issue-lifecycle";
    writeFileSync(skillPath(id), JSON.stringify(makeSkillDefinition(), null, 2), "utf-8");

    const proposal = makeProposal({
      target: { kind: "skill", id },
      payload: { step: "plan", action: "x" },
    });

    await applier.apply(proposal);

    const raw = readFileSync(skillPath(id), "utf-8");
    // Pretty-printed JSON contains a newline + two-space indent.
    expect(raw).toContain("\n  ");
  });

  it("throws if the skill file does not exist", async () => {
    const proposal = makeProposal({
      target: { kind: "skill", id: "does.not.exist" },
      payload: { step: "plan", action: "x" },
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/not found/i);
  });

  it("throws if the targeted step id does not exist in the skill", async () => {
    const id = "issue-lifecycle";
    writeFileSync(skillPath(id), JSON.stringify(makeSkillDefinition(), null, 2), "utf-8");

    const proposal = makeProposal({
      target: { kind: "skill", id },
      payload: { step: "no.such.step", action: "x" },
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/step/i);
  });

  it("throws if payload is missing the 'step' field", async () => {
    const id = "issue-lifecycle";
    writeFileSync(skillPath(id), JSON.stringify(makeSkillDefinition(), null, 2), "utf-8");

    const proposal = makeProposal({
      target: { kind: "skill", id },
      payload: { action: "x" },
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/step/i);
  });

  it("throws if payload is missing the 'action' field", async () => {
    const id = "issue-lifecycle";
    writeFileSync(skillPath(id), JSON.stringify(makeSkillDefinition(), null, 2), "utf-8");

    const proposal = makeProposal({
      target: { kind: "skill", id },
      payload: { step: "plan" },
    });

    await expect(applier.apply(proposal)).rejects.toThrow(/action/i);
  });
});

// ---------------------------------------------------------------------------
// Unsupported action
// ---------------------------------------------------------------------------

describe("SkillApplier — unsupported actions", () => {
  it("throws on 'create_agent_card'", async () => {
    const proposal = makeProposal({ action: "create_agent_card" });
    await expect(applier.apply(proposal)).rejects.toThrow(/unsupported action/i);
  });

  it("throws on 'update_agent_card'", async () => {
    const proposal = makeProposal({ action: "update_agent_card" });
    await expect(applier.apply(proposal)).rejects.toThrow(/unsupported action/i);
  });

  it("throws on 'add_capability'", async () => {
    const proposal = makeProposal({ action: "add_capability" });
    await expect(applier.apply(proposal)).rejects.toThrow(/unsupported action/i);
  });
});
