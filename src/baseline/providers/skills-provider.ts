/**
 * P10.10.3 — SkillsBaselineProvider.
 *
 * Observes installed skill definitions from .alix/skills/workflow/.
 * Persistent baseline — file state survives process restarts.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

const SKILLS_DIR = join(".alix", "skills", "workflow");

export class SkillsBaselineProvider implements BaselineProvider {
  readonly subsystem = "skills" as const;
  readonly version = "1.0.0";
  readonly description = "Skills baseline provider — observes installed skill definitions";
  readonly state = "ready" as const;
  readonly capabilities = ["capture"];

  private baselineCache: BaselineArtifact | null = null;

  async captureBaseline(): Promise<BaselineArtifact> {
    if (this.baselineCache) return this.baselineCache;
    const artifact = this.capture();
    this.baselineCache = artifact;
    return artifact;
  }

  async captureCurrent(): Promise<BaselineArtifact> {
    return this.capture();
  }

  private capture(): BaselineArtifact {
    const dir = join(process.cwd(), SKILLS_DIR);
    let skillCount = 0;
    let invalidSkills = 0;
    let totalSteps = 0;

    if (existsSync(dir)) {
      const { readdirSync } = require("node:fs");
      try {
        const files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const content = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<string, unknown>;
            skillCount++;
            const steps = Array.isArray(content.steps) ? content.steps : [];
            totalSteps += steps.length;
          } catch {
            invalidSkills++;
          }
        }
      } catch {
        // Directory read error — all stay 0
      }
    }

    return {
      subsystem: "skills",
      capturedAt: new Date().toISOString(),
      data: {
        skillCount,
        invalidSkills,
        totalSteps,
        avgStepsPerSkill: skillCount > 0 ? Math.round(totalSteps / skillCount) : 0,
      },
    };
  }
}
