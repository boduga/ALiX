/**
 * P5.1f — SkillApplier.
 *
 * Applies an approved AdaptationProposal whose action targets a skill
 * definition:
 *   - `adjust_skill_definition` → read existing skill, replace the targeted
 *                                 step's `action` description, write back.
 *
 * Invariant: the proposal MUST be in `"approved"` status. Other statuses throw.
 * This applier does NOT record evidence or update proposal status — the
 * ApprovalGate (P5.1d) is the single point that wraps applier calls with
 * evidence recording and status transitions. This module is intentionally
 * side-effect-minimal: it just writes the skill file.
 *
 * The skill id is taken from `proposal.target.id` (when `target.kind` is
 * `"skill"`) — this is the source of truth for the filename, not
 * `proposal.payload.id`. Using the target id keeps the applier consistent
 * with the rest of the registry which keys on skill id.
 *
 * Payload contract for `adjust_skill_definition`:
 *   {
 *     step:   string  — the SkillStep.step identifier to target (e.g. "plan")
 *     action: string  — the new action description to write onto that step
 *   }
 * The applier finds the step whose `step` field equals the payload's `step`
 * and replaces that step's `action` field with the payload's `action`. All
 * other steps and all other fields on the targeted step (agent, capability,
 * requiresApproval, hooks, …) are preserved. This is intentionally narrow —
 * a guided, reviewable mutation, not a general-purpose skill editor.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AdaptationProposal, ProposalTarget } from "../adaptation-types.js";
import type { SnapshotStore } from "../snapshot-store.js";
import type { EvidenceEventWriter } from "../../workflow/evidence-writer.js";

/** Path to the skill file for a given skill id. */
function skillPath(skillsDir: string, id: string): string {
  return join(skillsDir, `${id}.json`);
}

/** Extract the skill id from a `ProposalTarget`. Throws if the target isn't a skill. */
function skillIdFromTarget(target: ProposalTarget): string {
  if (target.kind !== "skill") {
    throw new Error(
      `SkillApplier requires target.kind="skill", got "${target.kind}"`,
    );
  }
  if (!target.id || typeof target.id !== "string") {
    throw new Error("SkillApplier requires target.id to be a non-empty string");
  }
  return target.id;
}

/** Read a JSON file and parse it. Throws with a helpful message if missing. */
function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`Skill not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

export class SkillApplier {
  constructor(
    private readonly skillsDir: string,
    private readonly snapshotStore?: SnapshotStore,
    private readonly writer?: EvidenceEventWriter,
  ) {}

  /**
   * Apply an approved proposal. Validates status, then dispatches to the
   * correct handler by `proposal.action`. Throws for unsupported actions.
   */
  async apply(proposal: AdaptationProposal): Promise<void> {
    if (proposal.status !== "approved") {
      throw new Error(
        `SkillApplier: proposal status is "${proposal.status}", expected "approved"`,
      );
    }

    const skillId = skillIdFromTarget(proposal.target);
    const path = skillPath(this.skillsDir, skillId);

    switch (proposal.action) {
      case "adjust_skill_definition":
        this.snapshotBeforeMutation(path, proposal);
        this.adjustStep(path, proposal.payload);
        return;
      default:
        throw new Error(
          `SkillApplier: unsupported action "${proposal.action}"`,
        );
    }
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  /**
   * Replace the `action` description of a single step in an existing skill.
   *
   * Payload contract:
   *   - `step`   (string, required) — the SkillStep.step identifier to target
   *   - `action` (string, required) — the new action description
   *
   * Throws if the skill file is missing, if the payload is malformed, or if
   * no step with the given `step` id exists in the skill.
   */
  private adjustStep(path: string, payload: Record<string, unknown>): void {
    const stepId = payload.step;
    if (typeof stepId !== "string" || stepId.length === 0) {
      throw new Error(
        'SkillApplier.adjust_skill_definition: payload must include a non-empty "step" string',
      );
    }
    const newAction = payload.action;
    if (typeof newAction !== "string" || newAction.length === 0) {
      throw new Error(
        'SkillApplier.adjust_skill_definition: payload must include a non-empty "action" string',
      );
    }

    const skill = readJson(path);
    const steps = Array.isArray(skill.steps) ? skill.steps : undefined;
    if (!steps) {
      throw new Error(
        `SkillApplier.adjust_skill_definition: skill has no "steps" array — ${path}`,
      );
    }

    let found = false;
    const updatedSteps = steps.map((step) => {
      if (
        step !== null &&
        typeof step === "object" &&
        !Array.isArray(step) &&
        (step as { step?: unknown }).step === stepId
      ) {
        found = true;
        // Preserve all other fields on the step, replace only `action`.
        return { ...(step as Record<string, unknown>), action: newAction };
      }
      return step;
    });

    if (!found) {
      throw new Error(
        `SkillApplier.adjust_skill_definition: step "${stepId}" not found in skill — ${path}`,
      );
    }

    this.writeSkill(path, { ...skill, steps: updatedSteps });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Snapshot the file at `path` before mutation, then record evidence.
   *
   * No-op when `snapshotStore` or `writer` is absent (backwards-compatible
   * with existing instantiation in `selectApplier` which passes neither).
   *
   * SkillApplier only modifies existing skills — there is no create path,
   * so every mutation path snapshots here.
   */
  private snapshotBeforeMutation(
    path: string,
    proposal: AdaptationProposal,
  ): void {
    if (!this.snapshotStore || !this.writer) return;

    const content = readFileSync(path, "utf-8");
    const base64 = Buffer.from(content, "utf-8").toString("base64");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const fingerprint = randomUUID();

    this.snapshotStore.save({
      proposalId: proposal.id,
      snapshotAt: new Date().toISOString(),
      action: proposal.action,
      target: proposal.target as { kind: string } & Record<string, unknown>,
      filePath: path,
      content: base64,
      contentHash,
      fingerprint,
    });

    this.writer.recordSnapshotTaken(proposal.id, {
      snapshotFingerprint: fingerprint,
      contentHash,
      filePath: path,
    });
  }

  /** Ensure the skills directory exists, then write the skill as pretty JSON. */
  private writeSkill(path: string, skill: Record<string, unknown>): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(skill, null, 2), "utf-8");
  }
}
