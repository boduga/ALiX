/**
 * P10.4a — PlanStore (immutable plan persistence).
 *
 * Append-once immutable store. Written once at save time; contentHash is
 * verified on every load. Uses atomic write pattern (SnapshotStore parity):
 * write to .tmp, fsync, renameSync.
 *
 * @module
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, parse } from "node:path";
import { createHash } from "node:crypto";
import type { ExecutionPlan } from "./planning-engine.js";
import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function validatePlan(plan: ExecutionPlan): void {
  if (!plan.steps || plan.steps.length === 0) {
    throw new Error("Plan validation failed: steps must be non-empty");
  }
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const prefix = `Plan validation failed: step[${i}]`;
    if (!step.id) throw new Error(`${prefix} is missing required field "id"`);
    if (!step.action) throw new Error(`${prefix} is missing required field "action"`);
    if (!step.targetSubsystem) throw new Error(`${prefix} is missing required field "targetSubsystem"`);
    if (!step.objectiveId) throw new Error(`${prefix} is missing required field "objectiveId"`);
    if (step.priorityScore === undefined || step.priorityScore === null) {
      throw new Error(`${prefix} is missing required field "priorityScore"`);
    }
  }
}

export class PlanStore {
  constructor(private readonly dir: string) {}

  /** Save an immutable plan. Atomic write with fsync. */
  async save(
    plan: ExecutionPlan,
    evidenceWriter?: EvidenceEventWriter,
  ): Promise<PersistedExecutionPlan> {
    validatePlan(plan);

    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const persisted: PersistedExecutionPlan = {
      ...plan,
      contentHash: sha256(JSON.stringify(plan)),
    };

    const targetPath = join(this.dir, `${plan.id}.json`);
    const tmpPath = targetPath + ".tmp";

    const fd = openSync(tmpPath, "w");
    try {
      writeFileSync(fd, JSON.stringify(persisted, null, 2), "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);

    // Best-effort evidence emission — never throws
    if (evidenceWriter) {
      try {
        await evidenceWriter.recordExecutivePlanSaved({
          planId: plan.id,
          contentHash: persisted.contentHash,
          stepCount: plan.steps.length,
          executionId: undefined,
        });
      } catch {
        // best-effort — never throw from evidence
      }
    }

    return persisted;
  }

  /** Load an immutable plan. Verifies contentHash on every read. */
  load(planId: string): PersistedExecutionPlan {
    const targetPath = join(this.dir, `${planId}.json`);
    if (!existsSync(targetPath)) {
      throw new Error(`Plan not found: ${planId}`);
    }
    const raw = readFileSync(targetPath, "utf-8");
    const plan = JSON.parse(raw) as PersistedExecutionPlan;

    // Verify contentHash
    const { contentHash, ...content } = plan;
    const expectedHash = sha256(JSON.stringify(content));
    if (contentHash !== expectedHash) {
      throw new Error(
        `Plan ${planId} contentHash mismatch: expected ${expectedHash}, got ${contentHash}`,
      );
    }
    return plan;
  }

  /** List all saved plans, newest first. */
  list(): PersistedExecutionPlan[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter(f => f.endsWith(".json") && f.endsWith("-state.json") === false)
      .map(f => parse(f).name)
      .map(id => {
        try { return this.load(id); }
        catch { return null; }
      })
      .filter((p): p is PersistedExecutionPlan => p !== null)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }
}
