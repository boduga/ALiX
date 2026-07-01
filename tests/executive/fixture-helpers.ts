/**
 * P10.9.2d — E2E fixture bootstrap helpers.
 *
 * Shared utilities for seeding minimal .alix directory structures in
 * integration tests. Each helper creates a self-contained fixture under a
 * temp directory and returns paths for assertion use.
 *
 * @module
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Skill fixture
// ---------------------------------------------------------------------------

/** Default minimal skill definition for testing. Has a single step. */
export const DEFAULT_SKILL_DEFINITION: Record<string, unknown> = {
  name: "test-skill",
  version: "1.0.0",
  steps: [
    {
      step: "step-1",
      name: "Test Step",
      prompt: "execute test step",
    },
  ],
  metadata: { test: true },
};

/**
 * Seed a minimal skill definition file.
 *
 * @returns The path to the created skill file.
 */
export function seedSkillFixture(
  rootDir: string,
  skillId: string,
  definition?: Record<string, unknown>,
): string {
  const skillsDir = join(rootDir, ".alix", "skills", "workflow");
  mkdirSync(skillsDir, { recursive: true });

  const skillPath = join(skillsDir, `${skillId}.json`);
  writeFileSync(skillPath, JSON.stringify(definition ?? DEFAULT_SKILL_DEFINITION, null, 2), "utf-8");
  return skillPath;
}

// ---------------------------------------------------------------------------
// Governance fixtures
// ---------------------------------------------------------------------------

/** Default calibration data with a single calibration target. */
export const DEFAULT_CALIBRATION = {
  calibrations: [{ target: "test-metric", value: 0.7 }],
};

/** Default lens registry with a single lens. */
export const DEFAULT_LENS_REGISTRY = {
  lenses: [{ lens: "test-lens", status: "active" as const, enabled: true }],
};

/** Default policy coverage data. */
export const DEFAULT_POLICY_COVERAGE = {
  currentCoverage: 60,
  targetCoverage: 80,
};

/**
 * Seed a minimal governance calibration.json fixture.
 *
 * @returns The path to the created file.
 */
export function seedCalibrationFixture(
  rootDir: string,
  data?: Record<string, unknown>,
): string {
  const govDir = join(rootDir, ".alix", "governance");
  mkdirSync(govDir, { recursive: true });

  const path = join(govDir, "calibration.json");
  writeFileSync(path, JSON.stringify(data ?? DEFAULT_CALIBRATION, null, 2), "utf-8");
  return path;
}

/**
 * Seed a minimal governance lens-registry.json fixture.
 *
 * @returns The path to the created file.
 */
export function seedLensRegistryFixture(
  rootDir: string,
  data?: Record<string, unknown>,
): string {
  const govDir = join(rootDir, ".alix", "governance");
  mkdirSync(govDir, { recursive: true });

  const path = join(govDir, "lens-registry.json");
  writeFileSync(path, JSON.stringify(data ?? DEFAULT_LENS_REGISTRY, null, 2), "utf-8");
  return path;
}

/**
 * Seed a minimal governance policy-coverage.json fixture.
 *
 * @returns The path to the created file.
 */
export function seedPolicyCoverageFixture(
  rootDir: string,
  data?: Record<string, unknown>,
): string {
  const govDir = join(rootDir, ".alix", "governance");
  mkdirSync(govDir, { recursive: true });

  const path = join(govDir, "policy-coverage.json");
  writeFileSync(path, JSON.stringify(data ?? DEFAULT_POLICY_COVERAGE, null, 2), "utf-8");
  return path;
}

// ---------------------------------------------------------------------------
// Full bootstrap
// ---------------------------------------------------------------------------

/**
 * Bootstrap a complete minimal .alix directory with all fixture files
 * needed for E2E remediation testing.
 *
 * Creates:
 *   - .alix/security/              (evidence store directory)
 *   - .alix/adaptation/proposals/  (proposal store directory)
 *   - .alix/skills/workflow/       (with a default skill file)
 *   - .alix/governance/            (calibration, lens-registry, policy-coverage)
 *
 * @returns A summary object with all created paths.
 */
export function bootstrapMinimalFixture(
  rootDir: string,
  overrides?: {
    skillId?: string;
    skillDefinition?: Record<string, unknown>;
    calibration?: Record<string, unknown>;
    lensRegistry?: Record<string, unknown>;
    policyCoverage?: Record<string, unknown>;
  },
): {
  skillPath: string;
  calibrationPath: string;
  lensRegistryPath: string;
  policyCoveragePath: string;
  proposalsDir: string;
  securityDir: string;
} {
  // Security (evidence store)
  const securityDir = join(rootDir, ".alix", "security");
  mkdirSync(securityDir, { recursive: true });

  // Proposals
  const proposalsDir = join(rootDir, ".alix", "adaptation", "proposals");
  mkdirSync(proposalsDir, { recursive: true });

  // Skill
  const skillId = overrides?.skillId ?? "test-skill";
  const skillPath = seedSkillFixture(rootDir, skillId, overrides?.skillDefinition);

  // Governance
  const calibrationPath = seedCalibrationFixture(rootDir, overrides?.calibration);
  const lensRegistryPath = seedLensRegistryFixture(rootDir, overrides?.lensRegistry);
  const policyCoveragePath = seedPolicyCoverageFixture(rootDir, overrides?.policyCoverage);

  return {
    skillPath,
    calibrationPath,
    lensRegistryPath,
    policyCoveragePath,
    proposalsDir,
    securityDir,
  };
}
